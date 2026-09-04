-- ══════════════════════════════════════════════════════════════
-- xCentral — Verification Hub core schema.
--
-- xCentral is the Central Control Hub: the other platforms
-- (BipraPay, xPayments, veriBills, PiggyBag, mySMME) do not each run
-- their own KYC stack — they call xCentral and receive a decision.
-- A verification CASE is the unit of work; every individual CHECK
-- (identity, document, credit, biometric) hangs off a case and the
-- case carries the composite decision.
--
-- Mirrors the BipraPay conventions: RLS on every table, read-only
-- select policies for authenticated staff, and all writes routed
-- through edge functions that enforce has_permission() and append to
-- audit_log.
-- ══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Staff profiles ──────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text,
  role text,
  role_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

-- ── RBAC ────────────────────────────────────────────────────────
create table public.roles (
  id text primary key,
  name text not null,
  description text
);

create table public.permissions (
  id text primary key,
  description text
);

create table public.role_permissions (
  role_id text not null references public.roles(id) on delete cascade,
  permission_id text not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

create policy "roles_select_authenticated" on public.roles for select to authenticated using (true);
create policy "permissions_select_authenticated" on public.permissions for select to authenticated using (true);
create policy "role_permissions_select_authenticated" on public.role_permissions for select to authenticated using (true);

insert into public.roles (id, name, description) values
  ('super_admin',         'Super Admin',          'Full hub access · platform onboarding · all config'),
  ('verification_officer','Verification Officer', 'Runs and decides identity & document verifications'),
  ('compliance_officer',  'Compliance Officer',   'POPIA consent register · retention · audit · FIC reporting'),
  ('credit_analyst',      'Credit Analyst',       'Bureau enquiries and NCA affordability assessments'),
  ('biometrics_officer',  'Biometrics Officer',   'Enrolment, face match and liveness adjudication'),
  ('developer',           'Developer',            'API keys, webhooks, sandbox · no subject data decisions'),
  ('support',             'Support',              'Read cases and re-send results · cannot decide'),
  ('read_only',           'Read-Only',            'View-only access to all sections');

insert into public.permissions (id, description) values
  ('identity',    'Run and decide identity verifications'),
  ('documents',   'Run and decide document verifications'),
  ('credit',      'Run credit bureau enquiries and affordability assessments'),
  ('biometrics',  'Enrol and adjudicate biometric verifications'),
  ('cases',       'Open, assign and close verification cases'),
  ('decisions',   'Issue the final verified/rejected decision on a case'),
  ('consent',     'Manage the POPIA consent register and retention'),
  ('platforms',   'Onboard and configure calling platforms'),
  ('api_keys',    'Issue and revoke platform API keys'),
  ('webhooks',    'Manage webhook endpoints and replays'),
  ('users',       'Invite staff and assign roles'),
  ('audit',       'Read the audit log'),
  ('config',      'Change hub configuration and provider routing'),
  ('view_all',    'View-only access to all sections');

insert into public.role_permissions (role_id, permission_id) values
  ('super_admin','identity'), ('super_admin','documents'), ('super_admin','credit'),
  ('super_admin','biometrics'), ('super_admin','cases'), ('super_admin','decisions'),
  ('super_admin','consent'), ('super_admin','platforms'), ('super_admin','api_keys'),
  ('super_admin','webhooks'), ('super_admin','users'), ('super_admin','audit'), ('super_admin','config'),
  ('verification_officer','identity'), ('verification_officer','documents'),
  ('verification_officer','cases'), ('verification_officer','decisions'),
  ('compliance_officer','consent'), ('compliance_officer','audit'),
  ('compliance_officer','cases'), ('compliance_officer','decisions'),
  ('credit_analyst','credit'), ('credit_analyst','cases'),
  ('biometrics_officer','biometrics'), ('biometrics_officer','cases'),
  ('developer','api_keys'), ('developer','webhooks'),
  ('support','view_all'),
  ('read_only','view_all');

alter table public.profiles
  add constraint profiles_role_id_fkey foreign key (role_id) references public.roles(id);

-- New staff default to Read-Only until a Super Admin assigns a real role.
alter table public.profiles alter column role_id set default 'read_only';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role, role_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'Read-Only'),
    coalesce(new.raw_user_meta_data->>'role_id', 'read_only')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Checks whether the calling user's role grants a given permission.
-- Used both in RLS policies and inside edge functions.
create or replace function public.has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid() and p.is_active and rp.permission_id = perm
  );
$$;

revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- ── Audit log ───────────────────────────────────────────────────
-- Append-only. No update/delete policy is intentional: a verification
-- audit trail is evidence and must not be editable by the app.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  actor_platform text,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

alter table public.audit_log enable row level security;

