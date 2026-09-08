# Discovery rebuild implementation

This document describes the local implementation. The production database has not been migrated. Live experiments have not started.

**1. Implemented behavior**

- Discovery requires an adult birthday and confirmed discovery preferences.
- Users select a discovery category separately from their displayed gender. The first interface supports men, women, and nonbinary people. No targeting preference is inferred from orientation.
- Gender and age preferences apply in both directions.
- Distance discovery requires both users to select distance mode and share location. Both distance limits apply. College discovery requires both users to select college mode and have the same normalized college name.
- The server excludes self, inactive accounts, blocks in either direction, previous viewer decisions, incoming passes, and existing matches.
- Each page rechecks eligibility. Swipes check current eligibility and blocks again.
- Public responses use an explicit field allowlist. Password hashes, contact data, birthdays, coordinates, targeting settings, and internal scores do not enter the response.
- Both swipe endpoints call one transaction service. The first decision is authoritative. Identical retries have no additional effect. Conflicting retries return `SWIPE_CONFLICT`.
- Swipe counters, match creation, database notifications, and action events commit together. No in-memory score queue is needed. ELO does not affect discovery.
- A pair lock and a unique unordered-pair index prevent duplicate matches. Sorted user locks prevent counter-update lock cycles between different pairs.
- The daily product swipe quota is removed. A per-account burst limit permits 120 swipe requests per minute. Page and visibility requests have separate limits.
- Server-issued receipts distinguish delivery from visibility. Visibility acknowledgements use an atomic compare-and-set and aggregate in the same transaction. Retries cannot increment the same receipt twice.
- Compatibility shows shared profile information. It uses interests, relationship intent, lifestyle, clubs, campus context, stated personality preferences, and hangout spots. It does not predict relationship success. The number is unavailable when fewer than two weighted factors or less than half the evidence weight can be compared.
- The treatment ranker adds bounded activity, photo-readiness, and exposure adjustments. Position 9 in each ten-card block uses a seeded exploration order. Both arms reserve configurable positions for candidates with insufficient compatibility evidence when available. Treatment also reserves positions for confirmed incoming likes. The control orders comparable candidates by compatibility. Both rankers use identical eligibility and public response rules.
- Mobile removes the 98 fallback and fabricated compatibility factors. It provides preference setup, editing, location sharing, and location removal.

**2. Deck contract**

`GET /api/v1/discover/recommendations?limit=20&cursor=...` returns:

```json
{
  "success": true,
  "data": {
    "cards": [],
    "nextCursor": null,
    "state": "exhausted",
    "deckId": "server-generated-uuid"
  }
}
```

States include `capacity_limited`, `ready`, `setup_required`, `exhausted`, and `generation_complete`. The shared declaration is in `packages/shared/index.d.ts`.

A cursor identifies the viewer, deck, last examined absolute sequence, eligibility version, and expiry. The server signs the cursor. Removing or swiping a card does not renumber the remaining cards. Invalid candidates advance the examined sequence without appearing in the response.

Decks expire after 45 minutes. Each viewer can retain two generations. A generation holds at most 2,000 IDs. Refill starts below 40 remaining entries. A generation begins with up to 400 candidates by default. Concurrent writers use ownership tokens. Failed or expired leases cannot publish a refill.

An expired, replaced, or stale deck returns HTTP 409 with `DECK_EXPIRED`. The client provides a restart action. Card IDs prevent duplicate appends within the mobile list. Previous swipe decisions remain excluded across generations. Unacted-on profiles can appear again after a restart; no lifetime impression exclusion is claimed.

The new mobile client uses cursors. Page numbers above 1 return a restart error. There is no silent conversion of unstable page offsets. Release the updated mobile client with the API contract change.

**3. Retrieval and capacity controls**

Retrieval uses incoming likes, indexed college affinity, recent-signup, and exploration sources. Incoming likes receive up to 10% of the candidate budget, college affinity up to 40%, and recent signups up to 20%. Exploration fills the remaining budget. All sources apply the same eligibility checks. A stored random sample key supports a stable traversal of the candidate population. The final merge removes duplicate IDs and transfers unused source capacity to exploration.

Recent-signup scanning uses a bounded source pool. Exploration first probes a bounded ordered pool. If that probe cannot fill the candidate budget, retrieval retries without the probe limit. This prevents limited sampling from producing a false exhausted result.

The ordered subqueries preserve index traversal before expensive eligibility checks. Correlated exclusions retain indexed lookups. Per-query settings disable JIT compilation and request a custom plan because selectivity changes substantially by viewer. A two-second statement timeout limits retrieval work. A timeout is an error, not an empty eligible population.

