// ══════════════════════════════════════════════════════════════
// Is this identity document genuine, and is the photograph on it the
// one that was printed there?
//
// Photograph substitution is the oldest document fraud there is: take
// a real card belonging to someone else, lift the portrait, put your
// own in its place. It survives a human glance and it survives a face
// match — the face on the card really is the person holding it. The
// only thing that catches it is the card itself, because a portrait
// that was printed as part of a document and a portrait that was stuck
// on top of one are physically different objects.
//
// Every check below is a comparison between the portrait region and
// the card around it, and each one exploits a different way in which
// the two must agree if they were made together:
//
//   Noise floor    One print process, one paper, one sensor — one
//                  characteristic texture. A photograph from somewhere
//                  else brings its own.
//   Compression    A pasted region has been through an encoder the
//                  rest of the image has not.
//   Error level    The same thing measured differently: re-encode and
//                  see which regions have further to fall.
//   Colour         Two printers, two white points. The eye forgives
//                  it; the mean of the red and blue channels does not.
//   Focus          A card lies in one focal plane. A photograph glued
//                  or taped onto it sits a fraction above, and at
//                  close range that is a measurable difference in
//                  sharpness.
//   Boundary       Paper has an edge. Tape has a specular sheen. A
//                  printed portrait has neither, because there is
//                  nothing there to have an edge.
//   Ghost portrait Where the card carries a second, smaller copy of
//                  the same photograph, substituting the main one
//                  breaks the pair. This is the strongest check here,
//                  because defeating it means replacing both.
//
// None of these is conclusive alone, and the code never treats one as
// though it were: they are weighted signals, they are reported with
// their measured values so a reviewer can disagree, and a document
// that fails them is referred rather than rejected.
//
// I am NOT CERTAIN that the security-feature expectations in
// reference.js match every issued version of every South African
// document — card designs change, and I have no specimen to hand. They
// are held as configuration rows for exactly that reason: correcting
// them is a data change, not a code change.
// ══════════════════════════════════════════════════════════════

import {
  clamp, cropCanvas, drawScaled, errorLevel, highPass, meanStd, ncc, paperWhite,
  regionPercentile, regionStats, sobel, toPlane,
} from './image.js';
import { compareFaces, faceDescriptor, locateFace } from './face.js';

const WORK_W = 900; // documents carry fine detail; they are worth the pixels

// ── The card within the frame ───────────────────────────────────
// Finding the card's own edges matters because every check is a
// comparison against "the rest of the card". If the desk it is lying
// on is counted as card, the background statistics describe the desk.
export function findCard(plane) {
  const { mag, w, h } = sobel(plane);

  const colSum = new Float32Array(w);
  const rowSum = new Float32Array(h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = mag[y * w + x];
      colSum[x] += v;
      rowSum[y] += v;
    }
  }

  const edge = (sums, length, from, to, step) => {
    const { mean, std } = meanStd(sums);
    const threshold = mean + std * 1.4;
    for (let i = from; i !== to; i += step) {
      if (sums[i] > threshold) return i;
    }
    return step > 0 ? from : to;
  };

  // Search only the outer fifth from each side: the strongest edges in
  // the middle of a card are its own printed content, not its border.
  const margin = { x: Math.floor(w * 0.2), y: Math.floor(h * 0.2) };
  const left = edge(colSum, w, 0, margin.x, 1);
  const right = edge(colSum, w, w - 1, w - margin.x, -1);
  const top = edge(rowSum, h, 0, margin.y, 1);
  const bottom = edge(rowSum, h, h - 1, h - margin.y, -1);

  const rect = {
    x: left, y: top, width: Math.max(8, right - left), height: Math.max(8, bottom - top),
  };
  // A card that ended up smaller than half the frame means the edge
  // search locked onto printed content. Better to use the whole frame
  // and say so than to measure the wrong rectangle.
  const credible = rect.width > w * 0.5 && rect.height > h * 0.4;
  return credible
    ? { ...rect, method: 'edge_projection' }
    : { x: 0, y: 0, width: w, height: h, method: 'whole_frame' };
}

