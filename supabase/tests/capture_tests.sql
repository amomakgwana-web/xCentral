-- ══════════════════════════════════════════════════════════════
-- Tests for live capture quality assessment and session progress.
--
--   psql -d xctest -v ON_ERROR_STOP=1 -f supabase/tests/capture_tests.sql
--
-- The agents themselves live in the edge function and are exercised by
-- the console; what is testable here is the quality gate they depend
-- on, and the session state machine that sequences the capture.
-- ══════════════════════════════════════════════════════════════

create or replace function public.expect(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — expected %, got %', label, want, got;
  end if;
  raise notice 'pass  %', label;
end $$;

-- ── Capture quality ────────────────────────────────────────────
do $$
declare r jsonb;
begin
  -- A good selfie: sharp, well lit, one face filling the frame.
  r := public.assess_capture_quality('selfie', 320, 55, 28, 1280, 960, 1, 22.0);
  perform public.expect('a good selfie passes', (r->>'passed')::boolean, true);
  perform public.expect('  · and scores full marks', (r->>'score')::numeric, 100::numeric);

  -- Blurred: the single most common reason a capture is unusable.
  r := public.assess_capture_quality('selfie', 22, 55, 28, 1280, 960, 1, 22.0);
  perform public.expect('a blurred selfie fails', (r->>'passed')::boolean, false);
  perform public.expect('  · and says it is blurred',
    r->'reason_codes' @> '["image_too_blurred"]'::jsonb, true);
  perform public.expect('  · scoring well below the bar', (r->>'score')::numeric < 70, true);

  -- Blur is graded, not binary: barely soft must score above unusable.
  perform public.expect('blur is graded rather than binary',
    (public.assess_capture_quality('selfie', 70, 55, 28, 1280, 960, 1, 22.0)->>'score')::numeric
      > (public.assess_capture_quality('selfie', 10, 55, 28, 1280, 960, 1, 22.0)->>'score')::numeric,
    true);

  r := public.assess_capture_quality('selfie', 320, 12, 28, 1280, 960, 1, 22.0);
  perform public.expect('a dark selfie fails',
    r->'reason_codes' @> '["image_too_dark"]'::jsonb, true);

  r := public.assess_capture_quality('selfie', 320, 97, 28, 1280, 960, 1, 22.0);
  perform public.expect('an overexposed selfie fails',
    r->'reason_codes' @> '["image_overexposed"]'::jsonb, true);

  -- No face at all, and more than one face, are different problems.
  r := public.assess_capture_quality('selfie', 320, 55, 28, 1280, 960, 0, 0);
  perform public.expect('a selfie with no face fails',
    r->'reason_codes' @> '["no_face_detected"]'::jsonb, true);

  r := public.assess_capture_quality('selfie', 320, 55, 28, 1280, 960, 2, 22.0);
  perform public.expect('a selfie with two faces fails',
    r->'reason_codes' @> '["more_than_one_face"]'::jsonb, true);

  r := public.assess_capture_quality('selfie', 320, 55, 28, 1280, 960, 1, 3.0);
  perform public.expect('a face too small in frame fails',
    r->'reason_codes' @> '["face_too_small_in_frame"]'::jsonb, true);

  r := public.assess_capture_quality('selfie', 320, 55, 28, 200, 200, 1, 22.0);
  perform public.expect('a low-resolution selfie fails',
    r->'reason_codes' @> '["resolution_too_low"]'::jsonb, true);

  -- A browser without the Shape Detection API is a capability gap, not
  -- a bad photograph. It must lower confidence and be recorded, but it
  -- must never block — otherwise no such browser could take a selfie
  -- at all.
  r := public.assess_capture_quality('selfie', 320, 55, 28, 1280, 960, null, null);
  perform public.expect('a missing face detector does not block the capture',
    (r->>'passed')::boolean, true);
  perform public.expect('  · but is recorded as an advisory',
    r->'advisories' @> '["face_detection_unavailable"]'::jsonb, true);
  perform public.expect('  · and lowers the score',
    (r->>'score')::numeric < 100, true);
  perform public.expect('  · without being read as an absent face',
    r->'reason_codes' @> '["no_face_detected"]'::jsonb, false);

  -- An actually absent face still blocks.
  perform public.expect('a genuinely absent face still blocks',
    (public.assess_capture_quality('selfie', 320, 55, 28, 1280, 960, 0, 0)->>'passed')::boolean,
    false);

  -- A document has no face requirement but a higher resolution bar.
  r := public.assess_capture_quality('document_front', 300, 55, 30, 1600, 1000, null, null);
  perform public.expect('a good document scan passes', (r->>'passed')::boolean, true);

  r := public.assess_capture_quality('document_front', 300, 55, 6, 1600, 1000, null, null);
  perform public.expect('a low-contrast document is flagged',
    r->'reason_codes' @> '["low_contrast"]'::jsonb, true);

  -- The portrait cropped from a document is small by nature, so it is
  -- judged against its own, looser bar.
  perform public.expect('the document portrait has its own threshold',
    (public.assess_capture_quality('document_portrait', 55, 45, 25, 200, 260, 1, 40.0)->>'passed')::boolean,
    true);
  perform public.expect('  · which the selfie rule would have failed',
    (public.assess_capture_quality('selfie', 55, 45, 25, 200, 260, 1, 40.0)->>'passed')::boolean,
    false);

  perform public.expect('an unknown capture type is refused, not guessed',
    public.assess_capture_quality('not_a_type', 300, 55, 30, 1600, 1000, null, null)->>'passed',
    null);
end $$;

-- ── Session progress ───────────────────────────────────────────
do $$
declare
  s_id uuid; sess text := 'CS-TEST-000001'; r jsonb;
begin
  insert into public.client_platforms (id, name, environment)
  values ('test_capture', 'Test Capture Co', 'sandbox') on conflict (id) do nothing;

  insert into public.subjects (id_type, id_hash, id_last4, first_names, surname)
  values ('sa_id', 'capture-subject-1', '9086', 'Thabo', 'Mokoena') returning id into s_id;

  insert into public.capture_sessions (id, platform_id, subject_id, channel, required_steps)
  values (sess, 'test_capture', s_id, 'branch',
          array['consent','document','selfie','match']);

  r := public.complete_capture_step(sess, 'consent');
  perform public.expect('a step is recorded',
    r->'completed_steps' @> '["consent"]'::jsonb, true);
  perform public.expect('  · and the rest are still outstanding',
    jsonb_array_length(r->'outstanding_steps'), 3);
  perform public.expect('  · so it is not ready to adjudicate',
    (r->>'ready_to_adjudicate')::boolean, false);

  perform public.complete_capture_step(sess, 'document');
  perform public.complete_capture_step(sess, 'selfie');
  r := public.complete_capture_step(sess, 'match');

  perform public.expect('the last step makes it ready',
    (r->>'ready_to_adjudicate')::boolean, true);
  perform public.expect('  · and the session moves to adjudicating',
    (select status from public.capture_sessions where id = sess), 'adjudicating');

  -- Repeating a step must not duplicate it.
  r := public.complete_capture_step(sess, 'selfie');
  perform public.expect('repeating a step does not duplicate it',
    jsonb_array_length(r->'completed_steps'), 4);

  -- A closed session takes no further captures.
  update public.capture_sessions set status = 'approved' where id = sess;
  begin
    perform public.complete_capture_step(sess, 'document');
    raise exception 'FAIL a closed session should refuse further steps';
  exception when check_violation then
    raise notice 'pass  a closed session refuses further steps';
  end;
end $$;

-- ── Agents are registered and their remits are distinct ────────
do $$
begin
  perform public.expect('every agent is registered',
    (select count(*) from public.agents where active), 7::bigint);

  perform public.expect('the vetoing agents are the ones that should be',
    (select string_agg(id, ',' order by id) from public.agents where can_veto and active),
    'biometric_agent,compliance_agent,document_agent,fraud_agent,identity_agent');

  -- Affordability must not veto: a thin file is a reason to refer, not
  -- to declare the identity false.
  perform public.expect('affordability cannot veto an identity decision',
    (select can_veto from public.agents where id = 'affordability_agent'), false);

  -- The shipped agents are deterministic, not model-backed. This is
  -- asserted so that adding a model-backed agent is a visible change.
  perform public.expect('every shipped agent reasons by rules',
    (select count(*) from public.agents where active and reasoning <> 'rules'), 0::bigint);

  perform public.expect('each agent owns a distinct domain',
    (select count(distinct domain) from public.agents where active), 7::bigint);
end $$;

-- ── Document forensics score the way the browser scores ────────
-- The same findings have to produce the same verdict on both sides of
-- the provider interface, or a document examined in the page and the
-- same document examined by the pipeline disagree about whether it is
-- genuine.
do $$
declare r record;
begin
  select * into r from public.score_document_forensics(array[]::text[]);
  perform public.expect('a document with no findings scores 100', r.score, 100);
  perform public.expect('and passes', r.status, 'passed');

  -- One weak finding is not a document problem. Refusing on it would
  -- turn every poorly lit photograph into a fraud allegation.
  select * into r from public.score_document_forensics(array['doc_geometry_wrong']);
  perform public.expect('a single weak finding still passes', r.status, 'passed');

  -- A failed check digit settles it on its own, whatever else is true,
  -- because it is arithmetic rather than inference: the data on the
  -- document does not agree with itself.
  select * into r from public.score_document_forensics(array['doc_mrz_check_digit_failed']);
  perform public.expect('a failed check digit is decisive', r.decisive, true);
  perform public.expect('and fails the document', r.status, 'failed');

  -- Three substitution signals together are what a pasted photograph
  -- looks like, and no one of them would have been enough.
  select * into r from public.score_document_forensics(
    array['portrait_noise_mismatch', 'portrait_edge_step', 'portrait_error_level_mismatch']);
  perform public.expect('three substitution signals fail the document', r.status, 'failed');
  perform public.expect('two of them are critical', r.critical_count, 2);

  -- A finding that is not a registered rule cannot silently cost a
  -- document anything.
  select * into r from public.score_document_forensics(array['not_a_rule_anyone_registered']);
  perform public.expect('an unknown finding deducts nothing', r.score, 100);

  perform public.expect('exactly one forensic rule is decisive on its own',
    (select count(*) from public.document_forensic_rules where decisive and active), 1::bigint);

  -- Every document type the console offers has to have its
  -- expectations on file, or the forensics run the wrong checks on it.
  perform public.expect('every identity document type declares its security features',
    (select count(*) from public.document_types t
      where t.category = 'identity' and t.active
        and not exists (select 1 from public.document_security_features f where f.doc_type = t.id)),
    0::bigint);

  -- A green book has no machine-readable zone, and failing it for not
  -- having one would be the system inventing a defect.
  perform public.expect('the green ID book is not expected to carry a machine-readable zone',
    (select mrz from public.document_security_features where doc_type = 'sa_id_book'), false);
  perform public.expect('the smart card is',
    (select mrz from public.document_security_features where doc_type = 'sa_id_card'), true);
end $$;

do $$ begin raise notice '───────────  ALL CAPTURE TESTS PASSED  ───────────'; end $$;
