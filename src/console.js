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
  { id: 'onboard',    label: 'Capture',  title: 'Live Capture & Onboarding',    sub: 'Scan the document, photograph the person, match them, let the agents decide' },
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
      ${timeline}`,
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
        <td>${badge(e.entry_type === 'sanction' ? 'rejected' : e.entry_type === 'pep' ? 'review' : 'none')}
          <span class="muted" style="font-size:10.5px">${esc(titleCase(e.entry_type))}</span></td>
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
      <td>${badge(p.environment === 'production' ? 'verified' : 'pending')}
        <span class="muted" style="font-size:10.5px">${esc(titleCase(p.environment))}</span></td>
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
            ? esc(b.on_time_pct) + '% on time · ' + esc(b.reversals) + ' reversal(s)'
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
      <td>${badge(a.asset_type.startsWith('vehicle') ? 'identity' : 'document')}
        <span class="muted" style="font-size:10.5px">${esc(titleCase(a.asset_type))}</span></td>
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
        <td>${badge(s.status === 'paid' ? 'passed' : s.status === 'missed' ? 'failed'
              : s.status === 'partial' ? 'review' : 'pending')}
          <span class="muted" style="font-size:10.5px">${esc(titleCase(s.status))}</span></td>
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
      <td>${badge(a.severity === 'critical' || a.severity === 'high' ? 'failed'
            : a.severity === 'medium' ? 'review' : 'passed')}
        <span class="muted" style="font-size:10.5px">${esc(titleCase(a.severity))}</span></td>
      <td class="mono">${a.score}</td>
      <td>${esc(custById.get(a.customer_id)?.customer_number ?? a.case_id ?? '—')}</td>
      <td class="mono">${a.signal_count} <span class="muted">(${a.critical_count} critical)</span></td>
      <td>${badge(a.status === 'confirmed_fraud' ? 'failed'
            : a.status === 'false_positive' ? 'passed' : 'review')}
        <span class="muted" style="font-size:10.5px">${esc(titleCase(a.status))}</span></td>
      <td class="muted">${fmtDateTime(a.created_at)}</td>
    </tr>`).join('') : `<tr><td colspan="6">${emptyState('No alerts raised.')}</td></tr>`;

  const byRule = {};
  signals.forEach((s) => { byRule[s.rule_code] = (byRule[s.rule_code] ?? 0) + 1; });
  const ruleRows = rules.map((r) => `
    <tr>
      <td><b>${esc(r.name)}</b>
        <div class="muted" style="font-size:10.5px;max-width:520px">${esc(r.description)}</div></td>
      <td>${badge(r.domain === 'document' ? 'document' : r.domain === 'identity' ? 'identity'
            : r.domain === 'employment' || r.domain === 'banking' ? 'credit' : 'biometric')}
        <span class="muted" style="font-size:10.5px">${esc(titleCase(r.domain))}</span></td>
      <td>${badge(r.severity === 'critical' ? 'failed' : r.severity === 'warn' ? 'review' : 'passed')}</td>
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
  badgeEl.textContent = DB.env === 'production' ? 'Production' : 'Sandbox';
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
  metricsTimer: null,
  captures: {},
  match: null,
  run: null,
  liveness: null,
  fingerprint: null,
  subject: null,
};

const WIZ_STEPS = [
  { id: 'subject',  label: 'Applicant' },
  { id: 'document', label: 'Scan document' },
  { id: 'selfie',   label: 'Live photograph' },
  { id: 'finger',   label: 'Fingerprint' },
  { id: 'decide',   label: 'Agents decide' },
];

let CAPTURE_LIB = null;
async function captureLib() {
  // The same module the pipeline's quality thresholds were written
  // against — one implementation, loaded on demand because it is only
  // needed on this page.
  if (!CAPTURE_LIB) CAPTURE_LIB = await import('./capture.js');
  return CAPTURE_LIB;
}

function stepRail() {
  return `<div class="steps">${WIZ_STEPS.map((st, i) => `
    <div class="step ${i === WIZ.step ? 'active' : ''} ${i < WIZ.step ? 'done' : ''}">
      <span class="step-no">${i < WIZ.step ? '✓' : i + 1}</span>${esc(st.label)}
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
  const hasCamera = lib.cameraAvailable();
  const hasFaceApi = lib.faceDetectionAvailable();
  const platforms = await DB.fetchPlatforms();

  return `
  ${stepRail()}
  <div class="g2" style="align-items:start">
    <div class="card" style="margin-top:0">
      <div class="card-hdr"><div><div class="card-title" id="wizTitle">Applicant</div>
        <div class="card-sub" id="wizSub">Who is being onboarded, and under what consent</div></div></div>
      <div class="card-body" id="wizBody">${loading()}</div>
    </div>

    <div class="card" style="margin-top:0">
      <div class="card-hdr"><div><div class="card-title">Capture</div>
        <div class="card-sub">Quality is measured from the pixels, live</div></div>
        <div class="card-actions" id="stageActions"></div></div>
      <div class="card-body">
        <div class="stage" id="stage">
          <div class="stage-empty">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">
              <rect x="2" y="5" width="16" height="11" rx="2"/><circle cx="10" cy="10.5" r="3"/>
              <path d="M7 5l1-1.6h4L13 5" stroke-linejoin="round"/></svg>
            <div>The camera starts at the scan and photograph steps.</div>
          </div>
        </div>
        <div class="metrics" id="metrics"></div>
        <div id="captureNote"></div>
      </div>
    </div>
  </div>

  ${!hasCamera ? `<div class="note note-warn">
    <b>No camera is available in this context.</b> Captures fall back to file upload, which is a
    weaker signal — an uploaded selfie proves far less than one taken under observation, and the
    system records which it was.</div>` : ''}
  ${!hasFaceApi ? `<div class="note note-info">
    <b>Face detection is not available in this browser.</b> Sharpness, brightness and contrast are
    still measured from the pixels; face presence and framing are recorded as
    <i>not measured</i> rather than assumed, so a missing detector never reads as a missing face.</div>` : ''}

  <div class="card" id="agentCard" style="display:none">
    <div class="card-hdr"><div><div class="card-title">Agent adjudication</div>
      <div class="card-sub">Six agents, each owning one question. A recommendation, not a decision.</div></div></div>
    <div class="card-body" id="agentBody"></div>
  </div>

  <input type="hidden" id="wizPlatforms" value="${esc(JSON.stringify(platforms.map((p) => ({ id: p.id, name: p.name }))))}">`;
};

WIRE.onboard = () => {
  WIZ.step = 0;
  WIZ.captures = {};
  WIZ.match = null;
  WIZ.run = null;
  renderWizStep();
};

function renderWizStep() {
  const body = document.getElementById('wizBody');
  const title = document.getElementById('wizTitle');
  const sub = document.getElementById('wizSub');
  const actions = document.getElementById('stageActions');
  if (!body) return;

  document.querySelectorAll('.steps').forEach((el) => { el.outerHTML = stepRail(); });
  actions.innerHTML = '';

  const step = WIZ_STEPS[WIZ.step];

  if (step.id === 'subject') {
    title.textContent = 'Applicant';
    sub.textContent = 'Who is being onboarded, and under what consent';
    const platforms = JSON.parse(document.getElementById('wizPlatforms')?.value ?? '[]');
    body.innerHTML = `
      <div class="field"><label for="wizPlatform">Platform</label>
        <select id="wizPlatform">${platforms.map((p) =>
          `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="row2">
        <div class="field"><label for="wizFirst">First names</label><input id="wizFirst" placeholder="Thabo"></div>
        <div class="field"><label for="wizSurname">Surname</label><input id="wizSurname" placeholder="Mokoena"></div>
      </div>
      <div class="field"><label for="wizId">SA ID number</label>
        <input id="wizId" class="mono" maxlength="20" placeholder="13 digits">
        <div class="hint" id="wizIdHint">Checked arithmetically as you type. The number is never stored — only a peppered hash.</div></div>
      <div class="field"><label for="wizChannel">Where is this happening?</label>
        <select id="wizChannel">
          <option value="branch">Branch counter</option>
          <option value="dealership">Dealership floor</option>
          <option value="field_agent">Field agent</option>
          <option value="self_service">Self-service — applicant's own device</option>
        </select>
        <div class="hint">An unobserved self-service capture is worth less than one taken at a counter, and is recorded as such.</div></div>
      <label style="display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.55;margin-top:4px">
        <input type="checkbox" id="wizConsent" style="width:auto;margin-top:2px">
        <span>The applicant has explicitly consented to biometric processing. POPIA s26 makes biometric
        data special personal information; s27 requires this and will not accept legitimate interest.</span>
      </label>
      <button class="btn btn-primary btn-sm" style="margin-top:14px" id="wizStart">Start capture session</button>
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
    return;
  }

  if (step.id === 'document') {
    title.textContent = 'Scan the identity document';
    sub.textContent = 'The portrait on the document becomes the reference the live photograph is matched against';
    body.innerHTML = `
      <div class="note note-info">Photograph the document itself, flat and filling the frame.
      A picture of a screen showing the document reads as low contrast and will be refused.</div>
      <div class="field" style="margin-top:12px"><label for="wizDocType">Document type</label>
        <select id="wizDocType">
          <option value="sa_id_card">SA Smart ID Card</option>
          <option value="sa_id_book">SA Green Barcoded ID Book</option>
          <option value="passport">Passport</option>
          <option value="drivers_licence">SA Driving Licence Card</option>
        </select></div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-primary btn-sm" id="wizDocCapture">Capture from camera</button>
        <button class="btn btn-sm" id="wizDocUploadBtn">Upload instead</button>
        <input type="file" id="wizDocUpload" accept="image/*" hidden>
      </div>
      <div id="wizDocResult"></div>`;

    document.getElementById('wizDocCapture').addEventListener('click', () => doCapture('document_front'));
    document.getElementById('wizDocUploadBtn').addEventListener('click',
      () => document.getElementById('wizDocUpload').click());
    document.getElementById('wizDocUpload').addEventListener('change', (e) => {
      if (e.target.files?.[0]) doUpload('document_front', e.target.files[0]);
    });
    startStage('environment');
    return;
  }

  if (step.id === 'selfie') {
    title.textContent = 'Photograph the applicant';
    sub.textContent = 'Liveness is checked first — a match computed from a photograph is worse than no match';
    body.innerHTML = `
      <div class="note note-info">The applicant should look straight at the camera, with their face
      filling the guide. Liveness runs before the comparison: if the capture fails it, no similarity
      is computed at all.</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary btn-sm" id="wizSelfieCapture">Capture and match</button>
        <button class="btn btn-sm" id="wizSelfieUploadBtn">Upload instead</button>
        <input type="file" id="wizSelfieUpload" accept="image/*" hidden>
      </div>
      <div id="wizSelfieResult"></div>`;

    document.getElementById('wizSelfieCapture').addEventListener('click', () => doCapture('selfie'));
    document.getElementById('wizSelfieUploadBtn').addEventListener('click',
      () => document.getElementById('wizSelfieUpload').click());
    document.getElementById('wizSelfieUpload').addEventListener('change', (e) => {
      if (e.target.files?.[0]) doUpload('selfie', e.target.files[0]);
    });
    startStage('user');
    return;
  }

  if (step.id === 'finger') {
    title.textContent = 'Fingerprint';
    sub.textContent = 'The device verifies its owner with its own sensor';
    stopStage();
    body.innerHTML = `
      <div class="note note-warn">
        <b>What this actually proves, and what it does not.</b> A browser cannot read a fingerprint
        scanner. WebAuthn asks the device to verify its owner with its own sensor and returns a
        signed assertion — the template never leaves the secure element, and neither this page nor
        the hub ever sees it. So this proves <i>the enrolled owner of this device was present</i>,
        not that a particular person's finger was. AFIS-grade capture needs a scanner behind the
        provider interface.
      </div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary btn-sm" id="wizFinger">Capture fingerprint</button>
        <button class="btn btn-sm" id="wizFingerSkip">Skip this step</button>
      </div>
      <div id="wizFingerResult"></div>`;

    document.getElementById('wizFinger').addEventListener('click', doFingerprint);
    document.getElementById('wizFingerSkip').addEventListener('click', () => {
      WIZ.step = 4; renderWizStep(); runAgents();
    });
    return;
  }

  // decide
  title.textContent = 'Decision';
  sub.textContent = 'What the agents concluded, and what you do with it';
  stopStage();
  body.innerHTML = `<div id="wizDecideBody">${loading()}</div>`;
}

// ── Session ─────────────────────────────────────────────────────
async function startSession() {
  const out = document.getElementById('wizStartResult');
  const platformId = document.getElementById('wizPlatform').value;
  const firstNames = document.getElementById('wizFirst').value.trim();
  const surname = document.getElementById('wizSurname').value.trim();
  const idNumber = document.getElementById('wizId').value.trim();
  const channel = document.getElementById('wizChannel').value;
  const consented = document.getElementById('wizConsent').checked;

  if (!idNumber) { toast('An ID number is required', 'err'); return; }
  if (!consented) {
    out.innerHTML = `<div class="note note-danger" style="margin-top:12px">
      <b>Consent is a precondition, not a formality.</b> The database refuses to store a biometric
      template without it — this is a constraint, not a checkbox the code can skip.</div>`;
    return;
  }

  out.innerHTML = loading();
  try {
    // Identity first: the case establishes the subject the captures
    // will hang off, and a customer cannot exist without it.
    const identity = await DB.verifyIdentity({
      idNumber, firstNames, surname, platformId, level: 'standard', purpose: 'onboarding',
    });
    WIZ.subject = { id: identity.subjectId, caseId: identity.caseId, name: [firstNames, surname].filter(Boolean).join(' ') };

    const session = await DB.openCaptureSession({
      platformId,
      caseId: identity.caseId,
      subjectId: identity.subjectId,
      channel,
      requiredSteps: ['consent', 'document', 'selfie', 'match'],
    });
    WIZ.sessionId = session.sessionId;

    out.innerHTML = `<div class="note note-info" style="margin-top:12px">
      Session <b>${esc(session.sessionId)}</b> open · case <b>${esc(identity.caseId)}</b>.
      ${identity.identity?.structureValid
        ? `Identity number valid · born ${fmtDate(identity.identity.dateOfBirth)}.`
        : `<span style="color:var(--red)">Identity number failed its check digit.</span>`}
      </div>`;

    WIZ.step = 1;
    setTimeout(renderWizStep, 600);
  } catch (e) {
    out.innerHTML = errorState(e);
  }
}

// ── Camera stage ────────────────────────────────────────────────
async function startStage(facingMode) {
  const stage = document.getElementById('stage');
  const actions = document.getElementById('stageActions');
  if (!stage) return;

  const lib = await captureLib();
  if (!lib.cameraAvailable()) {
    stage.innerHTML = `<div class="stage-empty">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"><rect x="2" y="5" width="16" height="11" rx="2"/>
      <path d="M4 4l12 12" stroke-linecap="round"/></svg>
      <div>No camera here. Use <b>Upload instead</b> — the capture is recorded as an upload, not a live capture.</div></div>`;
    return;
  }

  stage.className = `stage ${facingMode === 'user' ? 'mirrored' : ''}`;
  stage.innerHTML = `<video id="stageVideo" autoplay playsinline muted></video>
    <div class="stage-guide"></div>
    <div class="stage-badge"><span class="dot"></span>LIVE</div>`;

  actions.innerHTML = `<button class="btn btn-sm" id="stageStop">Stop camera</button>`;
  document.getElementById('stageStop').addEventListener('click', stopStage);

  try {
    WIZ.stream = await lib.startCamera(document.getElementById('stageVideo'), { facingMode });
    WIZ.cameraOn = true;
    startMetricsLoop();
  } catch (e) {
    stage.innerHTML = `<div class="stage-empty"><div>${esc(e.message)}</div></div>`;
    document.getElementById('metrics').innerHTML = '';
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
    + metricTile('Resolution', `${m.width}×${m.height}`,
        m.width >= 640 ? 'ok' : 'warn')
    + (faces
        ? metricTile('Faces', faces.count, faces.count === 1 ? 'ok' : 'bad')
        : '');
}

// ── Capture ─────────────────────────────────────────────────────
async function doCapture(captureType) {
  const video = document.getElementById('stageVideo');
  if (!video || !WIZ.cameraOn) { toast('Start the camera first', 'err'); return; }
  const lib = await captureLib();
  await handleCapture(captureType, await lib.captureAndMeasure(video, { captureType }), 'live_camera', video);
}

async function doUpload(captureType, file) {
  const lib = await captureLib();
  const canvas = await lib.fileToCanvas(file);
  await handleCapture(captureType, await lib.captureAndMeasure(canvas, { captureType }), 'upload', null);
}

async function handleCapture(captureType, measured, source, videoEl) {
  const resultEl = document.getElementById(
    captureType === 'selfie' ? 'wizSelfieResult' : 'wizDocResult');
  const noteEl = document.getElementById('captureNote');
  const lib = await captureLib();

  document.getElementById('metrics').innerHTML =
    renderMetrics(measured.metrics, measured.faces);

  // Freeze the frame so the operator sees exactly what was assessed.
  const stage = document.getElementById('stage');
  if (stage) {
    const shot = measured.canvas;
    stage.innerHTML = '';
    shot.style.width = '100%'; shot.style.height = '100%'; shot.style.objectFit = 'cover';
    stage.appendChild(shot);
  }

  // The same rules the pipeline uses, checked before anything is sent.
  let quality;
  try {
    quality = await DB.checkCaptureQuality(captureType, measured.metrics);
  } catch (e) { resultEl.innerHTML = errorState(e); return; }

  const advisories = quality.advisories ?? [];
  const advisoryNote = advisories.length
    ? `<div style="margin-top:7px;font-size:11px;color:var(--ink3)">
        Confidence lowered: ${esc(advisories.map(titleCase).join(' · '))}. Not a fault in the
        photograph — this browser could not measure it.</div>`
    : '';

  if (quality.passed === false) {
    noteEl.innerHTML = '';
    resultEl.innerHTML = `<div class="note note-danger" style="margin-top:12px">
      <b>Capture refused — score ${esc(quality.score)}.</b><br>
      ${esc((quality.reason_codes ?? []).map(titleCase).join(' · '))}
      <div style="margin-top:6px"><b>${esc(remedyText(quality.reason_codes ?? []))}</b></div>
      ${advisoryNote}
      </div>`;
    setTimeout(() => startStage(captureType === 'selfie' ? 'user' : 'environment'), 1800);
    return;
  }

  resultEl.innerHTML = loading();

  // Liveness runs on the live stream, before the match, and only where
  // there is a stream to run it on.
  let clientLiveness = null;
  if (captureType === 'selfie' && videoEl && WIZ.cameraOn) {
    noteEl.innerHTML = `<div class="note note-info">Checking for presentation attack…</div>`;
    clientLiveness = await lib.passiveLiveness(videoEl);
    noteEl.innerHTML = clientLiveness.available
      ? `<div class="note ${clientLiveness.looksStatic ? 'note-danger' : 'note-info'}">
          <b>Motion ${clientLiveness.motion}</b> — ${esc(clientLiveness.note)}</div>`
      : '';
  }

  try {
    const blob = await lib.canvasToBlob(measured.canvas, 'image/jpeg', 0.9);
    const imageBase64 = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });

    // A document scan carries the portrait the selfie is matched to, so
    // it is sent twice: once as the scan, once as the cropped face.
    const res = await DB.submitCapture({
      sessionId: WIZ.sessionId, captureType, source, imageBase64,
      metrics: measured.metrics, liveness: clientLiveness,
    });

    WIZ.captures[captureType] = res;

    if (captureType === 'document_front' && measured.faces?.largest) {
      const portrait = lib.cropFace(measured.canvas, measured.faces.largest);
      const pMeasured = await lib.captureAndMeasure(portrait, { captureType: 'document_portrait' });
      const pBlob = await lib.canvasToBlob(portrait, 'image/jpeg', 0.92);
      const pB64 = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(pBlob);
      });
      const pRes = await DB.submitCapture({
        sessionId: WIZ.sessionId, captureType: 'document_portrait', source,
        imageBase64: pB64, metrics: pMeasured.metrics,
      });
      WIZ.captures.document_portrait = pRes;
    }

    if (captureType === 'document_front') {
      const enrolled = !!WIZ.captures.document_portrait?.template;
      resultEl.innerHTML = `<div class="note ${enrolled ? 'note-info' : 'note-warn'}" style="margin-top:12px">
        <b>Document accepted — quality ${esc(quality.score)}.</b><br>
        ${advisoryNote}
        ${enrolled
          ? 'The portrait was found and enrolled as the reference for the live photograph.'
          : measured.faces === null
            ? 'No face detector in this browser, so the portrait could not be cropped automatically. '
              + 'The live photograph will have nothing to match against.'
            : 'No portrait was found on this document. The live photograph will have nothing to match against.'}
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:10px" id="wizNextSelfie">Continue to the photograph</button>`;
      document.getElementById('wizNextSelfie').addEventListener('click', () => {
        WIZ.step = 2; renderWizStep();
      });
      return;
    }

    // Selfie
    if (res.accepted === false && res.liveness) {
      resultEl.innerHTML = `<div class="note note-danger" style="margin-top:12px">
        <b>Presentation attack detected — ${esc(titleCase(res.liveness.attackType ?? 'unknown'))}.</b><br>
        ${esc(res.liveness.note ?? '')}
        </div>
        <button class="btn btn-sm" style="margin-top:10px" id="wizRetrySelfie">Retake</button>
        <button class="btn btn-primary btn-sm" style="margin-top:10px" id="wizPushOn">Continue to the agents</button>`;
      document.getElementById('wizRetrySelfie').addEventListener('click',
        () => { WIZ.step = 2; renderWizStep(); });
      document.getElementById('wizPushOn').addEventListener('click',
        () => { WIZ.step = 3; renderWizStep(); });
      return;
    }

    WIZ.match = res.match;
    WIZ.liveness = res.liveness;

    resultEl.innerHTML = renderMatch(res)
      + `<button class="btn btn-primary btn-sm" style="margin-top:10px" id="wizNextFinger">Continue</button>`;
    document.getElementById('wizNextFinger').addEventListener('click', () => {
      WIZ.step = 3; renderWizStep();
    });
  } catch (e) {
    resultEl.innerHTML = errorState(e);
  }
}

function renderMatch(res) {
  if (!res.match) {
    return `<div class="note note-warn" style="margin-top:12px">
      <b>Capture accepted, but nothing to match against.</b><br>
      ${esc(res.note ?? 'No document portrait has been enrolled.')}</div>`;
  }
  const m = res.match;
  const kind = m.matched ? (m.confidence >= 80 ? 'note-info' : 'note-warn') : 'note-danger';
  return `<div class="note ${kind}" style="margin-top:12px">
    <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
      <b style="font-size:13px">${m.matched ? 'Faces match' : 'No match'}</b>
      <span class="badge b-${m.matched ? 'passed' : 'failed'}">${esc(m.confidence)}% confidence</span>
    </div>
    <dl class="kv" style="margin-top:9px">
      <dt>Similarity</dt><dd class="mono">${esc(m.similarity)}</dd>
      <dt>Threshold</dt><dd class="mono">${esc(m.threshold)} at FMR ${esc(m.operatingFmr)}</dd>
      <dt>Liveness</dt><dd>${res.liveness?.passed
        ? `<span class="badge b-passed">Live subject</span>` : '<span class="muted">—</span>'}</dd>
      <dt>Capture quality</dt><dd class="mono">${esc(res.quality?.score ?? '—')}</dd>
    </dl>
    <div style="margin-top:8px;font-size:11px;color:var(--ink3)">
      The threshold is the model's calibrated cut-off at the operating false-match rate, not an
      arbitrary percentage. Confidence is the margin past it, so a borderline pass reads as one.
    </div>
  </div>`;
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

// ── Fingerprint ─────────────────────────────────────────────────
async function doFingerprint() {
  const out = document.getElementById('wizFingerResult');
  out.innerHTML = loading();
  try {
    const lib = await captureLib();
    const fp = await lib.captureFingerprint({ subjectLabel: WIZ.subject?.name ?? 'Applicant' });
    WIZ.fingerprint = fp;

    await DB.submitCapture({
      sessionId: WIZ.sessionId, captureType: 'fingerprint', fingerprint: fp,
    });

    out.innerHTML = `<div class="note note-info" style="margin-top:12px">
      <b>Device verified its owner.</b><br>${esc(fp.note)}</div>
      <button class="btn btn-primary btn-sm" style="margin-top:10px" id="wizToAgents">Run the agents</button>`;
    document.getElementById('wizToAgents').addEventListener('click', () => {
      WIZ.step = 4; renderWizStep(); runAgents();
    });
  } catch (e) {
    out.innerHTML = `<div class="note note-warn" style="margin-top:12px">${esc(e.message)}</div>
      <button class="btn btn-primary btn-sm" style="margin-top:10px" id="wizSkipToAgents">Continue without it</button>`;
    document.getElementById('wizSkipToAgents').addEventListener('click', () => {
      WIZ.step = 4; renderWizStep(); runAgents();
    });
  }
}

// ── Agents ──────────────────────────────────────────────────────
const VERDICT_ICON = {
  pass: '<path d="M4 10.5l4 4 8-9" stroke-linecap="round" stroke-linejoin="round"/>',
  concern: '<path d="M10 4.5v7M10 14.2v.4" stroke-linecap="round"/><circle cx="10" cy="10" r="8"/>',
  fail: '<path d="M6 6l8 8M14 6l-8 8" stroke-linecap="round"/>',
  abstain: '<path d="M5 10h10" stroke-linecap="round"/><circle cx="10" cy="10" r="8"/>',
};

async function runAgents() {
  const card = document.getElementById('agentCard');
  const body = document.getElementById('agentBody');
  const decide = document.getElementById('wizDecideBody');
  card.style.display = '';
  body.innerHTML = loading();

  try {
    const run = await DB.adjudicate({ sessionId: WIZ.sessionId });
    WIZ.run = run;

    const kind = run.recommendation === 'approve' ? 'note-info'
      : run.recommendation === 'decline' ? 'note-danger' : 'note-warn';

    body.innerHTML = `
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
          recorded against their account.
        </div>
      </div>

      <div style="margin-top:14px">
        ${run.decisions.map((d) => `
          <div class="agent">
            <div class="agent-icon agent-${esc(d.verdict)}">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">${VERDICT_ICON[d.verdict] ?? ''}</svg>
            </div>
            <div style="min-width:0;flex:1">
              <div class="agent-name">${esc(d.agent)}
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

    decide.innerHTML = `
      <dl class="kv">
        <dt>Session</dt><dd class="mono">${esc(WIZ.sessionId)}</dd>
        <dt>Applicant</dt><dd>${esc(WIZ.subject?.name ?? '—')}</dd>
        <dt>Face match</dt><dd>${WIZ.match
          ? (WIZ.match.matched ? `<span class="badge b-passed">Matched · ${esc(WIZ.match.confidence)}%</span>`
             : '<span class="badge b-failed">No match</span>')
          : '<span class="muted">Not run</span>'}</dd>
        <dt>Fingerprint</dt><dd>${WIZ.fingerprint
          ? '<span class="badge b-passed">Device verified</span>' : '<span class="muted">Skipped</span>'}</dd>
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
    body.innerHTML = errorState(e);
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
          Decision recorded, but the customer was not created: ${esc(e.message)}</div>`;
        return;
      }
    }

    out.innerHTML = `<div class="note ${approving ? 'note-info' : 'note-warn'}" style="margin-top:12px">
      <b>${outcome === 'accepted' ? 'Recommendation applied' : 'Overridden'}.</b>
      ${customer ? `<br>Customer <span class="mono">${esc(customer.customerId)}</span> created.` : ''}
      ${customer?.fraudScreen
        ? `<br>Screened on creation — ${esc(customer.fraudScreen.signals ?? 0)} signal(s).` : ''}
      </div>
      <button class="btn btn-sm" style="margin-top:10px" id="wizRestart">Start another</button>`;

    document.getElementById('wizRestart').addEventListener('click', () => go('onboard'));
    toast(outcome === 'accepted' ? 'Recommendation applied' : 'Decision overridden', 'ok');
  } catch (e) {
    out.innerHTML = errorState(e);
  }
}
