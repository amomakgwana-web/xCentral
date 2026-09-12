// ══════════════════════════════════════════════════════════════
// The vision code, against scenes built to have a known answer.
//
//   npm run test:vision
//
// Everything under test here makes a claim about physics: that a head
// produces parallax and a photograph does not; that a portrait printed
// on a card shares the card's noise, compression and white point, and
// one stuck on top of it does not. A claim like that is worth nothing
// unless something checks it, and no photograph of a real person comes
// with a label saying whether it was tampered with.
//
// So the scenes are synthetic and their ground truth is known by
// construction. A head is a textured ellipsoid rendered under a real
// perspective projection, so its parallax is the parallax of an actual
// three-dimensional object. A photograph of that head is the same
// render put through an affine warp, which is exactly what a flat
// object does. A substituted portrait is a different face, encoded
// separately, pasted with a hard edge.
//
// What this does NOT establish is how any of it behaves on real
// photographs of real people in real light. Nothing here is calibrated
// against those, and the thresholds say so where they are declared.
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

const DIST = new URL('../dist-vision', import.meta.url).pathname;
if (!existsSync(DIST)) {
  console.error('dist-vision/ is missing. Run `npm run build:vision` first.');
  process.exit(2);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const path = join(DIST, normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(4189, '127.0.0.1', r));

const browser = await chromium.launch({ executablePath: resolveChromium() });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:4189/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__VISION_READY, null, { timeout: 15000 });

let failed = 0;
const pass = (m) => console.log(`pass  ${m}`);
const fail = (m) => { failed++; console.log(`FAIL  ${m}`); };
const near = (label, value, cmp) => cmp ? pass(`${label} · ${value}`) : fail(`${label} · ${value}`);

// ── The scene builders, in the page ─────────────────────────────
await page.addScriptTag({ content: SCENES });

// ── 1 · A head has depth; a photograph of one does not ──────────
const depthResults = await page.evaluate(async () => {
  const head = (yaw, dx = 0, zoom = 1) => window.makeHead({ seed: 21, yaw, dx, zoom });

  const live = window.scanFrom([
    { pose: 'centre', axis: 'none', canvas: head(0) },
    { pose: 'left', axis: 'yaw', canvas: head(0.20) },
    { pose: 'right', axis: 'yaw', canvas: head(-0.20) },
    { pose: 'closer', axis: 'scale', canvas: head(0, 0, 1.1) },
  ]);

  const still = head(0);
  const flat = window.scanFrom([
    { pose: 'centre', axis: 'none', canvas: still },
    { pose: 'left', axis: 'yaw', canvas: window.flattenAs(still, { angle: 0.06, scale: 1.03, dx: 16, dy: -6 }) },
    { pose: 'right', axis: 'yaw', canvas: window.flattenAs(still, { angle: -0.05, scale: 0.98, dx: -14, dy: 5 }) },
    { pose: 'closer', axis: 'scale', canvas: window.flattenAs(still, { angle: 0.01, scale: 1.12, dx: 2, dy: 3 }) },
  ]);

  return {
    live: await window.V.depth.analyseDepthScan(live),
    flat: await window.V.depth.analyseDepthScan(flat),
  };
});

console.log(`      head  relief ${depthResults.live.reliefPct}%  R² ${depthResults.live.planarityR2}  `
  + `parallax ${depthResults.live.centralParallax}  →  ${depthResults.live.verdict}`);
console.log(`      photo relief ${depthResults.flat.reliefPct}%  R² ${depthResults.flat.planarityR2}  `
  + `parallax ${depthResults.flat.centralParallax}  →  ${depthResults.flat.verdict}`);

near('a rotating head is called three-dimensional',
  depthResults.live.verdict, depthResults.live.verdict === 'three_dimensional');
near('a photograph moved as a plane is called flat',
  depthResults.flat.verdict, depthResults.flat.verdict === 'flat');
near('the head leaves far more unexplained by a flat transform',
  `evidence ${depthResults.live.depthEvidence} vs ${depthResults.flat.depthEvidence}`,
  depthResults.live.depthEvidence > depthResults.flat.depthEvidence * 3);
near('the photograph fits a single flat transform better',
  `R² ${depthResults.flat.planarityR2} vs ${depthResults.live.planarityR2}`,
  depthResults.flat.planarityR2 > depthResults.live.planarityR2);