These query choices need continued measurement on the deployed PostgreSQL version and data distribution. The included benchmark tests sequential retrieval on local PostgreSQL 16. It does not test concurrent production traffic, network latency, replica behavior, or database size at millions of users.

**4. Configuration and rollout**

Set `DISCOVERY_CURSOR_SECRET` to a stable secret across API instances. `JWT_ACCESS_SECRET` is the fallback signing key. Discovery returns a service error when neither key is configured. Do not rotate the key during a deck's lifetime unless all current decks should restart.

The admin routes require the existing authentication and admin middleware:

- `GET /api/v1/admin/algorithm/config`
- `POST /api/v1/admin/algorithm/flags`
- `POST /api/v1/admin/algorithm/weights`
- `GET /api/v1/admin/metrics/algorithm`

Example flag body:

```json
{
  "flags": { "reco_rollout_pct": 5 },
  "reason": "Begin approved five-percent ranker experiment"
}
```

At 0% rollout, all users already receive the rebuilt eligibility, retrieval, compatibility, and deck behavior. The experiment compares policy adjustments enabled versus disabled. It does not compare the legacy scorer with the rebuilt scorer. Shadow mode has no legacy baseline.

Defaults are `reco_rollout_pct=0`, `shadow_enabled=0`, `shadow_sample_rate=0.01`, `shadow_max_queue=20`, and `candidate_budget=400`. There is no hard-filter bypass flag.

Settings load from the database for each page. Changes invalidate deck configuration versions immediately on the next request. Database/configuration failures use the validated default control configuration. That fallback retains eligibility checks. Admin updates validate exact keys, finite values, ranges, and the merged weight sum. Each transaction records the actor, reason, previous values, and new values.

Enable shadow sampling before a live ranker split. Shadow jobs start after the HTTP response finishes. Each instance has a bounded disposable queue and one database connection. Query timeouts bound work. More than five failed jobs in the latest 100 jobs opens the local circuit. Restart the worker after diagnosing the cause. Runtime queue, drop, and failure counters appear in algorithm metrics.

Shadow records contain control and alternative ordering, input/configuration versions, candidate count, and elapsed time. They are diagnostics. They do not establish lift for candidates the control never displayed.

**5. Migration procedure**

Do not run `db push` or `migrate reset` on an existing deployment.

The first historical migration already creates the original tables. The new `20260904000000_reconcile_schema` migration adds the schema changes missing between that migration and the location migration. New empty environments apply the complete migration chain normally.

An existing database that received manual schema changes needs a separate history check:

1. Back up the database and restore a staging copy.
2. Compare the copy with `prisma/snapshots/pre-rebuild.prisma` using `prisma migrate diff`. Use the installed Prisma 5 CLI.
3. Inspect every difference. Do not mark reconciliation applied merely because some columns exist.
4. If the copy already has the full pre-rebuild schema, mark `20260904000000_reconcile_schema` applied with `prisma migrate resolve --applied`. Otherwise prepare and execute the actual missing changes first.
5. Check migration records for the original migrations. Do not rewrite records that disagree with actual schema state.
6. Check for reversed duplicate match pairs. The new unique index intentionally fails if duplicates exist. Resolve each duplicate with its dependent chats and messages before retrying. This implementation does not delete or merge matches automatically.
7. Apply the remaining migrations to the copy. Compare the resulting schema and exercise discovery.
8. Repeat the verified procedure on the deployment during its release window.

Each concurrent index has its own one-statement migration. Do not wrap those migrations in a transaction. Check `pg_index.indisvalid` after interrupted index creation. Drop only the identified invalid index before retrying its failed migration.

The new preference columns remain unconfirmed for existing users. Existing distance values came from a screen labelled miles. The new setup screen explicitly asks users to confirm a kilometre value.

Retain `MatchPreference` and legacy score columns during the rollback window. They do not control new discovery. Roll back ranker configuration, not the corrected eligibility and public response contract.

**6. Data and maintenance commands**

Run the following from the API workspace with the intended database environment:

- `npm run discovery:reconcile-counters`: Rebuild swipe counters from stored decisions. Run during a swipe maintenance window to avoid replacing concurrent increments.
- `npm run discovery:maintenance`: Remove receipts and shadow rows older than 30 days in bounded batches. Remove deleted-user references. Run repeatedly when a backlog remains.
- `npm run discovery:report`: Save a descriptive mature conversation-outcome report as an analytics event. It does not calculate causal lift or confidence intervals.

