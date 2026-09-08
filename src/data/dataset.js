// ══════════════════════════════════════════════════════════════
// The records.
//
// Builds every table the console reads, in dependency order, with at
// least two hundred rows in each record-bearing module. Configuration
// tables — bureaus, modalities, agents, fraud rules, retention
// policies — are in reference.js and are deliberately their natural
// size; there are four credit bureaus in this country, and inventing
// another hundred and ninety-six would make the page lie.
//
// People are built from archetypes rather than at random. An archetype
// decides one thing — how this person's file turns out — and then
// every record that follows agrees with it: a file that fails its
// document check also fails its face match, has an employer CIPC
// cannot find, and never makes an instalment. Random fields produce
// volume; archetypes produce a dataset where the fraud page and the
// arrears book are talking about the same people.
// ══════════════════════════════════════════════════════════════

import {
  makeRandom, NOW, daysAgo, monthsAgo, addMonths, iso, isoDate,
  idLast4, imei, instalmentCents, tag, uid,
  FIRST_NAMES_F, FIRST_NAMES_M, SURNAMES, PLACES, STREETS, STREET_TYPE,
  BANKS, NETWORKS, SECTORS, EMPLOYER_STEMS, EMPLOYER_TAIL, EMPLOYER_FORM,
  JOB_TITLES, VEHICLES, HANDSETS, OTHER_ASSETS, COLOURS, CREDITORS,
  ACCOUNT_TYPES, PLATFORMS, PREFIX, CASE_REF_STEM,
} from './generate.js';

import {
  client_platforms, consent_texts, document_types, credit_bureaus,
  biometric_modalities, verification_requirements, affordability_norms, nca_caps,
  retention_policies, capture_quality_rules, agents, fraud_rules, credit_policies,
  asset_types, ncaMinimumExpensesCents,
} from './reference.js';

import {
  caseScore, generateSchedule, allocatePayments, recomputeContract,
  paymentBehaviour, assessAffordability, assessCapacity,
} from './compute.js';

const N_PEOPLE = 900;

// How a file turns out. The weights are roughly what a lender's book
// looks like: most files are unremarkable, and the interesting ones
// are interesting precisely because they are rare.
const ARCHETYPES = [
  ['clean', 40], ['strong', 11], ['late', 10], ['thin', 8],
  ['slipping', 6], ['arrears', 5], ['default', 3], ['settled', 4],
  ['fraud', 2], ['watchlist', 2], ['inflight', 3], ['pending', 6],
];

// ── Check templates, one set per outcome ────────────────────────
// The scores are the evidence. caseScore() turns them into the number
// on the case, so no case can claim a score its checks do not support.
const ARC_CHECKS = {
  strong: [
    ['identity', 'id_structure', 'xcentral', 'passed', 100],
    ['identity', 'authority_lookup', 'simulation', 'passed', 100],
    ['identity', 'deceased_register', 'xcentral', 'passed', 100],
    ['identity', 'watchlist_screening', 'xcentral', 'passed', 100],
    ['document', 'document_authenticity', 'simulation', 'passed', 97],
    ['document', 'document_expiry', 'xcentral', 'passed', 100],
    ['document', 'name_match', 'xcentral', 'passed', 100],
    ['biometric', 'face_match', 'simulation', 'passed', 96],
    ['biometric', 'liveness', 'simulation', 'passed', 98],
    ['credit', 'bureau_enquiry', 'simulation', 'passed', 91],
    ['credit', 'affordability', 'xcentral', 'passed', 93],
  ],
  clean: [
    ['identity', 'id_structure', 'xcentral', 'passed', 100],
    ['identity', 'authority_lookup', 'simulation', 'passed', 100],
    ['identity', 'deceased_register', 'xcentral', 'passed', 100],
    ['identity', 'watchlist_screening', 'xcentral', 'passed', 100],
    ['document', 'document_authenticity', 'simulation', 'passed', 93],
    ['document', 'document_expiry', 'xcentral', 'passed', 100],
    ['document', 'name_match', 'xcentral', 'passed', 99],
    ['biometric', 'face_match', 'simulation', 'passed', 92],
    ['biometric', 'liveness', 'simulation', 'passed', 96],
    ['credit', 'bureau_enquiry', 'simulation', 'passed', 82],
    ['credit', 'affordability', 'xcentral', 'passed', 87],
  ],
  thin: [
    ['identity', 'id_structure', 'xcentral', 'passed', 100],
    ['identity', 'authority_lookup', 'simulation', 'passed', 100],
    ['identity', 'deceased_register', 'xcentral', 'passed', 100],
    ['identity', 'watchlist_screening', 'xcentral', 'passed', 100],
    ['document', 'document_authenticity', 'simulation', 'passed', 89],
    ['document', 'document_expiry', 'xcentral', 'passed', 100],
    ['document', 'name_match', 'xcentral', 'passed', 96],
    ['biometric', 'face_match', 'simulation', 'passed', 88],
    ['biometric', 'liveness', 'simulation', 'passed', 94],
    ['credit', 'bureau_enquiry', 'simulation', 'manual_review', 44, ['thin_credit_file']],
    ['credit', 'affordability', 'xcentral', 'passed', 74],
  ],
  fraud: [
    ['identity', 'id_structure', 'xcentral', 'passed', 100],
    ['identity', 'authority_lookup', 'simulation', 'passed', 100],
    ['identity', 'deceased_register', 'xcentral', 'passed', 100],
    ['identity', 'watchlist_screening', 'xcentral', 'passed', 100],
    ['document', 'document_authenticity', 'simulation', 'failed', 4,
      ['mrz_check_digit_failed_composite', 'tamper_font_mismatch', 'tamper_metadata_edited']],
    ['document', 'document_expiry', 'xcentral', 'passed', 100],
    ['document', 'name_match', 'xcentral', 'manual_review', 61, ['name_partial_match']],
    ['biometric', 'face_match', 'simulation', 'failed', 18, ['face_below_threshold']],
    ['biometric', 'liveness', 'simulation', 'passed', 91],
    ['credit', 'bureau_enquiry', 'simulation', 'passed', 31],
    ['credit', 'affordability', 'xcentral', 'failed', 9,
      ['payslip_net_does_not_reconcile', 'employer_not_at_cipc']],
  ],
  watchlist: [
    ['identity', 'id_structure', 'xcentral', 'passed', 100],
    ['identity', 'authority_lookup', 'simulation', 'passed', 100],
    ['identity', 'deceased_register', 'xcentral', 'passed', 100],
    ['identity', 'watchlist_screening', 'xcentral', 'manual_review', 40, ['watchlist_potential_match']],
    ['document', 'document_authenticity', 'simulation', 'passed', 95],
    ['document', 'document_expiry', 'xcentral', 'passed', 100],
    ['document', 'name_match', 'xcentral', 'passed', 99],
    ['biometric', 'face_match', 'simulation', 'passed', 93],
    ['biometric', 'liveness', 'simulation', 'passed', 96],
  ],
  inflight: [
    ['identity', 'id_structure', 'xcentral', 'passed', 100],
    ['identity', 'deceased_register', 'xcentral', 'passed', 100],
    ['document', 'document_authenticity', 'simulation', 'manual_review', 52, ['image_quality_marginal']],
  ],
  refresh: [
    ['identity', 'id_structure', 'xcentral', 'passed', 100],
    ['identity', 'authority_lookup', 'simulation', 'passed', 100],
    ['identity', 'deceased_register', 'xcentral', 'passed', 100],
    ['identity', 'watchlist_screening', 'xcentral', 'passed', 100],
  ],
  agecheck: [
    ['identity', 'id_structure', 'xcentral', 'passed', 100],
    ['identity', 'deceased_register', 'xcentral', 'passed', 100],
    ['identity', 'watchlist_screening', 'xcentral', 'passed', 100],
    ['document', 'document_expiry', 'xcentral', 'passed', 100],
  ],
};

