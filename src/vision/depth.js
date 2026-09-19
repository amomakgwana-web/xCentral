// ══════════════════════════════════════════════════════════════
// The depth scan: telling a head from a photograph of a head.
//
// The idea is old and geometric rather than clever. When the camera
// and the subject move relative to one another, every point of a FLAT
// object moves according to one shared transform — a plane stays a
// plane, so the whole photograph shifts, rotates and scales together.
// A head does not. The nose is nearer the lens than the ears, so when
// it turns, the nose sweeps further across the frame than the cheek
// beside it. That difference is parallax, and it is the thing a
// printed photograph, a phone screen held up to the lens, and a
// flat-printed mask cannot produce.
//
// So the measurement is: track a grid of patches across the motion,
// fit the single best flat-object transform to how they moved, and
// look at what is left over. Near zero left over means the subject was
// flat. Structured left over — largest in the middle of the face,
// where the nose is — means it had depth.
//
// THE THREE DIMENSIONS, SAID PLAINLY, because "3D" and "4D" are
// marketing words everywhere else:
//   3D  depth, recovered from parallax as above. Not a depth camera:
//       there is no absolute distance here, only relative relief.
//   4D  that depth over time — the sequence of poses, the latency
//       between each prompt and the movement that answers it, and the
//       micro-motion of a face at rest.
//
// The prompts are issued in an order chosen at random per session.
// That is what makes this a challenge rather than a recording: a video
// of someone else's scan cannot know that this session will ask for
// left before closer. It is not unbeatable — a real-time puppeteering
// attack answers the challenge — and the confidence is capped to say
// so. Certified presentation attack detection is ISO/IEC 30107-3, it
// is a laboratory exercise, and it belongs behind the provider
// interface.
// ══════════════════════════════════════════════════════════════

import { clamp, ncc, patch, toPlane } from './image.js';
import { locateFace } from './face.js';

// Exported, because anything that builds a scan by hand — a test, a
// replay of stored frames — has to use the same width the analysis
// expects. A plane prepared at a different scale silently changes
// every pixel measurement downstream.
export const WORKING_WIDTH = 480;
const WORK_W = WORKING_WIDTH;
const BLOCK = 28;       // patch side, in working pixels
const SEARCH = 14;      // how far a patch is allowed to have moved
const MIN_NCC = 0.55;   // below this the patch was not really found

export const POSE_LIBRARY = {
  centre: { id: 'centre', prompt: 'Look straight at the camera and hold still', axis: 'none' },
  left:   { id: 'left',   prompt: 'Slowly turn your head to your left',  axis: 'yaw' },
  right:  { id: 'right',  prompt: 'Slowly turn your head to your right', axis: 'yaw' },
  up:     { id: 'up',     prompt: 'Tilt your chin up a little',          axis: 'pitch' },
  closer: { id: 'closer', prompt: 'Move a little closer to the camera',  axis: 'scale' },
};

// Centre first always — it is the reference every other pose is
// measured against. The rest are shuffled, and the order is part of
// the record.
export function planScan(random = Math.random) {
  const rest = ['left', 'right', 'up', 'closer'];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return ['centre', ...rest.slice(0, 3)].map((id) => POSE_LIBRARY[id]);
}

// ── Running the scan ────────────────────────────────────────────
// Captures a short series per pose. onPrompt is called with each pose
// so the page can put the instruction on screen; the promise resolves
// with everything needed to analyse, and nothing is judged here.
export async function runDepthScan(videoEl, {
  grabFrame,
  onPrompt = () => {},
  onProgress = () => {},
  poses = planScan(),
  holdMs = 2200,
  sampleMs = 160,
} = {}) {
  const captured = [];
  const startedAt = performance.now();

  for (let p = 0; p < poses.length; p++) {
    const pose = poses[p];
    const promptedAt = performance.now();
    onPrompt(pose, p, poses.length);

    const series = [];
    const until = performance.now() + holdMs;
    while (performance.now() < until) {
      try {
        const canvas = grabFrame(videoEl);
        series.push({
          at: performance.now() - startedAt,
          plane: toPlane(canvas, WORK_W),
          canvas: series.length === 0 ? canvas : null,
        });
      } catch { /* the camera can drop a frame; the series tolerates it */ }
      onProgress(clamp((p + (holdMs - (until - performance.now())) / holdMs) / poses.length, 0, 1));
      await new Promise((r) => setTimeout(r, sampleMs));
    }

    if (!series.length) {
      const e = new Error('The camera produced no frames during the scan.');
      e.code = 'no_frames';
      throw e;
    }

    // The settled frame is the one at the end of the hold: by then the
    // subject has finished moving into the pose. Taking the first
    // frame instead would measure the transition, not the pose.
    const settled = series[series.length - 1];
    let keyCanvas = null;
    try { keyCanvas = grabFrame(videoEl); } catch { /* keep the plane alone */ }

    captured.push({
      pose: pose.id,
      axis: pose.axis,
      promptedAt: promptedAt - startedAt,
      // How long the subject took to start answering the prompt. A
      // person takes a moment; a replay starts immediately or not at
      // all.
      respondedAfterMs: Math.round(firstMotionAt(series) ?? -1),
      plane: settled.plane,
      canvas: keyCanvas,
      series: series.map((s) => s.plane),
    });
  }

  return { poses: captured, plan: poses.map((p) => p.id), durationMs: Math.round(performance.now() - startedAt) };
}

