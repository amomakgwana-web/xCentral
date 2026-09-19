// ══════════════════════════════════════════════════════════════
// Screening, capacity, and the platform's own traffic.
//
// The fraud signals here are not written down. Each is produced by the
// same rule the engine runs — a query over records already generated —
// so a file lights up because of what is on it, and changing a record
// changes what fires. That is the only version of this worth showing:
// a fraud page whose contents were typed in proves nothing.
// ══════════════════════════════════════════════════════════════

import {
  NOW, daysAgo, monthsAgo, addMonths, iso, isoDate, tag, PLATFORMS, PREFIX,
} from './generate.js';

import { fraud_rules } from './reference.js';
import { paymentBehaviour, assessCapacity } from './compute.js';

export function buildPlatform(ctx) {
  const { t, people, R, staffBy, SHARED_ACCOUNT, SHARED_PAYSLIP } = ctx;
  const rule = (code) => fraud_rules.find((r) => r.code === code && r.active);

  // Indexes, so linkage is a lookup rather than a scan per person.
  const byAccountHash = new Map();
  for (const b of t.bank_accounts) {
    if (!byAccountHash.has(b.account_hash)) byAccountHash.set(b.account_hash, new Set());
    byAccountHash.get(b.account_hash).add(b.subject_id);
  }
  const byAddressHash = new Map();
  for (const a of t.addresses) {
    if (!byAddressHash.has(a.address_hash)) byAddressHash.set(a.address_hash, new Set());
    byAddressHash.get(a.address_hash).add(a.subject_id);
  }
  const byMsisdnHash = new Map();
  for (const ph of t.phone_numbers) {
    if (!byMsisdnHash.has(ph.msisdn_hash)) byMsisdnHash.set(ph.msisdn_hash, new Set());
    byMsisdnHash.get(ph.msisdn_hash).add(ph.subject_id);
  }
  const byDocHash = new Map();
  for (const d of t.documents) {
    if (!byDocHash.has(d.sha256)) byDocHash.set(d.sha256, new Set());
    byDocHash.get(d.sha256).add(d.subject_id);
  }

  const scheduleByContract = new Map();
  for (const s of t.payment_schedule) {
    if (!scheduleByContract.has(s.contract_id)) scheduleByContract.set(s.contract_id, []);
    scheduleByContract.get(s.contract_id).push(s);
  }
  const paymentsByCustomer = new Map();
  for (const p of t.payments) {
    if (!paymentsByCustomer.has(p.customer_id)) paymentsByCustomer.set(p.customer_id, []);
    paymentsByCustomer.get(p.customer_id).push(p);
  }
  const contractsByCustomer = new Map();
  for (const c of t.contracts) {
    if (!contractsByCustomer.has(c.customer_id)) contractsByCustomer.set(c.customer_id, []);
    contractsByCustomer.get(c.customer_id).push(c);
  }

  // ══════════════════════════════════════════════════════════
  // 7 · The fraud screen
  // ══════════════════════════════════════════════════════════
  for (const p of people) {
    const signals = [];
    const add = (code, detail) => {
      const r = rule(code);
      if (!r) return;
      signals.push({
        id: `fs_${t.fraud_signals.length + signals.length + 1}`,
        rule_code: code,
        case_id: p.caseId,
        customer_id: p.customerId,
        subject_id: p.subjectId,
        contract_id: p.contractId ?? null,
        severity: r.severity,
        weight: r.weight,
        detail,
        dismissed: false,
        dismissed_by: null,
        dismissed_reason: null,
        created_at: iso(daysAgo(R.int(1, 200))),
      });
    };

    // ── Address ──────────────────────────────────────────────
    for (const a of t.addresses.filter((x) => x.subject_id === p.subjectId)) {
      const shared = (byAddressHash.get(a.address_hash)?.size ?? 1) - 1;
      if (shared >= 4) add('address_shared_by_many', { address_id: a.id, shared_with: shared, threshold: 4 });
      const av = t.address_verifications.find((v) => v.address_id === a.id);
      if (av && av.document_in_subject_name === false) add('address_not_in_subject_name', { address_id: a.id });
    }

    // ── Phone ────────────────────────────────────────────────
    for (const ph of t.phone_numbers.filter((x) => x.subject_id === p.subjectId)) {
      const shared = (byMsisdnHash.get(ph.msisdn_hash)?.size ?? 1) - 1;
      if (shared >= 1) add('phone_shared_across_identities', { phone_id: ph.id, shared_with: shared });
      const pv = t.phone_verifications.find((v) => v.phone_id === ph.id);
      if (pv?.rica_status === 'registered_to_other') {
        add('phone_not_registered_to_subject', { phone_id: ph.id, registered_name: pv.registered_name });
      }
      if (pv?.days_since_sim_swap !== null && pv?.days_since_sim_swap !== undefined && pv.days_since_sim_swap <= 30) {
        add('recent_sim_swap', { phone_id: ph.id, days_since_sim_swap: pv.days_since_sim_swap });
      }
    }

    // ── Banking ──────────────────────────────────────────────
    for (const b of t.bank_accounts.filter((x) => x.subject_id === p.subjectId)) {
      const shared = (byAccountHash.get(b.account_hash)?.size ?? 1) - 1;
      if (shared >= 1) add('bank_account_shared', { account_id: b.id, shared_with: shared });
      if (b.avs_status === 'name_mismatch') {
        add('bank_account_name_mismatch', { account_id: b.id, holder: b.account_holder_name });
      }
    }

    // ── Documents ────────────────────────────────────────────
    for (const d of t.documents.filter((x) => x.subject_id === p.subjectId)) {
      const shared = (byDocHash.get(d.sha256)?.size ?? 1) - 1;
      if (shared >= 1) add('doc_reused_across_identities', { document_id: d.id, shared_with: shared });
      const dv = t.document_verifications.find((v) => v.document_id === d.id);
      if (!dv) continue;
      if (dv.mrz_present && dv.mrz_valid === false) add('doc_mrz_failed', { document_id: d.id });
      if (dv.expired) add('doc_expired', { document_id: d.id, expiry: dv.date_of_expiry });
      if ((dv.tamper_signals ?? []).some((x) => x.severity === 'critical')) {
        add('doc_tamper_critical', { document_id: d.id, signals: dv.tamper_signals });
      }
    }

    // ── Employment ───────────────────────────────────────────
    for (const er of t.employment_records.filter((x) => x.subject_id === p.subjectId)) {
      const employer = t.employers.find((e) => e.id === er.employer_id);
      const ev = t.employment_verifications.find((v) => v.employment_id === er.id);
      if (employer?.flagged) add('employer_flagged', { employer_id: employer.id, name: employer.name });
      if (employer?.cipc_status === 'not_found') add('employer_not_at_cipc', { employer_id: employer.id });
      if (ev && ev.payslip_arithmetic_ok === false) add('payslip_arithmetic_failed', { employment_id: er.id });
      if (ev && Math.abs(ev.income_variance_pct ?? 0) >= 25) {
        add('income_variance_high', { employment_id: er.id, variance_pct: ev.income_variance_pct });
      }
    }

    // ── Identity ─────────────────────────────────────────────
    const iv = t.identity_verifications.find((v) => v.subject_id === p.subjectId);
    const subject = t.subjects.find((s) => s.id === p.subjectId);
    if (iv && (iv.authority_status === 'no_match' || (iv.name_match_score ?? 100) < 70)) {
      add('id_mismatch_document_vs_claim', {
        claimed_name: iv.claimed_name, authority_name: iv.authority_name,
        name_match_score: iv.name_match_score,
      });
    }
    if (iv && subject && iv.derived_date_of_birth !== subject.date_of_birth) {
      add('dob_inconsistent', {
        derived_date_of_birth: iv.derived_date_of_birth,
        subject_date_of_birth: subject.date_of_birth,
      });
    }

    // ── Asset and payment ────────────────────────────────────
    for (const c of contractsByCustomer.get(p.customerId) ?? []) {
      const asset = t.assets.find((a) => a.id === c.asset_id);
      if (asset && ['encumbered', 'stolen', 'not_found', 'mismatch'].includes(asset.registry_status)) {
        add('asset_registry_adverse', { asset_id: asset.id, registry_status: asset.registry_status });
      }
      const sched = scheduleByContract.get(c.id) ?? [];
      const first = sched.find((s) => s.instalment_no === 1);
      if (first && first.due_date <= isoDate(NOW) && first.amount_paid_cents === 0) {
        add('first_payment_default', { contract_id: c.id });
      }
    }

    // ── Composite ────────────────────────────────────────────
    let score = signals.reduce((s, x) => s + Number(x.weight), 0);
    score = Math.min(Math.round(score), 100);
    const critical = signals.filter((x) => x.severity === 'critical').length;

    const severity = critical >= 2 || score >= 70 ? 'critical'
      : critical === 1 || score >= 45 ? 'high'
      : score >= 20 ? 'medium' : 'low';

    t.fraud_signals.push(...signals);
    p.fraudScore = score;

    // An alert is raised for anything a person should look at. Below
    // that the signals still exist and are queryable; they simply do
    // not interrupt anyone.
    if (signals.length && ['medium', 'high', 'critical'].includes(severity)) {
      const status = severity === 'critical'
        ? R.weighted([['investigating', 3], ['open', 4], ['confirmed_fraud', 1]])
        : R.weighted([['open', 6], ['investigating', 2], ['false_positive', 3], ['closed', 1]]);
      t.fraud_alerts.push({
        id: `fa_${t.fraud_alerts.length + 1}`,
        case_id: p.caseId,
        customer_id: p.customerId,
        subject_id: p.subjectId,
        platform_id: p.platform,
        score,
        severity,
        signal_count: signals.length,
        critical_count: critical,
        summary: `${signals.length} signal(s), ${critical} critical`,
        status,
        assigned_to: ['open', 'investigating'].includes(status) ? staffBy('fraud_analyst').id : null,
        resolved_by: ['false_positive', 'closed', 'confirmed_fraud'].includes(status) ? staffBy('fraud_analyst').id : null,
        resolved_at: ['false_positive', 'closed', 'confirmed_fraud'].includes(status)
          ? iso(daysAgo(R.int(1, 90))) : null,
        resolution_note: status === 'false_positive'
          ? 'Shared address is a residential complex; both parties verified independently. Cleared.'
          : status === 'confirmed_fraud'
            ? 'Confirmed. Identifiers written to the register and the agreement cancelled.'
            : status === 'investigating'
              ? 'Assigned to the fraud desk. Bank confirmed the account is not in the applicant’s name; awaiting the employer’s response.'
              : null,
        created_at: iso(daysAgo(R.int(1, 210))),
      });
    }
  }

  // Confirming fraud writes the identifiers to a register, so the next
  // application carrying one of them is caught at the door.
  const confirmed = t.fraud_alerts.filter((a) => a.status === 'confirmed_fraud');
  for (const a of confirmed) {
    const person = people.find((p) => p.subjectId === a.subject_id);
    if (!person) continue;
    for (const [type, value] of [
      ['account_hash', t.bank_accounts.find((b) => b.subject_id === a.subject_id)?.account_hash],
      ['msisdn_hash', t.phone_numbers.find((b) => b.subject_id === a.subject_id)?.msisdn_hash],
      ['address_hash', t.addresses.find((b) => b.subject_id === a.subject_id)?.address_hash],
    ]) {
      if (!value) continue;
      t.known_fraud_register.push({
        id: `kf_${t.known_fraud_register.length + 1}`,
        entity_type: type,
        entity_value: value,
        reason: 'Confirmed on an investigated alert',
        source_alert_id: a.id,
        confirmed_by: staffBy('fraud_analyst').id,
        confirmed_at: a.resolved_at,
        expires_at: null,
        active: true,
      });
    }
  }

  // Historical entries, from cases confirmed before this book starts.
  // A register that only holds what happened this quarter cannot catch
  // anything, which is the entire reason for keeping one.
  const HIST_REASONS = [
    'Account received proceeds on three files in different names',
    'Address used on a syndicate of applications',
    'Number presented on two identities within a week',
    'Identity document altered and re-submitted',
    'Employer named on files with fabricated payslips',
  ];
  while (t.known_fraud_register.length < 220) {
    const n = t.known_fraud_register.length;
    const type = R.pick(['account_hash', 'msisdn_hash', 'address_hash', 'document_sha256', 'employer_id', 'device_id']);
    const confirmedAt = daysAgo(R.int(120, 1500));
    t.known_fraud_register.push({
      id: `kf_${n + 1}`,
      entity_type: type,
      entity_value: tag(type, `historical-${n}`),
      reason: R.pick(HIST_REASONS),
      source_alert_id: null,
      confirmed_by: staffBy('fraud_analyst').id,
      confirmed_at: iso(confirmedAt),
      // Some entries lapse. A register nobody ever removes anything
      // from stops being evidence and becomes a grudge.
      expires_at: R.chance(0.2) ? iso(new Date(confirmedAt.getTime() + 1095 * 86400000)) : null,
      active: R.chance(0.9),
    });
  }

  // ══════════════════════════════════════════════════════════
  // 8 · Credit capacity
  // ══════════════════════════════════════════════════════════
  // How much can be given, worked out rather than typed in: the
  // weakest of affordability, bureau, behaviour and existing exposure
  // governs, and an open critical signal stops the assessment.
  for (const p of people) {
    if (!p.customerId || !p.affordability) continue;
    const customer = t.customers.find((c) => c.id === p.customerId);
    const contracts = contractsByCustomer.get(p.customerId) ?? [];
    const schedules = {};
    for (const c of contracts) schedules[c.id] = scheduleByContract.get(c.id) ?? [];
    const behaviour = paymentBehaviour({
      contracts, schedules, payments: paymentsByCustomer.get(p.customerId) ?? [],
    });

    const agreementType = contracts[0]?.agreement_type ?? 'unsecured_credit';
    const term = contracts[0]?.term_months ?? 36;
    const rate = Number(contracts[0]?.interest_rate_pct ?? 18.5);

    const r = assessCapacity({
      customer, agreementType, termMonths: term, ratePct: rate,
      affordability: p.affordability, bureau: p.bureau, behaviour,
      fraudScore: p.fraudScore ?? 0, contracts,
    });
    if (r.decision === 'insufficient_data') continue;

    t.credit_assessments.push({
      id: `cas_${t.credit_assessments.length + 1}`,
      customer_id: p.customerId,
      case_id: p.caseId,
      policy_id: null,
      agreement_type: agreementType,
      assessed_on: isoDate(NOW),
      net_income_cents: r.net_income_cents ?? null,
      discretionary_income_cents: r.discretionary_income_cents ?? null,
      existing_instalments_cents: r.existing_instalments_cents ?? 0,
      existing_exposure_cents: r.existing_exposure_cents ?? 0,
      bureau_score: r.bureau_score ?? null,
      bureau_band: r.bureau_band ?? null,
      behaviour_score: r.behaviour_score ?? null,
      fraud_score: r.fraud_score ?? 0,
      max_instalment_cents: r.max_instalment_cents ?? 0,
      max_principal_cents: r.max_principal_cents ?? 0,
      recommended_limit_cents: r.recommended_limit_cents ?? 0,
      assumed_rate_pct: r.assumed_rate_pct ?? rate,
      assumed_term_months: r.assumed_term_months ?? term,
      risk_grade: r.risk_grade,
      decision: r.decision,
      reason_codes: r.reason_codes ?? [],
      workings: r.workings ?? {},
      assessed_by: null,
      created_at: iso(NOW),
    });
  }

  // ══════════════════════════════════════════════════════════
  // 9 · API keys, traffic and webhooks
  // ══════════════════════════════════════════════════════════
  const callers = PLATFORMS.filter((p) => p.id !== 'xcentral_console');
  const KEY_NAMES = [
    'Onboarding worker', 'Batch KYC refresh', 'Lending origination', 'Collections read-only',
    'Account opening', 'Age gate', 'Fraud screen', 'Document intake', 'Webhook replay',
  ];
  // Keys are rotated on a quarterly cycle, and the revoked ones are
  // kept: which key was live when a call was made is exactly the sort
  // of thing an incident review needs.
  for (const plat of callers) {
    for (let q = 0; q < 44; q++) {
      const monthsBack = q * 3;
      const revoked = q > 0;
      t.api_keys.push({
        id: `ak_${t.api_keys.length + 1}`,
        platform_id: plat.id,
        name: `${R.pick(KEY_NAMES)} — ${isoDate(monthsAgo(monthsBack)).slice(0, 7)}`,
        key_prefix: `xck_${PREFIX[plat.id].toLowerCase()}`,
        key_last4: tag('key', `${plat.id}|${q}`).slice(-4),
        key_hash: tag('keyhash', `${plat.id}|${q}`),
        environment: 'sandbox',
        scopes: plat.domains,
        rate_limit_per_min: R.pick([60, 120, 240, 300, 600]),
        last_used_at: revoked ? iso(monthsAgo(monthsBack)) : iso(daysAgo(R.int(0, 2))),
        expires_at: iso(addMonths(monthsAgo(monthsBack), 12)),
        revoked_at: revoked ? iso(monthsAgo(monthsBack - 3)) : null,
        revoked_by: null,
        created_by: null,
        created_at: iso(monthsAgo(monthsBack)),
      });
    }
  }
  const liveKeys = t.api_keys.filter((k) => !k.revoked_at);

  const ENDPOINTS = [
    ['/verify-identity', 200, null, 180, 30],
    ['/verify-document', 200, null, 640, 20],
    ['/verify-biometric', 200, null, 520, 14],
    ['/verify-credit', 200, null, 910, 12],
    ['/case-decision', 200, null, 90, 8],
    ['/platform-verify', 200, null, 240, 10],
    ['/verify-identity', 422, 'invalid_id_number', 60, 3],
    ['/verify-credit', 403, 'consent_not_granted', 45, 2],
    ['/verify-document', 413, 'file_too_large', 30, 1],
    ['/verify-biometric', 429, 'rate_limit_exceeded', 12, 1],
    ['/verify-credit', 502, 'bureau_unavailable', 3100, 1],
  ];
  for (let i = 0; i < 820; i++) {
    const key = R.pick(liveKeys);
    const [endpoint, code, err, base] = R.weighted(ENDPOINTS.map((e) => [e, e[4]]));
    t.api_requests.push({
      id: `req_${i + 1}`,
      api_key_id: key.id,
      platform_id: key.platform_id,
      endpoint,
      method: 'POST',
      case_id: i % 7 === 0 ? R.pick(t.verification_cases).id : null,
      status_code: code,
      error_code: err,
      ip: `196.${R.int(10, 49)}.${R.int(1, 200)}.${R.int(2, 60)}`,
      latency_ms: base + R.int(0, 420),
      created_at: iso(new Date(NOW.getTime() - i * 23 * 60000)),
    });
  }

  for (const plat of callers) {
    t.webhook_endpoints.push({
      id: `we_${t.webhook_endpoints.length + 1}`,
      platform_id: plat.id,
      url: `https://${plat.id}.example.co.za/hooks/xcentral`,
      secret: null,
      events: ['case.decided', 'fraud.alert'],
      active: true,
      created_at: iso(monthsAgo(R.int(6, 30))),
    });
  }

  const decidedCases = t.verification_cases.filter((c) => c.decided_at);
  for (let i = 0; i < Math.min(340, decidedCases.length); i++) {
    const c = decidedCases[i];
    const ep = t.webhook_endpoints.find((e) => e.platform_id === c.platform_id);
    if (!ep) continue;
    const [status, attempts, respCode, body] = R.weighted([
      [['delivered', 1, 200, '{"ok":true}'], 16],
      [['delivered', 3, 200, '{"ok":true}'], 2],
      [['pending', 2, 503, 'upstream temporarily unavailable'], 1],
      [['exhausted', 6, 500, 'handler raised: NullReferenceException'], 1],
    ]);
    t.webhook_deliveries.push({
      id: `wd_${t.webhook_deliveries.length + 1}`,
      endpoint_id: ep.id,
      event: 'case.decided',
      case_id: c.id,
      payload: { event: 'case.decided', case_id: c.id, status: c.status, risk: c.risk },
      status,
      attempts,
      response_code: respCode,
      response_body: body,
      next_attempt_at: status === 'pending' ? iso(new Date(NOW.getTime() + 360000)) : null,
      delivered_at: status === 'delivered' ? iso(new Date(new Date(c.decided_at).getTime() + 4000)) : null,
      created_at: iso(new Date(new Date(c.decided_at).getTime() + 2000)),
    });
  }

  // ══════════════════════════════════════════════════════════
  // 10 · Audit trail
  // ══════════════════════════════════════════════════════════
  // Append-only. actor_id is null throughout because these are the
  // calling platforms and scheduled jobs acting, not a signed-in
  // person: staff profiles are created when a real person signs up.
  const audit = (platform, action, entityType, entityId, metadata, at, actorId = null) => {
    t.audit_log.push({
      id: `aud_${t.audit_log.length + 1}`,
      actor_id: actorId,
      actor_platform: platform,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
      created_at: iso(at),
    });
  };

  for (const c of t.verification_cases) {
    audit(c.platform_id, 'case.created', 'verification_case', c.id,
      { purpose: c.purpose, level: c.level }, new Date(c.created_at));
    if (c.decided_at) {
      audit(c.platform_id, 'case.decided', 'verification_case', c.id,
        { status: c.status, risk: c.risk }, new Date(c.decided_at), c.decided_by);
    }
  }
  for (const co of t.consents) {
    audit(co.platform_id, 'consent.granted', 'consent', co.id, {
      purpose: co.purpose, lawful_basis: co.lawful_basis,
      special_personal_information: co.special_personal_information,
    }, new Date(co.granted_at));
  }
  for (const ct of t.contracts) {
    audit(ct.platform_id, 'contract.activated', 'contract', ct.id, {
      principal_cents: ct.principal_cents, instalment_cents: ct.instalment_cents,
      term_months: ct.term_months, agreement_type: ct.agreement_type,
    }, new Date(ct.created_at));
  }
  for (const a of t.fraud_alerts) {
    audit(a.platform_id, 'fraud.alert_raised', 'fraud_alert', a.id, {
      score: a.score, severity: a.severity, signal_count: a.signal_count,
    }, new Date(a.created_at));
  }
  // Reading a document is the event that matters most: it is the only
  // path to the image, and it is written before the signed URL exists.
  for (const d of t.documents) {
    if (!['sa_id_card', 'bank_statement'].includes(d.doc_type)) continue;
    if (!R.chance(0.28)) continue;
    const c = t.verification_cases.find((x) => x.id === d.case_id);
    audit(c?.platform_id ?? null, 'document.accessed', 'document', d.id, {
      doc_type: d.doc_type, reason: 'FICA file review', url_ttl_seconds: 300,
    }, new Date(new Date(d.created_at).getTime() + 3 * 86400000), staffBy('compliance').id);
  }
  for (let i = 0; i < 24; i++) {
    audit(null, 'retention.purge_run', 'job', 'retention-purge', {
      documents_examined: R.int(2800, 3600), documents_purged: R.int(0, 14),
      templates_expired: R.int(0, 9), dry_run: i % 4 === 0,
    }, daysAgo(i * 7 + 1));
  }
  t.audit_log.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // ══════════════════════════════════════════════════════════
  // 11 · Data subject requests
  // ══════════════════════════════════════════════════════════
  // POPIA sections 23, 24 and 11(2)(b). The thirty-day clock is on
  // due_at, and a refusal has to say which section it rests on.
  const DSAR_KINDS = [
    ['access', 'Full record exported and delivered as a signed PDF and a JSON export.'],
    ['correction', 'Applicant states the address on file is a previous address. Awaiting a municipal account for the current one before amending.'],
    ['deletion', 'Refused under POPIA section 14(1)(a): the record is subject to a five-year retention obligation under FICA section 22. Applicant notified of the reason and of the right to complain to the Information Regulator.'],
    ['objection', 'Objection to biometric processing. Verifying the requester’s identity before acting, since acting on an unverified request is itself a breach.'],
    ['portability', 'Requests a machine-readable export for transfer to another credit provider.'],
  ];
  for (let i = 0; i < 215; i++) {
    const p = R.pick(people);
    const [kind, note] = R.pick(DSAR_KINDS);
    const receivedAt = daysAgo(R.int(0, 300));
    const status = kind === 'deletion'
      ? R.weighted([['rejected', 5], ['in_progress', 2], ['completed', 1]])
      : R.weighted([['completed', 6], ['in_progress', 3], ['verifying', 2], ['received', 2], ['rejected', 1]]);
    t.dsar_requests.push({
      id: `DSAR-${NOW.getFullYear()}-${String(i + 1).padStart(4, '0')}`,
      subject_id: p.subjectId,
      requester_email: `${p.first.toLowerCase()}.${p.surname.toLowerCase().replace(/[^a-z]/g, '')}@example.co.za`,
      request_type: kind,
      status,
      received_at: iso(receivedAt),
      due_at: iso(new Date(receivedAt.getTime() + 30 * 86400000)),
      completed_at: status === 'completed' ? iso(new Date(receivedAt.getTime() + R.int(2, 26) * 86400000)) : null,
      outcome_note: note,
      export_path: status === 'completed' && kind === 'access' ? `exports/${p.key}.json` : null,
      handled_by: status === 'received' ? null : staffBy('compliance').id,
    });
  }

  // A withdrawn consent, so the register shows what withdrawal does.
  // POPIA section 11(2)(b): withdrawal is always available, and it
  // does not undo processing already lawfully done.
  const objections = t.dsar_requests.filter((d) => d.request_type === 'objection').slice(0, 60);
  for (const d of objections) {
    const c = t.consents.find((x) => x.subject_id === d.subject_id && x.purpose === 'biometric_processing');
    if (!c) continue;
    c.withdrawn_at = iso(new Date(new Date(d.received_at).getTime() + 2 * 86400000));
    c.withdrawal_reason = `Data subject objected to further biometric processing (${d.id})`;
  }

  return ctx;
}
