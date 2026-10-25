# Message notifications plan - like WhatsApp and Telegram

Status: **being built** (2026-10-04). Android first; iPhone later (section 16).

### Decisions (2026-10-04)
- **Silent "clear" pushes go at normal priority** - fixed first. Firebase downgrades high-priority pushes that show nothing on screen.
- **Play from the notification: yes.** Android allows starting playback from a notification button (an official exception to the background-start rules).
- **"Played" receipts: yes**, like WhatsApp's blue microphone. Playing a voice note, in the app or from the notification, tells the sender it was listened to.
- **Native actions use their own narrow token** ("push action token"): the Kotlin side can't read the app's encrypted login, so the server gives each phone a token that only works for notification actions (reply, read, delivered, played, voice link), and dies with logout or a removed phone.
- **Old app versions keep working:** each phone tells the server it can draw chat notifications itself (`capabilities: ["chat_v2"]`). Phones that can't still get today's ready-made notifications.
This is Phase 8 of `NOTIFICATIONS_PLAN.md`, written out in full.

Contents
1. What people will see
2. What we have today, and what is missing
3. How it will work (the big picture)
4. Every message type in the notification
5. One notification per chat
6. Photos and videos in the notification
7. Voice notes - play from the status bar
8. Buttons: Reply, Mark as read, Play
9. Updating and removing notifications
10. Sound and vibration - not too much
11. Privacy and the lock screen
12. Android "Conversations" features
13. Delivered ticks
14. Settings
15. Every case
16. iPhone
17. Build order
18. Tests
19. Research sources

---

## 1. What people will see

```
┌─────────────────────────────────────────────┐
│ (Riya's photo)  Riya              2:14 pm   │
│   haha same                                  │
│   canteen at 2?                              │
│   📷 Photo   [small picture]                 │
│   🎤 Voice message (0:12)                    │
│   You: see you there 😄                      │
│ [ Reply ]  [ Mark as read ]  [ ▶ Play ]     │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ 🎵 Riya · Voice message        ⏮ ⏯ ⏭  1.5x │  ← while a voice note plays
│ ━━━━━━━━━●────────────  0:05 / 0:12         │
└─────────────────────────────────────────────┘
```

- **One notification per chat** that grows as messages arrive, with the sender's photo, like WhatsApp.
- **Photos show as a small picture**; videos show their first frame.
- **Voice notes can be played from the notification**, with a player in the status bar (pause, seek, speed). It also shows on the lock screen, like Telegram's.
- **Reply** without opening the app. Your reply shows in the same notification as "You: …".
- Several chats fold into **one group** ("IEM Connect · 3 chats").
- **Nothing private on the lock screen** unless the person turned previews on.

---

## 2. What we have today, and what is missing

| Already built (NOTIFICATIONS_PLAN.md) | Missing |
|---|---|
| A push per message, "Riya: text" or "New message" | **One growing notification per chat**; each message is separate today |
| Reply and Mark as read buttons | Reply showing **inside** the notification as "You: …" |
| Muted chats stay quiet; the open chat stays quiet | **Photos/videos** in the notification |
| Read on another phone → cleared | **Voice note playback** from the status bar |
| Unmatch/block → cleared | **Sender's photo** as the notification's picture |
| Quiet hours, channels, buttons | **Edited/deleted messages** updating the notification |
| | Android **Conversation** section (priority chats, chat shortcuts) |
| | **Delivered** ticks when the phone receives the message |

**Why it's missing:** today the server sends a finished notification and Android shows it as-is, so the app never touches it. For everything above, **the app must draw the notification itself**.

---

## 3. How it will work

```
A message is sent
  → server: outbox → "chat" push with DATA only (who, what, which chat) - no ready-made notification
  → Google FCM (high priority) → the phone
  → OUR Android code receives it (ChatMessagingService - Kotlin, no JavaScript start-up, fast)
       1. saves the message in the phone's chat store (ChatMessageStore - already exists)
       2. downloads the small picture / sender photo if needed (max ~5 seconds)
       3. draws the chat's notification from the store: all unread messages of that chat
       4. tells the server "delivered" (grey double tick)
  → anything that is not a chat message (likes, matches, stories...) → passed to Expo as today
```

