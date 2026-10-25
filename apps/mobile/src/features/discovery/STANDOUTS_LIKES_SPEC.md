# Likes You and Standouts: the second version

This document plans the next version of two surfaces reached from the Explore header: **Likes You** (the heart) and **Standouts** (the sparkles). Both exist in a first version, built under `EXPLORE_SPEC.md` sections 10–12. Section 1 lists what that version does and five defects found while reviewing it. The rest of the document says what changes and why.

Each behaviour is marked by where it comes from:

- **[source]**: stated in a published reference, listed at the end.
- **[convention]**: how an app behaves in current builds without a published spec.
- **[decision]**: a choice made for this app, with the reason given.
- **[found]**: a fact about this codebase, checked while writing this document.

Section 9 lists the decisions to confirm before building.

---

## Contents

1. [What exists today](#1-what-exists-today)
2. [Research: how other apps do it](#2-research-how-other-apps-do-it)
3. [Principles](#3-principles)
4. [Likes You](#4-likes-you)
5. [Standouts](#5-standouts)
6. [Server: data model and API](#6-server-data-model-and-api)
7. [App](#7-app)
8. [Privacy and safety](#8-privacy-and-safety)
9. [Decisions to confirm](#9-decisions-to-confirm)
10. [Build plan](#10-build-plan)
11. [Verification](#11-verification)
12. [Sources](#sources)

---

## 1. What exists today

| Surface | Server | App | Behaviour |
| --- | --- | --- | --- |
| Likes You | `LikesService.received`, `GET /discover/likes-you` | `LikesYouScreen`, reached from the heart in the Explore header | Everyone who liked you and whom you have not answered, 20 at a time, with Roses sorted first. Like back or Pass |
| Standouts | `StandoutsService.today`, `GET /discover/standouts` | `StandoutsScreen`, reached from the sparkles | Ten people a day, ordered by *your* compatibility, with a daily exposure cap per person in Redis. The only action is a Rose |
| Roses | `RoseService`, `GET /discover/roses` | `RoseSheet`, `useRoses` | 20 a week topped up (not accumulated), 5 a day, 1 per person per 30 days, with an optional comment of up to 140 characters |

### 1.1 Defects found in the first version **[found]**

| # | Defect | Effect |
| --- | --- | --- |
| **1** | **A Like can be listed but never answered.** `LikesService` lists every unanswered Like. But Liking back runs `SwipeService`, which checks full `mutuallyEligible` again: the current radius, fresh location, age range and "show me" choices. If the sender has since moved out of range, their location has gone stale, or either person changed preferences, the card stays on screen and Liking back fails with `PROFILE_UNAVAILABLE`. The app then puts the card back with "Couldn't save that". The screen's own promise, "Like them back and you match straight away", is false for these cards | A card that can never be answered, shown to exactly the people this screen is meant to reward |
| **2** | **"Roses first" only holds within one page.** Pages are cut by `createdAt`, and Roses are sorted to the top *after* the cut | A Rose older than the newest 20 Likes appears on page 2 or later, below ordinary Likes |
| **3** | **Nobody is told they were liked.** `NotificationService.sendLikeNotification` exists but nothing calls it. It would also **name the sender** in a push notification, which shows on a lock screen | A Like or Rose sits unseen until someone happens to open the heart. There is no count or badge anywhere |
| **4** | **The Rose comment has no filtering and no route to a report.** It is trimmed and stored as written. `EXPLORE_SPEC.md` section 10.3 said it would pass "the same abuse filters chat messages pass", but no text filter exists anywhere in the API | The one piece of free text a stranger can put in front of you is unfiltered and cannot be reported as a message |
| **5** | **A Standouts day lives only in Redis.** The day's set is cached in Redis and the exposure counts are Redis counters. If Redis restarts or evicts the key, the set is chosen again and every pick's exposure is counted twice | The set changes mid-day, and people are wrongly capped out of other readers' Standouts |

Two smaller gaps, not defects:

- The Rose comment is dropped at match time. It does not become part of the conversation it started.
- Standouts can include someone who has already liked you. That spends a Rose on a person who would have matched with an ordinary Like-back from Likes You.

---

## 2. Research: how other apps do it

### 2.1 Likes You

| App | Who sees it | Order | Expiry | Notes |
| --- | --- | --- | --- | --- |
| **Hinge** | Free users see one Like at a time; Hinge+ and HingeX see everyone at once **[source]** | Sort by **Recent** or **Your Type**, both free. Subscribers also get **Last Active** and **Nearby** **[source]** | Not documented | **Roses sit above everything, including Priority Likes**, with a Rose icon **[source]**. A Like is on a specific photo or prompt and can carry a comment **[source]**. A numbered badge sits on the Likes You tab **[source]** |
| **Tinder** | Gold and Platinum only; free users see a blurred grid **[source]** | Newest first | **Likes do not expire**, but likes from accounts inactive for 7–10 days stop being shown **[source]** | — |
| **Bumble** | Premium only; free users see blurred "Admirers" **[source]** | — | Beeline admirers **never expire**, but disappear when the account is deleted or snoozed **[source]** | — |

**The lesson.** Every app keeps a Like until it is answered, but none keeps showing a Like from someone who has gone quiet. Hinge makes ordering a free choice, and keeps Roses above everything whatever the sort. All three put a count on the entry point. Nobody names the person in a notification.

### 2.2 Standouts

| App | What it is | Chosen by | Reach | Refresh |
| --- | --- | --- | --- | --- |
| **Hinge Standouts** | A separate curated feed | People "most likely to like you back", within your preferences and dealbreakers, weighted towards those getting the most attention **[source]** | **Roses only**: an ordinary Like is not offered **[source]** | Daily, with a countdown on the first card. Someone may reappear in Discover on a later day, but not reliably **[source]** |
| **Tinder Top Picks** | About 10 "most compatible" profiles a day | Your swiping habits and profile **[source]** | Free users get one pick a day; the rest are blurred until the set refreshes **[source]** | Every 24 hours **[source]** |

**The criticism.** Hinge's version is widely resented as **"rose jail"**. People say it takes the profiles they most want to see out of the free feed and puts them behind a scarce currency, and the hashtag has close to a million views. Hinge's CEO has had to deny that the app keeps an attractiveness score. **[source]** The resentment is aimed at two features: *attention* as a ranking input, and *withholding* people from the free feed.

---

## 3. Principles

**[decision]** These carry over from `EXPLORE_SPEC.md` and govern every choice below.

1. **Everything shown can be acted on.** A card whose action is certain to fail is a defect, not a design (defect 1).
2. **No popularity, anywhere.** Nothing shows or ranks by how many Likes or Roses someone has received. Inside one college, that number is a leaderboard of classmates.
3. **Standouts is an extra, never a jail.** It adds people chosen for you. It does not take them from the deck, and Liking them from the deck or Explore stays possible. That rules out the resented half of Hinge's design.
4. **Nothing names a person outside the app.** Notifications say *that* something happened, never *who*.
5. **Free.** There is no payment path, as `EXPLORE_SPEC.md` section 12 decided. Nothing is blurred.

---

## 4. Likes You

### 4.1 Who is listed: the Like-back rule

The fix for defect 1 is one rule that decides both **what is listed** and **what Liking back accepts**. The two can then never disagree. **[decision]**

A Like from **S** (the sender) is listed for **R** (the recipient), and R's Like back is accepted, when **all** of these hold:

| Rule | Checked against | Why |
| --- | --- | --- |
| Both accounts active and verified, at an active institution | Now | Nobody suspended, deleted or unverified is reachable |
| No block in either direction | Now | As everywhere |
| R has not already answered S, and there is no active match | Now | Answered Likes leave the list |
| R's **own current** "show me" categories and age range include S | Now | If R no longer wants to see that gender or age, the Like is not shown. R's preferences are R's to change |
| S was eligible for R when S Liked | **At the time of the Like**: already true, because the deck, Explore, Standouts and Search only offer a Like where `eligibleSql` holds | The Like crossed the geography and scope bar when it was made |
| S has been active in the last **30 days** | Now | Tinder's practice **[source]**. The Like is hidden, not deleted, and returns if S comes back |

And explicitly **not** re-checked:

- **Geography and location freshness.** People move every day. S's location going stale overnight, or S walking out of R's radius, must not delete a Like already given. The Like was made within range, and the match is what both people asked for.
- **S's preferences changed after the Like.** S chose R at the time. Re-reading S's later settings would silently withdraw Likes, and would tell R something about S's settings if R noticed the card vanish.

**The implementation.** One function, `likeBackAllowed(sender, recipient)`, holds this rule. It becomes `LikesService`'s SQL predicate. `SwipeService` also uses it in place of `mutuallyEligible` **only** when the reverse swipe is a Like. Every other swipe keeps full eligibility.

### 4.2 Order

Roses are fetched on their own, so they come first whatever the page (defect 2): **[decision]**

1. **Roses**, newest first, all of them, up to 50. There are at most 20 a week, so this is bounded.
2. **Likes**, in the chosen sort, paged with a cursor of `(sort key, id)`.

The two sorts are both free, following Hinge **[source]**:

| Sort | Order | Default |
| --- | --- | --- |
| **Recent** | Newest Like first | Yes |
| **Your type** | Your compatibility score, from the `publicProfile` score the deck uses | — |

**[decision]** There are no **Last active** or **Nearby** sorts. "Last active" turns the list into a presence display that `show_online_status` is meant to control. "Nearby" is distance, which Search already refuses to show for the same reason (`SEARCH_SPEC.md` 5.4).

### 4.3 Answering

| Action | Result |
| --- | --- |
| **Like back** | Always a match, because the rule in 4.1 guarantees the swipe is accepted |
| **Like back with a Rose** | Not offered. They already liked you, so a Rose would be spent on a certain match **[decision]** |
| **Pass** | The Like leaves the list. The sender is told nothing. Their Like never turns into a match |
| **Report / Block** | From the profile, as everywhere, plus a **Report this note** option on a Rose comment (section 4.5) |

**[decision] The Rose comment opens the chat.** When a Rose with a comment turns into a match, the comment becomes the conversation's first message, sent by the Rose's sender at the moment of the match, and labelled in the chat as sent with a Rose. This is Hinge's behaviour for a comment on a Like **[source]**. It gives the match somewhere to start, and it is what the sender meant the note to be.

### 4.4 Telling people they were liked

**Count and badge** **[decision]**:

- `GET /discover/likes-you/summary` returns `{ total, roses, unseen }`.
- The heart in the Explore header shows `unseen` as a dot, and a Rose turns the dot into a small Rose. Only whether there is something new is shown, never a large number. A large number turns into a popularity score read off your own screen.
- Opening Likes You marks everything up to now as seen, via `likes_seen_at` on the user.

**Push notifications** (defect 3) **[decision]**:

| Event | Push | Frequency |
| --- | --- | --- |
| Rose received | "Someone sent you a Rose" | Right away, at most 3 a day |
| Like received | "You have new Likes" | Batched: at most one every 6 hours, only if there are unseen Likes |
| Match | Unchanged | — |

- **Never the sender's name.** A lock screen is readable by the person next to you in a lecture hall. `sendLikeNotification`'s named body is removed.
- Batching goes through the existing outbox (`outbox.service`), so a burst of Likes is one push, not ten.
- A new setting, **Settings → Notifications → Likes**, can turn both off.

**Live** **[decision]**. Likes You and the heart's dot update while open. The server sends a bare `likes_changed` socket event, and the app re-reads through the same rules as the list itself, so the event can never say more than the list does. The event is sent when:

- a Like lands;
- one is answered on another of your devices;
- a block takes one away, in either direction.

Near the top of the list, the re-read is silent and a "1 new Like" chip shows for a moment. Scrolled down, a **New Likes** button waits instead, so the list never moves under your thumb.

**A Like shows only once its sender can no longer Rewind it** (`LIKE_GRACE_MS`, 61 seconds). Without this, a live list would show a Like appear and then vanish, telling the recipient that someone liked them and changed their mind. The live event and the push are scheduled for the same moment, through the outbox's `available_at`. A Like rewound inside the window is never seen by anyone.

### 4.5 The Rose comment (defect 4)

**[decision]** Since no text filter exists anywhere, the Rose comment gets the minimum a stranger's note needs:

| Control | Rule |
| --- | --- |
| Contact details | Refused when the note contains a phone number, e-mail address, URL, or `@handle`. Contact goes through a match, not around it |
| Blocked terms | A small built-in list of slurs and sexual terms, matched as whole words (and as words spelled out letter by letter), extendable without a release through the `NOTE_BLOCKED_TERMS` environment variable. `algorithm_config` holds numbers only, so it could not carry the list. A match refuses the Rose with `ROSE_COMMENT_REJECTED`, and **the Rose is not spent** |
| Report | **Report this note** on the Likes You card files a report with `sourceType: 'rose'` and `sourceId`, the Rose's id, through the existing moderation cases |

A matching filter for chat messages is out of scope here, but should reuse the same module when it is built.

---

## 5. Standouts

### 5.1 Who is chosen

The current rules stay: personalised, capped exposure, no counts, Rose only. The changes are marked. **[decision]**

| Rule | Status |
| --- | --- |
| From the reader's own eligible pool (`eligibleSql`) | Unchanged |
| Ranked by the reader's compatibility, with recent activity as a tie-break | Unchanged |
| **Plus a reciprocity term**: how likely they are to Like *you* back, from `ReciprocityService`, the model the deck already uses | **New.** This is Hinge's actual criterion, "most likely to like you back" **[source]**. A Rose to someone who is unlikely to answer is a wasted Rose |
| **Never the attention a person receives** | Unchanged. It is the source of both the leaderboard problem and "rose jail" |
| **Excludes anyone who has already liked you** | **New.** They are in Likes You, where Liking back is free and certain. Spending a Rose on them is a trap |
| **Excludes anyone shown in your Standouts in the last 7 days** | **New.** The set is new each day rather than the same top ten from the same ordering |
| Excludes anyone you have swiped on or matched with | Unchanged |
| Daily exposure cap: one person appears in at most 12 readers' Standouts per day | Unchanged in value; **moved from Redis to the database** (5.3) |

### 5.2 Size, and small colleges

- 10 a day. **[decision]** A pool of fewer than **20** eligible people gives a proportionally smaller set, with a minimum of **3**. Below 3, the screen shows *"Not enough people yet — check back as your college joins."* Ten Standouts drawn from a pool of twelve would be "everyone, again, but Rose-only", which is exactly the jail.
- The 7-day rule gives way before the set drops below 3. A small college still gets a set, with repeats where there is no one else.

### 5.3 A day that survives Redis (defect 5)

**[decision]** The day's set is a database row: `standout_days(viewer_id, day, picks uuid[], hidden uuid[])`, unique on `(viewer_id, day)`.

- Choosing and inserting happen together, so a second request that arrives mid-choice reads the first request's row (`INSERT ... ON CONFLICT DO NOTHING`, then read).
- **Exposure is counted from the rows**: `count(*) WHERE day = today AND id = ANY(picks)`, backed by a GIN index on `picks`. Nothing is counted twice, because each row is written once.
- Redis is no longer involved: the row is read by its primary key, which is as cheap as the cache was.
- A reader's rows older than 8 days are deleted when their next day is written, since the 7-day rule needs a week of history. No sweep job is needed.

### 5.4 Acting on a Standout

| Action | Result |
| --- | --- |
| **Rose** | As today. The card is marked **Rose sent** for the rest of the day rather than vanishing, so the set does not look like it shrank |
| **Not for me** | **New.** Hides the card for the day by adding it to `hidden`. **It is not a Pass**: it records no swipe and changes nothing the person could ever notice. The deck can still show them |
| **Out of Roses** | The cards stay visible. The Rose button reads "Next Roses in 3 days" and is disabled. Hiding the set would make Standouts feel like a paywall |

**Why this person.** Each card carries up to two reasons from the existing `matchFactors`, such as "3 shared interests" or "Same department". **[decision]** The reasons are only ever things about the two of you, never about how others behave towards them.

**The refresh countdown.** "New Standouts in 5 h", from `refreshesInSeconds`, which the server already returns, following Hinge **[source]**.

### 5.5 Standouts and the deck

**[decision] A Standout is not removed from the deck or Explore.** This is the line between this app and "rose jail" **[source]**. If a person you would have seen in the deck also appears in Standouts, you can still Like them in the deck for free. Standouts only *adds* a Rose-worthy shortlist. `EXPLORE_SPEC.md` section 14.1 already made the server side of this decision; this document makes it the rule rather than a deviation.

---

## 6. Server: data model and API

### 6.1 Data model

```prisma
model User {
  // ...
  /// Everything in Likes You before this is "seen" (section 4.4).
  likesSeenAt        DateTime? @map("likes_seen_at")
  /// Push for Likes and Roses (section 4.4).
  notifyLikes        Boolean   @default(true) @map("notify_likes")
  likesPushedAt      DateTime? @map("likes_pushed_at")
}

/// One reader's Standouts for one day (section 5.3).
model StandoutDay {
  viewerId  String   @map("viewer_id") @db.Uuid
  day       String   @db.VarChar(10)          // IST calendar day, as istDay()
  picks     String[] @db.Uuid
  hidden    String[] @default([]) @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  @@id([viewerId, day])
  @@index([day])
  @@map("standout_days")
}
```

In the migration, applied in SQL: `CREATE INDEX standout_days_picks_idx ON standout_days USING GIN (picks);`

### 6.2 API

| Route | Change |
| --- | --- |
| `GET /discover/likes-you?sort=recent\|type&cursor=` | Rule 4.1 in SQL. Returns `{ roses: [...], likes: [...], nextCursor }`, with `roses` only on the first page. Each card keeps `isRose`, adds `roseId`, and keeps `roseComment` |
| `GET /discover/likes-you/summary` | **New.** `{ total, roses, unseen, unseenRoses }` |
| `POST /discover/likes-you/seen` | **New.** Sets `likes_seen_at = now()` |
| `POST /discover/swipe` | A Like back on an incoming Like uses `likeBackAllowed` (4.1). A Rose comment passes the filter (4.5). On a match, the Rose comment becomes the first message (4.3) |
| `GET /discover/standouts` | Reads or writes `standout_days`. Each card gains `reasons: string[]` and `roseSent: boolean` |
| `POST /discover/standouts/:userId/hide` | **New.** "Not for me" (5.4) |
| `POST /safety/report` | Accepts `sourceType: 'rose'` |

### 6.3 Performance

- Likes You needs an index on `swipes(target_id, action, created_at DESC)`. It must be checked in the migration and added if missing.
- The "has R answered S" check becomes a `NOT EXISTS` in SQL, replacing the current list of every swipe R has ever made, which is loaded into memory on each request and grows without bound.
- Blocks move into the query the same way.

---

## 7. App

### 7.1 Likes You screen

- **Header:** "Likes you", then a **Recent / Your type** segmented control.
- **Roses** section first, when there are any. Each card shows a Rose icon and the note as a speech bubble under the photo, with **Report this note** in its menu.
- **Likes** follow in a 2-column grid, as today, with infinite scroll.
- Profile opens with the existing photo transition (`ProfileDetailModal`, `transition="photo"`), with **Like back** and **Pass**. There is no Rose button (4.3).
- **A failed answer never re-inserts the card.** With rule 4.1 a failure can only be a network error, so the app shows a retry on the card itself instead of the current re-insert, which can duplicate a card.
- **Empty:** "No new Likes yet. Likes show up here as soon as they arrive."
- Opening the screen calls `/likes-you/seen`.

### 7.2 Standouts screen

- **Header:** "Standouts", then "New in 5 h" and the Rose balance.
- **Cards:** each shows its reasons as chips, **Rose** as the main action, and **Not for me** in the corner.
- A Rose sent marks the card rather than removing it.
- Out of Roses: the cards stay, and the button is disabled with its refresh date.
- A small-college state as in 5.2.

### 7.3 Entry points

**[decision]** Each surface sits beside what it belongs with. The bottom tab bar is not touched.

- **Likes You is the first tab of Matches**: "Likes you" and "Matches". A Like is a match waiting to happen, so the two sit side by side, as on Hinge and Bumble.
  - The tab shows how many Likes are waiting.
  - The number turns coloured when some are new, and rose-coloured when a Rose is among them.
  - It updates live.
  - Pushes open it at `iemdating://main/matches?tab=likes`. The old `likes-you` route still works for notifications already sent.
- **Standouts is a button on the swipe deck** (the Explore tab), since both are people picked for you.
- **Browse** (the Search tab, formerly headed "Explore") keeps only Map and Filters in its header, which removes the overflow that cut off its fourth button.

### 7.4 Demo

Development builds only, following Search and the map. A **Demo** pill in each screen's header switches to local data built from `demoProfiles`. Nothing is sent.

- **Likes You:** two Roses, one with a note and one without, and four Likes. Both sorts work. Like back gives the match alert, Pass removes the card, and Report on the note shows the report sheet.
- **Standouts:** a set of six with reasons, one already marked **Rose sent**, and a toggle that shows the out-of-Roses state and the small-college state.

---

## 8. Privacy and safety

- **No popularity surface.** There are no counts of Likes or Roses received beyond an "unseen" dot, and attention received is never a ranking input.
- **Notifications never name anyone**, and batched Likes cannot be matched to a time (4.4).
- **The sender learns nothing** from a Pass, from "Not for me", or from being hidden by the 30-day inactivity rule.
- **No distance or presence** in either screen or sort (4.2).
- **The Rose note** is filtered, reportable, and cannot carry contact details (4.5).
- **Blocks apply both ways**, in SQL, on both screens.
- **Standouts is not a jail:** nobody is withheld from the free deck (5.5).

---

## 9. Decisions to confirm

| # | Question | Recommendation |
| --- | --- | --- |
| **1** | **Should Liking back skip the geography re-check (4.1)?** It is what makes every listed Like answerable | **Yes.** The Like was made in range; people move |
| 2 | Hide Likes from accounts inactive for 30 days? | Yes, hidden rather than deleted (Tinder uses 7–10 days) |
| 3 | Should a Rose comment become the first chat message on a match? | Yes |
| 4 | Sorts: Recent and Your type only, with no Last active or Nearby? | Yes |
| 5 | Push notifications: Rose right away without a name, Likes batched every 6 hours? | Yes, with a setting to turn them off |
| 6 | Show an unseen dot rather than a count on the heart? | Yes |
| 7 | Leave people who already liked you out of Standouts? | Yes |
| 8 | A 7-day no-repeat rule in Standouts, and a smaller set for small colleges? | Yes |
| **9** | **Should a Standout stay likeable, free, from the deck and Explore?** | **Yes.** This is the line against "rose jail" |
| 10 | Add "Not for me" to Standouts, which is not a Pass? | Yes |
| 11 | A contact-details and blocked-terms filter on Rose notes, with the Rose not spent on refusal? | Yes |

---

## 10. Build plan

| Phase | Scope |
| --- | --- |
| **A. Likes You correctness** | `likeBackAllowed` shared by `LikesService` and `SwipeService`; Likes You in SQL (answered, blocks and 30-day inactivity as `NOT EXISTS`); Roses fetched on their own; `(key, id)` cursor; `sort=type`; the index check (defects 1 and 2) |
| **B. Being told** | `likes_seen_at`, `/summary`, `/seen`; the header dot; batched, unnamed pushes through the outbox; the notification setting (defect 3) |
| **C. The Rose note** | The contact-details and blocked-terms filter before spending; `sourceType: 'rose'` reports; the note as the first message on a match (defect 4) |
| **D. Standouts** | `standout_days` with the migration and GIN index; exposure from rows; the liked-you and 7-day exclusions; the reciprocity term; small-college sizing; reasons; `roseSent`; "Not for me"; the out-of-Roses state (defect 5) |
| **E. Screens and demo** | Both screens as in section 7; the demo pill on each |

A and C fix defects users can already hit, so they come first. D does not depend on A, B or C.

### 10.1 Implementation status

**All five phases are built, and verified against the local database.**

| Phase | Where |
| --- | --- |
| A | `likeBackAllowed` and `likeBackSql` in `eligibility.service.ts`, beside `mutuallyEligible` and `eligibleSql`. `SwipeService` accepts a Like back under the Like-back rule **in addition to** full eligibility, so nothing accepted before is refused now. `LikesService` rewritten in SQL, with Roses read separately, a keyset cursor for Recent, and an offset cursor over the 200 newest for Your type. The index it needs (`swipes_incoming_order_idx`) already existed |
| B | Migration `20260930100000_likes_standouts_v2` adds `likes_seen_at`, `notify_likes` and `likes_pushed_at`. Routes: `/likes-you/summary` and `/likes-you/seen`. The swipe enqueues `like.received`; `OutboxDeliveryService.deliverLikeReceived` sends unnamed pushes, with at most 3 Rose pushes a day and Likes batched by an atomic 6-hour claim. The named `sendLikeNotification` is deleted. App: a dot or Rose dot on the Explore heart, and Settings → Notifications → Likes and Roses |
| C | `note-safety.ts`, checked before the swipe transaction. `sourceType: 'rose'` reports, which only the recipient can file. `SwipeService.openWithRoseNote` writes the note as message 1 of the new match; `MessageBubble` labels it |
| D | `standout_days` with a GIN index on `picks`; exposure counted from rows; the liked-you and 7-day exclusions; the reciprocity term; small-college sizing; `reasons`; `roseSent`; `POST /standouts/:userId/hide` |
| E | `LikesYouScreen` and `StandoutsScreen` rewritten as in section 7, with a Demo pill on each (`demo/likesDemo.ts`). Standouts' demo also has **Out of Roses** and **Small college** toggles |

**Tests:** `npm run test:likes` (9 tests, new), plus `test:roses` (9) and `test:standouts` (11), both updated for the new shapes. All three are non-destructive. They also now remove the `like.received` outbox events about their own users, and `test:standouts` no longer clears every `standouts:*` Redis key.

---

## 11. Verification

**Server**: non-destructive tests that create their own users and remove them afterwards (`npm run test:likes`, and an extended `test:standouts`). **Never** use the truncating suites against the local database.

- **Answerable:** a Like whose sender has since moved out of radius, or whose location went stale, is listed **and** Liking back matches. A Like the recipient's own new preferences exclude is not listed, **and** a Like back to it is refused. The list and the swipe never disagree across a matrix of changed conditions.
- **Order:** 25 Likes followed by one Rose puts the Rose at the top of page 1. No card appears on two pages.
- **Inactivity:** a sender inactive for 31 days is hidden, and reappears once active.
- **Notifications:** ten Likes within an hour produce one push. No push body contains a name.
- **Rose note:** a phone number, e-mail, URL or blocked term is refused, and the balance is unchanged. An accepted note becomes the first message on a match.
- **Standouts:** clearing Redis mid-day returns the same set, and exposure counts stay the same. Someone who liked the reader never appears. Nobody repeats within 7 days while others are available. "Not for me" writes no swipe.
- **No leakage:** neither response contains counts of Likes or Roses received, distance, or presence.

**App**: type-check; a Babel compile check; each demo state.

**On device** (two accounts at the same college): A likes B, then A's location goes stale, and B still sees the Like and matches on Like back. A sends B a Rose with a note, and B's heart shows the Rose dot, the note leads the list, and the note is the first chat message after the match. A note with a phone number is refused, and A's Rose balance is unchanged.

---

## Sources

- [Hinge Roses: how they work and the weekly reset (SwipeStats)](https://www.swipestats.io/blog/hinge-roses)
- [Roses (Hinge Help Center)](https://help.hinge.co/hc/en-us/articles/36311177115027-Roses)
- [What is Standouts? (Hinge Help Center)](https://help.hinge.co/hc/en-us/articles/360057625534-What-is-Standouts)
- [Likes (Hinge Help Center)](https://help.hinge.co/hc/en-us/articles/36311632894995-Likes)
- [Subscriber Experience (Hinge Help Center)](https://help.hinge.co/hc/en-us/articles/36311764345107-Subscriber-Experience)
- [Hinge Standouts: what they are (VIDA Select)](https://www.vidaselect.com/hinge-standouts)
- [Hinge Standouts: how they work and when to send a Rose (Roast)](https://roast.dating/blog/hinge-standouts)
- [Hinge rose jail: how Standouts and Roses work (ProfileSharp)](https://profilesharp.com/en/blog/hinge-rose-jail-standouts-roses)
- [Hinge's CEO insists the app doesn't have an "attractiveness score" (Fortune)](https://fortune.com/2024/01/18/hinge-ceo-justin-mcleod-interview-attractiveness-score-algorithm-rose-jail)
- [How Hinge's algorithm decides who you date (Gizmodo)](https://gizmodo.com/hinge-dating-app-algorithm-1850744140)
- [Top Picks (Tinder Help Center)](https://www.help.tinder.com/hc/en-us/articles/360005039092-Top-Picks)
- [Tinder Picks explained (VIDA Select)](https://www.vidaselect.com/tinder-picks)
- [Do Tinder likes expire? (TinyGrab)](https://tinygrab.com/do-tinder-likes-expire/)
- [How long do Tinder likes last (Hollyland)](https://www.hollyland.com/blog/tips/how-long-does-tinder-likes-last)
- [How does the Beeline work on Bumble (Dude Hack)](https://dude-hack.com/how-does-the-beeline-work-on-bumble/)
- [How long does someone stay in your Beeline (Dude Hack)](https://dude-hack.com/how-long-does-someone-stay-in-your-beeline/)