// ── Individual measurements ─────────────────────────────────────
function blockiness(plane, rect) {
  // Mean absolute difference across the 8-pixel JPEG grid lines
  // against the mean within the blocks. A value near 1 means no grid
  // survived; well above 1 means the image carries visible block
  // structure.
  const { gray, w } = plane;
  let across = 0;
  let acrossN = 0;
  let within = 0;
  let withinN = 0;
  const x0 = Math.max(1, Math.round(rect.x));
  const y0 = Math.max(1, Math.round(rect.y));
  const x1 = Math.min(w - 1, Math.round(rect.x + rect.width));
  const y1 = Math.min(plane.h - 1, Math.round(rect.y + rect.height));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.abs(gray[y * w + x] - gray[y * w + x - 1]);
      if (x % 8 === 0) { across += d; acrossN++; } else { within += d; withinN++; }
    }
  }
  const a = acrossN ? across / acrossN : 0;
  const b = withinN ? within / withinN : 0;
  return b > 1e-6 ? a / b : 1;
}

// Focus, measured in a way that does not depend on how much is in the
// picture. Raw detail is useless here: a face has eyes and a card has
// text, so whichever region happens to carry more edges wins whatever
// the optics were doing. The ratio of fine detail to coarse detail
// does not have that problem — it asks how sharply the edges that ARE
// there fall off, which is what focus means.
function focusRatio(fine, coarse, w, h, rect) {
  const f = regionPercentile(fine, w, h, rect, 0.85);
  const c = regionPercentile(coarse, w, h, rect, 0.85);
  const inside = c.inside > 1e-6 ? f.inside / c.inside : 0;
  const outside = c.outside > 1e-6 ? f.outside / c.outside : 0;
  return { inside, outside, ratio: outside > 1e-6 ? inside / outside : 1 };
}

// A physical photograph laid onto a card has a thickness. That
// thickness casts a thin shadow along its edge, or catches the light
// as a bright line where tape holds it down. A portrait that was
// PRINTED has neither, because there is nothing there to have an edge
// — the ink is in the card.
//
// So this looks for a ridge: a narrow band of pixels along the
// boundary that is markedly darker or markedly brighter than the card
// a few millimetres further out. Measuring raw edge energy instead, as
// an earlier version did, fired on every genuine card in existence —
// a printed portrait has a perfectly good border too.
function boundaryRidge(plane, rect) {
  const { gray, w, h } = plane;
  const ring = (inset, thickness) => {
    let sum = 0;
    let n = 0;
    const x0 = Math.round(rect.x - inset);
    const y0 = Math.round(rect.y - inset);
    const x1 = Math.round(rect.x + rect.width + inset);
    const y1 = Math.round(rect.y + rect.height + inset);
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        const onRing = x < x0 + thickness || x >= x1 - thickness
          || y < y0 + thickness || y >= y1 - thickness;
        if (!onRing) continue;
        sum += gray[y * w + x]; n++;
      }
    }
    return n ? sum / n : null;
  };

  const atEdge = ring(2, 4);       // straddling the boundary
  const nearby = ring(16, 8);      // card, a few millimetres out
  if (atEdge === null || nearby === null) return { delta: 0, atEdge: 0, nearby: 0 };
  return {
    delta: Number((atEdge - nearby).toFixed(2)),
    atEdge: Number(atEdge.toFixed(1)),
    nearby: Number(nearby.toFixed(1)),
  };
}

function specular(plane, rect) {
  const { gray, w, h } = plane;
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(w, Math.round(rect.x + rect.width));
  const y1 = Math.min(h, Math.round(rect.y + rect.height));
  let blown = 0;
  let n = 0;
  let longestRun = 0;
  for (let y = y0; y < y1; y++) {
    let run = 0;
    for (let x = x0; x < x1; x++) {
      const v = gray[y * w + x];
      n++;
      if (v > 246) { blown++; run++; if (run > longestRun) longestRun = run; } else run = 0;
    }
  }
  return {
    blownPct: n ? Number(((blown / n) * 100).toFixed(2)) : 0,
    longestRunPct: rect.width ? Number(((longestRun / rect.width) * 100).toFixed(2)) : 0,
  };
}

