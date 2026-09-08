// ══════════════════════════════════════════════════════════════
// Configuration.
//
// These tables are not sample records and are deliberately not
// inflated to match the volume of the generated ones. There are four
// credit bureaus in South Africa that matter, not two hundred; there
// are three biometric modalities; there are twenty-three fraud rules
// because twenty-three were written. Padding configuration with
// invented rows would make the fraud page, the bureau list and the
// modality thresholds lie about what the system actually does.
//
// The numbers in here are the ones the system decides by: assurance
// requirements and their weights, quality thresholds, rule weights,
// retention periods, NCA expense norms and fee caps. They are held as
// data rather than as code so that tuning is an edit and past
// decisions stay explicable against the version in force when they
// were made.
// ══════════════════════════════════════════════════════════════

import { PLATFORMS } from './generate.js';

export const client_platforms = PLATFORMS.map((p) => ({
  id: p.id,
  name: p.name,
  environment: 'sandbox',
  status: 'active',
  contact_email: p.contact,
  allowed_domains: p.domains,
  responsible_party: p.party,
}));

export const consent_texts = [
  { id: 'ct_identity_v1', purpose: 'identity_verification', version: 1, retired_at: null,
    body: 'I consent to xCentral verifying my identity against the records of the Department of Home Affairs and other lawful sources, for the purpose of the service I am applying for.' },
  { id: 'ct_document_v1', purpose: 'document_storage', version: 1, retired_at: null,
    body: 'I consent to xCentral storing copies of the documents I have supplied for as long as the Financial Intelligence Centre Act requires, and to their examination for authenticity.' },
  { id: 'ct_credit_v1', purpose: 'credit_enquiry', version: 1, retired_at: null,
    body: 'I consent to xCentral obtaining my credit record from a registered credit bureau and to assessing my affordability as required by the National Credit Act. I understand a hard enquiry may affect my credit score.' },
  { id: 'ct_biometric_v1', purpose: 'biometric_processing', version: 1, retired_at: null,
    body: 'I explicitly consent to xCentral processing my biometric information — including a photograph of my face — to confirm that I am the person on the identity document supplied. I understand that biometric information is special personal information under the Protection of Personal Information Act, that no photograph of me is retained, and that I may withdraw this consent at any time.' },
  { id: 'ct_screening_v1', purpose: 'watchlist_screening', version: 1, retired_at: null,
    body: 'I consent to my name being screened against sanctions, politically exposed person and adverse media lists as required by the Financial Intelligence Centre Act.' },
  { id: 'ct_sharing_v1', purpose: 'result_sharing', version: 1, retired_at: null,
    body: 'I consent to the outcome of this verification being shared with the platform that requested it.' },
];

export const document_types = [
  { id: 'sa_id_card', name: 'SA Smart ID Card', category: 'identity', max_age_days: null, has_mrz: true, has_portrait: true, active: true },
  { id: 'sa_id_book', name: 'SA Green Barcoded ID Book', category: 'identity', max_age_days: null, has_mrz: false, has_portrait: true, active: true },
  { id: 'passport', name: 'Passport', category: 'identity', max_age_days: null, has_mrz: true, has_portrait: true, active: true },
  { id: 'drivers_licence', name: 'SA Driving Licence Card', category: 'identity', max_age_days: null, has_mrz: false, has_portrait: true, active: true },
  { id: 'asylum_permit', name: 'Asylum Seeker / Refugee Permit', category: 'identity', max_age_days: null, has_mrz: false, has_portrait: true, active: true },
  { id: 'proof_of_address', name: 'Proof of Address', category: 'address', max_age_days: 90, has_mrz: false, has_portrait: false, active: true },
  { id: 'bank_statement', name: 'Bank Statement', category: 'income', max_age_days: 90, has_mrz: false, has_portrait: false, active: true },
  { id: 'payslip', name: 'Payslip', category: 'income', max_age_days: 90, has_mrz: false, has_portrait: false, active: true },
  { id: 'cipc_registration', name: 'CIPC Company Registration', category: 'business', max_age_days: null, has_mrz: false, has_portrait: false, active: true },
  { id: 'sars_tax_clearance', name: 'SARS Tax Clearance / PIN', category: 'business', max_age_days: 365, has_mrz: false, has_portrait: false, active: true },
  { id: 'selfie', name: 'Liveness Selfie', category: 'other', max_age_days: null, has_mrz: false, has_portrait: true, active: true },
];

