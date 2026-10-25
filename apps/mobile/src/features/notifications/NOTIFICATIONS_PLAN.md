# Notifications plan - IEM Connect

Status: **phases 1-8 built** (2026-10-04) - see section 16. Phase 9 (campus moments) is later.

Contents
1. What we need from you (credentials)
2. How a notification travels (the whole path)
3. Every notification we send (the full list)
4. The "spicy" ones - making people open the app
5. Rules that stop us being annoying
6. Settings - what the user controls, and how it is respected
7. How it looks in the Android status bar
8. Action buttons (Reply, Accept, Say hi...)
9. Inside the app (banners, bell, badge)
10. Every case: app open, in background, killed, phone restarted, logged out...
11. Phone makers that kill apps (Xiaomi, Vivo, Oppo, Realme, Samsung)
12. Asking for permission
13. Measuring what works
14. Build order
15. Tests

---

## 1. What we need from you

Android push **cannot work today**: Android delivers every push through Google's Firebase Cloud
Messaging (FCM), and the app has no Firebase file yet.

| # | What | Where you get it | Where it goes |
|---|---|---|---|
| C1 | **Firebase project** with an Android app, package **`com.iemconnect.app`** | console.firebase.google.com > Add project > Add app > Android | - |
| C2 | **`google-services.json`** | Firebase > Project settings > Your apps > download | `apps/mobile/google-services.json` + `"googleServicesFile"` in app.json (I add this) |
| C3 | **FCM V1 service account key** (a `.json` file) | Firebase > Project settings > Service accounts > Generate new private key | Uploaded to Expo: `eas credentials` > Android > FCM V1. **Never in git, never in chat** - upload it yourself, or put it in a local file and tell me the path |
| C4 | **Expo access token** with "Enhanced push security" on | expo.dev > Account > Access tokens; project > Credentials > turn on enhanced security | `EXPO_ACCESS_TOKEN` in `apps/api/.env` (the code already reads it) |
| C5 | Later, for iPhone: **APNs key (.p8)** | Apple developer account | `eas credentials` > iOS |

After C2 the **dev client must be rebuilt once** (Firebase is native code).

We keep the **Expo push service** (it is already wired in `push.service.ts`, it talks to FCM for us,
and it is free). Section 7 notes the one thing it cannot do, and what we do about it later.

---

## 2. How a notification travels

```
Something happens (a message, a match, a like, a timer)
  -> API writes an outbox event                     (already built: outbox.service)
  -> outbox worker picks it up                      (already built: outbox.worker)
  -> saves a row in "notifications"                 (already built - the bell list)
  -> PushService.send(user, message, category)      (already built)
       checks the user's settings, pause, quiet hours, daily caps   (caps + quiet hours: NEW)
       picks the Android channel                    (NEW: one channel per type, section 7)
  -> Expo push service -> Google FCM -> the phone
  -> Android shows it, even if the app is closed or the phone just restarted
  -> the user taps it, or taps a button
  -> the app opens on the right screen (deep link in data.url)
  -> the app reports "opened" to the API            (NEW: section 13)
```

Timed notifications (reminders, "Standouts are ready", nudges) come from **hourly/daily workers on
the server**, like `verification-reminders.worker.ts` already does. **The phone never runs anything
in the background to make a notification**: no background service, no polling. That saves the
battery, and the Play Store prefers it.

---

## 3. Every notification we send

**P** = priority. *High* rings at once, even in Doze. *Normal* may wait a few minutes.
**Setting** = the switch in App settings that turns it off.

### 3a. Chat (the most important)

| # | When | Title / text (example) | Tap opens | Buttons | P | Setting |
|---|---|---|---|---|---|---|
| N1 | New message | **Riya** · "haha same, canteen at 2?" (preview off: "New message") | That chat | Reply · Mark as read | High | messages |
| N2 | More messages in the same chat | One notification per chat that grows: "3 new messages" | That chat | Reply · Mark as read | High | messages |
| N3 | Reaction to your message | Riya reacted ❤️ to "see you there" | That chat | - | Normal | reactions |
| N4 | Photo/voice note | Riya sent a photo 📷 | That chat | Reply | High | messages |
| N5 | Message expiring soon (disappearing chats) | "Riya's message disappears in 1 hour" | That chat | - | Normal | messages |

Never sent: a chat you have muted, the chat you are looking at right now, or a blocked person.

### 3b. Matches, likes, Roses

