# Stories, Part 3: Your stories over time (Instagram parity)

This document covers what happens to a story after you post it: the private **Archive**, **saving to your phone**, the **viewer list after a story ends**, **Insights**, **replies and reactions in Activity**, and **Memories**. It starts with research into how Instagram behaves, then gives a detailed plan for this app.

- **Part 1**, creating a story: `STORY_CREATION_SPEC.md`.
- **Viewing** (tray, viewer, gestures, Activity sheet): `STORIES_SPEC.md`.
- **Part 2**, who can see and respond: `STORY_AUDIENCE_SPEC.md`. Every rule there still applies here.

**Highlights are deliberately not built.** Instagram's Highlights keep chosen stories permanently visible on your profile. On a dating app, permanently visible content that outlives the person's control of who's watching (Part 2's Close Friends and Hide settings apply inconsistently to Highlights even on Instagram itself, per the research below) is a worse fit than it is on a public social app. This was researched and then removed at the user's decision; section 16 records why.

Each behaviour is marked by where it comes from:

- **[source]**: stated in a published reference, listed at the end.
- **[convention]**: how Instagram behaves in current builds without a published spec, or where sources disagree.
- **[decision]**: a choice made for this app, with the reason given.

---

## Contents

1. [What exists today](#1-what-exists-today)
2. [Research: how Instagram does it](#2-research-how-instagram-does-it)
3. [A story's life, hour by hour](#3-a-storys-life-hour-by-hour)
4. [Archive](#4-archive)
5. [Saving to your phone](#5-saving-to-your-phone)
6. [Viewer list after a story ends](#6-viewer-list-after-a-story-ends)
7. [Insights](#7-insights)
8. [Replies and reactions in Activity](#8-replies-and-reactions-in-activity)
9. [Memories and sharing again](#9-memories-and-sharing-again)
10. [Server: data model](#10-server-data-model)
11. [Server: API](#11-server-api)
12. [Server: background jobs](#12-server-background-jobs)
13. [App: screens and components](#13-app-screens-and-components)
14. [Privacy and safety](#14-privacy-and-safety)
15. [Not applicable](#15-not-applicable)
16. [Build plan](#16-build-plan)
17. [Decisions](#17-decisions)
18. [Verification](#18-verification)
19. [Sources](#sources)

---

## 1. What exists today

| Area | Today | Where |
| --- | --- | --- |
| When a story ends | Nothing happens. The row stays with `expiresAt` in the past, and every read route filters it out | `story.service.ts`, `expiresAt: { gt: new Date() }` on each query |
| Story media | Never deleted after expiry. Only account deletion removes it | `account-lifecycle.service.ts` |
| Deleting | Soft delete: `state = 'deleted'`, `deletedAt` set. Media stays in S3 | `StoryService.remove` |
| Viewer list | `story_views`, one row per viewer, kept forever. The app can only open it on a live story | `viewersPage` |
| Likes | `story_likes`, one row per viewer | `StoryService.like` |
| Replies and quick reactions | Sent as chat messages, `type = 'story_reply'`, `storyId` set. A quick reaction is just a message whose text is the emoji; nothing marks it as a reaction | `StoryService.reply`, `StoryFooter` `QUICK_REACTIONS` |
| Sticker results | The owner can read them "a few days" after expiry | `StoryStickerService.results` |
| Saving | Only in the editor before sharing (`saveToDevice`, including edited video through the native module) | `StoryEditor.tsx` |
| Profiles | Your own: `ProfileScreen`. A match's: `ChatProfileScreen`. Discovery: `ProfileDetailModal` | |
| Archive, Insights, Memories | None | |

**Good news for Part 3:** because nothing is ever purged, every story already posted is still in the database and in S3. The Archive can show them from day one. **The risk:** nothing is ever purged, so people who never want their stories kept have no way to get that today (section 12 fixes it).

---

## 2. Research: how Instagram does it

### 2.1 Archive

- Stories are saved to your Archive automatically when they expire, unless you turn it off. **[source]**
- The Archive is private: only you can see it. Nobody else, including Close Friends. **[source]**
- Archived stories stay until you delete them. There is no automatic purge. **[source]**
- The setting is **Settings → Archiving and downloading → Save story to archive**. Turning it off affects future stories; what is already archived stays. **[source]**
- The Archive lists stories by date, with a **calendar** view to jump by month and year, and a **map** view by location. **[source]**
- From an archived story you can **share it again** as a new story, or **delete** it. On Instagram you can also add it to a Highlight; this app has no Highlights (see above), so that option is dropped. **[source]**
- A deleted story cannot be recovered. **[source]**

### 2.2 Saving to your phone

- On your own story: ⋯ → **Save** saves the photo or video. **[source]**
- **Save story to camera roll / gallery** in Archiving and downloading saves every story you post, automatically. **[source]**
- This is separate from the Archive, which is private and inside the app. **[source]**

### 2.3 The viewer list over time

- Who viewed a story is visible while it is live, then from the Archive until **48 hours after posting**. After that the names are gone for good. **[source]**
- After 48 hours the total counts remain in insights, but not the names. **[source]** One source says nothing remains, so the counts are **[convention]**.

### 2.4 Insights

Instagram groups story insights into three kinds. **[source]**

| Group | Metric | Definition |
| --- | --- | --- |
| Discovery | **Views** (impressions) | Times the story was shown, counting repeats. **[source]** |
| | **Accounts reached** | Unique accounts that saw it at least once. **[source]** |
| Navigation | **Forward** | Taps to go to the next story. **[source]** |
| | **Back** | Taps to go back to the previous story. **[source]** |
| | **Next story** | Swipes to the next account's stories. **[source]** |
| | **Exited** | Times someone left the stories from this story: swiping down, closing, or leaving the app. **[source]** |
| Interactions | **Replies** | People who replied. **[source]** |
| | **Likes** | People who liked it. **[source]** |
| | **Profile visits** | Profile views by people who watched this story. **[source]** |
| | **Sticker taps, link taps** | Interactions with stickers and links. **[source]** |
| | Follows, shares, website visits, address taps | Business and resharing metrics. **[source]** |

- Insights are for professional (creator and business) accounts. You see them by swiping up on your story, or from Insights on your profile. **[source]**
- In-app insights cover up to about 14 days. **[source]**
- A high forward and exit count suggests people are skipping; a high back count suggests they wanted a second look. **[source]**

**A correction to what I said earlier in chat:** I suggested counting a swipe to the next person as an exit. Instagram actually counts it separately, as **Next story**. The plan below follows Instagram.

### 2.5 Reactions and replies in Activity

- Quick emoji reactions and text replies arrive in the owner's Direct inbox. **[source]**
- In the viewer list, a viewer who reacted shows the emoji on their row, and a like shows a heart. **[source]** Another source says reactions appear only in DMs, so the row emoji is **[convention]**.
- Nobody but the owner can see who reacted or replied; there is no public count. **[source]**

### 2.6 Memories and sharing again

- **On This Day** resurfaces archived stories posted on the same date in earlier years, at the top of the Archive. **[source]**
- You can share a memory again as a new story. Instagram adds a date label showing when it was first posted. **[source]**

---

## 3. A story's life, hour by hour

One timeline, used by every section below. All times are from `publishedAt`.

| Time | What happens |
| --- | --- |
| 0 to 24 h | **Live.** In the tray for its audience. Views, likes, replies, sticker responses and insight events are recorded |
| 24 h | **Ends.** Leaves the tray. If the owner's archive was on when it was posted, it moves to the **Archive** |
| 24 to 48 h | The owner can still open the **viewer list** and responses, from the Archive |
| 48 h | **Counts are frozen** (section 6). Viewer names are removed. Insights stay as numbers |
| After 48 h | In the Archive until the owner deletes it |
| 72 h | If it was posted with the archive **off**, its media is deleted from S3 and the story is marked `purged` (section 12) |

**[decision]** The 72-hour purge gives the 48-hour viewer window plus a day of margin for the job to run.

---

## 4. Archive

### 4.1 What is in it

Your stories that have ended, were posted with the archive on, and were not deleted. Stories still live are not listed there; they are in your tray. **[source]**

**[decision]** Stories posted before Part 3 ships are all treated as archived, since the setting did not exist and nothing was ever removed. The first time the owner opens the Archive, nothing is surprising: everything they ever posted is there.

### 4.2 The setting

**Settings → Story → Save story to archive**, on by default. **[source]**

- The value is copied onto each story when it is posted (`stories.archive`). Changing the setting affects stories posted afterwards; what is already archived stays. **[source]**
- Turning it off shows: "Stories you post from now on will be deleted after they end." **[decision]**

### 4.3 The Archive screen

Reached from **Profile → ⋯ → Archive** and from **Story settings → Archive**.

- A grid of three columns, newest first, each tile a still of the story (the thumbnail, or the photo), with a date badge on the first story of each day ("17 Sep"). **[source]**
- A **Close Friends** tile keeps a small green star, so the owner remembers its audience. **[decision]**
- **Calendar** button: a month view with a dot on each day that has stories; tapping a day scrolls the grid there. **[source]**
- **On This Day** banner at the top when there are memories (section 9). **[source]**
- Paged by cursor, 60 at a time. Empty state: "Stories you share will be saved here after they end." **[decision]**

### 4.4 Opening an archived story

The same full-screen viewer as live stories, opened on the tapped story, able to move through the whole archive in date order.

- Header shows the date posted instead of "2h". **[convention]**
- No reply bar, no heart. **[source]**
- Bottom actions: **Activity** (only in the first 48 hours, then **Insights** only), **Share**, **More** (Save, Delete). **[convention]**
- Stickers render as posted. Poll, quiz and slider results show the final numbers. Countdowns show "Ended". **[decision]**
- Screenshot blocking does not apply: only the owner sees their archive. **[decision]**

### 4.5 Deleting from the Archive

"Delete this story? This can't be undone." **[convention]**

- Uses the existing soft delete.
- The media is removed by the purge job (section 12), not in the request, so a slow S3 call never fails the delete. **[decision]**
- Chat story cards for it read "Story unavailable", as they already do for deleted stories.

---

## 5. Saving to your phone

### 5.1 Save one story

On your own story, live or archived: **More → Save photo** or **Save video**. **[source]**

- Downloads the story's media file and saves it to the gallery with `expo-media-library`, asking for permission the first time, as `ImageModal` already does.
- **What is included:** everything drawn into the file when it was shared (text, drawing, GIFs, filters, music mixed into the video). **Interactive stickers are not included**, because the viewer draws them live on top of the file (polls, questions, countdowns, links, mentions). **[decision]** Rendering them into the saved file would need a server-side compositor for a small gain. The toast reads "Saved. Interactive stickers are not included." the first time only.

### 5.2 Save every story automatically

**Settings → Story → Save story to gallery**, off by default. **[source]**

- When on, the app saves each story to the gallery **at the moment it is shared**, from the file it just rendered, using the same code as the editor's save button. Nothing is downloaded again. **[decision]**
- If saving fails (permission denied, storage full), the story still posts, and a toast says "Posted, but could not save to your gallery". **[decision]**
- This setting is stored on the server with the other story settings, so it follows the account to a new phone. **[decision]**

---

## 6. Viewer list after a story ends

**[source]** Names are visible for 48 hours after posting; after that only numbers remain.

- **24 to 48 h:** the owner opens the story from the Archive and swipes up for the same Activity sheet as a live story: viewers, likes, replies and reactions (section 8), sticker responses. Row menus (Hide story, Close Friends, Remove follower, Message) keep working.
- **At 48 h**, the freeze job (section 12):
  1. Copies `reach` (count of `story_views`) and `likes` (count of `story_likes`) into `story_insights`.
  2. Deletes that story's `story_views` and `story_likes` rows. **[decision]** Instagram removes the names permanently; keeping rows that the app can no longer show would only be a privacy liability and a data-export surprise.
  3. Sets `stories.viewers_closed_at`.
- **After 48 h:** the Activity sheet shows only **Insights** (section 7), with "Viewer list is available for 48 hours" under the numbers.
- **Sticker results** (who voted what, question replies) follow the same 48-hour window for names; the totals are kept. **[decision]** Today they are kept "a few days"; this makes one rule for all personal data about who responded.

---

## 7. Insights

### 7.1 Who gets them

**Every account**, on its own stories only. **[decision]** Instagram limits insights to professional accounts; this app has no account types, and the numbers are useful to anyone.

### 7.2 The metrics

| Group | Metric | How it is counted here |
| --- | --- | --- |
| Discovery | **Accounts reached** | Unique viewers. `story_views` while live; frozen into `story_insights.reach` at 48 h |
| | **Views** | Every time the story became the one on screen, counting repeats by the same viewer |
| Navigation | **Forward** | Taps on the right side while this story was showing |
| | **Back** | Taps on the left side while this story was showing |
| | **Next story** | Swipes to the next person while this story was showing |
| | **Exited** | The viewer closed the viewer while this story was showing (section 7.3) |
| Interactions | **Replies** | Text replies sent from this story |
| | **Reactions** | Quick emoji reactions sent from this story |
| | **Likes** | People who liked it; frozen at 48 h |
| | **Sticker taps** | Poll votes, quiz answers, slider ratings, question replies, link taps, countdown reminders and Add Yours entries on this story, from the existing sticker tables |
| | **Profile visits** | Opening the owner's profile from this story. Recorded once "tap the name to open the profile" (Part 2, section 17.3) exists; shown as 0 until then |

**Not included:** follows, shares, website visits, address taps (section 15).

### 7.3 Exactly what counts as each navigation event

The viewer already has separate handlers for each gesture, so each maps to one event, on **the story showing when the gesture happened**, and only when the viewer is **not the owner**. **[source]** for the definitions; the mapping is **[decision]**.

| Gesture in `StoryViewerScreen` | Event |
| --- | --- |
| Tap right zone, including on the person's last story (which moves to the next person) | **forward** |
| Tap left zone, including on the person's first story (which moves to the previous person) | **back** |
| Horizontal swipe to the next person (cube) | **next story** |
| Horizontal swipe to the previous person | **exited** (the viewer left this person's stories without finishing them) |
| Swipe down, close button, Android back | **exited** |
| App sent to background, then the viewer is closed or the app is killed | **exited** once |
| Story finishes by itself and moves on | nothing (a completed view) |
| Last story of the last person finishes and the viewer closes itself | nothing |
| Long press to pause, opening Activity, typing a reply | nothing |
| Every time a story becomes the one showing | **view** +1 |

### 7.4 Sending events: batched, not per tap

Counting happens on the phone and goes to the server in small batches. **[decision]** A request per tap would be slow and wasteful.

- The viewer keeps a counter map in a ref: `storyId → { views, forward, back, nextStory, exited }`. No re-renders.
- It is sent:
  - when the viewer closes,
  - when the app goes to the background (`AppState`),
  - every 30 seconds while the viewer stays open, so a long session is not lost if the app is killed.
- Each batch has a client `batchId` (UUID). The server remembers it in Redis for 24 hours and ignores a repeat, so a retry after a timeout never double-counts. **[decision]**
- A batch that fails is kept in memory and merged into the next one; a batch that fails when the app is killed is lost. Losing a few taps is acceptable for these numbers. **[decision]**

### 7.5 Protecting the numbers

A user could script fake taps to make someone's story look bad or good. **[decision]**

- The server accepts events only for stories the sender **can currently see**, that are **live**, and **not their own**.
- Per viewer, per story, lifetime caps, kept in Redis: views 50, forward 50, back 50, next story 10, exited 10. Anything over is dropped silently.
- `storyInsightRateLimiter`: 60 batches a minute, at most 100 stories per batch.
- Numbers are always shown to the owner as they are; there are no percentages derived from tiny samples.

### 7.6 Storage

One row per story, `story_insights`, with counters incremented in a single `INSERT ... ON CONFLICT DO UPDATE SET views = story_insights.views + EXCLUDED.views, ...`. **[decision]** No row per tap or per viewer: the numbers are totals, and nobody sees who tapped. Reach and likes are computed live from their tables until the 48-hour freeze, then read from here.

Replies and reactions are counted in `StoryService.reply` at the moment they are sent, so they survive the sender unsending the message, as Instagram's counts do. **[convention]**

### 7.7 Retention

Insights are kept **as long as the story exists** (archived) and removed with it. **[decision]** Instagram shows about 14 days in the app, but a story here is only ever a handful of rows, and the owner may want to look back.

### 7.8 Where the owner sees them

**[decision]** Inside the existing **Activity sheet**, not a separate dashboard. Instagram shows the viewer list on swipe-up and fuller insights elsewhere; this app has no professional dashboard, and a sheet one swipe away is simpler.

The sheet gets a third tab: **Viewers · Responses · Insights**. After 48 hours only **Insights** remains.

The Insights tab, top to bottom:

```
Overview
  Accounts reached      42
  Views                 57

Navigation                         57
  Forward               12
  Back                   3
  Next story             5
  Exited                 8

Interactions                        9
  Replies                2
  Reactions              4
  Likes                  6
  Sticker taps           3
  Profile visits         0
```

Plain numbers, grouped with a total on each heading, matching Instagram's layout. **[source]** Numbers refresh when the tab opens and every 30 seconds while it stays open. For a story still live, a footnote: "Numbers update as people watch."

### 7.9 Demo mode

Demo stories show fixed sample insights and record nothing, like the rest of demo mode.

---

## 8. Replies and reactions in Activity

### 8.1 In the viewer list

Each viewer row already shows a heart when they liked the story. It also shows: **[source]** for reactions on the row is **[convention]**, see 2.5.

- the **emoji** of their most recent quick reaction to this story, on the right of the avatar;
- a **reply** icon (speech bubble) if they sent a text reply.

Tapping either opens the chat with that person, scrolled to the reply. **[decision]**

### 8.2 Telling a reaction from a reply

Today a quick reaction is just a message containing the emoji. **[decision]** The reply request gets a `kind`: `reaction` or `text`. The server accepts `reaction` only when the content is one of the eight quick reaction emoji, and stores it in the message metadata (`metadata.storyReplyKind`). Old replies without it are treated as text.

### 8.3 What the owner can see, and when

- Built from chat messages with `type = 'story_reply'` and this `storyId`, sent to the owner, **not deleted or unsent**. If the viewer unsends a reply, it disappears from the row. **[decision]** The Insights count does not go down (7.6).
- Only while the viewer list exists (48 hours), like the rest of the rows.
- The owner's story card in chat keeps working after the story ends (today it says "Story unavailable" once the story expires). **[decision]** It resolves for the owner while the story is archived. Otherwise it stays "Story unavailable".

---

## 9. Memories and sharing again

### 9.1 On This Day

- At the top of the Archive, when there are stories from **today's date in earlier years**: a banner "On this day" with the year and a thumbnail. **[source]**
- Tapping it opens those stories in the archive viewer.
- **No push notification** and nothing in the tray. **[decision]** A dating app should not surprise someone with an old story about an ex.

### 9.2 Share again

From an archived story or a memory: **Share** opens the story editor with the story's media as the background, the original interactive stickers **not** carried over, and a removable date sticker ("17 Sep 2025"). **[source]** for the date label.

- The media is downloaded from its signed URL into the cache, then treated like a gallery item.
- The new story is a normal story with its own audience choice, viewers and insights.
- **Only your own stories** can be shared again.

---

## 10. Server: data model

### 10.1 Changes to existing tables

```prisma
model User {
  // ...
  storyArchive       Boolean @default(true)  @map("story_archive")
  storySaveToGallery Boolean @default(false) @map("story_save_to_gallery")
}

model Story {
  // ...
  /// Whether it goes to the owner's archive when it ends. Copied from the setting at posting.
  archive         Boolean   @default(true) @map("archive")
  /// Set at 48 hours, when the viewer list is removed and the counts are frozen.
  viewersClosedAt DateTime? @map("viewers_closed_at")
  /// Set when the media is deleted after the story ended without being archived.
  purgedAt        DateTime? @map("purged_at")
  @@index([ownerId, state, expiresAt(sort: Desc), id])   // archive grid
  @@index([viewersClosedAt, expiresAt])                  // freeze job
}
```

`stories.state` gains the value `purged` alongside `published` and `deleted`.

### 10.2 New table

```prisma
/// Totals for one story. Nobody can see who produced them.
model StoryInsight {
  storyId        String @id @map("story_id") @db.Uuid
  views          Int    @default(0)
  forwardTaps    Int    @default(0) @map("forward_taps")
  backTaps       Int    @default(0) @map("back_taps")
  nextStory      Int    @default(0) @map("next_story")
  exits          Int    @default(0)
  replies        Int    @default(0)
  reactions      Int    @default(0)
  profileVisits  Int    @default(0) @map("profile_visits")
  /// Frozen at 48 hours from story_views and story_likes.
  reach          Int?
  likes          Int?
  stickerTaps    Int?   @map("sticker_taps")
  @@map("story_insights")
}
```

Check constraints in the migration: every counter `>= 0`; `state IN ('published', 'deleted', 'purged')`.

### 10.3 Visibility in one place

`StoryVisibilityService` gains `canSeeEnded(viewerId, story)`. With Highlights removed, an ended Story is private to its owner alone — the Archive promise in 2.1 ("only you can see it") holds even for someone who was in its live audience and knows its id, for example from an old chat story card. So this is simpler than `canSee`: `published` and `ownerId === viewerId`, nothing else. Archived media for the owner and the owner's own story cards use it. No route checks access on its own.

---

## 11. Server: API

All under `/stories`, authenticated. Owner-only routes return the same 404 as a missing story when called by anyone else, so they reveal nothing.

### 11.1 Archive (owner only)

| Route | Does |
| --- | --- |
| `GET /archive?cursor=&limit=60` | Ended, archived, not deleted stories, newest first: id, still URL, posted date, audience, content type |
| `GET /archive/calendar?month=2026-09` | Days in that month with a count of stories |
| `GET /archive/memories` | Stories from today's date in earlier years |
| `GET /:storyId` and `GET /:storyId/media` | Now also allow the **owner** to open their ended, archived story |

### 11.2 Insights and activity

| Route | Who | Does |
| --- | --- | --- |
| `POST /insights/events` | viewer | `{ batchId, events: [{ storyId, views, forward, back, nextStory, exited }] }`; rules in 7.5. Always returns `202`, even when items are dropped, so it reveals nothing about visibility |
| `GET /:storyId/insights` | owner | All metrics in section 7.2 |
| `GET /:storyId/viewers` | owner | Existing; each row gains `reaction` (emoji or null) and `replied` (boolean). Returns `{ closed: true }` with no rows after 48 hours |
| `POST /:storyId/reply` | viewer | Existing; accepts `kind: 'text' \| 'reaction'` |

### 11.3 Settings

`PUT /settings` accepts `archive` and `saveToGallery`, and `GET /settings` returns them.

### 11.4 Deleting and exporting accounts

`account-lifecycle.service.ts` deletes story insight rows, and the data export gains `insights` (numbers per story).

---

## 12. Server: background jobs

One worker, `story-lifecycle.worker.ts`, every 10 minutes, each step in batches of 200 with `FOR UPDATE SKIP LOCKED`, so two API instances never process the same story. **[decision]**

1. **Freeze at 48 hours:** stories with `viewersClosedAt IS NULL` and `publishedAt < now() - 48h`: in one transaction per story, write `reach`, `likes` and `stickerTaps` into `story_insights`, delete its `story_views`, `story_likes` and the per-viewer sticker rows (keeping the totals the results screen needs), set `viewersClosedAt`.
2. **Purge at 72 hours:** stories with `archive = false`, `state = 'published'`, `purgedAt IS NULL`, `publishedAt < now() - 72h`: delete the media and thumbnail from S3, then set `state = 'purged'`, `purgedAt`.
3. **Deleted stories:** `state = 'deleted'` with media still present: delete the media, set `purgedAt`.

S3 deletes happen before the database update, and a failed delete leaves the row for the next run, so no row ever claims media is gone when it is not. **[decision]**

**Before step 1 runs for the first time** on real data, it would remove viewer names from every story older than 48 hours at once. That matches Instagram and is intended, but it is irreversible, so it ships behind `STORY_LIFECYCLE_JOBS=1`, off by default, and is turned on only after you confirm.

---

## 13. App: screens and components

| Where | What |
| --- | --- |
| `features/stories/archive/ArchiveScreen.tsx` | Grid, calendar button, On This Day banner |
| `features/stories/archive/ArchiveCalendar.tsx` | Month view with dots |
| `features/stories/insights/storyInsights.ts` | The event counter map, batching, `AppState` flush, retry merge |
| `features/stories/insights/InsightsTab.tsx` | The third tab of the Activity sheet |
| `StoryViewerScreen.tsx` | A `mode`: `tray` or `archive`. Calls into `storyInsights.ts` from the existing tap, swipe and close handlers. Header, footer and menus per mode |
| `StoryActivitySheet.tsx` | Insights tab; reaction emoji and reply icon on rows; closed state after 48 hours |
| `StoryFooter.tsx` | Sends `kind: 'reaction'` for quick reactions |
| `postingStore.ts` | Saves to the gallery after a successful share when the setting is on |
| `settings/StorySettingsScreen.tsx` | "Save story to archive", "Save story to gallery", and an "Archive" row |
| `ProfileScreen.tsx` | Archive in the ⋯ menu |
| `chat/components/StoryReplyCard.tsx` | Resolves archived stories (8.3) |
| `RootNavigator.tsx` | `StoryArchive` route |
| `demoStories.ts` | A demo archive, sample insights |

The custom bottom navbar is not touched.

---

## 14. Privacy and safety

- **Viewer names are removed at 48 hours**, not merely hidden (6).
- **Insights are totals only.** Nobody, including the owner, can see who tapped forward or exited (7.6).
- **Reports:** an archived story can be reported from the viewer, through the existing story report, using `canSeeEnded`. The evidence snapshot is taken as today.
- **Memories never notify** (9.1).
- **Deleting your account** removes everything in this document (11.4).

---

## 15. Not applicable

| Instagram | Why not here |
| --- | --- |
| **Highlights** (permanent, profile-visible collections) | Removed by decision. A dating app profile should not accumulate a permanent public record that outlives who the poster currently wants watching; Instagram's own Close Friends/Hide rules for Highlights are inconsistent (2.1), which is a worse property to inherit here than on a general social app |
| Public accounts and profile-visible collections | Stories here are always limited to followers and matches |
| Archive map view | Most stories have no location; the calendar covers finding old stories |
| Sharing a story in a message | Stories cannot be sent in chat here (`STORIES_SPEC.md`, section 5) |
| Follows, shares, website visits and address taps in insights | No public profiles, no resharing of others' stories to chat, no business profiles |
| Professional dashboard and 14-day account insights | Per-story insights in the Activity sheet cover it (7.8) |

---

## 16. Build plan

Each phase works on its own and can be tested in demo mode.

| Phase | Scope |
| --- | --- |
| **A. Archive and settings** | Migration (10.1, `StoryInsight` table); archive setting copied at posting; `canSeeEnded`; archive, calendar and owner media routes; `ArchiveScreen`, calendar, archive viewer mode; Save story (5.1) and Save to gallery (5.2) |
| **B. Insights and Activity** | Event batching in the viewer; `POST /insights/events` with caps, dedupe and rate limit; reply `kind`; reply and reaction counters; `GET /:storyId/insights`; Insights tab; reaction and reply icons on viewer rows |
| **C. Lifecycle and Memories** | `story-lifecycle.worker.ts` behind `STORY_LIFECYCLE_JOBS` (freeze, purge, deleted media); closed viewer list state; On This Day; Share again with the date sticker; account deletion and export |

Phase C's freeze step is the only irreversible change, so it ships last and switched off.

### 16.1 Implementation status

**All three phases are built.**

| Area | Where |
| --- | --- |
| Migrations | `20260921000000_story_archive` (Phase A): `users.story_archive`/`story_save_to_gallery`, `stories.archive`/`viewers_closed_at`/`purged_at`, the `story_insights` table. `20260922000000_story_insights` (Phase B): a partial index on `messages(story_id, sender_id, sent_at)` for the reaction/reply row lookup |
| Visibility | `StoryVisibilityService.canSeeEnded`: owner-only for an ended Story, used by `StoryService.findForViewer` (`get`, `readUrl`) and `StoryReplyCardService.cards` |
| Archive | `StoryArchiveService` (list with cursor and optional `date`, calendar, memories); `StoryArchiveController`; routes under `/stories/archive*` |
| Insights | `StoryInsightService`: `POST /stories/insights/events` (Redis-deduped by `batchId`, per-viewer-per-Story caps via a Lua script, visibility-checked, always 202); `GET /:storyId/insights` (owner-only, live before the 48h freeze, frozen columns after - Phase C fills those); reply/reaction counters incremented in `StoryService.reply` |
| Reactions vs. replies | `StoryService.reply` takes `kind: 'text' \| 'reaction'`; a reaction must be one of `QUICK_STORY_REACTIONS`; stored as `metadata.storyReplyKind` on the chat message (`chat.service.ts`'s `story_reply` metadata whitelist extended); `StoryService.viewersPage` returns `reaction` (most recent, survives nothing - an unsend removes it) and `replied` per row |
| Settings | `archive` and `saveToGallery` added to `STORY_SETTINGS_SELECT`/`storySettingsOf`/`StoryService.settings`/the settings schema; copied onto each Story at publish time in both `StoryService.publish` and `StoryBatchService`'s real posting path |
| Cleanup | `account-lifecycle.service.ts` deletes `story_insights` rows and includes them in the data export |
| App | `ArchiveScreen`, `ArchiveCalendar`; two new switches and an Archive row in `StorySettingsScreen`; "Save photo"/"Save video" in the viewer's own-Story menu (`StoryViewerScreen.saveOwnStory`); automatic gallery save on publish (`postingStore.maybeSaveToGallery`, a simplification - see its comment: it re-fetches the Story's signed URL rather than reusing the native worker's rendered file); `storyInsights.ts`'s `StoryInsightTracker` (batched, flushed on close/backgrounding/every 30s) wired into every tap, swipe and close path in `StoryViewerScreen` per the section 7.3 table, including consolidating the Android back button through `close()` so it now also invalidates the tray cache, which it previously bypassed; a third **Insights** tab and reaction/reply row icons in `StoryActivitySheet` |
| Lifecycle worker | `StoryLifecycleWorker` (`story-lifecycle.worker.ts`), behind `STORY_LIFECYCLE_JOBS=1` (off by default): freezes a Story's viewer list and likes into `story_insights` 48 hours after it was published, `FOR UPDATE SKIP LOCKED` so two instances never race the same row; purges S3 media 72 hours after publishing for a Story posted with the archive off, and promptly (no wait) for a deleted Story. `StoryService.viewersPage` and `StoryInsightService.get` both report `closed: true` once frozen, rather than an empty list reading the same as "nobody has viewed it yet" |
| Closed state in the app | `StoryActivitySheet` drops the Viewers tab once `viewersClosed` is true (threaded from `loadViewers`'s response) and moves off it to Insights if it was open; `InsightsTab`'s footnote already said the right thing from Phase B |
| Memories | The "On this day" banner (already built in Phase A) now has something to show once a Story is over a year old; unchanged in this phase |
| Share again | A new `ShareAgainPreset` on `StoryCreator`: downloads the archived Story's own media (not a small reshare card - the full background), imports it exactly as a camera or gallery photo/video would be, and adds a removable date-sticker text layer with the original post date. Reached from "Share again" in the viewer's own-Story menu, offered only once a Story has ended |
| Also fixed while in this code | Deleting your own Story now asks "Delete this story? This can't be undone." first - it previously deleted on a single tap, live or archived; the header shows the date posted instead of a relative time once a Story has ended |
| Tests | `npm run test:story-lifecycle` (8 tests, non-destructive - runs `sweep()` directly against real backdated test data, bypassing the flag that only gates the timer); the other three suites (25 tests) still pass unchanged. 33 tests total across all of Part 3 |
| Scope cuts, disclosed | The freeze job does not reduce sticker interactions (poll votes, question replies, link taps, Add Yours entries, Reveal unlocks) to anonymous totals - `StoryStickerService.results` keeps showing real names past 48 hours, so the Responses tab (when a Story has any) stays visible past the freeze even though section 6's summary bullet says "only Insights" remains; only the Insights `stickerTaps` total is frozen. Demo mode still shows no Insights tab. "Profile visits" stays 0 until Part 2's "tap the name to open the profile" exists |

---

## 17. Decisions

All accepted as recommended:

| # | Question | Decision |
| --- | --- | --- |
| — | Highlights | **Removed entirely**, at your instruction — a dating app should not keep a permanent, profile-visible collection of old stories |
| 1 | Remove viewer names at 48 hours (deleting the rows)? | Yes, but the job ships switched off until you explicitly turn it on |
| 2 | Delete media of stories posted with the archive off, 72 hours after posting? | Yes |
| 3 | Existing stories from before Part 3 | All treated as archived |
| 4 | Insights for every account? | Yes |
| 5 | Keep insights as long as the story exists? | Yes |
| 6 | On This Day notifications? | No, only a banner in the Archive |
| 7 | Interactive stickers in a saved story file? | Not included, with a one-time note |

---

## 18. Verification

**Server:** non-destructive integration tests that create their own users and remove only them (`npm run test:story-archive`). Never run `test:chat-regression`.

- **Archive:** only the owner can list or open archived stories; `archive = false` stories are not listed; deleted stories are not listed; calendar and memories dates are correct across time zones (IST).
- **Insights:** events for someone else's story you cannot see, your own story, or an ended story are dropped with `202`; a repeated `batchId` changes nothing; caps hold; counters add up under concurrent batches.
- **Replies:** `kind: 'reaction'` with a non-reaction emoji is refused; an unsent reply disappears from the row but not from the count.
- **Lifecycle:** with the flag on and a clock set forward, the freeze writes the right totals and removes rows; purge deletes S3 objects only for stories that are not archived; a failing S3 call leaves the row untouched; two workers running at once never process the same story.

**App:** type-check; unit tests for the gesture-to-event mapping in 7.3, batch merge after a failed send.

**On device (two accounts):**

- Post a story, wait for it to end (or use a short test expiry): it appears in the Archive, not in the tray.
- As a match, watch it from the tray: tap forward twice, back once, swipe to the next person. Your Insights tab shows Forward 2, Back 1, Next story 1, Views as expected.
- React with 🔥: it arrives in chat with the story card, and the viewer row shows 🔥.
- Save a story to the phone: the file is in the gallery. Turn on Save story to gallery and share: it is saved automatically.
- Delete a story from the Archive: it is gone, and the chat story card reads "Story unavailable".
- Turn the archive setting off, post, wait past 72 hours (test clock): the media is gone and the Archive no longer lists it.

---

## Sources

- [Introducing Stories Highlights and Stories Archive (About Instagram)](https://about.instagram.com/blog/announcements/introducing-stories-highlights-and-stories-archive)
- [View insights on your Instagram Stories (Instagram Help Center)](https://help.instagram.com/383939598845756/)
- [Save your Instagram story to your device's camera roll (Instagram Help Center)](https://help.instagram.com/142167909546084/)
- [Instagram Story Archive: who can see it (PeekStories)](https://peekstories.com/blog/instagram-story-archive-who-can-see-it-2026)
- [What happens to Instagram stories after 24 hours (PeekStories)](https://peekstories.com/blog/what-happens-to-instagram-stories-after-24-hours-2026)
- [Why did my Instagram story viewer list disappear? (ViewIGStory)](https://www.view-ig-story.com/blog/instagram-story-viewer-list-disappeared)
- [Can you see who viewed your Instagram story after 24 hours? (FANS)](https://fans.walter-labs.com/blog/can-you-see-who-viewed-your-instagram-story-after-24-hours/)
- [How to see who viewed your Instagram stories (InstaPV)](https://instapviewer.com/blog/how-to-see-who-viewed-your-instagram-stories)
- [How to save stories on Instagram, 2026 (Quso)](https://quso.ai/blog/how-to-save-stories-on-instagram)
- [Instagram Archive: what it is and how it works (Inspire to Thrive)](https://inspiretothrive.com/instagram-archive/)
- [How to save Instagram stories, 2026 (SocialRails)](https://socialrails.com/blog/how-to-save-instagram-stories)
- [Instagram Memories: On This Day (SocialRails)](https://socialrails.com/blog/instagram-memories-complete-guide)
- [How to find an old Instagram story, 2026 (Zeely)](https://zeely.ai/blog/how-to-find-old-instagram-story/)
- [Instagram story analytics: metrics that matter (Hootsuite)](https://blog.hootsuite.com/instagram-stories-analytics/)
- [Instagram Stories analytics guide, 2026 (Dash Social)](https://www.dashsocial.com/blog/instagram-stories-analytics)
- [Instagram story analytics explained (Later)](https://later.com/blog/instagram-stories-analytics/)
- [Instagram Stories metrics to measure in 2026 (Metricool)](https://metricool.com/instagram-stories-metrics/)
- [Instagram Insights definitions (Rival IQ)](https://help.rivaliq.com/en/articles/1747069-instagram-insights-definitions)
- [What "Exited" means on Instagram (The Enterprise World)](https://theenterprisew.medium.com/what-does-exited-metric-mean-on-instagram-80d6572363f2)
- [What does forward mean on Instagram stories (Zeely)](https://zeely.ai/blog/what-does-forward-mean-on-instagram-stories/)
- [How to react on an Instagram story (InstantDM)](https://instantdm.com/blog/how-to-react-on-instagram-story)
- [Can others see my Instagram story reaction? (ViewIGStory)](https://www.view-ig-story.com/blog/can-others-see-my-instagram-story-reaction)
- [Instagram tests new emoji reactions for Stories (Refinery29)](https://www.refinery29.com/en-us/2018/07/205461/instagram-stories-reactions-emoji)
