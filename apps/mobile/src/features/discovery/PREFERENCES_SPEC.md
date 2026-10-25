# My preferences

This document specifies **My preferences**, the screen opened from the deck header, and above all what **Done** changes. It replaces the first version, which kept choices "for this session" and left discovery untouched.

Markers, as in the other specs:

- **[source]**: stated in a published reference, listed at the end.
- **[decision]**: a choice made for this app, with the reason given.

---

## 1. Research: how other apps do it

| App | What it does |
| --- | --- |
| **Hinge** | Preferences are **soft**: people just outside them can still appear. Any preference can be made a **Dealbreaker**, and then it is strict **and two-sided**: you are only shown to each other if you both meet the dealbreakers either of you set. A question you leave unanswered keeps you out of feeds with a dealbreaker on it. **[source]** |
| **Tinder** | Age and distance each have a toggle to "show people slightly out of my preferred range", used mainly once someone runs out of people inside it. **[source]** |
| **Bumble** | A **Verified** filter is free. Advanced filters can only be set on questions you have answered yourself, and Bumble warns that every filter shrinks your deck. **[source]** |

---

## 2. The rules

| Choice | Kind | Effect |
| --- | --- | --- |
| **Show me** (Men, Women, Nonbinary) | Hard, both ways | As before |
| **Age range** | Hard, both ways | **18–35** **[decision]**. The highest degree in the IEM–UEM group is a PhD, which needs a Master's first. So the usual path is 18 (after Class 12) + 4 (B.Tech) + 2 (M.Tech) = 24 at the start of a PhD. UGC's PhD Regulations 2022 allow at most 6 years, so 30 at the latest, and 5 years' margin gives 35. The limit lives in `@iem-dating/shared/age`. Older values are brought inside the range (migration `20261001200000_age_range_18_35`), and older app versions that send, say, 60 are saved as 35 rather than refused |
| **Keep age flexible** | Widens the range | Up to **2 years** outside it, both ways. Those inside the strict range are shown first. On by default, as the screen always showed it **[decision]** |
| **Where to meet** (campus, college, city, group, nearby) | Hard | As before: a college scope, or distance mode |
| **Explore outside this area** | Widens the area | The existing "see further" |
| **Verified profiles only** | Hard, both ways | Someone who wants only verified people never sees an unverified one, and is never shown to one either **[decision]**, in the same way as Show me |
| **More criteria**, a soft choice | Ranks | People who match all of your soft choices come first, then those who match some, then the rest. **Nobody is hidden** (Hinge's preference) **[source]** |
| **More criteria**, "Must match" | Hard, **both ways** | Hinge's Dealbreaker **[source]**. An unanswered profile never matches it |

**[decision] Limits on "Must match":**

- **Your own answer is needed first.** The same rule as Bumble **[source]**. It also keeps the two-sided rule fair: you can't filter on a question others can't filter you on.
- **At most 3 at a time.** A single college is a small pool, and every dealbreaker shrinks it for both people.

The sheet shows the reason whenever the switch is locked.

---

## 3. What Done does

1. **Saves once.** `PUT /profile/preferences` with everything. The save runs the same checks discovery settings always ran:
   - *Nearby* needs a recent location, or offers **Location settings**;
   - *My campus* needs a campus;
   - changing the radius counts against the daily budget.
2. **Makes every open deck stale**, through `eligibility_version`.
3. **Changes every surface that shows people**, because they all read `eligibleSql`:

   | Surface | When it updates |
   | --- | --- |
   | The deck | Reloads straight away |
   | Browse | Reloads straight away |
   | Standouts | Today's set drops anyone the new filters exclude |
   | The map | Counts on its next open |
   | Likes You | A Like from outside a new dealbreaker leaves the list, and Liking it back is refused, since the list and the swipe share one rule. The update is live on every device |

4. **Search is not affected.** Search is the social layer, and dating filters never decide who can look a classmate up (`SEARCH_SPEC.md` section 4).

**Before Done, the footer shows a live estimate** of how many people the draft would show. It is a band, never a number:

- "Plenty of people match these choices."
- "A good number of people match."
- "Only a few people match…"
- "No one matches right now…"

**[decision]** It is a band because an exact count of classmates who fit a filter is a way to identify them.

**Reset** returns to what is saved, not to defaults.

---

## 4. Server

| Piece | Where |
| --- | --- |
| Columns | `match_criteria` (JSONB `{ id: { values, required } }`), `flexible_age`, `verified_only`. Migration `20261001100000_my_preferences` |
| Criteria | `match-criteria.ts` holds each question twice, side by side: the candidate's answers as SQL, and read from a row. `candidateMeetsMySql` and `iMeetCandidateSql` (retrieval) mirror `meetsRequired` (the swipe gate). Change one, change the other |
| Eligibility | `eligibleSql`, `mutuallyEligible`, `likeBackAllowed` and `likeBackSql` all apply flexible age, Verified only, and dealbreakers in both directions |
| Ordering | `RetrievalService.preferenceFirst`: a stable reorder after ranking and before `nearFirst` |
| API | `GET /profile/preferences` (includes `ownAnswers` and `maxRequired`), `PUT /profile/preferences`, `POST /profile/preferences/estimate` |
| Tests | `npm run test:preferences` (8, non-destructive). `test:location` (24) still cross-checks the SQL rules against the JS rules |

---

## Sources

- [IEM Kolkata courses, including doctoral (CollegeDekho)](https://www.collegedekho.com/colleges/iem-kolkata-courses)
- [PhD eligibility (UEM Kolkata)](https://uem.edu.in/uem-kolkata/phd-department/eligibility/)
- [UGC PhD regulations (DoctoratePath)](https://doctoratepath.com/blog/ugc-phd-key-regulations-and-latest-guidelines/)

- [How the Hinge algorithm works (SwipeStats)](https://www.swipestats.io/blog/hinge-algorithm)
- [How we connect daters (Hinge)](https://hinge.co/how-we-connect-daters)
- [Discovery Settings (Tinder Help Center)](https://www.help.tinder.com/hc/en-gb/articles/115003340963-Discovery-Settings)
- [Using filters to set your preferences (Bumble)](https://bumble.com/help/what-are-filters-and-advanced-filters)
- [How to use Advanced Filters (Bumble)](https://bumble.com/en/the-buzz/bumble-advanced-filters)
