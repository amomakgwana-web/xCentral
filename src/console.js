// ══════════════════════════════════════════════════════════════
// xCentral console.
//
// Renders against window.XC_DB (see backend.js). Every page degrades
// to a readable message rather than a blank screen when the project
// has no Supabase credentials or the signed-in role lacks permission,
// because a verification console that fails silently is worse than
// one that fails loudly.
// ══════════════════════════════════════════════════════════════

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const fmtRand = (cents) => cents === null || cents === undefined ? '—'
  : 'R ' + (Math.round(Number(cents)) / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Acronyms titleCase would otherwise mangle into "Sa Id", "Pep", "Dsar".
const ACRONYMS = {
  sa_id: 'SA ID', pep: 'PEP', ussd: 'USSD', dsar: 'DSAR', mrz: 'MRZ',
  nca: 'NCA', popia: 'POPIA', fica: 'FICA', pad: 'PAD', api: 'API',
  drivers_licence: "Driver's Licence", id_structure: 'ID Structure',
};
const titleCase = (s) => {
  const key = String(s ?? '').toLowerCase();
  if (ACRONYMS[key]) return ACRONYMS[key];
  return String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

const badge = (v) => v ? `<span class="badge b-${esc(v)}">${esc(titleCase(v))}</span>` : '<span class="muted">—</span>';

// badge() takes one value and uses it for both the colour and the
// wording, which is right only when the value is the word to show. It
// often is not: a fraud rule in the "address" domain has no colour of
// its own, so the colour has to be borrowed from another vocabulary —
// and badge() then prints that borrowed word. chip() takes the two
// separately, so the reader sees "Address", not "Biometric Address".
const chip = (tone, label) => label
  ? `<span class="badge b-${esc(tone)}">${esc(titleCase(label))}</span>`
  : '<span class="muted">—</span>';
const meter = (score) => {
  if (score === null || score === undefined) return '<span class="muted">—</span>';
  const cls = score >= 80 ? '' : score >= 55 ? 'mid' : 'low';
  return `<div style="display:flex;align-items:center;gap:8px">
    <div class="meter" style="flex:1"><i class="${cls}" style="width:${Math.max(0, Math.min(100, score))}%"></i></div>
    <span class="mono" style="min-width:26px;text-align:right">${score}</span></div>`;
};

const ICON = {
  dashboard: '<rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5"/>',
  cases: '<path d="M4 3h9l3 3v11a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M12 3v4h4" stroke-linejoin="round"/>',
  identity: '<rect x="2" y="4" width="16" height="12" rx="2"/><circle cx="7.5" cy="9.5" r="2"/><path d="M4 14c.6-1.6 2-2.3 3.5-2.3S10.4 12.4 11 14M12.5 8h4M12.5 11h3" stroke-linecap="round"/>',
  documents: '<path d="M5 2h6l4 4v12H5z" stroke-linejoin="round"/><path d="M11 2v4h4M7.5 10h5M7.5 13h5" stroke-linecap="round"/>',
  credit: '<rect x="2" y="5" width="16" height="11" rx="2"/><path d="M2 8.5h16" stroke-linecap="round"/><path d="M5 12.5h3" stroke-linecap="round"/>',
  biometrics: '<path d="M10 2.5c-3 0-5 2-5 4.5M15 7C15 4.5 13 2.5 10 2.5"/><path d="M3.5 10.5c0-1 .3-2 .8-2.8M16.5 10.5c0-1-.3-2-.8-2.8"/><path d="M6.5 8.5a3.5 3.5 0 017 0c0 3-.5 5.5-1.5 8M7 17c1-2 1.5-4.5 1.5-8" stroke-linecap="round"/>',
  consent: '<rect x="4" y="9" width="12" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 016 0V9" stroke-linecap="round"/><circle cx="10" cy="13" r="1.1" fill="currentColor" stroke="none"/>',
  watchlist: '<circle cx="9" cy="9" r="6"/><path d="M13.5 13.5L17 17" stroke-linecap="round"/><path d="M9 6.5v3M9 11.5v.4" stroke-linecap="round"/>',
  platforms: '<path d="M7 7l-4 3 4 3M13 7l4 3-4 3M11 5l-2 10" stroke-linecap="round" stroke-linejoin="round"/>',
  audit: '<path d="M3 4h14M3 10h14M3 16h9" stroke-linecap="round"/><circle cx="15.5" cy="16" r="2.2"/>',
  retention: '<path d="M4 6h12l-1 11H5L4 6z" stroke-linejoin="round"/><path d="M7.5 6V4.5a1 1 0 011-1h3a1 1 0 011 1V6M8.5 9.5v4M11.5 9.5v4" stroke-linecap="round"/>',
  onboard: '<rect x="2.5" y="4" width="15" height="12" rx="2"/><circle cx="7.5" cy="9" r="2.2"/><path d="M4 14c.5-1.6 1.9-2.4 3.5-2.4S10.5 12.4 11 14" stroke-linecap="round"/><path d="M12.5 8h4M12.5 11h2.5" stroke-linecap="round"/>',
  customers: '<circle cx="7.5" cy="7" r="2.8"/><path d="M2.5 16c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" stroke-linecap="round"/><path d="M13.5 5.5a2.4 2.4 0 010 4.6M15 15.8c0-2-.8-3.4-2-4.2" stroke-linecap="round"/>',
  portfolio: '<rect x="2.5" y="6" width="15" height="10" rx="2"/><path d="M7 6V4.6A1.6 1.6 0 018.6 3h2.8A1.6 1.6 0 0113 4.6V6" stroke-linecap="round"/><path d="M2.5 10h15" stroke-linecap="round"/>',
  payments: '<path d="M3 15.5V5a1 1 0 011-1h12a1 1 0 011 1v10.5" stroke-linecap="round"/><path d="M2 15.5h16" stroke-linecap="round"/><path d="M6.5 12l2.5-3 2.5 2 2.5-4" stroke-linecap="round" stroke-linejoin="round"/>',
  fraud: '<path d="M10 2.4L3.4 5v4.8c0 4.5 2.9 7.7 6.6 9.1 3.7-1.4 6.6-4.6 6.6-9.1V5L10 2.4z"/><path d="M10 7.4v3.4M10 13.2v.5" stroke-linecap="round"/>',
};

const PAGES = [
  { id: 'dashboard',  label: 'Home',     title: 'Verification Overview',        sub: 'Live case flow across every calling platform' },
  { id: 'cases',      label: 'Cases',    title: 'Verification Cases',           sub: 'Every case, its checks, and its decision' },
  { id: 'identity',   label: 'Identity', title: 'Identity Verification',        sub: 'SA ID structure · Home Affairs lookup · deceased register' },
  { id: 'documents',  label: 'Docs',     title: 'Document Verification',        sub: 'MRZ check digits · authenticity · expiry · private storage' },
  { id: 'credit',     label: 'Credit',   title: 'Credit Verification',          sub: 'Bureau enquiries · NCA Regulation 23A affordability' },
  { id: 'biometrics', label: 'Bio',      title: 'Biometric Verification',       sub: 'Face match · liveness · duplicate enrolment' },
  { id: 'onboard',    label: 'Capture',  title: 'Live Capture & Onboarding',    sub: 'The identity number, the person, their document — then everything reconciled against everything else' },
  { id: 'customers',  label: 'People',   title: 'Customers',                    sub: 'Profiles, background vetting and credit capacity' },
  { id: 'portfolio',  label: 'Book',     title: 'Assets & Agreements',          sub: 'What is financed, on what terms, against which asset' },
  { id: 'payments',   label: 'Pay',      title: 'Payments & Arrears',           sub: 'What was due, what arrived, and who is behind' },
  { id: 'fraud',      label: 'Fraud',    title: 'Fraud Detection',              sub: 'Signals, alerts and the confirmed fraud register' },
  { id: 'consent',    label: 'Consent',  title: 'Consent Register',             sub: 'POPIA lawful basis · withdrawal · data subject requests' },
  { id: 'watchlist',  label: 'Screen',   title: 'Sanctions & PEP Screening',    sub: 'FIC obligations · watchlist hits and adjudication' },
  { id: 'platforms',  label: 'API',      title: 'Platforms & API Keys',         sub: 'The systems that call the hub, and what they may ask' },
  { id: 'audit',      label: 'Audit',    title: 'Audit Trail',                  sub: 'Append-only record of every action taken' },
  { id: 'retention',  label: 'Keep',     title: 'Retention & Minimisation',     sub: 'What is kept, for how long, and on what basis' },
];

let DB = null;
let current = 'dashboard';
const cache = {};

// ── Chrome ──────────────────────────────────────────────────────
function renderNav() {
  document.getElementById('nav').innerHTML = PAGES.map((p) => `
    <button class="nav-btn ${p.id === current ? 'active' : ''}" data-page="${p.id}" title="${esc(p.title)}">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">${ICON[p.id]}</svg>
      <span>${esc(p.label)}</span>
      ${p.id === 'cases' && cache.reviewCount ? `<span class="nav-badge">${cache.reviewCount}</span>` : ''}
    </button>`).join('');

  document.querySelectorAll('.nav-btn').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.page)));
}

function shell(page, body) {
  return `<div class="page active">
    <div class="page-hdr">
      <div><div class="ph-title">${esc(page.title)}</div><div class="ph-sub">${esc(page.sub)}</div></div>
      <div class="ph-actions" id="phActions"></div>
    </div>
    <div class="pad">${body}</div>
  </div>`;
}

function loading() {
  return `<div class="empty"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2" stroke-linecap="round"/></svg><div>Loading…</div></div>`;
}

function emptyState(msg) {
  return `<div class="empty"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M6.5 9h7M6.5 12.5h4" stroke-linecap="round"/></svg><div>${esc(msg)}</div></div>`;
}

function errorState(e) {
  const msg = e instanceof Error ? e.message : String(e);
  return `<div class="note note-danger"><b>Could not load this page.</b><br>${esc(msg)}</div>`;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4600);
}

window.closeModal = () => document.getElementById('modal').classList.remove('open');

function openModal(title, body, foot = '', wide = false) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalFoot').innerHTML = foot;
  const modal = document.getElementById('modal');
  modal.classList.toggle('wide', !!wide);
  modal.classList.add('open');
}

async function go(pageId) {
  current = pageId;
  renderNav();
  const page = PAGES.find((p) => p.id === pageId);
  const main = document.getElementById('main');
  main.innerHTML = shell(page, loading());
  main.scrollTop = 0;

  if (!DB?.configured) {
    main.innerHTML = shell(page, `<div class="note note-warn">
      <b>This console is not pointed at a Supabase project yet.</b><br>
      Set <span class="mono">VITE_SUPABASE_URL_SANDBOX</span> and <span class="mono">VITE_SUPABASE_KEY_SANDBOX</span>,
      then apply the migrations in <span class="mono">supabase/migrations</span> and the seed in
      <span class="mono">supabase/seed.sql</span>. Everything below will populate from real data — nothing here is mocked.
    </div>`);
    return;
  }

  try {
    const body = await RENDER[pageId]();
    main.innerHTML = shell(page, body);
    (WIRE[pageId] ?? (() => {}))();
  } catch (e) {
    console.error(e);
    main.innerHTML = shell(page, errorState(e));
  }
}

// ── Pages ───────────────────────────────────────────────────────
const RENDER = {};
const WIRE = {};

RENDER.dashboard = async () => {
  const [d, name] = await Promise.all([DB.fetchDashboard(), platformName()]);
  cache.reviewCount = d.needsReview;

  const rows = d.recent.length ? d.recent.map((c) => `
    <tr class="clickable" data-case="${esc(c.id)}">
      <td class="mono">${esc(c.id)}</td>
      <td>${esc(name(c.platform))}</td>
      <td class="mono muted">${esc(c.reference ?? '—')}</td>
      <td>${badge(c.level)}</td>
      <td>${badge(c.status)}</td>
      <td style="min-width:110px">${meter(c.score)}</td>
      <td class="muted">${fmtDateTime(c.createdAt)}</td>
    </tr>`).join('') : `<tr><td colspan="7">${emptyState('No cases yet.')}</td></tr>`;

  return `
  <div class="g4">
    <div class="stat blue"><div class="stat-lbl">Total Cases</div><div class="stat-val">${d.total}</div>
      <div class="stat-meta">Across all calling platforms</div></div>
    <div class="stat green"><div class="stat-lbl">Verified</div><div class="stat-val">${d.verified}</div>
      <div class="stat-meta">${d.passRate === null ? 'No decided cases yet' : d.passRate + '% of decided cases'}</div></div>
    <div class="stat amber"><div class="stat-lbl">Awaiting Review</div><div class="stat-val">${d.needsReview}</div>
      <div class="stat-meta">A person must decide these</div></div>
    <div class="stat purple"><div class="stat-lbl">In Progress</div><div class="stat-val">${d.inProgress}</div>
      <div class="stat-meta">Required checks still outstanding</div></div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Recent cases</div>
      <div class="card-sub">Newest first · click a row for the full check timeline</div></div>
      <div class="card-actions"><button class="btn btn-sm" data-goto="cases">View all</button></div></div>
    <table><thead><tr><th>Case</th><th>Platform</th><th>Reference</th><th>Level</th><th>Status</th><th>Score</th><th>Opened</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>

  <div class="note note-info" style="margin-top:16px">
    <b>What the score means.</b> It is the weighted mean of the checks that have actually run, using the weights
    for the case's assurance level. A required check that has not run holds the case at <i>in&nbsp;progress</i> however
    high the average is, and a failed required check rejects the case whatever the average is — the score never
    outvotes a definite result.
  </div>`;
};

WIRE.dashboard = () => {
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
  wireCaseRows();
};

RENDER.cases = async () => {
  const [cases, name] = await Promise.all([DB.fetchCases({ limit: 300 }), platformName()]);
  cache.reviewCount = cases.filter((c) => c.status === 'review').length;

  const rows = cases.length ? cases.map((c) => `
    <tr class="clickable" data-case="${esc(c.id)}">
      <td class="mono">${esc(c.id)}</td>
      <td>${esc(name(c.platform))}</td>
      <td class="mono muted">${esc(c.reference ?? '—')}</td>
      <td>${esc(titleCase(c.purpose))}</td>
      <td>${badge(c.level)}</td>
      <td>${badge(c.status)}</td>
      <td>${badge(c.risk)}</td>
      <td style="min-width:110px">${meter(c.score)}</td>
      <td class="muted">${fmtDate(c.createdAt)}</td>
    </tr>`).join('') : `<tr><td colspan="9">${emptyState('No cases yet.')}</td></tr>`;

  return `
  <div class="tabs" id="caseTabs">
    ${['all', 'review', 'in_progress', 'verified', 'rejected'].map((s, i) =>
      `<button class="tab ${i === 0 ? 'active' : ''}" data-filter="${s}">${titleCase(s)}</button>`).join('')}
  </div>
  <div class="card">
    <table><thead><tr><th>Case</th><th>Platform</th><th>Reference</th><th>Purpose</th><th>Level</th>
      <th>Status</th><th>Risk</th><th>Score</th><th>Opened</th></tr></thead>
    <tbody id="caseRows">${rows}</tbody></table>
  </div>`;
};

WIRE.cases = () => {
  wireCaseRows();
  document.querySelectorAll('#caseTabs .tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('#caseTabs .tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    const f = t.dataset.filter;
    document.querySelectorAll('#caseRows tr').forEach((r) => {
      if (f === 'all') { r.style.display = ''; return; }
      r.style.display = r.querySelector(`.b-${f}`) ? '' : 'none';
    });
  }));
};

// Platform ids are what the cases carry; people read names. Cached
// because every case table needs the same lookup.
async function platformName() {
  if (!cache.platformNames) {
    try {
      const rows = await DB.fetchPlatforms();
      cache.platformNames = new Map(rows.map((p) => [p.id, p.name]));
    } catch {
      cache.platformNames = new Map();
    }
  }
  return (id) => cache.platformNames.get(id) ?? id;
}

function wireCaseRows() {
  document.querySelectorAll('tr[data-case]').forEach((r) =>
    r.addEventListener('click', () => openCase(r.dataset.case)));
}

