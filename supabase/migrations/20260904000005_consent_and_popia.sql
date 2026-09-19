-- ══════════════════════════════════════════════════════════════
-- Consent register and POPIA machinery.
--
-- This migration exists before the biometric one on purpose. Under
-- POPIA section 26, biometric information is SPECIAL personal
-- information and may not be processed at all unless a section 27
-- ground applies — in practice, the subject's explicit consent. A
-- credit bureau enquiry needs a lawful purpose under the NCA and the
-- subject's consent too.
--
-- So consent is not a checkbox recorded alongside the work; it is a
-- precondition the database enforces. The triggers added here (and in
-- the biometric migration) reject the write outright when no active
-- consent covers it. That way "we processed biometrics without
-- consent" is not a bug that can be introduced by a careless edge
-- function — it is a constraint violation.
-- ══════════════════════════════════════════════════════════════

-- ── Versioned consent wording ───────────────────────────────────
-- The exact words the subject agreed to, kept forever. A consent
-- record that cannot produce the wording it was given under is not
-- evidence of anything.
create table public.consent_texts (
  id text primary key,
  purpose text not null,
  version int not null,
  language text not null default 'en',
  body text not null,
  effective_from timestamptz not null default now(),
  retired_at timestamptz,
  unique (purpose, version, language)
);

alter table public.consent_texts enable row level security;

create policy "consent_texts_select_authenticated" on public.consent_texts
  for select to authenticated using (true);

-- ── Consent register ────────────────────────────────────────────
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete restrict,
  platform_id text references public.client_platforms(id),
  case_id text references public.verification_cases(id) on delete set null,
  purpose text not null check (purpose in (
    'identity_verification',
    'document_storage',
    'credit_enquiry',
    'biometric_processing',
    'watchlist_screening',
    'result_sharing'
  )),
  -- POPIA s26: biometrics and health data are special personal
  -- information and carry a higher bar. Derived, not caller-supplied.
  special_personal_information boolean not null default false,
  lawful_basis text not null default 'consent' check (lawful_basis in (
    'consent','contract','legal_obligation','legitimate_interest','public_law_duty'
  )),
  consent_text_id text references public.consent_texts(id),
  -- How the consent was captured, and the evidence for it.
  method text not null default 'click_wrap' check (method in (
    'click_wrap','signed_document','in_person','ussd','voice_recorded','api_attestation'
  )),
  evidence jsonb not null default '{}',
  captured_ip text,
  captured_user_agent text,
  granted_at timestamptz not null default now(),
  -- Consent is not open-ended. An expiry forces a refresh rather than
  -- letting a five-year-old click authorise today's processing.
  expires_at timestamptz not null default (now() + interval '1 year'),
  withdrawn_at timestamptz,
  withdrawal_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index consents_subject_purpose_idx on public.consents (subject_id, purpose, granted_at desc);
create index consents_case_idx on public.consents (case_id);

alter table public.consents enable row level security;

create policy "consents_select_authenticated" on public.consents
  for select to authenticated using (true);

-- Biometric consent is special personal information by definition.
-- Set here rather than trusted from the caller.
create or replace function public.mark_special_personal_information()
returns trigger
language plpgsql
as $$
begin
  if new.purpose = 'biometric_processing' then
    new.special_personal_information := true;
    -- s27 does not admit "legitimate interest" for special personal
    -- information; consent or an explicit legal obligation only.
    if new.lawful_basis not in ('consent','legal_obligation') then
      raise exception 'POPIA s27: biometric processing requires consent or a legal obligation, not %', new.lawful_basis
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger consents_mark_spi
  before insert or update on public.consents
  for each row execute function public.mark_special_personal_information();

-- The single question every gated write asks.
create or replace function public.has_active_consent(p_subject_id uuid, p_purpose text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.consents c
    where c.subject_id = p_subject_id
      and c.purpose = p_purpose
      and c.withdrawn_at is null
      and c.granted_at <= now()
      and c.expires_at > now()
  );
$$;

revoke execute on function public.has_active_consent(uuid, text) from public, anon;
grant execute on function public.has_active_consent(uuid, text) to authenticated;
-- The edge functions call this as service_role, whose implicit grant the
-- REVOKE above also removed.
grant execute on function public.has_active_consent(uuid, text) to service_role;

-- ── Consent gate on credit enquiries ────────────────────────────
-- An NCA bureau enquiry without a recorded, live consent is refused
-- at the database, whatever the calling code believes.
create or replace function public.enforce_credit_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subject_id is null then
    raise exception 'A credit check must be attached to a subject'
      using errcode = 'check_violation';
  end if;
  if not public.has_active_consent(new.subject_id, 'credit_enquiry') then
    raise exception 'No active credit_enquiry consent on record for subject %', new.subject_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger credit_checks_require_consent
  before insert on public.credit_checks
  for each row execute function public.enforce_credit_consent();

-- ── Data subject requests (POPIA s23/s24) ───────────────────────
create table public.dsar_requests (
  id text primary key,
  subject_id uuid references public.subjects(id) on delete set null,
  requester_email text,
  request_type text not null check (request_type in ('access','correction','deletion','objection','portability')),
  status text not null default 'received'
    check (status in ('received','verifying','in_progress','completed','rejected')),
  -- POPIA gives the responsible party a reasonable period; 30 days is
  -- the operating commitment.
  due_at timestamptz not null default (now() + interval '30 days'),
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome_note text,
  export_path text,
  handled_by uuid references public.profiles(id)
);

create index dsar_requests_status_idx on public.dsar_requests (status, due_at);

alter table public.dsar_requests enable row level security;

create policy "dsar_requests_select_authenticated" on public.dsar_requests
  for select to authenticated using (true);

-- ── Retention policy ────────────────────────────────────────────
-- Every class of data the hub holds declares how long it is kept and
-- why. The purge job reads this table; nothing is retained by
-- default just because no one deleted it.
create table public.retention_policies (
  id text primary key,
  entity text not null,
  description text not null,
  retain_days int not null,
  legal_basis text not null,
  active boolean not null default true
);

alter table public.retention_policies enable row level security;

create policy "retention_policies_select_authenticated" on public.retention_policies
  for select to authenticated using (true);

insert into public.retention_policies (id, entity, description, retain_days, legal_basis) values
  ('doc_images',        'documents',               'Scanned identity and supporting documents', 1825, 'FICA s22 — 5 years from end of relationship'),
  ('biometric_samples', 'biometric_samples',       'Raw captured biometric samples',               1, 'POPIA s10 minimisation — discarded once templated'),
  ('biometric_tmpl',    'biometric_templates',     'Irreversible biometric templates',           1825, 'FICA s22, subject to consent remaining live'),
  ('credit_payloads',   'credit_checks',           'Bureau enquiry results',                      730, 'NCA reg 17 — bureau data currency'),
  ('case_records',      'verification_cases',      'Verification case and decision record',      1825, 'FICA s22 — 5 years'),
  ('audit_trail',       'audit_log',               'Immutable audit trail',                      2555, 'FICA s22 / POPIA s17 — 7 years'),
  ('watchlist_hits',    'watchlist_hits',          'Sanctions and PEP screening outcomes',       1825, 'FIC Act screening record');