| # | When | Example | Tap opens | Buttons | P | Setting |
|---|---|---|---|---|---|---|
| N6 | New match | "It's a match! 🎉 You and Riya liked each other" | Match screen | Say hi | High | matches |
| N7 | Someone liked you | "Someone from Gurukul just liked you 👀" - **never who** | Likes You | See who | Normal | likes |
| N8 | Likes stacked up | "5 people like you. Go see 🔥" (instead of 5 separate ones) | Likes You | - | Normal | likes |
| N9 | Rose received | "You got a Rose 🌹 Someone really wants to meet you" | Likes You | See | High | roses |
| N10 | Match about to expire unanswered | "Riya is still waiting for your first message ⏳" (once, day 3) | That chat | Say hi | Normal | matches |

### 3c. Stories and follows (already built - only the look changes)

| # | When | Example | Tap opens | Buttons | Setting |
|---|---|---|---|---|---|
| N11 | Follow request | "Arjun wants to follow you" | Requests | Accept · Decline | follow_requests |
| N12 | Request accepted | "Arjun accepted your request" | Their profile | - | follow_requests |
| N13 | Mentioned in a Story | "Arjun mentioned you in their Story" | The Story | View | story_mentions |
| N14 | Question/Add Yours reply | "3 people answered your question" | Story activity | - | story_activity |
| N15 | Countdown ended | "'Fest night' countdown is over 🎆" | The Story | - | story_countdowns |
| N16 | Story failed | "Couldn't post your story" | Story editor | Try again | story_problems |

### 3d. Verification and account (mostly already built)

