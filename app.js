'use strict';

/* ============================================================
 * CONFIG — everything tunable lives here.
 * Messages are the notification texts (one is picked at random).
 * ============================================================ */

// Four escalation tiers. Warnings cycle through them in SEQUENCE — each
// alert plays the NEXT message in the current tier (never a repeat), and the
// ladder moves up as you keep ignoring it: MESSAGES → FIRM → STRONG → FINAL.
// The FINAL tier loops back to its start when exhausted, so while you keep
// holding the phone, alerts keep coming, one after another, always different.
const MESSAGES = [
  'HEY. PUT THE PHONE DOWN.',
  'Focus. The phone can wait.',
  'Come back to work.',
  "You're distracted — drop the phone.",
  'Put the phone away and get back to it.',
  'That phone is stealing your time. Set it down.',
  'Eyes back on the task. Phone away.',
  'You picked it up again. Put it down.',
  'This is your focus window. Protect it.',
  "Don't let one scroll turn into twenty minutes.",
];

const MESSAGES_FIRM = [
  'Still holding the phone. PUT IT DOWN.',
  'You are STILL on your phone. Stop.',
  'Phone down. Back to work. NOW.',
  "That's enough scrolling — close it.",
  'You are ignoring me. The phone stays down.',
  'Every second on that phone is work you are not doing.',
  'Enough. Put the phone away this minute.',
  'Your focus is slipping. Drop the phone NOW.',
  'The phone is not helping you. It is stealing from you.',
  'Stop scrolling and get back to the task.',
];

const MESSAGES_STRONG = [
  'STOP. PHONE DOWN. NOW.',
  'PUT THE PHONE DOWN IMMEDIATELY.',
  'ENOUGH. Put the phone away and work.',
  'You have been ignoring this. PHONE DOWN.',
  'THIS IS YOUR WARNING. Drop it now.',
  'You are failing your own goal. Put the phone down.',
  'THE PHONE GOES DOWN. RIGHT NOW.',
  'That scroll is a trap. Let go of the phone NOW.',
  'WAKE UP. You are on your phone. Put it down.',
  'No more gentle warnings after this. PHONE. DOWN.',
];

// The final tier: short, brutal, and it LOOPS — once you're here the alerts
// keep rotating through these until the phone leaves your hand.
const MESSAGES_FINAL = [
  'PHONE DOWN. PHONE DOWN. PHONE DOWN.',
  'PUT IT DOWN. WALK AWAY. WORK.',
  'YOU ARE STILL ON YOUR PHONE. THIS IS NOT WORKING.',
  'STOP. RIGHT NOW. THE PHONE LEAVES YOUR HAND.',
  'YOU CAME HERE TO WORK. THE PHONE IS IN THE WAY. DROP IT.',
  'ENOUGH IS ENOUGH. PHONE DOWN OR THIS KEEPS HAPPENING.',
  'LAST WARNING. PUT. THE. PHONE. DOWN.',
  "Don't let the phone win. You are stronger than it. DROP IT NOW.",
];

const DEFAULTS = {
  cameraOn: true,          // Camera: ON/OFF
  detectionDelay: 7,       // Detection delay: 5-30 s
  cooldown: 60,            // Notification cooldown: 30-300 s
  phoneSensitivity: 'Medium', // phone-detection confidence: Low / Medium / High
  alertSound: 'voice',     // voice | beep | off
  preview: false,          // open the camera feed in a small popup window
};

const VISION_FPS = 6;          // vision loop rate (~6 FPS, lightweight)
const TICK_MS = 300;           // detector tick rate
const ACTIVE_IF_IDLE_LESS_THAN = 3;   // input shown as "Active" under this (s)
// Phone detection TRACKS A BOX across frames instead of trusting per-frame
// scores. efficientdet_lite0 confuses hands with phones, so stray hand
// detections — which jump around the frame — never sustain a track, while a
// real phone (even half-hidden) moves smoothly and keeps its box alive.
// The tracked box is drawn on the camera preview, following the phone.
//   enter: confidence bar needed to START a track (needs 2 stable frames)
//   exit:  a track dies after PHONE_RELEASE_FRAMES frames with no nearby hit
// Sensitivity sets TWO bars for phone-class detections:
//   floor — minimum score to be "considered" at all: kept in the candidate
//           pool (so an ALREADY-locked phone keeps tracking at low scores,
//           e.g. half-hidden).
//   lock  — minimum score a candidate needs to START a brand-new track.
// Locking is location stability PLUS this higher score bar: the model flings
// low-confidence "cell phone" labels at all sorts of other objects (books,
// remotes, cups, hands), so a weak label must NOT be able to begin a track no
// matter how still it sits. A real phone on the accurate lite2 model scores
// well above the lock bar. (The old design locked on score-less stability
// alone, which is why random objects got flagged as phones.)
const PHONE_SENSITIVITY = {
  // The lock bars are deliberately LOW because the verification gates
  // (activeness + reference-photo match) catch false locks afterwards — the
  // bars only need to separate "something phone-ish and stable" from noise.
  // A real phone in hand — even half-covered or held at an angle — scores
  // well above these; only weak "cell phone" labels on faces/random objects
  // fall below, and even those must hold still for ~0.5 s to lock.
  Low:    { floor: 0.12, lock: 0.15, lockSquare: 0.28 },
  Medium: { floor: 0.06, lock: 0.08, lockSquare: 0.16 },
  High:   { floor: 0.05, lock: 0.05, lockSquare: 0.10 },
};
const PHONE_CONFIRM_FRAMES = 3;   // location-stable candidate frames to lock (~0.5 s)
const PHONE_RELEASE_FRAMES = 6;   // frames a track survives without a nearby hit (~1 s)
const PHONE_MAX_MOVE = 0.30;      // max normalized jump between frames while tracking
const PHONE_SHOW_MIN = 0.05;      // phone-class detections below this are ignored entirely
// STARTING a track is score + shape + stability, where shape only raises the
// bar instead of rejecting outright:
//   clearly portrait/landscape box (display aspect < 0.70 or > 1.50) locks
//     at the low `lock` bar — a phone half out of frame or half hidden still
//     shows a portrait/landscape sliver, so it locks even at modest scores;
//   near-square box (0.70-1.50) — a hand gripping a phone covers half of it
//     and makes the box square-ish, but chargers, cups and faces sit in this
//     band too — locks only at the higher `lockSquare` bar, and NOT if the
//     box overlaps the user's face (a face being mislabeled as a phone).
// The score bar alone is a weak signal (a half-hidden real phone scores
// low), so the bars are kept low enough that a real phone in hand clears
// them; weak "cell phone" labels on faces/noses/random objects never do.
// Oversized close-up boxes are excluded entirely. Once a track is locked it
// ignores shape, so a phone held at an angle stays tracked.
const PHONE_LOCK_ASPECT_MIN = 0.70;   // display w/h below = portrait-ish
const PHONE_LOCK_ASPECT_MAX = 1.50;   // display w/h above = landscape-ish
const PHONE_LOCK_AREA_MAX = 0.40;     // exclude giant (close-up) boxes

