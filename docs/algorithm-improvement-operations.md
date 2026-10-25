# Algorithm improvement operations

## Implemented scope

| Plan item | Implementation |
|---|---|
| Missing discovery indexes | Two concurrent SQL migrations. See `discovery-index-verification.md`. |
| Interest ID drift | One shared catalog with 263 entries. Both mobile screens use canonical IDs. |
| Existing interest values | Recognized aliases normalize on profile writes, compatibility reads, and swipe snapshots. Reciprocity also looks up historical aliases before backfill. |
| Backfill | Dry run by default, 200-row batches, checkpoints, conditional updates, and batch rollback on concurrent edits. |
| Page timing | Sampled asynchronous events. Generation, refill, and cached requests have separate labels. |
| Reciprocity coverage | Candidate counts, valid estimates, rejection reasons, query failures, and elapsed time. |
| Capacity waits | Unsampled page events with deck ID, sequence, and atomic pending count. |
| Empty decks | State counters for setup, exhaustion, generation limit, and errors. |
| Shadow comparison | Top-20 overlap, rank movement, evidence share, incoming-like positions, and score summaries. |
| Offline evaluation | Chronological Brier error, baseline error, log loss, and coverage saved as an analytics event. |
| Benchmark | Budgets 40, 400, and 800; reciprocity on and off; retrieval, ranking, first page, next page, and stage timings. |
| Unused code | Removed Elo service, empty score worker, and unused recommendation analytics method. Chat no longer writes Elo message counters. |
| Assignment | Stable `reco-v2` experiment key. Ranking-version changes do not reassign users. The new ranking version is `ranking-v7`; old decks expire on version mismatch. |

The plan needed three corrections. The catalog contains 263 entries, not 264. Clubs already compare without case sensitivity, so no club backfill is required. Hangout fields permit multiple entries. Token matching remains excluded because common words can refer to different places.

## Update 2026-10-08: the newer app rules in Discovery and Standouts

Checked against the app as it is now - unverified accounts, "Who you see", the real-person check, pauses, reports - and measured with `npm run algorithm:lab` (400 students, 22 checks).

**Already right, now measured by the lab**
- Gender and "show me", both ways, in the deck and in Standouts (`eligibleSql`, `mutuallyEligible`).
- Age ranges both ways, with the flexible years.
- "Who you see": my campus, all my college's campuses, both colleges, or "People near me" (radius to a person's cell, or to a college-mode person's campus).
- Unverified: own campus only (college choosers), a few places lower in ranking, never in Standouts as a pick, campus-only Standouts as viewers.
- Paused accounts out of everyone's lists.

**Added**
| Rule | Where |
|---|---|
| Passed the real-person check: +3 points in the deck ranking (never past a clearly better match), +8 of 100 in Standouts (`standouts_real_person_boost`) | `ranking-policy.ts`, `discovery-ranking.service.ts`, `standouts.service.ts`, `standouts-v3.service.ts` |
| A photo or video that now fails the real-person check: -4 in the deck, kept out of Standouts until fixed | same, and `readySql` |
| An open "Under 18" report: out of the deck, Explore, Standouts, Likes You, the map and search until the team has reviewed it (`UNDER_AGE_HOLD_SQL`) | `eligibility.service.ts`, `search-people.service.ts` |
| Standouts night run skips paused viewers | `standouts-v3.service.ts` |

**Lab result (seed 1):** all 22 checks OK - mutual visibility 5314/5314, 0 wrong gender or age cards of 5550, 0 cards outside a "near me" radius, 0 hidden people shown, real-person checked earlier in 62.5% of mixed decks and 46% of Standouts picks vs 41% of verified students, own campus first in 100% of mixed decks, Gini 0.25, deck p95 454 ms, Standouts 88% full.

## Interest backfill

Run from `apps/api`. Load the intended database address into `DATABASE_URL` through the normal environment configuration. The command does not load an `.env` file itself.

For the isolated database:

```powershell
$env:DATABASE_URL='postgresql://postgres:local-reco-test@127.0.0.1:55439/reco_test'
npm run discovery:canonicalize-interests -- --checkpoint interests-dry.json
npm run discovery:canonicalize-interests -- --apply --checkpoint interests-apply.json
npm run discovery:canonicalize-interests -- --checkpoint interests-verify.json
```

Use a different checkpoint for each mode and each new scan. The final dry run must report zero changes. A completed checkpoint does not rescan the database. To resume an interrupted run, reuse that run's checkpoint.

For owner-operated staging, set `NODE_ENV=staging`. Add `--staging --expect-host HOST:PORT` to each command. Replace `HOST:PORT` with the exact host and port in the staging database address. The command rejects other environments. No production backfill was run or enabled by this work.

