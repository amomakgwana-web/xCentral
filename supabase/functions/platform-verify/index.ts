// ══════════════════════════════════════════════════════════════
// The endpoint the other platforms call.
//
// BipraPay onboarding a merchant, xPayments approving a payout,
// veriBills opening an account — none of them should implement KYC.
// They POST here with an API key and get back a decision.
//
//   POST /functions/v1/platform-verify
//   x-api-key: xc_live_…
//   x-idempotency-key: <caller's own unique id for this request>
//
//   { "idNumber": "9001015009086",
//     "firstNames": "Thabo", "surname": "Mokoena",
//     "level": "standard", "purpose": "onboarding",
//     "clientReference": "MRC-APP-0022",
//     "consent": { "granted": true, "textId": "…", "method": "click_wrap" } }
//
// The response is a case id and a status. A case that needs a human
// comes back as 'review' and the platform is notified by webhook when
// it is decided — it does not poll.
//
// Two things this endpoint will not do, by design:
//   · run a check the key's scopes do not cover;
//   · process anything at all without a consent record. The calling
//     platform attests to consent it captured from the subject, and
//     that attestation is recorded against the platform as the
//     responsible party. It is not a checkbox we ignore.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requirePlatform, audit, logApiRequest } from '../_shared/auth.ts';
import { ensureSubject, ensureCase, recordCheck, refreshCase, queueWebhook } from '../_shared/cases.ts';
import { activeProvider, assertLiveProvider, identityAuthorityLookup } from '../_shared/providers.ts';

