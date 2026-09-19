// ══════════════════════════════════════════════════════════════
// The document scanning engine.
//
// One question asked three ways of every uploaded document:
//
//   Was this altered?     Somebody took a real document and changed
//                         it. The page looks right; the file does not.
//   Was it ever genuine?  Nobody altered anything, because nobody
//                         started from a real document. It was built.
//   Has it been seen?     It is real, unaltered, and belongs to
//                         somebody else — or to this person, last
//                         month, submitted again.
//
// They need different evidence, and a system that runs only the first
// catches only the laziest of the three. Altered documents give
// themselves away in structure — a second save, an editor's name in
// the metadata, a number in the wrong font. Fabricated ones give
// themselves away in ARITHMETIC: a real payslip reconciles because a
// payroll system produced it, and an invented one reconciles only if
// the person inventing it did the sums. Reused ones give themselves
// away by matching something already on file.
//
// Every finding carries the measurement behind it and a weight held as
// a row. None of them is decisive on its own except arithmetic that
// does not balance, because that is the only one where the document
// contradicts itself rather than merely looking unusual.
//
// WHAT THIS CANNOT DO, stated here so it is not inferred from silence:
// there is no reference library of genuine issuer templates, no
// certificate chain validation for signed PDFs, and no optical
// character recognition — a scanned paper document yields no text, so
// the arithmetic checks do not run on it and the engine says so rather
// than passing it for want of evidence.
// ══════════════════════════════════════════════════════════════

import { errorLevel, highPass, meanStd, regionPercentile, toPlane } from './image.js';
import { looksLikePdf, readPdf } from './pdf.js';
import {
  fingerprintOverlap, hammingDistance, layoutFingerprint, perceptualHash,
  sha256Hex, textFingerprint,
} from './fingerprint.js';

// Software that does not produce bank statements. A name from this
// list in a document's Producer field means the file passed through a
// tool whose purpose is changing how things look.
const RASTER_EDITORS = [
  'photoshop', 'gimp', 'illustrator', 'inkscape', 'corel', 'affinity',
  'paint.net', 'pixelmator', 'canva', 'figma', 'snapseed',
];
// Legitimate for a letter somebody typed; not for a document an
// institution is supposed to have generated.
const OFFICE_SUITES = ['microsoft word', 'libreoffice', 'openoffice', 'pages', 'google docs', 'wps'];

const MONEY = '(?:r\\s*)?(-?\\d{1,3}(?:[ ,]\\d{3})*(?:\\.\\d{1,2})?|-?\\d+(?:\\.\\d{1,2})?)';

// Twenty thousand minutes means nothing to a reader; a fortnight does.
function humanGap(minutes) {
  if (minutes < 90) return `${minutes} minutes`;
  if (minutes < 2880) return `${Math.round(minutes / 60)} hours`;
  return `${Math.round(minutes / 1440)} days`;
}

