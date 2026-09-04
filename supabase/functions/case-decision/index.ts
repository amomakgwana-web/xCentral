// ══════════════════════════════════════════════════════════════
// Human decision on a verification case.
//
// The automated pipeline can take a case as far as 'review'. A person
// with the 'decisions' permission closes it — and, importantly, may
// close it against the machine's suggestion. That override is the
// point: a watchlist hit that is a name collision, a document a human
// can see is genuine despite a glare artefact, a rejection the
// subject has since corrected.
//
// An override is recorded as an override, with a reason, so the rate
// at which humans disagree with the pipeline is itself measurable.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';
import { queueWebhook } from '../_shared/cases.ts';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'decisions');
  if (denied) return denied;

  const { caseId, decision, reason, validForDays = 365 } = body ?? {};
  if (!caseId) return json({ error: 'caseId is required' }, 400);
  if (!['verify', 'reject', 'cancel'].includes(decision)) {
    return json({ error: "decision must be 'verify', 'reject' or 'cancel'" }, 400);
  }

  const admin = staff.admin;

  try {
    const { data: kase } = await admin
      .from('verification_cases').select('*').eq('id', caseId).maybeSingle();
    if (!kase) return json({ error: `Case ${caseId} not found` }, 404);
    if (['verified', 'rejected', 'cancelled'].includes(kase.status)) {
      return json({ error: `Case ${caseId} was already ${kase.status}`, decidedAt: kase.decided_at }, 409);
    }

    // A rejection needs no justification beyond itself, but verifying
    // a case the pipeline did not clear does.
    const { data: scoring } = await admin.rpc('case_score', { p_case_id: caseId });
    const suggested = scoring?.suggested_status;
    const isOverride = (decision === 'verify' && suggested !== 'verified')
                    || (decision === 'reject' && suggested === 'verified');

    if (isOverride && !reason) {
      return json({
        error: 'A reason is required when overriding the pipeline',
        code: 'override_reason_required',
        suggested,
        missingChecks: scoring?.missing_checks ?? [],
        failedChecks: scoring?.failed_checks ?? [],
      }, 400);
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      decided_by: staff.userId,
      decided_at: now,
      decision_reason: reason ?? null,
    };

    if (decision === 'verify') {
      const expires = new Date();
      expires.setUTCDate(expires.getUTCDate() + Number(validForDays));
      patch.status = 'verified';
      patch.expires_at = expires.toISOString();
    } else if (decision === 'reject') {
      patch.status = 'rejected';
      patch.expires_at = null;
    } else {
      patch.status = 'cancelled';
      patch.expires_at = null;
    }

    const { data: updated, error } = await admin
      .from('verification_cases').update(patch).eq('id', caseId).select().single();
    if (error) return json({ error: error.message }, 500);

    // The subject's standing assurance follows the decision. A
    // rejection revokes it rather than merely failing to raise it.
    if (updated.subject_id) {
      if (decision === 'verify') {
        await admin.from('subjects').update({
          assurance_level: updated.level,
          assurance_expires_at: patch.expires_at,
        }).eq('id', updated.subject_id);
      } else if (decision === 'reject') {
        await admin.from('subjects').update({
          assurance_level: 'none',
          assurance_expires_at: null,
        }).eq('id', updated.subject_id);
      }
    }

    await audit(admin, {
      actorId: staff.userId,
      action: `case.${decision === 'verify' ? 'verified' : decision === 'reject' ? 'rejected' : 'cancelled'}`,
      entityType: 'verification_case',
      entityId: caseId,
      metadata: {
        reason: reason ?? null,
        override: isOverride,
        pipeline_suggested: suggested,
        pipeline_score: scoring?.score,
        ip: clientIp(req),
      },
    });

    // Tell the platform that asked.
    await queueWebhook(admin, updated.platform_id, 'case.decided', caseId, {
      event: 'case.decided',
      caseId,
      clientReference: updated.client_reference,
      status: updated.status,
      score: updated.score,
      level: updated.level,
      decidedAt: now,
      expiresAt: updated.expires_at,
    });

    return json({
      caseId,
      status: updated.status,
      score: updated.score,
      expiresAt: updated.expires_at,
      override: isOverride,
      pipelineSuggested: suggested,
    });
  } catch (e) {
    console.error('case-decision failed', e);
    return json({ error: e instanceof Error ? e.message : 'Decision failed' }, 500);
  }
});