// A photograph of a screen carries the screen's pixel grid. That grid
// beats against the camera's sensor grid and leaves a regular ripple —
// moiré — which shows up as a periodic peak in the autocorrelation of
// the high-pass signal. Paper has no such period.
function screenPeriodicity(plane) {
  const { w, h } = plane;

  // Two channels, because a display and a printing press ripple
  // differently. A screen's grid is made of red, green and blue
  // subpixels at slightly different positions, so when it beats
  // against the camera's own grid the ripple carries COLOUR. Ink laid
  // down in one pass ripples in brightness alone. Requiring both is
  // what stops fine line work on a genuine card from reading as a
  // screenshot — which it did, on every card, when this looked at
  // brightness only.
  const chroma = new Float32Array(plane.gray.length);
  for (let i = 0; i < chroma.length; i++) chroma[i] = plane.r[i] - plane.b[i];

  const lumaHp = highPass(plane, 1);
  const chromaHp = highPass({ gray: chroma, w, h }, 1);

  // The autocorrelation of one channel's high-pass energy along one
  // axis, at every candidate pitch.
  const axisProfile = (values, length, other, index) => {
    const profile = new Float32Array(length);
    for (let a = 0; a < length; a++) {
      let s2 = 0;
      for (let b = 0; b < other; b++) s2 += Math.abs(values[index(a, b)]);
      profile[a] = s2 / other;
    }
    const { mean } = meanStd(profile);
    for (let a = 0; a < length; a++) profile[a] -= mean;
    let zero = 0;
    for (let a = 0; a < length; a++) zero += profile[a] * profile[a];

    // Below three pixels is sensor noise. Above sixteen is the card's
    // own layout — line work, text baselines — rather than a display's
    // pixel pitch beating against a sensor.
    const out = new Float32Array(Math.min(17, length));
    if (zero < 1e-6) return out;
    for (let lag = 3; lag < out.length; lag++) {
      let acc = 0;
      for (let a = 0; a + lag < length; a++) acc += profile[a] * profile[a + lag];
      out[lag] = acc / zero;
    }
    return out;
  };

  const byRow = (a, b) => b * w + a;
  const byCol = (a, b) => a * w + b;
  const profiles = [
    axisProfile(lumaHp, w, h, byRow),
    axisProfile(lumaHp, h, w, byCol),
    axisProfile(chromaHp, w, h, byRow),
    axisProfile(chromaHp, h, w, byCol),
  ];

  // One pitch that is strong in every one of them. Taking each axis's
  // own best lag separately compares a screen's pitch against a card's
  // layout and concludes nothing.
  let best = { score: 0, lag: 0 };
  const shortest = Math.min(...profiles.map((p) => p.length));
  for (let lag = 3; lag < shortest; lag++) {
    const weakest = Math.min(...profiles.map((p) => p[lag] ?? 0));
    if (weakest > best.score) best = { score: weakest, lag };
  }

  return {
    periodicity: Number(clamp(best.score, 0, 1).toFixed(4)),
    lag: best.lag,
    luma: Number(Math.min(profiles[0][best.lag] ?? 0, profiles[1][best.lag] ?? 0).toFixed(4)),
    chroma: Number(Math.min(profiles[2][best.lag] ?? 0, profiles[3][best.lag] ?? 0).toFixed(4)),
  };
}

