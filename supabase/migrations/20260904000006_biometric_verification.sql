-- ══════════════════════════════════════════════════════════════
-- Biometric verification.
--
-- Three structural commitments, in order of how much they matter:
--
--   1. A raw biometric sample is never persisted. A selfie or
--      fingerprint image exists only for the lifetime of the request
--      that templates it — the same discipline BipraPay's vault
--      applies to a PAN. What is stored is the template.
--
--   2. Templates are unreadable by the application. biometric_templates
--      has row level security ENABLED and NO POLICIES, which means
--      every `authenticated` client — console included — gets zero
--      rows, always. Only the service role, i.e. the edge functions,
--      can read a template, and they only ever return a score. Staff
--      who need to see enrolment state read biometric_template_meta,
--      which carries no biometric data.
--
--   3. No template is written without live consent. Enforced by
--      trigger against the register from migration 5, so it holds
--      even if an edge function forgets to ask.
--
-- Matching thresholds are held as DATA per modality and per model,
-- because a similarity cut-off is meaningless without the model it
-- was calibrated against. Swapping the face model is a row change and
-- a recalibration, not a constant edit.
-- ══════════════════════════════════════════════════════════════

-- ── Modalities and their operating points ───────────────────────
create table public.biometric_modalities (
  id text primary key,
  name text not null,
  -- The model or SDK the templates were produced by. Templates from
  -- different models are not comparable and must never be scored
  -- against each other.
  model_id text not null,
  descriptor_length int,
  -- Similarity cut-offs at published false-match rates. These are
  -- calibration values for THIS model; they do not transfer.
  threshold_fmr_1e4 numeric(5,4),
  threshold_fmr_1e5 numeric(5,4),
  threshold_fmr_1e6 numeric(5,4),
  -- The operating point this hub actually enforces.
  operating_fmr text not null default '1e-5' check (operating_fmr in ('1e-4','1e-5','1e-6')),
  active boolean not null default true
);

alter table public.biometric_modalities enable row level security;

create policy "biometric_modalities_select_authenticated" on public.biometric_modalities
  for select to authenticated using (true);

-- The simulation model ships with placeholder calibration so the
-- sandbox behaves sensibly. Replace these rows, and re-run the
-- calibration, when a real SDK is wired in.
insert into public.biometric_modalities
  (id, name, model_id, descriptor_length, threshold_fmr_1e4, threshold_fmr_1e5, threshold_fmr_1e6, operating_fmr) values
  ('face',        'Face',        'sim-face-v1',  128, 0.6200, 0.6800, 0.7300, '1e-5'),
  ('fingerprint', 'Fingerprint', 'sim-finger-v1', 96, 0.6500, 0.7100, 0.7600, '1e-5'),
  ('voice',       'Voice',       'sim-voice-v1', 128, 0.6000, 0.6600, 0.7200, '1e-4');

-- Resolves the cut-off actually in force for a modality.
create or replace function public.biometric_threshold(p_modality text)
returns numeric
language sql
stable
as $$
  select case operating_fmr
    when '1e-4' then threshold_fmr_1e4
    when '1e-5' then threshold_fmr_1e5
    when '1e-6' then threshold_fmr_1e6
  end
  from public.biometric_modalities
  where id = p_modality and active
  limit 1;
$$;

-- ── Template comparison ─────────────────────────────────────────
-- Cosine similarity. Real arithmetic, done in the database so the
-- descriptors never have to leave it to be compared.
create or replace function public.cosine_similarity(a real[], b real[])
returns numeric
language plpgsql
immutable
as $$
declare
  dot double precision := 0;
  na double precision := 0;
  nb double precision := 0;
  i int;
begin
  if a is null or b is null then return null; end if;
  if array_length(a, 1) is distinct from array_length(b, 1) then
    -- Different lengths mean different models. Refuse rather than
    -- return a number someone might trust.
    raise exception 'Descriptor length mismatch: % vs %',
      array_length(a, 1), array_length(b, 1)
      using errcode = 'check_violation';
  end if;

  for i in 1..array_length(a, 1) loop
    dot := dot + (a[i]::double precision * b[i]::double precision);
    na  := na  + (a[i]::double precision * a[i]::double precision);
    nb  := nb  + (b[i]::double precision * b[i]::double precision);
  end loop;

  if na = 0 or nb = 0 then return 0; end if;
  return round((dot / (sqrt(na) * sqrt(nb)))::numeric, 6);
end;
$$;

-- ── Enrolled templates ──────────────────────────────────────────
-- RLS is enabled and deliberately left with no policies: this table
-- is invisible to every client role. See the header.
create table public.biometric_templates (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  modality text not null references public.biometric_modalities(id),
  model_id text not null,
  -- The irreversible template. No raw sample is stored anywhere.
  descriptor real[] not null,
  -- One-way digest of the descriptor, for duplicate-enrolment
  -- detection without reading the template itself.
  descriptor_hash text not null,
  -- Where the enrolment came from, for provenance.
  source text not null default 'document_portrait'
    check (source in ('document_portrait','live_capture','existing_record','migration')),
  source_document_id uuid references public.documents(id) on delete set null,
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  enrolled_by uuid references public.profiles(id),
  active boolean not null default true,
  -- Templates expire with the consent that authorised them.
  retention_until timestamptz not null default (now() + interval '5 years'),
  created_at timestamptz not null default now()
);

create index biometric_templates_subject_idx on public.biometric_templates (subject_id, modality) where active;
create index biometric_templates_hash_idx on public.biometric_templates (descriptor_hash);

