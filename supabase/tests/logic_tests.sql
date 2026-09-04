-- ══════════════════════════════════════════════════════════════
-- Tests for the arithmetic the hub does itself: SA ID validation,
-- name matching, NCA affordability, cosine similarity, and the
-- consent gates. Run against a scratch database seeded with
-- harness.sql plus every migration:
--
--   psql -d xctest -v ON_ERROR_STOP=1 -f supabase/tests/logic_tests.sql
--
-- Any failed expectation raises, so a clean run means a clean pass.
-- ══════════════════════════════════════════════════════════════

create or replace function public.expect(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — expected %, got %', label, want, got;
  end if;
  raise notice 'pass  %', label;
end $$;

do $$
declare v jsonb;
begin
  -- ── SA ID structure ──────────────────────────────────────────
  v := public.validate_sa_id('9001015009086');
  perform public.expect('valid SA ID accepted', (v->>'valid')::boolean, true);
  perform public.expect('  · date of birth decoded', v->>'date_of_birth', '1990-01-01');
  perform public.expect('  · gender decoded', v->>'gender', 'male');
  perform public.expect('  · citizenship decoded', v->>'citizenship', 'citizen');

  v := public.validate_sa_id('880315 0812 08 8');
  perform public.expect('spaces tolerated', (v->>'valid')::boolean, true);
  perform public.expect('  · female sequence decoded', v->>'gender', 'female');

  v := public.validate_sa_id('0507221234184');
  perform public.expect('permanent resident decoded', v->>'citizenship', 'permanent_resident');
  perform public.expect('  · 2000s birth year resolved', v->>'date_of_birth', '2005-07-22');

  -- A single transposed digit must break the checksum.
  v := public.validate_sa_id('9001015009087');
  perform public.expect('wrong check digit rejected', (v->>'valid')::boolean, false);
  perform public.expect('  · reason is the checksum', v->'reason_codes'->>0, 'checksum_failed');

  v := public.validate_sa_id('900101500908');
  perform public.expect('12 digits rejected', v->'reason_codes'->>0, 'id_length_invalid');

  v := public.validate_sa_id('9013015009083');
  perform public.expect('month 13 rejected', (v->>'valid')::boolean, false);

  v := public.validate_sa_id(null);
  perform public.expect('null rejected without error', (v->>'valid')::boolean, false);
end $$;

do $$
begin
  -- ── Name matching ────────────────────────────────────────────
  perform public.expect('identical names score 100',
    public.name_match_score('Thabo Mokoena', 'Thabo Mokoena'), 100::numeric);
  perform public.expect('name order ignored',
    public.name_match_score('Thabo Mokoena', 'Mokoena Thabo'), 100::numeric);
  perform public.expect('case and punctuation ignored',
    public.name_match_score('THABO  MOKOENA.', 'thabo mokoena'), 100::numeric);
  perform public.expect('accents folded',
    public.name_match_score('Renée Kühn', 'Renee Kuhn'), 100::numeric);
  perform public.expect('empty name scores zero',
    public.name_match_score('', 'Thabo Mokoena'), 0::numeric);

  if public.name_match_score('Thabo Mokoena', 'Sarah Naidoo') > 40 then
    raise exception 'FAIL unrelated names should score low, got %',
      public.name_match_score('Thabo Mokoena', 'Sarah Naidoo');
  end if;
  raise notice 'pass  unrelated names score low';

  -- A typo should stay recognisably close.
  if public.name_match_score('Thabo Mokoena', 'Thabo Mokoene') < 70 then
    raise exception 'FAIL single-letter typo should stay close, got %',
      public.name_match_score('Thabo Mokoena', 'Thabo Mokoene');
  end if;
  raise notice 'pass  single-letter typo stays close';
end $$;

do $$
declare v jsonb; e bigint;
begin
  -- ── NCA Regulation 23A minimum expenses ──────────────────────
  -- R500 income sits in the lowest band, which consumes all of it.
  perform public.expect('lowest band consumes all income',
    public.nca_minimum_expenses_cents(50000), 50000::bigint);

  -- R5 000 → R1 167.88 + 6.75% of (R5 000 − R800) = R1 167.88 + R283.50
  perform public.expect('R5 000 band computed',
    public.nca_minimum_expenses_cents(500000), 145138::bigint);

  -- R20 000 → R1 547.15 + 9% of (R20 000 − R6 250) = R1 547.15 + R1 237.50
  perform public.expect('R20 000 band computed',
    public.nca_minimum_expenses_cents(2000000), 278465::bigint);

  -- R60 000 → R5 299.02 + 6.75% of (R60 000 − R50 000) = R5 299.02 + R675.00
  perform public.expect('top band computed',
    public.nca_minimum_expenses_cents(6000000), 597402::bigint);

  perform public.expect('zero income yields zero minimum',
    public.nca_minimum_expenses_cents(0), 0::bigint);

  -- ── Affordability ────────────────────────────────────────────
  -- R30 000 gross, R6 000 deductions, R8 000 declared expenses,
  -- R3 000 existing debt, R2 500 proposed instalment.
  v := public.assess_affordability(3000000, 600000, 800000, 300000, 250000, true);
  perform public.expect('comfortable applicant is affordable', v->>'outcome', 'affordable');
  perform public.expect('  · net income computed', (v->>'net_income_cents')::bigint, 2400000::bigint);
  -- Declared R8 000 exceeds the R2 122.65 minimum for R24 000, so it governs.
  perform public.expect('  · declared expenses govern when above the minimum',
    (v->>'applied_expenses_cents')::bigint, 800000::bigint);
  perform public.expect('  · discretionary income computed',
    (v->>'discretionary_income_cents')::bigint, 1050000::bigint);

  -- Same applicant, instalment they plainly cannot carry.
  v := public.assess_affordability(3000000, 600000, 800000, 300000, 1500000, true);
  perform public.expect('over-large instalment is not affordable', v->>'outcome', 'not_affordable');

  -- Understated expenses must be lifted to the prescribed minimum.
  v := public.assess_affordability(2000000, 0, 10000, 0, 100000, true);
  e := public.nca_minimum_expenses_cents(2000000);
  perform public.expect('understated expenses lifted to the minimum',
    (v->>'applied_expenses_cents')::bigint, e);
  perform public.expect('  · and flagged',
    v->'reason_codes'->>0, 'declared_expenses_below_prescribed_minimum');

  -- Unverified income can never be better than marginal.
  v := public.assess_affordability(3000000, 600000, 800000, 300000, 250000, false);
  perform public.expect('unverified income caps at marginal', v->>'outcome', 'marginal');

  v := public.assess_affordability(0, 0, 0, 0, 100000, true);
  perform public.expect('no income is insufficient data', v->>'outcome', 'insufficient_data');

  v := public.assess_affordability(500000, 600000, 0, 0, 100000, true);
  perform public.expect('deductions above income are not affordable', v->>'outcome', 'not_affordable');
end $$;

do $$
declare s numeric;
begin
  -- ── Cosine similarity ────────────────────────────────────────
  perform public.expect('identical vectors match exactly',
    public.cosine_similarity(array[1,2,3]::real[], array[1,2,3]::real[]), 1::numeric);
  perform public.expect('scale is irrelevant to direction',
    public.cosine_similarity(array[1,2,3]::real[], array[2,4,6]::real[]), 1::numeric);
  perform public.expect('orthogonal vectors score zero',
    public.cosine_similarity(array[1,0]::real[], array[0,1]::real[]), 0::numeric);
  perform public.expect('opposed vectors score minus one',
    public.cosine_similarity(array[1,0]::real[], array[-1,0]::real[]), -1::numeric);
  perform public.expect('a zero vector scores zero, not an error',
    public.cosine_similarity(array[0,0]::real[], array[1,1]::real[]), 0::numeric);

  begin
    s := public.cosine_similarity(array[1,2,3]::real[], array[1,2]::real[]);
    raise exception 'FAIL mismatched descriptor lengths should raise';
  exception when check_violation then
    raise notice 'pass  mismatched descriptor lengths refused';
  end;

  perform public.expect('face threshold resolves to its operating point',
    public.biometric_threshold('face'), 0.6800::numeric);
end $$;

-- ── Consent gates ──────────────────────────────────────────────
do $$
declare
  v_subject uuid;
  v_case text := 'VC-TEST-0001';
begin
  insert into public.client_platforms (id, name) values ('test_platform', 'Test Platform')
    on conflict (id) do nothing;

  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname)
  values ('sa_id', 'test-hash-consent-gate', '9086', 'Thabo', 'Mokoena')
  returning id into v_subject;

  insert into public.verification_cases (id, subject_id, platform_id, level)
  values (v_case, v_subject, 'test_platform', 'enhanced');

  -- Credit enquiry without consent must be refused by the database.
  begin
    insert into public.credit_checks (case_id, subject_id, bureau_id)
    values (v_case, v_subject, 'transunion_za');
    raise exception 'FAIL credit check without consent should have been refused';
  exception when check_violation then
    raise notice 'pass  credit enquiry without consent refused';
  end;

  -- Biometric enrolment without consent must be refused too.
  begin
    insert into public.biometric_templates (subject_id, modality, model_id, descriptor, descriptor_hash)
    values (v_subject, 'face', 'sim-face-v1',
            (select array_agg(0.1::real) from generate_series(1,128)), 'hash-a');
    raise exception 'FAIL biometric enrolment without consent should have been refused';
  exception when check_violation then
    raise notice 'pass  biometric enrolment without consent refused';
  end;

  -- POPIA s27: biometric consent cannot rest on legitimate interest.
  begin
    insert into public.consents (subject_id, purpose, lawful_basis)
    values (v_subject, 'biometric_processing', 'legitimate_interest');
    raise exception 'FAIL legitimate interest should not support biometric processing';
  exception when check_violation then
    raise notice 'pass  legitimate interest refused for biometric processing';
  end;

  -- With proper consent, both writes succeed.
  insert into public.consents (subject_id, purpose, lawful_basis)
  values (v_subject, 'credit_enquiry', 'consent');
  insert into public.consents (subject_id, purpose, lawful_basis)
  values (v_subject, 'biometric_processing', 'consent');

  perform public.expect('biometric consent auto-marked as special personal information',
    (select special_personal_information from public.consents
      where subject_id = v_subject and purpose = 'biometric_processing'), true);

  insert into public.credit_checks (case_id, subject_id, bureau_id)
  values (v_case, v_subject, 'transunion_za');
  raise notice 'pass  credit enquiry accepted with live consent';

  insert into public.biometric_templates (subject_id, modality, model_id, descriptor, descriptor_hash)
  values (v_subject, 'face', 'sim-face-v1',
          (select array_agg(0.1::real) from generate_series(1,128)), 'hash-a');
  raise notice 'pass  biometric enrolment accepted with live consent';

  -- A descriptor of the wrong length for the modality is refused.
  begin
    insert into public.biometric_templates (subject_id, modality, model_id, descriptor, descriptor_hash)
    values (v_subject, 'face', 'sim-face-v1', array[0.1,0.2]::real[], 'hash-b');
    raise exception 'FAIL short descriptor should have been refused';
  exception when check_violation then
    raise notice 'pass  wrong-length descriptor refused';
  end;

  -- A template from another model must not be storable under this modality.
  begin
    insert into public.biometric_templates (subject_id, modality, model_id, descriptor, descriptor_hash)
    values (v_subject, 'face', 'other-model-v9',
            (select array_agg(0.1::real) from generate_series(1,128)), 'hash-c');
    raise exception 'FAIL foreign model template should have been refused';
  exception when check_violation then
    raise notice 'pass  foreign-model template refused';
  end;

  -- Withdrawing consent closes the gate again.
  update public.consents set withdrawn_at = now()
  where subject_id = v_subject and purpose = 'biometric_processing';

  perform public.expect('withdrawn consent is no longer active',
    public.has_active_consent(v_subject, 'biometric_processing'), false);

  begin
    insert into public.biometric_templates (subject_id, modality, model_id, descriptor, descriptor_hash)
    values (v_subject, 'face', 'sim-face-v1',
            (select array_agg(0.2::real) from generate_series(1,128)), 'hash-d');
    raise exception 'FAIL enrolment after withdrawal should have been refused';
  exception when check_violation then
    raise notice 'pass  enrolment refused after consent withdrawal';
  end;

  -- An expired consent is equally inactive.
  update public.consents set withdrawn_at = null, expires_at = now() - interval '1 day'
  where subject_id = v_subject and purpose = 'biometric_processing';
  perform public.expect('expired consent is not active',
    public.has_active_consent(v_subject, 'biometric_processing'), false);