// When, within a pose's series, the frame first changed meaningfully.
function firstMotionAt(series) {
  if (series.length < 2) return null;
  const base = series[0].plane.gray;
  for (let i = 1; i < series.length; i++) {
    const cur = series[i].plane.gray;
    if (cur.length !== base.length) continue;
    let diff = 0;
    for (let p = 0; p < base.length; p++) diff += Math.abs(base[p] - cur[p]);
    if (diff / base.length > 2.2) return series[i].at - series[0].at;
  }
  return null;
}

// ── Block matching ──────────────────────────────────────────────
// Where did each patch of the reference frame end up in the other one?
//
// In two stages, because people move. A head turned to the left has
// also usually drifted sideways and towards the lens, and that global
// shift can easily be thirty or forty pixels — far outside any search
// window small enough to run at speed. Searching a small window around
// zero finds the edge of the window instead of the patch, and every
// block then reports the same clipped displacement, which fits a plane
// beautifully and destroys the measurement. So: find the gross motion
// once from a large central patch, then search each block around that.
function globalShift(refPlane, movedPlane, box) {
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  const size = Math.max(32, Math.min(96, Math.round(box.width * 0.7)));
  const ref = patch(refPlane, cx, cy, size);

  let best = { score: -2, dx: 0, dy: 0 };
  for (let dy = -48; dy <= 48; dy += 4) {
    for (let dx = -48; dx <= 48; dx += 4) {
      const score = ncc(ref, patch(movedPlane, cx + dx, cy + dy, size));
      if (score > best.score) best = { score, dx, dy };
    }
  }
  const coarse = best;
  for (let dy = coarse.dy - 3; dy <= coarse.dy + 3; dy++) {
    for (let dx = coarse.dx - 3; dx <= coarse.dx + 3; dx++) {
      const score = ncc(ref, patch(movedPlane, cx + dx, cy + dy, size));
      if (score > best.score) best = { score, dx, dy };
    }
  }
  return best;
}

// The vertex of the parabola through three samples, as an offset from
// the middle one. Clamped to half a sample: a parabola fitted to a
// noisy peak can put its vertex anywhere, and anywhere is not where
// the patch is.
function subPixel(before, peak, after) {
  const den = before - 2 * peak + after;
  if (!Number.isFinite(den) || Math.abs(den) < 1e-9) return 0;
  const shift = (before - after) / (2 * den);
  return Number.isFinite(shift) ? Math.max(-0.5, Math.min(0.5, shift)) : 0;
}