const MEDIAPIPE_VERSION = '0.10.14';
const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MEDIAPIPE_VERSION;
const BUNDLE_URL = VISION_CDN + '/vision_bundle.mjs';
const WASM_URL = VISION_CDN + '/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const OBJ_MODEL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite';
const OBJ_MODEL_LITE0 = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
const SETTINGS_KEY = 'focus-guardian-settings';

// Phone verification — two gates, both fully client-side (no backend):
//   1) ACTIVENESS — if you are actively typing / moving the mouse while a
//      phone-shaped object is tracked, it is not treated as a distraction.
//   2) OBJECT MATCH — a tiny fingerprint (dHash + color histogram) of the
//      tracked object is compared with a stored photo of YOUR actual phone
//      (taken once in Settings). A match warns; anything else (chargers,
//      cups, books) stays silent. The picture is taken at most once per
//      hold episode (one 32x32 downscale, ~1 ms) — never per frame — and
//      the reference photo persists in localStorage across restarts.
const REF_PHOTO_KEY = 'focus-guardian-ref-phone';
const VERIFY_MATCH_MIN = 0.50;    // combined similarity (0-1) to call it "your phone"
const VERIFY_AWAY_GRACE = 3000;   // track-flicker grace: re-lock within 3 s keeps the verdict
const SIG_SIZE = 64;              // fingerprint downscale size (tiny & fast)
const SIG_GRID = 16;              // 16x16 block grid → 480-bit texture hash
const COLOR_BINS = 6;             // 6x6x6 color histogram = 216 bins

/* ============================================================
 * State
 * ============================================================ */

const state = {
  running: false,
  ...loadSettings(),

  lastKeyboard: performance.now(),
  lastMouse: performance.now(),
  lastInput: performance.now(),

  faceSupported: false,   // MediaPipe face detector loaded
  phoneSupported: false,  // object detector loaded
  facePresent: false,
  phoneSeen: false,       // "phone in view" — true while a phone box is tracked
  lastPhoneScore: 0,      // best phone-class score this frame (for the UI)
  phoneSince: null,       // timestamp when the phone was first tracked (for the timer)
  faceBox: null,          // normalized face box (drawn on the preview)
  phoneBox: null,         // normalized tracked phone box (drawn on the preview)

  suspiciousSince: null,
  lastWarn: Number.NEGATIVE_INFINITY,  // so the very first warning always fires
  warnCount: 0,             // warnings fired during the current hold episode
  distracted: false,
  wasDistracted: false,

  refPhoto: loadRefPhoto(), // stored photo of the real phone {url, sig, at}
  verifyVerdict: null,      // 'matched' | 'mismatch' | 'noref' | null
  verifySim: null,          // last similarity score (0-1)
  verifyThumb: null,        // data URL of the last verification capture
  verifyAway: null,         // when the phone left the frame (for the flicker grace)
  verifyAttempts: 0,        // mismatch retries on the current hold (blur guard)
};

let faceDetector = null;
let objectDetector = null;
let stream = null;
let visionTimer = null;
let detectorTimer = null;
let previewWin = null;      // small popup window showing the camera feed
let starting = false;       // re-entrancy guard for startWatching (async)
let phoneTrack = null;      // normalized {x,y,w,h} of the tracked phone box
let phoneTrackMisses = 0;   // consecutive frames without a nearby match
let initCand = null;        // last strong candidate (while starting a track)
let initStreak = 0;         // consecutive location-stable candidates
let initMisses = 0;         // frames with no nearby candidate during init

const $ = (id) => document.getElementById(id);
// Null-safe listener: if the element is missing (e.g. a cached old index.html
// being served alongside a newer app.js), skip instead of crashing the whole
// script at init — detection must keep working regardless.
function on(id, evt, fn) {
  const el = $(id);
  if (el) el.addEventListener(evt, fn);
}
const video = $('preview');

/* ============================================================
 * Input tracking — timestamps only, never content
 * ============================================================ */

function markInput(kind) {
  const now = performance.now();
  state.lastInput = now;
  if (kind === 'key') state.lastKeyboard = now;
  if (kind === 'mouse') state.lastMouse = now;
}
// A hand resting on the mouse jitters it constantly — that would keep the
// "idle" condition never true. Only count a mouse move as activity if it's a
// real movement (>12 px) or the first event in a while (>600 ms).
let lastMouseX = -1;
let lastMouseY = -1;
let lastMouseMoveAt = 0;
window.addEventListener('keydown', () => markInput('key'));
window.addEventListener('mousemove', (e) => {
  const now = performance.now();
  const moved = Math.hypot(e.clientX - lastMouseX, e.clientY - lastMouseY) >= 12 ||
                now - lastMouseMoveAt > 600;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  if (moved) {
    lastMouseMoveAt = now;
    markInput('mouse');
  }
});
window.addEventListener('mousedown', () => markInput('mouse'));
window.addEventListener('wheel', () => markInput('mouse'));
window.addEventListener('touchstart', () => markInput('mouse'));

function idleSeconds() {
  return (performance.now() - state.lastInput) / 1000;
}

/* ============================================================
 * Vision — MediaPipe Tasks (runs fully in the browser)
 * ============================================================ */

async function loadModels() {
  setMsg('Loading detection models (first time only, ~7 MB)...');
  try {
    const Vision = await import(BUNDLE_URL);  // MediaPipe Tasks Vision (ESM)
    const vision = await Vision.FilesetResolver.forVisionTasks(WASM_URL);
    faceDetector = await createDetector(
      Vision.FaceDetector, vision, FACE_MODEL,
      { minDetectionConfidence: 0.5 });
    state.faceSupported = faceDetector !== null;
    // Low pre-filter: let weak/partial detections through so the tracking
    // logic below can judge them (maxResults caps the CPU cost).
    objectDetector = await createDetector(
      Vision.ObjectDetector, vision, OBJ_MODEL,
      { minDetectionConfidence: 0.05, maxResults: 10 });
    if (!objectDetector && OBJ_MODEL !== OBJ_MODEL_LITE0) {
      // Fall back to the lighter model if the bigger one won't load.
      objectDetector = await createDetector(
        Vision.ObjectDetector, vision, OBJ_MODEL_LITE0,
        { minDetectionConfidence: 0.05, maxResults: 10 });
    }
    state.phoneSupported = objectDetector !== null;
  } catch (err) {
    console.warn('Model loading failed:', err);
  }
  if (!state.faceSupported || !state.phoneSupported) {
    setMsg('MediaPipe/models failed to load from the CDN. Check your internet connection, then reload.');
  } else {
    setMsg('Models ready.');
  }
}