function money(raw) {
  if (raw === undefined || raw === null) return null;
  const n = Number(String(raw).replace(/[ ,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// The first amount that follows a label. Payslips and statements put
// the number to the right of its name or under it, and in the text
// layer both come out as "label then number".
function labelled(text, patterns) {
  for (const p of patterns) {
    const m = new RegExp(`${p}[^0-9r-]{0,40}${MONEY}`, 'i').exec(text);
    if (m) return money(m[1]);
  }
  return null;
}

// ── Does the document agree with itself? ────────────────────────
// The strongest check in this file. A payroll system cannot emit a
// payslip where gross minus deductions is not net; a core banking
// system cannot emit a statement whose closing balance is not the
// opening balance plus the movements. A person building one in a
// spreadsheet very often can, because they changed the number they
// cared about and not the three that depend on it.
export function reconcile(text, docType) {
  if (!text || text.length < 40) {
    return { applicable: false, reason: 'no_text_layer' };
  }
  const flat = text.toLowerCase().replace(/\s+/g, ' ');

  if (docType === 'payslip') {
    const gross = labelled(flat, ['gross (?:pay|salary|earnings|income|remuneration)', 'total earnings', 'gross']);
    const deductions = labelled(flat, ['total deductions', 'deductions total', 'deductions']);
    const net = labelled(flat, ['net (?:pay|salary|income)', 'take.?home', 'amount paid']);
    if (gross === null || net === null) {
      return { applicable: false, reason: 'labels_not_found', found: { gross, deductions, net } };
    }
    const expected = gross - (deductions ?? 0);
    const difference = Number((net - expected).toFixed(2));
    return {
      applicable: true,
      kind: 'payslip',
      figures: { gross, deductions, net },
      expected: Number(expected.toFixed(2)),
      difference,
      // A rand of rounding is a rounding difference. Anything more is
      // a number somebody changed without changing its neighbours.
      balances: Math.abs(difference) <= 1,
      statement: `gross ${gross} less deductions ${deductions ?? 0} is ${expected.toFixed(2)}, and the document says net ${net}`,
    };
  }

  if (docType === 'bank_statement') {
    const opening = labelled(flat, ['opening balance', 'balance brought forward', 'b/?f balance']);
    const closing = labelled(flat, ['closing balance', 'balance carried forward', 'c/?f balance', 'available balance']);
    const credits = labelled(flat, ['total credits', 'credits total', 'money in']);
    const debits = labelled(flat, ['total debits', 'debits total', 'money out']);
    if (opening === null || closing === null || (credits === null && debits === null)) {
      return { applicable: false, reason: 'labels_not_found', found: { opening, closing, credits, debits } };
    }
    const expected = opening + (credits ?? 0) - (debits ?? 0);
    const difference = Number((closing - expected).toFixed(2));
    return {
      applicable: true,
      kind: 'bank_statement',
      figures: { opening, closing, credits, debits },
      expected: Number(expected.toFixed(2)),
      difference,
      balances: Math.abs(difference) <= 1,
      statement: `opening ${opening} plus credits ${credits ?? 0} less debits ${debits ?? 0} is ${expected.toFixed(2)}, and the document says closing ${closing}`,
    };
  }

  return { applicable: false, reason: 'no_arithmetic_defined_for_this_type' };
}

// ── Where was this image edited? ────────────────────────────────
// A splice — a number pasted over another number, a logo dropped onto
// a letter — has been through a different compression history from the
// page around it. Re-encoding the whole page and measuring how far
// each part moves finds the region that behaves differently, without
// needing to know what the page should look like.
export async function spliceMap(canvas, grid = 12) {
  const ela = await errorLevel(canvas, 0.75, 720);
  if (!ela) return null;
  const plane = toPlane(canvas, 720);
  const hp = highPass(plane, 1);
  const absHp = new Float32Array(hp.length);
  for (let i = 0; i < hp.length; i++) absHp[i] = Math.abs(hp[i]);

  const cells = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const rect = {
        x: (ela.w / grid) * gx, y: (ela.h / grid) * gy,
        width: ela.w / grid, height: ela.h / grid,
      };
      const e = regionPercentile(ela.diff, ela.w, ela.h, rect, 0.75);
      const nRect = {
        x: (plane.w / grid) * gx, y: (plane.h / grid) * gy,
        width: plane.w / grid, height: plane.h / grid,
      };
      const n = regionPercentile(absHp, plane.w, plane.h, nRect, 0.5);
      cells.push({ gx, gy, error: e.inside, noise: n.inside });
    }
  }

  // Compared against the median and the median absolute deviation
  // rather than the mean and standard deviation: one badly spliced
  // region would drag a mean far enough to hide itself.
  const stat = (key) => {
    const vals = cells.map((c) => c[key]).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    const devs = vals.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
    return { median, mad: devs[Math.floor(devs.length / 2)] || 1e-6 };
  };
  const eStat = stat('error');
  const nStat = stat('noise');

  // Blank paper has no error level and no noise worth the name, and
  // every document is mostly blank paper. Cells with nothing in them
  // are not evidence of anything.
  const inked = cells.filter((c) => c.noise > nStat.median * 0.4);
  const outliers = inked
    .map((c) => ({
      ...c,
      errorZ: (c.error - eStat.median) / eStat.mad,
      noiseZ: (c.noise - nStat.median) / nStat.mad,
    }))
    .filter((c) => c.errorZ > 6 || c.noiseZ > 6)
    .sort((a, b) => Math.max(b.errorZ, b.noiseZ) - Math.max(a.errorZ, a.noiseZ));

  return {
    grid,
    cellsExamined: inked.length,
    outliers: outliers.slice(0, 6).map((c) => ({
      x: c.gx, y: c.gy,
      errorZ: Number(c.errorZ.toFixed(2)),
      noiseZ: Number(c.noiseZ.toFixed(2)),
    })),
    worst: outliers.length ? Number(Math.max(outliers[0].errorZ, outliers[0].noiseZ).toFixed(2)) : 0,
  };
}

// ── The scan ────────────────────────────────────────────────────
export async function scanDocument(file, {
  docType = 'unknown',
  subjectId = null,
  corpus = [],
  issuerProfiles = [],
  now = () => new Date(),
} = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const isPdf = looksLikePdf(bytes);

  const signals = [];
  const push = (code, fired, value, detail) => signals.push({ code, fired, value, detail });

  let pdf = null;
  let image = null;
  let text = '';
  let runs = [];
  let perceptual = null;

  if (isPdf) {
    pdf = await readPdf(bytes);
    text = pdf.text;
    runs = pdf.runs;
  } else {
    const canvas = await fileToCanvas(file);
    const plane = toPlane(canvas, 900);
    const { mean, std } = meanStd(plane.gray);
    image = {
      width: canvas.width,
      height: canvas.height,
      brightness: Number(((mean / 255) * 100).toFixed(2)),
      contrast: Number(((std / 255) * 100).toFixed(2)),
      splice: await spliceMap(canvas),
    };
    perceptual = perceptualHash(canvas);
  }

  // ── Was this altered? ─────────────────────────────────────────
  if (pdf) {
    push('pdf_saved_more_than_once', pdf.revisions > 1, pdf.revisions,
      pdf.revisions > 1
        ? `The file carries ${pdf.revisions} saved revisions. A document generated once and left alone has one; `
          + 'every later save appends a new body and keeps the old one, so the file remembers being changed.'
        : 'The file has been saved once, which is what a freshly generated document looks like.');

    const created = pdf.meta.createdAt ? Date.parse(pdf.meta.createdAt) : null;
    const modified = pdf.meta.modifiedAt ? Date.parse(pdf.meta.modifiedAt) : null;
    const gapMinutes = (created && modified) ? Math.round((modified - created) / 60000) : null;
    push('pdf_modified_after_creation', gapMinutes !== null && gapMinutes > 2, gapMinutes,
      gapMinutes === null
        ? 'The file does not carry both a creation and a modification date.'
        : gapMinutes > 2
          ? `Modified ${humanGap(gapMinutes)} after it was created. A generated statement is written once.`
          : 'Created and last modified at effectively the same moment.');

    const producer = `${pdf.meta.producer ?? ''} ${pdf.meta.creator ?? ''}`.toLowerCase();
    const raster = RASTER_EDITORS.find((e) => producer.includes(e));
    push('pdf_producer_is_image_editor', Boolean(raster), pdf.meta.producer ?? pdf.meta.creator ?? null,
      raster
        ? `Produced by ${raster}. That is a tool for changing how something looks, not for issuing a record of account.`
        : 'The producing software is not a raster editor.');

    const office = OFFICE_SUITES.find((e) => producer.includes(e));
    const issuerGenerated = ['bank_statement', 'payslip', 'cipc_registration', 'sars_tax_clearance'];
    push('pdf_producer_is_word_processor',
      Boolean(office) && issuerGenerated.includes(docType), pdf.meta.producer ?? null,
      office
        ? `Produced by ${office}. Fine for a letter somebody typed; a ${docType.replace(/_/g, ' ')} is supposed to come out of a system.`
        : 'Not produced by a word processor.');

    push('pdf_metadata_stripped',
      !pdf.meta.producer && !pdf.meta.creator && !pdf.meta.createdAt, 0,
      'The file carries no producer, creator or creation date at all. Metadata does not usually go '
      + 'missing by itself; removing it is a step somebody takes.');

    const edits = (pdf.meta.xmpHistory ?? []).filter((h) => /saved|converted|edited/i.test(h.action));
    push('pdf_edit_history_present', edits.length > 1, edits.length,
      edits.length > 1
        ? `The embedded history records ${edits.length} editing events: ${edits.map((e) => e.action).join(', ')}.`
        : 'No multi-step editing history is recorded in the file.');

    // A number typed into an existing page rarely lands in the same
    // font as the numbers beside it. This looks for runs that are
    // mostly digits and sit in a font used almost nowhere else.
    const fontUse = new Map();
    for (const r of runs) fontUse.set(r.font, (fontUse.get(r.font) ?? 0) + 1);
    const odd = runs.filter((r) => /\d/.test(r.text) && (fontUse.get(r.font) ?? 0) <= 2
      && fontUse.size > 1 && r.font);
    push('pdf_figure_in_a_foreign_font', odd.length > 0, odd.length,
      odd.length
        ? `${odd.length} numeric run(s) are set in a font used almost nowhere else in the document `
          + `(${[...new Set(odd.map((o) => o.font))].join(', ')}). Typing over an existing page does this.`
        : 'Numbers are set in the same faces as the text around them.');

    // The strongest thing a PDF can tell you. Not an inference from
    // metadata — the previous wording of the page, still in the file,
    // beside the wording that replaced it.
    const changed = pdf.changedFrom;
    push('pdf_previous_version_differs',
      Boolean(changed && (changed.added.length || changed.removed.length)),
      changed ? changed.added.length + changed.removed.length : 0,
      changed && (changed.added.length || changed.removed.length)
        ? `An earlier version of this page is still inside the file, and it did not say the same thing. `
          + `Was: ${changed.removed.join(' ') || '(nothing removed)'}. `
          + `Now: ${changed.added.join(' ') || '(nothing added)'}.`
          + (changed.figuresChanged ? ' A figure changed.' : '')
        : 'No superseded version of the page is present to compare against.');

    push('pdf_is_a_picture_in_a_wrapper',
      !pdf.hasTextLayer && pdf.images > 0 && issuerGenerated.includes(docType), pdf.textLength,
      !pdf.hasTextLayer && pdf.images > 0
        ? 'There is no text in this file — only an image. A statement generated by a bank has a text layer; '
          + 'a photograph of one, or a rebuilt one, does not.'
        : 'The document carries a text layer.');
  }

  if (image?.splice) {
    push('image_region_edited', image.splice.worst > 6, image.splice.worst,
      image.splice.worst > 6
        ? `${image.splice.outliers.length} region(s) of the page compress and carry noise unlike the rest of it — `
          + 'the signature of something pasted in after the fact.'
        : 'No region of the page behaves differently from the rest under re-encoding.');
  }

  // ── Was it ever genuine? ──────────────────────────────────────
  const arithmetic = reconcile(text, docType);
  push('arithmetic_does_not_reconcile', arithmetic.applicable && !arithmetic.balances,
    arithmetic.applicable ? arithmetic.difference : null,
    arithmetic.applicable
      ? `${arithmetic.statement} — a difference of ${arithmetic.difference}.`
      : `No arithmetic could be checked (${String(arithmetic.reason).replace(/_/g, ' ')}), so this document `
        + 'has not been shown to reconcile. That is an absence of evidence, not evidence of absence.');

  const layout = layoutFingerprint(runs);
  const profiles = issuerProfiles.filter((p) => p.doc_type === docType && p.layout);
  let bestProfile = null;
  if (layout && profiles.length) {
    bestProfile = profiles
      .map((p) => ({ issuer: p.issuer, overlap: fingerprintOverlap(layout, p.layout) }))
      .sort((a, b) => b.overlap - a.overlap)[0];
    push('layout_matches_no_known_issuer', bestProfile.overlap < 0.35,
      bestProfile.overlap,
      `The closest known template for this document type is ${bestProfile.issuer}, at ${bestProfile.overlap} overlap. `
      + 'A document built from scratch shares a template with nothing on file.');
  }

  // ── Has it been seen before? ──────────────────────────────────
  const fingerprint = textFingerprint(text);
  const duplicates = [];
  for (const other of corpus) {
    if (other.sha256 === sha256) {
      duplicates.push({
        kind: 'identical_file', documentId: other.id, subjectId: other.subject_id ?? null,
        measure: 'sha-256', value: 1,
        detail: 'Byte for byte the same file.',
      });
      continue;
    }
    const distance = hammingDistance(perceptual, other.perceptual_hash);
    if (distance !== null && distance <= 8) {
      duplicates.push({
        kind: 'same_image', documentId: other.id, subjectId: other.subject_id ?? null,
        measure: 'perceptual distance', value: distance,
        detail: `The same picture, ${distance} of 64 comparisons apart — re-saved or lightly edited, not re-taken.`,
      });
      continue;
    }
    const overlap = fingerprintOverlap(fingerprint, other.text_fingerprint);
    if (overlap !== null && overlap >= 0.72) {
      duplicates.push({
        kind: 'same_content', documentId: other.id, subjectId: other.subject_id ?? null,
        measure: 'content overlap', value: overlap,
        detail: `${Math.round(overlap * 100)}% of the content is shared with a document already on file. `
              + 'A different file carrying the same statement.',
      });
    }
  }

  const acrossSubjects = duplicates.filter((d) => d.subjectId && subjectId && d.subjectId !== subjectId);
  push('document_already_on_file', duplicates.length > 0, duplicates.length,
    duplicates.length
      ? `Matches ${duplicates.length} document(s) already held: ${duplicates.map((d) => `${d.documentId} (${d.measure} ${d.value})`).join('; ')}.`
      : `Nothing on file matches this document. Compared against ${corpus.length} held document(s).`);

  push('document_reused_across_identities', acrossSubjects.length > 0, acrossSubjects.length,
    acrossSubjects.length
      ? `The matching document belongs to a different subject (${acrossSubjects.map((d) => d.subjectId).join(', ')}). `
        + 'One document supporting two identities is the oldest paper fraud there is.'
      : 'No match belongs to another subject.');

  return {
    file: { name: file.name ?? 'upload', mime: file.type || (isPdf ? 'application/pdf' : 'image/*'), bytes: bytes.length },
    route: isPdf ? 'pdf' : 'image',
    scannedAt: now().toISOString(),
    docType,
    pdf,
    image,
    arithmetic,
    issuerMatch: bestProfile,
    fingerprints: {
      sha256,
      perceptual,
      text: fingerprint,
      layout,
    },
    duplicates,
    signals,
    firedCodes: signals.filter((s) => s.fired).map((s) => s.code),
  };
}

async function fileToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is neither a PDF nor a readable image.'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