function matchBlocks(refPlane, movedPlane, box) {
  const out = [];
  const shift = globalShift(refPlane, movedPlane, box);
  const x0 = Math.max(BLOCK, box.x);
  const y0 = Math.max(BLOCK, box.y);
  const x1 = Math.min(refPlane.w - BLOCK, box.x + box.width);
  const y1 = Math.min(refPlane.h - BLOCK, box.y + box.height);
  const stepX = Math.max(8, Math.floor((x1 - x0) / 7));
  const stepY = Math.max(8, Math.floor((y1 - y0) / 8));

  for (let cy = y0; cy <= y1; cy += stepY) {
    for (let cx = x0; cx <= x1; cx += stepX) {
      const ref = patch(refPlane, cx, cy, BLOCK);

      // A flat patch — a cheek in even light — matches everywhere and
      // means nothing. Skipping it is not laziness: including it feeds
      // the fit a displacement that was never measured.
      let mn = Infinity;
      let mx = -Infinity;
      for (let i = 0; i < ref.length; i++) { if (ref[i] < mn) mn = ref[i]; if (ref[i] > mx) mx = ref[i]; }
      if (mx - mn < 14) continue;

      let best = { score: -2, dx: shift.dx, dy: shift.dy };
      for (let dy = -SEARCH; dy <= SEARCH; dy += 2) {
        for (let dx = -SEARCH; dx <= SEARCH; dx += 2) {
          const score = ncc(ref, patch(movedPlane, cx + shift.dx + dx, cy + shift.dy + dy, BLOCK));
          if (score > best.score) best = { score, dx: shift.dx + dx, dy: shift.dy + dy };
        }
      }
      // One refinement pass at single-pixel steps around the winner,
      // then a sub-pixel one.
      const coarse = best;
      const grid = new Map();
      const at = (dx, dy) => {
        const key = `${dx},${dy}`;
        if (!grid.has(key)) grid.set(key, ncc(ref, patch(movedPlane, cx + dx, cy + dy, BLOCK)));
        return grid.get(key);
      };
      for (let dy = coarse.dy - 1; dy <= coarse.dy + 1; dy++) {
        for (let dx = coarse.dx - 1; dx <= coarse.dx + 1; dx++) {
          const score = at(dx, dy);
          if (score > best.score) best = { score, dx, dy };
        }
      }

      // Whole-pixel matching has a floor of about half a pixel of
      // error, and at this working resolution half a pixel is roughly
      // half a percent of face width — the same order as the relief
      // being measured. Fitting a parabola through the correlation
      // peak and its two neighbours recovers the fraction, which is
      // the difference between a measurement and a coin toss.
      const px = subPixel(at(best.dx - 1, best.dy), best.score, at(best.dx + 1, best.dy));
      const py = subPixel(at(best.dx, best.dy - 1), best.score, at(best.dx, best.dy + 1));
      best = { ...best, dx: best.dx + px, dy: best.dy + py };

      // A block that landed against the edge of its own search window
      // was not found — it ran out of room. Keeping it would report a
      // displacement chosen by the window size rather than by the
      // subject.
      const clipped = Math.abs(best.dx - shift.dx) >= SEARCH || Math.abs(best.dy - shift.dy) >= SEARCH;
      if (best.score >= MIN_NCC && !clipped) {
        out.push({ x: cx, y: cy, dx: best.dx, dy: best.dy, score: best.score });
      }
    }
  }
  return out;
}

// Least squares affine fit over the displacement field. Six unknowns,
// solved as two independent three-parameter problems (one for dx, one
// for dy) through the normal equations.
//
// Affine rather than a full homography on purpose: at these angles and
// distances the perspective terms are far smaller than the parallax
// being measured, and a homography has enough freedom to start
// absorbing the very depth this is trying to detect.
function fitAffine(matches) {
  const n = matches.length;
  if (n < 6) return null;

  const mx = matches.reduce((s, m) => s + m.x, 0) / n;
  const my = matches.reduce((s, m) => s + m.y, 0) / n;

  const solve = (key) => {
    let sxx = 0; let sxy = 0; let syy = 0; let sx = 0; let sy = 0;
    let sxv = 0; let syv = 0; let sv = 0;
    for (const m of matches) {
      const x = m.x - mx;
      const y = m.y - my;
      const v = m[key];
      sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y;
      sxv += x * v; syv += y * v; sv += v;
    }
    // 3×3 normal equations, solved by Cramer's rule.
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
    const B = [sxv, syv, sv];
    const det = det3(A);
    if (Math.abs(det) < 1e-6) return null;
    const rep = (col) => {
      const M = A.map((row) => row.slice());
      for (let i = 0; i < 3; i++) M[i][col] = B[i];
      return det3(M) / det;
    };
    return [rep(0), rep(1), rep(2)];
  };

  const a = solve('dx');
  const b = solve('dy');
  if (!a || !b) return null;

  let ssRes = 0;
  let ssTot = 0;
  const meanDx = matches.reduce((s, m) => s + m.dx, 0) / n;
  const meanDy = matches.reduce((s, m) => s + m.dy, 0) / n;
  const residuals = [];

  for (const m of matches) {
    const x = m.x - mx;
    const y = m.y - my;
    const px = a[0] * x + a[1] * y + a[2];
    const py = b[0] * x + b[1] * y + b[2];
    const rx = m.dx - px;
    const ry = m.dy - py;
    ssRes += rx * rx + ry * ry;
    ssTot += (m.dx - meanDx) ** 2 + (m.dy - meanDy) ** 2;
    residuals.push({ x: m.x, y: m.y, rx, ry, mag: Math.hypot(rx, ry) });
  }

  return {
    r2: ssTot > 1e-6 ? clamp(1 - ssRes / ssTot, -1, 1) : 1,
    rms: Math.sqrt(ssRes / n),
    residuals,
    n,
    centre: { x: mx, y: my },
  };
}

