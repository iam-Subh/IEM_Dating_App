# Stories, Part 2: Who can see and respond (Instagram parity)

This document specifies who can see a story, who can respond to it, and the controls a person has over both: the audience chosen when sharing, Close Friends, hiding your story from people, reply and mention controls, resharing, muting, and screenshot protection. It also defines how the server enforces every rule, on every route.

- **Part 1**, creating a story: `STORY_CREATION_SPEC.md`.
- **Viewing** (tray, viewer, gestures, Activity sheet): `STORIES_SPEC.md`.
- **Part 3**, your own stories over time (Archive, insights, replies in Activity — no Highlights, by decision): `STORY_ARCHIVE_SPEC.md`.

Each behaviour is marked by where it comes from:

- **[source]**: stated in a published reference, listed at the end.
- **[convention]**: how Instagram behaves in current builds without a published spec.
- **[decision]**: a choice made for this app, with the reason given.

---

## Contents

1. [How visibility works today](#1-how-visibility-works-today)
2. [The audience model](#2-the-audience-model)
3. [Choosing the audience when sharing](#3-choosing-the-audience-when-sharing)
4. [Close Friends](#4-close-friends)
5. [Hide story from](#5-hide-story-from)
6. [Replies and reactions](#6-replies-and-reactions)
7. [Mentions and resharing](#7-mentions-and-resharing)
8. [Muting and unmuting](#8-muting-and-unmuting)
9. [Followers](#9-followers)
10. [Screenshot protection](#10-screenshot-protection)
11. [Story settings screen](#11-story-settings-screen)
12. [How every feature respects the audience](#12-how-every-feature-respects-the-audience)
13. [Server: data model and API](#13-server-data-model-and-api)
14. [App: screens and components](#14-app-screens-and-components)
15. [Limits](#15-limits)
16. [Safety for a college dating app](#16-safety-for-a-college-dating-app)
17. [Not applicable, and what is left for Part 3](#17-not-applicable-and-what-is-left-for-part-3)
18. [Build plan](#18-build-plan)
19. [Verification](#19-verification)
20. [Sources](#sources)

---

## 1. How visibility works today

What the code does now, so each change below is clear.

| Rule | Today | Where |
| --- | --- | --- |
| Who sees your stories | **Accepted followers only.** A match who does not follow you cannot see them | `StoryService.canView`, `visibleOwnerIds` |
| Following | A request the other person accepts. Both must be verified at the same college, the followee must have Stories on and allow follow requests, and they must be eligible for each other or already matched | `FollowService.requireAllowedPair` |
| Blocks | Either direction hides everything | `canView`, `visibleOwnerIds` |
| Muting | Hides an author from your tray. There is no way to unmute in the app | `PUT /stories/authors/:id/mute`, viewer menu |
| Replies and reactions | Only between active matches, delivered into their chat | `StoryService.reply` |
| Mentions | Anyone who follows you, you follow, or you have matched with | `StoryStickerService.mentionableIds` |
| The `audience` column | Exists on `stories`, always `followers`, never read | `schema.prisma` |
| Close Friends, hiding, reply settings, screenshot blocking | None | — |

**A gap in today's rules:** a match who does not follow you can be mentioned, and gets the "mentioned you" notification, but the story then fails to open for them. Section 2 closes it.

---

## 2. The audience model

### 2.1 Who is in your audience

| Audience | Who sees it | Basis |
| --- | --- | --- |
| **Your story** | Everyone who **follows you (accepted)** plus everyone you have an **active match** with | [decision] |
| **Close Friends** | Only people on your Close Friends list who are also in "Your story" | [source: list-only; decision: must also be a follower or match] |

**Why matches are included [decision]:** following needs a request and an accept, but a match is already a mutual yes. Someone you matched with expects to see your stories, and Reveal and Add Yours are designed around matches. When a match ends, that person loses access at once, unless they also follow you.

**Why Close Friends members must also be in "Your story" [decision]:** if someone unfollows you or unmatches, they should not keep seeing your private stories because they were once on the list. Their row stays on the list, inactive, and works again if they follow or match again.

### 2.2 The visibility rule

A viewer **V** may see story **S** owned by **O** when all of these hold:

1. S is published, not deleted, and not expired.
2. O's account is active and O has Stories on.
3. V is O, **or** V follows O (accepted) **or** V and O have an active match.
4. No block exists between V and O, in either direction.
5. V is **not** on O's "Hide story from" list.
6. If S's audience is `close_friends`: V is O, or V is on O's Close Friends list.

Muting is **not** part of this rule. A muted author's stories are left out of your tray, but can still be opened from their profile or a link (section 8).

The rule is evaluated **when the story is read**, not when it is posted, so a list change applies to stories already live. [decision; Instagram applies "Hide story from" to active stories: source]

### 2.3 Not revealing what you cannot see

- A story the viewer may not see returns the same `404 STORY_UNAVAILABLE` as a story that does not exist. Nothing distinguishes "hidden from you" from "deleted". [decision]
- The tray never counts, rings or preloads stories the viewer may not see. A person whose only live stories are Close Friends stories you are not in shows **no ring at all**. [source]
- Nobody is told when they are added to or removed from Close Friends, or hidden from a story. [source]

---

## 3. Choosing the audience when sharing

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Two share buttons | The editor's bottom bar has **Your story** (white pill, your avatar) and **Close Friends** (green pill with a white star) side by side | [convention] |
| First use | With an empty Close Friends list, tapping **Close Friends** opens the list editor first. After Done it returns to the editor, and the person taps again to share | [convention] |
| Edit the list | A long press on **Close Friends** opens the list editor without sharing | [decision] |
| Several items | All items shared together use the same audience | [decision] |
| After posting | A story's audience cannot be changed. Delete and post again instead | [convention] |
| Drafts | A draft does not store an audience. It is chosen when shared | [decision] |
| Posting ring | The tray's posting ring is green while a Close Friends share uploads | [decision] |
| Add Yours from a Close Friends story | Joining opens the camera as usual; the joiner picks their own audience | [convention] |
| Reshare of a mention (Part 1) | The new story's audience is picked normally | [convention] |

---

## 4. Close Friends

### 4.1 The list

| Behaviour | Detail | Basis |
| --- | --- | --- |
| One list per person | A single list used by every Close Friends story | [source] |
| Private | Only its owner can see who is on it. The API never returns another person's list | [source] |
| No notification | Adding and removing are silent | [source] |
| Who can be added | People in your "Your story" audience (followers and matches), not blocked either way | [decision] |
| Size | No limit, as on Instagram | [source] |
| Where to edit | Story settings → Close Friends; long press the share button; a viewer row's menu (section 5.2) | [source: settings; convention: others] |

### 4.2 The list editor

| Part | Detail | Basis |
| --- | --- | --- |
| Header | "Close Friends" with a back arrow; the count ("12 people") under it | [convention] |
| Explanation | "Only people on your list can see stories you share to Close Friends. Nobody is notified when you change your list." | [source: behaviour; convention: wording] |
| Search | A search field over followers and matches, by name | [source] |
| Rows | Avatar, name, and a round check on the right: empty grey ring, or filled green with a white tick | [convention] |
| Order | People already on the list first, then everyone else, most recently interacted first (matched, followed, or viewed your stories) | [convention] |
| Label | A small "Match" label under a match's name, so the person knows who they are adding | [decision] |
| Saving | Each tap saves at once; the tick changes immediately and rolls back with a toast if the request fails | [decision] |
| Clear | "Clear list" at the bottom, with a confirmation | [decision] |
| Empty | "Nobody here yet. Follow people or match to add them." | [decision] |

### 4.3 What viewers on the list see

| Place | Detail | Basis |
| --- | --- | --- |
| Tray ring | A **solid green ring** (`#1DBF3A`) instead of the gradient while any unseen story from that person is a Close Friends story. Seen stories give the usual grey ring | [source: green ring; convention: mixed groups] |
| Tray order | People with an **unseen Close Friends story come first**, before other unseen stories, then everyone else in today's order (unseen by newest, then fully seen). Your own story stays first of all | [decision] |
| Why | Instagram publishes no Close Friends boost: its tray is ranked by how close two people are and by recency, which usually puts these first anyway. Here the rule is explicit, since a private story is the one you least want to miss | [source: ranking; decision: explicit rule] |
| Inside a person | Their stories stay in the order posted, Close Friends ones among them | [convention] |
| Viewer header | A green pill with a white star and "Close Friends" beside the name and time, only on Close Friends stories | [source: star badge] |
| Progress bar | Unchanged | [convention] |
| Replies, likes, stickers | Work as on any story, within the owner's reply setting | [source] |

### 4.4 What the owner sees

| Place | Detail | Basis |
| --- | --- | --- |
| Own tray ring | Green while posting to Close Friends | [decision] |
| Own viewer | The same green "Close Friends" pill on those stories | [convention] |
| Activity sheet | Viewers and likes as for any story | [source] |

### 4.5 Changes to the list after posting

| Change | Effect | Basis |
| --- | --- | --- |
| Remove someone | They lose access to your live Close Friends stories on their next request. A story they are watching finishes its media but cannot load the next | [decision] |
| Add someone | They see your live Close Friends stories on their next tray refresh | [decision] |
| They unfollow and unmatch | They drop out of the audience; their row stays on the list, inactive, shown greyed with "Not following you" | [decision] |
| Views already recorded | Kept in your viewer list | [convention] |

---

## 5. Hide story from

### 5.1 The list

| Behaviour | Detail | Basis |
| --- | --- | --- |
| What it does | The chosen people see none of your stories, including Close Friends stories, while everyone else is unaffected | [source] |
| Active stories | Applies at once to stories already live | [source] |
| No notification | Silent | [source] |
| Different from blocking | They can still follow you, match, message you and see your profile | [source] |
| Different from muting | Muting is what **you** do not want to see; hiding is who does not see **yours** | [source] |
| Close Friends | Hiding wins: a hidden person on Close Friends sees nothing | [source] |
| Size | No limit | [decision] |
| Editor | The same list editor as Close Friends, with "Hide story from" as the title and a blue tick | [convention] |
| Explanation | "People you choose won't see your stories. They won't be notified." | [convention] |

### 5.2 From the viewer list

Each row in your Activity sheet gets a **⋯** button on the right (beside the heart), opening a menu:

| Item | Result | Basis |
| --- | --- | --- |
| Hide your story from *Name* | Adds them to the hidden list. The row stays in the list, shown with a crossed-eye icon; the same menu then offers "Show your story to *Name*" | [source] |
| Add to Close Friends / Remove from Close Friends | Toggles them on your list. Offered only if they are in your audience | [convention] |
| Remove follower | Only if they follow you. Confirms first ("*Name* won't be told they were removed"), then removes the follow (section 9) | [source] |
| Message | Opens your chat, only if you have matched | [convention] |

---

## 6. Replies and reactions

### 6.1 The setting

Instagram offers **Everyone**, **People you follow**, and **Off**. In this app, replies travel into a match's chat, and chat exists only between matches, so the options are:

| Option | Who can reply and react | Basis |
| --- | --- | --- |
| **Your matches** (default) | Viewers you have an active match with. Today's behaviour | [decision: replies need a chat] |
| **Close Friends** | Only people on your Close Friends list, and only where they are also an active match. On a Close Friends story this is everyone who can see it and is a match; on a normal story, only the close friends among your matches can reply | [decision] |
| **Off** | Nobody. The reply bar and quick reactions are gone from your stories | [source] |

- The setting covers **text replies and emoji quick reactions** together. [source]
- **Likes** (the private heart) are unaffected: they send no message. [decision]
- **Interactive stickers** (polls, quizzes, sliders, questions, countdowns, Add Yours) keep working when replies are Off. [convention]
- The setting is read at reply time, so changing it applies to live stories. [decision]

### 6.2 What a viewer sees

| Situation | Footer | Basis |
| --- | --- | --- |
| Replies allowed, viewer is a match | "Send message" bar, quick reactions, heart | [source] |
| Replies Off | Heart only | [source] |
| Viewer is a follower but not a match | Heart only, with a small "Match to reply" hint in place of the bar | [decision] |
| Replies set to Close Friends, viewer not on the list | Heart only, no hint, so the list stays private | [decision] |

### 6.3 Reveal stickers

A Reveal story unlocks when a viewer replies. With replies **Off**, adding a Reveal sticker shows "Turn on replies to use Reveal" in the sticker tray, and the server rejects such a story with `422 REVEAL_NEEDS_REPLIES`. [decision]

### 6.4 How a reply appears in the chat

Every reply and reaction becomes a chat message, and the chat must show **which story it answers**, as Instagram does. The server already stores the story on the message (`messages.story_id`, type `story_reply`); the chat screen ignores it today and shows plain text. That is the gap this section closes.

| Behaviour | Detail | Basis |
| --- | --- | --- |
| The bubble | Above the text sits a small card: a **60 × 100 thumbnail** of the story, a thin bar down its left edge, and a label | [source: thumbnail] |
| Label | "Replied to your story" for the owner, "You replied to their story" for the sender, above the thumbnail in small grey text | [source: wording] |
| Emoji reaction | The same card with the emoji large and alone under it | [convention] |
| Tap | Opens that story in the viewer if it is still live and the person may still see it | [convention] |
| After 24 hours | The card stays with the label and a grey placeholder reading "Story unavailable". The message itself never expires | [source] |
| Deleted or hidden since | The same placeholder, so nothing reveals what it was | [decision] |
| Close Friends story | The card carries the small green star, for both people | [decision] |
| Notification | Unchanged: the chat push, worded "replied to your story" | [existing] |
| Thumbnail source | A signed URL for the story's existing thumbnail, resolved when the chat loads, not stored in the message | [decision: no second copy of private media] |
| Chat list preview | "Replied to your story" instead of the raw text, matching the bubble | [convention] |

The API adds the story's thumbnail and state to messages of type `story_reply` in `GET /chat/:matchId/messages` (`story: { id, thumbnailUrl, available, closeFriends }`), applying the same visibility rule as everywhere else.

---

## 7. Mentions and resharing

### 7.1 Who can mention you

| Option | Who can put you in a mention sticker | Basis |
| --- | --- | --- |
| **Everyone** (default) | Anyone allowed to mention you today: people who follow you, you follow, or you matched with | [source: setting exists; decision: default] |
| **People you follow** | Only people you follow (accepted) | [source] |
| **No one** | Nobody | [source] |

People who cannot mention you do not find you in mention search.

### 7.2 A mention must be visible to the person mentioned

[decision] You may mention someone only if they can see that story:

- On "Your story", they must follow you or be your match, not be on your hidden list, and allow your mentions.
- On a Close Friends story, they must also be on your Close Friends list.

The mention sticker's search lists people who can see "Your story" and allow your mentions (the API also accepts `audience=close_friends`). Tapping **Close Friends** checks every mention against your list first and names anyone not on it. The server checks again at batch creation (`422 STORY_MENTION_NOT_ALLOWED`), and once more at publish, recording and notifying only people who can open the story. This fixes the gap in section 1.

### 7.3 Resharing a mention to your story

Part 1 added "Add to your story" on a mention card.

| Setting | Detail | Basis |
| --- | --- | --- |
| **Allow resharing to stories** (default on) | People you mention may add your story to theirs | [source] |
| Close Friends stories | Never reshareable, whatever the setting | [convention] |
| Server | The mention card returns `canReshare`; the button shows only when true | [decision] |

---

## 8. Muting and unmuting

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Mute | From a person's story menu (today), their profile, or a long press on their tray avatar | [source] |
| Effect | Their stories leave your tray. They are not told, and they still see yours | [source] |
| Opening a muted person | Their stories still open from a link or a chat reply card. Unmuting is from Muted accounts | [source: still viewable; decision: where to unmute] |
| Tray long press | **Mute *Name*'s story**. There is no "View profile": a profile opens here only once you have matched | [source: mute; decision: no profile entry] |
| Unmute | From their story menu, their profile, or Story settings → Muted accounts | [source] |
| Muted accounts list | Avatar, name, and an **Unmute** button per row | [source] |

---

## 9. Followers

Following already controls who sees "Your story". The app has no screen for it yet.

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Followers list | Story settings → Followers: avatar, name, **Remove** | [source] |
| Remove follower | Confirms, then removes the follow. They are not told. A 30-day wait applies before they can request again (today's rule) | [source: silent; existing: cooldown] |
| Following list | Story settings → Following: avatar, name, **Unfollow** | [source] |
| Follow requests | The existing Follow Requests screen, linked from Story settings with a count | [existing] |
| Allow follow requests | The existing setting, as a switch | [existing] |

---

## 10. Screenshot protection

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Instagram | Does not notify or block story screenshots | [source] |
| This app | A setting, **Block screenshots**, in Story settings. **On by default** | [decision: students' photos on a dating app] |
| On | Screenshots and screen recording are blocked in the story viewer for **every story you look at**, whoever posted it and whatever its audience. Captures come out black | [decision] |
| Off | Nothing is blocked anywhere; the viewer behaves like Instagram | [decision] |
| Whose setting counts | The **viewer's** own setting, since only the phone taking the screenshot can stop it. It protects what you see, and cannot promise your own stories are safe from others | [decision] |
| Wording in settings | "Blocks screenshots and screen recording while you watch stories. Other people's settings control their own phones." | [decision: no false promise] |
| Scope | The viewer only. The camera, editor and your own drafts are not protected | [decision] |
| No notification | Nothing is sent to the owner; the capture simply fails | [decision] |
| How | `ChatMedia.setScreenCaptureBlocked` (`modules/chat-media`, `ScreenSecurity.kt`) sets `FLAG_SECURE` on every app window while the viewer is open and the setting is on, including React Native Modal dialogs, which are separate windows. The demo viewer blocks too | [decision] |
| No detection notice | `expo-screen-capture` was tried first and removed: it registers Android 14's screenshot callback app-wide, which shows "IEM Connect detected a screenshot" everywhere, and its flag covered only the activity window, not Modals | [decision] |
| Honest limit | Another phone's camera can still photograph the screen. The Story settings explanation says captures are blocked "in the app", not that stories are safe from copying | [decision] |
| Stored where | On the device, and on the account (`users.story_screenshot_block`) so a new phone keeps the choice | [decision] |

---

## 11. Story settings screen

One screen gathers every control. It opens from **Settings → Story** and from the **⋯** menu on your own story.

```
Story
─────────────────────────────────
VIEWING
  Close Friends                12 ›
  Hide story from               2 ›
  Muted accounts                3 ›

REPLYING
  Replies and reactions   Your matches ›

MENTIONS AND SHARING
  Allow mentions from        Everyone ›
  Allow resharing to stories     [on]

FOLLOWERS
  Followers                    148 ›
  Following                     96 ›
  Follow requests                4 ›
  Allow follow requests          [on]

STORIES
  Stories                        [on]
  Block screenshots              [on]
  Blocks screenshots and screen recording while you
  watch stories. Other people's settings control
  their own phones.
─────────────────────────────────
```

- Pickers (replies, mentions) open a small sheet with radio options and a one-line explanation each. [convention]
- Switches save at once and roll back with a toast on failure. [decision]
- Turning **Stories** off keeps today's behaviour (it deletes live stories), and asks first. [existing]
- The custom bottom navbar is not changed. [decision]

---

## 12. How every feature respects the audience

Every route that reads a story, lists stories or acts on one uses the rule in section 2.2. A single server function does it.

| Feature | Rule | Basis |
| --- | --- | --- |
| Tray (`GET /stories/tray`), feed | Only stories the viewer may see, minus muted authors | [decision] |
| Story, media URL, view, like | 404 unless visible | [decision] |
| Reply | Visible, **and** the owner allows replies (6.1), **and** an active match | [decision] |
| Reply in the chat | The story card on a `story_reply` message is resolved with the same rule; an expired or now-invisible story shows "Story unavailable" (6.4) | [decision] |
| Tray order | People with an unseen Close Friends story are listed first (4.3) | [decision] |
| Sticker responses and results | Responding needs visibility. Results are the owner's alone | [existing] |
| Question replies | Need visibility | [decision] |
| Countdown reminders | Sent only to subscribers who can still see the story when it ends | [decision] |
| Add Yours thread | Lists only entries whose stories the viewer may see (per story, not per owner). The count stays the thread total | [decision] |
| Add Yours join notification | Sent to the thread's creator only if they may see the joining story | [decision] |
| Mention notification | Only to people allowed by section 7.2, so it always opens | [decision] |
| Reveal | Unchanged, within visibility | [existing] |
| Link taps, viewer list | Owner-only, unchanged | [existing] |
| Reporting a story | The reporter must be able to see it (today: follower only) | [decision] |
| Push and deep links | A link to a story the person can no longer see opens "This story is unavailable" | [decision] |
| Account deletion | Deletes the person's Close Friends and hidden rows, both as owner and as member | [decision] |
| Block | Removes both people from each other's Close Friends lists. "Hide story from" rows stay, since they only ever withhold more | [decision] |

---

## 13. Server: data model and API

### 13.1 Changes to existing tables

**`stories.audience`** keeps its column. Values: `followers` (meaning "Your story", followers and matches) and `close_friends`. A check constraint limits it to these two. [decision: no rename, so no data change]

**`users`** gains:

| Column | Type | Default | Meaning |
| --- | --- | --- | --- |
| `story_replies` | `varchar(16)` | `'matches'` | `matches`, `close_friends` or `off` |
| `story_mentions` | `varchar(16)` | `'everyone'` | `everyone`, `following` or `off` |
| `story_resharing` | `boolean` | `true` | People you mention may add your story to theirs |
| `story_screenshot_block` | `boolean` | `true` | This person's viewer blocks screen capture |

### 13.2 New tables

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `story_close_friends` | `id`, `owner_id`, `friend_id`, `created_at` | unique (`owner_id`, `friend_id`); index (`friend_id`) |
| `story_hidden_from` | `id`, `owner_id`, `hidden_user_id`, `created_at` | unique (`owner_id`, `hidden_user_id`); index (`hidden_user_id`) |

`story_preferences` (muting) is unchanged.

### 13.3 Visibility in one place

`StoryVisibilityService.forViewer(viewerId)` loads, in parallel:

- authors V follows (accepted), and V's active matches;
- blocks in either direction;
- authors who hide their stories from V (`story_hidden_from.hidden_user_id = V`);
- authors whose Close Friends list includes V (`story_close_friends.friend_id = V`);
- authors V has muted.

It returns a Prisma `where` for stories, used by the tray, feed and Add Yours:

```ts
{
  OR: [
    { ownerId: viewerId },
    {
      ownerId: { in: audienceOwnerIds },            // follows + matches − blocks − hidden
      OR: [{ audience: 'followers' }, { ownerId: { in: closeFriendOfIds } }],
    },
  ],
}
```

and a `canSee(viewerId, story)` check for single-story routes, replacing `canView`. The tray also removes muted authors. Both are covered by the tests in section 19.

### 13.4 API

All under `/api/stories`, authenticated.

| Method and path | Purpose |
| --- | --- |
| `GET /settings` | All story settings, plus counts for Close Friends, hidden, muted, followers, following and requests |
| `PUT /settings` | Partial update: `storiesEnabled`, `allowFollowRequests`, `replies`, `mentions`, `resharing`, `screenshotBlock` |
| `GET /audience/people?q=&list=close_friends\|hidden&cursor=` | Your followers and matches for a list editor, each with `onList`, `isMatch`, `followsYou`, sorted as in 4.2 |
| `GET /close-friends?cursor=` | Your list, including inactive rows flagged `inAudience: false` |
| `PUT /close-friends/:userId` | Add (idempotent). `422 CLOSE_FRIEND_NOT_IN_AUDIENCE` |
| `DELETE /close-friends/:userId` | Remove (idempotent) |
| `DELETE /close-friends` | Clear the list |
| `GET /hidden?cursor=` | People your stories are hidden from |
| `PUT /hidden/:userId` / `DELETE /hidden/:userId` | Hide / show (idempotent) |
| `GET /muted?cursor=` | Authors you have muted |
| `PUT /authors/:authorId/mute` | Existing; `{ muted: false }` unmutes |
| `DELETE /follows/:userId?direction=follower` | Existing removal, now exposed as "Remove follower" |

Changes to existing routes:

| Route | Change |
| --- | --- |
| `POST /stories/batches` | Takes `audience`. Validates mentions against it (7.2) and Reveal against the reply setting (6.3) |
| `GET /stories/tray` | Each story carries `audience`; each group carries `closeFriendsUnseen`, used for the green ring and to put those people first (4.3) |
| `GET /stories/:id` | Adds `canReply` and `replyBlockedReason` (`own`, `off`, `not_matched`; a Close Friends limit reads as `off`, so the list stays private), plus `contentType`, `seen` and `liked`, so a story can play on its own outside the tray |
| `GET /stories/:id/viewers` | Each row carries `relation: { closeFriend, hidden, followsYou, matchId }` for the row's ⋯ menu (5.2) |
| `GET /stories/reply-cards?ids=` | Story cards for up to 50 story replies that arrived live, after the chat loaded (6.4) |
| `GET /chat/:matchId/messages` | A `story_reply` message carries `story: { id, thumbnailUrl, available, closeFriends }` (6.4) |
| `GET /stories/people/:userId?storyId=` (mention card) | Adds `canReshare`: true only for the mentioned person, on an ordinary story whose owner allows resharing |
| `POST /stories/:id/reply` | `403 STORY_REPLIES_OFF` when the owner turned replies off |
| `GET /stories/mentions/search` | Takes `audience`, and filters by the mentioned person's setting and visibility |

### 13.5 Caching

**No cache.** Visibility is read from the database on every request: six indexed lookups for one viewer, run in parallel. [decision] A cache would let a removed close friend, or someone just hidden, keep seeing stories until it expired, which is the one thing this feature must never do. If the tray becomes slow at scale, cache only per-viewer inputs that cannot grant access, and measure first.

---

## 14. App: screens and components

| Module | Purpose |
| --- | --- |
| `settings/StorySettingsScreen.tsx` | Section 11 |
| `settings/AudienceListScreen.tsx` | One editor for Close Friends and Hide story from (`list` param): search, rows with ticks, optimistic saves |
| `settings/MutedAccountsScreen.tsx` | Muted authors with Unmute |
| `settings/FollowListScreen.tsx` | Followers (Remove) and Following (Unfollow) |
| `settings/OptionSheet.tsx` | Radio sheet for replies and mentions |
| `create/editor/ShareButtons.tsx` | "Your story" and green "Close Friends" (section 3) |
| `components/StoryTray.tsx` | Green ring; long press sheet (View profile, Mute) |
| `StoryViewerScreen.tsx` | Close Friends pill; reply bar per `canReply`; Unmute in the menu; "Story settings" in your own menu; screenshot blocking while focused, when the setting is on |
| `chat/components/StoryReplyCard.tsx` | The story card above a `story_reply` bubble: thumbnail, label, green star, "Story unavailable", tap to open (6.4) |
| `components/StoryActivitySheet.tsx` | Row ⋯ menu (section 5.2) |
| `create/editor/StickerTray.tsx` | Mention search by audience; Reveal warning when replies are Off |
| `api/storySettings.ts` | Typed calls, and a small store so counts and toggles update across screens |

**Demo mode:** a local Close Friends list with two demo people, one demo person with a Close Friends story (green ring), and all settings kept in memory. Nothing reaches the server.

---

## 15. Limits

**No size limits.** Instagram publishes no cap on Close Friends or the hidden list, so neither has one here. [source: no published cap; decision] Both lists are read as sets of ids, which stays fast at any size a student account reaches.

Only request rates are limited, and only to stop scripted abuse. A person using the app normally never meets them.

| Limit | Value | Basis |
| --- | --- | --- |
| Close Friends and Hide story from changes, and the people search | 120 requests per minute per person, together | [decision: stops scripted list probing] |
| Settings updates | Not limited: each is one row update | [decision] |

---

## 16. Safety for a college dating app

| Risk | Guard | Basis |
| --- | --- | --- |
| Someone learns they were hidden or removed | Identical 404s, no ring, no counts, no notifications; list rows never appear in anyone else's responses | [decision] |
| Private stories reach an ex who unfollowed | Close Friends needs current follow or match (2.1); the rule is checked on every read | [decision] |
| A match sees content meant for friends | Close Friends and Hide story from; the list editor labels matches | [decision] |
| Probing someone's list by adding and removing | Rate limit (section 15); adding someone reveals nothing about their lists | [decision] |
| Captures of private stories | Screenshot blocking in the viewer (section 10) | [decision] |
| Unwanted replies | Replies need a match, can be turned off, and pass the chat abuse filters | [existing + decision] |
| Mention spam or tagging without consent | Mention setting (7.1), visibility check (7.2), and the existing "remove mention" on the notification | [source + existing] |
| Blocking | Removes both people from each other's Close Friends lists, so an unblock does not silently restore private stories. "Hide story from" rows are kept | [decision] |

---

## 17. Not applicable, and what is left for Part 3

### 17.1 Instagram features that do not apply here

| Instagram | Why not here |
| --- | --- |
| Public and private accounts | Stories here are always limited to followers and matches |
| Replies from **Everyone** or **People you follow** | Replies are chat messages, and chat needs a match |
| Allow sharing to messages | Stories cannot be sent in chat (`STORIES_SPEC.md`, section 5) |
| Restrict | The app has block and report; a restricted state would duplicate them |
| Limits and Hidden Words | Replies already pass the chat abuse filters and require a match |
| Live | The app has no live video |

### 17.2 Part 3: your own stories over time

- **Archive and save:** keep expired stories privately; save your story to your phone. (Highlights — keeping stories on your profile past 24 hours — were researched and then deliberately dropped: see `STORY_ARCHIVE_SPEC.md`.)
- **Insights:** reach, forward and back taps, exits, replies.
- **Replies in Activity:** see emoji and text replies in the Activity sheet.
- **Viewer list after expiry:** kept for 48 hours after a story ends.

### 17.3 Watching extras, separately

**Built.**

- **The story growing out of the tapped avatar when opening:** `StoryTray.tsx` measures the tapped avatar's screen position, then a short (280ms) overlay animates it from that circle to full screen before the viewer opens - self-contained, so it never touches the viewer's own transition or gesture logic.
- **Tapping the author's name or avatar to open their profile:** only offered when you have matched with them - `ChatProfileScreen` needs a `matchId`, which a mere follower relationship does not have. `StoryService`'s tray and single-story responses now include `matchId` (`story.service.ts`) alongside `canReply`, since nothing previously exposed it. Tapping opens `ChatProfileScreen`, the same screen "Message" in the Activity sheet's viewer menu already used.
- **Live tray updates when someone posts:** a story's audience already received a push for mentions on publish (`OutboxDeliveryService.deliverStoryPublished`, formerly `deliverStoryMentions`); it now also emits a lightweight `story_published` socket event to everyone in `StoryVisibilityService.audienceOf(ownerId)`. The client (`StoryTray.tsx`) just refetches its tray on that signal, debounced 600ms to coalesce a multi-photo post into one refetch - the visibility, Close Friends and mute rules are only ever applied once, server-side, by the tray endpoint itself.

---

## 18. Build plan

Each phase is usable on its own and testable in demo mode.

| Phase | Scope |
| --- | --- |
| **A. Visibility core** | Migration (13.1, 13.2); `StoryVisibilityService`; matches join the audience; every route in section 12 switched to it; mention and notification fixes; integration tests |
| **B. Close Friends** | Share buttons, list editor, audience people API, green tray ring, viewer pill, mention search by audience |
| **C. Controls** | Story settings screen; Hide story from; replies setting (footer, Reveal check); mention setting; resharing setting; muted accounts and tray long press; followers and following lists with Remove and Unfollow |
| **D. Chat, viewer list and protection** | Story reply card in chat (6.4); Activity row ⋯ menu; the Block screenshots setting (development client rebuild); block clean-up; rate limits; caching |

Phase A changes who can see stories for every user, so it ships and is tested on its own before B.

---

### 18.1 Implementation status

All four phases are built.

| Area | Where |
| --- | --- |
| Migration | `apps/api/prisma/migrations/20260920000000_story_audience` (applied): user settings columns, `stories.audience` and `story_batches.audience` checks, `story_close_friends`, `story_hidden_from` |
| Visibility | `StoryVisibilityService`, used by the tray, feed, single story, media, views, likes, replies, stickers, Add Yours, reporting, countdown reminders, Add Yours pushes and chat story cards |
| Lists and settings | `StoryAudienceService`, `StoryAudienceController`; clean-up on block and account deletion; lists included in the data export |
| Story cards in chat | `StoryReplyCardService` on chat message loads, and `GET /stories/reply-cards` |
| App | `settings/` screens, share buttons in `StoryEditor`, rings and long press in `StoryTray`, pill, footer, menus and screenshot blocking in `StoryViewerScreen`, row menu in `StoryActivitySheet`, `StoryActionSheet`, `chat/components/StoryReplyCard` |
| Tests | `npm run test:story-audience` (12 tests, non-destructive) |
| Needs a rebuild | Screenshot blocking is native code in `modules/chat-media`. On a build without it the viewer simply does not block; nothing else depends on it |

## 19. Verification

**Server:** non-destructive integration tests that create their own users and remove only them. Never run `test:chat-regression`: it truncates real tables.

- **Visibility matrix:** for each combination of follow (none, pending, accepted, removed), match (none, active, ended), block (none, either way), hidden (yes, no), Close Friends (yes, no) and audience (`followers`, `close_friends`), assert tray, story, media, view, like, reply, sticker response and Add Yours results agree with section 2.2.
- **Timing:** removing someone from Close Friends or adding them to hidden blocks the very next media request.
- **No leaks:** a hidden story and a deleted story return byte-identical errors; the tray omits the person entirely.
- **Mentions:** search and batch creation reject people outside the audience or whose setting forbids it; notifications go only to allowed people.
- **Replies:** `off` rejects replies and a Reveal story; `matches` accepts only active matches; `close_friends` accepts only matches on the list, on both kinds of story.
- **Story replies in chat:** the story card resolves for a live story, and reports `available: false` once it expires, is deleted, or the viewer loses access, without leaking anything else.
- **Lists:** idempotency, no size cap, inactive rows after unfollow, clean-up on block and account deletion.

**App:** type-check; unit tests for ring colour and Close Friends-first ordering on mixed groups, list sorting, and optimistic rollback.

**On device (two accounts):**

- Post to Close Friends: the member sees a green ring and the pill; a non-member sees nothing.
- Remove the member mid-story: the next story does not load.
- Hide your story from a match: they see no ring; unhide and it returns.
- Turn replies Off: the bar disappears for a match; the heart still works.
- Mention someone who does not follow you on a Close Friends story: they are not offered.
- Try a screenshot in the viewer: it is black.
- Mute from the tray long press, then unmute from Muted accounts.
- Remove a follower from Activity: they lose your stories and are not told. Unfollow someone from Following: their stories leave your tray.
- A Close Friends story puts that person first in the tray, above other unseen stories.
- Reply to a story: the chat bubble shows the story's thumbnail and "Replied to your story", and tapping it opens the story. After the story expires, the card reads "Story unavailable".
- Set replies to Close Friends: a match on the list can reply, a match who is not sees only the heart.
- Turn **Block screenshots** off: a screenshot in the viewer works. Turn it on: it comes out black.

---

## Sources

- [Instagram Close Friends: full guide 2026 (Unfollr)](https://www.unfollr.com/blog/instagram-close-friends-guide)
- [Instagram Close Friends list: the green ring, explained (ViewIGStory)](https://www.view-ig-story.com/blog/instagram-close-friends-list)
- [Can you tell if someone added you to Close Friends? (ViewIGStory)](https://www.view-ig-story.com/blog/can-you-tell-if-someone-added-you-to-close-friends)
- [Who can see my Close Friends story (PeekStories)](https://peekstories.com/blog/who-can-see-my-close-friends-story-instagram-2026)
- [Instagram Close Friends: how creators use it (SetSmart)](https://setsmart.io/blog/instagram-close-friends)
- [What a green circle around a story means (Upgrow)](https://www.upgrow.com/blog/instagram-story-green-circle-meaning)
- [Can you hide your story from specific people? (ViewIGStory)](https://www.view-ig-story.com/blog/can-you-hide-your-story-from-specific-people)
- [How to hide your Instagram story from certain people (Lilach Bullock)](https://www.lilachbullock.com/instagram-story-private-from-certain-viewers/)
- [How to limit or turn off story replies (Screen Rant)](https://screenrant.com/limit-turn-off-instagram-story-replies-how/)
- [Instagram story replies: who can see them and how they work (InstantDM)](https://instantdm.com/blog/instagram-story-replies-private-who-can-see-how-they-work-2026)
- [Stop Instagram story replies in 2026 (MobileMasr)](https://mobilemasr.com/en/blogs/stop-instagram-story-replies-in-2026)
- [Share someone's story to your own story (Instagram Help Center)](https://help.instagram.com/4194195024242103/)
- [Does Instagram tell you who shared your story? (ViewIGStory)](https://www.view-ig-story.com/blog/does-instagram-tell-you-who-shared-your-story)
- [Does Instagram notify screenshots of stories? (ViewIGStory)](https://www.view-ig-story.com/blog/instagram-story-screenshot-notification)
- [Difference between restrict, mute, block and report (About Instagram)](https://about.instagram.com/blog/tips-and-tricks/restrict-mute-block-report-guide)
- [How to mute Instagram stories (NapoleonCat)](https://napoleoncat.com/blog/how-to-mute-instagram-stories/)
- [How to hide Instagram followers and remove a follower (Metricool)](https://metricool.com/hide-instagram-followers/)
- [Instagram updates and news 2026: Limits and Hidden Words (Metricool)](https://metricool.com/instagram-news/)
- [How the Instagram story algorithm ranks the tray (GrowthViral)](https://growthviral.co/instagram-growth-hub/algorithm/instagram-story-algorithm/)
- [Instagram story strategy 2026: ranking and Close Friends (ShadowPhone)](https://www.shadowphone.io/blog/instagram-story-strategy-2026)
- [How to react on an Instagram story: replies and reactions in DMs (InstantDM)](https://instantdm.com/blog/how-to-react-on-instagram-story)
- [Are Close Friends replies visible to others? (PeekStories)](https://peekstories.com/blog/are-instagram-close-friends-replies-visible-to-others-2026)
