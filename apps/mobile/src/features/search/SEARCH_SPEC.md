# Search: finding a specific person, safely

This document specifies Search: a query box that finds people at your college by name, and what must be true for that to be safe in an app that is also a dating app. Browsing by category and filter is a different surface with different rules: `../discovery/EXPLORE_SPEC.md`.

Each behaviour is marked by where it comes from:

- **[source]**: stated in a published reference, listed at the end.
- **[convention]**: how an app behaves in current builds without a published spec.
- **[decision]**: a choice made for this app, with the reason given.

Section 11 lists the decisions that need confirming before building. **Decision 1 is the one that matters** — whether this feature should exist in this form at all.

---

## Contents

1. [What exists today](#1-what-exists-today)
2. [Research: how other apps do it](#2-research-how-other-apps-do-it)
3. [The tension, and the shape that resolves it](#3-the-tension-and-the-shape-that-resolves-it)
4. [Who can be found](#4-who-can-be-found)
5. [What a result shows, and what it must not](#5-what-a-result-shows-and-what-it-must-not)
6. [How matching works](#6-how-matching-works)
7. [The discoverability setting](#7-the-discoverability-setting)
8. [Server: data model, API and limits](#8-server-data-model-api-and-limits)
9. [App: screen](#9-app-screen)
10. [Privacy and safety](#10-privacy-and-safety)
11. [Decisions to confirm](#11-decisions-to-confirm)
12. [Build plan](#12-build-plan)
13. [Verification](#13-verification)
14. [Sources](#sources)

---

## 1. What exists today

**There is no search.** The Search tab renders the Explore screen:

```tsx
<Tab.Screen name="Search" component={ExploreScreen} />   // MainTabNavigator.tsx
```

The only server route under `/search` is `/search/explore`. Nothing in the app takes a typed query and finds a person.

Three adjacent things do exist, and matter as precedent:

| Feature | Scope | Where |
| --- | --- | --- |
| **Mention search** in the Story editor | Only people who can see that Story — followers and matches, narrowed to Close Friends for a Close Friends Story | `StoryStickerService.searchMentions` |
| **Message search** | Inside one chat you are already in | `MessageSearchScreen.tsx` |
| **Place and GIF search** | Third-party catalogues, not people | `StorySearchService` |

Every existing search in this app is **scoped to a relationship you already have**. A general people search would be the first that is not, which is the whole subject of this document.

---

## 2. Research: how other apps do it

### 2.1 Dating apps deliberately have no name search

- **Tinder does not permit name-based search. Hinge has no directory-style search. Bumble has none either.** **[source]**
- The stated reason is not technical: name search "would make it trivially easy for abusers, stalkers, or obsessive ex-partners to locate and monitor specific users", and Hinge removed name search specifically to prevent stalking. **[source]**
- What exists instead is an ecosystem of third-party lookup services that scrape or reverse-image-search around the apps — i.e. the apps treat findability as something to resist, and people route around it externally. **[source]**

### 2.2 Social apps have full search, with discoverability controls

- **Instagram**: results in tabs — Top, Accounts, Audio, Tags, Places (Places removed during 2026). Ranking matches the query against usernames, bios, captions, hashtags and place names, then ranks on your own activity and overall popularity. **[source]**
- **Snapchat**: granular controls over being found — "Who can add me" (Everyone / My Friends), a toggle that disables phone-number lookup, and opting out of Quick Add suggestions. If discoverability is off, you are not findable unless you added them first. **[source]**

### 2.3 The lesson

The split is clean: **where a connection is an introduction between strangers, apps suppress findability. Where a connection is with someone you already know, apps expose it and give privacy switches.** This app is both at once, which section 3 resolves.

---

## 3. The tension, and the shape that resolves it

This app has two layers over the same accounts:

- a **dating layer** — the deck, Likes, matches, where people are introduced to strangers by an algorithm; and
- a **social layer** — Stories, follows, followers and following lists, where people connect with classmates they already know.

Name search is dangerous for the first and expected for the second. **[decision]** So Search belongs to the **social layer only**, and is defined by three rules, which the rest of this document implements:

1. **Search is bounded to your verified college.** Not the city, not the app. Everyone findable is someone you already share a campus with, verified through `student_memberships` — the population you can already see in a corridor.
2. **Search is social by default, with dating one deliberate tap deeper.** A result shows who someone is and offers Follow. A **View dating profile** button sits below it, and opens the full dating profile with Like and Rose — but **only when the deck would already have allowed that Like**, and when it would not, the app never says why (section 5). Search accelerates something the deck permits; it is not a way around it.
3. **Search visibility is independent of dating state.** Whether you swiped on someone, or they on you, changes nothing about whether they appear in your search results — because if it did, Search would become an oracle for reading other people's swipes (section 10).

**[decision]** Anyone who wants none of this has one switch that removes them entirely (section 7), following Snapchat's discoverability model rather than Instagram's always-on one. **[source]**

---

## 4. Who can be found

A person appears in your results only when **all** of these hold:

| Rule | Why |
| --- | --- |
| Verified, active membership of **your** institution | The college boundary of rule 1. Reuses the membership join already in `eligibleSql` |
| Their **Discoverable in search** setting is on (section 7) | The opt-out |
| `account_status = 'active'` | Suspended and deleted accounts are not people you can reach |
| No block in **either** direction | Same rule as everywhere else in the app |
| Not you | — |

And explicitly **not** conditioned on:

- whether either of you swiped, passed, matched or unmatched — rule 3;
- mutual dating preferences (`showMeCategories`, age, distance) — those govern the deck, not whether a classmate can look you up;
- whether they have Stories on, or allow follow requests — that governs the Follow *button's* behaviour, not their existence in a list.

**[decision]** This is a deliberately different scope from the deck. Search answers "does this person exist here?", which is already answerable by walking across campus; it does not answer "would we match?".

---

## 5. What a result shows, and what it must not

### 5.1 Two layers, one tap apart

An earlier draft of this document said Search never offers a dating action at all. **That was wrong, and it broke the most common reason anyone searches for a classmate: they like them.** Finding your crush and then being offered nothing but "Follow" is not privacy, it is a dead end.

**[decision]** The rule is not "no dating from Search". It is:

> **Dating actions are offered from Search exactly when the deck would have offered them, and when they are not, the reason is never disclosed.**

So a searched person has **two layers**:

| Layer | Contents | Reached by |
| --- | --- | --- |
| **Social** (default) | Name, avatar, verified badge, department, year, Stories ring if you may see them, and **Follow / Requested / Following** | Tapping a result row |
| **Dating** (one tap deeper) | The full dating profile: all photos, the profile video, About me, interests, prompts, match percentage, `seeking` — and **Like** and **Rose** | A **View dating profile** button at the bottom of the social layer |

**[decision]** Social stays the default because a name search is a social act; the dating layer is a deliberate second step rather than the thing you land on. That ordering also means nobody opens a classmate's dating profile by accident while looking them up for a group project.

**Follower counts** **[decision]**. The social layer also shows "Follows you", with **Follow back** on the button, and the person's follower and following counts, the way Instagram shows them even for private accounts. **[source]** The counts appear only when the person has Stories on, which is what makes their social profile exist, and has not turned off **Settings → Story → Show follower counts** (`users.show_follower_count`, on by default). Otherwise both are hidden rather than shown as 0, so a hidden count never reads as an empty one. Everyone who can find the person sees the same two numbers; following them unlocks nothing more. **The lists are never shown to anyone**: who follows whom, across one college, would map its friendships.

### 5.2 When the dating layer opens

The button appears on every result. What happens on tap depends on whether an ordinary deck Like would be allowed — that is, whether the pair satisfies `eligibleSql`, neither has swiped the other, and no match already exists:

| State | Result |
| --- | --- |
| A deck Like would be allowed | The dating profile opens, with Like and Rose |
| It would not — for any reason | A single, uniform message: **"You can't Like this profile right now."** with the social layer still behind it |

**[decision]** One message covers every no: mutual preferences do not overlap, you already swiped, they already passed, you already matched, they have paused dating, they have no dating profile set up, or a limit is spent. It is phrased as **"right now"** because several of those states really are temporary, and because a wording that sounded permanent would itself be a disclosure.

**An honest limit.** This does not achieve perfect non-disclosure and the plan should not pretend otherwise. Somebody who knows they never swiped on you, sees the refusal, and reasons carefully can narrow down why. What the uniform message does is remove the *casual* signal, keep the app from ever confirming it, and make the inference an effort rather than a notification. The alternative designs are worse: hiding the button entirely announces the exclusion more loudly, and naming the reason announces it outright.

### 5.3 What the dating layer changes, and what it does not

- A Like or Rose sent from here is **identical** to one sent from the deck — same quota, same Rose balance and limits (`EXPLORE_SPEC.md`, section 10), same entry in the recipient's Likes You. **[decision]** It carries no "found you in Search" marker: being sought out deliberately is not something the recipient needs to be told, and the marker would only make the app feel like a hunting tool.
- It is **not** a way around eligibility (5.2), a way around blocks, or a way around anyone's discoverability setting — you had to be able to find them at all to get here.
- The **social** layer still never shows: match percentage, `seeking`, distance, online status or last seen, or anything about swipe state. Those live behind the second tap, on the profile of somebody the deck would have shown you anyway. **[decision]**

### 5.4 Never shown, on either layer

| Never | Why |
| --- | --- |
| Distance, "x km away", precise location | Search is college-scoped; the number adds nothing and risks a lot |
| Online status or last seen | `show_online_status` governs this in chat and Search must not route around it |
| Whether they have liked *you* | That belongs in Likes You, which is mutual by design, not in a lookup |
| Any count of Likes or Roses received | Same rule as Explore: no popularity surface in a single college |

---

## 6. How matching works

**Query** — against the person's **name** only. **[decision]** Not bios, not interests, not captions, the way Instagram matches across profile text. **[source]** A bio is written to be read by someone already looking at the profile; making it a search index turns an offhand sentence into a way to enumerate people by attribute.

**Token-prefix matching** **[decision]**: the query matches if it is a prefix of **any word** in the name. "sub" and "pat" both find "Subhankar Patra"; "hank" finds nobody.

- Prefix, not substring, because substring search over a student directory is a trawling tool: `%a%` returns the college.
- Any word, not just the first, because people are commonly searched by surname.
- Case- and accent-insensitive; whitespace collapsed.

**Minimum query length: 2 characters.** **[decision]** Below that every query returns most of the college.

**Ordering** **[decision]**, most useful first and cheap to compute:

1. People you already follow, or have matched with
2. People who follow you
3. Exact whole-word match over prefix match
4. Alphabetical

**[decision]** No popularity term, unlike Instagram's ranking. **[source]** Ranking classmates by popularity inside a single college is precisely the social ranking Explore also refuses to build (`EXPLORE_SPEC.md`, section 3).

**Results are capped at 30 per query with no deep pagination.** **[decision]** Search is for finding a person you have in mind, not for paging through the college. If your query returns more than 30, refine it.

---

## 7. The discoverability setting

**Settings → Privacy → Discoverable in search**, with the explanation: *"People at your college can find you by name in Search. Turning this off hides you from search results. It does not affect your Stories, matches, or chats."*

| Property | Value |
| --- | --- |
| Column | `users.search_discoverable BOOLEAN NOT NULL DEFAULT true` |
| Default | **On** **[decision]** — see below |
| Effect when off | You never appear in anyone's results. Existing follows, matches and chats are untouched |
| Effect on your own searching | None — you can still search others |

**[decision] Why default on, with one deliberate exception.** The social layer does not function if nobody is findable: follows, Close Friends and Stories all assume you can reach a classmate you already know. The college boundary plus the name-only, prefix-only, 30-result rules keep the exposure close to what a campus already discloses. **The exception:** if an account has **Stories turned off and follow requests off**, they have already opted out of the social layer, so search discoverability defaults **off** for them too, rather than leaving them exposed by a surface they never opted into.

---

## 8. Server: data model, API and limits

### 8.1 Data model

```prisma
model User {
  // ...
  /// Findable by name in Search by people at the same college (SEARCH_SPEC.md, section 7).
  searchDiscoverable Boolean @default(true) @map("search_discoverable")
}
```

Matching index, applied in SQL (partial and expression indexes are maintained in migrations here, as the discovery indexes already are):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Token-prefix search over a normalised name.
CREATE INDEX users_search_name_trgm_idx ON users USING GIN (lower(name) gin_trgm_ops)
  WHERE account_status = 'active' AND search_discoverable;
```

### 8.2 API

```
GET /search/people?q=<2..60 chars>&limit=<1..30>
```

- `200 { people: [{ id, name, avatarUrl, department, year, isVerified, followStatus }], truncated: boolean }`
- `q` under 2 characters returns `{ people: [], truncated: false }` rather than an error — the app calls this on every keystroke.
- `truncated` is true when the cap in section 6 was hit, so the app can say "Keep typing to narrow this down" instead of implying those 30 are everyone.
- **No cursor, no offset.** Deep pagination is what turns a search endpoint into an export endpoint.

**[decision]** No `GET /search/people` with an empty `q` — there is no "browse everyone" mode. That is Explore's job, and Explore has a cohort floor.

**The dating layer** (section 5) reuses what already exists rather than adding a second profile endpoint:

| Route | Does |
| --- | --- |
| `GET /search/people/:userId/dating` | The dating profile, **only** when a deck Like would be allowed. Otherwise `403 DATING_PROFILE_UNAVAILABLE` with no detail — one code for every reason in 5.2 |
| `POST /discover/swipe` | Unchanged. A Like or Rose from Search goes through the same route, quota and Rose limits as one from the deck |

**[decision]** The eligibility decision is made **on the server, in that one endpoint**. The app never receives a flag saying "this person is ineligible for you" that a modified client could read — it either gets the profile or a single opaque refusal.

### 8.3 Limits and abuse controls

| Control | Value | Reason |
| --- | --- | --- |
| Rate limit | 30 queries/minute per account, via the existing `burstLimit` helper | Typing is fast; scraping is faster |
| Result cap | 30, no pagination | Section 6 |
| Minimum query | 2 characters | Section 6 |
| Name-only matching | Section 6 | Bio/interest search is an attribute-enumeration tool |
| Distinct-profile ceiling | Soft daily ceiling per account on distinct profiles returned, counted in Redis; beyond it, Search returns results more slowly and the account is flagged for review | A determined enumerator can still walk the alphabet; this makes it slow and visible |

**[decision] Queries are never stored server-side.** Rate and ceiling counters live in Redis as counts, not as text. A durable table of "who searched for whom" would be one of the most sensitive tables in the app and is not needed to run the feature.

---

## 9. App: screen

A real `SearchScreen`, replacing `<Tab.Screen name="Search" component={ExploreScreen} />`.

| Element | Behaviour |
| --- | --- |
| Search field | Autofocus off; debounced 250 ms; clears with an X |
| **People** results | Rows: avatar, name, verified badge, department · year, Follow button. Tap opens the social layer (section 5.1) |
| Social layer | The read-only expanded profile, with **View dating profile** pinned at the bottom |
| Dating layer | Opens on tap when allowed, with Like and Rose; otherwise the single uniform message from 5.2 |
| **Interests** section | Below People when the query matches interest names: tapping one opens **Explore** filtered to that interest, rather than listing people — Explore's cohort floor then applies |
| Recent searches | The last 8, **stored on the device only** and clearable **[decision]** — a server-side history is the sensitive table section 8.3 avoids |
| Zero state | Recent searches, then a row of interest chips as a prompt to browse. **No suggested people** **[decision]** — a suggested-classmates list is a second recommender with its own fairness and privacy questions, and Snapchat's Quick Add is exactly the thing its own privacy settings let people escape **[source]** |
| Empty result | "No one at your college matches that." Never "this person has hidden themselves" — that would confirm they exist |
| Truncated result | "Showing the first 30. Keep typing to narrow it down." |

---

## 10. Privacy and safety

- **The college boundary** is the containing rule: search reaches the people you already share a verified campus with, nobody else.
- **One switch removes you** (section 7), and people already outside the social layer start outside search too.
- **Search state is independent of dating state** (rule 3). This is subtle and worth stating plainly: if passing on someone removed them from your search results, then *their* disappearance would tell you what *they* did. Keeping search blind to swipes is what stops it becoming a swipe oracle.
- **Absence is ambiguous by design.** Someone who is not findable may have the setting off, may not be at your college, may have blocked you, or may not exist. The app never distinguishes these — the same empty state covers all of them.
- **No enumeration surface**: no empty query, no pagination, capped results, minimum query length, prefix-only matching, rate limits, and a daily ceiling with review (section 8.3).
- **No popularity ranking** of classmates (section 6).
- **No stored query history** anywhere on the server (section 8.3).
- **Blocks apply both ways**, as everywhere else.
- **Reporting** is available from the profile the result opens, through the existing report flow.
- **The dating layer never widens who can reach you.** It opens only where a deck Like was already allowed, the check runs server-side in one endpoint, and the refusal carries no reason (5.2, 8.2). The residual inference it cannot remove is stated plainly in 5.2 rather than glossed over.
- **A Like from Search looks exactly like a Like from the deck** (5.3), so nobody is told they were sought out by name.

---

## 11. Decisions to confirm

| # | Question | Recommendation |
| --- | --- | --- |
| **1** | **Should name search exist at all?** Tinder, Bumble and Hinge all deliberately refuse it **[source]** | **Yes, in the form above** — college-scoped, social-only, opt-out. The app's Stories/follows layer is unusable without a way to find a classmate you know. If you would rather not ship it, the honest alternative is to drop the Search tab and give Explore the space |
| 2 | Default `search_discoverable` to on? | On, except for accounts with Stories and follow requests both off |
| 3 | Name only, or also bio and interests? | Name only |
| 4 | Prefix matching rather than substring? | Prefix, on any word of the name |
| 5 | Cap at 30 with no pagination? | Yes |
| 6 | Suggested people in the zero state? | No, in v1 |
| 7 | Store recent searches on the server? | No — device only |
| **8** | **A View dating profile button under the social layer, with Like and Rose?** | **Yes** — this replaces the earlier "never any dating action" rule, which left the most common reason to search a classmate with nowhere to go |
| 9 | Open the dating layer only where a deck Like would already be allowed? | Yes — Search accelerates the deck, never bypasses it |
| 10 | One uniform "You can't Like this profile right now" for every refusal? | Yes, with the residual-inference limit admitted in 5.2 |
| 11 | Social layer as the default, dating one tap deeper? | Yes — a name lookup should not land on a dating profile |

---

## 12. Build plan

| Phase | Scope |
| --- | --- |
| **A. Server** | `search_discoverable` column and migration, `pg_trgm` index, `SearchService.people`, `GET /search/people`, rate limit, result cap, Redis ceiling counters |
| **B. Screen** | `SearchScreen` with the People list, debounce, empty/truncated states, device-side recent searches; Search tab stops pointing at Explore |
| **C. Settings and routing** | The Discoverable in search switch in Settings → Privacy; the Interests section routing into Explore; the social layer from a result |
| **D. The dating layer** | `GET /search/people/:userId/dating` with the server-side eligibility check and its single opaque refusal; the View dating profile button; Like and Rose through the existing swipe route |

Phase A ships behind the absence of any UI, so it can be verified by tests before anyone can type a query. **Phase D depends on Roses** (`EXPLORE_SPEC.md`, section 10) if the Rose action is wanted at launch; the Like action does not wait for it.

---

## 13. Verification

**Server** — non-destructive integration tests creating their own users and institutions (`npm run test:search`):

- **Scope:** a person at another institution never appears; an inactive account never appears; a blocked person never appears in either direction; a person with `search_discoverable = false` never appears.
- **Independence from dating state:** swiping, passing, matching and unmatching change nothing about whether someone appears — the same query returns the same people before and after each.
- **Matching:** "sub" and "pat" find "Subhankar Patra"; "hank" does not; one character returns nothing; case and accents are ignored.
- **Caps:** a 40-person cohort returns 30 with `truncated: true`; there is no cursor to fetch the rest.
- **Ordering:** a follow, then a follower, then an exact match, then alphabetical.
- **Limits:** the 31st query in a minute is refused; the daily ceiling trips and is recorded.
- **No leakage:** the search response contains no compatibility, `seeking`, distance, presence or swipe fields.

**The dating layer:**

- Opens for a mutually eligible, un-swiped pair; refuses with the **same** status and code for every one of: preferences do not overlap, already swiped, they passed, already matched, dating paused, no dating profile. The refusal body is byte-identical across all of them.
- A Like sent from it is indistinguishable in the database from a deck Like, counts against the same quota, and a Rose from it obeys every limit in `EXPLORE_SPEC.md` section 10.3.
- The search row and social layer for that same person are unchanged whether the dating layer would open or not — the refusal is never visible one level up.

**App** — type-check; unit tests for debounce, the truncated message, recent-search storage and clearing, and that the refusal renders one message with no variant copy.

**On device (two accounts at the same college):** find account B from account A by first name and by surname; turn off B's discoverability and confirm A's identical query returns the empty state; block in each direction and confirm the same; open B's social layer and confirm no match percentage there; tap **View dating profile** and confirm the full profile with Like and Rose; then set B's preferences to exclude A and confirm the same button gives the uniform message instead, with the social layer unchanged behind it.

---

## Sources

- [Can you search names on Tinder? Privacy and alternatives (Identingly)](https://www.identingly.com/blog/can-you-search-names-on-tinder)
- [Can you search for someone on Hinge (Dating Man Secrets)](https://datingmansecrets.com/can-you-search-for-someone-on-hinge/)
- [Hinge search: ways to find someone on Hinge (SocialCatfish)](https://socialcatfish.com/scamfish/hinge-search/)
- [How to find someone on dating apps like Tinder, Bumble and Hinge (Personpages)](https://personpages.com/blog/dating-app-lookup)
- [Instagram search: hidden features and how to use them (Sociality.io)](https://sociality.io/blog/instagram-search-features/)
- [Instagram SEO: how to rank on Instagram and Google (Buffer)](https://buffer.com/resources/instagram-search/)
- [Instagram search results: how to get discovered in 2026 (SEO Sherpa)](https://seosherpa.com/instagram-search-results/)
- [Can my contacts see me on Snapchat? Discovery and privacy settings (CLRN)](https://www.clrn.org/can-my-contacts-see-me-on-snapchat/)
- [How to find someone on Snapchat (Raptorkit)](https://raptorkit.com/how-to-find-someone-on-snapchat/)
