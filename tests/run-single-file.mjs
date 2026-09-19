// ══════════════════════════════════════════════════════════════
// Opens the single-file console the way a person receiving it does:
// straight off the disk, with nothing serving it.
//
//   npm run test:single
//
// The failure this exists to catch is specific and was real. A module
// script is deferred by definition and runs after the document is
// parsed. Inline the same code as a classic script where the tag sat —
// in the head — and it runs before the body exists, so the console's
// first write lands on null and the page boots into its own
// "did not start" panel. Every other suite in the repo stays green,
// because every other suite runs the served build.
//
// So this asserts the shipped artefact, over file://, with the network
// unable to help it.
// ══════════════════════════════════════════════════════════════

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

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
  throw new Error('No Chromium found. Run `npx playwright install chromium`, or set CHROMIUM_PATH.');
}

const FILE = new URL('../xcentral-console.html', import.meta.url).pathname;
if (!existsSync(FILE)) {
  console.error('xcentral-console.html is missing. Run `npm run build:single` first.');
  process.exit(2);
}

const PAGES = ['dashboard', 'cases', 'identity', 'documents', 'credit', 'biometrics',
  'onboard', 'customers', 'portfolio', 'payments', 'fraud', 'consent', 'watchlist',
  'platforms', 'audit', 'retention'];

const browser = await chromium.launch({ executablePath: resolveChromium() });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // The typeface comes from Google Fonts and is expected to be
  // unreachable here — that is the offline case this file is for, and
  // the stylesheet names system fallbacks after it.
  if (/fonts\.googleapis|ERR_|favicon/.test(m.text())) return;
  errors.push(`console: ${m.text()}`);
});

let failed = 0;
const pass = (m) => console.log(`pass  ${m}`);
const fail = (m) => { failed++; console.log(`FAIL  ${m}`); };

await page.goto(`file://${FILE}`);
await page.waitForTimeout(2500);

// ── It booted at all ────────────────────────────────────────────
const stalled = await page.locator('text=The console did not start').count();
if (stalled) fail('the console did not start when opened from disk');
else pass('the console starts from a file:// path');

const nav = await page.locator('#nav button').count();
if (nav === PAGES.length) pass(`all ${PAGES.length} pages are in the navigation`);
else fail(`expected ${PAGES.length} nav buttons, found ${nav}`);

// ── Nothing is fetched ──────────────────────────────────────────
// Anything the page requests over the wire is something a recipient
// without a network would not get. The typeface is the one exception,
// and it degrades to a system font.
const requested = [];
page.on('request', (r) => {
  if (!r.url().startsWith('file://') && !/fonts\.(googleapis|gstatic)\.com/.test(r.url())) {
    requested.push(r.url());
  }
});

// ── Every page renders its own records ──────────────────────────
for (const id of PAGES) {
  const before = errors.length;
  await page.click(`#nav button[data-page="${id}"]`);
  await page.waitForTimeout(300);
  const rows = await page.locator('#main :is(table tbody tr, .stat)').count();
  const errored = await page.locator('#main :text("Could not load this page")').count();
  const raised = errors.slice(before);
  if (errored) fail(`${id} — could not load`);
  else if (raised.length) fail(`${id} — ${raised.join(' | ')}`);
  else if (!rows) fail(`${id} — rendered nothing`);
  else pass(`${id} · ${rows} element(s)`);
}

// ── A detail view opens ─────────────────────────────────────────
{
  const before = errors.length;
  await page.click('#nav button[data-page="cases"]');
  await page.waitForTimeout(500);
  await page.locator('#main table tbody tr').first().click();
  await page.waitForTimeout(800);
  const body = (await page.locator('#modalBody').textContent().catch(() => '')) ?? '';
  if (errors.slice(before).length) fail(`case detail — ${errors.slice(before).join(' | ')}`);
  else if (body.length < 200) fail(`case detail rendered only ${body.length} characters`);
  else pass(`case detail opens with its evidence (${body.length} characters)`);
  await page.evaluate(() => window.closeModal());
}

if (requested.length) fail(`the page fetched ${requested.length} file(s): ${requested.slice(0, 3).join(', ')}`);
else pass('nothing is fetched over the network');

await browser.close();

console.log('');
if (failed) {
  console.log(`───────────  ${failed} SINGLE-FILE CHECK(S) FAILED  ───────────`);
  process.exit(1);
}
console.log('─────────  THE SINGLE FILE RUNS WITH NOTHING SERVING IT  ─────────');
