// ══════════════════════════════════════════════════════════════
// Builds the dataset once, and reconciles it.
//
// The reconciliation at the end is the part that matters: statuses
// were chosen to illustrate an outcome, and the scores are then
// recomputed from the evidence, so no case can claim a number its
// checks do not support and no subject can hold an assurance level its
// cases never earned.
// ══════════════════════════════════════════════════════════════

import { buildDataset } from './dataset.js';
import { buildLifecycle } from './lifecycle.js';
import { buildPlatform } from './platform.js';
import { caseScore } from './compute.js';
import { addMonths, iso, NOW } from './generate.js';

let cached = null;

export function dataset() {
  if (cached) return cached;

  const ctx = buildPlatform(buildLifecycle(buildDataset()));
  const { t } = ctx;

  // ── Case scores, from the checks that actually ran ──────────
  const checksByCase = new Map();
  for (const c of t.verification_checks) {
    if (!checksByCase.has(c.case_id)) checksByCase.set(c.case_id, []);
    checksByCase.get(c.case_id).push(c);
  }
  for (const c of t.verification_cases) {
    c.score = caseScore(c, checksByCase.get(c.id) ?? []).score;
  }

  // ── Assurance runs from the most recent verified case ───────
  // Not from the day someone was first onboarded. A file verified two
  // years ago and never refreshed is out of assurance, and the console
  // should say so rather than carry the original expiry forward.
  const latestVerified = new Map();
  for (const c of t.verification_cases) {
    if (c.status !== 'verified' || !c.decided_at) continue;
    const held = latestVerified.get(c.subject_id);
    if (!held || new Date(c.decided_at) > new Date(held.decided_at)) latestVerified.set(c.subject_id, c);
  }
  for (const s of t.subjects) {
    const c = latestVerified.get(s.id);
    if (!c) { s.assurance_level = 'none'; s.assurance_expires_at = null; continue; }
    s.assurance_level = c.level === 'enhanced' ? 'enhanced' : c.level === 'basic' ? 'basic' : 'standard';
    s.assurance_expires_at = iso(addMonths(new Date(c.decided_at), 12));
  }

  cached = t;
  return t;
}

// Row counts per table, for the check that every module carries real
// volume rather than a handful of rows.
export function counts() {
  const t = dataset();
  return Object.fromEntries(
    Object.entries(t)
      .filter(([, v]) => Array.isArray(v))
      .map(([k, v]) => [k, v.length])
      .sort((a, b) => b[1] - a[1]),
  );
}