// The machine-readable zone is two or three lines of a fixed-pitch
// font on an otherwise plain band. Its signature is a strip whose
// vertical stroke density is high and evenly spaced.
//
// Locating it is not reading it. Transcribing OCR-B needs a recogniser
// this environment does not have, so the band is found and the
// operator is asked to type what it says — at which point the check
// digits can be verified for real.
function findMrzBand(plane) {
  const { gray, w, h } = plane;
  let best = null;
  const bandHeight = Math.max(8, Math.round(h * 0.06));

  for (let y0 = Math.floor(h * 0.55); y0 < h - bandHeight; y0 += 4) {
    let crossings = 0;
    let n = 0;
    for (let y = y0; y < y0 + bandHeight; y++) {
      let prev = gray[y * w] > 128;
      for (let x = 1; x < w; x++) {
        const cur = gray[y * w + x] > 128;
        if (cur !== prev) crossings++;
        prev = cur;
        n++;
      }
    }
    const density = n ? crossings / n : 0;
    if (!best || density > best.density) best = { y: y0, height: bandHeight, density };
  }

  return best
    ? {
      found: best.density > 0.05,
      y: best.y,
      height: best.height,
      strokeDensity: Number(best.density.toFixed(4)),
    }
    : { found: false };
}

// ── The whole examination ───────────────────────────────────────
export async function analyseDocument(canvas, { docType = 'sa_id_card', features = {} } = {}) {
  const plane = toPlane(canvas, WORK_W);
  const scale = plane.w / canvas.width;
  const card = findCard(plane);

  const located = await locateFace(canvas);
  const portraits = located.boxes.map((b) => ({
    x: b.x * scale, y: b.y * scale, width: b.width * scale, height: b.height * scale,
    landmarks: b.landmarks,
  }));
  portraits.sort((a, b) => b.width * b.height - a.width * a.height);
  const portrait = portraits[0] ?? null;
  const ghost = portraits[1] ?? null;

  const signals = [];
  const push = (code, fired, value, detail) => signals.push({ code, fired, value, detail });

  // Geometry. ID-1 is 85.60 × 53.98 mm, so 1.586 to 3 places.
  const aspect = card.width / card.height;
  const ID1 = 85.6 / 53.98;
  const aspectOff = Math.abs(aspect - ID1) / ID1;
  if (features.id1_geometry) {
    push('doc_geometry_wrong', card.method === 'edge_projection' && aspectOff > 0.12,
      Number(aspect.toFixed(3)),
      `Card outline measures ${aspect.toFixed(3)}:1 against the ID-1 standard ${ID1.toFixed(3)}:1`
      + (card.method === 'whole_frame' ? ' — but the card edges were not found, so this is the frame, not the card.' : '.'));
  }

  // Screen capture.
  const screen = screenPeriodicity(plane);
  // Fires only well above anything measured on a printed card, and
  // weighted as a reason to look rather than a reason to refuse.
  //
  // Being straight about this one: on the synthetic scenes in
  // tests/run-vision.mjs this measure does NOT reliably order a
  // photographed display above a photographed card — the card's own
  // line work is periodic in both channels, and JPEG chroma
  // subsampling erodes the very colour ripple that is supposed to
  // separate them. So it is reported with its numbers, it is set where
  // it will not fire on a card, and nothing here claims it detects a
  // screen. The test asserts only that it stays quiet on paper, which
  // is the failure that would do damage.
  push('doc_photographed_from_screen', screen.periodicity > 0.55 && screen.lag <= 9, screen.periodicity,
    `A regular ripple at a ${screen.lag}px pitch runs across the image in brightness AND in colour `
    + `(brightness ${screen.luma}, colour ${screen.chroma}). Ink ripples in brightness alone; a `
    + 'display photographed by a camera ripples in both, because its grid is made of coloured subpixels.');

  // The MRZ band.
  const mrz = findMrzBand(plane);
  if (features.mrz) {
    push('doc_mrz_band_missing', !mrz.found, mrz.strokeDensity ?? 0,
      mrz.found
        ? `A machine-readable band was found ${Math.round((mrz.y / plane.h) * 100)}% down the image.`
        : 'No machine-readable band was found where this document type carries one.');
  }

  let substitution = null;
  if (portrait) {
    const rect = portrait;

    // Two residuals at two scales. The fine one is where print grain
    // and sensor noise live; the coarse one is where content lives.
    const fine = highPass(plane, 1);
    const coarse = highPass(plane, 4);
    const absFine = new Float32Array(fine.length);
    const absCoarse = new Float32Array(coarse.length);
    for (let i = 0; i < fine.length; i++) {
      absFine[i] = Math.abs(fine[i]);
      absCoarse[i] = Math.abs(coarse[i]);
    }

    // The noise floor, taken as a percentile rather than a mean, so it
    // comes from the smooth majority of each region rather than from
    // whichever region happens to contain more edges.
    const noise = regionPercentile(absFine, plane.w, plane.h, rect, 0.5);
    const noiseRatio = noise.outside > 1e-6 ? noise.inside / noise.outside : 1;

    const focus = focusRatio(absFine, absCoarse, plane.w, plane.h, rect);

    const blockIn = blockiness(plane, rect);
    const blockOut = blockiness(plane, { x: 0, y: 0, width: plane.w, height: plane.h });

    // White point from the highlights of each region, not their
    // average. A face is warmer than a card whatever printed it, so
    // comparing overall colour measures biology; comparing highlights
    // measures ink.
    const whiteIn = paperWhite(plane, rect, true);
    const whiteOut = paperWhite(plane, rect, false);
    const colourDelta = (whiteIn !== null && whiteOut !== null)
      ? Math.abs(whiteIn - whiteOut) : 0;

    const ridge = boundaryRidge(plane, rect);
    const sheen = specular(plane, rect);

    const ela = await errorLevel(canvas, 0.75, 640);
    let elaRatio = 1;
    if (ela) {
      const es = ela.w / canvas.width;
      const elaRect = {
        x: (rect.x / scale) * es, y: (rect.y / scale) * es,
        width: (rect.width / scale) * es, height: (rect.height / scale) * es,
      };
      const stats = regionPercentile(ela.diff, ela.w, ela.h, elaRect, 0.6);
      elaRatio = stats.outside > 1e-6 ? stats.inside / stats.outside : 1;
    }

    substitution = {
      noiseRatio: Number(noiseRatio.toFixed(3)),
      focusRatio: Number(focus.ratio.toFixed(3)),
      blockinessInside: Number(blockIn.toFixed(3)),
      blockinessWhole: Number(blockOut.toFixed(3)),
      whitePointInside: whiteIn === null ? null : Number(whiteIn.toFixed(3)),
      whitePointOutside: whiteOut === null ? null : Number(whiteOut.toFixed(3)),
      colourDelta: Number(colourDelta.toFixed(4)),
      boundaryRidge: ridge.delta,
      specular: sheen,
      errorLevelRatio: Number(elaRatio.toFixed(3)),
    };

    push('portrait_noise_mismatch', noiseRatio > 2.2 || noiseRatio < 0.45, substitution.noiseRatio,
      `The portrait's noise floor is ${noiseRatio > 1 ? `${noiseRatio.toFixed(2)}× busier` : `${(1 / noiseRatio).toFixed(2)}× flatter`} `
      + 'than the card around it. One printing process, one sheet, one sensor should leave one noise floor.');

    push('portrait_focus_mismatch', focus.ratio > 1.9 || focus.ratio < 0.5, substitution.focusRatio,
      `Fine detail falls off ${focus.ratio > 1 ? `${focus.ratio.toFixed(2)}× more slowly` : `${(1 / focus.ratio).toFixed(2)}× faster`} `
      + 'inside the portrait than outside it. A card lies in one focal plane; something stuck to it sits above that plane.');

    push('portrait_colour_mismatch', colourDelta > 0.16, substitution.colourDelta,
      `The highlights inside the portrait and on the card disagree about white by ${colourDelta.toFixed(3)} `
      + 'in red-to-blue. Two printers rarely agree; one printer always does.');

    push('portrait_edge_step', Math.abs(ridge.delta) > 11, substitution.boundaryRidge,
      `A ${ridge.delta < 0 ? 'dark' : 'bright'} ridge of ${Math.abs(ridge.delta).toFixed(1)} luma runs along the `
      + `portrait's border against the card beside it — consistent with ${ridge.delta < 0 ? 'the shadow of a physical edge' : 'light catching tape or a lifted corner'}. `
      + 'A printed portrait has nothing there to cast a shadow.');

    push('portrait_taped_or_glossy', sheen.blownPct > 3.5 && sheen.longestRunPct > 22,
      sheen.blownPct,
      `${sheen.blownPct}% of the portrait is blown out, in runs up to ${sheen.longestRunPct}% of its width — `
      + 'the signature of tape or a gloss finish over the photograph.');

    push('portrait_error_level_mismatch', elaRatio > 1.8 || elaRatio < 0.55, substitution.errorLevelRatio,
      `Re-encoding moves the portrait ${elaRatio > 1 ? `${elaRatio.toFixed(2)}× more` : `${(1 / elaRatio).toFixed(2)}× less`} `
      + 'than the card. A region that arrived from another file has already been through an encoder this one has not.');
  } else {
    push('portrait_not_found', true, 0,
      located.method === 'shape_detection'
        ? 'No portrait was found on this document. Nothing can be matched against the person.'
        : 'No portrait could be located, and this browser has no face detector, so this may be the '
          + 'detector missing rather than the portrait.');
  }

  // The ghost portrait.
  let ghostCorrelation = null;
  if (features.ghost_portrait) {
    if (portrait && ghost) {
      // Compared with the same machinery as any other pair of faces,
      // rather than by correlating two thumbnails. Two head-shaped
      // crops on a card correlate highly whoever is in them, which is
      // precisely the failure that made an earlier version of this
      // check score a substituted portrait HIGHER than a genuine one.
      // Both rendered at the SAME size before either is described, and
      // that size is the smaller one's. The ghost portrait is printed
      // at a third of the scale of the main one, so it carries a third
      // of the detail; describing the large one at full resolution and
      // the small one as it is compares a photograph with a thumbnail
      // and finds, correctly and uselessly, that they are different.
      const crop = (b) => cropCanvas(canvas, b.x / scale, b.y / scale,
        b.width / scale, b.height / scale);
      const target = {
        w: Math.min(portrait.width, ghost.width) / scale,
        h: Math.min(portrait.height, ghost.height) / scale,
      };
      const mainDesc = await faceDescriptor(drawScaled(crop(portrait), target.w, target.h));
      const ghostDesc = await faceDescriptor(drawScaled(crop(ghost), target.w, target.h));
      const cmp = compareFaces(mainDesc, ghostDesc);
      ghostCorrelation = cmp ? cmp.appearanceSimilarity : null;
      push('ghost_portrait_mismatch',
        ghostCorrelation !== null && ghostCorrelation < (features.ghost_pair_threshold ?? 0.62),
        ghostCorrelation,
        `The secondary portrait correlates with the main one at ${ghostCorrelation}. They are printed `
        + 'from the same file, so on a genuine card they agree; replacing one and not the other breaks that.');
    } else {
      push('ghost_portrait_absent', Boolean(portrait), ghost ? 1 : 0,
        'This card type carries a second, smaller copy of the portrait and none was found. '
        + 'A poor photograph of a genuine card does this too, so it is a reason to look, not to refuse.');
    }
  }

  const fired = signals.filter((s) => s.fired);
  return {
    docType,
    card,
    portrait,
    ghost,
    portraitLocatedBy: located.method,
    substitution,
    ghostCorrelation,
    mrzBand: mrz,
    screen,
    signals,
    firedCodes: fired.map((s) => s.code),
    // The portrait is handed back cropped so the pipeline can build a
    // descriptor from it without locating the face a second time.
    portraitCanvas: portrait
      ? cropCanvas(canvas, portrait.x / scale, portrait.y / scale,
        portrait.width / scale, portrait.height / scale)
      : null,
  };
}

// ── The machine-readable zone, once somebody types it ────────────
// The check digits are real arithmetic over the characters, so this
// genuinely verifies that the data on the document has not been
// altered since it was issued — which is the one document check here
// that is as strong on a laptop as it is in a laboratory.
export async function verifyMrz(text) {
  const { parseMrz } = await import('../../supabase/functions/_shared/mrz.ts');
  return parseMrz(String(text ?? '').toUpperCase());
}