async function createDetector(Cls, vision, modelPath, extra) {
  if (!Cls) return null;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      return await Cls.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: 'VIDEO',
        ...extra,
      });
    } catch (err) {
      console.warn(Cls.name + ' failed with delegate ' + delegate + ':', err);
    }
  }
  return null;
}

function visionTick() {
  if (!state.running || !video.videoWidth) return;
  const ts = performance.now();

  // Reset the per-frame score so the status row always reflects the CURRENT
  // frame (otherwise a stale score lingers next to a fresh "not detected").
  state.lastPhoneScore = 0;

  let facePresent = false;
  state.faceBox = null;
  if (faceDetector) {
    try {
      const res = faceDetector.detectForVideo(video, ts);
      const det = res && res.detections && res.detections[0];
      if (det) {
        facePresent = true;
        if (det.boundingBox) {
          // MediaPipe gives pixel coordinates; store normalized 0-1 boxes.
          state.faceBox = {
            x: det.boundingBox.originX / video.videoWidth,
            y: det.boundingBox.originY / video.videoHeight,
            w: det.boundingBox.width / video.videoWidth,
            h: det.boundingBox.height / video.videoHeight,
          };
        }
      }
    } catch (err) { /* skip frame */ }
  }

  // Run the object detector. Only phone-class detections are used/drawn —
  // everything the model labels is checked across ALL of its categories
  // because a real phone is often the 2nd/3rd hypothesis (e.g. below "book").
  // cands = candidates strong enough to track (>= sensitivity floor);
  // lockCands = confident + phone-shaped candidates (can START a track).
  const sens = PHONE_SENSITIVITY[state.phoneSensitivity] || PHONE_SENSITIVITY.Medium;
  const cands = [];      // floor-level candidates (track continuation)
  const lockCands = [];  // confident + phone-shaped candidates (can START a track)
  if (objectDetector) {
    try {
      const res = objectDetector.detectForVideo(video, ts);
      for (const d of (res.detections || [])) {
        let phoneCat = null;  // best phone-class category, if any
        for (const cat of (d.categories || [])) {
          if (cat && cat.categoryName && /phone/i.test(cat.categoryName) &&
              (!phoneCat || cat.score > phoneCat.score)) phoneCat = cat;
        }
        if (!phoneCat || !d.boundingBox) continue;
        // MediaPipe gives pixel coordinates — normalize to 0-1 first so
        // PHONE_MAX_MOVE and the size filter behave like true fractions.
        const b = d.boundingBox;
        const nw = b.width / video.videoWidth;
        const nh = b.height / video.videoHeight;
        if (nw <= 0 || nh <= 0) continue;
        const nx = b.originX / video.videoWidth;
        const ny = b.originY / video.videoHeight;
        if (phoneCat.score > state.lastPhoneScore) state.lastPhoneScore = phoneCat.score;
        if (phoneCat.score >= PHONE_SHOW_MIN && nw * nh >= 0.004) {
          const cand = {
            x: nx, y: ny, w: nw, h: nh,
            cx: nx + nw / 2, cy: ny + nh / 2,
            score: phoneCat.score,
          };
          if (phoneCat.score >= sens.floor) cands.push(cand);
          // Boxes are normalized per axis (x by width, y by height), so a
          // square object becomes "portrait" in normalized coords — undo that
          // with the video's pixel aspect before judging shape.
          const dispAspect = (cand.w / cand.h) * (video.videoWidth / video.videoHeight);
          const nearSquare = dispAspect >= PHONE_LOCK_ASPECT_MIN &&
                             dispAspect <= PHONE_LOCK_ASPECT_MAX;
          const bar = nearSquare ? sens.lockSquare : sens.lock;
          // A near-square box that is MOSTLY CONTAINED inside the face box is
          // almost certainly the face being mislabeled as a phone — block it.
          // But a phone held up near your face merely OVERLAPS the face box
          // (it extends outside the head silhouette), so it must still be
          // allowed to lock — blocking on overlap alone made phones held at
          // face level never register.
          const onFace = nearSquare && state.faceBox &&
            overlapFraction(cand, state.faceBox) > 0.75;
          if (phoneCat.score >= bar && !onFace && cand.w * cand.h < PHONE_LOCK_AREA_MAX) {
            lockCands.push(cand);
          }
        }
      }
    } catch (err) { /* skip frame */ }
  }

  // Box tracking: keep the phone's box alive and following it. A real phone
  // moves smoothly frame to frame; hands flashing through the camera produce
  // detections that jump around and can't sustain a track — so they don't
  // flip the status.
  if (phoneTrack) {
    let best = null;
    let bestD = Infinity;
    const tx = phoneTrack.x + phoneTrack.w / 2;
    const ty = phoneTrack.y + phoneTrack.h / 2;
    for (const c of cands) {
      const d = Math.hypot(c.cx - tx, c.cy - ty);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best && bestD <= PHONE_MAX_MOVE) {
      // Smooth the box toward the match so it follows rather than jitters.
      const k = 0.5;
      phoneTrack.x += k * (best.x - phoneTrack.x);
      phoneTrack.y += k * (best.y - phoneTrack.y);
      phoneTrack.w += k * (best.w - phoneTrack.w);
      phoneTrack.h += k * (best.h - phoneTrack.h);
      phoneTrackMisses = 0;
      state.phoneSeen = true;
    } else {
      phoneTrackMisses++;
      if (phoneTrackMisses >= PHONE_RELEASE_FRAMES) {
        phoneTrack = null;
        phoneTrackMisses = 0;
        state.phoneSeen = false;
      }
    }
  } else {
    // No track yet: a NEW track may only start from a CONFIDENT, phone-shaped
    // candidate (lockCands) that also stays location-stable for a few frames.
    // Weak "cell phone" labels — which the model throws at books, remotes,
    // hands, whatever — can't begin a track no matter how still they sit.
    // (Once locked, the track survives on the lower floor, so a half-hidden
    // real phone keeps counting.)
    if (initCand) {
      const scx = initCand.x + initCand.w / 2;
      const scy = initCand.y + initCand.h / 2;
      const near = lockCands
        .filter((c) => Math.hypot(c.cx - scx, c.cy - scy) <= PHONE_MAX_MOVE)
        .sort((a, b) => b.score - a.score)[0];
      if (near) {
        initStreak++;
        initCand = { x: near.x, y: near.y, w: near.w, h: near.h };
        initMisses = 0;
      } else {
        // A half-visible phone flickers in and out of the model's output, so
        // tolerate a few missed frames before giving up on the candidate
        // (2 was too strict — the streak died before it could ever lock).
        initMisses++;
        if (initMisses >= 4) {
          initCand = null;
          initStreak = 0;
          initMisses = 0;
        }
      }
    } else if (lockCands.length) {
      const best = lockCands.slice().sort((a, b) => b.score - a.score)[0];
      initCand = { x: best.x, y: best.y, w: best.w, h: best.h };
      initStreak = 1;
      initMisses = 0;
    }
    if (initStreak >= PHONE_CONFIRM_FRAMES) {
      phoneTrack = { x: initCand.x, y: initCand.y, w: initCand.w, h: initCand.h };
      initCand = null;
      initStreak = 0;
      initMisses = 0;
      state.phoneSeen = true;
    }
  }

  state.phoneBox = phoneTrack
    ? { x: phoneTrack.x, y: phoneTrack.y, w: phoneTrack.w, h: phoneTrack.h } : null;

  // Phone-usage timer: start it the moment the phone is first tracked, reset
  // it when the track dies.
  if (state.phoneSeen && state.phoneSince === null) state.phoneSince = performance.now();
  if (!state.phoneSeen) state.phoneSince = null;

  state.facePresent = facePresent;
  drawOverlays();
}

