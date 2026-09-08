# Chat, Stories, and Explore implementation guide

Date: 2026-09-07

Use this document to review, run, test, and release the implemented package. The production deployment remains an owner action.

Local verification completed on 2026-09-08. All 95 API tests passed. API, API tools, and mobile TypeScript checks passed. The shared package build passed. All 35 migrations applied to the isolated PostgreSQL database. Prisma validated the schema.

## Product rules

- Dating likes create matches through the existing swipe service.
- An active match grants one-to-one chat access.
- A follow request does not grant chat access.
- A follow request immediately discloses the sender's profile and request to the recipient. The sender must confirm this disclosure before submission.
- An accepted follow grants access to active private Stories.
- A match does not create a follow.
- A Story reply requires an active match.
- Explore only returns profiles from the discovery eligibility service.
- Filtered Explore requires a complete eligible cohort of at least 10 profiles. It accepts at most two filter dimensions and does not return the exact cohort size.
- Blocks and unmatches revoke chat rooms and follow relationships.

## Implemented backend

The additive data model includes ordered chat messages, ordered chat events, chat participants, message receipts, per-user message visibility, reactions, follows, Stories, Story media, Story views, Story mute settings, safety evidence, Story consent, and push delivery state.

Chat commands use the active-match check. Message sends allocate `messageSeq` while holding a PostgreSQL advisory lock. Each durable mutation allocates `eventSeq` in the same transaction. The event replay endpoint filters private events by the authenticated user. It returns a high-water sequence and reports an expired replay cursor.

Message retries compare a SHA-256 command fingerprint. Reusing a client message ID with different content returns `IDEMPOTENCY_MISMATCH`. Edit and delete-for-everyone use a 15-minute window. Edit accepts an expected revision. Delete-for-me creates private visibility state and a private event. Reactions use a fixed emoji set. Read and delivery receipts accept at most 100 message IDs and are monotonic.

Chat and Story media use a private bucket. The server verifies the declared size, MIME type, and file signature. FFmpeg removes metadata and writes each approved asset to a new immutable object key. It limits images to 1920 pixels wide. It converts videos to H.264 and AAC MP4, limits them to 15 seconds and 1080 pixels wide, and creates private JPEG thumbnails. It converts voice messages to AAC M4A, limits them to 60 seconds, and creates a bounded 64-value waveform. It creates private JPEG thumbnails for images. The old upload URL only points to the temporary source key. Read grants use current authorization.

Follow requests require two active, adult, verified students in the same institution. The pair must be mutually eligible or have an active match. A pass prevents a new non-match follow request. The Story owner must enable Stories and follow requests. Decline and removal apply a 30-day request cooldown. Follow and follower lists are private.

Stories use a 24-hour expiry and a maximum of 20 active items per owner. Publication is idempotent. The feed checks accepted follows, blocks, Story mute state, expiry, and logical deletion. Views are idempotent. Only the owner can read a viewer list. Story reports store a restricted evidence snapshot. Story replies use the chat command and require an active match.

Explore calls the existing recommendation service. It preserves mutual category, age, mode, institution or distance, block, pass, match, exposure, and receipt rules. It adds temporary category and interest filters. It does not change saved discovery settings.

## Implemented mobile behavior

- The Search tab now opens Explore.
- Explore has For you, New here, Active, Shared interests, and My department categories.
- Explore has interest chips from the shared interest catalog.
- Each card supports Like, Pass, and a private follow request when the profile accepts requests.
- The Chats screen has conversation search and a private Story tray.
- Story creation supports a photo or a video, a 200-character caption, upload completion, and publication.
- Story viewing supports short-lived media grants, visible-view acknowledgement, reply, mute, report, owner viewer count, and owner deletion.
- The follow-request screen supports Accept and Delete.
- Chat reconnect reads durable events after the last applied event sequence.
- A replay gap triggers a fresh authorized message snapshot.
- Messages from another device on the same account are not discarded.
- Read receipts are sent for visible messages. Off-screen arrivals remain unread.
- Message reports call the safety API and store message evidence.
- Message options support replies, reactions, edits, delete-for-me, and delete-for-everyone.
- Voice uploads use the actual WAV or M4A container.
- Push taps and cold starts resolve `iemdating://chat/:matchId` and follow-request routes.
- The chat header reports the local connection state. It does not claim that the other person is online.

