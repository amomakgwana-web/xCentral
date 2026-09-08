// ══════════════════════════════════════════════════════════════
// Drives every console page against a real, seeded Postgres.
//
//   DATABASE_URL=postgresql://… node tests/run-console-pages.mjs
//
// The gap this closes: the SQL suites prove the functions compute the
// right numbers, and CI proves no table backing a page is empty.
// Neither proves the console can render what is in those tables. A
// null where console.js expects a string renders an error panel, and
// every other test in the repo would still be green.
//
// So this runs the shipped bundle in real Chromium, against the real
// seeds, with backend.js's real queries going to a real database
// through tests/postgrest-shim.mjs. Nothing about the data path is
// stubbed. What is not covered: edge functions, which are Deno, and
// which no read path needs — the shim records it loudly if a page
// calls one.
//
// A page passes only if it renders its own content. Not an error
// panel, not the unconfigured-project notice, and not an empty state
// where the seed says there are rows.
// ══════════════════════════════════════════════════════════════

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { startShim } from './postgrest-shim.mjs';

function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const fromRegistry = chromium.executablePath();
    if (fromRegistry && existsSync(fromRegistry)) return fromRegistry;
  } catch { /* not installed through the registry */ }
  for (const p of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
                   '/opt/pw-browsers/chromium/chrome']) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    'No Chromium found. Run `npx playwright install chromium`, or set CHROMIUM_PATH.');
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. It must point at a database with the');
  console.error('migrations applied and all three seeds loaded.');
  process.exit(2);
}

const DIST = new URL('../dist', import.meta.url).pathname;
if (!existsSync(DIST)) {
  console.error('dist/ is missing. Run `npm run build` first — and build it with');
  console.error('VITE_SUPABASE_URL_SANDBOX pointing at this shim, or the console');
  console.error('will render the unconfigured-project notice instead of data.');
  process.exit(2);
}

// Every page, and what has to be on it for the page to count as
// rendered. The selectors are deliberately the page's own content
// rather than its chrome, so a page that throws and falls back to an
// error panel fails rather than passes on the header alone.
//
// A failed render is detected by the sentence errorState() writes, not
// by its CSS class: `note-danger` is also the class the fraud and
// biometrics pages use for deliberate emphasis copy, and matching on it
// fails both of those pages for having something to say.
const PAGES = [
  { id: 'dashboard',  needs: 'table tbody tr, .stat',   label: 'Verification Overview' },
  { id: 'cases',      needs: 'table tbody tr',          label: 'Verification Cases' },
  { id: 'identity',   needs: 'table tbody tr',          label: 'Identity Verification' },
  { id: 'documents',  needs: 'table tbody tr',          label: 'Document Verification' },
  { id: 'credit',     needs: 'table tbody tr',          label: 'Credit Verification' },
  { id: 'biometrics', needs: 'table tbody tr',          label: 'Biometric Verification' },
  { id: 'onboard',    needs: 'table tbody tr',          label: 'Live Capture & Onboarding' },
  { id: 'customers',  needs: 'table tbody tr',          label: 'Customers' },
  { id: 'portfolio',  needs: 'table tbody tr',          label: 'Assets & Agreements' },
  { id: 'payments',   needs: 'table tbody tr',          label: 'Payments & Arrears' },
  { id: 'fraud',      needs: 'table tbody tr',          label: 'Fraud Detection' },
  { id: 'consent',    needs: 'table tbody tr',          label: 'Consent Register' },
  { id: 'watchlist',  needs: 'table tbody tr',          label: 'Sanctions & PEP Screening' },
  { id: 'platforms',  needs: 'table tbody tr',          label: 'Platforms & API Keys' },
  { id: 'audit',      needs: 'table tbody tr',          label: 'Audit Trail' },
  { id: 'retention',  needs: 'table tbody tr',          label: 'Retention & Minimisation' },
];

const shim = await startShim({ databaseUrl: DATABASE_URL, distDir: DIST, port: 4187 });

const browser = await chromium.launch({ executablePath: resolveChromium() });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
const page = await ctx.newPage();

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // The bundle pulls its typeface from Google Fonts, which is not
  // reachable here and is not what is under test.
  if (/fonts\.googleapis|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|favicon/.test(m.text())) return;
  pageErrors.push(`console: ${m.text()}`);
});

let failed = 0;
const pass = (m) => console.log(`pass  ${m}`);
const fail = (m) => { failed++; console.log(`FAIL  ${m}`); };

await page.goto(`${shim.origin}/`, { waitUntil: 'networkidle' });

// ── The console reached the database at all ─────────────────────
const unconfigured = await page.locator('text=not pointed at a Supabase project').count();
if (unconfigured) {
  fail('the bundle was built without VITE_SUPABASE_URL_SANDBOX pointing at the shim');
  await browser.close();
  await shim.close();
  process.exit(1);
}
pass('the console is talking to the database');

const navCount = await page.locator('#nav button').count();
if (navCount === PAGES.length) pass(`all ${PAGES.length} pages are in the navigation`);
else fail(`expected ${PAGES.length} nav buttons, found ${navCount}`);