// Fraction of box `a` that lies inside box `b` (0-1). Used to tell a face
// fragment (mostly inside the face box — a mislabel) from a real phone held
// in front of the face (overlaps, but extends outside the head silhouette).
function overlapFraction(a, b) {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ix <= 0 || iy <= 0) return 0;
  return (ix * iy) / (a.w * a.h);
}

/* ============================================================
 * Phone verification — fingerprint + match (all client-side)
 * ============================================================ */

function loadRefPhoto() {
  try {
    const raw = localStorage.getItem(REF_PHOTO_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !p.url || !p.sig) return null;
    return { url: p.url, sig: p.sig, at: p.at || null };
  } catch (err) { return null; }
}

// Draw the given video region into a tiny SIG_SIZE x SIG_SIZE canvas and
// return its ImageData — the cheap fingerprint source for both the reference
// photo and every live verification.
function captureImageData(sx, sy, sw, sh) {
  if (!video.videoWidth) return null;
  const cv = document.createElement('canvas');
  cv.width = SIG_SIZE;
  cv.height = SIG_SIZE;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, SIG_SIZE, SIG_SIZE);
    return ctx.getImageData(0, 0, SIG_SIZE, SIG_SIZE);
  } catch (err) { return null; }
}

// 480-bit texture hash (16x16 block averages, horizontal + vertical
// adjacent-pixel comparisons) plus a 216-bin RGB color histogram. The fine
// grid captures screen texture/glare — what separates a phone from a plain
// phone-shaped charger — while the histogram carries color identity. Robust
// to scale and lighting, fast enough to run per hold without any backend.
function imageSignature(img) {
  if (!img) return null;
  const d = img.data;
  const g = new Array(SIG_SIZE * SIG_SIZE);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    g[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  }
  const cell = SIG_SIZE / SIG_GRID;   // pixels per block edge
  const n = SIG_GRID * SIG_GRID;
  const avg = new Array(n);
  for (let by = 0; by < SIG_GRID; by++) {
    for (let bx = 0; bx < SIG_GRID; bx++) {
      let s = 0;
      for (let y = 0; y < cell; y++) {
        const row = (by * cell + y) * SIG_SIZE + bx * cell;
        for (let x = 0; x < cell; x++) s += g[row + x];
      }
      avg[by * SIG_GRID + bx] = s / (cell * cell);
    }
  }
  let bits = '';
  for (let y = 0; y < SIG_GRID; y++) {
    for (let x = 0; x < SIG_GRID - 1; x++) {
      bits += avg[y * SIG_GRID + x] >= avg[y * SIG_GRID + x + 1] ? '1' : '0';
    }
  }
  for (let y = 0; y < SIG_GRID - 1; y++) {
    for (let x = 0; x < SIG_GRID; x++) {
      bits += avg[y * SIG_GRID + x] >= avg[(y + 1) * SIG_GRID + x] ? '1' : '0';
    }
  }
  const hash = bits.match(/.{1,4}/g).map((b) => parseInt(b, 2).toString(16)).join('');
  // floor(channel * bins / 256) — works for any bin count (Math.log2 is
  // only exact for powers of two, so no shifts here).
  const hist = new Array(COLOR_BINS * COLOR_BINS * COLOR_BINS).fill(0);
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = (d[i] * COLOR_BINS) >> 8;
    const gg = (d[i + 1] * COLOR_BINS) >> 8;
    const b = (d[i + 2] * COLOR_BINS) >> 8;
    hist[(r * COLOR_BINS + gg) * COLOR_BINS + b]++;
    total++;
  }
  return { hash, hist: hist.map((c) => c / (total || 1)) };
}

function hamming(a, b) {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { dist += x & 1; x >>= 1; }
  }
  return dist;
}

function signatureSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  const nBits = (SIG_GRID * (SIG_GRID - 1)) * 2;
  const hashSim = 1 - hamming(s1.hash, s2.hash) / nBits;
  let inter = 0;
  for (let i = 0; i < s1.hist.length; i++) inter += Math.min(s1.hist[i], s2.hist[i]);
  // Texture (hash) dominates — it carries the screen/glare pattern that
  // separates a phone from a phone-shaped object; color is the tiebreaker.
  return 0.65 * hashSim + 0.35 * inter;
}

// Draw the given video region as a small JPEG data URL (for the UI's
// "provided the picture" cross-check strip).
function makeThumb(sx, sy, sw, sh) {
  if (!video.videoWidth) return null;
  const scale = Math.min(1, 160 / sw);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sw * scale));
  cv.height = Math.max(1, Math.round(sh * scale));
  const ctx = cv.getContext('2d');
  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.7);
  } catch (err) { return null; }
}

