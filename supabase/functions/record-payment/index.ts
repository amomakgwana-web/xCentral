// ══════════════════════════════════════════════════════════════
// Payment intake.
//
// Called by the platform that actually collected the money — BipraPay,
// xPayments, or a dealership posting its own bank feed. Authenticated
// by API key, not a staff session, because this runs machine to machine
// on every collection run.
//
// Idempotent on the caller's own reference, which matters: a
// collection run that retries must not post the same debit twice and
// silently clear an instalment that was never paid.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requirePlatform, audit, logApiRequest } from '../_shared/auth.ts';

const ENDPOINT = 'record-payment';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const started = Date.now();
  const ip = clientIp(req);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  // A payment concerns the credit relationship, so it rides on the
  // credit scope rather than needing one of its own.
  const [platform, denied] = await requirePlatform(req, 'credit');
  if (denied) return denied;

  const admin = platform.admin;
  const { action = 'record' } = body ?? {};

  try {
    // ── Reversal: an unpaid debit order, or a recall. ─────────────
    if (action === 'reverse') {
      const { externalReference, reason } = body ?? {};
      if (!externalReference) return json({ error: 'externalReference is required to reverse' }, 400);

      const { data: existing } = await admin
        .from('payments').select('id, contract_id, status')
        .eq('source_platform', platform.platformId)
        .eq('external_reference', externalReference)
        .maybeSingle();

      if (!existing) return json({ error: `No payment found for reference ${externalReference}` }, 404);

      const { data: reversal, error } = await admin.rpc('reverse_payment', {
        p_payment_id: existing.id,
        p_reason: reason ?? 'Reversed by collecting platform',
      });
      if (error) return json({ error: error.message }, 500);

      await audit(admin, {
        actorPlatform: platform.platformId,
        action: 'payment.reversed',
        entityType: 'payment',
        entityId: existing.id,
        metadata: { contract_id: existing.contract_id, reason: reason ?? null, ip },
      });

      await logApiRequest(admin, {
        apiKeyId: platform.apiKeyId, platformId: platform.platformId,
        endpoint: ENDPOINT, statusCode: 200, ip, latencyMs: Date.now() - started,
      });

      return json({ reversed: true, paymentId: existing.id, ...reversal });
    }

    // ── Record a collection ───────────────────────────────────────
    const {
      contractId, amountCents, paidAt, method = 'debit_order',
      externalReference, valueDate,
    } = body ?? {};

    if (!contractId) return json({ error: 'contractId is required' }, 400);
    if (!amountCents || Number(amountCents) <= 0) {
      return json({ error: 'amountCents must be a positive integer' }, 400);
    }

    const { data: contract } = await admin
      .from('contracts').select('id, customer_id, platform_id, status')
      .eq('id', contractId).maybeSingle();
    if (!contract) return json({ error: `Contract ${contractId} not found` }, 404);

    // A platform may only post against its own contracts.
    if (contract.platform_id !== platform.platformId) {
      return json({ error: `Contract ${contractId} does not belong to ${platform.platformId}` }, 403);
    }

    // Idempotency: the same reference returns the original result
    // rather than posting a second payment.
    if (externalReference) {
      const { data: replay } = await admin
        .from('payments').select('id, amount_cents, status')
        .eq('source_platform', platform.platformId)
        .eq('external_reference', externalReference)
        .maybeSingle();
      if (replay) {
        const { data: position } = await admin.rpc('recompute_contract_position', {
          p_contract_id: contractId,
        });
        return json({
          paymentId: replay.id, duplicate: true,
          amountCents: replay.amount_cents, status: replay.status,
          contract: position,
        }, 200, { 'x-idempotent-replay': 'true' });
      }
    }

    const { data: payment, error } = await admin
      .from('payments')
      .insert({
        contract_id: contractId,
        customer_id: contract.customer_id,
        amount_cents: Number(amountCents),
        paid_at: paidAt ?? new Date().toISOString(),
        value_date: valueDate ?? null,
        method,
        source_platform: platform.platformId,
        external_reference: externalReference ?? null,
        status: 'received',
      })
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);

    const { data: allocation, error: allocErr } = await admin.rpc('allocate_payment', {
      p_payment_id: payment.id,
    });
    if (allocErr) return json({ error: `Allocation failed: ${allocErr.message}` }, 500);

    const { data: position } = await admin.rpc('recompute_contract_position', {
      p_contract_id: contractId,
    });

    await audit(admin, {
      actorPlatform: platform.platformId,
      action: 'payment.recorded',
      entityType: 'contract',
      entityId: contractId,
      metadata: {
        payment_id: payment.id, amount_cents: Number(amountCents),
        method, external_reference: externalReference ?? null, ip,
      },
    });

    await logApiRequest(admin, {
      apiKeyId: platform.apiKeyId, platformId: platform.platformId,
      endpoint: ENDPOINT, statusCode: 200, ip, latencyMs: Date.now() - started,
    });

    return json({
      paymentId: payment.id,
      contractId,
      amountCents: Number(amountCents),
      allocation,
      contract: position,
    });
  } catch (e) {
    console.error('record-payment failed', e);
    await logApiRequest(admin, {
      apiKeyId: platform.apiKeyId, platformId: platform.platformId,
      endpoint: ENDPOINT, statusCode: 500, errorCode: 'internal_error', ip,
      latencyMs: Date.now() - started,
    });
    return json({ error: e instanceof Error ? e.message : 'Could not record payment' }, 500);
  }
});
