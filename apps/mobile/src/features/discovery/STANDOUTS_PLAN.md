# Standouts v3: the plan

A daily, personal shortlist of people worth a Rose, built for IEM Connect's size:
about 10,000 students per campus, many campuses, every profile with a video.

This document is the plan. It builds on `STANDOUTS_LIKES_SPEC.md` (section 5),
which describes Standouts as it works today, and changes it where marked **New**.

---

## 1. What we learned from Hinge

### How Hinge's Standouts works

- A separate feed, refreshed once a day. You can only send a **Rose** there, not a Like.
- Hinge's help page: *"profiles catching the most attention on Hinge, tailored to your
  preferences and recent activity."* So: popularity mixed with your taste.
- Hinge's CEO: Standouts are *"a bit more weighted towards, you're likely to like them
  versus they're likely to like you back."*
- Someone in your Standouts *"may later appear in Discover, but it's not guaranteed."*
- Hinge also has **Most Compatible**: one free daily pick of the person most likely to be a
  two-way match (stable matching, Gale-Shapley, plus machine learning).
- One free Rose a week. Hinge says Roses are about **twice as likely** to lead to a date as Likes.

### What users dislike ("rose jail")

- Attractive people feel locked behind a Rose, taken out of the free feed.
- Ranking by attention concentrates it: Hinge's likes have a Gini of **0.73 for men and
  0.63 for women**, more unequal than Tinder.
- Roses feel like *"shooting your shot at someone out of your league"*: spent on people who
  rarely answer.

### What we take, and what we leave

| Take | Leave |
|---|---|
| A short, daily, Rose-worthy list | Ranking by popularity |
| "Likely to like you back" | Taking people out of the free feed |
| Daily refresh with a countdown | Rose-only access to anyone |

On a campus, popularity ranking would put the same 20 people in everyone's Standouts.

---

## 2. Principles

1. **Personal, never popularity.** How many Likes or Roses someone receives is never an input.
2. **A Rose here should usually get an answer.** Only ready, active people who are reasonably
   likely to like you back.
3. **Spread attention across the campus.** Fairness is a feature, not a side effect.
4. **Never a jail.** Everyone in Standouts stays in Discover and Explore for a free Like.
5. **Explainable.** Every card says why: "3 shared interests", "Same department".
6. **No counts, anywhere.**

---

## 3. What our scale means

Planning figures for one campus (to be replaced with real numbers):

| | Estimate |
|---|---|
| Students | 10,000 |
| Using the app (~40%) | ~4,000 |
| Opening the app on a given day | ~1,500 |
| Gender split | maybe 70% men / 30% women |

Three consequences:

1. **Pools are large but lopsided.** A man looking for women has ~1,200 candidates; a woman
   looking for men has ~2,800. Without limits, every man's Standouts would point at the same
   few dozen women.
2. **Choosing one person at a time, in the order people open the app, is unfair.** Early
   openers would take the best matches before anyone's limit fills. At this scale, sets are
   **chosen all at once overnight** (section 6).
3. **Today's sample of 120 mostly random people is too small** out of thousands. Candidates
   must be gathered on purpose (section 5.2).

---

## 4. How many Standouts, and how many Roses

### 4.1 Standouts per day: **8** (today: 10)

- Fewer cards make each one feel special.
- 8 a day is 56 a week. With 5 Roses a week, a Rose goes to about 1 card in 11: a real choice.
- 8 × 1,500 daily users = 12,000 places per campus per day: enough to spread attention widely.

The 8 slots:

| Slots | Type | Who |
|---|---|---|
| 6 | **Best fit** | Highest scores (sections 5.3–5.4) |
| 1 | **New face** | Joined in the last 14 days, profile ready |
| 1 | **Wildcard** | Compatibility 60 or more, but a department or year you rarely like |

An unfilled slot goes to the next best fit. Small pools keep today's rule: fewer than **24**
eligible people gives a proportionally smaller set; below **3**, no set
("Not enough people yet — check back as your college joins").

### 4.2 Roses **New**

| Rule | Value | Why |
|---|---|---|
| Free each week | **5**, topped up to 5, never piling up | Today 20, which makes a Rose a Like with a badge. Hinge gives 1. |
| Sent per day, at most | **2** | A week's Roses can't go in one minute |
| Earned (invite plan) | +3 per invited friend who verifies; up to **15** held | Ties into the invite rewards |
| New users | +3 in their first week, once | A chance to try Roses early |
| **Receive limit** | Someone who has **received 5 Roses today** leaves Standouts for the rest of the day (they stay in Discover) | With more men than women, popular women would otherwise get dozens of Roses a day and stop reading them. The next sender is pointed at someone who will see theirs. |
| Rose push notifications | 3 a day at most (unchanged) | |

When this ships, tell users once: *"Roses are now rarer: 5 a week, and they go to the top of
someone's Likes."*