// The object match: capture the tracked box, fingerprint it, and compare it
// with the stored reference photo. Returns 'matched' | 'mismatch' | 'noref'.
// (One tiny 64x64 downscale per call; a blurry frame is handled by the
// retry logic in detectorTick, not here.)
function verifyHeldObject() {
  if (!state.refPhoto) return 'noref';
  const cw = video.videoWidth, ch = video.videoHeight;
  if (!cw) return 'noref';
  const box = state.phoneBox;
  let sx, sy, sw, sh;
  if (box && box.w > 0.02 && box.h > 0.02) {
    sx = box.x * cw; sy = box.y * ch; sw = box.w * cw; sh = box.h * ch;
  } else {
    sw = cw * 0.6; sh = ch * 0.6; sx = (cw - sw) / 2; sy = (ch - sh) / 2;
  }
  const img = captureImageData(sx, sy, sw, sh);
  if (!img) return 'noref';
  const live = imageSignature(img);
  state.verifySim = signatureSimilarity(state.refPhoto.sig, live);
  state.verifyThumb = makeThumb(sx, sy, sw, sh);
  return state.verifySim >= VERIFY_MATCH_MIN ? 'matched' : 'mismatch';
}

// Settings → "Capture my phone": store a reference photo of the real phone
// (preferring the tracked phone box, else the frame center) so every future
// detection can be cross-checked against it. Stored in localStorage — never
// removed, never sent anywhere.
function captureRefPhoto() {
  if (!video.videoWidth) {
    setMsg('Start watching first so the camera is live, then capture your phone.');
    return;
  }
  const cw = video.videoWidth, ch = video.videoHeight;
  let sx = 0, sy = 0, sw = cw, sh = ch;
  if (state.phoneBox && state.phoneBox.w > 0.02 && state.phoneBox.h > 0.02) {
    sx = state.phoneBox.x * cw; sy = state.phoneBox.y * ch;
    sw = state.phoneBox.w * cw; sh = state.phoneBox.h * ch;
  }
  const img = captureImageData(sx, sy, sw, sh);
  if (!img) { setMsg('Could not read the camera frame — try again.'); return; }
  const sig = imageSignature(img);
  const scale = Math.min(1, 480 / sw);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sw * scale));
  cv.height = Math.max(1, Math.round(sh * scale));
  const ctx = cv.getContext('2d');
  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  } catch (err) { setMsg('Could not read the camera frame — try again.'); return; }
  const ref = { url: cv.toDataURL('image/jpeg', 0.72), sig, at: new Date().toISOString() };
  try {
    localStorage.setItem(REF_PHOTO_KEY, JSON.stringify(ref));
  } catch (err) {
    setMsg('Could not store the photo (browser storage full?). Try again.');
    return;
  }
  state.refPhoto = ref;
  state.verifyVerdict = null;
  state.verifySim = null;
  state.verifyThumb = null;
  state.verifyAway = null;
  state.verifyAttempts = 0;
  refreshRefUI();
  updateUI();
  setMsg('Phone reference photo saved — every detection is now cross-checked against it.');
}

function clearRefPhoto() {
  try { localStorage.removeItem(REF_PHOTO_KEY); } catch (err) { /* ignore */ }
  state.refPhoto = null;
  state.verifyVerdict = null;
  state.verifySim = null;
  state.verifyThumb = null;
  state.verifyAway = null;
  state.verifyAttempts = 0;
  refreshRefUI();
  updateUI();
  setMsg('Reference photo cleared. Detections fall back to shape + score only.');
}

function refreshRefUI() {
  const s = $('ref-status');
  const t = $('ref-thumb');
  if (!s || !t) return;   // stale cached HTML: the verification UI just isn't there
  const has = !!state.refPhoto;
  s.textContent = has
    ? (state.refPhoto.at ? 'Set (' + new Date(state.refPhoto.at).toLocaleDateString() + ')' : 'Set')
    : 'Not set';
  if (has) {
    t.src = state.refPhoto.url;
    t.classList.remove('hidden');
  } else {
    t.classList.add('hidden');
  }
}

/* ============================================================
 * Distraction rule + notification
 * ============================================================ */

function detectorTick() {
  if (!state.running) return;
  const now = performance.now();

  // A warning fires when a phone is being held (tracked) — the tracked box
  // only exists after a CONFIDENT, phone-shaped detection held still for a
  // few frames, so weak "cell phone" labels (on faces, noses, hands,
  // chargers, cups) never trigger anything. While the phone STAYS held,
  // warnings keep coming back with escalating, dynamic messages until you
  // put it down.
  const holding = state.phoneSupported && state.phoneSeen;

  if (!holding) {
    // Note when the phone left the frame: a track that comes back within a
    // couple of seconds is just flicker and keeps its verdict; a real new
    // pick-up re-verifies (still only one capture per hold episode).
    if (state.verifyVerdict !== null && state.verifyAway === null) state.verifyAway = now;
    state.suspiciousSince = null;
    state.distracted = false;
    state.warnCount = 0;      // escalation restarts per hold episode
    resetMessageLadder();     // ...and so does the message sequence
    updateUI();
    return;
  }

  if (state.verifyAway !== null) {
    if (now - state.verifyAway > VERIFY_AWAY_GRACE) {
      state.verifyVerdict = null;   // a real new hold → re-verify
      state.verifySim = null;
      state.verifyThumb = null;
      state.verifyAttempts = 0;
    }
    state.verifyAway = null;
  }

  const working = idleSeconds() < 8;

  // VERIFICATION 1 — activeness. If you're actively typing / moving the
  // mouse, the phone-shaped object in your hand is not a distraction:
  // no object check, no alert, no escalation.
  if (working) {
    state.suspiciousSince = null;
    state.distracted = false;
    state.warnCount = 0;
    resetMessageLadder();
    updateUI();
    return;
  }

  // VERIFICATION 2 — object match. Fingerprint the tracked object and
  // compare it with the stored photo of your actual phone. A single blurry
  // or motion-smeared frame must not decide the verdict, so a borderline
  // mismatch retries on the next ticks (up to 3 attempts, ~0.6 s) before
  // concluding "not your phone". 'noref' (no reference photo stored) falls
  // through to the old shape+score behavior so the app keeps working until
  // you calibrate.
  if (state.verifyVerdict === null) {
    const res = verifyHeldObject();
    if (res === 'noref') {
      state.verifyVerdict = 'noref';
    } else if (res === 'matched') {
      state.verifyVerdict = 'matched';
    } else {
      state.verifyAttempts = (state.verifyAttempts || 0) + 1;
      if (state.verifyAttempts >= 3) state.verifyVerdict = 'mismatch';
      // else: keep the verdict pending and re-check next tick
    }
  }

  if (state.verifyVerdict === 'mismatch') {
    // The object in view is NOT your phone (charger, cup, book, ...) —
    // not a distraction. Stay silent while it is held.
    state.suspiciousSince = null;
    state.distracted = false;
    state.warnCount = 0;
    resetMessageLadder();
    updateUI();
    return;
  }

  if (state.suspiciousSince === null) state.suspiciousSince = now;
  state.distracted = now - state.suspiciousSince >= state.detectionDelay * 1000;

  if (state.distracted) {
    // First warning of an episode waits the cooldown (quick pick-up/put-down
    // doesn't spam). While still held, repeats come faster and faster.
    const gapNeeded = state.warnCount === 0
      ? state.cooldown * 1000
      : escalateInterval(state.warnCount, working) * 1000;
    if (now - state.lastWarn >= gapNeeded) {
      state.lastWarn = now;
      state.warnCount++;
      notify(pickMessage(state.warnCount, working), alertTier(state.warnCount));
    }
  }

  state.wasDistracted = state.distracted;
  updateUI();
}