end $$;

-- ── Case scoring ───────────────────────────────────────────────
do $$
declare
  v_subject uuid;
  v_case text := 'VC-TEST-0002';
  v jsonb;
begin
  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname)
  values ('sa_id', 'test-hash-scoring', '1234', 'Nandi', 'Dlamini')
  returning id into v_subject;

  insert into public.verification_cases (id, subject_id, platform_id, level)
  values (v_case, v_subject, 'test_platform', 'basic');

  v := public.case_score(v_case);
  perform public.expect('a case with no checks is in progress', v->>'suggested_status', 'in_progress');
  perform public.expect('  · and lists all three basic checks as missing',
    jsonb_array_length(v->'missing_checks'), 3);

  insert into public.verification_checks (case_id, domain, check_type, status, score) values
    (v_case, 'identity', 'id_structure',        'passed', 100),
    (v_case, 'identity', 'deceased_register',   'passed', 100),
    (v_case, 'identity', 'watchlist_screening', 'passed', 100);

  v := public.case_score(v_case);
  perform public.expect('all checks passed yields a verified suggestion', v->>'suggested_status', 'verified');
  perform public.expect('  · with a full score', (v->>'score')::int, 100);

  -- A re-run supersedes rather than accumulating.
  insert into public.verification_checks (case_id, domain, check_type, status, score)
  values (v_case, 'identity', 'watchlist_screening', 'manual_review', 60);

  v := public.case_score(v_case);
  perform public.expect('a manual-review check sends the case to review', v->>'suggested_status', 'review');

  -- A failed required check is decisive regardless of the average.
  insert into public.verification_checks (case_id, domain, check_type, status, score)
  values (v_case, 'identity', 'id_structure', 'failed', 0);

  v := public.case_score(v_case);
  perform public.expect('a failed required check rejects the case', v->>'suggested_status', 'rejected');
  perform public.expect('  · and names the failure',
    v->'failed_checks'->>0, 'identity.id_structure');