// ── 1b · The scan loop itself, prompts and all ──────────────────
// analyseDepthScan is exercised above on a scan built by hand. This
// drives runDepthScan, which is the part that issues the prompts,
// samples a series per pose and times the response — the code that
// runs when somebody is actually sitting in front of a camera. It is
// given a frame source rather than a camera, so the loop is real and
// only the photons are not.
const scanLoop = await page.evaluate(async () => {
  const poses = [0, 0.2, -0.2, 0].map((yaw, i) =>
    window.makeHead({ seed: 21, yaw, zoom: i === 3 ? 1.1 : 1 }));
  let frame = 0;
  const prompts = [];

  const scan = await window.V.depth.runDepthScan({}, {
    // Each pose held for a few samples, then on to the next: what a
    // person does when they follow the instructions.
    grabFrame: () => poses[Math.min(poses.length - 1, Math.floor(frame++ / 4))],
    onPrompt: (pose) => prompts.push(pose.id),
    holdMs: 360,
    sampleMs: 80,
  });
  const analysis = await window.V.depth.analyseDepthScan(scan);
  return {
    prompts,
    posesCaptured: scan.poses.length,
    plan: scan.plan,
    verdict: analysis.verdict,
    answered: analysis.posesAnswered,
  };
});

near('the scan issues a prompt for every pose and captures each one',
  `${scanLoop.prompts.length} prompts, ${scanLoop.posesCaptured} poses captured`,
  scanLoop.prompts.length === scanLoop.posesCaptured && scanLoop.posesCaptured >= 3);
near('the scan always starts from the straight-ahead reference',
  scanLoop.plan.join(' → '), scanLoop.plan[0] === 'centre');
near('no pose is asked for twice in one scan',
  scanLoop.plan.join(' → '),
  new Set(scanLoop.plan).size === scanLoop.plan.length);

// The randomised order is the anti-replay property, so it is asserted
// rather than assumed: a recording of an earlier scan only fits if the
// prompts always come in the same sequence.
const orders = await page.evaluate(() =>
  Array.from({ length: 40 }, () => window.V.depth.planScan().map((p) => p.id).join(',')));
near('the prompt order varies between sessions',
  `${new Set(orders).size} distinct orders in 40 plans`, new Set(orders).size > 3);
near('the loop produces a verdict rather than throwing',
  scanLoop.verdict, typeof scanLoop.verdict === 'string' && scanLoop.verdict.length > 0);

// ── 2 · The same face scores higher than a different one ────────
const faceResults = await page.evaluate(async () => {
  const { faceDescriptor, compareFaces } = window.V.face;

  // The same person, photographed twice: slightly different angle,
  // slightly different light, different sensor noise.
  const a1 = window.makeHead({ seed: 21, yaw: 0 });
  const a2 = window.makeHead({ seed: 21, yaw: 0.07, dx: 9, light: 0.9 });
  const b1 = window.makeHead({ seed: 88, yaw: 0.02 });

  const da1 = await faceDescriptor(a1);
  const da2 = await faceDescriptor(a2);
  const db1 = await faceDescriptor(b1);

  return {
    located: { a1: da1?.method ?? null, dims: da1?.dimensions ?? null },
    same: compareFaces(da1, da2),
    different: compareFaces(da1, db1),
  };
});

console.log(`      same person ${faceResults.same.appearanceSimilarity}  `
  + `different person ${faceResults.different.appearanceSimilarity}  `
  + `(located by ${faceResults.located.a1}, ${faceResults.located.dims} dimensions)`);

near('a face is located and a descriptor computed',
  `${faceResults.located.a1} · ${faceResults.located.dims} dimensions`,
  Boolean(faceResults.located.a1 && faceResults.located.dims > 500));
near('the same face scores higher than a different face',
  `${faceResults.same.appearanceSimilarity} vs ${faceResults.different.appearanceSimilarity}`,
  faceResults.same.appearanceSimilarity > faceResults.different.appearanceSimilarity + 0.08);

// ── 3 · A substituted portrait is detectable ────────────────────
const docResults = await page.evaluate(async () => {
  const features = { id1_geometry: true, mrz: true, ghost_portrait: true };
  const clean = await window.makeCard({ seed: 21 });
  const tampered = await window.makeCard({ seed: 21, pasteSeed: 88 });
  return {
    clean: await window.V.docs.analyseDocument(clean, { docType: 'sa_id_card', features }),
    tampered: await window.V.docs.analyseDocument(tampered, { docType: 'sa_id_card', features }),
  };
});