function escalateInterval(warnCount, working) {
  // Each repeat is quicker; nag slower if you're actively working.
  const base = working ? 26 : 16;
  return Math.max(8, base - warnCount * 2);
}

// Sequential message ladder. Each warning takes the NEXT message in the
// current tier instead of a random pick, so consecutive alerts are always
// different and always escalating. Moving up a tier restarts that tier's
// sequence; the FINAL tier wraps around and keeps looping until the phone is
// put down (which resets the whole ladder for the next episode).
let msgLadder = null;    // tier currently being cycled
let msgLadderIdx = 0;    // next message position in that tier

function ladderTier(warnCount, working) {
  if (working || warnCount <= 1) return MESSAGES;
  if (warnCount <= 3) return MESSAGES_FIRM;
  if (warnCount <= 6) return MESSAGES_STRONG;
  return MESSAGES_FINAL;
}

function pickMessage(warnCount, working) {
  const tier = ladderTier(warnCount, working);
  if (msgLadder !== tier) {
    msgLadder = tier;        // fresh episode or moving up: start at message 0
    msgLadderIdx = 0;
  }
  const message = tier[msgLadderIdx];
  msgLadderIdx = (msgLadderIdx + 1) % tier.length;   // loop forever
  return message;
}

function resetMessageLadder() {
  msgLadder = null;
  msgLadderIdx = 0;
}

function randomMessage() {
  return MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
}

// 0 = gentle tier, 3 = the looping final tier — drives both the message pool
// and how harsh the sound gets.
function alertTier(warnCount) {
  if (warnCount <= 1) return 0;
  if (warnCount <= 3) return 1;
  if (warnCount <= 6) return 2;
  return 3;
}

function fmtSec(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function notify(message, tier) {
  tier = tier || 0;
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('FOCUS GUARDIAN', { body: message, tag: 'focus-guardian' });
    } catch (err) { /* banner below still shows */ }
  }
  playAlert(message, tier);
  $('warn').textContent = '⚠ DISTRACTION DETECTED\n' + message;
  updateUI();
}

/* ============================================================
 * Sound alerts — a spoken warning (or a beep when speech is off/unavailable)
 * ============================================================ */

let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch (err) { return null; }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playAlert(message, tier) {
  const mode = state.alertSound || 'voice';
  if (mode === 'off') return;
  // "Voice + beep": speak AND beep together. If speech is missing or throws,
  // the beep below still covers the alert.
  if (mode === 'voice' && 'speechSynthesis' in window) {
    try {
      speechSynthesis.cancel(); // don't stack warnings
      const u = new SpeechSynthesisUtterance(message);
      u.rate = Math.max(0.8, 1.05 - tier * 0.06);   // slower = more emphatic
      u.pitch = 1.1 + tier * 0.12;                   // sharper as it escalates
      const v = speechSynthesis.getVoices().find((v) => /^en/i.test(v.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (err) { /* beep below still fires */ }
  }
  beep(tier);
}

function beep(tier) {
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const n = 3 + tier;                            // more bursts as it escalates
    const gap = 0.24;
    const dur = 0.20 + tier * 0.02;
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t + i * gap;
      osc.type = 'square';
      osc.frequency.value = (i % 2 ? 880 : 660) + tier * 110;   // rising pitch
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.28, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    }
  } catch (err) { /* audio unavailable */ }
}

/* ============================================================
 * Camera + start/stop
 * ============================================================ */

async function startWatching() {
  // startWatching is async (camera prompt + model download) and the Start
  // button stays visible until it finishes, so a second click (or a settings
  // Save mid-load) must not start a second run: two streams and two timer
  // loops would fight, and the first camera stream would never be stopped.
  if (starting || state.running) return;
  starting = true;
  try {
    setMsg('Requesting camera access...');

    // Open the preview popup synchronously, inside the click gesture — an
    // async window.open() gets killed by the popup blocker. It stays empty
    // until the stream is attached below.
    const wantPreview = state.preview && state.cameraOn;
    if (wantPreview) openPreviewWindow();

    // Unlock audio inside the click gesture — browsers block sound until the
    // page has seen one user interaction.
    ensureAudio();

    if (state.cameraOn) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();
        if (wantPreview) attachPreviewToWindow();
      } catch (err) {
        closePreviewWindow();
        setMsg('Camera access denied. Allow camera permission in the browser, or turn Camera OFF in settings.');
        return;
      }
    }

    if (faceDetector === null && objectDetector === null) {
      await loadModels();
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    state.running = true;
    state.suspiciousSince = null;
    state.distracted = false;
    state.wasDistracted = false;
    visionTimer = setInterval(visionTick, 1000 / VISION_FPS);
    detectorTimer = setInterval(detectorTick, TICK_MS);
    $('btn-start').classList.add('hidden');
    $('btn-toggle').classList.remove('hidden');
    $('btn-toggle').textContent = 'Pause';
    // Keep a model-load failure message visible; only clear it when both
    // detectors are actually usable.
    if (state.faceSupported && state.phoneSupported) setMsg(null);
    updateUI();
  } finally {
    starting = false;
  }
}

