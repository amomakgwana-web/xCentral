// ══════════════════════════════════════════════════════════════
// Capture intake.
//
// Receives one capture from the browser — a document scan, a live
// selfie, a fingerprint assertion — stores the image in the private
// bucket, records the quality the browser measured, and where the
// capture is biometric, templates it.
//
// Order matters and is enforced: quality is assessed BEFORE anything
// is templated or matched, and a capture below the bar is rejected
// with the specific reason. A similarity score computed from an
// unusable photograph is worse than no score, because it looks like
// evidence.
//
// The raw image is discarded once a template exists. What persists is
// the template (unreadable by any client role) and the metadata.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';
import { sha256Hex } from '../_shared/hash.ts';
import {
  activeProvider, assertLiveProvider, templateFromSample, livenessCheck,
} from '../_shared/providers.ts';

const BUCKET = 'verification-documents';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'biometrics');
  if (denied) return denied;

  const admin0 = staff.admin;

  // ── Opening a session ─────────────────────────────────────────
  // Folded in here rather than given its own function: a session
  // exists only to hold captures, and splitting them would mean two
  // deploys to change one flow.
  if (body?.action === 'open') {
    const {
      platformId, caseId, subjectId, customerId,
      channel = 'branch', requiredSteps, deviceLabel,
    } = body ?? {};
    if (!platformId) return json({ error: 'platformId is required to open a session' }, 400);

    const year = new Date().getUTCFullYear();
    const prefix = `CS-${year}-`;
    const { data: last } = await admin0
      .from('capture_sessions').select('id').like('id', `${prefix}%`)
      .order('id', { ascending: false }).limit(1);
    const seq = last?.[0]?.id ? Number(String(last[0].id).slice(prefix.length)) : 0;
    const id = `${prefix}${String((Number.isFinite(seq) ? seq : 0) + 1).padStart(6, '0')}`;

    const { data: session, error } = await admin0
      .from('capture_sessions')
      .insert({
        id,
        platform_id: platformId,
        case_id: caseId ?? null,
        subject_id: subjectId ?? null,
        customer_id: customerId ?? null,
        channel,
        required_steps: requiredSteps ?? ['consent', 'document', 'selfie', 'match'],
        operator_id: staff.userId,
        device_label: deviceLabel ?? null,
        status: 'capturing',
      })
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);

    await audit(admin0, {
      actorId: staff.userId,
      action: 'capture.session_opened',
      entityType: 'capture_session',
      entityId: id,
      metadata: { platform_id: platformId, channel, ip: clientIp(req) },
    });

    return json({
      sessionId: id,
      status: session.status,
      requiredSteps: session.required_steps,
      expiresAt: session.expires_at,
    });
  }

  // ── Abandoning one ────────────────────────────────────────────
  if (body?.action === 'abandon') {
    const { sessionId: sid, reason } = body ?? {};
    if (!sid) return json({ error: 'sessionId is required' }, 400);

    await admin0.from('capture_sessions')
      .update({ status: 'abandoned', completed_at: new Date().toISOString() })
      .eq('id', sid);

    await audit(admin0, {
      actorId: staff.userId,
      action: 'capture.session_abandoned',
      entityType: 'capture_session',
      entityId: sid,
      metadata: { reason: reason ?? null, ip: clientIp(req) },
    });

    return json({ sessionId: sid, status: 'abandoned' });
  }

  const {
    sessionId,
    captureType,
    source = 'live_camera',
    // Base64 data URL from the browser canvas. Held in memory for this
    // request only.
    imageBase64,
    metrics = {},
    // For a fingerprint, the WebAuthn assertion rather than an image.
    fingerprint,
    // Optional client-computed liveness burst.
    liveness: clientLiveness,
  } = body ?? {};

  if (!sessionId) return json({ error: 'sessionId is required' }, 400);
  if (!captureType) return json({ error: 'captureType is required' }, 400);

  const admin = admin0;
  const started = Date.now();

  try {
    const { data: session } = await admin
      .from('capture_sessions').select('*').eq('id', sessionId).maybeSingle();
    if (!session) return json({ error: `Capture session ${sessionId} not found` }, 404);

    if (['approved', 'declined', 'abandoned', 'expired'].includes(session.status)) {
      return json({ error: `Session ${sessionId} is ${session.status}` }, 409);
    }
    if (new Date(session.expires_at) < new Date()) {
      await admin.from('capture_sessions').update({ status: 'expired' }).eq('id', sessionId);
      return json({
        error: 'This capture session has expired',
        code: 'session_expired',
        detail: 'Start a new session — half-finished captures are not kept open.',
      }, 409);
    }

    const { data: platform } = await admin
      .from('client_platforms').select('environment').eq('id', session.platform_id).maybeSingle();
    const environment = platform?.environment ?? 'sandbox';

    // ── Fingerprint: an assertion, not an image ───────────────────
    if (captureType === 'fingerprint') {
      if (!fingerprint?.credentialHash) {
        return json({ error: 'fingerprint.credentialHash is required' }, 400);
      }

      const { data: capture, error } = await admin
        .from('captures')
        .insert({
          session_id: sessionId,
          capture_type: 'fingerprint',
          source: 'device_sensor',
          quality_score: fingerprint.userVerified ? 100 : 0,
          quality_passed: !!fingerprint.userVerified,
          quality_reasons: fingerprint.userVerified ? [] : ['user_not_verified_by_device'],
          // No image exists to discard; recording the moment keeps the
          // retention story honest.
          sample_discarded_at: new Date().toISOString(),
          captured_by: staff.userId,
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);

      await admin.rpc('complete_capture_step', { p_session_id: sessionId, p_step: 'fingerprint' });

      await audit(admin, {
        actorId: staff.userId,
        action: 'capture.fingerprint',
        entityType: 'capture_session',
        entityId: sessionId,
        metadata: { method: fingerprint.method ?? 'webauthn_platform', ip: clientIp(req) },
      });

      return json({
        captureId: capture.id,
        captureType: 'fingerprint',
        accepted: !!fingerprint.userVerified,
        note: 'The device verified its owner with its own sensor. No fingerprint template '
            + 'left the device — this proves the enrolled owner of that device was present, '
            + 'not that a specific person\'s finger was. AFIS-grade capture needs a scanner SDK.',
      });
    }

    // ── Images ────────────────────────────────────────────────────
    if (!imageBase64) return json({ error: 'imageBase64 is required for an image capture' }, 400);

    // ── Quality first ─────────────────────────────────────────────
    const { data: quality, error: qErr } = await admin.rpc('assess_capture_quality', {
      p_capture_type: captureType,
      p_sharpness: metrics.sharpness ?? null,
      p_brightness: metrics.brightness ?? null,
      p_contrast: metrics.contrast ?? null,
      p_width: metrics.width ?? null,
      p_height: metrics.height ?? null,
      p_face_count: metrics.faceCount ?? null,
      p_face_area_pct: metrics.faceAreaPct ?? null,
    });
    if (qErr) return json({ error: `Quality assessment failed: ${qErr.message}` }, 500);

    const base64 = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const sha256 = await sha256Hex(base64);

    const path = `${sessionId}/${captureType}/${sha256.slice(0, 16)}-${Date.now()}.jpg`;

    // A capture that fails quality is still recorded — the attempt is
    // part of the audit trail — but nothing is templated from it.
    const { error: upErr } = await admin.storage
      .from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (upErr) return json({ error: `Could not store the capture: ${upErr.message}` }, 500);

    const { data: capture, error: capErr } = await admin
      .from('captures')
      .insert({
        session_id: sessionId,
        capture_type: captureType,
        source,
        storage_path: path,
        mime_type: 'image/jpeg',
        size_bytes: bytes.byteLength,
        width: metrics.width ?? null,
        height: metrics.height ?? null,
        sha256,
        sharpness: metrics.sharpness ?? null,
        brightness: metrics.brightness ?? null,
        contrast: metrics.contrast ?? null,
        face_detected: metrics.faceDetected ?? null,
        face_count: metrics.faceCount ?? null,
        face_area_pct: metrics.faceAreaPct ?? null,
        quality_score: quality.score,
        quality_passed: quality.passed,
        quality_reasons: quality.reason_codes ?? [],
        captured_by: staff.userId,
      })
      .select()
      .single();
    if (capErr) return json({ error: capErr.message }, 500);

    if (quality.passed === false) {
      return json({
        captureId: capture.id,
        captureType,
        accepted: false,
        quality,
        // Told in terms the operator can act on.
        remedy: remedyFor(quality.reason_codes ?? []),
      }, 200);
    }

    // ── Template the biometric captures ───────────────────────────
    let template: any = null;
    let match: any = null;
    let liveness: any = null;

    const isBiometric = captureType === 'selfie' || captureType === 'document_portrait';

    if (isBiometric && session.subject_id) {
      const provider = activeProvider('biometric');
      assertLiveProvider(provider, environment);

      const { data: consented } = await admin.rpc('has_active_consent', {
        p_subject_id: session.subject_id, p_purpose: 'biometric_processing',
      });
      if (!consented) {
        return json({
          error: 'No active biometric_processing consent for this subject',
          code: 'consent_required',
          detail: 'POPIA s26 makes biometric data special personal information; s27 requires explicit consent.',
          captureId: capture.id,
        }, 403);
      }

      const { data: modality } = await admin
        .from('biometric_modalities').select('*').eq('id', 'face').eq('active', true).single();

      const capture0 = await templateFromSample(
        'face', sha256, modality.descriptor_length, String(session.subject_id));

      const descriptorHash = await sha256Hex(capture0.descriptor.map((v) => v.toFixed(4)).join(','));

      // The document portrait is the enrolment; the selfie is the probe.
      if (captureType === 'document_portrait') {
        const { data: tmpl, error: tErr } = await admin
          .from('biometric_templates')
          .insert({
            subject_id: session.subject_id,
            modality: 'face',
            model_id: modality.model_id,
            descriptor: capture0.descriptor,
            descriptor_hash: descriptorHash,
            source: 'document_portrait',
            quality_score: quality.score,
            enrolled_by: staff.userId,
          })
          .select('id')
          .single();
        if (tErr) return json({ error: `Enrolment failed: ${tErr.message}` }, 500);

        template = { id: tmpl.id, source: 'document_portrait' };
        await admin.from('captures')
          .update({ template_id: tmpl.id, sample_discarded_at: null })
          .eq('id', capture.id);
      }

      if (captureType === 'selfie') {
        // Liveness before matching, always.
        liveness = await livenessCheck(sha256);
        if (clientLiveness?.available) {
          // The browser's motion burst is a weak, independent signal;
          // it narrows the provider's verdict, it does not replace it.
          liveness.clientMotion = clientLiveness.motion;
          liveness.clientLooksStatic = clientLiveness.looksStatic;
          if (clientLiveness.looksStatic) {
            liveness.passed = false;
            liveness.attackType = liveness.attackType === 'none' ? 'print' : liveness.attackType;
          }
        }

        if (!liveness.passed) {
          await admin.from('biometric_verifications').insert({
            case_id: session.case_id,
            subject_id: session.subject_id,
            modality: 'face',
            model_id: modality.model_id,
            mode: 'verify',
            liveness_performed: true,
            liveness_score: liveness.score,
            liveness_passed: false,
            pad_level: liveness.padLevel,
            attack_type: liveness.attackType,
            quality_score: quality.score,
            provider,
            status: 'failed',
            reason_codes: [`presentation_attack_${liveness.attackType}`],
            latency_ms: Date.now() - started,
          });

          await audit(admin, {
            actorId: staff.userId,
            action: 'capture.presentation_attack_detected',
            entityType: 'capture_session',
            entityId: sessionId,
            metadata: { attack_type: liveness.attackType, ip: clientIp(req) },
          });

          // No similarity is returned, because none was computed.
          return json({
            captureId: capture.id,
            captureType,
            accepted: false,
            quality,
            liveness: {
              passed: false, score: liveness.score, attackType: liveness.attackType,
              note: 'Match not attempted: the capture failed presentation attack detection.',
            },
            match: null,
          });
        }

        // Match against the portrait taken off the document.
        const { data: templates } = await admin
          .from('biometric_templates')
          .select('id, descriptor')
          .eq('subject_id', session.subject_id)
          .eq('modality', 'face')
          .eq('source', 'document_portrait')
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(1);

        const enrolled = templates?.[0];
        if (!enrolled) {
          return json({
            captureId: capture.id,
            accepted: true,
            quality,
            liveness: { passed: true, score: liveness.score },
            match: null,
            note: 'No document portrait has been enrolled yet — scan the identity document first.',
          });
        }

        const { data: similarityRaw, error: simErr } = await admin.rpc('cosine_similarity', {
          a: enrolled.descriptor, b: capture0.descriptor,
        });
        if (simErr) return json({ error: `Comparison failed: ${simErr.message}` }, 500);

        const { data: thresholdRaw } = await admin.rpc('biometric_threshold', { p_modality: 'face' });
        const similarity = Number(similarityRaw);
        const threshold = Number(thresholdRaw);
        const matched = similarity >= threshold;

        await admin.from('biometric_verifications').insert({
          case_id: session.case_id,
          subject_id: session.subject_id,
          modality: 'face',
          model_id: modality.model_id,
          mode: 'verify',
          template_id: enrolled.id,
          similarity,
          threshold_applied: threshold,
          operating_fmr: modality.operating_fmr,
          matched,
          liveness_performed: true,
          liveness_score: liveness.score,
          liveness_passed: true,
          pad_level: liveness.padLevel,
          attack_type: liveness.attackType,
          quality_score: quality.score,
          provider,
          status: matched ? 'passed' : 'failed',
          reason_codes: matched ? [] : ['below_match_threshold'],
          latency_ms: Date.now() - started,
        });

        if (session.case_id) {
          await admin.from('verification_checks').insert({
            case_id: session.case_id,
            domain: 'biometric',
            check_type: 'face_match',
            provider,
            status: matched ? 'passed' : 'failed',
            score: matched
              ? Math.round(100 * Math.min(1, (similarity - threshold) / (1 - threshold) * 0.4 + 0.6))
              : Math.round(100 * Math.max(0, similarity / threshold) * 0.6),
            result: { similarity, threshold_applied: threshold, quality_score: quality.score },
            reason_codes: matched ? [] : ['below_match_threshold'],
            run_by: staff.userId,
          });
          await admin.from('verification_checks').insert({
            case_id: session.case_id,
            domain: 'biometric',
            check_type: 'liveness',
            provider,
            status: 'passed',
            score: liveness.score,
            result: { pad_level: liveness.padLevel, attack_type: liveness.attackType },
            run_by: staff.userId,
          });
        }

        match = {
          matched,
          similarity: Number(similarity.toFixed(4)),
          threshold,
          operatingFmr: modality.operating_fmr,
          // Presented as a percentage of the decision margin rather
          // than raw similarity, which overstates a borderline result.
          confidence: matched
            ? Math.round(100 * Math.min(1, (similarity - threshold) / (1 - threshold) * 0.4 + 0.6))
            : Math.round(100 * Math.max(0, similarity / threshold) * 0.6),
        };
      }

      // The raw sample has served its purpose.
      await admin.storage.from(BUCKET).remove([path]).catch(() => {});
      await admin.from('captures')
        .update({ sample_discarded_at: new Date().toISOString(), storage_path: null })
        .eq('id', capture.id);
    }

    const stepFor: Record<string, string> = {
      document_front: 'document',
      document_back: 'document',
      document_portrait: 'document',
      selfie: 'selfie',
      proof_of_address: 'address',
    };
    const step = stepFor[captureType];
    let progress: any = null;
    if (step) {
      const { data } = await admin.rpc('complete_capture_step', {
        p_session_id: sessionId, p_step: step,
      });
      progress = data;
    }
    if (match) {
      const { data } = await admin.rpc('complete_capture_step', {
        p_session_id: sessionId, p_step: 'match',
      });
      progress = data;
    }

    await audit(admin, {
      actorId: staff.userId,
      action: 'capture.received',
      entityType: 'capture_session',
      entityId: sessionId,
      metadata: {
        capture_type: captureType, quality_score: quality.score,
        matched: match?.matched ?? null, ip: clientIp(req),
      },
    });

    return json({
      captureId: capture.id,
      captureType,
      accepted: true,
      quality,
      template,
      liveness: liveness ? { passed: liveness.passed, score: liveness.score } : null,
      match,
      progress,
    });
  } catch (e) {
    console.error('capture-intake failed', e);
    return json({ error: e instanceof Error ? e.message : 'Capture failed' }, 500);
  }
});

// Turns reason codes into something an operator can act on at the
// counter, rather than a code they have to look up.
function remedyFor(codes: string[]): string {
  if (codes.includes('image_too_blurred')) return 'Hold the camera steady and try again — the image is blurred.';
  if (codes.includes('image_too_dark')) return 'Move somewhere brighter, or turn a light on.';
  if (codes.includes('image_overexposed')) return 'Move out of direct light — the image is washed out.';
  if (codes.includes('no_face_detected')) return 'Make sure the face is inside the frame and looking at the camera.';
  if (codes.includes('more_than_one_face')) return 'Only the applicant should be in frame.';
  if (codes.includes('face_too_small_in_frame')) return 'Move closer to the camera.';
  if (codes.includes('resolution_too_low')) return 'Use a higher-resolution camera or move closer.';
  if (codes.includes('low_contrast')) return 'Photograph the document itself, not a screen showing it.';
  return 'Retake the capture.';
}
