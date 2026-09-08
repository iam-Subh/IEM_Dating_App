# Recommendation rebuild: review and implementation plan

Date: 2026-09-05.

Scope: review of the supplied plan against the current local source. This document proposes implementation work. No application code was changed. Production data, deployed schema, query plans, traffic, and latency were not measured. Existing local edits were left intact.

**1. Assessment**

Keep the separation between eligibility, retrieval, ranking, and presentation. Keep explicit discovery preferences, database exclusions, stable decks, real compatibility factors, and controlled rollout. These address defects in the current implementation.

Do not implement the supplied plan without revisions. Its deck design can still skip profiles. Its reciprocity formula measures popularity in the wrong direction. Its fallback can remove user constraints. Its evaluation gates claim more than shadow data can establish.

Treat 100,000 users, 400 candidates, latency limits, and rollout percentages as planning assumptions. None is a measured capacity result.

**2. Confirmed defects and corrections to the supplied review**

| Finding | Evidence and correction |
|---|---|
| Missing targeting | `recommendation.service.ts` applies activity and exclusion filters. It does not apply gender, age, or distance preferences. |
| Candidate limit | Retrieval takes at most 150 candidates per generation. This is not a permanent global pool of 150 users. Viewer-specific swipe and block exclusions change the pool. Activity changes also change it. At 20 cards per page, page 8 can contain 10 cards; page 9 must be empty. |
| Large exclusion lists | All previous swipe IDs are loaded into Node. Replace this with indexed database exclusions. A list of 10,000 UUIDs does not itself exceed 65,535 parameters. Do not assert a specific driver failure threshold without reproducing it. |
| Display fallbacks | Four inspected discovery components use `matchPercentage || 98`. This substitutes 98 for zero or missing data. It does not prove users almost always see 98. |
| New-user scoring | Null activity applies a 0.1 multiplier. The cold-start bonus is added after that multiplication. The bonus is not itself reduced by 90%. |
| Bot suppression | The lifetime-rate test can hide normal users. It is recalculated, so rate-based suppression is not necessarily permanent. |
| Preference model | `MatchPreference` has both `userId` and required `matchId`. The required match link makes it unsuitable for pre-match discovery. Deprecate before deleting it. |
| Tests | The flow test contains placeholders. A health test has real assertions. The API package has no test script. There is no demonstrated recommendation test coverage. |
| Migration state | Three migration directories exist. Their presence does not establish the actual deployed schema or prove which commands changed it. Inspect the target database before repair. |

**3. Additional blockers found in the code**

**Public response fields.** The recommendation query uses Prisma `include`, which retains user scalar fields. The discovery controller then spreads `...user` into the response. The TypeScript assertion does not remove runtime fields. This path can return password hashes, email, phone, birthday, stored coordinates, and internal scores. Replace it with explicit database selections and a public response allowlist. Apply gender and orientation visibility settings. Purge the old recommendation cache namespace after the fix. If deployed, review whether these responses reached users.

**Impression reliability.** `flush()` uses separate `HGETALL` and `HDEL` calls. Two workers can read the same counts. An increment between the read and deletion can disappear. A database failure after deletion loses the batch. Fixing `bestPosition` alone does not make these data reliable.

**Impression meaning.** The server records every returned card as displayed. Prefetched cards might never appear on screen. Position restarts at zero on every response. Daily aggregation cannot reconstruct request order. `markActed()` can run before the buffered row exists and updates multiple days. It also does not distinguish a like from a pass.

**Two swipe paths.** `DiscoverController.swipe()` queues score updates. `MatchService.performSwipe()` enforces a 100-swipe daily cap and marks impressions as acted. Put both routes through one service. Otherwise unlimited swipes and measurement remain inconsistent.

**Retry and match correctness.** A repeated swipe request can increment counters again. The score queue is in memory. `EloService.processSwipe()` catches errors, which prevents the outer worker from detecting those failures. Counter updates are not one transaction. The current match uniqueness constraint does not prevent reversed pairs. Concurrent mutual likes also need explicit handling.

**Zero weights.** Expressions such as `weight_department || 0.12` replace an intentional zero with the default. Use validated weights and nullish fallback. Load one immutable weight snapshot per generation.

**Feature values.** Relationship-intent labels in mobile differ from the scorer's compatibility keys. Department substring matching can produce false matches. Define stable identifiers and symmetric compatibility tables. Do not assume that all 14 current factors are sound.

**4. Product rules to establish before implementation**

The first release should follow these rules:

