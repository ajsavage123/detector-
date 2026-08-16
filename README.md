# Focus Guardian (Web)

A tiny web app that watches your webcam and nags you when you hold your
phone while you're supposed to be working.

```
CAMERA
  → Phone detected (confident + phone-shaped)?
  → Box tracked & held still for ~0.5 s?
  → Wait ~5-10 s
  → Warning: "HEY. PUT THE PHONE DOWN."
```

- **No backend, no server, no database.** Everything runs in your browser.
- Webcam frames are processed locally in memory — nothing is recorded,
  saved, or uploaded anywhere.
- Keyboard/mouse are tracked only by *when* input happened, never content.
- Detection uses **MediaPipe** loaded from a CDN on first start: a small face
  detector (for the preview box) + an `efficientdet_lite2` object detector
  (the accurate phone model; falls back to `efficientdet_lite0` if the big
  one won't load).
- ~6 FPS vision, phone detection on every frame.
- The preview draws only two boxes: a **green face box** and an **amber
  phone box that follows the phone** once it's confidently tracked. Weak
  "maybe a phone" detections are never drawn — no noise boxes.

## How the phone detection is tuned

A warning fires only when a **phone track locks**, and locking requires all
of these (see `PHONE_SENSITIVITY` / `PHONE_LOCK_*` at the top of `app.js`):

1. **Confidence** — the phone-class score must clear the sensitivity bar.
   Clearly portrait/landscape boxes (a fully visible phone) lock at a low
   bar; near-square boxes — a hand gripping a phone covers half of it and
   makes the box square-ish — need a higher bar (chargers, cups and faces
   sit in that band too). Weak "cell phone" labels on faces/noses/random
   objects never reach either bar.
2. **Stability** — the same location must hold for ~0.5 s before the track
   locks, and the track dies after ~1 s without a nearby hit.
3. **Size** — oversized close-up boxes are excluded.

Once locked, a real phone keeps counting even if it's half-hidden or the
confidence dips. The **Phone sensitivity** setting raises/lowers the bars:
Low = fewest false alarms, High = catches the weakest hints.

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
   While watching, a condition line shows why a warning hasn't fired yet —
   `✓ phone` or `✗ phone`.
4. Whenever you hold a phone in view of the webcam, the status shows
   **"warn in Ns"** counting down, then a warning fires (spoken voice + beep,
   browser notification, and big banner). **Keep holding it and the alerts
   keep coming**: each repeat is faster and the messages escalate from gentle
   ("Hey. Put the phone down.") to firm to strong ("STOP. PHONE DOWN. NOW.")
   until you put it down. If you're actively typing/moving the mouse (the
   **Working** row says Yes) the nagging is slower and gentler. If nothing
   fires, check the condition line (`✓ phone`), and use **Settings → Test
   alert** to verify sound + notifications work.

## Settings

Everything is configurable from the **Settings** panel (stored in your
browser's `localStorage`):

| Setting | Meaning | Range |
| --- | --- | --- |
| Camera | use the webcam or not | ON / OFF |
| Detection delay | how long the phone must be tracked before a warning | 2-30 s |
| Notification cooldown | minimum wait before a NEW phone-hold episode can warn again (while you keep holding, repeats are faster and escalating) | 30-300 s |
| Phone sensitivity | minimum confidence to start a NEW phone track (near-square boxes — hand-gripped phones, but also chargers/cups — need a higher bar); tracks also need ~0.5 s of stability (Low = fewest false alarms; High = catches the weakest hints) | Low / Medium / High |
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
- The phone must be visible to the webcam. A phone held directly in front of
  the face hides the face, so detection is unreliable in that pose; very
  close-up or fast-moving phones are also hard. Hold it roughly at arm's
  length and in frame.
- A **power bank or TV remote is genuinely phone-shaped** — with a single
  webcam there is no way to tell a phone-shaped rectangle from a phone, so
  holding one still in view can trigger. That's what **Phone sensitivity →
  Low** is for.
- Detection only runs while **Start watching** is active — the Phone row stays
  `NO`/`N/A` until then.
- The first run downloads the MediaPipe models from Google's CDN
  (`storage.googleapis.com`) — needs an internet connection once.
- Expect occasional false positives/negatives — the thresholds at the top of
  `app.js` (`PHONE_SENSITIVITY`, `PHONE_LOCK_*`) tune the trade-off.