const ENDPOINT = 'platform-verify';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const started = Date.now();
  const ip = clientIp(req);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  // Identity is the minimum any verification implies, so it is the
  // scope the endpoint itself requires; deeper domains are checked
  // individually below.
  const [platform, denied] = await requirePlatform(req, 'identity');
  if (denied) return denied;

  const admin = platform.admin;

  const {
    idNumber, idType = 'sa_id', firstNames, surname,
    level = 'standard', purpose = 'onboarding', clientReference,
    consent, document, credit, biometric,
  } = body ?? {};

  const idempotencyKey = req.headers.get('x-idempotency-key');

  try {
    // ── Idempotency ──────────────────────────────────────────────
    // A retried request must not open a second case or trigger a
    // second bureau enquiry.
    if (idempotencyKey) {
      const { data: replay } = await admin
        .from('idempotency_keys').select('*').eq('key', idempotencyKey).maybeSingle();
      if (replay) {
        await logApiRequest(admin, {
          apiKeyId: platform.apiKeyId, platformId: platform.platformId,
          endpoint: ENDPOINT, statusCode: replay.status_code,
          errorCode: 'idempotent_replay', ip, latencyMs: Date.now() - started,
        });
        return json(replay.response_body, replay.status_code, { 'x-idempotent-replay': 'true' });
      }
    }

    if (!idNumber) return await fail(admin, platform, 400, 'missing_id_number', ip, started,
      { error: 'idNumber is required' });

    if (!['basic', 'standard', 'enhanced'].includes(level)) {
      return await fail(admin, platform, 400, 'invalid_level', ip, started,
        { error: "level must be 'basic', 'standard' or 'enhanced'" });
    }

    // ── Consent attestation ──────────────────────────────────────
    if (!consent?.granted) {
      return await fail(admin, platform, 403, 'consent_required', ip, started, {
        error: 'A consent attestation is required',
        detail: 'Send consent.granted=true with the wording id and capture method your platform used. ' +
                'Your platform is recorded as the responsible party for that consent.',
      });
    }

    const claimedName = [firstNames, surname].filter(Boolean).join(' ').trim();
    const { subject, idHash } = await ensureSubject(admin, { idNumber, idType, firstNames, surname });

    // Record the attested consent against the calling platform.
    const purposes = ['identity_verification'];
    if (document) purposes.push('document_storage');
    if (credit) purposes.push('credit_enquiry');
    if (biometric) purposes.push('biometric_processing');

    for (const p of purposes) {
      const { data: already } = await admin.rpc('has_active_consent', {
        p_subject_id: subject.id, p_purpose: p,
      });
      if (already) continue;

      const { error: consentErr } = await admin.from('consents').insert({
        subject_id: subject.id,
        platform_id: platform.platformId,
        purpose: p,
        lawful_basis: 'consent',
        consent_text_id: consent.textId ?? null,
        method: consent.method ?? 'api_attestation',
        evidence: {
          attested_by: platform.platformId,
          attested_at: new Date().toISOString(),
          client_reference: clientReference ?? null,
          subject_ip: consent.subjectIp ?? null,
          ...(consent.evidence ?? {}),
        },
        captured_ip: ip,
      });
      if (consentErr) {
        return await fail(admin, platform, 400, 'consent_rejected', ip, started,
          { error: `Consent for '${p}' was rejected: ${consentErr.message}` });
      }
    }

    const kase = await ensureCase(admin, {
      subjectId: subject.id,
      platformId: platform.platformId,
      clientReference,
      purpose,
      level,
    });

    // ── Identity, always. ────────────────────────────────────────
    let structure: any = { valid: true, reason_codes: [] };
    if (idType === 'sa_id') {
      const { data } = await admin.rpc('validate_sa_id', { id_number: idNumber });
      structure = data;
    }

    if (structure.valid && idType === 'sa_id') {
      await admin.from('subjects').update({
        date_of_birth: structure.date_of_birth,
        gender: structure.gender,
        citizenship: structure.citizenship,
      }).eq('id', subject.id);
    }

    await recordCheck(admin, {
      caseId: kase.id, domain: 'identity', checkType: 'id_structure', provider: 'xcentral',
      status: structure.valid ? 'passed' : 'failed',
      score: structure.valid ? 100 : 0,
      result: {
        date_of_birth: structure.date_of_birth, age: structure.age,
        gender: structure.gender, citizenship: structure.citizenship,
      },
      reasonCodes: structure.reason_codes ?? [],
    });

    const { data: deceased } = await admin
      .from('deceased_register').select('date_of_death').eq('id_hash', idHash).maybeSingle();

    await recordCheck(admin, {
      caseId: kase.id, domain: 'identity', checkType: 'deceased_register', provider: 'xcentral',
      status: deceased ? 'failed' : 'passed',
      score: deceased ? 0 : 100,
      result: { on_register: !!deceased },
      reasonCodes: deceased ? ['subject_on_deceased_register'] : [],
    });

    let hits: any[] = [];
    if (claimedName) {
      const { data } = await admin.rpc('screen_watchlist', { subject_name: claimedName, threshold: 82 });
      hits = data ?? [];
      for (const hit of hits) {
        await admin.from('watchlist_hits').insert({
          case_id: kase.id, entry_id: hit.entry_id, match_score: hit.match_score,
        });
      }
    }

    await recordCheck(admin, {
      caseId: kase.id, domain: 'identity', checkType: 'watchlist_screening', provider: 'xcentral',
      status: hits.length > 0 ? 'manual_review' : (claimedName ? 'passed' : 'skipped'),
      score: hits.length > 0 ? 40 : 100,
      result: { hits: hits.map((h) => ({ list: h.list_name, type: h.entry_type, score: h.match_score })) },
      reasonCodes: hits.length > 0 ? ['watchlist_potential_match'] : [],
    });

    if (level !== 'basic') {
      const provider = activeProvider('identity');
      assertLiveProvider(provider, platform.environment);

      const authority = await identityAuthorityLookup(idHash, claimedName);
      let nameScore: number | null = null;
      if (authority.status === 'match' && authority.authorityName && claimedName) {
        const { data } = await admin.rpc('name_match_score', { a: claimedName, b: authority.authorityName });
        nameScore = data === null ? null : Number(data);
      }
      const passed = authority.status === 'match' && (nameScore ?? 0) >= 85;

      await recordCheck(admin, {
        caseId: kase.id, domain: 'identity', checkType: 'authority_lookup', provider,
        status: authority.status === 'unavailable' ? 'error' : passed ? 'passed' : 'manual_review',
        score: passed ? 100 : (authority.status === 'match' ? (nameScore ?? 0) : 0),
        result: { authority_status: authority.status, name_match_score: nameScore },
        reasonCodes: passed ? [] : [`authority_${authority.status}`],
      });
    }

    // ── Deeper domains are scope-gated. ──────────────────────────
    // Rather than silently skipping a domain the caller asked for,
    // say so: a platform that thinks it ordered a credit check and
    // silently did not is worse off than one that gets an error.
    const refused: string[] = [];
    for (const [domain, requested] of [['document', document], ['credit', credit], ['biometric', biometric]] as const) {
      if (!requested) continue;
      if (!platform.scopes.includes(domain) || !platform.allowedDomains.includes(domain)) {
        refused.push(domain);
      }
    }
    if (refused.length > 0) {
      return await fail(admin, platform, 403, 'scope_denied', ip, started, {
        error: `This API key cannot request: ${refused.join(', ')}`,
        caseId: kase.id,
        keyScopes: platform.scopes,
      }, kase.id);
    }

    // Document, credit and biometric material arrives through their
    // own endpoints, which need uploaded artefacts rather than JSON.
    // What this endpoint reports is what the case still needs.
    const { case: refreshed, scoring } = await refreshCase(admin, kase.id);

    const response = {
      caseId: refreshed.id,
      clientReference: clientReference ?? null,
      status: refreshed.status,
      score: refreshed.score,
      risk: refreshed.risk,
      level: refreshed.level,
      expiresAt: refreshed.expires_at,
      identity: {
        structureValid: structure.valid,
        dateOfBirth: structure.date_of_birth,
        age: structure.age,
        gender: structure.gender,
        citizenship: structure.citizenship,
        deceased: !!deceased,
        watchlistHit: hits.length > 0,
        reasonCodes: structure.reason_codes ?? [],
      },
      outstanding: scoring?.missing_checks ?? [],
      failed: scoring?.failed_checks ?? [],
      needsReview: scoring?.manual_review_checks ?? [],
    };

    if (idempotencyKey) {
      await admin.from('idempotency_keys').insert({
        key: idempotencyKey, endpoint: ENDPOINT, platform_id: platform.platformId,
        status_code: 200, response_body: response,
      });
    }

    await audit(admin, {
      actorPlatform: platform.platformId,
      action: 'platform.verification_requested',
      entityType: 'verification_case',
      entityId: kase.id,
      metadata: {
        level, purpose, client_reference: clientReference ?? null,
        status: refreshed.status, ip,
      },
    });

    if (['verified', 'rejected'].includes(refreshed.status)) {
      await queueWebhook(admin, platform.platformId, 'case.decided', kase.id, {
        event: 'case.decided', caseId: kase.id, clientReference: clientReference ?? null,
        status: refreshed.status, score: refreshed.score,
      });
    }

    await logApiRequest(admin, {
      apiKeyId: platform.apiKeyId, platformId: platform.platformId,
      endpoint: ENDPOINT, caseId: kase.id, statusCode: 200, ip,
      latencyMs: Date.now() - started,
    });

    return json(response);
  } catch (e) {
    console.error('platform-verify failed', e);
    const message = e instanceof Error ? e.message : 'Verification failed';
    return await fail(admin, platform, 500, 'internal_error', ip, started, { error: message });
  }
});

// Logs the failed call before returning it, so api_requests reflects
// what callers actually experienced rather than only what succeeded.
async function fail(
  admin: any, platform: any, status: number, code: string,
  ip: string, started: number, payload: Record<string, unknown>,
  caseId?: string,
) {
  await logApiRequest(admin, {
    apiKeyId: platform.apiKeyId, platformId: platform.platformId,
    endpoint: ENDPOINT, caseId: caseId ?? null, statusCode: status,
    errorCode: code, ip, latencyMs: Date.now() - started,
  });
  return json({ ...payload, code }, status);
}
