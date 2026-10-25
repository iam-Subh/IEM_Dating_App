# Feedback: bug reports and ratings

How people tell us something is broken, and how we learn whether they like
the app. Code: `apps/mobile/src/features/feedback/`, `apps/api/src/services/feedback.service.ts`,
admin panel **Bug reports** and **Ratings**.

## Bug reports

### Where they start
- Settings > Safety and help > **Report a problem** (and **My reports**).
- **Shaking the phone** (`ShakeToReport.tsx`). The screen is captured first and attached. On by default; off in Settings > App settings > Help. Never on the selfie check, Stories, the map or the report screens.
- The **"Something went wrong"** screen (`AppErrorBoundary.tsx`) when a screen crashes: "Tell us what happened".
- A **low in-app rating** (1-2): "Report a problem", with the comment carried over.

Reporting a person stays separate (Report someone / the report sheet).

### The form
Area (chips), what happened (10-2,000 characters), up to 5 photos (the
screenshot counts as one) and one screen recording, and "Include technical
details" (on; "See what is sent" shows exactly what goes).

- **Photos:** shrunk on the phone to 1600 px JPEG; over 10 MB is refused when picked.
- **Recording:** 60 s and 50 MB at most, checked when picked. Android has no
  in-app screen recording without a special permission, so the form says to
  use the phone's own screen recorder and add the file.
- **Hide private details** (`RedactModal.tsx`): drag over a screenshot to
  cover someone's photo, name or message; the covered copy replaces it.
- **Technical details** (`diagnostics.ts`): app version, phone, Android
  version, screen, the last 20 errors. Tokens and email addresses are cut out.
  Never messages or passwords.
- The draft is kept if the app closes.

### Sending
1. `POST /feedback/reports` saves the report and returns upload links.
2. The phone uploads each file to the private bucket, then
   `POST /feedback/reports/:id/attachments/:aid/complete`: the server checks
   size and type and runs the nudity check (a flagged image is hidden from
   staff until clicked).
3. **No signal:** the report is kept on the phone (`reportQueue.ts`) and sent
   when the app comes back. The server knows a retry by its `clientId`, so it
   is never sent twice. A file that fails 3 times is skipped and the person
   is told.

### Limits
| What | Limit |
|---|---|
| Reports | 5 an hour, 20 a day per person (429 `FEEDBACK_RATE_LIMITED`) |
| Files | 5 photos (10 MB), 1 recording (50 MB, 60 s) |
| Description | 10-2,000 characters |
| Files kept | until closed or duplicate, at most 90 days; unfinished uploads 1 day |

### After sending
"Thanks, we got it - Reference #B-1001. We read every report. We can't reply
to each one, but if we need more details we'll message you here. You'll get a
notification when it's fixed." Offline: "Saved - we'll send it when you're
back online."

### The team (admin panel > Bug reports)
Open / Fixed / Closed, filter by area. Each status change notifies the person:
- **Looking into it** (I), with an optional note;
- **Fixed** (F), with the version it is fixed in;
- **Duplicate** (D) of another reference - files deleted;
- **Close** (C), with an optional note - files deleted.

## Ratings

### Google Play's card (`engagement.ts`)
Google's rules: no question before it, no reward, never from a button (the
Settings row opens the store page instead), and it may silently not show.
We ask only when **all** hold:
- at least 5 days and 5 sessions since first open;
- a good moment in the last 3 days (a new match);
- on Explore or Matches, 1.5 s after it settles;
- not within 14 days of a setback (bug report, report, block, unmatch);
- at most every 120 days, and 14 days away from our own card.

It can only be tested from a Play test track (internal testing).

### Our own card (`RatingPrompt.tsx`)
"How's IEM Connect so far?" with 5 faces, from day 7, then every 60 days,
never near the Play card or a setback. 1-2: "What went wrong?" and Report a
problem. 3: "What would make it better?". 4-5: "Thank you!" - and nothing
else: happy people are not sent to the store, so the Play rating is never
filtered (review gating). Results: admin panel > Ratings (average, weekly
trend, comments). Settings has "Preview rating card" in development builds.

## Native pieces
`react-native-view-shot` (screenshots) and `expo-store-review` (Play card)
need a rebuilt development client (`npx expo run:android`). Without them the
app still works: no automatic screenshot, no Play card.
