// ══════════════════════════════════════════════════════════════
// The agents that adjudicate an onboarding.
//
// Six agents, each owning one question, plus an orchestrator that
// combines them. Their remits do not overlap, so a decline is always
// traceable to the agent whose question failed rather than to an
// aggregate nobody can unpick.
//
// A word on what these are, because "AI agent" is doing a lot of work
// in most products that use the phrase. These are DETERMINISTIC
// reasoners: each reads the check data the pipeline has already
// produced and applies a stated policy to it. They are not language
// models, and the shipped ones make no model calls. That is a
// deliberate choice for this use — a lending decision has to be
// reproducible and explainable to the NCR, and "the model said so" is
// neither. The `reasoning` column on each agent records which kind it
// is, so a model-backed agent added later is visibly different from
// these.
//
// What makes them agents rather than a scoring function: each has its
// own remit and evidence, forms its own verdict independently, writes
// its own rationale in plain words, and can veto. The orchestrator
// arbitrates rather than averaging.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';

type Verdict = 'pass' | 'concern' | 'fail' | 'abstain';

interface AgentDecision {
  agentId: string;
  verdict: Verdict;
  confidence: number;
  rationale: string;
  evidence: Record<string, unknown>;
  reasonCodes: string[];
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'decisions');
  if (denied) return denied;

  const admin = staff.admin;
  const action = body?.action ?? 'adjudicate';

  try {
    // ── A person accepts or overrides the recommendation ──────────
    if (action === 'decide') {
      const { runId, outcome, reason } = body ?? {};
      if (!runId) return json({ error: 'runId is required' }, 400);
      if (!['accepted', 'overridden'].includes(outcome)) {
        return json({ error: "outcome must be 'accepted' or 'overridden'" }, 400);
      }
      if (outcome === 'overridden' && !reason) {
        return json({ error: 'Overriding the agents needs a reason' }, 400);
      }

      const { data: run } = await admin
        .from('agent_runs').select('*').eq('id', runId).maybeSingle();
      if (!run) return json({ error: `Run ${runId} not found` }, 404);

      await admin.from('agent_runs').update({
        human_outcome: outcome,
        decided_by: staff.userId,
        decided_at: new Date().toISOString(),
        override_reason: reason ?? null,
      }).eq('id', runId);

      if (run.session_id) {
        const finalStatus = outcome === 'accepted'
          ? (run.recommendation === 'approve' ? 'approved'
            : run.recommendation === 'decline' ? 'declined' : 'review')
          : 'review';
        await admin.from('capture_sessions')
          .update({ status: finalStatus, completed_at: new Date().toISOString() })
          .eq('id', run.session_id);
      }

      await audit(admin, {
        actorId: staff.userId,
        action: outcome === 'accepted' ? 'agents.recommendation_accepted' : 'agents.recommendation_overridden',
        entityType: 'agent_run',
        entityId: runId,
        metadata: {
          recommendation: run.recommendation, reason: reason ?? null, ip: clientIp(req),
        },
      });

      return json({ runId, humanOutcome: outcome, recommendation: run.recommendation });
    }

    // ── Adjudicate ────────────────────────────────────────────────
    const { sessionId, caseId, customerId } = body ?? {};
    if (!sessionId && !caseId && !customerId) {
      return json({ error: 'sessionId, caseId or customerId is required' }, 400);
    }

    const started = Date.now();

    let session: any = null;
    let resolvedCase = caseId ?? null;
    let resolvedCustomer = customerId ?? null;
    let subjectId: string | null = null;

    if (sessionId) {
      const { data } = await admin
        .from('capture_sessions').select('*').eq('id', sessionId).maybeSingle();
      if (!data) return json({ error: `Session ${sessionId} not found` }, 404);
      session = data;
      resolvedCase = resolvedCase ?? data.case_id;
      resolvedCustomer = resolvedCustomer ?? data.customer_id;
      subjectId = data.subject_id;
    }
    if (!subjectId && resolvedCase) {
      const { data } = await admin
        .from('verification_cases').select('subject_id').eq('id', resolvedCase).maybeSingle();
      subjectId = data?.subject_id ?? null;
    }
    if (!subjectId && resolvedCustomer) {
      const { data } = await admin
        .from('customers').select('subject_id').eq('id', resolvedCustomer).maybeSingle();
      subjectId = data?.subject_id ?? null;
    }

    // ── Gather the evidence once ──────────────────────────────────
    const [checks, biometrics, captures, fraudSignals, subject, affordability] = await Promise.all([
      resolvedCase
        ? admin.from('verification_checks').select('*').eq('case_id', resolvedCase)
        : Promise.resolve({ data: [] }),
      resolvedCase
        ? admin.from('biometric_verifications').select('*').eq('case_id', resolvedCase)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      sessionId
        ? admin.from('captures').select('*').eq('session_id', sessionId)
        : Promise.resolve({ data: [] }),
      admin.from('fraud_signals').select('*').eq('dismissed', false)
        .or([
          resolvedCase ? `case_id.eq.${resolvedCase}` : null,
          resolvedCustomer ? `customer_id.eq.${resolvedCustomer}` : null,
          subjectId ? `subject_id.eq.${subjectId}` : null,
        ].filter(Boolean).join(',')),
      subjectId
        ? admin.from('subjects').select('*').eq('id', subjectId).maybeSingle()
        : Promise.resolve({ data: null }),
      subjectId
        ? admin.from('affordability_assessments').select('*').eq('subject_id', subjectId)
            .order('created_at', { ascending: false }).limit(1)
        : Promise.resolve({ data: [] }),
    ]);

    const ev = {
      checks: checks.data ?? [],
      biometrics: biometrics.data ?? [],
      captures: captures.data ?? [],
      fraudSignals: fraudSignals.data ?? [],
      subject: subject.data ?? null,
      affordability: (affordability.data ?? [])[0] ?? null,
      subjectId,
      caseId: resolvedCase,
      customerId: resolvedCustomer,
      session,
      admin,
    };

    // Each agent forms its own view.
    const decisions: AgentDecision[] = [
      identityAgent(ev),
      documentAgent(ev),
      biometricAgent(ev),
      await fraudAgent(ev),
      affordabilityAgent(ev),
      await complianceAgent(ev),
    ];

    // ── Orchestration ─────────────────────────────────────────────
    const { data: agentRows } = await admin.from('agents').select('*').eq('active', true);
    const agentById = new Map((agentRows ?? []).map((a: any) => [a.id, a]));

    // A veto is decisive. Averaging a failed identity check against a
    // good affordability score would produce a number that means
    // nothing, so the orchestrator arbitrates instead.
    const vetoed = decisions.find(
      (d) => d.verdict === 'fail' && agentById.get(d.agentId)?.can_veto);

    const scored = decisions.filter((d) => d.verdict !== 'abstain');
    const totalWeight = scored.reduce(
      (a, d) => a + Number(agentById.get(d.agentId)?.weight ?? 1), 0);
    const weighted = scored.reduce((a, d) => {
      const w = Number(agentById.get(d.agentId)?.weight ?? 1);
      const v = d.verdict === 'pass' ? 100 : d.verdict === 'concern' ? 50 : 0;
      return a + v * w;
    }, 0);
    const confidence = totalWeight ? Number((weighted / totalWeight).toFixed(2)) : 0;

    const concerns = decisions.filter((d) => d.verdict === 'concern');
    const abstained = decisions.filter((d) => d.verdict === 'abstain');

    let recommendation: 'approve' | 'refer' | 'decline';
    let summary: string;

    if (vetoed) {
      recommendation = 'decline';
      summary = `${agentById.get(vetoed.agentId)?.name ?? vetoed.agentId} vetoed: ${vetoed.rationale}`;
    } else if (decisions.some((d) => d.verdict === 'fail')) {
      recommendation = 'refer';
      summary = 'A non-blocking check failed — a person should look at this before it proceeds.';
    } else if (concerns.length > 0) {
      recommendation = 'refer';
      summary = `${concerns.length} agent(s) raised a concern: `
        + concerns.map((c) => agentById.get(c.agentId)?.name ?? c.agentId).join(', ') + '.';
    } else if (abstained.length >= 3) {
      // Six agents that mostly had nothing to read is not an approval.
      recommendation = 'refer';
      summary = `${abstained.length} agents had no evidence to judge — the file is too thin to approve.`;
    } else {
      recommendation = 'approve';
      summary = 'Every agent with evidence to judge passed.';
    }

    const { data: run, error: runErr } = await admin
      .from('agent_runs')
      .insert({
        session_id: sessionId ?? null,
        case_id: resolvedCase,
        customer_id: resolvedCustomer,
        recommendation,
        confidence,
        vetoed_by: vetoed?.agentId ?? null,
        summary,
        human_outcome: 'pending',
        latency_ms: Date.now() - started,
      })
      .select()
      .single();
    if (runErr) return json({ error: runErr.message }, 500);

    for (const d of decisions) {
      await admin.from('agent_decisions').insert({
        run_id: run.id,
        agent_id: d.agentId,
        verdict: d.verdict,
        confidence: d.confidence,
        rationale: d.rationale,
        evidence: d.evidence,
        reason_codes: d.reasonCodes,
      });
    }

    if (sessionId) {
      await admin.from('capture_sessions').update({ status: 'adjudicating' }).eq('id', sessionId);
    }

    await audit(admin, {
      actorId: staff.userId,
      action: 'agents.adjudicated',
      entityType: sessionId ? 'capture_session' : 'verification_case',
      entityId: sessionId ?? resolvedCase,
      metadata: {
        recommendation, confidence, vetoed_by: vetoed?.agentId ?? null, ip: clientIp(req),
      },
    });

    return json({
      runId: run.id,
      recommendation,
      confidence,
      vetoedBy: vetoed?.agentId ?? null,
      summary,
      // A recommendation is not a decision. A person still applies it.
      awaitingHuman: true,
      decisions: decisions.map((d) => ({
        agent: agentById.get(d.agentId)?.name ?? d.agentId,
        agentId: d.agentId,
        remit: agentById.get(d.agentId)?.remit,
        canVeto: agentById.get(d.agentId)?.can_veto ?? false,
        verdict: d.verdict,
        confidence: d.confidence,
        rationale: d.rationale,
        evidence: d.evidence,
        reasonCodes: d.reasonCodes,
      })),
    });
  } catch (e) {
    console.error('agent-adjudicate failed', e);
    return json({ error: e instanceof Error ? e.message : 'Adjudication failed' }, 500);
  }
});