1. Discovery includes adults with completed discovery setup and permitted account status.
2. Users explicitly select whom they want to see. Orientation describes identity and must not silently set targeting.
3. Display gender and discovery category remain separate. Let users confirm their discovery category. Do not force every identity into a static three-category map. A three-category interface requires clear descriptions and user confirmation.
4. Apply confirmed gender and age preferences in both directions. Do not infer reciprocal consent from identity labels.
5. Treat distance as a mutual hard limit only if the interface states that rule. For the initial design, use mutual limits and explain them during setup.
6. Users choose a separate college/city mode if they do not provide location. Both users must permit the applicable mode. Missing location does not automatically disable a candidate's distance limit.
7. Do not relax blocks, account restrictions, adult eligibility, or confirmed hard preferences during fallback.
8. Unlimited swipes means no product quota. It does not mean unlimited eligible profiles or unlimited request throughput. Retain abuse controls.
9. Exclude completed swipes for the initial release. Any future repeat-profile feature needs an explicit policy. Do not repeat profiles silently when supply ends.

**5. Stage A: repair the response, configuration, and migration foundation**

Implement the public response allowlist first. Validate recommendation limits and cursors. Remove fabricated compatibility factors and the 98 fallback immediately. Show an unavailable state when the API has no valid compatibility value.

Create typed configuration for ranker version, rollout fraction, shadow sampling, queue bounds, and candidate budget. Keep flags separate from scoring weights. Validate allowed keys, finite values, ranges, and the full merged weight set. Commit updates atomically. Record actor, reason, previous value, new value, and version.

Propagate configuration changes through Redis and poll as a backstop. Set an initial maximum propagation delay of 60 seconds. Test missed messages and disconnected instances. A fallback uses the last validated configuration or a simple ranker with the same eligibility checks. There is no flag that disables those checks.

Inspect migration history and the actual target schema. Prepare and test the repair on a restored copy. Rebuild an empty database through the supported migration process. Do not mark a schema-difference migration applied if its changes are absent. Schedule concurrent index creation outside a transaction and check for invalid indexes after failure. Defer table deletion until the rollback window ends.

Replace Redis `KEYS` invalidation with versioned deterministic keys. Remove obsolete keys through expiry or a bounded cleanup. Make scoring synchronous after loading its configuration.

Exit conditions: public responses contain only allowed fields; zero weights remain zero; configuration rollback works; fresh and upgraded databases reach the same intended schema.

**6. Stage B: add explicit preferences and shared eligibility**

Add per-user discovery settings with validated identifiers:

| Field | Purpose |
|---|---|
| `discoveryCategory` | User-confirmed category used for targeting. |
| `showMeCategories` | Explicit accepted discovery categories. |
| `minAge`, `maxAge` | Confirmed inclusive age limits. |
| `locationMode`, `maxDistanceKm` | Distance or college/city discovery policy. |
| `preferencesConfirmedAt` | Distinguishes completed setup from missing data. |
| `eligibilityVersion` | Invalidates the viewer's previous deck after a relevant change. |

Use the birthday as the age source where reliable. Validate server-side and define the date boundary. Reconcile existing birthday/age conflicts. Do not trust a client-supplied age independently of birthday. Require missing adult eligibility information before discovery. Proposed age defaults are suggestions that users confirm, not inferred consent.

Backfill known display data without inventing targeting preferences. Keep unconfirmed accounts in a visible setup state. Explain why discovery needs completion. Track completion and eligible supply before rollout.

Use kilometres in the interface and API. Existing saved values came from a screen labelled miles. Ask users to confirm the corrected distance. Do not assume those values express kilometre preferences because retrieval previously ignored them.

Build one eligibility specification for self-exclusion, account state, mutual preferences, both block directions, prior swipes, existing matches, and location policy. Define treatment of suspended accounts and resolved safety actions. An unreviewed report alone should not automatically hide a user.

Apply the specification during retrieval and immediately before returning each page. Check current block and account state again before accepting a swipe. Candidate changes must affect existing decks without deleting that candidate from every viewer's cache. Already downloaded cards require refresh or a client removal event; the server cannot retract bytes already delivered.

Exit conditions: all preference combinations behave as specified; blocks and deactivation affect later responses; missing values never silently broaden hard preferences.

**7. Stage C: unify swipes and establish usable events**

Route both swipe endpoints through one service. Remove the daily product quota from the shared path. Keep validated requests and rate controls.

Give each action an idempotency key. A retry must not create a second counter update, match event, or notification. Define action changes explicitly; for an initial simple policy, accept the first decision and reject conflicting retries.

