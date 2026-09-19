// ══════════════════════════════════════════════════════════════
// Contract origination and lifecycle.
//
// Creating an agreement is the point at which everything before it
// stops being a report and starts being money, so three things are
// checked here and refused rather than warned about:
//
//   · the customer's identity was verified;
//   · a credit capacity assessment exists and the instalment fits
//     inside it — the NCA's reckless credit provisions make lending
//     beyond assessed affordability an offence, not a risk appetite;
//   · the asset is not already financed.
//
// The schedule is generated at activation, from the database function,
// so what the customer is told they owe and what the system will chase
// them for are the same numbers.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';
import { activeProvider, assertLiveProvider, assetRegistryLookup } from '../_shared/providers.ts';

async function nextContractId(admin: any, platformId: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `CT-${platformId.toUpperCase().slice(0, 4)}-${year}-`;
  const { data } = await admin
    .from('contracts').select('id').like('id', `${prefix}%`)
    .order('id', { ascending: false }).limit(1);
  const last = data?.[0]?.id ? Number(String(data[0].id).slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(5, '0')}`;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'contracts');
  if (denied) return denied;

  const admin = staff.admin;
  const action = body?.action ?? 'create';

  try {
    // ── Activate: generate the schedule and start the clock ───────
    if (action === 'activate') {
      const { contractId } = body ?? {};
      if (!contractId) return json({ error: 'contractId is required' }, 400);

      const { data: contract } = await admin
        .from('contracts').select('*').eq('id', contractId).maybeSingle();
      if (!contract) return json({ error: `Contract ${contractId} not found` }, 404);
      if (!['draft', 'pending_approval', 'approved'].includes(contract.status)) {
        return json({ error: `Contract ${contractId} is ${contract.status} and cannot be activated` }, 409);
      }

      const { error: schedErr } = await admin.rpc('generate_payment_schedule', {
        p_contract_id: contractId,
      });
      if (schedErr) return json({ error: `Schedule: ${schedErr.message}` }, 500);

      await admin.from('contracts').update({ status: 'active' }).eq('id', contractId);
      const { data: position } = await admin.rpc('recompute_contract_position', {
        p_contract_id: contractId,
      });

      await audit(admin, {
        actorId: staff.userId, action: 'contract.activated',
        entityType: 'contract', entityId: contractId,
        metadata: { term_months: contract.term_months, ip: clientIp(req) },
      });

      return json({ contractId, status: 'active', position });
    }

    // ── Create ────────────────────────────────────────────────────
    const {
      customerId, assetId, agreementType = 'instalment_sale',
      principalCents, depositCents = 0, balloonCents = 0,
      interestRatePct, termMonths, firstPaymentDate, paymentDay,
      collectionMethod = 'debicheck', originationCaseId,
      overrideCapacity = false, overrideReason,
    } = body ?? {};

    if (!customerId) return json({ error: 'customerId is required' }, 400);
    if (!principalCents || Number(principalCents) <= 0) {
      return json({ error: 'principalCents must be positive' }, 400);
    }
    if (!termMonths || Number(termMonths) <= 0) {
      return json({ error: 'termMonths must be positive' }, 400);
    }

    const { data: customer } = await admin
      .from('customers').select('*').eq('id', customerId).maybeSingle();
    if (!customer) return json({ error: `Customer ${customerId} not found` }, 404);

    // Identity first.
    const { data: subject } = await admin
      .from('subjects').select('assurance_level, assurance_expires_at, deceased')
      .eq('id', customer.subject_id).single();

    if (subject.deceased) {
      return json({ error: 'Subject is on the deceased register', code: 'subject_deceased' }, 409);
    }
    if (subject.assurance_level === 'none') {
      return json({
        error: 'This customer has no current identity assurance',
        code: 'not_verified',
        detail: 'Run a verification case to a verified outcome before originating an agreement.',
      }, 409);
    }
    if (subject.assurance_expires_at && new Date(subject.assurance_expires_at) < new Date()) {
      return json({
        error: 'Identity assurance has expired and needs refreshing',
        code: 'assurance_expired',
        expiredAt: subject.assurance_expires_at,
      }, 409);
    }

    // The asset must be free.
    if (assetId) {
      const { data: existing } = await admin
        .from('contracts').select('id, status').eq('asset_id', assetId)
        .in('status', ['approved', 'active', 'in_arrears', 'defaulted', 'legal'])
        .maybeSingle();
      if (existing) {
        return json({
          error: `That asset already backs live agreement ${existing.id}`,
          code: 'asset_already_financed',
        }, 409);
      }

      // Ask the registry while we are here, so an encumbered or stolen
      // asset surfaces before the agreement rather than after.
      const { data: asset } = await admin
        .from('assets').select('*').eq('id', assetId).maybeSingle();
      if (asset) {
        const identifier = asset.vin ?? asset.imei ?? asset.serial_number;
        if (identifier) {
          const provider = activeProvider('asset');
          const { data: platform } = await admin
            .from('client_platforms').select('environment')
            .eq('id', customer.platform_id).maybeSingle();
          assertLiveProvider(provider, platform?.environment ?? 'sandbox');

          const registry = await assetRegistryLookup(identifier, asset.asset_type);
          await admin.from('assets').update({
            registry_verified: registry.status === 'clear',
            registry_verified_at: new Date().toISOString(),
            registry_status: registry.status,
          }).eq('id', assetId);
        }
      }
    }

    const instalment = await admin.rpc('instalment_cents', {
      p_principal_cents: Number(principalCents),
      p_annual_rate_pct: Number(interestRatePct ?? 0),
      p_term_months: Number(termMonths),
      p_balloon_cents: Number(balloonCents),
    });
    const instalmentCents = Number(instalment.data ?? 0);

    // ── Affordability gate ────────────────────────────────────────
    const { data: capacity } = await admin.rpc('assess_credit_capacity', {
      p_customer_id: customerId,
      p_agreement_type: agreementType,
      p_term_months: Number(termMonths),
      p_rate_pct: Number(interestRatePct ?? 0),
      p_balloon_cents: Number(balloonCents),
    });

    const capped = Number(capacity?.max_instalment_cents ?? 0);
    const exceedsCapacity = capacity?.decision === 'decline'
      || capacity?.decision === 'insufficient_data'
      || instalmentCents > capped;

    if (exceedsCapacity && !overrideCapacity) {
      return json({
        error: 'This instalment exceeds the customer\'s assessed capacity',
        code: 'exceeds_credit_capacity',
        detail: 'Lending beyond assessed affordability is reckless credit under NCA s80. '
              + 'Reduce the principal, extend the term, or record an explicit override with a reason.',
        instalmentCents,
        maxInstalmentCents: capped,
        maxPrincipalCents: capacity?.max_principal_cents ?? 0,
        capacityDecision: capacity?.decision,
        capacityReasons: capacity?.reason_codes ?? [],
      }, 409);
    }

    if (exceedsCapacity && overrideCapacity && !overrideReason) {
      return json({
        error: 'An override needs a reason',
        code: 'override_reason_required',
      }, 400);
    }

    const contractId = await nextContractId(admin, customer.platform_id);

    const { data: contract, error } = await admin
      .from('contracts')
      .insert({
        id: contractId,
        customer_id: customerId,
        platform_id: customer.platform_id,
        asset_id: assetId ?? null,
        agreement_type: agreementType,
        origination_case_id: originationCaseId ?? customer.onboarding_case_id ?? null,
        status: 'draft',
        principal_cents: Number(principalCents),
        deposit_cents: Number(depositCents),
        balloon_cents: Number(balloonCents),
        interest_rate_pct: Number(interestRatePct ?? 0),
        term_months: Number(termMonths),
        instalment_cents: instalmentCents,
        first_payment_date: firstPaymentDate ?? null,
        payment_day: paymentDay ?? null,
        collection_method: collectionMethod,
        created_by: staff.userId,
      })
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);

    if (assetId) {
      await admin.from('assets').update({ status: 'financed' }).eq('id', assetId);
    }

    await audit(admin, {
      actorId: staff.userId,
      action: exceedsCapacity ? 'contract.created_over_capacity' : 'contract.created',
      entityType: 'contract',
      entityId: contractId,
      metadata: {
        customer_id: customerId, principal_cents: Number(principalCents),
        instalment_cents: instalmentCents,
        capacity_decision: capacity?.decision,
        max_instalment_cents: capped,
        override: exceedsCapacity, override_reason: overrideReason ?? null,
        ip: clientIp(req),
      },
    });

    return json({
      contractId,
      status: contract.status,
      instalmentCents,
      capacity: {
        decision: capacity?.decision,
        riskGrade: capacity?.risk_grade,
        maxInstalmentCents: capped,
        maxPrincipalCents: capacity?.max_principal_cents ?? 0,
      },
      overrodeCapacity: exceedsCapacity,
      nextStep: "Call this function again with action 'activate' to generate the schedule",
    });
  } catch (e) {
    console.error('manage-contract failed', e);
    return json({ error: e instanceof Error ? e.message : 'Contract operation failed' }, 500);
  }
});
