# Google sign-up, and verifying later

**Current behavior (7 October 2026):** Google sign-up starts profile setup. College email verification is outside onboarding. Users open the form and verification code from **Settings → Account → College verification → Verify**. This replaces the earlier instruction to show verification once after Google sign-up.

IEM Connect asks everyone to sign up with their **college email**: it verifies
them at once and gives the verified badge. **Google** is the second way in. A
Google account uses the app like everyone else, and **adds a college email
later** - entering the code sent there - to get verified.

The idea: Google users are never hidden from the app. They are reminded to verify
at the moments they care most, and a few things wait for verification.

**Status (3 Oct 2026):** everything in this plan is built and tested, except
what needs the stores first (section 10). Server and app typecheck; the test
suites are listed in section 10.

**One person, one account.** However someone signs up, and however they sign in
afterwards - Google, college email, after a reinstall - they always land in the
same account. A second account is never created by accident.

---

## 1. Sign-up and signing in

### 1.1 The two ways to sign up

| Order | Option | Password | Result |
|---|---|---|---|
| 1 (main button) | **Continue with college email** | **Required** at sign-up | Verified at sign-up |
| 2 | **Continue with Google** | **Not needed** | Account created; verify later |

Under the Google button: *"You can add your college email later to get the
verified badge."*

**Shortcut:** if the Google address *is* a college address (for example
`name.surname2026@iem.edu.in` on Google Workspace) and Google says it is
verified, the account is verified at once, as long as exactly one college uses
that domain.

**Status:** built - `POST /auth/google`, the Google button, the shortcut, and
Settings > Account showing the Google account.

### 1.2 Sign-in methods on one account

| Signed up with | Can add later (Settings > Account) | Can then sign in with |
|---|---|---|
| **Google** | **Add a password** (optional) | Google - or Gmail + password, if they added one |
| **College email** | **Connect with Google** | College email + password - or Google |
| **Google, then verified their college email** | (password set while verifying, 1.4) | Google - or college email + password - or Gmail + password |

- **Google user adds a password:** Settings > Account > *"You signed up with
  Google. Add a password"*. Afterwards Google still works **without** the
  password - after a reinstall, picking that Google account opens the account
  straight away. The password is only an extra way in.
- **College-email user connects Google:** Settings > Account > *"Connect with
  Google"*. That Google account is now linked. After a reinstall, *Continue with
  Google* with that Google account opens **this** account - it never creates a
  new one.
- **One password per account:** the same password works with every email on the
  account (the Gmail and the college email).

**Edge cases:**

| Situation | What happens |
|---|---|
| Connecting a Google account that is already linked to **another** IEM Connect account | Refused: *"This Google account is already linked to another account."* Never moved silently |
| Disconnecting Google | Allowed only if the account has a password - nobody can lock themselves out |
| "Forgot password" on a Google-only account | *"This account signs in with Google"* and a Google button, instead of a reset email |
| *Continue with Google* with a Gmail address that already has an account (with a password, Google not connected yet) | Ask for that account's password **once**, then connect Google automatically. From then on Google opens it directly |

### 1.3 Onboarding for Google users

Google users fill in **the same details as everyone else**: they are students who
simply haven't given their college email yet.

1. Name, birthday (18+ only, 6.2), gender, photos, video - as everyone.
2. **College** - chosen from the list. Needed because the department list
   depends on the college.
3. **Department** and **graduation year** - from that college's lists.
4. Preferences, as everyone.
5. *"Verify your college"* - **Verify now** / **Later** (reminder 1, section 4).

- **On their card:** the college they chose shows **without the tick**. The tick
  appears only after the college email is verified.
