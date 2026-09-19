-- ══════════════════════════════════════════════════════════════
-- Fraud detection.
--
-- The premise: most application fraud is not clever. It is the same
-- document submitted under two names, one address serving nine
-- unrelated applicants, a payslip whose gross minus deductions does
-- not equal its net, a SIM swapped four days before the application, a
-- car financed twice. None of that needs a model to catch — it needs
-- the data joined up and the arithmetic actually done.
--
-- So the rules here are DECIDABLE. Each one is a query over data the
-- hub already holds, returns a specific reason a human can check, and
-- is stored as a signal with the evidence attached. No score appears
-- without the signals that produced it.
--
-- Two design choices worth stating:
--
--   Rules are rows, not code. Thresholds, weights and severities live
--   in fraud_rules, so tuning is an update and every past decision
--   remains explicable against the rule version that made it.
--
--   Signals are linked, not merged. A critical signal raises an alert
--   for a person; it does not auto-decline. A shared address is a
--   block of flats as often as it is a syndicate, and the system that
--   cannot tell the difference should not be making that call alone.
-- ══════════════════════════════════════════════════════════════

-- ── Bank accounts ───────────────────────────────────────────────
-- Needed both for income corroboration and because a bank account
-- shared between two identities is among the strongest signals there is.
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  bank_name text,
  branch_code text,
  account_type text check (account_type in ('cheque','savings','transmission','credit_card','other')),
  -- Only the last four are kept in the clear; the hash is what links
  -- accounts across identities. Same discipline as the ID number.
  account_last4 text,
  account_hash text not null,
  account_holder_name text,
  -- Does the bank agree the account exists and is in this name?
  avs_status text check (avs_status in (
    'verified','name_mismatch','account_not_found','account_closed','unavailable','not_run'
  )),
  avs_checked_at timestamptz,
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);

create index bank_accounts_customer_idx on public.bank_accounts (customer_id);
create index bank_accounts_hash_idx on public.bank_accounts (account_hash);

alter table public.bank_accounts enable row level security;
create policy "bank_accounts_select_authenticated" on public.bank_accounts
  for select to authenticated using (true);

