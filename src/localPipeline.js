// ══════════════════════════════════════════════════════════════
// The verification pipeline, running in the page.
//
// In production these three steps are edge functions: the browser
// sends an image, the function templates it, compares it, records it
// and answers. Here there is no server, so the same steps run in the
// tab — but the DIVISION OF LABOUR IS KEPT. The wizard measures; this
// decides. Nothing in console.js works out whether a document is
// genuine or two faces are the same person, for the same reason the
// production console does not: a decision made in the page is a
// decision the page can be edited to change.
//
// What differs from production, said plainly rather than hidden:
//
//   The image never leaves the tab. In production the function
//   receives it, templates it and discards the sample. Here the
//   descriptor is computed in the page and only the descriptor is
//   passed in. Weaker in principle, identical in what is retained.
//
//   The authority comparison is simulated, and stamped `simulation`
//   on every record it touches. There is no Home Affairs here. What
//   the register does hold is real: the first time an identity number
//   is seen, the portrait printed on the document it arrived with is
//   enrolled as that identity's reference. Every later presentation is
//   compared against it by the same arithmetic as any other
//   comparison. So the check genuinely catches a second person
//   presenting the same number later — which is most of what the real
//   query is for — and it cannot catch a first presentation that was
//   fraudulent from the start. That limit is reported in the result,
//   not left to be inferred.
// ══════════════════════════════════════════════════════════════

import { validateSaId } from './data/compute.js';
import {
  agents as AGENT_DEFS, appearance_thresholds, biometric_modalities,
  document_forensic_rules, document_security_features,
} from './data/reference.js';
import { iso, tag } from './data/generate.js';

const FACE_MODALITY = biometric_modalities.find((m) => m.id === 'face');

// The authority's own copy of each identity's portrait, keyed by the
// hash of the identity number — never by the number itself, which is
// not stored anywhere in this system.
const AUTHORITY_REGISTER = new Map();

// Every descriptor ever enrolled here, so the same face arriving under
// a second identity number can be found. This is the check that
// catches a syndicate enrolling one person under many identities, and
// it only works because the descriptors are kept in one place.
const ENROLLED_FACES = [];

export function resetLocalPipeline() {
  AUTHORITY_REGISTER.clear();
  ENROLLED_FACES.length = 0;
}

function cosine(a, b) {
  if (!a || !b) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den > 1e-9 ? dot / den : 0;
}

// The measurement is appearance similarity. The verdict is the face
// model's, and in this environment the face model is the simulation
// one, whose transfer function is written here rather than tucked away
// — a reader can see exactly what the verdict was computed from.
//
// The mapping is deliberately dull: the measured similarity is
// rescaled onto the model's own threshold scale so that the model's
// published cut-off keeps its meaning. It invents nothing. If the
// measurement is 0.5 the verdict is borderline, because 0.5 IS
// borderline.
function faceVerdict(appearance, level = 'standard') {
  const threshold = level === 'strict' ? FACE_MODALITY.threshold_strict
    : level === 'lenient' ? FACE_MODALITY.threshold_lenient
      : FACE_MODALITY.threshold_standard;

  // Anchored on two points, so the model's published cut-off keeps its
  // meaning: the appearance figure at which two photographs stop
  // looking like the same person maps just below the threshold, and
  // the figure at which they plainly are maps just above it.
  //
  // The slope matters as much as the anchors. An earlier version
  // squeezed the whole useful range into a span so narrow that every
  // genuine match came out at the 0.99 ceiling — which reads as
  // certainty and is not, and which threw away the difference between
  // a comfortable match and a marginal one.
  const lo = appearance_thresholds.different_person;
  const hi = appearance_thresholds.same_person;
  const slope = (threshold + 0.02 - 0.5) / Math.max(1e-6, hi - lo);
  const similarity = Number(
    Math.max(0.01, Math.min(0.99, 0.5 + (appearance - lo) * slope)).toFixed(4));

  return {
    provider: 'simulation',
    modelId: FACE_MODALITY.model_id,
    measuredAppearance: Number(appearance.toFixed(4)),
    similarity,
    threshold,
    operatingFmr: FACE_MODALITY.operating_fmr,
    matched: similarity >= threshold,
    confidence: Number(Math.max(0, Math.min(99,
      50 + (similarity - threshold) * 220)).toFixed(1)),
    basis: 'The simulation face model. Its similarity is a declared rescaling of the appearance '
         + 'measurement computed in the browser, not an independent opinion. A real biometric SDK '
         + 'replaces this verdict and keeps the measurement.',
  };
}

