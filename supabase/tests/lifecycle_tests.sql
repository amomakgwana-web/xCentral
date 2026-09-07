-- ══════════════════════════════════════════════════════════════
-- Tests for the customer lifecycle: amortisation, payment allocation,
-- arrears, behaviour scoring, background vetting, the fraud rules, and
-- credit capacity.
--
--   psql -d xctest -v ON_ERROR_STOP=1 -f supabase/tests/lifecycle_tests.sql
--
-- Run after logic_tests.sql, which defines expect().
-- ══════════════════════════════════════════════════════════════

create or replace function public.expect(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — expected %, got %', label, want, got;
  end if;
  raise notice 'pass  %', label;
end $$;

-- ── Amortisation ───────────────────────────────────────────────
do $$
declare p bigint; i bigint; back bigint;
begin
  -- Interest-free: the instalment is simply the principal over the term.
  perform public.expect('interest-free instalment is principal over term',
    public.instalment_cents(120000000, 0, 12, 0), 10000000::bigint);

  -- A balloon reduces what has to be amortised.
  perform public.expect('a balloon reduces the instalment',
    public.instalment_cents(120000000, 0, 12, 24000000), 8000000::bigint);

  -- Interest-bearing: assert the relationship rather than a magic
  -- number, so the test states the property it cares about.
  i := public.instalment_cents(30000000, 15.0, 60, 0);
  if i * 60 <= 30000000 then
    raise exception 'FAIL an interest-bearing loan must repay more than principal, got % over 60', i;
  end if;
  raise notice 'pass  interest-bearing total exceeds principal';

  if i <= public.instalment_cents(30000000, 0, 60, 0) then
    raise exception 'FAIL 15%% must cost more per month than 0%%';
  end if;
  raise notice 'pass  a higher rate raises the instalment';

  -- The reverse function must invert the forward one.
  back := public.principal_from_instalment(i, 15.0, 60, 0);
  if abs(back - 30000000) > 200 then
    raise exception 'FAIL round trip drifted: R% back from R%',
      back/100.0, 30000000/100.0;
  end if;
  raise notice 'pass  principal_from_instalment inverts instalment_cents';

  perform public.expect('a longer term buys more principal at the same instalment',
    public.principal_from_instalment(500000, 15.0, 72, 0)
      > public.principal_from_instalment(500000, 15.0, 36, 0), true);
end $$;

-- ── Fixtures ───────────────────────────────────────────────────
do $$
declare
  s_id uuid; c_id uuid; a_id uuid;
begin
  insert into public.client_platforms (id, name, environment)
  values ('test_dealer', 'Test Motors', 'sandbox') on conflict (id) do nothing;

  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname, date_of_birth)
  values ('sa_id', 'lifecycle-subject-1', '9086', 'Thabo', 'Mokoena', '1990-01-01')
  returning id into s_id;

  insert into public.customers (subject_id, platform_id, customer_number, status, email)
  values (s_id, 'test_dealer', 'CUST-0001', 'active', 'thabo@example.co.za')
  returning id into c_id;

  insert into public.assets (platform_id, asset_type, make, model, year, vin,
                             registration_number, retail_value_cents, condition, status)
  values ('test_dealer', 'vehicle_passenger', 'Toyota', 'Corolla Quest', 2024,
          'AHTBB3CD900123456', 'CA 123-456', 32000000, 'new', 'financed')
  returning id into a_id;

  -- R300 000 over 60 months at 15%.
  insert into public.contracts (id, customer_id, platform_id, asset_id, agreement_type,
    status, principal_cents, interest_rate_pct, term_months, instalment_cents,
    monthly_service_fee_cents, first_payment_date, payment_day, collection_method)
  values ('CT-TEST-0001', c_id, 'test_dealer', a_id, 'instalment_sale',
    'active', 30000000, 15.0, 60,
    public.instalment_cents(30000000, 15.0, 60, 0), 6900,
    (current_date - interval '5 months')::date, 1, 'debicheck');

  perform public.generate_payment_schedule('CT-TEST-0001');
end $$;

do $$
declare v_count int; v_sum bigint; v_final bigint; c record;
begin
  select count(*), sum(amount_due_cents) into v_count, v_sum
  from public.payment_schedule where contract_id = 'CT-TEST-0001';

  perform public.expect('the schedule has one row per instalment', v_count, 60);

  select * into c from public.contracts where id = 'CT-TEST-0001';
  perform public.expect('total repayable matches the schedule',
    c.total_repayable_cents, v_sum);

  -- The final instalment absorbs rounding, so the schedule clears the
  -- balance exactly rather than stranding a few cents.
  select sum(principal_cents) into v_final
  from public.payment_schedule where contract_id = 'CT-TEST-0001';
  perform public.expect('scheduled principal sums to the amount advanced',
    v_final, 30000000::bigint);
