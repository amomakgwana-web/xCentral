// ══════════════════════════════════════════════════════════════
// The arithmetic.
//
// These are the ports of the Postgres functions the schema defines,
// and they are the reason the figures on screen hold together: nothing
// in the dataset writes down a score, an arrears position or a lending
// limit. Every one of them is produced here, from the records.
//
// Kept apart from the dataset because the console calls them too —
// scoring a case, profiling a customer, sizing an offer — and the
// answer a page shows has to be the same answer the fixture was built
// with, not a second implementation that drifts from it.
// ══════════════════════════════════════════════════════════════

import {
  verification_requirements, credit_policies, ncaMinimumExpensesCents,
} from './reference.js';
import { instalmentCents, addMonths, isoDate, NOW } from './generate.js';

// ── Case scoring ────────────────────────────────────────────────
// A weighted average over the checks the level requires, with one
// override that matters: a failed required check is decisive whatever
// the average says. An identity that failed the deceased register does
// not become acceptable because six other checks passed.
export function caseScore(kase, checks) {
  const reqs = verification_requirements.filter((r) => r.level === kase.level);
  if (!reqs.length) return { level: kase.level, score: 0, suggested_status: 'in_progress', missing_checks: [], failed_checks: [], manual_review_checks: [] };

  let totalWeight = 0;
  let weighted = 0;
  const missing = [];
  const failed = [];
  const manual = [];

  for (const r of reqs) {
    const runs = checks
      .filter((c) => c.domain === r.domain && c.check_type === r.check_type && c.status !== 'pending')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latest = runs[0];
    const name = `${r.domain}.${r.check_type}`;

    if (!latest) { if (r.required) missing.push(name); continue; }
    if (latest.status === 'skipped') { if (r.required) missing.push(name); continue; }
    if (latest.status === 'error') { if (r.required) missing.push(name); continue; }

    if (latest.status === 'failed' && r.required) failed.push(name);
    else if (latest.status === 'manual_review') manual.push(name);

    totalWeight += r.weight;
    weighted += (latest.score ?? 0) * r.weight;
  }

  const score = totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);

  // Ordering matters. Failure first, then incompleteness, then doubt.
  let suggested;
  if (failed.length) suggested = 'rejected';
  else if (missing.length) suggested = 'in_progress';
  else if (manual.length) suggested = 'review';
  else if (score >= 80) suggested = 'verified';
  else suggested = 'review';

  return {
    level: kase.level,
    score,
    suggested_status: suggested,
    missing_checks: missing,
    failed_checks: failed,
    manual_review_checks: manual,
  };
}

// ── Amortisation ────────────────────────────────────────────────
export { instalmentCents };

// The schedule an agreement is actually chased against. Interest is
// charged on the reducing balance; the last instalment absorbs the
// rounding so the schedule sums to the agreement rather than to
// something a cent or two away from it.
export function generateSchedule(contract) {
  const rows = [];
  const rate = Number(contract.interest_rate_pct) / 100 / 12;
  const fee = contract.monthly_service_fee_cents ?? 0;
  let balance = contract.principal_cents;
  const first = new Date(contract.first_payment_date);

  for (let n = 1; n <= contract.term_months; n++) {
    const interest = Math.round(balance * rate);
    let principal = contract.instalment_cents - interest;
    if (n === contract.term_months) principal = balance;
    if (principal > balance) principal = balance;
    balance -= principal;

    rows.push({
      id: `${contract.id}-S${String(n).padStart(3, '0')}`,
      contract_id: contract.id,
      version: 1,
      instalment_no: n,
      due_date: isoDate(addMonths(first, n - 1)),
      amount_due_cents: principal + interest + fee,
      principal_cents: principal,
      interest_cents: interest,
      fees_cents: fee,
      amount_paid_cents: 0,
      status: 'due',
      paid_on: null,
    });
  }
  return rows;
}