// ── The agents ──────────────────────────────────────────────────
// Each returns a verdict, a confidence, and a rationale written for a
// person to read. An agent with nothing to read abstains rather than
// passing — silence is not approval.

function latest(checks: any[], domain: string, type: string) {
  return checks
    .filter((c) => c.domain === domain && c.check_type === type && c.status !== 'pending')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

function identityAgent(ev: any): AgentDecision {
  const structure = latest(ev.checks, 'identity', 'id_structure');
  const authority = latest(ev.checks, 'identity', 'authority_lookup');
  const deceased = latest(ev.checks, 'identity', 'deceased_register');
  const watchlist = latest(ev.checks, 'identity', 'watchlist_screening');

  const evidence = {
    id_structure: structure?.status ?? null,
    authority_lookup: authority?.status ?? null,
    deceased_register: deceased?.status ?? null,
    watchlist_screening: watchlist?.status ?? null,
    assurance_level: ev.subject?.assurance_level ?? null,
  };

  if (!structure) {
    return { agentId: 'identity_agent', verdict: 'abstain', confidence: 0,
      rationale: 'No identity check has run yet, so there is nothing for me to judge.',
      evidence, reasonCodes: ['no_identity_check'] };
  }

  const codes: string[] = [];
  if (structure.status === 'failed') codes.push('id_structure_failed');
  if (ev.subject?.deceased || deceased?.status === 'failed') codes.push('subject_on_deceased_register');
  if (authority?.status === 'failed') codes.push('authority_no_match');

  if (codes.length > 0) {
    return { agentId: 'identity_agent', verdict: 'fail', confidence: 96,
      rationale: codes.includes('subject_on_deceased_register')
        ? 'This identity number appears on the deceased register. Nothing else about this application matters until that is resolved.'
        : codes.includes('id_structure_failed')
          ? 'The identity number does not satisfy its own check digit, so it was mistyped or invented.'
          : 'The authority does not hold a record matching this identity.',
      evidence, reasonCodes: codes };
  }

  if (watchlist?.status === 'manual_review') {
    return { agentId: 'identity_agent', verdict: 'concern', confidence: 62,
      rationale: 'The name matched a sanctions, PEP or internal list closely enough to need a person. '
        + 'Name collisions are common, especially across transliterations, so this is not a decline on its own.',
      evidence, reasonCodes: ['watchlist_potential_match'] };
  }

  if (authority?.status === 'manual_review') {
    return { agentId: 'identity_agent', verdict: 'concern', confidence: 58,
      rationale: 'The authority lookup did not cleanly match — usually a name discrepancy rather than a false identity.',
      evidence, reasonCodes: ['authority_partial_match'] };
  }

  if (!authority) {
    return { agentId: 'identity_agent', verdict: 'concern', confidence: 55,
      rationale: 'The number is well-formed and not on the deceased register, but no authority lookup has confirmed the record exists.',
      evidence, reasonCodes: ['authority_lookup_not_run'] };
  }

  return { agentId: 'identity_agent', verdict: 'pass', confidence: 93,
    rationale: 'The identity number checks out arithmetically, the authority holds a matching record, '
      + 'the subject is not on the deceased register, and no watchlist matched.',
    evidence, reasonCodes: [] };
}

function documentAgent(ev: any): AgentDecision {
  const authenticity = latest(ev.checks, 'document', 'document_authenticity');
  const expiry = latest(ev.checks, 'document', 'document_expiry');
  const nameMatch = latest(ev.checks, 'document', 'name_match');
  const docCaptures = ev.captures.filter((c: any) => c.capture_type.startsWith('document'));

  const evidence = {
    authenticity: authenticity?.status ?? null,
    authenticity_score: authenticity?.score ?? null,
    mrz_valid: authenticity?.result?.mrz_valid ?? null,
    expiry: expiry?.status ?? null,
    name_match: nameMatch?.status ?? null,
    document_captures: docCaptures.length,
    capture_quality: docCaptures.map((c: any) => c.quality_score),
  };

  if (!authenticity && docCaptures.length === 0) {
    return { agentId: 'document_agent', verdict: 'abstain', confidence: 0,
      rationale: 'No document has been scanned or verified, so there is nothing for me to judge.',
      evidence, reasonCodes: ['no_document'] };
  }

  const codes: string[] = [];
  if (authenticity?.status === 'failed') codes.push('document_authenticity_failed');
  if (expiry?.status === 'failed') codes.push('document_expired_or_stale');
  if (authenticity?.result?.mrz_valid === false) codes.push('mrz_check_digit_failed');

  if (codes.length > 0) {
    return { agentId: 'document_agent', verdict: 'fail', confidence: 94,
      rationale: codes.includes('mrz_check_digit_failed')
        ? 'The machine-readable zone fails its own check digits. That zone protects itself arithmetically, '
          + 'so this is alteration or fabrication, not a poor scan.'
        : codes.includes('document_expired_or_stale')
          ? 'The document has expired, or the supporting document is too old to prove a current state.'
          : 'Forensic analysis found a critical problem with this document.',
      evidence, reasonCodes: codes };
  }

  const poorScan = docCaptures.find((c: any) => c.quality_passed === false);
  if (poorScan) {
    return { agentId: 'document_agent', verdict: 'concern', confidence: 45,
      rationale: `The document scan did not meet the quality bar (${(poorScan.quality_reasons ?? []).join(', ')}). `
        + 'That is a photograph problem rather than a document problem — rescan before reading anything into it.',
      evidence, reasonCodes: ['document_capture_quality_low'] };
  }

  if (nameMatch?.status === 'manual_review' || nameMatch?.status === 'failed') {
    return { agentId: 'document_agent', verdict: 'concern', confidence: 55,
      rationale: 'The name on the document does not closely match the name given. Married names, '
        + 'initials and transliterations do this legitimately, so a person should compare them.',
      evidence, reasonCodes: ['document_name_mismatch'] };
  }

  if (!authenticity) {
    return { agentId: 'document_agent', verdict: 'concern', confidence: 40,
      rationale: 'A document was captured but has not been run through authenticity analysis yet.',
      evidence, reasonCodes: ['authenticity_not_run'] };
  }

  return { agentId: 'document_agent', verdict: 'pass', confidence: 90,
    rationale: 'The document is current, its machine-readable zone checks out, no tampering was '
      + 'detected, and the name matches the applicant.',
    evidence, reasonCodes: [] };
}

function biometricAgent(ev: any): AgentDecision {
  const verification = ev.biometrics[0];
  const selfie = ev.captures.find((c: any) => c.capture_type === 'selfie');
  const portrait = ev.captures.find((c: any) => c.capture_type === 'document_portrait');

  const evidence = {
    similarity: verification?.similarity ?? null,
    threshold: verification?.threshold_applied ?? null,
    matched: verification?.matched ?? null,
    liveness_passed: verification?.liveness_passed ?? null,
    attack_type: verification?.attack_type ?? null,
    selfie_quality: selfie?.quality_score ?? null,
    portrait_enrolled: !!portrait,
  };

  if (!verification) {
    return { agentId: 'biometric_agent', verdict: 'abstain', confidence: 0,
      rationale: 'No face comparison has been run, so I cannot say whether the person captured is '
        + 'the person on the document.',
      evidence, reasonCodes: ['no_biometric_verification'] };
  }

  // Liveness first, always — a match from a spoofed sample is worse
  // than no match, because it looks like proof.
  if (verification.liveness_passed === false) {
    return { agentId: 'biometric_agent', verdict: 'fail', confidence: 97,
      rationale: `The capture failed presentation attack detection (${verification.attack_type}). `
        + 'Whatever was in front of the camera, it was not a live person, and no similarity was computed '
        + 'from it — a high score obtained from a photograph is worse than no score at all.',
      evidence, reasonCodes: [`presentation_attack_${verification.attack_type}`] };
  }

  if (verification.matched === false) {
    // Distinguish "different person" from "bad photograph". They call
    // for opposite actions.
    if (selfie && selfie.quality_score !== null && Number(selfie.quality_score) < 60) {
      return { agentId: 'biometric_agent', verdict: 'concern', confidence: 50,
        rationale: `The faces did not match (similarity ${Number(verification.similarity).toFixed(3)} `
          + `against a threshold of ${verification.threshold_applied}), but the selfie scored only `
          + `${selfie.quality_score} for quality. Retake the photograph before concluding these are different people.`,
        evidence, reasonCodes: ['no_match_but_poor_capture'] };
    }
    return { agentId: 'biometric_agent', verdict: 'fail', confidence: 88,
      rationale: `The live capture does not match the portrait on the document `
        + `(similarity ${Number(verification.similarity).toFixed(3)}, threshold ${verification.threshold_applied}). `
        + 'The capture quality was adequate, so this is a person mismatch rather than a photography problem.',
      evidence, reasonCodes: ['face_match_failed'] };
  }

  const margin = Number(verification.similarity) - Number(verification.threshold_applied);
  if (margin < 0.05) {
    return { agentId: 'biometric_agent', verdict: 'concern', confidence: 60,
      rationale: `The faces matched, but only just — ${Number(verification.similarity).toFixed(3)} `
        + `against a threshold of ${verification.threshold_applied}. A borderline match at the `
        + 'operating false-match rate deserves a human look.',
      evidence, reasonCodes: ['borderline_match'] };
  }

  return { agentId: 'biometric_agent', verdict: 'pass', confidence: 92,
    rationale: `The live capture matches the document portrait with a clear margin `
      + `(${Number(verification.similarity).toFixed(3)} against ${verification.threshold_applied}), `
      + 'and the capture passed presentation attack detection, so a live person was present.',
    evidence, reasonCodes: [] };
}

async function fraudAgent(ev: any): Promise<AgentDecision> {
  const signals = ev.fraudSignals ?? [];
  const critical = signals.filter((s: any) => s.severity === 'critical');
  const warnings = signals.filter((s: any) => s.severity === 'warn');

  const evidence = {
    signal_count: signals.length,
    critical_count: critical.length,
    rules_fired: signals.map((s: any) => s.rule_code),
  };

  if (signals.length === 0) {
    return { agentId: 'fraud_agent', verdict: 'pass', confidence: 80,
      rationale: 'No fraud rule fired. Nothing here links to a document, address, phone, bank '
        + 'account or employer we have seen misused before.',
      evidence, reasonCodes: [] };
  }

  if (critical.length > 0) {
    const names = critical.map((s: any) => s.rule_code).join(', ');
    return { agentId: 'fraud_agent', verdict: 'fail', confidence: 90,
      rationale: `${critical.length} critical signal(s) fired: ${names}. `
        + 'Each of these is a specific, checkable finding rather than a risk score, and each has its '
        + 'evidence attached.',
      evidence, reasonCodes: critical.map((s: any) => s.rule_code) };
  }

  return { agentId: 'fraud_agent', verdict: 'concern', confidence: 55,
    rationale: `${warnings.length} warning-level signal(s) fired: `
      + warnings.map((s: any) => s.rule_code).join(', ')
      + '. None is decisive on its own — a shared address is a block of flats as often as a syndicate — '
      + 'but a person should look.',
    evidence, reasonCodes: warnings.map((s: any) => s.rule_code) };
}

function affordabilityAgent(ev: any): AgentDecision {
  const aff = ev.affordability;
  const evidence = {
    outcome: aff?.outcome ?? null,
    net_income_cents: aff?.net_income_cents ?? null,
    discretionary_income_cents: aff?.discretionary_income_cents ?? null,
    income_verified: aff?.income_verified ?? null,
  };

  if (!aff) {
    return { agentId: 'affordability_agent', verdict: 'abstain', confidence: 0,
      rationale: 'No affordability assessment exists. That is fine for an identity-only onboarding, '
        + 'but nothing can be lent until one does.',
      evidence, reasonCodes: ['no_affordability_assessment'] };
  }

  if (aff.outcome === 'not_affordable') {
    return { agentId: 'affordability_agent', verdict: 'fail', confidence: 90,
      rationale: 'The NCA assessment shows no room for a further obligation. Lending here would be '
        + 'reckless credit under s80 regardless of how good the rest of the file looks.',
      evidence, reasonCodes: ['not_affordable'] };
  }

  if (aff.outcome === 'marginal' || !aff.income_verified) {
    return { agentId: 'affordability_agent', verdict: 'concern', confidence: 55,
      rationale: !aff.income_verified
        ? 'The income has not been corroborated against a payslip or bank statement, so the '
          + 'affordability figure rests on what the applicant said.'
        : 'The assessment clears, but by a thin margin — a small shock would break it.',
      evidence, reasonCodes: [aff.income_verified ? 'thin_margin' : 'income_not_corroborated'] };
  }

  return { agentId: 'affordability_agent', verdict: 'pass', confidence: 85,
    rationale: 'Verified income leaves real discretionary room after the prescribed minimum expenses '
      + 'and existing obligations.',
    evidence, reasonCodes: [] };
}

async function complianceAgent(ev: any): Promise<AgentDecision> {
  const admin = ev.admin;
  const evidence: Record<string, unknown> = {};
  const codes: string[] = [];

  if (!ev.subjectId) {
    return { agentId: 'compliance_agent', verdict: 'abstain', confidence: 0,
      rationale: 'No subject is attached, so there is no consent position for me to check.',
      evidence, reasonCodes: ['no_subject'] };
  }

  // Biometric processing without consent is the one that matters most:
  // POPIA s26 makes it special personal information.
  const purposes = ['identity_verification', 'biometric_processing'];
  for (const purpose of purposes) {
    const { data } = await admin.rpc('has_active_consent', {
      p_subject_id: ev.subjectId, p_purpose: purpose,
    });
    evidence[purpose] = !!data;
    if (!data) codes.push(`missing_consent_${purpose}`);
  }

  const hasBiometric = ev.biometrics.length > 0
    || ev.captures.some((c: any) => c.capture_type === 'selfie');

  if (codes.includes('missing_consent_biometric_processing') && hasBiometric) {
    return { agentId: 'compliance_agent', verdict: 'fail', confidence: 98,
      rationale: 'Biometric processing happened without a live consent on record. Under POPIA s26 '
        + 'biometric data is special personal information and s27 requires explicit consent. '
        + 'This is not a paperwork gap — it is unlawful processing.',
      evidence, reasonCodes: codes };
  }

  if (codes.length > 0) {
    return { agentId: 'compliance_agent', verdict: 'concern', confidence: 60,
      rationale: `Consent is missing for: ${codes.map((c) => c.replace('missing_consent_', '')).join(', ')}. `
        + 'Capture it before the file is closed.',
      evidence, reasonCodes: codes };
  }

  return { agentId: 'compliance_agent', verdict: 'pass', confidence: 92,
    rationale: 'Live consent is on record for every purpose processed here, with the wording the '
      + 'subject agreed to identifiable.',
    evidence, reasonCodes: [] };
}
