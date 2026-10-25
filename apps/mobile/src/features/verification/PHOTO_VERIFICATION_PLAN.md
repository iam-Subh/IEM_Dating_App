# Real-person check (selfie)

**The question it answers:** is this person really the one in their photos and
video?

| | |
|---|---|
| Stops | Catfish (someone else's photos), bots, fake Gmail accounts |
| Who | **Required for Google accounts; optional for college-email students** (D1) |
| What they get | A message - *"You're verified as a real person ✓"* - plus a green **face-scan mark** on each photo, which others see **only on the expanded profile** (D2) |
| Cost | Free (Google ML Kit + dlib, our own server) |

**The blue tick stays the college check only** (D8): it comes from verifying a
college email (`features/auth/GOOGLE_SIGNUP_PLAN.md`). The real-person check
never adds or takes away the tick, and shows nothing on cards.

---

## 0. Decisions

| # | Decision | Recommendation | Status |
|---|---|---|---|
| D1 | Who must do it | **Required for Google accounts** (before their 14-day grace period ends, like the college email); **optional for college-email students**, with a reminder | Decided |
| D2 | A badge for it? | A green **face-scan icon** in the top-right corner of every photo, **only on the expanded profile** (not on the swipe card, Explore, Search list or Likes You). Tapping it explains. It goes away while a changed photo or video needs fixing or is with our team, and comes back once fixed. Photos are never hidden. The person also sees *"You're verified as a real person ✓"* in their profile and Settings | Decided (changed 2026-10-03, was "no badge") |
| D8 | What gives the blue tick | **The college email only** (option A). Later, once most students have done the selfie, the tick may need both (option B) - announced first | Decided |
| D3 | How later photo changes are checked | **A - keep a face key** (numbers, not a picture), with consent; checked automatically | Agreed |
| D4 | Face matching tool | **dlib** (public-domain model, 99.38% LFW) in a small Python service | Agreed |
| D5 | Liveness tool | **Google ML Kit** on the phone, random actions; Amazon Rekognition later only if needed | Agreed |
| D6 | Profile videos | **Checked too**: they must show the person | Agreed |

---

## 1. How it works - the whole picture

```
PHONE                                   OUR SERVER                          ADMIN
─────                                   ──────────                          ─────
"Verify your photos"
  │
  ├─ Google ML Kit: find the face
  ├─ 3 random actions (blink, turn
  │  left/right, smile), random order
  │  from the server's challenge
  ├─ 3 snapshots during the actions ──▶  check the challenge was followed
                                         dlib: snapshots are one person
                                         dlib: compare with each profile
                                         photo + video frames
                                         save the FACE KEY (numbers)
                                         delete the snapshots
                                           │
                     ◀── verified ✓ ───────┤ all match
                     ◀── fix this photo ───┤ a photo is not them
                                           └─ unsure ─────────────────────▶ review queue
                                                                            (sees snapshots
                                                                             + photos, decides)
LATER: new photo / new video ──────────▶  compare with the face key
                     ◀── live ✓ / not them, status paused ──
```

---

## 2. The selfie check, step by step

### 2.1 Before the camera

Screen **"Verify your photos"**:

- What it is: *"Take a quick video selfie. We check it's you in your photos -
  then you're verified as a real person."*
- What we keep - consent, required to continue:
  *"We compare your selfie with your photos and videos, then delete it. We keep
  a face key - numbers, not a picture - to check new photos are you. It's
  never shared and is deleted with your account."* - **[I agree]**.
- Needs at least one photo where their face is clear (the main photo).

### 2.2 The liveness actions (on the phone)

- The server sends a **challenge**: 3 actions in a random order, valid for 2
  minutes, from: *blink*, *turn your head left*, *turn your head right*,
  *smile*.
- Google ML Kit, on the phone, follows the face frame by frame:
  - exactly **one face** in view, close enough (fills a set share of the frame);
  - **blink**: both eyes' "open" score drops below a low value, then recovers;
  - **turn**: head yaw passes a set angle in the asked direction and comes back;
  - **smile**: smiling score passes a set value;
  - the **same face** throughout (tracking ID does not change).
- One **snapshot** at each action's peak, plus one looking straight → 3–4
  images, uploaded to the private bucket (never public).
- Fails gently: *"Move closer"*, *"Too dark - face a light"*, *"Only you in
  the picture"*, *"Take off your sunglasses"*.

This stops printed photos, screenshots and a replayed recording (the order is
new every time). It does not stop masks or deepfakes - see 9.1.

### 2.3 The check (on the server)

1. The challenge exists, belongs to this person, isn't expired or used.
2. dlib finds exactly one face in each snapshot.
3. **The snapshots are one person** (all within the match distance of each
   other) - so nobody swaps faces between actions.
4. **Compare with each profile photo** (rules in 3) and the profile video
   frames (rules in 4).
5. Result: **verified**, **fix a photo**, or **unsure → review**.
6. Save the **face key** (the average of the snapshot descriptors: 128
   numbers), the result, the date; **delete the snapshots** (unsure cases: kept
   for the reviewer, deleted when decided, at most 7 days).

### 2.4 Results the person sees

| Result | Message | Real-person status |
|---|---|---|
| All match | *"You're verified as a real person ✓"* | ✓ |
| Main photo isn't them | *"Your main photo doesn't look like you. Use a photo of yourself."* | ✗ |
| Another photo isn't them | That photo is marked: *"This photo doesn't seem to be you. Remove or replace it."* | ✗ until fixed |
| Video isn't them | *"Your video has to show you."* | ✗ until fixed |
| Liveness failed | *"We couldn't confirm it's a live selfie. Try again in good light."* | ✗ |
| Unsure | *"Thanks - a person from our team will check it, usually within a day."* | Pending |

**Tries:** at most **5 selfie attempts a day**; after 3 failures in a row the
next one goes straight to review (stops people probing the threshold).

---

## 3. Photo rules

| Photo | Rule |
|---|---|
| **Main photo** (first on the card) | Must contain **their face**, matching |
| Other photos, one face | That face must be them |
| Group photos | They must be **one of** the faces |
| Photos with no face (food, places, pets) | Allowed - nothing to compare |
| Heavy filters, cartoons, AI art of themselves | Main photo: refused if no real face is found; others: allowed if no face |

**Matching distance** (dlib descriptors, Euclidean):

| Distance | Means |
|---|---|
| ≤ **0.50** | Same person - match |
| 0.50 – **0.60** | Unsure → review |
| > 0.60 | Not the same person |

These are starting values (dlib's usual cut-off is 0.6). They are set for real
from the calibration test (8).

---

## 4. Profile video rules

Runs inside the existing video processing (the step that makes the playable
file and the cover):

1. **Frames:** one per second, at most 10 (ffmpeg, already on the server).
2. Faces in each frame; compare with the face key.
3. Rules:

| What's in the video | Result |
|---|---|
| They appear in **at least 2 frames** | Approved |
| Only other people's faces | Not approved: *"Your video has to show you."* |
| No face at all | Not approved: *"Show yourself in your video."* |
| Unsure (dark, far, fast) | Review |

- While checking: "Processing…" as today. Not approved: the new video doesn't
  go live; the old one stays.
- **No face key yet** (no real-person check yet): the video goes live as today and
  is checked when they do the selfie check.

---

## 5. After verifying: every change is checked (face key)

| Change | Check | If it fails |
|---|---|---|
| New or replaced **main photo** | Must match the face key | Not saved: *"Your main photo has to show your face."* |
| New other photo | Rules in 3 | Photo saved but **real-person status paused** until removed or a new selfie |
| New **video** | Rules in 4 | Not live (4) |
| Reported for fake photos | All photos and video re-checked | Status removed if they don't match; to review |

Checked in the background, a second or two per photo. Honest people never
notice.

**The real-person status is lost** when: a mismatching photo stays, a report is
upheld, or they delete the face key (Settings → "Remove my real-person check").
**A photo or video changed later never pauses the profile** - only the
real-person status, until the photo is fixed (then it comes back at once, no
new selfie). The 14-day rule for Google accounts asks only whether they have
**ever passed** (`users.real_person_passed_at`); removing the check in Settings,
or a rejected review, clears that, so they owe it again.

---

## 6. What the person and others see

| Who | Where | What |
|---|---|---|
| The person | Profile, Settings > Account | *"You're verified as a real person ✓"* - or *"Verify you're a real person"* with a button |
| The person | Edit profile photos | Marks on any photo that isn't them |
| Others | Expanded profile only | The green face-scan mark on the photos (D2) - gone while a photo or video needs fixing; every photo stays visible. Nothing on the other cards. The blue tick is still only the college email (D8) |

Behind the scenes only (never shown): fake photos are caught, and a Google
account can't keep using the app past its grace period without it.

---

## 7. Server

### 7.1 Face service (new, small)

- A **Python** service in Docker, next to the API: `face_recognition` (built on
  dlib; dlib model in the public domain, library Boost-licensed).
- Private, inside our network only; no outside access.
- Endpoints (internal):
  - `POST /descriptors` - image(s) → faces found, each with 128 numbers and the
    face box.
  - `POST /frames` - a video file → descriptors for sampled frames.
- No storage: it computes and forgets; the API stores what is needed.
- Runs on CPU; about 0.2–0.5 s per photo.

### 7.2 Data

| Table / field | Purpose |
|---|---|
| `face_verifications` (user, status: verified / pending_review / failed / removed, verified_at, method `mlkit_dlib`) | The real-person status and its history |
| `face_keys` (user, 128 numbers, model version, created_at) | The face key - **encrypted at rest**, deleted with the account or on request |
| `face_challenges` (id, user, actions, expires_at, used_at) | Random actions; one use, 2 minutes |
| `face_review_cases` (user, reason, snapshot keys, photo ids, distances, status, decided_by) | The admin queue; snapshots deleted on decision or after 7 days |
| `profile_photos.face_status` (match / no_face / mismatch / unchecked) | Per photo, for the status and the "fix this photo" marks |
| `users.photo_verified_at` | Quick read for cards and ranking |

### 7.3 API

| Endpoint | What it does |
|---|---|
| `POST /verification/face/challenge` | Starts a check: 3 random actions, 2 minutes |
| `POST /verification/face/upload-urls` | Private upload slots for the snapshots |
| `POST /verification/face/submit` | Challenge + snapshot keys → result |
| `GET /verification/face` | Real-person status, per-photo status, what to fix |
| `DELETE /verification/face` | Remove my photo verification and face key |
| Photo save / video processing | Call the face service when a face key exists (5) |
| `GET /admin/face-reviews`, `POST /admin/face-reviews/:id/decide` | Review queue: snapshots + photos side by side, short-lived links |

### 7.4 Limits and safety

- 5 attempts a day; after 3 failures in a row → review.
- Snapshots: private bucket, 5-minute upload links, deleted after the check.
- The face key never leaves the server, never in an API answer.
- A banned person's face key is **not** kept for ban evasion at launch (see
  9.3).

---

## 8. Calibration before launch

Free models are measured mostly on Western faces, so we test on ours:

1. With consent, **30–50 people** from the team and friends (Indian faces,
   mixed skin tones, glasses, beards, hijab, varied light).
2. Each: a selfie check + their real profile photos + 2 "impostor" photos
   (other volunteers).
3. Measure: genuine pairs wrongly refused, impostors wrongly accepted, at each
   distance from 0.40 to 0.65.
4. Choose the match line where **impostors accepted ≈ 0** and genuine refusals
   are few; put the band just above it into review.
5. Repeat after any model change. Keep the numbers in this file.

A script, `npm run face:calibrate`, reads a folder of labelled images and
prints the table.

---

## 9. What it can't do, and what comes later

### 9.1 Masks and deepfakes

ML Kit liveness doesn't stop them. Rare for a college app; if they appear, swap
the liveness step for **Amazon Rekognition Face Liveness** (about ₹1.3 per
check), keeping everything else.

### 9.2 Someone else's identity with their own face

Not this check's job - the **college email** proves the student; the selfie
proves the photos.

### 9.3 Banned people returning (face)

Possible later: keep banned accounts' face keys and compare new sign-ups. The
most sensitive use of face data - only with a clear policy and consent wording,
after launch.

---

## 10. Privacy (India's DPDP Act)

- **Consent** before the camera (2.1), clear and separate - not hidden in the
  terms.
- **Purpose:** only this check. Never for ads, never shared, never sold.
- **Kept:** the face key (numbers) and the result. **Deleted:** snapshots
  (right after; review cases within 7 days), video frames (right away).
- **Deleted on request:** Settings → "Remove my photo verification"; and with
  the account.
- **Privacy policy:** a section on photo verification; the Play Store Data
  safety form lists "biometric data (face)".

---

## 11. App screens

| Screen | Where |
|---|---|
| "Verify you're a real person" intro + consent | **Onboarding: right after the photos** ("Let's keep it real" → photos → selfie, with "Do it later"); Profile, Settings > Account, Edit profile photos |
| Camera with the 3 actions, progress, gentle hints | New screen |
| Result: verified / fix this photo / pending | New screen |
| Per-photo marks in Edit profile ("Not you - replace") | Photo grid |
| "You're verified as a real person ✓" | Profile and Settings > Account - the person sees this; others see the face-scan mark on the photos of the expanded profile |
| Settings > Account: "Real-person check" row - status, remove | Account screen |
| Reminders: Google accounts (required, like the college email, during the 14 days); college-email students (optional, gentle) | Follow `REMINDER_SCREENS.md` rules (one pop-up a day) |

New native modules: `react-native-vision-camera` + ML Kit face detection →
**a new dev client build**.

---

## 12. Admin

Review queue (needs the admin panel):

- Each case: the snapshots, the profile photos, the distances, the reason
  (unsure, 3 failures, report).
- **Approve** (verified as a real person) / **Reject** (with a reason the person sees) /
  **Ask for a new selfie**.
- Oldest first.

---

## 13. Build order and status

| Step | What | Status |
|---|---|---|
| 1 | Face service (Python, dlib) in Docker | **Built** - `apps/face-service`, `docker compose up face` |
| 2 | Calibration script | **Built** - `npm run face:calibrate -- --dir=<folder>`; **the volunteer test is still to do** |
| 3 | Data + API: challenges, uploads, submit, status, remove | **Built** |
| 4 | App: intro + consent, camera with the actions, results | **Built** - `RealPersonCheckScreen` |
| 5 | Photo rules, "not you" list, face key checks on every later photo | **Built** |
| 6 | Profile video check after processing | **Built** |
| 7 | Status in Profile and Settings; required for Google accounts within 14 days | **Built**, behind `REAL_PERSON_REQUIRED` |
| 8 | Admin review queue | **Server built** (`/admin/face-reviews`); screens wait for the admin panel |
| 9 | Privacy policy, Data safety form | To do (not code) |
| Later | Amazon Rekognition liveness if needed; face-based ban evasion | Later |

**As built - where it differs from the plan above:**

- **Uploads:** the challenge itself returns the private upload slots (2 frames
  for each of 4 steps); there is no separate upload-urls call.
- **"Blink" is "Close your eyes"** for about two seconds, until the phone
  buzzes - a blink is too quick to photograph reliably without live detection.
- **ML Kit is optional at run time.** With it (after a new dev build) the phone
  retries a missed action at once; without it the selfie still works and the
  server alone decides. The server always re-checks every action from the dlib
  landmarks (eye openness, head angle, mouth width) - the phone is never trusted.
- **Profile video:** a video that isn't them does not get pulled down; it pauses
  the real-person status and is listed in Edit profile until replaced.
- **Photos:** Edit profile lists each photo that isn't them under the grid
  (thumbnail and what to do), rather than marking the tiles.
- **Required for Google accounts:** off until `REAL_PERSON_REQUIRED=true` - turn
  it on once the app build with this screen is out, or nobody could comply.
- **Tests:** `npm run test:face` (face service, face key, photo checks, the
  main-photo rule, a selfie through the private bucket, removal) and the
  Google-account rule in `test:grace-and-limits`.

## 14. Cost

| Part | Cost |
|---|---|
| Google ML Kit (phone) | Free |
| dlib + face service (our server) | Free; a little CPU |
| ffmpeg video frames | Free (already used) |
| Storage | Tiny - face keys are 128 numbers each |
| Later: Amazon liveness | About ₹1.3 per check |

## Sources

- Google ML Kit face detection: https://developers.google.com/ml-kit/vision/face-detection
- dlib face recognition (public-domain model, 99.38% LFW): https://github.com/davisking/dlib-models, http://blog.dlib.net/2017/02/high-quality-face-recognition-with-deep.html
- Human library notes on accuracy: https://github.com/vladmandic/human/discussions/212
- Amazon Rekognition Face Liveness: https://aws.amazon.com/rekognition/face-liveness/