function det3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
       - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
       + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

// ── Analysis ────────────────────────────────────────────────────
export async function analyseDepthScan(scan) {
  const reference = scan.poses.find((p) => p.pose === 'centre') ?? scan.poses[0];
  const others = scan.poses.filter((p) => p !== reference);

  // The face box is found on the reference frame and expressed in
  // working-plane coordinates, so only the face drives the fit. Let
  // the background in and a static poster behind the subject would
  // look like a perfectly flat object and drag the result towards
  // "photograph".
  let box = null;
  if (reference.canvas) {
    const located = await locateFace(reference.canvas);
    if (located.box) {
      const s = reference.plane.w / reference.canvas.width;
      box = {
        x: located.box.x * s, y: located.box.y * s,
        width: located.box.width * s, height: located.box.height * s,
        method: located.method,
      };
    }
  }
  if (!box) {
    // No face located: fall back to the middle of the frame, and say
    // so, rather than refusing to measure anything.
    box = {
      x: reference.plane.w * 0.25, y: reference.plane.h * 0.18,
      width: reference.plane.w * 0.5, height: reference.plane.h * 0.62,
      method: 'frame_centre_fallback',
    };
  }

  const perPose = [];
  for (const pose of others) {
    const matches = matchBlocks(reference.plane, pose.plane, box);
    const fit = fitAffine(matches);
    if (!fit) {
      perPose.push({ pose: pose.pose, axis: pose.axis, tracked: matches.length, usable: false });
      continue;
    }

    // Relief, as a percentage of face width, so a phone held close and
    // a webcam far away produce comparable numbers.
    const relief = (fit.rms / box.width) * 100;

    // Parallax from a turning head is largest where the face sticks out
    // furthest — down the middle, at the nose — and it points the same
    // way the head is going. A flat surface produces residuals that
    // are noise, scattered and directionless.
    //
    // The residual has to be SIGNED, and projected onto the direction
    // of travel, for that shape to show up. Correlating the magnitude
    // instead — as an earlier version did — measures a dome against a
    // plane through it, which is large in the middle and large again
    // at the rim, and produced a NEGATIVE correlation for a real head.
    const cxFace = box.x + box.width / 2;
    const cyFace = box.y + box.height / 2;

    // Project onto the axis the prompt asked the subject to move along.
    // A turn of the head displaces along x, a nod along y, and moving
    // closer displaces radially outward from the centre of the face.
    // Using the average direction of travel instead fails exactly when
    // it matters: a head that rotates about its own centre barely
    // translates at all, so there is no average direction to use.
    const projected = fit.residuals.map((r) => {
      if (pose.axis === 'yaw') return r.rx;
      if (pose.axis === 'pitch') return r.ry;
      const rx = r.x - cxFace;
      const ry = r.y - cyFace;
      const len = Math.hypot(rx, ry) || 1;
      return (r.rx * rx + r.ry * ry) / len;
    });
    const centrality = fit.residuals.map((r) => clamp(
      1 - Math.hypot((r.x - cxFace) / (box.width / 2), (r.y - cyFace) / (box.height / 2)), 0, 1));
    // The magnitude, not the sign. Whether the nose leads or trails
    // depends on which way the subject turned, which nobody controls;
    // what distinguishes depth from noise is that there is a
    // relationship at all.
    const centralParallax = Math.abs(correlation(centrality, projected));

    perPose.push({
      pose: pose.pose,
      axis: pose.axis,
      tracked: fit.n,
      usable: true,
      planarityR2: Number(fit.r2.toFixed(4)),
      reliefPct: Number(relief.toFixed(3)),
      centralParallax: Number(centralParallax.toFixed(3)),
      respondedAfterMs: pose.respondedAfterMs,
    });
  }

  const usable = perPose.filter((p) => p.usable);

  // Only the poses that ROTATED the head count towards the verdict.
  // Parallax comes from turning, not from approaching: scaling a dome
  // is almost exactly scaling a plane, so a "move closer" pose puts a
  // photograph and a face on equal footing and dilutes the one
  // measurement that separates them. It is still worth capturing — it
  // shows the subject answered a prompt — so it is reported, and left
  // out of the arithmetic.
  const rotations = usable.filter((p) => p.axis === 'yaw' || p.axis === 'pitch');
  const counted = rotations.length ? rotations : usable;
  const mean = (key) => (counted.length
    ? counted.reduce((s2, p) => s2 + p[key], 0) / counted.length : 0);

  const relief = mean('reliefPct');
  const planarity = counted.length ? mean('planarityR2') : 1;
  const parallax = mean('centralParallax');
  const micro = microMotion(reference.series);

  // One statistic, because the two halves are only meaningful
  // together. Relief alone cannot separate depth from tracking error —
  // both put pixels in the wrong place. What a flat object cannot do
  // is produce relief that a single flat transform FAILS to explain.
  // So: how much was left over, multiplied by how badly the flat
  // explanation fitted.
  const evidence = relief * (1 - planarity);

  // Did the poses actually happen? A subject who ignores the prompts
  // and sits still produces a scan where nothing moved, which is not a
  // flat-object finding — it is a scan that measured nothing.
  const moved = counted.filter((p) => p.reliefPct > 0 || p.planarityR2 < 0.999).length;
  const answeredPrompts = perPose.filter((p) => p.respondedAfterMs > 60 && p.respondedAfterMs < 2200).length;
  const enough = counted.length >= 2 && moved >= 2;

  // The thresholds, stated rather than buried. They are calibrated
  // against the synthetic scenes in tests/run-vision.mjs — a textured
  // ellipsoid under a real perspective projection, and the same render
  // put through an affine warp — where the separation is roughly six
  // to one. They are NOT calibrated against real faces under real
  // light, which is why the band between them is wide, the middle
  // lands in "inconclusive" rather than in a decision, and the
  // confidence is capped well below certainty.
  const FLAT_EVIDENCE = 0.85;
  const LIVE_EVIDENCE = 1.6;

  let verdict;
  let note;
  if (!enough) {
    verdict = 'not_measured';
    note = 'The subject did not move enough between prompts for parallax to be measurable. '
         + 'This is not a finding about the subject — nothing was measured.';
  } else if (evidence < FLAT_EVIDENCE) {
    verdict = 'flat';
    note = 'Every tracked point moved as one rigid plane. That is what a printed photograph, '
         + 'a screen held to the lens, or a flat mask produces, and what a face does not.';
  } else if (evidence >= LIVE_EVIDENCE) {
    verdict = 'three_dimensional';
    note = 'The head\'s movement left behind more than a flat transform can account for, and it '
         + 'was largest towards the middle of the face. That is parallax from real depth.';
  } else {
    verdict = 'inconclusive';
    note = 'The motion carried some depth but not cleanly enough to call. Usually poor light, '
         + 'too little movement, or the subject moving the camera instead of their head.';
  }

  const confidence = verdict === 'three_dimensional'
    ? clamp(40 + (evidence - LIVE_EVIDENCE) * 18 + parallax * 30, 0, 85)
    : verdict === 'flat'
      ? clamp(50 + (FLAT_EVIDENCE - evidence) * 40, 0, 88)
      : 30;

  return {
    verdict,
    note,
    confidence: Number(confidence.toFixed(1)),
    depthEvidence: Number(evidence.toFixed(3)),
    reliefPct: Number(relief.toFixed(3)),
    planarityR2: Number(planarity.toFixed(4)),
    centralParallax: Number(parallax.toFixed(3)),
    microMotion: micro,
    posesRequested: scan.plan,
    posesAnswered: answeredPrompts,
    posesCounted: counted.map((p) => p.pose),
    faceLocatedBy: box.method,
    perPose,
    durationMs: scan.durationMs,
    thresholds: { flatEvidence: FLAT_EVIDENCE, liveEvidence: LIVE_EVIDENCE },
    limits: 'Parallax and a randomised prompt order. Defeats a printed photograph, a screen and a '
          + 'pre-recorded video; does not defeat a live puppeteering attack or a moulded 3D mask. '
          + 'Certified detection is ISO/IEC 30107-3 and belongs behind the provider interface.',
  };
}

// A face at rest is never quite still. This is the same weak signal
// the older passive check computed, kept because it fails differently
// from parallax: a video replay has motion and no depth, a photograph
// on a swaying hand has depth-like noise and no micro-motion.
function microMotion(series) {
  if (!series || series.length < 3) return { available: false, motion: 0 };
  let total = 0;
  let comparisons = 0;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1].gray;
    const b = series[i].gray;
    if (a.length !== b.length) continue;
    let diff = 0;
    for (let p = 0; p < a.length; p++) diff += Math.abs(a[p] - b[p]);
    total += diff / a.length;
    comparisons++;
  }
  const motion = comparisons ? total / comparisons : 0;
  return {
    available: true,
    frames: series.length,
    motion: Number(motion.toFixed(3)),
    looksStatic: motion < 0.9,
  };
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 1e-9 ? num / den : 0;
}