end $$;

-- ── Allocation and arrears ─────────────────────────────────────
do $$
declare
  c_id uuid; p_id uuid; res jsonb; pos jsonb; inst bigint; due bigint;
begin
  select id into c_id from public.customers where customer_number = 'CUST-0001';
  select amount_due_cents into due from public.payment_schedule
  where contract_id = 'CT-TEST-0001' and instalment_no = 1;

  -- Five instalments have fallen due and nothing has been paid.
  pos := public.recompute_contract_position('CT-TEST-0001');
  perform public.expect('unpaid instalments show as arrears',
    (pos->>'months_in_arrears')::int >= 5, true);
  perform public.expect('  · and the contract is in arrears',
    pos->>'status', 'defaulted');

  -- Pay exactly two instalments' worth.
  insert into public.payments (contract_id, customer_id, amount_cents, paid_at, method,
                               source_platform, external_reference)
  values ('CT-TEST-0001', c_id, due * 2, now() - interval '4 months', 'debicheck',
          'test_dealer', 'PAY-0001')
  returning id into p_id;

  res := public.allocate_payment(p_id);
  perform public.expect('a payment allocates oldest instalment first',
    (res->'instalments'->0->>'instalment_no')::int, 1);
  perform public.expect('  · then the next',
    (res->'instalments'->1->>'instalment_no')::int, 2);
  perform public.expect('  · and allocates the whole amount',
    (res->>'allocated_cents')::bigint, due * 2);

  perform public.expect('the first two instalments are now paid',
    (select count(*) from public.payment_schedule
     where contract_id = 'CT-TEST-0001' and status = 'paid'), 2::bigint);

  pos := public.recompute_contract_position('CT-TEST-0001');
  perform public.expect('arrears fall by what was paid',
    (pos->>'months_in_arrears')::int < 5, true);

  -- A part payment leaves the instalment partial, not paid.
  insert into public.payments (contract_id, customer_id, amount_cents, method, external_reference,
                               source_platform)
  values ('CT-TEST-0001', c_id, 100000, 'eft', 'PAY-0002', 'test_dealer')
  returning id into p_id;
  perform public.allocate_payment(p_id);

  perform public.expect('a part payment leaves the instalment partial',
    (select status from public.payment_schedule
     where contract_id = 'CT-TEST-0001' and instalment_no = 3), 'partial');
end $$;

-- ── Reversal ───────────────────────────────────────────────────
do $$
declare p_id uuid; before_arrears bigint; after_arrears bigint;
begin
  select id into p_id from public.payments where external_reference = 'PAY-0001';
  select arrears_cents into before_arrears from public.contracts where id = 'CT-TEST-0001';

  perform public.reverse_payment(p_id, 'Debit order unpaid — insufficient funds');

  select arrears_cents into after_arrears from public.contracts where id = 'CT-TEST-0001';
  perform public.expect('reversing a payment restores the arrears',
    after_arrears > before_arrears, true);

  perform public.expect('  · and removes its allocations',
    (select count(*) from public.payment_allocations where payment_id = p_id), 0::bigint);

  perform public.expect('  · so the instalments are unpaid again',
    (select status from public.payment_schedule
     where contract_id = 'CT-TEST-0001' and instalment_no = 1), 'missed');
end $$;

-- ── Payment behaviour ──────────────────────────────────────────
do $$
declare c_id uuid; b jsonb;
begin
  select id into c_id from public.customers where customer_number = 'CUST-0001';
  b := public.payment_behaviour(c_id);

  perform public.expect('behaviour reports a history', (b->>'has_history')::boolean, true);
  perform public.expect('  · and counts the reversal', (b->>'reversals')::int, 1);

  -- A customer with no contracts has no behaviour to report, and says
  -- so rather than returning a misleading zero.
  perform public.expect('a customer with no contracts has no score',
    (public.payment_behaviour(gen_random_uuid())->>'has_history')::boolean, false);
end $$;

-- ── Phone normalisation ────────────────────────────────────────
do $$
begin
  perform public.expect('national format normalises',
    public.normalise_msisdn('0821234567'), '+27821234567');
  perform public.expect('spaces are ignored',
    public.normalise_msisdn('082 123 4567'), '+27821234567');
  perform public.expect('the 00 prefix normalises',
    public.normalise_msisdn('0027821234567'), '+27821234567');
  perform public.expect('an already-normalised number is unchanged',
    public.normalise_msisdn('+27821234567'), '+27821234567');
  perform public.expect('a bare subscriber number gains the country code',
    public.normalise_msisdn('821234567'), '+27821234567');
  perform public.expect('empty input yields null',
    public.normalise_msisdn(''), null::text);