function stopWatching() {
  state.running = false;
  clearInterval(visionTimer);
  clearInterval(detectorTimer);
  visionTimer = detectorTimer = null;
  if ('speechSynthesis' in window) {
    try { speechSynthesis.cancel(); } catch (err) { /* ignore */ }
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
  closePreviewWindow();
  state.suspiciousSince = null;
  state.distracted = false;
  state.wasDistracted = false;
  state.warnCount = 0;
  resetMessageLadder();
  state.verifyVerdict = null;
  state.verifySim = null;
  state.verifyThumb = null;
  state.verifyAway = null;
  state.verifyAttempts = 0;
  state.phoneSeen = false;
  state.lastPhoneScore = 0;
  state.phoneSince = null;
  state.testBanner = 0;
  state.phoneBox = null;
  state.faceBox = null;
  phoneTrack = null;
  phoneTrackMisses = 0;
  initCand = null;
  initStreak = 0;
  initMisses = 0;
  $('btn-start').classList.remove('hidden');
  $('btn-toggle').classList.add('hidden');
  updateUI();
}

/* ============================================================
 * Camera preview popup — a small separate window
 * ============================================================ */

const PREVIEW_POPUP_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<title>Focus Guardian — Camera</title>' +
  '<style>html,body{margin:0;height:100%;background:#0f1115;color:#e6e8ee;' +
  'font:14px "Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;' +
  'align-items:center;justify-content:center;gap:10px}' +
  '#stage{position:relative;width:100%;max-width:520px;aspect-ratio:4/3;' +
  'background:#000;border-radius:8px;overflow:hidden}' +
  '#stage video{width:100%;height:100%;object-fit:fill;display:block}' +
  '#stage canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}' +
  'p{margin:0;opacity:.6}</style></head>' +
  '<body><div id="stage"><video id="cam" autoplay muted playsinline></video>' +
  '<canvas id="ov"></canvas></div>' +
  '<p>Focus Guardian — camera preview</p></body></html>';

function openPreviewWindow() {
  if (previewWin && !previewWin.closed) return previewWin;
  previewWin = null;
  try {
    previewWin = window.open('', 'focusGuardianPreview',
      'popup=yes,width=580,height=540,resizable=yes');
  } catch (err) {
    previewWin = null;
  }
  if (previewWin) {
    try {
      previewWin.document.open();
      previewWin.document.write(PREVIEW_POPUP_HTML);
      previewWin.document.close();
      previewWin.focus();
    } catch (err) {
      previewWin = null;
    }
  }
  return previewWin;
}

function attachPreviewToWindow() {
  if (!previewWin || previewWin.closed || !stream) return false;
  try {
    const v = previewWin.document.getElementById('cam');
    if (!v) return false;
    v.srcObject = stream;
    v.play().catch(() => {});
    return true;
  } catch (err) {
    return false;
  }
}

function closePreviewWindow() {
  if (previewWin && !previewWin.closed) {
    try { previewWin.close(); } catch (err) { /* already gone */ }
  }
  previewWin = null;
}

/* ============================================================
 * Detection overlay — draws the face/phone boxes on the preview
 * ============================================================ */

function drawOverlays() {
  if (!video.videoWidth) return;
  drawOnCanvas($('preview-ov'), video);
  if (previewWin && !previewWin.closed) {
    const v = previewWin.document.getElementById('cam');
    const ov = previewWin.document.getElementById('ov');
    if (v && ov && v.videoWidth) drawOnCanvas(ov, v);
  }
}

function drawOnCanvas(canvas, v) {
  if (!canvas) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch) return;
  const dpr = canvas.ownerDocument.defaultView.devicePixelRatio || 1;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = Math.max(2, Math.round(cw / 120));
  ctx.font = Math.round(cw / 30) + 'px sans-serif';
  ctx.textBaseline = 'top';
  const drawBox = (box, color, label, dashed) => {
    if (!box) return;
    // Boxes are normalized 0-1; the canvas exactly covers the displayed
    // video, so multiply straight through.
    const x = box.x * canvas.width, y = box.y * canvas.height;
    const w = box.w * canvas.width, h = box.h * canvas.height;
    ctx.strokeStyle = color;
    ctx.setLineDash(dashed ? [6, 4] : []);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    if (label) {
      ctx.fillStyle = color;
      ctx.fillText(label, x, y - ctx.lineWidth >= 0 ? y - ctx.lineWidth : y + h);
    }
  };
  drawBox(state.faceBox, 'rgba(46,160,67,0.95)', 'face');
  if (state.phoneBox) {
    drawBox(state.phoneBox,
      state.phoneSeen ? 'rgba(210,153,34,0.95)' : 'rgba(210,153,34,0.5)',
      'phone ' + (state.lastPhoneScore > 0 ? state.lastPhoneScore.toFixed(2) : ''));
  }
}

function toggleWatching() {
  if (state.running) stopWatching();
  else startWatching();
}

/* ============================================================
 * Settings
 * ============================================================ */

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) { /* defaults */ }
  return { ...DEFAULTS };
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      cameraOn: state.cameraOn,
      detectionDelay: state.detectionDelay,
      cooldown: state.cooldown,
      phoneSensitivity: state.phoneSensitivity,
      alertSound: state.alertSound,
      preview: state.preview,
    }));
  } catch (err) { /* storage unavailable */ }
}

function openPanel() {
  $('set-camera').value = state.cameraOn ? 'on' : 'off';
  $('set-delay').value = state.detectionDelay;
  $('set-delay-val').textContent = state.detectionDelay;
  $('set-cooldown').value = state.cooldown;
  $('set-cooldown-val').textContent = state.cooldown;
  $('set-phone').value = state.phoneSensitivity;
  $('set-sound').value = state.alertSound;
  $('set-preview').checked = state.preview;
  refreshRefUI();
  $('panel').classList.remove('hidden');
}

function closePanel() {
  $('panel').classList.add('hidden');
}

function applySettings() {
  state.cameraOn = $('set-camera').value === 'on';
  state.detectionDelay = parseInt($('set-delay').value, 10);
  state.cooldown = parseInt($('set-cooldown').value, 10);
  state.phoneSensitivity = $('set-phone').value;
  state.alertSound = $('set-sound').value;
  state.preview = $('set-preview').checked;
  saveSettings();
  if (state.running) {
    // Restart watching so camera on/off + preview apply cleanly.
    stopWatching();
    startWatching();
  }
  updateUI();
}

/* ============================================================
 * UI
 * ============================================================ */