export const credit_bureaus = [
  { id: 'transunion_za', name: 'TransUnion South Africa', active: true },
  { id: 'experian_za', name: 'Experian South Africa', active: true },
  { id: 'xds', name: 'XDS (Xpert Decision Systems)', active: true },
  { id: 'vericred', name: 'VeriCred Credit Bureau', active: true },
];

// Thresholds are the model's calibration, not a preference. A cut-off
// quoted without the model and the false-match rate it was measured at
// means nothing.
export const biometric_modalities = [
  { id: 'face', name: 'Face', model_id: 'sim-face-v1', descriptor_length: 128,
    threshold_lenient: 0.62, threshold_standard: 0.68, threshold_strict: 0.73, operating_fmr: '1e-5', active: true },
  { id: 'fingerprint', name: 'Fingerprint', model_id: 'sim-finger-v1', descriptor_length: 96,
    threshold_lenient: 0.65, threshold_standard: 0.71, threshold_strict: 0.76, operating_fmr: '1e-5', active: true },
  { id: 'voice', name: 'Voice', model_id: 'sim-voice-v1', descriptor_length: 128,
    threshold_lenient: 0.60, threshold_standard: 0.66, threshold_strict: 0.72, operating_fmr: '1e-4', active: true },
];

// What each assurance level requires, and how heavily each check
// counts. Held as rows so an assurance level is a statement about
// evidence rather than a word.
export const verification_requirements = [
  { level: 'basic', domain: 'identity', check_type: 'id_structure', required: true, weight: 2.0 },
  { level: 'basic', domain: 'identity', check_type: 'deceased_register', required: true, weight: 1.0 },
  { level: 'basic', domain: 'identity', check_type: 'watchlist_screening', required: true, weight: 1.5 },

  { level: 'standard', domain: 'identity', check_type: 'id_structure', required: true, weight: 2.0 },
  { level: 'standard', domain: 'identity', check_type: 'authority_lookup', required: true, weight: 2.5 },
  { level: 'standard', domain: 'identity', check_type: 'deceased_register', required: true, weight: 1.0 },
  { level: 'standard', domain: 'identity', check_type: 'watchlist_screening', required: true, weight: 1.5 },
  { level: 'standard', domain: 'document', check_type: 'document_authenticity', required: true, weight: 2.0 },
  { level: 'standard', domain: 'document', check_type: 'document_expiry', required: true, weight: 1.0 },
  { level: 'standard', domain: 'document', check_type: 'name_match', required: true, weight: 1.5 },

  { level: 'enhanced', domain: 'identity', check_type: 'id_structure', required: true, weight: 2.0 },
  { level: 'enhanced', domain: 'identity', check_type: 'authority_lookup', required: true, weight: 2.5 },
  { level: 'enhanced', domain: 'identity', check_type: 'deceased_register', required: true, weight: 1.0 },
  { level: 'enhanced', domain: 'identity', check_type: 'watchlist_screening', required: true, weight: 1.5 },
  { level: 'enhanced', domain: 'document', check_type: 'document_authenticity', required: true, weight: 2.0 },
  { level: 'enhanced', domain: 'document', check_type: 'document_expiry', required: true, weight: 1.0 },
  { level: 'enhanced', domain: 'document', check_type: 'name_match', required: true, weight: 1.5 },
  { level: 'enhanced', domain: 'biometric', check_type: 'face_match', required: true, weight: 3.0 },
  { level: 'enhanced', domain: 'biometric', check_type: 'liveness', required: true, weight: 2.5 },
  { level: 'enhanced', domain: 'credit', check_type: 'bureau_enquiry', required: false, weight: 1.5 },
  { level: 'enhanced', domain: 'credit', check_type: 'affordability', required: false, weight: 1.5 },
];