## Additional implementation completed on 2026-09-07

- The Story viewer groups items by author and plays each group from oldest to newest.
- It provides progress segments, long-press pause, background pause, accessible previous and next controls, close, bounded two-item prefetch, and explicit loading, expiry, access, error, and empty states.
- The owner viewer list is a bounded screen with cursor pagination.
- `ChatDeviceCursor` stores monotonic per-device and per-match replay progress. The API rejects cursors beyond the server high-water mark.
- `AccountEvent` provides monotonic conversation-update and access-revocation hints. The chat list reads these events after an offline period and refreshes its authorized snapshot.
- `DeliveryAttempt` records each push attempt by outbox event and destination device. Successful device deliveries are not sent again during an outbox retry.
- Match creation, chat mutations, unmatch, and block operations create account events in their database transaction.
- The Matches tab now lists active matches and opens their chats.
- Active sessions and Blocked accounts screens are available from Settings. A user can revoke a non-current session or unblock an account.
- Mobile message search supports one conversation and all active conversations. Selecting a result opens an authorized context around the message.
- Story feeds, owner viewer lists, and conversation lists now use bounded cursor pages. Story feed cursors retain the first-page high-water time.
- Private chat and Story uploads now pass through server-controlled media processing before publication.
- Processing writes normalized MIME types, detected types, private thumbnail keys, waveform data, and completion timestamps.
- Upload completion claims each asset with an atomic processing-state update. Completed retries return the prior result. Concurrent retries receive an in-progress response.
- Processing failures reject the media asset. The mobile client displays an explicit Story processing error.

## Remaining implementation work

The full product plan is not complete. Do not use this guide as evidence that all production exit gates passed.

### Master-plan phases 6 through 8

Phase 6 is partly complete. The repository contains a 100,000-user local synthetic benchmark with reciprocity enabled and disabled. It also contains a concurrent HTTP load runner and a ranking-readiness report. The readiness report checks telemetry sample size, reciprocity coverage and failures, discovery p95 latency, evaluation age, and shadow-report age. See `phase6-performance-operations.md`. Local results do not prove production throughput or recommendation quality.

The local Phase 7 package is implemented. The mobile app has stable Android and iOS identifiers, EAS build profiles, permission text, release validation scripts, and accessibility metadata for the primary Chat, Story, Explore, Match, and account controls. See `phase7-mobile-release-rehearsal.md`. Signed physical-device evidence, store records, provider credentials, and operational rehearsal require the staging and owner accounts.

Complete these remaining gates:

- Run the concurrent load test with production-size data and the target infrastructure.
- Collect enough live telemetry for the ranking-readiness report to pass the predeclared gates.
- Complete accessibility checks and signed Android and iOS physical-device tests.
- Test object storage, push delivery, background execution, slow networks, and multi-device recovery.
- Prepare store material and complete the operational rehearsal.
- Start Phase 8 only through the owner-controlled production rollout.

## API routes

Chat routes:

- `GET /api/v1/chat/conversations?q=&cursor=&limit=`
- `GET /api/v1/chat/account-events?afterSeq=&limit=`
- `GET /api/v1/chat/search?q=`
- `GET /api/v1/chat/:matchId/messages`
- `GET /api/v1/chat/:matchId/messages/:messageId/context`
- `GET /api/v1/chat/:matchId/events?afterSeq=`
- `PUT /api/v1/chat/:matchId/device-cursor`
- `GET /api/v1/chat/:matchId/search?q=`
- `POST /api/v1/chat/:matchId/messages`
- `PATCH /api/v1/chat/:matchId/read`
- `PATCH /api/v1/chat/:matchId/delivered`
- `PATCH /api/v1/chat/:matchId/mute`
- `PATCH /api/v1/chat/:matchId/messages/:messageId`
- `DELETE /api/v1/chat/:matchId/messages/:messageId`
- `PUT /api/v1/chat/:matchId/messages/:messageId/reaction`

Story and follow routes:

- `GET /api/v1/stories/feed?cursor=&limit=`
- `PUT /api/v1/stories/settings`
- `GET /api/v1/stories/follow-requests`
- `GET /api/v1/stories/followers`
- `GET /api/v1/stories/following`
- `POST /api/v1/stories/follows`
- `PATCH /api/v1/stories/follows/:followId`
- `DELETE /api/v1/stories/follows/:userId?direction=following|follower`
- `POST /api/v1/stories/media/upload-url?ext=`
- `POST /api/v1/stories/media/:assetId/complete`
- `POST /api/v1/stories`
- `GET /api/v1/stories/:storyId`
- `GET /api/v1/stories/:storyId/media`
- `POST /api/v1/stories/:storyId/views`
- `GET /api/v1/stories/:storyId/viewers?cursor=&limit=`
- `POST /api/v1/stories/:storyId/reply`
- `DELETE /api/v1/stories/:storyId`
- `PUT /api/v1/stories/authors/:authorId/mute`

Explore route:

- `GET /api/v1/search/explore?category=&interests=&cursor=&limit=`

Account session routes:

- `GET /api/v1/auth/sessions`
- `DELETE /api/v1/auth/sessions/:sessionId`
- `POST /api/v1/auth/logout-all`

## Required configuration

Set the existing authentication, database, Redis, email or SMS, and discovery variables from `apps/api/.env.example`. Also set these media variables:

```env
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET_NAME=...
AWS_PRIVATE_MEDIA_BUCKET=...
EXPO_PUSH_ENDPOINT=https://exp.host/--/api/v2/push/send
```

Keep the private bucket private. Permit the API role to put, read, copy, and delete objects under `chat-media/`, `chat-media-approved/`, `stories/`, and `stories-approved/`. Configure object lifecycle rules only after they agree with moderation evidence and account-deletion policy.

## Local validation

Start the isolated services:

```powershell
docker compose -f apps/api/docker-compose.recommendation-test.yml up -d --wait
```

Apply migrations only to the isolated database:

```powershell
$env:DATABASE_URL='postgresql://postgres:local-reco-test@127.0.0.1:55439/reco_test'
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Set isolated test variables. Then run all checks:

```powershell
$env:REDIS_URL='redis://127.0.0.1:56420'
$env:JWT_ACCESS_SECRET='local-test-access-secret-that-is-at-least-32-bytes'
$env:JWT_REFRESH_SECRET='local-test-refresh-secret-that-is-at-least-32-bytes'
$env:OTP_HMAC_SECRET='local-test-otp-hmac-secret-that-is-at-least-32-bytes'
$env:DISCOVERY_CURSOR_SECRET='local-test-discovery-cursor-secret-at-least-32-bytes'
npm run typecheck --workspace apps/api
npm run typecheck --workspace apps/mobile
npm run test:all --workspace apps/api
```

Stop the isolated services when validation is complete:

```powershell
docker compose -f apps/api/docker-compose.recommendation-test.yml down
```

## Scheduled maintenance

Run this command at least once each hour from one controlled worker:

```powershell
npm run chat-story:maintenance --workspace apps/api
```

The command marks expired Stories and removes stale upload objects and chat events older than 30 days. The replay API detects event-retention gaps and tells the mobile client to reload an authorized snapshot.

Continue to run the existing account-deletion, outbox, discovery, and media workers. Monitor dead outbox events, Story expiry backlog, upload rejection rate, event replay resets, chat send latency, push errors, and Explore latency.

## Production release procedure

1. Back up the production database.
2. Confirm that both S3 buckets and the API role have the required private-media permissions.
3. Rehearse every migration on a recent production-size backup.
4. Review query plans for message trigram search and Explore with production-size data.
5. Apply the additive migrations.
6. Deploy the API and outbox worker.
7. Start the hourly chat and Story maintenance command.
8. Build signed Android and iOS applications with the production API URL and deep-link settings.
9. Test two real accounts on two physical devices.
10. Test send, retry, reconnect, other-device send, edit, delete, reaction, visible read, mute, push tap, follow approval, block, unmatch, Story expiry, Story report, and Explore swipe.
11. Check screen-reader labels, denied media permission, low storage, background and foreground transitions, and slow networks.
12. Release to a small internal college group. Monitor the listed metrics before wider release.

Do not run the test database commands against production. Do not mark the release complete until signed-device, object-storage, push-provider, load, and migration-rehearsal checks pass in the target environment.
