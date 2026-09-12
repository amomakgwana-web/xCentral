// ══════════════════════════════════════════════════════════════
// A client shaped like the real one, backed by the in-memory tables.
//
// The console reaches its data through one object. Point that object
// at Postgres and it is production; point it here and it is the same
// console running on generated records. backend.js and console.js are
// untouched either way, which is the whole reason for doing it at this
// seam rather than stubbing forty read functions: there is one
// implementation of the query logic, and it is the one that ships.
//
// This speaks the subset the console actually uses and refuses the
// rest loudly. A client that quietly answered a filter it did not
// really implement would show numbers nobody could trust, which is
// worse than an error.
// ══════════════════════════════════════════════════════════════

import { dataset } from './data/index.js';
import {
  caseScore, paymentBehaviour, assessCapacity, assessAffordability,
  assessCaptureQuality, validateSaId, generateSchedule, allocatePayments,
  recomputeContract,
} from './data/compute.js';
import { capture_quality_rules, fraud_rules } from './data/reference.js';
import { NOW, iso, isoDate, tag } from './data/generate.js';
import { createPipeline } from './localPipeline.js';

class Unsupported extends Error {}

// ── Query builder ───────────────────────────────────────────────
// Chainable and thenable, so `await db.from('x').select('*').eq(…)`
// behaves the way the calling code already expects.
class Query {
  constructor(rows, table) {
    this.rows = rows;
    this.table = table;
    this.singleMode = null;
  }

  select() { return this; }

  eq(col, value) {
    this.rows = this.rows.filter((r) => String(r[col] ?? '') === String(value ?? ''));
    return this;
  }

  neq(col, value) {
    this.rows = this.rows.filter((r) => String(r[col] ?? '') !== String(value ?? ''));
    return this;
  }

  is(col, value) {
    if (value === null) this.rows = this.rows.filter((r) => r[col] === null || r[col] === undefined);
    else this.rows = this.rows.filter((r) => r[col] === value);
    return this;
  }

  in(col, values) {
    const set = new Set((values ?? []).map((v) => String(v)));
    this.rows = this.rows.filter((r) => set.has(String(r[col] ?? '')));
    return this;
  }

  gt(col, v) { this.rows = this.rows.filter((r) => r[col] > v); return this; }
  gte(col, v) { this.rows = this.rows.filter((r) => r[col] >= v); return this; }
  lt(col, v) { this.rows = this.rows.filter((r) => r[col] < v); return this; }
  lte(col, v) { this.rows = this.rows.filter((r) => r[col] <= v); return this; }

  order(col, opts = {}) {
    const dir = opts.ascending === false ? -1 : 1;
    this.rows = this.rows.slice().sort((a, b) => {
      const x = a[col]; const y = b[col];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * dir;
    });
    return this;
  }

  limit(n) { this.rows = this.rows.slice(0, n); return this; }
  range(from, to) { this.rows = this.rows.slice(from, to + 1); return this; }

  maybeSingle() { this.singleMode = 'maybe'; return this; }
  single() { this.singleMode = 'one'; return this; }

  then(resolve, reject) {
    try {
      if (this.singleMode === 'maybe') {
        return resolve({ data: this.rows[0] ?? null, error: null });
      }
      if (this.singleMode === 'one') {
        if (this.rows.length !== 1) {
          return resolve({
            data: null,
            error: { code: 'PGRST116', message: `expected one row, found ${this.rows.length}` },
          });
        }
        return resolve({ data: this.rows[0], error: null });
      }
      return resolve({ data: this.rows, error: null });
    } catch (e) {
      return reject ? reject(e) : resolve({ data: null, error: { message: e.message } });
    }
  }
}

