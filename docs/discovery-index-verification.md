# Discovery index repair

The account lifecycle migration removed `is_active`. PostgreSQL also removed the two partial indexes that referenced that column.

The replacement migrations create these indexes:

| Index | Purpose |
|---|---|
| `users_discovery_active_sample_idx` | Read active, confirmed profiles in `discovery_sample, id` order. |
| `users_discovery_created_idx` | Read active, confirmed profiles in `created_at DESC, id` order. |

Both indexes require `account_status = 'active' AND preferences_confirmed_at IS NOT NULL`.

The old college-text index is not recreated. Current eligibility uses verified institution membership. The new sample index matches the current retrieval order. The existing full sample index remains in place.

Each migration contains one `CREATE INDEX CONCURRENTLY` statement. Run the normal Prisma migration command. Do not wrap these migrations in a transaction. If an index build fails, inspect the failed migration and index validity before following the migration recovery procedure. Do not mark a failed build as applied.

## Repeat the verification

Run from the repository root in PowerShell:

```powershell
docker compose -f apps/api/docker-compose.recommendation-test.yml up -d --wait
$env:DATABASE_URL='postgresql://postgres:local-reco-test@127.0.0.1:55439/reco_test'
Push-Location apps/api
npx prisma migrate deploy
npm run discovery:verify-indexes
Pop-Location
docker compose -f apps/api/docker-compose.recommendation-test.yml down
```

The verification command rejects other database addresses. It checks index validity and readiness. It creates 100,000 synthetic users with verified memberships. Half the profiles meet the active and confirmed predicate.

The command compares retrieval before and after the indexes. It checks that each run returns 400 candidates. It checks candidate order and confirms both indexes appear in the query plan. It rolls back the fixture and temporary index changes, including on failure. The migration-created indexes remain installed.

The saved result is `docs/verification/discovery-index-verification.json`. It includes PostgreSQL query plans with execution and buffer statistics.

On 2026-09-07, 20 measured runs per stage produced these local results:

| Stage | p50 | p95 |
|---|---:|---:|
| Before | 409 ms | 460 ms |
| After | 384 ms | 423 ms |

These results cover warm retrieval in one local process. They do not establish production capacity or ranking and reciprocity latency. PostgreSQL can select different plans for different data distributions.

The API build, 21 algorithm unit tests, and 22 discovery integration tests passed after the migrations. The isolated test containers were stopped. No production migration was run.
