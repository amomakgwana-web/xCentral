// ══════════════════════════════════════════════════════════════
// The pixel primitives every other vision module is built from.
//
// Nothing here makes a judgement. These are the measurements —
// luminance planes, gradients, local statistics, correlation — and the
// modules above decide what they mean. Keeping them in one place means
// the face descriptor and the document forensics agree on what
// "grayscale" and "high-pass energy" are, rather than each inventing a
// slightly different version and producing numbers that cannot be
// compared.
//
// Everything works on a plain canvas and returns plain typed arrays,
// so any of it can be exercised from a test without a camera.
// ══════════════════════════════════════════════════════════════

// Rec. 601 luma. The same weights the capture metrics already use, so
// a sharpness figure means the same thing everywhere in the system.
export function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function drawScaled(src, w, h) {
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

export function cropCanvas(src, x, y, w, h) {
  const cx = Math.max(0, Math.round(x));
  const cy = Math.max(0, Math.round(y));
  const cw = Math.max(1, Math.min(src.width - cx, Math.round(w)));
  const ch = Math.max(1, Math.min(src.height - cy, Math.round(h)));
  const out = makeCanvas(cw, ch);
  out.getContext('2d').drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch);
  return out;
}

// A plane is the unit the rest of the code passes around: one channel
// of floats plus its dimensions. Keeping width and height with the
// data avoids the classic bug of indexing a plane with the wrong
// stride after a resize.
export function toPlane(canvas, maxWidth = 0) {
  const scale = maxWidth ? Math.min(1, maxWidth / canvas.width) : 1;
  const work = scale < 1
    ? drawScaled(canvas, canvas.width * scale, canvas.height * scale)
    : canvas;

  const w = work.width;
  const h = work.height;
  const { data } = work.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  const r = new Float32Array(w * h);
  const g = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    r[p] = data[i]; g[p] = data[i + 1]; b[p] = data[i + 2];
    gray[p] = luma(data[i], data[i + 1], data[i + 2]);
  }
  return { gray, r, g, b, w, h };
}

export function meanStd(values, from = 0, to = values.length) {
  let sum = 0;
  let n = 0;
  for (let i = from; i < to; i++) { sum += values[i]; n++; }
  if (!n) return { mean: 0, std: 0, n: 0 };
  const mean = sum / n;
  let sq = 0;
  for (let i = from; i < to; i++) { const d = values[i] - mean; sq += d * d; }
  return { mean, std: Math.sqrt(sq / n), n };
}

// Separable box blur, run twice. Two box passes approximate a Gaussian
// closely enough for the uses here (local illumination, noise floor)
// and cost a fraction of a real convolution.
export function boxBlur(plane, radius = 2) {
  const { w, h } = plane;
  const src = plane.gray ?? plane.data ?? plane;
  const pass = (input) => {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -radius; x <= radius; x++) acc += input[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (radius * 2 + 1);
        acc -= input[row + clamp(x - radius, 0, w - 1)];
        acc += input[row + clamp(x + radius + 1, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -radius; y <= radius; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (radius * 2 + 1);
        acc -= tmp[clamp(y - radius, 0, h - 1) * w + x];
        acc += tmp[clamp(y + radius + 1, 0, h - 1) * w + x];
      }
    }
    return out;
  };
  return pass(pass(src));
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// The residual after removing the local average: everything the blur
// threw away. Print texture, sensor noise and compression artefacts
// all live here, which is what makes it the basis of the substitution
// checks — two regions printed by the same process have the same
// residual character, a pasted photograph does not.
export function highPass(plane, radius = 2) {
  const low = boxBlur(plane, radius);
  const src = plane.gray ?? plane;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] - low[i];
  return out;
}

export function sobel(plane) {
  const { gray, w, h } = plane;
  const mag = new Float32Array(w * h);
  const dir = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1]
                 + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1]
                 + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
      dir[i] = Math.atan2(gy, gx);
    }
  }
  return { mag, dir, w, h };
}

// Zero-mean normalised cross-correlation: how alike two equally sized
// patches are, independent of brightness and gain. -1 to 1.
//
// Independence from gain is the point. Two photographs of the same
// card under different lights differ hugely in raw pixel values and
// hardly at all in structure, and it is the structure that carries the
// identity.
export function ncc(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 1e-6 ? num / den : 0;
}

export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den > 1e-9 ? dot / den : 0;
}

// Pulls a rectangular patch out of a plane as a flat array, for
// correlation. Out-of-bounds reads clamp to the edge rather than
// wrapping, so a patch near the border degrades instead of picking up
// pixels from the opposite side.
export function patch(plane, cx, cy, size) {
  const { gray, w, h } = plane;
  const half = Math.floor(size / 2);
  // Rounded, and deliberately so. A typed array indexed by 102.7
  // returns undefined rather than throwing, every arithmetic step
  // downstream turns into NaN, and the comparison that follows simply
  // never finds a match — a silent, total failure that looks exactly
  // like "the subject did not move".
  const ox = Math.round(cx) - half;
  const oy = Math.round(cy) - half;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = clamp(oy + y, 0, h - 1);
    for (let x = 0; x < size; x++) {
      const sx = clamp(ox + x, 0, w - 1);
      out[y * size + x] = gray[sy * w + sx];
    }
  }
  return out;
}