Schedule maintenance through the deployment's job runner. No production schedule was installed by this change. Extend the deployment's account-deletion procedure to run the same cleanup before claiming immediate deletion of analytics data.

Visibility currently means the top card remained on the focused, active discovery screen for one second. It is not an instrumented geometric measurement of 50% visibility. Validate the mobile visibility behavior on a physical device before using these events for a live experiment.

**7. Verification**

- API: `npm run build --workspace=@iem-dating/api`.
- Mobile: `npx tsc --noEmit -p apps/mobile/tsconfig.json`.
- Unit tests: `npm test --workspace=@iem-dating/api`.
- Integration tests: `npm run test:integration --workspace=@iem-dating/api` with the isolated PostgreSQL and Redis URLs required by the test file.
- Synthetic retrieval: `npm run discovery:benchmark -- 100000` or `200000` from the API workspace. This command replaces data only in the explicitly guarded `localhost:55439/reco_test` database.

Integration coverage includes private-field exclusion, receipt retries, aggregation rollback, pagination through 220 swiped profiles, current blocks and preferences, concurrent mutual likes, repeated actions through both HTTP routes, parallel page reads, expired cursors, geometry across the antimeridian, and configuration validation.

For a new local test environment, run these commands from `apps/api` in PowerShell:

```powershell
docker compose -f docker-compose.recommendation-test.yml up -d --wait
$env:DATABASE_URL = 'postgresql://postgres:local-reco-test@127.0.0.1:55439/reco_test'
$env:REDIS_URL = 'redis://127.0.0.1:56420'
npx prisma migrate deploy --schema prisma/schema.prisma
npm test
npm run test:integration
```

These credentials apply only to the loopback test database. The integration suite replaces that database's test data. Stop the two test services after testing with `docker compose -f docker-compose.recommendation-test.yml stop`.

The Android JavaScript bundle exported successfully. Location sharing adds `expo-location`. Rebuild the native development client before testing location on the device. The existing React Native patch had incorrect hunk counts; those counts were corrected without changing the patch's intended null check.

Machine-readable retrieval results are in `docs/verification/discovery-100000.json` and `discovery-200000.json`. Review their scope statements. Do not treat these results as proof of production throughput or match-quality improvement.

Historical retrieval benchmark (superseded): five warm-up runs and 100 measured runs per case. These fixtures predate required student membership and are not current verification:

| Population | Dense p95 | Heavy swiper p95 | Distance p95 | Sparse college p95 |
|---|---|---|---|---|
| 100,000 | 115 ms | 116 ms | 60 ms | 67 ms |
| 200,000 | 98 ms | 107 ms | 164 ms | 57 ms |

The 200,000-user distance case does not meet the proposed 150 ms target. Keep that performance gate open. The benchmark has only one concurrent requester and does not measure full page generation, event-table growth, or production network cost.

**8. Release conditions still requiring the deployment**

Verify the actual database history, run concurrent load tests on representative infrastructure, rebuild and test the native client, and collect confirmed preferences from users. Then run shadow sampling and a live ranker experiment with a predeclared outcome and sample-size calculation.

The implementation uses a conditional outgoing-decision estimator described below. It does not infer gender preferences, remove filters to fill decks, or claim measured relationship success.

**Ranking review corrections**

Ranking revision 3 uses a hash of viewer ID, deck seed, and candidate ID for ties. The same deck keeps the same tie order. New decks rotate that order. Ranking never substitutes 50 for missing evidence. Each interleave iteration emits a unique ID or exits. Duplicate input IDs cannot cause an infinite loop.

The default compatibility weights are interests 0.30, intent 0.25, lifestyle 0.15, clubs 0.05, campus context 0.10, stated personality preferences 0.10, and hangout spots 0.05. These are initial policy settings, not learned estimates. Campus context compares department, campus, yearOfStudy, and hosteller status only within the same college in college mode. The legacy year field can contain a graduation year, so the scorer does not infer yearOfStudy from it. Personality measures similarity in stated personality, communication, and love-reception values. It does not use star signs or claim psychological validity.

Weights require the compatibility_v3 marker. Older saved weights fall back to the complete new defaults. The ranking-v6 configuration prefix invalidates decks created by the earlier ranking code.

Treatment orders candidates with missing evidence by visible exposure, activity, photo readiness, then seeded order. Control uses seeded order for this pool. Unused reserved capacity transfers to other candidates. Exploration can also select candidates with missing evidence. Therefore, the reservation is not a strict upper bound on their share.

