# Focus Guardian (Web)

A tiny web app that watches your webcam + keyboard/mouse and nags you when
you're distracted by your phone.

```
CAMERA
  → Phone detected?
  → Head looking down?
  → Keyboard/mouse inactive for ~10 s?
  → Wait ~5-10 s
  → Warning: "HEY. PUT THE PHONE DOWN."
```

- **No backend, no server, no database.** Everything runs in your browser.
- Webcam frames are processed locally in memory — nothing is recorded,
  saved, or uploaded anywhere.
- Keyboard/mouse are tracked only by *when* input happened, never content.
- Detection uses **MediaPipe** (face detection + an `efficientdet_lite2`
  object detector — the more accurate model; falls back to `efficientdet_lite0`
  if the big one won't load) loaded from a CDN on first start (~25 MB,
  cached).
- ~6 FPS vision, face + phone detection on every frame (small phone model).
- The detector's boxes are drawn on the camera preview — a **green face box**,
  an **amber phone box that follows the phone** as it moves, and a dashed
  `phone?` box whenever the model sees anything phone-like (even far below
  the lock bar). No other objects are drawn.
- Phone detection **tracks the box across frames** instead of trusting single
  frames: a phone that's half-hidden or briefly blurred stays "seen" while
  its box is alive (~1 s grace), while hands flashing through the frame jump
  around and never lock a track, so they don't flip the status.

## Run locally

The webcam only works on `localhost` or HTTPS, so use a small static server:

```bash
python -m http.server 8000
```

or

```bash
npx serve
```

Then open <http://localhost:8000> and click **Start watching**. Allow the
camera + notification permissions when asked.

## Deploy to Vercel (free, no backend)

**Option A — CLI:**

```bash
npm i -g vercel
vercel        # run it inside this folder, accept the defaults
```

**Option B — GitHub:**

1. Push this folder to a GitHub repo.
2. Go to <https://vercel.com> → **Add New Project** → import the repo.
3. Framework preset: **Other** (no build command needed — it's static).
4. Deploy. Vercel gives you an HTTPS URL, so the webcam + notifications work.

## How to use

1. Open the app (it works best in Chrome or Edge).
2. Click **Start watching**. Keep this tab open.
3. The status panel shows live state: Camera / Keyboard / Mouse / Phone /
   Phone time / Notifications / Distraction. While the phone is tracked,
   **Phone time** counts how long it's been in your hands (e.g. `1:23`).
   While watching, a condition line shows exactly why a warning hasn't
   fired yet — `✓ face · ✓ down · ✗ phone · ✓ idle` — so you can see which
   requirement is missing.
4. Whenever you hold your phone, the status shows **"warn in Ns"** counting
   down, then a warning fires (spoken voice + beep, browser notification, and
   big banner). There is no face / head-down requirement — holding the phone
   is enough. **Keep holding it and the alerts keep coming**: each repeat is
   faster and the messages escalate from gentle ("Hey. Put the phone down.")
   to firm to strong ("STOP. PHONE DOWN. NOW.") until you put it down. If
   you're actively typing/moving the mouse (the **Working** row says Yes) the
   nagging is slower and gentler. If nothing fires, check the condition line
   (`✓ phone`), and use **Settings → Test alert** to verify sound +
   notifications work.

## Settings

Everything is configurable from the **Settings** panel (stored in your
browser's `localStorage`):

| Setting | Meaning | Range |
| --- | --- | --- |
| Camera | use the webcam or not | ON / OFF |
| Detection delay | how long the phone must be held before a warning | 2-30 s |
| Notification cooldown | minimum wait before a NEW phone-hold episode can warn again (while you keep holding, repeats are faster and escalating) | 30-300 s |
| Phone sensitivity | minimum confidence for a phone to be considered at all; locking is decided by the box staying still for ~0.5 s (Low = fewest false alarms; High = catches the weakest hints) | Low / Medium / High |
| Alert sound | spoken warning (browser text-to-speech) + beep, beep only, or off | Voice + beep / Beep only / Off |
| Show camera preview | open your camera feed in a small popup window | on/off |

The warning **messages** are easy to edit: they're the `MESSAGES` list at
the top of `app.js` (one is picked at random each warning).

## Privacy

This is a pure client-side app. There is no server: your video never
leaves the browser, nothing is recorded, and there are no accounts or
tracking.

## Known limitations

- Browser notifications only fire while the tab is open (and with
  notification permission granted).
- Voice alerts use the browser's text-to-speech and need audio to be
  unlocked — click **Start watching** once (that unlocks sound), and keep the
  tab audible (not muted). Chrome may also pause speech when the tab is fully
  backgrounded; the on-screen banner and notification still fire.
- The phone must be visible to the webcam; a phone held directly in front
  of the face hides the face, so detection is unreliable in that pose.
- Phone detection uses a small model (`efficientdet_lite0`) that sometimes
  confuses hands with phones. The box tracking filters most of that out (a
  real phone holds still / moves smoothly, hands jump around), but if your
  hands keep triggering it, set **Phone sensitivity** to Low. Hold the phone
  roughly at arm's length and in frame; very close-up or fast-moving phones
  are still hard. The status row shows the live confidence (e.g. `NO · 0.19`)
  and the preview draws the box the detector is tracking.
- Detection only runs while **Start watching** is active — the Phone row stays
  `NO`/`N/A` until then.
- The first run downloads the MediaPipe models from Google's CDN
  (`storage.googleapis.com`) — needs an internet connection once.
- Expect occasional false positives/negatives — adjust Strictness.
