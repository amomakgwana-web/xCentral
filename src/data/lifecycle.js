// ══════════════════════════════════════════════════════════════
// What happens after someone is verified.
//
// Assets, agreements, the schedules they are chased against, the money
// that actually arrived, the counter sessions, what the agents made of
// them, the fraud screen, and the platform's own traffic and audit
// trail.
//
// The money here is not decoration. Instalments come from the
// amortisation formula, schedules from the reducing balance, arrears
// from comparing what fell due to what was paid, and behaviour from
// that record. A contract's status is whatever those figures make it,
// which is why the arrears book and the customer profiles agree.
// ══════════════════════════════════════════════════════════════

import {
  NOW, daysAgo, monthsAgo, addMonths, iso, isoDate, imei, instalmentCents, tag,
  VEHICLES, HANDSETS, OTHER_ASSETS, COLOURS, PLATFORMS, PREFIX,
} from './generate.js';

import { fraud_rules, agents as AGENTS } from './reference.js';

import {
  generateSchedule, allocatePayments, recomputeContract,
  paymentBehaviour, assessCapacity,
} from './compute.js';

const PAY_PATTERN = {
  strong: 'clean', clean: 'clean', late: 'late', slipping: 'slipping',
  arrears: 'arrears', default: 'nothing', settled: 'settled', thin: 'clean',
  fraud: 'nothing',
};

const AGREEMENT_FOR = {
  biprapay: 'instalment_sale', xpayments: 'instalment_sale',
  veribills: 'phone_contract', piggybag: 'instalment_sale', mysmme: 'instalment_sale',
};