// ── Every page renders its own content ──────────────────────────
for (const spec of PAGES) {
  const before = pageErrors.length;
  await page.click(`#nav button[data-page="${spec.id}"]`);
  await page.waitForFunction(
    () => !/Loading…/.test(document.getElementById('main')?.textContent ?? ''),
    null, { timeout: 20000 },
  ).catch(() => {});
  await page.waitForTimeout(250);

  const title = (await page.locator('#main .ph-title').first().textContent()
    .catch(() => '')) ?? '';
  const errored = await page.locator('#main :text("Could not load this page")').count();
  const rows = await page.locator(`#main :is(${spec.needs})`).count();
  const raised = pageErrors.slice(before);

  if (errored) {
    const why = (await page.locator('#main :text("Could not load this page")').first()
      .textContent().catch(() => '')) ?? '';
    fail(`${spec.id} — could not load: ${why.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  }
  else if (raised.length) fail(`${spec.id} — ${raised.join(' | ')}`);
  else if (!rows) fail(`${spec.id} — rendered nothing (no ${spec.needs})`);
  else pass(`${spec.id} · ${title.trim() || spec.label} · ${rows} element(s)`);
}

// ── The two deep views a client actually clicks into ────────────
// A list that renders and a detail view that throws is the failure
// this is here to catch.
{
  const before = pageErrors.length;
  await page.click('#nav button[data-page="cases"]');
  await page.waitForTimeout(600);
  await page.locator('#main table tbody tr').first().click();
  await page.waitForTimeout(900);
  const open = await page.locator('#modal.open').count();
  const body = (await page.locator('#modalBody').textContent().catch(() => '')) ?? '';
  const raised = pageErrors.slice(before);
  if (!open) fail('a case row does not open its detail view');
  else if (raised.length) fail(`case detail — ${raised.join(' | ')}`);
  else if (body.length < 200) fail(`case detail rendered only ${body.length} characters`);
  else pass(`case detail opens with its checks (${body.length} characters)`);
  await page.evaluate(() => window.closeModal());
}

{
  const before = pageErrors.length;
  await page.click('#nav button[data-page="customers"]');
  await page.waitForTimeout(600);
  await page.locator('#main table tbody tr').first().click();
  await page.waitForTimeout(1200);
  const open = await page.locator('#modal.open').count();
  const body = (await page.locator('#modalBody').textContent().catch(() => '')) ?? '';
  const raised = pageErrors.slice(before);
  if (!open) fail('a customer row does not open the profile');
  else if (raised.length) fail(`customer profile — ${raised.join(' | ')}`);
  else if (body.length < 200) fail(`customer profile rendered only ${body.length} characters`);
  else pass(`customer profile opens (${body.length} characters)`);
}

{
  // The agents are the most explainable part of the system and, until
  // the adjudication history existed, the least reachable: a reviewer
  // had to run a live capture to see one. This asserts a stored run is
  // readable after the fact, with each agent's own rationale.
  const before = pageErrors.length;
  await page.evaluate(() => window.closeModal());
  await page.click('#nav button[data-page="onboard"]');
  await page.waitForTimeout(800);
  // The newest session is the one still capturing, which has no run
  // yet — that is correct, and not what this assertion is about.
  await page.locator('#main tr[data-session]')
    .filter({ hasNotText: 'Not yet run' }).first().click();
  await page.waitForTimeout(900);
  const open = await page.locator('#modal.open').count();
  const body = (await page.locator('#modalBody').textContent().catch(() => '')) ?? '';
  const agents = await page.locator('#modalBody .agent').count();
  const raised = pageErrors.slice(before);
  if (!open) fail('a capture session does not open its adjudication');
  else if (raised.length) fail(`adjudication — ${raised.join(' | ')}`);
  else if (agents < 6) fail(`adjudication shows only ${agents} agents, expected at least 6`);
  else if (!/Recommend|Approve|Decline|Refer/i.test(body)) fail('adjudication shows no recommendation');
  else pass(`a stored adjudication is reviewable · ${agents} agents with their rationales`);
  await page.evaluate(() => window.closeModal());

  // And a session that has not reached the agents says so, rather than
  // rendering an empty panel or throwing.
  const before2 = pageErrors.length;
  await page.locator('#main tr[data-session]')
    .filter({ hasText: 'Not yet run' }).first().click();
  await page.waitForTimeout(700);
  const unrun = (await page.locator('#modalBody').textContent().catch(() => '')) ?? '';
  if (pageErrors.slice(before2).length) fail('an unadjudicated session throws');
  else if (!/never put to the agents/i.test(unrun)) fail(`an unadjudicated session shows: ${unrun.slice(0, 120)}`);
  else pass('a session still capturing says so instead of rendering an empty panel');
  await page.evaluate(() => window.closeModal());
}

// ── The shim itself must not have papered over anything ─────────
if (shim.failures.length) {
  for (const f of shim.failures) fail(`shim: ${f}`);
} else {
  pass(`every query the console made was served (${shim.queries.length} in total)`);
}

await browser.close();
await shim.close();

console.log('');
if (failed) {
  console.log(`───────────  ${failed} CONSOLE PAGE CHECK(S) FAILED  ───────────`);
  process.exit(1);
}
console.log('──────────  ALL CONSOLE PAGES RENDER THE SEEDED DATA  ──────────');