// Oldest instalment first, so "three months in arrears" means one
// thing consistently rather than depending on which payment happened
// to be allocated where.
export function allocatePayments(schedule, payments) {
  for (const s of schedule) { s.amount_paid_cents = 0; s.status = 'due'; s.paid_on = null; }
  const allocations = [];

  const received = payments
    .filter((p) => p.status === 'received')
    .sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at));

  for (const p of received) {
    let left = p.amount_cents;
    for (const s of schedule) {
      if (left <= 0) break;
      const owing = s.amount_due_cents - s.amount_paid_cents;
      if (owing <= 0) continue;
      const applied = Math.min(owing, left);
      s.amount_paid_cents += applied;
      left -= applied;
      allocations.push({
        id: `${p.id}-A${allocations.length + 1}`,
        payment_id: p.id,
        schedule_id: s.id,
        contract_id: s.contract_id,
        instalment_no: s.instalment_no,
        amount_cents: applied,
      });
      if (s.amount_paid_cents >= s.amount_due_cents) {
        s.status = 'paid';
        s.paid_on = isoDate(new Date(p.paid_at));
      } else {
        s.status = 'partial';
      }
    }
  }

  const today = isoDate(NOW);
  for (const s of schedule) {
    if (s.status === 'due' && s.due_date <= today) s.status = 'missed';
  }
  return allocations;
}

// Arrears is what has fallen due and not been paid. An instalment not
// yet due is not arrears, however large the remaining balance.
export function recomputeContract(contract, schedule, payments) {
  const today = isoDate(NOW);
  const fallenDue = schedule.filter((s) => s.due_date <= today && s.status !== 'waived');

  const arrears = fallenDue.reduce((sum, s) => sum + Math.max(0, s.amount_due_cents - s.amount_paid_cents), 0);
  const monthsBehind = fallenDue.filter((s) => s.amount_due_cents > s.amount_paid_cents).length;

  const received = payments.filter((p) => p.status === 'received');
  const principalPaid = schedule.filter((s) => s.status === 'paid').reduce((sum, s) => sum + s.principal_cents, 0);
  const lastPayment = received.length
    ? received.map((p) => isoDate(new Date(p.paid_at))).sort().at(-1)
    : null;

  let status;
  if (['settled', 'cancelled', 'written_off', 'legal'].includes(contract.status)) {
    status = contract.status;
  } else if (arrears <= 0 && schedule.some((s) => s.status !== 'paid')) {
    status = 'active';
  } else if (arrears <= 0) {
    status = 'settled';
  } else if (monthsBehind >= 3) {
    status = 'defaulted';
  } else {
    status = 'in_arrears';
  }

  contract.arrears_cents = Math.max(arrears, 0);
  contract.months_in_arrears = Math.max(monthsBehind, 0);
  contract.balance_cents = Math.max(contract.principal_cents - principalPaid, 0);
  contract.last_payment_date = lastPayment;
  contract.status = status;
  return contract;
}

// ── Payment behaviour ───────────────────────────────────────────
// A late payment counts as 0.6 of an on-time one. On-time percentage
// alone cannot separate a customer who paid every instalment a
// fortnight late from one who paid nothing — both are 0% on time, and
// they are not the same risk.
//
// Every penalty is a rate, not a count. An earlier version subtracted
// two points per late instalment while scoring the base as a
// percentage, which mixed units: forty instalments paid a fortnight
// late scored zero, identical to never having paid, purely because the
// agreement had been running longer. The score has to measure conduct,
// not tenure. Reversals stay absolute and capped, because a returned
// debit order is a discrete event and five of them say what fifty do.
export function paymentBehaviour({ contracts, schedules, payments }) {
  const today = isoDate(NOW);
  const rows = contracts.flatMap((c) => (schedules[c.id] ?? []));
  const due = rows.filter((s) => s.due_date <= today && s.status !== 'waived');

  if (!contracts.length || !due.length) {
    return {
      has_history: false, score: null, contracts: contracts.length,
      reason: contracts.length ? 'No instalments have fallen due yet' : 'No agreements on this platform',
    };
  }

  const onTime = due.filter((s) => s.status === 'paid' && s.paid_on <= s.due_date).length;
  const late = due.filter((s) => s.status === 'paid' && s.paid_on > s.due_date).length;
  const missed = due.filter((s) => ['due', 'partial', 'missed'].includes(s.status)).length;
  const reversals = payments.filter((p) => p.status === 'reversed').length;
  const worst = contracts.reduce((m, c) => Math.max(m, c.months_in_arrears ?? 0), 0);

  let score = Math.round(
    ((onTime + late * 0.6) / due.length) * 100
    - (late / due.length) * 14
    - (missed / due.length) * 30
    - Math.min(reversals, 5) * 4,
  );
  score = Math.max(0, Math.min(100, score));
  if (worst >= 3) score = Math.min(score, 35);

  // Consecutive on-time instalments, newest backwards.
  const newestFirst = due.slice().sort((a, b) => (a.due_date < b.due_date ? 1 : -1));
  let streak = 0;
  for (const s of newestFirst) {
    if (s.status === 'paid' && s.paid_on <= s.due_date) streak++;
    else break;
  }

  return {
    has_history: true,
    contracts: contracts.length,
    instalments_due: due.length,
    paid_on_time: onTime,
    paid_late: late,
    missed_or_short: missed,
    reversals,
    worst_months_in_arrears: worst,
    on_time_pct: Number(((onTime / due.length) * 100).toFixed(2)),
    consecutive_on_time: streak,
    score,
  };
}

