// ══════════════════════════════════════════════════════════════
// Consent capture and withdrawal.
//
// Nothing else in the hub may record consent — the tables carry no
// insert policy for authenticated, so this is the only way in. That
// matters because a consent record is evidence: it has to carry the
// exact wording shown, how it was captured, and when it lapses.
//
// Withdrawal is equally a first-class operation. POPIA s11(2)(b)
// gives a data subject the right to withdraw at any time, and a
// system that can only record consent, never revoke it, does not
// actually honour that right.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';

const PURPOSES = [
  'identity_verification', 'document_storage', 'credit_enquiry',
  'biometric_processing', 'watchlist_screening', 'result_sharing',
];

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'consent');
  if (denied) return denied;

  const admin = staff.admin;
  const action = body?.action ?? 'grant';

  try {
    // ── Withdrawal ───────────────────────────────────────────────
    if (action === 'withdraw') {
      const { consentId, reason } = body ?? {};
      if (!consentId) return json({ error: 'consentId is required to withdraw' }, 400);

      const { data: existing } = await admin
        .from('consents').select('*').eq('id', consentId).maybeSingle();
      if (!existing) return json({ error: `Consent ${consentId} not found` }, 404);
      if (existing.withdrawn_at) {
        return json({ error: 'That consent was already withdrawn', withdrawnAt: existing.withdrawn_at }, 409);
      }

      const { data: updated, error } = await admin
        .from('consents')
        .update({ withdrawn_at: new Date().toISOString(), withdrawal_reason: reason ?? null })
        .eq('id', consentId)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);

      // Withdrawing biometric consent must actually stop the
      // processing it authorised, not merely be noted. Templates are
      // deactivated in the same breath.
      let templatesDeactivated = 0;
      if (existing.purpose === 'biometric_processing') {
        const { data: deactivated } = await admin
          .from('biometric_templates')
          .update({ active: false })
          .eq('subject_id', existing.subject_id)
          .eq('active', true)
          .select('id');
        templatesDeactivated = deactivated?.length ?? 0;
      }

      await audit(admin, {
        actorId: staff.userId,
        action: 'consent.withdrawn',
        entityType: 'consent',
        entityId: consentId,
        metadata: {
          subject_id: existing.subject_id, purpose: existing.purpose,
          templates_deactivated: templatesDeactivated, reason: reason ?? null, ip: clientIp(req),
        },
      });

      return json({
        consentId: updated.id,
        purpose: updated.purpose,
        withdrawnAt: updated.withdrawn_at,
        templatesDeactivated,
      });
    }

    // ── Grant ────────────────────────────────────────────────────
    const {
      subjectId, purpose, platformId, caseId,
      lawfulBasis = 'consent', method = 'click_wrap',
      consentTextId, evidence, expiresInDays = 365,
    } = body ?? {};

    if (!subjectId) return json({ error: 'subjectId is required' }, 400);
    if (!PURPOSES.includes(purpose)) {
      return json({ error: `purpose must be one of: ${PURPOSES.join(', ')}` }, 400);
    }

    const { data: subject } = await admin
      .from('subjects').select('id').eq('id', subjectId).maybeSingle();
    if (!subject) return json({ error: `Subject ${subjectId} not found` }, 404);

    // A consent record without the wording it was given under proves
    // nothing, so for actual consent the text is mandatory.
    if (lawfulBasis === 'consent' && !consentTextId) {
      return json({
        error: 'consentTextId is required when the lawful basis is consent',
        detail: 'The exact wording the subject agreed to must be identifiable',
      }, 400);
    }
    if (consentTextId) {
      const { data: text } = await admin
        .from('consent_texts').select('id, purpose').eq('id', consentTextId).maybeSingle();
      if (!text) return json({ error: `Consent text ${consentTextId} not found` }, 404);
      if (text.purpose !== purpose) {
        return json({
          error: `Consent text ${consentTextId} covers '${text.purpose}', not '${purpose}'`,
        }, 400);
      }
    }

    const expires = new Date();
    expires.setUTCDate(expires.getUTCDate() + Number(expiresInDays));

    const { data: consent, error } = await admin
      .from('consents')
      .insert({
        subject_id: subjectId,
        platform_id: platformId ?? null,
        case_id: caseId ?? null,
        purpose,
        lawful_basis: lawfulBasis,
        consent_text_id: consentTextId ?? null,
        method,
        evidence: evidence ?? {},
        captured_ip: clientIp(req),
        captured_user_agent: req.headers.get('user-agent'),
        expires_at: expires.toISOString(),
        created_by: staff.userId,
      })
      .select()
      .single();

    if (error) {
      // The s27 trigger rejects an unlawful basis for biometrics.
      if (error.message?.includes('POPIA s27')) return json({ error: error.message }, 400);
      return json({ error: error.message }, 500);
    }

    await audit(admin, {
      actorId: staff.userId,
      action: 'consent.granted',
      entityType: 'consent',
      entityId: consent.id,
      metadata: {
        subject_id: subjectId, purpose, lawful_basis: lawfulBasis,
        method, special: consent.special_personal_information, ip: clientIp(req),
      },
    });

    return json({
      consentId: consent.id,
      subjectId,
      purpose,
      lawfulBasis,
      specialPersonalInformation: consent.special_personal_information,
      grantedAt: consent.granted_at,
      expiresAt: consent.expires_at,
    });
  } catch (e) {
    console.error('record-consent failed', e);
    return json({ error: e instanceof Error ? e.message : 'Consent operation failed' }, 500);
  }
});
