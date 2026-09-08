# IEM Connect updated application runbook

**Updated:** 6 September 2026  
**Workspace:** `E:\IEM_Dating_App`  
**Purpose:** Use this document to install, configure, run, test, rebuild, and operate the current application.

This document describes the current workspace. It does not authorize a production deployment. Complete the release gates in section 14 before production.

## 1. Current application components

| Component | Current implementation |
|---|---|
| Mobile | Expo SDK 57, React Native 0.86.3, React 19.2.3, custom development client |
| API | Express 5, TypeScript, Socket.IO, Prisma |
| Database | PostgreSQL; 25 migrations currently exist |
| Short-lived state | Redis for OTP, rate limits, discovery state, and socket coordination |
| Delivery worker | Transactional outbox worker inside the API process |
| Media | Amazon S3-compatible profile and private chat buckets |
| Local queue | Account-scoped mobile message retry queue |
| Tests | Algorithm, discovery integration, security integration, and outbox integration suites |

The API process starts HTTP, Socket.IO, the outbox worker, and the discovery impression flush loop. Do not start a separate outbox worker.

RabbitMQ remains in the legacy root Docker Compose file. The current outbox delivery path does not use RabbitMQ.

## 2. Required software

Install these tools before the first run:

| Tool | Required version or condition |
|---|---|
| Node.js | `20.19.4`, `22.13.0`, `24.3.0`, or a later supported version |
| npm | The version supplied with the selected Node.js release |
| Docker Desktop | Current supported release with Docker Compose v2 |
| Git | Current supported release |
| Android Studio | Required for Android native builds and the emulator |
| Java | JDK 17 for Android Gradle builds |
| Android SDK | Platform tools, build tools, and one emulator or physical Android device |
| ADB | Android Debug Bridge from Android SDK platform tools |
| Xcode | Required only for iOS builds on macOS |

Check the main tools:

```powershell
node --version
npm --version
docker version
docker compose version
adb version
java -version
```

## 3. First installation

Open PowerShell in the repository root:

```powershell
cd E:\IEM_Dating_App
npm install
```

The root `postinstall` command applies two required patches:

- `patches/@react-navigation+core+7.21.13.patch`
- `patches/@siteed+audio-studio+3.2.1.patch`

The install must show both patches as successful. Do not delete these files. Review each patch when its target dependency version changes.

Generate the Prisma client:

```powershell
cd E:\IEM_Dating_App\apps\api
npx prisma generate --schema prisma/schema.prisma
```

If Windows reports that a Prisma engine file is locked, stop only the API process that uses this workspace. Then run the command again. Do not stop unrelated Node.js processes.

## 4. API environment configuration

Create the local API environment file:

```powershell
cd E:\IEM_Dating_App
Copy-Item apps\api\.env.example apps\api\.env
```

Edit `apps/api/.env`. Never commit this file.

Generate independent secrets. Run the command once for each secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use different values for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HMAC_SECRET`, and `DISCOVERY_CURSOR_SECRET`.

### Required API variables

| Variable | Local value or rule |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the selected environment |
| `REDIS_URL` | `redis://localhost:6379` for the root local services |
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | Default local value is `3000` |
| `JWT_ACCESS_SECRET` | Independent random secret with at least 32 characters |
| `JWT_REFRESH_SECRET` | Different random secret with at least 32 characters |
| `OTP_HMAC_SECRET` | Independent random secret with at least 32 characters |
| `DISCOVERY_CURSOR_SECRET` | Independent random secret with at least 32 characters |
| `JWT_ISSUER` | Use `iem-connect-api` unless the environment defines another stable value |
| `JWT_AUDIENCE` | Use `iem-connect-mobile` unless the environment defines another stable value |
| `CORS_ORIGIN` | Exact permitted mobile web or administration origin; avoid `*` outside local development |

The API refuses to start when JWT or OTP secrets are absent, weak, placeholders, or shared.

### Email and SMS variables

