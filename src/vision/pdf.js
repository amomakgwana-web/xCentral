// ══════════════════════════════════════════════════════════════
// Reading a PDF's structure, without a PDF library.
//
// Most document fraud that arrives as a PDF is not clever. Somebody
// opens a real bank statement in an editor, changes a number, and
// saves. The page looks perfect — and the FILE remembers. A PDF saved
// a second time usually keeps the first version inside it and appends
// the change, so the document carries its own edit history; the
// software that did it writes its name into the Producer field; and a
// number typed into an existing page almost never lands in the same
// font, at the same size, on the same baseline as the numbers around
// it.
//
// None of that needs the page to be rendered, which is why there is no
// dependency here. What this does need is inflate, for the compressed
// content streams, and the browser has one: DecompressionStream. So
// this runs offline, in the tab, with nothing installed.
//
// WHAT THIS IS NOT. It does not render pages, so it cannot see what a
// document looks like — only what it is made of. It does not decrypt.
// It does not handle cross-reference streams for object lookup (it
// scans for objects instead, which is cruder and does not fall over on
// a malformed file). A document whose metadata is inside an object
// stream will report its Producer as unknown rather than guessing, and
// "unknown" is reported as unknown rather than as clean.
// ══════════════════════════════════════════════════════════════

// The file as latin-1 text. Every structural token in a PDF —
// dictionaries, names, operators, the trailer — is ASCII, so scanning
// the bytes as characters finds all of it. Binary stream payloads come
// out as mojibake, which is fine: they are located by offset and
// decompressed from the original bytes, never from this.
function asLatin1(bytes) {
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return out;
}

export function looksLikePdf(bytes) {
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50
      && bytes[2] === 0x44 && bytes[3] === 0x46;
}

// PDF date strings: D:YYYYMMDDHHmmSSOHH'mm'. Returned as an ISO string
// where it parses, and null where it does not — a malformed date is a
// finding in itself, and inventing one would hide it.
function pdfDate(raw) {
  if (!raw) return null;
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw);
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// A PDF string is either (literal) with backslash escapes, or <hex>.
// UTF-16 with a byte-order mark is common in metadata written by
// Windows software.
function pdfString(raw) {
  if (raw === undefined || raw === null) return null;
  let s = raw;
  if (s.startsWith('<') && s.endsWith('>')) {
    const hex = s.slice(1, -1).replace(/\s/g, '');
    let out = '';
    for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    s = out;
  } else if (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1).replace(/\\([nrtbf()\\])/g, (_, c) =>
      ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? c));
  }
  if (s.charCodeAt(0) === 0xFE && s.charCodeAt(1) === 0xFF) {
    let out = '';
    for (let i = 2; i + 1 < s.length; i += 2) {
      out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
    }
    s = out;
  }
  return s.replace(/\u0000/g, '').trim() || null;
}

const STRING = '(\\([^)]*\\)|<[0-9A-Fa-f\\s]*>)';

function firstMatch(text, key) {
  const m = new RegExp(`/${key}\\s*${STRING}`).exec(text);
  return m ? pdfString(m[1]) : null;
}

// The LAST occurrence, not the first. A PDF saved again appends a new
// document information dictionary and leaves the old one in place, so
// the first /ModDate in the file is the one from before the edit.
// Reading that one reports an edited document as untouched — which is
// the failure the whole check exists to prevent.
function lastMatch(text, key) {
  const re = new RegExp(`/${key}\\s*${STRING}`, 'g');
  let found = null;
  let m;
  while ((m = re.exec(text)) !== null) found = m[1];
  return found ? pdfString(found) : null;
}