// ── Case evidence ───────────────────────────────────────────────
// fetchCase() returns the identity, document, credit, affordability,
// biometric and watchlist records behind a case, and for a long time
// openCase() rendered only the check timeline and dropped the rest —
// six of its seven round-trips fetched data nobody could see. The
// check timeline says a document check scored 91; these say which
// document, whether its machine-readable zone verified, and what the
// tamper signals were. That is the difference between a score and
// evidence a person can act on.
//
// Each section renders only when there is something in it, so a basic
// age check does not grow six empty panels.
function caseEvidence(c) {
  const section = (title, body) => body
    ? `<div style="height:16px"></div>
       <div class="card-title" style="margin-bottom:10px">${esc(title)}</div>${body}`
    : '';

  const identity = (c.identity ?? []).map((v) => `
    <dl class="kv">
      <dt>Authority</dt><dd>${chip(
        v.authority_status === 'match' ? 'passed'
        : v.authority_status === 'no_match' ? 'failed' : 'review', v.authority_status)}
        ${v.authority_provider ? `<span class="muted">via ${esc(v.authority_provider)}</span>` : ''}</dd>
      <dt>Name returned</dt><dd>${esc(v.authority_name ?? '—')}
        ${v.name_match_score !== null ? `<span class="mono muted">${esc(v.name_match_score)}% match</span>` : ''}</dd>
      <dt>Claimed</dt><dd>${esc(v.claimed_name ?? '—')}</dd>
      <dt>From the number</dt><dd>${fmtDate(v.derived_date_of_birth)} ·
        ${esc(titleCase(v.derived_gender ?? 'unknown'))} ·
        ${esc(titleCase(v.derived_citizenship ?? 'unknown'))}</dd>
      <dt>Flags</dt><dd>${[
        v.structure_valid ? '' : '<span class="badge b-failed">Check digit failed</span>',
        v.deceased_flag ? '<span class="badge b-failed">On the deceased register</span>' : '',
        v.watchlist_hit ? '<span class="badge b-review">Watchlist hit</span>' : '',
      ].filter(Boolean).join(' ') || '<span class="muted">None</span>'}</dd>
    </dl>`).join('<div style="height:10px"></div>');

  const documents = (c.documents ?? []).length ? `
    <table><thead><tr>
      <th>Document</th><th>MRZ</th><th>Expires</th><th>Authenticity</th><th>Outcome</th>
    </tr></thead><tbody>
      ${c.documents.map((d) => {
        const tamper = Array.isArray(d.tamper_signals) ? d.tamper_signals : [];
        return `<tr>
          <td><b>${esc(titleCase(d.doc_type))}</b>
            ${d.document_number_last4 ? `<div class="mono muted">···· ${esc(d.document_number_last4)}</div>` : ''}</td>
          <td>${d.mrz_present
            ? (d.mrz_valid ? '<span class="badge b-passed">Verified</span>'
                           : '<span class="badge b-failed">Check digit failed</span>')
            : '<span class="muted">None</span>'}</td>
          <td>${d.date_of_expiry ? fmtDate(d.date_of_expiry) : '<span class="muted">—</span>'}
            ${d.expired ? '<span class="badge b-failed">Expired</span>' : ''}
            ${d.stale ? '<span class="badge b-review">Stale</span>' : ''}</td>
          <td class="mono">${d.authenticity_score ?? '—'}</td>
          <td>${badge(d.status)}
            ${tamper.length ? `<div class="muted" style="font-size:10.5px;color:var(--red)">
              ${esc(tamper.map((t) => t.code ?? '').filter(Boolean).join(', '))}</div>` : ''}
            ${d.reason_codes?.length ? `<div class="muted" style="font-size:10.5px">
              ${esc(d.reason_codes.join(', '))}</div>` : ''}</td>
        </tr>`;
      }).join('')}
    </tbody></table>` : '';

  const credit = (c.credit ?? []).map((k) => `
    <dl class="kv">
      <dt>Bureau</dt><dd>${esc(k.bureau_id)} · ${esc(titleCase(k.enquiry_type ?? ''))} enquiry
        ${k.provider_reference ? `<span class="mono muted">${esc(k.provider_reference)}</span>` : ''}</dd>
      <dt>Score</dt><dd style="max-width:220px">${meter(k.score)}</dd>
      <dt>Band</dt><dd>${esc(k.band ?? '—')} ${k.risk ? chip(
        k.risk === 'low' ? 'passed' : k.risk === 'medium' ? 'review' : 'failed', k.risk) : ''}</dd>
      <dt>Accounts</dt><dd>${esc(k.accounts_total ?? 0)} open ·
        ${esc(k.accounts_in_arrears ?? 0)} in arrears${k.worst_arrears_months
          ? ` · worst ${esc(k.worst_arrears_months)} month(s)` : ''}</dd>
      <dt>Monthly obligations</dt><dd class="mono">${fmtRand(k.monthly_debt_obligations_cents)}</dd>
      <dt>Adverse</dt><dd>${[
        (k.defaults ?? 0) ? `${k.defaults} default(s)` : '',
        (k.judgments ?? 0) ? `${k.judgments} judgment(s)` : '',
        k.debt_review ? 'Under debt review' : '',
        k.sequestration ? 'Sequestrated' : '',
      ].filter(Boolean).join(' · ') || '<span class="muted">Nothing on record</span>'}</dd>
    </dl>`).join('<div style="height:10px"></div>');

  // The affordability panel is laid out to mirror NCA Regulation 23A:
  // the applied expense figure is the greater of what was declared and
  // the regulated minimum, and showing both is the only way a reader
  // can see which one governed.
  const affordability = (c.affordability ?? []).map((a) => `
    <dl class="kv">
      <dt>Net income</dt><dd class="mono">${fmtRand(a.net_income_cents)}
        ${a.income_verified ? '<span class="badge b-passed">Verified</span>'
                            : '<span class="badge b-review">Not verified</span>'}
        ${a.income_source ? `<span class="muted">${esc(a.income_source)}</span>` : ''}</dd>
      <dt>Declared expenses</dt><dd class="mono">${fmtRand(a.declared_expenses_cents)}</dd>
      <dt>Regulation 23A minimum</dt><dd class="mono">${fmtRand(a.minimum_expenses_cents)}</dd>
      <dt>Applied</dt><dd class="mono"><b>${fmtRand(a.applied_expenses_cents)}</b>
        <span class="muted">the greater of the two</span></dd>
      <dt>Existing obligations</dt><dd class="mono">${fmtRand(a.existing_obligations_cents)}</dd>
      <dt>Proposed instalment</dt><dd class="mono">${fmtRand(a.proposed_instalment_cents)}</dd>
      <dt>Discretionary income</dt><dd class="mono"><b>${fmtRand(a.discretionary_income_cents)}</b></dd>
      <dt>Outcome</dt><dd>${chip(
        a.outcome === 'affordable' ? 'passed'
        : a.outcome === 'marginal' ? 'review' : 'failed', a.outcome)}
        ${a.reason_codes?.length ? `<span class="muted">${esc(a.reason_codes.join(', '))}</span>` : ''}</dd>
    </dl>`).join('<div style="height:10px"></div>');

  const biometrics = (c.biometrics ?? []).length ? `
    <table><thead><tr>
      <th>Modality</th><th>Mode</th><th>Similarity</th><th>Threshold</th>
      <th>Liveness</th><th>Outcome</th>
    </tr></thead><tbody>
      ${c.biometrics.map((b) => `<tr>
        <td><b>${esc(titleCase(b.modality))}</b>
          <div class="mono muted">${esc(b.model_id ?? '')}</div></td>
        <td>${esc(titleCase(b.mode ?? ''))}</td>
        <td class="mono">${b.similarity ?? '—'}</td>
        <td class="mono">${b.threshold_applied ?? '—'}
          ${b.operating_fmr ? `<div class="muted">FMR ${esc(b.operating_fmr)}</div>` : ''}</td>
        <td>${b.liveness_performed
          ? (b.liveness_passed ? `<span class="badge b-passed">Live</span>
              ${b.pad_level ? `<span class="muted">PAD ${esc(b.pad_level)}</span>` : ''}`
            : `<span class="badge b-failed">${esc(titleCase(b.attack_type ?? 'failed'))}</span>`)
          : '<span class="muted">Not run</span>'}</td>
        <td>${badge(b.status)}
          ${b.reason_codes?.length ? `<div class="muted" style="font-size:10.5px">
            ${esc(b.reason_codes.join(', '))}</div>` : ''}</td>
      </tr>`).join('')}
    </tbody></table>
    <div class="note note-info" style="margin-top:10px">
      <b>No image is held.</b> A similarity is a comparison of two irreversible templates.
      The threshold is the model's own calibration at the stated false match rate, not a
      number chosen here.</div>` : '';

  const hits = (c.hits ?? []).length ? `
    <table><thead><tr><th>Match</th><th>Score</th><th>Status</th><th>Note</th></tr></thead><tbody>
      ${c.hits.map((h) => `<tr>
        <td class="mono">${esc(h.entry_id ?? '—')}</td>
        <td class="mono">${esc(h.match_score)}</td>
        <td>${chip(h.status === 'confirmed' ? 'failed'
          : h.status === 'false_positive' ? 'passed' : 'review', h.status)}</td>
        <td class="muted">${esc(h.review_note ?? '—')}</td>
      </tr>`).join('')}
    </tbody></table>` : '';

  return section('Identity', identity)
    + section('Documents', documents)
    + section('Credit bureau', credit)
    + section('Affordability · NCA Regulation 23A', affordability)
    + section('Biometrics', biometrics)
    + section('Watchlist hits', hits);
}

async function openCase(caseId) {
  openModal(caseId, loading());
  try {
    const c = await DB.fetchCase(caseId);
    if (!c) { openModal(caseId, errorState(new Error('Case not found'))); return; }
    const scoring = await DB.scoreCase(caseId);

    const timeline = c.checks.length ? `<div class="timeline">${c.checks.map((k) => `
      <div class="tl-item ${esc(k.status)}">
        <div class="tl-head">
          <span class="tl-name">${esc(titleCase(k.check_type))}</span>
          ${badge(k.domain)} ${badge(k.status)}
          ${k.score !== null ? `<span class="mono muted">${k.score}</span>` : ''}
        </div>
        <div class="tl-meta">
          ${esc(k.provider)} · ${fmtDateTime(k.created_at)}
          ${k.reason_codes?.length ? ` · <span style="color:var(--amb)">${esc(k.reason_codes.join(', '))}</span>` : ''}
        </div>
      </div>`).join('')}</div>` : emptyState('No checks have run on this case yet.');

    const outstanding = (scoring?.missing_checks ?? []);
    const failed = (scoring?.failed_checks ?? []);
    const manual = (scoring?.manual_review_checks ?? []);

    const gaps = (outstanding.length || failed.length || manual.length) ? `
      <div class="note ${failed.length ? 'note-danger' : 'note-warn'}">
        ${failed.length ? `<b>Failed:</b> ${esc(failed.join(', '))}<br>` : ''}
        ${manual.length ? `<b>Needs a person:</b> ${esc(manual.join(', '))}<br>` : ''}
        ${outstanding.length ? `<b>Still outstanding:</b> ${esc(outstanding.join(', '))}` : ''}
      </div>` : `<div class="note note-info">Every required check for the <b>${esc(c.level)}</b> level has passed.</div>`;

    const subject = c.subject ? `<dl class="kv">
      <dt>Subject</dt><dd>${esc([c.subject.first_names, c.subject.surname].filter(Boolean).join(' ') || '—')}</dd>
      <dt>Identifier</dt><dd class="mono">${esc(titleCase(c.subject.id_type))} ···· ${esc(c.subject.id_last4)}
        <span class="muted" style="font-size:10.5px"> (number never stored)</span></dd>
      <dt>Date of birth</dt><dd>${fmtDate(c.subject.date_of_birth)}</dd>
      <dt>Citizenship</dt><dd>${esc(titleCase(c.subject.citizenship ?? 'unknown'))}</dd>
      <dt>Standing assurance</dt><dd>${badge(c.subject.assurance_level)} ${c.subject.assurance_expires_at ? `<span class="muted">until ${fmtDate(c.subject.assurance_expires_at)}</span>` : ''}</dd>
    </dl>` : '<div class="muted">No subject linked.</div>';

    const decidable = !['verified', 'rejected', 'cancelled', 'expired'].includes(c.status);

    openModal(`${caseId} · ${titleCase(c.status)}`, `
      ${subject}
      <div style="height:14px"></div>
      <dl class="kv">
        <dt>Platform</dt><dd>${esc((await platformName())(c.platform))}</dd>
        <dt>Reference</dt><dd class="mono">${esc(c.reference ?? '—')}</dd>
        <dt>Purpose · level</dt><dd>${esc(titleCase(c.purpose))} · ${badge(c.level)}</dd>
        <dt>Score</dt><dd style="max-width:200px">${meter(c.score)}</dd>
        <dt>Valid until</dt><dd>${fmtDate(c.expiresAt)}</dd>
        ${c.decisionReason ? `<dt>Decision reason</dt><dd>${esc(c.decisionReason)}</dd>` : ''}
      </dl>
      ${gaps}
      <div style="height:16px"></div>
      <div class="card-title" style="margin-bottom:10px">Check timeline</div>
      ${timeline}
      ${caseEvidence(c)}`,
      decidable ? `
        <button class="btn" onclick="closeModal()">Close</button>
        <button class="btn btn-danger btn-sm" id="rejectBtn">Reject</button>
        <button class="btn btn-primary btn-sm" id="verifyBtn">Verify</button>`
        : `<button class="btn" onclick="closeModal()">Close</button>`);

    if (decidable) {
      document.getElementById('verifyBtn').addEventListener('click', () => decide(caseId, 'verify', scoring));
      document.getElementById('rejectBtn').addEventListener('click', () => decide(caseId, 'reject', scoring));
    }
  } catch (e) {
    openModal(caseId, errorState(e));
  }
}

function decide(caseId, decision, scoring) {
  const suggested = scoring?.suggested_status;
  const isOverride = (decision === 'verify' && suggested !== 'verified')
                  || (decision === 'reject' && suggested === 'verified');

  openModal(`${decision === 'verify' ? 'Verify' : 'Reject'} ${caseId}`, `
    ${isOverride ? `<div class="note note-warn"><b>This overrides the pipeline.</b><br>
      The checks suggest <b>${esc(titleCase(suggested ?? 'unknown'))}</b>. A reason is required, and the override
      is recorded against your account in the audit trail.</div><div style="height:12px"></div>` : ''}
    <div class="field">
      <label for="decisionReason">Reason${isOverride ? ' (required)' : ' (optional)'}</label>
      <textarea id="decisionReason" placeholder="What did you find that the checks did not?"></textarea>
    </div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button>
     <button class="btn ${decision === 'verify' ? 'btn-primary' : 'btn-danger'} btn-sm" id="confirmDecision">
       Confirm ${decision === 'verify' ? 'verification' : 'rejection'}</button>`);

  document.getElementById('confirmDecision').addEventListener('click', async () => {
    const reason = document.getElementById('decisionReason').value.trim();
    if (isOverride && !reason) { toast('A reason is required to override the pipeline', 'err'); return; }
    try {
      const res = await DB.decideCase({ caseId, decision, reason: reason || undefined });
      toast(`${caseId} is now ${res.status}`, 'ok');
      closeModal();
      go(current);
    } catch (e) {
      toast(e.message, 'err');
    }
  });
}

RENDER.identity = async () => {
  const cases = await DB.fetchCases({ limit: 200 });
  const subjects = await DB.fetchSubjects(100);

  const subjectRows = subjects.length ? subjects.map((s) => `
    <tr>
      <td>${esc([s.first_names, s.surname].filter(Boolean).join(' ') || '—')}</td>
      <td class="mono">${esc(titleCase(s.id_type))} ···· ${esc(s.id_last4)}</td>
      <td>${fmtDate(s.date_of_birth)}</td>
      <td>${esc(titleCase(s.gender ?? 'unknown'))}</td>
      <td>${esc(titleCase(s.citizenship ?? 'unknown'))}</td>
      <td>${badge(s.assurance_level)}</td>
      <td>${s.deceased ? '<span class="badge b-rejected">On register</span>' : '<span class="muted">—</span>'}</td>
    </tr>`).join('') : `<tr><td colspan="7">${emptyState('No subjects yet.')}</td></tr>`;

  return `
  <div class="g2">
    <div class="card" style="margin-top:0">
      <div class="card-hdr"><div><div class="card-title">SA ID validator</div>
        <div class="card-sub">Check-digit arithmetic only — nothing is stored and no case is opened</div></div></div>
      <div class="card-body">
        <div class="field">
          <label for="idInput">South African ID number</label>
          <input id="idInput" class="mono" maxlength="20" placeholder="13 digits" autocomplete="off">
          <div class="hint">The number is sent to the database only to run <span class="mono">validate_sa_id()</span>; it is not written anywhere.</div>
        </div>
        <button class="btn btn-primary btn-sm" id="validateBtn">Validate</button>
        <div id="idResult"></div>
      </div>
    </div>

    <div class="card" style="margin-top:0">
      <div class="card-hdr"><div><div class="card-title">What identity verification proves</div></div></div>
      <div class="card-body" style="font-size:12px;line-height:1.65;color:var(--ink3)">
        <p><b style="color:var(--ink)">Structure</b> is decided here, from the number itself: the Luhn check digit,
        the encoded date of birth, the gender sequence and the citizenship digit. A transposed digit fails
        arithmetically — no provider is involved and no provider can disagree.</p>
        <p style="margin-top:9px"><b style="color:var(--ink)">Existence</b> is not. Whether Home Affairs holds this
        record, and whether the name on it matches, is a provider call. Until a contract is live those checks run
        against the simulation adapter and are stamped <span class="mono">simulation</span> in the ledger, permanently
        and visibly.</p>
        <p style="margin-top:9px"><b style="color:var(--ink)">The number is never stored.</b> What persists is a
        peppered SHA-256 hash, the last four digits, and the attributes the number encodes. Two platforms verifying
        the same person converge on one subject record without the hub holding the number.</p>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Subjects</div>
      <div class="card-sub">${subjects.length} on record · identifiers shown masked, as stored</div></div></div>
    <table><thead><tr><th>Name</th><th>Identifier</th><th>Date of birth</th><th>Gender</th>
      <th>Citizenship</th><th>Assurance</th><th>Deceased register</th></tr></thead>
    <tbody>${subjectRows}</tbody></table>
  </div>`;
};

