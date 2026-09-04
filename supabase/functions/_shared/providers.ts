// ══════════════════════════════════════════════════════════════
// Provider adapters.
//
// Some of what a verification hub does is arithmetic we own: the SA
// ID check digit, the MRZ check digits, the NCA affordability
// calculation, cosine similarity between templates. That work is real
// and lives in this repository.
//
// The rest requires an authority we do not have offline — does the
// Department of Home Affairs hold this record, what does TransUnion
// score this person, is the face in front of the camera alive. Those
// are provider calls, and this module is the contract they implement.
//
// A `simulation` provider ships so the sandbox, the console and the
// tests all work end to end without contracts in place. It is
// deterministic: the same input always yields the same answer, so a
// demo is reproducible and a test can assert on it.
//
// It is also FENCED. A simulated result is a fabricated result, and
// the one genuinely dangerous failure mode for this system is a
// fabricated verification being mistaken for a real one. So:
//
//   · every simulated result is stamped provider='simulation'
//     in verification_checks, visibly, forever;
//   · assertLiveProvider() refuses to run the simulation against a
//     production platform unless XCENTRAL_ALLOW_SIMULATION_IN_PROD is
//     explicitly set — the check fails closed with an error rather
//     than quietly returning a plausible number.
// ══════════════════════════════════════════════════════════════

import { sha256Hex } from './hash.ts';

export type ProviderName = string;

export interface IdentityAuthorityResult {
  status: 'match' | 'no_match' | 'not_found' | 'unavailable' | 'error';
  authorityName: string | null;
  deceased: boolean;
  portraitAvailable: boolean;
  provider: ProviderName;
}

export interface DocumentAnalysisResult {
  authenticityScore: number;
  tamperSignals: Array<{ code: string; severity: 'info' | 'warn' | 'critical'; detail: string }>;
  provider: ProviderName;
}

export interface CreditBureauResult {
  status: 'completed' | 'no_record' | 'unavailable' | 'error';
  score: number | null;
  accountsTotal: number;
  accountsInArrears: number;
  worstArrearsMonths: number;
  monthlyDebtObligationsCents: number;
  judgments: number;
  defaults: number;
  adminOrder: boolean;
  debtReview: boolean;
  sequestration: boolean;
  provider: ProviderName;
}

export interface BiometricCaptureResult {
  descriptor: number[];
  qualityScore: number;
  provider: ProviderName;
}

export interface LivenessResult {
  score: number;
  passed: boolean;
  padLevel: 1 | 2;
  attackType: string;
  provider: ProviderName;
}

// ── Determinism ─────────────────────────────────────────────────
// mulberry32: small, fast, and stable across runtimes, which is what
// makes a simulated case reproducible.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function seedFrom(input: string): Promise<number> {
  const hex = await sha256Hex(input);
  return parseInt(hex.slice(0, 8), 16);
}

// ── The fence ───────────────────────────────────────────────────
export function activeProvider(domain: string): ProviderName {
  // Per-domain override, then a global default, then simulation.
  return Deno.env.get(`XCENTRAL_PROVIDER_${domain.toUpperCase()}`)
    ?? Deno.env.get('XCENTRAL_PROVIDER_DEFAULT')
    ?? 'simulation';
}

export function assertLiveProvider(provider: ProviderName, environment: string) {
  if (provider === 'simulation' && environment === 'production') {
    if (Deno.env.get('XCENTRAL_ALLOW_SIMULATION_IN_PROD') !== 'true') {
      throw new Error(
        'Refusing to run the simulation provider against a production platform. ' +
        'Configure a real provider for this domain, or set ' +
        'XCENTRAL_ALLOW_SIMULATION_IN_PROD=true if this is a deliberate drill.',
      );
    }
  }
}

// ── Simulation implementations ──────────────────────────────────
// Reminder: every value below is fabricated. It exists so the system
// can be exercised, not so anyone can be verified.

export async function identityAuthorityLookup(
  idHash: string,
  claimedName: string,
): Promise<IdentityAuthorityResult> {
  const rand = mulberry32(await seedFrom(`authority:${idHash}`));
  const roll = rand();
  let status: IdentityAuthorityResult['status'];
  if (roll < 0.86) status = 'match';
  else if (roll < 0.94) status = 'no_match';
  else if (roll < 0.98) status = 'not_found';
  else status = 'unavailable';

  return {
    status,
    // On a match the authority returns the name it holds; simulated,
    // that is simply the claimed name echoed back.
    authorityName: status === 'match' ? claimedName : null,
    deceased: rand() < 0.01,
    portraitAvailable: status === 'match' && rand() < 0.9,
    provider: 'simulation',
  };
}

