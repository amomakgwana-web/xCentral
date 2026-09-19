// ══════════════════════════════════════════════════════════════
// Has this document been seen before?
//
// Three fingerprints, because a duplicate arrives in three forms and
// each one defeats the check above it.
//
//   The same file.        Byte-identical. A SHA-256 catches it, and
//                         nothing else is needed.
//   The same picture.     Re-saved, re-compressed, cropped a little,
//                         a few pixels lighter. The bytes differ
//                         entirely. A perceptual hash does not: it
//                         describes the image's gross structure, and
//                         that survives everything an honest copy does
//                         to a file.
//   The same content.     Re-exported, retyped, a different template
//                         around the same numbers. Neither hash above
//                         survives that. A fingerprint over the words
//                         does, because the words are the part the
//                         fraudster needs to keep.
//
// The third is the one that matters for documents. A payslip submitted
// under two identities is usually not the same file — it has been
// opened, edited and saved — but it is the same employer, the same
// month and very nearly the same numbers, and that is what gets
// compared here.
// ══════════════════════════════════════════════════════════════

import { drawScaled, toPlane } from './image.js';

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Difference hash. Reduce to 9×8 greyscale and record, for each pair
// of neighbouring pixels, which was brighter. Only the RELATIONSHIPS
// are kept, so the result does not move when the whole image gets
// brighter, is re-compressed, or is scaled — and it does move when the
// content changes.
export function perceptualHash(canvas) {
  const small = drawScaled(canvas, 9, 8);
  const { gray, w } = toPlane(small);
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += gray[y * w + x] > gray[y * w + x + 1] ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

// How many of the 64 comparisons disagree. Zero is the same image.
// Real re-saves of one image land in the low single figures; two
// different documents of the same kind — same template, same layout —
// sit around twenty and up.
export function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

// ── Content ─────────────────────────────────────────────────────
function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    // Numbers are the point of a financial document, so they are kept
    // — but their formatting is not.
    .replace(/[\s]+/g, ' ')
    // Thousands separators, twice: "1 234 567" needs two passes.
    .replace(/(\d)[ ,](\d{3})\b/g, '$1$2')
    .replace(/(\d)[ ,](\d{3})\b/g, '$1$2')
    // The currency mark is not part of the number. "R25,000.00" and
    // "25 000.00" are the same amount written two ways, and a
    // fingerprint that treats them as different words fails at exactly
    // the thing it exists for — recognising one document re-exported
    // by something else.
    .replace(/\br(?=\d)/g, ' ')
    .replace(/[^a-z0-9. ]+/g, ' ')
    // A full stop that is not a decimal point is punctuation.
    .replace(/(\D)\.|\.(?!\d)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash32(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const SIGNATURE_LENGTH = 64;

// MinHash. For each of sixty-four independent hash functions, keep the
// smallest value any shingle produced. Two documents then agree on a
// position exactly as often as they share content, so comparing the
// signatures estimates how much they overlap without ever comparing
// the documents themselves — which is the property that makes it cheap
// enough to run every new upload against everything already on file.
export function textFingerprint(text) {
  const words = normalise(text).split(' ').filter(Boolean);
  if (words.length < 8) return null;

  // Four-word shingles: long enough that a shared phrase means
  // something, short enough to survive a reordered line.
  const shingles = new Set();
  for (let i = 0; i + 4 <= words.length; i++) shingles.add(words.slice(i, i + 4).join(' '));
  if (!shingles.size) return null;

  const signature = new Uint32Array(SIGNATURE_LENGTH).fill(0xFFFFFFFF);
  for (const shingle of shingles) {
    for (let k = 0; k < SIGNATURE_LENGTH; k++) {
      const v = hash32(shingle, 0x9E3779B9 + k * 0x85EBCA6B);
      if (v < signature[k]) signature[k] = v;
    }
  }
  return { signature: Array.from(signature), shingles: shingles.size, words: words.length };
}

// The estimated Jaccard overlap: the fraction of positions where two
// signatures agree.
export function fingerprintOverlap(a, b) {
  if (!a?.signature || !b?.signature) return null;
  let same = 0;
  for (let i = 0; i < SIGNATURE_LENGTH; i++) if (a.signature[i] === b.signature[i]) same++;
  return Number((same / SIGNATURE_LENGTH).toFixed(4));
}

// A shape fingerprint for a PDF: the sequence of fonts and sizes the
// text was drawn in, with the words thrown away. Two exports of the
// same template match even when every value inside differs — which is
// how one employer's payslips are recognised as one employer's
// payslips, and how a document claiming that employer but built in
// something else stands out.
export function layoutFingerprint(runs) {
  if (!runs?.length) return null;
  const shape = runs.map((r) => `${r.font ?? '?'}:${r.size ?? '?'}:${
    r.text.replace(/\d/g, '#').replace(/[a-z]/gi, 'a').slice(0, 12)}`).join('|');
  return textFingerprint(shape.replace(/\|/g, ' '));
}