WIRE.identity = () => {
  const run = async () => {
    const val = document.getElementById('idInput').value.trim();
    const out = document.getElementById('idResult');
    if (!val) { out.innerHTML = ''; return; }
    try {
      const r = await DB.validateSaId(val);
      out.innerHTML = r.valid
        ? `<div class="note note-info" style="margin-top:12px">
             <b style="color:var(--gr2)">Valid.</b>
             <dl class="kv" style="margin-top:8px">
               <dt>Date of birth</dt><dd>${fmtDate(r.date_of_birth)}</dd>
               <dt>Age</dt><dd>${esc(r.age ?? '—')}</dd>
               <dt>Gender</dt><dd>${esc(titleCase(r.gender))}</dd>
               <dt>Citizenship</dt><dd>${esc(titleCase(r.citizenship))}</dd>
             </dl></div>`
        : `<div class="note note-danger" style="margin-top:12px"><b>Not valid.</b><br>
             ${esc((r.reason_codes ?? []).map(titleCase).join(' · ') || 'Unknown reason')}</div>`;
    } catch (e) { out.innerHTML = errorState(e); }
  };
  document.getElementById('validateBtn').addEventListener('click', run);
  document.getElementById('idInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
};

RENDER.documents = async () => {
  const [types, policies] = await Promise.all([DB.fetchDocumentTypes(), DB.fetchRetentionPolicies()]);
  const docPolicy = policies.find((p) => p.id === 'doc_images');

  const typeRows = types.map((t) => `
    <tr>
      <td><b>${esc(t.name)}</b></td>
      <td>${badge(t.category)}</td>
      <td>${t.has_mrz ? '<span class="badge b-passed">Yes</span>' : '<span class="muted">—</span>'}</td>
      <td>${t.has_portrait ? '<span class="badge b-passed">Yes</span>' : '<span class="muted">—</span>'}</td>
      <td class="muted">${t.max_age_days ? t.max_age_days + ' days' : 'Does not go stale'}</td>
    </tr>`).join('');

  return `
  <div class="note note-info">
    <b>Documents are never reachable by URL.</b> The bucket is private and carries no client policy, so a staff
    member cannot open an ID scan even with a valid session. Access goes through the
    <span class="mono">document-access</span> function, which checks the permission, demands a written reason, logs
    the access, and mints a signed URL that expires in at most five minutes.
    ${docPolicy ? `Images are deleted after <b>${docPolicy.retain_days} days</b> — ${esc(docPolicy.legal_basis)}.` : ''}
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Accepted document types</div>
      <div class="card-sub">Types with a machine-readable zone are check-digit verifiable without a provider</div></div></div>
    <table><thead><tr><th>Type</th><th>Category</th><th>MRZ</th><th>Portrait</th><th>Goes stale after</th></tr></thead>
    <tbody>${typeRows}</tbody></table>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">MRZ verification</div>
      <div class="card-sub">ICAO 9303 — paste a machine-readable zone to check its arithmetic</div></div></div>
    <div class="card-body">
      <div class="field">
        <label for="mrzInput">Machine-readable zone (2 lines of 44 for a passport, 3 of 30 for an ID card)</label>
        <textarea id="mrzInput" class="mono" style="min-height:76px" spellcheck="false"
          placeholder="P&lt;UTOERIKSSON&lt;&lt;ANNA&lt;MARIA&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
L898902C36UTO7408122F1204159ZE184226B&lt;&lt;&lt;&lt;&lt;10"></textarea>
        <div class="hint">Each field carries its own check digit, and a composite digit covers them together — so a
          single altered character breaks two checks at once. This runs entirely in your browser.</div>
      </div>
      <button class="btn btn-primary btn-sm" id="mrzBtn">Check</button>
      <div id="mrzResult"></div>
    </div>
  </div>`;
};

WIRE.documents = () => {
  document.getElementById('mrzBtn').addEventListener('click', async () => {
    const out = document.getElementById('mrzResult');
    const raw = document.getElementById('mrzInput').value;
    if (!raw.trim()) { out.innerHTML = ''; return; }
    try {
      // The same module the verify-document edge function uses. Vite
      // transpiles the TypeScript, so there is one MRZ implementation
      // in this repository and the console cannot drift from the
      // pipeline's answer.
      const { parseMrz } = await import('../supabase/functions/_shared/mrz.ts');
      const r = parseMrz(raw);
      const digits = Object.entries(r.checkDigits ?? {}).map(([k, v]) =>
        `<dt>${esc(titleCase(k))}</dt><dd>${v ? '<span class="badge b-passed">Passes</span>' : '<span class="badge b-failed">Fails</span>'}</dd>`).join('');
      out.innerHTML = `<div class="note ${r.valid ? 'note-info' : 'note-danger'}" style="margin-top:12px">
        <b>${r.valid ? 'Internally consistent' : 'Not consistent'}</b> — format ${esc(r.format)}.
        ${r.valid ? '' : '<br>This does not prove forgery on its own, but the zone does not check out.'}
        <dl class="kv" style="margin-top:9px">${digits}
          ${r.fields?.surname ? `<dt>Name</dt><dd>${esc([r.fields.given_names, r.fields.surname].filter(Boolean).join(' '))}</dd>` : ''}
          ${r.fields?.document_number ? `<dt>Document number</dt><dd class="mono">${esc(r.fields.document_number)}</dd>` : ''}
          ${r.fields?.date_of_birth ? `<dt>Date of birth</dt><dd>${fmtDate(r.fields.date_of_birth)}</dd>` : ''}
          ${r.fields?.date_of_expiry ? `<dt>Expires</dt><dd>${fmtDate(r.fields.date_of_expiry)}</dd>` : ''}
        </dl>
        ${r.reasonCodes?.length ? `<div style="margin-top:7px">${esc(r.reasonCodes.map(titleCase).join(' · '))}</div>` : ''}
      </div>`;
    } catch (e) { out.innerHTML = errorState(e); }
  });
};

RENDER.credit = async () => {
  const bureaus = await DB.fetchBureaus();
  return `
  <div class="note note-warn">
    <b>A bureau enquiry cannot run without consent.</b> The database refuses the insert — the consent check is a
    trigger on <span class="mono">credit_checks</span>, not a line of application code that could be forgotten.
    A hard enquiry marks the subject's bureau record, so it is opt-in per request and refused twice on the same case.
  </div>

  <div class="g2">
    <div class="card">
      <div class="card-hdr"><div><div class="card-title">Affordability calculator</div>
        <div class="card-sub">NCA Regulation 23A · the same function the pipeline uses</div></div></div>
      <div class="card-body">
        <div class="row2">
          <div class="field"><label for="afGross">Gross monthly income (R)</label><input id="afGross" type="number" min="0" step="100" value="28000"></div>
          <div class="field"><label for="afDed">Statutory deductions (R)</label><input id="afDed" type="number" min="0" step="100" value="5200"></div>
        </div>
        <div class="row2">
          <div class="field"><label for="afExp">Declared living expenses (R)</label><input id="afExp" type="number" min="0" step="100" value="9000"></div>
          <div class="field"><label for="afObl">Existing debt repayments (R)</label><input id="afObl" type="number" min="0" step="100" value="4120"></div>
        </div>
        <div class="row2">
          <div class="field"><label for="afInst">Proposed instalment (R)</label><input id="afInst" type="number" min="0" step="100" value="3500"></div>
          <div class="field"><label for="afVer">Income corroborated?</label>
            <select id="afVer"><option value="true">Yes — payslip or bank statement verified</option><option value="false">No — declared only</option></select></div>
        </div>
        <button class="btn btn-primary btn-sm" id="afBtn">Assess</button>
        <div id="afResult"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-hdr"><div><div class="card-title">How the assessment works</div></div></div>
      <div class="card-body" style="font-size:12px;line-height:1.65;color:var(--ink3)">
        <p>Regulation 23A prescribes a <b style="color:var(--ink)">minimum</b> for living expenses, not a substitute
        for them. Where an applicant declares more than the prescribed figure, their own number governs; where they
        declare less, the prescribed figure is used and the understatement is flagged.</p>
        <p style="margin-top:9px">Existing debt repayments are taken from the bureau where it has them, because a
        self-declared debt figure is the one most often understated.</p>
        <p style="margin-top:9px">Income that has not been corroborated against a payslip or bank statement can never
        produce better than a <b style="color:var(--ink)">marginal</b> outcome, however comfortable the arithmetic
        looks.</p>
        <p style="margin-top:9px">The prescribed figures are held as versioned rows, not constants. Superseding them
        is an insert, and past assessments stay reproducible against the version that was in force when they were made.</p>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Registered bureaus</div></div></div>
    <table><thead><tr><th>Bureau</th><th>Score range</th><th>Status</th></tr></thead><tbody>
      ${bureaus.map((b) => `<tr><td><b>${esc(b.name)}</b></td>
        <td class="mono">${b.score_min}–${b.score_max}</td>
        <td>${b.active ? badge('active') : badge('none')}</td></tr>`).join('')}
    </tbody></table>
  </div>`;
};

WIRE.credit = () => {
  document.getElementById('afBtn').addEventListener('click', async () => {
    const out = document.getElementById('afResult');
    const num = (id) => Number(document.getElementById(id).value || 0);
    try {
      const r = await DB.previewAffordability({
        grossIncome: num('afGross'),
        deductions: num('afDed'),
        expenses: num('afExp'),
        existingObligations: num('afObl'),
        instalment: num('afInst'),
        incomeVerified: document.getElementById('afVer').value === 'true',
      });
      const kind = r.outcome === 'affordable' ? 'note-info' : r.outcome === 'not_affordable' ? 'note-danger' : 'note-warn';
      out.innerHTML = `<div class="note ${kind}" style="margin-top:12px">
        <b>${esc(titleCase(r.outcome))}</b>
        <dl class="kv" style="margin-top:9px">
          <dt>Net income</dt><dd>${fmtRand(r.net_income_cents)}</dd>
          <dt>Prescribed minimum</dt><dd>${fmtRand(r.minimum_expenses_cents)}</dd>
          <dt>Expenses applied</dt><dd>${fmtRand(r.applied_expenses_cents)}</dd>
          <dt>Existing obligations</dt><dd>${fmtRand(r.existing_obligations_cents)}</dd>
          <dt>Proposed instalment</dt><dd>${fmtRand(r.proposed_instalment_cents)}</dd>
          <dt>Discretionary income</dt><dd><b>${fmtRand(r.discretionary_income_cents)}</b></dd>
        </dl>
        ${(r.reason_codes ?? []).length ? `<div style="margin-top:8px">${esc(r.reason_codes.map(titleCase).join(' · '))}</div>` : ''}
      </div>`;
    } catch (e) { out.innerHTML = errorState(e); }
  });
};

RENDER.biometrics = async () => {
  const [modalities, dupes] = await Promise.all([DB.fetchModalities(), DB.fetchDuplicateFlags()]);

  const modRows = modalities.map((m) => {
    const op = m.operating_fmr === '1e-4' ? m.threshold_fmr_1e4
             : m.operating_fmr === '1e-6' ? m.threshold_fmr_1e6 : m.threshold_fmr_1e5;
    return `<tr>
      <td><b>${esc(m.name)}</b></td>
      <td class="mono">${esc(m.model_id)}</td>
      <td class="mono">${esc(m.descriptor_length)}</td>
      <td class="mono">${esc(m.operating_fmr)}</td>
      <td class="mono"><b>${esc(op)}</b></td>
      <td>${m.active ? badge('active') : badge('none')}</td>
    </tr>`;
  }).join('');

  const dupeRows = dupes.length ? dupes.map((d) => `
    <tr>
      <td class="mono">${esc(String(d.subject_id).slice(0, 8))}…</td>
      <td class="mono">${esc(String(d.matched_subject_id).slice(0, 8))}…</td>
      <td>${badge(d.modality)}</td>
      <td class="mono">${Number(d.similarity).toFixed(4)}</td>
      <td>${badge(d.status)}</td>
      <td class="muted">${fmtDateTime(d.created_at)}</td>
    </tr>`).join('') : `<tr><td colspan="6">${emptyState('No duplicate enrolments flagged.')}</td></tr>`;

  return `
  <div class="note note-danger">
    <b>Liveness is evaluated before the match, and a failure stops there.</b>
    Matching a photograph of a photograph against a stored template succeeds — the template does not know that nobody
    was present. A high similarity score obtained from a presentation attack is worse than no score at all, because it
    looks like proof. When liveness fails, no similarity is computed and none is returned.
  </div>

  <div class="note note-info">
    <b>Templates are unreadable by this console.</b> The <span class="mono">biometric_templates</span> table has row
    level security enabled and no policies at all, which means every client role gets zero rows, always. Only the edge
    functions can read a template, and they only ever return a score. No raw sample — no selfie, no fingerprint image —
    is stored anywhere: it exists for the lifetime of the request that templates it and is then gone.
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Modalities and operating points</div>
      <div class="card-sub">A similarity cut-off is meaningless without the model it was calibrated against, so both are held together</div></div></div>
    <table><thead><tr><th>Modality</th><th>Model</th><th>Descriptor length</th><th>Operating FMR</th>
      <th>Threshold in force</th><th>Status</th></tr></thead><tbody>${modRows}</tbody></table>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Duplicate enrolments</div>
      <div class="card-sub">One face enrolled against two identities — the finding that matters most in a shared hub</div></div></div>
    <table><thead><tr><th>Subject</th><th>Matches</th><th>Modality</th><th>Similarity</th><th>Status</th><th>Flagged</th></tr></thead>
    <tbody>${dupeRows}</tbody></table>
  </div>`;
};

RENDER.consent = async () => {
  const [consents, texts, dsar] = await Promise.all([
    DB.fetchConsents(), DB.fetchConsentTexts(), DB.fetchDsarRequests(),
  ]);

  const state = (c) => c.withdrawn_at ? 'withdrawn'
    : new Date(c.expires_at) < new Date() ? 'expired' : 'active';

  const rows = consents.length ? consents.map((c) => `
    <tr>
      <td class="mono">${esc(String(c.subject_id).slice(0, 8))}…</td>
      <td>${esc(titleCase(c.purpose))}</td>
      <td>${c.special_personal_information
        ? '<span class="badge b-biometric">Special</span>' : '<span class="muted">Ordinary</span>'}</td>
      <td>${esc(titleCase(c.lawful_basis))}</td>
      <td>${esc(titleCase(c.method))}</td>
      <td>${esc(c.platform_id ?? '—')}</td>
      <td>${badge(state(c) === 'active' ? 'active' : state(c) === 'withdrawn' ? 'rejected' : 'expired')}</td>
      <td class="muted">${fmtDate(c.expires_at)}</td>
      <td>${state(c) === 'active'
        ? `<button class="btn btn-sm" data-withdraw="${esc(c.id)}">Withdraw</button>` : ''}</td>
    </tr>`).join('') : `<tr><td colspan="9">${emptyState('No consent records yet.')}</td></tr>`;

  const dsarRows = dsar.length ? dsar.map((d) => `
    <tr><td class="mono">${esc(d.id)}</td><td>${esc(titleCase(d.request_type))}</td>
      <td class="muted">${esc(d.requester_email ?? '—')}</td><td>${badge(d.status)}</td>
      <td class="muted">${fmtDate(d.due_at)}</td><td class="muted">${esc(d.outcome_note ?? '—')}</td></tr>`).join('')
    : `<tr><td colspan="6">${emptyState('No data subject requests.')}</td></tr>`;

  return `
  <div class="note note-info">
    <b>Consent is a precondition the database enforces, not a checkbox recorded alongside the work.</b>
    Triggers on <span class="mono">credit_checks</span> and <span class="mono">biometric_templates</span> reject the
    write outright when no live consent covers it — so "we processed biometrics without consent" is not a bug a
    careless function can introduce. Biometric consent is marked special personal information automatically under
    POPIA s26, and s27 will not accept legitimate interest as its basis.
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Consent register</div>
      <div class="card-sub">${consents.length} records · withdrawing biometric consent deactivates the templates it authorised</div></div></div>
    <table><thead><tr><th>Subject</th><th>Purpose</th><th>Class</th><th>Lawful basis</th><th>Captured by</th>
      <th>Platform</th><th>State</th><th>Expires</th><th></th></tr></thead><tbody>${rows}</tbody></table>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Consent wording in force</div>
      <div class="card-sub">A consent record that cannot produce the words it was given under proves nothing</div></div></div>
    <div class="card-body">
      ${texts.map((t) => `<div style="margin-bottom:13px">
        <div style="font-size:11px;font-weight:700;color:var(--brand)">${esc(titleCase(t.purpose))} · v${t.version}</div>
        <div style="font-size:11.5px;color:var(--ink3);line-height:1.6;margin-top:3px">${esc(t.body)}</div>
      </div>`).join('') || emptyState('No consent wording loaded.')}
    </div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Data subject requests</div>
      <div class="card-sub">POPIA s23/s24 · access, correction, deletion, objection, portability</div></div></div>
    <table><thead><tr><th>Reference</th><th>Type</th><th>Requester</th><th>Status</th><th>Due</th><th>Note</th></tr></thead>
    <tbody>${dsarRows}</tbody></table>
  </div>`;
};

WIRE.consent = () => {
  document.querySelectorAll('[data-withdraw]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.withdraw;
    openModal('Withdraw consent', `
      <div class="note note-warn">Withdrawing biometric consent also deactivates every template it authorised.
      That is the point: a right to withdraw that leaves the processing running is not a right.</div>
      <div style="height:12px"></div>
      <div class="field"><label for="wdReason">Reason</label>
        <textarea id="wdReason" placeholder="Subject requested withdrawal by email, 4 September"></textarea></div>`,
      `<button class="btn" onclick="closeModal()">Cancel</button>
       <button class="btn btn-danger btn-sm" id="wdConfirm">Withdraw consent</button>`);

    document.getElementById('wdConfirm').addEventListener('click', async () => {
      try {
        const r = await DB.withdrawConsent(id, document.getElementById('wdReason').value.trim() || undefined);
        toast(r.templatesDeactivated
          ? `Consent withdrawn · ${r.templatesDeactivated} template(s) deactivated`
          : 'Consent withdrawn', 'ok');
        closeModal();
        go('consent');
      } catch (e) { toast(e.message, 'err'); }
    });
  }));
};

RENDER.watchlist = async () => {
  const [entries, hits] = await Promise.all([DB.fetchWatchlist(), DB.fetchWatchlistHits()]);

  const hitRows = hits.length ? hits.map((h) => `
    <tr class="clickable" data-case="${esc(h.case_id)}">
      <td class="mono">${esc(h.case_id)}</td>
      <td class="mono">${Number(h.match_score).toFixed(1)}</td>
      <td>${badge(h.status === 'confirmed' ? 'rejected' : h.status === 'false_positive' ? 'passed' : 'pending')}</td>
      <td class="muted">${esc(h.review_note ?? '—')}</td>
      <td class="muted">${fmtDateTime(h.created_at)}</td>
    </tr>`).join('') : `<tr><td colspan="5">${emptyState('No watchlist hits.')}</td></tr>`;

  return `
  <div class="note note-warn">
    <b>A watchlist hit is never an automatic rejection.</b> Name collisions with sanctioned or politically exposed
    people are common, especially across transliterations. A hit sends the case to a compliance officer and records
    the match score; the decision is theirs, and it is recorded as theirs.
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Screening hits</div>
      <div class="card-sub">Click a row to open the case behind it</div></div></div>
    <table><thead><tr><th>Case</th><th>Match score</th><th>Adjudication</th><th>Note</th><th>Screened</th></tr></thead>
    <tbody>${hitRows}</tbody></table>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Lists in force</div>
      <div class="card-sub">${entries.length} active entries · matched on a normalised, order-insensitive form including aliases</div></div></div>
    <table><thead><tr><th>Name</th><th>List</th><th>Type</th><th>Country</th><th>Aliases</th></tr></thead><tbody>
      ${entries.map((e) => `<tr>
        <td><b>${esc(e.full_name)}</b></td><td>${esc(e.list_name)}</td>
        <td>${chip(e.entry_type === 'sanction' ? 'rejected'
            : e.entry_type === 'pep' ? 'review' : 'none', e.entry_type)}</td>
        <td class="mono">${esc(e.country ?? '—')}</td>
        <td class="muted">${esc((e.aliases ?? []).join(', ') || '—')}</td></tr>`).join('')
        || `<tr><td colspan="5">${emptyState('No watchlist entries loaded.')}</td></tr>`}
    </tbody></table>
  </div>`;
};

WIRE.watchlist = () => wireCaseRows();

RENDER.platforms = async () => {
  const [platforms, keys, requests, requirements] = await Promise.all([
    DB.fetchPlatforms(), DB.fetchApiKeys(), DB.fetchApiRequests(60), DB.fetchRequirements(),
  ]);

  const platformRows = platforms.map((p) => `
    <tr>
      <td><b>${esc(p.name)}</b><div class="mono muted" style="font-size:10.5px">${esc(p.id)}</div></td>
      <td>${chip(p.environment === 'production' ? 'verified' : 'pending', p.environment)}</td>
      <td>${badge(p.status)}</td>
      <td>${(p.allowed_domains ?? []).map((d) => `<span class="badge b-${esc(d)}">${esc(titleCase(d))}</span>`).join(' ')}</td>
      <td class="muted">${esc(p.responsible_party ?? '—')}</td>
    </tr>`).join('');

  const keyRows = keys.length ? keys.map((k) => `
    <tr>
      <td><b>${esc(k.name)}</b></td>
      <td>${esc(k.platform_id)}</td>
      <td class="mono">${esc(k.key_prefix)}…${esc(k.key_last4)}</td>
      <td>${(k.scopes ?? []).map((s) => `<span class="badge b-${esc(s)}">${esc(titleCase(s))}</span>`).join(' ')}</td>
      <td>${k.revoked_at ? badge('rejected') : badge('active')}</td>
      <td class="muted">${k.last_used_at ? fmtDateTime(k.last_used_at) : 'Never'}</td>
      <td>${k.revoked_at ? '' : `<button class="btn btn-sm" data-revoke="${esc(k.id)}">Revoke</button>`}</td>
    </tr>`).join('') : `<tr><td colspan="7">${emptyState('No API keys issued.')}</td></tr>`;

  const reqByLevel = {};
  requirements.forEach((r) => { (reqByLevel[r.level] ??= []).push(r); });

  return `
  <div class="card" style="margin-top:0">
    <div class="card-hdr"><div><div class="card-title">Calling platforms</div>
      <div class="card-sub">Every case is attributed to one, so usage and POPIA accountability resolve to a named party</div></div></div>
    <table><thead><tr><th>Platform</th><th>Environment</th><th>Status</th><th>Entitled to</th><th>Responsible party</th></tr></thead>
    <tbody>${platformRows}</tbody></table>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">API keys</div>
      <div class="card-sub">Only the SHA-256 digest is stored — a key is shown once, at issue, and never again</div></div>
      <div class="card-actions"><button class="btn btn-primary btn-sm" id="newKeyBtn">
        <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 4v12M4 10h12" stroke-linecap="round"/></svg>
        Issue key</button></div></div>
    <table><thead><tr><th>Name</th><th>Platform</th><th>Key</th><th>Scopes</th><th>State</th><th>Last used</th><th></th></tr></thead>
    <tbody>${keyRows}</tbody></table>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">What each assurance level requires</div>
      <div class="card-sub">Held as data, so the definition of "standard" is a row set an auditor can read</div></div></div>
    <div class="card-body g3">
      ${['basic', 'standard', 'enhanced'].map((lvl) => `
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--brand);text-transform:uppercase;letter-spacing:.5px">${lvl}</div>
          <div style="margin-top:7px;display:flex;flex-direction:column;gap:5px">
            ${(reqByLevel[lvl] ?? []).map((r) => `<div style="display:flex;align-items:center;gap:7px;font-size:11.5px">
              <span class="badge b-${esc(r.domain)}">${esc(titleCase(r.domain))}</span>
              <span>${esc(titleCase(r.check_type))}</span>
              <span class="mono muted" style="margin-left:auto">×${r.weight}${r.required ? '' : ' opt'}</span>
            </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Calling the hub</div>
      <div class="card-sub">What BipraPay, xPayments and veriBills send</div></div></div>
    <div class="card-body">
      <div class="code"><span class="c"># Idempotent: a retry returns the first result rather than re-running checks</span>
POST /functions/v1/platform-verify
<span class="k">x-api-key</span>: xc_live_…
<span class="k">x-idempotency-key</span>: <span class="s">"onboard-MRC-APP-0022"</span>

{
  <span class="k">"idNumber"</span>: <span class="s">"9001015009086"</span>,
  <span class="k">"firstNames"</span>: <span class="s">"Thabo"</span>, <span class="k">"surname"</span>: <span class="s">"Mokoena"</span>,
  <span class="k">"level"</span>: <span class="s">"standard"</span>,
  <span class="k">"purpose"</span>: <span class="s">"onboarding"</span>,
  <span class="k">"clientReference"</span>: <span class="s">"MRC-APP-0022"</span>,
  <span class="k">"consent"</span>: { <span class="k">"granted"</span>: true, <span class="k">"textId"</span>: <span class="s">"ct_identity_v1"</span>, <span class="k">"method"</span>: <span class="s">"click_wrap"</span> }
}</div>
      <div class="note note-info">A case needing a person comes back as <span class="mono">review</span>, and the
      platform is notified by webhook when it is decided — it does not poll. The webhook is signed over the timestamp
      <i>and</i> the body, so a captured delivery cannot be replayed forever.</div>
    </div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Recent API calls</div>
      <div class="card-sub">Who asked about whom, when, and under which key</div></div></div>
    <table><thead><tr><th>Endpoint</th><th>Platform</th><th>Case</th><th>Status</th><th>Error</th><th>Latency</th><th>When</th></tr></thead>
    <tbody>${requests.length ? requests.map((r) => `<tr>
      <td class="mono">${esc(r.endpoint)}</td><td>${esc(r.platform_id ?? '—')}</td>
      <td class="mono muted">${esc(r.case_id ?? '—')}</td>
      <td><span class="badge ${r.status_code < 300 ? 'b-passed' : r.status_code < 500 ? 'b-review' : 'b-failed'}">${r.status_code}</span></td>
      <td class="muted">${esc(r.error_code ?? '—')}</td>
      <td class="mono muted">${r.latency_ms ? r.latency_ms + ' ms' : '—'}</td>
      <td class="muted">${fmtDateTime(r.created_at)}</td></tr>`).join('')
      : `<tr><td colspan="7">${emptyState('No API calls recorded.')}</td></tr>`}
    </tbody></table>
  </div>`;
};

WIRE.platforms = () => {
  document.getElementById('newKeyBtn')?.addEventListener('click', async () => {
    const platforms = await DB.fetchPlatforms();
    openModal('Issue an API key', `
      <div class="field"><label for="kPlatform">Platform</label>
        <select id="kPlatform">${platforms.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="kName">Key name</label>
        <input id="kName" placeholder="Production onboarding"></div>
      <div class="field"><label>Scopes</label>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:3px">
          ${['identity', 'document', 'credit', 'biometric'].map((s) => `
            <label style="display:flex;align-items:center;gap:5px;font-weight:500;font-size:12px">
              <input type="checkbox" value="${s}" class="kScope" ${s === 'identity' ? 'checked' : ''} style="width:auto;height:auto">
              ${titleCase(s)}</label>`).join('')}
        </div>
        <div class="hint">A key can never be broader than the platform it belongs to.</div></div>
      <div class="field"><label for="kEnv">Environment</label>
        <select id="kEnv"><option value="sandbox">Sandbox</option><option value="production">Production</option></select></div>`,
      `<button class="btn" onclick="closeModal()">Cancel</button>
       <button class="btn btn-primary btn-sm" id="kIssue">Issue key</button>`);

    document.getElementById('kIssue').addEventListener('click', async () => {
      const scopes = [...document.querySelectorAll('.kScope:checked')].map((c) => c.value);
      if (!scopes.length) { toast('Choose at least one scope', 'err'); return; }
      try {
        const r = await DB.issueApiKey({
          platformId: document.getElementById('kPlatform').value,
          name: document.getElementById('kName').value.trim() || 'Untitled key',
          scopes,
          environment: document.getElementById('kEnv').value,
        });
        openModal('Key issued — copy it now', `
          <div class="note note-warn"><b>This is the only time this key will ever be shown.</b>
          Only its SHA-256 digest is stored, so it cannot be retrieved again. Losing it means issuing a new one.</div>
          <div style="height:12px"></div>
          <div class="code" style="white-space:pre-wrap;word-break:break-all">${esc(r.apiKey)}</div>`,
          `<button class="btn btn-primary btn-sm" onclick="closeModal()">I have stored it</button>`);
      } catch (e) { toast(e.message, 'err'); }
    });
  });

  document.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await DB.revokeApiKey(b.dataset.revoke);
      toast('Key revoked', 'ok');
      go('platforms');
    } catch (e) { toast(e.message, 'err'); }
  }));
};

