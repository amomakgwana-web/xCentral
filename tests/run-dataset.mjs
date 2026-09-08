// ══════════════════════════════════════════════════════════════
// The dataset has to be worth running the console against.
//
//   node tests/run-dataset.mjs
//
// Two things are asserted here that nothing else covers. First, that
// every record-bearing module carries real volume — a page with four
// rows on it cannot be judged. Second, that the records agree with one
// another: a payment against an agreement that exists, an arrears
// figure that matches the schedule it was derived from, a case score
// that the checks actually support.
//
// The second is the one that matters. Volume is easy and proves
// nothing on its own; a dataset where the arrears book and the
// customer profiles disagree is worse than a small one, because it
// looks convincing while being wrong.
// ══════════════════════════════════════════════════════════════

import { dataset, counts } from '../src/data/index.js';
import { caseScore, paymentBehaviour } from '../src/data/compute.js';

const t = dataset();
let failed = 0;
const pass = (m) => console.log(`pass  ${m}`);
const fail = (m) => { failed++; console.log(`FAIL  ${m}`); };
const expect = (label, got, want) => (got === want ? pass(label) : fail(`${label} — expected ${want}, got ${got}`));

// Configuration is not sample data and is deliberately its natural
// size. There are four credit bureaus in this country; padding the
// list to two hundred would make the page lie about what the system
// can actually reach.
const CONFIGURATION = new Set([
  'client_platforms', 'consent_texts', 'document_types', 'credit_bureaus',
  'biometric_modalities', 'verification_requirements', 'affordability_norms',
  'nca_caps', 'retention_policies', 'capture_quality_rules', 'agents',
  'fraud_rules', 'credit_policies', 'asset_types', 'webhook_endpoints',
]);

// ── Volume ──────────────────────────────────────────────────────
console.log('── Records per module');
const c = counts();
const thin = [];
for (const [table, n] of Object.entries(c)) {
  if (CONFIGURATION.has(table)) continue;
  if (n < 200) thin.push(`${table} (${n})`);
}
if (thin.length) fail(`modules below 200 records: ${thin.join(', ')}`);
else pass(`every record module carries at least 200 rows (${Object.keys(c).length} tables, ${Object.values(c).reduce((a, b) => a + b, 0)} rows)`);

// ── Determinism ─────────────────────────────────────────────────
// A figure that moves between reloads is a figure nobody can check
// against yesterday's screenshot.
{
  const again = counts();
  const same = Object.entries(c).every(([k, v]) => again[k] === v);
  expect('the same dataset is produced on every build', same, true);
}

// ── Referential integrity ───────────────────────────────────────
console.log('');
console.log('── The records agree with one another');
{
  const ids = (rows) => new Set(rows.map((r) => r.id));
  const subjects = ids(t.subjects);
  const customers = ids(t.customers);
  const contracts = ids(t.contracts);
  const cases = ids(t.verification_cases);

  const orphan = (rows, col, pool, allowNull = true) =>
    rows.filter((r) => (allowNull ? r[col] != null : true) && r[col] != null && !pool.has(r[col])).length;

  expect('every customer points at a subject that exists', orphan(t.customers, 'subject_id', subjects), 0);
  expect('every case points at a subject that exists', orphan(t.verification_cases, 'subject_id', subjects), 0);
  expect('every check belongs to a case', orphan(t.verification_checks, 'case_id', cases), 0);
  expect('every contract belongs to a customer', orphan(t.contracts, 'customer_id', customers), 0);
  expect('every payment belongs to a contract', orphan(t.payments, 'contract_id', contracts), 0);
  expect('every schedule row belongs to a contract', orphan(t.payment_schedule, 'contract_id', contracts), 0);
  expect('every document belongs to a case', orphan(t.documents, 'case_id', cases), 0);
  expect('every fraud signal names a rule that exists',
    t.fraud_signals.filter((s) => !t.fraud_rules.some((r) => r.code === s.rule_code)).length, 0);
  expect('every agent decision belongs to a run',
    t.agent_decisions.filter((d) => !t.agent_runs.some((r) => r.id === d.run_id)).length, 0);
}