// ── Streams ─────────────────────────────────────────────────────
// Every `stream … endstream` and how it is encoded. Located in the
// latin-1 view, decompressed from the real bytes.
function findStreams(text) {
  const out = [];
  // "endstream" contains "stream". Matching the keyword without
  // excluding that gives a phantom stream starting three characters
  // into every terminator, which then swallows the next real one — so
  // on a file saved twice the appended revision is never seen, and an
  // edited document reads as an unedited one.
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (text.slice(m.index - 3, m.index) === 'end') continue;
    const start = m.index + m[0].length;
    const endKeyword = text.indexOf('endstream', start);
    if (endKeyword < 0) continue;

    // A stream's dictionary is what lies between its object header and
    // the `stream` keyword — nothing earlier. Scanning a fixed window
    // back from the keyword instead reaches into the PREVIOUS
    // revision's objects on a file that has been saved twice, and
    // picks up their /Length. The stream then gets cut to somebody
    // else's length and most of the page disappears, silently.
    const window = text.slice(Math.max(0, m.index - 1200), m.index);
    const objRe = /(\d+)\s+\d+\s+obj/g;
    let objMatch = null;
    let om;
    while ((om = objRe.exec(window)) !== null) objMatch = om;
    const objNum = objMatch ? Number(objMatch[1]) : null;
    const dict = objMatch ? window.slice(objMatch.index) : window;

    const length = Number((/\/Length\s+(\d+)/.exec(dict) ?? [])[1]);

    // Sliced by /Length where the file gives one. Cutting at the
    // `endstream` keyword instead leaves the newline before it inside
    // the payload, and an inflater handed one trailing byte of
    // non-stream data rejects the whole thing — which reads, from the
    // outside, exactly like a document with no text in it.
    const end = Number.isFinite(length) && length > 0 && start + length <= endKeyword + 2
      ? start + length
      : endKeyword;

    out.push({
      start,
      end,
      object: Number.isFinite(objNum) ? objNum : null,
      flate: /\/Filter\s*(\/FlateDecode|\[\s*\/FlateDecode)/.test(dict),
      isImage: /\/Subtype\s*\/Image/.test(dict),
      isMetadata: /\/Type\s*\/Metadata/.test(dict),
      isObjStm: /\/Type\s*\/ObjStm/.test(dict),
    });
    // Past the terminator, not at it.
    re.lastIndex = endKeyword + 'endstream'.length;
  }
  return out;
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') return null;
  for (const format of ['deflate', 'deflate-raw']) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { /* try the next framing */ }
  }
  return null;
}