-- ── Rule registry ───────────────────────────────────────────────
create table public.fraud_rules (
  code text primary key,
  name text not null,
  description text not null,
  domain text not null check (domain in (
    'identity','document','address','phone','employment','banking','asset','payment','velocity'
  )),
  severity text not null check (severity in ('info','warn','critical')),
  -- Contribution to the composite fraud score, 0-100 scale.
  weight numeric(5,2) not null default 10,
  -- Rule-specific thresholds, so tuning is an update not a deploy.
  params jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.fraud_rules enable row level security;
create policy "fraud_rules_select_authenticated" on public.fraud_rules
  for select to authenticated using (true);

insert into public.fraud_rules (code, name, description, domain, severity, weight, params) values
  ('doc_reused_across_identities', 'Document reused under another identity',
   'The exact same file, by content hash, has been submitted for a different person. Either one of the two identities is fabricated, or a document has been recycled through a syndicate.',
   'document', 'critical', 30, '{}'),

  ('doc_dates_impossible', 'Document dates cannot both be true',
   'The document is issued after it expires, or issued in the future. A genuine issuer does not produce either.',
   'document', 'critical', 25, '{}'),

  ('doc_expired', 'Document has expired',
   'The document was valid but no longer is. Common and often innocent, so it asks for a fresh copy rather than implying fraud.',
   'document', 'warn', 8, '{}'),

  ('doc_mrz_failed', 'Machine-readable zone does not check out',
   'An ICAO 9303 check digit failed. The zone protects itself arithmetically, so this is alteration or a fabrication, not a scanning artefact.',
   'document', 'critical', 30, '{}'),

  ('doc_tamper_critical', 'Document shows tampering',
   'Forensic analysis found a critical signal — portrait substitution, a missing security feature, or inconsistent recompression.',
   'document', 'critical', 28, '{}'),

  ('id_mismatch_document_vs_claim', 'Identity number on the document differs from the one claimed',
   'The applicant gave one number and the document carries another.',
   'identity', 'critical', 30, '{}'),

  ('dob_inconsistent', 'Date of birth differs between sources',
   'The identity number, the document and the declared date of birth do not agree.',
   'identity', 'critical', 22, '{}'),

  ('known_fraud_hit', 'Matches the confirmed fraud register',
   'An identifier on this application matches an entity previously confirmed as fraudulent.',
   'identity', 'critical', 40, '{}'),

  ('address_shared_by_many', 'Address shared by unrelated applicants',
   'This address appears under several unrelated identities. A block of flats does this legitimately, which is why it is reviewed rather than declined.',
   'address', 'warn', 15, '{"threshold": 4}'),

  ('address_not_in_subject_name', 'Proof of residence is in someone else''s name',
   'The corroborating document does not name the applicant, so it proves where a document was sent, not where this person lives.',
   'address', 'warn', 10, '{}'),

  ('phone_shared_across_identities', 'Phone number used by another identity',
   'The same number is registered against a different person. One line, two identities.',
   'phone', 'critical', 25, '{}'),

  ('recent_sim_swap', 'SIM swapped shortly before the application',
   'Control of the number changed hands days before this application. One-time passwords and account recovery rest on that number, and this is the pattern behind most takeovers.',
   'phone', 'critical', 28, '{"max_days": 30}'),

  ('phone_not_registered_to_subject', 'Number is not registered to the applicant',
   'Under RICA the SIM is registered to someone, and it is not this person.',
   'phone', 'warn', 15, '{}'),

  ('payslip_arithmetic_failed', 'Payslip does not reconcile',
   'Gross minus deductions does not equal the stated net. A forger who edits the gross rarely recomputes the rest.',
   'employment', 'critical', 28, '{"tolerance_cents": 200}'),

  ('employer_not_at_cipc', 'Employer not found at CIPC',
   'No company registration matches the stated employer. Real employers are registered; invented ones are not.',
   'employment', 'warn', 18, '{}'),

  ('employer_flagged', 'Employer implicated in previous fraud',
   'This employer has already been linked to confirmed fraudulent applications.',
   'employment', 'critical', 32, '{}'),

  ('income_variance_high', 'Declared income does not match money received',
   'What the payslip claims and what actually lands in the bank account differ materially.',
   'employment', 'warn', 20, '{"max_variance_pct": 20}'),

  ('bank_account_shared', 'Bank account shared with another identity',
   'The same account appears under a different person. Proceeds routed to one account across several identities is a syndicate pattern.',
   'banking', 'critical', 30, '{}'),

  ('bank_account_name_mismatch', 'Bank account is not in the applicant''s name',
   'Account verification returned a different account holder.',
   'banking', 'warn', 18, '{}'),

  ('asset_already_financed', 'Asset already backs a live agreement',
   'This VIN or IMEI is already financed. Financing the same unit twice is one of the oldest frauds there is.',
   'asset', 'critical', 35, '{}'),

  ('asset_registry_adverse', 'Asset registry reports a problem',
   'The registry says the asset is encumbered, stolen, or does not exist as described.',
   'asset', 'critical', 30, '{}'),

  ('application_velocity', 'Several applications in a short window',
   'This identity has applied repeatedly across platforms in a few days, which is what shotgunning a stolen identity looks like.',
   'velocity', 'warn', 18, '{"window_days": 7, "threshold": 3}'),

  ('first_payment_default', 'Never made the first instalment',
   'A contract that defaults on its very first payment usually means the affordability was never real.',
   'payment', 'critical', 25, '{}');

-- ── Confirmed fraud register ────────────────────────────────────
-- Entities proven fraudulent, held as hashes so the register itself
-- carries no readable personal information.
create table public.known_fraud_register (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'id_hash','msisdn_hash','address_hash','account_hash','document_sha256','employer_id','device_id'
  )),
  entity_value text not null,
  reason text not null,
  -- Which case or investigation established this.
  source_alert_id uuid,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  -- Even a confirmed marker should not last forever without review.
  expires_at timestamptz,
  active boolean not null default true,
  unique (entity_type, entity_value)
);

create index known_fraud_lookup_idx on public.known_fraud_register (entity_type, entity_value)
  where active;

alter table public.known_fraud_register enable row level security;
create policy "known_fraud_register_select_authenticated" on public.known_fraud_register
  for select to authenticated using (true);

