// ══════════════════════════════════════════════════════════════
// Identity verification.
//
// Runs up to four checks and folds each into the case:
//
//   id_structure         the number's own arithmetic — check digit,
//                        encoded date of birth, gender, citizenship.
//                        Decided locally; no provider involved.
//   deceased_register    is this identity on the deceased feed.
//   watchlist_screening  sanctions, PEP and internal deny lists.
//   authority_lookup     does the authority hold this record, and
//                        does the name on it match what was claimed.
//
// The number itself never reaches a table: it is validated, hashed,
// and discarded with the request.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';
import { ensureSubject, ensureCase, recordCheck, refreshCase } from '../_shared/cases.ts';
import { activeProvider, assertLiveProvider, identityAuthorityLookup } from '../_shared/providers.ts';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'identity');
  if (denied) return denied;

  const {
    idNumber, idType = 'sa_id', firstNames, surname,
    caseId, platformId = 'xcentral_console', clientReference,
    purpose = 'onboarding', level = 'standard',
  } = body ?? {};

  if (!idNumber) return json({ error: 'idNumber is required' }, 400);

  const admin = staff.admin;
  const claimedName = [firstNames, surname].filter(Boolean).join(' ').trim();

  try {
    // ── 1. Structure. Pure arithmetic on the number itself. ──────
    const started = Date.now();
    let structure: any = { valid: false, reason_codes: ['unsupported_id_type'] };

    if (idType === 'sa_id') {
      const { data, error } = await admin.rpc('validate_sa_id', { id_number: idNumber });
      if (error) return json({ error: `ID validation failed: ${error.message}` }, 500);
      structure = data;
    } else {
      // Passports and permits carry no self-checking structure of
      // their own; the MRZ on the document is what verifies them,
      // through verify-document.
      structure = { valid: true, reason_codes: [], date_of_birth: null, gender: null, citizenship: null };
    }

    const { subject, idHash } = await ensureSubject(admin, { idNumber, idType, firstNames, surname });
    const kase = await ensureCase(admin, {
      caseId, subjectId: subject.id, platformId, clientReference, purpose, level,
    });

    // Attributes the number encodes are recorded on the subject once
    // the number has been shown to be well-formed.
    if (structure.valid && idType === 'sa_id') {
      await admin.from('subjects').update({
        date_of_birth: structure.date_of_birth,
        gender: structure.gender,
        citizenship: structure.citizenship,
      }).eq('id', subject.id);
    }

    const structureCheckId = await recordCheck(admin, {
      caseId: kase.id,
      domain: 'identity',
      checkType: 'id_structure',
      provider: 'xcentral',
      status: structure.valid ? 'passed' : 'failed',
      score: structure.valid ? 100 : 0,
      result: {
        id_type: idType,
        date_of_birth: structure.date_of_birth,
        age: structure.age,
        gender: structure.gender,
        citizenship: structure.citizenship,
      },
      reasonCodes: structure.reason_codes ?? [],
      runBy: staff.userId,
      latencyMs: Date.now() - started,
    });

    // ── 2. Deceased register. ────────────────────────────────────
    const { data: deceased } = await admin
      .from('deceased_register').select('id_hash, date_of_death').eq('id_hash', idHash).maybeSingle();

    await recordCheck(admin, {
      caseId: kase.id,
      domain: 'identity',
      checkType: 'deceased_register',
      provider: 'xcentral',
      status: deceased ? 'failed' : 'passed',
      score: deceased ? 0 : 100,
      result: deceased ? { date_of_death: deceased.date_of_death } : { on_register: false },
      reasonCodes: deceased ? ['subject_on_deceased_register'] : [],
      runBy: staff.userId,
    });

    if (deceased) await admin.from('subjects').update({ deceased: true }).eq('id', subject.id);

    // ── 3. Watchlist screening. ──────────────────────────────────
    let watchlistHit = false;
    let hits: any[] = [];
    if (claimedName) {
      const { data } = await admin.rpc('screen_watchlist', { subject_name: claimedName, threshold: 82 });
      hits = data ?? [];
      watchlistHit = hits.length > 0;

      for (const hit of hits) {
        await admin.from('watchlist_hits').insert({
          case_id: kase.id,
          entry_id: hit.entry_id,
          match_score: hit.match_score,
        });
      }
    }

    await recordCheck(admin, {
      caseId: kase.id,
      domain: 'identity',
      checkType: 'watchlist_screening',
      provider: 'xcentral',
      // A watchlist hit is never an automatic rejection — a name
      // collision with a sanctioned person is common and the decision
      // belongs to a compliance officer.
      status: watchlistHit ? 'manual_review' : (claimedName ? 'passed' : 'skipped'),
      score: watchlistHit ? 40 : 100,
      result: { hits: hits.map((h) => ({ list: h.list_name, type: h.entry_type, score: h.match_score })) },
      reasonCodes: watchlistHit ? ['watchlist_potential_match'] : [],
      runBy: staff.userId,
    });

    // ── 4. Authority lookup. ─────────────────────────────────────
    let authority: any = null;
    let nameMatchScore: number | null = null;

    if (level !== 'basic') {
      const provider = activeProvider('identity');
      assertLiveProvider(provider, kase.platform_id === 'xcentral_console' ? 'sandbox' : 'production');

      const authStarted = Date.now();
      authority = await identityAuthorityLookup(idHash, claimedName);

      if (authority.status === 'match' && authority.authorityName && claimedName) {
        const { data } = await admin.rpc('name_match_score', { a: claimedName, b: authority.authorityName });
        nameMatchScore = data === null ? null : Number(data);
      }

      const authorityPassed = authority.status === 'match' && (nameMatchScore ?? 0) >= 85;
      const reasonCodes: string[] = [];
      if (authority.status !== 'match') reasonCodes.push(`authority_${authority.status}`);
      if (authority.status === 'match' && (nameMatchScore ?? 0) < 85) reasonCodes.push('name_mismatch');

      await recordCheck(admin, {
        caseId: kase.id,
        domain: 'identity',
        checkType: 'authority_lookup',
        provider,
        status: authority.status === 'unavailable'
          ? 'error'
          : authorityPassed ? 'passed' : 'manual_review',
        score: authorityPassed ? 100 : (authority.status === 'match' ? (nameMatchScore ?? 0) : 0),
        result: {
          authority_status: authority.status,
          name_match_score: nameMatchScore,
          portrait_available: authority.portraitAvailable,
        },
        reasonCodes,
        runBy: staff.userId,
        latencyMs: Date.now() - authStarted,
      });
    }

    // ── Detail row and case refresh. ─────────────────────────────
    await admin.from('identity_verifications').insert({
      case_id: kase.id,
      check_id: structureCheckId,
      subject_id: subject.id,
      id_type: idType,
      id_last4: subject.id_last4,
      structure_valid: structure.valid,
      derived_date_of_birth: structure.date_of_birth,
      derived_gender: structure.gender,
      derived_citizenship: structure.citizenship,
      claimed_name: claimedName || null,
      authority_name: authority?.authorityName ?? null,
      name_match_score: nameMatchScore,
      authority_provider: authority ? activeProvider('identity') : null,
      authority_status: authority?.status ?? 'not_run',
      deceased_flag: !!deceased,
      watchlist_hit: watchlistHit,
    });

    const { case: refreshed, scoring } = await refreshCase(admin, kase.id);

    await audit(admin, {
      actorId: staff.userId,
      action: 'identity.verified',
      entityType: 'verification_case',
      entityId: kase.id,
      metadata: {
        subject_id: subject.id,
        id_last4: subject.id_last4,
        structure_valid: structure.valid,
        authority_status: authority?.status ?? 'not_run',
        watchlist_hit: watchlistHit,
        ip: clientIp(req),
      },
    });

    return json({
      caseId: refreshed.id,
      subjectId: subject.id,
      status: refreshed.status,
      score: refreshed.score,
      risk: refreshed.risk,
      identity: {
        structureValid: structure.valid,
        dateOfBirth: structure.date_of_birth,
        age: structure.age,
        gender: structure.gender,
        citizenship: structure.citizenship,
        reasonCodes: structure.reason_codes ?? [],
        authorityStatus: authority?.status ?? 'not_run',
        nameMatchScore,
        deceased: !!deceased,
        watchlistHit,
      },
      scoring,
    });
  } catch (e) {
    console.error('verify-identity failed', e);
    return json({ error: e instanceof Error ? e.message : 'Identity verification failed' }, 500);
  }
});
