// ══════════════════════════════════════════════════════════════
// Turns a verified subject into a customer of a platform.
//
// The order is deliberate and enforced: a customer cannot be created
// from a case that has not been verified. Onboarding someone whose
// identity was never established is the failure that every later
// control inherits, so it is refused here rather than flagged later.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'customers');
  if (denied) return denied;

  const { caseId, platformId, customerNumber, email, preferredContact, notes } = body ?? {};
  if (!caseId) return json({ error: 'caseId is required' }, 400);

  const admin = staff.admin;

  try {
    const { data: kase } = await admin
      .from('verification_cases').select('*').eq('id', caseId).maybeSingle();
    if (!kase) return json({ error: `Case ${caseId} not found` }, 404);

    if (kase.status !== 'verified') {
      return json({
        error: `Case ${caseId} is ${kase.status}, not verified`,
        code: 'case_not_verified',
        detail: 'A customer cannot be created from an unverified identity — every control after this one assumes it was established here.',
      }, 409);
    }
    if (!kase.subject_id) {
      return json({ error: `Case ${caseId} has no subject` }, 400);
    }

    const platform = platformId ?? kase.platform_id;

    // One customer record per person per platform; a repeat onboarding
    // returns the existing record rather than creating a duplicate.
    const { data: existing } = await admin
      .from('customers').select('*')
      .eq('platform_id', platform).eq('subject_id', kase.subject_id).maybeSingle();

    if (existing) {
      return json({
        customerId: existing.id,
        alreadyExisted: true,
        status: existing.status,
        customerNumber: existing.customer_number,
      });
    }

    const { data: customer, error } = await admin
      .from('customers')
      .insert({
        subject_id: kase.subject_id,
        platform_id: platform,
        customer_number: customerNumber ?? null,
        status: 'active',
        onboarding_case_id: caseId,
        onboarded_at: new Date().toISOString(),
        email: email ?? null,
        preferred_contact: preferredContact ?? null,
        notes: notes ?? null,
        created_by: staff.userId,
      })
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);

    await audit(admin, {
      actorId: staff.userId,
      action: 'customer.onboarded',
      entityType: 'customer',
      entityId: customer.id,
      metadata: { case_id: caseId, platform_id: platform, ip: clientIp(req) },
    });

    // A newly onboarded customer is screened immediately, so linkage to
    // an existing identity shows up before any money is committed.
    const { data: screen } = await admin.rpc('run_fraud_screen', {
      p_case_id: caseId, p_customer_id: customer.id,
    });

    return json({
      customerId: customer.id,
      subjectId: kase.subject_id,
      platformId: platform,
      status: customer.status,
      fraudScreen: screen ?? null,
    });
  } catch (e) {
    console.error('customer-onboard failed', e);
    return json({ error: e instanceof Error ? e.message : 'Onboarding failed' }, 500);
  }
});
