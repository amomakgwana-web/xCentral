// ══════════════════════════════════════════════════════════════
// The synthetic scenes both browser tests are built on.
//
// Shared rather than copied, because the two tests have to agree about
// what a face is. When the wizard test carried its own simpler head —
// one flat ellipse with a few dots — two different people measured 0.68
// alike and the duplicate-enrolment check fired on strangers, while the
// vision test, using the richer scene, had the same code separating
// them cleanly at 0.49 against 0.04. The disagreement was in the
// scenes, and it cost an afternoon.
//
// Everything here is injected into the page as a classic script, so it
// runs beside the shipped modules with the same canvas and the same
// JPEG encoder.
// ══════════════════════════════════════════════════════════════

export const SCENES = String.raw`
  // A small deterministic generator, so the same scene is drawn on
  // every run and a failure is reproducible.
  window.rnd = function rnd(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // A head as a textured ellipsoid. The texture is what block matching
  // tracks; the ellipsoid is what gives those points different depths,
  // which is the entire point of the exercise.
  window.makeHead = function makeHead({ seed = 7, yaw = 0, dx = 0, dy = 0, zoom = 1,
                                        tone = null, w = 480, h = 620, light = 1,
                                        background = '#20242e' } = {}) {
    // Two people differ in the proportions of the head, the placement
    // and size of the features, and the tone of the skin — not in the
    // seed of a noise generator. A scene where the only difference is
    // noise tests nothing about telling people apart.
    const who = window.rnd(seed * 7919 + 13);
    const FACE = { A: 96 + who() * 34, B: 132 + who() * 40, C: 82 + who() * 26 };
    tone = tone ?? [196 + who() * 52, 150 + who() * 56, 118 + who() * 60];
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = background; g.fillRect(0, 0, w, h);

    const A = FACE.A, B = FACE.B, C = FACE.C;   // ellipsoid semi-axes
    const F = 620, D = 900;           // focal length and camera distance
    const cx = w / 2 + dx, cy = h / 2 + dy;

    const project = (X, Y, Z) => {
      const xr = X * Math.cos(yaw) + Z * Math.sin(yaw);
      const zr = -X * Math.sin(yaw) + Z * Math.cos(yaw);
      const s = (F * zoom) / (D - zr);
      return { x: cx + xr * s, y: cy + Y * s, s };
    };

    // The silhouette, drawn from the projected extremes so it moves
    // with the head rather than staying put.
    const p0 = project(0, 0, C);
    g.save();
    g.translate(p0.x, p0.y);
    g.beginPath();
    g.ellipse(0, 0, A * p0.s * 0.98, B * p0.s * 0.98, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgb(' + tone.map((v) => Math.round(v * light)).join(',') + ')';
    g.fill();
    g.restore();

    // Surface texture: points on the front of the ellipsoid, each
    // shaded by its own normal, so the pattern is fixed to the surface
    // and travels with it.
    const r = window.rnd(seed);
    for (let i = 0; i < 1100; i++) {
      const u = r() * 2 - 1;
      const v = r() * Math.PI * 2;
      const rad = Math.sqrt(1 - u * u);
      const X = rad * Math.cos(v) * A;
      const Y = u * B;
      const Z = rad * Math.sin(v) * C;
      if (Z < 6) continue;
      const p = project(X, Y, Z);
      // Only draw what is still facing the camera after the rotation.
      const facing = (X / A) * -Math.sin(yaw) + (Z / C) * Math.cos(yaw);
      if (facing < 0.12) continue;
      const shade = 0.62 + 0.38 * facing;
      const jitter = 0.82 + r() * 0.36;
      g.fillStyle = 'rgb(' + tone.map((t2) =>
        Math.max(20, Math.min(250, Math.round(t2 * shade * jitter * light)))).join(',') + ')';
      const size = Math.max(4.5, 9 * p.s);
      g.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }

    // Features, so two different seeds are two different faces rather
    // than two shufflings of the same noise.
    const feat = (X, Y, Z, rx, ry, col) => {
      const p = project(X, Y, Z);
      const facing = (X / A) * -Math.sin(yaw) + (Z / C) * Math.cos(yaw);
      if (facing < 0.05) return;
      g.save(); g.translate(p.x, p.y);
      g.beginPath(); g.ellipse(0, 0, rx * p.s, ry * p.s, 0, 0, Math.PI * 2);
      g.fillStyle = col; g.fill(); g.restore();
    };
    const spread = A * (0.26 + who() * 0.14);
    const brow = -B * (0.22 + who() * 0.16);
    const eye = 8 + who() * 8;
    feat(-spread, brow, C * 0.72, eye, eye * 0.6, '#2b2118');
    feat(spread, brow, C * 0.72, eye, eye * 0.6, '#2b2118');
    feat(0, B * (who() * 0.12), C * 0.99, 9 + who() * 8, 12 + who() * 9, 'rgba(90,60,45,.55)');
    feat(0, B * (0.34 + who() * 0.16), C * 0.74, 18 + who() * 16, 7 + who() * 6, '#7a3a34');
    // A brow line and a hairline: gross layout, which is what the
    // thumbnail correlation is looking at.
    feat(0, brow - B * 0.07, C * 0.8, A * (0.4 + who() * 0.2), 4 + who() * 5, 'rgba(40,28,20,.5)');
    feat(0, -B * (0.66 + who() * 0.1), C * 0.55, A * 0.85, B * 0.2, 'rgba(28,20,16,.75)');
    return c;
  };

  // A photograph OF that head: the same render, moved as a flat object
  // is moved. Rotate it, scale it, shift it — every point transforms
  // by the same affine map, because that is what being flat means.
  window.flattenAs = function flattenAs(src, { angle = 0.05, scale = 1.04, dx = 12, dy = -7 } = {}) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.fillStyle = '#20242e'; g.fillRect(0, 0, c.width, c.height);
    g.translate(c.width / 2 + dx, c.height / 2 + dy);
    g.rotate(angle); g.scale(scale, scale);
    g.translate(-c.width / 2, -c.height / 2);
    g.drawImage(src, 0, 0);
    return c;
  };

  window.reencode = async function reencode(canvas, quality) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    out.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    return out;
  };

  // An identity card: a printed ground with fine guilloche, a portrait,
  // a smaller ghost copy of it, some text and a machine-readable band.
  window.makeCard = async function makeCard({ seed = 7, pasteSeed = null } = {}) {
    const W = 1000, H = 630;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#e9eef2'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#12325c'; g.fillRect(0, 0, W, 58);
    g.fillStyle = '#1d7a4a'; g.fillRect(0, 58, W, 10);

    // Guilloche: the fine line work a card is printed with, and the
    // texture the portrait has to match.
    g.strokeStyle = 'rgba(60,90,130,.30)';
    g.lineWidth = 0.8;
    for (let k = 0; k < 90; k++) {
      g.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const y = H / 2 + Math.sin(x / 26 + k * 0.31) * (44 + k * 2.4) + k * 1.1 - 50;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }

    const PORTRAIT = { x: 62, y: 112, w: 232, h: 300 };
    const GHOST = { x: 792, y: 150, w: 116, h: 150 };

    // Identity portraits are shot against a light, neutral ground —
    // that is what the standard asks for, and it means the highlights
    // inside a printed portrait belong to the card's paper rather than
    // to the subject's skin.
    const head = window.makeHead({ seed, w: 240, h: 310, background: '#dfe3e6' });
    g.drawImage(head, PORTRAIT.x, PORTRAIT.y, PORTRAIT.w, PORTRAIT.h);
    g.drawImage(head, GHOST.x, GHOST.y, GHOST.w, GHOST.h);

    g.fillStyle = '#ffffff';
    g.font = 'bold 30px sans-serif';
    g.fillText('REPUBLIC OF SOUTH AFRICA', 40, 40);
    g.fillStyle = '#16213a';
    g.font = '24px sans-serif';
    g.fillText('Surname        MOKOENA', 330, 170);
    g.fillText('Names          THABO JOHN', 330, 210);
    g.fillText('Identity No    9001015009086', 330, 250);

    // The machine-readable band: regular vertical strokes at a fixed
    // pitch, which is the shape the band locator looks for.
    const rr = window.rnd(seed + 11);
    g.fillStyle = '#101820';
    for (let line = 0; line < 3; line++) {
      const y = H - 150 + line * 42;
      for (let x = 40; x < W - 40; x += 17) {
        const hgt = 26;
        if (rr() > 0.18) g.fillRect(x, y, 6, hgt);
        if (rr() > 0.55) g.fillRect(x + 7, y + 6, 4, hgt - 12);
      }
    }

    // Print grain over everything, so the portrait and the card share
    // one noise floor — which is exactly the property a substitution
    // destroys.
    const grain = g.getImageData(0, 0, W, H);
    const gr = window.rnd(seed + 3);
    for (let i = 0; i < grain.data.length; i += 4) {
      const n = (gr() - 0.5) * 16;
      grain.data[i] = Math.max(0, Math.min(255, grain.data[i] + n));
      grain.data[i + 1] = Math.max(0, Math.min(255, grain.data[i + 1] + n));
      grain.data[i + 2] = Math.max(0, Math.min(255, grain.data[i + 2] + n));
    }
    g.putImageData(grain, 0, 0);

    if (pasteSeed !== null) {
      // Somebody else's photograph, compressed on its own before it got
      // here, laid over the portrait with a cut edge and the warmer
      // white point of a different printer. No card grain over it,
      // because it was never printed with the card.
      const other = window.makeHead({ seed: pasteSeed, w: 240, h: 310, tone: [238, 198, 168],
        light: 1.06, background: '#efe6d8' });
      const squashed = await window.reencode(other, 0.34);
      g.save();
      g.globalAlpha = 1;
      g.drawImage(squashed, PORTRAIT.x, PORTRAIT.y, PORTRAIT.w, PORTRAIT.h);
      // The edge of the physical photograph.
      g.strokeStyle = 'rgba(40,40,45,.75)';
      g.lineWidth = 3;
      g.strokeRect(PORTRAIT.x - 1, PORTRAIT.y - 1, PORTRAIT.w + 2, PORTRAIT.h + 2);
      g.restore();
    }

    // One final encode, the way any photograph of the card would be.
    return window.reencode(c, 0.9);
  };

  // A photograph of a display: the same card, with the display's pixel
  // grid beating against the camera's sensor grid. Periodic in BOTH
  // axes at the same small pitch, which is what a grid is.
  window.throughAScreen = async function throughAScreen(card) {
    const c = document.createElement('canvas');
    c.width = card.width; c.height = card.height;
    const g = c.getContext('2d');
    g.drawImage(card, 0, 0);
    const img = g.getImageData(0, 0, c.width, c.height);
    const PITCH = 6;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        // Each channel at the same pitch but a third of a period
        // apart, which is what a strip of red, green and blue
        // subpixels is. That phase offset is why moire off a display
        // has colour in it and moire off ink does not.
        for (let ch = 0; ch < 3; ch++) {
          const beat = Math.cos(((x + ch * PITCH / 3) / PITCH) * Math.PI * 2)
                     * Math.cos(((y + ch * PITCH / 3) / PITCH) * Math.PI * 2);
          img.data[i + ch] = Math.max(0, Math.min(255, img.data[i + ch] * (1 + beat * 0.17)));
        }
      }
    }
    g.putImageData(img, 0, 0);
    return window.reencode(c, 0.9);
  };

  window.scanFrom = function scanFrom(frames) {
    const { toPlane } = window.V.image;
    const W = window.V.depth.WORKING_WIDTH;
    return {
      poses: frames.map((f, i) => ({
        pose: f.pose,
        axis: f.axis,
        promptedAt: i * 2200,
        respondedAfterMs: 320,
        plane: toPlane(f.canvas, W),
        canvas: f.canvas,
        series: [toPlane(f.canvas, W), toPlane(f.canvas, W)],
      })),
      plan: frames.map((f) => f.pose),
      durationMs: frames.length * 2200,
    };
  };
  // Hands a canvas to a file input the way a person hands it a
  // photograph, so the upload path under test is the real one.
  window.feed = async function feed(inputId, canvas, name) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    const file = new File([blob], name, { type: 'image/jpeg' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById(inputId);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
`;
