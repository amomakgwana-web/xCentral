import { supabase, XC_ENV, XC_CONFIGURED } from './supabaseClient.js';

// ══════════════════════════════════════════════════════════════
// Bridges the Supabase backend into the console UI, exposed as
// window.XC_DB — the same pattern BipraPay uses for window.SP_DB, so
// the two consoles stay recognisably the same codebase to work on.
//
// Note what is NOT in this file, and cannot be: there is no function
// to read a biometric template, fetch a document image, or retrieve
// an identity number. Those are not omissions to be filled in later —
// the browser has no path to that data by design, and anything
// needing it goes through an edge function that checks a permission
// and writes an audit entry first.
// ══════════════════════════════════════════════════════════════

const centsToRand = (c) => Math.round(Number(c) || 0) / 100;
const randToCents = (r) => Math.round(Number(r) * 100);

// ── Client-side observability ───────────────────────────────────
// Wrapping invoke once catches API failures from every flow without
// touching each call site.
if (supabase) {
  const rawInvoke = supabase.functions.invoke.bind(supabase.functions);
  supabase.functions.invoke = async (name, opts) => {
    const res = await rawInvoke(name, opts);
    if (res.error) console.error(`[xCentral] ${name} failed`, res.error);
    return res;
  };
}

function requireClient() {
  if (!supabase) {
    throw new Error(
      'xCentral is not pointed at a Supabase project. Set VITE_SUPABASE_URL_SANDBOX and VITE_SUPABASE_KEY_SANDBOX.',
    );
  }
  return supabase;
}

