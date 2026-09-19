// ══════════════════════════════════════════════════════════════
// The document scanning engine, against documents built to be wrong.
//
//   npm run test:docscan
//
// Six PDFs, each differing from the clean one in exactly one respect,
// so a finding can only be explained by the thing that was changed:
//
//   clean        written once, by a payroll system, and it adds up
//   compressed   the same, with a deflated content stream
//   tampered     opened, the net pay changed, saved again
//   fabricated   built in an image editor, and it still adds up
//   reExported   the same words through different software
//   anonymous    stripped of everything that says where it came from
//
// The fabricated one matters most. It reconciles perfectly, because
// whoever built it did the arithmetic — so if the engine only checked
// the sums it would pass, and the only thing that catches it is the
// file saying which program made it.
// ══════════════════════════════════════════════════════════════

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { PAPERS } from './papers.mjs';

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
await new Promise((r) => server.listen(4197, '127.0.0.1', r));

const browser = await chromium.launch({ executablePath: resolveChromium() });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:4197/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__VISION_READY, null, { timeout: 15000 });
await page.addScriptTag({ content: PAPERS });

let failed = 0;
const pass = (m) => console.log(`pass  ${m}`);
const fail = (m) => { failed++; console.log(`FAIL  ${m}`); };
const check = (label, value, ok) => (ok ? pass(`${label} · ${value}`) : fail(`${label} · ${value}`));

// ── 1 · The reader gets the document out of the file ────────────
const read = await page.evaluate(async () => {
  const p = await window.papers();
  const bytes = async (f) => new Uint8Array(await f.arrayBuffer());
  return {
    plain: await window.V.pdf.readPdf(await bytes(p.clean)),
    compressed: await window.V.pdf.readPdf(await bytes(p.compressed)),
    tampered: await window.V.pdf.readPdf(await bytes(p.tampered)),
  };
});

check('an uncompressed content stream is read',
  `${read.plain.textLength} characters, ${read.plain.revisions} revision, fonts ${read.plain.fonts.join(',')}`,
  read.plain.hasTextLayer && /Gross Pay/i.test(read.plain.text));
check('a deflated content stream is inflated and read',
  `${read.compressed.textLength} characters`,
  read.compressed.hasTextLayer && /Net Pay/i.test(read.compressed.text));
check('the producer is recovered from the file',
  read.plain.meta.producer ?? 'none', /Sage/.test(read.plain.meta.producer ?? ''));
check('a document saved twice reports two revisions',
  `${read.plain.revisions} then ${read.tampered.revisions}`,
  read.plain.revisions === 1 && read.tampered.revisions === 2);

// ── 2 · Arithmetic ──────────────────────────────────────────────
const sums = await page.evaluate(async () => {
  const p = await window.papers();
  const bytes = async (f) => new Uint8Array(await f.arrayBuffer());
  const text = async (f) => (await window.V.pdf.readPdf(await bytes(f))).text;
  return {
    clean: window.V.scan.reconcile(await text(p.clean), 'payslip'),
    tampered: window.V.scan.reconcile(await text(p.tampered), 'payslip'),
    nothing: window.V.scan.reconcile('', 'payslip'),
  };
});
check('a genuine payslip reconciles',
  sums.clean.applicable ? `${sums.clean.statement} — difference ${sums.clean.difference}` : sums.clean.reason,
  sums.clean.applicable === true && sums.clean.balances === true);
check('a payslip whose net was changed does not',
  sums.tampered.applicable ? `difference ${sums.tampered.difference}` : sums.tampered.reason,
  sums.tampered.applicable === true && sums.tampered.balances === false);
check('a document with no text layer says so rather than passing',
  sums.nothing.reason, sums.nothing.applicable === false && sums.nothing.reason === 'no_text_layer');

// ── 3 · The whole scan, on each fixture ─────────────────────────
const scans = await page.evaluate(async () => {
  const p = await window.papers();
  const one = (file, opts = {}) => window.V.scan.scanDocument(file, { docType: 'payslip', ...opts });
  const out = {};
  for (const [name, file] of Object.entries(p)) {
    const r = await one(file);
    out[name] = {
      fired: r.firedCodes,
      balances: r.arithmetic.applicable ? r.arithmetic.balances : null,
      producer: r.pdf?.meta?.producer ?? null,
      revisions: r.pdf?.revisions ?? null,
      sha: r.fingerprints.sha256.slice(0, 12),
    };
  }
  return out;
});

for (const [name, r] of Object.entries(scans)) {
  console.log(`      ${name.padEnd(11)} ${r.fired.join(', ') || 'nothing'}`);
}

const ALTERED = ['pdf_saved_more_than_once', 'pdf_modified_after_creation',
  'pdf_producer_is_image_editor', 'pdf_metadata_stripped', 'pdf_figure_in_a_foreign_font'];

check('a genuine payslip fires nothing',
  scans.clean.fired.join(', ') || 'nothing', scans.clean.fired.length === 0);
check('so does the same payslip compressed',
  scans.compressed.fired.join(', ') || 'nothing', scans.compressed.fired.length === 0);

check('an edited payslip is caught as edited',
  scans.tampered.fired.filter((c) => ALTERED.includes(c)).join(', '),
  scans.tampered.fired.includes('pdf_saved_more_than_once')
  && scans.tampered.fired.includes('pdf_modified_after_creation'));
