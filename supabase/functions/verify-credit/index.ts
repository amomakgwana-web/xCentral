// ══════════════════════════════════════════════════════════════
// Credit verification.
//
// Two checks with different characters:
//
//   bureau_enquiry  provider data. Gated on a live credit_enquiry
//                   consent, which the database enforces on insert —
//                   this function checks first only so the caller
//                   gets a clear 403 instead of a constraint error.
//   affordability   our own arithmetic, per NCA Regulation 23A,
//                   computed by assess_affordability() in Postgres so
//                   the console, the API and reporting cannot drift.
//
// A hard enquiry marks the subject's bureau record, so it is opt-in
// per request and idempotent per case: re-running does not re-pull.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';
import { ensureCase, recordCheck, refreshCase } from '../_shared/cases.ts';
import { activeProvider, assertLiveProvider, creditBureauEnquiry } from '../_shared/providers.ts';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'credit');
  if (denied) return denied;

  const {
    caseId,
    bureauId = 'transunion_za',
    enquiryType = 'soft',
    purpose = 'onboarding',
    // Affordability inputs, in cents. Omit to run the bureau enquiry alone.
    grossIncomeCents,
    statutoryDeductionsCents = 0,
    declaredExpensesCents = 0,
    proposedInstalmentCents = 0,
    incomeVerified = false,
    incomeSource,
    platformId = 'xcentral_console',
  } = body ?? {};

  if (!caseId) return json({ error: 'caseId is required' }, 400);
  if (!['soft', 'hard'].includes(enquiryType)) {
    return json({ error: "enquiryType must be 'soft' or 'hard'" }, 400);
  }

  const admin = staff.admin;

  try {
    const kase = await ensureCase(admin, { caseId, subjectId: body?.subjectId, platformId });
    const subjectId = kase.subject_id;
    if (!subjectId) return json({ error: `Case ${kase.id} has no subject to enquire about` }, 400);

    // The database will refuse the insert without consent; checking
    // here turns a constraint violation into an answerable error.
    const { data: consented } = await admin.rpc('has_active_consent', {
      p_subject_id: subjectId, p_purpose: 'credit_enquiry',
    });
    if (!consented) {
      return json({
        error: 'No active credit_enquiry consent on record for this subject',
        code: 'consent_required',
        remedy: 'Capture consent through record-consent before running a bureau enquiry',
      }, 403);
    }

    // A hard enquiry costs the subject something, so never run one twice.
    if (enquiryType === 'hard') {
      const { data: existing } = await admin
        .from('credit_checks')
        .select('id, created_at')
        .eq('case_id', kase.id)
        .eq('bureau_id', bureauId)
        .eq('enquiry_type', 'hard')
        .maybeSingle();
      if (existing) {
        return json({
          error: `A hard enquiry against ${bureauId} already exists for case ${kase.id}`,
          code: 'duplicate_hard_enquiry',
          creditCheckId: existing.id,
        }, 409);
      }
    }

    const { data: subject } = await admin
      .from('subjects').select('id_hash').eq('id', subjectId).single();

    // ── 1. Bureau enquiry. ───────────────────────────────────────
    const provider = activeProvider('credit');
    assertLiveProvider(provider, platformId === 'xcentral_console' ? 'sandbox' : 'production');

    const started = Date.now();
    const bureau = await creditBureauEnquiry(subject.id_hash, bureauId);

    let band: string | null = null;
    let risk: string | null = null;
    if (bureau.score !== null) {
      const { data: banded } = await admin.rpc('credit_band', { bureau: bureauId, score: bureau.score });
      band = banded?.[0]?.band ?? null;
      risk = banded?.[0]?.risk ?? null;
    }

    const adverse = bureau.judgments > 0 || bureau.defaults > 0
      || bureau.adminOrder || bureau.debtReview || bureau.sequestration;

    const bureauReasons: string[] = [];
    if (bureau.status === 'no_record') bureauReasons.push('no_bureau_record');
    if (bureau.judgments > 0) bureauReasons.push('judgments_on_record');
    if (bureau.defaults > 0) bureauReasons.push('defaults_on_record');
    if (bureau.adminOrder) bureauReasons.push('administration_order');
    if (bureau.debtReview) bureauReasons.push('under_debt_review');
    if (bureau.sequestration) bureauReasons.push('sequestration');

    const { data: creditCheck, error: ccErr } = await admin
      .from('credit_checks')
      .insert({
        case_id: kase.id,
        subject_id: subjectId,
        bureau_id: bureauId,
        enquiry_type: enquiryType,
        purpose,
        score: bureau.score,
        band,
        risk,
        accounts_total: bureau.accountsTotal,
        accounts_in_arrears: bureau.accountsInArrears,
        worst_arrears_months: bureau.worstArrearsMonths,
        monthly_debt_obligations_cents: bureau.monthlyDebtObligationsCents,
        judgments: bureau.judgments,
        defaults: bureau.defaults,
        admin_order: bureau.adminOrder,
        debt_review: bureau.debtReview,
        sequestration: bureau.sequestration,
        status: bureau.status,
        reason_codes: bureauReasons,
        raw_summary: { provider, retrieved_at: new Date().toISOString() },
      })
      .select()
      .single();
    if (ccErr) return json({ error: `Could not record bureau enquiry: ${ccErr.message}` }, 500);

    // Debt review and sequestration are legal states, not risk
    // opinions — they fail the check rather than shading a score.
    const bureauStatus = (bureau.debtReview || bureau.sequestration || bureau.adminOrder)
      ? 'failed'
      : bureau.status === 'no_record'
        ? 'manual_review'
        : adverse ? 'manual_review' : 'passed';

    const bureauCheckId = await recordCheck(admin, {
      caseId: kase.id,
      domain: 'credit',
      checkType: 'bureau_enquiry',
      provider,
      status: bureauStatus,
      // Bureau scores run 0-999; the case scale is 0-100.
      score: bureau.score === null ? null : Math.round((bureau.score / 999) * 100),
      result: {
        bureau: bureauId, enquiry_type: enquiryType, raw_score: bureau.score, band, risk,
        accounts_total: bureau.accountsTotal, accounts_in_arrears: bureau.accountsInArrears,
        judgments: bureau.judgments, defaults: bureau.defaults,
        admin_order: bureau.adminOrder, debt_review: bureau.debtReview,
        sequestration: bureau.sequestration,
      },
      reasonCodes: bureauReasons,
      runBy: staff.userId,
      latencyMs: Date.now() - started,
    });

    await admin.from('credit_checks').update({ check_id: bureauCheckId }).eq('id', creditCheck.id);

    // ── 2. Affordability, when income was supplied. ──────────────
    let affordability: any = null;
    if (grossIncomeCents !== undefined && grossIncomeCents !== null) {
      // Existing obligations come from the bureau where it has them,
      // because a self-declared debt figure is the one most often understated.
      const existingObligations = bureau.monthlyDebtObligationsCents ?? 0;

      const { data: assessed, error: aErr } = await admin.rpc('assess_affordability', {
        p_gross_income_cents: Number(grossIncomeCents),
        p_statutory_deductions_cents: Number(statutoryDeductionsCents),
        p_declared_expenses_cents: Number(declaredExpensesCents),
        p_existing_obligations_cents: existingObligations,
        p_proposed_instalment_cents: Number(proposedInstalmentCents),
        p_income_verified: !!incomeVerified,
        p_as_at: new Date().toISOString().slice(0, 10),
      });
      if (aErr) return json({ error: `Affordability assessment failed: ${aErr.message}` }, 500);
      affordability = assessed;

      const affordabilityCheckId = await recordCheck(admin, {
        caseId: kase.id,
        domain: 'credit',
        checkType: 'affordability',
        provider: 'xcentral',
        status: affordability.outcome === 'affordable'
          ? 'passed'
          : affordability.outcome === 'not_affordable'
            ? 'failed'
            : 'manual_review',
        score: affordability.outcome === 'affordable' ? 100
             : affordability.outcome === 'marginal' ? 60
             : affordability.outcome === 'insufficient_data' ? 40 : 0,
        result: affordability,
        reasonCodes: affordability.reason_codes ?? [],
        runBy: staff.userId,
      });

      await admin.from('affordability_assessments').insert({
        case_id: kase.id,
        check_id: affordabilityCheckId,
        subject_id: subjectId,
        gross_income_cents: Number(grossIncomeCents),
        statutory_deductions_cents: Number(statutoryDeductionsCents),
        net_income_cents: affordability.net_income_cents ?? 0,
        income_verified: !!incomeVerified,
        income_source: incomeSource ?? null,
        declared_expenses_cents: Number(declaredExpensesCents),
        minimum_expenses_cents: affordability.minimum_expenses_cents ?? null,
        applied_expenses_cents: affordability.applied_expenses_cents ?? null,
        existing_obligations_cents: existingObligations,
        proposed_instalment_cents: Number(proposedInstalmentCents),
        discretionary_income_cents: affordability.discretionary_income_cents ?? null,
        outcome: affordability.outcome,
        reason_codes: affordability.reason_codes ?? [],
      });
    }

    const { case: refreshed, scoring } = await refreshCase(admin, kase.id);

    await audit(admin, {
      actorId: staff.userId,
      action: 'credit.enquiry',
      entityType: 'verification_case',
      entityId: kase.id,
      metadata: {
        bureau: bureauId, enquiry_type: enquiryType, band,
        affordability_outcome: affordability?.outcome ?? null,
        ip: clientIp(req),
      },
    });

    return json({
      caseId: refreshed.id,
      status: refreshed.status,
      score: refreshed.score,
      credit: {
        bureau: bureauId,
        enquiryType,
        status: bureau.status,
        score: bureau.score,
        band,
        risk,
        accountsTotal: bureau.accountsTotal,
        accountsInArrears: bureau.accountsInArrears,
        judgments: bureau.judgments,
        defaults: bureau.defaults,
        adminOrder: bureau.adminOrder,
        debtReview: bureau.debtReview,
        sequestration: bureau.sequestration,
        reasonCodes: bureauReasons,
      },
      affordability,
      scoring,
    });
  } catch (e) {
    console.error('verify-credit failed', e);
    return json({ error: e instanceof Error ? e.message : 'Credit verification failed' }, 500);
  }
});