// National Credit Act Regulation 23A. I am not certain these are the
// currently gazetted figures — they are held as versioned rows so that
// correcting them is a data change and past assessments stay
// reproducible against the version in force when they were made.
export const affordability_norms = [
  { version: 1, band_floor_cents: 0, band_ceiling_cents: 80000, fixed_cents: 0, marginal_pct: 100.0, effective_from: '2015-09-11' },
  { version: 1, band_floor_cents: 80001, band_ceiling_cents: 600000, fixed_cents: 80000, marginal_pct: 6.75, effective_from: '2015-09-11' },
  { version: 1, band_floor_cents: 600001, band_ceiling_cents: 1000000, fixed_cents: 115100, marginal_pct: 9.0, effective_from: '2015-09-11' },
  { version: 1, band_floor_cents: 1000001, band_ceiling_cents: 1500000, fixed_cents: 151100, marginal_pct: 8.2, effective_from: '2015-09-11' },
  { version: 1, band_floor_cents: 1500001, band_ceiling_cents: null, fixed_cents: 192100, marginal_pct: 6.75, effective_from: '2015-09-11' },
];

export const nca_caps = [
  { agreement_type: 'mortgage', max_rate_formula: 'repo + 12%', max_initiation_cents: 645000, max_service_cents: 6900 },
  { agreement_type: 'credit_facility', max_rate_formula: 'repo + 14%', max_initiation_cents: 17500, max_service_cents: 6900 },
  { agreement_type: 'unsecured_credit', max_rate_formula: 'repo + 21%', max_initiation_cents: 128250, max_service_cents: 6900 },
  { agreement_type: 'instalment_sale', max_rate_formula: 'repo + 12%', max_initiation_cents: 128250, max_service_cents: 6900 },
  { agreement_type: 'short_term', max_rate_formula: '5% per month', max_initiation_cents: 17500, max_service_cents: 6900 },
  { agreement_type: 'developmental', max_rate_formula: 'repo + 27%', max_initiation_cents: 30000, max_service_cents: 6900 },
  { agreement_type: 'phone_contract', max_rate_formula: 'repo + 21%', max_initiation_cents: 17500, max_service_cents: 0 },
];

export const retention_policies = [
  { id: 'rp_documents', entity: 'documents', retain_days: 1825, legal_basis: 'FICA s22 — five years from the end of the business relationship', active: true, description: 'Identity and supporting documents' },
  { id: 'rp_cases', entity: 'verification_cases', retain_days: 1825, legal_basis: 'FICA s22', active: true, description: 'Verification case records and their outcomes' },
  { id: 'rp_biometric', entity: 'biometric_templates', retain_days: 1825, legal_basis: 'POPIA s14 — no longer than necessary; expires with the consent', active: true, description: 'Irreversible biometric templates. No raw sample is ever stored.' },
  { id: 'rp_captures', entity: 'captures', retain_days: 0, legal_basis: 'POPIA s10 — minimisation', active: true, description: 'Raw camera frames are discarded the moment a template is derived' },
  { id: 'rp_audit', entity: 'audit_log', retain_days: 2555, legal_basis: 'FICA s22 and internal governance', active: true, description: 'Append-only record of every action taken' },
  { id: 'rp_credit', entity: 'credit_checks', retain_days: 730, legal_basis: 'NCR guidance on enquiry records', active: true, description: 'Bureau enquiry results' },
  { id: 'rp_consents', entity: 'consents', retain_days: 2555, legal_basis: 'POPIA — proof of lawful basis outlives the processing', active: true, description: 'Consent grants and withdrawals' },
  { id: 'rp_api', entity: 'api_requests', retain_days: 365, legal_basis: 'Operational; no personal information held', active: true, description: 'API call metadata' },
  { id: 'rp_dsar', entity: 'dsar_requests', retain_days: 1095, legal_basis: 'POPIA s23/s24 — proof the request was answered', active: true, description: 'Data subject requests and their outcomes' },
];

