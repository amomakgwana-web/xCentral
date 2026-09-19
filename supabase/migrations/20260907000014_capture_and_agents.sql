-- ══════════════════════════════════════════════════════════════
-- Live capture, and the agents that adjudicate what it produces.
--
-- The flow this models is the one an operator actually performs at a
-- counter: scan the identity document, take a live photograph of the
-- person in front of them, capture a fingerprint, compare the live
-- face to the portrait on the document, and get a decision.
--
-- Three things are modelled carefully because they are where this kind
-- of system usually goes wrong:
--
--   The document portrait and the live capture are separate captures
--   with separate quality records. A poor match caused by a blurred
--   selfie is a different problem from a poor match caused by two
--   different people, and an operator who cannot tell them apart will
--   either wave through impostors or turn away customers.
--
--   Quality is recorded BEFORE the match is attempted, and a capture
--   below the threshold is rejected rather than scored. A similarity
--   figure computed from an unusable image is a number with no meaning
--   attached to it.
--
--   The agents record their reasoning, not just their verdict. An
--   approval nobody can explain is not usable evidence six months
--   later when the customer disputes the agreement.
-- ══════════════════════════════════════════════════════════════

-- ── Capture sessions ────────────────────────────────────────────
-- One onboarding attempt, from consent to decision. Sessions expire:
-- a half-finished capture left open for a week is an abandoned set of
-- images sitting in storage.
create table public.capture_sessions (
  id text primary key,
  platform_id text not null references public.client_platforms(id),
  case_id text references public.verification_cases(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  -- Where the capture happened, which changes how much it is worth.
  channel text not null default 'branch' check (channel in (
    'branch','dealership','field_agent','self_service','call_centre'
  )),
  status text not null default 'open' check (status in (
    'open','capturing','matching','adjudicating','approved','declined','review','abandoned','expired'
  )),
  -- The steps this session must complete, in order.
  required_steps text[] not null default array['consent','document','selfie','match'],
  completed_steps text[] not null default '{}',
  operator_id uuid references public.profiles(id),
  device_label text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now()
);

create index capture_sessions_status_idx on public.capture_sessions (status, started_at desc);
create index capture_sessions_case_idx on public.capture_sessions (case_id);
create index capture_sessions_expiry_idx on public.capture_sessions (expires_at)
  where status in ('open','capturing','matching');

alter table public.capture_sessions enable row level security;
create policy "capture_sessions_select_authenticated" on public.capture_sessions
  for select to authenticated using (true);

-- ── Captures ────────────────────────────────────────────────────
-- One image or biometric sample. The image itself lives in the private
-- bucket; what is here is the metadata, the quality metrics, and the
-- derived template reference.
create table public.captures (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.capture_sessions(id) on delete cascade,
  capture_type text not null check (capture_type in (
    'document_front','document_back','document_portrait','selfie','selfie_frame',
    'fingerprint','proof_of_address','signature'
  )),
  -- Live capture through a camera or sensor, versus a file the
  -- applicant supplied. The difference matters: an uploaded selfie
  -- proves far less than one taken under observation.
  source text not null default 'live_camera' check (source in (
    'live_camera','upload','scanner','device_sensor'
  )),
  storage_path text,
  mime_type text,
  size_bytes int,
  width int,
  height int,
  sha256 text,

  -- ── Quality, measured in the browser before upload ────────────
  -- Sharpness is the variance of the Laplacian: a blurred image has
  -- little high-frequency content and scores low. Real arithmetic on
  -- the pixels, not a provider opinion.
  sharpness numeric(8,2),
  brightness numeric(5,2),
  contrast numeric(5,2),
  -- Whether a face was found, and how much of the frame it fills.
  face_detected boolean,
  face_count int,
  face_area_pct numeric(5,2),
  quality_score numeric(5,2) check (quality_score between 0 and 100),
  quality_passed boolean,
  quality_reasons text[] not null default '{}',

  -- Set once the capture has been templated.
  template_id uuid references public.biometric_templates(id) on delete set null,
  -- Raw samples are never kept. This records when the image was
  -- discarded after templating, which is the POPIA-relevant fact.
  sample_discarded_at timestamptz,
  captured_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index captures_session_idx on public.captures (session_id, capture_type);
create index captures_template_idx on public.captures (template_id) where template_id is not null;

alter table public.captures enable row level security;
create policy "captures_select_authenticated" on public.captures
  for select to authenticated using (true);

-- Quality thresholds, per capture type, held as data so a branch with
-- poor lighting can be tuned without a deploy.
create table public.capture_quality_rules (
  capture_type text primary key,
  min_sharpness numeric(8,2) not null default 60,
  min_brightness numeric(5,2) not null default 25,
  max_brightness numeric(5,2) not null default 92,
  min_width int not null default 480,
  min_height int not null default 480,
  require_face boolean not null default false,
  min_face_area_pct numeric(5,2),
  max_faces int,
  active boolean not null default true
);

alter table public.capture_quality_rules enable row level security;
create policy "capture_quality_rules_select_authenticated" on public.capture_quality_rules
  for select to authenticated using (true);

insert into public.capture_quality_rules
  (capture_type, min_sharpness, min_brightness, max_brightness, min_width, min_height,
   require_face, min_face_area_pct, max_faces) values
  -- A selfie must show exactly one face, filling enough of the frame
  -- that there are pixels to compare. Two faces means someone is
  -- standing behind the applicant, which is its own problem.
  ('selfie',            80, 28, 90, 480, 480, true,  8.0,  1),
  ('document_front',    90, 25, 95, 800, 500, false, null, null),
  ('document_back',     90, 25, 95, 800, 500, false, null, null),
  -- The portrait cropped out of the document is small by nature, so
  -- the bar is lower — but it still has to contain a face.
  ('document_portrait', 45, 20, 95, 160, 200, true,  20.0, 1),
  ('fingerprint',       70, 20, 95, 256, 256, false, null, null),
  ('proof_of_address',  70, 25, 95, 800, 600, false, null, null),
  ('signature',         50, 30, 98, 300, 120, false, null, null);

-- Applies the rules to a capture's measured metrics. Returns the
-- verdict and the specific reasons, so an operator is told "too dark,
-- move to the window" rather than "capture failed".
create or replace function public.assess_capture_quality(
  p_capture_type text,
  p_sharpness numeric,
  p_brightness numeric,
  p_contrast numeric,
  p_width int,
  p_height int,
  p_face_count int default null,
  p_face_area_pct numeric default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  r record;
  -- Reasons that make the image unusable: the capture is refused.
  reasons text[] := '{}';
  -- Reasons that lower confidence but are not the image's fault —
  -- chiefly a browser with no face detector. These shade the score and
  -- are recorded, but they never block, or a capability gap in the
  -- browser would stop the counter working.
  advisories text[] := '{}';
  score numeric := 100;
begin
  select * into r from public.capture_quality_rules
  where capture_type = p_capture_type and active;

  if not found then
    return jsonb_build_object('passed', null, 'score', null,
      'reason_codes', to_jsonb(array['no_quality_rule_for_type']));
  end if;

  if p_width is null or p_height is null
     or p_width < r.min_width or p_height < r.min_height then
    reasons := reasons || 'resolution_too_low'::text;
    score := score - 35;
  end if;

  if p_sharpness is null then
    advisories := advisories || 'sharpness_not_measured'::text;
    score := score - 15;
  elsif p_sharpness < r.min_sharpness then
    reasons := reasons || 'image_too_blurred'::text;
    -- Blur scales: barely soft is not the same as unusable.
    score := score - least(45, 45 * (r.min_sharpness - p_sharpness) / r.min_sharpness);
  end if;

  if p_brightness is not null then
    if p_brightness < r.min_brightness then
      reasons := reasons || 'image_too_dark'::text;
      score := score - 25;
    elsif p_brightness > r.max_brightness then
      reasons := reasons || 'image_overexposed'::text;
      score := score - 25;
    end if;
  end if;

  -- Low contrast usually means a screen photographed off another
  -- screen, or a washed-out scan.
  if p_contrast is not null and p_contrast < 12 then
    reasons := reasons || 'low_contrast'::text;
    score := score - 15;
  end if;

  if r.require_face then
    if p_face_count is null then
      advisories := advisories || 'face_detection_unavailable'::text;
      score := score - 10;
    elsif p_face_count = 0 then
      reasons := reasons || 'no_face_detected'::text;
      score := score - 50;
    elsif r.max_faces is not null and p_face_count > r.max_faces then
      reasons := reasons || 'more_than_one_face'::text;
      score := score - 40;
    end if;

    if r.min_face_area_pct is not null and p_face_area_pct is not null
       and p_face_area_pct < r.min_face_area_pct then
      reasons := reasons || 'face_too_small_in_frame'::text;
      score := score - 25;
    end if;
  end if;

  score := greatest(0, least(100, round(score, 2)));

  return jsonb_build_object(
    -- A capture below the bar is rejected, not scored: a similarity
    -- figure computed from an unusable image means nothing. Advisories
    -- are reported alongside so an operator can see why confidence is
    -- lower without being blocked by their browser's limitations.
    'passed', array_length(reasons, 1) is null,
    'score', score,
    'reason_codes', to_jsonb(reasons),
    'advisories', to_jsonb(advisories),
    'thresholds', jsonb_build_object(
      'min_sharpness', r.min_sharpness,
      'min_brightness', r.min_brightness,
      'max_brightness', r.max_brightness,
      'min_width', r.min_width,
      'min_height', r.min_height,
      'require_face', r.require_face
    )
  );
end;
$$;

-- ── Agents ──────────────────────────────────────────────────────
-- Each agent owns one question and answers only that. Their remits do
-- not overlap, so a decline can always be traced to the agent whose
-- question failed rather than to an aggregate nobody can unpick.
create table public.agents (
  id text primary key,
  name text not null,
  remit text not null,
  -- What the agent reads. Named so the console can show an operator
  -- why a given agent had nothing to say.
  domain text not null check (domain in (
    'identity','document','biometric','credit','fraud','compliance','orchestration'
  )),
  -- How the agent reaches its verdict. 'rules' means a deterministic
  -- policy over stored check data — reproducible and explainable.
  -- 'model' is reserved for a language or scoring model, which none of
  -- the shipped agents use.
  reasoning text not null default 'rules' check (reasoning in ('rules','model','hybrid')),
  -- Whether this agent alone can block an approval.
  can_veto boolean not null default false,
  weight numeric(5,2) not null default 1.0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.agents enable row level security;
create policy "agents_select_authenticated" on public.agents
  for select to authenticated using (true);

insert into public.agents (id, name, remit, domain, reasoning, can_veto, weight) values
  ('identity_agent', 'Identity Agent',
   'Is the identity well-formed, real, alive, and not on a list?',
   'identity', 'rules', true, 2.0),

  ('document_agent', 'Document Agent',
   'Is the document genuine, current, and does it belong to this person?',
   'document', 'rules', true, 2.0),

  ('biometric_agent', 'Biometric Agent',
   'Is the person in front of the camera the person on the document, and were they actually present?',
   'biometric', 'rules', true, 3.0),

  ('fraud_agent', 'Fraud Agent',
   'Does anything here link to a pattern we have seen before?',
   'fraud', 'rules', true, 2.5),

  ('affordability_agent', 'Affordability Agent',
   'Can this person carry what they are asking for, under the NCA?',
   'credit', 'rules', false, 1.5),

  ('compliance_agent', 'Compliance Agent',
   'Is there lawful basis for everything we have done, and is the file complete for FICA?',
   'compliance', 'rules', true, 2.0),

  ('orchestrator', 'Orchestrator',
   'Combines the agents into one recommendation, and says what a human still has to decide.',
   'orchestration', 'rules', false, 0);

-- ── Agent decisions ─────────────────────────────────────────────
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  session_id text references public.capture_sessions(id) on delete cascade,
  case_id text references public.verification_cases(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  -- The combined recommendation. Never applied automatically without a
  -- human where the policy says otherwise.
  recommendation text not null check (recommendation in ('approve','refer','decline')),
  confidence numeric(5,2) check (confidence between 0 and 100),
  vetoed_by text references public.agents(id),
  summary text,
  -- Whether a person accepted the recommendation, and who.
  human_outcome text check (human_outcome in ('accepted','overridden','pending')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  override_reason text,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index agent_runs_session_idx on public.agent_runs (session_id);
create index agent_runs_case_idx on public.agent_runs (case_id);

alter table public.agent_runs enable row level security;
create policy "agent_runs_select_authenticated" on public.agent_runs
  for select to authenticated using (true);

create table public.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  agent_id text not null references public.agents(id),
  verdict text not null check (verdict in ('pass','concern','fail','abstain')),
  confidence numeric(5,2) check (confidence between 0 and 100),
  -- The agent's reasoning in plain words, and the evidence it read.
  -- An approval nobody can explain is not usable evidence later.
  rationale text not null,
  evidence jsonb not null default '{}',
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (run_id, agent_id)
);

create index agent_decisions_run_idx on public.agent_decisions (run_id);

alter table public.agent_decisions enable row level security;
create policy "agent_decisions_select_authenticated" on public.agent_decisions
  for select to authenticated using (true);

-- ── Session progress ────────────────────────────────────────────
-- Marks a step done and advances the session. Kept in the database so
-- a session resumed on another device sees the same state.
create or replace function public.complete_capture_step(p_session_id text, p_step text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_completed text[];
  v_outstanding text[];
begin
  select * into s from public.capture_sessions where id = p_session_id;
  if not found then raise exception 'Capture session % not found', p_session_id; end if;

  if s.status in ('approved','declined','abandoned','expired') then
    raise exception 'Session % is %s and cannot take further steps', p_session_id, s.status
      using errcode = 'check_violation';
  end if;

  v_completed := (select array_agg(distinct e) from unnest(s.completed_steps || p_step) e);

  select array_agg(r) into v_outstanding
  from unnest(s.required_steps) r
  where r <> all(v_completed);

  update public.capture_sessions
     set completed_steps = v_completed,
         status = case
           when v_outstanding is null then 'adjudicating'
           else 'capturing' end
   where id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'completed_steps', to_jsonb(v_completed),
    'outstanding_steps', to_jsonb(coalesce(v_outstanding, '{}')),
    'ready_to_adjudicate', v_outstanding is null
  );
end;
$$;

revoke execute on function public.complete_capture_step(text, text) from public, anon;
grant execute on function public.complete_capture_step(text, text) to service_role;

-- Retention for the new image classes.
insert into public.retention_policies (id, entity, description, retain_days, legal_basis) values
  ('capture_images', 'captures',
   'Live capture images — selfies, document scans, fingerprints', 1825,
   'FICA s22 — 5 years; raw biometric samples discarded once templated'),
  ('capture_sessions', 'capture_sessions',
   'Onboarding capture session records', 1825, 'FICA s22 — 5 years')
on conflict (id) do nothing;