RENDER.audit = async () => {
  const log = await DB.fetchAuditLog(300);
  const rows = log.length ? log.map((a) => `
    <tr>
      <td class="muted">${fmtDateTime(a.created_at)}</td>
      <td class="mono">${esc(a.action)}</td>
      <td>${esc(titleCase(a.entity_type))}</td>
      <td class="mono muted">${esc(a.entity_id ?? '—')}</td>
      <td class="muted">${esc(a.actor_platform ?? (a.actor_id ? String(a.actor_id).slice(0, 8) + '…' : 'system'))}</td>
      <td class="mono muted" style="font-size:10.5px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        title="${esc(JSON.stringify(a.metadata))}">${esc(JSON.stringify(a.metadata))}</td>
    </tr>`).join('') : `<tr><td colspan="6">${emptyState('Audit log is empty.')}</td></tr>`;

  return `
  <div class="note note-info">
    <b>Append-only by construction.</b> <span class="mono">audit_log</span> has a select policy and no insert, update
    or delete policy for any client role — the application literally cannot rewrite it, only the edge functions can
    append. Document access is logged here too, with the reason the operator gave, so "who looked at this person's
    ID and why" is an answerable question.
  </div>
  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Audit trail</div>
      <div class="card-sub">Most recent ${log.length} entries</div></div></div>
    <table><thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Id</th><th>Actor</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>`;
};

RENDER.retention = async () => {
  const policies = await DB.fetchRetentionPolicies();
  const rows = policies.map((p) => `
    <tr>
      <td><b>${esc(p.description)}</b><div class="mono muted" style="font-size:10.5px">${esc(p.entity)}</div></td>
      <td class="mono">${p.retain_days} days</td>
      <td class="muted">${(p.retain_days / 365).toFixed(1)} years</td>
      <td class="muted">${esc(p.legal_basis)}</td>
    </tr>`).join('');

  return `
  <div class="note note-info">
    <b>A retention policy nobody executes is not a policy.</b> The <span class="mono">retention-purge</span> function
    runs on a schedule and actually deletes: document objects past retention are removed from storage and their paths
    blanked, biometric templates past retention or whose consent has lapsed are deactivated, verified cases past
    validity expire, and the subject's standing assurance drops with them. It supports a dry run, so the first
    execution against real data can be inspected before anything is destroyed.
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Retention schedule</div>
      <div class="card-sub">What is kept, for how long, and on what legal basis</div></div></div>
    <table><thead><tr><th>Data</th><th>Retained</th><th></th><th>Basis</th></tr></thead><tbody>${rows}</tbody></table>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">What is deliberately not kept</div></div></div>
    <div class="card-body" style="font-size:12px;line-height:1.7;color:var(--ink3)">
      <p><b style="color:var(--ink)">Identity numbers.</b> Only a peppered SHA-256 hash and the last four digits.
      The pepper is a function secret and is never in the database, so a dump of the tables does not yield the numbers —
      which matters, because a 13-digit ID number has a small enough keyspace that an unpeppered hash of it is
      reversible by brute force in minutes.</p>
      <p style="margin-top:9px"><b style="color:var(--ink)">Raw biometric samples.</b> No selfie, no fingerprint image.
      A sample exists for the lifetime of the request that templates it, and the retention schedule above lists it at
      one day only because a scheduled sweep is cheaper than trusting that nothing ever writes one.</p>
      <p style="margin-top:9px"><b style="color:var(--ink)">Card numbers, passwords, plaintext API keys.</b> None of
      these are the hub's business, and the two it does touch — API keys and webhook signatures — are held as digests.</p>
    </div>
  </div>`;
};


// ── Customers ───────────────────────────────────────────────────
RENDER.customers = async () => {
  const [customers, name] = await Promise.all([DB.fetchCustomers(), platformName()]);
  cache.customers = customers;

  const rows = customers.length ? customers.map((c) => `
    <tr class="clickable" data-customer="${esc(c.id)}">
      <td class="mono">${esc(c.customer_number ?? '—')}</td>
      <td>${esc(name(c.platform_id))}</td>
      <td>${badge(c.status)}</td>
      <td class="muted">${esc(c.email ?? '—')}</td>
      <td class="muted">${fmtDate(c.onboarded_at)}</td>
    </tr>`).join('') : `<tr><td colspan="5">${emptyState('No customers yet.')}</td></tr>`;

  return `
  <div class="note note-info">
    <b>A customer is a subject in an ongoing relationship with one platform.</b>
    The same verified person can be a customer of the dealership and the lender without either
    seeing the other's relationship — identity is shared, commercial history is not. Open a row for
    the full profile: bureau score, payment history, exposure, open fraud signals, and how much
    credit the assessment supports.
  </div>
  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Customers</div>
      <div class="card-sub">${customers.length} on the hub</div></div></div>
    <table><thead><tr><th>Customer no.</th><th>Platform</th><th>Status</th>
      <th>Email</th><th>Onboarded</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
};

WIRE.customers = () => {
  document.querySelectorAll('tr[data-customer]').forEach((r) =>
    r.addEventListener('click', () => openCustomer(r.dataset.customer)));
};

async function openCustomer(customerId) {
  openModal('Customer', loading(), '', true);
  try {
    const p = await DB.fetchCustomerProfile(customerId);
    const capacity = await DB.creditCapacity(customerId, { termMonths: 72, ratePct: 13.75 });

    const b = p.payment_behaviour ?? {};
    const bureau = p.credit?.bureau;
    const aff = p.credit?.affordability;
    const port = p.portfolio ?? {};

    const contracts = (port.contracts ?? []).length
      ? (port.contracts).map((ct) => `
        <tr>
          <td class="mono">${esc(ct.id)}</td>
          <td>${esc(titleCase(ct.agreement_type))}</td>
          <td>${ct.asset ? esc([ct.asset.make, ct.asset.model].filter(Boolean).join(' ')) : '<span class="muted">—</span>'}</td>
          <td class="mono">${fmtRand(ct.instalment_cents)}</td>
          <td class="mono">${fmtRand(ct.balance_cents)}</td>
          <td class="mono ${ct.arrears_cents > 0 ? 'arrears' : ''}">${fmtRand(ct.arrears_cents)}</td>
          <td>${badge(ct.status)}</td>
        </tr>`).join('')
      : `<tr><td colspan="7">${emptyState('No agreements.')}</td></tr>`;

    const signals = (p.fraud?.signals ?? []).length
      ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          ${p.fraud.signals.map((sig) => `
            <div style="display:flex;align-items:flex-start;gap:8px;font-size:11.5px">
              ${badge(sig.severity === 'critical' ? 'failed' : 'review')}
              <div><b>${esc(titleCase(sig.rule))}</b>
                <div class="mono muted" style="font-size:10.5px;margin-top:2px">${esc(JSON.stringify(sig.detail))}</div>
              </div>
            </div>`).join('')}
         </div>`
      : '<div class="muted" style="font-size:12px;margin-top:6px">No open signals.</div>';

    const capacityBlock = capacity?.decision === 'insufficient_data'
      ? `<div class="note note-warn"><b>Capacity cannot be assessed.</b><br>
           ${esc((capacity.reason_codes ?? []).map(titleCase).join(' · '))}
           ${capacity.remedy ? `<br>${esc(capacity.remedy)}` : ''}</div>`
      : `<div class="note ${capacity.decision === 'approve' ? 'note-info'
            : capacity.decision === 'decline' ? 'note-danger' : 'note-warn'}">
          <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
            <b style="font-size:13px">${esc(titleCase(capacity.decision))}</b>
            <span class="badge b-${capacity.risk_grade === 'A' || capacity.risk_grade === 'B' ? 'passed'
              : capacity.risk_grade === 'E' ? 'failed' : 'review'}">Grade ${esc(capacity.risk_grade)}</span>
          </div>
          <dl class="kv" style="margin-top:9px">
            <dt>Can afford per month</dt><dd class="mono"><b>${fmtRand(capacity.max_instalment_cents)}</b></dd>
            <dt>Supports a principal of</dt><dd class="mono"><b>${fmtRand(capacity.max_principal_cents)}</b></dd>
            <dt>Recommended limit</dt><dd class="mono"><b>${fmtRand(capacity.recommended_limit_cents)}</b></dd>
            <dt>At</dt><dd>${esc(capacity.assumed_rate_pct)}% over ${esc(capacity.assumed_term_months)} months</dd>
          </dl>
          ${(capacity.reason_codes ?? []).length
            ? `<div style="margin-top:8px;font-size:11px">${esc(capacity.reason_codes.map(titleCase).join(' · '))}</div>` : ''}
         </div>`;

    openModal(`${p.identity?.name || 'Customer'} · ${p.customer?.customer_number ?? ''}`, `
      <div class="g2" style="gap:14px">
        <div>
          <div class="card-title" style="margin-bottom:8px">Identity</div>
          <dl class="kv">
            <dt>Name</dt><dd>${esc(p.identity?.name ?? '—')}</dd>
            <dt>Identifier</dt><dd class="mono">${esc(titleCase(p.identity?.id_type))} ···· ${esc(p.identity?.id_last4 ?? '')}</dd>
            <dt>Date of birth</dt><dd>${fmtDate(p.identity?.date_of_birth)}</dd>
            <dt>Assurance</dt><dd>${badge(p.identity?.assurance_level)}</dd>
            <dt>Status</dt><dd>${badge(p.customer?.status)}</dd>
          </dl>
        </div>
        <div>
          <div class="card-title" style="margin-bottom:8px">Contact & work</div>
          <dl class="kv">
            <dt>Phone</dt><dd>${(p.contact?.phones ?? []).map((ph) =>
              `<div class="mono">${esc(ph.msisdn)} <span class="muted">${esc(ph.network ?? '')}</span>
               ${ph.days_since_sim_swap !== null && ph.days_since_sim_swap <= 30
                 ? '<span class="badge b-failed">SIM swap ' + esc(ph.days_since_sim_swap) + 'd ago</span>' : ''}</div>`
              ).join('') || '<span class="muted">—</span>'}</dd>
            <dt>Address</dt><dd>${(p.contact?.addresses ?? []).map((a) =>
              `<div>${esc([a.line1, a.suburb, a.city].filter(Boolean).join(', '))}
               ${a.shared_with >= 4 ? '<span class="badge b-review">shared with ' + esc(a.shared_with) + '</span>' : ''}</div>`
              ).join('') || '<span class="muted">—</span>'}</dd>
            <dt>Employer</dt><dd>${(p.employment ?? []).map((e) =>
              `<div>${esc(e.employer ?? '—')}
               ${e.cipc_status === 'not_found' ? '<span class="badge b-failed">not at CIPC</span>'
                 : e.cipc_status === 'in_business' ? '<span class="badge b-passed">registered</span>' : ''}</div>`
              ).join('') || '<span class="muted">—</span>'}</dd>
          </dl>
        </div>
      </div>

      <div style="height:16px"></div>
      <div class="card-title" style="margin-bottom:8px">How much credit can be given</div>
      ${capacityBlock}

      <div style="height:16px"></div>
      <div class="g3" style="gap:12px">
        <div class="stat ${bureau ? (bureau.risk === 'low' ? 'green' : bureau.risk === 'high' ? 'red' : 'amber') : ''}">
          <div class="stat-lbl">Bureau score</div>
          <div class="stat-val">${bureau?.score ?? '—'}</div>
          <div class="stat-meta">${bureau ? esc(bureau.band ?? '') + ' · ' + esc(bureau.bureau ?? '') : 'No bureau record'}</div>
        </div>
        <div class="stat ${b.score >= 70 ? 'green' : b.score >= 40 ? 'amber' : 'red'}">
          <div class="stat-lbl">Payment behaviour</div>
          <div class="stat-val">${b.score ?? '—'}</div>
          <div class="stat-meta">${b.has_history
            // On-time percentage alone cannot explain the score: a
            // customer who paid every instalment a fortnight late and
            // one who paid nothing are both 0% on time, and they do not
            // score the same. Say what actually happened.
            ? [
                `${esc(b.paid_on_time ?? 0)}/${esc(b.instalments_due ?? 0)} on time`,
                (b.paid_late ?? 0) ? `${esc(b.paid_late)} late` : '',
                (b.missed_or_short ?? 0) ? `${esc(b.missed_or_short)} missed` : '',
                (b.reversals ?? 0) ? `${esc(b.reversals)} reversed` : '',
              ].filter(Boolean).join(' · ')
            : 'No history on this platform'}</div>
        </div>
        <div class="stat ${(p.fraud?.highest_score ?? 0) >= 45 ? 'red' : (p.fraud?.highest_score ?? 0) > 0 ? 'amber' : 'green'}">
          <div class="stat-lbl">Fraud</div>
          <div class="stat-val">${p.fraud?.highest_score ?? 0}</div>
          <div class="stat-meta">${esc(p.fraud?.open_alerts ?? 0)} open alert(s)</div>
        </div>
      </div>

      ${aff ? `<div style="height:14px"></div>
      <dl class="kv">
        <dt>Net income</dt><dd class="mono">${fmtRand(aff.net_income_cents)}</dd>
        <dt>Discretionary income</dt><dd class="mono">${fmtRand(aff.discretionary_income_cents)}</dd>
        <dt>Income corroborated</dt><dd>${aff.income_verified ? badge('passed') : badge('review')}</dd>
        <dt>Affordability</dt><dd>${badge(aff.outcome)}</dd>
      </dl>` : ''}

      <div style="height:16px"></div>
      <div class="card-title" style="margin-bottom:8px">Agreements</div>
      <div style="overflow-x:auto">
      <table><thead><tr><th>Contract</th><th>Type</th><th>Asset</th><th>Instalment</th>
        <th>Balance</th><th>Arrears</th><th>Status</th></tr></thead><tbody>${contracts}</tbody></table>
      </div>
      <dl class="kv" style="margin-top:10px">
        <dt>Total exposure</dt><dd class="mono"><b>${fmtRand(port.total_exposure_cents)}</b></dd>
        <dt>Monthly commitment</dt><dd class="mono">${fmtRand(port.monthly_commitment_cents)}</dd>
        <dt>Total arrears</dt><dd class="mono">${fmtRand(port.total_arrears_cents)}</dd>
      </dl>

      <div style="height:16px"></div>
      <div class="card-title">Fraud signals</div>
      ${signals}`,
      `<button class="btn" onclick="closeModal()">Close</button>
       <button class="btn btn-primary btn-sm" id="rescreenBtn">Re-screen for fraud</button>`,
      true);

    document.getElementById('rescreenBtn')?.addEventListener('click', async () => {
      try {
        const r = await DB.screenForFraud({ customerId });
        toast(`Screen complete — ${r.signals} signal(s), ${r.critical} critical`,
          r.critical > 0 ? 'err' : 'ok');
        openCustomer(customerId);
      } catch (e) { toast(e.message, 'err'); }
    });
  } catch (e) {
    openModal('Customer', errorState(e));
  }
}