// ── Affordability ───────────────────────────────────────────────
export function assessAffordability({
  grossCents, deductionsCents, declaredExpensesCents,
  existingObligationsCents = 0, proposedInstalmentCents = 0, incomeVerified = true,
}) {
  const net = grossCents - deductionsCents;
  const minimum = ncaMinimumExpensesCents(net);
  const applied = Math.max(declaredExpensesCents, minimum);
  const discretionary = net - applied - existingObligationsCents - proposedInstalmentCents;

  const reasons = [];
  if (!incomeVerified) reasons.push('income_not_verified');
  if (declaredExpensesCents < minimum) reasons.push('declared_below_regulated_minimum');
  if (discretionary >= 0 && discretionary < 150000) reasons.push('thin_affordability_margin');

  let outcome;
  if (!incomeVerified) outcome = 'insufficient_data';
  else if (discretionary < 0) outcome = 'not_affordable';
  else if (discretionary < 150000) outcome = 'marginal';
  else outcome = 'affordable';

  return {
    gross_income_cents: grossCents,
    statutory_deductions_cents: deductionsCents,
    net_income_cents: net,
    declared_expenses_cents: declaredExpensesCents,
    minimum_expenses_cents: minimum,
    applied_expenses_cents: applied,
    existing_obligations_cents: existingObligationsCents,
    proposed_instalment_cents: proposedInstalmentCents,
    discretionary_income_cents: discretionary,
    outcome,
    reason_codes: reasons,
  };
}

