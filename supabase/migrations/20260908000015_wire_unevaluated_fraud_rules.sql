-- ══════════════════════════════════════════════════════════════
-- Wire up the three fraud rules that were registered but never read.
--
-- fraud_rules has carried address_not_in_subject_name, dob_inconsistent
-- and id_mismatch_document_vs_claim since the engine shipped, each with
-- a description and a weight, and run_fraud_screen never evaluated any
-- of them. A rule listed on the fraud page that can never raise a
-- signal is worse than no rule: it reads as coverage that does not
-- exist.
--
-- All three are decidable from data already stored — address
-- verification records whether the proof of residence is in the
-- subject's name, and identity verification records both the name the
-- authority returned and the date of birth derived from the identity
-- number. Nothing new has to be collected.
--
-- run_fraud_screen is replaced whole rather than patched, because a
-- plpgsql body cannot be amended in place.
-- ══════════════════════════════════════════════════════════════

create or replace function public.run_fraud_screen(
  p_case_id text default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject uuid;
  v_platform text;
  r record;
  rule record;
  v_score numeric := 0;
  v_signals int := 0;
  v_critical int := 0;
  v_severity text;
  v_alert_id uuid;
  v_params jsonb;
begin
  if p_case_id is null and p_customer_id is null then
    raise exception 'run_fraud_screen needs a case id or a customer id';
  end if;

  -- Resolve the subject either way, since most rules are about the person.
  if p_case_id is not null then
    select subject_id, platform_id into v_subject, v_platform
    from public.verification_cases where id = p_case_id;
  else
    select subject_id, platform_id into v_subject, v_platform
    from public.customers where id = p_customer_id;
  end if;

  -- Clear prior undismissed signals for this screen so a re-run
  -- reflects current data rather than accumulating history. Dismissed
  -- ones survive: an investigator's judgement is not discarded.
  delete from public.fraud_signals
  where not dismissed
    and ((p_case_id is not null and case_id = p_case_id)
      or (p_customer_id is not null and customer_id = p_customer_id));

  -- ── Document rules ────────────────────────────────────────────
  for r in
    select d.id, d.sha256, d.doc_type, dv.expired, dv.date_of_issue, dv.date_of_expiry,
           dv.mrz_valid, dv.tamper_signals
    from public.documents d
    left join public.document_verifications dv on dv.document_id = d.id
    where (p_case_id is not null and d.case_id = p_case_id)
       or (v_subject is not null and d.subject_id = v_subject)
  loop
    -- Same bytes, different person.
    if exists (select 1 from public.detect_document_reuse(r.id)) then
      select * into rule from public.fraud_rules where code = 'doc_reused_across_identities' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('document_id', r.id, 'sha256', r.sha256,
            'also_submitted_for', (select jsonb_agg(jsonb_build_object(
                'subject_id', other_subject_id, 'case_id', other_case_id))
              from public.detect_document_reuse(r.id))));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        if rule.severity = 'critical' then v_critical := v_critical + 1; end if;
      end if;
    end if;

    -- Issued after it expires, or issued in the future.
    if (r.date_of_issue is not null and r.date_of_expiry is not null
        and r.date_of_issue > r.date_of_expiry)
       or (r.date_of_issue is not null and r.date_of_issue > current_date) then
      select * into rule from public.fraud_rules where code = 'doc_dates_impossible' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('document_id', r.id, 'date_of_issue', r.date_of_issue,
                             'date_of_expiry', r.date_of_expiry));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    if r.expired then
      select * into rule from public.fraud_rules where code = 'doc_expired' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('document_id', r.id, 'date_of_expiry', r.date_of_expiry));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
      end if;
    end if;

    if r.mrz_valid is false then
      select * into rule from public.fraud_rules where code = 'doc_mrz_failed' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('document_id', r.id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    if r.tamper_signals is not null and jsonb_typeof(r.tamper_signals) = 'array'
       and exists (select 1 from jsonb_array_elements(r.tamper_signals) t
                   where t->>'severity' = 'critical') then
      select * into rule from public.fraud_rules where code = 'doc_tamper_critical' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('document_id', r.id, 'signals', r.tamper_signals));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;
  end loop;

  -- ── Address ───────────────────────────────────────────────────
  for r in
    select a.id, a.address_hash, public.address_shared_count(a.id) as shared,
           -- The most recent verification of this address. A proof of
           -- residence in someone else's name is ordinary — a spouse,
           -- a parent, a landlord — and on its own it is a warning, not
           -- an accusation. It matters in combination.
           (select av.document_in_subject_name
              from public.address_verifications av
             where av.address_id = a.id
               and av.document_in_subject_name is not null
             order by av.created_at desc limit 1) as in_subject_name
    from public.addresses a
    where (p_customer_id is not null and a.customer_id = p_customer_id)
       or (v_subject is not null and a.subject_id = v_subject)
  loop
    select * into rule from public.fraud_rules where code = 'address_not_in_subject_name' and active;
    if found and r.in_subject_name is false then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('address_id', r.id));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
    end if;

    select * into rule from public.fraud_rules where code = 'address_shared_by_many' and active;
    if found and r.shared >= coalesce((rule.params->>'threshold')::int, 4) then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('address_id', r.id, 'shared_with', r.shared,
                           'threshold', (rule.params->>'threshold')::int));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
    end if;
  end loop;

  -- ── Phone ─────────────────────────────────────────────────────
  for r in
    select p.id, p.msisdn_hash, pv.rica_status, pv.days_since_sim_swap
    from public.phone_numbers p
    left join lateral (
      select * from public.phone_verifications v
      where v.phone_id = p.id order by v.created_at desc limit 1
    ) pv on true
    where (p_customer_id is not null and p.customer_id = p_customer_id)
       or (v_subject is not null and p.subject_id = v_subject)
  loop
    if exists (
      select 1 from public.phone_numbers p2
      where p2.msisdn_hash = r.msisdn_hash and p2.id <> r.id
        and p2.subject_id is distinct from v_subject and p2.subject_id is not null
    ) then
      select * into rule from public.fraud_rules where code = 'phone_shared_across_identities' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('phone_id', r.id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    select * into rule from public.fraud_rules where code = 'recent_sim_swap' and active;
    if found and r.days_since_sim_swap is not null
       and r.days_since_sim_swap <= coalesce((rule.params->>'max_days')::int, 30) then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('phone_id', r.id, 'days_since_sim_swap', r.days_since_sim_swap));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
      v_critical := v_critical + 1;
    end if;

    if r.rica_status = 'registered_to_other' then
      select * into rule from public.fraud_rules where code = 'phone_not_registered_to_subject' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('phone_id', r.id, 'rica_status', r.rica_status));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
      end if;
    end if;
  end loop;

  -- ── Employment ────────────────────────────────────────────────
  for r in
    select e.id, e.employer_id, emp.cipc_status, emp.flagged, emp.name,
           ev.payslip_arithmetic_ok, ev.income_variance_pct
    from public.employment_records e
    left join public.employers emp on emp.id = e.employer_id
    left join lateral (
      select * from public.employment_verifications v
      where v.employment_id = e.id order by v.created_at desc limit 1
    ) ev on true
    where (p_customer_id is not null and e.customer_id = p_customer_id)
       or (v_subject is not null and e.subject_id = v_subject)
  loop
    if r.payslip_arithmetic_ok is false then
      select * into rule from public.fraud_rules where code = 'payslip_arithmetic_failed' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('employment_id', r.id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    if r.cipc_status = 'not_found' then
      select * into rule from public.fraud_rules where code = 'employer_not_at_cipc' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('employment_id', r.id, 'employer', r.name));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
      end if;
    end if;

    if r.flagged then
      select * into rule from public.fraud_rules where code = 'employer_flagged' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('employment_id', r.id, 'employer', r.name));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    select * into rule from public.fraud_rules where code = 'income_variance_high' and active;
    if found and r.income_variance_pct is not null
       and abs(r.income_variance_pct) > coalesce((rule.params->>'max_variance_pct')::numeric, 20) then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('employment_id', r.id, 'variance_pct', r.income_variance_pct));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
    end if;
  end loop;

  -- ── Banking ───────────────────────────────────────────────────
  for r in
    select b.id, b.account_hash, b.avs_status
    from public.bank_accounts b
    where (p_customer_id is not null and b.customer_id = p_customer_id)
       or (v_subject is not null and b.subject_id = v_subject)
  loop
    if exists (
      select 1 from public.bank_accounts b2
      where b2.account_hash = r.account_hash and b2.id <> r.id
        and b2.subject_id is distinct from v_subject and b2.subject_id is not null
    ) then
      select * into rule from public.fraud_rules where code = 'bank_account_shared' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('bank_account_id', r.id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end if;

    if r.avs_status = 'name_mismatch' then
      select * into rule from public.fraud_rules where code = 'bank_account_name_mismatch' and active;
      if found then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('bank_account_id', r.id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
      end if;
    end if;
  end loop;

  -- ── Confirmed fraud register ──────────────────────────────────
  select * into rule from public.fraud_rules where code = 'known_fraud_hit' and active;
  if found and v_subject is not null then
    if exists (
      select 1 from public.known_fraud_register k
      where k.active and (
        (k.entity_type = 'id_hash' and k.entity_value =
          (select id_hash from public.subjects where id = v_subject))
        or (k.entity_type = 'msisdn_hash' and k.entity_value in
          (select msisdn_hash from public.phone_numbers where subject_id = v_subject))
        or (k.entity_type = 'address_hash' and k.entity_value in
          (select address_hash from public.addresses where subject_id = v_subject))
        or (k.entity_type = 'account_hash' and k.entity_value in
          (select account_hash from public.bank_accounts where subject_id = v_subject))
      )
    ) then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('matched', 'confirmed fraud register'));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
      v_critical := v_critical + 1;
    end if;
  end if;

  -- ── Velocity ──────────────────────────────────────────────────
  select * into rule from public.fraud_rules where code = 'application_velocity' and active;
  if found and v_subject is not null then
    declare v_recent int;
    begin
      select count(*) into v_recent
      from public.verification_cases
      where subject_id = v_subject
        and created_at > now() - make_interval(days => coalesce((rule.params->>'window_days')::int, 7));

      if v_recent >= coalesce((rule.params->>'threshold')::int, 3) then
        insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
          jsonb_build_object('applications', v_recent,
                             'window_days', (rule.params->>'window_days')::int));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
      end if;
    end;
  end if;

  -- ── Assets and payment behaviour ──────────────────────────────
  -- These attach to the customer's contracts rather than the identity.
  if p_customer_id is not null then
    for r in
      select ct.id as contract_id, ct.asset_id, a.vin, a.imei, a.registry_status
      from public.contracts ct
      left join public.assets a on a.id = ct.asset_id
      where ct.customer_id = p_customer_id
    loop
      -- The same physical unit already backing another live agreement.
      select * into rule from public.fraud_rules where code = 'asset_already_financed' and active;
      if found and r.asset_id is not null and exists (
        select 1 from public.contracts c2
        where c2.asset_id = r.asset_id
          and c2.id <> r.contract_id
          and c2.status in ('approved','active','in_arrears','defaulted','legal')
      ) then
        insert into public.fraud_signals
          (rule_code, case_id, customer_id, subject_id, contract_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, r.contract_id, rule.severity, rule.weight,
          jsonb_build_object('asset_id', r.asset_id, 'vin', r.vin, 'imei', r.imei));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;

      select * into rule from public.fraud_rules where code = 'asset_registry_adverse' and active;
      if found and r.registry_status in ('encumbered','stolen','not_found','mismatch') then
        insert into public.fraud_signals
          (rule_code, case_id, customer_id, subject_id, contract_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, r.contract_id, rule.severity, rule.weight,
          jsonb_build_object('asset_id', r.asset_id, 'registry_status', r.registry_status));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;

      -- Never paid the first instalment: the affordability was not real.
      select * into rule from public.fraud_rules where code = 'first_payment_default' and active;
      if found and exists (
        select 1 from public.payment_schedule s
        where s.contract_id = r.contract_id
          and s.instalment_no = 1
          and s.due_date < current_date
          and s.amount_paid_cents = 0
          and s.status <> 'waived'
      ) then
        insert into public.fraud_signals
          (rule_code, case_id, customer_id, subject_id, contract_id, severity, weight, detail)
        values (rule.code, p_case_id, p_customer_id, v_subject, r.contract_id, rule.severity, rule.weight,
          jsonb_build_object('contract_id', r.contract_id));
        v_score := v_score + rule.weight; v_signals := v_signals + 1;
        v_critical := v_critical + 1;
      end if;
    end loop;
  end if;

  -- ── Identity ──────────────────────────────────────────────────
  -- What the document says about this person against what they claimed
  -- and what the authority returned. Both of these are critical: an
  -- identity that does not agree with itself is the substrate of every
  -- other fraud in this table.
  for r in
    select iv.id, iv.case_id, iv.name_match_score, iv.authority_status,
           iv.claimed_name, iv.authority_name,
           iv.derived_date_of_birth, s.date_of_birth as subject_date_of_birth
    from public.identity_verifications iv
    join public.subjects s on s.id = iv.subject_id
    where iv.subject_id = v_subject
      and (p_case_id is null or iv.case_id = p_case_id)
  loop
    select * into rule from public.fraud_rules where code = 'id_mismatch_document_vs_claim' and active;
    if found and (
         r.authority_status = 'no_match'
      or (r.name_match_score is not null
          and r.name_match_score < coalesce((rule.params->>'min_name_match')::numeric, 70))
    ) then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('claimed_name', r.claimed_name,
                           'authority_name', r.authority_name,
                           'name_match_score', r.name_match_score,
                           'authority_status', r.authority_status));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
      v_critical := v_critical + 1;
    end if;

    -- The date of birth is carried in the identity number itself, so a
    -- disagreement with the subject record means one of the two was
    -- entered to match a document rather than a person.
    select * into rule from public.fraud_rules where code = 'dob_inconsistent' and active;
    if found and r.derived_date_of_birth is not null
       and r.subject_date_of_birth is not null
       and r.derived_date_of_birth <> r.subject_date_of_birth then
      insert into public.fraud_signals (rule_code, case_id, customer_id, subject_id, severity, weight, detail)
      values (rule.code, p_case_id, p_customer_id, v_subject, rule.severity, rule.weight,
        jsonb_build_object('derived_date_of_birth', r.derived_date_of_birth,
                           'subject_date_of_birth', r.subject_date_of_birth));
      v_score := v_score + rule.weight; v_signals := v_signals + 1;
      v_critical := v_critical + 1;
    end if;
  end loop;

  -- ── Composite ─────────────────────────────────────────────────
  v_score := least(round(v_score), 100);

  v_severity := case
    when v_critical >= 2 or v_score >= 70 then 'critical'
    when v_critical = 1 or v_score >= 45 then 'high'
    when v_score >= 20 then 'medium'
    else 'low' end;

  -- An alert is raised for anything a person should look at. Below
  -- that the signals still exist and are queryable; they just do not
  -- interrupt anyone.
  if v_signals > 0 and v_severity in ('medium','high','critical') then
    insert into public.fraud_alerts
      (case_id, customer_id, subject_id, platform_id, score, severity,
       signal_count, critical_count, summary)
    values (p_case_id, p_customer_id, v_subject, v_platform, v_score::int, v_severity,
            v_signals, v_critical,
            v_signals || ' signal(s), ' || v_critical || ' critical')
    returning id into v_alert_id;
  end if;

  return jsonb_build_object(
    'score', v_score::int,
    'severity', v_severity,
    'signals', v_signals,
    'critical', v_critical,
    'alert_id', v_alert_id,
    'signal_detail', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'rule', s.rule_code, 'severity', s.severity, 'detail', s.detail)), '[]'::jsonb)
      from public.fraud_signals s
      where not s.dismissed
        and ((p_case_id is not null and s.case_id = p_case_id)
          or (p_customer_id is not null and s.customer_id = p_customer_id))
    )
  );
end;
$$;

revoke execute on function public.run_fraud_screen(text, uuid) from public, anon;
grant execute on function public.run_fraud_screen(text, uuid) to service_role, authenticated;
