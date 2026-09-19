-- ══════════════════════════════════════════════════════════════
-- How much credit can this customer be given, and why.
--
-- The answer is built from four things the hub already holds, and the
-- weakest of them governs:
--
--   Affordability — what the NCA assessment says is actually left over
--   each month. This is a ceiling, not an input to be averaged: no
--   score, however good, creates money that is not there. Lending
--   above it is reckless credit under s80 regardless of the applicant's
--   record.
--
--   Bureau score — how they have paid everyone else.
--
--   Payment behaviour here — how they have paid US. A thin bureau file
--   with two years of perfect instalments on this platform is a
--   different proposition from a thin file with nothing behind it.
--
--   Fraud signals — an open critical signal stops the assessment. A
--   number computed from data that may be fabricated is worse than no
--   number.
--
-- Every assessment stores the inputs it used, so a decision can be
-- re-read months later and explained to the customer, the NCR, or a
-- court, without recomputing anything.
-- ══════════════════════════════════════════════════════════════

-- ── Lending policy ──────────────────────────────────────────────
-- The lender's own appetite, held per platform and product so a
-- dealership and an unsecured lender can run different rules on the
-- same hub without either editing code.
create table public.credit_policies (
  id uuid primary key default gen_random_uuid(),
  platform_id text not null references public.client_platforms(id) on delete cascade,
  agreement_type text not null,
  name text not null,
  -- The share of discretionary income the lender is willing to commit
  -- to a new instalment. Never 100: a buffer is what stops the first
  -- unexpected expense becoming a default.
  max_discretionary_share_pct numeric(5,2) not null default 60,
  -- Total debt service as a share of net income, across all lenders.
  max_debt_to_income_pct numeric(5,2) not null default 40,
  min_bureau_score int,
  -- Below this, decline outright rather than refer.
  hard_decline_bureau_score int,
  max_principal_cents bigint,
  min_principal_cents bigint not null default 0,
  max_term_months int not null default 72,
  -- Behaviour on this platform can substitute for a thin bureau file,
  -- adding up to this many points to the 500 baseline. It has to be
  -- able to carry a customer past the lowest passing band or a perfect
  -- payer with no bureau record could never grade above E.
  behaviour_uplift_max int not null default 150,
  -- Fraud score at or above which no capacity is offered at all.
  fraud_block_score int not null default 45,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (platform_id, agreement_type, name)
);

alter table public.credit_policies enable row level security;
create policy "credit_policies_select_authenticated" on public.credit_policies
  for select to authenticated using (true);

-- ── Reverse amortisation ────────────────────────────────────────
-- Given what someone can afford each month, what principal does that
-- support? The inverse of instalment_cents(), and the number a
-- dealership actually wants: "what car can this person buy".
create or replace function public.principal_from_instalment(
  p_instalment_cents bigint,
  p_annual_rate_pct numeric,
  p_term_months int,
  p_balloon_cents bigint default 0
)
returns bigint
language plpgsql
immutable
as $$
declare
  r numeric; n int; factor numeric;
begin
  if p_instalment_cents is null or p_instalment_cents <= 0 then return 0; end if;
  if p_term_months is null or p_term_months <= 0 then return 0; end if;

  n := p_term_months;
  r := coalesce(p_annual_rate_pct, 0) / 100.0 / 12.0;

  if r = 0 then
    return (p_instalment_cents::numeric * n + coalesce(p_balloon_cents, 0))::bigint;
  end if;

  factor := power(1 + r, n);
  -- Rearranged from the annuity-with-future-value formula.
  return floor(
    (p_instalment_cents::numeric * (factor - 1) / r + coalesce(p_balloon_cents, 0)) / factor
  )::bigint;
end;
$$;

-- ── Assessments ─────────────────────────────────────────────────
create table public.credit_assessments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  case_id text references public.verification_cases(id) on delete set null,
  policy_id uuid references public.credit_policies(id),
  agreement_type text not null,
  assessed_on date not null default current_date,
  -- Inputs, captured so the decision stays explicable.
  net_income_cents bigint,
  discretionary_income_cents bigint,
  existing_instalments_cents bigint not null default 0,
  existing_exposure_cents bigint not null default 0,
  bureau_score int,
  bureau_band text,
  behaviour_score int,
  fraud_score int,
  -- Outputs.
  max_instalment_cents bigint,
  max_principal_cents bigint,
  recommended_limit_cents bigint,
  assumed_rate_pct numeric(7,3),
  assumed_term_months int,
  risk_grade text check (risk_grade in ('A','B','C','D','E')),
  decision text not null check (decision in ('approve','refer','decline','insufficient_data')),
  reason_codes text[] not null default '{}',
  -- The full working, for a dispute or an NCR audit.
  workings jsonb not null default '{}',
  assessed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index credit_assessments_customer_idx
  on public.credit_assessments (customer_id, created_at desc);

