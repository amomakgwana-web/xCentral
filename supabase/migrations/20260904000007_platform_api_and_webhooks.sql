-- ══════════════════════════════════════════════════════════════
-- The hub's outward face: how sibling platforms call in, and how
-- results get back to them.
--
-- BipraPay, xPayments, veriBills and the rest do not read these
-- tables directly. They hold an API key, POST to the platform-verify
-- edge function, and receive a decision — plus a webhook when a case
-- that went to manual review is later decided. Everything a caller
-- can do is bounded by the key's scopes and the platform's
-- allowed_domains.
-- ══════════════════════════════════════════════════════════════

-- ── Platform API keys ───────────────────────────────────────────
-- The key itself is never stored, on the same principle as a
-- password: only a SHA-256 digest, plus a prefix and last four so an
-- operator can recognise which key a log line refers to.
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  platform_id text not null references public.client_platforms(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_last4 text not null,
  key_hash text not null unique,
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  -- Bounded capability. A key issued for age checks cannot pull a
  -- credit report even if the platform is entitled to.
  scopes text[] not null default array['identity'],
  rate_limit_per_min int not null default 60,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index api_keys_platform_idx on public.api_keys (platform_id) where revoked_at is null;

alter table public.api_keys enable row level security;

-- Staff can see that a key exists and its metadata. key_hash is in
-- the row, but knowing the digest does not let anyone use the key.
create policy "api_keys_select_authenticated" on public.api_keys
  for select to authenticated using (true);

-- ── Request log ─────────────────────────────────────────────────
-- Every inbound API call, whether it succeeded or not. This is what
-- answers "who asked about this person, when, and under what key".
create table public.api_requests (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid references public.api_keys(id) on delete set null,
  platform_id text references public.client_platforms(id),
  endpoint text not null,
  method text not null default 'POST',
  case_id text references public.verification_cases(id) on delete set null,
  status_code int not null,
  error_code text,
  ip text,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index api_requests_platform_idx on public.api_requests (platform_id, created_at desc);
create index api_requests_key_idx on public.api_requests (api_key_id, created_at desc);

alter table public.api_requests enable row level security;

create policy "api_requests_select_authenticated" on public.api_requests
  for select to authenticated using (true);

-- ── Idempotency ─────────────────────────────────────────────────
-- A retried verification request must not open a second case or
-- trigger a second bureau enquiry — the latter would cost money and,
-- for a hard enquiry, mark the subject's record.
create table public.idempotency_keys (
  key text primary key,
  endpoint text not null,
  platform_id text references public.client_platforms(id),
  status_code int not null,
  response_body jsonb not null,
  created_at timestamptz not null default now()
);

create index idempotency_keys_created_idx on public.idempotency_keys (created_at);

alter table public.idempotency_keys enable row level security;

create policy "idempotency_keys_select_authenticated" on public.idempotency_keys
  for select to authenticated using (true);

-- ── Webhooks ────────────────────────────────────────────────────
create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  platform_id text not null references public.client_platforms(id) on delete cascade,
  url text not null,
  -- Signing secret for the HMAC header the receiver verifies.
  secret text not null,
  events text[] not null default array['case.decided'],
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.webhook_endpoints enable row level security;

create policy "webhook_endpoints_select_authenticated" on public.webhook_endpoints
  for select to authenticated using (true);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event text not null,
  case_id text references public.verification_cases(id) on delete set null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','delivered','failed','exhausted')),
  attempts int not null default 0,
  response_code int,
  response_body text,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index webhook_deliveries_pending_idx on public.webhook_deliveries (next_attempt_at)
  where status in ('pending','failed');

alter table public.webhook_deliveries enable row level security;

create policy "webhook_deliveries_select_authenticated" on public.webhook_deliveries
  for select to authenticated using (true);

-- ── What each assurance level requires ──────────────────────────
-- Held as data so the definition of "standard" is a row set an
-- auditor can read, not logic buried in a function.
create table public.verification_requirements (
  level text not null check (level in ('basic','standard','enhanced')),
  domain text not null check (domain in ('identity','document','credit','biometric')),
  check_type text not null,
  required boolean not null default true,
  -- How much this check contributes to the composite case score.
  weight numeric(4,2) not null default 1.0,
  primary key (level, domain, check_type)
);

alter table public.verification_requirements enable row level security;

create policy "verification_requirements_select_authenticated" on public.verification_requirements
  for select to authenticated using (true);

insert into public.verification_requirements (level, domain, check_type, required, weight) values
  -- basic: is this a real, well-formed identity that is not on a list?
  ('basic',    'identity',  'id_structure',        true,  2.0),
  ('basic',    'identity',  'deceased_register',   true,  1.0),
  ('basic',    'identity',  'watchlist_screening', true,  1.5),
  -- standard: adds the authority record and a genuine document.
  ('standard', 'identity',  'id_structure',        true,  2.0),
  ('standard', 'identity',  'authority_lookup',    true,  2.5),
  ('standard', 'identity',  'deceased_register',   true,  1.0),
  ('standard', 'identity',  'watchlist_screening', true,  1.5),
  ('standard', 'document',  'document_authenticity', true, 2.0),
  ('standard', 'document',  'document_expiry',     true,  1.0),
  ('standard', 'document',  'name_match',          true,  1.5),
  -- enhanced: adds "the person present is the person on the document",
  -- and, where money is being lent, whether they can afford it.
  ('enhanced', 'identity',  'id_structure',        true,  2.0),
  ('enhanced', 'identity',  'authority_lookup',    true,  2.5),
  ('enhanced', 'identity',  'deceased_register',   true,  1.0),
  ('enhanced', 'identity',  'watchlist_screening', true,  1.5),
  ('enhanced', 'document',  'document_authenticity', true, 2.0),
  ('enhanced', 'document',  'document_expiry',     true,  1.0),
  ('enhanced', 'document',  'name_match',          true,  1.5),
  ('enhanced', 'biometric', 'face_match',          true,  3.0),
  ('enhanced', 'biometric', 'liveness',            true,  2.5),
  ('enhanced', 'credit',    'bureau_enquiry',      false, 1.5),
  ('enhanced', 'credit',    'affordability',       false, 1.5);

-- ── Composite scoring ───────────────────────────────────────────
-- The case score is the weighted mean of its checks' scores, using
-- the weights for the level the case was opened at. A required check
-- that has not run yet holds the case open; a required check that
-- failed caps the case rather than averaging away.
create or replace function public.case_score(p_case_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_level text;
  v_total_weight numeric := 0;
  v_weighted numeric := 0;
  v_missing text[] := '{}';
  v_failed text[] := '{}';
  v_manual text[] := '{}';
  r record;
  latest record;
  v_score int;
  v_status text;
begin
  select level into v_level from public.verification_cases where id = p_case_id;
  if v_level is null then
    return jsonb_build_object('error', 'case_not_found');
  end if;

  for r in
    select * from public.verification_requirements where level = v_level
  loop
    -- Only the most recent run of a given check counts; a re-run
    -- supersedes rather than accumulates.
    select c.status, c.score into latest
    from public.verification_checks c
    where c.case_id = p_case_id
      and c.domain = r.domain
      and c.check_type = r.check_type
      and c.status <> 'pending'
    order by c.created_at desc
    limit 1;

    if not found then
      if r.required then
        v_missing := v_missing || (r.domain || '.' || r.check_type);
      end if;
      continue;
    end if;

    if latest.status = 'skipped' then
      if r.required then
        v_missing := v_missing || (r.domain || '.' || r.check_type);
      end if;
      continue;
    end if;

    if latest.status = 'failed' and r.required then
      v_failed := v_failed || (r.domain || '.' || r.check_type);
    elsif latest.status = 'manual_review' then
      v_manual := v_manual || (r.domain || '.' || r.check_type);
    elsif latest.status = 'error' and r.required then
      v_missing := v_missing || (r.domain || '.' || r.check_type);
      continue;
    end if;

    v_total_weight := v_total_weight + r.weight;
    v_weighted := v_weighted + (coalesce(latest.score, 0) * r.weight);
  end loop;

  v_score := case when v_total_weight = 0 then 0
                  else round(v_weighted / v_total_weight)::int end;

  -- Ordering matters: a failed required check is decisive whatever
  -- the average says.
  if array_length(v_failed, 1) is not null then
    v_status := 'rejected';
  elsif array_length(v_missing, 1) is not null then
    v_status := 'in_progress';
  elsif array_length(v_manual, 1) is not null then
    v_status := 'review';
  elsif v_score >= 80 then
    v_status := 'verified';
  else
    v_status := 'review';
  end if;

  return jsonb_build_object(
    'level', v_level,
    'score', v_score,
    'suggested_status', v_status,
    'missing_checks', to_jsonb(v_missing),
    'failed_checks', to_jsonb(v_failed),
    'manual_review_checks', to_jsonb(v_manual)
  );
end;
$$;

revoke execute on function public.case_score(text) from public, anon;
grant execute on function public.case_score(text) to authenticated;
-- The edge functions call this as service_role, whose implicit grant the
-- REVOKE above also removed.
grant execute on function public.case_score(text) to service_role;

-- Keeps verification_cases.updated_at honest.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger verification_cases_touch
  before update on public.verification_cases
  for each row execute function public.touch_updated_at();