export async function analyseDocument(
  sha256: string,
  docType: string,
): Promise<DocumentAnalysisResult> {
  const rand = mulberry32(await seedFrom(`document:${sha256}:${docType}`));
  const signals: DocumentAnalysisResult['tamperSignals'] = [];

  const base = 70 + rand() * 30;
  if (rand() < 0.10) {
    signals.push({ code: 'font_inconsistency', severity: 'warn', detail: 'Glyph metrics differ across the data page' });
  }
  if (rand() < 0.05) {
    signals.push({ code: 'portrait_substitution', severity: 'critical', detail: 'Portrait region shows recompression inconsistent with the surrounding page' });
  }
  if (rand() < 0.08) {
    signals.push({ code: 'security_feature_absent', severity: 'critical', detail: 'Expected optically variable feature not detected' });
  }
  if (rand() < 0.15) {
    signals.push({ code: 'low_capture_quality', severity: 'info', detail: 'Glare or low resolution over part of the document' });
  }

  // Critical signals dominate the score; warnings shade it.
  const critical = signals.filter((s) => s.severity === 'critical').length;
  const warn = signals.filter((s) => s.severity === 'warn').length;
  const score = Math.max(0, base - critical * 45 - warn * 12);

  return { authenticityScore: Number(score.toFixed(2)), tamperSignals: signals, provider: 'simulation' };
}

export async function creditBureauEnquiry(
  idHash: string,
  bureauId: string,
): Promise<CreditBureauResult> {
  const rand = mulberry32(await seedFrom(`credit:${idHash}:${bureauId}`));
  if (rand() < 0.04) {
    return {
      status: 'no_record', score: null, accountsTotal: 0, accountsInArrears: 0,
      worstArrearsMonths: 0, monthlyDebtObligationsCents: 0, judgments: 0,
      defaults: 0, adminOrder: false, debtReview: false, sequestration: false,
      provider: 'simulation',
    };
  }

  const score = Math.round(450 + rand() * 500);
  const accountsTotal = Math.round(rand() * 12);
  const distress = score < 600;
  const accountsInArrears = distress ? Math.round(rand() * Math.max(1, accountsTotal)) : Math.round(rand() * 1.4);

  return {
    status: 'completed',
    score,
    accountsTotal,
    accountsInArrears,
    worstArrearsMonths: accountsInArrears > 0 ? Math.round(1 + rand() * 5) : 0,
    monthlyDebtObligationsCents: Math.round(rand() * 1_200_000),
    judgments: distress && rand() < 0.3 ? Math.round(1 + rand() * 2) : 0,
    defaults: distress && rand() < 0.4 ? Math.round(1 + rand() * 3) : 0,
    adminOrder: distress && rand() < 0.08,
    debtReview: distress && rand() < 0.12,
    sequestration: distress && rand() < 0.03,
    provider: 'simulation',
  };
}

// Produces a deterministic unit-length descriptor from a sample
// reference. Two captures tagged with the same subjectSeed land close
// together; different subjects land far apart — which is the property
// the matching pipeline needs in order to be exercised at all.
export async function templateFromSample(
  modality: string,
  sampleRef: string,
  descriptorLength: number,
  subjectSeed: string,
  drift = 0.08,
): Promise<BiometricCaptureResult> {
  const baseRand = mulberry32(await seedFrom(`bio:${modality}:${subjectSeed}`));
  const noiseRand = mulberry32(await seedFrom(`noise:${modality}:${sampleRef}`));

  const vec: number[] = [];
  for (let i = 0; i < descriptorLength; i++) {
    const base = baseRand() * 2 - 1;
    const noise = (noiseRand() * 2 - 1) * drift;
    vec.push(base + noise);
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;

  return {
    descriptor: vec.map((v) => Number((v / norm).toFixed(6))),
    qualityScore: Number((60 + noiseRand() * 40).toFixed(2)),
    provider: 'simulation',
  };
}

export async function livenessCheck(sampleRef: string): Promise<LivenessResult> {
  const rand = mulberry32(await seedFrom(`liveness:${sampleRef}`));
  const roll = rand();
  let attackType = 'none';
  if (roll < 0.03) attackType = 'screen_replay';
  else if (roll < 0.05) attackType = 'print';
  else if (roll < 0.06) attackType = 'mask_3d';
  else if (roll < 0.065) attackType = 'deepfake';

  const passed = attackType === 'none';
  return {
    score: Number((passed ? 75 + rand() * 25 : rand() * 40).toFixed(2)),
    passed,
    padLevel: 2,
    attackType,
    provider: 'simulation',
  };
}
