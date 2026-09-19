// ══════════════════════════════════════════════════════════════
// Live capture.
//
// What is genuinely computed here, from the actual pixels, with no
// provider involved:
//
//   Sharpness  variance of the Laplacian. A blurred image carries
//              little high-frequency content, so the second derivative
//              is flat and its variance is low. This is the single
//              most useful capture metric: most failed matches are
//              failed photographs.
//   Brightness mean luminance, 0-100.
//   Contrast   standard deviation of luminance. A photograph of a
//              screen, or a washed-out scan, reads low.
//   Faces      via the Shape Detection API where the browser has it.
//   Motion     inter-frame difference across a short burst. A held-up
//              photograph barely changes between frames; a person
//              does. A weak signal, and labelled as one.
//
// What is NOT computed here, and must not be implied: face matching.
// Comparing two faces needs a model trained for it. The images go to
// the biometric provider, which returns a similarity; this module's
// job is to make sure what it sends is worth comparing.
//
// Fingerprints: a browser cannot read a fingerprint scanner. WebAuthn
// asks the DEVICE to verify its owner with its own sensor and returns
// a signed assertion — proof that the enrolled person unlocked this
// device, not a fingerprint template. That distinction is preserved
// all the way through; anything AFIS-grade needs a scanner SDK behind
// the provider interface.
// ══════════════════════════════════════════════════════════════

const WORK_WIDTH = 480; // metrics are computed at this width, for speed

// ── Camera ──────────────────────────────────────────────────────
export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

export function cameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

export async function startCamera(videoEl, { facingMode = 'user', deviceId } = {}) {
  if (!cameraAvailable()) {
    const e = new Error('This browser or context has no camera access.');
    e.code = 'no_camera_api';
    throw e;
  }

  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } }
      : { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    // Distinguish the cases an operator can actually do something
    // about from the ones they cannot.
    const e = new Error(
      err.name === 'NotAllowedError'
        ? 'Camera permission was refused. Allow it in the browser, then try again.'
        : err.name === 'NotFoundError'
          ? 'No camera is connected to this device.'
          : err.name === 'NotReadableError'
            ? 'The camera is in use by another application.'
            : `Could not start the camera: ${err.message}`);
    e.code = err.name;
    throw e;
  }

  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', '');
  videoEl.muted = true;
  await videoEl.play();

  // Wait for real dimensions; a frame grabbed before this is empty.
  if (!videoEl.videoWidth) {
    await new Promise((resolve) => {
      videoEl.addEventListener('loadedmetadata', resolve, { once: true });
      setTimeout(resolve, 2000);
    });
  }

  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks?.().forEach((t) => t.stop());
}

// ── Frame grab ──────────────────────────────────────────────────
export function grabFrame(videoEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) throw new Error('The camera has not produced a frame yet.');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(videoEl, 0, 0, w, h);
  return canvas;
}

export async function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function fileToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not a readable image.'));
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

// ── Quality ─────────────────────────────────────────────────────
// Downsample to a fixed working width so the numbers are comparable
// between a phone camera and a webcam, and so the pass is fast.
function toGrayscale(canvas) {
  const scale = Math.min(1, WORK_WIDTH / canvas.width);
  const w = Math.max(2, Math.round(canvas.width * scale));
  const h = Math.max(2, Math.round(canvas.height * scale));

  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  work.getContext('2d').drawImage(canvas, 0, 0, w, h);

  const { data } = work.getContext('2d').getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Rec. 601 luma.
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { gray, w, h };
}

export function measureQuality(canvas) {
  const { gray, w, h } = toGrayscale(canvas);

  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const mean = sum / gray.length;

  let varSum = 0;
  for (let i = 0; i < gray.length; i++) {
    const d = gray[i] - mean;
    varSum += d * d;
  }
  const stdDev = Math.sqrt(varSum / gray.length);

  // Laplacian: the discrete second derivative. Its variance across the
  // image is the standard blur measure.
  let lapSum = 0;
  let lapSqSum = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      lapSum += lap;
      lapSqSum += lap * lap;
      n++;
    }
  }
  const lapMean = n ? lapSum / n : 0;
  const sharpness = n ? lapSqSum / n - lapMean * lapMean : 0;

  return {
    // 0-100, so the thresholds read the same way as every other score.
    brightness: Number(((mean / 255) * 100).toFixed(2)),
    contrast: Number(((stdDev / 255) * 100).toFixed(2)),
    sharpness: Number(sharpness.toFixed(2)),
    width: canvas.width,
    height: canvas.height,
  };
}

// ── Faces ───────────────────────────────────────────────────────
// The Shape Detection API is not everywhere. When it is missing this
// returns null rather than a guess, and the quality rules treat that
// as "not measured" rather than "no face".
export function faceDetectionAvailable() {
  return typeof window !== 'undefined' && 'FaceDetector' in window;
}

export async function detectFaces(canvas) {
  if (!faceDetectionAvailable()) return null;
  try {
    const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
    const faces = await detector.detect(canvas);
    const frameArea = canvas.width * canvas.height;

    const boxes = faces.map((f) => ({
      x: Math.round(f.boundingBox.x),
      y: Math.round(f.boundingBox.y),
      width: Math.round(f.boundingBox.width),
      height: Math.round(f.boundingBox.height),
      areaPct: Number((((f.boundingBox.width * f.boundingBox.height) / frameArea) * 100).toFixed(2)),
    }));

    const largest = boxes.reduce((a, b) => (b.areaPct > (a?.areaPct ?? 0) ? b : a), null);

    return { count: boxes.length, boxes, largest, areaPct: largest?.areaPct ?? 0 };
  } catch {
    return null;
  }
}