Store swipe state and a durable event in one database transaction. Use an outbox: a database table of events that a worker delivers after commit. Make each consumer idempotent. Canonicalize match pairs and enforce uniqueness. Serialize pair decisions or use a retry strategy that ensures concurrent mutual likes create one match. Emit notifications only for a newly created match.

Record separate events for page delivery, card visibility, swipe, match creation, and conversation outcome. A suggested visibility rule is at least 50% visible for one second. Confirm that rule through mobile tests. Deduplicate by server-issued impression ID. Bind visibility claims to a card that the server delivered to that viewer.

Include request ID, deck ID, candidate ID, absolute sequence, algorithm version, experiment assignment, and timestamps. Keep action outcomes separate from visibility. Handle swipes that arrive before visibility events.

For buffered ingestion, use atomic claiming with acknowledgement and retry. Deduplicate persisted events before incrementing aggregates. Bound queue size and monitor lag. Keep daily aggregates for reporting, but use sampled event-level records for rank evaluation. Retain event data for a defined period and remove user-linked records on deletion.

Exit conditions: retries have one effect; simultaneous likes create one match; worker restarts do not lose committed actions; visibility and delivery counts remain distinct.

**8. Stage D: implement stable deck cursors**

The proposed `LREM` plus positional `LRANGE` is insufficient. If page 1 contains positions 0–19 and those entries are removed, the old position 20 moves. A cursor containing an offset can skip unseen profiles.

Use stable sequence numbers within each deck generation. Store ordered IDs and generation metadata. Do not remove entries in a way that renumbers remaining entries. Filter invalid or acted-on entries while reading. Advance the cursor to the last sequence examined, including skipped entries.

The opaque cursor contains a deck ID, last examined sequence, eligibility version, and expiry. Sign it and bind it to the authenticated viewer. Save deck seed, ranker version, configuration version, and creation time on the server.

Append refills atomically with increasing sequence numbers. Use a membership set for that bounded deck to prevent duplicate appends. Acquire locks with ownership tokens and release them only when ownership matches. Reject writes from stale generators after a preference change.

Start with up to 400 candidate IDs, pages of 20, a refill trigger near 40 unconsumed entries, and a 45-minute expiry. Measure these settings. `LLEN` alone does not measure unconsumed entries when the deck retains earlier positions. Bound total generation size and rotate to a new generation at the limit.

Specify retry and multiple-device behavior. Repeating a cursor returns the same sequence interval, minus profiles that are no longer eligible. The client deduplicates by card ID. An expired cursor returns an explicit restart state. A page-number compatibility layer must bind pages to a deck generation; a page number alone is insufficient.

A short session history can reduce repeats across generations. Its expiry and cap define the guarantee. A capped set of 500 IDs cannot guarantee lifetime non-repetition. Durable swipe records provide that exclusion.

Deploy stable deck delivery with the existing ranker after response and eligibility repairs. This isolates pagination changes from ranking changes.

Exit conditions: swipes, retries, blocks, parallel refills, expiry, and multiple devices do not skip unseen eligible sequence entries.

**9. Stage E: retrieve candidates within a measured budget**

Use parameterized SQL where it improves control of geometry and query plans. Keep indexed `NOT EXISTS` exclusions. Load viewer settings once. Hydrate only the final page where possible; obtain scoring features through a bounded projection. Restore explicit rank order after hydration because `findMany` does not preserve input-ID order.

Start with three candidate sources: affinity, recent signup, and exploration. The proposed 200/120/80 split is an initial experiment. Deduplicate candidates across sources. Transfer unused capacity to another source that still has eligible candidates. Enforce all hard constraints on every source.

Retrieval quotas do not guarantee displayed exposure. Reserve and measure a small exploration allocation in the final deck. Apply a quality floor. Measure new-user time to first qualified impression, rather than claiming signup order guarantees distribution.

Do not assume hashing every eligible ID is cheap. It still evaluates the hash across the eligible set. Benchmark that approach for the initial population. If it exceeds the budget, use indexed, stable sampling buckets with bounded probes and randomized bucket traversal. Measure under-retrieval for heavily swiped viewers.