function setMsg(text) {
  const el = $('msg');
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

function updateUI() {
  const paused = !state.running;
  const testActive = !!state.testBanner && performance.now() < state.testBanner;
  const status = $('status');

  if (paused) {
    status.textContent = '⏸ Paused';
    status.className = 'status paused';
  } else if (state.distracted || testActive) {
    // A test alert isn't a real distraction: show 0:00 instead of the time
    // since the last real warning (which may be stale or -Infinity and would
    // render as "Infinity:NaN").
    const el = state.distracted
      ? (performance.now() - (state.suspiciousSince || state.lastWarn)) / 1000
      : 0;
    status.textContent = '⚠ DISTRACTION DETECTED (' + fmtSec(el) + ')';
    status.className = 'status bad';
  } else if (state.suspiciousSince !== null) {
    // The warning fires at the LATER of: the hold-duration delay, and the
    // cooldown/escalation gap since the last warning — mirror detectorTick
    // so the countdown matches when the alert actually lands.
    const working = idleSeconds() < 8;
    const gap = state.warnCount === 0
      ? state.cooldown * 1000
      : escalateInterval(state.warnCount, working) * 1000;
    const warnAt = Math.max(
      state.suspiciousSince + state.detectionDelay * 1000,
      state.lastWarn + gap);
    const left = Math.max(0, Math.ceil((warnAt - performance.now()) / 1000));
    status.textContent = left > 0 ? '● Watching… warn in ' + left + 's' : '● Watching…';
    status.className = 'status susp';
  } else {
    status.textContent = '● Watching';
    status.className = 'status ok';
  }

  $('warn').classList.toggle('hidden', !(state.distracted || testActive));

  // Live trigger-condition readout: what the verification pipeline needs
  // before a warning can fire.
  const conds = $('conds');
  if (state.running) {
    const items = [['phone', state.phoneSeen]];
    if (state.phoneSeen) {
      if (idleSeconds() < 8) items.push(['working', true]);
      else if (state.verifyVerdict === 'matched') items.push(['your phone', true]);
      else if (state.verifyVerdict === 'mismatch') items.push(['not your phone', false]);
      else if (state.verifyVerdict === 'noref') items.push(['no ref photo', false]);
    }
    conds.innerHTML = items.map(([k, v]) =>
      '<span class="' + (v ? 'ok' : 'no') + '">' + (v ? '✓' : '✗') + ' ' + k + '</span>'
    ).join(' ');
    conds.classList.remove('hidden');
  } else {
    conds.classList.add('hidden');
  }

  // Verify row + cross-check strip: what verification #2 concluded about the
  // tracked object. Guarded so a stale cached index.html (missing these
  // elements) can never break updateUI — detection and warnings still run.
  const rowVerify = $('row-verify');
  const strip = $('verify-strip');
  if (rowVerify && strip) {
    const vv = state.verifyVerdict;
    if (!state.running) {
      rowVerify.textContent = '—';
    } else if (idleSeconds() < 8 && state.phoneSeen) {
      rowVerify.textContent = 'Working — no alert';
    } else if (vv === 'matched') {
      rowVerify.textContent = '✅ your phone' +
        (state.verifySim != null ? ' (' + Math.round(state.verifySim * 100) + '%)' : '');
    } else if (vv === 'mismatch') {
      rowVerify.textContent = '❌ other object' +
        (state.verifySim != null ? ' (' + Math.round(state.verifySim * 100) + '%)' : '');
    } else if (vv === 'noref') {
      rowVerify.textContent = 'No reference photo';
    } else if (state.phoneSeen) {
      rowVerify.textContent = 'Checking…';
    } else {
      rowVerify.textContent = '—';
    }
    if (state.running && state.phoneSeen && state.verifyThumb) {
      const refEl = $('verify-ref'), capEl = $('verify-cap'), simEl = $('verify-sim');
      if (refEl && capEl && simEl) {
        refEl.src = state.refPhoto ? state.refPhoto.url : '';
        refEl.classList.toggle('hidden', !state.refPhoto);
        capEl.src = state.verifyThumb;
        simEl.textContent = state.verifySim != null
          ? Math.round(state.verifySim * 100) + '% match — ' +
            (state.verifyVerdict === 'matched' ? 'your phone' :
             state.verifyVerdict === 'mismatch' ? 'NOT your phone' : 'no reference')
          : '';
      }
      strip.classList.remove('hidden');
    } else {
      strip.classList.add('hidden');
    }
  }

  if (!('Notification' in window)) {
    $('row-notify').textContent = 'N/A';
  } else {
    $('row-notify').textContent =
      Notification.permission === 'granted' ? 'ON'
      : Notification.permission === 'denied' ? 'BLOCKED'
      : 'Ask';
  }

  if (paused) {
    $('row-camera').textContent = state.cameraOn ? 'PAUSED' : 'OFF';
  } else if (!state.cameraOn) {
    $('row-camera').textContent = 'OFF';
  } else if (video.videoWidth) {
    $('row-camera').textContent = 'ON';
  } else {
    $('row-camera').textContent = 'UNAVAILABLE';
  }

  $('row-keyboard').textContent =
    (performance.now() - state.lastKeyboard) / 1000 < ACTIVE_IF_IDLE_LESS_THAN ? 'Active' : 'Idle';
  $('row-mouse').textContent =
    (performance.now() - state.lastMouse) / 1000 < ACTIVE_IF_IDLE_LESS_THAN ? 'Active' : 'Idle';
  $('row-working').textContent = state.running
    ? (idleSeconds() < 8 ? 'Yes' : 'No') : '—';

  const phoneScore = state.lastPhoneScore > 0 ? ' · ' + state.lastPhoneScore.toFixed(2) : '';
  $('row-phone').textContent =
    state.phoneSeen ? 'YES' + phoneScore
    : (state.phoneSupported ? 'NO' + phoneScore : 'N/A');
  $('row-phonetime').textContent =
    state.running && state.phoneSeen && state.phoneSince
      ? fmtSec((performance.now() - state.phoneSince) / 1000) : '—';
  $('row-distraction').textContent = state.distracted ? '⚠ YES' : 'No';

  // When the popup is alive it owns the preview; the inline video (the
  // detection source) stays hidden. If the popup was blocked or the user
  // closed it, fall back to the inline preview.
  const previewInPopup = !!(previewWin && !previewWin.closed);
  const previewVisible = state.preview && state.running && state.cameraOn &&
    video.videoWidth && !previewInPopup;
  $('preview-wrap').classList.toggle('hidden', !previewVisible);
}

/* ============================================================
 * Init
 * ============================================================ */

$('btn-start').addEventListener('click', startWatching);
$('btn-toggle').addEventListener('click', toggleWatching);
$('btn-settings').addEventListener('click', () => {
  if ($('panel').classList.contains('hidden')) openPanel();
  else closePanel();
});
$('set-save').addEventListener('click', () => { applySettings(); closePanel(); });
$('set-cancel').addEventListener('click', closePanel);
on('set-capture', 'click', captureRefPhoto);
on('set-ref-clear', 'click', clearRefPhoto);
$('set-test').addEventListener('click', () => {
  // Fire the full alert pipeline right now so you can verify sound,
  // notification permission, and the banner actually work.
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  state.testBanner = performance.now() + 3000; // keep the banner visible ~3 s
  notify(randomMessage(), 0);   // normal intensity for a test
  updateUI();
});
$('set-delay').addEventListener('input', () => {
  $('set-delay-val').textContent = $('set-delay').value;
});
$('set-cooldown').addEventListener('input', () => {
  $('set-cooldown-val').textContent = $('set-cooldown').value;
});

refreshRefUI();   // show the stored reference photo state at boot
updateUI();
