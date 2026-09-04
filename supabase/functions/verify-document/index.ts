// ══════════════════════════════════════════════════════════════
// Document verification.
//
// Three checks, in descending order of how much they can be trusted
// without a provider:
//
//   document_expiry        pure date arithmetic against the type's
//                          own rules. An expired ID is expired
//                          whatever any provider says.
//   document_authenticity  MRZ check digits where the type carries an
//                          MRZ (decidable here), plus provider tamper
//                          analysis of the image (not).
//   name_match             the name on the document against the name
//                          claimed, scored by the same function the
//                          identity domain uses.
//
// The document image must already be in the private bucket; this
// function is given its path, never its bytes.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';
import { ensureCase, recordCheck, refreshCase } from '../_shared/cases.ts';
import { activeProvider, assertLiveProvider, analyseDocument } from '../_shared/providers.ts';
import { parseMrz } from '../_shared/mrz.ts';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'documents');
  if (denied) return denied;

  const {
    caseId, subjectId, docType, storagePath, sha256,
    mimeType, sizeBytes, pageCount = 1,
    mrz, claimedName, dateOfIssue, dateOfExpiry, documentNumber,
    platformId = 'xcentral_console', level = 'standard',
  } = body ?? {};

  if (!caseId) return json({ error: 'caseId is required' }, 400);
  if (!docType) return json({ error: 'docType is required' }, 400);
  if (!storagePath) return json({ error: 'storagePath is required' }, 400);
  if (!sha256) return json({ error: 'sha256 of the stored object is required' }, 400);

  const admin = staff.admin;

  try {
    const { data: type } = await admin
      .from('document_types').select('*').eq('id', docType).maybeSingle();
    if (!type) return json({ error: `Unknown document type '${docType}'` }, 400);
    if (!type.active) return json({ error: `Document type '${docType}' is no longer accepted` }, 400);

    const kase = await ensureCase(admin, { caseId, subjectId, platformId, level });

    // Retention is set from the policy table, not guessed at insert.
    const { data: policy } = await admin
      .from('retention_policies').select('retain_days').eq('id', 'doc_images').maybeSingle();
    const retention = new Date();
    retention.setUTCDate(retention.getUTCDate() + (policy?.retain_days ?? 1825));

    const { data: doc, error: docErr } = await admin
      .from('documents')
      .insert({
        case_id: kase.id,
        subject_id: subjectId ?? kase.subject_id,
        doc_type: docType,
        storage_path: storagePath,
        mime_type: mimeType ?? null,
        size_bytes: sizeBytes ?? null,
        page_count: pageCount,
        sha256,
        uploaded_by: staff.userId,
        uploaded_via: 'console',
        retention_until: retention.toISOString(),
      })
      .select()
      .single();
    if (docErr) return json({ error: `Could not record document: ${docErr.message}` }, 500);

    // ── MRZ, where the type carries one. ─────────────────────────
    let mrzResult: ReturnType<typeof parseMrz> | null = null;
    if (type.has_mrz && mrz) mrzResult = parseMrz(mrz);

    // Dates: the MRZ is authoritative over anything typed in, because
    // it is check-digit protected and a keyed-in date is not.
    const expiry = mrzResult?.fields?.date_of_expiry ?? dateOfExpiry ?? null;
    const issue = dateOfIssue ?? null;

    // ── 1. Expiry and staleness. ─────────────────────────────────
    const today = new Date();
    const expired = expiry ? new Date(String(expiry)) < today : false;

    // A document that proves a current state (an address, an income)
    // goes stale on its issue date; an ID card does not.
    let stale = false;
    if (type.max_age_days && issue) {
      const ageDays = (today.getTime() - new Date(String(issue)).getTime()) / 86_400_000;
      stale = ageDays > type.max_age_days;
    }

    const expiryReasons: string[] = [];
    if (expired) expiryReasons.push('document_expired');
    if (stale) expiryReasons.push('document_stale');
    if (!expiry && !issue && type.max_age_days) expiryReasons.push('document_date_missing');

    await recordCheck(admin, {
      caseId: kase.id,
      domain: 'document',
      checkType: 'document_expiry',
      provider: 'xcentral',
      status: (expired || stale) ? 'failed' : (expiryReasons.length > 0 ? 'manual_review' : 'passed'),
      score: (expired || stale) ? 0 : (expiryReasons.length > 0 ? 50 : 100),
      result: { date_of_expiry: expiry, date_of_issue: issue, expired, stale, max_age_days: type.max_age_days },
      reasonCodes: expiryReasons,
      runBy: staff.userId,
    });

    // ── 2. Authenticity: MRZ arithmetic plus provider analysis. ──
    const provider = activeProvider('document');
    assertLiveProvider(provider, platformId === 'xcentral_console' ? 'sandbox' : 'production');

    const started = Date.now();
    const analysis = await analyseDocument(sha256, docType);

    const authenticityReasons = [...analysis.tamperSignals.map((s) => s.code)];
    let authenticityScore = analysis.authenticityScore;

    if (type.has_mrz) {
      if (!mrzResult) {
        authenticityReasons.push('mrz_not_supplied');
        // Missing evidence is not evidence of forgery; it caps the
        // score and sends the document to a human.
        authenticityScore = Math.min(authenticityScore, 55);
      } else if (!mrzResult.valid) {
        authenticityReasons.push(...mrzResult.reasonCodes);
        // A failed MRZ check digit is arithmetic, not opinion.
        authenticityScore = 0;
      }
    }

    const critical = analysis.tamperSignals.some((s) => s.severity === 'critical');
    const authenticityStatus = (critical || (type.has_mrz && mrzResult && !mrzResult.valid))
      ? 'failed'
      : authenticityScore >= 75 ? 'passed' : 'manual_review';

    const authenticityCheckId = await recordCheck(admin, {
      caseId: kase.id,
      domain: 'document',
      checkType: 'document_authenticity',
      provider,
      status: authenticityStatus,
      score: authenticityScore,
      result: {
        mrz_present: !!mrzResult,
        mrz_valid: mrzResult?.valid ?? null,
        mrz_check_digits: mrzResult?.checkDigits ?? null,
        tamper_signals: analysis.tamperSignals,
      },
      reasonCodes: authenticityReasons,
      runBy: staff.userId,
      latencyMs: Date.now() - started,
    });

    // ── 3. Name on the document against the name claimed. ────────
    let nameScore: number | null = null;
    const documentName = mrzResult
      ? [mrzResult.fields.given_names, mrzResult.fields.surname].filter(Boolean).join(' ')
      : (body?.documentName ?? null);

    if (documentName && claimedName) {
      const { data } = await admin.rpc('name_match_score', { a: claimedName, b: documentName });
      nameScore = data === null ? null : Number(data);

      await recordCheck(admin, {
        caseId: kase.id,
        domain: 'document',
        checkType: 'name_match',
        provider: 'xcentral',
        status: (nameScore ?? 0) >= 85 ? 'passed' : (nameScore ?? 0) >= 65 ? 'manual_review' : 'failed',
        score: nameScore,
        result: { claimed_name: claimedName, document_name: documentName },
        reasonCodes: (nameScore ?? 0) >= 85 ? [] : ['document_name_mismatch'],
        runBy: staff.userId,
      });
    } else {
      await recordCheck(admin, {
        caseId: kase.id,
        domain: 'document',
        checkType: 'name_match',
        provider: 'xcentral',
        status: 'skipped',
        score: null,
        result: { reason: 'No name available from the document or the claim' },
        reasonCodes: ['name_not_comparable'],
        runBy: staff.userId,
      });
    }

    await admin.from('document_verifications').insert({
      case_id: kase.id,
      check_id: authenticityCheckId,
      document_id: doc.id,
      doc_type: docType,
      mrz_present: !!mrzResult,
      mrz_valid: mrzResult?.valid ?? null,
      mrz_fields: mrzResult?.fields ?? {},
      extracted: { document_name: documentName, document_number_supplied: !!documentNumber },
      document_number_last4: String(mrzResult?.fields?.document_number ?? documentNumber ?? '').slice(-4) || null,
      date_of_issue: issue,
      date_of_expiry: expiry,
      expired,
      stale,
      authenticity_score: authenticityScore,
      tamper_signals: analysis.tamperSignals,
      provider,
      status: authenticityStatus,
      reason_codes: authenticityReasons,
    });

    const { case: refreshed, scoring } = await refreshCase(admin, kase.id);

    await audit(admin, {
      actorId: staff.userId,
      action: 'document.verified',
      entityType: 'document',
      entityId: doc.id,
      metadata: {
        case_id: kase.id, doc_type: docType, sha256,
        mrz_valid: mrzResult?.valid ?? null,
        authenticity_score: authenticityScore,
        ip: clientIp(req),
      },
    });

    return json({
      caseId: refreshed.id,
      documentId: doc.id,
      status: refreshed.status,
      score: refreshed.score,
      document: {
        docType,
        mrzPresent: !!mrzResult,
        mrzValid: mrzResult?.valid ?? null,
        mrzFields: mrzResult?.fields ?? null,
        expired,
        stale,
        dateOfExpiry: expiry,
        authenticityScore,
        tamperSignals: analysis.tamperSignals,
        nameMatchScore: nameScore,
        reasonCodes: authenticityReasons,
      },
      scoring,
    });
  } catch (e) {
    console.error('verify-document failed', e);
    return json({ error: e instanceof Error ? e.message : 'Document verification failed' }, 500);
  }
});
