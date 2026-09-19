// ══════════════════════════════════════════════════════════════
// How much credit can this customer be given.
//
// The computation lives in Postgres so the console, this endpoint and
// any report cannot disagree. What this function adds is persistence:
// the assessment is stored with the inputs it used, because under the
// NCA a decision has to be explicable months later, and recomputing it
// against today's data would not answer the question that was asked.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'credit');
  if (denied) return denied;

  const {
    customerId,
    agreementType = 'instalment_sale',
    termMonths = 60,
    ratePct = 15.0,
    balloonCents = 0,
    caseId,
    persist = true,
  } = body ?? {};

  if (!customerId) return json({ error: 'customerId is required' }, 400);

  const admin = staff.admin;

  try {
    const { data: customer } = await admin
      .from('customers').select('id, platform_id').eq('id', customerId).maybeSingle();
    if (!customer) return json({ error: `Customer ${customerId} not found` }, 404);

    const { data: assessment, error } = await admin.rpc('assess_credit_capacity', {
      p_customer_id: customerId,
      p_agreement_type: agreementType,
      p_term_months: termMonths,
      p_rate_pct: ratePct,
      p_balloon_cents: balloonCents,
    });
    if (error) return json({ error: `Assessment failed: ${error.message}` }, 500);

    // An assessment that could not be made is not stored as a decision,
    // because "we didn't know" is not a lending outcome to point at later.
    let assessmentId: string | null = null;
    if (persist && assessment?.decision !== 'insufficient_data') {
      const { data: policy } = await admin
        .from('credit_policies').select('id')
        .eq('platform_id', customer.platform_id)
        .eq('agreement_type', agreementType)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: stored, error: storeErr } = await admin
        .from('credit_assessments')
        .insert({
          customer_id: customerId,
          case_id: caseId ?? null,
          policy_id: policy?.id ?? null,
          agreement_type: agreementType,
          net_income_cents: assessment.net_income_cents ?? null,
          discretionary_income_cents: assessment.discretionary_income_cents ?? null,
          existing_instalments_cents: assessment.existing_instalments_cents ?? 0,
          existing_exposure_cents: assessment.existing_exposure_cents ?? 0,
          bureau_score: assessment.bureau_score ?? null,
          bureau_band: assessment.bureau_band ?? null,
          behaviour_score: assessment.behaviour_score ?? null,
          fraud_score: assessment.fraud_score ?? null,
          max_instalment_cents: assessment.max_instalment_cents ?? null,
          max_principal_cents: assessment.max_principal_cents ?? null,
          recommended_limit_cents: assessment.recommended_limit_cents ?? null,
          assumed_rate_pct: assessment.assumed_rate_pct ?? ratePct,
          assumed_term_months: assessment.assumed_term_months ?? termMonths,
          risk_grade: assessment.risk_grade ?? null,
          decision: assessment.decision,
          reason_codes: assessment.reason_codes ?? [],
          workings: assessment.workings ?? {},
          assessed_by: staff.userId,
        })
        .select('id')
        .single();
      if (storeErr) return json({ error: `Could not store assessment: ${storeErr.message}` }, 500);
      assessmentId = stored.id;
    }

    await audit(admin, {
      actorId: staff.userId,
      action: 'credit.capacity_assessed',
      entityType: 'customer',
      entityId: customerId,
      metadata: {
        decision: assessment?.decision,
        risk_grade: assessment?.risk_grade,
        recommended_limit_cents: assessment?.recommended_limit_cents,
        agreement_type: agreementType,
        ip: clientIp(req),
      },
    });

    return json({ customerId, assessmentId, ...assessment });
  } catch (e) {
    console.error('assess-credit-capacity failed', e);
    return json({ error: e instanceof Error ? e.message : 'Capacity assessment failed' }, 500);
  }
});