### Key decisions (from the research)
| Decision | Why |
|---|---|
| **Our own `ChatMessagingService`** that *extends* Expo's `ExpoFirebaseMessagingService` | Only one app service receives pushes. Expo's is registered at priority -1, ours at the normal 0 wins. Ours handles `type: "chat"` and hands everything else to Expo unchanged |
| **Kotlin, not JavaScript** | Starting the JS app in the background takes seconds and is often killed on Xiaomi/Vivo; Kotlin runs in under a second. We already have Kotlin chat code (`modules/chat-timeline`, `modules/chat-media`) |
| **Always show a visible notification** for every high-priority chat push | Firebase rule: high-priority pushes that show nothing get **downgraded** for that phone. If drawing fails, a plain "Riya: New message" is shown instead - never nothing |
| **Silent "clear" pushes go at *normal* priority** | Same rule: they show nothing. ⚠️ Today's clear push (built yesterday) is sent *high* - fix this first (step 0 of section 17) |
| **The same text as today when drawing is impossible** | Fallback path = today's notification, so nothing gets worse |

### What the "chat" push carries (max 4 KB)
```
type: "chat", userId, matchId, messageId, seq, sentAt,
sender: { id, name, avatarThumbUrl? },
kind: text | photo | video | voice | document | story_reply | link,
text?        - only if "Show name and message" is on, cut to 500 characters
media?       - { count, durationSec, thumbUrl (signed, 10 minutes), fileName, sizeBytes }
replyTo?     - { senderName, snippet } (a quoted message)
previews: true/false
```
With previews **off**, the push carries **no text and no pictures**, only that a message exists. The phone shows "New message".

---

## 4. Every message type in the notification

| Message | Notification line (previews on) | Previews off |
|---|---|---|
| Text | `canteen at 2?` (up to ~4 lines when expanded) | `New message` |
| Only emoji | `😂😂` (shown larger by Android) | `New message` |
| Text replying to a message | `↩ "see you there" · ok cool` | `New message` |
| Photo | 📷 small picture + `Photo` (+ caption) | `📷 Photo` |
| Several photos | 📷 first picture + `3 photos` | `📷 3 photos` |
| Video | first frame + `🎥 Video (0:24)` | `🎥 Video` |
| Voice note | `🎤 Voice message (0:12)` + **▶ Play** button | `🎤 Voice message` (Play still works) |
| Document | `📄 notes.pdf (2.1 MB)` | `📄 Document` |
| Link | `instagram.com/p/…` → link title from our link preview | `New message` |
| Story reply | `Replied to your story: 🔥` + the story's small picture | `Replied to your story` |
| Reaction | Added to the chat's notification as its own line: `Riya reacted ❤️ to "see you"` | `Reaction` |
| Edited message | The line changes in place, quietly (no sound) | - |
| Deleted for everyone | The line disappears; if it was the only one, the notification goes | - |
| Disappearing message | Disappears from the notification when it expires | - |
| First message after a new match | Title shows `Riya · New match` | `New match` |
| Message from someone you blocked/unmatched | Never shown | - |

---

## 5. One notification per chat

- **Android's chat style** (`NotificationCompat.MessagingStyle`). Each sender is a `Person` with name and round photo (104 dp, as Google recommends), so Android draws the chat layout with faces.
- **Notification id = the chat**: a new message *updates* the chat's notification instead of adding one.
- Shows the **last 7 unread messages**; older ones fold into `+12 more messages`.
- Your replies appear as **"You: …"** lines (sender `Person` = you).
- **Group**: all chat notifications share one group with a summary. On most phones the summary shows "3 chats" with the latest line of each.
- **Sender photo**: downloaded once and cached on the phone for a week; initials if it fails (Android does this itself).
- **Order**: the newest chat on top (Android sorts by time).
- Android allows ~50 notifications per app; grouping keeps us far below that.

---

## 6. Photos and videos in the notification

