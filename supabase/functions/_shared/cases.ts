// Case and check plumbing shared by every verification function, so
// that "run a check and fold it into the case" means exactly one
// thing across all four domains.

import { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { hashIdNumber, last4 } from './hash.ts';
import { nextCaseId } from './auth.ts';

export interface SubjectInput {
  idNumber: string;
  idType?: string;
  firstNames?: string;
  surname?: string;
  idCountry?: string;
}

// Finds the subject behind an identity number, or creates them.
//
// The lookup key is the peppered hash, never the number itself, so
// two platforms verifying the same person converge on one subject
// record without either the hub or an attacker holding the number.
export async function ensureSubject(admin: SupabaseClient, input: SubjectInput) {
  const idType = input.idType ?? 'sa_id';
  const idHash = await hashIdNumber(input.idNumber);

  const { data: existing } = await admin
    .from('subjects')
    .select('*')
    .eq('id_type', idType)
    .eq('id_hash', idHash)
    .maybeSingle();

  if (existing) {
    // Fill in names we did not have before, but never overwrite a
    // name that a verified check already established.
    const patch: Record<string, unknown> = {};
    if (!existing.first_names && input.firstNames) patch.first_names = input.firstNames;
    if (!existing.surname && input.surname) patch.surname = input.surname;
    if (Object.keys(patch).length > 0) {
      const { data: updated } = await admin
        .from('subjects').update(patch).eq('id', existing.id).select().single();
      return { subject: updated ?? existing, idHash, created: false };
    }
    return { subject: existing, idHash, created: false };
  }

  const { data: created, error } = await admin
    .from('subjects')
    .insert({
      id_type: idType,
      id_hash: idHash,
      id_last4: last4(input.idNumber),
      id_country: input.idCountry ?? 'ZA',
      first_names: input.firstNames ?? null,
      surname: input.surname ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Could not create subject: ${error.message}`);
  return { subject: created, idHash, created: true };
}

export interface CaseInput {
  caseId?: string;
  subjectId: string;
  platformId: string;
  clientReference?: string;
  purpose?: string;
  level?: string;
}

// Resolves the case a check belongs to: an existing one by id, or a
// new one opened for this subject and platform.
export async function ensureCase(admin: SupabaseClient, input: CaseInput) {
  if (input.caseId) {
    const { data: existing } = await admin
      .from('verification_cases').select('*').eq('id', input.caseId).maybeSingle();
    if (!existing) throw new Error(`Case ${input.caseId} not found`);
    if (['verified', 'rejected', 'cancelled', 'expired'].includes(existing.status)) {
      throw new Error(`Case ${input.caseId} is closed (${existing.status}) and cannot take new checks`);
    }
    return existing;
  }

  const id = await nextCaseId(admin);
  const { data: created, error } = await admin
    .from('verification_cases')
    .insert({
      id,
      subject_id: input.subjectId,
      platform_id: input.platformId,
      client_reference: input.clientReference ?? null,
      purpose: input.purpose ?? 'onboarding',
      level: input.level ?? 'standard',
      status: 'in_progress',
    })
    .select()
    .single();

  if (error) throw new Error(`Could not open case: ${error.message}`);
  return created;
}

export interface CheckRecord {
  caseId: string;
  domain: 'identity' | 'document' | 'credit' | 'biometric';
  checkType: string;
  provider: string;
  status: 'passed' | 'failed' | 'error' | 'manual_review' | 'skipped';
  score?: number | null;
  result?: Record<string, unknown>;
  reasonCodes?: string[];
  runBy?: string | null;
  latencyMs?: number;
}

// Appends one row to the check ledger and returns its id, which the
// domain-specific detail row then points at.
export async function recordCheck(admin: SupabaseClient, check: CheckRecord): Promise<string> {
  const { data, error } = await admin
    .from('verification_checks')
    .insert({
      case_id: check.caseId,
      domain: check.domain,
      check_type: check.checkType,
      provider: check.provider,
      status: check.status,
      score: check.score ?? null,
      result: check.result ?? {},
      reason_codes: check.reasonCodes ?? [],
      run_by: check.runBy ?? null,
      latency_ms: check.latencyMs ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Could not record check: ${error.message}`);
  return data.id;
}

// Recomputes the case score from its checks and advances the status.
//
// The database decides — case_score() is the single implementation,
// so the console, the API and any report agree. A case only ever
// moves itself as far as 'review'; 'verified' and 'rejected' are
// applied here from the suggestion, but a human can still override
// either through case-decision.
export async function refreshCase(admin: SupabaseClient, caseId: string) {
  const { data: scored, error } = await admin.rpc('case_score', { p_case_id: caseId });
  if (error) throw new Error(`Could not score case: ${error.message}`);
  if (scored?.error) throw new Error(String(scored.error));

  const suggested = scored.suggested_status as string;
  const patch: Record<string, unknown> = {
    score: scored.score,
    status: suggested,
    risk: scored.score >= 80 ? 'low' : scored.score >= 55 ? 'medium' : 'high',
  };

  // A machine-verified case still gets an expiry, so nothing is
  // trusted indefinitely without a refresh.
  if (suggested === 'verified') {
    const expires = new Date();
    expires.setUTCFullYear(expires.getUTCFullYear() + 1);
    patch.expires_at = expires.toISOString();
    patch.decided_at = new Date().toISOString();
    patch.decision_reason = 'Automatically verified: all required checks passed';
  }

  const { data: updated, error: upErr } = await admin
    .from('verification_cases').update(patch).eq('id', caseId).select().single();
  if (upErr) throw new Error(`Could not update case: ${upErr.message}`);

  // Raise the subject's standing assurance to match a verified case.
  if (suggested === 'verified' && updated.subject_id) {
    await admin.from('subjects').update({
      assurance_level: updated.level,
      assurance_expires_at: patch.expires_at,
    }).eq('id', updated.subject_id);
  }

  return { case: updated, scoring: scored };
}

// Queues the outbound notification for a case transition. Delivery
// itself is the webhook-dispatch function's job.
export async function queueWebhook(
  admin: SupabaseClient,
  platformId: string,
  event: string,
  caseId: string,
  payload: Record<string, unknown>,
) {
  const { data: endpoints } = await admin
    .from('webhook_endpoints')
    .select('id, events')
    .eq('platform_id', platformId)
    .eq('active', true);

  for (const endpoint of endpoints ?? []) {
    if (!endpoint.events?.includes(event)) continue;
    await admin.from('webhook_deliveries').insert({
      endpoint_id: endpoint.id,
      event,
      case_id: caseId,
      payload,
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
    });
  }
}
