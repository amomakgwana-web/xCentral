// Bundles src/capture.js and exercises its image-quality maths in
// headless Chromium against synthetic images whose properties are
// known in advance — a checkerboard is sharp, a blurred copy is not,
// a flat fill has no contrast.
//
//   node tests/run-capture-metrics.mjs
//
// Needs Chromium. Set CHROMIUM_PATH to override the default location.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Chromium lives in different places depending on where this runs: an
// explicit override, the Playwright registry that `playwright install`
// populates on CI, or a preinstalled copy. Try them in that order and
// say clearly which was used.
function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const fromRegistry = chromium.executablePath();
    if (fromRegistry && existsSync(fromRegistry)) return fromRegistry;
  } catch { /* not installed through the registry */ }
  const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (existsSync(preinstalled)) return preinstalled;
  throw new Error(
    'No Chromium found. Run `npx playwright install chromium`, or set CHROMIUM_PATH.');
}


const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const work = await mkdtemp(join(tmpdir(), 'xc-capture-'));

try {
  execFileSync('npx', ['esbuild', join(root, 'src/capture.js'),
    '--bundle', '--format=iife', '--global-name=CAP',
    `--outfile=${join(work, 'capture.bundle.js')}`, '--log-level=warning'],
    { cwd: root, stdio: 'inherit' });

  await writeFile(join(work, 'capture-test.html'),
    await readFile(join(here, 'capture-metrics.html'), 'utf8'));

  const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
  const server = createServer(async (rq, rs) => {
    try {
      const p = join(work, rq.url === '/' ? 'capture-test.html' : rq.url.slice(1));
      const b = await readFile(p);
      rs.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'text/plain' });
      rs.end(b);
    } catch { rs.writeHead(404); rs.end('not found'); }
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const browser = await chromium.launch({ executablePath: resolveChromium() });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
  const results = await page.evaluate(() => window.__RESULTS);
  const metrics = await page.evaluate(() => window.__METRICS);

  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'pass  ' : 'FAIL  '}${r.label}   [${r.detail}]`);
    if (!r.ok) failed++;
  }
  console.log(`\nsharpness — sharp ${metrics.qSharp.sharpness}`
    + ` · 4px blur ${metrics.qSoft.sharpness} · 12px blur ${metrics.qVery.sharpness}`);
  if (errors.length) console.log('page errors:', errors);

  await browser.close();
  server.close();

  console.log(failed || errors.length
    ? `\n${failed} CAPTURE METRIC TEST(S) FAILED`
    : '\n──────────  ALL CAPTURE METRIC TESTS PASSED  ──────────');
  process.exit(failed || errors.length ? 1 : 0);
} finally {
  await rm(work, { recursive: true, force: true });
}