export const capture_quality_rules = [
  { capture_type: 'document_front', min_sharpness: 90, min_brightness: 25, max_brightness: 92, min_contrast: 12, min_width: 800, min_height: 600, require_face: false, min_face_area_pct: null, active: true },
  { capture_type: 'document_back', min_sharpness: 90, min_brightness: 25, max_brightness: 92, min_contrast: 12, min_width: 800, min_height: 600, require_face: false, min_face_area_pct: null, active: true },
  { capture_type: 'document_portrait', min_sharpness: 45, min_brightness: 22, max_brightness: 94, min_contrast: 9, min_width: 200, min_height: 240, require_face: true, min_face_area_pct: 25, active: true },
  { capture_type: 'selfie', min_sharpness: 80, min_brightness: 25, max_brightness: 95, min_contrast: 10, min_width: 480, min_height: 480, require_face: true, min_face_area_pct: 12, active: true },
  { capture_type: 'selfie_frame', min_sharpness: 40, min_brightness: 20, max_brightness: 96, min_contrast: 8, min_width: 320, min_height: 320, require_face: false, min_face_area_pct: null, active: true },
  { capture_type: 'proof_of_address', min_sharpness: 70, min_brightness: 25, max_brightness: 94, min_contrast: 10, min_width: 800, min_height: 600, require_face: false, min_face_area_pct: null, active: true },
  { capture_type: 'signature', min_sharpness: 60, min_brightness: 30, max_brightness: 96, min_contrast: 14, min_width: 400, min_height: 150, require_face: false, min_face_area_pct: null, active: true },
];

// Deterministic reasoners, not language models. Each owns one question
// and writes its reasoning in plain words, because a lending decision
// has to be explainable to the regulator that asks about it.
export const agents = [
  { id: 'identity_agent', name: 'Identity Agent', domain: 'identity', reasoning: 'rules', can_veto: true, weight: 2.0, active: true,
    remit: 'Is the identity well-formed, real, alive, and not on a list?' },
  { id: 'document_agent', name: 'Document Agent', domain: 'document', reasoning: 'rules', can_veto: true, weight: 2.0, active: true,
    remit: 'Is the document genuine, current, and does it belong to this person?' },
  { id: 'biometric_agent', name: 'Biometric Agent', domain: 'biometric', reasoning: 'rules', can_veto: true, weight: 3.0, active: true,
    remit: 'Is the person in front of the camera the person on the document, and were they actually present?' },
  { id: 'fraud_agent', name: 'Fraud Agent', domain: 'fraud', reasoning: 'rules', can_veto: true, weight: 2.5, active: true,
    remit: 'Does anything here link to a pattern we have seen before?' },
  { id: 'affordability_agent', name: 'Affordability Agent', domain: 'credit', reasoning: 'rules', can_veto: false, weight: 1.5, active: true,
    remit: 'Can this person carry what they are asking for, under the NCA?' },
  { id: 'compliance_agent', name: 'Compliance Agent', domain: 'compliance', reasoning: 'rules', can_veto: true, weight: 2.0, active: true,
    remit: 'Is there lawful basis for everything we have done, and is the file complete for FICA?' },
  { id: 'orchestrator', name: 'Orchestrator', domain: 'orchestration', reasoning: 'rules', can_veto: false, weight: 0, active: true,
    remit: 'Combines the agents into one recommendation, and says what a human still has to decide.' },
];