Treatment reserves a position for a candidate who has already liked the viewer. It does not add ranking points for that like. This is direct directional evidence. It does not change the displayed compatibility percentage. The ranker does not use inbound popularity ratios as a reciprocity prediction. Predictions for candidates who have not acted use the conditional outgoing-decision model described below. Its accuracy must be assessed from observed outcomes.

The exposure penalty is min(25, 2 * log(1 + dailyVisibleCount)). It continues increasing above 147 views and reaches its cap near 268,336 views. This remains a bounded heuristic. It does not guarantee equal exposure or prevent every concentration effect.

The stored benchmark results predate these ranking changes and measure retrieval. They do not establish latency for the updated treatment ranking queries.

**Second review corrections**

Grouped evidence now scales with the number of comparable fields: lifestyle uses four fields, campus context uses four fields, and stated personality uses three fields. One answered lifestyle field supplies one quarter of the lifestyle weight. Missing fields do not become disagreements. A profile needs at least two comparable groups and at least 0.5 total evidence weight before a numeric score is available.

Incoming likes now have a retrieval source in both experiment arms. The treatment reservation can therefore operate on these candidates even when sampling would otherwise omit them. This change improves access to known directional interest. It is not a learned mutual-interest prediction.

Deck creation and refill remove duplicate IDs. Refill rejects deleted or expired decks instead of returning stale in-memory data. Weight configuration requires a valid marker and every expected weight key. The ranking-v6 prefix forces earlier decks to restart.

Remaining evaluation work: factor weights and reserved shares are hand-selected. Their effect on mutual conversations needs a controlled experiment. Visible exposure uses a rolling day. Redis now reserves temporary delivery capacity across concurrent requests. Shadow diagnostics now run both ranking variants on one captured candidate and feature snapshot. Historical reports are descriptive and do not establish causal lift. Earlier retrieval benchmark numbers predate the incoming-like source; rerun capacity tests before production rollout.

**Completed reservation and index work**

cold_slots_per_10 defaults to 2 and accepts integers from 0 through 4. Positions are selected from 5, 10, 3, and 8 in that order. incoming_slots_per_10 defaults to 1 and accepts integers from 0 through 2. Treatment positions are 2 and 7. Treatment exploration uses position 9. These sets do not overlap. Earlier natural selection can consume a candidate from a reserved pool; the shared used-ID set prevents duplicate output. Empty pools transfer capacity. Reservations are opportunities, not maximum shares.

Exposure adjustments are computed once per candidate before sorting. No incoming-like points remain. Both live and shadow ranking receive the same reservation configuration. Changes invalidate earlier decks.

Three concurrent migrations add swipes_target_action_swiper_idx and swipes_incoming_order_idx, then remove swipes_swiper_id_idx. The unique (swiper_id,target_id) index remains. Each migration contains one statement and must run outside an explicit transaction.

The query-plan fixture contains 50,000 incoming swipes for one target and 200,000 background swipes. Before/after execution times were 2.241/2.181 ms for candidate-specific lookup, 18.569/0.145 ms for ordered incoming retrieval, and 0.232/0.052 ms for outgoing lookup. These are individual local measurements, not latency percentiles. The new lookup index appeared in the ranking bitmap plan. The ordered index supported incoming retrieval. The unique composite index supported outgoing lookup after removal. Index-only behavior depends on visibility maps; no fixed planner choice is promised. Raw plans are in docs/verification/incoming-query-plans.json. The fixture script rolls back all inserted swipes and index changes.

Existing users receive setup_required until they confirm. GET preferences does not infer discovery category or targeting from gender or orientation. The mobile settings screen explains confirmation and prevents saving after a load failure. Invalid confirmation requests leave preferences_confirmed_at null. Integration coverage checks that valid explicit confirmation produces a populated discovery page. No artificial confirmation backfill is performed.

Final verification for this change includes 18 unit tests, 19 database integration tests, API compilation, mobile TypeScript validation, and successful application of the three migrations on the isolated test database. Production deployment and real-device interaction are not represented by these checks.

**Completed local algorithm: revision 6**

The directional reciprocity model is an empirical conditional estimator. It uses each candidate's own outgoing decisions from the preceding 90 days, capped at their latest 200 decisions. Swipe transactions save interest and relationship-intent inputs in target_signals at decision time. Historical rows without snapshots remain unknown. No historical input is reconstructed from a profile that may have changed.

