// ══════════════════════════════════════════════════════════════
// Background vetting: address, phone, employment, bank account.
//
// One endpoint rather than four, because in practice they are run
// together on an application and each one's result informs how the
// others are read — an address that checks out on a payslip from an
// employer that does not exist at CIPC is not corroboration.
//
// Every check writes into the same verification_checks ledger the
// identity and document domains use, so a case has one timeline.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';
import { recordCheck, refreshCase } from '../_shared/cases.ts';
import { sha256Hex, normaliseIdNumber } from '../_shared/hash.ts';
import {
  activeProvider, assertLiveProvider,
  addressLookup, phoneLookup, employerLookup, verifyBankAccount,
} from '../_shared/providers.ts';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'identity');
  if (denied) return denied;

  const { customerId, caseId, address, phone, employment, bankAccount } = body ?? {};
  if (!customerId) return json({ error: 'customerId is required' }, 400);
  if (!address && !phone && !employment && !bankAccount) {
    return json({ error: 'Nothing to vet — supply address, phone, employment or bankAccount' }, 400);
  }

  const admin = staff.admin;
  const result: Record<string, unknown> = {};

  try {
    const { data: customer } = await admin
      .from('customers').select('id, subject_id, platform_id, environment:platform_id')
      .eq('id', customerId).maybeSingle();
    if (!customer) return json({ error: `Customer ${customerId} not found` }, 404);

    const { data: subject } = await admin
      .from('subjects').select('first_names, surname').eq('id', customer.subject_id).single();
    const subjectName = [subject?.first_names, subject?.surname].filter(Boolean).join(' ').trim();

    const { data: platform } = await admin
      .from('client_platforms').select('environment').eq('id', customer.platform_id).maybeSingle();
    const environment = platform?.environment ?? 'sandbox';

    // ── Address ───────────────────────────────────────────────────
    if (address) {
      const provider = activeProvider('address');
      assertLiveProvider(provider, environment);

      const { data: addr, error: addrErr } = await admin
        .from('addresses')
        .insert({
          customer_id: customerId,
          subject_id: customer.subject_id,
          address_type: address.type ?? 'residential',
          line1: address.line1,
          line2: address.line2 ?? null,
          suburb: address.suburb ?? null,
          city: address.city ?? null,
          province: address.province ?? null,
          postal_code: address.postalCode ?? null,
          resident_since: address.residentSince ?? null,
          // The trigger computes address_hash; a placeholder satisfies
          // the not-null constraint until it fires.
          address_hash: 'pending',
        })
        .select()
        .single();
      if (addrErr) return json({ error: `Address: ${addrErr.message}` }, 500);

      const lookup = await addressLookup(addr.address_hash, subjectName);
      const { data: shared } = await admin.rpc('address_shared_count', { p_address_id: addr.id });

      const reasons: string[] = [];
      if (!lookup.confirmed) reasons.push('address_not_corroborated');
      if (address.documentInSubjectName === false) reasons.push('proof_not_in_subject_name');
      if ((shared ?? 0) >= 4) reasons.push('address_shared_with_many');

      // A shared address is a question, not a verdict — a block of
      // flats produces the same signal as a syndicate.
      const status = !lookup.confirmed ? 'failed'
        : reasons.length > 0 ? 'manual_review' : 'verified';

      await admin.from('address_verifications').insert({
        address_id: addr.id,
        case_id: caseId ?? null,
        method: address.method ?? 'third_party_data',
        document_in_subject_name: address.documentInSubjectName ?? null,
        document_id: address.documentId ?? null,
        document_date: address.documentDate ?? null,
        status,
        confidence: lookup.confidence,
        shared_with_count: shared ?? 0,
        reason_codes: reasons,
        provider,
      });

      if (caseId) {
        await recordCheck(admin, {
          caseId, domain: 'identity', checkType: 'address_verification', provider,
          status: status === 'verified' ? 'passed' : status === 'failed' ? 'failed' : 'manual_review',
          score: lookup.confidence,
          result: { shared_with: shared ?? 0, confirmed: lookup.confirmed },
          reasonCodes: reasons, runBy: staff.userId,
        });
      }

      result.address = {
        addressId: addr.id, status, confidence: lookup.confidence,
        sharedWith: shared ?? 0, reasonCodes: reasons,
      };
    }

    // ── Phone ─────────────────────────────────────────────────────
    if (phone) {
      const provider = activeProvider('phone');
      assertLiveProvider(provider, environment);

      const { data: normalised } = await admin.rpc('normalise_msisdn', {
        p_raw: phone.msisdn, p_default_country: '27',
      });
      if (!normalised) return json({ error: 'Could not read that phone number' }, 400);

      const msisdnHash = await sha256Hex(normaliseIdNumber(normalised));
      const lookup = await phoneLookup(normalised, subjectName);

      const { data: ph, error: phErr } = await admin
        .from('phone_numbers')
        .insert({
          customer_id: customerId,
          subject_id: customer.subject_id,
          msisdn: normalised,
          msisdn_hash: msisdnHash,
          network: lookup.network,
          line_type: lookup.lineType,
          is_primary: phone.isPrimary ?? true,
        })
        .select()
        .single();
      if (phErr) return json({ error: `Phone: ${phErr.message}` }, 500);

      let nameScore: number | null = null;
      if (lookup.registeredName) {
        const { data } = await admin.rpc('name_match_score', { a: subjectName, b: lookup.registeredName });
        nameScore = data === null ? null : Number(data);
      }

      const reasons: string[] = [];
      if (lookup.ricaStatus === 'registered_to_other') reasons.push('rica_registered_to_other');
      if (lookup.ricaStatus === 'not_registered') reasons.push('rica_not_registered');
      // The signal that matters most for takeover fraud.
      if (lookup.daysSinceSimSwap !== null && lookup.daysSinceSimSwap <= 30) {
        reasons.push('recent_sim_swap');
      }

      const status = lookup.ricaStatus === 'registered_to_subject' && reasons.length === 0
        ? 'verified'
        : lookup.ricaStatus === 'unavailable' ? 'unavailable' : 'manual_review';

      await admin.from('phone_verifications').insert({
        phone_id: ph.id,
        case_id: caseId ?? null,
        rica_status: lookup.ricaStatus,
        registered_name: lookup.registeredName,
        name_match_score: nameScore,
        days_since_sim_swap: lookup.daysSinceSimSwap,
        last_sim_swap_at: lookup.daysSinceSimSwap === null ? null
          : new Date(Date.now() - lookup.daysSinceSimSwap * 86_400_000).toISOString(),
        tenure_days: lookup.tenureDays,
        status,
        confidence: lookup.ricaStatus === 'registered_to_subject' ? (nameScore ?? 80) : 30,
        reason_codes: reasons,
        provider,
      });

      if (caseId) {
        await recordCheck(admin, {
          caseId, domain: 'identity', checkType: 'phone_verification', provider,
          status: status === 'verified' ? 'passed' : status === 'unavailable' ? 'error' : 'manual_review',
          score: lookup.ricaStatus === 'registered_to_subject' ? (nameScore ?? 80) : 25,
          result: {
            rica_status: lookup.ricaStatus, network: lookup.network,
            days_since_sim_swap: lookup.daysSinceSimSwap, tenure_days: lookup.tenureDays,
          },
          reasonCodes: reasons, runBy: staff.userId,
        });
      }

      result.phone = {
        phoneId: ph.id, msisdn: normalised, status,
        ricaStatus: lookup.ricaStatus, network: lookup.network,
        daysSinceSimSwap: lookup.daysSinceSimSwap, nameMatchScore: nameScore,
        reasonCodes: reasons,
      };
    }

    // ── Employment ────────────────────────────────────────────────
    if (employment) {
      const provider = activeProvider('employment');
      assertLiveProvider(provider, environment);

      const employerName = String(employment.employerName ?? '').trim();
      if (!employerName) return json({ error: 'employment.employerName is required' }, 400);

      const normalisedName = employerName.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ').trim();
      const lookup = await employerLookup(employerName);

      // Employers are a shared registry, so "eleven applicants all work
      // somewhere that does not exist" becomes a query, not an anecdote.
      let { data: employer } = await admin
        .from('employers').select('*')
        .eq('name_normalised', normalisedName)
        .eq('registration_number', lookup.registrationNumber ?? '')
        .maybeSingle();

      if (!employer) {
        const { data: created } = await admin
          .from('employers')
          .insert({
            name: employerName,
            name_normalised: normalisedName,
            registration_number: lookup.registrationNumber,
            cipc_status: lookup.status === 'unavailable' ? 'unavailable' : lookup.status,
            cipc_checked_at: new Date().toISOString(),
            sector: lookup.sector,
          })
          .select()
          .single();
        employer = created;
      }

      const { data: record, error: recErr } = await admin
        .from('employment_records')
        .insert({
          customer_id: customerId,
          subject_id: customer.subject_id,
          employer_id: employer?.id ?? null,
          employer_name_claimed: employerName,
          job_title: employment.jobTitle ?? null,
          employment_type: employment.employmentType ?? null,
          started_on: employment.startedOn ?? null,
          gross_monthly_cents: employment.grossMonthlyCents ?? null,
          net_monthly_cents: employment.netMonthlyCents ?? null,
          pay_frequency: employment.payFrequency ?? 'monthly',
          pay_day: employment.payDay ?? null,
        })
        .select()
        .single();
      if (recErr) return json({ error: `Employment: ${recErr.message}` }, 500);

      // Payslip arithmetic — decidable here, and one of the cheapest
      // ways to catch a fabricated document.
      let payslip: any = null;
      if (employment.grossMonthlyCents && employment.netMonthlyCents) {
        const { data } = await admin.rpc('check_payslip_arithmetic', {
          p_gross_cents: employment.grossMonthlyCents,
          p_deductions: employment.deductions ?? [],
          p_net_cents: employment.netMonthlyCents,
          p_tolerance_cents: 200,
        });
        payslip = data;
      }

      // Declared income against money actually arriving.
      let variance: number | null = null;
      if (employment.observedDepositCents && employment.netMonthlyCents) {
        variance = Number(
          (((employment.netMonthlyCents - employment.observedDepositCents) /
            employment.observedDepositCents) * 100).toFixed(2));
      }

      const reasons: string[] = [];
      if (lookup.status === 'not_found') reasons.push('employer_not_at_cipc');
      if (lookup.status === 'deregistered') reasons.push('employer_deregistered');
      if (lookup.status === 'in_liquidation') reasons.push('employer_in_liquidation');
      if (payslip && payslip.ok === false) {
        reasons.push(...(payslip.reason_codes ?? ['payslip_does_not_reconcile']));
      }
      if (variance !== null && Math.abs(variance) > 20) reasons.push('income_variance_high');

      const status = reasons.length === 0 ? 'verified'
        : (payslip && payslip.ok === false) ? 'failed' : 'manual_review';

      await admin.from('employment_verifications').insert({
        employment_id: record.id,
        case_id: caseId ?? null,
        method: employment.method ?? 'payslip',
        document_id: employment.documentId ?? null,
        employer_exists: lookup.status === 'in_business',
        payslip_arithmetic_ok: payslip ? payslip.ok : null,
        declared_gross_cents: employment.grossMonthlyCents ?? null,
        declared_net_cents: employment.netMonthlyCents ?? null,
        computed_net_cents: payslip?.computed_net_cents ?? null,
        observed_deposit_cents: employment.observedDepositCents ?? null,
        income_variance_pct: variance,
        status,
        confidence: status === 'verified' ? 88 : status === 'failed' ? 10 : 50,
        reason_codes: reasons,
        provider,
      });

      if (caseId) {
        await recordCheck(admin, {
          caseId, domain: 'credit', checkType: 'employment_verification', provider,
          status: status === 'verified' ? 'passed' : status === 'failed' ? 'failed' : 'manual_review',
          score: status === 'verified' ? 95 : status === 'failed' ? 0 : 50,
          result: {
            employer: employerName, cipc_status: lookup.status,
            payslip_reconciles: payslip ? payslip.ok : null,
            income_variance_pct: variance,
          },
          reasonCodes: reasons, runBy: staff.userId,
        });
      }

      result.employment = {
        employmentId: record.id, employer: employerName,
        cipcStatus: lookup.status, registrationNumber: lookup.registrationNumber,
        payslip, incomeVariancePct: variance, status, reasonCodes: reasons,
      };
    }

    // ── Bank account ──────────────────────────────────────────────
    if (bankAccount) {
      const provider = activeProvider('banking');
      assertLiveProvider(provider, environment);

      const accountNumber = String(bankAccount.accountNumber ?? '').replace(/\D/g, '');
      if (!accountNumber) return json({ error: 'bankAccount.accountNumber is required' }, 400);

      const accountHash = await sha256Hex(`${bankAccount.branchCode ?? ''}:${accountNumber}`);
      const avs = await verifyBankAccount(accountHash, subjectName);

      const { data: acct, error: acctErr } = await admin
        .from('bank_accounts')
        .insert({
          customer_id: customerId,
          subject_id: customer.subject_id,
          bank_name: bankAccount.bankName ?? null,
          branch_code: bankAccount.branchCode ?? null,
          account_type: bankAccount.accountType ?? 'cheque',
          account_last4: accountNumber.slice(-4),
          account_hash: accountHash,
          account_holder_name: bankAccount.holderName ?? subjectName,
          avs_status: avs.status,
          avs_checked_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (acctErr) return json({ error: `Bank account: ${acctErr.message}` }, 500);

      result.bankAccount = {
        bankAccountId: acct.id,
        last4: accountNumber.slice(-4),
        avsStatus: avs.status,
        accountOpenMonths: avs.accountOpenMonths,
      };
    }

    // Everything vetted feeds the fraud rules, so screen once at the end
    // rather than after each individual check.
    const { data: screen } = await admin.rpc('run_fraud_screen', {
      p_case_id: caseId ?? null, p_customer_id: customerId,
    });

    if (caseId) {
      try { await refreshCase(admin, caseId); } catch { /* case may not require these checks */ }
    }

    await audit(admin, {
      actorId: staff.userId,
      action: 'customer.vetted',
      entityType: 'customer',
      entityId: customerId,
      metadata: { checks: Object.keys(result), case_id: caseId ?? null, ip: clientIp(req) },
    });

    return json({ customerId, ...result, fraudScreen: screen ?? null });
  } catch (e) {
    console.error('vet-background failed', e);
    return json({ error: e instanceof Error ? e.message : 'Background vetting failed' }, 500);
  }
});