// Each rule is a query over data the hub already holds. Weights and
// thresholds are rows so tuning is an update rather than a deploy.
export const fraud_rules = [
  { code: 'address_shared_by_many', name: 'Address shared by unrelated applicants', domain: 'address', severity: 'warn', weight: 15, active: true,
    description: 'This address appears under several unrelated identities. A block of flats does this legitimately, which is why it is reviewed rather than declined.' },
  { code: 'address_not_in_subject_name', name: 'Proof of residence is in someone else’s name', domain: 'address', severity: 'warn', weight: 10, active: true,
    description: 'The corroborating document does not name the applicant, so it proves where a document was sent, not where this person lives.' },
  { code: 'asset_already_financed', name: 'Asset already backs a live agreement', domain: 'asset', severity: 'critical', weight: 35, active: true,
    description: 'This VIN or IMEI is already financed. Financing the same unit twice is one of the oldest frauds there is.' },
  { code: 'asset_registry_adverse', name: 'Asset registry reports a problem', domain: 'asset', severity: 'critical', weight: 30, active: true,
    description: 'The registry says the asset is encumbered, stolen, or does not exist as described.' },
  { code: 'bank_account_shared', name: 'Bank account shared with another identity', domain: 'banking', severity: 'critical', weight: 30, active: true,
    description: 'The same account appears under a different person. Proceeds routed to one account across several identities is a syndicate pattern.' },
  { code: 'bank_account_name_mismatch', name: 'Bank account is not in the applicant’s name', domain: 'banking', severity: 'warn', weight: 18, active: true,
    description: 'Account verification returned a different account holder.' },
  { code: 'doc_expired', name: 'Document has expired', domain: 'document', severity: 'warn', weight: 8, active: true,
    description: 'The document was valid once and is not valid now.' },
  { code: 'doc_dates_impossible', name: 'Document dates cannot both be true', domain: 'document', severity: 'critical', weight: 25, active: true,
    description: 'Issue and expiry dates contradict each other or the date of birth.' },
  { code: 'doc_mrz_failed', name: 'Machine-readable zone does not verify', domain: 'document', severity: 'critical', weight: 30, active: true,
    description: 'An ICAO 9303 check digit fails. The data on the document has been altered since it was issued.' },
  { code: 'doc_reused_across_identities', name: 'Same document under two identities', domain: 'document', severity: 'critical', weight: 30, active: true,
    description: 'Identical file content, by hash, submitted for two different people.' },
  { code: 'doc_tamper_critical', name: 'Document shows signs of tampering', domain: 'document', severity: 'critical', weight: 28, active: true,
    description: 'Forensics found a critical signal: an editor in the metadata, modification after creation, or a font the issuer does not use.' },
  { code: 'employer_flagged', name: 'Employer is on the internal flag list', domain: 'employment', severity: 'critical', weight: 32, active: true,
    description: 'This employer name has appeared on files already confirmed fraudulent.' },
  { code: 'employer_not_at_cipc', name: 'Employer is not registered at CIPC', domain: 'employment', severity: 'warn', weight: 18, active: true,
    description: 'No company registration matches the employer named on the payslip.' },
  { code: 'income_variance_high', name: 'Declared income does not match the deposits', domain: 'employment', severity: 'warn', weight: 20, active: true,
    description: 'The salary claimed and the money actually arriving in the account are materially different.' },
  { code: 'payslip_arithmetic_failed', name: 'Payslip does not reconcile', domain: 'employment', severity: 'critical', weight: 28, active: true,
    description: 'Gross minus the deductions listed does not equal the net shown. The document was assembled, not issued.' },
  { code: 'dob_inconsistent', name: 'Date of birth contradicts the identity number', domain: 'identity', severity: 'critical', weight: 22, active: true,
    description: 'The number carries the date of birth in its first six digits, and it is not the date on the application.' },
  { code: 'id_mismatch_document_vs_claim', name: 'Name does not match the authority record', domain: 'identity', severity: 'critical', weight: 30, active: true,
    description: 'What the applicant claimed and what Home Affairs returned are not the same person.' },
  { code: 'known_fraud_hit', name: 'Matches the confirmed fraud register', domain: 'identity', severity: 'critical', weight: 40, active: true,
    description: 'An identifier on this file was written to the register after a confirmed case.' },
  { code: 'first_payment_default', name: 'Never made the first instalment', domain: 'payment', severity: 'critical', weight: 25, active: true,
    description: 'Not one payment arrived. Whatever the affordability assessment said, it was not real.' },
  { code: 'phone_not_registered_to_subject', name: 'Number is RICA-registered to someone else', domain: 'phone', severity: 'warn', weight: 15, active: true,
    description: 'Common in a family, and also what taking over someone else’s number looks like.' },
  { code: 'phone_shared_across_identities', name: 'Number used by two identities', domain: 'phone', severity: 'critical', weight: 25, active: true,
    description: 'The same line appears on applications in different names.' },
  { code: 'recent_sim_swap', name: 'SIM swapped shortly before the application', domain: 'phone', severity: 'critical', weight: 28, active: true,
    description: 'Control of the number is what one-time passwords rest on, and it changed hands days ago.' },
  { code: 'application_velocity', name: 'Several applications in a short window', domain: 'velocity', severity: 'warn', weight: 18, active: true,
    description: 'This identity has applied repeatedly across platforms in a few days, which is what shotgunning a stolen identity looks like.' },
];