// Crops the portrait out of a document scan, padded around the
// detected face. The portrait is what gets compared to the selfie —
// comparing a whole ID card against a face wastes most of the frame.
export function cropFace(canvas, box, pad = 0.45) {
  const px = box.width * pad;
  const py = box.height * pad;

  const x = Math.max(0, Math.round(box.x - px));
  const y = Math.max(0, Math.round(box.y - py));
  const w = Math.min(canvas.width - x, Math.round(box.width + px * 2));
  const h = Math.min(canvas.height - y, Math.round(box.height + py * 2));

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

// ── Passive liveness ────────────────────────────────────────────
// Captures a short burst and measures how much the frame actually
// changes. A photograph held to the lens is nearly static; a person
// is not. This is a weak signal on its own and is reported as one —
// a determined attacker defeats it with a video. Real presentation
// attack detection is an ISO/IEC 30107-3 certified SDK behind the
// provider interface.
export async function passiveLiveness(videoEl, { frames = 8, intervalMs = 120 } = {}) {
  const samples = [];

  for (let i = 0; i < frames; i++) {
    try {
      const { gray } = toGrayscale(grabFrame(videoEl));
      samples.push(gray);
    } catch {
      break;
    }
    if (i < frames - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }

  if (samples.length < 3) {
    return { available: false, reason: 'not_enough_frames', framesAnalysed: samples.length };
  }

  let totalDiff = 0;
  let comparisons = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.length !== b.length) continue;

    let diff = 0;
    for (let p = 0; p < a.length; p++) diff += Math.abs(a[p] - b[p]);
    totalDiff += diff / a.length;
    comparisons++;
  }

  const motion = comparisons ? totalDiff / comparisons : 0;

  // Calibrated loosely: a static photograph sits near sensor noise,
  // a seated person breathing and blinking sits well above it.
  const looksStatic = motion < 0.9;

  return {
    available: true,
    framesAnalysed: samples.length,
    motion: Number(motion.toFixed(3)),
    looksStatic,
    // Deliberately capped: this method cannot justify high confidence.
    confidence: Number(Math.min(70, motion * 22).toFixed(1)),
    note: looksStatic
      ? 'Very little frame-to-frame change — consistent with a photograph held to the camera.'
      : 'Frame-to-frame change consistent with a live subject.',
  };
}

// ── Fingerprint, via the device's own sensor ────────────────────
export function platformAuthenticatorAvailable() {
  return Boolean(window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable);
}

export async function fingerprintSupported() {
  if (!platformAuthenticatorAvailable()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// Asks the device to verify its owner with its own sensor. What comes
// back is a signed assertion, not a fingerprint: the template never
// leaves the secure element, and neither this page nor the server ever
// sees it. That is a feature, and it is also the limit — this proves
// the enrolled owner of THIS DEVICE was present, not that a particular
// person's finger was.
export async function captureFingerprint({ challenge, subjectLabel = 'xCentral applicant' } = {}) {
  if (!(await fingerprintSupported())) {
    const e = new Error('This device has no fingerprint or face sensor available to the browser.');
    e.code = 'no_platform_authenticator';
    throw e;
  }

  const raw = challenge ?? crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: raw,
        rp: { name: 'xCentral Verification Hub' },
        user: { id: userId, name: subjectLabel, displayName: subjectLabel },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          // The whole point: the sensor must actually verify a person.
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'none',
      },
    });

    if (!credential) throw new Error('No credential was returned.');

    const hex = (buf) => Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0')).join('');

    return {
      method: 'webauthn_platform',
      credentialId: credential.id,
      // A stable reference to the device credential, not a biometric.
      credentialHash: hex(credential.rawId),
      userVerified: true,
      capturedAt: new Date().toISOString(),
      note: 'The device verified its owner with its own sensor. No fingerprint image or '
          + 'template left the device, and none reached this system.',
    };
  } catch (err) {
    const e = new Error(
      err.name === 'NotAllowedError'
        ? 'The fingerprint prompt was dismissed or timed out.'
        : `Fingerprint capture failed: ${err.message}`);
    e.code = err.name;
    throw e;
  }
}

// ── One-call capture-and-assess ─────────────────────────────────
// What the wizard uses: grab, measure, detect, and report — without
// deciding. The database's assess_capture_quality() owns the verdict
// so the console and the pipeline cannot drift.
export async function captureAndMeasure(source, { captureType = 'selfie' } = {}) {
  const canvas = source instanceof HTMLCanvasElement ? source : grabFrame(source);
  const quality = measureQuality(canvas);
  const faces = await detectFaces(canvas);

  return {
    canvas,
    captureType,
    metrics: {
      ...quality,
      faceDetected: faces ? faces.count > 0 : null,
      faceCount: faces ? faces.count : null,
      faceAreaPct: faces ? faces.areaPct : null,
      faceDetectionAvailable: faces !== null,
    },
    faces,
  };
}