---

## 5. The algorithm

### 5.1 Who can be picked

**Unchanged:**

- Eligible both ways (`eligibleSql`): age, "Show me", area, verified college membership,
  "Must match" filters, no block, no match, no Pass from them.
- Not swiped on by you.
- **Not anyone who already liked you** — they are free in Likes You; a Rose on them would be a trap.

**New:**

| Rule | Detail |
|---|---|
| **Profile ready** | Profile video **processed and playable** (video is required in this app; this checks it finished processing), **at least 3 photos**, and a bio or at least 3 interests |
| **Active** | Active in the last **14 days** |
| **Not for me** | Hidden by you in the last **30 days** (today: only for the day) |
| **Receive limit** | Has not received 5 Roses today |

**Small campuses** relax step by step instead of showing nothing:

1. 2 photos instead of 3.
2. Active within 30 days instead of 14.

The video check is never relaxed.

### 5.2 Gathering candidates: ~600 per person, from four sources **New**

| Source | Share | What |
|---|---|---|
| **Shared interests** | 40% | Most interests in common (indexed interests search) |
| **Your taste** | 30% | Same department, year or traits as people you liked (5.3) |
| **Under-seen** | 20% | Ready profiles with few appearances in the past 7 days |
| **New** | 10% | Joined in the last 14 days |

The viewer's area setting applies here: own campus, college, city or whole group, as set in
My preferences. Your own campus first, as everywhere else (`nearFirst`).

### 5.3 Scoring: 0–100

| Part | Weight | What |
|---|---|---|
| **Compatibility** | 50% | The existing score: interests, intent, lifestyle, campus, personality, clubs, hangouts |
| **Your taste** **New** | 25% | How much they resemble people you liked (below) |
| **Likely to like you back** | 20% | The existing reciprocity prediction, scaled to 0–100. Counts once that person has 50+ swipes; neutral before |
| **Freshness** | 5% | Active today scores more than active this week |

**Never used:** Likes or Roses received.

**Your taste**, learned from swipes **New**:

- From your **last 200 swipes**: Likes count for a trait, Passes against.
- Traits: department, year of study, campus, hosteller or not, interests, what they're
  looking for, lifestyle, personality.
- Smoothed so a trait seen once doesn't dominate.
- A Rose sent from Standouts counts as a **strong** Like; "Not for me" as a **mild** Pass
  (5.6). Not acting is not a "no".
- **Worked out once per person per day**, in the night run, and stored with that day's set.
- **Fewer than 20 swipes**: neutral, and compatibility carries more weight.

### 5.4 Each person's list, with variety **New**

Ranked best first, picking one card at a time: the next card is the best remaining score
minus a penalty for being too similar to cards already picked.

**Hard limits per set:**

- At most **2** from the same department.
- At most **3** from the same year.
- A mix of "what they're looking for".

### 5.5 Sharing out picks fairly across the campus **New**

The core of the scale design.

**1. A daily limit per person, from that day's numbers.** For each group, such as men looking
for women on campus X:

```
average share = (people getting Standouts today × 8) ÷ eligible candidates
limit         = 2.5 × average share
```

Example: 1,000 men × 8 = 8,000 places, over 1,200 women = 6.7 each on average,
so the limit is **17**. Nobody appears in more than 17 men's Standouts that day.
This replaces today's fixed limit of 12, which is too many for a small campus and too few
for a large one.

**2. Round-robin picking.** Everyone is put in a random order. Each round, every person takes
their best remaining candidate who is under the limit; then the next round, until everyone
has 8. Like a sports draft: nobody gets all their top choices for going first, and the most
picked people stop appearing once they reach the limit.

**3. Under-seen boost.** Up to **+5** points for people with few appearances in the past
7 days, so attention reaches the whole campus.

**4. No repeats.** Nobody shown to you in the last 7 days, unless the pool is too small.

### 5.6 Save, explain, learn

**Save.** One database row per person per day (`standout_days`), as today, now with:

- the **slot type of each card** (best fit, new face, wildcard),
- the **taste profile** used that day.

History is kept **31 days** (today 8), for the 30-day "Not for me" rule.

**Explain.** Up to two reasons per card, only ever about the two of you:

- "3 shared interests", "Same department", "Same relationship goal", "2 shared clubs",
  "Same hangout spots" (unchanged),
- **"New on IEM Connect"** on the new-face card **New**.

**Learn.**

| Action | Effect |
|---|---|
| **Rose sent** | Strong positive signal for your taste |
| **Not for me** | Hidden for 30 days; mild negative signal for your taste. Not a Pass: nothing the other person could ever notice |
| **Neither** | Nothing learned |

### 5.7 Verified and Google-only accounts

Sign-up with Google is planned (`features/auth/GOOGLE_SIGNUP_PLAN.md`). A
Google-only account has no verified college until it adds a college email.

