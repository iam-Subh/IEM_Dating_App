# Verify reminders: every screen, as built

**Design update: 8 October 2026.** This file retains the original inventory. The app now uses centred overlays, inline cards, and chat counters. See `REMINDER_DESIGN.md` and the reminder website for the current appearance and copy.

Everything the app shows to get someone to verify their college email, and
what a verified student sees about unverified people. One entry per place:
when it shows, exactly what it says, how it looks, and the file to change.

Use this to redesign them. The rules behind them (limits, numbers, why) are in
`features/auth/GOOGLE_SIGNUP_PLAN.md`; the reminder numbers (#1–#27) match its
section 4.

---

## 0. The building blocks

Almost every reminder is one of four pieces. Redesign these and most of the
app changes with them.

### 0.1 The reminder card - `VerifyNudge`

`features/verification/VerifyNudge.tsx`

```
┌──────────────────────────────────────────────────────────┐
│ [icon]  Text, up to 3 lines                [Verify]   ✕   │
└──────────────────────────────────────────────────────────┘
```

| Part | Today |
|---|---|
| Icon | The verified badge, or an Ionicon passed in (green `#BDE4CA` on *info*, pink `#FFB4B6` on *warn* / *locked*) |
| Text | `#EDEDED`, 13 px, line height 18, max 3 lines |
| Button | Red pill `#E84A3B`, white 12 px bold. Says **Verify** (or **Re-verify**, **Preferences**) |
| ✕ | Only when the reminder can be dismissed (`dismissKey`); hides it for N days |
| Background by tone | **info** `#1F2421` (dark green-grey) · **warn** `#2E2324` (dark rose) · **locked** `#3A1E20` (deeper red) |
| Shape | Radius 16, padding 12 × 10, margin 16 sides (or 0 when `compact`) |

Variants built on it:

- **`UnverifiedNudge`** - the same card, shown only to people who never
  verified.
- **`GetVerifiedSpot`** - always there until verified; says "Re-verify" once a
  verification has ended.

### 0.2 The rules screen - `VerifyRulesScreen`

`features/verification/VerifyRulesScreen.tsx` - a bottom sheet over a dark
backdrop. Opens whenever someone tries something that waits for verifying.

```
┌──────────────────────────────────────────┐
│                 ────                      │  grabber
│ [badge] Verify your college              │  22 px, bold
│ ┌──────────────────────────────────────┐ │
│ │ [icon] Title of what's locked         │ │  the "waiting" box
│ │        Why, in one or two lines       │ │
│ └──────────────────────────────────────┘ │
│ VERIFYING UNLOCKS                        │  small caps, grey
│ ✓ Unlimited chat                         │
│ ✓ Photos and videos in chat              │
│ ✓ 5 Roses every week                     │
│ ✓ A place in Standouts                   │
│ ✓ The verified badge                     │
│ Your college email and the 6-digit code  │  grey, 12 px
│ we send there - about a minute.          │
│ [          Verify now          ]         │  red, full width
│             Not now                       │  text button
└──────────────────────────────────────────┘
```

- Sheet `#1B1A19`, top corners 26. Waiting box `#2A2224`, radius 16.
- **Verify now** opens Verify your college; **Not now** or tapping outside
  closes it.

**What the waiting box says** (one per reason):

| Reason | Opens when | Title | Body |
|---|---|---|---|
| `chat` | The 31st message, or tapping the locked message box | You've used your 30 messages | Your chats are waiting. Verify your college to keep chatting - everything else still works. |
| `media` | Tapping the attachment button in a chat | Photos and videos | Sending photos, videos and files is for verified students. Voice notes and messages still work. |
| `rose` | Tapping Rose after the trial Rose | You've sent your Rose | Verified students get 5 Roses every week. |
| `roseSent` | Right after sending the trial Rose (0.6 s later) | Nice choice 🌹 | That was your Rose on us. Verified students get 5 Roses every week - verify your college to get yours. |
| `likes` | The 26th like of the day | You've used today's likes | You get 25 likes a day until you verify. They come back at midnight - or verify for unlimited likes. |
| `paused` | Liking or sending a Rose after day 14 | Your profile is paused | It's been 14 days, so others can't see you right now. Verify your college to start liking again - it unpauses at once. |
| `follows` | The 11th follow request of the day | You've sent today's follow requests | You can send more tomorrow, or verify for no limit. |
| `mention` | Mentioning someone they haven't matched with in a Story | Mentions | Until you verify, you can mention only people you have matched with. |
| `welcome` | Once, the first time they reach the deck after onboarding | Get the verified badge | Verified profiles get more likes. Until you verify: 30 messages, 25 likes a day, one Rose - and your profile pauses after 14 days. |
| `area` | Tapping a 🔒 choice in "Who you see" | Meet your whole college | Until you verify, you meet students from your campus, or people near you. Verify to see all your college campuses and both colleges. |
| `search` | After 30 different people in Search in a day | You've reached today's search limit | Before verifying, Search shows up to 30 people a day, on your campus. Verify your college to search freely. |
| `standouts` | (spare; not opened today) | Standouts | Verified students appear in Standouts and get 5 Roses every week. |

How it opens: any server refusal with one of these codes opens it, from any
screen (`features/verification/verifyGate.ts`, wired in `services/api.ts`) -
never twice within 1.5 s.

### 0.3 Verify your college - `StudentVerificationScreen`

`features/auth/screens/StudentVerificationScreen.tsx` - a full screen.

```
Verify your college                          32 px bold
Enter your college email and the code we send there to get the verified badge.
  ✓  The verified badge on your profile
  ✓  Unlimited chat, photos and videos
  ✓  5 Roses every week
  ✓  A place in Standouts
College          [ IEM ]  [ UEM Newtown ]     choice rows
College email    [ name@college.edu       ]
[        Send code        ]
Six digit code   [ 000000 ]
Set a password   [ At least 8 characters ]    only when the account has none
  So you can also sign in with your college email. Google keeps working.
[    Verify membership    ]
Send a new code                               link
Later  /  Not now
  You can verify any time from your profile or Settings.
```

- **Later** - only right after a Google sign-up (onboarding).
- **Not now** - when opened from anywhere else ("VerifyCollege").
- **After success** (opened from the app): alert *"You're verified ✓ - Your
  badge is on your profile. Unlimited chat, photos and videos, Roses and
  Standouts are unlocked."*
- **College email already has its own account:** alert *"You already have an
  account - This college email already has an IEM Connect account. Use that
  one? Google will open it from now on, and this new account will be deleted."*
  (+ *"This account's matches and chats will be lost."* when it has any) -
  **No** / **Use that one**.

### 0.4 One-line text reminders

Small text, no button - #10 (Story share) and the chat's grey line. Described
where they appear.

---

## 1. Onboarding

| # | When | Where | What it shows | File |
|---|---|---|---|---|
| 1 | Right after Google sign-up | Full screen | Verify your college with **Later** (0.3) | `features/auth/screens/StudentVerificationScreen.tsx` |
| - | Choosing a college (Google users) | College step | Subtitle: *"Choose your college. It shows the verified tick once you verify your college email."* | `features/auth/screens/CollegeSelectionScreen.tsx` |
| 2 | First time on the deck after onboarding | Rules screen | `welcome` (0.2) - once ever | `features/verification/DeckVerifyBanner.tsx` |
| - | "Let's keep it real" (before photos) | Full screen | *"Add clear, recent photos that show your face. Then take a quick selfie, so we can confirm it's really you in them."* **Complete now** / **Maybe later** | `features/auth/screens/FaceVerificationInfoScreen.tsx` |
| - | Right after saving the photos | The selfie screen | *"Last step: a quick selfie. We check it's really you in the photos you just added - about a minute."* **I agree - start** / **Do it later** (*"You'll find it in your Profile. Accounts made with Google need it within 14 days."*) | `features/verification/RealPersonCheckScreen.tsx` |

---

## 2. Discover (the deck)

All in `features/verification/DeckVerifyBanner.tsx`, shown under the Story
tray, above the cards. **One at a time**, most urgent first:

| Order | When | Tone | Text | Button | Dismiss |
|---|---|---|---|---|---|
| a | A **verified** student's top card is unverified (first time) | info, shield icon | Some people haven't verified their college yet - they have no badge. Prefer verified profiles only? It's in your preferences. | **Preferences** | ✕ for good |
| b | Verification has ended | info | Your college verification has ended. Re-verify to get your badge back. | **Re-verify** | ✕ for 1 day |
| c | Paused (after day 14) - #20 | locked, pause icon | Your profile is paused - others can't see you. Verify your college to unpause it at once. | **Verify** | No |
| d | Pause in 4 days or fewer - #19 | warn, clock icon | Your profile pauses in **N** days. Verify your college to stay visible. | **Verify** | No |
| e | 5 or fewer likes left today - #14 | warn, heart icon | **N** likes left today - verify for unlimited likes. / at 0: You've used today's likes. They come back at midnight - or verify for unlimited likes. | **Verify** | No |
| f | After ~20 swipes in one sitting - #3 | info, badge | Verify your college to get the badge - verified profiles get more likes. | **Verify** | ✕ for 1 day; at most one pop-up a day |

**Match alert - #4** (`features/discovery/screens/DiscoverScreen.tsx`): the
usual *"It's a match! You and Rohan liked each other."* gains, when the match
is verified and you aren't: *"Rohan is verified ✓. Verify so they know you're
real too."* with **Later** / **Verify**.

**Swipe refused** by a limit: the rules screen, never the old "Swipe not saved"
alert.

---

## 3. Chat

`features/chat/screens/ChatScreen.tsx` - all above the message box, stacked:

| # | When | Look | Text |
|---|---|---|---|
| 5 | Unverified, more than 5 messages left | Reminder card, ✕ per chat (for good) | Get verified: matches reply more to verified profiles. |
| - | **The other person** has used their 30 (you are the partner) | Grey line, centred, `#8E8D93` 12 px on a dark pill | Waiting for **Ankit** to verify |
| 16 | 5 or fewer messages left | Small rose pill (`#3A1E20`), shield icon, tappable → Verify | **N** messages left - verify to keep chatting |
| 17 | 0 messages left | **Replaces the message box**: red full-width pill (`#E84A3B`), lock icon | Verify your college to keep chatting → rules screen `chat` |
| 18 | Tapping the attachment (+) button | - | Rules screen `media` (the picker does not open) |

Story replies that hit the limit open the rules screen from the Story viewer
(`features/stories/StoryViewerScreen.tsx`).

---

## 4. Headers and lines across the app

Each is an `UnverifiedNudge` card at the top of the screen, for people who
never verified:

| # | Screen | Text | Icon | Dismiss | File |
|---|---|---|---|---|---|
| 7 | Standouts | Verify to appear in Standouts and get 5 Roses a week. | sparkles | ✕ for 7 days | `screens/main/StandoutsScreen.tsx` |
| 8 | Likes You | Verified profiles show up first in people's Likes. | badge | ✕ for 7 days | `screens/main/LikesYouScreen.tsx` |
| 9 | Search | You're searching your campus. Verify to search all your college campuses. | badge | ✕ for 7 days | `features/search/SearchScreen.tsx` |
| 23 | Profile preview | This is your card without the verified badge. Verified profiles get more likes. | badge | ✕ for 7 days | `screens/main/ProfilePreviewScreen.tsx` |
| 25 | Matches | Unlock photos and unlimited chat - verify your college. | badge | ✕ for 7 days | `screens/main/MatchesScreen.tsx` |
| 25 | Chat list | Unlock photos and unlimited chat - verify your college. | badge | ✕ for 7 days | `screens/main/ChatListScreen.tsx` |
| 26 | Map | You're not shown on the map yet - verify to appear. | map | ✕ for 7 days | `features/location/MapScreen.tsx` |
| - | My preferences (Basics tab) | Until you verify, you meet students from your campus. Verify to see all your college campuses and both colleges. | globe | No | `features/discovery/screens/PreferencesScreen.tsx` |

**#10 Story share** (`features/stories/create/editor/StoryEditor.tsx`): one
quiet line floating just above the share row, no button -
*"Your Stories show the verified badge once you verify your college."*
(white 75 %, 12 px, on a dark pill).

### 4.1 The Standouts card (fewer than 8 picks)

`screens/main/StandoutsScreen.tsx` - replaces #7 when an unverified student
has fewer than 8 Standouts, and replaces the empty state:

```
┌──────────────────────────────────────────────────┐
│ ✨ More Standouts after you verify                │  16 px bold
│ Right now you see people from Gurukul. Verify     │
│ your college to get Standouts from all IEM        │
│ campuses, and 5 Roses a week.                     │
│ [Verify now]                                      │
└──────────────────────────────────────────────────┘
```

- Card `#2A2320` with a `#4A3A2C` border, radius 18.
- With "People near me": *"Right now you see people near you."*
- Campus and college come from their account ("New Town", "UEM Newtown"...).

### 4.2 Who you see (My preferences)

`features/discovery/screens/PreferencesScreen.tsx` - the choice sheet:

```
Who you see
Until you verify your college, you meet students from your campus, or people near you.
  My campus · Gurukul            Students from IEM Gurukul          ●
  🔒 All IEM campuses             Verify your college to choose this ○
  🔒 IEM & UEM Newtown            Verify your college to choose this ○
  People near me                 Anyone within a distance you choose ○
```

Tapping a 🔒 row closes the sheet and opens the rules screen `area`. The same
locks appear in the onboarding preferences form
(`features/discovery/components/DiscoverySettings.tsx`), there greyed out with
*"Verify your college to choose this."*

---

## 5. Always-there spots

| # | Where | What | File |
|---|---|---|---|
| 11 | Profile tab, under the title | Card: *"Get verified ✓ - the badge, unlimited chat, Roses and Standouts."* **Verify**. Ended: *"Your college verification has ended. Re-verify to get your badge back."* **Re-verify**. Never dismissable | `screens/main/ProfileScreen.tsx` |
| 12 | Settings > Account | Card "College verification": row **Get verified · Not verified** - *"Add your college email and the code we send there: the verified badge, unlimited chat with photos and videos, Roses and Standouts."* **Verify**. Ended: note "Ended", **Re-verify** | `screens/main/AccountScreen.tsx` |
| 24 | Edit profile > College | Card: *"Verify your college email to get the tick."* **Verify** (ended: *"Your verification has ended. Re-verify to get the tick back."*), then the college list. Subtitle: *"It shows on your profile without the verified tick until you verify your college email."* | `screens/main/edit/EditCollegeScreen.tsx` |

---

## 6. Pushes and notifications

Sent by the server (`api/src/services/verification-reminders.worker.ts`,
hourly), also kept in the Notifications screen. They follow App settings >
**Verification reminders** (on by default) and "Pause all". Tapping opens
Verify your college.

| # | When | Title | Body |
|---|---|---|---|
| 13 | Day 1 after Google sign-up | Get your verified badge | Add your college email to get the badge, unlimited chat and Roses. It takes a minute. |
| 13 | Day 3 | Matches reply more to verified profiles | Verify your college email to unlock photos and unlimited chat. |
| 13 | Day 7 | One step to your verified badge | Verify your college email - your Roses and Standouts are waiting. |
| 19 | Days 10, 12, 13 | Your profile pauses in **N** days | Verify your college email to stay visible. It takes a minute. |
| 20 | Day 14 | Your profile is paused | Others can't see you right now. Verify your college email and it unpauses at once - your matches and chats are still here. |
| - | 30, 7, 1 days before a verification ends | Your college verification ends in **N** days | Re-verify with your college email to keep your badge. |
| 27 | A verified student likes them | A verified student liked you *(or "…sent you a Rose")* | Open Likes You to see who - and verify so they see your badge. |

Only the latest step is sent if several are due; never twice.

---

## 7. What verified students see about unverified people

| Where | What | File |
|---|---|---|
| Swipe card | No badge (nothing else) | `features/discovery/components/SwipeCard.tsx` |
| Profile detail | A faint ⓘ where the badge would be; tap: alert *"Not verified - Ankit hasn't verified their college yet."* | `features/discovery/components/profile-detail/ProfileDetailModal.tsx` |
| Search result | Grey *"Not verified"* after the name (11 px, `#8E8D93`) instead of the badge | `features/search/SearchScreen.tsx` |
| Deck, first unverified card | Banner (a) in section 2 | `features/verification/DeckVerifyBanner.tsx` |
| Chat | "Waiting for Ankit to verify" (section 3) | `features/chat/screens/ChatScreen.tsx` |
| Settings | Switch **Unverified accounts can find me** - *"Off: only verified students find you by name. On: people who haven't verified their college yet, on your campus, can too."* (verified only, under "Discoverable in search") | `screens/main/SettingsScreen.tsx` |
| Report reasons | "Under 18" added everywhere a profile can be reported | profile detail, Search, Likes You |

---

## 7a. Real-person check (selfie)

`features/verification/RealPerson.tsx`, `RealPersonCheckScreen.tsx` -
`PHOTO_VERIFICATION_PLAN.md`. No badge; only the person sees these.

| Where | When | Text | Button |
|---|---|---|---|
| Profile tab | Verified | *"You're verified as a real person ✓"* (green line) | - |
| Profile tab | Google account, not done | *"Verify you're a real person - a quick selfie. Needed within N days to stay visible."* (warn from 4 days) | **Start** |
| Profile tab | College-email student, not done | *"Verify you're a real person - a quick selfie that matches your photos."* (✕ for 14 days) | **Start** |
| Profile tab | A photo or the video isn't them | *"A photo or your video doesn't seem to be you. Fix it to finish your real-person check."* | **Fix** |
| Profile tab | With the team | *"Your real-person check is with our team - usually within a day."* | **Details** |
| Discover deck | Google account owes it, 4 days or fewer | *"Verify you're a real person within N days to stay visible - a quick selfie."* | **Start** |
| Discover deck | Paused for it | *"Your profile is paused - verify you're a real person with a quick selfie to unpause it at once."* | **Start** |
| Edit profile, under the photos | Something isn't them | Card "Real-person check" listing each: *"Doesn't look like you - replace or remove it"*, *"No face found - your main photo must show your face"*, *"Your video doesn't seem to show you"*, *"Being checked by our team"* | - |
| Saving a main photo that isn't them | - | Alert *"Use a photo of yourself - This doesn't look like you. Your main photo has to show your face."* | - |
| Settings > Account | Always | Card "Real-person check" - *Selfie check*: status, **Start** / **Remove** | - |

**The selfie screen:** intro and consent (*"What we keep"*), **I agree - start**
/ **Not now**; then the oval camera with "Step N of 4": *Look straight at the
camera* → three of *Close your eyes*, *Turn your head to one side*, *Now turn
to the other side*, *Smile* (random order), a buzz after each; *Checking your
selfie*; then the result: *"You're verified as a real person ✓"* · *"Almost
there"* (team check) · *"One thing to fix"* (**Edit my photos**) · *"We
couldn't confirm it"* (**Try again**).

## 8. How often - the rules every redesign should keep

- **Lock moments** (rules screen, counters, the locked message box, #14–#22)
  always show: they answer something the person just tried.
- **Nudges** (#3, #5, #7–#10, #23, #25–#27) are dismissable, and pop-ups
  share **one a day** (`features/verification/nudges.ts`).
- **Always-there spots** (#11, #12, #24) never pop up.
- **Everything stops the moment they verify** - the status is re-read
  (`features/verification/useVerificationStatus.ts`) and every reminder hides.
- Verified students see only section 7.

---

## 9. Where to change things

| To change | Edit |
|---|---|
| Look of every reminder card | `features/verification/VerifyNudge.tsx` (styles at the bottom) |
| The rules sheet, its texts | `features/verification/VerifyRulesScreen.tsx` (`WAITING`, `UNLOCKS`) |
| Deck banners and their order | `features/verification/DeckVerifyBanner.tsx` |
| How often nudges pop up | `features/verification/nudges.ts` |
| Which refusals open the rules sheet | `features/verification/verifyGate.ts` |
| Push and notification texts | `api/src/services/verification-reminders.worker.ts` |
| "A verified student liked you" | `api/src/services/outbox-delivery.service.ts` |
| Who you see names and locks | `api/src/services/preferences.service.ts` (`areaOptions`) |