end $$;

-- ── 1:N identification ─────────────────────────────────────────
do $$
declare
  v_a uuid; v_b uuid;
  hits int;
  top_similarity numeric;
begin
  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname)
  values ('sa_id', 'test-hash-bio-a', '1111', 'Lerato', 'Khumalo') returning id into v_a;
  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname)
  values ('sa_id', 'test-hash-bio-b', '2222', 'Sipho', 'Ndlovu') returning id into v_b;

  insert into public.consents (subject_id, purpose, lawful_basis) values
    (v_a, 'biometric_processing', 'consent'),
    (v_b, 'biometric_processing', 'consent');

  -- Two distinct enrolments: one all-ones, one alternating.
  insert into public.biometric_templates (subject_id, modality, model_id, descriptor, descriptor_hash)
  values (v_a, 'face', 'sim-face-v1',
          (select array_agg(1.0::real) from generate_series(1,128)), 'bio-a');
  insert into public.biometric_templates (subject_id, modality, model_id, descriptor, descriptor_hash)
  values (v_b, 'face', 'sim-face-v1',
          (select array_agg((case when i % 2 = 0 then 1.0 else -1.0 end)::real)
             from generate_series(1,128) i), 'bio-b');

  -- The sweep is global by design, so assert on this pair specifically
  -- rather than on the total, which earlier blocks also contribute to.
  select count(*) into hits
  from public.biometric_identify('face',
    (select array_agg(1.0::real) from generate_series(1,128)), 50) h
  where h.subject_id in (v_a, v_b);
  perform public.expect('identification reaches every enrolled template', hits, 2);

  -- Any descriptor pointing the same way scores 1, so assert on this
  -- subject's own score rather than on rank: other blocks in this file
  -- enrol collinear templates and would tie for first.
  select h.similarity into top_similarity
  from public.biometric_identify('face',
    (select array_agg(1.0::real) from generate_series(1,128)), 50) h
  where h.subject_id = v_a;
  perform public.expect('  · the matching subject scores a perfect 1', top_similarity, 1::numeric);

  -- The alternating descriptor is orthogonal to all-ones: half the
  -- dimensions agree and half oppose, so it must score zero.
  select h.similarity into top_similarity
  from public.biometric_identify('face',
    (select array_agg(1.0::real) from generate_series(1,128)), 50) h
  where h.subject_id = v_b;
  perform public.expect('  · an unrelated template scores zero', top_similarity, 0::numeric);
end $$;

do $$ begin raise notice '───────────────  ALL LOGIC TESTS PASSED  ───────────────'; end $$;
