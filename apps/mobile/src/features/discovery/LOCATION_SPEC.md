# Location — research and plan

Location is the most dangerous data this app holds. In a single-college app the realistic attacker is not a stranger across the world. It is a classmate with a verified account, and the thing they want is which hostel block or flat someone sleeps in. Everything below is written against that threat model.

**Status: built.** L0 through L7 are built, server and app, and verified; only L8 (PostGIS) waits, by design, until the numbers call for it. Section 13 records what was built, where the build deliberately differs from the plan above, and the defects found along the way.

---

## 1. Summary

| | Today | After this plan |
| --- | --- | --- |
| Asking for location | Once, in settings, if you think to look | On every open in distance mode, the way Bumble and Tinder do, through our own screen first so Android's two-denial limit is never wasted (6.1) |
| Precise vs approximate | Precise requested; approximate not handled | Both supported. Precise is rounded **on the phone**, so it never leaves the device (6.2) |
| Precision stored | ~1.1 km grid | ~2.2 km grid (6.4) |
| How often it updates | Once. Never again | On app open, only when you have moved to a new cell (6.7) |
| Saved places | None | Up to 3 places you have actually been (Home, Hostel, …), à la Swiggy, each with a "hide me here" option (7) |
| Campuses | One free-text "Gurukul/Ashram" field; New Town and Management House missing; UEM Kolkata and UEM Jaipur indistinguishable at sign-up | Real campus list per institution; a college scope that answers "can Gurukul see New Town, and can Jaipur see Kolkata?" (8) |
| College vs distance users | Can never match | Can match through the campus anchor you approved (8.5) |
| Map | None | happn-style map with three layers: campuses and hangout spots (who, from profile facts), and areas around you (how many only, never who is where) (9) |
| Teleporting (spoofed GPS) | Unlimited *(fixed in L0)* | Rate-limited, speed-checked, logged |
| Switching to college mode | Kept coordinates *(fixed in L0)* | Coordinates erased |

---

## 2. What exists today

Verified in the code, not assumed:

- **Coordinates are snapped before storage** to a 0.01° grid (`snapToGrid`, [geo.ts](../../../../api/src/utils/geo.ts)). Exact GPS is never persisted, and distance is computed between cell centres on the server.
- **Distances are shown as bands**, never numbers (`distanceLabel`).
- **Distance is a filter, never an ordering.** Nothing in `compatibility`, `ranking-policy`, `discovery-ranking` or `recommendation` sorts by distance. The Grindr attack in 3.2 (locating people from the *order* results come back in) does not apply here.
- **Distance applies both ways**: `LEAST(my radius, their radius)` in `eligibleSql`.
- **Consent and removal exist**: a consent alert before the first share (`DiscoverySettings`), and `DELETE /profile/location`.
- **College mode collects no personal location at all.** It is decided by verified institution membership. This is the strongest privacy property the app has, and every section below keeps it.
- **Location is asked for in exactly one place**: the "Share location" button in Discovery settings. Nothing asks on open, and nothing refreshes it.
- **Story location stickers** round the phone's position to 0.1° (~11 km) on the server before asking Photon, and exclude homes. Fine as it stands.

## 3. Research

### 3.1 How other apps collect and show location

| App | When it asks / updates | What others see | Moving / travel |
| --- | --- | --- | --- |
| **Bumble** | Needs location to show anyone new. With location off you **can still chat with existing matches** but cannot be seen or find anyone new; choosing "Never" means it **asks again on every open**. Its own help suggests turning **Precise Location off** as a middle ground | City name, and distance "at the time you launched the app" | Travel Mode (Premium): anchored to a chosen **city centre** for 7 days, with a visible "Traveler" badge |
| **Tinder** | Updates each time you open the app and your GPS has changed; nothing while closed | Distance | Passport (paid) |
| **Hinge** | Set on a **map**: tap the compass to use the device location, or type a city, neighbourhood or address, or **drag the pin anywhere**. **Never updates automatically** | A **neighbourhood name**, never an address; can be widened to a whole city | Manual |
| **Swiggy / Blinkit** (not dating, but the saved-place pattern you named) | Saved addresses labelled **Home / Work / Other**, each confirmed on a map pin. At checkout Swiggy **detects where you are and matches it to a saved address** | — (delivery only) | — |

What to take from each:
- **Bumble:** the *behaviour* when location is off. Chat keeps working; only discovery of new people stops.
- **Tinder:** refreshing on open.
- **Swiggy:** saved places, and matching where you are to one of them.
- **Hinge:** the free pin is the one thing **not** to copy. A pin you can drop anywhere is a Passport, and it is exactly the tool the radius-oracle attack in 3.2 needs (section 7 explains the safe version).

### 3.2 Known attacks

- **Exact distances.** Tinder once sent exact coordinates to phones, then server-computed distances with 15 decimal places. Both could be trilaterated. (Heaton)
- **Rounded distances.** Bumble rounded to whole miles but rounded *down*, so moving until "3 miles" flipped to "4 miles" found an exact boundary. Three boundaries pinpoint someone. The fix: round **locations** before computing any distance. (Heaton)
- **Sort order.** Grindr users who hid their distance were still located from the nearest-first order of results. (Your Neighbors Are My Spies) *Not applicable here.*
- **2024 survey.** KU Leuven analysed the 15 most popular location-based dating apps; **6 of 15 leaked detailed location**. Reducing location to a town centre defeated trilateration. (Dhondt et al., USENIX Security 2024)
- **The radius filter as an oracle** (our own analysis, derived from the above). Spoof your location, set the smallest radius, watch whether someone appears, and repeat. L0 made this slow and logged; section 6.4 makes the answer coarse.

### 3.3 Precise and approximate location on the platforms

**Android (12 and later).** When an app asks for both fine and coarse location, one dialog asks two things:

| First choice | Second choice | What the app gets |
| --- | --- | --- |
| **Precise** | While using the app | GPS-level fixes while open |
| **Precise** | **Only this time** | The same, until the app is closed; next open the permission is gone and must be asked again |
| **Approximate** | While using the app | A location **obfuscated to about 3 km²**, updated at a throttled rate |
| **Approximate** | **Only this time** | The same, for this session only |
| — | Don't allow | Nothing |

- An app targeting Android 12 that wants fine location **must** request fine and coarse together.
- The user can switch between precise and approximate later in system settings, for any app.
- **Since Android 11, tapping Deny twice means "don't ask again".** The system dialog stops appearing for that install, and the only way back is the app's settings page.