// ── The arithmetic holds ────────────────────────────────────────
console.log('');
console.log('── The figures were computed, not written down');
{
  const scheduleBy = new Map();
  for (const s of t.payment_schedule) {
    if (!scheduleBy.has(s.contract_id)) scheduleBy.set(s.contract_id, []);
    scheduleBy.get(s.contract_id).push(s);
  }
  const today = new Date().toISOString().slice(0, 10);

  let arrearsWrong = 0;
  let balanceWrong = 0;
  for (const ct of t.contracts) {
    const sched = scheduleBy.get(ct.id) ?? [];
    const due = sched.filter((s) => s.due_date <= today && s.status !== 'waived');
    const arrears = due.reduce((sum, s) => sum + Math.max(0, s.amount_due_cents - s.amount_paid_cents), 0);
    if (arrears !== ct.arrears_cents) arrearsWrong++;
    const principalPaid = sched.filter((s) => s.status === 'paid').reduce((sum, s) => sum + s.principal_cents, 0);
    if (Math.max(ct.principal_cents - principalPaid, 0) !== ct.balance_cents) balanceWrong++;
  }
  expect('arrears on every agreement matches its own schedule', arrearsWrong, 0);
  expect('the outstanding balance matches the principal actually repaid', balanceWrong, 0);

  // The schedule has to sum to the agreement. A schedule a cent or two
  // out is a schedule that will be argued about.
  let sumWrong = 0;
  for (const ct of t.contracts) {
    const sched = scheduleBy.get(ct.id) ?? [];
    const principal = sched.reduce((s, r) => s + r.principal_cents, 0);
    if (principal !== ct.principal_cents) sumWrong++;
  }
  expect('every schedule repays exactly the principal advanced', sumWrong, 0);

  // Allocation is oldest-instalment-first, so an unpaid instalment can
  // never sit behind a paid one.
  let outOfOrder = 0;
  for (const [, sched] of scheduleBy) {
    const ordered = sched.slice().sort((a, b) => a.instalment_no - b.instalment_no);
    let seenUnpaid = false;
    for (const s of ordered) {
      if (s.amount_paid_cents === 0) seenUnpaid = true;
      else if (seenUnpaid && s.amount_paid_cents >= s.amount_due_cents) { outOfOrder++; break; }
    }
  }
  expect('payments were allocated oldest instalment first', outOfOrder, 0);
}

{
  const checksBy = new Map();
  for (const k of t.verification_checks) {
    if (!checksBy.has(k.case_id)) checksBy.set(k.case_id, []);
    checksBy.get(k.case_id).push(k);
  }
  const drift = t.verification_cases.filter(
    (c) => c.score !== caseScore(c, checksBy.get(c.id) ?? []).score,
  ).length;
  expect('every case score is what its checks compute to', drift, 0);
}

// ── The story holds together ────────────────────────────────────
console.log('');
console.log('── A file that fails, fails consistently');
{
  // The point of archetypes: a document check that failed should be on
  // a file whose face match also failed and whose employer CIPC cannot
  // find. Evidence that disagrees with itself is worse than none.
  const rejected = t.verification_cases.filter((c) => c.status === 'rejected');
  expect('there are rejected cases to inspect', rejected.length > 0, true);

  const bad = rejected.filter((c) => {
    const checks = t.verification_checks.filter((k) => k.case_id === c.id);
    return checks.some((k) => k.status === 'failed');
  });
  expect('every rejected case has a failed check behind it', bad.length, rejected.length);

  // And the converse: a verified case must not be carrying a failed
  // required check, or the decision contradicts its own evidence.
  const verified = t.verification_cases.filter((c) => c.status === 'verified');
  const contradictory = verified.filter((c) => {
    const s = caseScore(c, t.verification_checks.filter((k) => k.case_id === c.id));
    return s.failed_checks.length > 0;
  });
  expect('no verified case carries a failed required check', contradictory.length, 0);
}

