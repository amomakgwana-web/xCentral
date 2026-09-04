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
};

const PAGES = [
  { id: 'dashboard',  label: 'Home',     title: 'Verification Overview',        sub: 'Live case flow across every calling platform' },
  { id: 'cases',      label: 'Cases',    title: 'Verification Cases',           sub: 'Every case, its checks, and its decision' },
  { id: 'identity',   label: 'Identity', title: 'Identity Verification',        sub: 'SA ID structure · Home Affairs lookup · deceased register' },
  { id: 'documents',  label: 'Docs',     title: 'Document Verification',        sub: 'MRZ check digits · authenticity · expiry · private storage' },
  { id: 'credit',     label: 'Credit',   title: 'Credit Verification',          sub: 'Bureau enquiries · NCA Regulation 23A affordability' },
  { id: 'biometrics', label: 'Bio',      title: 'Biometric Verification',       sub: 'Face match · liveness · duplicate enrolment' },
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

function openModal(title, body, foot = '') {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalFoot').innerHTML = foot;
  document.getElementById('modal').classList.add('open');
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

// ── Boot ────────────────────────────────────────────────────────
async function boot() {
  DB = window.XC_DB;

  const badgeEl = document.getElementById('envBadge');
  badgeEl.textContent = DB.env === 'production' ? 'Production' : 'Sandbox';
  badgeEl.className = `env-badge env-${DB.env}`;

  const health = document.getElementById('healthLabel');
  const chip = document.getElementById('healthChip');

  if (!DB.configured) {
    health.textContent = 'Not configured';
    chip.className = 'chip';
    chip.style.cssText = 'background:var(--amb-bg);color:var(--amb);border-color:var(--amb-bd)';
  } else {
    try {
      const profile = await DB.getProfile();
      health.textContent = 'Live';
      document.getElementById('userLabel').textContent = profile?.name ?? profile?.email ?? 'Sign in';
    } catch {
      health.textContent = 'Signed out';
      chip.style.cssText = 'background:var(--bg2);color:var(--ink4);border-color:var(--border)';
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
