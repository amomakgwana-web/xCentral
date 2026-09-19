// ══════════════════════════════════════════════════════════════
// Finding a face, and deciding whether two of them look like the same
// person.
//
// BE CLEAR ABOUT WHAT THIS IS. This is not a trained face recogniser.
// A face recogniser is a network trained on millions of labelled
// identities, and its output is calibrated against a measured false
// match rate. Nothing here is trained on anything.
//
// What this computes is APPEARANCE SIMILARITY: a descriptor built from
// gradient orientation histograms and local binary patterns over an
// illumination-normalised crop, compared by cosine. It is real
// arithmetic over real pixels, it is deterministic, and it separates
// "plainly the same photograph of a person" from "plainly a different
// person" reliably. It does not separate identical twins, and it will
// be beaten by a large pose or age difference.
//
// So the number it produces is reported under its own name, never as a
// biometric match. The identity verdict is issued by the biometric
// model behind the provider interface — in this environment the
// simulation model, which is a declared function of the measurement
// below, so a reader can always see what the verdict was computed
// from. Swapping in a real SDK replaces the verdict, not the
// measurement.
// ══════════════════════════════════════════════════════════════

import {
  boxBlur, clamp, cosine, cropCanvas, drawScaled, makeCanvas, ncc, toPlane,
} from './image.js';

// The descriptor is computed at a fixed geometry so two descriptors
// are always comparable: a passport portrait and a webcam frame end up
// the same size before anything is measured.
const FACE_W = 64;
const FACE_H = 80;
const CELL = 8;
const BINS = 9;

// ── Locating a face ─────────────────────────────────────────────
export function shapeDetectionAvailable() {
  return typeof window !== 'undefined' && 'FaceDetector' in window;
}

// The Shape Detection API where the browser has it; a chroma-and-shape
// locator where it does not.
//
// The fallback is honest about being a locator rather than a detector:
// it finds the largest coherent skin-toned region with a plausible
// face shape. On a portrait that is the face. On a beach photograph it
// might be an arm. Its method is carried in the result so nothing
// downstream can mistake it for a detection.
export async function locateFace(canvas) {
  if (shapeDetectionAvailable()) {
    try {
      const detector = new window.FaceDetector({ fastMode: false, maxDetectedFaces: 8 });
      const faces = await detector.detect(canvas);
      if (faces.length) {
        const boxes = faces.map((f) => ({
          x: f.boundingBox.x,
          y: f.boundingBox.y,
          width: f.boundingBox.width,
          height: f.boundingBox.height,
          landmarks: (f.landmarks ?? []).map((l) => ({
            type: l.type,
            x: l.locations?.[0]?.x ?? null,
            y: l.locations?.[0]?.y ?? null,
          })),
        }));
        boxes.sort((a, b) => b.width * b.height - a.width * a.height);
        return {
          method: 'shape_detection',
          count: boxes.length,
          box: boxes[0],
          boxes,
          areaPct: pctOfFrame(boxes[0], canvas),
        };
      }
      // The detector ran and found nothing. That is a measurement, not
      // a gap, so it is reported as zero faces rather than falling
      // through to the weaker method and contradicting it.
      return { method: 'shape_detection', count: 0, box: null, boxes: [], areaPct: 0 };
    } catch { /* fall through to the locator */ }
  }

  const found = chromaLocate(canvas);
  return found.length
    ? {
      method: 'chroma_locator',
      count: found.length,
      box: found[0],
      boxes: found,
      areaPct: pctOfFrame(found[0], canvas),
    }
    : { method: 'chroma_locator', count: 0, box: null, boxes: [], areaPct: 0 };
}

function pctOfFrame(box, canvas) {
  const area = canvas.width * canvas.height;
  return area ? Number((((box.width * box.height) / area) * 100).toFixed(2)) : 0;
}

// Skin in YCbCr. The useful property is that skin of every tone sits
// in a narrow chroma band — what varies between people is luma, which
// is exactly the channel this rule ignores. A rule written in RGB
// instead would work on light skin and fail on dark skin, which is not
// a subtle bug: it is the system refusing to see some of its users.
function skinMask(plane) {
  const { r, g, b, w, h } = plane;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    const cb = 128 - 0.168736 * r[i] - 0.331264 * g[i] + 0.5 * b[i];
    const cr = 128 + 0.5 * r[i] - 0.418688 * g[i] - 0.081312 * b[i];
    const y = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
    // The luma bound only removes pixels too dark or too blown out to
    // carry usable chroma at all.
    mask[i] = (cb >= 76 && cb <= 130 && cr >= 132 && cr <= 178 && y > 30 && y < 250) ? 1 : 0;
  }
  return { mask, w, h };
}