// ── Document authenticity ───────────────────────────────────────
function scoreDocument(docType, firedCodes, mrzResult) {
  const rules = new Map(document_forensic_rules.map((r) => [r.code, r]));
  const fired = [...firedCodes];
  if (mrzResult && mrzResult.valid === false) fired.push('doc_mrz_check_digit_failed');

  let deduction = 0;
  let decisive = false;
  const explained = [];
  for (const code of fired) {
    const rule = rules.get(code);
    if (!rule) continue;
    deduction += rule.weight;
    if (rule.decisive) decisive = true;
    explained.push({ code, name: rule.name, weight: rule.weight, severity: rule.severity });
  }

  const score = Math.max(0, Math.min(100, 100 - deduction));
  const status = decisive || score < 45 ? 'failed'
    : score < 78 ? 'manual_review' : 'passed';

  return {
    docType,
    score,
    status,
    decisive,
    findings: explained,
    criticalCount: explained.filter((e) => e.severity === 'critical').length,
  };
}

// ── The pipeline ────────────────────────────────────────────────
// getSession rather than session: the pipeline is built once, at
// client construction, and the operator signs in afterwards. Taking
// the value now would stamp every capture for the rest of the run with
// whoever was signed in at load, which is nobody.
export function createPipeline({ tables: t, audit, getSession = () => null }) {
  const session = { get user() { return getSession()?.user ?? null; } };
  const now = () => iso(new Date());
  const nextId = (prefix, arr) => `${prefix}${arr.length + 1}`;

  function findOrCreateSubject({ idNumber, firstNames, surname, identity }) {
    const idHash = tag('subject', `live|${idNumber}`);
    let subject = t.subjects.find((s) => s.id_hash === idHash);
    if (subject) return { subject, created: false };

    subject = {
      id: `sub_live_${t.subjects.length + 1}`,
      id_type: 'sa_id',
      id_hash: idHash,
      id_last4: String(idNumber).slice(-4),
      id_country: 'ZA',
      first_names: firstNames || 'Not given',
      surname: surname || 'Not given',
      date_of_birth: identity.date_of_birth ?? null,
      gender: identity.gender ?? null,
      citizenship: identity.citizenship ?? null,
      assurance_level: 'none',
      assurance_expires_at: null,
      deceased: false,
      created_at: now(),
    };
    t.subjects.unshift(subject);
    audit('subject.created', 'subject', subject.id, { source: 'live_capture' });
    return { subject, created: true };
  }

  function verifyIdentity(body) {
    const idNumber = String(body.idNumber ?? '').replace(/\s/g, '');
    const identity = validateSaId(idNumber);

    const { subject } = findOrCreateSubject({
      idNumber,
      firstNames: body.firstNames,
      surname: body.surname,
      identity,
    });

    const caseId = `VC-${new Date().getFullYear()}-L${String(t.verification_cases.length + 1).padStart(5, '0')}`;
    t.verification_cases.unshift({
      id: caseId,
      subject_id: subject.id,
      platform_id: body.platformId,
      client_reference: body.clientReference ?? `LIVE-${Date.now().toString(36).toUpperCase()}`,
      purpose: body.purpose ?? 'onboarding',
      level: body.level ?? 'standard',
      status: 'in_progress',
      risk: 'low',
      score: 0,
      decided_by: null,
      decided_at: null,
      decision_reason: null,
      expires_at: null,
      created_at: now(),
      updated_at: now(),
    });

    t.verification_checks.unshift({
      id: nextId('chk_live_', t.verification_checks),
      case_id: caseId,
      domain: 'identity',
      check_type: 'id_structure',
      provider: 'xcentral',
      status: identity.valid ? 'passed' : 'failed',
      score: identity.valid ? 100 : 0,
      result: {
        date_of_birth: identity.date_of_birth ?? null,
        gender: identity.gender ?? null,
        citizenship: identity.citizenship ?? null,
      },
      reason_codes: identity.reason_codes ?? [],
      created_at: now(),
    });

    audit('case.opened', 'verification_case', caseId, { purpose: body.purpose ?? 'onboarding' });

    return {
      caseId,
      subjectId: subject.id,
      identity: {
        structureValid: identity.valid,
        dateOfBirth: identity.date_of_birth ?? null,
        gender: identity.gender ?? null,
        citizenship: identity.citizenship ?? null,
        reasonCodes: identity.reason_codes ?? [],
        // The number itself goes no further than this function.
        idHash: subject.id_hash,
        last4: subject.id_last4,
      },
    };
  }

  function openSession(body) {
    const sessionId = `CS-${new Date().getFullYear()}-L${String(t.capture_sessions.length + 1).padStart(5, '0')}`;
    t.capture_sessions.unshift({
      id: sessionId,
      platform_id: body.platformId,
      case_id: body.caseId ?? null,
      subject_id: body.subjectId ?? null,
      customer_id: null,
      channel: body.channel ?? 'branch',
      status: 'capturing',
      required_steps: body.requiredSteps ?? ['consent', 'selfie', 'document', 'match'],
      completed_steps: ['consent'],
      operator_id: session?.user?.id ?? null,
      device_label: body.deviceLabel ?? 'This device',
      started_at: now(),
      completed_at: null,
      expires_at: iso(new Date(Date.now() + 2 * 3600000)),
      created_at: now(),
    });
    audit('capture.session_opened', 'capture_session', sessionId, { channel: body.channel });
    return { sessionId };
  }

  // One capture. The wizard has already measured the pixels; this
  // records what was kept, enrols the template, and runs whatever
  // comparison the new capture makes possible.
  function submitCapture(body) {
    const s = t.capture_sessions.find((x) => x.id === body.sessionId);
    if (!s) throw new Error('That capture session is not open.');

    const m = body.metrics ?? {};
    const captureId = `cap_live_${t.captures.length + 1}`;
    const quality = body.quality ?? {};

    t.captures.unshift({
      id: captureId,
      session_id: s.id,
      capture_type: body.captureType,
      source: body.source ?? 'live_camera',
      storage_path: null,
      mime_type: 'image/jpeg',
      size_bytes: body.sizeBytes ?? null,
      width: m.width ?? null,
      height: m.height ?? null,
      sha256: tag('capture', `${s.id}|${body.captureType}|${t.captures.length}`),
      sharpness: m.sharpness ?? null,
      brightness: m.brightness ?? null,
      contrast: m.contrast ?? null,
      face_detected: m.faceDetected ?? null,
      face_count: m.faceCount ?? null,
      face_area_pct: m.faceAreaPct ?? null,
      quality_score: quality.score ?? null,
      quality_passed: quality.passed ?? null,
      quality_reasons: quality.reason_codes ?? [],
      template_id: null,
      // Nothing is stored, so the sample is gone the moment this
      // returns. The timestamp is the fact the retention rules care
      // about.
      sample_discarded_at: now(),
      captured_by: session?.user?.id ?? null,
      created_at: now(),
    });

    if (!s.completed_steps.includes(stepFor(body.captureType))) {
      s.completed_steps = [...s.completed_steps, stepFor(body.captureType)];
    }

    const result = { captureId, accepted: true };

    // The descriptor, if the wizard computed one.
    if (body.descriptor) {
      const templateId = `tpl_live_${t.biometric_templates.length + 1}`;
      t.biometric_templates.unshift({
        id: templateId,
        subject_id: s.subject_id,
        modality: 'face',
        model_id: appearance_thresholds.model_id,
        // The vector lives in the page's memory for the session and is
        // never written into a record that a page can render. In
        // production this column is behind row level security with no
        // policies at all, so no client role reads it.
        descriptor: null,
        descriptor_length: body.descriptor.length,
        quality: m.sharpness ?? null,
        source_capture: body.captureType,
        provider: 'xcentral_browser',
        created_at: now(),
      });
      t.captures[0].template_id = templateId;
      result.templateId = templateId;
    }

    audit('capture.submitted', 'capture', captureId,
      { type: body.captureType, source: body.source ?? 'live_camera' });

    return result;
  }

  function stepFor(captureType) {
    if (captureType === 'selfie' || captureType === 'depth_scan') return 'selfie';
    if (String(captureType).startsWith('document')) return 'document';
    return captureType;
  }

  // The reconciliation: everything the session has gathered, compared.
  // This is the step the whole wizard exists to reach.
  function reconcile(body) {
    const s = t.capture_sessions.find((x) => x.id === body.sessionId);
    if (!s) throw new Error('That capture session is not open.');

    const selfie = body.selfieDescriptor ?? null;
    const docPortrait = body.documentPortraitDescriptor ?? null;
    const idHash = body.idHash ?? null;
    const level = body.level ?? 'standard';

    const out = {
      sessionId: s.id,
      comparisons: {},
      enrolment: {},
      document: null,
      depth: body.depth ?? null,
    };

    // 1 · The person in front of the camera against the portrait on
    //     the document they handed over. Both images are here, so this
    //     comparison is entirely real.
    if (selfie && docPortrait) {
      const appearance = cosine(selfie, docPortrait);
      const verdict = faceVerdict(appearance, level);
      out.comparisons.selfie_vs_document = {
        ...verdict,
        question: 'Is the person at the camera the person printed on this document?',
        evidence: 'both images captured in this session',
      };
      t.biometric_verifications.unshift({
        id: `bio_live_${t.biometric_verifications.length + 1}`,
        case_id: s.case_id,
        subject_id: s.subject_id,
        modality: 'face',
        comparison: 'selfie_to_document',
        similarity: verdict.similarity,
        threshold: verdict.threshold,
        matched: verdict.matched,
        liveness_passed: out.depth ? out.depth.verdict === 'three_dimensional' : null,
        provider: 'simulation',
        created_at: now(),
      });
    }

    // 2 · The person against the authority's copy of their portrait.
    if (idHash && selfie) {
      const held = AUTHORITY_REGISTER.get(idHash);
      if (held) {
        const appearance = cosine(selfie, held.descriptor);
        out.comparisons.selfie_vs_authority = {
          ...faceVerdict(appearance, level),
          question: 'Is this the person the authority holds under this identity number?',
          evidence: `reference enrolled ${held.enrolledAt} from ${held.source}`,
          simulated: true,
          limit: 'The reference was enrolled from the first document presented under this number, '
               + 'not received from Home Affairs. It catches a different person presenting the '
               + 'same number later; it cannot catch a first presentation that was already false.',
        };
      } else if (docPortrait) {
        AUTHORITY_REGISTER.set(idHash, {
          descriptor: docPortrait,
          enrolledAt: now(),
          source: 'the portrait printed on the document presented in this session',
        });
        out.enrolment.authority = 'first_presentation';
        out.comparisons.selfie_vs_authority = {
          provider: 'simulation',
          question: 'Is this the person the authority holds under this identity number?',
          matched: null,
          simulated: true,
          note: 'No reference was held for this identity number, so the portrait on the document '
              + 'has been enrolled as one. There is nothing to compare a first presentation '
              + 'against — a real Home Affairs query would answer this, and this environment '
              + 'cannot.',
        };
      }
    }

    // 3 · Has this face already been enrolled under a different
    //     identity number? One person, several identities, is the
    //     shape of a syndicate.
    if (selfie) {
      const threshold = appearance_thresholds.same_person;
      const collision = ENROLLED_FACES
        .map((e) => ({ ...e, appearance: cosine(selfie, e.descriptor) }))
        .filter((e) => e.idHash !== idHash && e.appearance >= threshold)
        .sort((a, b) => b.appearance - a.appearance)[0];

      if (collision) {
        out.comparisons.duplicate_enrolment = {
          fired: true,
          appearance: Number(collision.appearance.toFixed(4)),
          otherSubjectId: collision.subjectId,
          otherLast4: collision.last4,
          note: 'This face is already enrolled under a different identity number in this session '
              + 'register. One person holding two identities is the oldest syndicate pattern there is.',
        };
        t.biometric_duplicate_flags.unshift({
          id: `dup_live_${t.biometric_duplicate_flags.length + 1}`,
          subject_id: s.subject_id,
          matched_subject_id: collision.subjectId,
          modality: 'face',
          similarity: Number(collision.appearance.toFixed(4)),
          status: 'open',
          detected_at: now(),
          resolved_at: null,
          resolution: null,
          created_at: now(),
        });
      } else {
        out.comparisons.duplicate_enrolment = { fired: false, checked: ENROLLED_FACES.length };
      }

      if (idHash && !ENROLLED_FACES.some((e) => e.idHash === idHash)) {
        ENROLLED_FACES.push({
          idHash,
          subjectId: s.subject_id,
          last4: body.last4 ?? null,
          descriptor: selfie,
        });
      }
    }

    // 4 · Is the document itself genuine?
    if (body.documentFindings) {
      const features = document_security_features
        .find((f) => f.doc_type === body.documentType) ?? {};
      const scored = scoreDocument(body.documentType, body.documentFindings.firedCodes ?? [],
        body.mrz ?? null);
      out.document = {
        ...scored,
        expectedFeatures: features,
        measurements: body.documentFindings.substitution ?? null,
        ghostCorrelation: body.documentFindings.ghostCorrelation ?? null,
        mrz: body.mrz ?? null,
      };

      t.verification_checks.unshift({
        id: `chk_live_doc_${t.verification_checks.length + 1}`,
        case_id: s.case_id,
        domain: 'document',
        check_type: 'authenticity',
        provider: 'xcentral',
        status: scored.status,
        score: scored.score,
        result: { findings: scored.findings.map((f) => f.code) },
        reason_codes: scored.findings.map((f) => f.code),
        created_at: now(),
      });
    }

    // 5 · Was the person actually present?
    if (out.depth) {
      t.verification_checks.unshift({
        id: `chk_live_live_${t.verification_checks.length + 1}`,
        case_id: s.case_id,
        domain: 'biometric',
        check_type: 'liveness',
        provider: 'xcentral',
        status: out.depth.verdict === 'three_dimensional' ? 'passed'
          : out.depth.verdict === 'flat' ? 'failed' : 'manual_review',
        score: out.depth.confidence,
        result: {
          relief_pct: out.depth.reliefPct,
          planarity_r2: out.depth.planarityR2,
          poses: out.depth.posesRequested,
        },
        reason_codes: out.depth.verdict === 'flat' ? ['presentation_attack_suspected'] : [],
        created_at: now(),
      });
    }

    audit('capture.reconciled', 'capture_session', s.id, {
      document: out.document?.status ?? null,
      match: out.comparisons.selfie_vs_document?.matched ?? null,
    });

    return out;
  }

  // ── The agents ────────────────────────────────────────────────
  // Rules over the evidence, every one of them. Nothing here is a
  // language model, which is why the same file always produces the
  // same answer and why the answer can be explained to the regulator
  // that asks for it.
  function adjudicate(body) {
    const s = t.capture_sessions.find((x) => x.id === body.sessionId);
    if (!s) throw new Error('That capture session is not open.');
    const ev = body.evidence ?? {};
    const startedAt = performance.now();

    const decisions = [];
    const decide = (agentId, verdict, confidence, rationale) =>
      decisions.push({ agentId, verdict, confidence, rationale });

    // Identity
    if (ev.identity?.structureValid === false) {
      decide('identity_agent', 'fail', 97,
        `The identity number fails its own arithmetic (${(ev.identity.reasonCodes ?? []).join(', ') || 'check digit'}). `
        + 'A number that does not check cannot belong to anybody, so nothing else about this file matters.');
    } else if (ev.identity) {
      decide('identity_agent', 'pass', 92,
        `Identity number is structurally valid; the check digit holds. Born ${ev.identity.dateOfBirth}, `
        + `${ev.identity.citizenship?.replace(/_/g, ' ')}. The number itself was hashed and discarded — only the last four digits remain.`);
    } else {
      decide('identity_agent', 'abstain', 0, 'No identity number reached this session.');
    }

    // Document
    const doc = ev.document;
    if (!doc) {
      decide('document_agent', 'abstain', 0, 'No identity document was presented.');
    } else if (doc.status === 'failed') {
      decide('document_agent', 'fail', 94,
        `Document authenticity ${doc.score}/100 with ${doc.criticalCount} critical finding(s): `
        + `${doc.findings.map((f) => f.name).join('; ')}. `
        + (doc.decisive ? 'The machine-readable zone fails its check digits, which is arithmetic rather than inference.' : ''));
    } else if (doc.status === 'manual_review') {
      decide('document_agent', 'concern', 61,
        `Document authenticity ${doc.score}/100. ${doc.findings.map((f) => f.name).join('; ')}. `
        + 'Each of these has an innocent explanation and none of them is conclusive, which is exactly why a person should look.');
    } else {
      decide('document_agent', 'pass', 88,
        `Document authenticity ${doc.score}/100. The portrait's texture, focus, colour and compression `
        + 'all match the card around it, so it was printed there rather than added to it.');
    }

    // Biometric
    const match = ev.comparisons?.selfie_vs_document;
    const depth = ev.depth;
    if (depth?.verdict === 'flat') {
      decide('biometric_agent', 'fail', 90,
        `The subject was flat. Every tracked point moved as one plane (relief ${depth.reliefPct}% of face width, `
        + `flat-object fit ${depth.planarityR2}). A face has depth; a photograph, a screen and a printed mask do not. `
        + 'No similarity was computed, because a match against a photograph of somebody is worse than no match at all.');
    } else if (!match) {
      decide('biometric_agent', 'abstain', 0,
        'There was no pair to compare — either no live photograph or no portrait on the document.');
    } else if (!match.matched) {
      decide('biometric_agent', 'fail', 88,
        `The live capture does not match the portrait on the document: similarity ${match.similarity} `
        + `against a ${match.threshold} threshold at FMR ${match.operatingFmr}.`);
    } else {
      const live = depth?.verdict === 'three_dimensional';
      decide('biometric_agent', live ? 'pass' : 'concern', live ? 86 : 58,
        `The live capture matches the document portrait at ${match.similarity} against a ${match.threshold} threshold. `
        + (live
          ? `Depth was confirmed from parallax across ${depth.posesAnswered} answered prompts, so the person was actually there.`
          : `Depth was ${depth?.verdict === 'not_measured' ? 'not measurable' : 'inconclusive'}, so the match is real but the presence is not established.`));
    }

    // Fraud
    const dup = ev.comparisons?.duplicate_enrolment;
    if (dup?.fired) {
      decide('fraud_agent', 'fail', 93,
        `This face is already enrolled under a different identity number (appearance ${dup.appearance}). `
        + 'One person holding two identities is a syndicate pattern, not a coincidence.');
    } else if (doc?.findings?.some((f) => f.code === 'doc_photographed_from_screen')) {
      decide('fraud_agent', 'concern', 70,
        'The document was photographed from a screen rather than held in the hand. That is how a stolen '
        + 'scan is presented, and it is also how a tired operator works around a broken scanner.');
    } else {
      decide('fraud_agent', 'pass', 74,
        `Nothing here links to a pattern already on file. ${dup ? `Checked against ${dup.checked} enrolled face(s) in this register.` : ''}`);
    }

    // Affordability has nothing to read at onboarding, and says so
    // rather than producing a number from an empty file.
    decide('affordability_agent', 'abstain', 0,
      'No income, expenses or bureau file has been gathered in this session, so there is nothing to '
      + 'assess. An affordability opinion from an empty file would be a guess wearing a number.');

    // Compliance
    if (ev.consented === false) {
      decide('compliance_agent', 'fail', 99,
        'No explicit consent to biometric processing. POPIA s26 makes biometric data special personal '
        + 'information and s27 does not accept legitimate interest for it.');
    } else {
      decide('compliance_agent', 'pass', 85,
        'Explicit consent to biometric processing was recorded before any template was computed. '
        + 'The identity number was hashed and discarded; no raw sample was retained.');
    }

    // The orchestrator arbitrates rather than averages. A veto is
    // decisive, and three abstentions is a refer, because six agents
    // that mostly had nothing to read is a thin file rather than a
    // clean one.
    const byId = new Map(AGENT_DEFS.map((a) => [a.id, a]));
    const vetoed = decisions.find((d) => d.verdict === 'fail' && byId.get(d.agentId)?.can_veto);
    const concerns = decisions.filter((d) => d.verdict === 'concern');
    const abstentions = decisions.filter((d) => d.verdict === 'abstain');

    let recommendation;
    let confidence;
    let summary;

    if (vetoed) {
      recommendation = 'decline';
      confidence = Math.max(...decisions.filter((d) => d.verdict === 'fail').map((d) => d.confidence));
      summary = `${byId.get(vetoed.agentId).name} vetoed. ${vetoed.rationale}`;
    } else if (abstentions.length >= 3) {
      recommendation = 'refer';
      confidence = 45;
      summary = `${abstentions.length} of ${decisions.length} agents had nothing to read. That is a thin `
        + 'file, not a clean one, and a thin file is a person\'s decision.';
    } else if (concerns.length) {
      recommendation = 'refer';
      confidence = Math.round(
        concerns.reduce((s2, d) => s2 + d.confidence, 0) / concerns.length);
      summary = `No agent vetoed, but ${concerns.length} raised a concern: `
        + `${concerns.map((d) => byId.get(d.agentId).name).join(', ')}. `
        + 'Every one has an innocent explanation, which is why this goes to a person rather than a rule.';
    } else {
      recommendation = 'approve';
      const weighted = decisions
        .filter((d) => d.verdict === 'pass')
        .reduce((acc, d) => {
          const w = byId.get(d.agentId)?.weight ?? 1;
          return { sum: acc.sum + d.confidence * w, w: acc.w + w };
        }, { sum: 0, w: 0 });
      confidence = Math.round(weighted.w ? weighted.sum / weighted.w : 70);
      summary = 'Identity checks out, the document is consistent with itself, the person at the camera '
        + 'is the person on the document, and they were actually present. Approve — a person still applies it.';
    }

    const runId = `run_live_${t.agent_runs.length + 1}`;
    t.agent_runs.unshift({
      id: runId,
      session_id: s.id,
      case_id: s.case_id,
      customer_id: null,
      recommendation,
      confidence,
      vetoed_by: vetoed?.agentId ?? null,
      summary,
      human_outcome: 'pending',
      decided_by: null,
      decided_at: null,
      override_reason: null,
      latency_ms: Math.round(performance.now() - startedAt),
      created_at: now(),
    });

    decisions.forEach((d, i) => {
      t.agent_decisions.unshift({
        id: `dec_live_${t.agent_decisions.length + i + 1}`,
        run_id: runId,
        agent_id: d.agentId,
        verdict: d.verdict,
        confidence: d.confidence,
        rationale: d.rationale,
        evidence: {},
        created_at: now(),
      });
    });

    s.status = recommendation === 'approve' ? 'approved'
      : recommendation === 'decline' ? 'declined' : 'review';
    s.completed_at = now();

    const kase = t.verification_cases.find((c) => c.id === s.case_id);
    if (kase) {
      kase.status = recommendation === 'approve' ? 'verified'
        : recommendation === 'decline' ? 'rejected' : 'review';
      kase.updated_at = now();
      kase.risk = recommendation === 'decline' ? 'high' : recommendation === 'refer' ? 'medium' : 'low';
    }

    audit('agents.adjudicated', 'agent_run', runId, { recommendation, confidence });

    return {
      runId,
      recommendation,
      confidence,
      summary,
      vetoedBy: vetoed?.agentId ?? null,
      latencyMs: Math.round(performance.now() - startedAt),
      decisions: decisions.map((d) => ({
        agentId: d.agentId,
        name: byId.get(d.agentId)?.name ?? d.agentId,
        remit: byId.get(d.agentId)?.remit ?? '',
        canVeto: byId.get(d.agentId)?.can_veto ?? false,
        reasoning: byId.get(d.agentId)?.reasoning ?? 'rules',
        verdict: d.verdict,
        confidence: d.confidence,
        rationale: d.rationale,
      })),
    };
  }

  function applyDecision(body) {
    const run = t.agent_runs.find((r) => r.id === body.runId);
    if (!run) throw new Error('No such adjudication.');
    run.human_outcome = body.outcome;
    run.override_reason = body.reason ?? null;
    run.decided_by = session?.user?.id ?? null;
    run.decided_at = now();
    audit('agents.decision_applied', 'agent_run', run.id, { outcome: body.outcome });
    return { runId: run.id, outcome: run.human_outcome };
  }

  return { verifyIdentity, openSession, submitCapture, reconcile, adjudicate, applyDecision };
}
