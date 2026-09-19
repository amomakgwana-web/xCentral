-- ══════════════════════════════════════════════════════════════
-- Sandbox seed for the customer lifecycle.
--
-- Runs after seed.sql, which creates the subjects and platforms these
-- customers hang off. Everyone here is invented. The three customers
-- are chosen to show the three outcomes the console has to make legible:
-- a good payer, one sliding into arrears, and one the fraud rules
-- should light up.
-- ══════════════════════════════════════════════════════════════

-- ── Default lending policy per platform ─────────────────────────
-- Deliberately conservative. A platform tunes its own appetite by
-- inserting its own row; these exist so an assessment never has to
-- guess in the absence of one.
insert into public.credit_policies
  (platform_id, agreement_type, name, max_discretionary_share_pct, max_debt_to_income_pct,
   min_bureau_score, hard_decline_bureau_score, max_principal_cents, max_term_months,
   behaviour_uplift_max, fraud_block_score)
select p.id, t.agreement_type, 'Standard', t.disc_share, t.dti,
       t.min_score, t.hard_decline, t.max_principal, t.max_term, 150, 45
from public.client_platforms p
cross join (values
  ('instalment_sale',  60::numeric, 40::numeric, 583, 520, 150000000::bigint, 72),
  ('unsecured_credit', 40::numeric, 30::numeric, 614, 560,   5000000::bigint, 36),
  ('phone_contract',   35::numeric, 30::numeric, 583, 520,   3000000::bigint, 36),
  ('credit_facility',  40::numeric, 35::numeric, 614, 560,   2000000::bigint, 24)
) as t(agreement_type, disc_share, dti, min_score, hard_decline, max_principal, max_term)
on conflict (platform_id, agreement_type, name) do nothing;

do $$
declare
  s_thabo uuid; s_nandi uuid; s_pieter uuid; s_lerato uuid;
  c_thabo uuid; c_nandi uuid; c_pieter uuid;
  a_corolla uuid; a_polo uuid; a_phone uuid; a_hilux uuid;
  ct1 text := 'CT-BIPR-2026-00001';
  ct2 text := 'CT-XPAY-2026-00001';
  ct3 text := 'CT-VERI-2026-00001';
  due bigint; i int; pay uuid;