alter table public.biometric_templates enable row level security;
-- Intentionally no policies. Service role only.

-- Consent gate: no template without a live biometric_processing consent.
create or replace function public.enforce_biometric_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_active_consent(new.subject_id, 'biometric_processing') then
    raise exception 'POPIA s27: no active biometric_processing consent for subject %', new.subject_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger biometric_templates_require_consent
  before insert on public.biometric_templates
  for each row execute function public.enforce_biometric_consent();

-- Descriptors must match the modality's declared length, or the
-- comparison later would be meaningless.
create or replace function public.enforce_descriptor_length()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected int;
  expected_model text;
begin
  select descriptor_length, model_id into expected, expected_model
  from public.biometric_modalities where id = new.modality;

  if expected is not null and array_length(new.descriptor, 1) is distinct from expected then
    raise exception 'Modality % expects a descriptor of length %, got %',
      new.modality, expected, array_length(new.descriptor, 1)
      using errcode = 'check_violation';
  end if;
  if new.model_id is distinct from expected_model then
    raise exception 'Modality % is calibrated for model %, got %',
      new.modality, expected_model, new.model_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger biometric_templates_check_descriptor
  before insert or update on public.biometric_templates
  for each row execute function public.enforce_descriptor_length();

-- Safe projection for the console: enrolment state without biometrics.
create view public.biometric_template_meta
with (security_invoker = true) as
  select
    t.id,
    t.subject_id,
    t.modality,
    t.model_id,
    t.source,
    t.quality_score,
    t.active,
    t.retention_until,
    t.created_at,
    array_length(t.descriptor, 1) as descriptor_length,
    left(t.descriptor_hash, 12) as descriptor_fingerprint
  from public.biometric_templates t;

-- security_invoker means the view honours the caller's RLS, which for
-- biometric_templates is "no rows". Reads of enrolment state therefore
-- go through the biometric-enrol edge function, exactly like template
-- comparison does. The view exists so that a service-role query has a
-- shape that omits the descriptor by construction.

-- ── Verification attempts ───────────────────────────────────────
create table public.biometric_verifications (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.verification_cases(id) on delete cascade,
  check_id uuid references public.verification_checks(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete restrict,
  modality text not null references public.biometric_modalities(id),
  model_id text not null,
  -- 1:1 verification against an enrolled template, or 1:N identification.
  mode text not null default 'verify' check (mode in ('verify','identify','enrol')),
  template_id uuid references public.biometric_templates(id) on delete set null,
  -- Cosine similarity of probe against template, 0-1.
  similarity numeric(7,6),
  -- The cut-off in force at the time, captured so a past decision
  -- stays interpretable after a recalibration.
  threshold_applied numeric(5,4),
  operating_fmr text,
  matched boolean,
  -- Presentation attack detection, per ISO/IEC 30107-3.
  liveness_performed boolean not null default false,
  liveness_score numeric(5,2) check (liveness_score between 0 and 100),
  liveness_passed boolean,
  pad_level int check (pad_level in (1, 2)),
  attack_type text check (attack_type in (
    'none','print','screen_replay','mask_2d','mask_3d','deepfake','injection','unknown'
  )),
  -- Capture quality, since a low-quality probe explains a low score.
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  provider text not null default 'simulation',
  status text not null default 'pending'
    check (status in ('pending','passed','failed','manual_review','error')),
  reason_codes text[] not null default '{}',
  latency_ms int,
  created_at timestamptz not null default now()
);

create index biometric_verifications_case_idx on public.biometric_verifications (case_id);
create index biometric_verifications_subject_idx on public.biometric_verifications (subject_id, created_at desc);

alter table public.biometric_verifications enable row level security;

create policy "biometric_verifications_select_authenticated" on public.biometric_verifications
  for select to authenticated using (true);

-- ── Duplicate-enrolment watch ───────────────────────────────────
-- One face enrolled against two identities is the signal that matters
-- most in a verification hub, so a 1:N sweep records its own findings.
create table public.biometric_duplicate_flags (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  matched_subject_id uuid not null references public.subjects(id) on delete cascade,
  modality text not null references public.biometric_modalities(id),
  similarity numeric(7,6) not null,
  status text not null default 'open' check (status in ('open','false_positive','confirmed')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (subject_id <> matched_subject_id)
);

create index biometric_duplicate_flags_subject_idx on public.biometric_duplicate_flags (subject_id);

alter table public.biometric_duplicate_flags enable row level security;

create policy "biometric_duplicate_flags_select_authenticated" on public.biometric_duplicate_flags
  for select to authenticated using (true);

-- 1:N identification sweep. Service role only, by way of the
-- unreadable templates table it reads.
create or replace function public.biometric_identify(
  p_modality text,
  p_descriptor real[],
  p_limit int default 5
)
returns table (template_id uuid, subject_id uuid, similarity numeric)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.subject_id, public.cosine_similarity(t.descriptor, p_descriptor) as similarity
  from public.biometric_templates t
  where t.active
    and t.modality = p_modality
    and array_length(t.descriptor, 1) = array_length(p_descriptor, 1)
  order by similarity desc
  limit greatest(coalesce(p_limit, 5), 1);
$$;

-- Not granted to authenticated: a 1:N sweep is an edge-function
-- operation, never something the browser can drive.
revoke execute on function public.biometric_identify(text, real[], int) from public, anon, authenticated;
-- Restored for the service role alone: the 1:N sweep is an edge-function
-- operation, and the REVOKE above stripped its implicit grant as well.
grant execute on function public.biometric_identify(text, real[], int) to service_role;