// A percentile of a plane over a rectangle, and over everything
// outside it.
//
// The percentile matters. Averaging |high-pass| over a region is
// dominated by whatever content the region happens to contain — a face
// has eyes and a card has text, and the one with more edges wins
// regardless of how it was printed. The 60th percentile is a value
// from the region's SMOOTH majority, where nothing lives except the
// noise the printing process and the sensor left behind. That is the
// quantity these checks are actually about.
export function regionPercentile(values, w, h, rect, p = 0.6) {
  const x0 = clamp(Math.round(rect.x), 0, w - 1);
  const y0 = clamp(Math.round(rect.y), 0, h - 1);
  const x1 = clamp(Math.round(rect.x + rect.width), 0, w);
  const y1 = clamp(Math.round(rect.y + rect.height), 0, h);

  const inside = [];
  const outside = [];
  // Every fourth pixel: a percentile does not need all of them, and
  // this keeps a full-resolution document under a few milliseconds.
  for (let y = 0; y < h; y += 2) {
    const inRow = y >= y0 && y < y1;
    for (let x = 0; x < w; x += 2) {
      const v = values[y * w + x];
      if (inRow && x >= x0 && x < x1) inside.push(v);
      else outside.push(v);
    }
  }
  const pick = (arr) => {
    if (!arr.length) return 0;
    arr.sort((a, b) => a - b);
    return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  };
  return { inside: pick(inside), outside: pick(outside), insideN: inside.length, outsideN: outside.length };
}

// The white point of a region, approximated by the colour of its
// brightest pixels. Two printers disagree about white; a face and a
// card disagree about being a face, which is why comparing their
// overall colour measures nothing useful and comparing their
// highlights measures the ink.
export function paperWhite(plane, rect, inside = true) {
  const { r, g, b, gray, w, h } = plane;
  const x0 = clamp(Math.round(rect.x), 0, w - 1);
  const y0 = clamp(Math.round(rect.y), 0, h - 1);
  const x1 = clamp(Math.round(rect.x + rect.width), 0, w);
  const y1 = clamp(Math.round(rect.y + rect.height), 0, h);

  const pixels = [];
  for (let y = 0; y < h; y += 2) {
    const inRow = y >= y0 && y < y1;
    for (let x = 0; x < w; x += 2) {
      const within = inRow && x >= x0 && x < x1;
      if (within !== inside) continue;
      const i = y * w + x;
      // Blown-out pixels carry no colour information at all — every
      // channel is clipped, so everything looks neutral.
      if (gray[i] > 248) continue;
      pixels.push(i);
    }
  }
  if (pixels.length < 24) return null;
  pixels.sort((a, c) => gray[c] - gray[a]);
  const top = pixels.slice(0, Math.max(12, Math.floor(pixels.length * 0.1)));
  let rs = 0;
  let bs = 0;
  for (const i of top) { rs += r[i]; bs += b[i]; }
  return rs / Math.max(1, bs);
}

// Re-encodes at a known JPEG quality and returns the per-pixel
// difference. A region that has already been through a different
// encoder, or was pasted in from another file, settles at a different
// error level than the rest of the frame — the basis of error level
// analysis.
export async function errorLevel(canvas, quality = 0.75, maxWidth = 640) {
  const src = drawScaled(canvas, Math.min(canvas.width, maxWidth),
    Math.min(canvas.width, maxWidth) * (canvas.height / canvas.width));
  const blob = await new Promise((r) => src.toBlob(r, 'image/jpeg', quality));
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('re-encode failed'));
      i.src = url;
    });
    const again = makeCanvas(src.width, src.height);
    again.getContext('2d').drawImage(img, 0, 0, src.width, src.height);

    const a = toPlane(src);
    const b = toPlane(again);
    const diff = new Float32Array(a.gray.length);
    for (let i = 0; i < diff.length; i++) diff[i] = Math.abs(a.gray[i] - b.gray[i]);
    return { diff, w: a.w, h: a.h };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Mean of a plane over a rectangle, and over everything outside it.
// Most of the substitution checks are a comparison of exactly this
// shape: the portrait against the card it sits on.
export function regionStats(values, w, h, rect) {
  const x0 = clamp(Math.round(rect.x), 0, w - 1);
  const y0 = clamp(Math.round(rect.y), 0, h - 1);
  const x1 = clamp(Math.round(rect.x + rect.width), 0, w);
  const y1 = clamp(Math.round(rect.y + rect.height), 0, h);

  let inSum = 0;
  let inN = 0;
  let outSum = 0;
  let outN = 0;
  for (let y = 0; y < h; y++) {
    const inRow = y >= y0 && y < y1;
    for (let x = 0; x < w; x++) {
      const v = values[y * w + x];
      if (inRow && x >= x0 && x < x1) { inSum += v; inN++; }
      else { outSum += v; outN++; }
    }
  }
  const inside = inN ? inSum / inN : 0;
  const outside = outN ? outSum / outN : 0;

  let inSq = 0;
  let outSq = 0;
  for (let y = 0; y < h; y++) {
    const inRow = y >= y0 && y < y1;
    for (let x = 0; x < w; x++) {
      const v = values[y * w + x];
      if (inRow && x >= x0 && x < x1) { const d = v - inside; inSq += d * d; }
      else { const d = v - outside; outSq += d * d; }
    }
  }

  return {
    inside,
    outside,
    insideStd: inN ? Math.sqrt(inSq / inN) : 0,
    outsideStd: outN ? Math.sqrt(outSq / outN) : 0,
    insideN: inN,
    outsideN: outN,
  };
}