function chromaLocate(canvas) {
  const plane = toPlane(canvas, 240);
  const { mask, w, h } = skinMask(plane);

  // Largest connected component, flood filled iteratively. A recursive
  // fill blows the stack on a big region, which is precisely the case
  // that matters here.
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const found = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    let n = 0;

    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[sp++] = i + w; }
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const aspect = bw / bh;
    // A face is taller than it is wide, and fills most of its own
    // bounding box. A forearm fails the first test; a scattered mask
    // of background fails the second.
    const fill = n / (bw * bh);
    if (aspect < 0.55 || aspect > 1.35 || fill < 0.45) continue;
    if (n < mask.length * 0.004) continue;
    found.push({ n, minX, minY, bw, bh });
  }

  // Every candidate, largest first, not just the winner. A document
  // carrying a second, smaller copy of the portrait has two, and the
  // pair of them is the strongest substitution check there is —
  // returning only the biggest would throw that check away before it
  // could run.
  found.sort((a, b) => b.n - a.n);
  const scale = canvas.width / w;
  return found.slice(0, 4).map((f) => ({
    x: f.minX * scale,
    y: f.minY * scale,
    width: f.bw * scale,
    height: f.bh * scale,
    landmarks: [],
  }));
}

// ── Alignment ───────────────────────────────────────────────────
// Where the detector gives eye positions, the crop is rotated so the
// eyes are level and scaled so they sit a fixed distance apart. That
// single step removes most of the variation between a phone held at an
// angle and a flatbed scan of a passport page, and it is the
// difference between a descriptor that compares faces and one that
// compares head tilts.
export function alignFace(canvas, box) {
  const eyes = (box.landmarks ?? []).filter((l) => l.type === 'eye' && l.x !== null);

  if (eyes.length >= 2) {
    const [a, b] = eyes.sort((p, q) => p.x - q.x);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 4) {
      const angle = Math.atan2(dy, dx);
      // Eyes at 42% of the width, 38% down, 38% of the width apart:
      // the proportions of a standard passport portrait.
      const scale = (FACE_W * 0.38) / dist;
      const out = makeCanvas(FACE_W, FACE_H);
      const ctx = out.getContext('2d');
      ctx.translate(FACE_W * 0.5, FACE_H * 0.38);
      ctx.rotate(-angle);
      ctx.scale(scale, scale);
      ctx.translate(-(a.x + b.x) / 2, -(a.y + b.y) / 2);
      ctx.drawImage(canvas, 0, 0);
      return { canvas: out, aligned: 'landmarks' };
    }
  }

  // No landmarks: crop INSIDE the box and resize. Inside, not around —
  // the outline of a head is the most powerful structure in the frame
  // and it is nearly the same structure for everybody, so a crop that
  // includes it produces descriptors that agree with each other about
  // being head-shaped and have very little left over to disagree
  // about. Two different people scored 0.96 that way. What tells
  // people apart lives between the brows and the chin.
  const inset = cropCanvas(canvas,
    box.x + box.width * 0.11,
    box.y + box.height * 0.15,
    box.width * 0.78,
    box.height * 0.72);
  return { canvas: drawScaled(inset, FACE_W, FACE_H), aligned: 'bounding_box' };
}

// Divide out the local illumination. What is left is the shape of the
// face rather than the light that happened to be falling on it, which
// is what lets a portrait photographed under a counter lamp compare
// against one printed by Home Affairs.
function selfQuotient(plane) {
  const low = boxBlur(plane, 4);
  const out = new Float32Array(plane.gray.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = plane.gray[i] / Math.max(8, low[i]);
  }
  return { gray: out, w: plane.w, h: plane.h };
}