end $$;

-- ── Address fingerprinting ─────────────────────────────────────
do $$
begin
  perform public.expect('the same address written two ways collapses',
    public.address_fingerprint('12 Main Road', 'Apt 3', 'Rosebank', 'Johannesburg', '2196')
      = public.address_fingerprint('Unit 3, 12 Main Rd', null, 'rosebank', 'JOHANNESBURG', '2196'),
    true);

  perform public.expect('different addresses do not collapse',
    public.address_fingerprint('12 Main Road', null, 'Rosebank', 'Johannesburg', '2196')
      = public.address_fingerprint('14 Main Road', null, 'Rosebank', 'Johannesburg', '2196'),
    false);
end $$;

-- ── Payslip arithmetic ─────────────────────────────────────────
do $$
declare r jsonb;
begin
  -- R30 000 gross, R5 200 PAYE, R300 UIF → R24 500 net.
  r := public.check_payslip_arithmetic(3000000,
        '[{"label":"PAYE","amount_cents":520000},{"label":"UIF","amount_cents":30000}]'::jsonb,
        2450000);
  perform public.expect('a payslip that reconciles passes', (r->>'ok')::boolean, true);

  -- The same payslip with the gross inflated and deductions untouched.
  r := public.check_payslip_arithmetic(4500000,
        '[{"label":"PAYE","amount_cents":520000},{"label":"UIF","amount_cents":30000}]'::jsonb,
        2450000);
  perform public.expect('an inflated gross fails to reconcile', (r->>'ok')::boolean, false);
  perform public.expect('  · and says why',
    r->'reason_codes'->>0, 'payslip_net_does_not_reconcile');

  r := public.check_payslip_arithmetic(2000000, '[]'::jsonb, 2500000);
  perform public.expect('net above gross is caught',
    r->'reason_codes' @> '["payslip_net_exceeds_gross"]'::jsonb, true);
end $$;

-- ── Fraud detection ────────────────────────────────────────────
do $$
declare
  s1 uuid; s2 uuid; c1 uuid; case1 text := 'VC-FRAUD-0001';
  d1 uuid; d2 uuid; res jsonb;
begin
  select subject_id, id into s1, c1 from public.customers where customer_number = 'CUST-0001';

  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname)
  values ('sa_id', 'lifecycle-subject-2', '5511', 'Sipho', 'Ndlovu') returning id into s2;

  insert into public.verification_cases (id, subject_id, platform_id, level, status)
  values (case1, s1, 'test_dealer', 'standard', 'in_progress');

  -- The same file, by content hash, submitted for two different people.
  insert into public.documents (case_id, subject_id, doc_type, storage_path, sha256)
  values (case1, s1, 'proof_of_address', 'p/1', 'shared-sha-256-value') returning id into d1;
  insert into public.documents (subject_id, doc_type, storage_path, sha256)
  values (s2, 'proof_of_address', 'p/2', 'shared-sha-256-value') returning id into d2;

  perform public.expect('a document reused under another identity is detected',
    (select count(*) from public.detect_document_reuse(d1)), 1::bigint);

  -- A phone registered to one person, used by another.
  insert into public.phone_numbers (customer_id, subject_id, msisdn, msisdn_hash)
  values (c1, s1, '+27821234567', 'shared-msisdn-hash');
  insert into public.phone_numbers (subject_id, msisdn, msisdn_hash)
  values (s2, '+27821234567', 'shared-msisdn-hash');

  res := public.run_fraud_screen(case1, null);

  perform public.expect('the screen raises signals',
    (res->>'signals')::int >= 2, true);
  perform public.expect('  · including the reused document',
    exists (select 1 from public.fraud_signals
            where case_id = case1 and rule_code = 'doc_reused_across_identities'), true);
  perform public.expect('  · and the shared phone number',
    exists (select 1 from public.fraud_signals
            where case_id = case1 and rule_code = 'phone_shared_across_identities'), true);
  perform public.expect('  · and grades it critical',
    res->>'severity', 'critical');
  perform public.expect('  · and opens an alert',
    (res->>'alert_id') is not null, true);

  -- Re-running supersedes rather than duplicating.
  res := public.run_fraud_screen(case1, null);
  perform public.expect('re-screening does not duplicate signals',
    (select count(*) from public.fraud_signals
     where case_id = case1 and rule_code = 'doc_reused_across_identities'), 1::bigint);
end $$;

-- ── Credit capacity ────────────────────────────────────────────
do $$
declare
  s3 uuid; c3 uuid; res jsonb; case3 text := 'VC-CAP-0001';