| Variable | Purpose |
|---|---|
| `SMTP_HOST` | SMTP server host |
| `SMTP_PORT` | SMTP server port, usually `587` |
| `SMTP_USER` | SMTP account |
| `SMTP_PASS` | SMTP credential from the secret manager |
| `SMTP_FROM` | Verified sender identity |
| `SMS_TRANSPORT` | Use `msg91` for the current real adapter; use `test` only with `NODE_ENV=test` |
| `MSG91_AUTH_KEY` | MSG91 credential |
| `MSG91_TEMPLATE_ID` | Approved MSG91 template ID |

Real student verification needs a working email transport. Phone OTP needs a working SMS transport. Test transport is rejected outside test mode.

### Media variables

| Variable | Purpose |
|---|---|
| `AWS_REGION` | S3 region |
| `AWS_ACCESS_KEY_ID` | Storage credential |
| `AWS_SECRET_ACCESS_KEY` | Storage credential |
| `AWS_S3_BUCKET_NAME` | Profile-media bucket |
| `AWS_PRIVATE_MEDIA_BUCKET` | Separate private chat-media bucket |
| `CDN_URL` | Optional approved profile-media CDN origin |
| `MEDIA_CACHE_TTL` | Signed media cache duration in seconds; default is `3600` |

Do not use the profile bucket as the private chat bucket. Use separate access policies and credentials where possible.

## 5. Mobile environment configuration

Create the mobile environment file:

```powershell
cd E:\IEM_Dating_App
Copy-Item apps\mobile\.env.example apps\mobile\.env
```

Set these values:

```text
EXPO_PUBLIC_API_URL=https://your-api-host.example/api/v1
EXPO_PUBLIC_SOCKET_URL=https://your-api-host.example
```

Rules:

- Include `/api/v1` in `EXPO_PUBLIC_API_URL`.
- Do not include `/api/v1` in `EXPO_PUBLIC_SOCKET_URL`.
- Remove the trailing slash from both values.
- Use HTTPS for a physical device, staging, and production.
- Restart Metro after either value changes.
- Treat every `EXPO_PUBLIC_*` value as public. Never put a secret in it.

For an Android emulator, local values can use the emulator host alias:

```text
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api/v1
EXPO_PUBLIC_SOCKET_URL=http://10.0.2.2:3000
```

For a physical device, use an HTTPS tunnel or a reachable HTTPS development host. Set `CORS_ORIGIN` to the permitted origin when a browser client is used.

The release application identity is `IEM Connect`, Expo slug `iem-connect`, and Android and iOS identifier `com.iemconnect.app`. Confirm that this identifier is available before the first store upload. Link the project with `eas init` from `apps/mobile`. Do not commit signing credentials.

## 6. Start local PostgreSQL and Redis

Start Docker Desktop. Then run:

```powershell
cd E:\IEM_Dating_App
npm run services:up
```

This command starts the root `postgres` and `redis` services. It does not start the legacy RabbitMQ service.

Check the services:

```powershell
docker compose ps
docker compose exec redis redis-cli ping
```

Redis must return `PONG`.

The root Compose file contains development credentials. Do not use those credentials or volumes in staging or production.

## 7. Apply database migrations

Apply committed migrations before the API starts:

```powershell
cd E:\IEM_Dating_App\apps\api
npx prisma migrate deploy --schema prisma/schema.prisma
```

Use `migrate deploy` for shared environments. Do not use `migrate dev` against staging or production.

Check migration state:

```powershell
npx prisma migrate status --schema prisma/schema.prisma
```

The current clean setup applies 25 migrations. Investigate any failed or missing migration before API startup.

## 8. Start the API

Open terminal 1:

```powershell
cd E:\IEM_Dating_App
npm run dev:api
```

Wait for these startup results:

- Database connection succeeds.
- The server listens on port `3000` or the configured port.
- No authentication configuration error appears.

Check HTTP health:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected result:

```json
{
  "status": "ok"
}
```

