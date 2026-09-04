-- ══════════════════════════════════════════════════════════════
-- Sandbox seed.
--
-- Enough data for the console to be worth looking at and for the
-- sibling platforms to be wired up. Every subject here is invented.
--
-- Staff profiles are deliberately absent: they are created by
-- handle_new_user() when a real person signs up, so seeding them
-- would create profile rows pointing at auth users that do not exist.
-- ══════════════════════════════════════════════════════════════

-- ── The platforms that call the hub ─────────────────────────────
insert into public.client_platforms (id, name, environment, status, contact_email, allowed_domains, responsible_party) values
  ('xcentral_console', 'xCentral Console',  'sandbox', 'active', 'ops@xcentral.co.za',
    array['identity','document','credit','biometric'], 'xCentral (Pty) Ltd'),
  ('biprapay',         'BipraPay',          'sandbox', 'active', 'compliance@biprapay.com',
    array['identity','document','biometric'], 'BipraPay (Pty) Ltd'),
  ('xpayments',        'xPayments',         'sandbox', 'active', 'risk@xpayments.co.za',
    array['identity','document','credit','biometric'], 'xPayments (Pty) Ltd'),
  ('veribills',        'veriBills',         'sandbox', 'active', 'support@veribills.co.za',
    array['identity','document'], 'veriBills (Pty) Ltd'),
  ('piggybag',         'PiggyBag',          'sandbox', 'active', 'hello@piggybag.co.za',
    array['identity','credit'], 'PiggyBag (Pty) Ltd'),
  ('mysmme',           'mySMME',            'sandbox', 'active', 'admin@mysmme.co.za',
    array['identity','document'], 'mySMME (Pty) Ltd')
on conflict (id) do nothing;

-- ── Consent wording ─────────────────────────────────────────────
insert into public.consent_texts (id, purpose, version, body) values
  ('ct_identity_v1', 'identity_verification', 1,
   'I consent to xCentral verifying my identity against the records of the Department of Home Affairs and other lawful sources, for the purpose of the service I am applying for.'),
  ('ct_document_v1', 'document_storage', 1,
   'I consent to xCentral storing copies of the documents I have supplied for as long as the Financial Intelligence Centre Act requires, and to their examination for authenticity.'),
  ('ct_credit_v1', 'credit_enquiry', 1,
   'I consent to xCentral obtaining my credit record from a registered credit bureau and to assessing my affordability as required by the National Credit Act. I understand a hard enquiry may affect my credit score.'),
  ('ct_biometric_v1', 'biometric_processing', 1,
   'I explicitly consent to xCentral processing my biometric information — including a photograph of my face — to confirm that I am the person on the identity document supplied. I understand that biometric information is special personal information under the Protection of Personal Information Act, that no photograph of me is retained, and that I may withdraw this consent at any time.'),
  ('ct_screening_v1', 'watchlist_screening', 1,
   'I consent to my name being screened against sanctions, politically exposed person and adverse media lists as required by the Financial Intelligence Centre Act.'),
  ('ct_sharing_v1', 'result_sharing', 1,
   'I consent to the outcome of this verification being shared with the platform that requested it.')
on conflict (id) do nothing;

-- ── Sanctions / PEP watchlist ───────────────────────────────────
-- Invented entries standing in for the UNSC consolidated list, the
-- FIC targeted financial sanctions list and an internal deny list.
insert into public.watchlist_entries (list_name, entry_type, full_name, aliases, country, notes) values
  ('UNSC Consolidated',    'sanction',      'Viktor Andreyev',      array['V. Andreyev','Viktor Andreev'], 'RU', 'Illustrative entry'),
  ('UNSC Consolidated',    'sanction',      'Amina Haddad',         array['A. Haddad'],                    'LY', 'Illustrative entry'),
  ('FIC Targeted Sanctions','sanction',     'Johannes Pretorius',   array['Johan Pretorius'],              'ZA', 'Illustrative entry'),
  ('Domestic PEP Register','pep',           'Nomsa Radebe',         array['N. Radebe'],                    'ZA', 'Provincial official — illustrative'),
  ('Domestic PEP Register','pep',           'Kagiso Molefe',        array['K. Molefe'],                    'ZA', 'Municipal official — illustrative'),
  ('Adverse Media',        'adverse_media', 'Unknown Corp Holdings',array[]::text[],                       'ZA', 'Illustrative entry'),
  ('Internal Deny List',   'internal_deny', 'Pieter van der Merwe', array['P. van der Merwe'],             'ZA', 'Prior confirmed document fraud — illustrative')