begin
  select id into s_thabo  from public.subjects where id_hash = 'seed-subject-thabo';
  select id into s_nandi  from public.subjects where id_hash = 'seed-subject-nandi';
  select id into s_pieter from public.subjects where id_hash = 'seed-subject-pieter';
  select id into s_lerato from public.subjects where id_hash = 'seed-subject-lerato';

  -- ── Customers ────────────────────────────────────────────────
  insert into public.customers (subject_id, platform_id, customer_number, status,
                                onboarding_case_id, onboarded_at, email, preferred_contact)
  values (s_thabo, 'biprapay', 'BP-CUST-1001', 'active', 'VC-2026-000001',
          now() - interval '14 months', 'thabo.mokoena@example.co.za', 'whatsapp')
  returning id into c_thabo;

  insert into public.customers (subject_id, platform_id, customer_number, status,
                                onboarding_case_id, onboarded_at, email, preferred_contact)
  values (s_nandi, 'xpayments', 'XP-CUST-2044', 'active', 'VC-2026-000002',
          now() - interval '8 months', 'nandi.dlamini@example.co.za', 'sms')
  returning id into c_nandi;

  insert into public.customers (subject_id, platform_id, customer_number, status,
                                onboarding_case_id, onboarded_at, email, preferred_contact)
  values (s_pieter, 'veribills', 'VB-CUST-0317', 'suspended', 'VC-2026-000003',
          now() - interval '3 months', 'p.vdmerwe@example.co.za', 'email')
  returning id into c_pieter;

  -- ── Assets ───────────────────────────────────────────────────
  insert into public.assets (platform_id, asset_type, make, model, variant, year, colour,
    vin, engine_number, registration_number, retail_value_cents, trade_value_cents,
    valued_on, odometer_km, condition, status, registry_verified, registry_status)
  values ('biprapay', 'vehicle_passenger', 'Toyota', 'Corolla Quest', '1.8 Exclusive', 2024,
          'Silver', 'AHTBB3CD900123456', '2ZR1234567', 'CA 481-902',
          38900000, 34500000, current_date - 30, 18400, 'used', 'financed', true, 'clear')
  returning id into a_corolla;

  insert into public.assets (platform_id, asset_type, make, model, variant, year, colour,
    vin, registration_number, retail_value_cents, valued_on, odometer_km,
    condition, status, registry_verified, registry_status)
  values ('xpayments', 'vehicle_passenger', 'Volkswagen', 'Polo Vivo', '1.4 Comfortline', 2023,
          'White', 'WVWZZZ6RZPY123456', 'GP JH 44 TX',
          27500000, current_date - 60, 41200, 'used', 'financed', true, 'clear')
  returning id into a_polo;

  insert into public.assets (platform_id, asset_type, make, model, year,
    imei, retail_value_cents, condition, status, registry_verified, registry_status)
  values ('veribills', 'handset', 'Samsung', 'Galaxy A55 5G', 2025,
          '356938035643809', 1099900, 'new', 'financed', false, 'not_found')
  returning id into a_phone;

  -- An unencumbered car on the floor, for the capacity demo.
  insert into public.assets (platform_id, asset_type, make, model, variant, year, colour,
    vin, registration_number, retail_value_cents, valued_on, odometer_km,
    condition, status, registry_verified, registry_status)
  values ('biprapay', 'vehicle_commercial', 'Toyota', 'Hilux', '2.4 GD-6 SRX', 2025,
          'White', 'AHTFR22G80A987654', null,
          52900000, current_date - 7, 12, 'demo', 'available', true, 'clear')
  returning id into a_hilux;

  -- ── Contracts ────────────────────────────────────────────────
  -- Thabo: 14 months in, paying on time.
  insert into public.contracts (id, customer_id, platform_id, asset_id, agreement_type,
    origination_case_id, status, principal_cents, deposit_cents, interest_rate_pct,
    term_months, instalment_cents, monthly_service_fee_cents,
    first_payment_date, payment_day, collection_method)
  values (ct1, c_thabo, 'biprapay', a_corolla, 'instalment_sale', 'VC-2026-000001',
    'active', 33000000, 5900000, 13.75, 72,
    public.instalment_cents(33000000, 13.75, 72, 0), 6900,
    (current_date - interval '14 months')::date, 1, 'debicheck');
  perform public.generate_payment_schedule(ct1);

  -- Nandi: 8 months in, has slipped.
  insert into public.contracts (id, customer_id, platform_id, asset_id, agreement_type,
    origination_case_id, status, principal_cents, deposit_cents, interest_rate_pct,
    term_months, instalment_cents, monthly_service_fee_cents,
    first_payment_date, payment_day, collection_method)
  values (ct2, c_nandi, 'xpayments', a_polo, 'instalment_sale', 'VC-2026-000002',
    'active', 24750000, 2750000, 16.25, 60,
    public.instalment_cents(24750000, 16.25, 60, 0), 6900,
    (current_date - interval '8 months')::date, 25, 'debit_order');
  perform public.generate_payment_schedule(ct2);

  -- Pieter: a handset contract, never paid a cent.
  insert into public.contracts (id, customer_id, platform_id, asset_id, agreement_type,
    origination_case_id, status, principal_cents, interest_rate_pct,
    term_months, instalment_cents, monthly_service_fee_cents,
    first_payment_date, payment_day, collection_method)
  values (ct3, c_pieter, 'veribills', a_phone, 'phone_contract', 'VC-2026-000003',
    'active', 1099900, 24.5, 24,
    public.instalment_cents(1099900, 24.5, 24, 0), 0,
    (current_date - interval '3 months')::date, 1, 'debit_order');
  perform public.generate_payment_schedule(ct3);

  -- ── Payments ─────────────────────────────────────────────────
  -- Thabo pays every month, on time, including the one just due.
  for i in 1..15 loop
    select amount_due_cents into due from public.payment_schedule
    where contract_id = ct1 and instalment_no = i;

    insert into public.payments (contract_id, customer_id, amount_cents, paid_at, method,
                                 source_platform, external_reference, status)
    values (ct1, c_thabo, due,
            ((current_date - interval '14 months') + make_interval(months => i - 1))::timestamptz,
            'debicheck', 'biprapay', 'BP-COL-' || lpad(i::text, 5, '0'), 'received')
    returning id into pay;
    perform public.allocate_payment(pay);
  end loop;

  -- Nandi pays five, then one bounces, then stops.
  for i in 1..5 loop
    select amount_due_cents into due from public.payment_schedule
    where contract_id = ct2 and instalment_no = i;

    insert into public.payments (contract_id, customer_id, amount_cents, paid_at, method,
                                 source_platform, external_reference, status)
    values (ct2, c_nandi, due,
            ((current_date - interval '8 months') + make_interval(months => i - 1))::timestamptz,
            'debit_order', 'xpayments', 'XP-COL-' || lpad(i::text, 5, '0'), 'received')
    returning id into pay;
    perform public.allocate_payment(pay);
  end loop;

  select amount_due_cents into due from public.payment_schedule
  where contract_id = ct2 and instalment_no = 6;
  insert into public.payments (contract_id, customer_id, amount_cents, paid_at, method,
                               source_platform, external_reference, status)
  values (ct2, c_nandi, due,
          ((current_date - interval '8 months') + make_interval(months => 5))::timestamptz,
          'debit_order', 'xpayments', 'XP-COL-00006', 'received')
  returning id into pay;
  perform public.allocate_payment(pay);
  perform public.reverse_payment(pay, 'Debit order unpaid — insufficient funds');

  perform public.recompute_contract_position(ct1);
  perform public.recompute_contract_position(ct2);
  perform public.recompute_contract_position(ct3);

  -- ── Contact and employment ───────────────────────────────────
  insert into public.addresses (customer_id, subject_id, address_type, line1, suburb,
                                city, province, postal_code, resident_since, address_hash)
  values
    (c_thabo, s_thabo, 'residential', '17 Protea Street', 'Ferndale',
     'Randburg', 'Gauteng', '2194', current_date - interval '6 years', 'pending'),
    (c_nandi, s_nandi, 'residential', '42B Marine Drive', 'Bluff',
     'Durban', 'KwaZulu-Natal', '4052', current_date - interval '2 years', 'pending'),
    (c_pieter, s_pieter, 'residential', '9 Kerk Straat', 'Central',
     'Bloemfontein', 'Free State', '9301', current_date - interval '4 months', 'pending');

  -- Two more subjects at Pieter's address, so the shared-address rule
  -- has something real to find.
  insert into public.addresses (subject_id, address_type, line1, suburb, city,
                                province, postal_code, address_hash)
  values
    (s_lerato, 'residential', '9 Kerk Street', 'Central', 'Bloemfontein',
     'Free State', '9301', 'pending'),
    (s_nandi, 'previous', 'Unit 9, Kerk Str', 'Central', 'Bloemfontein',
     'Free State', '9301', 'pending');

  insert into public.phone_numbers (customer_id, subject_id, msisdn, msisdn_hash,
                                    network, line_type)
  values
    (c_thabo,  s_thabo,  '+27821234567', 'seed-hash-thabo-msisdn',  'Vodacom', 'mobile_contract'),
    (c_nandi,  s_nandi,  '+27835550142', 'seed-hash-nandi-msisdn',  'MTN',     'mobile_contract'),
    (c_pieter, s_pieter, '+27723334455', 'seed-hash-shared-msisdn', 'Cell C',  'mobile_prepaid');

  -- The same line under a second identity.
  insert into public.phone_numbers (subject_id, msisdn, msisdn_hash, network, line_type)
  values (s_lerato, '+27723334455', 'seed-hash-shared-msisdn', 'Cell C', 'mobile_prepaid');

  insert into public.phone_verifications (phone_id, rica_status, registered_name,
    name_match_score, tenure_days, status, confidence, provider)
  select id, 'registered_to_subject', 'Thabo Mokoena', 100, 2140, 'verified', 96, 'simulation'
  from public.phone_numbers where msisdn_hash = 'seed-hash-thabo-msisdn';

  -- Pieter's number was swapped four days before he applied.
  insert into public.phone_verifications (phone_id, rica_status, registered_name,
    name_match_score, last_sim_swap_at, days_since_sim_swap, tenure_days,
    status, confidence, reason_codes, provider)
  select id, 'registered_to_other', 'M. Nkosi', 12,
         now() - interval '4 days', 4, 61, 'manual_review', 20,
         array['rica_registered_to_other','recent_sim_swap'], 'simulation'
  from public.phone_numbers where msisdn_hash = 'seed-hash-shared-msisdn'
    and subject_id = s_pieter;

  insert into public.employers (name, name_normalised, registration_number, cipc_status,
                                cipc_checked_at, sector)
  values
    ('Transnet SOC Ltd', 'transnet soc ltd', '1990/000900/30', 'in_business', now(), 'Transport'),
    ('Bluff Marine Services CC', 'bluff marine services cc', '2011/114520/23', 'in_business', now(), 'Manufacturing'),
    ('Sentinel Holdings Group', 'sentinel holdings group', null, 'not_found', now(), null);

  insert into public.employment_records (customer_id, subject_id, employer_id,
    employer_name_claimed, job_title, employment_type, started_on,
    gross_monthly_cents, net_monthly_cents, pay_frequency, pay_day)
  values
    (c_thabo, s_thabo, (select id from public.employers where name_normalised = 'transnet soc ltd'),
     'Transnet SOC Ltd', 'Operations Supervisor', 'permanent',
     current_date - interval '7 years', 4200000, 3180000, 'monthly', 25),
    (c_nandi, s_nandi, (select id from public.employers where name_normalised = 'bluff marine services cc'),
     'Bluff Marine Services CC', 'Accounts Clerk', 'permanent',
     current_date - interval '3 years', 2800000, 2280000, 'monthly', 25),
    (c_pieter, s_pieter, (select id from public.employers where name_normalised = 'sentinel holdings group'),
     'Sentinel Holdings Group', 'Regional Director', 'permanent',
     current_date - interval '2 months', 9500000, 8900000, 'monthly', 30);

  insert into public.employment_verifications (employment_id, method, employer_exists,
    payslip_arithmetic_ok, declared_gross_cents, declared_net_cents, computed_net_cents,
    observed_deposit_cents, income_variance_pct, status, confidence, reason_codes, provider)
  select er.id, 'payslip', true, true, 4200000, 3180000, 3180000, 3180000, 0,
         'verified', 94, '{}', 'simulation'
  from public.employment_records er where er.customer_id = c_thabo;

  -- Pieter's payslip: R95 000 gross, R6 000 of deductions listed, and a
  -- net of R89 000 that does not follow from either.
  insert into public.employment_verifications (employment_id, method, employer_exists,
    payslip_arithmetic_ok, declared_gross_cents, declared_net_cents, computed_net_cents,
    observed_deposit_cents, income_variance_pct, status, confidence, reason_codes, provider)
  select er.id, 'payslip', false, false, 9500000, 8900000, 8900000, 1200000, 641.67,
         'failed', 8,
         array['payslip_net_does_not_reconcile','employer_not_at_cipc','income_variance_high'],
         'simulation'
  from public.employment_records er where er.customer_id = c_pieter;

  insert into public.bank_accounts (customer_id, subject_id, bank_name, branch_code,
    account_type, account_last4, account_hash, account_holder_name, avs_status, avs_checked_at)
  values
    (c_thabo, s_thabo, 'Standard Bank', '051001', 'cheque', '4471',
     'seed-hash-thabo-account', 'T Mokoena', 'verified', now()),
    (c_nandi, s_nandi, 'Capitec', '470010', 'savings', '9902',
     'seed-hash-nandi-account', 'N Dlamini', 'verified', now()),
    (c_pieter, s_pieter, 'FNB', '250655', 'cheque', '1188',
     'seed-hash-shared-account', 'M Nkosi', 'name_mismatch', now());

  -- The same account under another identity.
  insert into public.bank_accounts (subject_id, bank_name, branch_code, account_type,
    account_last4, account_hash, account_holder_name, avs_status)
  values (s_lerato, 'FNB', '250655', 'cheque', '1188',
          'seed-hash-shared-account', 'M Nkosi', 'verified');

  -- A bureau record for the good payer, so the normal path is shown
  -- rather than only the thin-file one.
  insert into public.consents (subject_id, platform_id, purpose, lawful_basis,
                               consent_text_id, method)
  values (s_thabo, 'biprapay', 'credit_enquiry', 'consent', 'ct_credit_v1', 'click_wrap');

  insert into public.credit_checks (case_id, subject_id, bureau_id, enquiry_type, purpose,
    score, band, risk, accounts_total, accounts_in_arrears, worst_arrears_months,
    monthly_debt_obligations_cents, status)
  values ('VC-2026-000001', s_thabo, 'transunion_za', 'soft', 'onboarding',
          742, 'Good', 'low', 4, 0, 0, 0, 'completed');

  -- ── Affordability, so capacity can be assessed ───────────────
  insert into public.affordability_assessments
    (case_id, subject_id, gross_income_cents, statutory_deductions_cents, net_income_cents,
     income_verified, income_source, declared_expenses_cents, minimum_expenses_cents,
     applied_expenses_cents, existing_obligations_cents, proposed_instalment_cents,
     discretionary_income_cents, outcome)
  values ('VC-2026-000001', s_thabo, 4200000, 1020000, 3180000, true, 'Payslip — verified',
          1100000, public.nca_minimum_expenses_cents(3180000), 1100000, 0, 0,
          3180000 - 1100000, 'affordable');

  -- ── Screen everyone ──────────────────────────────────────────
  perform public.run_fraud_screen(null, c_thabo);
  perform public.run_fraud_screen(null, c_nandi);
  perform public.run_fraud_screen('VC-2026-000003', c_pieter);

  -- ── A stored capacity assessment for the good customer ───────
  insert into public.credit_assessments (customer_id, case_id, agreement_type, net_income_cents,
    discretionary_income_cents, existing_instalments_cents, existing_exposure_cents,
    bureau_score, bureau_band, behaviour_score, fraud_score,
    max_instalment_cents, max_principal_cents, recommended_limit_cents,
    assumed_rate_pct, assumed_term_months, risk_grade, decision, reason_codes, workings)
  select c_thabo, 'VC-2026-000001', 'instalment_sale',
         (r->>'net_income_cents')::bigint, (r->>'discretionary_income_cents')::bigint,
         (r->>'existing_instalments_cents')::bigint, (r->>'existing_exposure_cents')::bigint,
         (r->>'bureau_score')::int, r->>'bureau_band',
         (r->>'behaviour_score')::int, (r->>'fraud_score')::int,
         (r->>'max_instalment_cents')::bigint, (r->>'max_principal_cents')::bigint,
         (r->>'recommended_limit_cents')::bigint,
         (r->>'assumed_rate_pct')::numeric, (r->>'assumed_term_months')::int,
         r->>'risk_grade', r->>'decision',
         array(select jsonb_array_elements_text(r->'reason_codes')), r->'workings'
  from public.assess_credit_capacity(c_thabo, 'instalment_sale', 72, 13.75, 0) r
  where r->>'decision' <> 'insufficient_data';
end $$;