alter table public.credit_assessments enable row level security;
create policy "credit_assessments_select_authenticated" on public.credit_assessments
  for select to authenticated using (true);

-- ── The assessment ──────────────────────────────────────────────
create or replace function public.assess_credit_capacity(
  p_customer_id uuid,
  p_agreement_type text default 'instalment_sale',
  p_term_months int default 60,
  p_rate_pct numeric default 15.0,
  p_balloon_cents bigint default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cust record;
  pol record;
  aff record;
  -- Policy values are held as scalars rather than a record, so the
  -- default path does not depend on constructing a typed row.
  v_policy_id uuid;
  v_policy_name text;
  v_max_disc_share numeric;
  v_max_dti numeric;
  v_hard_decline int;
  v_principal_cap bigint;
  v_max_term int;
  v_behaviour_uplift int;
  v_fraud_block int;
  bureau record;
  behaviour jsonb;
  v_fraud int := 0;
  v_existing_instalments bigint := 0;
  v_existing_exposure bigint := 0;
  v_discretionary bigint;
  v_net bigint;
  v_max_instalment bigint;
  v_dti_cap bigint;
  v_max_principal bigint;
  v_effective_score int;
  v_behaviour_score int;
  v_grade text;
  v_decision text;
  reasons text[] := '{}';
begin
  select * into cust from public.customers where id = p_customer_id;
  if not found then
    return jsonb_build_object('decision', 'insufficient_data',
      'reason_codes', to_jsonb(array['customer_not_found']));
  end if;

  -- Policy: the platform's own, else a conservative default.
  select * into pol from public.credit_policies
  where platform_id = cust.platform_id and agreement_type = p_agreement_type and active
  order by created_at desc limit 1;

  if found then
    v_policy_id       := pol.id;
    v_policy_name     := pol.name;
    v_max_disc_share  := pol.max_discretionary_share_pct;
    v_max_dti         := pol.max_debt_to_income_pct;
    v_hard_decline    := pol.hard_decline_bureau_score;
    v_principal_cap   := pol.max_principal_cents;
    v_max_term        := pol.max_term_months;
    v_behaviour_uplift:= pol.behaviour_uplift_max;
    v_fraud_block     := pol.fraud_block_score;
  else
    -- Conservative defaults when a platform has not set its appetite.
    v_policy_name     := 'default';
    v_max_disc_share  := 60;
    v_max_dti         := 40;
    v_hard_decline    := null;
    v_principal_cap   := null;
    v_max_term        := 72;
    v_behaviour_uplift:= 150;
    v_fraud_block     := 45;
    reasons := reasons || 'no_platform_policy_using_defaults'::text;
  end if;

  -- ── Fraud gate, before anything else ──────────────────────────
  select coalesce(max(score), 0) into v_fraud
  from public.fraud_alerts
  where customer_id = p_customer_id and status in ('open','investigating','confirmed_fraud');

  if v_fraud >= v_fraud_block then
    return jsonb_build_object(
      'decision', 'decline',
      'risk_grade', 'E',
      'fraud_score', v_fraud,
      'max_instalment_cents', 0,
      'max_principal_cents', 0,
      'recommended_limit_cents', 0,
      'reason_codes', to_jsonb(reasons || 'blocked_by_open_fraud_alert'::text),
      'workings', jsonb_build_object('fraud_block_score', v_fraud_block)
    );
  end if;

  -- ── Affordability: the ceiling ────────────────────────────────
  select * into aff from public.affordability_assessments
  where subject_id = cust.subject_id
  order by created_at desc limit 1;

  if not found or aff.discretionary_income_cents is null then
    return jsonb_build_object(
      'decision', 'insufficient_data',
      'reason_codes', to_jsonb(reasons || 'no_affordability_assessment'::text),
      'remedy', 'Run verify-credit with income figures before assessing capacity'
    );
  end if;

  v_net := aff.net_income_cents;
  -- The proposed instalment in that assessment is added back: we are
  -- sizing a new obligation, not the one that was modelled then.
  v_discretionary := aff.discretionary_income_cents + coalesce(aff.proposed_instalment_cents, 0);

  -- ── Existing exposure on this platform ────────────────────────
  select coalesce(sum(instalment_cents), 0), coalesce(sum(balance_cents), 0)
    into v_existing_instalments, v_existing_exposure
  from public.contracts
  where customer_id = p_customer_id and status in ('active','in_arrears','defaulted','legal');

  -- ── Bureau and behaviour ──────────────────────────────────────
  select * into bureau from public.credit_checks
  where subject_id = cust.subject_id and status = 'completed'
  order by created_at desc limit 1;

  behaviour := public.payment_behaviour(p_customer_id);
  v_behaviour_score := nullif(behaviour->>'score', '')::int;

  if bureau.score is null then
    reasons := reasons || 'no_bureau_record'::text;
    -- A thin file is not a bad file. Behaviour here earns a share of
    -- the policy's uplift, proportional to how well they have paid.
    if v_behaviour_score is null then
      reasons := reasons || 'no_payment_history'::text;
      v_effective_score := 500;
    else
      v_effective_score := 500 + least(
        v_behaviour_uplift,
        round(v_behaviour_score * v_behaviour_uplift / 100.0)::int
      );
    end if;
  else
    v_effective_score := bureau.score;
    -- Behaviour here nudges the bureau score, in both directions.
    if v_behaviour_score is not null then
      v_effective_score := least(999, greatest(0,
        v_effective_score + round((v_behaviour_score - 60) * 0.5)::int));
    end if;
  end if;

  if v_hard_decline is not null
     and coalesce(bureau.score, v_effective_score) < v_hard_decline then
    reasons := reasons || 'below_hard_decline_score'::text;
    return jsonb_build_object(
      'decision', 'decline', 'risk_grade', 'E',
      'bureau_score', bureau.score, 'effective_score', v_effective_score,
      'max_instalment_cents', 0, 'max_principal_cents', 0, 'recommended_limit_cents', 0,
      'reason_codes', to_jsonb(reasons)
    );
  end if;

  -- Legal states are not risk opinions.
  if bureau.debt_review or bureau.sequestration or bureau.admin_order then
    reasons := reasons || 'under_debt_review_or_sequestration'::text;
    return jsonb_build_object(
      'decision', 'decline', 'risk_grade', 'E',
      'max_instalment_cents', 0, 'max_principal_cents', 0, 'recommended_limit_cents', 0,
      'reason_codes', to_jsonb(reasons)
    );
  end if;

  -- ── Sizing ────────────────────────────────────────────────────
  -- Two independent caps; the tighter wins.
  v_max_instalment := floor(v_discretionary * v_max_disc_share / 100.0)::bigint;

  v_dti_cap := floor(v_net * v_max_dti / 100.0)::bigint
               - v_existing_instalments
               - coalesce(bureau.monthly_debt_obligations_cents, 0);

  if v_dti_cap < v_max_instalment then
    v_max_instalment := v_dti_cap;
    reasons := reasons || 'limited_by_debt_to_income'::text;
  else
    reasons := reasons || 'limited_by_discretionary_income'::text;
  end if;

  if v_max_instalment <= 0 then
    return jsonb_build_object(
      'decision', 'decline', 'risk_grade', 'E',
      'net_income_cents', v_net,
      'discretionary_income_cents', v_discretionary,
      'existing_instalments_cents', v_existing_instalments,
      'max_instalment_cents', 0, 'max_principal_cents', 0, 'recommended_limit_cents', 0,
      'reason_codes', to_jsonb(reasons || 'no_capacity_after_existing_obligations'::text)
    );
  end if;

  v_max_principal := public.principal_from_instalment(
    v_max_instalment, p_rate_pct, least(p_term_months, v_max_term), p_balloon_cents);

  if v_principal_cap is not null and v_max_principal > v_principal_cap then
    v_max_principal := v_principal_cap;
    reasons := reasons || 'capped_by_policy_maximum'::text;
  end if;

  -- ── Grade and decision ────────────────────────────────────────
  v_grade := case
    when v_effective_score >= 767 then 'A'
    when v_effective_score >= 681 then 'B'
    when v_effective_score >= 614 then 'C'
    when v_effective_score >= 583 then 'D'
    else 'E' end;

  -- Arrears now outweighs any score.
  if exists (select 1 from public.contracts
             where customer_id = p_customer_id and months_in_arrears >= 2
               and status in ('active','in_arrears','defaulted')) then
    v_grade := 'E';
    reasons := reasons || 'currently_in_arrears'::text;
  end if;

  v_decision := case
    when v_grade in ('A','B') and v_fraud < 20 then 'approve'
    when v_grade = 'E' then 'decline'
    else 'refer' end;

  -- Anything the affordability assessment itself was unhappy about
  -- keeps a person in the loop, whatever the grade.
  if aff.outcome in ('marginal', 'insufficient_data') then
    if v_decision = 'approve' then v_decision := 'refer'; end if;
    reasons := reasons || ('affordability_' || aff.outcome)::text;
  end if;

  if v_fraud >= 20 then
    if v_decision = 'approve' then v_decision := 'refer'; end if;
    reasons := reasons || 'open_fraud_signals'::text;
  end if;

  return jsonb_build_object(
    'decision', v_decision,
    'risk_grade', v_grade,
    'net_income_cents', v_net,
    'discretionary_income_cents', v_discretionary,
    'existing_instalments_cents', v_existing_instalments,
    'existing_exposure_cents', v_existing_exposure,
    'bureau_score', bureau.score,
    'bureau_band', bureau.band,
    'behaviour_score', v_behaviour_score,
    'effective_score', v_effective_score,
    'fraud_score', v_fraud,
    'max_instalment_cents', v_max_instalment,
    'max_principal_cents', v_max_principal,
    -- What to actually offer: the full capacity for a clean approve,
    -- pulled back where a person still has to look at it.
    'recommended_limit_cents', case
      when v_decision = 'approve' then v_max_principal
      when v_decision = 'refer' then floor(v_max_principal * 0.7)::bigint
      else 0 end,
    'assumed_rate_pct', p_rate_pct,
    'assumed_term_months', least(p_term_months, v_max_term),
    'reason_codes', to_jsonb(reasons),
    'workings', jsonb_build_object(
      'policy', v_policy_name,
      'max_discretionary_share_pct', v_max_disc_share,
      'max_debt_to_income_pct', v_max_dti,
      'discretionary_cap_cents', floor(v_discretionary * v_max_disc_share / 100.0)::bigint,
      'dti_cap_cents', v_dti_cap,
      'affordability_outcome', aff.outcome,
      'affordability_assessed_on', aff.assessed_on
    )
  );
end;
$$;

revoke execute on function public.assess_credit_capacity(uuid, text, int, numeric, bigint) from public, anon;
grant execute on function public.assess_credit_capacity(uuid, text, int, numeric, bigint)
  to authenticated, service_role;

-- ── Customer profile ────────────────────────────────────────────
-- Everything known about one customer, in one call: who they are, how
-- verified, what they owe, how they have paid, what the bureau says,
-- what fraud signals are open, and what they can be lent.
create or replace function public.customer_profile(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cust record;
  subj record;
  v_result jsonb;
begin
  select * into cust from public.customers where id = p_customer_id;
  if not found then return jsonb_build_object('error', 'customer_not_found'); end if;

  select * into subj from public.subjects where id = cust.subject_id;

  select jsonb_build_object(
    'customer', jsonb_build_object(
      'id', cust.id,
      'customer_number', cust.customer_number,
      'platform_id', cust.platform_id,
      'status', cust.status,
      'onboarded_at', cust.onboarded_at,
      'email', cust.email
    ),
    'identity', jsonb_build_object(
      'name', trim(coalesce(subj.first_names,'') || ' ' || coalesce(subj.surname,'')),
      'id_type', subj.id_type,
      'id_last4', subj.id_last4,
      'date_of_birth', subj.date_of_birth,
      'gender', subj.gender,
      'citizenship', subj.citizenship,
      'assurance_level', subj.assurance_level,
      'assurance_expires_at', subj.assurance_expires_at,
      'deceased', subj.deceased
    ),
    'contact', jsonb_build_object(
      'phones', (select coalesce(jsonb_agg(jsonb_build_object(
          'msisdn', p.msisdn, 'network', p.network, 'line_type', p.line_type,
          'rica_status', (select v.rica_status from public.phone_verifications v
                          where v.phone_id = p.id order by v.created_at desc limit 1),
          'days_since_sim_swap', (select v.days_since_sim_swap from public.phone_verifications v
                          where v.phone_id = p.id order by v.created_at desc limit 1)
        )), '[]'::jsonb) from public.phone_numbers p where p.customer_id = cust.id),
      'addresses', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id, 'type', a.address_type,
          'line1', a.line1, 'suburb', a.suburb, 'city', a.city,
          'province', a.province, 'postal_code', a.postal_code,
          'status', (select v.status from public.address_verifications v
                     where v.address_id = a.id order by v.created_at desc limit 1),
          'shared_with', public.address_shared_count(a.id)
        )), '[]'::jsonb) from public.addresses a where a.customer_id = cust.id and a.is_current)
    ),
    'employment', (select coalesce(jsonb_agg(jsonb_build_object(
        'employer', coalesce(e.name, er.employer_name_claimed),
        'cipc_status', e.cipc_status,
        'job_title', er.job_title,
        'type', er.employment_type,
        'started_on', er.started_on,
        'gross_monthly_cents', er.gross_monthly_cents,
        'verification_status', (select v.status from public.employment_verifications v
                                where v.employment_id = er.id order by v.created_at desc limit 1)
      )), '[]'::jsonb)
      from public.employment_records er
      left join public.employers e on e.id = er.employer_id
      where er.customer_id = cust.id and er.is_current),
    'credit', jsonb_build_object(
      'bureau', (select jsonb_build_object(
          'bureau', cc.bureau_id, 'score', cc.score, 'band', cc.band, 'risk', cc.risk,
          'accounts_total', cc.accounts_total, 'accounts_in_arrears', cc.accounts_in_arrears,
          'judgments', cc.judgments, 'defaults', cc.defaults,
          'debt_review', cc.debt_review, 'checked_at', cc.created_at)
        from public.credit_checks cc
        where cc.subject_id = cust.subject_id and cc.status = 'completed'
        order by cc.created_at desc limit 1),
      'affordability', (select jsonb_build_object(
          'outcome', a.outcome,
          'net_income_cents', a.net_income_cents,
          'discretionary_income_cents', a.discretionary_income_cents,
          'income_verified', a.income_verified,
          'assessed_on', a.assessed_on)
        from public.affordability_assessments a
        where a.subject_id = cust.subject_id order by a.created_at desc limit 1)
    ),
    'payment_behaviour', public.payment_behaviour(cust.id),
    'portfolio', jsonb_build_object(
      'contracts', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', ct.id, 'agreement_type', ct.agreement_type, 'status', ct.status,
          'principal_cents', ct.principal_cents, 'balance_cents', ct.balance_cents,
          'instalment_cents', ct.instalment_cents,
          'arrears_cents', ct.arrears_cents, 'months_in_arrears', ct.months_in_arrears,
          'last_payment_date', ct.last_payment_date,
          'asset', (select jsonb_build_object('type', ast.asset_type, 'make', ast.make,
                      'model', ast.model, 'year', ast.year,
                      'registration', ast.registration_number, 'vin', ast.vin, 'imei', ast.imei)
                    from public.assets ast where ast.id = ct.asset_id)
        ) order by ct.created_at desc), '[]'::jsonb)
        from public.contracts ct where ct.customer_id = cust.id),
      'total_exposure_cents', (select coalesce(sum(balance_cents), 0) from public.contracts
        where customer_id = cust.id and status in ('active','in_arrears','defaulted','legal')),
      'total_arrears_cents', (select coalesce(sum(arrears_cents), 0) from public.contracts
        where customer_id = cust.id),
      'monthly_commitment_cents', (select coalesce(sum(instalment_cents), 0) from public.contracts
        where customer_id = cust.id and status in ('active','in_arrears'))
    ),
    'fraud', jsonb_build_object(
      'open_alerts', (select count(*) from public.fraud_alerts
        where customer_id = cust.id and status in ('open','investigating')),
      'highest_score', (select coalesce(max(score), 0) from public.fraud_alerts
        where customer_id = cust.id and status in ('open','investigating')),
      'signals', (select coalesce(jsonb_agg(jsonb_build_object(
          'rule', s.rule_code, 'severity', s.severity, 'detail', s.detail,
          'raised_at', s.created_at)), '[]'::jsonb)
        from public.fraud_signals s where s.customer_id = cust.id and not s.dismissed)
    ),
    'latest_assessment', (select jsonb_build_object(
        'decision', ca.decision, 'risk_grade', ca.risk_grade,
        'max_instalment_cents', ca.max_instalment_cents,
        'max_principal_cents', ca.max_principal_cents,
        'recommended_limit_cents', ca.recommended_limit_cents,
        'assessed_on', ca.assessed_on, 'reason_codes', ca.reason_codes)
      from public.credit_assessments ca
      where ca.customer_id = cust.id order by ca.created_at desc limit 1)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.customer_profile(uuid) from public, anon;
grant execute on function public.customer_profile(uuid) to authenticated, service_role;