| # | When | Example | Setting |
|---|---|---|---|
| N17 | The 27 verification reminders | See `REMINDER_SCREENS.md` (already built) | verify_reminders |
| N18 | Real-person status paused (a changed photo isn't you) | "One of your photos needs a look" | verify_reminders |
| N19 | Real-person check done after team review | "You're verified as a real person ✓" | verify_reminders |
| N20 | New sign-in on another phone | "New sign-in on a Vivo phone. Not you? Tap to secure your account" | account_security (**cannot be turned off**) |
| N21 | Password/email changed, deletion scheduled, data export ready | as today | account_security (cannot be turned off) |
| N22 | Report outcome | "Thanks - we acted on your report" | account_security |

### 3e. Comeback and "spicy" (all NEW - section 4)

| # | When | Setting |
|---|---|---|
| N23 | Today's Standouts are ready | **picks** (new switch) |
| N24 | New people joined from your campus | picks |
| N25 | Not opened the app for 3 / 7 / 14 days | **nudges** (new switch) |
| N26 | Profile tips ("add a video, get 2x more likes") | nudges |
| N27 | Campus moments (fest week, exam over, Valentine's week, weekend) | nudges |
| N28 | Updates from Team IEM Connect (new feature) | team_updates (already exists) |

Two **new switches** in App settings > Notifications, under a new group **"From IEM Connect"**:
- **Daily picks** - Standouts and new people. On by default.
- **Tips and nudges** - comebacks, profile tips, campus moments. On by default.

---

## 4. The "spicy" ones

Like Swiggy and Blinkit: short, playful, a little curious, and written **for Kolkata college
students**. But with one hard rule:

> **Never lie.** "Someone liked you" is sent only if someone did. "3 people from Gurukul are online"
> only if they are. A fake notification gets the app reported, and breaks Play Store rules. It also
> makes people stop trusting every notification after it.

### How a good one is written
- **Curiosity, not the answer**: "Someone just liked you 👀" - the name is in the app.
- **Close to them**: their campus, their department, their year. "Someone from CSE..."
- **Time of day**: chai break, after class, Sunday night.
- **One emoji**, at most two. Title under 40 characters, text under 80 (Android cuts the rest).
- **A light Hinglish/Bangla touch now and then** - not every time.

### The lines (each has 4-6 versions; the server picks one at random and we keep the winners)

**Likes (N7/N8)**
- "Someone from {campus} just liked you 👀"
- "Psst... someone's got a crush on you 🤫"
- "{count} people like you. That's not nothing 🔥"
- "Your profile's doing numbers today 📈"

**Rose (N9)**
- "A Rose 🌹 for you. Someone *really* wants to meet you"
- "Okay, someone went all out - you got a Rose 🌹"

**Match (N6)**
- "It's a match! 🎉 Don't let Riya wait"
- "You and Riya. It's happening 💘 Say hi first?"

**Waiting match (N10)**
- "Riya's waiting... say something, anything 😅"
- "A 'hi' takes 2 seconds. Riya's still here ⏳"

**Standouts (N23) - at the user's usual time**
- "Your Standouts just dropped 🔥 Fresh faces from {campus}"
- "Chai break? ☕ 8 new picks are waiting"
- "Monday blues? Today's Standouts might fix that 😌"

**New people (N24)**
- "{count} new people from {campus} joined this week 👋"
- "New faces in {department}. Just saying 👀"

**Comeback (N25)** - only true things
- day 3: "You have {count} likes you haven't seen 👀" (sent only if count > 0; otherwise the next line)
- day 3: "{count} new people joined since you left"
- day 7: "Your matches miss you. Well, probably 😄"
- day 14: "We kept your spot. {count} people liked you while you were away"
- after day 14: **stop**. Nothing more, ever, until they open the app again.

**Profile tips (N26)** - one per week at most (no made-up numbers: we only claim what we can show)
- "Add a video to your profile 🎥 - A few seconds of you says more than any bio."
- "Add a couple more photos 📸 - Fuller profiles get more right swipes."
- "Your bio is empty ✍️ - One line is enough. Give people something to reply to."

**Campus moments (N27)** - planned by us in an admin calendar
- Fest week: "Fest week 🎶 Who are you going with?"
- After exams: "Exams over 🎉 You've earned some fun"
- Valentine's week: "Rose Day 🌹 Your free Rose is here"
- Friday evening: "Weekend plans? Someone nearby is free 😉" (only if true for "nearby")

**Never spicy**: messages from people, account and security, verification, reports. These stay plain.

### Rich notifications
- N9 (Rose) and N23 (Standouts): a **big picture** - a **blurred** photo of a pick, never a clear
  face of someone who didn't agree to it. Needs checking on Expo SDK 57 (`richContent.image`); if
  it doesn't work there, comes with the native step in section 7.
- N1 (message): the sender's **round photo** in the notification.

---

## 5. Rules that stop us being annoying

| Rule | Value |
|---|---|
| **Quiet hours** (IST) | 11:30 pm - 8:30 am: nothing but messages, matches and account security. Everything else waits until 8:30 am |
| **Daily cap** for N23-N27 (spicy) | **2 a day** at most, and never 2 within 4 hours |
| **Weekly cap** for N25-N27 | 4 a week |
| Likes (N7/N8) | at most 1 an hour; after that they stack into one "5 people like you" |
| Roses | 3 a day (already built) |
| **Back-off** | Ignored 5 spicy notifications in a row -> send spicy ones half as often. Ignored 10 -> stop spicy ones for 2 weeks |
| **Best time** | Spicy ones go at the hour this person usually opens the app (from the last 14 days); default 7:30 pm |
| Expiry (TTL) | "Online now"/"nearby" ones expire after 30 minutes; Standouts after 6 hours; messages after 4 weeks. An old notification that arrives late is worse than none |
| Same thing twice | Never. Each has a dedupe key (already built: `deliveryKey`) |
| Paused / deleting / banned accounts | No spicy or comeback notifications at all |
| Under review for age (the "Under 18" report) | Nothing but account notices |

---

## 6. Settings - what the user controls

### Already built
- App settings > Notifications: one switch per type (section 3's "Setting" column), and
  **Pause all** (account security still comes).
- "Show name and message" (off = "New message" on the lock screen).
- Banners while using the app, Sound, Vibration.
- Muting a chat.
- The server checks all of this before every push (`pushDecision`).

### New
| What | How |
|---|---|
| **Daily picks** and **Tips and nudges** switches | New items in `NOTIFICATION_GROUPS` |
| **Quiet hours** switch with times | Default on, 11:30 pm - 8:30 am. Applies to everything except account security; messages from people too if the user turns on "Quiet for messages too" |
| **Android's own settings** | Android lets the user turn off each **channel** (section 7) in the phone's settings. The app **reads** this every time it opens and shows it: if "Messages" is off in Android, our switch shows "Off in phone settings - Open settings" |
| **All notifications off in Android** | A banner at the top of App settings > Notifications: "Notifications are off for IEM Connect on this phone. Turn on" -> opens Android's page for our app |
| Sound and vibration | Android fixes sound per channel and an app can't change it later. So on Android, the Sound/Vibration rows open the channel's page in phone settings. (Today we use 4 sound/vibration channels; they are replaced by the per-type channels) |
| Logged out | That phone gets nothing (token removed - already built) |
| Two phones | Both get it; reading it on one clears it on the other (section 10) |

---

## 7. How it looks in the Android status bar

### Channels (shown in Android > Apps > IEM Connect > Notifications)

| Channel | What's in it | Importance (Android) |
|---|---|---|
| **Messages** | N1-N5 | High - pops up, sound |
| **Matches** | N6, N10 | High |
| **Likes and Roses** | N7-N9 | Default - sound, no pop-up |
| **Stories and follows** | N11-N16 | Default |
| **Verification** | N17-N19 | Default |
| **Account and security** | N20-N22 | High |
| **Picks and tips** | N23-N28 | Low - no sound, sits quietly in the shade |

### The look
- **Small icon** in the status bar: a white, single-colour IEM Connect mark (Android paints it; a
  coloured icon shows as a white square). Accent colour `#FF5A5F`.
- **Large icon**: the sender's photo for N1-N6 and N11; the app logo for the rest.
- **One notification per chat**, which grows: "Riya · 3 new messages", the last lines shown.
- **Grouped**: several chats fold into one "IEM Connect · 4 chats" summary.
- **Replaced, not stacked**: a newer "5 people like you" replaces "3 people like you".
- **Cleared by itself**: reading the chat in the app (or on another phone) removes it from the
  status bar.
- Lock screen: with "Show name and message" off, only "IEM Connect · New message".
- Launcher badge (the dot/number on the app icon): unread messages + new likes.

### What Expo push can't do, and the later fix
Expo push shows normal notifications well, but **not** Android's chat style (several lines with
the sender's face in one growing notification, like WhatsApp). For that the server sends a **silent
data message**, and the app draws the notification itself with a small native step. It is
**phase 3**, after everything else works.

---

## 8. Action buttons

| Notification | Buttons | What happens |
|---|---|---|
| Message | **Reply** (type right there) · **Mark as read** | Reply sends the message **without opening the app**; the notification updates to "You: ..." |
| Match | **Say hi** | Opens the chat with the keyboard up |
| Like | **See who** | Opens Likes You (or the Rose/upgrade screen if locked) |
| Follow request | **Accept** · **Decline** | Done without opening the app; the notification disappears |
| Story mention | **View** | Opens the Story |
| Story failed | **Try again** | Opens the editor with the draft |
| Sign-in on a new phone | **It was me** · **Not me** | "Not me" opens Secure account (log out all, change password) |

How the buttons work:
- Built with `setNotificationCategoryAsync` (expo-notifications). Each push says which button set
  it uses.
- Buttons that open the app: the app starts, logs in silently, and goes to the screen.
- Buttons that **don't** open the app (Reply, Mark as read, Accept, Decline): a small background
  handler wakes up, uses the saved login, calls the API, and goes back to sleep. If the phone is
  offline, it shows "Couldn't send - tap to try again".
- Every button checks again on the server: a blocked person, an unmatched chat, or a request that
  was already answered gives a polite "This chat is no longer available".

---

## 9. Inside the app

| Part | Status |
|---|---|
| Banner at the top while using the app (not for the chat you are in) | Built |
| Bell + Notifications page, unread count, per-type filters | Built |
| Read / unread / remove | Built |
| **Tap a banner** -> goes to the same place as the push | New |
| **Live dot** on the Matches tab when a message arrives (no refresh) | New (via the socket we already have) |
| **Good-moment prompts**: after the first match, "Want to know when Riya replies? Turn on notifications" | New (section 12) |
| In-app "spicy" cards (e.g. "5 people like you" card at the top of Discover) | New - the same lines as section 4, shown at most once a day |

---

## 10. Every case

| Case | What happens | Status |
|---|---|---|
| App **open**, on another screen | Banner at the top (if on); the bell count goes up | Built |
| App **open**, in that exact chat | Nothing; the message just appears | Built |
| App **in the background** | Normal Android notification | Works after C1-C4 |
| App **swiped away** from recents | Still delivered - FCM is part of Android itself, not our app | Works after C1-C4 |
| **Phone restarted** | Still delivered. Our app **doesn't need to start** at boot: Google Play services gets the push and shows it. Notifications that arrived while the phone was off come in when it reconnects (if not expired) | Works after C1-C4 |
| App **force-stopped** (Settings > Force stop) | Android blocks all its pushes until the user opens the app again. Nothing any app can do; WhatsApp has the same limit | Android rule |
| Phone **offline** | FCM keeps it and delivers when online, until the expiry time (section 5) | - |
| Phone in **Doze** (screen off for a long time) | High priority ones (messages, matches, security) come at once; others at the next wake-up | New: set priority per type |
| **Tap with the app killed** (cold start) | The app opens, waits for login and navigation to be ready, then opens the screen. Already handled with `getLastNotificationResponse` | Built - check after C1 |
| Tap while **logged out** | Opens Login; after login it goes to the screen | New |
| Notification for **another account** (two accounts on one phone, user switched) | The app checks the `userId` in the push and ignores it if it's not the logged-in user | New |
| **Logged out** | Token removed from the server; the phone stops getting them | Built |
| **Account deleted / banned** | All tokens removed, nothing sent | New check |
| Token **changes** (Google rotates it, app reinstalled) | The app sends the new token every time it opens, and when Android says it changed | Partly built - add the change listener |
| Token **dead** (app uninstalled) | Expo says "DeviceNotRegistered"; we delete it | Built |
| Notification permission **taken away** later | Seen next time the app opens; banner in settings (section 6) | New |
| **Two phones** | Both get it; reading on one clears it on the other (a silent "clear" push) | New |
| User **blocks** someone | Their old notifications are removed from the status bar and the bell | New |
| User **unmatched** | Same | New |
| Push provider **down** | The outbox retries (already built) up to the expiry time; then it stays only in the bell | Built |

---

## 11. Phone makers that kill apps

Many phones popular in India (Xiaomi/Redmi/Poco, Vivo, Oppo, Realme, OnePlus, some Samsung) stop
apps in the background to save battery, so notifications come late or not at all.

What we do:
1. The app checks the phone maker. If it's one of these **and** a high-priority push arrived late
   (the push carries the time it was sent; the app compares when it opens), we show once:
   "Notifications may be late on this phone. Fix it" -> a short page with 2 steps and pictures
   for that maker (Autostart on, Battery: No restrictions) and a button that opens the right
   settings page.
2. Never more than once a month, and never on the first day.
3. **No foreground service, no keep-alive tricks** - they drain battery and the Play Store rejects
   them for an app like ours.

---

## 12. Asking for permission

Android 13+ asks "Allow IEM Connect to send notifications?" and we can ask **only twice** before
Android stops showing it. So we **don't** ask right after login, before the person has seen anything (as the app does
today: `RootNavigator` asks as soon as they are logged in).

- **When**: at the end of onboarding, after the profile is ready, on our own screen first:
  "Know when someone likes you or messages you 💬" - **Turn on** / Not now. Only "Turn on" shows
  Android's question.
- **If "Not now"**: ask again at a good moment - the first match ("Want to know when Riya
  replies?"), or the first message sent. At most 3 times in total, never twice in a week.
- **If Android's answer was "Don't allow"** twice: the button opens Android's settings page.

---

## 13. Measuring what works

| What | How |
|---|---|
| Sent | `notifications.push_sent_at` (built) |
| **Opened** | New: the app calls `POST /notifications/opened {id, action}` when a push or button is tapped |
| Open rate per type and per line | New admin view: e.g. "Standouts line 3: 18% opened" |
| **Turned off** | Track when someone switches a type off right after one arrives - that line is too much |
| Keep the winners | Every 2 weeks: drop lines under half the average open rate, write new ones |

---

## 14. Build order

| Phase | What | Needs |
|---|---|---|
| **1. Make push work** | C1-C4, rebuild the dev client, test N1/N6 on your phone: open, background, killed, restarted | Your credentials |
| **2. Channels and look** | Per-type channels, small icon, photos, grouping per chat, clear on read, priority + expiry per type, launcher badge | - |
| **3. Buttons** | Reply, Mark as read, Say hi, Accept/Decline, It was me/Not me, background handler | - |
| **4. Settings** | New switches, quiet hours, reading Android's channel state, "off on this phone" banner | - |
| **5. Permission flow** | Our own screen at the end of onboarding, good-moment re-asks | - |
| **6. Spicy** | Lines (section 4), caps, back-off, best time, Standouts/new people/comeback workers, open tracking | - |
| **7. Phone makers** | Late-delivery check and the help page | - |
| **8. Chat style** | Silent data push + native WhatsApp-style chat notification | Optional |
| **9. Campus moments** | Admin calendar for fest/exam/Valentine's lines | Admin panel |

---

## 15. Tests

- **Server**: every type respects its switch, Pause all, quiet hours, caps, back-off, blocked and
  muted; account security ignores Pause all; the same event never pushes twice; comeback stops
  after day 14; nothing goes to paused/banned/deleting accounts; "someone liked you" only when a
  real like exists.
- **On your phone** (one by one, with you): app open / in the chat / background / swiped away /
  **restarted** / force-stopped / offline then online / logged out / two accounts; each button with
  the app killed; turning a channel off in Android settings shows in our settings.

---

## 16. As built (2026-10-04)

### Server (apps/api)
| Part | Where |
|---|---|
| Channel, priority, expiry, quiet-hours rule per type; all the spicy lines | `services/push-policy.service.ts` |
| Every push: account check (banned/deleted, open "Under 18" case -> account notices only), switches, quiet hours (held in `push_queue`), channel, buttons (`categoryId`), log row in `push_log`; silent `clear` push | `services/push.service.ts` |
| Timed pushes: Standouts (N23), new people (N24), comebacks day 3/7/14 (N25), tips (N26), waiting match (N10); caps, 4-hour gap, back-off, best hour; sends what quiet hours held | `services/push-engagement.service.ts` (worker every 15 min) |
| Best hour: counted from app use, once an hour per person | `middlewares/auth.middleware.ts` -> `PushEngagementService.touch` |
| New switches "Daily picks", "Tips and nudges", "Quiet at night", "Messages and matches too" | `services/app-settings.service.ts` |
| N12 follow accepted | `services/follow.service.ts` |
| N18/N19 real-person status paused / team's answer | `services/face-verification.service.ts` |
| N20 new sign-in (email/password and Google) | `services/sign-in-notice.service.ts` |
| N22 report outcome; ban removes the person's phones | `services/safety.service.ts` |
| Likes: 1 an hour, stacked "N people like you", lines; Roses, matches with lines and Say hi | `services/outbox-delivery.service.ts` |
| Clear on read (other phones), unmatch, block | `chat.service.ts`, `match.service.ts`, `routes/block.routes.ts` |
| `POST /notifications/opened`, `POST /notifications/action` (Reply, Mark as read, Accept, Decline, It was me) | `routes/notification.routes.ts` |
| `GET /admin/notifications/stats?days=14` - open rate per type and per line, "turned off" counts | `services/push-stats.service.ts` |
| Tables `push_log`, `push_queue`, `push_engagement` | migration `20261004100000_notifications_v2` |
| Tests (10) | `tests/notifications.integration.test.ts` |

### App (apps/mobile)
| Part | Where |
|---|---|
| 7 channels (old 4 sound/vibration channels removed) | `features/notifications/push/channels.ts` |
| Button sets | `push/categories.ts` |
| Background task: buttons and silent clears with the app killed | `push/backgroundTask.ts`, defined in `index.ts` (needs `expo-task-manager`, added) |
| Tap handling, opens counted, link kept until login, push for another account ignored | `push/responses.ts`, `push/actions.ts` |
| Permission: no more asking at login; our own primer after onboarding and after sending a message; 3 times max, a week apart | `push/permission.ts`, `push/PermissionPrimer.tsx` |
| Late-delivery check and fix-it page (Xiaomi, Vivo, Oppo, Realme, OnePlus, Samsung) | `push/lateDelivery.ts`, `push/NotificationHelpScreen.tsx` |
| App settings: "Off in phone settings - Turn on" per type; Sound and vibration open the phone's settings on Android; late-notifications link | `screens/main/AppSettingsScreen.tsx` |
| Chat opened -> its notifications leave the status bar | `features/chat/screens/ChatScreen.tsx` |
| Logout removes this phone's token and clears the status bar and icon badge | `services/sessionLogout.ts`, `services/notifications.ts` |
| Icon badge = unread notifications | `navigation/RootNavigator.tsx` (BadgeSync) |
| White status-bar icon, accent colour | `assets/notification-icon.png`, `app.json` |

### Not done (on purpose, or later)
- ~~Phase 1~~ - **done** (2026-10-04): Firebase set up, the Android project regenerated, pushes reach the phone.
- ~~Phase 8~~ - **done** (2026-10-04): WhatsApp-style chat notifications - see `MESSAGE_NOTIFICATIONS_PLAN.md` section 20.
- **Phase 9** - campus moments (fest, exams, Valentine's): needs the admin calendar.
- **N5** message about to disappear - left out; low value for the work.
- **Live dot on the Matches tab** - not touched: the tab bar stays as it is.
- **In-app spicy cards** on Discover - left for later.
- **Big pictures** (blurred Standouts photo) - the server can send one (`image`), nothing uses it yet.
- **Follow requests** still say "New follow request" without the name, as before (privacy on the lock screen).
- **"Say hi"** opens the chat; the keyboard doesn't open by itself yet.