// ── The text layer ──────────────────────────────────────────────
// Text in a PDF is drawn by operators, not stored as a paragraph:
// `(Hello) Tj` and `[(He) -20 (llo)] TJ`. Pulling the strings back out
// gives the words in drawing order, which is close enough to reading
// order for the checks here — the arithmetic on a payslip does not
// care about column order, and the duplicate fingerprint is over a
// normalised bag of tokens.
//
// The font in force is tracked alongside, because "this number is in a
// different font from the rest of its line" is one of the strongest
// tamper signals there is.
function extractText(content) {
  const runs = [];
  let font = null;
  const re = /\/([A-Za-z0-9#+.\-]+)\s+([\d.]+)\s+Tf|\((?:\\.|[^\\()])*\)\s*(?:Tj|')|\[((?:[^\][\\]|\\.)*)\]\s*TJ/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) { font = { name: m[1], size: Number(m[2]) }; continue; }
    const token = m[0];
    let text = '';
    if (token.startsWith('[')) {
      const inner = m[3] ?? '';
      const lit = /\((?:\\.|[^\\()])*\)/g;
      let l;
      while ((l = lit.exec(inner)) !== null) text += unescapePdf(l[0].slice(1, -1));
    } else {
      text = unescapePdf(token.slice(1, token.lastIndexOf(')')));
    }
    if (text) runs.push({ text, font: font?.name ?? null, size: font?.size ?? null });
  }
  return runs;
}

function unescapePdf(s) {
  return s.replace(/\\(\d{1,3}|.)/g, (_, c) => {
    if (/^\d+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? c);
  });
}

// ── The whole read ──────────────────────────────────────────────
export async function readPdf(bytes) {
  const text = asLatin1(bytes);

  const version = (/^%PDF-(\d\.\d)/.exec(text) ?? [])[1] ?? null;

  // How many times this file has been saved. A PDF written once ends
  // with one %%EOF; every incremental save appends a new body, a new
  // cross-reference section and another %%EOF, and the trailers chain
  // backwards through /Prev. This is the single most useful thing in
  // the file: a document the issuer generated and nobody touched has
  // exactly one revision.
  const eofs = (text.match(/%%EOF/g) ?? []).length;
  const prevs = (text.match(/\/Prev\s+\d+/g) ?? []).length;
  const revisions = Math.max(1, eofs);

  const streams = findStreams(text);

  // Document information dictionary. Read from the raw text, which
  // works whenever it is not itself inside a compressed object stream.
  // Creation is the FIRST one — when the document was originally
  // written — and modification is the LAST. Together they say whether
  // anything happened in between.
  const info = {
    producer: lastMatch(text, 'Producer'),
    creator: lastMatch(text, 'Creator'),
    title: lastMatch(text, 'Title'),
    author: lastMatch(text, 'Author'),
    createdAt: pdfDate(firstMatch(text, 'CreationDate')),
    modifiedAt: pdfDate(lastMatch(text, 'ModDate')),
  };

  // Fonts, by the name the file gives them. A subset prefix (six
  // capitals and a plus) means the font was embedded by whatever
  // produced the file; two different subsets of the same family in one
  // document usually means two different producers touched it.
  const fonts = [...new Set((text.match(/\/BaseFont\s*\/([A-Za-z0-9#+.\-]+)/g) ?? [])
    .map((f) => f.replace(/\/BaseFont\s*\//, '')))];

  const signatures = (text.match(/\/Type\s*\/Sig\b/g) ?? []).length
    + (text.match(/\/SubFilter\s*\/(adbe|ETSI)[A-Za-z0-9.\-]*/g) ?? []).length;

  // Decode every content stream, keeping track of which object each
  // one belongs to. When a file has been saved twice the same object
  // number appears more than once, and the LAST definition is the one
  // a reader displays — the earlier ones are what the page used to
  // say. Both are kept here, because the difference between them is
  // the most direct evidence of tampering a document can offer: not an
  // inference from metadata, but the previous wording still sitting in
  // the file beside the new one.
  const byObject = new Map();
  const metadataXml = [];
  for (const st of streams) {
    if (st.isImage) continue;
    const raw = bytes.subarray(st.start, st.end);
    let body = null;
    if (st.flate) {
      const out = await inflate(raw);
      if (out) body = asLatin1(out);
    } else {
      body = asLatin1(raw);
    }
    if (!body) continue;

    if (st.isMetadata || /<x:xmpmeta|<rdf:RDF/.test(body)) { metadataXml.push(body); continue; }
    if (st.isObjStm) {
      // An object stream holds the objects a plain scan cannot see,
      // including, often, the document information dictionary.
      if (!info.producer) info.producer = lastMatch(body, 'Producer');
      if (!info.creator) info.creator = lastMatch(body, 'Creator');
      if (!info.createdAt) info.createdAt = pdfDate(firstMatch(body, 'CreationDate'));
      if (!info.modifiedAt) info.modifiedAt = pdfDate(lastMatch(body, 'ModDate'));
      continue;
    }

    const key = st.object ?? `anon_${byObject.size}`;
    if (!byObject.has(key)) byObject.set(key, []);
    byObject.get(key).push(body);
  }

  const decoded = [];
  const superseded = [];
  for (const versions of byObject.values()) {
    decoded.push(versions[versions.length - 1]);
    for (let i = 0; i < versions.length - 1; i++) superseded.push(versions[i]);
  }

  // XMP carries a second copy of the metadata and, when Acrobat has
  // been involved, an explicit history of what was done to the file.
  const xmp = metadataXml.join('\n') || (/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/.exec(text) ?? [''])[0];
  const xmpValue = (tag) => {
    const m = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(xmp)
           ?? new RegExp(`${tag}="([^"]*)"`).exec(xmp);
    return m ? m[1].trim() : null;
  };
  const history = [...xmp.matchAll(/stEvt:action="([^"]*)"[\s\S]{0,300}?stEvt:when="([^"]*)"/g)]
    .map((m) => ({ action: m[1], at: m[2] }));

  const meta = {
    ...info,
    producer: info.producer ?? xmpValue('pdf:Producer'),
    creator: info.creator ?? xmpValue('xmp:CreatorTool'),
    createdAt: info.createdAt ?? xmpValue('xmp:CreateDate'),
    modifiedAt: info.modifiedAt ?? xmpValue('xmp:ModifyDate'),
    xmpHistory: history,
  };

  const runs = decoded.flatMap(extractText);
  const plainText = runs.map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim();

  const previousRuns = superseded.flatMap(extractText);
  const previousText = previousRuns.map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim();

  return {
    kind: 'pdf',
    version,
    bytes: bytes.length,
    revisions,
    incrementalUpdates: Math.max(0, revisions - 1),
    hasPrevChain: prevs > 0,
    pages: (text.match(/\/Type\s*\/Page\b/g) ?? []).length,
    streams: streams.length,
    images: streams.filter((s) => s.isImage).length,
    // The stream table, kept because "which object, how long, which
    // revision" is the first thing anybody asks when a reading looks
    // wrong, and reconstructing it afterwards means running the parser
    // again by hand.
    streamTable: streams.map((st) => ({
      object: st.object, bytes: st.end - st.start, flate: st.flate,
      image: st.isImage, metadata: st.isMetadata, objStm: st.isObjStm,
    })),
    fonts,
    signatures,
    hasAcroForm: /\/AcroForm\b/.test(text),
    annotations: (text.match(/\/Annots\b/g) ?? []).length,
    meta,
    runs,
    text: plainText,
    textLength: plainText.length,
    // What the page said before it was last saved, where an earlier
    // version of it is still in the file.
    previousText,
    changedFrom: previousText ? diffTokens(previousText, plainText) : null,
    // Said explicitly, because "no text" means two very different
    // things: a scan of a paper document has none legitimately, and a
    // document that claims to be issued electronically and has none is
    // a picture pretending to be a record.
    hasTextLayer: plainText.length > 40,
  };
}

// What changed between the superseded version of a page and the
// current one, at the level of words. Crude on purpose: it is not
// trying to produce a readable diff, only to name the values that are
// no longer what they were, which is the thing a reviewer wants to see
// first and the thing an applicant has to explain.
function diffTokens(before, after) {
  // Thousands separators are joined up first. Without that, "19 800.00"
  // splits into two tokens and the difference reads "was 19, now 29",
  // which is true and tells a reviewer nothing.
  const split = (s) => s
    .replace(/(\d)[ ,](\d{3})\b/g, '$1$2')
    .replace(/(\d)[ ,](\d{3})\b/g, '$1$2')
    .split(/\s+/).filter(Boolean);
  const a = split(before);
  const b = split(after);
  const bCount = new Map();
  for (const t of b) bCount.set(t, (bCount.get(t) ?? 0) + 1);
  const aCount = new Map();
  for (const t of a) aCount.set(t, (aCount.get(t) ?? 0) + 1);

  const removed = a.filter((t) => {
    const n = bCount.get(t) ?? 0;
    if (n > 0) { bCount.set(t, n - 1); return false; }
    return true;
  });
  const added = b.filter((t) => {
    const n = aCount.get(t) ?? 0;
    if (n > 0) { aCount.set(t, n - 1); return false; }
    return true;
  });

  return {
    removed: removed.slice(0, 12),
    added: added.slice(0, 12),
    // A changed FIGURE is worth saying out loud. Words move around
    // when a template is regenerated; numbers do not change by
    // themselves.
    figuresChanged: removed.filter((t) => /\d/.test(t)).length > 0
      || added.filter((t) => /\d/.test(t)).length > 0,
  };
}