- **Only verified people are picked** for anyone's Standouts: it is a Rose-worthy
  showcase.
- A **Google-only viewer** gets a set from verified people in their area (the
  whole IEM–UEM group, until they verify).
- The fairness limits (5.5) group viewers with no college as
  **`group:<category>`**, beside the per-college groups.

### 5.8 Unchanged rules

- Rose only on the Standouts screen; a free Like in Discover and Explore always works.
- A card with a Rose sent stays, marked "Rose sent", for the rest of the day.
- Cards stay visible when you're out of Roses ("Next Roses in 3 days").
- The refresh countdown stays ("New Standouts in 5 h").
- No counts anywhere.

---

## 6. When it runs

**Nightly job, 00:30–03:00 India time**, for everyone active in the last 7 days, campus by
campus, so the fair sharing in 5.5 sees everyone at once.

**First-open fallback:** someone not covered by the night run gets their set on first open,
with the same steps, inside the limits that are left.

### Cost

| | Estimate |
|---|---|
| People per night | ~10,000–20,000 across campuses |
| Gathering per person | one database query, ~30–50 ms |
| Scoring 600 candidates | under 10 ms |
| Total | ~5–10 minutes with 4 workers |

Appearance counts per person per day are kept as their own records, so the round-robin is fast.

---

## 7. Admin settings (no app release needed)

| Setting | Starting value |
|---|---|
| Standouts v3 on/off | off, until tested |
| Standouts per day | 8 |
| Weights: compatibility / your taste / like-back / freshness | 50 / 25 / 20 / 5 |
| Fairness limit multiplier | 2.5 |
| Same department / same year per set | 2 / 3 |
| Roses: weekly / sent per day / receive limit / most held | 5 / 2 / 5 / 15 |
| Active window / "Not for me" window | 14 / 30 days |
| Under-seen boost | up to +5 |
| Night run window | 00:30–03:00 IST |

---

## 8. How we'll know it works

| Measure | Meaning | Target |
|---|---|---|
| **Rose answer rate** | Roses from Standouts that become matches | The main number; up |
| **Coverage** | Active ready profiles in at least one set a week | Over **70%** |
| **Fairness** | Inequality (Gini) of Standouts appearances and of Roses received | Well below Hinge's 0.63–0.73 |
| **Short sets** | Sets below 8, and how often the ready-check relaxes, per campus | Down |
| **Night run** | Duration, and people served by the first-open fallback | Under 15 min; fallback small |

---

## 9. Build order

| Phase | What |
|---|---|
| **1** | Ready check (video processed, 3 photos, bio or interests), 14-day activity, 30-day "Not for me" (keep 31 days of history), 8 cards a day, new Rose rules (5 a week, 2 a day, receive limit 5, new users +3, the one-time message) |
| **2** | Gathering from four sources; the your-taste score learned from swipes, worked out once per person per day and stored with the day's set; variety rules; the three slot types, with each card's slot type saved in the day's record and "New on IEM Connect" on the new-face card |
| **3** | The nightly job with the daily fairness limit and round-robin; the first-open fallback; the under-seen boost |
| **4** | Admin settings (section 7); the measures (section 8); shadow mode comparing v3 with today's Standouts before switching on |

Tests for every phase create and delete only their own test users. Never the suites that
empty the database (chat-regression, integration, chat-stories, outbox, security).

---

## 10. Open questions

1. **Real figures:** students per campus and the man/woman split, to check the planning
   numbers. The fairness limit is computed from live numbers every day either way.
2. **Roses from 20 to 5 a week:** confirm. People used to 20 will notice; the one-time
   message explains it.
3. **Most Compatible:** a separate free daily pick, like Hinge's, could come after this.
   Not part of this plan.

---

## Sources

- [Fortune: Hinge CEO Justin McLeod on the algorithm and rose jail](https://fortune.com/2024/01/18/hinge-ceo-justin-mcleod-interview-attractiveness-score-algorithm-rose-jail)
- [Hinge Help: What is Standouts?](https://help.hinge.co/hc/en-us/articles/360057625534-What-is-Standouts)
- [VidaSelect: Hinge Standouts](https://www.vidaselect.com/hinge-standouts)
- [ProfileSharp: Hinge rose jail](https://profilesharp.com/en/blog/hinge-rose-jail-standouts-roses)
- [The Focus: users angry about rose jail](https://www.thefocus.news/lifestyle/dating-app-users-are-raging-after-finding-themselves-in-rose-jail-between-matches/)
- [SwipeStats: how Hinge decides Most Compatible](https://www.swipestats.io/blog/hinge-most-compatible)
- [SwipeStats: dating app statistics (Hinge Gini)](https://www.swipestats.io/blog/dating-app-statistics)
- [Paul van der Laken: Tinder's unequal like economy](https://paulvanderlaken.com/2019/07/31/two-tinder-experiments-an-unequal-economy/)
