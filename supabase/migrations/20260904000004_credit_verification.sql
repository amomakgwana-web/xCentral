-- ══════════════════════════════════════════════════════════════
-- Credit verification.
--
-- Two distinct things live here and they are deliberately separate:
--
--   Bureau enquiry — what a registered credit bureau holds on the
--   subject. This is inbound provider data. Under the NCA a bureau
--   enquiry needs a lawful purpose and the subject's consent, so a
--   credit check cannot be recorded without pointing at a consent
--   record (enforced in migration 5, once consents exists).
--
--   Affordability assessment — arithmetic the hub does itself, per
--   NCA Regulation 23A. The prescribed minimum-expense table is held
--   as versioned DATA, not as constants in a function, because the
--   figures are gazetted and change. Superseding them is an insert,
--   not a code deploy, and historical assessments stay reproducible
--   against the version that was in force when they were made.
-- ══════════════════════════════════════════════════════════════

-- ── Registered bureaus ──────────────────────────────────────────
create table public.credit_bureaus (
  id text primary key,
  name text not null,
  -- Bureaus score on different scales; keeping the range with the
  -- bureau is what makes cross-bureau normalisation possible.
  score_min int not null default 0,
  score_max int not null default 999,
  active boolean not null default true
);

alter table public.credit_bureaus enable row level security;

create policy "credit_bureaus_select_authenticated" on public.credit_bureaus
  for select to authenticated using (true);

insert into public.credit_bureaus (id, name, score_min, score_max) values
  ('transunion_za', 'TransUnion South Africa', 0, 999),
  ('experian_za',   'Experian South Africa',   0, 999),
  ('xds',           'XDS (Xpert Decision Systems)', 0, 999),
  ('vericred',      'VeriCred Credit Bureau',  0, 999);

-- ── Score bands ─────────────────────────────────────────────────
-- Per-bureau banding so a raw score can be described consistently.
create table public.credit_score_bands (
  bureau_id text not null references public.credit_bureaus(id) on delete cascade,
  band text not null,
  score_from int not null,
  score_to int not null,
  risk text not null check (risk in ('low','medium','high')),
  primary key (bureau_id, band)
);

alter table public.credit_score_bands enable row level security;

create policy "credit_score_bands_select_authenticated" on public.credit_score_bands
  for select to authenticated using (true);

insert into public.credit_score_bands (bureau_id, band, score_from, score_to, risk) values
  ('transunion_za', 'Excellent',  767, 999, 'low'),
  ('transunion_za', 'Good',       681, 766, 'low'),
  ('transunion_za', 'Favourable', 614, 680, 'medium'),
  ('transunion_za', 'Average',    583, 613, 'medium'),
  ('transunion_za', 'Poor',         0, 582, 'high'),
  ('experian_za',   'Excellent',  767, 999, 'low'),
  ('experian_za',   'Good',       681, 766, 'low'),
  ('experian_za',   'Favourable', 614, 680, 'medium'),
  ('experian_za',   'Average',    583, 613, 'medium'),
  ('experian_za',   'Poor',         0, 582, 'high');

create or replace function public.credit_band(bureau text, score int)
returns table (band text, risk text)
language sql
stable
as $$
  select b.band, b.risk
  from public.credit_score_bands b
  where b.bureau_id = bureau and score between b.score_from and b.score_to
  limit 1;
$$;