// Lending appetite per platform and agreement type. Deliberately
// conservative: a platform tunes its own by inserting its own row.
export const credit_policies = client_platforms.flatMap((p) => ([
  { platform_id: p.id, agreement_type: 'instalment_sale', name: 'Standard', max_discretionary_share_pct: 60, max_debt_to_income_pct: 40, min_bureau_score: 583, hard_decline_bureau_score: 520, max_principal_cents: 150000000, max_term_months: 72, behaviour_uplift_max: 150, fraud_block_score: 45 },
  { platform_id: p.id, agreement_type: 'unsecured_credit', name: 'Standard', max_discretionary_share_pct: 40, max_debt_to_income_pct: 30, min_bureau_score: 614, hard_decline_bureau_score: 560, max_principal_cents: 5000000, max_term_months: 36, behaviour_uplift_max: 150, fraud_block_score: 45 },
  { platform_id: p.id, agreement_type: 'phone_contract', name: 'Standard', max_discretionary_share_pct: 35, max_debt_to_income_pct: 30, min_bureau_score: 583, hard_decline_bureau_score: 520, max_principal_cents: 3000000, max_term_months: 36, behaviour_uplift_max: 150, fraud_block_score: 45 },
  { platform_id: p.id, agreement_type: 'credit_facility', name: 'Standard', max_discretionary_share_pct: 40, max_debt_to_income_pct: 35, min_bureau_score: 614, hard_decline_bureau_score: 560, max_principal_cents: 2000000, max_term_months: 24, behaviour_uplift_max: 150, fraud_block_score: 45 },
])).map((r, i) => ({ id: `cp_${i + 1}`, ...r }));

export const asset_types = [
  { id: 'vehicle_passenger', name: 'Passenger vehicle', registry: 'NaTIS', identifier: 'vin' },
  { id: 'vehicle_commercial', name: 'Commercial vehicle', registry: 'NaTIS', identifier: 'vin' },
  { id: 'motorcycle', name: 'Motorcycle', registry: 'NaTIS', identifier: 'vin' },
  { id: 'handset', name: 'Mobile handset', registry: null, identifier: 'imei' },
  { id: 'tablet', name: 'Tablet', registry: null, identifier: 'serial_number' },
  { id: 'laptop', name: 'Laptop', registry: null, identifier: 'serial_number' },
  { id: 'equipment', name: 'Equipment', registry: null, identifier: 'serial_number' },
  { id: 'solar_system', name: 'Solar system', registry: null, identifier: 'serial_number' },
];

// The Regulation 23A minimum. Applied expenses are the greater of this
// and what the applicant declared — a declared figure below the
// regulated floor does not reduce what the assessment must assume.
export function ncaMinimumExpensesCents(netIncomeCents) {
  const band = affordability_norms.find((b) =>
    netIncomeCents >= b.band_floor_cents &&
    (b.band_ceiling_cents === null || netIncomeCents <= b.band_ceiling_cents));
  if (!band) return 0;
  const over = Math.max(0, netIncomeCents - band.band_floor_cents + (band.band_floor_cents > 0 ? 1 : 0));
  return Math.round(band.fixed_cents + (over * band.marginal_pct) / 100);
}