// Archetypes that behave like `clean` for evidence but differ in how
// they pay. The distinction is deliberate: a customer who falls behind
// two years after onboarding did not have a bad file at onboarding.
ARC_CHECKS.late = ARC_CHECKS.clean;
ARC_CHECKS.slipping = ARC_CHECKS.clean;
ARC_CHECKS.arrears = ARC_CHECKS.clean;
ARC_CHECKS.default = ARC_CHECKS.thin;
ARC_CHECKS.settled = ARC_CHECKS.strong;
// Waiting on a credit officer: the evidence is in and one check needs
// a person, which is exactly what 'review' means.
ARC_CHECKS.pending = ARC_CHECKS.thin;

const CASE_STATUS = {
  strong: 'verified', clean: 'verified', late: 'verified', slipping: 'verified',
  arrears: 'verified', default: 'verified', settled: 'verified', thin: 'verified',
  fraud: 'rejected', watchlist: 'review', inflight: 'in_progress', pending: 'review',
};

const PAY_PATTERN = {
  strong: 'clean', clean: 'clean', late: 'late', slipping: 'slipping',
  arrears: 'arrears', default: 'nothing', settled: 'settled',
  thin: 'clean', fraud: 'nothing', watchlist: null, inflight: null,
};

export function buildDataset(seed = 20260908) {
  const R = makeRandom(seed);
  const ctxStaff = {};
  const t = {
    // Configuration, carried through unchanged.
    client_platforms, consent_texts, document_types, credit_bureaus,
    biometric_modalities, verification_requirements, affordability_norms, nca_caps,
    retention_policies, capture_quality_rules, agents, fraud_rules, credit_policies,
    asset_types,
    // Records, built below.
    profiles: [], subjects: [], consents: [], customers: [],
    addresses: [], address_verifications: [], phone_numbers: [], phone_verifications: [],
    employers: [], employment_records: [], employment_verifications: [], bank_accounts: [],
    verification_cases: [], verification_checks: [], identity_verifications: [],
    documents: [], document_verifications: [], document_forensics: [],
    credit_checks: [], credit_accounts: [], affordability_assessments: [],
    biometric_templates: [], biometric_verifications: [], biometric_duplicate_flags: [],
    watchlist_entries: [], watchlist_hits: [], deceased_register: [],
    assets: [], contracts: [], payment_schedule: [], payments: [], payment_allocations: [],
    capture_sessions: [], captures: [], agent_runs: [], agent_decisions: [],
    fraud_signals: [], fraud_alerts: [], known_fraud_register: [],
    credit_assessments: [],
    api_keys: [], api_requests: [], webhook_endpoints: [], webhook_deliveries: [],
    audit_log: [], dsar_requests: [],
  };

  const platformIds = PLATFORMS.filter((p) => p.id !== 'xcentral_console').map((p) => p.id);

  // ══════════════════════════════════════════════════════════
  // 0 · Staff
  // ══════════════════════════════════════════════════════════
  // Who did what is half of an audit trail. A decision attributed to
  // nobody is a decision nobody can be asked about.
  const ROLES = [
    ['operator', 'Branch operator', 34], ['reviewer', 'Case reviewer', 22],
    ['fraud_analyst', 'Fraud analyst', 12], ['collections', 'Collections', 12],
    ['dealer_admin', 'Dealer administrator', 10], ['compliance', 'Compliance officer', 7],
    ['admin', 'Administrator', 3],
  ];
  for (let i = 0; i < 220; i++) {
    const male = R.chance(0.5);
    const first = R.pick(male ? FIRST_NAMES_M : FIRST_NAMES_F);
    const surname = R.pick(SURNAMES);
    const [role, roleName] = R.weighted(ROLES.map((r) => [r, r[2]]));
    t.profiles.push({
      id: `stf_${i + 1}`,
      email: `${first.toLowerCase()}.${surname.toLowerCase().replace(/[^a-z]/g, '')}@xcentral.co.za`,
      name: `${first} ${surname}`,
      role,
      role_name: roleName,
      platform_id: R.pick(platformIds),
      status: R.weighted([['active', 18], ['suspended', 1]]),
      last_seen_at: iso(daysAgo(R.int(0, 40))),
      created_at: iso(daysAgo(R.int(60, 1400))),
    });
  }
  const staff = t.profiles.filter((s) => s.status === 'active');
  const staffBy = (role) => {
    const pool = staff.filter((s) => s.role === role);
    return pool.length ? R.pick(pool) : R.pick(staff);
  };
  ctxStaff.staff = staff;
  ctxStaff.staffBy = staffBy;
  const counters = {};
  const nextRef = (platform) => {
    counters[platform] = (counters[platform] ?? 0) + 1;
    return `${CASE_REF_STEM[platform]}-${String(counters[platform]).padStart(5, '0')}`;
  };

  // ══════════════════════════════════════════════════════════
  // 1 · Screening lists
  // ══════════════════════════════════════════════════════════
  const LISTS = [
    ['UNSC Consolidated', 'sanction'], ['FIC Targeted Sanctions', 'sanction'],
    ['Domestic PEP Register', 'pep'], ['Foreign PEP Register', 'pep'],
    ['Adverse Media', 'adverse_media'], ['Internal Deny List', 'internal_deny'],
  ];
  for (let i = 0; i < 240; i++) {
    const [list, type] = R.pick(LISTS);
    const male = R.chance(0.6);
    const first = R.pick(male ? FIRST_NAMES_M : FIRST_NAMES_F);
    const surname = R.pick(SURNAMES);
    t.watchlist_entries.push({
      id: `wl_${i + 1}`,
      list_name: list,
      entry_type: type,
      full_name: `${first} ${surname}`,
      aliases: [`${first[0]}. ${surname}`],
      country: type === 'pep' || list.startsWith('FIC') || list.startsWith('Internal') ? 'ZA'
        : R.pick(['RU', 'SY', 'LY', 'NG', 'ZW', 'CD']),
      notes: type === 'pep' ? 'Public office — illustrative entry'
        : type === 'internal_deny' ? 'Prior confirmed fraud — illustrative entry'
        : 'Illustrative entry',
      active: true,
      created_at: iso(daysAgo(R.int(30, 900))),
    });
  }

  for (let i = 0; i < 220; i++) {
    t.deceased_register.push({
      id: `dr_${i + 1}`,
      id_hash: tag('deceased', `dha-${i}`),
      date_of_death: isoDate(daysAgo(R.int(30, 1800))),
      source: 'dha_feed',
    });
  }

  // ══════════════════════════════════════════════════════════
  // 2 · Employers
  // ══════════════════════════════════════════════════════════
  const employerCount = 240;
  for (let i = 0; i < employerCount; i++) {
    // A handful are untraceable at CIPC. Those are the ones the
    // employment rule is looking for, and they cluster on fraud files.
    const traceable = i >= 14;
    const name = `${R.pick(EMPLOYER_STEMS)} ${R.pick(EMPLOYER_TAIL)} ${R.pick(EMPLOYER_FORM)}`;
    const year = R.int(1994, 2023);
    t.employers.push({
      id: `emp_${i + 1}`,
      name,
      name_normalised: name.toLowerCase(),
      registration_number: traceable
        ? `${year}/${String(R.int(100, 999999)).padStart(6, '0')}/${R.pick(['07', '23', '30', '21'])}`
        : null,
      cipc_status: traceable ? 'in_business' : 'not_found',
      cipc_checked_at: iso(daysAgo(R.int(1, 120))),
      sector: traceable ? R.pick(SECTORS) : null,
      flagged: !traceable,
      flag_reason: traceable ? null : 'No CIPC registration found for this name',
      created_at: iso(daysAgo(R.int(120, 1200))),
    });
  }
  const goodEmployers = t.employers.filter((e) => e.cipc_status === 'in_business');
  const badEmployers = t.employers.filter((e) => e.cipc_status === 'not_found');

  // ══════════════════════════════════════════════════════════
  // 3 · People
  // ══════════════════════════════════════════════════════════
  const people = [];
  for (let i = 0; i < N_PEOPLE; i++) {
    const archetype = R.weighted(ARCHETYPES);
    const male = R.chance(0.52);
    const first = R.pick(male ? FIRST_NAMES_M : FIRST_NAMES_F);
    const surname = R.pick(SURNAMES);
    const citizenship = R.chance(0.94) ? 'citizen' : 'permanent_resident';
    const birthYear = R.int(1962, 2005);
    const dob = new Date(Date.UTC(birthYear, R.int(0, 11), R.int(1, 28)));
    const platform = R.pick(platformIds);
    const place = R.pick(PLACES);

    // Income drives affordability, which drives the whole credit side.
    // The bands are roughly South African formal-sector monthly pay.
    const gross = R.weighted([
      [R.int(850000, 1600000), 22],
      [R.int(1600000, 2800000), 30],
      [R.int(2800000, 4800000), 27],
      [R.int(4800000, 8000000), 15],
      [R.int(8000000, 16000000), 6],
    ]);
    const deductions = Math.round(gross * (0.16 + R.next() * 0.12));

    const p = {
      key: `p${i + 1}`,
      archetype,
      first, surname,
      gender: male ? 'male' : 'female',
      dob,
      citizenship,
      idLast4: idLast4(R, citizenship),
      platform,
      place,
      grossCents: gross,
      deductionsCents: deductions,
      netCents: gross - deductions,
      onboardMonths: ['watchlist', 'inflight', 'pending'].includes(archetype)
        ? R.int(0, 3) : R.int(1, 44),
      subjectId: null,
      customerId: null,
      caseId: null,
    };
    people.push(p);
  }

  // A deterministic slice of the fraud files share a bank account and
  // an address with each other. Linkage is the whole point of a shared
  // register — two files that look clean alone look different together.
  const fraudPeople = people.filter((p) => p.archetype === 'fraud');
  const SHARED_ACCOUNT = tag('account', 'shared-syndicate-1');
  const SHARED_ADDRESS = PLACES[34];
  const SHARED_MSISDN = '+27723334455';

  // ── Subjects, consents, customers ────────────────────────────
  people.forEach((p, i) => {
    const subjectId = `sub_${i + 1}`;
    p.subjectId = subjectId;
    const onboardedAt = new Date(
      monthsAgo(p.onboardMonths).getTime()
      - R.int(0, 27) * 86400000 - R.int(0, 10) * 3600000,
    );
    p.onboardedAt = onboardedAt;

    t.subjects.push({
      id: subjectId,
      id_type: 'sa_id',
      id_hash: tag('subject', p.key),
      id_last4: p.idLast4,
      id_country: 'ZA',
      first_names: p.first,
      surname: p.surname,
      date_of_birth: isoDate(p.dob),
      gender: p.gender,
      citizenship: p.citizenship,
      assurance_level: 'none',
      assurance_expires_at: null,
      deceased: false,
      created_at: iso(onboardedAt),
    });

    const grant = (purpose, textId, basis = 'consent') => {
      t.consents.push({
        id: `con_${t.consents.length + 1}`,
        subject_id: subjectId,
        platform_id: p.platform,
        case_id: null,
        purpose,
        special_personal_information: purpose === 'biometric_processing',
        lawful_basis: basis,
        consent_text_id: textId,
        method: R.weighted([['click_wrap', 6], ['signed_document', 2], ['in_person', 1], ['ussd', 1]]),
        evidence: {},
        captured_ip: null,
        captured_user_agent: null,
        granted_at: iso(onboardedAt),
        expires_at: null,
        withdrawn_at: null,
        withdrawal_reason: null,
        created_at: iso(onboardedAt),
      });
    };

    grant('identity_verification', 'ct_identity_v1');
    grant('watchlist_screening', 'ct_screening_v1', 'legal_obligation');
    grant('result_sharing', 'ct_sharing_v1');
    if (p.archetype !== 'inflight') grant('document_storage', 'ct_document_v1', 'legal_obligation');
    if (p.archetype !== 'inflight') grant('biometric_processing', 'ct_biometric_v1');
    if (!['inflight', 'watchlist'].includes(p.archetype)) grant('credit_enquiry', 'ct_credit_v1');

    // Everyone but the still-running and the screened-out becomes a
    // customer. A subject is someone verified once; a customer is that
    // subject in an ongoing relationship with one platform.
    if (!['inflight', 'watchlist', 'pending'].includes(p.archetype)) {
      const customerId = `cus_${t.customers.length + 1}`;
      p.customerId = customerId;
      t.customers.push({
        id: customerId,
        subject_id: subjectId,
        platform_id: p.platform,
        customer_number: `${PREFIX[p.platform]}-CUST-${String(1000 + t.customers.length + 1)}`,
        status: p.archetype === 'fraud' ? 'suspended'
          : p.archetype === 'settled' ? R.weighted([['active', 3], ['dormant', 2]])
          : 'active',
        onboarding_case_id: null,
        onboarded_at: iso(onboardedAt),
        email: `${p.first.toLowerCase()}.${p.surname.toLowerCase().replace(/[^a-z]/g, '')}@example.co.za`,
        preferred_contact: R.pick(['whatsapp', 'sms', 'email', 'phone']),
        notes: null,
        created_by: null,
        created_at: iso(onboardedAt),
        updated_at: iso(onboardedAt),
      });
    }
  });

  // ── Contact, employment, banking ─────────────────────────────
  people.forEach((p, i) => {
    const onboardedAt = p.onboardedAt;
    const isFraud = p.archetype === 'fraud';
    const place = isFraud && R.chance(0.7) ? SHARED_ADDRESS : p.place;
    const years = R.int(0, 18) + R.next();

    const addressId = `addr_${t.addresses.length + 1}`;
    t.addresses.push({
      id: addressId,
      customer_id: p.customerId,
      subject_id: p.subjectId,
      address_type: 'residential',
      line1: `${R.int(1, 480)} ${R.pick(STREETS)} ${R.pick(STREET_TYPE)}`,
      line2: null,
      suburb: place.suburb,
      city: place.city,
      province: place.province,
      postal_code: place.code,
      country: 'ZA',
      latitude: null,
      longitude: null,
      address_hash: tag('address', `${place.suburb}|${place.code}`),
      resident_since: isoDate(daysAgo(Math.round(years * 365))),
      is_current: true,
      created_at: iso(onboardedAt),
    });

    // Proof of residence in someone else's name is ordinary — a
    // spouse, a parent, a landlord — and on its own it is a warning,
    // not an accusation. It matters in combination.
    const inOwnName = isFraud ? false : R.chance(0.88);
    t.address_verifications.push({
      id: `av_${t.address_verifications.length + 1}`,
      address_id: addressId,
      case_id: null,
      check_id: null,
      method: years >= 3 ? 'municipal_account' : R.pick(['bank_statement', 'utility_bill', 'lease_agreement']),
      document_in_subject_name: inOwnName,
      document_id: null,
      document_date: isoDate(daysAgo(R.int(5, 80))),
      status: inOwnName ? 'verified' : 'manual_review',
      confidence: inOwnName ? R.int(84, 97) : R.int(24, 44),
      shared_with_count: 0,
      reason_codes: inOwnName ? [] : ['document_not_in_subject_name'],
      provider: 'simulation',
      created_at: iso(onboardedAt),
    });

    const msisdn = isFraud && R.chance(0.5)
      ? SHARED_MSISDN
      : `+27${R.pick([6, 7, 8])}${R.int(10000000, 49999999)}`;
    const phoneId = `ph_${t.phone_numbers.length + 1}`;
    t.phone_numbers.push({
      id: phoneId,
      customer_id: p.customerId,
      subject_id: p.subjectId,
      msisdn,
      msisdn_hash: tag('msisdn', msisdn),
      network: R.pick(NETWORKS),
      line_type: R.weighted([['mobile_contract', 3], ['mobile_prepaid', 2]]),
      is_primary: true,
      created_at: iso(onboardedAt),
    });

    const ricaOk = isFraud ? false : R.chance(0.9);
    const tenure = isFraud ? R.int(4, 70) : R.int(120, 4200);
    const swapped = tenure < 90;
    t.phone_verifications.push({
      id: `pv_${t.phone_verifications.length + 1}`,
      phone_id: phoneId,
      case_id: null,
      check_id: null,
      rica_status: ricaOk ? 'registered_to_subject' : 'registered_to_other',
      registered_name: ricaOk ? `${p.first[0]} ${p.surname}` : `${R.pick(FIRST_NAMES_M)[0]} ${R.pick(SURNAMES)}`,
      name_match_score: ricaOk ? R.int(88, 100) : R.int(4, 40),
      last_sim_swap_at: swapped ? iso(daysAgo(tenure)) : null,
      days_since_sim_swap: swapped ? tenure : null,
      last_ported_at: null,
      tenure_days: tenure,
      otp_delivered: true,
      otp_confirmed: ricaOk,
      status: ricaOk ? 'verified' : 'manual_review',
      confidence: ricaOk ? R.int(85, 98) : R.int(10, 30),
      reason_codes: ricaOk ? [] : ['rica_registered_to_other'],
      provider: 'simulation',
      created_at: iso(onboardedAt),
    });

    const employer = isFraud ? R.pick(badEmployers) : R.pick(goodEmployers);
    const empId = `er_${t.employment_records.length + 1}`;
    const empYears = isFraud ? R.next() * 0.6 : R.int(0, 16) + R.next();
    t.employment_records.push({
      id: empId,
      customer_id: p.customerId,
      subject_id: p.subjectId,
      employer_id: employer.id,
      employer_name_claimed: employer.name,
      job_title: R.pick(JOB_TITLES),
      employment_type: R.weighted([['permanent', 8], ['contract', 2], ['fixed_term', 1], ['self_employed', 1], ['informal', 1]]),
      started_on: isoDate(daysAgo(Math.round(empYears * 365))),
      ended_on: null,
      is_current: true,
      gross_monthly_cents: p.grossCents,
      net_monthly_cents: p.netCents,
      pay_frequency: 'monthly',
      pay_day: R.pick([25, 26, 30, 1]),
      created_at: iso(onboardedAt),
    });

    // The payslip is checked, not taken on trust: gross minus the
    // deductions listed has to equal the net shown, and the net has to
    // resemble what actually lands in the account.
    const observed = isFraud ? Math.round(p.netCents * (0.1 + R.next() * 0.12)) : p.netCents;
    const variance = Number((((p.netCents - observed) / Math.max(observed, 1)) * 100).toFixed(2));
    t.employment_verifications.push({
      id: `ev_${t.employment_verifications.length + 1}`,
      employment_id: empId,
      case_id: null,
      check_id: null,
      method: 'payslip',
      document_id: null,
      employer_exists: employer.cipc_status === 'in_business',
      payslip_arithmetic_ok: !isFraud,
      declared_gross_cents: p.grossCents,
      declared_net_cents: p.netCents,
      computed_net_cents: p.netCents,
      observed_deposit_cents: observed,
      income_variance_pct: isFraud ? variance : 0,
      status: isFraud ? 'failed' : employer.cipc_status === 'in_business' ? 'verified' : 'manual_review',
      confidence: isFraud ? R.int(3, 12) : R.int(82, 97),
      reason_codes: isFraud
        ? ['payslip_net_does_not_reconcile', 'employer_not_at_cipc', 'income_variance_high']
        : [],
      provider: 'simulation',
      created_at: iso(onboardedAt),
    });

    const bank = R.pick(BANKS);
    const accountHash = isFraud && R.chance(0.75) ? SHARED_ACCOUNT : tag('account', p.key);
    t.bank_accounts.push({
      id: `ba_${t.bank_accounts.length + 1}`,
      customer_id: p.customerId,
      subject_id: p.subjectId,
      bank_name: bank.name,
      branch_code: bank.branch,
      account_type: R.pick(['cheque', 'savings']),
      account_last4: String(R.int(1000, 9999)),
      account_hash: accountHash,
      account_holder_name: isFraud && accountHash === SHARED_ACCOUNT
        ? 'M Nkosi'
        : `${p.first[0]} ${p.surname}`,
      avs_status: isFraud ? 'name_mismatch' : R.weighted([['verified', 19], ['name_mismatch', 1]]),
      avs_checked_at: iso(onboardedAt),
      is_primary: true,
      created_at: iso(onboardedAt),
    });
  });

  // ══════════════════════════════════════════════════════════
  // 4 · Cases and their evidence
  // ══════════════════════════════════════════════════════════
  const PURPOSE_BY_PLATFORM = {
    biprapay: 'onboarding', xpayments: 'lending', veribills: 'onboarding',
    piggybag: 'lending', mysmme: 'onboarding',
  };

  const addCase = (p, { arc, purpose, level, status, months, decisionReason = null }) => {
    const id = `VC-${NOW.getFullYear()}-${String(t.verification_cases.length + 1).padStart(6, '0')}`;
    // Spread within the month and across the working day. Without this
    // every case opened in the same month lands on the same instant,
    // and a list ordered by time stops telling a reader anything.
    const createdAt = new Date(
      monthsAgo(months).getTime()
      - R.int(0, 27) * 86400000
      - R.int(0, 10) * 3600000
      - R.int(0, 59) * 60000,
    );
    const decided = ['verified', 'rejected'].includes(status);
    t.verification_cases.push({
      id,
      subject_id: p.subjectId,
      platform_id: p.platform,
      client_reference: nextRef(p.platform),
      purpose,
      level,
      status,
      risk: arc === 'fraud' || arc === 'watchlist' ? 'high'
        : ['thin', 'arrears', 'slipping', 'default'].includes(arc) ? 'medium' : 'low',
      score: 0,
      decided_by: decided ? staffBy('reviewer').id : null,
      decided_at: decided ? iso(new Date(createdAt.getTime() + 4 * 3600000)) : null,
      decision_reason: decisionReason,
      expires_at: status === 'verified' ? iso(addMonths(createdAt, 12)) : null,
      created_at: iso(createdAt),
      updated_at: iso(createdAt),
    });

    for (const [domain, check_type, provider, cstatus, score, reasons] of (ARC_CHECKS[arc] ?? [])) {
      // A basic or standard level never runs the checks it does not
      // require, so the timeline matches the assurance asked for.
      const required = verification_requirements.some(
        (r) => r.level === level && r.domain === domain && r.check_type === check_type,
      );
      if (!required) continue;
      t.verification_checks.push({
        id: `chk_${t.verification_checks.length + 1}`,
        case_id: id,
        domain,
        check_type,
        provider,
        status: cstatus,
        score,
        result: {},
        reason_codes: reasons ?? [],
        created_at: iso(new Date(createdAt.getTime() + 3 * 3600000)),
      });
    }
    return id;
  };

  // The onboarding case each person came in on.
  for (const p of people) {
    const level = p.archetype === 'inflight' ? 'standard'
      : ['thin', 'fraud', 'watchlist', 'strong', 'clean', 'late', 'slipping', 'arrears', 'default', 'settled']
        .includes(p.archetype) && PURPOSE_BY_PLATFORM[p.platform] === 'lending' ? 'enhanced' : 'standard';

    p.caseId = addCase(p, {
      arc: p.archetype,
      purpose: PURPOSE_BY_PLATFORM[p.platform],
      level,
      status: CASE_STATUS[p.archetype],
      months: p.onboardMonths,
      decisionReason: p.archetype === 'fraud'
        ? 'Payslip does not reconcile; banking details shared with an unrelated identity'
        : null,
    });

    const customer = t.customers.find((c) => c.id === p.customerId);
    if (customer) customer.onboarding_case_id = p.caseId;
  }

  // Later cases: periodic FICA refreshes, payouts, age gates, and a
  // few that were cancelled or expired in flight.
  for (const p of people) {
    if (['inflight', 'pending'].includes(p.archetype)) continue;
    const extra = R.weighted([[0, 4], [1, 4], [2, 2]]);
    for (let k = 0; k < extra; k++) {
      const kind = R.weighted([['refresh', 6], ['payout', 2], ['agecheck', 1], ['inflight', 1]]);
      const months = R.int(0, Math.max(0, p.onboardMonths - 1));
      if (kind === 'refresh') {
        addCase(p, {
          arc: 'refresh', purpose: 'kyc_refresh', level: 'basic', months,
          status: R.weighted([['verified', 8], ['expired', 1], ['cancelled', 1]]),
        });
      } else if (kind === 'payout') {
        addCase(p, { arc: 'clean', purpose: 'payout', level: 'standard', months, status: 'verified' });
      } else if (kind === 'agecheck') {
        addCase(p, { arc: 'agecheck', purpose: 'age_check', level: 'basic', months, status: 'verified' });
      } else {
        addCase(p, { arc: 'inflight', purpose: 'account_recovery', level: 'standard', months, status: 'in_progress' });
      }
    }
  }

  // ── Watchlist adjudication ───────────────────────────────────
  const watchPeople = people.filter((p) => p.archetype === 'watchlist');
  let hitN = 0;
  for (const p of watchPeople) {
    const entry = R.pick(t.watchlist_entries);
    t.watchlist_hits.push({
      id: `wh_${++hitN}`,
      case_id: p.caseId,
      entry_id: entry.id,
      match_score: R.int(72, 96),
      status: R.weighted([['open', 5], ['false_positive', 3], ['confirmed', 1]]),
      reviewed_by: staffBy('compliance').id,
      reviewed_at: null,
      review_note: 'Surname and initial match a listed person; date of birth differs. Awaiting documentary confirmation.',
      created_at: iso(monthsAgo(p.onboardMonths)),
    });
  }
  // Screening runs on every file, and near-matches are common. Most
  // are cleared; the register keeps them so the clearing is auditable.
  while (t.watchlist_hits.length < 210) {
    const p = R.pick(people);
    const entry = R.pick(t.watchlist_entries);
    t.watchlist_hits.push({
      id: `wh_${++hitN}`,
      case_id: p.caseId,
      entry_id: entry.id,
      match_score: R.int(55, 78),
      status: 'false_positive',
      reviewed_by: staffBy('compliance').id,
      reviewed_at: iso(daysAgo(R.int(1, 400))),
      review_note: 'Common surname. Date of birth and identity number both differ. Cleared.',
      created_at: iso(daysAgo(R.int(2, 420))),
    });
  }

  // ── Identity verification records ────────────────────────────
  for (const p of people) {
    if (p.archetype === 'inflight') continue;
    const isFraud = p.archetype === 'fraud';
    t.identity_verifications.push({
      id: `iv_${t.identity_verifications.length + 1}`,
      case_id: p.caseId,
      check_id: null,
      subject_id: p.subjectId,
      id_type: 'sa_id',
      id_last4: p.idLast4,
      structure_valid: true,
      // On a fraud file the number decodes to a different date from
      // the one on the application. That is the signature of a
      // borrowed or invented identity.
      derived_date_of_birth: isFraud
        ? isoDate(new Date(Date.UTC(p.dob.getUTCFullYear() - 3, p.dob.getUTCMonth(), p.dob.getUTCDate())))
        : isoDate(p.dob),
      derived_gender: p.gender,
      derived_citizenship: p.citizenship,
      claimed_name: `${p.first} ${p.surname}`,
      authority_name: isFraud ? `${p.first[0]} ${p.surname}` : `${p.first} ${p.surname}`,
      name_match_score: isFraud ? R.int(48, 64) : 100,
      authority_provider: 'simulation',
      authority_status: 'match',
      deceased_flag: false,
      watchlist_hit: p.archetype === 'watchlist',
      created_at: iso(monthsAgo(p.onboardMonths)),
    });
  }

  // ── Documents and their examination ──────────────────────────
  const SHARED_PAYSLIP = tag('document', 'shared-payslip');
  for (const p of people) {
    if (p.archetype === 'inflight') continue;
    const isFraud = p.archetype === 'fraud';
    const at = monthsAgo(p.onboardMonths);
    const wanted = ['sa_id_card', 'proof_of_address'];
    if (p.customerId) wanted.push('payslip', 'bank_statement');

    for (const docType of wanted) {
      const sha = isFraud && docType === 'payslip' ? SHARED_PAYSLIP : tag('document', `${p.key}|${docType}`);
      const docId = `doc_${t.documents.length + 1}`;
      t.documents.push({
        id: docId,
        case_id: p.caseId,
        subject_id: p.subjectId,
        doc_type: docType,
        storage_path: `${p.caseId}/${docType}.jpg`,
        mime_type: docType === 'bank_statement' ? 'application/pdf' : 'image/jpeg',
        size_bytes: docType === 'bank_statement' ? R.int(180000, 620000) : R.int(900000, 2400000),
        page_count: docType === 'bank_statement' ? 3 : 1,
        sha256: sha,
        uploaded_by: null,
        uploaded_via: R.weighted([['api', 6], ['console', 2], ['portal', 2]]),
        // FICA s22: five years from the end of the relationship.
        retention_until: iso(addMonths(at, 60)),
        purged_at: null,
        created_at: iso(at),
      });

      const auth = isFraud && ['sa_id_card', 'payslip'].includes(docType) ? R.int(4, 16) : R.int(86, 98);
      const failed = isFraud && ['sa_id_card', 'payslip'].includes(docType);
      t.document_verifications.push({
        id: `dv_${t.document_verifications.length + 1}`,
        case_id: p.caseId,
        check_id: null,
        document_id: docId,
        doc_type: docType,
        mrz_present: docType === 'sa_id_card',
        mrz_valid: docType === 'sa_id_card' ? !failed : null,
        mrz_fields: docType === 'sa_id_card' ? {
          document_type: 'ID', issuing_state: 'ZAF',
          surname: p.surname.toUpperCase(), given_names: p.first.toUpperCase(),
          composite_check_valid: !failed,
        } : {},
        extracted: { full_name: `${p.first} ${p.surname}` },
        document_number_last4: docType === 'sa_id_card' ? p.idLast4 : null,
        date_of_issue: isoDate(daysAgo(R.int(200, 2600))),
        date_of_expiry: docType === 'sa_id_card' ? isoDate(addMonths(NOW, R.int(-6, 96))) : null,
        expired: docType === 'sa_id_card' ? R.chance(0.04) : false,
        stale: ['proof_of_address', 'bank_statement', 'payslip'].includes(docType) ? R.chance(0.06) : false,
        authenticity_score: auth,
        tamper_signals: failed ? [
          { code: 'font_mismatch', severity: 'critical', detail: 'Surname field set in a face the issuer does not use' },
          { code: 'metadata_edited', severity: 'critical', detail: 'Producer software is a raster editor' },
        ] : [],
        provider: 'simulation',
        status: failed ? 'failed' : 'passed',
        reason_codes: failed
          ? ['mrz_check_digit_failed_composite', 'tamper_font_mismatch', 'tamper_metadata_edited']
          : [],
        created_at: iso(at),
      });

      if (docType === 'sa_id_card') {
        t.document_forensics.push({
          id: `df_${t.document_forensics.length + 1}`,
          document_id: docId,
          perceptual_hash: tag('phash', p.key).slice(-16),
          producer_software: failed ? 'Adobe Photoshop 25.9 (Windows)' : 'DHA Smart Card Scanner v3.1',
          creation_date: iso(daysAgo(R.int(3, 40))),
          modification_date: iso(daysAgo(failed ? 0 : R.int(3, 40))),
          has_digital_signature: !failed,
          signature_valid: failed ? null : true,
          findings: failed ? [
            { code: 'producer_is_image_editor', severity: 'critical' },
            { code: 'modified_after_creation', severity: 'critical' },
          ] : [],
          provider: 'simulation',
          created_at: iso(at),
        });
      }
    }
  }

  // ── Bureau enquiries and the tradelines behind them ──────────
  const BANDS = [
    [781, 'Excellent', 'low'], [742, 'Excellent', 'low'], [708, 'Good', 'low'],
    [681, 'Good', 'low'], [664, 'Favourable', 'low'], [631, 'Average', 'medium'],
    [603, 'Average', 'medium'], [574, 'Below average', 'medium'], [548, 'Below average', 'medium'],
    [509, 'Poor', 'high'],
  ];

  for (const p of people) {
    if (['inflight', 'watchlist'].includes(p.archetype)) continue;
    // Thin files have barely been seen by a bureau; that is what makes
    // them thin, and why behaviour on this platform has to stand in.
    if (p.archetype === 'thin' && R.chance(0.55)) { p.bureau = null; continue; }

    const idx = p.archetype === 'fraud' ? 9
      : p.archetype === 'strong' ? R.int(0, 2)
      : p.archetype === 'default' ? R.int(7, 9)
      : ['arrears', 'slipping'].includes(p.archetype) ? R.int(5, 8)
      : p.archetype === 'thin' ? R.int(6, 8)
      : R.int(2, 6);
    const [score, band, risk] = BANDS[idx];
    const accounts = p.archetype === 'thin' ? R.int(1, 2) : R.int(2, 9);
    const arrearsAccts = ['fraud', 'default', 'arrears'].includes(p.archetype) ? R.int(1, 4)
      : p.archetype === 'slipping' ? R.int(0, 1) : 0;
    const obligations = Math.round(p.netCents * (0.04 + R.next() * 0.22));

    const checkId = `cc_${t.credit_checks.length + 1}`;
    t.credit_checks.push({
      id: checkId,
      case_id: p.caseId,
      check_id: null,
      subject_id: p.subjectId,
      bureau_id: R.pick(credit_bureaus).id,
      enquiry_type: R.weighted([['hard', 4], ['soft', 1]]),
      purpose: PURPOSE_BY_PLATFORM[p.platform],
      score: score + R.int(-8, 8),
      band,
      risk,
      accounts_total: accounts,
      accounts_in_arrears: arrearsAccts,
      worst_arrears_months: arrearsAccts ? R.int(1, 6) : 0,
      monthly_debt_obligations_cents: obligations,
      judgments: p.archetype === 'fraud' ? R.int(0, 2) : 0,
      defaults: arrearsAccts ? R.int(1, 3) : 0,
      admin_order: false,
      debt_review: p.archetype === 'arrears' && R.chance(0.15),
      sequestration: false,
      provider_reference: `${tag('enq', p.key).slice(-8).toUpperCase()}`,
      status: 'completed',
      reason_codes: arrearsAccts ? ['defaults_on_record'] : accounts <= 1 ? ['thin_credit_file'] : [],
      raw_summary: { enquiries_last_12m: accounts > 4 ? R.int(2, 5) : R.int(0, 2) },
      created_at: iso(monthsAgo(p.onboardMonths)),
    });
    p.bureau = t.credit_checks.at(-1);

    // The tradelines that produce the score. Balances and instalments
    // are apportioned from the bureau obligation figure, so the list
    // adds up to the number on the summary rather than contradicting it.
    for (let a = 0; a < accounts; a++) {
      t.credit_accounts.push({
        id: `ca_${t.credit_accounts.length + 1}`,
        credit_check_id: checkId,
        creditor: R.pick(CREDITORS),
        account_type: R.pick(ACCOUNT_TYPES),
        opened_on: isoDate(daysAgo(R.int(200, 3200))),
        balance_cents: Math.round((obligations * 14) / accounts),
        instalment_cents: Math.round(obligations / accounts),
        months_in_arrears: a < arrearsAccts ? R.int(1, 6) : 0,
        status: a < arrearsAccts ? 'in_arrears' : 'open',
      });
    }
  }

  // ── Affordability ───────────────────────────────────────────
  for (const p of people) {
    if (['inflight', 'watchlist'].includes(p.archetype)) continue;
    const declared = Math.round(p.netCents * (0.28 + R.next() * 0.18));
    const a = assessAffordability({
      grossCents: p.grossCents,
      deductionsCents: p.deductionsCents,
      declaredExpensesCents: declared,
      existingObligationsCents: p.bureau?.monthly_debt_obligations_cents ?? 0,
      proposedInstalmentCents: 0,
      incomeVerified: p.archetype !== 'fraud',
    });
    t.affordability_assessments.push({
      id: `aa_${t.affordability_assessments.length + 1}`,
      case_id: p.caseId,
      check_id: null,
      subject_id: p.subjectId,
      assessed_on: isoDate(monthsAgo(p.onboardMonths)),
      income_verified: p.archetype !== 'fraud',
      income_source: p.archetype === 'fraud' ? 'Payslip — failed verification' : 'Payslip — verified',
      ...a,
      created_at: iso(monthsAgo(p.onboardMonths)),
    });
    p.affordability = t.affordability_assessments.at(-1);
  }

  // ── Biometrics ──────────────────────────────────────────────
  // Two templates per person: one lifted from the document portrait,
  // one from the live capture. The similarity between them is a real
  // number produced by comparing them, not a figure typed in — which
  // is why the impostor's file scores where it does.
  const descriptor = (seedN, dim, noise) => {
    const g = makeRandom(seedN);
    const base = Array.from({ length: dim }, () => g.next() - 0.5);
    if (noise === 0) return base;
    const h = makeRandom(seedN + 7919);
    return base.map((v) => v + noise * (h.next() - 0.5));
  };
  const cosine = (a, b) => {
    let dot = 0; let na = 0; let nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? Number((dot / (Math.sqrt(na) * Math.sqrt(nb))).toFixed(6)) : 0;
  };

  for (const p of people) {
    if (p.archetype === 'inflight') continue;
    const at = monthsAgo(p.onboardMonths);
    const seedN = 1000 + people.indexOf(p) * 13;
    const noise = p.archetype === 'fraud' ? 2.6 : 0.35 + R.next() * 0.35;
    const docVec = descriptor(seedN, 128, 0);
    const liveVec = descriptor(seedN, 128, noise);
    const sim = cosine(docVec, liveVec);

    const docTemplate = `bt_${t.biometric_templates.length + 1}`;
    t.biometric_templates.push({
      id: docTemplate, subject_id: p.subjectId, modality: 'face', model_id: 'sim-face-v1',
      descriptor: docVec, descriptor_hash: tag('template', `${p.key}|doc`),
      source: 'document_portrait', source_document_id: null, quality_score: R.int(82, 94),
      enrolled_by: null, active: true, retention_until: iso(addMonths(at, 60)), created_at: iso(at),
    });
    t.biometric_templates.push({
      id: `bt_${t.biometric_templates.length + 1}`, subject_id: p.subjectId, modality: 'face',
      model_id: 'sim-face-v1', descriptor: liveVec, descriptor_hash: tag('template', `${p.key}|live`),
      source: 'live_capture', source_document_id: null, quality_score: R.int(85, 96),
      enrolled_by: null, active: true, retention_until: iso(addMonths(at, 60)), created_at: iso(at),
    });

    t.biometric_verifications.push({
      id: `bv_${t.biometric_verifications.length + 1}`,
      case_id: p.caseId, check_id: null, subject_id: p.subjectId,
      modality: 'face', model_id: 'sim-face-v1', mode: 'verify', template_id: docTemplate,
      similarity: sim, threshold_applied: 0.68, operating_fmr: '1e-5', matched: sim >= 0.68,
      liveness_performed: true,
      liveness_score: R.int(88, 99), liveness_passed: true, pad_level: 2, attack_type: 'none',
      quality_score: R.int(84, 96), provider: 'simulation',
      status: sim >= 0.68 ? 'passed' : 'failed',
      reason_codes: sim >= 0.68 ? [] : ['face_below_threshold'],
      latency_ms: R.int(380, 940), created_at: iso(at),
    });

    // A fingerprint, where the branch has a reader. WebAuthn proves the
    // enrolled owner of that device was present — not that a particular
    // person's finger was — and the record says which.
    if (R.chance(0.55)) {
      const fp = `bt_${t.biometric_templates.length + 1}`;
      t.biometric_templates.push({
        id: fp, subject_id: p.subjectId, modality: 'fingerprint', model_id: 'sim-finger-v1',
        descriptor: descriptor(seedN + 5000, 96, 0), descriptor_hash: tag('template', `${p.key}|finger`),
        source: 'live_capture', source_document_id: null, quality_score: R.int(78, 92),
        enrolled_by: null, active: true, retention_until: iso(addMonths(at, 60)), created_at: iso(at),
      });
      t.biometric_verifications.push({
        id: `bv_${t.biometric_verifications.length + 1}`,
        case_id: p.caseId, check_id: null, subject_id: p.subjectId,
        modality: 'fingerprint', model_id: 'sim-finger-v1', mode: 'enrol', template_id: fp,
        similarity: 1.0, threshold_applied: 0.71, operating_fmr: '1e-5', matched: true,
        liveness_performed: false, liveness_score: null, liveness_passed: null,
        pad_level: null, attack_type: null,
        quality_score: R.int(78, 92), provider: 'simulation', status: 'passed',
        reason_codes: [], latency_ms: R.int(180, 360), created_at: iso(at),
      });
    }
  }

  // ── Duplicate enrolment ─────────────────────────────────────
  // A slice of the population is the same face under two identities.
  // Their live templates are generated from the other person's seed,
  // so the sweep below finds them by comparing vectors — the flag is
  // the result of a comparison, not a label attached by hand.
  const dupPairs = [];
  const pool = R.shuffle(people.filter((x) => x.archetype !== 'inflight'));
  for (let i = 0; i + 1 < pool.length && dupPairs.length < 45; i += 2) {
    const [a, b] = [pool[i], pool[i + 1]];
    if (a.platform === b.platform) continue;
    dupPairs.push([a, b]);
  }

  const seedOf = (p) => 1000 + people.indexOf(p) * 13;
  for (const [a, b] of dupPairs) {
    const impostorVec = descriptor(seedOf(a), 128, 0.5 + R.next() * 0.3);
    const liveTemplate = t.biometric_templates.find(
      (x) => x.subject_id === b.subjectId && x.source === 'live_capture' && x.modality === 'face',
    );
    if (!liveTemplate) continue;
    liveTemplate.descriptor = impostorVec;
  }

  // The sweep. Every live face template against every enrolled one,
  // which is what 1:N identification means and why it is expensive.
  const faceTemplates = t.biometric_templates.filter((x) => x.modality === 'face');
  const bySubject = new Map();
  for (const tpl of faceTemplates) {
    if (!bySubject.has(tpl.subject_id)) bySubject.set(tpl.subject_id, []);
    bySubject.get(tpl.subject_id).push(tpl);
  }

  const flag = (subjectId, matchedId, similarity, status, note) => {
    t.biometric_duplicate_flags.push({
      id: `bdf_${t.biometric_duplicate_flags.length + 1}`,
      subject_id: subjectId,
      matched_subject_id: matchedId,
      modality: 'face',
      similarity,
      status,
      reviewed_by: status === 'open' ? null : staffBy('compliance').id,
      reviewed_at: status === 'open' ? null : iso(daysAgo(R.int(1, 120))),
      review_note: note,
      created_at: iso(daysAgo(R.int(1, 300))),
    });
  };

  for (const [a, b] of dupPairs) {
    const av = (bySubject.get(a.subjectId) ?? []).find((x) => x.source === 'document_portrait');
    const bv = (bySubject.get(b.subjectId) ?? []).find((x) => x.source === 'live_capture');
    if (!av || !bv) continue;
    const sim = cosine(av.descriptor, bv.descriptor);
    if (sim < 0.62) continue;
    flag(b.subjectId, a.subjectId, sim,
      R.weighted([['open', 4], ['confirmed', 3], ['false_positive', 1]]),
      `Live capture matched an enrolled template held under a different identity at ${sim}, `
      + 'above the 0.62 identification threshold. Two identities, one face — or two people who '
      + 'genuinely look alike. A person decides which.');
  }

  // A sweep at a lenient threshold also raises near-matches that are
  // not duplicates. They are kept, with the reason they were cleared,
  // because a register that only holds confirmed hits cannot show that
  // the clearing was ever done.
  const subjects = t.subjects.map((x) => x.id);
  while (t.biometric_duplicate_flags.length < 220) {
    const a = R.pick(subjects);
    const b = R.pick(subjects);
    if (a === b) continue;
    flag(a, b, Number((0.620 + R.next() * 0.048).toFixed(6)), 'false_positive',
      'Near-match on the sweep. Identity numbers, dates of birth and addresses all differ, and '
      + 'the two were captured eleven hundred kilometres apart on the same afternoon. Cleared.');
  }

  return {
    t, people, R, cosine, descriptor,
    staff: ctxStaff.staff, staffBy: ctxStaff.staffBy,
    SHARED_ACCOUNT, SHARED_PAYSLIP, SHARED_MSISDN,
  };
}