-- ── Bureau enquiries ────────────────────────────────────────────
create table public.credit_checks (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.verification_cases(id) on delete cascade,
  check_id uuid references public.verification_checks(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete restrict,
  bureau_id text not null references public.credit_bureaus(id),
  -- An enquiry that affects the subject's own score must be
  -- distinguishable from one that does not.
  enquiry_type text not null default 'soft' check (enquiry_type in ('soft','hard')),
  purpose text not null default 'onboarding',
  score int,
  band text,
  risk text check (risk in ('low','medium','high')),
  -- Aggregates lifted from the bureau payload.
  accounts_total int,
  accounts_in_arrears int,
  worst_arrears_months int,
  monthly_debt_obligations_cents bigint,
  -- Adverse markers.
  judgments int not null default 0,
  defaults int not null default 0,
  admin_order boolean not null default false,
  debt_review boolean not null default false,
  sequestration boolean not null default false,
  provider_reference text,
  status text not null default 'pending'
    check (status in ('pending','completed','no_record','unavailable','error')),
  reason_codes text[] not null default '{}',
  raw_summary jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index credit_checks_case_idx on public.credit_checks (case_id);
create index credit_checks_subject_idx on public.credit_checks (subject_id, created_at desc);

alter table public.credit_checks enable row level security;

create policy "credit_checks_select_authenticated" on public.credit_checks
  for select to authenticated using (true);

-- ── Tradelines ──────────────────────────────────────────────────
create table public.credit_accounts (
  id uuid primary key default gen_random_uuid(),
  credit_check_id uuid not null references public.credit_checks(id) on delete cascade,
  creditor text not null,
  account_type text,
  opened_on date,
  balance_cents bigint not null default 0,
  instalment_cents bigint not null default 0,
  months_in_arrears int not null default 0,
  status text
);

create index credit_accounts_check_idx on public.credit_accounts (credit_check_id);

alter table public.credit_accounts enable row level security;

create policy "credit_accounts_select_authenticated" on public.credit_accounts
  for select to authenticated using (true);

-- ── NCA Regulation 23A minimum expense norms ────────────────────
-- Versioned. `effective_from` is the date the gazetted table came
-- into force; an assessment always resolves the version that was in
-- force on its own assessment date, so a rate change never rewrites
-- past decisions.
--
-- Each band is: base_cents + rate_pct of the portion of gross income
-- above band_floor_cents.
create table public.affordability_norms (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  band_floor_cents bigint not null,
  band_ceiling_cents bigint,
  base_cents bigint not null default 0,
  rate_pct numeric(6,3) not null default 0,
  -- The lowest band consumes the whole income; flagged rather than
  -- expressed as a 100% rate so the intent stays legible.
  consumes_all boolean not null default false,
  note text,
  unique (effective_from, band_floor_cents)
);

alter table public.affordability_norms enable row level security;

create policy "affordability_norms_select_authenticated" on public.affordability_norms
  for select to authenticated using (true);

-- Figures as gazetted with the 2015 affordability assessment
-- regulations. Amounts in cents. Supersede by inserting a new
-- effective_from set; do not edit these rows.
insert into public.affordability_norms
  (effective_from, band_floor_cents, band_ceiling_cents, base_cents, rate_pct, consumes_all, note) values
  ('2015-09-13',        0,    80000,      0,  0.000, true,  'R0 – R800: minimum expenses equal the whole of income'),
  ('2015-09-13',    80000,   625000, 116788,  6.750, false, 'R800.01 – R6 250'),
  ('2015-09-13',   625000,  2500000, 154715,  9.000, false, 'R6 250.01 – R25 000'),
  ('2015-09-13',  2500000,  5000000, 323465,  8.250, false, 'R25 000.01 – R50 000'),
  ('2015-09-13',  5000000,     null, 529902,  6.750, false, 'Above R50 000');

-- Prescribed minimum monthly living expenses for a given net income,
-- using the norm version in force on `as_at`.
create or replace function public.nca_minimum_expenses_cents(income_cents bigint, as_at date default current_date)
returns bigint
language plpgsql
stable
as $$
declare
  v_effective date;
  n record;
begin
  if income_cents is null or income_cents <= 0 then
    return 0;
  end if;

  select max(effective_from) into v_effective
  from public.affordability_norms
  where effective_from <= as_at;

  if v_effective is null then
    -- No norms loaded for this date: refuse to guess.
    return null;
  end if;

  select * into n
  from public.affordability_norms
  where effective_from = v_effective
    and income_cents > band_floor_cents
    and (band_ceiling_cents is null or income_cents <= band_ceiling_cents)
  limit 1;

  if not found then
    -- Income falls in the lowest band, which is floored at zero.
    select * into n
    from public.affordability_norms
    where effective_from = v_effective
    order by band_floor_cents asc
    limit 1;
  end if;

  if n.consumes_all then
    return income_cents;
  end if;

  return n.base_cents + round((income_cents - n.band_floor_cents) * n.rate_pct / 100.0);
end;
$$;

-- ── Affordability assessments ───────────────────────────────────
create table public.affordability_assessments (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.verification_cases(id) on delete cascade,
  check_id uuid references public.verification_checks(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete restrict,
  assessed_on date not null default current_date,
  -- Declared and, where a payslip or bank statement was verified,
  -- corroborated income.
  gross_income_cents bigint not null,
  statutory_deductions_cents bigint not null default 0,
  net_income_cents bigint not null,
  income_verified boolean not null default false,
  income_source text,
  -- Living expenses: the greater of what the subject declared and the
  -- prescribed minimum is what the assessment must use.
  declared_expenses_cents bigint not null default 0,
  minimum_expenses_cents bigint,
  applied_expenses_cents bigint,
  -- Existing debt service, from the bureau enquiry where available.
  existing_obligations_cents bigint not null default 0,
  -- What the new obligation would cost per month.
  proposed_instalment_cents bigint not null default 0,
  discretionary_income_cents bigint,
  outcome text check (outcome in ('affordable','marginal','not_affordable','insufficient_data')),
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index affordability_case_idx on public.affordability_assessments (case_id);

alter table public.affordability_assessments enable row level security;

create policy "affordability_assessments_select_authenticated" on public.affordability_assessments
  for select to authenticated using (true);

-- Computes the assessment. Kept in the database so that the console,
-- the edge functions and any reporting query all get the same answer
-- from the same code path.
create or replace function public.assess_affordability(
  p_gross_income_cents bigint,
  p_statutory_deductions_cents bigint,
  p_declared_expenses_cents bigint,
  p_existing_obligations_cents bigint,
  p_proposed_instalment_cents bigint,
  p_income_verified boolean default false,
  p_as_at date default current_date
)
returns jsonb
language plpgsql
stable
as $$
declare
  net_income bigint;
  min_exp bigint;
  applied_exp bigint;
  discretionary bigint;
  outcome text;
  reasons text[] := '{}';
begin
  if p_gross_income_cents is null or p_gross_income_cents <= 0 then
    return jsonb_build_object(
      'outcome', 'insufficient_data',
      'reason_codes', to_jsonb(array['no_income_declared'])
    );
  end if;

  net_income := p_gross_income_cents - coalesce(p_statutory_deductions_cents, 0);
  if net_income <= 0 then
    return jsonb_build_object(
      'outcome', 'not_affordable',
      'net_income_cents', net_income,
      'reason_codes', to_jsonb(array['deductions_exceed_income'])
    );
  end if;

  min_exp := public.nca_minimum_expenses_cents(net_income, p_as_at);
  if min_exp is null then
    return jsonb_build_object(
      'outcome', 'insufficient_data',
      'reason_codes', to_jsonb(array['no_affordability_norms_for_date'])
    );
  end if;

  -- Regulation 23A sets a floor, not a substitute: where the subject
  -- declares more than the minimum, their own figure governs.
  applied_exp := greatest(min_exp, coalesce(p_declared_expenses_cents, 0));
  if coalesce(p_declared_expenses_cents, 0) < min_exp then
    reasons := reasons || 'declared_expenses_below_prescribed_minimum'::text;
  end if;

  discretionary := net_income
                   - applied_exp
                   - coalesce(p_existing_obligations_cents, 0)
                   - coalesce(p_proposed_instalment_cents, 0);

  if not coalesce(p_income_verified, false) then
    reasons := reasons || 'income_not_corroborated'::text;
  end if;

  if discretionary < 0 then
    outcome := 'not_affordable';
    reasons := reasons || 'negative_discretionary_income'::text;
  elsif discretionary < (net_income * 0.05)::bigint then
    -- Clears by so little that a small shock breaks it.
    outcome := 'marginal';
    reasons := reasons || 'thin_affordability_margin'::text;
  elsif not coalesce(p_income_verified, false) then
    outcome := 'marginal';
  else
    outcome := 'affordable';
  end if;

  return jsonb_build_object(
    'outcome', outcome,
    'net_income_cents', net_income,
    'minimum_expenses_cents', min_exp,
    'applied_expenses_cents', applied_exp,
    'existing_obligations_cents', coalesce(p_existing_obligations_cents, 0),
    'proposed_instalment_cents', coalesce(p_proposed_instalment_cents, 0),
    'discretionary_income_cents', discretionary,
    'reason_codes', to_jsonb(reasons)
  );
end;
$$;