The timestamp field will also be present.

The current `/health` route checks the HTTP process only. Check PostgreSQL, Redis, storage, email, SMS, and push separately before a release.

## 9. Build or start the mobile app

The current upgrade changes native dependencies. Create a new development build before the first device test.

### Android development build

Connect an emulator or device. Then open terminal 2:

```powershell
cd E:\IEM_Dating_App\apps\mobile
npx expo run:android
```

This command builds the native application, installs it, and starts Metro. Do not start another Metro process at the same time.

Create another native build after any of these changes:

- Expo SDK or React Native version
- Native dependency
- `app.json` plugin or permission
- Android or iOS native configuration
- A version-specific native patch

JavaScript and TypeScript changes normally need only Metro reload.

### Daily development after the native build exists

Open terminal 2:

```powershell
cd E:\IEM_Dating_App\apps\mobile
npx expo start --dev-client
```

The app uses a custom development client. Expo Go is not sufficient for the current audio and native modules.

If the phone cannot reach Metro on the local network, use:

```powershell
npx expo start --dev-client --tunnel
```

### Web development

```powershell
cd E:\IEM_Dating_App
npm run web --workspace mobile
```

Test native-only functions separately. Secure storage, notifications, camera, audio recording, and native media behavior can differ on web.

### iOS development

Run this command on macOS with Xcode installed:

```bash
cd apps/mobile
npx expo run:ios
```

Do not claim iOS support until the iOS build and physical-device tests pass.

## 10. Connect a physical Android device

Enable Developer options and USB debugging on the phone.

For USB:

```powershell
adb devices
```

Accept the authorization prompt on the phone.

For Android 11 or later wireless debugging, pair once:

```powershell
adb pair <phone-ip>:<pairing-port>
```

Connect each session:

```powershell
cd E:\IEM_Dating_App\apps\mobile
npm run connect
```

If automatic discovery fails:

```powershell
npm run connect -- -PhoneIP <phone-ip> -Port <wireless-debugging-port>
adb devices
```

The pairing port and connection port are different. Use the port from the main Wireless debugging screen for `adb connect`.

## 11. Required application-flow check

Use a test account and complete this sequence after a clean build:

1. Register or sign in.
2. Verify the login identifier.
3. Confirm that an unsupported college domain fails.
4. Verify membership through an approved institution flow.
5. Confirm an adult birthday.
6. Complete the required profile fields and approved media.
7. Submit discovery preferences explicitly.
8. Confirm that the discovery deck appears only after readiness succeeds.
9. Like another eligible test account from device A.
10. Like the first account from device B.
11. Confirm that one match is created.
12. Send text and permitted media from both transports.
13. Close and reopen one client. Confirm ordered message recovery.
14. Unmatch. Confirm that HTTP, Socket.IO, and private-media access stop.
15. Repeat with block and suspension.
16. Log out. Confirm that credentials, socket state, account cache, and pending messages are cleared.

Use synthetic accounts and media. Do not use real student conversations or identity evidence in local testing.

## 12. Validation commands

Run these checks from the repository root after dependency or application changes.

### Source and dependency checks

```powershell
cd E:\IEM_Dating_App
npm audit
npm run build --workspace @iem-dating/api
npm run typecheck:mobile
npm run release:validate --workspace apps/mobile
cd apps\mobile
npx expo-doctor
cd ..\..
git diff --check
```

Expected current results:

- `npm audit`: zero findings
- API build: success
- Mobile TypeScript: success
- Mobile release configuration: success
- Expo Doctor: 21 of 21 checks
- `git diff --check`: no errors

### Android bundle check

```powershell
cd E:\IEM_Dating_App\apps\mobile
npx expo export --platform android --output-dir .codex-export
```

Delete `.codex-export` after inspection. Do not commit it.

Before a signed staging or production build, run the environment check with the intended public endpoint variables and EAS project ID:

```powershell
cd E:\IEM_Dating_App
npm run release:validate:environment --workspace apps/mobile
```