// ── The descriptor ──────────────────────────────────────────────
function hog(plane) {
  const { gray, w, h } = plane;
  const cellsX = Math.floor(w / CELL);
  const cellsY = Math.floor(h / CELL);
  const cells = new Float32Array(cellsX * cellsY * BINS);

  for (let y = 1; y < h - 1; y++) {
    const cy = Math.min(cellsY - 1, Math.floor(y / CELL));
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      const mag = Math.hypot(gx, gy);
      if (mag < 1e-6) continue;
      // Unsigned orientation: a dark-to-light edge and a light-to-dark
      // edge at the same angle are the same structure, and treating
      // them as different would make the descriptor depend on whether
      // the subject wore a white shirt.
      let ang = Math.atan2(gy, gx);
      if (ang < 0) ang += Math.PI;
      const bin = Math.min(BINS - 1, Math.floor((ang / Math.PI) * BINS));
      const cx = Math.min(cellsX - 1, Math.floor(x / CELL));
      cells[(cy * cellsX + cx) * BINS + bin] += mag;
    }
  }

  // 2×2 block normalisation with L2-Hys. Normalising per block rather
  // than globally is what makes the descriptor robust to a bright
  // window behind one side of the face.
  const out = [];
  for (let by = 0; by < cellsY - 1; by++) {
    for (let bx = 0; bx < cellsX - 1; bx++) {
      const block = [];
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const base = ((by + dy) * cellsX + (bx + dx)) * BINS;
          for (let k = 0; k < BINS; k++) block.push(cells[base + k]);
        }
      }
      let norm = Math.sqrt(block.reduce((s, v) => s + v * v, 0)) + 1e-6;
      for (let k = 0; k < block.length; k++) block[k] = Math.min(block[k] / norm, 0.2);
      norm = Math.sqrt(block.reduce((s, v) => s + v * v, 0)) + 1e-6;
      for (let k = 0; k < block.length; k++) out.push(block[k] / norm);
    }
  }
  return Float32Array.from(out);
}

// Uniform local binary patterns, 8 neighbours at radius 1, histogrammed
// over a grid. LBP answers a different question from HOG — texture
// rather than edge structure — so the two disagree in useful ways: a
// printed photocopy of a face keeps its edges and loses its texture.
const LBP_UNIFORM = buildUniformTable();
function buildUniformTable() {
  const table = new Uint8Array(256);
  let next = 0;
  for (let v = 0; v < 256; v++) {
    let transitions = 0;
    for (let b = 0; b < 8; b++) {
      const a1 = (v >> b) & 1;
      const a2 = (v >> ((b + 1) % 8)) & 1;
      if (a1 !== a2) transitions++;
    }
    table[v] = transitions <= 2 ? next++ : 58;
  }
  return table;
}

function lbp(plane, gridX = 4, gridY = 5) {
  const { gray, w, h } = plane;
  const bins = 59;
  const hist = new Float32Array(gridX * gridY * bins);
  const cw = w / gridX;
  const ch = h / gridY;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const c = gray[i];
      let code = 0;
      code |= (gray[i - w - 1] >= c ? 1 : 0) << 0;
      code |= (gray[i - w] >= c ? 1 : 0) << 1;
      code |= (gray[i - w + 1] >= c ? 1 : 0) << 2;
      code |= (gray[i + 1] >= c ? 1 : 0) << 3;
      code |= (gray[i + w + 1] >= c ? 1 : 0) << 4;
      code |= (gray[i + w] >= c ? 1 : 0) << 5;
      code |= (gray[i + w - 1] >= c ? 1 : 0) << 6;
      code |= (gray[i - 1] >= c ? 1 : 0) << 7;

      const gx = Math.min(gridX - 1, Math.floor(x / cw));
      const gy = Math.min(gridY - 1, Math.floor(y / ch));
      hist[(gy * gridX + gx) * bins + LBP_UNIFORM[code]] += 1;
    }
  }

  // Per-region L1 normalisation, so a region that happens to be larger
  // does not dominate the comparison.
  for (let rgn = 0; rgn < gridX * gridY; rgn++) {
    let sum = 0;
    for (let k = 0; k < bins; k++) sum += hist[rgn * bins + k];
    if (sum > 0) for (let k = 0; k < bins; k++) hist[rgn * bins + k] /= sum;
  }
  return hist;
}

function centre(vec) {
  let m = 0;
  for (let i = 0; i < vec.length; i++) m += vec[i];
  m /= (vec.length || 1);
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] - m;
  return out;
}