Each checkpoint is bound to the database address, mode, and catalog version. Each update compares the complete original JSON document. A concurrent edit rolls back the whole batch. Retry the same checkpoint after a conflict. A checkpoint-write interruption can cause a batch to be scanned again. The transformation is idempotent. Progress counts describe checkpointed work, not a transaction ledger.

The backfill changes known interest aliases only. It preserves unknown values, unrelated JSON fields, clubs, and historical relationship intent. It does not reconstruct historical snapshots from current profiles. User changes increment `eligibility_version` to expire that user's existing decks.

Keep checkpoint files out of version control. Backfill commands write local progress files even in dry-run mode.

## Telemetry

Set `DISCOVERY_TELEMETRY_SAMPLE_RATE` to a number from 0 to 1. The default is 0.1. Use 1 in isolated verification when every request must be recorded.

The queue holds at most 200 events per process. A separate database connection writes batches of 20 events. Database statements have a one-second timeout. Discovery requests do not wait for those writes. Admin metrics expose completed, failed, dropped, and queued event counts. These process counters reset on restart. State counts are unsampled but can still lose events when the queue is full or the database is unavailable.

The admin endpoint is `GET /api/v1/admin/metrics/algorithm`. Its `measurement` field contains:

- `timings`: seven-day p50 and p95 by page kind and stage.
- `rankingTimings`: compatibility and reciprocity percentiles by algorithm.
- `reciprocity`: candidates, estimates, and rejection or failure counts.
- `reciprocityCoverage`: estimates divided by measured candidates; null when there are no candidates.
- `states`: counts for non-ready page states, including capacity waits.
- `lastReciprocityEvaluation` and `lastShadowComparison`: persisted reports.

Deck time includes retrieval and ranking. Ranking time includes compatibility and reciprocity. Do not add these overlapping times. Cached pages have no ranking batch. A disabled estimator is represented by null, not by zero successful predictions. A candidate with insufficient valid history and malformed snapshots is classified as malformed. Candidates with valid history below the minimum are classified as below history. Candidates with enough history but too few similar decisions are classified as below similarity.

## Reports

Run these commands from `apps/api` with the intended environment loaded:

```powershell
npm run discovery:evaluate-reciprocity
npm run discovery:shadow-report
npm run discovery:report
```

Each command writes an analytics event. Shadow comparison reads at most the newest 10,000 rows from seven days. The output identifies the cap and included configuration versions. `lastReport` remains the descriptive conversation-outcome report for API compatibility. The two new reports have separate admin fields.

Algorithm 0 is the rebuilt scorer with policy off. Algorithm 1 is the rebuilt scorer with policy on. Shadow comparison does not contain a legacy algorithm baseline. Synthetic evaluation does not establish real-user match quality.

## Validation commands

Start the isolated services with `docker compose -f apps/api/docker-compose.recommendation-test.yml up -d --wait`. Use the isolated database and Redis addresses from the main runbook.

```powershell
npm run build --workspace @iem-dating/api
npm run typecheck:tools --workspace @iem-dating/api
npm run typecheck:mobile
```

The current suite contains 83 tests: 4 HTTP flow, 27 algorithm, 28 discovery integration, 19 security integration, and 5 outbox integration.

Run `npm run test:all` from `apps/api` with the test secrets from the main runbook. Run `npm run discovery:benchmark -- 100000` in that workspace after the tests. The benchmark replaces the isolated fixture. Do not run it concurrently with database tests or a backfill.

The benchmark requires `REDIS_URL=redis://127.0.0.1:56420` and a test-only `DISCOVERY_CURSOR_SECRET`. It creates 100,000 users, a verified eligible pool of 2,000 candidates, and 480,000 decision snapshots. Every eligible candidate has enough evidence to exercise the estimator. It asserts full candidate counts, successful estimates when enabled, and full page delivery.

There are three warm-up runs and 20 measured runs per configuration. Results are saved in `docs/verification/discovery-v2-100000.json`. The 40-candidate next-page case includes refill. Larger next-page cases use cached candidates. These are sequential local timings, not production capacity measurements.

Stop the isolated services with `docker compose -f apps/api/docker-compose.recommendation-test.yml down` after verification.

## Owner release work

Local verification on 2026-09-07 passed all 83 tests, the API build, script and test typechecking, mobile typechecking, and Android export. The backfill changed 240,000 aliases in the synthetic fixture. A fresh scan of 580,000 documents found zero remaining changes. See `docs/verification/algorithm-improvement-local.json` and `docs/verification/discovery-v2-100000.json`.

Production deployment remains separate. Apply migrations, run the staging backfill and a fresh dry-run verification, configure telemetry sampling, and check actual reciprocity coverage before changing rollout. Keep the default treatment rollout at zero until the owner completes release checks. No local benchmark proves production latency or recommendation quality.