export function buildLifecycle(ctx) {
  const { t, people, R, staffBy } = ctx;

  // ══════════════════════════════════════════════════════════
  // 5 · Assets and agreements
  // ══════════════════════════════════════════════════════════
  const vin = () => {
    const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'; // No I, O or Q, as the standard requires.
    let s = R.pick(['AHT', 'AAV', 'AFA', 'ADM', 'ADN', 'MAL', 'MZB', 'LVV', 'LGW', 'MA1', 'MAK']);
    while (s.length < 17) s += alphabet[R.int(0, alphabet.length - 1)];
    return s;
  };
  const plate = () => `${R.pick(['CA', 'CJ', 'CY', 'ND', 'GP', 'FS', 'LP', 'NW', 'MP', 'EC'])} ${R.int(10, 99)} ${R.pick(['ABC', 'JHB', 'KLM', 'PQR', 'TUV'])}`;

  for (const p of people) {
    const pattern = PAY_PATTERN[p.archetype];
    if (!pattern || !p.customerId) continue;

    const agreementType = AGREEMENT_FOR[p.platform];
    const isPhone = agreementType === 'phone_contract';
    const spec = isPhone ? R.pick(HANDSETS)
      : R.chance(0.06) ? R.pick(OTHER_ASSETS) : R.pick(VEHICLES);

    // The instalment has to land inside BOTH caps the lending policy
    // applies, not just the first one. Sizing against discretionary
    // income alone writes agreements that breach the debt-to-income
    // limit at origination — and then the capacity assessment, which
    // checks both, declines an A-grade customer for having no room,
    // which is true and reads as nonsense. A book has to be made of
    // agreements the policy would actually have approved.
    const netForDti = p.netCents;
    const discretionary = p.affordability?.discretionary_income_cents ?? Math.round(p.netCents * 0.2);
    const shareCap = Math.round(discretionary * 0.55);
    const dtiCap = Math.round(netForDti * 0.34);
    const room = Math.max(50000, Math.min(shareCap, dtiCap));
    const term = isPhone ? R.pick([24, 36]) : R.pick([48, 54, 60, 66, 72]);
    const rate = isPhone ? R.int(2100, 2500) / 100
      : (p.bureau?.score ?? 600) >= 700 ? R.int(1150, 1350) / 100
      : (p.bureau?.score ?? 600) >= 620 ? R.int(1350, 1600) / 100
      : R.int(1600, 2150) / 100;

    const retail = spec.retail;
    const depositPct = isPhone ? 0 : R.weighted([[0, 3], [0.1, 4], [0.15, 2], [0.2, 1]]);
    let deposit = Math.round(retail * depositPct);
    let principal = retail - deposit;

    // Size down rather than write an agreement the file cannot carry.
    let instal = instalmentCents(principal, rate, term, 0);
    if (instal > room && !isPhone) {
      const scale = Math.max(0.35, room / instal);
      principal = Math.round(principal * scale);
      deposit = retail - principal;
      instal = instalmentCents(principal, rate, term, 0);
    }

    const monthsAgoStart = pattern === 'settled'
      ? term + R.int(1, 8)
      : Math.min(p.onboardMonths, R.int(2, Math.max(3, Math.min(term - 2, p.onboardMonths))));

    const assetId = `ast_${t.assets.length + 1}`;
    const assetType = spec.type ?? (isPhone ? 'handset' : 'vehicle_passenger');
    const isVehicle = assetType.startsWith('vehicle') || assetType === 'motorcycle';
    // A handset has no registry to consult, so the honest answer is
    // that none was obtained — not that one was asked and found
    // nothing, which is what the adverse-registry rule looks for.
    const registry = isVehicle
      ? (p.archetype === 'fraud' ? 'encumbered' : R.weighted([['clear', 24], ['encumbered', 1]]))
      : 'unavailable';

    t.assets.push({
      id: assetId,
      platform_id: p.platform,
      asset_type: assetType,
      make: spec.make, model: spec.model, variant: spec.variant ?? null,
      year: NOW.getFullYear() - R.int(0, 4),
      colour: isVehicle ? R.pick(COLOURS) : null,
      vin: isVehicle ? vin() : null,
      engine_number: isVehicle ? `${R.int(100000, 999999)}` : null,
      registration_number: isVehicle ? plate() : null,
      imei: assetType === 'handset' ? imei(R) : null,
      serial_number: !isVehicle && assetType !== 'handset' ? `SN-${R.int(100000, 999999)}` : null,
      retail_value_cents: retail,
      trade_value_cents: isVehicle ? Math.round(retail * (0.72 + R.next() * 0.14)) : null,
      valued_on: isoDate(daysAgo(R.int(3, 90))),
      odometer_km: isVehicle ? R.int(50, 140000) : null,
      condition: R.weighted([['used', 6], ['new', 3], ['demo', 1]]),
      status: pattern === 'settled' ? 'sold' : 'financed',
      registry_verified: isVehicle,
      registry_verified_at: isVehicle ? iso(monthsAgo(monthsAgoStart)) : null,
      registry_status: registry,
      created_at: iso(monthsAgo(monthsAgoStart)),
    });

    const contractId = `CT-${PREFIX[p.platform]}-${String(t.contracts.length + 1).padStart(5, '0')}`;
    const first = monthsAgo(monthsAgoStart);
    const contract = {
      id: contractId,
      customer_id: p.customerId,
      platform_id: p.platform,
      asset_id: assetId,
      agreement_type: agreementType,
      origination_case_id: p.caseId,
      status: 'active',
      principal_cents: principal,
      deposit_cents: deposit,
      balloon_cents: 0,
      initiation_fee_cents: Math.min(Math.round(principal * 0.001) * 100 + 116900, 128250),
      monthly_service_fee_cents: isPhone ? 0 : 6900,
      interest_rate_pct: rate,
      rate_type: 'fixed',
      term_months: term,
      instalment_cents: instal,
      total_repayable_cents: instal * term,
      first_payment_date: isoDate(first),
      final_payment_date: isoDate(addMonths(first, term - 1)),
      payment_day: R.pick([1, 5, 15, 25, 28, 30]),
      collection_method: R.weighted([['debit_order', 5], ['debicheck', 4], ['eft', 1], ['payroll_deduction', 1]]),
      balance_cents: principal,
      arrears_cents: 0,
      months_in_arrears: 0,
      last_payment_date: null,
      settled_at: null,
      created_by: null,
      created_at: iso(new Date(first.getTime() - 3 * 86400000)),
      updated_at: iso(NOW),
    };
    t.contracts.push(contract);

    // ── The schedule, and what actually arrived ────────────────
    const schedule = generateSchedule(contract);
    const today = isoDate(NOW);
    const dueSoFar = schedule.filter((s) => s.due_date <= today);

    let payCount;
    switch (pattern) {
      case 'clean': payCount = dueSoFar.length; break;
      case 'late': payCount = dueSoFar.length; break;
      case 'slipping': payCount = Math.max(0, dueSoFar.length - 2); break;
      case 'arrears': payCount = Math.max(0, dueSoFar.length - 3); break;
      case 'nothing': payCount = 0; break;
      case 'settled': payCount = schedule.length; break;
      default: payCount = dueSoFar.length;
    }

    const payments = [];
    for (let n = 0; n < payCount; n++) {
      const s = schedule[n];
      // A late payer arrives after the due date by a different number
      // of days each month, which is what makes the behaviour score
      // rate them as late rather than delinquent.
      const offset = pattern === 'late' ? R.int(8, 19) : 0;
      const paidAt = new Date(new Date(s.due_date).getTime() + offset * 86400000 + 9 * 3600000);
      payments.push({
        id: `pay_${t.payments.length + payments.length + 1}`,
        contract_id: contractId,
        customer_id: p.customerId,
        amount_cents: s.amount_due_cents,
        paid_at: iso(paidAt),
        method: contract.collection_method,
        source_platform: p.platform,
        external_reference: `${PREFIX[p.platform]}-COL-${s.due_date.slice(0, 7).replace('-', '')}-${String(n + 1).padStart(4, '0')}`,
        status: 'received',
        reversed_at: null,
        reversal_reason: null,
        created_at: iso(paidAt),
      });
    }

    // A debit order that presented and bounced is a reversal, not a
    // payment that never happened. The money not being there on the
    // day is the signal, and the record has to keep it.
    if (['slipping', 'arrears'].includes(pattern) && payments.length && R.chance(0.5)) {
      const s = schedule[payments.length];
      if (s) {
        const at = new Date(new Date(s.due_date).getTime() + 9 * 3600000);
        payments.push({
          id: `pay_${t.payments.length + payments.length + 1}`,
          contract_id: contractId, customer_id: p.customerId,
          amount_cents: s.amount_due_cents, paid_at: iso(at),
          method: contract.collection_method, source_platform: p.platform,
          external_reference: `${PREFIX[p.platform]}-COL-RVSL-${String(payments.length + 1).padStart(4, '0')}`,
          status: 'reversed',
          reversed_at: iso(new Date(at.getTime() + 3 * 86400000)),
          reversal_reason: 'Debit order returned unpaid — insufficient funds',
          created_at: iso(at),
        });
      }
    }

    const allocations = allocatePayments(schedule, payments);
    if (pattern === 'settled') {
      contract.status = 'settled';
      contract.settled_at = iso(addMonths(first, term));
    }
    recomputeContract(contract, schedule, payments);

    t.payment_schedule.push(...schedule);
    t.payments.push(...payments);
    t.payment_allocations.push(...allocations);
    p.contractId = contractId;
  }

  // Stock on the floor, so the assets page shows a dealership's actual
  // position: what is financed, what is available, what came back.
  for (let i = 0; i < 70; i++) {
    const spec = R.chance(0.75) ? R.pick(VEHICLES) : R.pick(HANDSETS);
    const assetType = spec.type ?? 'handset';
    const isVehicle = assetType.startsWith('vehicle');
    t.assets.push({
      id: `ast_${t.assets.length + 1}`,
      platform_id: R.pick(PLATFORMS.filter((x) => x.id !== 'xcentral_console')).id,
      asset_type: assetType,
      make: spec.make, model: spec.model, variant: spec.variant ?? null,
      year: NOW.getFullYear() - R.int(0, 3),
      colour: isVehicle ? R.pick(COLOURS) : null,
      vin: isVehicle ? vin() : null,
      engine_number: isVehicle ? `${R.int(100000, 999999)}` : null,
      registration_number: isVehicle && R.chance(0.6) ? plate() : null,
      imei: assetType === 'handset' ? imei(R) : null,
      serial_number: null,
      retail_value_cents: spec.retail,
      trade_value_cents: isVehicle ? Math.round(spec.retail * 0.8) : null,
      valued_on: isoDate(daysAgo(R.int(1, 40))),
      odometer_km: isVehicle ? R.int(5, 90000) : null,
      condition: R.weighted([['new', 4], ['demo', 2], ['used', 4]]),
      status: R.weighted([['available', 6], ['reserved', 2], ['repossessed', 1], ['returned', 1]]),
      registry_verified: isVehicle,
      registry_verified_at: isVehicle ? iso(daysAgo(R.int(1, 40))) : null,
      registry_status: isVehicle ? R.weighted([['clear', 8], ['encumbered', 1]]) : 'unavailable',
      created_at: iso(daysAgo(R.int(1, 200))),
    });
  }

  // ══════════════════════════════════════════════════════════
  // 6 · Counter sessions and what the agents made of them
  // ══════════════════════════════════════════════════════════
  const CHANNELS = ['branch', 'dealership', 'field_agent', 'self_service', 'call_centre'];
  const DEVICES = {
    branch: (n) => `${n} branch — Counter ${R.int(1, 6)}`,
    dealership: (n) => `${n} — Kiosk ${R.int(1, 3)}`,
    field_agent: () => `Field tablet FT-${R.int(100, 320)}`,
    self_service: () => `Applicant device (${R.pick(['Android', 'iOS'])})`,
    call_centre: () => `Call centre — Pod ${R.int(1, 12)}`,
  };

  const sessionPeople = R.shuffle(people.filter((p) => p.archetype !== 'inflight')).slice(0, 230);
  sessionPeople.forEach((p, i) => {
    const sid = `CS-${NOW.getFullYear()}-${String(i + 1).padStart(6, '0')}`;
    const channel = R.pick(CHANNELS);
    const monthsBack = Math.min(p.onboardMonths, R.int(0, 20));
    const started = monthsAgo(monthsBack);

    const outcome = p.archetype === 'fraud' ? 'declined'
      : ['thin', 'watchlist'].includes(p.archetype) ? R.weighted([['review', 3], ['approved', 1]])
      : R.weighted([['approved', 22], ['review', 2], ['capturing', 1]]);

    t.capture_sessions.push({
      id: sid,
      platform_id: p.platform,
      case_id: p.caseId,
      subject_id: p.subjectId,
      customer_id: p.customerId,
      channel,
      status: outcome,
      required_steps: ['consent', 'document', 'selfie', 'match'],
      completed_steps: outcome === 'capturing'
        ? ['consent', 'document'] : ['consent', 'document', 'selfie', 'match'],
      operator_id: null,
      device_label: DEVICES[channel](p.place.city),
      started_at: iso(started),
      completed_at: outcome === 'capturing' ? null : iso(new Date(started.getTime() + 7 * 60000)),
      expires_at: iso(new Date(started.getTime() + 2 * 3600000)),
      created_at: iso(started),
    });

    // The captures themselves. Quality is measured from the pixels —
    // sharpness as the variance of the Laplacian, brightness and
    // contrast from luminance — and assessed before anything is
    // templated, because most failed matches are failed photographs.
    const shot = (type, w, h, extra = {}) => {
      t.captures.push({
        id: `cap_${t.captures.length + 1}`,
        session_id: sid,
        capture_type: type,
        source: 'live_camera',
        storage_path: `${sid}/${type}.jpg`,
        mime_type: 'image/jpeg',
        size_bytes: R.int(180000, 2100000),
        width: w, height: h,
        sha256: tag('capture', `${sid}|${type}`),
        sharpness: Number((90 + R.next() * 220).toFixed(2)),
        brightness: Number((44 + R.next() * 22).toFixed(2)),
        contrast: Number((22 + R.next() * 18).toFixed(2)),
        face_detected: extra.face ?? false,
        face_count: extra.face ? 1 : 0,
        face_area_pct: extra.face ? Number((14 + R.next() * 52).toFixed(2)) : null,
        quality_score: Number((84 + R.next() * 14).toFixed(2)),
        quality_passed: true,
        quality_reasons: [],
        template_id: null,
        // No raw sample is kept. This records when the image was
        // discarded after templating, which is the fact POPIA cares about.
        sample_discarded_at: iso(new Date(started.getTime() + 9 * 60000)),
        captured_by: null,
        created_at: iso(new Date(started.getTime() + 2 * 60000)),
      });
    };
    shot('document_front', 1920, 1080);
    shot('document_portrait', 480, 640, { face: true });
    if (outcome !== 'capturing') shot('selfie', 1280, 960, { face: true });

    if (outcome === 'capturing') return;

    const sim = t.biometric_verifications.find(
      (b) => b.subject_id === p.subjectId && b.modality === 'face',
    )?.similarity;

    const recommendation = outcome === 'approved' ? 'approve'
      : outcome === 'declined' ? 'decline' : 'refer';
    const confidence = outcome === 'approved' ? 88 + R.int(0, 9)
      : outcome === 'declined' ? 95 + R.int(0, 4) : 56 + R.int(0, 11);

    const runId = `run_${t.agent_runs.length + 1}`;
    t.agent_runs.push({
      id: runId,
      session_id: sid,
      case_id: p.caseId,
      customer_id: p.customerId,
      recommendation,
      confidence,
      vetoed_by: outcome === 'declined' ? 'document_agent' : null,
      summary: outcome === 'approved'
        ? `Identity confirmed against Home Affairs, document machine-readable zone verified, live capture matched the document portrait at ${sim ?? 'n/a'} against a 0.68 threshold. No fraud signal above the block score. Approve.`
        : outcome === 'declined'
          ? 'The identity document fails its composite check digit and carries two critical tamper signals; the live capture does not match the document portrait; the payslip does not reconcile and the employer is not registered at CIPC. Decline.'
          : 'Identity and document are sound and the face matched. The bureau file is too thin to price the agreement and the affordability margin is narrow. Refer to a credit officer.',
      human_outcome: outcome === 'review' ? 'pending'
        : R.weighted([['accepted', 14], ['overridden', 1]]),
      decided_by: outcome === 'review' ? null : staffBy('reviewer').id,
      decided_at: outcome === 'review' ? null : iso(new Date(started.getTime() + 22 * 60000)),
      override_reason: null,
      latency_ms: R.int(1600, 2900),
      created_at: iso(new Date(started.getTime() + 7 * 60000)),
    });

    const run = t.agent_runs.at(-1);
    if (run.human_outcome === 'overridden') {
      run.override_reason = 'Branch manager accepted a lower face-match score on a customer known to the branch for eight years; a second operator witnessed the capture.';
    }

    // Each agent's own verdict. Nothing here is a language model —
    // every one is a rule over the records above, which is why the
    // same file always produces the same answer, and why the answer
    // can be explained to the regulator that asks.
    const verdict = (kind) => {
      if (outcome === 'declined') return kind === 'identity' || kind === 'compliance' ? 'pass' : 'fail';
      if (outcome === 'review') return ['fraud', 'affordability'].includes(kind) ? 'concern' : 'pass';
      return 'pass';
    };
    const RATIONALE = {
      identity: 'Identity number is structurally valid and its check digit holds. Home Affairs returned a match on name and date of birth. Not on the deceased register. No watchlist hit.',
      document: outcome === 'declined'
        ? 'The machine-readable zone’s composite check digit does not verify. Image metadata shows the file was produced in a raster editor and modified after creation. Two critical tamper signals. This document is not genuine.'
        : 'Machine-readable zone parses and every ICAO 9303 check digit verifies, including the composite. Document is current. The name on the document matches the name claimed.',
      biometric: outcome === 'declined'
        ? `The live capture scores ${sim ?? 'n/a'} against the document portrait, well under the 0.68 threshold. Liveness passed, so a live person was present — but not the person on the document.`
        : `Live capture scores ${sim ?? 'n/a'} against the document portrait, above the 0.68 threshold at a 1-in-100 000 false match rate. Passive liveness passed at presentation attack detection level 2. No raw image retained.`,
      fraud: outcome === 'declined'
        ? 'The banking details are already on file under two unrelated identities, the residential address is shared with two others, and the payslip has been seen before on a different application.'
        : outcome === 'review'
          ? 'Nothing critical. One warning: the applicant has been on the network for under a year, so there is little history to compare against.'
          : 'No signal above the warning threshold. Banking, address, phone and employer are each unique to this identity.',
      affordability: outcome === 'declined'
        ? 'Declared net income cannot be verified: the payslip arithmetic does not reconcile and the observed bank deposit is a fraction of the figure claimed. No affordability assessment can be made on this evidence, which under NCA section 81 means no agreement may be entered into.'
        : outcome === 'review'
          ? 'Income is verified and expenses exceed the Regulation 23A minimum, but discretionary income after the proposed instalment leaves a margin too thin to price with confidence. A human should set the limit.'
          : 'Income verified against a payslip and three months of bank statements. Living expenses are above the Regulation 23A minimum for this income band. Discretionary income carries the proposed instalment with room to spare.',
      compliance: 'Consent is on record for identity verification, document storage, biometric processing and credit enquiry, each against its own versioned wording, none withdrawn. Biometric consent is explicit as POPIA section 27 requires for special personal information. The FICA file is complete. Retention is set to five years from the end of the relationship under FICA section 22.',
    };

    const KIND = {
      identity_agent: 'identity', document_agent: 'document', biometric_agent: 'biometric',
      fraud_agent: 'fraud', affordability_agent: 'affordability', compliance_agent: 'compliance',
    };

    for (const a of AGENTS) {
      if (a.id === 'orchestrator') continue;
      const kind = KIND[a.id];
      t.agent_decisions.push({
        id: `ad_${t.agent_decisions.length + 1}`,
        run_id: runId,
        agent_id: a.id,
        verdict: verdict(kind),
        confidence: verdict(kind) === 'fail' ? 92 + R.int(0, 7) : 80 + R.int(0, 19),
        rationale: RATIONALE[kind],
        evidence: {},
        reason_codes: [],
        created_at: iso(new Date(started.getTime() + 7 * 60000)),
      });
    }
    // The orchestrator does not vote; it combines, and a veto is
    // decisive rather than averaged away.
    t.agent_decisions.push({
      id: `ad_${t.agent_decisions.length + 1}`,
      run_id: runId,
      agent_id: 'orchestrator',
      verdict: outcome === 'declined' ? 'fail' : outcome === 'review' ? 'concern' : 'pass',
      confidence,
      rationale: outcome === 'approved'
        ? `Six agents, no veto, no concern. Weighted confidence ${confidence}. Recommend approve.`
        : outcome === 'declined'
          ? 'The document agent vetoes, and the biometric, fraud and affordability agents each fail independently. Recommend decline.'
          : 'No veto. The affordability and fraud agents each raise a concern that a rule cannot resolve. Recommend refer to a human.',
      evidence: { agents_run: 6, vetoes: outcome === 'declined' ? 1 : 0 },
      reason_codes: [],
      created_at: iso(new Date(started.getTime() + 7 * 60000)),
    });
  });

  return ctx;
}