function l2(vec) {
  let n = 0;
  for (let i = 0; i < vec.length; i++) n += vec[i] * vec[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n;
  return out;
}

// The descriptor: the two halves normalised separately and then
// weighted, so neither can swamp the other purely by having more
// dimensions.
export async function faceDescriptor(canvas, boxOrNull = null) {
  const located = boxOrNull ? { box: boxOrNull, method: 'given' } : await locateFace(canvas);
  if (!located.box) return null;

  const { canvas: aligned, aligned: how } = alignFace(canvas, located.box);
  const plane = toPlane(aligned);
  const normalised = selfQuotient(plane);

  // Centred before it is normalised. Every face shares a great deal of
  // structure — two eyes, a nose between them, a mouth below — and
  // that shared part is a large constant in the descriptor. Cosine
  // against a large constant is close to one whoever the two people
  // are, which is how an earlier version scored two different faces at
  // 0.97 and could not tell anybody apart. Removing the mean leaves
  // only what differs between faces, which is the whole question.
  const gradients = l2(centre(hog(normalised)));
  const texture = lbp(plane);

  // A small greyscale thumbnail travels with the descriptor. It costs
  // almost nothing and lets two portraits be correlated directly,
  // which is how the ghost portrait on a card is checked against the
  // main one.
  const thumbCanvas = drawScaled(aligned, 24, 30);
  const thumb = toPlane(thumbCanvas).gray;

  // One vector, carrying the two parts that were measured to separate
  // people: gradient structure, and gross layout. Anything crossing a
  // service boundary arrives as one array of numbers, so the single
  // vector has to be the WHOLE comparison — not a weaker stand-in for
  // one the page could have made.
  //
  // Two earlier versions got this wrong, in opposite directions. The
  // first concatenated the raw local-binary-pattern histograms: every
  // face fills the same bins, so any two people scored about 0.99 and
  // the pipeline called a stranger's document a match. The second
  // centred those histograms, which helped the cosine and did nothing
  // for the chi-square that was supposed to use them — measured
  // against synthetic pairs, the texture term saturated at its floor
  // for EVERY non-identical pair and contributed a constant. So the
  // texture is computed and reported, because it is informative to
  // look at, and it is not part of the score.
  const parts = [[gradients, 0.70], [l2(centre(thumb)), 0.30]];
  const total = parts.reduce((n, [v]) => n + v.length, 0);
  const vec = new Float32Array(total);
  let at = 0;
  for (const [v, weight] of parts) {
    for (let i = 0; i < v.length; i++) vec[at + i] = v[i] * weight;
    at += v.length;
  }

  return {
    vector: l2(vec),
    gradients,
    texture,
    thumb,
    thumbSize: { w: 24, h: 30 },
    box: located.box,
    method: located.method,
    alignment: how,
    dimensions: vec.length,
  };
}

// Histograms are not vectors, and treating them as though they were is
// the reason cosine is a poor way to compare them: it is dominated by
// the bins every face fills. Chi-square weights a difference by how
// rare the bin is, so a disagreement in an uncommon pattern — which is
// exactly what distinguishes one face from another — counts for
// something.
function chiSquare(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    const s = a[i] + b[i];
    if (s > 1e-9) sum += (d * d) / s;
  }
  return sum;
}

// ── Comparison ──────────────────────────────────────────────────
// Two numbers, because they fail differently. The descriptor cosine
// carries structure and texture; the thumbnail correlation carries
// gross layout. A pasted photograph of a different person scores badly
// on both. A poor crop scores badly on the second alone, which is a
// signal worth being able to see.
export function compareFaces(a, b) {
  if (!a || !b) return null;

  // The score is the cosine of the two descriptors, and nothing else.
  // One number, computed one way, wherever the comparison happens —
  // in this module, in the pipeline, or on the far side of a provider
  // interface that was handed the vector. When the page and the
  // pipeline each had their own formula they disagreed by a wide
  // margin on the same pair of photographs, and only one of them was
  // being shown to anybody.
  const appearance = cosine(a.vector, b.vector);

  // The parts, for a reader who wants to know WHY. They are reported,
  // not combined.
  const gradients = (a.gradients && b.gradients) ? cosine(a.gradients, b.gradients) : null;
  const thumbnail = (a.thumb && b.thumb && a.thumb.length === b.thumb.length)
    ? ncc(a.thumb, b.thumb) : null;
  const textureChi = (a.texture && b.texture) ? chiSquare(a.texture, b.texture) : null;

  return {
    appearanceSimilarity: Number(clamp(appearance, -1, 1).toFixed(4)),
    gradientCorrelation: gradients === null ? null : Number(gradients.toFixed(4)),
    thumbnailCorrelation: thumbnail === null ? null : Number(thumbnail.toFixed(4)),
    textureChiSquare: textureChi === null ? null : Number(textureChi.toFixed(4)),
    alignment: [a.alignment, b.alignment],
    // Said in the result itself, so it survives being copied into a
    // report or a screenshot without its caption.
    basis: 'cosine of a gradient-orientation descriptor and a layout thumbnail, both centred and '
         + 'taken over an illumination-normalised crop. Two different faces are alike to begin '
         + 'with — they are both faces — so the useful range is narrow and sits well above zero. '
         + 'Not a trained face recogniser.',
  };
}