create policy "audit_log_select_authenticated" on public.audit_log
  for select to authenticated using (true);

-- ── Calling platforms ───────────────────────────────────────────
-- Every consumer of the hub is a registered platform. Cases are
-- always attributed to one, so usage, billing and POPIA
-- accountability all resolve to a named responsible party.
create table public.client_platforms (
  id text primary key,
  name text not null,
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  status text not null default 'active' check (status in ('active','suspended','retired')),
  contact_email text,
  -- Which verification domains this platform is entitled to call.
  allowed_domains text[] not null default array['identity','document','credit','biometric'],
  -- Operator of record for POPIA purposes.
  responsible_party text,
  created_at timestamptz not null default now()
);

alter table public.client_platforms enable row level security;

create policy "client_platforms_select_authenticated" on public.client_platforms
  for select to authenticated using (true);

-- ── Subjects ────────────────────────────────────────────────────
-- The natural person being verified.
--
-- The raw SA ID / passport number is NEVER stored. Exactly as
-- BipraPay's vault stores a card fingerprint rather than a PAN, we
-- keep a one-way hash (for duplicate-subject detection and case
-- linkage), the last four digits for operator recognition, and the
-- non-sensitive attributes that are mathematically derivable from
-- the ID anyway (date of birth, gender, citizenship class).
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  id_type text not null default 'sa_id' check (id_type in ('sa_id','passport','asylum_permit','drivers_licence')),
  id_hash text not null,
  id_last4 text not null,
  id_country text not null default 'ZA',
  first_names text,
  surname text,
  date_of_birth date,
  gender text check (gender in ('male','female','unknown')),
  citizenship text check (citizenship in ('citizen','permanent_resident','unknown')),
  -- Rolling assurance level, raised by successful checks and expired by retention.
  assurance_level text not null default 'none'
    check (assurance_level in ('none','basic','standard','enhanced')),
  assurance_expires_at timestamptz,
  deceased boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id_type, id_hash)
);

create index subjects_surname_idx on public.subjects (lower(surname));

alter table public.subjects enable row level security;

create policy "subjects_select_authenticated" on public.subjects
  for select to authenticated using (true);

-- ── Verification cases ──────────────────────────────────────────
create table public.verification_cases (
  id text primary key,
  subject_id uuid references public.subjects(id) on delete restrict,
  platform_id text not null references public.client_platforms(id),
  -- The platform's own reference, so results can be reconciled on their side.
  client_reference text,
  purpose text not null default 'onboarding'
    check (purpose in ('onboarding','lending','payout','kyc_refresh','age_check','account_recovery')),
  -- Which assurance tier the caller asked for. Determines the required checks.
  level text not null default 'standard' check (level in ('basic','standard','enhanced')),
  status text not null default 'pending'
    check (status in ('pending','in_progress','review','verified','rejected','expired','cancelled')),
  risk text not null default 'low' check (risk in ('low','medium','high')),
  -- Composite 0-100 confidence across all completed checks.
  score int check (score between 0 and 100),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_reason text,
  -- A verification is not valid forever; POPIA minimisation and FICA
  -- refresh cycles both argue for an explicit expiry.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index verification_cases_status_idx on public.verification_cases (status, created_at desc);
create index verification_cases_subject_idx on public.verification_cases (subject_id);
create index verification_cases_platform_idx on public.verification_cases (platform_id, created_at desc);

alter table public.verification_cases enable row level security;

create policy "verification_cases_select_authenticated" on public.verification_cases
  for select to authenticated using (true);

-- ── Check ledger ────────────────────────────────────────────────
-- One row per check executed against a case, across all four
-- domains. This is the single timeline an auditor reads.
create table public.verification_checks (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.verification_cases(id) on delete cascade,
  domain text not null check (domain in ('identity','document','credit','biometric')),
  check_type text not null,
  -- 'simulation' in sandbox; a named adapter (dha_hanis, transunion_za,
  -- rekognition, …) once the provider contract is live.
  provider text not null default 'simulation',
  status text not null default 'pending'
    check (status in ('pending','passed','failed','error','manual_review','skipped')),
  -- 0-100 confidence for this individual check.
  score numeric(5,2) check (score between 0 and 100),
  -- Structured findings. Never contains raw identifiers or biometric samples.
  result jsonb not null default '{}',
  -- Reasons the check did not pass outright, as machine-readable codes.
  reason_codes text[] not null default '{}',
  run_by uuid references public.profiles(id),
  latency_ms int,
  created_at timestamptz not null default now()
);

create index verification_checks_case_idx on public.verification_checks (case_id, created_at);
create index verification_checks_domain_idx on public.verification_checks (domain, status);

alter table public.verification_checks enable row level security;

create policy "verification_checks_select_authenticated" on public.verification_checks
  for select to authenticated using (true);