async function invoke(name, body) {
  const db = requireClient();
  const { data, error } = await db.functions.invoke(name, { body });
  if (error) {
    // Edge functions return a JSON body with the real reason; the
    // SDK's error alone is usually just "non-2xx status".
    let detail = error.message;
    try {
      const parsed = await error.context?.json?.();
      if (parsed?.error) detail = parsed.error;
    } catch { /* keep the original message */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function select(table, build) {
  const db = requireClient();
  let q = db.from(table).select('*');
  if (build) q = build(q);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ── Auth ────────────────────────────────────────────────────────
async function signIn(email, password) {
  const db = requireClient();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  const db = requireClient();
  const { error } = await db.auth.signOut();
  if (error) throw error;
}

async function getProfile() {
  const db = requireClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data, error } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

async function hasPermission(perm) {
  const db = requireClient();
  const { data, error } = await db.rpc('has_permission', { perm });
  if (error) return false;
  return !!data;
}

// ── Cases ───────────────────────────────────────────────────────
function mapCase(row) {
  return {
    id: row.id,
    subjectId: row.subject_id,
    platform: row.platform_id,
    reference: row.client_reference,
    purpose: row.purpose,
    level: row.level,
    status: row.status,
    risk: row.risk,
    score: row.score,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

async function fetchCases({ status, platform, limit = 100 } = {}) {
  const rows = await select('verification_cases', (q) => {
    let query = q.order('created_at', { ascending: false }).limit(limit);
    if (status) query = query.eq('status', status);
    if (platform) query = query.eq('platform_id', platform);
    return query;
  });
  return rows.map(mapCase);
}

async function fetchCase(caseId) {
  const db = requireClient();
  const [{ data: kase }, checks, identity, documents, credit, affordability, biometrics, hits] =
    await Promise.all([
      db.from('verification_cases').select('*').eq('id', caseId).maybeSingle(),
      select('verification_checks', (q) => q.eq('case_id', caseId).order('created_at', { ascending: true })),
      select('identity_verifications', (q) => q.eq('case_id', caseId)),
      select('document_verifications', (q) => q.eq('case_id', caseId)),
      select('credit_checks', (q) => q.eq('case_id', caseId)),
      select('affordability_assessments', (q) => q.eq('case_id', caseId)),
      select('biometric_verifications', (q) => q.eq('case_id', caseId)),
      select('watchlist_hits', (q) => q.eq('case_id', caseId)),
    ]);

  if (!kase) return null;

  let subject = null;
  if (kase.subject_id) {
    const { data } = await db.from('subjects').select('*').eq('id', kase.subject_id).maybeSingle();
    subject = data;
  }

  return {
    ...mapCase(kase),
    subject,
    checks,
    identity,
    documents,
    credit,
    affordability,
    biometrics,
    watchlistHits: hits,
  };
}

async function scoreCase(caseId) {
  const db = requireClient();
  const { data, error } = await db.rpc('case_score', { p_case_id: caseId });
  if (error) throw error;
  return data;
}

// ── Verification actions ────────────────────────────────────────
const verifyIdentity  = (payload) => invoke('verify-identity', payload);
const verifyDocument  = (payload) => invoke('verify-document', payload);
const verifyCredit    = (payload) => invoke('verify-credit', payload);
const verifyBiometric = (payload) => invoke('verify-biometric', payload);
const decideCase      = (payload) => invoke('case-decision', payload);
const grantConsent    = (payload) => invoke('record-consent', { action: 'grant', ...payload });
const withdrawConsent = (consentId, reason) => invoke('record-consent', { action: 'withdraw', consentId, reason });
const openDocument    = (documentId, reason) => invoke('document-access', { documentId, reason });
const issueApiKey     = (payload) => invoke('manage-api-key', { action: 'create', ...payload });
const revokeApiKey    = (keyId) => invoke('manage-api-key', { action: 'revoke', keyId });

// Uploads a document to the private bucket, then verifies it.
// The hash is computed in the browser so the stored object can later
// be proven unaltered without re-reading it through a signed URL.
async function uploadAndVerifyDocument({ caseId, subjectId, docType, file, claimedName, mrz, dateOfIssue, dateOfExpiry }) {
  const db = requireClient();

  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const path = `${caseId}/${docType}/${sha256.slice(0, 16)}-${Date.now()}`;
  const { error: upErr } = await db.storage
    .from('verification-documents')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;

  return await verifyDocument({
    caseId, subjectId, docType, storagePath: path, sha256,
    mimeType: file.type, sizeBytes: file.size,
    claimedName, mrz, dateOfIssue, dateOfExpiry,
  });
}

// ── Reference data ──────────────────────────────────────────────
const fetchPlatforms    = () => select('client_platforms', (q) => q.order('name'));
const fetchSubjects     = (limit = 100) => select('subjects', (q) => q.order('created_at', { ascending: false }).limit(limit));
const fetchConsents     = (subjectId) => select('consents', (q) => subjectId ? q.eq('subject_id', subjectId).order('granted_at', { ascending: false }) : q.order('granted_at', { ascending: false }).limit(200));
const fetchConsentTexts = () => select('consent_texts', (q) => q.is('retired_at', null).order('purpose'));
const fetchWatchlist    = () => select('watchlist_entries', (q) => q.eq('active', true).order('full_name'));
const fetchWatchlistHits= () => select('watchlist_hits', (q) => q.order('created_at', { ascending: false }).limit(200));
const fetchApiKeys      = () => select('api_keys', (q) => q.order('created_at', { ascending: false }));
const fetchApiRequests  = (limit = 200) => select('api_requests', (q) => q.order('created_at', { ascending: false }).limit(limit));
const fetchAuditLog     = (limit = 200) => select('audit_log', (q) => q.order('created_at', { ascending: false }).limit(limit));
const fetchDsarRequests = () => select('dsar_requests', (q) => q.order('received_at', { ascending: false }));
const fetchRetentionPolicies = () => select('retention_policies', (q) => q.eq('active', true).order('entity'));
const fetchModalities   = () => select('biometric_modalities', (q) => q.order('name'));
const fetchDuplicateFlags = () => select('biometric_duplicate_flags', (q) => q.order('created_at', { ascending: false }).limit(100));
const fetchWebhookEndpoints = () => select('webhook_endpoints', (q) => q.order('created_at', { ascending: false }));
const fetchWebhookDeliveries = (limit = 100) => select('webhook_deliveries', (q) => q.order('created_at', { ascending: false }).limit(limit));
const fetchRequirements = () => select('verification_requirements', (q) => q.order('level').order('domain'));
const fetchBureaus      = () => select('credit_bureaus', (q) => q.eq('active', true).order('name'));
const fetchDocumentTypes= () => select('document_types', (q) => q.eq('active', true).order('category'));

// Validates an SA ID without opening a case — the check-digit
// arithmetic only, for the console's inline validator.
async function validateSaId(idNumber) {
  const db = requireClient();
  const { data, error } = await db.rpc('validate_sa_id', { id_number: idNumber });
  if (error) throw error;
  return data;
}

async function previewAffordability(input) {
  const db = requireClient();
  const { data, error } = await db.rpc('assess_affordability', {
    p_gross_income_cents: randToCents(input.grossIncome),
    p_statutory_deductions_cents: randToCents(input.deductions ?? 0),
    p_declared_expenses_cents: randToCents(input.expenses ?? 0),
    p_existing_obligations_cents: randToCents(input.existingObligations ?? 0),
    p_proposed_instalment_cents: randToCents(input.instalment ?? 0),
    p_income_verified: !!input.incomeVerified,
  });
  if (error) throw error;
  return data;
}

// ── Dashboard aggregates ────────────────────────────────────────
async function fetchDashboard() {
  const cases = await fetchCases({ limit: 500 });
  const byStatus = cases.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  const decided = cases.filter((c) => ['verified', 'rejected'].includes(c.status));
  const verified = cases.filter((c) => c.status === 'verified').length;

  return {
    total: cases.length,
    byStatus,
    verified,
    // Pass rate over decided cases only: counting cases still in
    // flight would make the rate drift with queue depth rather than
    // with how the pipeline is actually performing.
    passRate: decided.length > 0 ? Math.round((verified / decided.length) * 100) : null,
    needsReview: byStatus.review ?? 0,
    inProgress: byStatus.in_progress ?? 0,
    recent: cases.slice(0, 12),
  };
}

// ── Realtime ────────────────────────────────────────────────────
function subscribeCases(onChange) {
  const db = requireClient();
  return db.channel('verification_cases_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'verification_cases' },
        (p) => onChange(mapCase(p.new ?? p.old)))
    .subscribe();
}

window.XC_DB = {
  env: XC_ENV,
  configured: XC_CONFIGURED,
  centsToRand,
  randToCents,
  signIn,
  signOut,
  getProfile,
  hasPermission,
  fetchCases,
  fetchCase,
  scoreCase,
  fetchDashboard,
  verifyIdentity,
  verifyDocument,
  verifyCredit,
  verifyBiometric,
  uploadAndVerifyDocument,
  decideCase,
  grantConsent,
  withdrawConsent,
  openDocument,
  issueApiKey,
  revokeApiKey,
  validateSaId,
  previewAffordability,
  fetchPlatforms,
  fetchSubjects,
  fetchConsents,
  fetchConsentTexts,
  fetchWatchlist,
  fetchWatchlistHits,
  fetchApiKeys,
  fetchApiRequests,
  fetchAuditLog,
  fetchDsarRequests,
  fetchRetentionPolicies,
  fetchModalities,
  fetchDuplicateFlags,
  fetchWebhookEndpoints,
  fetchWebhookDeliveries,
  fetchRequirements,
  fetchBureaus,
  fetchDocumentTypes,
  subscribeCases,
};

window.dispatchEvent(new Event('xc-db-ready'));