How Android shows a picture inside a chat notification: the message carries an image (`Message.setData("image/jpeg", uri)`). The picture must be a **file on the phone**, shared with the system through a `FileProvider` (Android's notification screen needs permission to read it).

| Step | How |
|---|---|
| 1. Which picture | The server puts a **small rendition** (~320 px, ~30 KB, the chat's existing thumbnail) in the push as a **signed link valid 10 minutes**. Our S3 bucket stays private; the link expires |
| 2. Download | The Kotlin service downloads it within **5 seconds**. Slow network → show `📷 Photo` without the picture, then update quietly when it arrives |
| 3. Store | `cache/notification-media/`, deleted when the chat is read, and anything older than 2 days |
| 4. Show | Two lines: the picture (fallback text "Photo"), then the caption as text, as Google advises |
| Video | The same with the video's poster frame, plus `🎥 Video (0:24)` |
| Previews off / lock screen | No picture at all - nothing downloaded |
| Tap the picture | Opens the chat at that message (we have "open chat at message") |

**Never in notifications:** photos from a chat with Screen security on, if that is ever added (view-once photos don't exist in the app today; if they come, they never show in a notification).

---

## 7. Voice notes - play from the status bar

**Like Telegram:** tap ▶ Play on the notification. The voice note plays, and a **media player** appears in the status bar and on the lock screen.

| Part | How |
|---|---|
| Player | **Media3** (`ExoPlayer` + `MediaSessionService`). Media3 draws and updates the media notification itself, with Android 13+'s media controls |
| Allowed by Android? | Yes. Starting playback from a **notification button** is an official exception to Android 12+'s background-start rules ("user interacts with a notification") |
| Manifest | A service of type `mediaPlayback` and the `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permission (required on Android 14+) |
| The file | Voice notes are private on S3: the push carries the note's id; on Play, the service gets a signed link from the API (with the saved login) and streams it. A one-minute note is ~200 KB |
| Controls | Play/pause, seek bar, **speed 1× / 1.5× / 2×** (like WhatsApp), close |
| Shown | Sender's photo and name, "Voice message · 0:12" |
| Several notes | ⏭ plays the chat's next unheard voice note (Telegram does this) |
| Headphones pulled out | Pauses (Android's "becoming noisy" signal) |
| A call comes in / another app plays | Pauses (audio focus) |
| Finished | **The player closes itself and ends the media session.** Telegram had a bug where it didn't, and its player got stuck in the status bar - we close it explicitly |
| Marks | The chat's notification line changes to `🎤 Voice message (0:12) · played` |
| Also inside the app | The app's own voice player publishes the same media session, so a voice note started in the app **keeps playing with the screen off or the app in the background**, with the same controls |
| Earpiece (raise to ear) | Only inside the app (proximity sensor); from the notification it plays on the speaker or headphones |

**"Played" receipts (decided: yes):** the blue microphone, like WhatsApp's. When a voice note is played (in the app or from the notification), the sender's bubble shows a blue mic. Stored per recipient in `message_receipts.played_at`; sent live to the sender.

---

## 8. Buttons: Reply, Mark as read, Play

| Button | Shown on | What happens |
|---|---|---|
| **Reply** | Every chat notification | Type in place. The message is saved in the **send queue** (WorkManager - we already use it for uploads) and sent, even if the network is down for a minute. The notification immediately shows "You: …" with a small "Sending…", which disappears when sent. If it fails: "Not sent - tap to retry" |
| **Mark as read** | Every chat notification | Marks the chat read (blue ticks for the sender), removes the notification. Works with the app closed |
| **▶ Play** | When the newest unheard message is a voice note | Section 7 |
| Smart replies | On the Reply box | Android's own suggestions ("👍", "On my way") made on the phone - nothing is sent to anyone. Can be turned off (section 14) |

- Buttons are tagged with Android's meanings (`SEMANTIC_ACTION_REPLY`, `SEMANTIC_ACTION_MARK_AS_READ`), so watches and Android Auto understand them.
- Each button runs in Kotlin, with no JavaScript, and calls the API with the saved login (refreshing it if needed).
- Every rule is checked again on the server: blocked, unmatched, the 30-message limit for unverified accounts. A refusal replaces the notification with its reason.
- **Tapping the notification** opens the chat at the first unread message.

---

## 9. Updating and removing notifications

| Event | Notification |
|---|---|
| New message in the same chat | Updated in place; sound only by the rules in section 10 |
| Read in the app on this phone | Removed at once (built) |
| Read on another phone | Removed by a silent clear push - **normal** priority |
| You reply from the notification | "You: …" line added, sound off, stays until you open or swipe it |
| Message edited | Line updated quietly (`setOnlyAlertOnce`) |
| Message deleted for everyone | Line removed; no lines left → notification removed |
| Disappearing message expires | Line removed at its time (WorkManager job at the expiry) |
| Unmatch / block | Removed, its shortcut removed (built for the notification) |
| Chat muted | Removed now; none until unmuted |
| Logged out | All removed, shortcuts removed, notification cache and pictures deleted |
| Swiped away | Stays away; the **next** message brings it back with all unread lines |

---

## 10. Sound and vibration - not too much

- **First message** in a chat → sound and vibration (the Messages channel).
- **More messages in the same chat within 10 seconds** → the notification updates quietly (`setOnlyAlertOnce`), like WhatsApp during a burst.
- Another chat → sounds again.
- **App open, other screen** → the in-app banner as today (the Kotlin side asks the app whether it is in the foreground and which chat is open; the app tells it through the chat-timeline module).
- **App open, same chat** → nothing (built).
- **Quiet hours** with "Messages and matches too" → the notification still appears, but silently, not held until morning. A message should be there when they wake up. (Different from other pushes.)
- Per-chat custom sound → Android's own Conversation settings (section 12), not ours.

---

## 11. Privacy and the lock screen

| Where | Previews on | Previews off (default) |
|---|---|---|
| Status bar, unlocked | Name, text, pictures | "IEM Connect · New message" |
| Lock screen | **"Riya · 2 new messages"** - no text, no picture (a separate "public version" of the notification) | "IEM Connect · 2 new messages" |
| Lock screen with "Show sensitive content" turned on in the phone's own settings | Full notification (the person chose this) | Same as above |
| What goes through Google's servers | Name, text up to 500 characters, a 10-minute picture link | Nothing but "a message exists" |

**Later option:** encrypt the push's content with a key only this phone has, so Google sees nothing even with previews on. More work; not needed for launch.

---

## 12. Android "Conversations" features

Android 11+ gives messaging apps a special **Conversations** section at the top of the notification shade. It needs, per chat, a **long-lived shortcut** with the person (`ShortcutInfoCompat`, `setIsConversation`, `setLocusId`) linked to the notification (`setShortcutId`).

What that gives us, for free once the shortcut exists:
- Chats appear in the **Conversations section**, above other apps' notifications.
- People can mark a chat **Priority**: it shows first, with the person's photo in the status bar, and can break through Do Not Disturb.
- **Per-chat sound and vibration** in the phone's settings (long-press the notification).
- **Chat shortcuts**: long-press the app icon to see recent chats; they also appear in Android's share sheet ("Share to Riya").

Rules:
- One shortcut per chat, created when a notification is shown **and** when the chat is opened in the app; the same id both times.
- Removed on unmatch, block and logout.
- **Bubbles** (floating chat heads) also need an embedded resizable chat screen. That's a big job for a React Native app; **later**, not in this plan's build.

---

## 13. Delivered ticks

When the Kotlin service receives a chat push, it tells the server **delivered** (the endpoint `PATCH /chat/:matchId/delivered` already exists). The sender then sees the grey double tick even if the app is closed, exactly like WhatsApp. If the call fails, it is retried with WorkManager when the network returns.

---

## 14. Settings

App settings → Matches and messages (built switches stay):

| Switch | Default | New? |
|---|---|---|
| Messages | On | - |
| Show name and message | Off | - |
| **Show photos in notifications** (under "Show name and message") | On | New |
| **Smart reply suggestions** | On | New |
| **Play voice messages from notifications** | On | New |
| Reactions | On | - |

Per chat (chat menu): Mute (built). Sound per chat → "Open phone settings for this chat" (Android's conversation settings).

---

## 15. Every case

| Case | What happens |
|---|---|
| App killed / swiped away | Kotlin service still runs (FCM starts it) - full notification |
| Phone restarted | Same - no app start needed |
| Force-stopped | Nothing until opened (Android rule) |
| Xiaomi/Vivo holding the app back | FCM high priority still wakes the service; if drawing doesn't finish in time, the plain fallback shows. The fix-it page (built) helps |
| No network for the picture | Text first, picture added quietly later |
| Login expired in the background | Kotlin refreshes it with the saved refresh token; if that fails, the notification still shows (it needs no login), but buttons say "Open the app to continue" |
| Two accounts on one phone | Pushes for the other account are dropped (built rule, also in Kotlin) |
| 100 messages while away | Last 7 shown, "+93 more" |
| Very long message | Cut at 500 characters in the push; full text in the app |
| Chat with screen security on | Text only, never pictures |
| Unverified account at its 30-message limit replies from the notification | "You've used your 30 messages - verify to keep chatting" replaces the notification, with a Verify button |
| Reply while offline | Queued, "Sending…", sent when online; after 24 hours: "Not sent - tap to retry" |
| Voice note while on a call | Doesn't start; "Can't play during a call" |
| Low storage | Pictures skipped; text only |
| Sender changes photo | New photo used from the next notification |
| App updated | Notifications and shortcuts stay |

---

## 16. iPhone (later)

The same result on iPhone needs a **Notification Service Extension** (pictures, edits) and **Communication Notifications** (sender photos). It's a separate build with the Apple key (credential C5 in NOTIFICATIONS_PLAN.md). Until then, iPhones get today's notifications.

---

## 17. Build order

| Step | What | Size |
|---|---|---|
| **0. Fix now** | Silent "clear" push to **normal** priority (Firebase downgrade rule) | Small |
| **1. Server** | `type: "chat"` data push with the payload in section 3; signed thumbnail and voice links; previews respected | Medium |
| **2. Kotlin receiver** | `ChatMessagingService` extending Expo's; config plugin to register it; pass non-chat pushes to Expo; fallback plain notification | Medium |
| **3. Chat style** | MessagingStyle, Person with photos, one per chat, group summary, "+N more", lock-screen public version, sound rules, delivered ticks | Large |
| **4. Buttons in Kotlin** | Reply (with send queue and "You:" line), Mark as read, retries | Medium |
| **5. Pictures** | Download, FileProvider, cache, cleanup, video frames, story-reply pictures | Medium |
| **6. Updates** | Edits, deletes, disappearing, reactions, mute, unmatch/block, logout | Medium |
| **7. Conversations** | Shortcuts, LocusId, priority conversations, share-sheet chats | Medium |
| **8. Voice player** | Media3 service, media notification, speed, next note, in-app voice notes in background | Large |
| **9. Settings** | The three new switches | Small |
| Later | Bubbles; encrypted push content; iPhone; "played" receipts if wanted | - |

Each step ends with a dev-client rebuild and a test on your phone (section 18). No new credentials needed.

---

## 18. Tests

**Server (automatic):** the chat push carries no text/picture with previews off; text cut at 500; signed links expire; clear pushes are normal priority; muted/blocked/unmatched send nothing; the reply action respects every limit.

**Kotlin (automatic, on the build machine):** drawing from the store (7 lines, "+N more"); the fallback when drawing fails; the burst rule (sound once per 10 s); edits/deletes update lines; the two-account rule.

**On your phone (with you):**
- App open (other screen / same chat), background, swiped away, **restarted**, force-stopped.
- Text, emoji, reply-quote, photo, 3 photos, video, voice, document, link, story reply, reaction.
- Reply from the notification: online, offline then online, at the unverified limit.
- Mark as read: the sender sees blue ticks.
- Play a voice note from the notification: pause, seek, 2×, headphones out, next note, lock screen, finish (the player must disappear).
- Edit and delete from the other phone; a disappearing message expiring.
- Previews off: nothing private anywhere; lock screen with previews on.
- Long-press: Priority conversation, per-chat sound; chat shortcuts on the app icon.
- On a Xiaomi or Vivo phone if possible.

---

## 19. Research sources

- Android - [People and conversations](https://developer.android.com/develop/ui/views/notifications/conversations): MessagingStyle + long-lived shortcut + Person, LocusId, 104 dp avatars, setData for images, don't cancel before seen.
- Android - [MessagingStyle.Message](https://developer.android.com/reference/androidx/core/app/NotificationCompat.MessagingStyle.Message): `setData(mimeType, uri)`, FileProvider permission, image + text as two messages.
- Android - [Foreground service background-start exemptions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start): a user interacting with a notification may start a foreground service.
- Android - [Foreground service types (Android 14)](https://developer.android.com/about/versions/14/changes/fgs-types-required): `mediaPlayback` type and permission.
- Android - [Media3 background playback](https://developer.android.com/media/media3/session/background-playback) and [media controls](https://developer.android.com/media/implement/surfaces/mobile): MediaSessionService publishes and updates the media notification.
- Android - [Notification.Action.Builder](https://developer.android.com/reference/android/app/Notification.Action.Builder): `setSemanticAction`, `setAllowGeneratedReplies`.
- Firebase - [Message priority](https://firebase.google.com/docs/cloud-messaging/android/message-priority) and [FCM on Android (2025)](https://firebase.blog/posts/2025/04/fcm-on-android): high priority only for visible notifications, otherwise downgraded.
- Telegram bug tracker - [media notification stuck after a voice message](https://bugs.telegram.org/c/62625/163): end the media session when playback stops.
- WhatsApp features - [notification bubbles (WABetaInfo)](https://wabetainfo.com/whatsapp-beta-is-testing-notification-bubbles-on-android/), [Mark as read from the notification](https://ubergizmo.com/2018/07/whatsapp-mark-as-read-button-notifications).
- Expo - `ExpoFirebaseMessagingService` is an `open class` registered at intent-filter priority -1 (read in `node_modules/expo-notifications`), so an app service can extend it and take chat pushes first.

---

## 20. As built (2026-10-04)

### Server (apps/api)
| Part | Where |
|---|---|
| Clear pushes at **normal** priority; `end` flag on unmatch/block | `services/push.service.ts` |
| Per-phone pushes: `chat_v2` phones get data, others ready-made text; chat messages never held by quiet hours (silent instead; quiet channel on old phones); `sendNative` for updates | `services/push.service.ts` |
| Chat payload per message type, previews respected, text cut at 500, signed 15-minute picture links, video poster frames, reply quotes, "new match" | `services/chat-notification.service.ts` |
| Better ready-made text for old phones: 📷 Photo, 🎤 Voice message, 📄 file name, story replies | same, `legacyText` |
| Reactions as a chat line; edits and deletes update the phone; muting clears it | `services/outbox-delivery.service.ts`, `chat.service.ts` |
| Played receipts: `message_receipts.played_at`, `PATCH /chat/:matchId/messages/:messageId/played`, live `message.played` event, `playedAt` in message lists | `chat.service.ts`, `routes/chat.routes.ts` |
| Push action token (own audience, tied to session + phone) and `/notifications/native/*`: reply, read, delivered, played, voice-url, opened | `services/push-action-token.service.ts`, `routes/notification.routes.ts` |
| Device capabilities; registration returns the token | `device_tokens.capabilities`, `PUT /notifications/devices` |
| Settings: Show photos in notifications, Play voice messages from notifications, Smart reply suggestions | `services/app-settings.service.ts` |
| Migration | `20261004200000_message_notifications` |
| Tests (6) | `tests/chat-notifications.integration.test.ts` |

### Phone (apps/mobile/modules/chat-notify - Kotlin)
| File | Does |
|---|---|
| `ChatMessagingService.kt` | Receives every push first; draws chats, reactions, updates, clears; hands the rest to Expo; delivered ticks; two-account rule; fallback |
| `ChatNotifier.kt` | MessagingStyle per chat, sender photo, pictures, "+N more", "You:" lines, Reply / Mark as read / ▶ Play, lock-screen version, conversation shortcut, group summary, burst rule, expiry redraw |
| `ChatStore.kt` | The lines of each chat, kept across app restarts |
| `MediaFetcher.kt` | Sender photos (round, a week) and pictures (512 px, 2 days), time limits and size caps; FileProvider |
| `ChatActionReceiver.kt`, `ChatWork.kt` | Reply ("Sending…", offline queue, refusal shown), Mark as read, delivered, played - WorkManager, retried up to a day |
| `VoicePlaybackService.kt` | Media3 player in the status bar and lock screen: speed 1×/1.5×/2×, next unheard note, headphones/calls pause, closes itself when done |
| `ChatNotifyModule.kt` + `index.ts` | The app signs it in/out, tells it what is on screen, clears a chat when opened |

### App (JavaScript)
- Registers `chat_v2` and passes the token to the native side (`services/notifications.ts`); logout clears everything.
- Tells the native side when the app is on screen and which chat is open (`watchScreenForChatNotifications`).
- Opening a chat clears its notification (`ChatScreen.tsx`).
- Played receipts: blue mic in the sender's voice bubble; first play marks it (`MessageBubble.tsx`, `features/chat/voicePlayed.ts`).
- Voice messages played in the app keep playing in the background, with lock-screen controls (`expo-audio`).

### Added the same day
| Part | Where |
|---|---|
| **Encrypted pushes**: each phone makes a 256-bit key (`pushKey`), sent at registration over HTTPS and kept sealed on the server; chat pushes are AES-256-GCM, so Google carries only `{ type: "enc", iv, ct }`. Text is cut, then picture links dropped, to stay under 4 KB | `services/push-crypto.service.ts`, `push.service.ts` (`sealFor`, `fitForPush`); `PushCrypto.kt` |
| **Counting opens**: a tap opens `iemdating://chat/<id>?pushId=…` and the app reports it; Reply and Mark as read report themselves | `ChatNotifier.openChat`, `ChatActionReceiver.kt`; `responses.ts` `recordOpenFromUrl` |
| **Raise to ear**: proximity sensor while a voice message plays; at the ear the screen turns off and it continues through the earpiece at the same place, back to the speaker when lowered | `Earpiece.kt`; `MessageBubble.tsx` (VoicePlayerBubble) |
| **Share sheet**: text and pictures from other apps - "Share to <name>" per chat (shortcut category + `chat_share_targets.xml`), or to the app and pick a chat; it lands in the composer | `ShareIntake.kt`, `plugins/withShareTargets.js`, `SharePickerScreen.tsx`, `ChatScreen.tsx` |
| **Bubbles**: floating chat heads on Android 11+, for chats the person allows; the bubble runs just that chat (`ChatBubble` root), and anything else opens the full app | `ChatBubbleActivity.kt`, `ChatNotifier` (BubbleMetadata); `features/chat/bubble/ChatBubbleRoot.tsx`, `index.ts` |
| Tests (7) | `tests/chat-notifications.integration.test.ts` |

### Removed (2026-10-04)
- **Forwarding messages** - not something a dating app should have: a message is written to this person. The Forward menu item, the selection-bar button and the picker are gone, and the server refuses forwarded messages (`FORWARDING_NOT_AVAILABLE`).

### iPhone (section 16) - blocked, not built
Needs three things this project doesn't have yet: an **Apple Developer account** (99 USD/year), its **APNs key** (credential C5), and a **Mac or EAS cloud builds** to compile iOS. On iPhone the same experience needs a Notification Service Extension (pictures, decrypting pushes, edits) and Communication Notifications (sender photos) - native iOS code that can't be compiled or tested on Windows. Until then iPhones get the ready-made notifications (📷 / 🎤 lines), which already work through Expo.

### Still to try on a real phone
Bubbles depend on the phone's own settings (Settings → Apps → IEM Connect → Bubbles). Raise to ear depends on the phone having a proximity sensor.