Follow [Phase 7 mobile release and device rehearsal](phase7-mobile-release-rehearsal.md) for signed builds, physical-device coverage, accessibility checks, and store records.

### Isolated complete API test suite

The following database is disposable. The tests replace its data. The commands are guarded for `127.0.0.1:55439/reco_test`.

```powershell
cd E:\IEM_Dating_App\apps\api
docker compose -f docker-compose.recommendation-test.yml up -d --wait

$env:NODE_ENV='test'
$env:DATABASE_URL='postgresql://postgres:local-reco-test@127.0.0.1:55439/reco_test'
$env:REDIS_URL='redis://127.0.0.1:56420'
$env:JWT_ACCESS_SECRET='test-access-secret-for-isolated-tests-only'
$env:JWT_REFRESH_SECRET='test-refresh-secret-for-isolated-tests-only'
$env:OTP_HMAC_SECRET='test-otp-hmac-secret-for-isolated-tests-only'
$env:JWT_ISSUER='iem-connect-api-test'
$env:JWT_AUDIENCE='iem-connect-mobile-test'

npx prisma migrate deploy --schema prisma/schema.prisma
npm run test:all
docker compose -f docker-compose.recommendation-test.yml stop
```

Expected current result: 95 tests pass.

| Suite | Expected tests |
|---|---:|
| HTTP flow | 4 |
| Algorithm | 27 |
| Discovery integration | 28 |
| Security integration | 19 |
| Outbox integration | 5 |

Always stop the isolated services after the test run.

## 13. Operations and maintenance

Run maintenance commands from `apps/api` with the intended environment loaded.

### Outbox status

```powershell
npm run outbox:status
```

Investigate old `pending` events, expired `processing` leases, repeated failures, and any `dead` event.

Retry one reviewed dead event:

```powershell
npm run outbox:retry -- <event-uuid>
```

The retry command accepts one UUID and only changes an event in the `dead` state.

### Discovery reports and maintenance

```powershell
npm run discovery:report
npm run discovery:maintenance
npm run discovery:reconcile-counters
npm run discovery:shadow-report
npm run discovery:evaluate-reciprocity
```

Run destructive or large maintenance commands only against an explicitly verified database. Review each script before production use.

Run the synthetic benchmark only against the guarded isolated database:

```powershell
npm run discovery:benchmark -- 100000
```

Do not use old benchmark results as current production evidence.

### Graceful shutdown

Stop the API with `Ctrl+C`. The process stops the impression loop, shadow connection, outbox worker, sockets, and Prisma connection.

Stop local services when they are no longer needed:

```powershell
cd E:\IEM_Dating_App
npm run services:down
```

This command removes the Compose containers and network. Named database and Redis volumes remain.

## 14. Staging and production handoff

Create a staging environment before production. Use separate databases, Redis instances, buckets, provider accounts, push projects, domains, and secrets.

Complete these steps in order:

1. Build from a reviewed commit.
2. Run `npm install` and confirm both patches.
3. Run all source, audit, Expo, bundle, and API tests.
4. Back up the target PostgreSQL database.
5. Rehearse restore with a separate database.
6. Apply migrations with `prisma migrate deploy`.
7. Verify migration status and required indexes.
8. Set secrets through the environment secret manager.
9. Configure separate public and private media buckets.
10. Configure real email, SMS, and push providers.
11. Start the API and check all dependencies.
12. Build a signed mobile binary with the correct public API and socket URLs.
13. Run the account, discovery, match, chat, media, block, report, deletion, and notification drills.
14. Run the complete cross-account authorization sweep.
15. Confirm support and moderation staffing.
16. Start a restricted campus rollout.
17. Monitor errors, queue age, login failures, media failures, reports, and discovery supply.

If an environment ever used a known or fallback JWT secret, follow [Authentication secret rotation](auth-secret-rotation.md). Rotate both JWT secrets, revoke all sessions, increment account session versions, restart every API instance, and confirm that old HTTP and socket credentials fail.

