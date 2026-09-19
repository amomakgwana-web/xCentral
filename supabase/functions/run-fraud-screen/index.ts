// ══════════════════════════════════════════════════════════════
// Runs the fraud rules and returns what fired, with the evidence.
//
// Also the place where an investigator dismisses a signal or resolves
// an alert. Both are recorded against the person who did it: a
// dismissed signal is a judgement someone made, and it should be
// attributable.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'fraud');
  if (denied) return denied;
  return await handle(req, body, staff);
});

async function handle(req: Request, body: any, staff: any) {
  const admin = staff.admin;
  const action = body?.action ?? 'screen';

  try {
    // ── Dismiss a signal ──────────────────────────────────────────
    if (action === 'dismiss_signal') {
      const { signalId, reason } = body ?? {};
      if (!signalId) return json({ error: 'signalId is required' }, 400);
      if (!reason) return json({ error: 'A reason is required to dismiss a signal' }, 400);

      const { data, error } = await admin
        .from('fraud_signals')
        .update({ dismissed: true, dismissed_by: staff.userId, dismissed_reason: reason })
        .eq('id', signalId)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);

      await audit(admin, {
        actorId: staff.userId, action: 'fraud.signal_dismissed',
        entityType: 'fraud_signal', entityId: signalId,
        metadata: { rule: data.rule_code, reason, ip: clientIp(req) },
      });

      return json({ signalId, dismissed: true });
    }

    // ── Resolve an alert ──────────────────────────────────────────
    if (action === 'resolve_alert') {
      const { alertId, outcome, note } = body ?? {};
      if (!alertId) return json({ error: 'alertId is required' }, 400);
      if (!['confirmed_fraud', 'false_positive', 'closed'].includes(outcome)) {
        return json({ error: "outcome must be 'confirmed_fraud', 'false_positive' or 'closed'" }, 400);
      }

      const { data: alert } = await admin
        .from('fraud_alerts').select('*').eq('id', alertId).maybeSingle();
      if (!alert) return json({ error: `Alert ${alertId} not found` }, 404);

      const { error } = await admin
        .from('fraud_alerts')
        .update({
          status: outcome, resolved_by: staff.userId,
          resolved_at: new Date().toISOString(), resolution_note: note ?? null,
        })
        .eq('id', alertId);
      if (error) return json({ error: error.message }, 500);

      // Confirming fraud writes the identifiers to the register, so the
      // same person, phone, address or account is caught on sight next
      // time rather than re-investigated from scratch.
      let registered = 0;
      if (outcome === 'confirmed_fraud' && alert.subject_id) {
        const entries: Array<{ entity_type: string; entity_value: string }> = [];

        const { data: subj } = await admin
          .from('subjects').select('id_hash').eq('id', alert.subject_id).maybeSingle();
        if (subj?.id_hash) entries.push({ entity_type: 'id_hash', entity_value: subj.id_hash });

        const { data: phones } = await admin
          .from('phone_numbers').select('msisdn_hash').eq('subject_id', alert.subject_id);
        for (const p of phones ?? []) entries.push({ entity_type: 'msisdn_hash', entity_value: p.msisdn_hash });

        const { data: accounts } = await admin
          .from('bank_accounts').select('account_hash').eq('subject_id', alert.subject_id);
        for (const a of accounts ?? []) entries.push({ entity_type: 'account_hash', entity_value: a.account_hash });

        for (const entry of entries) {
          const { error: regErr } = await admin.from('known_fraud_register').insert({
            ...entry,
            reason: note ?? `Confirmed on alert ${alertId}`,
            source_alert_id: alertId,
            confirmed_by: staff.userId,
          });
          // 23505 = already on the register; that is fine.
          if (!regErr || regErr.code === '23505') registered++;
        }

        if (alert.customer_id) {
          await admin.from('customers').update({ status: 'suspended' }).eq('id', alert.customer_id);
        }
      }

      await audit(admin, {
        actorId: staff.userId, action: `fraud.alert_${outcome}`,
        entityType: 'fraud_alert', entityId: alertId,
        metadata: { note: note ?? null, register_entries: registered, ip: clientIp(req) },
      });

      return json({ alertId, status: outcome, registerEntries: registered });
    }

    // ── Screen ────────────────────────────────────────────────────
    const { caseId, customerId } = body ?? {};
    if (!caseId && !customerId) {
      return json({ error: 'caseId or customerId is required' }, 400);
    }

    const { data: screen, error } = await admin.rpc('run_fraud_screen', {
      p_case_id: caseId ?? null,
      p_customer_id: customerId ?? null,
    });
    if (error) return json({ error: error.message }, 500);

    await audit(admin, {
      actorId: staff.userId, action: 'fraud.screened',
      entityType: customerId ? 'customer' : 'verification_case',
      entityId: customerId ?? caseId,
      metadata: {
        score: screen?.score, severity: screen?.severity,
        signals: screen?.signals, ip: clientIp(req),
      },
    });

    return json(screen);
  } catch (e) {
    console.error('run-fraud-screen failed', e);
    return json({ error: e instanceof Error ? e.message : 'Fraud screen failed' }, 500);
  }
}