// ── Portfolio ───────────────────────────────────────────────────
RENDER.portfolio = async () => {
  const [contracts, assets, customers, name] = await Promise.all([
    DB.fetchContracts(), DB.fetchAssets(), DB.fetchCustomers(), platformName(),
  ]);
  const custById = new Map(customers.map((c) => [c.id, c]));

  const advanced = contracts.reduce((a, c) => a + Number(c.principal_cents ?? 0), 0);
  const outstanding = contracts.filter((c) => ['active','in_arrears','defaulted','legal'].includes(c.status))
    .reduce((a, c) => a + Number(c.balance_cents ?? 0), 0);
  const monthly = contracts.filter((c) => ['active','in_arrears'].includes(c.status))
    .reduce((a, c) => a + Number(c.instalment_cents ?? 0), 0);

  const rows = contracts.length ? contracts.map((c) => `
    <tr class="clickable" data-contract="${esc(c.id)}">
      <td class="mono">${esc(c.id)}</td>
      <td>${esc(custById.get(c.customer_id)?.customer_number ?? '—')}</td>
      <td>${esc(name(c.platform_id))}</td>
      <td>${esc(titleCase(c.agreement_type))}</td>
      <td class="mono">${fmtRand(c.principal_cents)}</td>
      <td class="mono">${fmtRand(c.instalment_cents)}</td>
      <td class="mono">${esc(c.interest_rate_pct)}% / ${esc(c.term_months)}m</td>
      <td class="mono">${fmtRand(c.balance_cents)}</td>
      <td>${badge(c.status)}</td>
    </tr>`).join('') : `<tr><td colspan="9">${emptyState('No agreements yet.')}</td></tr>`;

  const assetRows = assets.length ? assets.map((a) => `
    <tr>
      <td><b>${esc([a.make, a.model].filter(Boolean).join(' '))}</b>
        <div class="muted" style="font-size:10.5px">${esc(a.variant ?? '')} ${a.year ? esc(a.year) : ''}</div></td>
      <td>${chip(a.asset_type.startsWith('vehicle') ? 'identity' : 'document', a.asset_type)}</td>
      <td class="mono muted">${esc(a.vin ?? a.imei ?? a.serial_number ?? '—')}</td>
      <td class="mono muted">${esc(a.registration_number ?? '—')}</td>
      <td class="mono">${fmtRand(a.retail_value_cents)}</td>
      <td>${badge(a.status)}</td>
      <td>${a.registry_status
        ? `<span class="badge b-${a.registry_status === 'clear' ? 'passed' : 'failed'}">${esc(titleCase(a.registry_status))}</span>`
        : '<span class="muted">not checked</span>'}</td>
    </tr>`).join('') : `<tr><td colspan="7">${emptyState('No assets on file.')}</td></tr>`;

  return `
  <div class="g4">
    <div class="stat blue"><div class="stat-lbl">Agreements</div><div class="stat-val">${contracts.length}</div>
      <div class="stat-meta">${contracts.filter((c)=>c.status==='active').length} active</div></div>
    <div class="stat purple"><div class="stat-lbl">Advanced</div>
      <div class="stat-val" style="font-size:19px">${fmtRand(advanced)}</div>
      <div class="stat-meta">Total principal written</div></div>
    <div class="stat amber"><div class="stat-lbl">Outstanding</div>
      <div class="stat-val" style="font-size:19px">${fmtRand(outstanding)}</div>
      <div class="stat-meta">Book still at risk</div></div>
    <div class="stat green"><div class="stat-lbl">Monthly instalments</div>
      <div class="stat-val" style="font-size:19px">${fmtRand(monthly)}</div>
      <div class="stat-meta">Expected each month</div></div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Agreements</div>
      <div class="card-sub">Click a row for the instalment schedule</div></div></div>
    <div style="overflow-x:auto">
    <table><thead><tr><th>Contract</th><th>Customer</th><th>Platform</th><th>Type</th>
      <th>Principal</th><th>Instalment</th><th>Rate / term</th><th>Balance</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Assets</div>
      <div class="card-sub">A VIN or IMEI names one physical unit, so the database refuses to let two live agreements share one</div></div></div>
    <div style="overflow-x:auto">
    <table><thead><tr><th>Asset</th><th>Type</th><th>VIN / IMEI</th><th>Registration</th>
      <th>Value</th><th>Status</th><th>Registry</th></tr></thead><tbody>${assetRows}</tbody></table></div>
  </div>`;
};

WIRE.portfolio = () => {
  document.querySelectorAll('tr[data-contract]').forEach((r) =>
    r.addEventListener('click', () => openContract(r.dataset.contract)));
};