{
  // A late payer and a defaulter must not score the same. This is the
  // distinction the behaviour score exists to make.
  const scheduleBy = new Map();
  for (const s of t.payment_schedule) {
    if (!scheduleBy.has(s.contract_id)) scheduleBy.set(s.contract_id, []);
    scheduleBy.get(s.contract_id).push(s);
  }
  const scoreFor = (customerId) => {
    const contracts = t.contracts.filter((x) => x.customer_id === customerId);
    const schedules = {};
    for (const ct of contracts) schedules[ct.id] = scheduleBy.get(ct.id) ?? [];
    return paymentBehaviour({
      contracts, schedules, payments: t.payments.filter((p) => p.customer_id === customerId),
    });
  };

  const withHistory = t.customers
    .map((c) => ({ c, b: scoreFor(c.id) }))
    .filter((x) => x.b.has_history);

  const neverPaid = withHistory.filter((x) => x.b.paid_on_time === 0 && x.b.paid_late === 0);
  const alwaysLate = withHistory.filter((x) => x.b.paid_late > 0 && x.b.missed_or_short === 0);
  const alwaysOnTime = withHistory.filter((x) => x.b.missed_or_short === 0 && x.b.paid_late === 0);

  expect('there are customers who paid nothing', neverPaid.length > 0, true);
  expect('there are customers who paid everything late', alwaysLate.length > 0, true);
  expect('there are customers who never missed', alwaysOnTime.length > 0, true);

  const worstLate = Math.min(...alwaysLate.map((x) => x.b.score));
  const bestNever = Math.max(...neverPaid.map((x) => x.b.score));
  if (worstLate > bestNever) pass(`a late payer outscores a defaulter (${worstLate} vs ${bestNever})`);
  else fail(`a late payer scores ${worstLate}, a defaulter ${bestNever} — the two are not separated`);

  const worstOnTime = Math.min(...alwaysOnTime.map((x) => x.b.score));
  if (worstOnTime > worstLate) pass(`and is outscored in turn by someone who was never late (${worstOnTime})`);
  else fail(`an on-time payer scores ${worstOnTime}, no better than a late one at ${worstLate}`);
}

{
  // Fraud signals have to come from the records, so a file with no
  // adverse record on it should raise nothing.
  const alerted = new Set(t.fraud_alerts.map((a) => a.subject_id));
  const clean = t.subjects.filter((s) => !alerted.has(s.id));
  expect('most files raise no alert at all', clean.length > t.subjects.length / 2, true);

  const critical = t.fraud_alerts.filter((a) => a.severity === 'critical');
  expect('some files are critical', critical.length > 0, true);
  const everyCriticalHasSignals = critical.every((a) => a.critical_count > 0);
  expect('every critical alert has a critical signal behind it', everyCriticalHasSignals, true);
}

{
  // Nobody is enrolled biometrically without explicit consent. POPIA
  // s27 requires it for special personal information, and no amount of
  // legitimate interest substitutes.
  const enrolled = new Set(t.biometric_templates.map((x) => x.subject_id));
  const consented = new Set(
    t.consents.filter((c) => c.purpose === 'biometric_processing').map((c) => c.subject_id),
  );
  const without = [...enrolled].filter((s) => !consented.has(s)).length;
  expect('no biometric template exists without explicit consent', without, 0);
}

{
  // Capacity has to discriminate. If everything approves, the
  // assessment is decoration; if a top-grade customer routinely
  // declines, the book was written outside the policy that assesses
  // it — which is exactly what happened when agreements were sized
  // against discretionary income while the policy also caps
  // debt-to-income.
  const a = t.credit_assessments;
  const by = (d) => a.filter((x) => x.decision === d).length;
  expect('capacity approves, refers and declines', by('approve') > 0 && by('refer') > 0 && by('decline') > 0, true);
  expect('most assessments are not declines', by('decline') < a.length / 3, true);

  const gradeADeclines = a.filter((x) => x.risk_grade === 'A' && x.decision === 'decline').length;
  const gradeA = a.filter((x) => x.risk_grade === 'A').length;
  if (gradeADeclines <= gradeA * 0.1) {
    pass(`a top-grade customer is rarely declined for capacity (${gradeADeclines} of ${gradeA})`);
  } else {
    fail(`${gradeADeclines} of ${gradeA} A-grade customers decline — the book breaches the policy that assesses it`);
  }

  // Every grade should actually occur, or the grading is not doing
  // anything the reader can see.
  const grades = new Set(a.map((x) => x.risk_grade));
  expect('every risk grade from A to E occurs', ['A', 'B', 'C', 'D', 'E'].every((g) => grades.has(g)), true);
}

console.log('');
if (failed) {
  console.log(`───────────  ${failed} DATASET CHECK(S) FAILED  ───────────`);
  process.exit(1);
}
console.log('──────────────  DATASET CHECKS PASSED  ──────────────');
