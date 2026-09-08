# Phase 6 performance and ranking validation

Use these tools on local or staging systems. Do not run them against production.

## Concurrent HTTP load test

Prepare active test accounts. Each account must have completed student verification, onboarding, and discovery preferences. Prepare active matches for message scenarios.

Set the target and access tokens:

```powershell
$env:LOAD_TEST_TARGET_LABEL='staging'
$env:LOAD_TEST_BASE_URL='https://staging.example.com'
$env:LOAD_TEST_DISCOVERY_TOKENS='token-for-account-a,token-for-account-b'
$env:LOAD_TEST_CONCURRENCY='20'
$env:LOAD_TEST_DURATION_SECONDS='120'
$env:LOAD_TEST_SCENARIOS='discovery,conversation_list'
npm run load:test --workspace apps/api
```

The command uses these default gates:

- Total p95 latency must not exceed 500 milliseconds.
- The error rate must not exceed 1 percent.
- The run must complete at least ten requests per configured concurrent worker.

The command exits with code 1 when a gate fails. It writes a JSON report under `docs/verification`. The report includes concurrency, duration, target origin, scenarios, host information, latency percentiles, throughput, HTTP status counts, and gate results. It does not include access tokens.

For message-history reads, set chat targets:

```powershell
$env:LOAD_TEST_CHAT_TARGETS='[{"token":"token-for-account-a","matchId":"00000000-0000-0000-0000-000000000000"}]'
$env:LOAD_TEST_SCENARIOS='message_read'
npm run load:test --workspace apps/api
```

Message writes create real test messages. Use them only in isolated test matches:

```powershell
$env:LOAD_TEST_ENABLE_WRITES='true'
$env:LOAD_TEST_SCENARIOS='message_send'
npm run load:test --workspace apps/api
```

Delete test messages and accounts according to the staging-data procedure after a write test.

## Ranking readiness report

Enable discovery telemetry on staging. Let the sample window collect normal test traffic. Run the chronological reciprocity evaluator and shadow comparison before the readiness report.

```powershell
$env:PHASE6_TARGET_LABEL='staging'
$env:PHASE6_MINIMUM_RECIPROCITY_CANDIDATES='1000'
$env:PHASE6_MINIMUM_RECIPROCITY_COVERAGE_PERCENT='10'
$env:PHASE6_MAXIMUM_RECIPROCITY_FAILURE_PERCENT='1'
$env:PHASE6_MAXIMUM_DISCOVERY_P95_MS='500'
$env:PHASE6_MAXIMUM_EVIDENCE_AGE_HOURS='168'
npm run discovery:phase6-readiness --workspace apps/api
```

The command checks these conditions:

- The seven-day telemetry window contains enough reciprocity candidates.
- The configured minimum share receives a reciprocity estimate.
- Reciprocity query failures stay within the configured limit.
- The worst discovery total p95 stays within the configured limit.
- The latest reciprocity evaluation is current.
- The latest shadow comparison is current.

Set thresholds before each test. Record the reason for each threshold change. Do not lower a threshold after reading the result from the same run.

## Required evidence

Keep these artifacts for each release candidate:

- The load-test JSON report.
- The Phase 6 readiness JSON report.
- The current reciprocity evaluation report.
- The current shadow comparison report.
- The database size, application revision, infrastructure size, region, and test-client location.

A local result verifies the tools. Only a representative staging result can close the Phase 6 release gate.