Similar examples require equal nonempty relationship intent and at least one shared normalized interest with the current viewer. The model needs 50 usable decisions and 20 similar examples. The actor baseline is (likes + 5) / (observations + 10). Conditional probability is (similarLikes + 10 * baseline) / (similarObservations + 10). Treatment adds at most five points in either direction from the difference between conditional probability and that actor's baseline. This does not add points for general popularity. Observed incoming likes use their reserved pool instead of a predicted adjustment. No model value enters the public compatibility response.

reciprocity_enabled defaults to 1 and affects only treatment. The overall treatment rollout remains 0 by default. Missing evidence produces no prediction. Model-query failures omit the model adjustment and increment the failed-candidate count in sampled telemetry. A two-second statement timeout bounds the live model query. The actor-history index supports bounded latest-decision retrieval. The estimator updates directly from committed decisions and needs no training worker.

Run npm run discovery:evaluate-reciprocity --workspace=@iem-dating/api for chronological evaluation. The report includes prediction coverage, Brier error, actor-baseline Brier error, and log loss. Only earlier decisions train each evaluated prediction. Local synthetic fixtures verify that the model learns a conditional pattern; they do not establish production accuracy or causal match lift.

Redis reservations atomically cap unacknowledged delivery claims per profile. max_pending_per_profile defaults to 20 (range 1–100). exposure_reservation_seconds defaults to 120 (range 30–300). Retries for the same viewer/deck/sequence reuse a claim. A committed visibility acknowledgement releases it; failed acknowledgements retain it until retry or expiry. Abandoned requests expire without a worker. Redis server time controls expiry. Existing longer claims retain their expiry when configuration reduces the claim duration.

At capacity, a page returns capacity_limited and a cursor positioned before the waiting card. Previously selected cards can still be delivered. The mobile screen provides a retry message and Load more action. This can temporarily delay cards behind the reserved profile; it does not report false exhaustion or skip the waiting card. The cap applies to pending deliveries during the reservation interval, not lifetime exposure or cards retained on a disconnected device.

Shadow mode captures candidate IDs, compatibility scores, activity, photo readiness, visible counts, incoming-interest flags, and model adjustments once. The queue copies that snapshot. Both variants use the same viewer, seed, configuration, and captured values. Shadow work performs no second retrieval and no reservation claims. Its isolated database connection persists the comparison. Tests change a profile after delivery and verify that the captured comparison remains unchanged.

Migrations 20260906110000 and 20260906120000 add decision-time signal storage and the actor-history index. No model-input or preference-confirmation backfill is performed. Tests cover conditional learning, insufficient evidence, legacy missing snapshots, bounded ranking effects, concurrent reservation claims, idempotent claims, expired claims, cursor retry, visibility release, and identical-input shadow comparison.

All three previously missing local capabilities are implemented. Production migration, rollout, real-device checks, and interpretation of live outcomes remain deployment responsibilities.

Revision 6 verification: 21 unit tests and 22 database integration tests pass. API compilation, mobile TypeScript validation, Prisma client generation, and schema comparison pass. The schema comparison reports no difference on the isolated test database. Synthetic evaluation output is saved in docs/verification/reciprocity-evaluation-local.json.

## Algorithm metrics and interest normalization — 2026-09-07

Both mobile interest screens and the API use `packages/shared/interest-catalog.js`. The catalog contains 263 entries. Known legacy aliases map to canonical IDs. Unknown strings remain unchanged. Club and hangout comparisons retain case-insensitive exact matching. Hangout token matching is not enabled because shared words can identify different places.

Discovery timings use a bounded asynchronous queue with one separate database connection. The default sample rate is 10%. State and capacity events are not sampled but can be dropped if the queue is full. Admin metrics expose queue failures and drops for the current process. Counters reset when the process restarts.

`GET /admin/metrics/algorithm` includes seven-day stage timing percentiles, reciprocity coverage and rejection counts, state counts, latest evaluation, and latest shadow comparison. Generation, refill, and cached requests are identified. Deck time includes retrieval and ranking. Do not add overlapping stage times.

Shadow comparison reports include top-20 overlap, mean absolute rank movement, known-evidence share, incoming-like positions, and score distributions. Both orders use the same captured input. Algorithm 0 means policy off. Algorithm 1 means policy on. Neither is a legacy scorer baseline.

The experiment key remains `reco-v2` across ranking-version changes. The removed Elo service and empty score worker have no remaining callers. Chat retains message analytics but no longer writes unused Elo message counters.

Run `npm run typecheck:tools` to check scripts and tests. Follow [Algorithm improvement operations](algorithm-improvement-operations.md) for backfill and benchmark commands.
