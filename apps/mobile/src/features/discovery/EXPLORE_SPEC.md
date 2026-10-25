# Explore: browsing people by what you have in common

This document specifies the Explore surface: the browsable grid of people outside the swipe deck, its categories and filters, and the privacy rules that bound them. Search is a **separate** surface with different rules and a different threat model: `../search/SEARCH_SPEC.md`.

Each behaviour is marked by where it comes from:

- **[source]**: stated in a published reference, listed at the end.
- **[convention]**: how an app behaves in current builds without a published spec.
- **[decision]**: a choice made for this app, with the reason given.

Section 13 lists the decisions that need confirming before building.

---

## Contents

1. [What exists today](#1-what-exists-today)
2. [Research: how other apps do it](#2-research-how-other-apps-do-it)
3. [What Explore is for here](#3-what-explore-is-for-here)
4. [Categories](#4-categories)
5. [Filters](#5-filters)
6. [Running out, and what happens then](#6-running-out-and-what-happens-then)
7. [Server: retrieval and API](#7-server-retrieval-and-api)
8. [App: screen and cards](#8-app-screen-and-cards)
9. [Privacy and safety](#9-privacy-and-safety)
10. [Roses](#10-roses)
11. [Standouts](#11-standouts)
12. [Premium features, free here](#12-premium-features-free-here)
13. [Decisions to confirm](#13-decisions-to-confirm)
14. [Build plan](#14-build-plan)
15. [Verification](#15-verification)
16. [Sources](#sources)

---

## 1. What exists today

| Area | Today | Where |
| --- | --- | --- |
| Entry point | The **Explore** tab. The **Search** tab renders this same screen — there is no search | `MainTabNavigator.tsx`: `<Tab.Screen name="Search" component={ExploreScreen} />` |
| Categories defined | `for_you`, `new_here`, `active`, `shared_interests`, `same_department` | `search.service.ts` `ExploreCategory` |
| Categories actually shown | Only three. The chip strip filters the list to `for_you`, `shared_interests`, `new_here` — **`active` and `same_department` are unreachable in the app** even though the server supports them | `ExploreScreen.tsx`, `categories.filter(...)` |
| Filters | Interests, chosen in a bottom sheet. At most two "filter dimensions" total, where a non-default category counts as one | `EXPLORE_MAX_FILTER_DIMENSIONS = 2` |
| Small-group protection | A filtered cohort under 10 eligible people is refused with `EXPLORE_COHORT_TOO_SMALL` | `EXPLORE_MIN_COHORT = 10` |
| Retrieval | `RecommendationService.getRecommendations(userId, cursor, 40)`, then **filtered in memory** down to ≤20 | `SearchService.explore` |
| Eligibility | Shared with the deck: verified college membership, active account, mutual `showMeCategories`/`discoveryCategory`, mutual age preferences, college or distance geography, blocks both ways, already-swiped, already-matched, they-passed-you | `eligibility.service.ts` `eligibleSql` |
| Card | Photo, name, age, one shared interest. Tap opens the expanded profile (`ProfileDetailModal`) with Like, Pass and Request-to-follow | `ExploreProfileCard.tsx` |
| Impressions | Each card that becomes visible posts `/discover/visible` once | `ExploreScreen.tsx` `onViewableItemsChanged` |

**The structural problem.** Categories are applied **after** retrieval. Explore asks the recommender for 40 cards, then throws away everything that does not match "New here" or "My department". If those 40 happen to contain two people who joined this month, "New here" shows two people — however many actually exist. Every category is therefore a filter over the deck's top 40, not a view of the college. Section 7 moves the filtering into the query.

**A correction to an earlier claim.** An older planning document in this repo says discovery has no gender, orientation, age or distance filtering. That is **out of date**: `eligibleSql` enforces mutual `discovery_category` / `show_me_categories`, mutual age preferences, and college or distance geography today. The parts of that plan still open are ranking quality and deck size, not basic eligibility.

---

## 2. Research: how other apps do it

### 2.1 Tinder — Explore

- A free hub reached from a magnifying-glass icon, organising profiles into **curated interest and lifestyle categories** such as "Pet Parents", "Creatives", "Binge Watchers", "Coffee Date" and "Nature Lovers". **[source]**
- **My Vibe** browses by dating intention: "Free Tonight", "Coffee Date", "Looking For Love". **[source]**
- **Vibes** are time-limited events: everyone answers the same themed questions within 48 hours, and the answers sit on the profile for 72 hours. **[source]**
- Tiles can be seasonal or event-based, so the set is editorial, not fixed. **[source]**

### 2.2 Hinge — Standouts and Most Compatible

- **Most Compatible** puts one recommendation a day at the top of Discover, built from mutual dealbreakers, recent activity, and patterns in who people Like; it expires after 24 hours. **[source]**
- **Standouts** is a *separate feed* of profiles currently getting attention, and costs a Rose rather than an ordinary Like to reach. **[source]**

### 2.3 Bumble — filters

- Basic filters: age, distance, verified, languages, interests. Advanced (paid): height, exercise, star sign, education, dating intentions, religion, politics, drinking, smoking, children. **[source]**
- **You can only filter on an attribute you have filled in yourself.** **[source]**
- When you exhaust a filtered set, Bumble starts showing people outside the filters rather than leaving you on an empty screen. **[source]**

### 2.4 Instagram — Explore

- A recommendation engine over accounts you do **not** follow, driven by predicted interest rather than the social graph. **[source]**
- 2026's dominant ranking signals are watch time, sends per reach, then likes per reach; shares now count heavily. **[source]**

### 2.5 What transfers, and what does not

| Idea | Here? |
| --- | --- |
| Interest and lifestyle category tiles (Tinder) | **Yes.** The app already has a full interest catalogue, plus department, campus, hostel, clubs, hangout spots, year |
| Intention-led browsing ("My Vibe") | **Yes**, from the existing `seeking` field |
| One daily most-compatible person (Hinge) | **Yes** — cheap, and the compatibility score already exists |
| A separate "getting attention" feed (Standouts) | **Yes, adapted** (section 11) — personalised per viewer and rose-gated, with no like counts and an exposure cap, so it is not a popularity ranking of classmates |
| Roses as a scarce, higher-priority like (Hinge) | **Yes** (section 10), 20 free a week rather than Hinge's one |
| Filter only on what you filled in (Bumble) | **Yes** **[decision]** — it also nudges profile completion |
| Silently widening past your filters when exhausted (Bumble) | **No** **[decision]** — with a 10-person cohort floor, quietly widening can undo the guarantee. Offer it as a tap instead (section 6) |
| Paid filter tiers | **Free here** (section 12) — everything other apps charge for that helps you *find* people is free; the limits that remain exist for privacy and anti-abuse, not price |
| Time-limited Vibes events (Tinder) | **Later** **[decision]** — it needs someone writing and scheduling prompts every week |
| Engagement-velocity ranking (Instagram) | **No** — there is no public post to accumulate engagement; ranking stays compatibility-led |

---

## 3. What Explore is for here

**[decision]** The swipe deck answers "who next?". Explore answers "who is like *this*?" — a browsable, filterable view of the same eligible people, where the person chooses the axis.

Three rules follow, and everything below obeys them:

1. **Same eligibility, always.** Explore never shows anyone the deck would not show. It reuses `eligibleSql`, so mutual categories, mutual ages, geography, blocks and prior swipes all hold.
2. **Explore reveals a cohort, not an individual.** Every axis a person can filter on is a group of at least ten (section 9). This is what keeps "Computer Science, 2027, hostel" from being a way to identify one classmate.
3. **No new dating signal is exposed.** A card in Explore shows exactly what a deck card shows. Nothing here says who is popular, who is online now to the minute, or who liked whom.

---

## 4. Categories

A horizontal strip, one selected at a time. **[convention]** All of these run in SQL (section 7), so each is a real view of the eligible college, not a filter over 40 cards.

| Category | Shows | Source field |
| --- | --- | --- |
| **For you** | The recommender's order, unfiltered. The default | — |
| **New here** | Joined in the last 30 days | `users.created_at` |
| **Active** | Active in the last 7 days | `users.last_active_at` |
| **Shared interests** | At least one interest in common with you | `preferences.interests` |
| **My department** | Same department | `users.department` |
| **My year** | Same graduation year or year of study | `graduation_year`, `year_of_study` |
| **On campus** | Same campus | `users.campus` |
| **Looking for the same thing** | Same `seeking` value as you | `users.seeking` |

**[decision]** `My year`, `On campus` and `Looking for the same thing` are new; `Active` and `My department` already exist server-side and are simply unreachable in the app today (section 1).

**Rules**

- A category whose source field is empty **on your own profile** is not offered — you cannot browse "My department" with no department set. **[decision]**, following Bumble's rule that you may only filter on what you have filled in. The chip is replaced by a one-tap prompt to complete that field.
- A category whose eligible cohort is under ten is not offered either, and says so plainly rather than returning an empty grid (section 6).
- Selecting a category replaces the previous one. Categories are never combined with each other — only with interests (section 5).

### 4.1 Most compatible today

**[decision]** One card, pinned above the grid in **For you** only, refreshed daily and expiring after 24 hours, following Hinge's Most Compatible. **[source]**

- Chosen as the highest `compatibilityScore` among eligible people not yet swiped.
- Labelled "Most compatible today" with the score, and never re-shown once acted on.
- Deliberately one person, not a ranked list: a leaderboard of classmates is exactly what section 3's third rule forbids.

---

## 5. Filters

A bottom sheet, as today, with two groups.

**Interests** — from `INTEREST_CATEGORIES`, the catalogue the profile editor already uses. Selecting an interest narrows the current category.

**Attributes** **[decision]** — a small set drawn from fields the app already stores, each offered only when you have filled it in yourself:

| Filter | Field |
| --- | --- |
| Hosteller / day scholar | `is_hosteller` |
| Club | `clubs` |
| Hangout spot | `hangout_spots` |
| Degree | `degree` |

**[decision]** No height, religion, politics, drinking, smoking or children filters, which Bumble puts behind Advanced Filters. **[source]** In a single-college population those combine into an identifying description of one person far faster than they do on a city-wide app, and several are sensitive categories this app has no reason to index on.

**Dimension limit.** At most **two** dimensions at once, unchanged from today, where a non-default category counts as one and each interest or attribute counts as one. `EXPLORE_MAX_FILTER_DIMENSIONS = 2` stays.

---

## 6. Running out, and what happens then

Three distinct states, each with its own copy. **[decision]** They are easy to confuse and today only the second exists.

| State | Cause | What the app shows |
| --- | --- | --- |
| **Too small to show** | Fewer than ten eligible people match | "Not enough people match this to show it privately. Try a broader filter." The category or filter is disabled, not merely empty |
| **Seen everything** | The cohort is ≥10 but you have swiped all of them | "You've seen everyone in this filter." Plus a **Broaden** button that drops the narrowest dimension, and a **For you** button |
| **Nothing to load** | Network or server failure | "Explore could not load. Check your connection and try again." Retry |

**[decision]** The cohort floor counts *eligible* people, not *unswiped* ones. Otherwise the message would flip from "too small" to "seen everyone" as you swipe, which leaks the size of a group you were told was too small to show.

---

## 7. Server: retrieval and API

### 7.1 The change that matters

Category and filter predicates move **into** the eligible query, alongside `eligibleSql`, and the recommender orders what comes back — instead of the recommender choosing 40 and Explore discarding most of them.

```
GET /search/explore
  ?category=new_here          one of section 4
  &interests=music,football   0..2
  &attributes=hosteller:true  0..2 (section 5)
  &cursor=...&limit=20
```

```sql
SELECT u.id FROM users u
WHERE ${eligibleSql(me)}
  AND ${categoryPredicate}      -- created_at / last_active_at / department / year / campus / seeking
  AND ${interestPredicate}      -- (u.preferences->'interests') ?| $interests
  AND ${attributePredicate}
ORDER BY ${recommenderOrder}
LIMIT $limit + 1
```

**[decision]** Keep `RecommendationService` as the source of *order*, not of *membership*: Explore asks it to score the filtered set, rather than filtering its output. That keeps one scoring implementation while making each category complete.

### 7.2 Indexes

Needed for the new predicates, all `CONCURRENTLY`:

```sql
CREATE INDEX users_explore_created_idx  ON users (created_at DESC)      WHERE account_status = 'active';
CREATE INDEX users_explore_active_idx   ON users (last_active_at DESC)  WHERE account_status = 'active';
CREATE INDEX users_explore_department_idx ON users (department)         WHERE account_status = 'active';
CREATE INDEX users_interests_gin        ON users USING GIN ((preferences->'interests'));
```

### 7.3 Cohort counting

`filteredCohortSize` already bounds its count with `LIMIT EXPLORE_MIN_COHORT` — it asks "are there at least ten?", never "how many?". **Keep that exactly.** An exact count is itself a disclosure about a small group. Extend it to the new categories and attributes unchanged in shape.

### 7.4 Responses

`{ cards, nextCursor, category, state }` where `state` is `ok`, `cohort_too_small`, or `exhausted` — so the app can render section 6's three states without inferring them from an empty array. **[decision]** Today "too small" arrives as a `409` error code and "exhausted" is indistinguishable from "empty".

---

## 8. App: screen and cards

| Where | Change |
| --- | --- |
| `ExploreScreen.tsx` | Show every category the server offers, rather than a hardcoded three; render the three empty states; pin Most compatible today in For you |
| `ExploreScreen.tsx` filters sheet | Interests plus the attribute filters; grey out anything missing from your own profile, with a link to fill it in |
| `ExploreProfileCard.tsx` | Unchanged. Tap still opens `ProfileDetailModal` with Like, Pass and Request-to-follow |
| New `exploreCategories.ts` | The category list, their labels, and which profile field each needs, shared by the chips and the filter sheet |

The custom bottom navbar is not touched. **Search stops pointing at this screen** — that is `SEARCH_SPEC.md`, section 8.

---

## 9. Privacy and safety

- **The cohort floor is the core rule.** Ten eligible people minimum, counted boundedly (7.3), before any filtered view renders. This is what stops filters being used to single out one classmate.
- **Two dimensions maximum**, for the same reason: "CSE" is a cohort, "CSE + 2027 + hosteller + chess club" is a person.
- **Only fields you filled in yourself** can be filtered on, which keeps people from being sorted on attributes they chose not to publish.
- **No popularity surface.** No Standouts equivalent, no "most liked", no view counts on anyone's profile.
- **No precise activity.** "Active" means within 7 days, never "online now" or a last-seen timestamp — `show_online_status` already governs presence in chat and Explore must not route around it. **[decision]**
- **Same eligibility as the deck**, so blocks, prior passes and mutual preferences all hold; Explore can never be used to see someone who has excluded you.
- **Impressions** continue through `/discover/visible`, so Explore views count the same as deck views for exposure fairness.

---

## 10. Roses

**[decision]** A Rose is a scarce, higher-priority Like. It is the only currency in the app, and for now it is free.

### 10.1 What one is

| Property | Here | Hinge, for comparison |
| --- | --- | --- |
| What it does for the sender | Their Like lands at the **top** of the recipient's Likes You, marked as a Rose, with an optional short comment | The same **[source]** |
| What it does for the recipient | Nothing is forced. They accept or decline as with any Like | The same — "the recipient still chooses" **[source]** |
| Where it can be sent from | The deck, Explore, a Standout (where it is the **only** way to Like, section 11), and a profile opened from Search (`SEARCH_SPEC.md`, section 5) | Discover and Standouts **[source]** |
| Grant | **20 a week**, free | One a week free; more with HingeX **[source]** |
| Accumulation | **None.** The weekly grant tops the balance up *to* 20; it does not add 20 | Free Roses do not accumulate **[source]** |

**[decision] Why top-up rather than accrual.** Hinge's rule exists for a reason: if grants stacked, an account dormant for two months would return holding 160 Roses, which is a spam budget rather than a signal of interest. Topping up to a ceiling keeps a Rose meaning "I chose this person this week".

### 10.2 The grant

- 20 Roses, refreshed weekly, **configurable at runtime** through the existing `AlgorithmConfig` numeric settings (`roses_weekly_grant`), so the number can come down from 20 once the app is past its growth phase without a release. **[decision]** The user's intent is explicitly "free while I gain users"; the plan should not hard-code the promotional value.
- The refresh is lazy: the balance and its `roses_refreshed_at` are brought up to date when read or spent, so there is no weekly job over every account. **[decision]**
- Roses are never purchasable in this version. There is no payment path anywhere in the app.

### 10.3 Limits that keep 20 a week from becoming spam

Hinge gives one a week; twenty is generous enough that the abuse cases have to be designed for up front. **[decision]**

| Limit | Value | Reason |
| --- | --- | --- |
| Per recipient | **One Rose per person per 30 days** | Stops one person being rosed repeatedly by the same sender |
| Per day | **5** | A week's allowance cannot be spent on one evening's spree |
| Eligibility | A Rose obeys exactly the rules an ordinary Like obeys | A Rose must never reach someone a Like could not |
| Comment | Optional, ≤140 characters, through the same abuse filters chat messages pass | It is the one piece of free text a stranger can put in front of you |
| Withdrawal | Not possible once sent | Matches a Like; an "unsend" would let someone probe and retract |

### 10.4 What Roses depend on

**Roses only mean something if there is a Likes You screen, and there is not one today.** The whole dating surface is `/discover/recommendations`, `/discover/swipe` and `/discover/visible` — nothing shows a person who has liked you until a match already exists. A Rose that lands at the top of a screen nobody can open is worth nothing, so **Likes You ships with Roses, not after them** (section 12, and the build plan).

### 10.5 Data model and API

```prisma
model User {
  // ...
  roses            Int      @default(20)
  rosesRefreshedAt DateTime @default(now()) @map("roses_refreshed_at")
}

/// One Rose, kept so the recipient's Likes You can order and mark it, and so
/// the per-recipient limit in 10.3 can be enforced.
model Rose {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  senderId    String   @map("sender_id") @db.Uuid
  recipientId String   @map("recipient_id") @db.Uuid
  swipeId     String?  @map("swipe_id") @db.Uuid
  comment     String?  @db.VarChar(140)
  createdAt   DateTime @default(now()) @map("created_at")
  @@index([recipientId, createdAt(sort: Desc)])
  @@index([senderId, recipientId, createdAt(sort: Desc)])
  @@map("roses")
}
```

| Route | Does |
| --- | --- |
| `GET /discover/roses` | Balance and when it next refreshes, after a lazy top-up |
| `POST /discover/swipe` | Gains `rose: true` and an optional `comment`. Spends one Rose atomically with the swipe, in one transaction, so a failure cannot take the Rose without recording the Like |
| `GET /discover/likes-you` | The Likes You list: Roses first, newest first, then ordinary Likes. Each row carries `isRose` and the comment |
| `GET /discover/standouts` | Today's set (section 11), each marked `roseOnly: true` |

**[decision]** The balance is spent inside the swipe transaction rather than in a separate call, so a Rose is never deducted for a Like that did not land — and a retry of the same `clientSwipeId` never spends twice.

---

## 11. Standouts

**[decision]** A second feed, separate from Explore's categories: a small daily set of people chosen for *you*, where the only way to reach someone is a Rose.

| Property | Here | Hinge, for comparison |
| --- | --- | --- |
| Contents | 10 profiles, refreshed daily | "Profiles receiving a lot of attention that still meet your preferences", refreshed regularly **[source]** |
| How to reach someone | **A Rose only.** Ordinary Likes are not offered | The same **[source]** |
| Chosen by | *Your* compatibility score, their recent activity, and a per-person exposure cap (below) | Attention received, within your preferences **[source]** |
| Like counts shown | **Never** | Not shown |

**[decision] How this avoids becoming a popularity board.** Hinge's Standouts leans on how much attention a profile is getting. In a single college, a feed of "who is getting the most attention" is a ranked list of classmates, and everyone would compare notes. Three rules prevent that:

1. **Personalised, not global.** The set is computed per viewer from their own compatibility ordering. Two friends comparing screens see mostly different people.
2. **An exposure cap.** One person may appear in at most a bounded number of other people's Standouts per day, using the same exposure counters discovery already keeps (`ImpressionService`). Without this, the most compatible-with-everyone person ends up in everyone's feed, which reproduces the leaderboard by accident.
3. **No counts, ever.** Nothing in the app says how many Likes or Roses anyone has received.

Standouts respects `eligibleSql` exactly like every other surface, and its impressions are recorded through `/discover/visible` so the fairness metrics see them.

---

## 12. Premium features, free here

Other apps put most of discovery behind a subscription. This app has no payment path at all, so the question is not "what do we charge for" but "which of these are good for people, and which only exist to sell". **[decision]**

The rule applied below: **anything that helps you find or be found is free; anything that buys an advantage over other users, or weakens safety, is not built at all** — not sold, not given away.

| Feature, and where it is paid | Here | Why |
| --- | --- | --- |
| Unlimited Likes (Tinder Plus, Hinge+, Bumble) **[source]** | **Free**, with an anti-abuse rate limit only | A cap on Likes is a paywall, not a safety measure. The limit that stays is the one that stops scripted mass-liking |
| See who liked you (Tinder Gold, HingeX, Bumble Beeline) **[source]** | **Free — and it has to be built** (10.4) | The single most valuable paid feature elsewhere, and the precondition for Roses meaning anything |
| Advanced filters (Hinge+, Bumble Premium) **[source]** | **Free**, bounded by the cohort floor and the two-dimension rule (sections 5, 9) | The bound that remains is about not identifying one classmate, not about price |
| Sort by Most Compatible (Hinge+) **[source]** | **Free** | It is only an ordering |
| Top Picks / daily standout profiles (Tinder Gold) **[source]** | **Free** — "Most compatible today" (section 4.1) and Standouts (section 11) | |
| Weekly Super Likes / Roses (Tinder Gold, HingeX) **[source]** | **Free — 20 a week** (section 10) | |
| Rewind the last swipe (Tinder Plus) **[source]** | **Free, narrowly**: the last swipe only, within 60 seconds, once per swipe | It fixes a misplaced thumb. A longer window turns into a way to re-open and re-examine profiles you dismissed |
| Boost / Spotlight (Tinder Gold, Bumble) **[source]** | **Not built** **[decision]** | It is zero-sum by construction: if everyone is boosted, nobody is. Free boosts would be theatre, and paid ones are the thing this app is choosing not to be |
| Priority Likes (Tinder Platinum) **[source]** | **Not built** **[decision]** | Its only effect is to push other people's Likes down the queue |
| Passport / Travel Mode (Tinder Plus, Bumble) **[source]** | **Not built** **[decision]** | Membership is verified against a real institution. Letting someone browse another college by changing a setting undoes the boundary the whole app rests on |
| Message before matching (Tinder Platinum) **[source]** | **Not built** **[decision]** | Unsolicited messages to strangers, inside one campus, is a harassment channel. The Rose comment (10.3) is the safe version: short, filtered, attached to a Like, and only opens a chat if accepted |
| Incognito (Tinder Plus, Bumble) **[source]** | **Deferred** **[decision]** | It overlaps confusingly with controls that already exist — Stories audience, hidden list, and `search_discoverable` — and needs its own design before being bolted on |
| No ads (Tinder Plus) **[source]** | Not applicable | There are no ads |

---

## 13. Decisions to confirm

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Add `My year`, `On campus`, `Looking for the same thing`, and surface the existing `Active` / `My department`? | Yes — five categories the server can already support or nearly support |
| 2 | Attribute filters limited to hosteller, club, hangout spot, degree? | Yes; no height/religion/politics/drink/smoke/children |
| 3 | One "Most compatible today" card in For you? | Yes, expiring daily, never a ranked list |
| 4 | Offer **Broaden** on exhaustion rather than silently widening like Bumble? | Yes — silent widening can undo the cohort floor |
| 5 | Keep the cohort floor at 10 and the dimension cap at 2? | Yes, unchanged |
| 6 | Categories hidden when your own field is empty? | Yes, with a prompt to complete the profile |
| 7 | **20 Roses a week, topping up rather than accumulating?** | Yes — accrual turns a dormant account into a spam budget (10.1) |
| 8 | Rose limits: one per person per 30 days, 5 a day, 140-character filtered comment? | Yes — 20 a week is twenty times Hinge's grant, so the abuse cases need bounding up front |
| 9 | Grant configurable at runtime rather than hard-coded? | Yes — it is a growth-phase number, not a permanent one |
| 10 | Standouts personalised per viewer, rose-only, no counts, exposure-capped? | Yes — the only version that is not a public ranking of classmates |
| 11 | **Build Likes You as part of this?** | Yes — Roses have no meaning without it, and it is the feature other apps charge most for |
| 12 | Free: unlimited Likes, Likes You, filters, Most Compatible, Top Picks, Roses, narrow Rewind | Yes |
| 13 | Not built at all: Boost, Priority Likes, Passport, Message-before-matching; Incognito deferred | Yes — each is either zero-sum, or a safety hole in a single-campus app (section 12) |

---

## 14. Build plan

| Phase | Scope |
| --- | --- |
| **A. Retrieval** | Move category, interest and attribute predicates into SQL beside `eligibleSql`; indexes; `state` in the response; extend bounded cohort counting to the new axes |
| **B. Categories and filters** | `exploreCategories.ts`; full chip strip; attribute filters; own-field gating; the three empty states |
| **C. Most compatible today** | Daily pinned card in For you, 24-hour expiry, no list |
| **D. Likes You** | `GET /discover/likes-you`, the screen, and the notification when a Like arrives. Ships before or with Roses, never after |
| **E. Roses** | `roses` / `roses_refreshed_at` columns, the `roses` table, lazy weekly top-up, `rose` on the swipe route inside one transaction, the per-recipient and per-day limits, comment filtering, the balance indicator, Roses first in Likes You |
| **F. Standouts** | Daily personalised set, rose-only interaction, exposure cap, impressions through `/discover/visible` |
| **G. Free premium** | Unlimited Likes with abuse-only rate limits, narrow Rewind, Sort by Most Compatible |

Phase A is invisible on its own but fixes correctness — every category becomes a real view of the college — so it ships and is verified first. **D precedes E**, for the reason in 10.4: a Rose with nowhere to land is not a feature.

### 14.1 Implementation status

**A through G are built, server and app, and verified against the real database.**

| Area | Where |
| --- | --- |
| Retrieval (A) | `ExploreService` (new): every category, interest and attribute predicate in SQL beside `eligibleSql`; `RetrievalService.exploreIds`; bounded cohort counting kept bounded; the ranked list cached per browse in Redis so paging is stable; `state` in the response. `SearchService` deleted — its post-filtering was the bug |
| Categories and filters (B) | `exploreCategories.ts` (new, shared); the full chip strip including `active` and `same_department`, which the app could never reach before; `same_year`, `same_campus`, `same_intent` added; attribute filters from your own fields only; the three empty states with **Broaden** |
| Most compatible today (C) | `ExploreService.mostCompatibleToday`: one person, same all day in the reader's own clock, **spent rather than replaced** once acted on; pinned above the grid in For you |
| Likes You (D) | `LikesService.received`, `GET /discover/likes-you`; `LikesYouScreen` (new) — Roses first with the comment attached, reached from the heart in the Explore header. Liking back always matches, because they already liked you |
| Roses (E) | Migration `20260923000000_roses` (applied); `RoseService` with the lazy weekly top-up, per-recipient and per-day limits; spent inside the swipe transaction; `GET /discover/roses`; `rose` and `comment` on the swipe route. App: `RoseSheet` (composer, optional note, balance) and `useRoses` (shared balance), wired into Explore, the deck and Standouts; the Rose button sits between Pass and Like with the balance on it, and stays visible at zero so it can explain itself |
| Standouts (F) | `StandoutsService` (new), `GET /discover/standouts`; `StandoutsScreen` (new), reached from the sparkles in the Explore header. Ten a day, fixed for the day in the reader's own clock, personalised rather than global, a per-person daily exposure cap via Redis, and **no Like button** — a Rose is the only way to reach someone |
| Free premium (G) | Unlimited Likes: already true — there was never a daily cap, only the 120/minute anti-script burst limit, which is exactly the limit section 12 says to keep. Rewind: `RewindService` (new), `GET`/`POST /discover/rewind`, and a countdown button on the deck. Sort by Most Compatible: `sort=compatibility` on `/search/explore`, in the Explore filter sheet |
| Shared plumbing | `discovery-cards.service.ts` (new) — the day boundary, the non-blocking cache, and card building with impression receipts, so Explore and Standouts cannot drift apart on any of the three |
| Tests | `npm run test:roses` (9) and `npm run test:standouts` (8), both non-destructive. Roses: top-up-not-accrual, atomic spending, replay, the limits, Rose-first ordering. Standouts and Rewind: bounded and stable for the day, no attention counts on a card, answered picks drop out, and Rewind's four refusals — stale window, second undo, a swipe that matched, and the Rose refund |
| Test data | `scripts/seed-explore-testers.ts` — 24 testers per real account, clustered so every category clears the cohort floor of 10; `--remove` deletes them |

**A note from building A.** Two accounts can only ever see each other when their `discovery_mode` matches — `mutuallyEligible` returns false across `college` and `distance`, before any Explore filter is considered. The two test accounts on this project are one of each, which is why both the deck and Explore show nothing for them. That is existing behaviour, not something Explore introduced, but it is worth a decision of its own: arguably a college-mode person and a distance-mode person who satisfy *both* constraints should match.

**A defect found while testing F, and the decision it forced.** `eligibleSql` and `mutuallyEligible` disagreed in college mode: retrieval required only the same verified institution, while the swipe endpoint *also* required the same free-text `college` string. Every retrieval surface — the deck, Explore, Standouts — could therefore show a card whose swipe then failed with `PROFILE_UNAVAILABLE`.

**[decision] The verified institution is authoritative; the typed college name does not decide who may meet whom.** `student_memberships.institution_id` is verified against a real institution and is the boundary the whole app rests on. `college` is entered during onboarding and varies by spelling, casing and whitespace — two verified students of the same institution who wrote it differently were invisible to each other, with no error and nothing to notice. So `mutuallyEligible` no longer compares the string, and `eligibleSql` is unchanged. `setupComplete` still requires a non-empty `college`, because it is a profile field people see.

`mutuallyEligible(a, b, { sameInstitution })` now takes that verified fact as a **required** argument rather than an optional one. In college mode it is the entire geography test, so a caller that could omit it would either match people across institutions or make them silently invisible; requiring it moves that mistake to compile time. Both callers — `SwipeService` and `FollowService` — already checked verified same-institution before calling, so neither gained a check and nobody lost reachability.

**One deviation from section 11.** Standouts is Rose-only *as a surface* — the screen offers no Like, and the profile opened from it offers only a Rose. The server does not additionally refuse an ordinary Like aimed at the same person from elsewhere, because Standouts draws from the same eligible pool as Explore and the deck, so overlap is certain; refusing a Like in Explore because that person happened to be in today's Standouts would read as a bug, not a rule.

---

## 15. Verification

**Server** — non-destructive integration tests creating their own users (`npm run test:explore`):

- Every category returns only people who satisfy both `eligibleSql` and that category, and never someone blocked, already swiped, already matched, or outside mutual preferences.
- A category whose cohort is 9 returns `cohort_too_small`; at 10 it returns cards. The count query never returns a number above the floor.
- Three dimensions are refused; two are accepted.
- Exhausting a cohort returns `exhausted`, not an empty `ok`, and the message does not change as the cohort shrinks through swiping.
- Most compatible today returns one person, the same person for the whole day, and never someone already swiped.

**Roses and Standouts** (`npm run test:roses`):

- A week-old balance of 3 tops up to 20, not to 23; two reads in the same week top up once.
- Spending is atomic: a swipe that fails leaves the balance untouched, and replaying the same swipe id spends one Rose, not two.
- The per-recipient limit refuses a second Rose to the same person inside 30 days; the daily limit refuses the sixth in a day; a Rose to someone outside `eligibleSql` is refused exactly as a Like would be.
- A Rose appears above every ordinary Like in the recipient's Likes You, carries its comment, and a comment that fails the abuse filter is refused before the Rose is spent.
- Standouts: rose-only (an ordinary Like is refused), never repeats a person inside a day, respects `eligibleSql`, honours the exposure cap across viewers, and no response anywhere contains a count of Likes or Roses received.

**App** — type-check; unit tests for category gating against a profile with missing fields, the three empty states, and the Rose balance indicator at 0.

**On device (two accounts):** set a department on one account only and confirm "My department" is offered to that account and prompts the other; filter to a tiny interest and confirm the "not enough people" state rather than an empty grid; swipe through a small cohort and confirm "seen everyone" plus Broaden; send a Rose with a comment and confirm it sits at the top of the other account's Likes You with the comment attached; try a second Rose to the same person and confirm it is refused.

---

## Sources

- [Explore (Tinder Help Center)](https://www.help.tinder.com/hc/en-us/articles/38094560737677-Explore)
- [Tinder Explore explained (VIDA Select)](https://www.vidaselect.com/tinder-explore)
- [Tinder Vibes explained (VIDA Select)](https://www.vidaselect.com/tinder-vibes)
- [How to use Tinder's Explore page (MakeUseOf)](https://www.makeuseof.com/how-to-use-tinder-explore-page/)
- [Hinge employs new algorithm to find your "most compatible" match (TechCrunch)](https://techcrunch.com/2018/07/11/hinge-employs-new-algorithm-to-find-your-most-compatible-match-for-you/)
- [How the Hinge algorithm works in 2026 (SwipeStats)](https://www.swipestats.io/blog/hinge-algorithm)
- [Hinge Most Compatible explained (VIDA Select)](https://www.vidaselect.com/hinge-most-compatible)
- [What are filters and advanced filters? (Bumble Support)](https://bumble.com/en-us/help/what-are-filters-and-advanced-filters)
- [How to use advanced filters on Bumble (Bumble Buzz)](https://bumble.com/en/the-buzz/bumble-advanced-filters)
- [Instagram algorithm in 2026: rank signals (Later)](https://later.com/blog/how-instagram-algorithm-works/)
- [Instagram algorithm 2026 ranking signals (Hootsuite)](https://blog.hootsuite.com/instagram-algorithm/)
- [Roses (Hinge Help Center)](https://help.hinge.co/hc/en-us/articles/36311177115027-Roses)
- [Hinge Roses: how they work and the weekly reset (SwipeStats)](https://www.swipestats.io/blog/hinge-roses)
- [Navigating Roses on Hinge (The Match Artist)](https://thematchartist.com/hinge/what-is-a-rose-on-hinge)
- [Hinge Standouts: what they are (VIDA Select)](https://www.vidaselect.com/hinge-standouts)
- [Tinder subscriptions (Tinder Help Center)](https://www.help.tinder.com/hc/en-us/articles/115004487406-Tinder-subscriptions)
- [Tinder Plus vs Gold vs Platinum (SwipeStats)](https://www.swipestats.io/blog/tinder-plus-vs-tinder-gold)
- [Hinge vs Bumble vs Tinder 2026 (SwipeStats)](https://www.swipestats.io/blog/hinge-vs-bumble-vs-tinder)