check('and the changed figure is spotted in a foreign font',
  scans.tampered.fired.includes('pdf_figure_in_a_foreign_font') ? 'spotted' : 'missed',
  scans.tampered.fired.includes('pdf_figure_in_a_foreign_font'));
check('and its arithmetic no longer holds',
  `balances ${scans.tampered.balances}`, scans.tampered.balances === false);

check('a fabricated payslip is caught by its producer, not its sums',
  `${scans.fabricated.producer} · balances ${scans.fabricated.balances}`,
  scans.fabricated.fired.includes('pdf_producer_is_image_editor')
  && scans.fabricated.balances === true);
check('stripped metadata is itself a finding',
  scans.anonymous.fired.join(', '),
  scans.anonymous.fired.includes('pdf_metadata_stripped'));

// The headline evidence: not an inference from metadata, but the
// previous wording of the page still inside the file.
const changed = await page.evaluate(async () => {
  const p = await window.papers();
  const r = await window.V.scan.scanDocument(p.tampered, { docType: 'payslip' });
  return {
    fired: r.firedCodes.includes('pdf_previous_version_differs'),
    detail: (r.signals.find((s) => s.code === 'pdf_previous_version_differs') ?? {}).detail,
    diff: r.pdf.changedFrom,
  };
});
console.log(`      was ${changed.diff.removed.join(' ')} → now ${changed.diff.added.join(' ')}`);
check('the earlier version of the page is recovered and compared',
  changed.fired ? 'recovered' : 'missed',
  changed.fired && changed.diff.removed.includes('19800.00') && changed.diff.added.includes('29800.00'));
check('and the engine says a figure changed',
  String(changed.diff.figuresChanged), changed.diff.figuresChanged === true);

// ── 4 · Duplicates, in all three forms ──────────────────────────
const dupes = await page.evaluate(async () => {
  const p = await window.papers();
  const corpus = [];
  const scan = async (file, subjectId) => {
    const r = await window.V.scan.scanDocument(file, { docType: 'payslip', subjectId, corpus });
    corpus.push({
      id: 'doc_' + (corpus.length + 1),
      subject_id: subjectId,
      sha256: r.fingerprints.sha256,
      perceptual_hash: r.fingerprints.perceptual,
      text_fingerprint: r.fingerprints.text,
    });
    return r;
  };

  const first = await scan(p.clean, 'sub_a');
  // The identical file, under a different person.
  const again = await scan(p.clean, 'sub_b');
  // The same statement through different software: different bytes,
  // different producer, different fonts, same words.
  const reExported = await scan(p.reExported, 'sub_c');
  return {
    first: { duplicates: first.duplicates, fired: first.firedCodes },
    again: { duplicates: again.duplicates, fired: again.firedCodes },
    reExported: { duplicates: reExported.duplicates, fired: reExported.firedCodes },
  };
});

console.log(`      first upload   ${dupes.first.duplicates.length} match(es)`);
console.log(`      same file      ${dupes.again.duplicates.map((d) => `${d.kind} ${d.value}`).join(', ') || 'none'}`);
console.log(`      re-exported    ${dupes.reExported.duplicates.map((d) => `${d.kind} ${d.value}`).join(', ') || 'none'}`);

check('the first upload matches nothing',
  `${dupes.first.duplicates.length} match(es)`, dupes.first.duplicates.length === 0);
check('the identical file is caught by its hash',
  dupes.again.duplicates.map((d) => d.kind).join(', '),
  dupes.again.duplicates.some((d) => d.kind === 'identical_file'));
check('and is reported as the same document under two identities',
  dupes.again.fired.includes('document_reused_across_identities') ? 'reported' : 'missed',
  dupes.again.fired.includes('document_reused_across_identities'));
check('a re-export with different bytes is caught by its content',
  dupes.reExported.duplicates.map((d) => `${d.kind} ${d.value}`).join(', ') || 'none',
  dupes.reExported.duplicates.some((d) => d.kind === 'same_content'));

// ── 5 · The fingerprints behave as claimed ──────────────────────
const prints = await page.evaluate(async () => {
  const { textFingerprint, fingerprintOverlap } = window.V.fingerprint;
  const a = textFingerprint('gross pay 25 000.00 paye 4 100.00 uif 177.12 net pay 19 800.00 acme logistics');
  const b = textFingerprint('Gross Pay R25,000.00 PAYE R4,100.00 UIF 177.12 Net Pay R19,800.00 Acme Logistics');
  const c = textFingerprint('invoice 4471 for consulting services rendered in august total due 8 200.00 vat included');
  return { sameish: fingerprintOverlap(a, b), different: fingerprintOverlap(a, c) };
});
check('the same content formatted differently still matches',
  `${prints.sameish} against ${prints.different} for unrelated text`,
  prints.sameish > 0.6 && prints.different < 0.2);

if (errors.length) fail(`the page raised: ${errors.slice(0, 3).join(' | ')}`);
else pass('no errors were raised in the page');

await browser.close();
await new Promise((r) => server.close(r));

console.log('');
if (failed) {
  console.log(`───────────  ${failed} DOCUMENT SCAN CHECK(S) FAILED  ───────────`);
  process.exit(1);
}
console.log('──────  ALTERED, FABRICATED AND REUSED ARE ALL CAUGHT  ──────');