**iOS.**
- Allow Once / While Using / Don't Allow, plus a **Precise** switch.
- With Precise off, location is quantised into sectors "roughly a few kilometres in size", **1–20 km** accurate, and only changes when you cross into another sector.
- `NSLocationDefaultAccuracyReduced` in Info.plist hides the Precise option entirely.

**What this means:**
- The app must work fully on approximate location, because either platform can hand it one whatever the app asked for.
- "Ask every time you open" cannot mean "show the system dialog every time". After two denials Android simply won't. It has to mean *our own* screen on every open, which fires the system dialog only when the person chooses to (section 6.1).

### 3.4 Maps of nearby people — happn, and the lessons around it

The map you described is **happn's** (Bumble has none). How it works:

- **Crossings, not live positions.** happn records a "crossing" when two users' phones come within about **250 m** of each other. The **Map** (launched 2018) lets you tap a place you have been and see the people you crossed there. The window was **7 days** at launch; happn's help centre now says **14 days**. People stay on your map for 30 days.
- **Deliberately fuzzy and late.** happn's CEO: "users' exact positions are never revealed to others, neither is the exact time", there is "a delay and a safety perimeter", and "users will only ever be able to see their own location on the app, not their Crush's".
- **Opt-outs.**
  - Untick **"Share my crossing locations"** to stay off other people's maps.
  - **Invisible mode**, scheduled in advance (e.g. work hours), stops location being used.
  - "Invisible zones", such as home or office, stop crossings being recorded there. Reported by secondary sources; I could not confirm it on happn's own pages.
- **It needs background location.** Crossings are detected as you walk around, not only when the app is open.
- **One real-time signal:** a **"NOW"** tag when you are currently within range of someone.
- **CrushPoints (2023).** happn's newer location feature is about **places, not people's positions**. You add favourite spots to your profile across six categories (bars and coffee, restaurants, culture, outdoors, clubs, sports; 20 million places via Foursquare), and you can find people who share them.
- **Radius.** Beyond crossings, happn can widen to people further away, up to 90–120 km.

Around it:

- **Tinder Places (2018)** matched people on places they frequented. It auto-blocked homes and workplaces, and was still widely called "creepy" for the stalking potential. It launched only in Sydney, Brisbane and Santiago and is no longer offered. I could not find the reason it was dropped.
- **Snap Map** is off by default, with Ghost Mode and friends-only sharing, and still drew police warnings about stalking, because a live map reveals routines.
- **Strava's 2018 heatmap** showed only aggregated, "anonymous" activity, yet it outlined secret military bases. Where users are *sparse*, a count shows exactly where the few of them go. **Aggregate counts are not automatically safe.** They leak wherever the population is small.

**What fits this app, and what does not:**

| happn idea | Fit here? | Why |
| --- | --- | --- |
| Crossings map (who you passed, where) | **No** | On one campus everyone crosses everyone all day, so it says nothing. Off campus it says "you crossed her near your PG at 11 pm", which is the hostel-finding the threat model is about. It also needs background and precise location, which section 5 rules out |
| "NOW" in range | **No** | Real-time presence, the one thing every safe design avoids |
| **Places people choose (CrushPoints)** | **Yes** | Self-declared and static. The app already has `hangoutSpots` on profiles and a "spot" filter in Explore |
| Opt out of the map; invisible modes | **Yes** | Cheap and clearly right |
| Delays and fuzziness | **Yes**, as hourly snapshots and bands | |

Section 9 builds the map from the rows marked "Yes".

### 3.5 The IEM–UEM campuses

From IEM's and UEM's own contact pages:

| Institution (in our database) | Campus / building | Address | Email domain |
| --- | --- | --- | --- |
| **IEM Kolkata** (`IEM-KOLKATA`) | **Gurukul** | Y-12, Block EP, Sector V, Salt Lake | `iem.edu.in` |
| | **Ashram** | GN-34/2, Sector V, Salt Lake | `iem.edu.in` |
| | **Management House** | Sector V, Salt Lake (the third IEM building there) | `iem.edu.in` |
| **UEM Kolkata** (`UEM-KOLKATA`) | **New Town** — its School of Engineering & Management is itself called *IEM New Town* | Plot III-B/5, University Area, Action Area III, New Town | `uem.edu.in` |
| **UEM Jaipur** (`UEM-JAIPUR`) | **Gurukul** (also called that) | Sikar Road (NH-11), Udaipuria Mod, near Chomu, Jaipur | `uem.edu.in` |

Two findings matter for how the app works:

1. **UEM Kolkata and UEM Jaipur share the `uem.edu.in` domain.** An email code proves someone is in the UEM group, not which campus, and the two are about 1,350 km apart.
   - At registration, `AuthService.register` picks *whichever* `uem.edu.in` institution the database returns first when no code is sent ([auth.service.ts:48](../../../../api/src/services/auth.service.ts#L48)).
   - In student verification, a Jaipur student can simply choose UEM Kolkata.

   College mode's boundary is only as good as this mapping.
2. **"Gurukul" names two different campuses**, IEM's in Salt Lake and UEM's in Jaipur. A campus must be identified by *institution + campus*, never by its name alone.

The database today has one campus per institution ("Kolkata", "New Town", "Jaipur"). The app offers only Gurukul and Ashram (`CampusSelectionScreen`, `EditCampusScreen`), not tied to any institution, with no Management House or New Town. It also spells "Managment" in `EditCollegeScreen`.

I have **not** guessed campus coordinates. Section 8.1 has them set from a map pin by an admin.

### 3.6 Rules that apply

- **Google Play:** a prominent in-app disclosure before *any* location access; use the minimum scope (coarse over fine, foreground over background). We never need background location.
- **India's DPDP Rules 2025:** notified November 2025; full compliance due **13 May 2027**. Withdrawing consent must be as easy as giving it. Personal data must be **erased once its purpose ends**. Erasure requests are answered within 90 days.

## 4. Gaps

| # | Gap | Status |
| --- | --- | --- |
| G1 | Location captured once, **never refreshed**; `locationUpdatedAt` never read | Plan (6.7) |
| G2 | No rate limit or plausibility check on location writes | **Fixed in L0** |
| G3 | Radius 1–100 km in 1 km steps and an "under 1 km" band: more precision than the data has | Plan (6.4, 6.5) |
| G4 | Precise location requested, then thrown away on the server | Plan (6.2) |
| G5 | College mode kept coordinates | **Fixed in L0** |
| G6 | Stale locations matched on indefinitely | Plan (6.8) |
| G7 | College and distance users can never match | Plan (8.5), **approved** |
| G8 | No way to hide your distance band | Plan (10.2) |
| G9 | Nothing asks for location on open; the only entry is a settings button | Plan (6.1) |
| G10 | `uem.edu.in` does not distinguish Kolkata from Jaipur | Plan (8.2) |
| G11 | Campus list incomplete, untied to institution, and "Gurukul" ambiguous | Plan (8.1) |
| G12 | Scale: b-tree on `(latitude, longitude)` | Plan (10.3) |

## 5. Principles

1. **Collect the least precise location that works, and coarsen it on the phone.** The server never needs, and should never receive, a precise fix.
2. **Never answer finer than the grid.** No band, radius, count or map cell smaller than the grid's worst-case error.
3. **Make probing expensive and visible.** Limit, speed-check and log changes to where you are and how far you look.
4. **Keep location only while it has a purpose.** In college mode it has none.
5. **Show how many, never who is where.** A person's own profile says which campus they study at. Nothing says where they are.
6. **Losing location loses discovery, not the app.** Chat, matches and Stories keep working, as on Bumble.

## 6. Distance mode: getting and keeping a location

### 6.1 Asking on every open (your Bumble / Tinder request)

Distance mode only. **College mode never asks**, because it needs no location.

On every app open in distance mode, the app checks the permission *without* prompting, then:

| State on open | What happens |
| --- | --- |
| Granted (precise or approximate) | Take one fix silently and refresh if you have moved cells (6.7). Nothing on screen |
| Was "Only this time" and has now lapsed | Show **our** "Location is off" screen (below). The system dialog appears only if you tap **Turn on** |
| Never asked | Our explainer screen first (Play's prominent disclosure), then the system dialog on **Continue** |
| Denied once | Our screen again; **Turn on** may fire the system dialog one more time |
| Denied twice ("don't ask again") | Our screen, with **Open settings** instead, since the system dialog can no longer appear |

**The "Location is off" screen** replaces the discovery deck, never the whole app:

- **Turn on location** (or **Open settings**).
- **Use a saved place** instead (section 7), if you have one.
- **Switch to college mode**, which needs no location.
- A line that chat and matches still work.

Asked on every open, the way you described, but it is our screen doing the asking. So Android's two-denial limit is never wasted on someone who just tapped past it.

### 6.2 Precise and approximate, both supported

The app requests fine and coarse together (Android requires both) and treats whatever it gets as normal:

| You chose | What the phone gives | What we do |
| --- | --- | --- |
| **Precise** | GPS-level fix | Snap it to the grid **on the phone** and send only the cell. The precise fix never leaves the device |
| **Approximate** (Android ~3 km², iOS 1–20 km) | An obfuscated area | Send it; the server snaps it. Store `locationAccuracy = 'approximate'` and the reported accuracy radius |
| Approximate, reported accuracy worse than 5 km | Very rough | Accept it, and tell you in settings: "Your location is approximate, so distances to you are rough." Nobody else is told |

What precise buys you: only that you land in the right ~2 km cell near a cell edge. **No feature needs precise location, and nothing requires it.** The explainer screen says so, and says approximate is enough.

Rounding on the phone changes the privacy story from "we collect precise location but promise to throw it away" to "precise location never reaches us". That is the stronger guarantee, and it costs one function call in the app.

### 6.3 Rate limits and plausibility — built (L0)

- A write landing in your current cell is a **no-op** and costs nothing.
- A move implying **more than 300 km/h** is refused and recorded.
- **12** accepted cell changes and **10** radius changes a day.
- A burst limit on the route.
- Recorded events never contain coordinates.

### 6.4 A coarser grid

- **0.02°**, about **2.2 km × 2.1 km** at Kolkata's latitude, matching Android's ~3 km² approximate precision.
- Snapping moves a point by at most ~1.5 km, so distance between two people can be off by up to **~3 km**. Every band and radius is sized to that.
- **Rejected:**
  - Heaton's 0.1° (~11 km) and town-centre snapping. Both are right for a global app, but would put most of Kolkata in one cell.
  - Keeping today's 0.01° (~1.1 km). Android's approximate location is only ~3 km² accurate, so a 1 km cell stores precision the input doesn't have. Near campus, a 1 km cell is roughly one hostel neighbourhood.
- **Decided: 0.02°.**
- **Migration:** one idempotent re-snap of every stored coordinate. Nothing gets more precise.

### 6.5 Radius and bands

Research: Bumble's slider runs **1–100+ miles**, and up to "Whole country". Bumble, Tinder and Hinge all offer some form of "**show people further away if I run out**", with Hinge's "dealbreaker" switch to make the limit strict.

**Decided:**
- **Radius:** six presets, **5, 10, 15, 25, 50, 100 km**, rather than a slider in 5 km steps. Fewer possible radii means fewer distinct answers for the radius oracle to read. Six still covers everything from "near campus" to "across Kolkata and beyond".
- **Floor of 5 km,** because the grid's worst-case error is ~3 km (6.4). A 1 km option, as Bumble has, would promise precision the data does not have.
- **Bands:** **under 5 km**, 5–10, 10–25, 25–50, 50–100.
- **"Show people further away when I run out":** off by default, which makes the limit strict, as Hinge's dealbreaker does. When on, people beyond the radius appear only after everyone inside it, **with their true band**, never a relabelled one.

### 6.6 Hide my distance

A free switch. It hides the *label* only. It cannot hide the fact that you fall inside someone's radius, which is why 6.3 and 6.4 come first.

### 6.7 Refreshing on open

- When the app comes to the foreground in distance mode with a location older than **6 hours**, it takes one fix, compares cells locally (the server returns your cell with every write), and writes only if the cell changed.
- **No background location, ever.**

### 6.8 Staleness and erasure

| Condition | Effect |
| --- | --- |
| Distance mode, location **older than 14 days** | Leaves other people's distance decks and Explore; the open-time screen asks for a refresh |
| Location **older than 30 days** | Coordinates erased |
| Switch to college mode | Coordinates erased *(built)* |
| Consent withdrawn | Coordinates, saved places and consent erased |

Only the current cell is stored. No history, no "last seen at".

**Why these numbers.** The other apps show the problem to avoid:
- **Tinder** shows the location from the last time someone opened the app, however long ago that was.
- **Hinge** never updates location on its own.
- So on both, someone who moved away months ago still appears where they used to live.
- **Tinder** closes accounts only after **2 years** of inactivity, and keeps even "imprecise location of download" for **5 years**.

India's DPDP Rules require erasure once the purpose ends. A location nobody has refreshed in weeks is not doing its job.

**Decided:**
- **14 days out of decks.** Two weeks covers a normal term-time gap between opens, and it is short enough that a card doesn't claim someone is near campus a fortnight into the holidays.
- **30 days erased.** After a month without a refresh the location is too old to use, and erasing it satisfies the purpose rule.

Opening the app in distance mode restores everything with one fix (6.7).

## 7. Saved places (your Hinge / Swiggy request)

You go home at the weekend, or you're at a PG during the week and a hostel otherwise. Saved places let you choose where you appear from, the way Swiggy lets you choose where to deliver.

**The rule that makes this safe: you can only save a place where your phone actually is.**

What the research says:
- **Swiggy** saves addresses by confirming them on a map pin, and matches where you are to a saved one at checkout.
- **Hinge** lets you type any place or drag a pin anywhere.
- The two apps that thought hardest about location safety both treat home as somewhere to **hide**, not broadcast: **Tinder Places** auto-blocked homes and workplaces, and happn offers invisible zones.
- Nobody in this group of apps lets people advertise where they sleep.

**Decided:** save only where you are, at most 3, with a per-place "hide me here". Details:
- Hinge lets you drag a pin anywhere, and that is a Passport. It is also the exact tool the radius oracle needs: set a pin next to someone's hostel and see whether they appear.
- Saving "the place I am standing in" gives the convenience without handing anyone a free teleport.

| | |
| --- | --- |
| How you save one | "Save this place" from Location settings, while there. Label it **Home, Hostel, PG** or your own word |
| How many | Up to **3** |
| What is stored | The **grid cell** and your label. Never an address, never a precise point |
| Using one | Pick it in Location settings, or from the "Location is off" screen. You then appear from that cell until you change it or your live location refreshes |
| Auto-match (Swiggy's trick) | When a live fix lands in the cell of a saved place, the app shows "At Hostel" rather than a bare area |
| Switching between them | Counts against the daily cell-change budget (6.3). Switching is instant but not free, so saved places cannot become an oracle either |
| Who sees the label | **Only you.** Others see a distance band, exactly as now |
| Staleness | A saved place you have not been to in **90 days** is removed, with a notice |
| **Hide me at this place** | Per place, off by default. While your live fix is in that cell you are not placed there; you keep your previous location, or go quiet in distance mode. This is happn's "invisible zone" idea, for anyone who would rather not be findable near home at all |
| Erasure | Removed with the rest when you withdraw location consent |

## 8. College mode and campuses (your Gurukul / Ashram / New Town question)

### 8.1 A real campus list

A new `institution_campuses` table: institution, name, and **public** coordinates set by an admin from a map pin (institutional data, not personal). Starting rows, from 3.5:

- IEM Kolkata: **Gurukul**, **Ashram**, **Management House**
- UEM Kolkata: **New Town**
- UEM Jaipur: **Gurukul (Jaipur)**

Your campus becomes a pick from *your own institution's* list. That ends the free-text field and the two-Gurukuls ambiguity. The onboarding and edit screens list the right campuses for the college you verified with.

### 8.2 Which UEM, Kolkata or Jaipur? (G10)

The email cannot say. Options:

1. **One approximate location check at verification.** Only for a shared domain, and only once: are you in West Bengal or Rajasthan? The two are ~1,350 km apart, so approximate location answers it with enormous margin. Nothing is stored beyond the resulting institution.
2. **Roll-number or ID format**, if the two universities' formats differ. I could not confirm that they do.
3. **Self-declared, with admin review** of anything that looks wrong.

**Decided: 1, with 3 as the fallback.**
- **Precedent:** Tinder U checks location at sign-up too; in the US, students "have to be geolocated on campus" before college mode turns on.
- **Why not option 2:** I could not find any published roll-number format for either university. UEM's own Jaipur contact page uses the same `uem.edu.in` domain, and the group also runs an "IEM Jaipur" site on a `uem.edu.in` subdomain, so the domain gives no signal at all. Worth asking the IEM–UEM IT office whether student IDs differ; if they do, option 2 becomes a free, silent check.

How it works:
- Registration stops picking "the first matching institution" for a shared domain and requires an explicit choice.
- If the approximate check contradicts the choice (chose Kolkata, phone in Rajasthan), the membership is held for admin review rather than refused, since students travel.
- Someone who declines the check can still verify. Their membership is marked **unconfirmed campus** and goes to review; until then they can use the app but appear only to their own institution.

### 8.3 How college mode works across campuses

College mode is decided by **which institution you are verified at**, never by where you are standing. So:

| You | They | Today | After this plan |
| --- | --- | --- | --- |
| IEM, Gurukul | IEM, Ashram | ✅ Same institution; they see each other | ✅ Unchanged. "My campus" in Explore narrows to Gurukul |
| IEM, Gurukul | IEM, Management House | ✅ Same institution | ✅ Unchanged |
| IEM, Gurukul (Salt Lake) | UEM, New Town (*IEM New Town*) | ❌ Different institutions; never | Depends on **scope** (8.4) |
| IEM Salt Lake or UEM New Town | UEM Jaipur | ❌ | ❌ Different city; stays apart unless both choose "Whole IEM–UEM group" |

**Out of college, still in college mode** (your question): an IEM student at home in Siliguri for the holidays **still sees and is seen by IEM students**. College mode is about your college, not your whereabouts, which is also why it never needs location. If you want to meet people *where you are* instead, that is what distance mode is for.

### 8.4 College scope: how wide "my college" reaches

Research: **Tinder U** prioritises "your university **and nearby colleges**", with a toggle to swipe by plain location instead. The **Marriage Pact** matches only within one school. Neither widens anyone's audience silently, and neither is fully open by default.

A new setting under college mode, applied **mutually**: both people's scopes must include each other, exactly as age and gender preferences already work.

| Scope | Who you can see (and be seen by) |
| --- | --- |
| **My campus** | Only your campus, e.g. Gurukul |
| **My college** *(default, today's behaviour)* | Your whole institution, e.g. Gurukul + Ashram + Management House |
| **IEM–UEM in my city** | Also the group's other institution in your city: Salt Lake ↔ New Town |
| **Whole IEM–UEM group** | Kolkata and Jaipur |

- "In my city" is judged from the **campus coordinates** in 8.1, not from anyone's personal location.
- It needs an `institution_groups` link between IEM Kolkata and UEM Kolkata (and Jaipur), because today the database cannot say they are related.
- **Decided default: My college**, today's behaviour, so nobody's audience widens without their choosing it.
- **Improvement on Tinder U:** "IEM–UEM in my city" is offered once with a clear prompt ("Also meet students from UEM New Town?"), not quietly switched on.
- People from the wider scope are ranked **after** your own college's, as Tinder U prioritises your own school. Explore gets a chip for them.

### 8.6 A UEM Jaipur student who wants to meet IEM Kolkata students

The two campuses are ~1,350 km apart and separate institutions, so today they can never meet. Three situations, each with its own answer:

| Situation | Answer |
| --- | --- |
| **Jaipur student, staying in Jaipur, open to long distance** | Both sides choose **Whole IEM–UEM group** scope (8.4). It is mutual, so only Kolkata students who also chose it see them. Their card reads **"UEM Jaipur · Jaipur"**, so nobody mistakes 1,350 km for nearby. That echoes Bumble's visible Traveler badge, which exists because hidden distance is a bad surprise. Cross-city people rank after same-city people, and are gathered under an Explore chip, **Other IEM–UEM campuses** |
| **Jaipur student visiting Kolkata** (holidays, an event) | **Distance mode**, from where they physically are. They then see Kolkata's distance-mode students, and IEM college-mode students through the campus anchors (8.5), subject to those students' scope. Their card carries **"Visiting · UEM Jaipur"** while their live location is far from their home campus, Bumble's badge again |
| **Jaipur student, in Jaipur, wanting to appear in Kolkata** | **Not supported.** That is Tinder's Passport or Hinge's free pin, which section 7 and EXPLORE_SPEC §12 rule out. It is also the radius-oracle tool: appear anywhere, probe anyone |

Why this and not a Passport:
- The honest need, "I'm open to someone from our group in another city", is fully met by the group scope, with **no fake location at all**.
- Being physically in Kolkata is met by distance mode.
- The only thing left out is pretending to be somewhere you are not, which is the one thing that endangers other people.

### 8.5 College meets distance: campus anchors (approved)

- A college-mode person is "located", for distance-mode people only, at **their campus's public coordinates**.
- A pair is mutually eligible when both people's rules hold:
  - the college-mode person's: same institution, or within their chosen scope;
  - the distance-mode person's: that campus is within their radius.
- The college-mode person still shares **no personal location**. The only thing used is a campus already shown on their profile.
- This replaces the hard `discoveryMode` equality in `mutuallyEligible` and `eligibleSql`.

## 9. The map (your happn-style request: "how many and who's near me")

A **Map** button on the Explore header. It has three layers. The rule running through all of them: **"who" is shown only through things people chose to put on their profile, never through where their phone is.**

| Layer | How many | Who | Needs your location? |
| --- | --- | --- | --- |
| **Campuses** | Yes | Yes: tapping a campus lists people from it | No |
| **Hangout spots** (happn's CrushPoints, the safe half) | Yes | Yes: tapping a spot lists people who **chose** it | No |
| **Areas around you** (distance mode) | Yes, as bands | **No** | Yes |

Plus **your own position**, visible only to you.

### 9.1 Campuses layer (both modes)

- A marker at each campus in your scope (8.4), at its public coordinates. It shows how many eligible-for-you people have it as their **home campus**: *"Gurukul · 50+ · Ashram · 25+ · Management House · a few"*, and with a wider scope, *"New Town · 100+"*.
- Tapping a campus opens Explore's campus list for it. That is safe because home campus is already on every profile. Nothing about where anyone *is* goes into it, so the layer works **with location off**.

### 9.2 Hangout spots layer (both modes) — the happn feature, made safe

- The app already lets people list hangout spots (`hangoutSpots`: canteen, library, a café) and filter Explore by them. This layer puts those places on the map.
  - **Campus spots:** Gurukul canteen, the library, the Ashram lawn.
  - **Nearby spots:** cafés and malls in Sector V, New Town, City Centre.

  Each shows how many eligible-for-you people **chose** that spot, and tapping it lists them.
- This is happn's CrushPoints idea, and the reason it is safe where crossings are not: **nobody appears at a spot because their phone was there**, only because they added it to their profile. It tells you someone likes the canteen, not that they are in it.
- Rules:
  - **Spots are public places only.** This is a change, because `hangoutSpots` is free text today (one real profile holds `"RDB\n"`). Spots would be picked from:
    - a campus list an admin maintains (canteens, library, lawns);
    - the Photon place search the story sticker already uses.

    Hostels, PGs and homes are excluded, as Tinder Places auto-blocked homes and the sticker search already does (`PRIVATE_VALUES`). Existing free-text spots stay on profiles but only map-able spots appear on the map.
  - **The same cohort floor as Explore** (`EXPLORE_MIN_COHORT = 10`). A spot fewer than 10 eligible people chose shows "a few" and no list. Explore's spot filter already works this way, so the map cannot become a way around it.
  - **"Show me on spot maps"**, on by default, can be switched off, as happn's "Share my crossing locations" can. Off means your spots still sit on your profile but you are not counted or listed on the map.

### 9.3 Areas-around-you layer (distance mode only) — how many, never who

- The 0.02° grid cells within your radius, grouped into larger tiles (about 3 × 3 cells, ~6 km), shaded by band: *10+, 25+, 50+, 100+*.
- Each tile counts eligible-for-you people whose cell falls in it. The counts are an **hourly snapshot**, never live, like happn's delay. A tile with fewer than 10 is left blank, not labelled.
- **Tapping a tile does not list anyone.** It opens your normal nearby list, unfiltered by the tile, which never says where anyone is. A list of who is in a tile would say "Priya is in this 6 km square right now", the attacker's goal from section 1 in one tap. That is the crossings map's flaw, and why happn itself hides exact positions and times.
- **The Strava lesson, applied:** where the population is sparse, even counts point at people. A lone PG cluster on the edge of town would light up as the only 10+ tile for miles. Three rules keep that from happening:
  - **Tiles, not cells:** 6 km tiles make it hard for a tile to single out one building.
  - **The k ≥ 10 floor**, below which a tile is blank.
  - **Suppress lone tiles:** a tile shows only if a neighbouring tile also clears the floor, so an isolated cluster never stands out alone.
- Counts can change when one person moves. Bands, the floor and hourly snapshots make one person's move invisible. The test in 11 checks that a single move never changes a displayed value on its own.

### 9.4 Your own controls

- **Hide me from maps:** leaves you out of every count and list on the map. You stay visible in the deck and Explore as normal.
- **Invisible hours** (happn's scheduled invisibility): distance mode stops using your live location during the hours you set. You appear from your last saved place, or not at all in distance mode.
- **Hide me at this place**, on each saved place (7): while your live fix is inside that cell, you are not placed there. This is happn's invisible zone for home or hostel.

## 10. Build order

| Phase | What | Notes |
| --- | --- | --- |
| **L0** ✅ | Rate limits, speed check, no-op writes; erase on college mode | Built |
| **L1** | Open-time location screen and permission states (6.1); fine + coarse requested together with rounding on the phone (6.2); refresh on open (6.7) | **Native change: needs one dev-client rebuild** |
| **L2** | 0.02° grid, re-snap migration, 5 km radius steps, new bands (6.4, 6.5); staleness and erasure (6.8) | One migration |
| **L3** | Campus table and correct campus pickers (8.1); fix the shared `uem.edu.in` mapping (8.2) | Fixes a verification defect, so it could go earlier |
| **L4** | College scope (8.4) and campus anchors (8.5) | Changes who can meet whom, and is **approved** in principle |
| **L5** | Saved places (7) | |
| **L6** | Map: campuses layer (9.1) and hangout-spots layer (9.2) first, since neither needs location (spots need the place-picker change); then the areas-around-you layer (9.3); controls (9.4) | |
| **L7** | Hide my distance (6.6) | |
| **L8** | PostGIS (`geography` + GiST) when `Rows Removed by Filter` passes ~15× the rows returned | On demand |

## 11. Verification

**Server, non-destructive** (`npm run test:location`, own users only; this project's database is the real one):

- *(built)* Same-cell writes are free; implausible jumps are refused and recorded; daily budgets hold; events carry no coordinates; college mode erases coordinates.
- Oracle simulation: an attacker sweeping spoofed positions at the smallest radius can narrow a victim to no finer than one cell before the budget stops them.
- A saved place can only be created from a live fix inside that cell; switching between saved places spends the budget.
- Scope is mutual: Gurukul-with-*My college* and New-Town-with-*IEM–UEM in my city* do **not** see each other until both widen.
- Campus anchors: a college-mode user appears to a distance-mode user only when the campus is within radius **and** within the college user's scope.
- The shared domain: a `uem.edu.in` sign-up with no explicit choice is refused rather than assigned the first match.
- Map:
  - no response ties a person's id to a tile or to their live location;
  - spot and campus lists respect the floor of 10 and the "hide me from maps" switch;
  - no tile count below 10 is returned, and a lone tile is suppressed;
  - a single person moving cells never changes a displayed band on its own.
- Staleness: a 15-day-old location leaves distance retrieval; a 31-day-old one is erased.

**On device (dev client, two accounts):**
- Deny location twice, then confirm the screen switches to **Open settings** and chat still works.
- Choose Approximate and confirm distance mode works.
- Choose Only this time, reopen, and confirm our screen appears before any system dialog.

## 12. Decisions

You asked for the best option on each open question. All are now decided on the research above; any can be overridden.

| # | Decision | Status | Deciding evidence |
| --- | --- | --- | --- |
| 1 | Campus anchors so college and distance students can meet (8.5) | **Approved by you** | — |
| 2 | Ask on every open in distance mode through our own screen; both precise and approximate supported, precise rounded on the phone (6.1, 6.2) | **Your brief** | Bumble asks on every open while location is off; Android stops showing its own dialog after two denials |
| 3 | Grid **0.02° (~2.2 km)**; radius presets **5 / 10 / 15 / 25 / 50 / 100 km**; strict by default, with "show further away when I run out" optional (6.4, 6.5) | **Decided** | Android approximate ≈ 3 km²; Bumble 1–100+ mi; all three apps offer "show more if I run out" |
| 4 | Saved places **only where you actually are**, max 3, budgeted switching, per-place "hide me here" (7) | **Decided** | Tinder Places blocked homes; happn invisible zones; Hinge's free pin is a Passport |
| 5 | College scope, default **My college**; "in my city" offered with a prompt; wider scopes ranked after your own college (8.4) | **Decided** | Tinder U: own school first, nearby colleges with a toggle; Marriage Pact: own school only |
| 6 | UEM Jaipur ↔ IEM Kolkata: mutual **Whole-group** scope with a visible city label; distance mode when physically visiting; no Passport (8.6) | **Decided** | Bumble's Traveler badge; Tinder Passport and Hinge pin rejected for safety |
| 7 | Shared `uem.edu.in`: one approximate location check at verification, admin review as fallback (8.2) | **Decided** | Tinder U geolocates students on campus at sign-up; no public roll-number format found. **Action for you:** ask the IEM–UEM IT office whether student IDs differ by campus |
| 8 | Map: campuses and hangout spots show **who** (profile facts, k ≥ 10); areas around you show **how many** only, as 6 km tiles, hourly, lone tiles suppressed; opt-outs and invisible hours (9) | **Decided** | happn hides exact positions and times; Tinder Places called creepy; Strava's heatmap leaked through sparse counts |
| 9 | Staleness: **14 days** out of decks, **30 days** erased (6.8) | **Decided** | Tinder and Hinge serve stale locations indefinitely; DPDP requires erasure once the purpose ends |

## 13. What was built

### 13.1 Where to find it

| Area | Server | App |
| --- | --- | --- |
| Grid, radius, bands (6.4, 6.5) | `@iem-dating/shared/location` (one grid for phone and server), `geo.ts`, migration `20260924000000_location` (re-snap, presets) | Preset slider in onboarding and Edit distance; preset chips and "show further away" in Discovery preferences |
| Asking on open, precise and approximate (6.1, 6.2, 6.7) | `PUT /profile/location` carries the accuracy class | `locationClient.ts` (rounds a precise fix on the phone), `useLocationGate.ts`, `LocationGate.tsx` in the deck |
| Limits and erasure (6.3, 6.8) | `LocationService`, `LocationRetentionWorker` (hourly) | — |
| Saved places (7) | `saved_places`, `/profile/location/places`, `/profile/location/source` | Location settings screen |
| Campuses and scope (8.1, 8.4, 8.5, 8.6) | `institution_campuses`, `institutions.group_code/city`, `users.campus_id/college_scope`, `eligibleSql` + `mutuallyEligible`, `RetrievalService.nearFirst` | Campus pickers from `/profile/campuses`; scope picker; "Other IEM–UEM campuses" chip; card labels |
| Shared email domain (8.2) | Registration no longer guesses; verification checks the campus; `/admin/memberships/unconfirmed` and `/confirm` | One-time campus check on the verification screen |
| Map (9) | `MapService`, `/discover/map`, `/discover/map/places/*` | `MapScreen.tsx` on a tile map needing no new build (`TileMap.tsx`); map button in Explore |
| Privacy switches (6.6, 9.4) | `/profile/location/settings` | Location settings screen |
| Admin | `/admin/campuses`, `PUT /admin/campuses/:id/anchor` | — |

**Tests:** `npm run test:location`, 18 tests, non-destructive. Among them is a cross-check of retrieval against the swipe gate for every ordered pair of 15 users covering every campus, scope and mode, so the two can never drift apart again.

### 13.2 Where the build differs from the plan, and why

- **"In my city" is decided by the institution's city, not by campus coordinates (8.4).** The city is a recorded fact about the institution. Coordinates would have made Jaipur's scope depend on a pin that does not exist yet.
- **Map spots are a separate, opt-in list, not the existing hangout-spot text (9.2).** The free-text field predates the map. Reusing it would have put people on the map who never chose to be there, so appearing on the map is now a choice of its own: pin up to three public places.
- **Invisible hours hide you from distance discovery entirely (9.4).** The plan offered "appear from your last saved place" as an alternative. Hiding is simpler to reason about and is what happn's invisible mode does. Invisible hours affect visibility, not eligibility, so an existing pair is never undone.
- **College-mode viewers see no distance band at all (6.6).** Measuring from a fixed campus would give several college-mode viewers fixed anchors to trilaterate from. Only a distance-mode viewer, whose own position is budgeted, sees a band.
- **A fix shared in college mode is kept only as a short-lived baseline.** It is never displayed or used for discovery. Switching to distance mode within 10 minutes promotes it; otherwise the sweep clears it within the hour. Without this, sharing a location from college mode would have stored exactly what switching to college mode is meant to erase.
- **Campus coordinates.**
  - IEM's three Sector V buildings share one OpenStreetMap point (way 134101300). All three sit well inside one grid cell.
  - New Town uses way 514278915.
  - UEM Jaipur is not in OpenStreetMap, so it has **no pin**. Its students keep every college-mode feature, but have no campus anchor or map marker, and their memberships go to review until an admin sets the pin with `PUT /admin/campuses/:id/anchor`.
- **The development map uses OpenStreetMap tiles and credits the data on screen.** `EXPO_PUBLIC_MAP_TILE_URL` swaps the source; a paid or self-hosted service is required before launch.

### 13.3 Defects found while building, all fixed and covered by a test

- **A missing campus pin counted as distance 0 in SQL.** Postgres's `GREATEST(0.0, NULL)` ignores the NULL, so a campus with no coordinates was "always in range" in retrieval, while the swipe gate said no. The cross-check test caught it; anchors are now tested for explicitly.
- **`PUT /profile` could change the radius around both the presets and the daily budget.** The onboarding and Edit distance screens use it. It now applies both.
- **Edit distance labelled kilometres as "mi".**
- **The retrieval bounding box would have dropped every college-mode candidate from a distance viewer's results**, because they have no personal coordinates. The box now applies to distance-mode candidates only.
- **`eligibleSql` trusted its callers to check that the viewer was set up.** It now refuses on its own, so a stale viewer can never retrieve anyone.
- **Explore's privacy floor counted only unswiped people**, so swiping through a filter flipped its message to "not enough people". It now counts everyone who matches, as EXPLORE_SPEC 15 requires, and an answered-out list says "seen everyone".
- **The tester seeder wrote raw, unsnapped coordinates to the database.** It now snaps them.
- **The campus pickers offered other institutions' campuses**, so a UEM student could choose Gurukul. They now list the student's own institution's campuses only.

---

### 13.4 Code review fixes

An outside review found eight problems. Each was checked against the code; all were real, and all but the last are fixed and tested.

| # | Finding | Fix |
| --- | --- | --- |
| 1 | A fix inside a "hide me here" place left the person discoverable from their previous cell | An explicit hidden state (`location_hidden_at`) keeps them out of distance discovery until a fresh fix is accepted. Hiding the place you are standing in hides you at once. Unhiding or deleting it cannot expose the previous cell |
| 2 | "Follow my phone" changed the source but kept showing the saved place | The phone's fix travels with the switch, so source and position change together. Without a fix, nothing is shown until one arrives, never the old place. Deleting the place in use works the same way |
| 3 | Campus lists opened from the map ignored "hide me from maps" | They honour it, as place lists do. The ordinary "My campus" category is unaffected |
| 4 | Cached results outlived privacy changes | Every Explore page is now re-checked against live eligibility before it is returned, so blocks, hides and swipes apply at once. Before this, anything cached could be served for up to 15 minutes. Hiding from maps or unpinning a spot invalidates every map snapshot. Additions still wait for the hourly snapshot, so the map cannot be diffed minute by minute |
| 5 | The app's refresh memory was not per account | Keyed by account, and cleared on logout and on location deletion |
| 6 | The three-place limits could be raced | Counted and written under a per-person database lock |
| 7 | The map snapped back after a drag, zoom jumped to whole levels, and long drags hit blank edges | Offsets clear only after the new centre renders; zoom is fractional and stays under the fingers; the previous tile level remains aligned below the new level while Android decodes it; two extra rings of tiles reduce blank edges; double-tap zoom keeps the tapped point fixed |
| 8 | The tile service is not fit for launch | **Your decision** (13.5) |

The map also gained the review's recommended design:
- **Tapping a campus or place** keeps the map mounted and opens a panel with the name, category and "People who like this place" or "People from this campus".
- **Previews** appear when at least 10 people qualify, and open the usual profile with Like and Pass.
- **Overlapping spots** group into a bubble that zooms in.
- **Wording:** "likes this place" throughout, never "is here".
- **Visual design:** a pastel street map, purple count groups, coral place markers and a lavender profile panel follow happn's current map hierarchy while retaining this app's controls.

Tests: `npm run test:location`, now 24.

### 13.5 Decisions still open

1. **Map tiles.** The development server is suitable for testing, but a dating app must not depend on a community tile server at launch. Options:
   - a CARTO key under a paid plan;
   - another OpenStreetMap tile provider with a commercial plan (MapTiler, Stadia);
   - self-hosted tiles.

   Any of these is one environment variable: `EXPO_PUBLIC_MAP_TILE_URL` and `EXPO_PUBLIC_MAP_ATTRIBUTION`. **Google Maps is not one of them.** Google does not allow its tiles outside its own SDK, so using Google means replacing `TileMap` with `react-native-maps` (a native module and a dev-client rebuild), plus an API key and billing.
2. **A native map renderer** (MapLibre, or `react-native-maps`) would still improve sustained gesture performance, label rendering and very long drags. The current renderer keeps pinch zoom under the fingers and retains the old tile level until the new level draws, but it remains an image-tile renderer. Either native option needs a rebuild.
3. **Crossed paths.** happn's "people you crossed" needs a separate system: its own consent, background location samples, time-and-distance matching, accuracy thresholds, private-zone exclusion, expiry and immediate block enforcement. The current design (a ~2 km grid, refreshed every six hours) cannot say two people crossed paths and must never claim they did. It should be built only after the foundations above, as its own opt-in feature.

## Sources

- [Bumble — Enable location services on Android](https://bumble.com/help/how-do-i-enable-location-services-for-bumble-on-my-android) · [on iPhone](https://bumble.com/en-us/help/how-can-i-enable-location-services-for-bumble-on-my-iphone) · [Travel Mode](https://bumble.com/help/what-is-travel-mode) · [2026 feature announcement](https://ir.bumble.com/news/news-details/2026/Bumble-Announces-Two-New-Features-For-Confidence-and-Clarity-in-Dating-2026-36eaJ_omGR/default.aspx)
- [Hinge — Location Settings](https://help.hinge.co/hc/en-us/articles/49661615922195-Location-Settings)
- [When does Tinder update your location? (secondary)](https://www.imobie.com/location-change/tinder-location-update-guide.htm)
- [Swiggy's nearest-address detection](https://medium.com/productlocus/swiggys-nearest-address-detection-eliminates-manual-mistake-271ff02b6f6) · [Saving multiple addresses on Swiggy](https://www.newsbytesapp.com/news/science/how-to-save-multiple-addresses-on-swiggy-for-android/story)
- [happn — What is the happn Map?](https://support.happn.fr/hc/en-us/articles/15703631805853-What-is-the-happn-Map) · [happn responds to geo-location questions](https://www.globaldatinginsights.com/news/happn-responds-to-geo-location-questions/)
- [Snapchat — Snap Map privacy](https://values.snap.com/privacy/privacy-by-product/snap-map) · [Snap Map privacy and safety reminder](https://help.snapchat.com/hc/en-us/articles/24547077410580-Snap-Map-Privacy-Safety-Reminder)
- [Robert Heaton — Bumble vulnerability](https://robertheaton.com/bumble-vulnerability/)
- [Dhondt et al., "Swipe Left for Identity Theft", USENIX Security 2024](https://www.usenix.org/conference/usenixsecurity24/presentation/dhondt) · [KU Leuven summary](https://distrinet.cs.kuleuven.be/news/swipe-left-for-identity-theft-privacy-risks-in-location-based-dating-apps)
- [Your Neighbors Are My Spies (arXiv)](https://arxiv.org/pdf/1604.07850)
- [Android — Request location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions) · [Approximate location codelab](https://developer.android.com/codelabs/approximate-location) · [Permission updates in Android 11](https://developer.android.com/about/versions/11/privacy/permissions) · [Request runtime permissions](https://developer.android.com/training/permissions/requesting)
- [Radar — Approximate location in iOS 14](https://radar.com/blog/understanding-approximate-location-in-ios-14) · [WWDC20 — What's new in location](https://developer.apple.com/videos/play/wwdc2020/10660)
- [Google Play — Prominent disclosure and consent](https://support.google.com/googleplay/android-developer/answer/11150561?hl=en)
- [DPDP Rules 2025 — timeline](https://www.consently.in/blog/dpdp-rules-2025-implementation-timeline-india) · [Lexology — DPDP Rules 2025](https://www.lexology.com/library/detail.aspx?g=7e3af947-10aa-4712-bc1e-54179a613409)
- [IEM — Contact us (Gurukul, Ashram, New Town addresses)](https://iem.edu.in/contact-us/) · [UEM Kolkata — Contact](https://uem.edu.in/uem-kolkata/contact-us/) · [UEM Jaipur (Wikipedia)](https://en.wikipedia.org/wiki/University_of_Engineering_&_Management,_Jaipur) · [UEM Kolkata (Wikipedia)](https://en.wikipedia.org/wiki/University_of_Engineering_&_Management,_Kolkata)
- [happn — Map launch, 7 days (TechCrunch, 2018)](https://techcrunch.com/2018/06/21/happn-takes-on-tinder-places-with-an-interactive-map-of-missed-connections) · [happn Map, 14 days (help centre)](https://support.happn.fr/hc/en-us/articles/15703631805853-What-is-the-happn-Map) · [Not appearing on others' happn Maps](https://support.happn.fr/hc/en-us/articles/15703705375517-I-do-not-want-to-appear-on-other-users-happn-Maps-What-Can-I-do) · [happn CEO on delay and safety perimeter](https://www.globaldatinginsights.com/news/happn-responds-to-geo-location-questions/) · [CrushPoints (happn press)](https://www.happn.com/press/happn-is-incorporating-over-20-million-locations-into-its-crushpoints-feature) · [VIDA Select happn review (map, 250 m, invisibility)](https://www.vidaselect.com/happn-app-review)
- [Tinder's upcoming location feature seems a bit creepy (TechCrunch, 2018)](https://techcrunch.com/2018/05/14/tinders-upcoming-location-based-feature-seems-a-bit-creepy/) · [Tinder Places explained](https://www.vidaselect.com/tinder-places)
- [Tinder U / College Mode (help)](https://www.help.tinder.com/hc/en-us/articles/360015516052-Tinder-U-College-Mode) · [Tinder U launches in India (Business Today)](https://www.businesstoday.in/technology/news/story/tinder-u-arrives-in-india-bringing-a-campus-first-dating-experience-for-students-468423-2025-03-19) · [Introducing Tinder U — geolocated on campus at sign-up (TechCrunch)](https://techcrunch.com/2018/08/21/tinders-latest-feature-tinder-u-is-only-for-college-students/)
- [Marriage Pact — schools](https://marriagepact.com/schools)
- [Bumble — distance filter](https://bumble.com/help/how-does-the-distance-filter-work) · [Hinge dealbreakers (distance)](https://hingeapp.zendesk.com/hc/en-us/articles/360011321613-Why-do-I-only-see-profiles-that-are-far-away) · [Bumble Travel Mode badge (VIDA Select)](https://www.vidaselect.com/bumble-travel-mode)
- [Tinder privacy policy (retention)](https://policies.tinder.com/privacy)
- [Strava heatmap revealed military bases (ABC News)](https://www.abc.net.au/news/science/2018-02-04/strava-heatmap-online-anonymity-is-almost-impossible/9380326) · [Strava restricts data after exposing bases (Engadget)](https://www.engadget.com/2018-03-13-after-exposing-secret-military-bases-strava-restricts-data-visi.html)
- [UEM Jaipur — Contact (uem.edu.in addresses)](https://uem.edu.in/uem-jaipur/contact-us/) · [IEM Jaipur site on a uem.edu.in subdomain](https://iem-jaipur.uem.edu.in/contact-us/)