// ── Credit capacity ─────────────────────────────────────────────
// Sizes an offer from affordability, the bureau score, behaviour on
// this platform and existing exposure — and the weakest of them
// governs. Affordability is a ceiling, not an average: no score
// creates money that is not there, and lending past it is reckless
// credit under NCA s80.
export function assessCapacity({
  customer, agreementType = 'instalment_sale', termMonths = 60, ratePct = 15.0,
  affordability, bureau, behaviour, fraudScore = 0, contracts = [],
}) {
  const policy = credit_policies.find(
    (p) => p.platform_id === customer.platform_id && p.agreement_type === agreementType,
  ) ?? credit_policies.find((p) => p.agreement_type === agreementType);

  const reasons = [];
  const existingInstalments = contracts
    .filter((c) => ['active', 'in_arrears', 'defaulted', 'approved', 'legal'].includes(c.status))
    .reduce((s, c) => s + c.instalment_cents, 0);
  const existingExposure = contracts
    .filter((c) => ['active', 'in_arrears', 'defaulted', 'approved', 'legal'].includes(c.status))
    .reduce((s, c) => s + (c.balance_cents ?? 0), 0);

  // An open critical fraud signal stops the assessment rather than
  // producing a number from data that may be fabricated.
  if (fraudScore >= (policy?.fraud_block_score ?? 45)) {
    return {
      decision: 'decline', risk_grade: 'E', fraud_score: fraudScore,
      reason_codes: ['blocked_by_open_fraud_alert'],
      existing_instalments_cents: existingInstalments,
      existing_exposure_cents: existingExposure,
      max_instalment_cents: 0, max_principal_cents: 0, recommended_limit_cents: 0,
      assumed_rate_pct: ratePct, assumed_term_months: termMonths,
    };
  }

  if (!affordability) {
    return {
      decision: 'insufficient_data', risk_grade: null,
      reason_codes: ['no_affordability_assessment'],
      existing_instalments_cents: existingInstalments,
      existing_exposure_cents: existingExposure,
    };
  }

  const net = affordability.net_income_cents;
  // Discretionary income before the proposed instalment: this is the
  // room being sized, so the instalment cannot already be subtracted.
  const discretionary = net - affordability.applied_expenses_cents - existingInstalments;

  const bureauScore = bureau?.score ?? null;
  const behaviourScore = behaviour?.has_history ? behaviour.score : null;

  // A thin bureau file is not a bad one. Behaviour on this platform
  // adds to the floor rather than capping it — an earlier version
  // applied it as a ceiling below the lowest passing band, which meant
  // a perfect payer with no bureau record could never grade above E.
  let effective = bureauScore;
  if (effective === null) {
    const uplift = behaviourScore === null ? 0
      : Math.min(policy?.behaviour_uplift_max ?? 150,
                 Math.round((behaviourScore * (policy?.behaviour_uplift_max ?? 150)) / 100));
    effective = 500 + uplift;
    reasons.push('thin_bureau_file_behaviour_substituted');
  }

  if (bureauScore !== null && bureauScore < (policy?.hard_decline_bureau_score ?? 520)) {
    return {
      decision: 'decline', risk_grade: 'E', bureau_score: bureauScore, bureau_band: bureau?.band ?? null,
      behaviour_score: behaviourScore, fraud_score: fraudScore,
      reason_codes: ['bureau_score_below_hard_decline'],
      net_income_cents: net, discretionary_income_cents: Math.max(discretionary, 0),
      existing_instalments_cents: existingInstalments, existing_exposure_cents: existingExposure,
      max_instalment_cents: 0, max_principal_cents: 0, recommended_limit_cents: 0,
      assumed_rate_pct: ratePct, assumed_term_months: termMonths,
    };
  }

  const shareCap = Math.round((discretionary * (policy?.max_discretionary_share_pct ?? 50)) / 100);
  const dtiCap = Math.round((net * (policy?.max_debt_to_income_pct ?? 35)) / 100) - existingInstalments;
  const maxInstalment = Math.max(0, Math.min(shareCap, dtiCap));

  if (dtiCap < shareCap) reasons.push('limited_by_debt_to_income');
  if (maxInstalment <= 0) reasons.push('no_capacity_after_existing_obligations');

  // Reverse amortisation: the principal that instalment supports.
  const i = ratePct / 100 / 12;
  const f = Math.pow(1 + i, termMonths);
  const maxPrincipal = i === 0
    ? maxInstalment * termMonths
    : Math.round((maxInstalment * (f - 1)) / (i * f));

  const capped = Math.min(maxPrincipal, policy?.max_principal_cents ?? maxPrincipal);
  if (capped < maxPrincipal) reasons.push('limited_by_policy_maximum');

  let grade;
  if (effective >= 700) grade = 'A';
  else if (effective >= 660) grade = 'B';
  else if (effective >= 614) grade = 'C';
  else if (effective >= 583) grade = 'D';
  else grade = 'E';

  let decision;
  if (maxInstalment <= 0) decision = 'decline';
  else if (effective < (policy?.min_bureau_score ?? 583)) { decision = 'refer'; reasons.push('bureau_score_below_appetite'); }
  else if (affordability.outcome === 'marginal') { decision = 'refer'; reasons.push('thin_affordability_margin'); }
  else decision = 'approve';

  return {
    decision,
    risk_grade: grade,
    bureau_score: bureauScore,
    bureau_band: bureau?.band ?? null,
    behaviour_score: behaviourScore,
    fraud_score: fraudScore,
    net_income_cents: net,
    discretionary_income_cents: Math.max(discretionary, 0),
    existing_instalments_cents: existingInstalments,
    existing_exposure_cents: existingExposure,
    max_instalment_cents: maxInstalment,
    max_principal_cents: capped,
    recommended_limit_cents: decision === 'decline' ? 0 : capped,
    assumed_rate_pct: ratePct,
    assumed_term_months: termMonths,
    reason_codes: reasons,
    workings: {
      discretionary_share_cap_cents: shareCap,
      debt_to_income_cap_cents: dtiCap,
      governed_by: dtiCap < shareCap ? 'debt_to_income' : 'discretionary_share',
      policy: policy?.name ?? 'default',
    },
  };
}