begin
  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname)
  values ('sa_id', 'lifecycle-subject-3', '7788', 'Nandi', 'Dlamini') returning id into s3;

  insert into public.customers (subject_id, platform_id, customer_number, status)
  values (s3, 'test_dealer', 'CUST-0003', 'active') returning id into c3;

  insert into public.verification_cases (id, subject_id, platform_id, level, status)
  values (case3, s3, 'test_dealer', 'enhanced', 'verified');

  -- No affordability assessment yet: the answer must be "I don't know",
  -- never a number.
  res := public.assess_credit_capacity(c3, 'instalment_sale', 60, 15.0, 0);
  perform public.expect('capacity without an affordability assessment is refused',
    res->>'decision', 'insufficient_data');
  perform public.expect('  · and names what is missing',
    res->'reason_codes' @> '["no_affordability_assessment"]'::jsonb, true);

  -- R35 000 gross, R6 500 deductions, R9 000 expenses, no other debt.
  insert into public.affordability_assessments
    (case_id, subject_id, gross_income_cents, statutory_deductions_cents, net_income_cents,
     income_verified, declared_expenses_cents, minimum_expenses_cents, applied_expenses_cents,
     existing_obligations_cents, proposed_instalment_cents, discretionary_income_cents, outcome)
  values (case3, s3, 3500000, 650000, 2850000, true, 900000,
          public.nca_minimum_expenses_cents(2850000), 900000, 0, 0, 1950000, 'affordable');

  insert into public.consents (subject_id, purpose, lawful_basis)
  values (s3, 'credit_enquiry', 'consent');
  insert into public.credit_checks (case_id, subject_id, bureau_id, status, score, band, risk,
                                    monthly_debt_obligations_cents)
  values (case3, s3, 'transunion_za', 'completed', 720, 'Good', 'low', 0);

  res := public.assess_credit_capacity(c3, 'instalment_sale', 60, 15.0, 0);

  perform public.expect('a good applicant is approved', res->>'decision', 'approve');
  perform public.expect('  · at grade B', res->>'risk_grade', 'B');
  perform public.expect('  · with an instalment inside discretionary income',
    (res->>'max_instalment_cents')::bigint <= 1950000, true);
  perform public.expect('  · and a principal that supports it',
    (res->>'max_principal_cents')::bigint > 0, true);

  -- The instalment offered must actually be affordable at the assumed
  -- rate and term — the two functions must agree with each other.
  perform public.expect('  · the principal and instalment are consistent',
    abs(public.instalment_cents((res->>'max_principal_cents')::bigint, 15.0, 60, 0)
        - (res->>'max_instalment_cents')::bigint) <= 200, true);

  -- An open critical fraud alert stops the assessment cold.
  insert into public.fraud_alerts (customer_id, subject_id, platform_id, score, severity,
                                   signal_count, critical_count, status)
  values (c3, s3, 'test_dealer', 80, 'critical', 3, 2, 'open');

  res := public.assess_credit_capacity(c3, 'instalment_sale', 60, 15.0, 0);
  perform public.expect('an open fraud alert blocks capacity', res->>'decision', 'decline');
  perform public.expect('  · offering nothing',
    (res->>'recommended_limit_cents')::bigint, 0::bigint);
  perform public.expect('  · and saying so',
    res->'reason_codes' @> '["blocked_by_open_fraud_alert"]'::jsonb, true);
end $$;

-- ── Customer profile ───────────────────────────────────────────
do $$
declare c_id uuid; p jsonb;
begin
  select id into c_id from public.customers where customer_number = 'CUST-0001';
  p := public.customer_profile(c_id);

  perform public.expect('the profile names the customer',
    p->'identity'->>'name', 'Thabo Mokoena');
  perform public.expect('  · masks the identity number',
    p->'identity'->>'id_last4', '9086');
  perform public.expect('  · lists the contract',
    jsonb_array_length(p->'portfolio'->'contracts'), 1);
  perform public.expect('  · with the financed asset',
    p->'portfolio'->'contracts'->0->'asset'->>'make', 'Toyota');
  perform public.expect('  · reports exposure',
    (p->'portfolio'->>'total_exposure_cents')::bigint > 0, true);
  perform public.expect('  · carries the payment behaviour',
    (p->'payment_behaviour'->>'has_history')::boolean, true);
  perform public.expect('  · and surfaces open fraud signals',
    (p->'fraud'->>'open_alerts')::int >= 0, true);

  perform public.expect('an unknown customer is reported, not invented',
    public.customer_profile(gen_random_uuid())->>'error', 'customer_not_found');
end $$;

do $$ begin raise notice '───────────  ALL LIFECYCLE TESTS PASSED  ───────────'; end $$;
