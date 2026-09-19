// ══════════════════════════════════════════════════════════════
// Biometric verification.
//
// Three modes:
//
//   enrol     template a capture and store it against the subject.
//   verify    1:1 — is the person presenting the same person who
//             enrolled? Cosine similarity against the stored
//             template, compared to the modality's calibrated
//             threshold at the operating false-match rate.
//   identify  1:N — does this face already exist in the hub under a
//             different identity? The duplicate-enrolment sweep.
//
// Ordering is deliberate and enforced: liveness is evaluated BEFORE
// the match, and a failed liveness check short-circuits. Matching a
// photograph of a photograph to a template succeeds — the template
// does not care that nobody was present. A high similarity score
// obtained from a presentation attack is worse than no score at all,
// because it looks like proof.
//
// Raw samples are never stored. The caller supplies a sample
// reference; the descriptor is derived, the reference is discarded.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';
import { ensureCase, recordCheck, refreshCase } from '../_shared/cases.ts';
import { activeProvider, assertLiveProvider, templateFromSample, livenessCheck } from '../_shared/providers.ts';
import { sha256Hex } from '../_shared/hash.ts';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'biometrics');
  if (denied) return denied;

  const {
    caseId,
    mode = 'verify',
    modality = 'face',
    // Reference to the capture — a storage path or a provider session
    // id. Never the sample bytes themselves.
    sampleRef,
    // Optional: a descriptor produced by a client-side or provider
    // SDK. When absent the configured provider templates the sample.
    descriptor,
    source = 'live_capture',
    sourceDocumentId,
    requireLiveness = true,
    platformId = 'xcentral_console',
  } = body ?? {};

  if (!caseId) return json({ error: 'caseId is required' }, 400);
  if (!['enrol', 'verify', 'identify'].includes(mode)) {
    return json({ error: "mode must be 'enrol', 'verify' or 'identify'" }, 400);
  }
  if (!sampleRef && !descriptor) {
    return json({ error: 'Either sampleRef or descriptor is required' }, 400);
  }

  const admin = staff.admin;
  const started = Date.now();

  try {
    const kase = await ensureCase(admin, { caseId, subjectId: body?.subjectId, platformId });
    const subjectId = kase.subject_id;
    if (!subjectId) return json({ error: `Case ${kase.id} has no subject` }, 400);

    const { data: modalityRow } = await admin
      .from('biometric_modalities').select('*').eq('id', modality).eq('active', true).maybeSingle();
    if (!modalityRow) return json({ error: `Unknown or inactive modality '${modality}'` }, 400);

    // POPIA s27. The database enforces this too; checking here yields
    // a usable error rather than a constraint violation.
    const { data: consented } = await admin.rpc('has_active_consent', {
      p_subject_id: subjectId, p_purpose: 'biometric_processing',
    });
    if (!consented) {
      return json({
        error: 'No active biometric_processing consent on record for this subject',
        code: 'consent_required',
        detail: 'POPIA s26 makes biometric data special personal information; s27 requires explicit consent',
      }, 403);
    }

    const provider = activeProvider('biometric');
    assertLiveProvider(provider, platformId === 'xcentral_console' ? 'sandbox' : 'production');

    // ── Liveness first. ──────────────────────────────────────────
    // A match score computed from a spoofed sample is misleading
    // evidence, so if liveness fails we do not compute one at all.
    let liveness: any = null;

    // Liveness applies to every match, and to an enrolment taken from
    // a live capture. Enrolling from a document portrait has no live
    // subject to test, so it is exempt.
    const shouldRunLiveness = requireLiveness && (mode !== 'enrol' || source === 'live_capture');
    if (shouldRunLiveness) {
      liveness = await livenessCheck(String(sampleRef ?? 'descriptor-supplied'));

      await recordCheck(admin, {
        caseId: kase.id,
        domain: 'biometric',
        checkType: 'liveness',
        provider,
        status: liveness.passed ? 'passed' : 'failed',
        score: liveness.score,
        result: {
          pad_level: liveness.padLevel,
          attack_type: liveness.attackType,
          modality,
        },
        reasonCodes: liveness.passed ? [] : [`presentation_attack_${liveness.attackType}`],
        runBy: staff.userId,
        latencyMs: Date.now() - started,
      });

      if (!liveness.passed) {
        await admin.from('biometric_verifications').insert({
          case_id: kase.id,
          subject_id: subjectId,
          modality,
          model_id: modalityRow.model_id,
          mode,
          liveness_performed: true,
          liveness_score: liveness.score,
          liveness_passed: false,
          pad_level: liveness.padLevel,
          attack_type: liveness.attackType,
          provider,
          status: 'failed',
          reason_codes: [`presentation_attack_${liveness.attackType}`],
          latency_ms: Date.now() - started,
        });

        const { case: rejected, scoring } = await refreshCase(admin, kase.id);

        await audit(admin, {
          actorId: staff.userId,
          action: 'biometric.presentation_attack_detected',
          entityType: 'verification_case',
          entityId: kase.id,
          metadata: { modality, attack_type: liveness.attackType, ip: clientIp(req) },
        });

        // Deliberately no similarity in the response: there is none,
        // because none was computed.
        return json({
          caseId: rejected.id,
          status: rejected.status,
          score: rejected.score,
          biometric: {
            mode, modality,
            livenessPassed: false,
            livenessScore: liveness.score,
            attackType: liveness.attackType,
            matched: null,
            reasonCodes: [`presentation_attack_${liveness.attackType}`],
            note: 'Match not computed: the sample failed presentation attack detection',
          },
          scoring,
        }, 200);
      }
    }

    // ── Descriptor. ──────────────────────────────────────────────
    let vector: number[];
    let quality: number;

    if (Array.isArray(descriptor)) {
      if (descriptor.length !== modalityRow.descriptor_length) {
        return json({
          error: `Modality '${modality}' expects a descriptor of length ${modalityRow.descriptor_length}, got ${descriptor.length}`,
        }, 400);
      }
      vector = descriptor.map(Number);
      quality = Number(body?.qualityScore ?? 80);
    } else {
      const capture = await templateFromSample(
        modality,
        String(sampleRef),
        modalityRow.descriptor_length,
        // In simulation, captures of the same subject must land close
        // together; the subject id is what ties them.
        String(subjectId),
      );
      vector = capture.descriptor;
      quality = capture.qualityScore;
    }

    const descriptorHash = await sha256Hex(vector.map((v) => v.toFixed(4)).join(','));

    // ── enrol ────────────────────────────────────────────────────
    if (mode === 'enrol') {
      // Before enrolling, sweep for this face already existing under
      // another identity. That is the finding that matters most in a
      // shared verification hub.
      const { data: sweep } = await admin.rpc('biometric_identify', {
        p_modality: modality, p_descriptor: vector, p_limit: 5,
      });

      const threshold = Number(await resolveThreshold(admin, modality));

      const duplicates = (sweep ?? []).filter(
        (h: any) => h.subject_id !== subjectId && Number(h.similarity) >= threshold,
      );

      for (const dup of duplicates) {
        await admin.from('biometric_duplicate_flags').insert({
          subject_id: subjectId,
          matched_subject_id: dup.subject_id,
          modality,
          similarity: dup.similarity,
        });
      }

      const { data: template, error: tErr } = await admin
        .from('biometric_templates')
        .insert({
          subject_id: subjectId,
          modality,
          model_id: modalityRow.model_id,
          descriptor: vector,
          descriptor_hash: descriptorHash,
          source,
          source_document_id: sourceDocumentId ?? null,
          quality_score: quality,
          enrolled_by: staff.userId,
        })
        .select('id, created_at')
        .single();
      if (tErr) return json({ error: `Enrolment failed: ${tErr.message}` }, 500);

      await admin.from('biometric_verifications').insert({
        case_id: kase.id,
        subject_id: subjectId,
        modality,
        model_id: modalityRow.model_id,
        mode: 'enrol',
        template_id: template.id,
        liveness_performed: !!liveness,
        liveness_score: liveness?.score ?? null,
        liveness_passed: liveness?.passed ?? null,
        pad_level: liveness?.padLevel ?? null,
        attack_type: liveness?.attackType ?? null,
        quality_score: quality,
        provider,
        status: duplicates.length > 0 ? 'manual_review' : 'passed',
        reason_codes: duplicates.length > 0 ? ['duplicate_enrolment_detected'] : [],
        latency_ms: Date.now() - started,
      });

      await audit(admin, {
        actorId: staff.userId,
        action: 'biometric.enrolled',
        entityType: 'subject',
        entityId: subjectId,
        metadata: {
          case_id: kase.id, modality, quality,
          duplicate_flags: duplicates.length, ip: clientIp(req),
        },
      });

      return json({
        caseId: kase.id,
        templateId: template.id,
        biometric: {
          mode: 'enrol',
          modality,
          qualityScore: quality,
          livenessPassed: liveness?.passed ?? null,
          duplicateFlags: duplicates.map((d: any) => ({
            matchedSubjectId: d.subject_id, similarity: Number(d.similarity),
          })),
        },
      });
    }

    // ── identify (1:N) ───────────────────────────────────────────
    if (mode === 'identify') {
      const { data: sweep } = await admin.rpc('biometric_identify', {
        p_modality: modality, p_descriptor: vector, p_limit: Number(body?.limit ?? 5),
      });

      const threshold = Number(await resolveThreshold(admin, modality));
      const candidates = (sweep ?? []).map((h: any) => ({
        subjectId: h.subject_id,
        similarity: Number(h.similarity),
        aboveThreshold: Number(h.similarity) >= threshold,
      }));

      await audit(admin, {
        actorId: staff.userId,
        action: 'biometric.identify',
        entityType: 'verification_case',
        entityId: kase.id,
        metadata: { modality, candidates: candidates.length, ip: clientIp(req) },
      });

      return json({
        caseId: kase.id,
        biometric: {
          mode: 'identify', modality, thresholdApplied: threshold,
          operatingFmr: modalityRow.operating_fmr,
          livenessPassed: liveness?.passed ?? null,
          candidates,
        },
      });
    }

    // ── verify (1:1) ─────────────────────────────────────────────
    const { data: templates } = await admin
      .from('biometric_templates')
      .select('id, descriptor, model_id')
      .eq('subject_id', subjectId)
      .eq('modality', modality)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1);

    const template = templates?.[0];
    if (!template) {
      await recordCheck(admin, {
        caseId: kase.id,
        domain: 'biometric',
        checkType: 'face_match',
        provider,
        status: 'skipped',
        score: null,
        result: { reason: 'No enrolled template for this subject and modality' },
        reasonCodes: ['no_enrolled_template'],
        runBy: staff.userId,
      });
      return json({
        error: `No enrolled ${modality} template for this subject`,
        code: 'not_enrolled',
        remedy: "Run this function with mode 'enrol' first",
      }, 409);
    }

    const { data: similarityRaw, error: simErr } = await admin.rpc('cosine_similarity', {
      a: template.descriptor, b: vector,
    });
    if (simErr) return json({ error: `Comparison failed: ${simErr.message}` }, 500);

    const similarity = Number(similarityRaw);
    const threshold = Number(await resolveThreshold(admin, modality));
    const matched = similarity >= threshold;

    // A low-quality capture explains a low score, so it is reported
    // rather than silently producing a rejection.
    const reasonCodes: string[] = [];
    if (!matched) reasonCodes.push('below_match_threshold');
    if (quality < 50) reasonCodes.push('low_capture_quality');

    // The check type is named for the modality so the requirements
    // table can address face matching specifically.
    const checkType = modality === 'face' ? 'face_match' : `${modality}_match`;

    await recordCheck(admin, {
      caseId: kase.id,
      domain: 'biometric',
      checkType,
      provider,
      status: matched ? 'passed' : (quality < 50 ? 'manual_review' : 'failed'),
      // Map the decision margin onto 0-100 rather than reporting raw
      // similarity as a percentage, which would overstate a 0.60.
      score: matched
        ? Math.round(100 * Math.min(1, (similarity - threshold) / (1 - threshold) * 0.4 + 0.6))
        : Math.round(100 * Math.max(0, similarity / threshold) * 0.6),
      result: {
        similarity, threshold_applied: threshold,
        operating_fmr: modalityRow.operating_fmr,
        model_id: modalityRow.model_id,
        quality_score: quality,
      },
      reasonCodes,
      runBy: staff.userId,
      latencyMs: Date.now() - started,
    });

    await admin.from('biometric_verifications').insert({
      case_id: kase.id,
      subject_id: subjectId,
      modality,
      model_id: modalityRow.model_id,
      mode: 'verify',
      template_id: template.id,
      similarity,
      threshold_applied: threshold,
      operating_fmr: modalityRow.operating_fmr,
      matched,
      liveness_performed: !!liveness,
      liveness_score: liveness?.score ?? null,
      liveness_passed: liveness?.passed ?? null,
      pad_level: liveness?.padLevel ?? null,
      attack_type: liveness?.attackType ?? null,
      quality_score: quality,
      provider,
      status: matched ? 'passed' : 'failed',
      reason_codes: reasonCodes,
      latency_ms: Date.now() - started,
    });

    const { case: refreshed, scoring } = await refreshCase(admin, kase.id);

    await audit(admin, {
      actorId: staff.userId,
      action: matched ? 'biometric.match' : 'biometric.no_match',
      entityType: 'verification_case',
      entityId: kase.id,
      metadata: { modality, similarity, threshold, ip: clientIp(req) },
    });

    return json({
      caseId: refreshed.id,
      status: refreshed.status,
      score: refreshed.score,
      biometric: {
        mode: 'verify',
        modality,
        matched,
        similarity,
        thresholdApplied: threshold,
        operatingFmr: modalityRow.operating_fmr,
        qualityScore: quality,
        livenessPassed: liveness?.passed ?? null,
        livenessScore: liveness?.score ?? null,
        reasonCodes,
      },
      scoring,
    });
  } catch (e) {
    console.error('verify-biometric failed', e);
    return json({ error: e instanceof Error ? e.message : 'Biometric verification failed' }, 500);
  }
});

async function resolveThreshold(admin: any, modality: string): Promise<number> {
  const { data } = await admin.rpc('biometric_threshold', { p_modality: modality });
  return Number(data);
}