// ── SA identity number ──────────────────────────────────────────
// The check digit is Luhn over the first twelve digits. Everything
// else the number claims — date of birth, gender, citizenship — is
// read out of its own structure rather than asked for separately.
export function validateSaId(idNumber) {
  const reasons = [];
  const digits = String(idNumber ?? '').replace(/\s/g, '');

  if (!/^\d{13}$/.test(digits)) {
    return { valid: false, reason_codes: ['not_thirteen_digits'] };
  }

  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (mm < 1 || mm > 12) reasons.push('month_out_of_range');
  if (dd < 1 || dd > 31) reasons.push('day_out_of_range');

  // Two-digit years: anything ahead of today belongs to the last
  // century, since nobody applies before they are born.
  const thisYear = NOW.getFullYear() % 100;
  const century = yy > thisYear ? 1900 : 2000;
  const dob = new Date(Date.UTC(century + yy, mm - 1, dd));
  if (dob.getUTCMonth() !== mm - 1 || dob.getUTCDate() !== dd) reasons.push('date_not_real');

  const seq = Number(digits.slice(6, 10));
  const gender = seq < 5000 ? 'female' : 'male';
  const citizenship = digits[10] === '0' ? 'citizen'
    : digits[10] === '1' ? 'permanent_resident' : 'unknown';
  if (citizenship === 'unknown') reasons.push('citizenship_digit_invalid');

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let d = Number(digits[11 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  if (check !== Number(digits[12])) reasons.push('checksum_failed');

  const age = Math.floor((NOW - dob) / (365.25 * 86400000));

  return {
    valid: reasons.length === 0,
    date_of_birth: isoDate(dob),
    age,
    gender,
    citizenship,
    reason_codes: reasons,
  };
}

// ── Capture quality ─────────────────────────────────────────────
// Assessed before anything is templated or matched. A capture below
// the bar is refused with a remedy an operator can act on, because
// most failed matches are failed photographs.
export function assessCaptureQuality(captureType, m, rules) {
  const rule = rules.find((r) => r.capture_type === captureType && r.active);
  if (!rule) {
    return { passed: false, score: 0, reason_codes: ['unknown_capture_type'],
      remedy: 'This capture type is not configured.' };
  }

  const reasons = [];
  if ((m.sharpness ?? 0) < rule.min_sharpness) reasons.push('image_too_blurred');
  if ((m.brightness ?? 0) < rule.min_brightness) reasons.push('image_too_dark');
  if ((m.brightness ?? 0) > rule.max_brightness) reasons.push('image_overexposed');
  if ((m.contrast ?? 0) < rule.min_contrast) reasons.push('image_low_contrast');
  if ((m.width ?? 0) < rule.min_width || (m.height ?? 0) < rule.min_height) reasons.push('resolution_too_low');

  // A browser without a face detector produces an advisory, not a
  // failure: a capability gap in the browser is not a defect in the
  // photograph.
  const advisories = [];
  if (rule.require_face) {
    if (m.faceCount === null || m.faceCount === undefined) advisories.push('face_detection_unavailable');
    else if (m.faceCount === 0) reasons.push('no_face_found');
    else if (m.faceCount > 1) reasons.push('more_than_one_face');
    else if (rule.min_face_area_pct && (m.faceAreaPct ?? 0) < rule.min_face_area_pct) reasons.push('face_too_small');
  }

  const score = Math.max(0, 100 - reasons.length * 22 - advisories.length * 4);
  const REMEDY = {
    image_too_blurred: 'Hold the camera steady and try again.',
    image_too_dark: 'Move somewhere brighter.',
    image_overexposed: 'Move out of direct light.',
    image_low_contrast: 'Place the document on a darker surface.',
    resolution_too_low: 'Move closer, or use a better camera.',
    no_face_found: 'Make sure the face is fully in frame.',
    more_than_one_face: 'Only the applicant should be in frame.',
    face_too_small: 'Move closer to the camera.',
  };

  return {
    passed: reasons.length === 0,
    score,
    reason_codes: reasons,
    advisories,
    remedy: reasons.map((r) => REMEDY[r]).filter(Boolean).join(' ') || null,
  };
}