- **Their campus** (chosen in onboarding, from that college's campuses) is who
  they meet before verifying (2.1): "My campus" is their one college choice
  until the college email proves the rest.
- **If they later verify a different college**, the verified college replaces
  what they chose (department and year are asked again if the lists differ).

### 1.4 Verifying the college email

Always the same, and never a claim:

1. Enter the **college email**.
2. Enter the **6-digit code** sent to it - only someone with that inbox can do it.
3. **Set a password** - skipped if they already added one (1.2).

The college email is now linked to the **same account**. They can sign in with
Google, or with the college email and password. The badge appears at once.

**The rare case - the college email already has its own account.**

Example: Rahul signed up with his college email last month, forgot, and today
signed up again with Google. In the new Google account he enters his college
email to verify - but that email already belongs to his old account.

- The code still proves the inbox is his, so the app asks: *"You already have an
  account with this college email. Use that one?"*
- **Yes:** Google is connected to the **old account** and the new, empty Google
  account is deleted. If the new account already has matches or chats, he is
  warned first that they will be lost. From then on Google opens the old account.
- **No:** nothing changes; the new account stays unverified.
- The two accounts are **never merged** - too complicated, and things could go
  wrong. One person keeps one account.

---

## 2. What an unverified Google account can do

### 2.1 Who you see

Four choices in My preferences, named for each person:

| Choice | Verified IEM student (Gurukul) | Unverified Google user (chose Gurukul) |
|---|---|---|
| **My campus · Gurukul** | ✓ | ✓ - the campus chosen in onboarding, with the limits of 2.2 |
| **All IEM campuses** (Gurukul, Ashram, Management House) | ✓ | 🔒 *Verify your college to choose this* |
| **IEM & UEM Newtown** | ✓ | 🔒 *Verify your college to choose this* |
| **People near me** | ✓ | ✓ |

- **Names:** the server sends them - "My campus · Gurukul", "All IEM
  campuses", "IEM & UEM Newtown". UEM Newtown has one campus, so its students
  see "My campus · New Town", "IEM & UEM Newtown" and "People near me".
- **Colleges live today:** IEM (Gurukul, Ashram, Management House - Sector V,
  Salt Lake) and **UEM Newtown** (New Town). UEM's Kolkata college is always
  called UEM Newtown, never confused with UEM Jaipur. **UEM Jaipur is switched
  off** until it launches - in no list, no verification; switched on, Jaipur
  students get their own "both colleges in your city", and Kolkata students
  meet Jaipur only through "show people further away". The New Town campus once
  listed under IEM was UEM's ("IEM Newtown" is a nickname) and is switched off.
- **Before verifying:** only My campus and People near me can be chosen.
  Tapping a locked choice opens the rules screen ("Meet your whole college");
  the server also saves a locked choice as My campus.
- **Who sees them:** verified students reach them by their own choice, as
  anyone else on that campus - "My campus · Gurukul", "All IEM campuses" or
  "IEM & UEM Newtown" all include an unverified person on Gurukul. Never
  students with **Verified profiles only** on.
- **Old settings** moved: My college → All IEM campuses; In my city / Whole
  group → IEM & UEM Newtown; My campus and People nearby stay.

| | Verified student | Google, not verified |
|---|---|---|
| **Who they see** | Any of the four choices | **Their campus**, or People near me |
| **Who sees them** | Everyone whose choice includes them | Everyone whose choice includes their campus, except Verified profiles only |
| **Badge** | ✓ | ✗ |
| Profile, video, Stories, Likes, matches | ✓ | ✓ |

Once verified, all four choices open, and their college comes from the
college email.

### 2.2 What waits for verification

| | Verified | Not verified | Status |
|---|---|---|---|
| **Chat: photos, videos, documents** | ✓ | **Locked** (lock on the attachment button: "Verify to send photos and videos") | Decided |
| **Chat: messages** | Unlimited | **30 messages in total** across all chats; text and **voice notes both count** | Decided |
| **Roses** | 5 a week | **1, once** - a trial (2.5) | Decided |
| **Appear in others' Standouts** | ✓ | ✗ | Decided |
| **Likes per day** | Unlimited | **25**, resetting at midnight IST; a counter at 5 left | Decided |
| **Found in Search by name** | ✓ | ✓ by their college, marked "Not verified"; they search their campus only (2.8) | Decided |
| **Grace period** | — | **14 days**, then their profile pauses until verified (2.6) | Decided |

### 2.3 The chat limit, in detail

- **Counting:** every message they send - text or voice - in any chat counts
  towards 30. Counting across all chats means starting new chats doesn't reset it.
- **What doesn't count:** emoji reactions on messages.
- **Story replies count** (2.7) - otherwise they'd be a way around the limit.
- **Both people unverified:** each has their own 30.
- **From message 25:** a counter in the chat: *"5 messages left - verify to keep
  chatting."*
- **At 30:** the message box becomes *"Verify your college to keep chatting"*,
  opening the verify steps.
- **The other person is never punished:** a verified match can keep sending
  messages and never sees a "blocked" message - at most a quiet grey line,
  *"Waiting for Ankit to verify."*
- **If they don't verify:** only chatting pauses. **Everything else keeps
  working** - Discover, Explore, Likes, matches, Stories, profile - and whenever
  they reach something that waits for verification, the **rules screen** shows
  what is locked and why, with **Verify now** and **Not now**.
- **Verifying unlocks everything at once:** unlimited chat, photos and videos,
  the badge, Roses, Standouts.

### 2.4 The rules screen

One screen, used wherever something is locked: the chat limit, a photo in chat,
a Rose, Standouts, a like while paused.

- The badge, and what verifying unlocks: *unlimited chat, photos and videos,
  Roses, Standouts, the verified badge.*
- What is waiting right now (for example *"You've used your 30 messages"*).
- **Verify now** (main) and **Not now** (closes, back to where they were).

### 2.5 The trial Rose

People want more of something once they've used it: one Rose teaches its worth
better than a locked button, without making Roses common.

1. **One Rose, once** - *"Your first Rose is on us 🌹."* It never refills.
2. **The moment they send it:** a sheet - *"Nice choice. Verified students get 5
   Roses every week. Verify your college to get yours."* - **Verify now** / **Not
   now**.
3. **Tapping Rose with none left:** the rules screen (2.4).
4. **On verifying:** *"You're verified ✓ - here are 5 Roses"* (plus the +3
   new-user welcome in their first week, STANDOUTS_PLAN.md 4.2).
5. **For the person receiving it:** a Rose from an unverified account shows
   without the badge, and below Roses from verified students in Likes You.

### 2.6 The grace period

- **14 days** from sign-up to verify.
- **Warnings** on days 10, 12 and 13: in the app and by push.
- **After 14 days the profile pauses:** hidden from other people's decks,
  Explore and Likes You.
- **While paused they can:** sign in, browse Discover and Explore, see their
  matches, chat within their limit, use Stories and settings.
- **While paused they can't like or send a Rose:** tapping like opens the rules
  screen - *"Your profile is paused. Verify your college to start liking again."*
  (Otherwise their likes would reach people who can't see them.)
- **Verifying unpauses them at once.**

### 2.7 The rest of the app

| Feature | Unverified Google account | Why |
|---|---|---|
| Discover, Explore | ✓ Their campus (or People near me), with 25 likes a day | A chosen campus proves nothing beyond itself |
| Likes You | ✓ They see who liked them | A strong reason to stay and verify |
| Rewind | ✓ | Harmless |
| **Story replies** | Count towards the 30 chat messages | Otherwise a way around the chat limit |
| **Story mention stickers** | Only people they're matched with | Mentioning strangers is a harassment risk |
| Posting Stories | ✓ To followers and matches, as for everyone | Same privacy rules |
| **Follow requests** | ✓ At most **10 a day** | Stops mass-following from an unchecked account |
| Map (the people-nearby glow) | ✓ They can view it; **they aren't counted in it** | The glow reflects verified students |
| Activity status, notifications, settings, profile video | ✓ | Normal app features |
| Reports and blocks | ✓ Same as everyone; **reports against unverified accounts go to the front of the admin queue** | Safety |

### 2.8 Search (built)

| Who searches → who is found | Rule |
|---|---|
| Verified → verified | Same college |
| Verified → unverified | Unverified accounts that chose the same college, listed after verified students, "Not verified" and no tick |
| Unverified → anyone | **Their own campus only**, as in Discover |
| Unverified → verified | Only students who turned on **"Unverified accounts can find me"** (Settings, off by default) |

- Before verifying: at most **30 different people a day** in results (people,
  not searches - the app searches as you type); then the rules screen.
- Paused accounts are never found; blocks and "Discoverable in search" work
  for everyone.
- "Unverified accounts can find me" shows only for verified students, and only
  while "Discoverable in search" is on.

---

## 3. What verified students see

| Situation | What the verified student sees or gets |
|---|---|
| **An unverified card in their deck** | No badge; the college shows without a tick; tapping the badge spot shows *"Hasn't verified their college yet."* No "unverified" label - the missing badge says enough |
| **Who you see includes their campus** | Unverified accounts on that campus can appear - by My campus, All IEM campuses or IEM & UEM Newtown alike |
| **Order in their deck** | Unverified people come after verified people with a similar score - shown, never hidden |
| **Verified profiles only** | Already in My preferences, off by default. The first time an unverified card appears, a one-time tip mentions it |
| **Likes You** | Likes and Roses from unverified accounts appear below verified ones, without a badge |
| **Standouts** | Unverified accounts never appear in their Standouts |
| **Search** | Unverified accounts of their college appear after verified students, "Not verified". They decide whether unverified accounts can find *them* ("Unverified accounts can find me", off by default) |
| **Chatting with an unverified match** | The verified student can send anything - photos, videos; only the unverified side is limited. When the other person reaches 30 messages they see a quiet grey line, *"Waiting for Ankit to verify"* - never "blocked" |
| **The other person pauses after 14 days** | The chat stays; the paused person leaves discovery. If they verify, everything carries on |
| **Safety** | Block and report as always; reports on unverified accounts are reviewed first |

---

## 4. Where they are reminded to verify

| # | When | Where | What they see | Type |
|---|---|---|---|---|
| 1 | Right after Google sign-up | Onboarding | "Verify your college": **Verify now** / **Later** | Full screen, once |
| 2 | Finishing their profile | Last onboarding step | Their own card with and without the badge: "Verified profiles get more likes" | Full screen, once |
| 3 | While swiping | Discover deck | After about 20 swipes, a card: "Verify your college to get the badge" | In-deck card, at most once a day |
| 4 | They get a match | Match screen | "Rohan is verified ✓. Verify so they know you're real too" (only if the match is verified) | One line |
| 5 | Opening a chat | Top of the chat | "Get verified: matches reply more to verified profiles" | Thin banner, dismissable per chat |
| 6 | Tapping Rose | Rose button | The rules screen (2.4) | Sheet |
| 7 | Opening Standouts | Standouts | "Verify to appear in Standouts and get 5 Roses a week" | Header card |
| 8 | Opening Likes You | Likes You | "Verified profiles show up first in people's Likes" | Header card |
| 9 | Using Search | Search | "You're searching your campus. Verify to search all your college campuses." | Header card |
| 10 | Posting a Story | Story share screen | "Your Stories show the verified badge once you verify" | One line |
| 11 | Their own profile | Profile tab | A grey badge spot: **"Get verified ✓"** | Always there |
| 12 | Settings | Settings > Account | "Get verified" row | Always there |
| 13 | Not opening the app | Push | Day 1, day 3, day 7 reminders | Push, 3 in total |

**Lock moments** - they tried something that is limited (2.2-2.7):

| # | When | Where | What they see | Type |
|---|---|---|---|---|
| 14 | 5 likes left today | Discover deck | A small counter: *"5 likes left today"* | Counter |
| 15 | Out of likes (25 used) | Discover, Explore | Rules screen: *"You've used today's likes. Verify for unlimited likes."* | Rules screen |
| 16 | 25 messages sent | Chat | *"5 messages left - verify to keep chatting"* | Counter |
| 17 | 30 messages sent | Chat message box | *"Verify your college to keep chatting"* | Message box |
| 18 | Tapping the attachment button | Chat | Rules screen: *"Verify to send photos and videos"* | Rules screen |
| 19 | Days 10, 12, 13 | In the app and by push | *"Your profile pauses in 4 / 2 / 1 days. Verify to stay visible."* | Sheet + push |
| 20 | After day 14, tapping like or Rose | Discover, Explore | Rules screen: *"Your profile is paused. Verify your college to start liking again."* | Rules screen |
| 21 | 10 follow requests today | Follow button | Rules screen: *"You can send more tomorrow, or verify for no limit"* | Rules screen |
| 22 | Mentioning someone they haven't matched with | Story editor | *"Verify to mention people you haven't matched with"* | One line |

**More nudges:**

| # | When | Where | What they see | Type |
|---|---|---|---|---|
| 23 | Looking at their own card | Profile preview ("See how others see you") | Their card without the badge, and *"Verified profiles get more likes. Verify now"* | One line |
| 24 | Editing their college | Edit profile > College | The college without a tick, and a **Verify** button next to it | Always there |
| 25 | Opening Matches / the chat list | Header | *"Unlock photos and unlimited chat - verify your college"* | Header card, at most once a week, dismissable |
| 26 | Opening the map | Map | *"You're not shown on the map yet - verify to appear"* | One line |
| 27 | A verified student likes them | Notification, then Likes You | *"A verified student liked you."* Opening it: *"Verify so they see your badge"* | Notification + one line |

Not added: an Explore header (the deck card, 3, covers browsing) and a
Notifications screen banner (too many banners).

**Not spammy:**

- **Two kinds of reminder:**
  - **Lock moments (6, 14–22)** always show and **don't count** towards the daily
    limit - they answer something the person just tried; without them the
    button would just feel broken.
  - **Nudges (3, 5, 7–10, 23, 25–27)** are ours to choose, and stay within the
    limit below.
- At most **one pop-up reminder a day** (the deck card, or a sheet).
- In-context reminders (4, 5, 7–10, 23, 25–27) appear only at those moments and
  can be dismissed.
- Always-there spots (11, 12, 24) never pop up.
- Pushes: 3 in total, never after day 7; they follow App settings ("Pause all"
  stops them).
- **Everything stops the moment they verify**, with a "You're verified ✓" moment
  as the badge appears on their card.

---

## 5. When verification expires

A verification lasts **365 days** (`student_memberships.expires_at`).

- **Reminders:** 30, 7 and 1 day before - in the app and by push: *"Your college
  verification ends soon. Re-verify to keep your badge."*
- **When it expires:**
  - The **badge goes**, and a *"Re-verify your college"* prompt appears (profile,
    Settings > Account).
  - They are **not** treated as a new Google user: **no** 30-message limit,
    **no** 14-day pause, **no** likes limit. They were checked once already.
  - Until they re-verify, they reach other people the way an unverified account
    does (2.1): their campus, and not people with Verified profiles only.
- **Re-verifying:** the same steps (college email, code) - the badge returns at
  once.
- **Graduates who no longer have their college email:** they keep their account,
  without the badge. (Later, perhaps, an "Alumni" label.)

---

## 6. Safety

### 6.1 Stopping banned people from coming back

Gmail accounts are free, so a banned person could otherwise sign up again in a
minute. Industry practice, strongest first:

| # | Method | What it does | When |
|---|---|---|---|
| 1 | **Block the identity** | A banned person's Google account (`google_sub`), every email on the account, and their **college email** are blocked forever, stored as keyed hashes. The college email is the strongest: each student has one, so a banned student can **never get the badge again** | Built |
| 2 | **Android: Play Integrity "device recall"** | Google's own tool: 3 bits stored against the device by Google, kept through **reinstall and even factory reset**, with no device or user ID shared - privacy-safe. In beta; only for Play Store installs | With the Play Store release |
| 3 | **Android ID** | Saved with each account; at most **2 Google sign-ups per phone**, and a banned phone can't sign up. Survives a reinstall, not a factory reset. Needs the `expo-application` module in the build (rebuild the dev client) | Built |
| 4 | **iOS: Apple DeviceCheck** | Apple's equivalent: 2 bits per device, kept through reinstall and "Erase all content" | With the iOS app |
| 5 | Photo matching | New profile photos compared against banned users' photos (perceptual hashes, as Tinder and Hinge do) | Later |
| 6 | Selfie check | A short video selfie, as Tinder and Bumble now use | Later |

**How the 3 device-recall bits are used:**

- **Bit 1 - banned:** this device can't create any new account. The message
  gives an appeal email (phones get resold).
- **Bits 2-3 - Google sign-ups on this device:** counted 0-3; **at most 2**.
  College-email sign-ups aren't counted - they're verified anyway.

Sources: [Play Integrity device recall](https://developer.android.com/google/play/integrity/device-recall),
[Apple DeviceCheck](https://developer.apple.com/videos/play/wwdc2021/10244/).

### 6.2 Age

Google doesn't tell us anyone's age, so the app checks it - for **everyone**,
college sign-ups too (some first-years are 17):

- **Birthday is required; under 18 is refused** at sign-up (discovery already
  leaves out anyone under 18).
- **The birthday can be changed once** after onboarding (as Hinge does), in
  Edit profile, with a warning first: *"You can change your birthday only once.
  Make sure it's right."* The new date must still be 18+.
- **After that one change, it's locked.** A further change goes through support,
  with a **photo of an ID** (Aadhaar, PAN, college ID, passport). The ID photo is
  deleted once the change is decided.
- Without this, someone could just keep typing a different date.
- **"Under 18"** is a report reason, reviewed first. Confirmed: banned, and the
  device flagged (6.1).

### 6.3 Outsiders

Anyone with a Gmail can sign up, students or not. Together these keep them in
check without blocking Gmail:

- No badge; the chosen college has no tick.
- They meet only the campus they chose, and never people with Verified
  profiles only.
- 30 messages, no media, 25 likes a day.
- Paused after 14 days unless they prove a college inbox.
- Reports against them reviewed first.

---

## 7. Server

### 7.1 Data

| Field | Purpose |
|---|---|
| `users.google_sub` (unique), `google_email`, `google_linked_at` | The linked Google account |
| `users.password_hash` empty for Google-only accounts | Whether the account has a password (1.2) |
| `users.claimed_institution_id`, `verify_later_at` | The college an unverified account chose; "Later" on Verify your college (1.3) |
| `users.paused_at`, `grace_warning_level`, `verify_push_level`, `expiry_reminder_level` | The pause and the reminders sent so far (2.6, 4, 5) |
| `users.birthday_changed_at`, `birthday_change_requests` | The one birthday change; later ones through support with an ID photo (6.2) |
| `users.signup_android_id`, `banned_identifiers` | The sign-up phone; a banned person's identities as keyed hashes (6.1) |
| `users.search_by_unverified` | "Unverified accounts can find me" (2.8), off by default |
| `institutions.short_name` | "IEM", "UEM Newtown", "UEM Jaipur" in Who you see and Search |
| Messages sent while unverified | Counted from `messages` - no new column |

All built; every change is an additive migration (`20261003100000` to
`20261003500000`).

### 7.2 Signing in and linking

| Endpoint | What it does |
|---|---|
| `POST /auth/google` | Signs in by `google_sub`; a Gmail that already has an account with a password answers `GOOGLE_NEEDS_PASSWORD` |
| `POST /auth/google/link-with-password` | Password once, then Google connected and signed in |
| `POST /auth/login` | Email + password, the email being the main one **or** the verified college email |
| `POST /auth/account/password` | Add a password (Google accounts) |
| `POST /auth/account/google`, `DELETE /auth/account/google` | Connect / disconnect Google (disconnect only with a password) |
| `POST /auth/recovery/start` | For a Google-only account: `USE_GOOGLE_SIGN_IN` instead of a reset email |
| `POST /verification/student/verify` | Gains the **password**; a college email with its own account answers `COLLEGE_EMAIL_HAS_ACCOUNT` with a switch token |
| `POST /verification/switch-account` | "Use that one?": Google moves to the old account, the new one is deleted |
| `POST /verification/student/later`, `GET /verification/status` | "Later" on Verify your college; everything the app shows about verifying |

Sign-ups (college email and Google) and college verification check
`banned_identifiers`; Google sign-ups check the two-per-phone limit.

### 7.3 Discovery for unverified accounts

Rule 5 in `eligibility.service.ts` - `eligibleSql` and `mutuallyEligible`
change together, and `npm run test:location` checks they agree on every pair:

- An **unverified party** is the college they chose (or were once verified
  at) and the campus they chose. Their own reach is **their campus** (their
  college if they chose none), whatever is saved; distance mode works as for
  everyone.
- A verified person reaches them by their own scope, as anyone else on that
  campus or college. **Verified profiles only** means a valid verification,
  both ways (it used to read a flag nothing ever set).
- Paused accounts are left out of everyone's decks, Explore and Likes You.
- Expired verifications follow the same rule as unverified ones.

### 7.4 Limits

- **Chat:** the send endpoint and the socket refuse media from unverified
  senders, and refuse a 31st message with `VERIFY_TO_CHAT`. Reactions are not
  counted; story replies are.
- **Roses:** one trial Rose for an unverified account (`ROSE_VERIFY_REQUIRED`
  after it); 5 a week from verification, with the welcome Roses.
- **Likes:** 25 a day for unverified accounts (`LIKE_LIMIT_UNVERIFIED`);
  none while paused (`PROFILE_PAUSED`).
- **Follow requests:** 10 a day for unverified accounts.
- **Story mentions:** only people they're matched with.
- **Standouts and the map:** unverified accounts are never picked or counted.
- **Search:** per 2.8; before verifying, 30 different people a day
  (`SEARCH_LIMIT_UNVERIFIED`).
- **Ordering:** unverified people after verified at a similar score - in decks,
  and in Likes You.
- **Grace period:** an hourly job pauses unverified profiles after 14 days (with
  the warnings on days 10, 12 and 13); verifying unpauses at once.
- **Expiry:** the same job sends the 30 / 7 / 1-day reminders; expired
  memberships lose the badge, without the new-user limits (5).
- **Admin:** reports against unverified accounts and "Under 18" reports sort
  first in the review queue.
- Every refusal has a clear code the app turns into the rules screen.

### 7.5 Standouts (`features/discovery/STANDOUTS_PLAN.md`)

- Only verified people can be picked; unverified accounts never appear in
  anyone's Standouts.
- Unverified viewers get a set from verified people **on their campus** (or
  near them, with People near me), as in Discover - every card is someone they
  can Like or Rose. Their one trial Rose works here; Likes count towards 25.
- **Fewer than 8 picks before verifying** (small campuses): instead of an
  empty or thin page, a card - *"More Standouts after you verify. Right now
  you see people from Gurukul. Verify your college to get Standouts from all
  IEM campuses, and 5 Roses a week."* - **Verify now** (built).
- After verifying, their own set widens **from the next day** (today's set is
  fixed for the day); they appear in others' Standouts from the next night run.
- Fairness limits group viewers with no college as `group:<category>`.

---

## 8. App

All built:

- Sign-up with Google; Settings > Account: add a password, connect /
  disconnect Google, "Get verified", "Re-verify your college".
- Sign-in: "enter your password once to connect Google"; "This account signs in
  with Google" on Forgot password.
- Onboarding for Google users: college, department, year, campus (1.3); Verify
  now / Later; the welcome sheet.
- Verification: the password step; the "Use that one?" switch (1.4).
- Who you see: four choices, named for each person, locks before verifying
  (2.1); the same in the onboarding preferences form.
- The rules screen (2.4); the chat limit (2.3): counter, locked attachments,
  "Verify to keep chatting", the partner's grey line.
- The 27 reminders (section 4).
- The trial Rose and its sheet; the likes counter; the grace warnings; the
  paused state (2.6).
- Search (2.8): "Not verified" in results, the campus note, the daily limit,
  "Unverified accounts can find me" in Settings.
- For verified students: the badge-spot note, the one-time "Verified profiles
  only" tip, the grey "Waiting to verify" line.
- Birthday: one change in Edit profile (with the warning), then support with an
  ID photo; "Under 18" in the report reasons.
- The Android ID with sign-up (once the dev client is rebuilt).

---

## 9. Google Cloud and launch setup

1. OAuth consent screen (app name, support email, logo, privacy policy URL);
   **move it from Testing to Production** before launch - in Testing only listed
   test users can sign in.
2. Client IDs:
   - **Android** - package `com.iemconnect.app` with the debug keystore SHA-1
     (`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`). **Done.**
     Before launch: add the **Play App Signing SHA-1** - without it Google
     sign-in fails on Play Store installs.
   - **Web** - used by the server to check tokens. **Done** (`GOOGLE_CLIENT_IDS`,
     `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`). **Reset its client secret** - it was
     shared in chat.
   - **iOS** - the bundle ID; then the Google config plugin goes back into
     `app.json` with `iosUrlScheme`.
3. **Play Integrity API** enabled in the Play Console (device recall, 6.1).
4. Play Store Data safety form and privacy policy: mention Google sign-in and the
   device signals.
5. Record which reminder led to each verification, to tune section 4 later.

---

## 10. Build order

| Step | What | Status |
|---|---|---|
| 1 | Server: Google sign-in, token checks, account creation, the college-address shortcut | Built |
| 2 | App: Google button, native sign-in (rebuilt), Settings > Account | Built |
| 3 | Onboarding for Google users: college, department, year; Verify now / Later (1.3) | Built |
| 4 | Server: discovery for unverified accounts (2.1, 7.3), with tests | Built |
| 5 | Sign-in methods: add a password, connect / disconnect Google, password-once linking, login by college email, Forgot password for Google accounts (1.2) | Built |
| 6 | Verification: password step, "Use that one?" switch (1.4) | Built |
| 7 | Chat limit and media lock, the rules screen (2.3, 2.4) | Built |
| 8 | The badge preview and the 27 reminders (section 4) | Built |
| 9 | The trial Rose, 25 likes a day, follow and mention limits, Standouts / Search / map exclusions, ordering | Built |
| 10 | Grace period: hourly pause job, warnings, paused state, unpause on verifying | Built |
| 11 | Expiry: reminders, badge removal, re-verify (5) | Built |
| 12 | Safety: banned identifiers, Android ID, one birthday change then ID through support, "Under 18" reports, admin queue order (6) | Built - device recall waits for the Play Store (below) |
| 13 | Who you see: four named choices, campus-only before verifying, UEM Newtown name, UEM Jaipur and IEM's "New Town" switched off (2.1) | Built |
| 14 | Search with unverified accounts: "Not verified", campus-only, 30 people a day, "Unverified accounts can find me" (2.8) | Built |

**To do on your side:** rebuild the dev client (adds `expo-application` for the
Android ID); restart the API with `npx prisma generate` while it is stopped.

**Not built yet - needs the store first:**

- **Play Integrity device recall** (6.1): needs the app on the Play Store, the
  Play Console linked to the Google Cloud project, and a native module. Until
  then the Android ID does the same job, except after a factory reset.
- **iOS DeviceCheck**, with the iOS app.
- **Photo matching and the selfie check** (6.1, "Later").
- **An admin panel**: the admin endpoints exist (reports by priority, bans,
  birthday requests with the ID photo, unconfirmed campuses) but have no
  screens yet.

**Where it lives:**

| Part | Files |
|---|---|
| Who sees whom | `api/src/services/eligibility.service.ts` (rule 5: unverified parties) |
| Limits, status | `api/src/services/verification-limits.service.ts`, `GET /verification/status` |
| Reminders, grace, expiry | `api/src/services/verification-reminders.worker.ts` (hourly) |
| Sign-in methods | `api/src/services/google-auth.service.ts`, `auth.service.ts` |
| Account switch | `api/src/services/student-membership.service.ts` (`switchAccount`) |
| Bans, devices | `api/src/services/identity-ban.service.ts` |
| Birthday requests | `api/src/services/birthday-change.service.ts` |
| Rules screen, reminders (app) | `mobile/src/features/verification/` |
| Who you see | `api/src/services/preferences.service.ts` (`areaOptions`), `mobile/src/features/discovery/screens/PreferencesScreen.tsx` |
| Search | `api/src/services/search-people.service.ts` |
| Tests | `test:unverified-onboarding`, `test:sign-in-methods`, `test:verification-limits`, `test:grace-and-limits`, `test:safety-identity`, `test:search-unverified`, and unverified pairs in `test:location` - none of them wipes the database |

---

## 11. Decided

- College email is the recommended sign-up; Google is second.
- Google sign-up needs no password; college-email sign-up needs one.
- One person, one account: Google users can add a password; college-email users
  can connect Google; every way in opens the same account, also after a
  reinstall.
- Verification is always the college email and its code, then a password -
  never a claim. If that college email already has an account, the person is
  offered to switch to it; accounts are never merged.
- Google users fill in college, department and year like everyone; the college
  shows without a tick until verified.
- Who you see: My campus · (campus), All (college) campuses, IEM & UEM Newtown,
  People near me. Before verifying: My campus or People near me only; verified
  students reach unverified people by their own choice, never with Verified
  profiles only.
- UEM's Kolkata college is UEM Newtown; UEM Jaipur is off until it launches;
  IEM's campuses are Gurukul, Ashram and Management House.
- Chat for unverified accounts: photos, videos and documents locked; 30 messages
  in total; voice notes and story replies count, reactions don't; each
  unverified person has their own 30; the other person is never punished.
- At the chat limit, only chat pauses - the rest of the app keeps working, with
  the rules screen wherever something is locked.
- Standouts never shows unverified people.
- Search: unverified people are found by their college, marked "Not verified";
  they search their own campus only, 30 different people a day; verified
  students choose whether unverified accounts can find them (off by default).
- The 27 reminders: lock moments always show; nudges at most one pop-up a day;
  all stopping once verified.
- **Roses:** one trial Rose, once; 5 a week after verifying.
- **Likes:** 25 a day until verified.
- **Grace period:** 14 days, warnings on days 10, 12 and 13, then the profile
  pauses; paused accounts can browse but not like; verifying unpauses.
- **Expiry:** after 365 days the badge goes until they re-verify; no new-user
  limits.
- **Safety:** banned identities blocked forever (college email strongest);
  device recall on Android (banned bit, at most 2 Google sign-ups per device);
  DeviceCheck on iOS later; 18+ for everyone; the birthday can be changed once,
  then only through support with an ID.
- The rest of the app per 2.7, and verified students' view per section 3.
- **Real-person check (selfie)** - planned in
  `features/verification/PHOTO_VERIFICATION_PLAN.md`: **required for Google
  accounts** within their 14 days, optional for college-email students; it shows
  only *"You're verified as a real person ✓"* to the person - **no badge**. The
  **blue tick stays the college email only.**
# Current onboarding behavior (7 October 2026)

Google sign-up starts profile setup. Do not show college email verification during onboarding. Users open the college email form and verification code from **Settings → Account → College verification → Verify**. This rule replaces the earlier instruction to show verification once after Google sign-up.