async function openContract(contractId) {
  openModal(contractId, loading());
  try {
    const [schedule, payments, contracts] = await Promise.all([
      DB.fetchSchedule(contractId),
      DB.fetchPayments({ contractId }),
      DB.fetchContracts(),
    ]);
    const c = contracts.find((x) => x.id === contractId);
    const version = Math.max(...schedule.map((s) => s.version ?? 1), 1);
    const live = schedule.filter((s) => (s.version ?? 1) === version);

    const rows = live.map((s) => `
      <tr>
        <td class="mono">${s.instalment_no}</td>
        <td class="muted">${fmtDate(s.due_date)}</td>
        <td class="mono">${fmtRand(s.amount_due_cents)}</td>
        <td class="mono">${fmtRand(s.amount_paid_cents)}</td>
        <td>${chip(s.status === 'paid' ? 'passed' : s.status === 'missed' ? 'failed'
              : s.status === 'partial' ? 'review' : 'pending', s.status)}</td>
        <td class="muted">${fmtDate(s.paid_on)}</td>
      </tr>`).join('');

    const payRows = payments.length ? payments.map((p) => `
      <tr>
        <td class="muted">${fmtDateTime(p.paid_at)}</td>
        <td class="mono">${fmtRand(p.amount_cents)}</td>
        <td>${esc(titleCase(p.method))}</td>
        <td class="mono muted">${esc(p.external_reference ?? '—')}</td>
        <td>${p.status === 'reversed'
          ? `<span class="badge b-failed">Reversed</span>` : badge(p.status)}</td>
        <td class="muted">${esc(p.reversal_reason ?? '')}</td>
      </tr>`).join('') : `<tr><td colspan="6">${emptyState('No payments recorded.')}</td></tr>`;

    openModal(`${contractId} · ${titleCase(c?.status ?? '')}`, `
      <dl class="kv">
        <dt>Type</dt><dd>${esc(titleCase(c?.agreement_type))}</dd>
        <dt>Principal</dt><dd class="mono">${fmtRand(c?.principal_cents)}</dd>
        <dt>Instalment</dt><dd class="mono"><b>${fmtRand(c?.instalment_cents)}</b></dd>
        <dt>Rate / term</dt><dd>${esc(c?.interest_rate_pct)}% over ${esc(c?.term_months)} months</dd>
        <dt>Total repayable</dt><dd class="mono">${fmtRand(c?.total_repayable_cents)}</dd>
        <dt>Balance</dt><dd class="mono">${fmtRand(c?.balance_cents)}</dd>
        <dt>Arrears</dt><dd class="mono">${fmtRand(c?.arrears_cents)}
          ${c?.months_in_arrears ? `<span class="badge b-failed">${esc(c.months_in_arrears)} months</span>` : ''}</dd>
        <dt>Collection</dt><dd>${esc(titleCase(c?.collection_method ?? '—'))}</dd>
      </dl>

      <div style="height:16px"></div>
      <div class="card-title" style="margin-bottom:8px">Payments received</div>
      <div style="overflow-x:auto">
      <table><thead><tr><th>When</th><th>Amount</th><th>Method</th><th>Reference</th>
        <th>Status</th><th>Note</th></tr></thead><tbody>${payRows}</tbody></table></div>

      <div style="height:16px"></div>
      <div class="card-title" style="margin-bottom:8px">Instalment schedule</div>
      <div style="max-height:300px;overflow:auto">
      <table><thead><tr><th>#</th><th>Due</th><th>Amount</th><th>Paid</th>
        <th>Status</th><th>Settled</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      `<button class="btn" onclick="closeModal()">Close</button>`, true);
  } catch (e) {
    openModal(contractId, errorState(e));
  }
}

// ── Payments ────────────────────────────────────────────────────
RENDER.payments = async () => {
  const [payments, arrears, customers, name] = await Promise.all([
    DB.fetchPayments({ limit: 150 }), DB.fetchArrearsBook(), DB.fetchCustomers(), platformName(),
  ]);
  const custById = new Map(customers.map((c) => [c.id, c]));

  const received = payments.filter((p) => p.status === 'received');
  const reversed = payments.filter((p) => p.status === 'reversed');
  const collected = received.reduce((a, p) => a + Number(p.amount_cents ?? 0), 0);
  const totalArrears = arrears.reduce((a, c) => a + Number(c.arrears_cents ?? 0), 0);

  const arrearsRows = arrears.length ? arrears.map((c) => `
    <tr class="clickable" data-contract="${esc(c.id)}">
      <td class="mono">${esc(c.id)}</td>
      <td>${esc(custById.get(c.customer_id)?.customer_number ?? '—')}</td>
      <td>${esc(name(c.platform_id))}</td>
      <td class="mono arrears"><b>${fmtRand(c.arrears_cents)}</b></td>
      <td><span class="badge b-${c.months_in_arrears >= 3 ? 'failed' : 'review'}">${esc(c.months_in_arrears)} months</span></td>
      <td class="mono">${fmtRand(c.instalment_cents)}</td>
      <td class="muted">${fmtDate(c.last_payment_date)}</td>
      <td>${badge(c.status)}</td>
    </tr>`).join('') : `<tr><td colspan="8">${emptyState('Nothing in arrears.')}</td></tr>`;

  const payRows = payments.length ? payments.map((p) => `
    <tr>
      <td class="muted">${fmtDateTime(p.paid_at)}</td>
      <td>${esc(custById.get(p.customer_id)?.customer_number ?? '—')}</td>
      <td class="mono muted">${esc(p.contract_id)}</td>
      <td class="mono">${fmtRand(p.amount_cents)}</td>
      <td>${esc(titleCase(p.method))}</td>
      <td>${esc(p.source_platform ? name(p.source_platform) : '—')}</td>
      <td>${p.status === 'reversed' ? '<span class="badge b-failed">Reversed</span>' : badge(p.status)}</td>
    </tr>`).join('') : `<tr><td colspan="7">${emptyState('No payments recorded.')}</td></tr>`;

  return `
  <div class="note note-info">
    <b>xCentral does not collect money — it checks it arrived.</b> BipraPay and xPayments take the
    payment and post it here; this platform compares what was due with what came in. A debit order
    that presents and bounces is recorded as a reversal rather than as a payment that never happened,
    because the money not being there on the day is the signal that matters.
  </div>

  <div class="g4">
    <div class="stat green"><div class="stat-lbl">Collected</div>
      <div class="stat-val" style="font-size:19px">${fmtRand(collected)}</div>
      <div class="stat-meta">${received.length} payment(s) received</div></div>
    <div class="stat red"><div class="stat-lbl">Total arrears</div>
      <div class="stat-val" style="font-size:19px">${fmtRand(totalArrears)}</div>
      <div class="stat-meta">Across ${arrears.length} agreement(s)</div></div>
    <div class="stat amber"><div class="stat-lbl">Reversals</div><div class="stat-val">${reversed.length}</div>
      <div class="stat-meta">Presented and bounced</div></div>
    <div class="stat purple"><div class="stat-lbl">Worst arrears</div>
      <div class="stat-val">${arrears.length ? arrears[0].months_in_arrears : 0}</div>
      <div class="stat-meta">Months behind</div></div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Arrears book</div>
      <div class="card-sub">Worst first · click for the schedule and payment history</div></div></div>
    <div style="overflow-x:auto">
    <table><thead><tr><th>Contract</th><th>Customer</th><th>Platform</th><th>Arrears</th>
      <th>Behind</th><th>Instalment</th><th>Last paid</th><th>Status</th></tr></thead>
    <tbody>${arrearsRows}</tbody></table></div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Recent payments</div>
      <div class="card-sub">As posted by the collecting platform</div></div></div>
    <div style="overflow-x:auto">
    <table><thead><tr><th>When</th><th>Customer</th><th>Contract</th><th>Amount</th>
      <th>Method</th><th>Collected by</th><th>Status</th></tr></thead><tbody>${payRows}</tbody></table></div>
  </div>`;
};

WIRE.payments = () => {
  document.querySelectorAll('tr[data-contract]').forEach((r) =>
    r.addEventListener('click', () => openContract(r.dataset.contract)));
};

// ── Fraud ───────────────────────────────────────────────────────
RENDER.fraud = async () => {
  const [alerts, signals, rules, customers] = await Promise.all([
    DB.fetchFraudAlerts(), DB.fetchFraudSignals(), DB.fetchFraudRules(), DB.fetchCustomers(),
  ]);
  const custById = new Map(customers.map((c) => [c.id, c]));

  const open = alerts.filter((a) => ['open','investigating'].includes(a.status));
  const critical = alerts.filter((a) => a.severity === 'critical' && a.status === 'open');
  const confirmed = alerts.filter((a) => a.status === 'confirmed_fraud');

  const alertRows = alerts.length ? alerts.map((a) => `
    <tr class="clickable" data-alert="${esc(a.id)}">
      <td>${chip(a.severity === 'critical' || a.severity === 'high' ? 'failed'
            : a.severity === 'medium' ? 'review' : 'passed', a.severity)}</td>
      <td class="mono">${a.score}</td>
      <td>${esc(custById.get(a.customer_id)?.customer_number ?? a.case_id ?? '—')}</td>
      <td class="mono">${a.signal_count} <span class="muted">(${a.critical_count} critical)</span></td>
      <td>${chip(a.status === 'confirmed_fraud' ? 'failed'
            : a.status === 'false_positive' ? 'passed' : 'review', a.status)}</td>
      <td class="muted">${fmtDateTime(a.created_at)}</td>
    </tr>`).join('') : `<tr><td colspan="6">${emptyState('No alerts raised.')}</td></tr>`;

  const byRule = {};
  signals.forEach((s) => { byRule[s.rule_code] = (byRule[s.rule_code] ?? 0) + 1; });
  const ruleRows = rules.map((r) => `
    <tr>
      <td><b>${esc(r.name)}</b>
        <div class="muted" style="font-size:10.5px;max-width:520px">${esc(r.description)}</div></td>
      <td>${chip(r.domain === 'document' ? 'document' : r.domain === 'identity' ? 'identity'
            : r.domain === 'employment' || r.domain === 'banking' ? 'credit' : 'biometric',
            r.domain)}</td>
      <td>${chip(r.severity === 'critical' ? 'failed' : r.severity === 'warn' ? 'review' : 'passed',
            r.severity)}</td>
      <td class="mono">${esc(r.weight)}</td>
      <td class="mono">${byRule[r.code] ?? 0}</td>
    </tr>`).join('');

  return `
  <div class="note note-danger">
    <b>Most application fraud is not clever.</b> It is the same document submitted under two names,
    one address serving nine unrelated applicants, a payslip whose gross minus deductions does not
    equal its net, a SIM swapped four days before the application, a car financed twice. None of
    that needs a model to catch — it needs the data joined up and the arithmetic actually done.
    Every rule below is a query over data the hub already holds, and every signal carries the
    evidence a person can check.
  </div>

  <div class="g4">
    <div class="stat red"><div class="stat-lbl">Open alerts</div><div class="stat-val">${open.length}</div>
      <div class="stat-meta">${critical.length} critical</div></div>
    <div class="stat amber"><div class="stat-lbl">Live signals</div><div class="stat-val">${signals.length}</div>
      <div class="stat-meta">Undismissed</div></div>
    <div class="stat purple"><div class="stat-lbl">Rules active</div><div class="stat-val">${rules.length}</div>
      <div class="stat-meta">Held as data, tuned by update</div></div>
    <div class="stat green"><div class="stat-lbl">Confirmed</div><div class="stat-val">${confirmed.length}</div>
      <div class="stat-meta">Written to the register</div></div>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Alert queue</div>
      <div class="card-sub">Click an alert to see the signals behind it</div></div></div>
    <table><thead><tr><th>Severity</th><th>Score</th><th>Subject</th><th>Signals</th>
      <th>Status</th><th>Raised</th></tr></thead><tbody>${alertRows}</tbody></table>
  </div>

  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Detection rules</div>
      <div class="card-sub">Thresholds and weights are rows, so tuning is an update and past decisions stay explicable</div></div></div>
    <div style="overflow-x:auto">
    <table><thead><tr><th>Rule</th><th>Domain</th><th>Severity</th><th>Weight</th><th>Fired</th></tr></thead>
    <tbody>${ruleRows}</tbody></table></div>
  </div>`;
};

WIRE.fraud = () => {
  document.querySelectorAll('tr[data-alert]').forEach((r) =>
    r.addEventListener('click', () => openAlert(r.dataset.alert)));
};

async function openAlert(alertId) {
  openModal('Fraud alert', loading());
  try {
    const [alerts, customers] = await Promise.all([DB.fetchFraudAlerts(), DB.fetchCustomers()]);
    const a = alerts.find((x) => x.id === alertId);
    if (!a) { openModal('Fraud alert', errorState(new Error('Alert not found'))); return; }

    const signals = await DB.fetchFraudSignals(
      a.customer_id ? { customerId: a.customer_id } : { caseId: a.case_id });
    const cust = customers.find((c) => c.id === a.customer_id);

    const list = signals.length ? signals.map((s) => `
      <div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${badge(s.severity === 'critical' ? 'failed' : s.severity === 'warn' ? 'review' : 'passed')}
          <b style="font-size:12.5px">${esc(titleCase(s.rule_code))}</b>
          <span class="mono muted" style="margin-left:auto">weight ${esc(s.weight)}</span>
        </div>
        <div class="mono" style="font-size:10.5px;color:var(--ink3);margin-top:5px;word-break:break-all">
          ${esc(JSON.stringify(s.detail))}</div>
        <button class="btn btn-sm" style="margin-top:7px" data-dismiss="${esc(s.id)}">Dismiss this signal</button>
      </div>`).join('') : emptyState('No live signals on this alert.');

    const resolved = ['confirmed_fraud','false_positive','closed'].includes(a.status);

    openModal(`Alert · ${titleCase(a.severity)} · score ${a.score}`, `
      <dl class="kv">
        <dt>Customer</dt><dd>${esc(cust?.customer_number ?? '—')}</dd>
        <dt>Case</dt><dd class="mono">${esc(a.case_id ?? '—')}</dd>
        <dt>Signals</dt><dd>${a.signal_count} (${a.critical_count} critical)</dd>
        <dt>Status</dt><dd>${badge(a.status === 'confirmed_fraud' ? 'failed'
          : a.status === 'false_positive' ? 'passed' : 'review')}</dd>
        ${a.resolution_note ? `<dt>Resolution</dt><dd>${esc(a.resolution_note)}</dd>` : ''}
      </dl>
      <div class="note note-warn" style="margin-top:12px">
        Confirming fraud writes this person's identifiers — identity hash, phone, bank account — to
        the register, so the same entity is caught on sight next time rather than re-investigated
        from scratch. It also suspends the customer.
      </div>
      <div style="height:14px"></div>
      <div class="card-title" style="margin-bottom:4px">Signals</div>
      ${list}`,
      resolved
        ? `<button class="btn" onclick="closeModal()">Close</button>`
        : `<button class="btn" onclick="closeModal()">Close</button>
           <button class="btn btn-sm" id="falsePositiveBtn">False positive</button>
           <button class="btn btn-danger btn-sm" id="confirmFraudBtn">Confirm fraud</button>`);

    document.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', async () => {
      const reason = prompt('Why is this signal not a concern?');
      if (!reason) return;
      try {
        await DB.dismissFraudSignal(b.dataset.dismiss, reason);
        toast('Signal dismissed', 'ok');
        openAlert(alertId);
      } catch (e) { toast(e.message, 'err'); }
    }));

    const resolve = async (outcome, label) => {
      const note = prompt(`${label} — what did you find?`);
      if (note === null) return;
      try {
        const r = await DB.resolveFraudAlert(alertId, outcome, note);
        toast(outcome === 'confirmed_fraud'
          ? `Confirmed · ${r.registerEntries} identifier(s) added to the register`
          : 'Marked as a false positive', 'ok');
        closeModal();
        go('fraud');
      } catch (e) { toast(e.message, 'err'); }
    };

    document.getElementById('confirmFraudBtn')?.addEventListener('click',
      () => resolve('confirmed_fraud', 'Confirm fraud'));
    document.getElementById('falsePositiveBtn')?.addEventListener('click',
      () => resolve('false_positive', 'False positive'));
  } catch (e) {
    openModal('Fraud alert', errorState(e));
  }
}

// ── Boot ────────────────────────────────────────────────────────
async function boot() {
  DB = window.XC_DB;

  const badgeEl = document.getElementById('envBadge');
  // Which source is behind the console, stated rather than assumed.
  // 'Local data' means the records ship with the bundle; the other two
  // mean a Supabase project is answering.
  const ENV_LABEL = { production: 'Production', sandbox: 'Sandbox', local: 'Local data' };
  badgeEl.textContent = ENV_LABEL[DB.env] ?? 'Local data';
  badgeEl.className = `env-badge env-${DB.env}`;

  // Connection state is no longer surfaced in the header. It still
  // reaches the user where it matters: an unconfigured project gets the
  // explanatory panel in go(), and a failed call raises a toast.
  if (DB.configured) {
    try {
      const profile = await DB.getProfile();
      document.getElementById('userLabel').textContent =
        profile?.name ?? profile?.email ?? 'Sign in';
    } catch {
      document.getElementById('userLabel').textContent = 'Sign in';
    }
  }

  document.getElementById('userBtn').addEventListener('click', signInFlow);
  document.getElementById('globalSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim();
    if (/^VC-\d{4}-\d+$/i.test(q)) openCase(q.toUpperCase());
    else if (q) { go('cases'); toast('Filter the case list using the tabs above'); }
  });

  renderNav();
  go('dashboard');
}

function signInFlow() {
  openModal('Sign in', `
    <div class="field"><label for="siEmail">Email</label><input id="siEmail" type="email" autocomplete="username"></div>
    <div class="field"><label for="siPass">Password</label><input id="siPass" type="password" autocomplete="current-password"></div>
    <div class="note note-info">Your role decides what you can do here. Permissions are checked by the same
    <span class="mono">has_permission()</span> function the row level security policies use, so this console and the
    database can never disagree about what you are allowed to do.</div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary btn-sm" id="siGo">Sign in</button>`);

  document.getElementById('siGo').addEventListener('click', async () => {
    try {
      await DB.signIn(document.getElementById('siEmail').value.trim(), document.getElementById('siPass').value);
      closeModal();
      toast('Signed in', 'ok');
      boot();
    } catch (e) { toast(e.message, 'err'); }
  });
}

if (window.XC_DB) boot();
else window.addEventListener('xc-db-ready', boot, { once: true });

// ══════════════════════════════════════════════════════════════
// Live capture and onboarding.
//
// The wizard drives the camera through src/capture.js and sends each
// capture to the hub. Two things it deliberately does NOT do:
//
//   It does not decide. The agents recommend; a person applies it.
//   It does not hide a poor capture behind a match score. Quality is
//   shown live, assessed before anything is sent, and a failed capture
//   is refused with the reason and a remedy — because most failed
//   matches are failed photographs, and telling an operator "no match"
//   when the real answer is "too dark" produces the wrong action.
// ══════════════════════════════════════════════════════════════

const WIZ = {
  step: 0,
  sessionId: null,
  stream: null,
  cameraOn: false,
  facing: 'user',
  cameras: [],
  metricsTimer: null,
  identity: null,
  subject: null,
  consented: false,
  level: 'standard',
  selfie: null,       // { descriptor, metrics, source }
  depth: null,        // the analysed scan
  document: null,     // { docType, findings, portraitDescriptor, metrics, source }
  mrz: null,          // parsed machine-readable zone, once typed
  reconciliation: null,
  run: null,
};

const WIZ_STEPS = [
  { id: 'identity', label: 'Identity number' },
  { id: 'live',     label: 'Live capture' },
  { id: 'document', label: 'Identity document' },
  { id: 'reconcile', label: 'Reconciliation' },
  { id: 'decide',   label: 'Agents decide' },
];

let CAPTURE_LIB = null;
async function captureLib() {
  // Loaded on demand: the camera, the descriptor and the forensics are
  // only needed on this page, and they are the heaviest code in the
  // console.
  if (!CAPTURE_LIB) {
    const [capture, face, depth, docs] = await Promise.all([
      import('./capture.js'),
      import('./vision/face.js'),
      import('./vision/depth.js'),
      import('./vision/document.js'),
    ]);
    CAPTURE_LIB = { ...capture, face, depth, docs };
  }
  return CAPTURE_LIB;
}

// getUserMedia is refused outside a secure context, and no amount of
// permission granting changes that. Saying so precisely — with the
// address that would work — is the difference between a two-minute fix
// and an afternoon spent blaming the camera.
function cameraContext() {
  if (typeof window === 'undefined') return { ok: false, reason: 'no_window' };
  const host = location.hostname;
  const localish = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  if (location.protocol === 'https:' || localish) return { ok: true };
  if (location.protocol === 'file:') {
    return {
      ok: false,
      reason: 'file_url',
      advice: 'This page was opened straight from disk. Browsers refuse camera access to a file:// '
            + 'address however the permissions are set. Run it from a server — `npm run dev` and '
            + 'open http://localhost:5173 — and the camera works.',
    };
  }
  return {
    ok: false,
    reason: 'insecure_origin',
    advice: `This page is served over plain HTTP from ${host}. Camera access needs HTTPS, or `
          + 'localhost. On a phone, open it over HTTPS — `npm run dev:lan` prints an address '
          + 'that works, once you accept its certificate.',
  };
}

function stepRail() {
  return `<div class="steps">${WIZ_STEPS.map((st, i) => `
    <div class="step ${i === WIZ.step ? 'active' : ''} ${i < WIZ.step ? 'done' : ''}">
      <span class="step-no">${i < WIZ.step ? '&#10003;' : i + 1}</span>${esc(st.label)}
    </div>`).join('')}</div>`;
}

function metricTile(label, value, state, suffix = '') {
  return `<div class="metric ${state}">
    <div class="metric-lbl">${esc(label)}</div>
    <div class="metric-val">${value === null || value === undefined ? '—' : esc(value)}${esc(suffix)}</div>
  </div>`;
}

RENDER.onboard = async () => {
  const lib = await captureLib();
  const ctx = cameraContext();
  const hasCamera = ctx.ok && lib.cameraAvailable();
  const hasFaceApi = lib.face.shapeDetectionAvailable();
  // Sessions already adjudicated are shown below the wizard. Without
  // this the agents can only be seen by running a live capture, which
  // makes the most explainable part of the system the hardest to look
  // at — and impossible to review after the fact.
  const [platforms, sessions, runs, name] = await Promise.all([
    DB.fetchPlatforms(),
    DB.fetchCaptureSessions().catch(() => []),
    DB.fetchAgentRuns().catch(() => []),
    platformName(),
  ]);
  const runByKey = new Map(runs.filter((r) => r.session_id).map((r) => [r.session_id, r]));

  return `
  ${stepRail()}
  <div class="g2" style="align-items:start">
    <div class="card" style="margin-top:0">
      <div class="card-hdr"><div><div class="card-title" id="wizTitle">Identity number</div>
        <div class="card-sub" id="wizSub">Who is being verified, and under what consent</div></div></div>
      <div class="card-body" id="wizBody">${loading()}</div>
    </div>

    <div class="card" style="margin-top:0">
      <div class="card-hdr"><div><div class="card-title">Camera</div>
        <div class="card-sub">Quality is measured from the pixels, live</div></div>
        <div class="card-actions" id="stageActions"></div></div>
      <div class="card-body">
        <div class="stage" id="stage">
          <div class="stage-empty">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">
              <rect x="2" y="5" width="16" height="11" rx="2"/><circle cx="10" cy="10.5" r="3"/>
              <path d="M7 5l1-1.6h4L13 5" stroke-linejoin="round"/></svg>
            <div>The camera starts at the live capture and document steps.</div>
          </div>
        </div>
        <div class="metrics" id="metrics"></div>
        <div id="captureNote"></div>
      </div>
    </div>
  </div>

  ${!hasCamera ? `<div class="note note-warn">
    <b>No camera is available here.</b> ${esc(ctx.advice ?? 'This browser or context has no camera access.')}
    Captures fall back to file upload, which is a weaker signal — an uploaded photograph proves far
    less than one taken under observation, the depth scan cannot run at all, and the system records
    which it was.</div>` : ''}
  ${!hasFaceApi ? `<div class="note note-info">
    <b>This browser has no face detector.</b> Faces are located by a chroma-and-shape method instead,
    which is weaker: it finds the largest skin-toned region of roughly the right shape. Every result
    carries the method that produced it, so a coarse locator never reads as a detection.</div>` : ''}

  <div class="card" id="agentCard" style="display:none">
    <div class="card-hdr"><div><div class="card-title">Agent adjudication</div>
      <div class="card-sub">Six agents, each owning one question. A recommendation, not a decision.</div></div></div>
    <div class="card-body" id="agentBody"></div>
  </div>

  ${sessions.length ? `
  <div class="card">
    <div class="card-hdr"><div><div class="card-title">Recent adjudications</div>
      <div class="card-sub">Every session already put to the agents · click a row for what each one said</div></div></div>
    <div class="card-body">
      <table><thead><tr>
        <th>Session</th><th>Platform</th><th>Channel</th><th>Where</th>
        <th>Outcome</th><th>Recommendation</th><th>A person</th><th>Started</th>
      </tr></thead><tbody>
        ${sessions.map((sn) => {
          const run = runByKey.get(sn.id);
          return `<tr class="clickable" data-session="${esc(sn.id)}">
            <td class="mono">${esc(sn.id)}</td>
            <td>${esc(name(sn.platform_id))}</td>
            <td>${esc(titleCase(sn.channel))}</td>
            <td class="muted">${esc(sn.device_label ?? '—')}</td>
            <td><span class="badge b-${sn.status === 'approved' ? 'passed'
                      : sn.status === 'declined' ? 'failed'
                      : sn.status === 'review' ? 'review' : 'pending'}"
              >${esc(titleCase(sn.status))}</span></td>
            <td>${run ? `<b>${esc(titleCase(run.recommendation))}</b>
                  <span class="mono muted">${esc(run.confidence)}%</span>
                  ${run.vetoed_by ? `<span class="veto-tag">veto</span>` : ''}`
                 : '<span class="muted">Not yet run</span>'}</td>
            <td>${run?.human_outcome && run.human_outcome !== 'pending'
                 ? badge(run.human_outcome === 'accepted' ? 'passed'
                      : run.human_outcome === 'overridden' ? 'review' : 'pending')
                 : '<span class="muted">—</span>'}</td>
            <td class="muted">${esc(fmtDateTime(sn.started_at))}</td>
          </tr>`;
        }).join('')}
      </tbody></table>
    </div>
  </div>` : ''}

  <input type="hidden" id="wizPlatforms" value="${esc(JSON.stringify(platforms.map((p) => ({ id: p.id, name: p.name }))))}">`;
};

WIRE.onboard = () => {
  WIZ.step = 0;
  WIZ.selfie = null;
  WIZ.depth = null;
  WIZ.document = null;
  WIZ.mrz = null;
  WIZ.reconciliation = null;
  WIZ.run = null;
  renderWizStep();

  document.querySelectorAll('tr[data-session]').forEach((r) =>
    r.addEventListener('click', () => openAdjudication(r.dataset.session)));
};

// What the agents said about a session that has already been decided.
// Reads the stored run rather than re-adjudicating: a decision has to
// be reviewable as it was made, not as the rules would make it today.
async function openAdjudication(sessionId) {
  openModal('Adjudication', loading(), '', true);
  try {
    const [runs, captures] = await Promise.all([
      DB.fetchAgentRuns({ sessionId }),
      DB.fetchCaptures(sessionId).catch(() => []),
    ]);
    const run = runs[0];
    if (!run) {
      document.getElementById('modalBody').innerHTML =
        '<div class="note note-info">This session was never put to the agents.</div>';
      return;
    }

    const [decisions, agents] = await Promise.all([
      DB.fetchAgentDecisions(run.id),
      DB.fetchAgents().catch(() => []),
    ]);
    const remit = new Map(agents.map((a) => [a.id, a]));
    const kind = run.recommendation === 'approve' ? 'note-info'
      : run.recommendation === 'decline' ? 'note-danger' : 'note-warn';

    document.getElementById('modalBody').innerHTML = `
      <div class="note ${kind}">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <b style="font-size:14px">${esc(titleCase(run.recommendation))}</b>
          <span class="badge b-${run.recommendation === 'approve' ? 'passed'
            : run.recommendation === 'decline' ? 'failed' : 'review'}">${esc(run.confidence)}% confidence</span>
          ${run.vetoed_by ? `<span class="veto-tag">vetoed by ${esc(run.vetoed_by.replace(/_/g, ' '))}</span>` : ''}
        </div>
        <div style="margin-top:7px">${esc(run.summary ?? '')}</div>
      </div>

      <dl class="kv" style="margin-top:12px">
        <dt>Session</dt><dd class="mono">${esc(sessionId)}</dd>
        <dt>Decided</dt><dd>${esc(fmtDateTime(run.created_at))}</dd>
        <dt>Deliberation</dt><dd>${run.latency_ms ? `${esc(run.latency_ms)} ms` : '—'}</dd>
        <dt>A person</dt><dd>${run.human_outcome ? esc(titleCase(run.human_outcome)) : '—'}</dd>
        ${run.override_reason ? `<dt>Because</dt><dd>${esc(run.override_reason)}</dd>` : ''}
        <dt>Captures</dt><dd>${captures.length
          ? captures.map((c) => esc(titleCase(c.capture_type))).join(', ')
          : '—'}</dd>
      </dl>

      ${captures.length ? `<div class="note note-info" style="margin-top:10px">
        <b>No image is held.</b> Each capture was templated and the sample discarded — what remains
        is the quality it was measured at and the template it produced.</div>` : ''}

      <div style="margin-top:14px">
        ${decisions.map((d) => `
          <div class="agent">
            <div class="agent-icon agent-${esc(d.verdict)}">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">${VERDICT_ICON[d.verdict] ?? ''}</svg>
            </div>
            <div style="min-width:0;flex:1">
              <div class="agent-name">${esc(remit.get(d.agent_id)?.name ?? titleCase(d.agent_id))}
                ${badge(d.verdict === 'pass' ? 'passed' : d.verdict === 'fail' ? 'failed'
                  : d.verdict === 'concern' ? 'review' : 'skipped')}
                ${remit.get(d.agent_id)?.can_veto ? '<span class="veto-tag">can veto</span>' : ''}
                <span class="mono muted" style="margin-left:auto;font-size:10.5px">${esc(d.confidence)}%</span>
              </div>
              <div class="agent-remit">${esc(remit.get(d.agent_id)?.remit ?? '')}</div>
              <div class="agent-rationale">${esc(d.rationale)}</div>
            </div>
          </div>`).join('')}
      </div>`;
  } catch (e) {
    document.getElementById('modalBody').innerHTML = errorState(e);
  }
}

function gotoStep(n) {
  WIZ.step = n;
  renderWizStep();
}

function renderWizStep() {
  const body = document.getElementById('wizBody');
  const title = document.getElementById('wizTitle');
  const sub = document.getElementById('wizSub');
  const actions = document.getElementById('stageActions');
  if (!body) return;

  document.querySelectorAll('.steps').forEach((el) => { el.outerHTML = stepRail(); });
  if (actions) actions.innerHTML = '';

  const step = WIZ_STEPS[WIZ.step];
  if (step.id === 'identity') return renderIdentityStep(body, title, sub);
  if (step.id === 'live') return renderLiveStep(body, title, sub);
  if (step.id === 'document') return renderDocumentStep(body, title, sub);
  if (step.id === 'reconcile') return renderReconcileStep(body, title, sub);
  return renderDecideStep(body, title, sub);
}

// ── 1 · The identity number ─────────────────────────────────────
function renderIdentityStep(body, title, sub) {
  stopStage();
  title.textContent = 'Identity number';
  sub.textContent = 'Everything that follows is checked against this';
  const platforms = JSON.parse(document.getElementById('wizPlatforms')?.value ?? '[]');

  body.innerHTML = `
    <div class="field"><label for="wizId">SA ID number</label>
      <input id="wizId" class="mono" maxlength="20" inputmode="numeric" placeholder="13 digits">
      <div class="hint" id="wizIdHint">Checked arithmetically as you type — the check digit, the date
      of birth it encodes, and the citizenship digit. The number itself is never stored; only a
      peppered hash and the last four digits.</div></div>
    <div class="row2">
      <div class="field"><label for="wizFirst">First names</label><input id="wizFirst" placeholder="As printed on the document"></div>
      <div class="field"><label for="wizSurname">Surname</label><input id="wizSurname" placeholder="As printed on the document"></div>
    </div>
    <div class="field"><label for="wizPlatform">Platform</label>
      <select id="wizPlatform">${platforms.map((p) =>
        `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="wizChannel">Where is this happening?</label>
      <select id="wizChannel">
        <option value="self_service">Self-service — this device</option>
        <option value="branch">Branch counter</option>
        <option value="dealership">Dealership floor</option>
        <option value="field_agent">Field agent</option>
      </select>
      <div class="hint">An unobserved capture on the applicant's own device is worth less than one
      taken at a counter, and is recorded as such rather than quietly treated the same.</div></div>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.55;margin-top:4px">
      <input type="checkbox" id="wizConsent" style="width:auto;margin-top:2px">
      <span>The applicant has explicitly consented to biometric processing. POPIA s26 makes biometric
      data special personal information; s27 requires explicit consent and will not accept
      legitimate interest.</span>
    </label>
    <button class="btn btn-primary btn-sm" style="margin-top:14px" id="wizStart">Begin verification</button>
    <div id="wizStartResult"></div>`;

  const idInput = document.getElementById('wizId');
  idInput.addEventListener('input', async () => {
    const hint = document.getElementById('wizIdHint');
    const v = idInput.value.trim();
    if (v.replace(/\D/g, '').length !== 13) {
      hint.textContent = 'Checked arithmetically as you type. The number is never stored — only a peppered hash.';
      hint.style.color = '';
      return;
    }
    try {
      const r = await DB.validateSaId(v);
      hint.textContent = r.valid
        ? `Valid · born ${fmtDate(r.date_of_birth)} · ${titleCase(r.gender)} · ${titleCase(r.citizenship)}`
        : `Not valid — ${(r.reason_codes ?? []).map(titleCase).join(', ')}`;
      hint.style.color = r.valid ? 'var(--gr2)' : 'var(--red)';
    } catch { /* leave the hint as it was */ }
  });

  document.getElementById('wizStart').addEventListener('click', startSession);
}

async function startSession() {
  const out = document.getElementById('wizStartResult');
  const platformId = document.getElementById('wizPlatform').value;
  const firstNames = document.getElementById('wizFirst').value.trim();
  const surname = document.getElementById('wizSurname').value.trim();
  const idNumber = document.getElementById('wizId').value.trim();
  const channel = document.getElementById('wizChannel').value;
  const consented = document.getElementById('wizConsent').checked;

  if (!idNumber) { toast('An identity number is required', 'err'); return; }
  if (!consented) {
    out.innerHTML = `<div class="note note-danger" style="margin-top:12px">
      <b>Consent is a precondition, not a formality.</b> No template is computed without it — this is
      a constraint the pipeline enforces, not a checkbox the code steps over.</div>`;
    return;
  }

  out.innerHTML = loading();
  try {
    const identity = await DB.verifyIdentity({
      idNumber, firstNames, surname, platformId, level: 'standard', purpose: 'onboarding',
    });
    WIZ.identity = identity.identity;
    WIZ.consented = true;
    WIZ.subject = {
      id: identity.subjectId,
      caseId: identity.caseId,
      name: [firstNames, surname].filter(Boolean).join(' ') || 'Applicant',
    };

    const session = await DB.openCaptureSession({
      platformId,
      caseId: identity.caseId,
      subjectId: identity.subjectId,
      channel,
      deviceLabel: deviceLabel(),
      requiredSteps: ['consent', 'selfie', 'document', 'match'],
    });
    WIZ.sessionId = session.sessionId;

    out.innerHTML = `<div class="note ${identity.identity.structureValid ? 'note-info' : 'note-danger'}" style="margin-top:12px">
      Session <b>${esc(session.sessionId)}</b> open · case <b>${esc(identity.caseId)}</b>.<br>
      ${identity.identity.structureValid
        ? `The number checks out: born ${fmtDate(identity.identity.dateOfBirth)},
           ${esc(titleCase(identity.identity.gender ?? ''))},
           ${esc(titleCase(identity.identity.citizenship ?? ''))}.
           Stored as <span class="mono">••• ${esc(identity.identity.last4)}</span> and a hash.`
        : `<b>This number fails its own arithmetic</b> —
           ${esc((identity.identity.reasonCodes ?? []).map(titleCase).join(', '))}.
           The session continues so the rest can be captured, and the identity agent will veto.`}
      </div>`;

    setTimeout(() => gotoStep(1), 700);
  } catch (e) {
    out.innerHTML = errorState(e);
  }
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const kind = /iPhone|iPad|Android/i.test(ua) ? 'Phone or tablet'
    : /Macintosh/i.test(ua) ? 'Mac'
      : /Windows/i.test(ua) ? 'Windows PC' : 'This device';
  return `${kind} · ${location.hostname || 'local'}`;
}

// ── 2 · The live capture, with the depth scan ───────────────────
function renderLiveStep(body, title, sub) {
  title.textContent = 'Live capture';
  sub.textContent = 'A photograph of the person, and a scan that proves they were there';

  const done = Boolean(WIZ.selfie);
  body.innerHTML = `
    <div class="note note-info">
      <b>Two things happen here, and they answer different questions.</b>
      The photograph is what gets compared to the document. The scan is what establishes that a
      person was in front of the camera at all — you will be asked to turn your head, and the
      movement is measured for parallax, which a printed photograph and a screen cannot produce.
      The prompts come in a random order, so a recording of an earlier scan does not fit.
    </div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-primary btn-sm" id="wizLiveGo">${done ? 'Retake' : 'Photograph and scan'}</button>
      <button class="btn btn-sm" id="wizLivePhotoOnly">Photograph only</button>
      <button class="btn btn-sm" id="wizLiveUploadBtn">Upload a photograph</button>
      <input type="file" id="wizLiveUpload" accept="image/*" capture="user" hidden>
    </div>
    <div id="wizLiveResult">${done ? renderSelfieSummary() : ''}</div>`;

  document.getElementById('wizLiveGo').addEventListener('click', () => runLiveCapture(true));
  document.getElementById('wizLivePhotoOnly').addEventListener('click', () => runLiveCapture(false));
  document.getElementById('wizLiveUploadBtn').addEventListener('click',
    () => document.getElementById('wizLiveUpload').click());
  document.getElementById('wizLiveUpload').addEventListener('change', (e) => {
    if (e.target.files?.[0]) uploadSelfie(e.target.files[0]);
  });

  startStage('user');
}

async function runLiveCapture(withScan) {
  const out = document.getElementById('wizLiveResult');
  const video = document.getElementById('stageVideo');
  if (!video || !WIZ.cameraOn) { toast('Start the camera first', 'err'); return; }

  const lib = await captureLib();
  out.innerHTML = loading();

  try {
    const measured = await lib.captureAndMeasure(video, { captureType: 'selfie' });
    document.getElementById('metrics').innerHTML = renderMetrics(measured.metrics, measured.faces);

    const quality = await DB.checkCaptureQuality('selfie', measured.metrics);
    if (quality.passed === false) {
      out.innerHTML = refusal(quality);
      return;
    }

    const descriptor = await lib.face.faceDescriptor(measured.canvas);
    if (!descriptor) {
      out.innerHTML = `<div class="note note-danger" style="margin-top:12px">
        <b>No face could be located in that photograph.</b> Nothing can be compared without one.
        Move into the guide, make sure the light is on your face rather than behind you, and retake.</div>`;
      return;
    }

    WIZ.selfie = {
      descriptor,
      metrics: measured.metrics,
      source: 'live_camera',
      quality,
    };

    await DB.submitCapture({
      sessionId: WIZ.sessionId,
      captureType: 'selfie',
      source: 'live_camera',
      metrics: measured.metrics,
      quality,
      descriptor: Array.from(descriptor.vector),
    });

    if (!withScan) {
      WIZ.depth = null;
      out.innerHTML = renderSelfieSummary()
        + `<div class="note note-warn" style="margin-top:10px">
            <b>No depth scan was run.</b> The photograph can still be compared to the document, but
            nothing here establishes that a person was present rather than a photograph of one.</div>`
        + continueButton('wizToDoc', 'Continue to the document');
      document.getElementById('wizToDoc').addEventListener('click', () => gotoStep(2));
      return;
    }

    await runDepthScan(out, lib, video);
  } catch (e) {
    out.innerHTML = errorState(e);
  }
}

async function runDepthScan(out, lib, video) {
  const stage = document.getElementById('stage');
  const prompt = document.createElement('div');
  prompt.className = 'stage-prompt';
  stage.appendChild(prompt);
  const bar = document.createElement('div');
  bar.className = 'scan-bar';
  bar.innerHTML = '<i></i>';
  stage.appendChild(bar);

  out.innerHTML = `<div class="note note-info" style="margin-top:12px">
    <b>Scanning.</b> Follow the prompt on the camera. Move your head, not the device — the
    measurement is the difference between the two.</div>`;

  try {
    const scan = await lib.depth.runDepthScan(video, {
      grabFrame: lib.grabFrame,
      onPrompt: (pose, i, n) => { prompt.textContent = `${i + 1} of ${n} · ${pose.prompt}`; },
      onProgress: (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; },
    });
    prompt.textContent = 'Working out the geometry…';
    const analysis = await lib.depth.analyseDepthScan(scan);
    WIZ.depth = analysis;

    await DB.submitCapture({
      sessionId: WIZ.sessionId,
      captureType: 'depth_scan',
      source: 'live_camera',
      metrics: { width: null, height: null },
      quality: { score: analysis.confidence, passed: analysis.verdict !== 'flat', reason_codes: [] },
    });

    prompt.remove();
    bar.remove();

    out.innerHTML = renderSelfieSummary() + renderDepth(analysis)
      + continueButton('wizToDoc', 'Continue to the document');
    document.getElementById('wizToDoc').addEventListener('click', () => gotoStep(2));
  } catch (e) {
    prompt.remove();
    bar.remove();
    out.innerHTML = renderSelfieSummary()
      + `<div class="note note-warn" style="margin-top:10px">
          <b>The scan did not complete:</b> ${esc(e.message)}. The photograph stands; presence does not.</div>`
      + continueButton('wizToDoc', 'Continue to the document');
    document.getElementById('wizToDoc').addEventListener('click', () => gotoStep(2));
  }
}

async function uploadSelfie(file) {
  const out = document.getElementById('wizLiveResult');
  out.innerHTML = loading();
  try {
    const lib = await captureLib();
    const canvas = await lib.fileToCanvas(file);
    const measured = await lib.captureAndMeasure(canvas, { captureType: 'selfie' });
    showFrozen(canvas);
    document.getElementById('metrics').innerHTML = renderMetrics(measured.metrics, measured.faces);

    const quality = await DB.checkCaptureQuality('selfie', measured.metrics);
    if (quality.passed === false) { out.innerHTML = refusal(quality); return; }

    const descriptor = await lib.face.faceDescriptor(canvas);
    if (!descriptor) {
      out.innerHTML = '<div class="note note-danger" style="margin-top:12px">No face could be located in that file.</div>';
      return;
    }

    WIZ.selfie = { descriptor, metrics: measured.metrics, source: 'upload', quality };
    WIZ.depth = null;
    await DB.submitCapture({
      sessionId: WIZ.sessionId, captureType: 'selfie', source: 'upload',
      metrics: measured.metrics, quality, descriptor: Array.from(descriptor.vector),
    });

    out.innerHTML = renderSelfieSummary()
      + `<div class="note note-warn" style="margin-top:10px">
          <b>This was uploaded, not captured.</b> An uploaded photograph proves that a file exists.
          It cannot show that the person was present, and no depth scan is possible on it. The
          session records the difference.</div>`
      + continueButton('wizToDoc', 'Continue to the document');
    document.getElementById('wizToDoc').addEventListener('click', () => gotoStep(2));
  } catch (e) {
    out.innerHTML = errorState(e);
  }
}

function renderSelfieSummary() {
  if (!WIZ.selfie) return '';
  const d = WIZ.selfie.descriptor;
  return `<div class="note note-info" style="margin-top:12px">
    <b>Photograph accepted — quality ${esc(WIZ.selfie.quality?.score ?? '—')}.</b><br>
    A ${esc(d.dimensions)}-dimension descriptor was computed and the image discarded.
    Face located by <b>${esc(d.method.replace(/_/g, ' '))}</b>, aligned on
    <b>${esc(d.alignment.replace(/_/g, ' '))}</b>.
    </div>`;
}

function renderDepth(a) {
  const tone = a.verdict === 'three_dimensional' ? 'note-info'
    : a.verdict === 'flat' ? 'note-danger' : 'note-warn';
  const label = a.verdict === 'three_dimensional' ? 'Depth confirmed'
    : a.verdict === 'flat' ? 'Flat — presentation attack'
      : a.verdict === 'not_measured' ? 'Nothing measured' : 'Inconclusive';

  return `<div class="note ${tone}" style="margin-top:10px">
    <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
      <b style="font-size:13px">${esc(label)}</b>
      <span class="badge b-${a.verdict === 'three_dimensional' ? 'passed'
        : a.verdict === 'flat' ? 'failed' : 'review'}">${esc(a.confidence)}% confidence</span>
    </div>
    <div style="margin-top:7px">${esc(a.note)}</div>
    <dl class="kv" style="margin-top:9px">
      <dt>Depth evidence</dt><dd class="mono">${esc(a.depthEvidence)}
        <span class="muted">(flat below ${esc(a.thresholds.flatEvidence)}, live above ${esc(a.thresholds.liveEvidence)})</span></dd>
      <dt>Relief</dt><dd class="mono">${esc(a.reliefPct)}% of face width</dd>
      <dt>Flat-object fit</dt><dd class="mono">R² ${esc(a.planarityR2)}
        <span class="muted">— how much of the motion one rigid plane explains</span></dd>
      <dt>Central parallax</dt><dd class="mono">${esc(a.centralParallax)}</dd>
      <dt>Prompts</dt><dd>${esc(a.posesRequested.join(' → '))} · ${esc(a.posesAnswered)} answered
        <span class="muted">· counted: ${esc((a.posesCounted ?? []).join(', ') || 'none')}</span></dd>
      <dt>Micro-motion</dt><dd class="mono">${esc(a.microMotion.motion ?? '—')}</dd>
      <dt>Face found by</dt><dd>${esc(a.faceLocatedBy.replace(/_/g, ' '))}</dd>
    </dl>
    <div style="margin-top:8px;font-size:11px;color:var(--ink3)">${esc(a.limits)}</div>
  </div>`;
}

// ── 3 · The identity document ───────────────────────────────────
function renderDocumentStep(body, title, sub) {
  title.textContent = 'Identity document';
  sub.textContent = 'Photograph it or upload it — then it gets examined, not just read';

  body.innerHTML = `
    <div class="note note-info">
      <b>Hold the card flat and fill the frame.</b> The examination compares the portrait against the
      card around it — its texture, focus, colour and compression — so the more of the card in shot,
      the more there is to compare it with. A photograph of a screen showing the document is
      detected and reported as such.
    </div>
    <div class="field" style="margin-top:12px"><label for="wizDocType">Document type</label>
      <select id="wizDocType">
        <option value="sa_id_card">SA Smart ID Card</option>
        <option value="sa_id_book">SA Green Barcoded ID Book</option>
        <option value="passport">Passport</option>
        <option value="drivers_licence">SA Driving Licence Card</option>
        <option value="asylum_permit">Asylum Seeker / Refugee Permit</option>
      </select></div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-primary btn-sm" id="wizDocCapture">Photograph the document</button>
      <button class="btn btn-sm" id="wizDocUploadBtn">Upload or scan a file</button>
      <input type="file" id="wizDocUpload" accept="image/*" capture="environment" hidden>
    </div>
    <div id="wizDocResult"></div>`;

  document.getElementById('wizDocCapture').addEventListener('click', () => captureDocument('live_camera'));
  document.getElementById('wizDocUploadBtn').addEventListener('click',
    () => document.getElementById('wizDocUpload').click());
  document.getElementById('wizDocUpload').addEventListener('change', (e) => {
    if (e.target.files?.[0]) captureDocument('upload', e.target.files[0]);
  });

  // The rear camera, where there is one: nobody photographs a card
  // with the selfie lens.
  startStage('environment');
}

async function captureDocument(source, file) {
  const out = document.getElementById('wizDocResult');
  const docType = document.getElementById('wizDocType').value;
  const lib = await captureLib();
  out.innerHTML = loading();

  try {
    let canvas;
    if (source === 'upload') {
      canvas = await lib.fileToCanvas(file);
      showFrozen(canvas);
    } else {
      const video = document.getElementById('stageVideo');
      if (!video || !WIZ.cameraOn) { toast('Start the camera first', 'err'); out.innerHTML = ''; return; }
      canvas = lib.grabFrame(video);
      showFrozen(canvas);
    }

    const measured = await lib.captureAndMeasure(canvas, { captureType: 'document_front' });
    document.getElementById('metrics').innerHTML = renderMetrics(measured.metrics, measured.faces);

    const quality = await DB.checkCaptureQuality('document_front', measured.metrics);
    if (quality.passed === false) { out.innerHTML = refusal(quality); return; }

    out.innerHTML = `<div class="note note-info" style="margin-top:12px">Examining the document…</div>`;

    const features = (await DB.fetchDocumentSecurityFeatures()).find((f) => f.doc_type === docType) ?? {};
    const findings = await lib.docs.analyseDocument(canvas, { docType, features });

    let portraitDescriptor = null;
    if (findings.portraitCanvas) {
      portraitDescriptor = await lib.face.faceDescriptor(findings.portraitCanvas);
    }

    WIZ.document = {
      docType, findings, portraitDescriptor, metrics: measured.metrics, source, quality, features,
    };

    await DB.submitCapture({
      sessionId: WIZ.sessionId, captureType: 'document_front', source,
      metrics: measured.metrics, quality,
    });
    if (portraitDescriptor) {
      await DB.submitCapture({
        sessionId: WIZ.sessionId, captureType: 'document_portrait', source,
        metrics: measured.metrics, quality,
        descriptor: Array.from(portraitDescriptor.vector),
      });
    }

    out.innerHTML = renderDocumentFindings(findings, features, portraitDescriptor)
      + (features.mrz ? mrzPanel() : '')
      + continueButton('wizToReconcile', 'Reconcile everything');

    if (features.mrz) {
      document.getElementById('wizMrzCheck').addEventListener('click', checkMrz);
    }
    document.getElementById('wizToReconcile').addEventListener('click', () => gotoStep(3));
  } catch (e) {
    out.innerHTML = errorState(e);
  }
}

function renderDocumentFindings(f, features, portraitDescriptor) {
  const fired = f.signals.filter((s) => s.fired);
  const s = f.substitution;

  return `<div class="note ${fired.length ? 'note-warn' : 'note-info'}" style="margin-top:12px">
      <b>${fired.length ? `${fired.length} finding${fired.length === 1 ? '' : 's'} to look at` : 'Nothing inconsistent found'}.</b>
      ${portraitDescriptor
        ? ` The portrait was found and a descriptor computed from it${f.ghost ? ', and a second, smaller portrait was found too' : ''}.`
        : ' No portrait was located, so there is nothing to compare the person against.'}
    </div>

    ${fired.length ? `<div style="margin-top:10px">${fired.map((sig) => `
      <div class="note note-warn" style="margin-top:6px">
        <b>${esc(titleCase(sig.code))}</b> <span class="mono muted">${esc(sig.value)}</span><br>
        ${esc(sig.detail)}
      </div>`).join('')}</div>` : ''}

    ${s ? `<div class="card" style="margin-top:12px"><div class="card-hdr">
        <div><div class="card-title">Portrait against the card it sits on</div>
        <div class="card-sub">Every figure is the portrait compared with the rest of the document</div></div></div>
      <div class="card-body" style="padding:0">
        <table><thead><tr><th>Measure</th><th>Value</th><th>What it would mean</th></tr></thead><tbody>
          <tr><td>Fine texture</td><td class="mono">${esc(s.noiseRatio)}×</td>
            <td class="muted">One printing process leaves one texture. A ratio far from 1 means two.</td></tr>
          <tr><td>Focus falloff</td><td class="mono">${esc(s.focusRatio)}×</td>
            <td class="muted">A card lies in one focal plane; something stuck on top of it sits above that plane.</td></tr>
          <tr><td>White point</td><td class="mono">${esc(s.colourDelta)}</td>
            <td class="muted">Measured from the highlights, not the average — a face is warmer than a card whoever printed it.</td></tr>
          <tr><td>Border ridge</td><td class="mono">${esc(s.boundaryRidge)} luma</td>
            <td class="muted">A physical photograph casts a shadow along its edge, or catches light off tape. Printed ink does neither.</td></tr>
          <tr><td>Compression</td><td class="mono">${esc(s.errorLevelRatio)}×</td>
            <td class="muted">A region from another file falls differently when re-encoded.</td></tr>
          <tr><td>Blown highlights</td><td class="mono">${esc(s.specular.blownPct)}%</td>
            <td class="muted">Runs of white across the portrait are the signature of tape or gloss.</td></tr>
          ${f.ghostCorrelation !== null ? `<tr><td>Ghost portrait</td>
            <td class="mono">${esc(f.ghostCorrelation)}</td>
            <td class="muted">The second, smaller portrait is printed from the same file. Replacing one and not the other breaks the pair.</td></tr>` : ''}
        </tbody></table>
      </div></div>` : ''}

    <div class="note note-info" style="margin-top:10px;font-size:11px">
      <b>What this cannot do.</b> There is no reference specimen here to compare against, no
      ultraviolet or infrared channel, and no reading of the chip. These checks ask whether the
      document is consistent with itself — which is what catches a substituted photograph, and is
      not the same as confirming the document was issued.
      ${features.notes ? `<br><b>${esc(titleCase(f.docType))}:</b> ${esc(features.notes)}` : ''}
    </div>`;
}

function mrzPanel() {
  return `<div class="card" style="margin-top:12px">
    <div class="card-hdr"><div><div class="card-title">Machine-readable zone</div>
      <div class="card-sub">The one check here that is as strong on a laptop as in a laboratory</div></div></div>
    <div class="card-body">
      <div class="note note-info" style="margin-top:0">Reading the characters off the image needs an
      optical recogniser this environment does not have, so the band is located and you type what it
      says. The check digits are then verified for real — they are arithmetic over the characters,
      so they catch a document whose data has been altered since it was issued.</div>
      <div class="field" style="margin-top:10px"><label for="wizMrz">The lines, as printed</label>
        <textarea id="wizMrz" class="mono" rows="3" placeholder="IDZAF..."></textarea></div>
      <button class="btn btn-sm" id="wizMrzCheck">Verify the check digits</button>
      <div id="wizMrzResult"></div>
    </div></div>`;
}

async function checkMrz() {
  const out = document.getElementById('wizMrzResult');
  const text = document.getElementById('wizMrz').value.trim();
  if (!text) { toast('Type the lines first', 'err'); return; }
  out.innerHTML = loading();
  try {
    const lib = await captureLib();
    const parsed = await lib.docs.verifyMrz(text);
    WIZ.mrz = parsed;
    const f = parsed.fields ?? {};
    out.innerHTML = `<div class="note ${parsed.valid ? 'note-info' : 'note-danger'}" style="margin-top:10px">
      <b>${parsed.valid ? 'Every check digit holds.' : 'A check digit fails.'}</b>
      ${parsed.valid
        ? 'The data on the document agrees with itself.'
        : 'The data on this document does not agree with itself. That is arithmetic, not inference.'}
      <dl class="kv" style="margin-top:8px">
        <dt>Format</dt><dd class="mono">${esc(parsed.format ?? '—')}</dd>
        ${f.document_number ? `<dt>Document</dt><dd class="mono">${esc(f.document_number)}</dd>` : ''}
        ${f.surname ? `<dt>Name</dt><dd>${esc([f.given_names, f.surname].filter(Boolean).join(' '))}</dd>` : ''}
        ${f.date_of_birth ? `<dt>Born</dt><dd>${esc(f.date_of_birth)}</dd>` : ''}
        ${f.date_of_expiry ? `<dt>Expires</dt><dd>${esc(f.date_of_expiry)}</dd>` : ''}
        ${(parsed.reasonCodes ?? []).length
          ? `<dt>Failures</dt><dd>${esc(parsed.reasonCodes.map(titleCase).join(', '))}</dd>` : ''}
      </dl></div>`;
  } catch (e) {
    out.innerHTML = errorState(e);
  }
}

// ── 4 · Reconciliation ──────────────────────────────────────────
function renderReconcileStep(body, title, sub) {
  stopStage();
  title.textContent = 'Reconciliation';
  sub.textContent = 'The person, the document, and what the authority holds';
  body.innerHTML = loading();
  reconcile(body);
}

async function reconcile(body) {
  try {
    const res = await DB.reconcileCapture({
      sessionId: WIZ.sessionId,
      selfieDescriptor: WIZ.selfie ? Array.from(WIZ.selfie.descriptor.vector) : null,
      documentPortraitDescriptor: WIZ.document?.portraitDescriptor
        ? Array.from(WIZ.document.portraitDescriptor.vector) : null,
      documentType: WIZ.document?.docType ?? null,
      documentFindings: WIZ.document ? {
        firedCodes: WIZ.document.findings.firedCodes,
        substitution: WIZ.document.findings.substitution,
        ghostCorrelation: WIZ.document.findings.ghostCorrelation,
      } : null,
      mrz: WIZ.mrz,
      depth: WIZ.depth,
      idHash: WIZ.identity?.idHash ?? null,
      last4: WIZ.identity?.last4 ?? null,
      level: WIZ.level,
    });
    WIZ.reconciliation = res;

    const c = res.comparisons ?? {};
    body.innerHTML = `
      ${comparisonCard('The person against their document', c.selfie_vs_document,
        'Both images were captured in this session, so this comparison is made entirely from what you just took.')}
      ${comparisonCard('The person against the authority record', c.selfie_vs_authority,
        'Simulated. There is no Home Affairs here.')}
      ${duplicateCard(c.duplicate_enrolment)}
      ${documentCard(res.document)}
      ${WIZ.depth ? `<div style="margin-top:12px">${renderDepth(WIZ.depth)}</div>` : `
        <div class="note note-warn" style="margin-top:12px"><b>Presence was never established.</b>
        No depth scan ran in this session, so nothing here distinguishes a person from a photograph
        of one.</div>`}
      ${continueButton('wizToAgents', 'Put it to the agents')}`;

    document.getElementById('wizToAgents').addEventListener('click', () => {
      gotoStep(4);
      runAgents();
    });
  } catch (e) {
    body.innerHTML = errorState(e);
  }
}

function comparisonCard(heading, cmp, footnote) {
  if (!cmp) {
    return `<div class="note note-warn" style="margin-top:12px">
      <b>${esc(heading)}</b><br>Not computed — one of the two images is missing.</div>`;
  }
  if (cmp.matched === null || cmp.matched === undefined) {
    return `<div class="note note-warn" style="margin-top:12px">
      <b>${esc(heading)}</b><br>${esc(cmp.note ?? 'No comparison was possible.')}</div>`;
  }

  const tone = cmp.matched ? (cmp.confidence >= 70 ? 'note-info' : 'note-warn') : 'note-danger';
  return `<div class="note ${tone}" style="margin-top:12px">
    <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
      <b style="font-size:13px">${esc(heading)}</b>
      <span class="badge b-${cmp.matched ? 'passed' : 'failed'}">${cmp.matched ? 'Match' : 'No match'}</span>
      <span class="mono muted">${esc(cmp.confidence)}% confidence</span>
      ${cmp.simulated ? '<span class="veto-tag">simulated</span>' : ''}
    </div>
    <div style="margin-top:6px">${esc(cmp.question ?? '')}</div>
    <dl class="kv" style="margin-top:9px">
      <dt>Model similarity</dt><dd class="mono">${esc(cmp.similarity)} against a ${esc(cmp.threshold)} threshold at FMR ${esc(cmp.operatingFmr)}</dd>
      <dt>Measured appearance</dt><dd class="mono">${esc(cmp.measuredAppearance)}</dd>
      <dt>Model</dt><dd class="mono">${esc(cmp.modelId)} · ${esc(cmp.provider)}</dd>
      <dt>Evidence</dt><dd>${esc(cmp.evidence ?? '—')}</dd>
    </dl>
    <div style="margin-top:8px;font-size:11px;color:var(--ink3)">
      ${esc(cmp.basis ?? '')} ${cmp.limit ? `<br><b>${esc(cmp.limit)}</b>` : ''}
      ${footnote ? `<br>${esc(footnote)}` : ''}
    </div>
  </div>`;
}

function duplicateCard(dup) {
  if (!dup) return '';
  if (!dup.fired) {
    // A check against nothing is not a check, and saying "not enrolled
    // elsewhere" after comparing against an empty register would be
    // the console reporting a reassurance it has not earned.
    return dup.checked
      ? `<div class="note note-info" style="margin-top:12px">
          <b>This face is not enrolled under any other identity number.</b>
          Compared against ${esc(dup.checked)} face(s) already enrolled here.</div>`
      : `<div class="note note-warn" style="margin-top:12px">
          <b>Nothing to compare against yet.</b> This is the first face enrolled in this register,
          so the duplicate-identity check had no material to work with. It is not a finding.</div>`;
  }
  return `<div class="note note-danger" style="margin-top:12px">
    <b>This face is already enrolled under a different identity number.</b><br>
    Appearance ${esc(dup.appearance)} against the identity ending
    <span class="mono">${esc(dup.otherLast4 ?? '····')}</span>. ${esc(dup.note)}</div>`;
}

function documentCard(doc) {
  if (!doc) {
    return `<div class="note note-warn" style="margin-top:12px">
      <b>No document was examined in this session.</b></div>`;
  }
  const tone = doc.status === 'passed' ? 'note-info' : doc.status === 'failed' ? 'note-danger' : 'note-warn';
  return `<div class="note ${tone}" style="margin-top:12px">
    <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
      <b style="font-size:13px">The document itself</b>
      <span class="badge b-${doc.status === 'passed' ? 'passed' : doc.status === 'failed' ? 'failed' : 'review'}"
        >${esc(titleCase(doc.status))}</span>
      <span class="mono muted">${esc(doc.score)}/100</span>
    </div>
    ${doc.findings.length ? `<div style="margin-top:8px">
      ${doc.findings.map((f) => `<div>· ${esc(f.name)}
        <span class="mono muted">−${esc(f.weight)}</span>
        ${f.severity === 'critical' ? '<span class="veto-tag">critical</span>' : ''}</div>`).join('')}
    </div>` : '<div style="margin-top:8px">Nothing inconsistent was found between the portrait and the card it is printed on.</div>'}
    ${doc.mrz ? `<div style="margin-top:8px">Machine-readable zone:
      <b>${doc.mrz.valid ? 'every check digit holds' : 'a check digit fails'}</b>.</div>` : ''}
  </div>`;
}

// ── 5 · The agents ──────────────────────────────────────────────
function renderDecideStep(body, title, sub) {
  stopStage();
  title.textContent = 'Decision';
  sub.textContent = 'What the agents concluded, and what you do with it';
  body.innerHTML = `<div id="wizDecideBody">${loading()}</div>`;
}

const VERDICT_ICON = {
  pass: '<path d="M4 10.5l4 4 8-9" stroke-linecap="round" stroke-linejoin="round"/>',
  concern: '<path d="M10 4.5v7M10 14.2v.4" stroke-linecap="round"/><circle cx="10" cy="10" r="8"/>',
  fail: '<path d="M6 6l8 8M14 6l-8 8" stroke-linecap="round"/>',
  abstain: '<path d="M5 10h10" stroke-linecap="round"/><circle cx="10" cy="10" r="8"/>',
};

async function runAgents() {
  const card = document.getElementById('agentCard');
  const bodyEl = document.getElementById('agentBody');
  const decide = document.getElementById('wizDecideBody');
  card.style.display = '';
  bodyEl.innerHTML = loading();

  try {
    const run = await DB.adjudicate({
      sessionId: WIZ.sessionId,
      evidence: {
        identity: WIZ.identity,
        consented: WIZ.consented,
        document: WIZ.reconciliation?.document ?? null,
        comparisons: WIZ.reconciliation?.comparisons ?? {},
        depth: WIZ.depth,
      },
    });
    WIZ.run = run;

    const kind = run.recommendation === 'approve' ? 'note-info'
      : run.recommendation === 'decline' ? 'note-danger' : 'note-warn';

    bodyEl.innerHTML = `
      <div class="note ${kind}">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <b style="font-size:14px">${esc(titleCase(run.recommendation))}</b>
          <span class="badge b-${run.recommendation === 'approve' ? 'passed'
            : run.recommendation === 'decline' ? 'failed' : 'review'}">${esc(run.confidence)}% confidence</span>
          ${run.vetoedBy ? `<span class="veto-tag">vetoed by ${esc(run.vetoedBy.replace(/_/g, ' '))}</span>` : ''}
        </div>
        <div style="margin-top:7px">${esc(run.summary)}</div>
        <div style="margin-top:7px;font-size:11px">
          <b>This is a recommendation, not a decision.</b> A person applies it, and an override is
          recorded against their account. Every agent below is a rule over the evidence — nothing
          here is a language model, which is why the same file always produces the same answer.
        </div>
      </div>

      <div style="margin-top:14px">
        ${run.decisions.map((d) => `
          <div class="agent">
            <div class="agent-icon agent-${esc(d.verdict)}">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">${VERDICT_ICON[d.verdict] ?? ''}</svg>
            </div>
            <div style="min-width:0;flex:1">
              <div class="agent-name">${esc(d.name)}
                ${badge(d.verdict === 'pass' ? 'passed' : d.verdict === 'fail' ? 'failed'
                  : d.verdict === 'concern' ? 'review' : 'skipped')}
                ${d.canVeto ? '<span class="veto-tag">can veto</span>' : ''}
                <span class="mono muted" style="margin-left:auto;font-size:10.5px">${esc(d.confidence)}%</span>
              </div>
              <div class="agent-remit">${esc(d.remit ?? '')}</div>
              <div class="agent-rationale">${esc(d.rationale)}</div>
            </div>
          </div>`).join('')}
      </div>`;

    const cmp = WIZ.reconciliation?.comparisons?.selfie_vs_document;
    decide.innerHTML = `
      <dl class="kv">
        <dt>Session</dt><dd class="mono">${esc(WIZ.sessionId)}</dd>
        <dt>Applicant</dt><dd>${esc(WIZ.subject?.name ?? '—')}
          <span class="mono muted">••• ${esc(WIZ.identity?.last4 ?? '····')}</span></dd>
        <dt>Document match</dt><dd>${cmp
          ? (cmp.matched ? `<span class="badge b-passed">Matched · ${esc(cmp.similarity)}</span>`
             : '<span class="badge b-failed">No match</span>')
          : '<span class="muted">Not run</span>'}</dd>
        <dt>Presence</dt><dd>${WIZ.depth
          ? (WIZ.depth.verdict === 'three_dimensional'
              ? '<span class="badge b-passed">Depth confirmed</span>'
              : WIZ.depth.verdict === 'flat'
                ? '<span class="badge b-failed">Flat</span>'
                : '<span class="badge b-review">Inconclusive</span>')
          : '<span class="muted">Not scanned</span>'}</dd>
        <dt>Document</dt><dd>${WIZ.reconciliation?.document
          ? `${esc(titleCase(WIZ.reconciliation.document.status))}
             <span class="mono muted">${esc(WIZ.reconciliation.document.score)}/100</span>`
          : '<span class="muted">Not examined</span>'}</dd>
        <dt>Recommendation</dt><dd><b>${esc(titleCase(run.recommendation))}</b></dd>
      </dl>
      <div style="display:flex;gap:7px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="wizAccept">Accept and onboard</button>
        <button class="btn btn-sm" id="wizOverride">Override</button>
      </div>
      <div id="wizFinal"></div>`;

    document.getElementById('wizAccept').addEventListener('click', () => applyDecision('accepted'));
    document.getElementById('wizOverride').addEventListener('click', () => applyDecision('overridden'));
  } catch (e) {
    bodyEl.innerHTML = errorState(e);
    if (decide) decide.innerHTML = '';
  }
}

async function applyDecision(outcome) {
  const out = document.getElementById('wizFinal');
  let reason;
  if (outcome === 'overridden') {
    reason = prompt('The agents recommended '
      + `"${WIZ.run.recommendation}". What are you deciding instead, and why?`);
    if (!reason) return;
  }

  out.innerHTML = loading();
  try {
    await DB.applyAgentDecision(WIZ.run.runId, outcome, reason);

    let customer = null;
    const approving = outcome === 'accepted' && WIZ.run.recommendation === 'approve';
    if (approving && WIZ.subject?.caseId) {
      try {
        customer = await DB.onboardCustomer({ caseId: WIZ.subject.caseId });
      } catch (e) {
        out.innerHTML = `<div class="note note-warn" style="margin-top:12px">
          Decision recorded. The customer record was not created: ${esc(e.message)}</div>
          <button class="btn btn-sm" style="margin-top:10px" id="wizRestart">Start another</button>`;
        document.getElementById('wizRestart').addEventListener('click', () => go('onboard'));
        return;
      }
    }

    out.innerHTML = `<div class="note ${approving ? 'note-info' : 'note-warn'}" style="margin-top:12px">
      <b>${outcome === 'accepted' ? 'Recommendation applied' : 'Overridden'}.</b>
      ${customer ? `<br>Customer <span class="mono">${esc(customer.customerId)}</span> created.` : ''}
      </div>
      <button class="btn btn-sm" style="margin-top:10px" id="wizRestart">Start another</button>`;

    document.getElementById('wizRestart').addEventListener('click', () => go('onboard'));
    toast(outcome === 'accepted' ? 'Recommendation applied' : 'Decision overridden', 'ok');
  } catch (e) {
    out.innerHTML = errorState(e);
  }
}

// ── The camera stage ────────────────────────────────────────────
async function startStage(facing) {
  const stage = document.getElementById('stage');
  const actions = document.getElementById('stageActions');
  if (!stage) return;

  stopStage();
  const lib = await captureLib();
  const ctx = cameraContext();

  if (!ctx.ok || !lib.cameraAvailable()) {
    stage.className = 'stage';
    stage.innerHTML = `<div class="stage-empty">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"><rect x="2" y="5" width="16" height="11" rx="2"/>
      <path d="M4 4l12 12" stroke-linecap="round"/></svg>
      <div>${esc(ctx.advice ?? 'No camera is available here.')}<br>
      Use <b>Upload</b> — the capture is recorded as an upload, not a live capture.</div></div>`;
    return;
  }

  WIZ.facing = facing;
  stage.className = `stage ${facing === 'user' ? 'mirrored' : ''}`;
  stage.innerHTML = `<video id="stageVideo" autoplay playsinline muted></video>
    ${facing === 'user' ? '<div class="stage-guide"></div>' : '<div class="stage-card-guide"></div>'}
    <div class="stage-badge"><span class="dot"></span>LIVE</div>`;

  try {
    WIZ.stream = await lib.startCamera(document.getElementById('stageVideo'), { facingMode: facing });
    WIZ.cameraOn = true;
    WIZ.cameras = await lib.listCameras();
    startMetricsLoop();

    // A phone has two cameras and the wrong one is always the one that
    // opens. A laptop has one, and a button that does nothing is worse
    // than no button.
    actions.innerHTML = `${WIZ.cameras.length > 1
      ? '<button class="btn btn-sm" id="stageFlip">Switch camera</button>' : ''}
      <button class="btn btn-sm" id="stageStop">Stop camera</button>`;
    document.getElementById('stageStop').addEventListener('click', stopStage);
    document.getElementById('stageFlip')?.addEventListener('click',
      () => startStage(WIZ.facing === 'user' ? 'environment' : 'user'));
  } catch (e) {
    stage.innerHTML = `<div class="stage-empty"><div>${esc(e.message)}</div></div>`;
    const metrics = document.getElementById('metrics');
    if (metrics) metrics.innerHTML = '';
  }
}

function stopStage() {
  if (WIZ.metricsTimer) { clearInterval(WIZ.metricsTimer); WIZ.metricsTimer = null; }
  if (WIZ.stream) {
    captureLib().then((lib) => lib.stopCamera(WIZ.stream));
    WIZ.stream = null;
  }
  WIZ.cameraOn = false;
  const actions = document.getElementById('stageActions');
  if (actions) actions.innerHTML = '';
}

// Freezes the captured frame in the stage so the operator sees exactly
// what was assessed, rather than a live view that has already moved on.
function showFrozen(canvas) {
  const stage = document.getElementById('stage');
  if (!stage) return;
  stopStage();
  stage.className = 'stage';
  stage.innerHTML = '';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.objectFit = 'contain';
  stage.appendChild(canvas);
}

// Measures the live frame a few times a second so the operator can fix
// the lighting before capturing rather than after.
function startMetricsLoop() {
  if (WIZ.metricsTimer) clearInterval(WIZ.metricsTimer);
  WIZ.metricsTimer = setInterval(async () => {
    const video = document.getElementById('stageVideo');
    const el = document.getElementById('metrics');
    if (!video || !el || !WIZ.cameraOn) return;
    try {
      const lib = await captureLib();
      const m = lib.measureQuality(lib.grabFrame(video));
      el.innerHTML = renderMetrics(m, null);
    } catch { /* the frame may not be ready between renders */ }
  }, 700);
}

function renderMetrics(m, faces) {
  const sharpState = m.sharpness > 120 ? 'ok' : m.sharpness > 60 ? 'warn' : 'bad';
  const brightState = m.brightness >= 28 && m.brightness <= 90 ? 'ok'
    : m.brightness >= 20 && m.brightness <= 94 ? 'warn' : 'bad';
  const contrastState = m.contrast > 18 ? 'ok' : m.contrast > 12 ? 'warn' : 'bad';

  return metricTile('Sharpness', Math.round(m.sharpness), sharpState)
    + metricTile('Brightness', m.brightness, brightState, '%')
    + metricTile('Contrast', m.contrast, contrastState, '%')
    + metricTile('Resolution', `${m.width}×${m.height}`, m.width >= 640 ? 'ok' : 'warn')
    + (faces ? metricTile('Faces', faces.count, faces.count === 1 ? 'ok' : 'bad') : '');
}

function refusal(quality) {
  return `<div class="note note-danger" style="margin-top:12px">
    <b>Capture refused — score ${esc(quality.score)}.</b><br>
    ${esc((quality.reason_codes ?? []).map(titleCase).join(' · '))}
    <div style="margin-top:6px"><b>${esc(remedyText(quality.reason_codes ?? []))}</b></div>
    <div style="margin-top:6px;font-size:11px">Nothing was templated or compared. Most failed matches
    are failed photographs, and telling you "no match" when the real answer is "too dark" would send
    you after the wrong problem.</div></div>`;
}

function continueButton(id, label) {
  return `<button class="btn btn-primary btn-sm" style="margin-top:12px" id="${id}">${esc(label)}</button>`;
}

function remedyText(codes) {
  if (codes.includes('image_too_blurred')) return 'Hold the camera steady and try again.';
  if (codes.includes('image_too_dark')) return 'Move somewhere brighter, or turn a light on.';
  if (codes.includes('image_overexposed')) return 'Move out of direct light.';
  if (codes.includes('no_face_detected')) return 'Make sure the face is inside the guide.';
  if (codes.includes('more_than_one_face')) return 'Only the applicant should be in frame.';
  if (codes.includes('face_too_small_in_frame')) return 'Move closer to the camera.';
  if (codes.includes('resolution_too_low')) return 'Move closer, or use a better camera.';
  if (codes.includes('low_contrast')) return 'Photograph the document itself, not a screen showing it.';
  return 'Retake the capture.';
}