const SUBSTITUTION = [
  'portrait_noise_mismatch', 'portrait_focus_mismatch', 'portrait_colour_mismatch',
  'portrait_edge_step', 'portrait_taped_or_glossy', 'portrait_error_level_mismatch',
  'ghost_portrait_mismatch',
];
const cleanHits = docResults.clean.firedCodes.filter((c) => SUBSTITUTION.includes(c));
const tamperHits = docResults.tampered.firedCodes.filter((c) => SUBSTITUTION.includes(c));

console.log(`      genuine card  periodicity ${docResults.clean.screen.periodicity} `
  + `(brightness ${docResults.clean.screen.luma}, colour ${docResults.clean.screen.chroma}, lag ${docResults.clean.screen.lag})`);
console.log(`      genuine card  fired: ${docResults.clean.firedCodes.join(', ') || 'nothing'}`);
console.log(`      pasted photo  fired: ${docResults.tampered.firedCodes.join(', ') || 'nothing'}`);
console.log(`      ghost correlation  genuine ${docResults.clean.ghostCorrelation}  `
  + `pasted ${docResults.tampered.ghostCorrelation}`);

near('a substituted portrait fires substitution signals',
  `${tamperHits.length} signal(s): ${tamperHits.join(', ')}`, tamperHits.length >= 2);
near('a genuine card fires fewer of them than a tampered one',
  `${cleanHits.length} vs ${tamperHits.length}`, cleanHits.length < tamperHits.length);
near('the ghost portrait agrees with the main one on a genuine card, and not on a tampered one',
  `${docResults.clean.ghostCorrelation} vs ${docResults.tampered.ghostCorrelation}`,
  docResults.clean.ghostCorrelation > docResults.tampered.ghostCorrelation);
const screenResult = await page.evaluate(async () => {
  const features = { id1_geometry: true, mrz: true, ghost_portrait: true };
  const card = await window.makeCard({ seed: 21 });
  const onScreen = await window.throughAScreen(card);
  const r = await window.V.docs.analyseDocument(onScreen, { docType: 'sa_id_card', features });
  return { periodicity: r.screen, fired: r.firedCodes.includes('doc_photographed_from_screen') };
});
console.log(`      card on a screen  periodicity ${screenResult.periodicity.periodicity} `
  + `(brightness ${screenResult.periodicity.luma}, colour ${screenResult.periodicity.chroma}, `
  + `lag ${screenResult.periodicity.lag})`);

// Deliberately NOT asserted: that the screen capture is caught. On
// these scenes the measure does not reliably order a photographed
// display above a photographed card, so the check is tuned to stay
// quiet rather than to fire, and its numbers are reported for a
// reviewer to judge. Asserting a detection that does not happen would
// be a test written to make a feature look real.
near('a card photographed on paper is not called a screenshot',
  docResults.clean.firedCodes.includes('doc_photographed_from_screen') ? 'fired' : 'quiet',
  !docResults.clean.firedCodes.includes('doc_photographed_from_screen'));

near('the machine-readable band is located',
  `density ${docResults.clean.mrzBand.strokeDensity}`, docResults.clean.mrzBand.found === true);
near('a portrait is found on the card',
  docResults.clean.portrait ? 'yes' : 'no', Boolean(docResults.clean.portrait));

// ── 4 · The check digits are arithmetic, and they bite ──────────
const mrzResult = await page.evaluate(async () => {
  // The ICAO 9303 TD3 specimen. One character changed is one check
  // digit failed — that is the property, and it does not depend on any
  // of the inference above.
  const good = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\n'
             + 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
  const bad = good.replace('7408122', '7408123');
  return {
    good: await window.V.docs.verifyMrz(good),
    bad: await window.V.docs.verifyMrz(bad),
  };
});
near('the ICAO specimen verifies', mrzResult.good.valid ? 'valid' : 'invalid', mrzResult.good.valid === true);
near('one altered character fails a check digit',
  mrzResult.bad.valid ? 'still valid' : `rejected: ${(mrzResult.bad.reasonCodes ?? []).join(', ')}`,
  mrzResult.bad.valid === false);

if (errors.length) fail(`the page raised: ${errors.slice(0, 3).join(' | ')}`);
else pass('no errors were raised in the page');

await browser.close();
await new Promise((r) => server.close(r));

console.log('');
if (failed) {
  console.log(`───────────  ${failed} VISION CHECK(S) FAILED  ───────────`);
  process.exit(1);
}
console.log('──────  THE VISION CODE SEPARATES WHAT IT CLAIMS TO SEPARATE  ──────');