Benchmark a shared filtered query against separate source queries. `MATERIALIZED` can prevent useful predicate pushdown. PostgreSQL normally materializes a multiply referenced common table expression; the supplied claim that omission always repeats the full work is incorrect. See the [PostgreSQL WITH documentation](https://www.postgresql.org/docs/17/queries-with.html).

Prisma supports relation filters such as `none`. `relationMode="prisma"` controls referential integrity behavior; it does not disable all relation queries. Raw SQL is a reasonable implementation choice, but the supplied justification is too broad. See [Prisma relation queries](https://www.prisma.io/docs/orm/v6/prisma-client/queries/relation-queries) and [relation modes](https://docs.prisma.io/docs/orm/prisma-schema/data-model/relations/relation-mode).

For array targeting, test a containment predicate such as `show_me_categories @> ARRAY[viewer_category]`. A GIN array index supports specific operators; do not assume scalar `= ANY(array_column)` uses it. With only a few categories, selectivity can still be poor. See [PostgreSQL GIN documentation](https://www.postgresql.org/docs/17/gin.html).

Measure existing swipe and block indexes before adding reverse composite indexes or dropping prefix indexes. Inspect index size, write cost, heap access, and query workload. A compound latitude/longitude B-tree does not guarantee efficient two-dimensional retrieval.

Repair `boundingBox()` before treating it as a reference. Its longitude clamp loses valid results across the antimeridian. Its approximate latitude conversion can under-bound the spherical distance calculation. Handle poles, wrapped longitude ranges, rounding, and radius boundaries. Clamp the Haversine intermediate to [0,1]. Compare with independently verified fixtures as well as SQL/Node agreement.

Stored coordinates are approximate. Report broad distance bands and never expose stored coordinates. Evaluate PostGIS early if the hosting environment supports it. Choose it from measured geometry and query needs, not an arbitrary ratio of filtered rows.

Exit conditions: retrieval returns only eligible IDs; source overlap does not shrink decks unexpectedly; dense and sparse workloads meet an agreed latency and database-work budget.

**10. Stage F: separate compatibility from ranking**

Compatibility is an explainable profile similarity score. It is not a probability of relationship success. Prefer a label such as “Compatibility 72/100”. If the product retains a percentage, explain its meaning and do not imply calibration.

Use normalized interests, relationship intent, and user-selected lifestyle preferences. Treat department, college, clubs, year, and hangout preferences as optional context. Reduce duplicate influence from correlated education fields. Exclude star sign and inferred personality labels from the initial score unless there is a stated product reason and evidence.

For comparable factors, use:

`compatibility = 100 × sum(weight × similarity) / sum(comparable weights)`

Each similarity lies between 0 and 1. Define symmetry explicitly. Missing data is unknown, not automatic disagreement. Return evidence coverage with the score. Hide the number below a minimum evidence rule set before launch. One shared field must not produce an apparently complete 100-point assessment.

Return actual factor identifiers, shared values, contribution points, and score version. Do not expose hidden profile attributes through explanations. Validate the whole feature pipeline against mobile values.

The proposed `totalLikesReceived / totalSwipesReceived` estimates how often other users like the candidate among recorded swipes. It does not estimate whether the candidate will like this viewer. Multiplying by it reintroduces popularity bias.

For the first release, rank mainly by compatibility with bounded activity, profile readiness, and exposure adjustments. Use neutral defaults for users with little history. Keep exposure adjustments bounded so a frequently eligible profile is not suppressed indefinitely. Compare exposure within relevant opportunity groups, not only across the whole population.

Do not replace absolute ELO with ELO proximity by default. Proximity still groups users by a popularity-derived value. Remove ELO from the first revised ranker and retain it only for an explicitly justified experiment.

Later, train separate directional estimates from reliable data: P(viewer likes candidate) and P(candidate likes viewer). Account for whether each side had an opportunity to see the other. Use smoothing, calibration checks, and randomized exploration records. Multiplying estimates is a model assumption to validate, not proof of expected matches. An existing incoming like is direct directional evidence, subject to current eligibility.

Use windowed abuse signals for service protection. A high swipe rate alone does not establish a bot. Keep moderation decisions separate from compatibility and popularity ranking.

Exit conditions: compatibility is symmetric and deterministic for a fixed input; explanations reconcile with the score; missing data and zero weights behave as specified; popularity is absent from the displayed score.

**11. Stage G: run shadow validation, then a live experiment**

Shadow means generating alternative recommendations without showing them. Sample deck generations with explicit cache-hit metadata. Do not infer cache hits from response time. Record input versions and timestamps so delayed jobs can distinguish changed data from algorithm differences.

Use a bounded worker queue, concurrency limits, and database timeouts. A separate client pool helps isolate connections but still shares database CPU and I/O. Budget connections across all instances. Stop shadow jobs automatically when they threaten production resources. Measure dropped jobs and sampling bias.

Store sampled candidate records with request IDs, actual control positions, feature versions, and source membership. Avoid parallel arrays unless equal lengths and positional alignment are validated. At 300,000 records per day, 30 days means 9 million records. Arrays reduce row count, not the underlying candidate payload. Measure bytes, indexes, and retention cost.

Use shadow mode to test eligibility, latency, candidate overlap, resource cost, and supply. Metrics on candidates shown by control remain selected and position-biased. Do not use a 5% NDCG improvement or a predicted 10% match gain from this intersection as proof of live improvement. NDCG measures how well ranked items agree with relevance labels. Here the available labels do not cover the new candidate population.

Do not require Kendall correlation below 0.9. A different ranking is not necessarily a better ranking. Keep correlation and overlap as diagnostics.

Separate empty results into genuine supply exhaustion, missing setup, exclusions, and retrieval failure. A sparse eligible population can have a valid empty deck. Never remove a hard preference to pass an empty-deck threshold. The interface can offer a user-controlled preference change.

After technical validation, compare two rankers under identical eligibility rules. Assign users with a stable, versioned application hash mapped to a nonnegative range. Specify how cross-arm matches count. Because both users affect an outcome, use user-level uncertainty estimates and consider college/city cluster experiments when traffic supports them.

Choose one primary outcome before launch. A proposed outcome is the share of assigned active users who obtain a new mutual match with messages from both users within seven days. Record supporting measures: matches per 100 visible cards, time to first match, qualified conversation rate, blocks/reports per visible card, latency, and eligible-profile coverage. Prevent spam messages from inflating the conversation outcome.

Set sample size from baseline outcome rate, minimum useful improvement, and statistical power. Fifteen thousand impressions is not a universal sample requirement. Run across at least two full weekly cycles and allow outcome windows to mature. Low traffic can require longer.

**12. Release gates and rollout**

| Gate | Required evidence |
|---|---|
| Public response | Automated tests find no private fields or hidden-attribute explanations. |
| Eligibility | Zero violations in deterministic and generated test cases. Investigate every observed live violation. |
| Deck behavior | No unintended skips or duplicate decisions under concurrency and retries. |
| Event integrity | Retry/restart tests produce one persistent effect per action. |
| Supply | Explain empty decks by cause. Detect retrieval failures where eligible supply exists. |
| Performance | Establish a baseline and agree on separate retrieval and end-to-end budgets. An initial retrieval p95 target of 150 ms requires load-test evidence. |
| Operations | Demonstrate configuration propagation, worker shutdown, safe fallback, and bounded memory. |
| Product outcome | Meet the predeclared live-experiment decision rule without unacceptable guardrail regression. |

Run internal validation, sampled shadow, 1% live, 5%, 25%, 50%, then 100%. Percentages are suggested operating steps. Advance only after enough traffic and mature outcomes support the relevant gate. Pause ranker rollout on material errors or performance regression. Keep the corrected eligibility and public response contract active during rollback.

**13. Required verification and delivery order**

Create a runnable API test command. Add unit tests for eligibility matrices, normalized feature values, age boundaries, missing inputs, score symmetry, configuration, and cursor validation.

Use PostgreSQL and Redis integration tests for query behavior, deck races, candidate edits, simultaneous likes, action retries, failed event delivery, and deletion handling. Check every swipe route through the shared service.

Generate synthetic workloads with 100,000 and 200,000 users. Include uneven college sizes, broad radii, missing locations, users with many prior swipes, and active decks during preference changes. Measure requests per second, p50/p95/p99 latency, scanned rows, buffer reads, sort spill, lock waits, connection usage, and Redis memory. Include swipe-table growth; user count alone does not describe load.

Inspect `EXPLAIN (ANALYZE, BUFFERS)` on a test database. Do not require a particular index or prohibit every sequential scan. The optimizer can correctly choose a scan for small or unselective data. Assert bounded work and latency for specified workloads.

Test mobile onboarding, preference editing, cursor restart, missing compatibility, true zero scores, verified factors, visible-card events, and distance labels. Verify profiles beyond the original 150 limit when eligible unseen supply exists. Show an honest exhausted state when it does not.

Deliver in this order: A response/configuration/migrations → B preferences/eligibility → C shared swipes/events → D stable decks → E retrieval → F scoring/mobile contract → G shadow/live evaluation.

Primary files: `discover.controller.ts`, `recommendation.service.ts`, `impression.service.ts`, `match.service.ts`, `score-update.worker.ts`, `elo.service.ts`, profile/auth schemas and services, `admin.controller.ts`, `geo.ts`, Prisma schema and migrations, shared API types, and mobile discovery/onboarding components. Add dedicated eligibility, retrieval, deck, and swipe services. Keep the first implementation free of learned ranking dependencies.
