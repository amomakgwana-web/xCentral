// ══════════════════════════════════════════════════════════════
// The live capture wizard, end to end, against the real pipeline.
//
//   npm run test:wizard
//
// Nothing is stubbed. The page runs the shipped bundle, the bundle
// runs the local client, and the local client runs the same identity
// arithmetic, face comparison, document forensics and agent rules that
// a person clicking through the console runs. The only thing supplied
// from outside is the photographs, and those are synthetic so the
// right answer is known in advance.
//
// Two journeys, because they have to end differently:
//
//   The applicant's own document. The face in front of the camera and
//   the face on the card are the same person, so the comparison
//   matches and the agents approve.
//
//   Somebody else's document. Same card stock, same everything, a
//   different face printed on it — which is the fraud this whole
//   feature exists to catch. The comparison must fail and the
//   biometric agent must veto. A system that only ever sees the happy
//   path has not been tested; it has been demonstrated.
// ══════════════════════════════════════════════════════════════

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { SCENES } from './scenes.mjs';

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

const DIST = new URL('../dist', import.meta.url).pathname;
if (!existsSync(DIST)) {
  console.error('dist/ is missing. Run `npm run build` first.');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
};
const server = createServer(async (req, res) => {
  try {
    const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const path = join(DIST, normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(4185, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: resolveChromium(),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['camera'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/fonts\.googleapis|ERR_|favicon/.test(m.text())) return;
  errors.push(`console: ${m.text()}`);
});

let failed = 0;
const pass = (m) => console.log(`pass  ${m}`);
const fail = (m) => { failed++; console.log(`FAIL  ${m}`); };

await page.goto('http://127.0.0.1:4185/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.nav-btn[data-page="onboard"]', { timeout: 20000 });

// The same scene builders the vision test uses, so a face here is a
// face there.
await page.addScriptTag({ content: SCENES });

async function runJourney({ label, personSeed, cardSeed, idNumber }) {
  console.log(`\n── ${label} ──`);
  await page.click('.nav-btn[data-page="onboard"]');
  await page.waitForSelector('#wizStart', { timeout: 15000 });

  await page.fill('#wizId', idNumber);
  await page.fill('#wizFirst', 'Thabo');
  await page.fill('#wizSurname', 'Mokoena');
  await page.waitForTimeout(400);
  const hint = (await page.locator('#wizIdHint').textContent())?.trim() ?? '';
  if (/^Valid/.test(hint)) pass(`the identity number is checked as it is typed · ${hint}`);
  else fail(`the identity number hint reads: ${hint}`);

  // Consent is a precondition, and the wizard must actually enforce it
  // rather than decorate the form with a checkbox.
  await page.click('#wizStart');
  await page.waitForTimeout(400);
  const refused = await page.locator('#wizStartResult .note-danger').count();
  if (refused) pass('without consent the session is refused');
  else fail('the session opened without consent to biometric processing');

  await page.check('#wizConsent');
  await page.click('#wizStart');
  await page.waitForSelector('#wizLiveGo', { timeout: 20000 });
  pass('a session and a case were opened');

  // The live photograph, by upload — the fake camera carries a test
  // pattern, not a face, and this test is about the pipeline.
  await page.evaluate(async (seed) => {
    // A selfie is a face in a lit room, not a head floating in a dark
    // void — and the quality gate is right to refuse the latter.
    await window.feed('wizLiveUpload',
      window.makeHead({ seed, zoom: 1.35, background: '#4a5460' }), 'selfie.jpg');
  }, personSeed);
  await page.waitForSelector('#wizToDoc', { timeout: 40000 }).catch(async () => {
    const why = (await page.locator('#wizLiveResult').innerText().catch(() => '')) ?? '';
    fail(`the live photograph never got past the capture step: ${why.replace(/\s+/g, ' ').slice(0, 300)}`);
    throw new Error('live capture did not complete');
  });
  const selfieText = (await page.locator('#wizLiveResult').innerText()).replace(/\s+/g, ' ');
  if (/descriptor was computed/.test(selfieText)) pass(`the live photograph was accepted · ${selfieText.slice(0, 90)}`);
  else fail(`the live photograph: ${selfieText.slice(0, 160)}`);

  await page.click('#wizToDoc');
  await page.waitForSelector('#wizDocCapture', { timeout: 15000 });

  await page.evaluate(async (seed) => {
    await window.feed('wizDocUpload', await window.makeCard({ seed }), 'card.jpg');
  }, cardSeed);
  await page.waitForSelector('#wizToReconcile', { timeout: 60000 }).catch(async () => {
    const why = (await page.locator('#wizDocResult').innerText().catch(() => '')) ?? '';
    fail(`the document never got past the examination: ${why.replace(/\s+/g, ' ').slice(0, 300)}`);
    throw new Error('document examination did not complete');
  });
  const docText = (await page.locator('#wizDocResult').innerText()).replace(/\s+/g, ' ');
  if (/portrait was found/.test(docText)) pass(`the document was examined · ${docText.slice(0, 100)}`);
  else fail(`the document: ${docText.slice(0, 200)}`);

  await page.click('#wizToReconcile');
  await page.waitForSelector('#wizToAgents', { timeout: 60000 });
  const reconcileText = (await page.locator('#wizBody').innerText()).replace(/\s+/g, ' ');
  const matched = /The person against their document[^]*?Match(?!\w)/.test(reconcileText)
    && !/The person against their document[^]*?No match/.test(reconcileText);
  const at = reconcileText.indexOf('The person against their document');
  console.log(`      ${reconcileText.slice(at, at + 260)}`);

  await page.click('#wizToAgents');
  await page.waitForSelector('#agentBody .agent', { timeout: 30000 });
  const agents = await page.locator('#agentBody .agent').count();
  const verdict = (await page.locator('#agentBody .note').first().innerText()).replace(/\s+/g, ' ');
  const agentText = (await page.locator('#agentBody').innerText()).replace(/\s+/g, ' ');
  if (agents >= 6) pass(`${agents} agents each gave a verdict and a reason`);
  else fail(`only ${agents} agents reported`);

  return { matched, verdict, agentText, agents };
}

const own = await runJourney({
  label: 'The applicant\'s own document',
  personSeed: 21, cardSeed: 21, idNumber: '9001015009086',
});
if (own.matched) pass('the person matches the portrait on their own document');
else fail('the person did not match the portrait on their own document');
// Not "approve". Both photographs were uploaded, so nothing in this
// journey established that a person was present — and the biometric
// agent is right to raise that rather than wave it through. A refer on
// an unobserved upload is the correct answer, and a system that
// approved it would be the thing worth failing.
if (/Refer|Approve/i.test(own.verdict) && !/Decline/i.test(own.verdict)) {
  pass(`the agents do not decline a genuine file · ${own.verdict.slice(0, 120)}`);
} else fail(`the agents said: ${own.verdict.slice(0, 200)}`);
if (/presence is not established|Depth was/i.test(own.agentText)) {
  pass('the referral is about presence, not identity');
} else fail('the referral does not say what is missing');

const stolen = await runJourney({
  label: 'Somebody else\'s document',
  personSeed: 34, cardSeed: 88, idNumber: '8801235111088',
});
if (!stolen.matched) pass('the person does not match a portrait of somebody else');
else fail('a different face on the card was accepted as a match');
if (/Decline/i.test(stolen.verdict)) pass(`the agents decline · ${stolen.verdict.slice(0, 140)}`);
else fail(`the agents said: ${stolen.verdict.slice(0, 200)}`);
if (/biometric/i.test(stolen.verdict)) pass('the biometric agent is the one that vetoed');
else fail(`the veto came from somewhere else: ${stolen.verdict.slice(0, 160)}`);

// One face, two identity numbers. This is the syndicate pattern, and
// it is only findable because every enrolled descriptor is kept in one
// place and compared against.
const twice = await runJourney({
  label: 'The same face under a second identity number',
  personSeed: 21, cardSeed: 21, idNumber: '8801235111088',
});
if (/already enrolled under a different identity number/i.test(twice.agentText)) {
  pass('one face presented under two identity numbers is caught');
} else fail('the same face under a second identity number went unnoticed');

// No descriptor may reach the page. In production the templates table
// has row level security with no policies at all; here the property
// that has to hold is the one that matters downstream.
const leaked = await page.evaluate(() => /(-?0\.\d{4,},\s*){6,}/.test(document.body.innerText));
if (leaked) fail('a biometric descriptor was rendered into the page');
else pass('no biometric descriptor reaches the rendered page');

if (errors.length) fail(`the page raised: ${errors.slice(0, 3).join(' | ')}`);
else pass('no errors were raised in the page');

await browser.close();
await new Promise((r) => server.close(r));

console.log('');
if (failed) {
  console.log(`───────────  ${failed} WIZARD CHECK(S) FAILED  ───────────`);
  process.exit(1);
}
console.log('────────  THE WIZARD RUNS END TO END, BOTH WAYS  ────────');