-- ── Signals and alerts ──────────────────────────────────────────
create table public.fraud_signals (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null references public.fraud_rules(code),
  -- A signal attaches to whichever of these it concerns; at least one.
  case_id text references public.verification_cases(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  contract_id text references public.contracts(id) on delete cascade,
  severity text not null check (severity in ('info','warn','critical')),
  weight numeric(5,2) not null,
  -- The specific finding, with enough detail for a person to check it
  -- without re-running anything.
  detail jsonb not null default '{}',
  -- Set when an investigator decides the signal was wrong.
  dismissed boolean not null default false,
  dismissed_by uuid references public.profiles(id),
  dismissed_reason text,
  created_at timestamptz not null default now(),
  check (case_id is not null or customer_id is not null
         or subject_id is not null or contract_id is not null)
);

create index fraud_signals_case_idx on public.fraud_signals (case_id) where not dismissed;
create index fraud_signals_customer_idx on public.fraud_signals (customer_id) where not dismissed;
create index fraud_signals_rule_idx on public.fraud_signals (rule_code, created_at desc);

alter table public.fraud_signals enable row level security;
create policy "fraud_signals_select_authenticated" on public.fraud_signals
  for select to authenticated using (true);

create table public.fraud_alerts (
  id uuid primary key default gen_random_uuid(),
  case_id text references public.verification_cases(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  platform_id text references public.client_platforms(id),
  -- 0-100 composite from the signals that fired.
  score int not null check (score between 0 and 100),
  severity text not null check (severity in ('low','medium','high','critical')),
  signal_count int not null default 0,
  critical_count int not null default 0,
  summary text,
  status text not null default 'open' check (status in (
    'open','investigating','confirmed_fraud','false_positive','closed'
  )),
  assigned_to uuid references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);

create index fraud_alerts_status_idx on public.fraud_alerts (status, created_at desc);
create index fraud_alerts_customer_idx on public.fraud_alerts (customer_id);

alter table public.fraud_alerts enable row level security;
create policy "fraud_alerts_select_authenticated" on public.fraud_alerts
  for select to authenticated using (true);

-- ── Document forensics ──────────────────────────────────────────
create table public.document_forensics (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  -- Perceptual hash: catches the same image re-saved, cropped or
  -- lightly edited, which a content hash alone would miss.
  perceptual_hash text,
  -- What produced the file. A "scanned ID" whose producer is an image
  -- editor is worth a second look.
  producer_software text,
  creation_date timestamptz,
  modification_date timestamptz,
  has_digital_signature boolean,
  signature_valid boolean,
  -- Signals with a severity each, same shape as tamper_signals.
  findings jsonb not null default '[]',
  provider text not null default 'simulation',
  created_at timestamptz not null default now()
);

create index document_forensics_document_idx on public.document_forensics (document_id);
create index document_forensics_phash_idx on public.document_forensics (perceptual_hash)
  where perceptual_hash is not null;

alter table public.document_forensics enable row level security;
create policy "document_forensics_select_authenticated" on public.document_forensics
  for select to authenticated using (true);

-- ── Detection ───────────────────────────────────────────────────
-- The same file submitted for two different people. Content hash, so
-- there is no judgement involved: it is either the same bytes or not.
create or replace function public.detect_document_reuse(p_document_id uuid)
returns table (other_document_id uuid, other_subject_id uuid, other_case_id text, sha256 text)
language sql
stable
security definer
set search_path = public
as $$
  select d2.id, d2.subject_id, d2.case_id, d2.sha256
  from public.documents d1
  join public.documents d2
    on d2.sha256 = d1.sha256
   and d2.id <> d1.id
   and d2.subject_id is distinct from d1.subject_id
  where d1.id = p_document_id
    and d1.subject_id is not null
    and d2.subject_id is not null;
$$;

-- The main entry point. Evaluates every active rule that can be
-- decided from stored data, writes the signals, and returns the
-- composite. Deliberately idempotent per run: signals from a previous
-- screen of the same case are superseded, not duplicated.
create or replace function public.run_fraud_screen(
  p_case_id text default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject uuid;
  v_platform text;
  r record;
  rule record;
  v_score numeric := 0;
  v_signals int := 0;
  v_critical int := 0;
  v_severity text;
  v_alert_id uuid;
  v_params jsonb;
begin
  if p_case_id is null and p_customer_id is null then
    raise exception 'run_fraud_screen needs a case id or a customer id';
  end if;

  -- Resolve the subject either way, since most rules are about the person.
  if p_case_id is not null then
    select subject_id, platform_id into v_subject, v_platform
    from public.verification_cases where id = p_case_id;
  else
    select subject_id, platform_id into v_subject, v_platform
    from public.customers where id = p_customer_id;
  end if;

  -- Clear prior undismissed signals for this screen so a re-run
  -- reflects current data rather than accumulating history. Dismissed
  -- ones survive: an investigator's judgement is not discarded.
  delete from public.fraud_signals
  where not dismissed
    and ((p_case_id is not null and case_id = p_case_id)
      or (p_customer_id is not null and customer_id = p_customer_id));

  -- ── Document rules ────────────────────────────────────────────
  for r in
    select d.id, d.sha256, d.doc_type, dv.expired, dv.date_of_issue, dv.date_of_expiry,
           dv.mrz_valid, dv.tamper_signals
    from public.documents d
    left join public.document_verifications dv on dv.document_id = d.id
    where (p_case_id is not null and d.case_id = p_case_id)
       or (v_subject is not null and d.subject_id = v_subject)
  loop
    -- Same bytes, different person.
    if exists (select 1 from public.detect_document_reuse(r.id)) then
      select * into rule from public.fraud_rules where code = 'doc_reused_across_identities' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('document_id', r.id, 'sha256', r.sha256,
            'also_submitted_for', (select jsonb_agg(jsonb_build_object(
                'subject_id', other_subject_id, 'case_id', other_case_id))
              from public.detect_document_reuse(r.id))));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        if rule.severity = 'critical' then v_critical := v_critical + 1; end if;
      end if;
    end if;

    -- Issued after it expires, or issued in the future.
    if (r.date_of_issue is not null and r.date_of_expiry is not null
        and r.date_of_issue > r.date_of_expiry)
       or (r.date_of_issue is not null and r.date_of_issue > current_date) then
      select * into rule from public.fraud_rules where code = 'doc_dates_impossible' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('document_id', r.id, 'date_of_issue', r.date_of_issue,
                             'date_of_expiry', r.date_of_expiry));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    if r.expired then
      select * into rule from public.fraud_rules where code = 'doc_expired' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('document_id', r.id, 'date_of_expiry', r.date_of_expiry));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
      end if;
    end if;

    if r.mrz_valid is false then
      select * into rule from public.fraud_rules where code = 'doc_mrz_failed' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('document_id', r.id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    if r.tamper_signals is not null and jsonb_typeof(r.tamper_signals) = 'array'
       and exists (select 1 from jsonb_array_elements(r.tamper_signals) t
                   where t->>'severity' = 'critical') then
      select * into rule from public.fraud_rules where code = 'doc_tamper_critical' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('document_id', r.id, 'signals', r.tamper_signals));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;
  end loop;

  -- ── Address ───────────────────────────────────────────────────
  for r in
    select a.id, a.address_hash, public.address_shared_count(a.id) as shared
    from public.addresses a
    where (p_customer_id is not null and a.customer_id = p_customer_id)
       or (v_subject is not null and a.subject_id = v_subject)
  loop
    select * into rule from public.fraud_rules where code = 'address_shared_by_many' and active;
    if found and r.shared >= coalesce((rule.params->>'threshold')::int, 4) then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('address_id', r.id, 'shared_with', r.shared,
                           'threshold', (rule.params->>'threshold')::int));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
    end if;
  end loop;

  -- ── Phone ─────────────────────────────────────────────────────
  for r in
    select p.id, p.msisdn_hash, pv.rica_status, pv.days_since_sim_swap
    from public.phone_numbers p
    left join lateral (
      select * from public.phone_verifications v
      where v.phone_id = p.id order by v.created_at desc limit 1
    ) pv on true
    where (p_customer_id is not null and p.customer_id = p_customer_id)
       or (v_subject is not null and p.subject_id = v_subject)
  loop
    if exists (
      select 1 from public.phone_numbers p2
      where p2.msisdn_hash = r.msisdn_hash and p2.id <> r.id
        and p2.subject_id is distinct from v_subject and p2.subject_id is not null
    ) then
      select * into rule from public.fraud_rules where code = 'phone_shared_across_identities' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('phone_id', r.id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    select * into rule from public.fraud_rules where code = 'recent_sim_swap' and active;
    if found and r.days_since_sim_swap is not null
       and r.days_since_sim_swap <= coalesce((rule.params->>'max_days')::int, 30) then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('phone_id', r.id, 'days_since_sim_swap', r.days_since_sim_swap));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
      v_critical := v_critical + 1;
    end if;

    if r.rica_status = 'registered_to_other' then
      select * into rule from public.fraud_rules where code = 'phone_not_registered_to_subject' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('phone_id', r.id, 'rica_status', r.rica_status));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
      end if;
    end if;
  end loop;

  -- ── Employment ────────────────────────────────────────────────
  for r in
    select e.id, e.employer_id, emp.cipc_status, emp.flagged, emp.name,
           ev.payslip_arithmetic_ok, ev.income_variance_pct
    from public.employment_records e
    left join public.employers emp on emp.id = e.employer_id
    left join lateral (
      select * from public.employment_verifications v
      where v.employment_id = e.id order by v.created_at desc limit 1
    ) ev on true
    where (p_customer_id is not null and e.customer_id = p_customer_id)
       or (v_subject is not null and e.subject_id = v_subject)
  loop
    if r.payslip_arithmetic_ok is false then
      select * into rule from public.fraud_rules where code = 'payslip_arithmetic_failed' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('employment_id', r.id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    if r.cipc_status = 'not_found' then
      select * into rule from public.fraud_rules where code = 'employer_not_at_cipc' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('employment_id', r.id, 'employer', r.name));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
      end if;
    end if;

    if r.flagged then
      select * into rule from public.fraud_rules where code = 'employer_flagged' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('employment_id', r.id, 'employer', r.name));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    select * into rule from public.fraud_rules where code = 'income_variance_high' and active;
    if found and r.income_variance_pct is not null
       and abs(r.income_variance_pct) > coalesce((rule.params->>'max_variance_pct')::numeric, 20) then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('employment_id', r.id, 'variance_pct', r.income_variance_pct));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
    end if;
  end loop;

  -- ── Banking ───────────────────────────────────────────────────
  for r in
    select b.id, b.account_hash, b.avs_status
    from public.bank_accounts b
    where (p_customer_id is not null and b.customer_id = p_customer_id)
       or (v_subject is not null and b.subject_id = v_subject)
  loop
    if exists (
      select 1 from public.bank_accounts b2
      where b2.account_hash = r.account_hash and b2.id <> r.id
        and b2.subject_id is distinct from v_subject and b2.subject_id is not null
    ) then
      select * into rule from public.fraud_rules where code = 'bank_account_shared' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('bank_account_id', r.id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    if r.avs_status = 'name_mismatch' then
      select * into rule from public.fraud_rules where code = 'bank_account_name_mismatch' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('bank_account_id', r.id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
      end if;
    end if;
  end loop;

  -- ── Confirmed fraud register ──────────────────────────────────
  select * into rule from public.fraud_rules where code = 'known_fraud_hit' and active;
  if found and v_subject is not null then
    if exists (
      select 1 from public.known_fraud_register k
      where k.active and (
        (k.entity_type = 'id_hash' and k.entity_value =
          (select id_hash from public.subjects where id = v_subject))
        or (k.entity_type = 'msisdn_hash' and k.entity_value in
          (select msisdn_hash from public.phone_numbers where subject_id = v_subject))
        or (k.entity_type = 'address_hash' and k.entity_value in
          (select address_hash from public.addresses where subject_id = v_subject))
        or (k.entity_type = 'account_hash' and k.entity_value in
          (select account_hash from public.bank_accounts where subject_id = v_subject))
      )
    ) then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('matched', 'confirmed fraud register'));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
      v_critical := v_critical + 1;
    end if;
  end if;

  -- ── Velocity ──────────────────────────────────────────────────
  select * into rule from public.fraud_rules where code = 'application_velocity' and active;
  if found and v_subject is not null then
    declare v_recent int;
    begin
      select count(*) into v_recent
      from public.verification_cases
      where subject_id = v_subject
        and created_at > now() - make_interval(days => coalesce((rule.params->>'window_days')::int, 7));

      if v_recent >= coalesce((rule.params->>'threshold')::int, 3) then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('applications', v_recent,
                             'window_days', (rule.params->>'window_days')::int));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
      end if;
    end;
  end if;

  -- ── Assets and payment behaviour ──────────────────────────────
  -- These attach to the customer's contracts rather than the identity.
  if p_customer_id is not null then
    for r in
      select ct.id as contract_id, ct.asset_id, a.vin, a.imei, a.registry_status
      from public.contracts ct
      left join public.assets a on a.id = ct.asset_id
      where ct.customer_id = p_customer_id
    loop
      -- The same physical unit already backing another live agreement.
      select * into rule from public.fraud_rules where code = 'asset_already_financed' and active;
      if found and r.asset_id is not null and exists (
        select 1 from public.contracts c2
        where c2.asset_id = r.asset_id
          and c2.id <> r.contract_id
          and c2.status in ('approved','active','in_arrears','defaulted','legal')
      ) then
        insert into public.fraud_signals
          (rule_code, case_id, customer_id, subject_id, contract_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, r.contract_id, rule.severity, rule.weight,
          jsonb_build_object('asset_id', r.asset_id, 'vin', r.vin, 'imei', r.imei));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;

      select * into rule from public.fraud_rules where code = 'asset_registry_adverse' and active;
      if found and r.registry_status in ('encumbered','stolen','not_found','mismatch') then
        insert into public.fraud_signals
          (rule_code, case_id, customer_id, subject_id, contract_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, r.contract_id, rule.severity, rule.weight,
          jsonb_build_object('asset_id', r.asset_id, 'registry_status', r.registry_status));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;

      -- Never paid the first instalment: the affordability was not real.
      select * into rule from public.fraud_rules where code = 'first_payment_default' and active;
      if found and exists (
        select 1 from public.payment_schedule s
        where s.contract_id = r.contract_id
          and s.instalment_no = 1
          and s.due_date < current_date
          and s.amount_paid_cents = 0
          and s.status <> 'waived'
      ) then
        insert into public.fraud_signals
          (rule_code, case_id, customer_id, subject_id, contract_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, r.contract_id, rule.severity, rule.weight,
          jsonb_build_object('contract_id', r.contract_id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end loop;
  end if;

  -- ── Composite ─────────────────────────────────────────────────
  v_score := least(round(v_score), 100);

  v_severity := case
    when v_critical >= 2 or v_score >= 70 then 'critical'
    when v_critical = 1 or v_score >= 45 then 'high'
    when v_score >= 20 then 'medium'
    else 'low' end;

  -- An alert is raised for anything a person should look at. Below
  -- that the signals still exist and are queryable; they just do not
  -- interrupt anyone.
  if v_signals > 0 and v_severity in ('medium','high','critical') then
    insert into public.fraud_alerts
      (case_id, customer_id, subject_id, platform_id, score, severity,
       signal_count, critical_count, summary)
    values (p_case_id, p_customer_id, v_subject, v_platform, v_score::int, v_severity,
            v_signals, v_critical,
            v_signals || ' signal(s), ' || v_critical || ' critical')
    returning id into v_alert_id;
  end if;

  return jsonb_build_object(
    'score', v_score::int,
    'severity', v_severity,
    'signals', v_signals,
    'critical', v_critical,
    'alert_id', v_alert_id,
    'signal_detail', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'rule', s.rule_code, 'severity', s.severity, 'detail', s.detail)), '[]'::jsonb)
      from public.fraud_signals s
      where not s.dismissed
        and ((p_case_id is not null and s.case_id = p_case_id)
          or (p_customer_id is not null and s.customer_id = p_customer_id))
    )
  );
end;
$$;

revoke execute on function public.run_fraud_screen(text, uuid) from public, anon;
grant execute on function public.run_fraud_screen(text, uuid) to service_role, authenticated;
revoke execute on function public.detect_document_reuse(uuid) from public, anon;
grant execute on function public.detect_document_reuse(uuid) to service_role, authenticated;