export function createLocalClient() {
  const t = dataset();

  // Indexes rebuilt lazily, since the console mutates through the
  // function equivalents below and the pages re-read afterwards.
  const find = (table, id) => (t[table] ?? []).find((r) => r.id === id);
  const where = (table, pred) => (t[table] ?? []).filter(pred);

  const schedulesFor = (contractId) => t.payment_schedule.filter((s) => s.contract_id === contractId);
  const paymentsFor = (customerId) => t.payments.filter((p) => p.customer_id === customerId);
  const contractsFor = (customerId) => t.contracts.filter((c) => c.customer_id === customerId);

  // Nobody is signed in until they sign in. The console handles that
  // and shows the pages regardless — reading is not gated on a session
  // here, exactly as row level security allows in production.
  let session = null;

  function customerProfile(customerId) {
    const customer = find('customers', customerId);
    if (!customer) return { error: 'customer_not_found' };
    const subject = find('subjects', customer.subject_id);
    const contracts = contractsFor(customerId);
    const schedules = {};
    for (const c of contracts) schedules[c.id] = schedulesFor(c.id);
    const payments = paymentsFor(customerId);

    const bureau = t.credit_checks
      .filter((c) => c.subject_id === customer.subject_id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] ?? null;
    const afford = t.affordability_assessments
      .filter((a) => a.subject_id === customer.subject_id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] ?? null;

    const alerts = t.fraud_alerts.filter((a) => a.customer_id === customerId);
    const signals = t.fraud_signals.filter((s) => s.customer_id === customerId && !s.dismissed);

    return {
      customer: {
        id: customer.id, customer_number: customer.customer_number, status: customer.status,
        platform_id: customer.platform_id, email: customer.email, onboarded_at: customer.onboarded_at,
      },
      identity: subject ? {
        name: [subject.first_names, subject.surname].filter(Boolean).join(' '),
        id_type: subject.id_type, id_last4: subject.id_last4,
        date_of_birth: subject.date_of_birth, gender: subject.gender,
        citizenship: subject.citizenship, deceased: subject.deceased,
        assurance_level: subject.assurance_level, assurance_expires_at: subject.assurance_expires_at,
      } : null,
      contact: {
        addresses: t.addresses.filter((a) => a.customer_id === customerId).map((a) => ({
          id: a.id, type: a.address_type, line1: a.line1, suburb: a.suburb, city: a.city,
          province: a.province, postal_code: a.postal_code,
          status: t.address_verifications.find((v) => v.address_id === a.id)?.status ?? 'pending',
          shared_with: t.addresses.filter((x) => x.address_hash === a.address_hash).length - 1,
        })),
        phones: t.phone_numbers.filter((p) => p.customer_id === customerId).map((p) => {
          const v = t.phone_verifications.find((x) => x.phone_id === p.id);
          return {
            msisdn: p.msisdn, network: p.network, line_type: p.line_type,
            rica_status: v?.rica_status ?? null, days_since_sim_swap: v?.days_since_sim_swap ?? null,
          };
        }),
      },
      employment: t.employment_records.filter((e) => e.customer_id === customerId).map((e) => {
        const v = t.employment_verifications.find((x) => x.employment_id === e.id);
        const emp = find('employers', e.employer_id);
        return {
          employer: e.employer_name_claimed, job_title: e.job_title,
          started_on: e.started_on, gross_monthly_cents: e.gross_monthly_cents,
          net_monthly_cents: e.net_monthly_cents,
          cipc_status: emp?.cipc_status ?? null,
          status: v?.status ?? 'pending', confidence: v?.confidence ?? null,
        };
      }),
      credit: {
        bureau: bureau ? {
          bureau: bureau.bureau_id, score: bureau.score, band: bureau.band, risk: bureau.risk,
          accounts_total: bureau.accounts_total, accounts_in_arrears: bureau.accounts_in_arrears,
          defaults: bureau.defaults, judgments: bureau.judgments, debt_review: bureau.debt_review,
          checked_at: bureau.created_at,
        } : null,
        affordability: afford ? {
          outcome: afford.outcome, assessed_on: afford.assessed_on,
          income_verified: afford.income_verified,
          net_income_cents: afford.net_income_cents,
          discretionary_income_cents: afford.discretionary_income_cents,
        } : null,
      },
      portfolio: {
        contracts: contracts.map((c) => {
          const asset = find('assets', c.asset_id);
          return {
            id: c.id, agreement_type: c.agreement_type, status: c.status,
            instalment_cents: c.instalment_cents, balance_cents: c.balance_cents,
            arrears_cents: c.arrears_cents, months_in_arrears: c.months_in_arrears,
            asset: asset ? { make: asset.make, model: asset.model, variant: asset.variant } : null,
          };
        }),
        total_exposure_cents: contracts.reduce((s, c) => s + (c.balance_cents ?? 0), 0),
        monthly_commitment_cents: contracts
          .filter((c) => ['active', 'in_arrears', 'defaulted'].includes(c.status))
          .reduce((s, c) => s + c.instalment_cents, 0),
        total_arrears_cents: contracts.reduce((s, c) => s + (c.arrears_cents ?? 0), 0),
      },
      payment_behaviour: paymentBehaviour({ contracts, schedules, payments }),
      fraud: {
        open_alerts: alerts.filter((a) => ['open', 'investigating'].includes(a.status)).length,
        highest_score: alerts.reduce((m, a) => Math.max(m, a.score), 0),
        signals: signals.map((s) => ({
          rule: s.rule_code, severity: s.severity, detail: s.detail, created_at: s.created_at,
        })),
      },
    };
  }

  const RPC = {
    has_permission: () => true,

    case_score: ({ p_case_id }) => {
      const kase = find('verification_cases', p_case_id);
      if (!kase) return { error: 'case_not_found' };
      return caseScore(kase, t.verification_checks.filter((c) => c.case_id === p_case_id));
    },

    customer_profile: ({ p_customer_id }) => customerProfile(p_customer_id),

    payment_behaviour: ({ p_customer_id }) => {
      const contracts = contractsFor(p_customer_id);
      const schedules = {};
      for (const c of contracts) schedules[c.id] = schedulesFor(c.id);
      return paymentBehaviour({ contracts, schedules, payments: paymentsFor(p_customer_id) });
    },

    assess_credit_capacity: (args) => {
      const customer = find('customers', args.p_customer_id);
      if (!customer) return { decision: 'insufficient_data', reason_codes: ['customer_not_found'] };
      const contracts = contractsFor(customer.id);
      const schedules = {};
      for (const c of contracts) schedules[c.id] = schedulesFor(c.id);
      const behaviour = paymentBehaviour({ contracts, schedules, payments: paymentsFor(customer.id) });
      const bureau = t.credit_checks
        .filter((c) => c.subject_id === customer.subject_id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] ?? null;
      const affordability = t.affordability_assessments
        .filter((a) => a.subject_id === customer.subject_id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] ?? null;
      const fraudScore = t.fraud_alerts
        .filter((a) => a.customer_id === customer.id && ['open', 'investigating'].includes(a.status))
        .reduce((m, a) => Math.max(m, a.score), 0);
      return assessCapacity({
        customer,
        agreementType: args.p_agreement_type ?? 'instalment_sale',
        termMonths: args.p_term_months ?? 60,
        ratePct: Number(args.p_rate_pct ?? 15),
        affordability, bureau, behaviour, fraudScore, contracts,
      });
    },

    assess_affordability: (args) => assessAffordability({
      grossCents: args.p_gross_income_cents,
      deductionsCents: args.p_statutory_deductions_cents ?? 0,
      declaredExpensesCents: args.p_declared_expenses_cents ?? 0,
      existingObligationsCents: args.p_existing_obligations_cents ?? 0,
      proposedInstalmentCents: args.p_proposed_instalment_cents ?? 0,
      incomeVerified: args.p_income_verified ?? true,
    }),

    assess_capture_quality: (args) => assessCaptureQuality(args.p_capture_type, {
      sharpness: args.p_sharpness, brightness: args.p_brightness, contrast: args.p_contrast,
      width: args.p_width, height: args.p_height,
      faceCount: args.p_face_count, faceAreaPct: args.p_face_area_pct,
    }, capture_quality_rules),

    validate_sa_id: (args) => validateSaId(args.p_id_number ?? args.id_number),
  };

  // ── Edge-function equivalents ─────────────────────────────────
  // The write paths. In production these are Deno functions that check
  // a permission and write an audit entry before doing anything; here
  // they do the same work against the tables, and still write the
  // audit entry, because a change nobody can trace is not an
  // improvement over no change at all.
  const audit = (action, entityType, entityId, metadata) => {
    t.audit_log.unshift({
      id: `aud_${t.audit_log.length + 1}`,
      actor_id: session?.user?.id ?? null,
      actor_platform: null,
      action, entity_type: entityType, entity_id: entityId,
      metadata: metadata ?? {},
      created_at: iso(new Date()),
    });
  };

  const FUNCTIONS = {
    'case-decision': (body) => {
      const kase = find('verification_cases', body.caseId);
      if (!kase) throw new Error('Case not found');
      kase.status = body.decision === 'verify' ? 'verified' : 'rejected';
      kase.decision_reason = body.reason ?? null;
      kase.decided_at = iso(new Date());
      kase.updated_at = kase.decided_at;
      audit('case.decided', 'verification_case', kase.id,
        { status: kase.status, reason: kase.decision_reason });
      return { caseId: kase.id, status: kase.status };
    },

    'record-consent': (body) => {
      const row = {
        id: `con_${t.consents.length + 1}`,
        subject_id: body.subjectId, platform_id: body.platformId ?? null,
        case_id: body.caseId ?? null, purpose: body.purpose,
        special_personal_information: body.purpose === 'biometric_processing',
        lawful_basis: body.lawfulBasis ?? 'consent',
        consent_text_id: body.textId ?? null, method: body.method ?? 'click_wrap',
        evidence: {}, captured_ip: null, captured_user_agent: null,
        granted_at: iso(new Date()), expires_at: null,
        withdrawn_at: null, withdrawal_reason: null, created_at: iso(new Date()),
      };
      t.consents.unshift(row);
      audit('consent.granted', 'consent', row.id, { purpose: row.purpose });
      return row;
    },

    'run-fraud-screen': (body) => {
      const alert = t.fraud_alerts.find(
        (a) => a.customer_id === body.customerId || a.case_id === body.caseId);
      const signals = t.fraud_signals.filter(
        (s) => (body.customerId && s.customer_id === body.customerId)
          || (body.caseId && s.case_id === body.caseId));
      audit('fraud.screen_run', 'customer', body.customerId ?? body.caseId, {});
      return {
        score: alert?.score ?? signals.reduce((s, x) => s + Number(x.weight), 0),
        severity: alert?.severity ?? 'low',
        signals: signals.length,
        critical: signals.filter((s) => s.severity === 'critical').length,
        alert_id: alert?.id ?? null,
        signal_detail: signals.map((s) => ({ rule: s.rule_code, severity: s.severity, detail: s.detail })),
      };
    },

    'document-access': (body) => {
      const doc = find('documents', body.documentId);
      if (!doc) throw new Error('Document not found');
      if (!body.reason) throw new Error('A written reason is required before a document can be opened');
      // The audit entry is written before the URL exists, which is the
      // ordering that matters: the record of the access cannot be
      // skipped by whatever happens next.
      audit('document.accessed', 'document', doc.id,
        { doc_type: doc.doc_type, reason: body.reason, url_ttl_seconds: 300 });
      return {
        // No object store is running locally, so there is nothing to
        // hand back. Saying so is better than minting a link that 404s.
        url: null,
        expiresIn: 300,
        note: 'Document storage is not attached in this environment. The access has still been logged.',
      };
    },

    'manage-api-key': (body) => {
      if (body.action === 'revoke') {
        const key = find('api_keys', body.keyId);
        if (!key) throw new Error('Key not found');
        key.revoked_at = iso(new Date());
        audit('api_key.revoked', 'api_key', key.id, { reason: body.reason ?? null });
        return { id: key.id, revoked_at: key.revoked_at };
      }
      const row = {
        id: `ak_${t.api_keys.length + 1}`,
        platform_id: body.platformId, name: body.name ?? 'New key',
        key_prefix: 'xck_new', key_last4: tag('key', String(t.api_keys.length)).slice(-4),
        key_hash: tag('keyhash', String(t.api_keys.length)),
        environment: 'sandbox', scopes: body.scopes ?? ['identity'],
        rate_limit_per_min: body.rateLimit ?? 60,
        last_used_at: null, expires_at: null, revoked_at: null,
        revoked_by: null, created_by: session?.user?.id ?? null, created_at: iso(new Date()),
      };
      t.api_keys.unshift(row);
      audit('api_key.issued', 'api_key', row.id, { scopes: row.scopes });
      return { ...row, key: 'xck_local_this_is_shown_once_only' };
    },

    // ── Live capture ──────────────────────────────────────────
    // In production each of these is an edge function. Here they run
    // in the tab, over the same records, with the same division of
    // labour: the page measures, the pipeline decides.
    'verify-identity': (body) => pipeline.verifyIdentity(body),

    'capture-intake': (body) => {
      if (body.action === 'open') return pipeline.openSession(body);
      if (body.action === 'reconcile') return pipeline.reconcile(body);
      return pipeline.submitCapture(body);
    },

    'agent-adjudicate': (body) => {
      if (body.action === 'decide') {
        return pipeline.applyDecision({ runId: body.runId, outcome: body.outcome, reason: body.reason });
      }
      return pipeline.adjudicate(body);
    },
  };

  const pipeline = createPipeline({ tables: t, audit, getSession: () => session });

  // Everything the console can call that this environment cannot
  // honestly do — running a live bureau enquiry, templating a face,
  // parsing a document — says so rather than inventing a result.
  // Live capture runs here for real: the identity arithmetic, the
  // comparisons, the document forensics and the agents are all
  // computed, not invented. What remains on this list is the work that
  // genuinely needs a provider — a bureau enquiry, a registry lookup —
  // and it still says so rather than returning a number nobody could
  // stand behind.
  const NOT_LOCAL = [
    'verify-document', 'verify-credit', 'verify-biometric',
    'customer-onboard', 'vet-background',
    'assess-credit-capacity', 'manage-contract',
  ];

  return {
    // Marks this client for anything that needs to know which one it is.
    __local: true,

    from(table) {
      const rows = t[table];
      if (!rows) throw new Unsupported(`unknown table ${table}`);
      return new Query(rows.slice(), table);
    },

    async rpc(name, args = {}) {
      const fn = RPC[name];
      if (!fn) return { data: null, error: { message: `${name} is not available in this environment` } };
      try { return { data: fn(args), error: null }; }
      catch (e) { return { data: null, error: { message: e.message } }; }
    },

    auth: {
      async signInWithPassword({ email }) {
        const profile = t.profiles.find((p) => p.email === String(email).toLowerCase())
          ?? t.profiles.find((p) => p.role === 'admin' && p.status === 'active');
        if (!profile) return { data: null, error: { message: 'No account matches that address' } };
        session = { user: { id: profile.id, email: profile.email } };
        return { data: session, error: null };
      },
      async signOut() { session = null; return { error: null }; },
      async getUser() { return { data: { user: session?.user ?? null }, error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },

    functions: {
      async invoke(name, opts = {}) {
        const body = opts.body ?? {};
        if (FUNCTIONS[name]) {
          try { return { data: FUNCTIONS[name](body), error: null }; }
          catch (e) { return { data: null, error: { message: e.message } }; }
        }
        if (NOT_LOCAL.includes(name)) {
          return {
            data: null,
            error: {
              message: `${name} needs the verification services, which are not attached in this environment. `
                + 'The records already on file are unaffected.',
            },
          };
        }
        return { data: null, error: { message: `${name} is not available in this environment` } };
      },
    },

    // No realtime without a server pushing. Returning a channel that
    // never fires is honest; pretending to subscribe and silently
    // dropping updates would not be.
    channel() {
      return {
        on() { return this; },
        subscribe() { return this; },
        unsubscribe() { return this; },
      };
    },

    removeChannel() {},
  };
}