on conflict do nothing;

-- ── Deceased register sample ────────────────────────────────────
-- Hashes only, as the live feed would be. These are arbitrary values
-- and match no real identity number.
insert into public.deceased_register (id_hash, date_of_death, source) values
  ('seed-deceased-0000000000000000000000000000000000000000000000000000001', '2024-11-02', 'dha_feed'),
  ('seed-deceased-0000000000000000000000000000000000000000000000000000002', '2025-03-19', 'dha_feed')
on conflict (id_hash) do nothing;

-- ── Demo subjects and cases ─────────────────────────────────────
-- id_hash values here are seed placeholders, not real peppered
-- hashes; a live subject is only ever created through ensureSubject().
do $$
declare
  s_thabo uuid; s_nandi uuid; s_pieter uuid; s_lerato uuid;
  c1 text := 'VC-2026-000001';
  c2 text := 'VC-2026-000002';
  c3 text := 'VC-2026-000003';
  c4 text := 'VC-2026-000004';
begin
  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname, date_of_birth, gender, citizenship, assurance_level, assurance_expires_at)
  values ('sa_id', 'seed-subject-thabo', '9086', 'Thabo', 'Mokoena', '1990-01-01', 'male', 'citizen', 'standard', now() + interval '11 months')
  returning id into s_thabo;

  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname, date_of_birth, gender, citizenship)
  values ('sa_id', 'seed-subject-nandi', '2088', 'Nandi', 'Dlamini', '1988-03-15', 'female', 'citizen')
  returning id into s_nandi;

  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname, date_of_birth, gender, citizenship)
  values ('sa_id', 'seed-subject-pieter', '4471', 'Pieter', 'van der Merwe', '1979-06-22', 'male', 'citizen')
  returning id into s_pieter;

  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname, date_of_birth, gender, citizenship)
  values ('sa_id', 'seed-subject-lerato', '1184', 'Lerato', 'Khumalo', '2005-07-22', 'female', 'permanent_resident')
  returning id into s_lerato;

  -- Consents, so the seeded cases are lawful on their face.
  insert into public.consents (subject_id, platform_id, purpose, lawful_basis, consent_text_id, method) values
    (s_thabo,  'biprapay',  'identity_verification', 'consent', 'ct_identity_v1',  'click_wrap'),
    (s_thabo,  'biprapay',  'document_storage',      'consent', 'ct_document_v1',  'click_wrap'),
    (s_thabo,  'biprapay',  'biometric_processing',  'consent', 'ct_biometric_v1', 'click_wrap'),
    (s_nandi,  'xpayments', 'identity_verification', 'consent', 'ct_identity_v1',  'click_wrap'),
    (s_nandi,  'xpayments', 'credit_enquiry',        'consent', 'ct_credit_v1',    'signed_document'),
    (s_pieter, 'veribills', 'identity_verification', 'consent', 'ct_identity_v1',  'in_person'),
    (s_lerato, 'piggybag',  'identity_verification', 'consent', 'ct_identity_v1',  'ussd');

  -- A clean, fully verified case.
  insert into public.verification_cases (id, subject_id, platform_id, client_reference, purpose, level, status, risk, score, expires_at)
  values (c1, s_thabo, 'biprapay', 'MRC-APP-0022', 'onboarding', 'standard', 'verified', 'low', 96, now() + interval '11 months');

  insert into public.verification_checks (case_id, domain, check_type, provider, status, score, result) values
    (c1, 'identity', 'id_structure',        'xcentral',   'passed', 100, '{"gender":"male","citizenship":"citizen"}'),
    (c1, 'identity', 'authority_lookup',    'simulation', 'passed', 100, '{"authority_status":"match","name_match_score":100}'),
    (c1, 'identity', 'deceased_register',   'xcentral',   'passed', 100, '{"on_register":false}'),
    (c1, 'identity', 'watchlist_screening', 'xcentral',   'passed', 100, '{"hits":[]}'),
    (c1, 'document', 'document_authenticity','simulation','passed',  94, '{"mrz_valid":true}'),
    (c1, 'document', 'document_expiry',     'xcentral',   'passed', 100, '{"expired":false}'),
    (c1, 'document', 'name_match',          'xcentral',   'passed', 100, '{"document_name":"Thabo Mokoena"}');

  -- A case waiting on a credit decision.
  insert into public.verification_cases (id, subject_id, platform_id, client_reference, purpose, level, status, risk, score)
  values (c2, s_nandi, 'xpayments', 'LOAN-2026-0417', 'lending', 'enhanced', 'review', 'medium', 71);

  insert into public.verification_checks (case_id, domain, check_type, provider, status, score, result) values
    (c2, 'identity',  'id_structure',        'xcentral',   'passed',        100, '{"gender":"female"}'),
    (c2, 'identity',  'authority_lookup',    'simulation', 'passed',        100, '{"authority_status":"match"}'),
    (c2, 'identity',  'deceased_register',   'xcentral',   'passed',        100, '{"on_register":false}'),
    (c2, 'identity',  'watchlist_screening', 'xcentral',   'passed',        100, '{"hits":[]}'),
    (c2, 'document',  'document_authenticity','simulation','passed',         88, '{"mrz_valid":true}'),
    (c2, 'document',  'document_expiry',     'xcentral',   'passed',        100, '{"expired":false}'),
    (c2, 'document',  'name_match',          'xcentral',   'passed',         97, '{}'),
    (c2, 'biometric', 'face_match',          'simulation', 'passed',         92, '{"similarity":0.81}'),
    (c2, 'biometric', 'liveness',            'simulation', 'passed',         96, '{"attack_type":"none"}'),
    (c2, 'credit',    'bureau_enquiry',      'simulation', 'manual_review',  58, '{"band":"Average","defaults":1}'),
    (c2, 'credit',    'affordability',       'xcentral',   'manual_review',  60, '{"outcome":"marginal"}');

  -- A case rejected on a watchlist confirmation.
  insert into public.verification_cases (id, subject_id, platform_id, client_reference, purpose, level, status, risk, score, decision_reason, decided_at)
  values (c3, s_pieter, 'veribills', 'ACC-88213', 'onboarding', 'standard', 'rejected', 'high', 34,
          'Internal deny list match confirmed — prior document fraud', now() - interval '2 days');

  insert into public.verification_checks (case_id, domain, check_type, provider, status, score, result, reason_codes) values
    (c3, 'identity', 'id_structure',        'xcentral',   'passed',        100, '{}', '{}'),
    (c3, 'identity', 'authority_lookup',    'simulation', 'passed',        100, '{"authority_status":"match"}', '{}'),
    (c3, 'identity', 'deceased_register',   'xcentral',   'passed',        100, '{"on_register":false}', '{}'),
    (c3, 'identity', 'watchlist_screening', 'xcentral',   'manual_review',  40, '{"hits":[{"list":"Internal Deny List","score":100}]}', array['watchlist_potential_match']),
    (c3, 'document', 'document_authenticity','simulation','failed',          0, '{"mrz_valid":false}', array['mrz_check_digit_failed_composite']),
    (c3, 'document', 'document_expiry',     'xcentral',   'passed',        100, '{}', '{}'),
    (c3, 'document', 'name_match',          'xcentral',   'passed',         94, '{}', '{}');

  insert into public.watchlist_hits (case_id, entry_id, match_score, status, review_note)
  select c3, id, 100, 'confirmed', 'Confirmed against internal record'
  from public.watchlist_entries where full_name = 'Pieter van der Merwe' limit 1;

  -- A basic age check, still running.
  insert into public.verification_cases (id, subject_id, platform_id, client_reference, purpose, level, status, risk, score)
  values (c4, s_lerato, 'piggybag', 'AGE-9921', 'age_check', 'basic', 'in_progress', 'low', 67);

  insert into public.verification_checks (case_id, domain, check_type, provider, status, score, result) values
    (c4, 'identity', 'id_structure',      'xcentral', 'passed', 100, '{"citizenship":"permanent_resident"}'),
    (c4, 'identity', 'deceased_register', 'xcentral', 'passed', 100, '{"on_register":false}');

  insert into public.identity_verifications
    (case_id, subject_id, id_type, id_last4, structure_valid, derived_date_of_birth, derived_gender, derived_citizenship, claimed_name, authority_name, name_match_score, authority_status)
  values
    (c1, s_thabo, 'sa_id', '9086', true, '1990-01-01', 'male', 'citizen', 'Thabo Mokoena', 'Thabo Mokoena', 100, 'match'),
    (c2, s_nandi, 'sa_id', '2088', true, '1988-03-15', 'female', 'citizen', 'Nandi Dlamini', 'Nandi Dlamini', 100, 'match');

  insert into public.credit_checks
    (case_id, subject_id, bureau_id, enquiry_type, purpose, score, band, risk, accounts_total, accounts_in_arrears, worst_arrears_months, monthly_debt_obligations_cents, defaults, status, reason_codes)
  values
    (c2, s_nandi, 'transunion_za', 'hard', 'lending', 601, 'Average', 'medium', 6, 1, 2, 412000, 1, 'completed', array['defaults_on_record']);

  insert into public.affordability_assessments
    (case_id, subject_id, gross_income_cents, statutory_deductions_cents, net_income_cents, income_verified, income_source,
     declared_expenses_cents, minimum_expenses_cents, applied_expenses_cents, existing_obligations_cents,
     proposed_instalment_cents, discretionary_income_cents, outcome, reason_codes)
  values
    (c2, s_nandi, 2800000, 520000, 2280000, true, 'Payslip — verified',
     900000, public.nca_minimum_expenses_cents(2280000), 900000, 412000,
     350000, 2280000 - 900000 - 412000 - 350000, 'marginal', array['thin_affordability_margin']);
end $$;

-- ── Webhook endpoints for the calling platforms ─────────────────
insert into public.webhook_endpoints (platform_id, url, secret, events) values
  ('biprapay',  'https://biprapay.com/api/hooks/xcentral',  'seed-secret-replace-me-biprapay',  array['case.decided']),
  ('xpayments', 'https://xpayments.co.za/api/hooks/xcentral','seed-secret-replace-me-xpayments', array['case.decided'])
on conflict do nothing;

-- ── Retention dry-run visibility ────────────────────────────────
insert into public.dsar_requests (id, request_type, requester_email, status, outcome_note) values
  ('DSAR-2026-0001', 'access',   'thabo.mokoena@example.co.za', 'completed', 'Full record exported and delivered'),
  ('DSAR-2026-0002', 'deletion', 'anon@example.co.za',          'in_progress', 'Awaiting FICA retention expiry on two documents')
on conflict (id) do nothing;

-- ── Keep the seeded scores honest ───────────────────────────────
-- The statuses above were chosen to illustrate each outcome; the
-- scores are whatever case_score() actually computes from the checks,
-- so the seed cannot drift from the scoring rules.
update public.verification_cases c
set score = (public.case_score(c.id)->>'score')::int;