Do not copy development secrets, database URLs, buckets, or test transport settings into production.

## 15. Features that still need external or device evidence

The application can run locally without claiming that these areas are production-ready:

- Real SMS delivery needs MSG91 credentials and an approved template.
- Real email verification needs a configured SMTP provider.
- Remote push delivery has an Expo provider client. It still needs an EAS project ID, provider credentials when enhanced security is enabled, and terminated-app device tests.
- Profile, chat, and Story media have ownership checks and durable processing. Test the private object store, FFmpeg capacity, rejection behavior, and moderation evidence on staging before public use.
- Age assurance needs a stronger method than a birthday entry before public dating access.
- Content safety, scam controls, location anti-triangulation, and unwanted-media consent still require implementation.
- Moderation has case records, assignment, priority, decisions, and account actions. It still needs evidence storage, user notices, and appeals.
- Account export and delayed deletion run in the API worker. Test backup-restoration deletion records and large exports before release.
- Android and iOS need physical-device accessibility and safety tests.
- Production needs backup, restore, incident response, and provider-failure drills.

Keep this section current. Remove an item only after its code, negative tests, failure handling, device behavior, and operating procedure pass.

## 16. Troubleshooting

| Problem | Check and correction |
|---|---|
| API rejects startup secrets | Use four independent random secrets. Each required secret must contain at least 32 characters. |
| API cannot reach PostgreSQL | Run `docker compose ps`; check `DATABASE_URL`; confirm port `5432` is free. |
| Redis errors | Start Docker Desktop; run `docker compose exec redis redis-cli ping`. |
| Port 3000 is occupied | Identify the process with `Get-NetTCPConnection -LocalPort 3000`; stop only the known stale API process. |
| Port 8081 is occupied | One Metro process already runs. Keep one Metro instance. |
| Mobile API calls fail | Check both `EXPO_PUBLIC_*` variables. Restart Metro after changes. Confirm the URL includes `/api/v1` only for the API variable. |
| Socket connection fails | Check `EXPO_PUBLIC_SOCKET_URL`, API reachability, session validity, and Redis. |
| Physical phone cannot reach Metro | Put both devices on the same network or use `--tunnel`. |
| ADB reports `unauthorized` | Accept the debugging prompt on the phone. Reconnect the device. |
| ADB wireless connection fails | Use the current connection port, not the pairing port. Run `npm run connect` again. |
| Native module is missing | Stop Metro. Build and install the SDK 57 development client with `npx expo run:android`. |
| Patch installation fails | Confirm the exact dependency versions in `package-lock.json`. Do not skip the failed patch. Review and regenerate it for the new version. |
| Prisma engine file is locked | Stop the known workspace API process. Run `npx prisma generate` again. |
| Existing user receives setup-required state | Complete the required discovery-preference screen. Do not bulk-set `preferencesConfirmedAt`. |
| User cannot access dating routes | Check adult birthday, current student membership, account state, profile readiness, and explicit preference confirmation. |
| Messages remain pending | Run `npm run outbox:status`; inspect the event error and dependency health. |
| Media upload fails | Check bucket separation, credentials, region, content type, size, ownership, and ticket expiry. |

For interest normalization, backfill checkpoints, algorithm telemetry, and current benchmarks, follow [Algorithm improvement operations](algorithm-improvement-operations.md).

## 17. Update rules for this runbook

For the discovery index repair and its isolated verification command, follow [Discovery index repair](discovery-index-verification.md). The two added migrations use concurrent index creation. The verification command is `npm run discovery:verify-indexes` from `apps/api`.

Update this document in the same change when any of these items changes:

- Required environment variable
- Startup command
- Migration procedure
- Worker process model
- Native dependency or development-client requirement
- Test command or expected count
- Provider configuration
- Maintenance command
- Release gate
- Secret-rotation procedure

Commands in this runbook must match committed package scripts. Never document a future command as if it already exists.
