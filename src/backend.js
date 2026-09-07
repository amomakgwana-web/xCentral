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


// ── Customers, contracts, payments, fraud ───────────────────────
// Reads go straight to the tables; anything that decides, moves money
// or changes a customer's standing goes through an edge function that
// checks a permission and writes an audit entry first.

const fetchCustomers = (platform) => select('customers', (q) => {
  let query = q.order('created_at', { ascending: false }).limit(300);
  if (platform) query = query.eq('platform_id', platform);
  return query;
});

// The whole 360 view in one call — identity, contact, employment,
// bureau, behaviour, portfolio, fraud and the latest credit decision.
async function fetchCustomerProfile(customerId) {
  const db = requireClient();
  const { data, error } = await db.rpc('customer_profile', { p_customer_id: customerId });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

async function creditCapacity(customerId, { agreementType = 'instalment_sale',
  termMonths = 60, ratePct = 15, balloonCents = 0 } = {}) {
  const db = requireClient();
  const { data, error } = await db.rpc('assess_credit_capacity', {
    p_customer_id: customerId,
    p_agreement_type: agreementType,
    p_term_months: termMonths,
    p_rate_pct: ratePct,
    p_balloon_cents: balloonCents,
  });
  if (error) throw error;
  return data;
}

async function paymentBehaviour(customerId) {
  const db = requireClient();
  const { data, error } = await db.rpc('payment_behaviour', { p_customer_id: customerId });
  if (error) throw error;
  return data;
}

const fetchContracts = (opts = {}) => select('contracts', (q) => {
  let query = q.order('created_at', { ascending: false }).limit(300);
  if (opts.customerId) query = query.eq('customer_id', opts.customerId);
  if (opts.status) query = query.eq('status', opts.status);
  return query;
});

const fetchAssets = (platform) => select('assets', (q) => {
  let query = q.order('created_at', { ascending: false }).limit(300);
  if (platform) query = query.eq('platform_id', platform);
  return query;
});

const fetchSchedule = (contractId) => select('payment_schedule',
  (q) => q.eq('contract_id', contractId).order('instalment_no'));

const fetchPayments = (opts = {}) => select('payments', (q) => {
  let query = q.order('paid_at', { ascending: false }).limit(opts.limit ?? 200);
  if (opts.contractId) query = query.eq('contract_id', opts.contractId);
  if (opts.customerId) query = query.eq('customer_id', opts.customerId);
  return query;
});

const fetchFraudAlerts = (status) => select('fraud_alerts', (q) => {
  let query = q.order('created_at', { ascending: false }).limit(200);
  if (status) query = query.eq('status', status);
  return query;
});

const fetchFraudSignals = (opts = {}) => select('fraud_signals', (q) => {
  let query = q.eq('dismissed', false).order('created_at', { ascending: false }).limit(300);
  if (opts.customerId) query = query.eq('customer_id', opts.customerId);
  if (opts.caseId) query = query.eq('case_id', opts.caseId);
  return query;
});

const fetchFraudRules = () => select('fraud_rules', (q) => q.eq('active', true).order('domain'));
const fetchCreditPolicies = () => select('credit_policies', (q) => q.eq('active', true).order('platform_id'));
const fetchAddresses = (customerId) => select('addresses', (q) => q.eq('customer_id', customerId));
const fetchPhones = (customerId) => select('phone_numbers', (q) => q.eq('customer_id', customerId));
const fetchEmployment = (customerId) => select('employment_records', (q) => q.eq('customer_id', customerId));
const fetchAssessments = (customerId) => select('credit_assessments',
  (q) => q.eq('customer_id', customerId).order('created_at', { ascending: false }));

const onboardCustomer   = (payload) => invoke('customer-onboard', payload);
const vetBackground     = (payload) => invoke('vet-background', payload);
const assessCapacity    = (payload) => invoke('assess-credit-capacity', payload);
const createContract    = (payload) => invoke('manage-contract', { action: 'create', ...payload });
const activateContract  = (contractId) => invoke('manage-contract', { action: 'activate', contractId });
const screenForFraud    = (payload) => invoke('run-fraud-screen', { action: 'screen', ...payload });
const dismissFraudSignal= (signalId, reason) => invoke('run-fraud-screen', { action: 'dismiss_signal', signalId, reason });
const resolveFraudAlert = (alertId, outcome, note) => invoke('run-fraud-screen', { action: 'resolve_alert', alertId, outcome, note });

// Arrears book: every contract behind, worst first. What a collections
// desk opens the morning on.
async function fetchArrearsBook() {
  const rows = await select('contracts', (q) => q
    .in('status', ['in_arrears', 'defaulted', 'legal'])
    .order('months_in_arrears', { ascending: false })
    .limit(200));
  return rows;
}


// ── Live capture and agent adjudication ─────────────────────────
// The capture module itself (camera, quality maths, WebAuthn) is
// src/capture.js and runs entirely in the browser. These are the calls
// that carry its output to the hub.

const openCaptureSession  = (payload) => invoke('capture-intake', { action: 'open', ...payload });
const abandonCaptureSession = (sessionId, reason) => invoke('capture-intake', { action: 'abandon', sessionId, reason });
const submitCapture       = (payload) => invoke('capture-intake', payload);
const adjudicate          = (payload) => invoke('agent-adjudicate', { action: 'adjudicate', ...payload });
const applyAgentDecision  = (runId, outcome, reason) => invoke('agent-adjudicate', { action: 'decide', runId, outcome, reason });

const fetchCaptureSessions = (status) => select('capture_sessions', (q) => {
  let query = q.order('started_at', { ascending: false }).limit(100);
  if (status) query = query.eq('status', status);
  return query;
});

const fetchCaptures = (sessionId) => select('captures',
  (q) => q.eq('session_id', sessionId).order('created_at'));

const fetchAgents = () => select('agents', (q) => q.eq('active', true).order('domain'));

const fetchAgentRuns = (opts = {}) => select('agent_runs', (q) => {
  let query = q.order('created_at', { ascending: false }).limit(100);
  if (opts.sessionId) query = query.eq('session_id', opts.sessionId);
  if (opts.caseId) query = query.eq('case_id', opts.caseId);
  return query;
});

const fetchAgentDecisions = (runId) => select('agent_decisions',
  (q) => q.eq('run_id', runId).order('created_at'));

const fetchQualityRules = () => select('capture_quality_rules',
  (q) => q.eq('active', true).order('capture_type'));

// Assesses capture quality against the same rules the pipeline uses,
// so the wizard can tell an operator to retake before anything is sent.
async function checkCaptureQuality(captureType, m) {
  const db = requireClient();
  const { data, error } = await db.rpc('assess_capture_quality', {
    p_capture_type: captureType,
    p_sharpness: m.sharpness ?? null,
    p_brightness: m.brightness ?? null,
    p_contrast: m.contrast ?? null,
    p_width: m.width ?? null,
    p_height: m.height ?? null,
    p_face_count: m.faceCount ?? null,
    p_face_area_pct: m.faceAreaPct ?? null,
  });
  if (error) throw error;
  return data;
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

  // Customer lifecycle
  fetchCustomers,
  fetchCustomerProfile,
  creditCapacity,
  paymentBehaviour,
  fetchContracts,
  fetchAssets,
  fetchSchedule,
  fetchPayments,
  fetchArrearsBook,
  fetchAddresses,
  fetchPhones,
  fetchEmployment,
  fetchAssessments,
  fetchCreditPolicies,
  onboardCustomer,
  vetBackground,
  assessCapacity,
  createContract,
  activateContract,

  // Live capture and agents
  openCaptureSession,
  abandonCaptureSession,
  submitCapture,
  adjudicate,
  applyAgentDecision,
  fetchCaptureSessions,
  fetchCaptures,
  fetchAgents,
  fetchAgentRuns,
  fetchAgentDecisions,
  fetchQualityRules,
  checkCaptureQuality,

  // Fraud
  fetchFraudAlerts,
  fetchFraudSignals,
  fetchFraudRules,
  screenForFraud,
  dismissFraudSignal,
  resolveFraudAlert,
};

window.dispatchEvent(new Event('xc-db-ready'));
