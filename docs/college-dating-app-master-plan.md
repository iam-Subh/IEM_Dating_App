# IEM Connect: whole-app audit and implementation plan

**Audit date:** 5 September 2026  
**Workspace:** `E:/IEM_Dating_App`  
**Scope:** Product behavior, mobile app, API, data, security, moderation, operations, and release readiness.  
**Deliverable:** An implementation plan and workspace progress record. No production service is changed.

## 1. Current assessment

Planning addendum, 2026-09-07: [Chat, follower-based Stories, and Explore plan](chat-stories-search-plan.md) reviews the supplied chat architecture and specifies missing work. This is a design document, not a completion claim. The latest algorithm verification baseline is 83 tests; earlier package counts below are historical.

The app has a usable implementation base. Discovery has received much more testing than the other areas. The whole app is not yet ready for a public college launch.

Keep the discovery rebuild. Prioritize authorization, student verification, account lifecycle, media privacy, and reliable chat before adding more ranking features.

This assessment comes from source inspection. A feature file proves that code exists. It does not prove that the feature works on a phone or in production. Confirmed findings below identify source-level defects. Missing features mean that no complete implementation was found in the inspected routes, services, schema, or navigation.

The current workspace verification passes 4 HTTP flow tests, 21 algorithm tests, 22 discovery integration tests, 19 security integration tests, and 5 transactional-outbox tests. API compilation, mobile TypeScript validation, Expo Doctor, Android bundle export, all 25 database migrations, and the dependency audit also pass. Device tests and production operations remain under owner control.

### Planning assumptions

- Start with IEM and a controlled list of approved campuses. Add other institutions through configuration.
- Permit adults aged 18 or older. College enrollment is separate from adult eligibility.
- Use verified student membership as the trust basis for the college product.
- Start with Android and retain iOS-compatible code. Verify each platform before releasing it.
- Keep standard matching, messaging, blocking, reporting, and account deletion free.
- Keep production deployment under the app owner's control, as requested.
- Treat numerical defaults in this plan as proposed settings, not universal dating-app standards.

## 2. What already exists

| Area | Current implementation | Status and remaining boundary |
|---|---|---|
| Application structure | Expo/React Native mobile app; Express API; Prisma/PostgreSQL; Redis; Socket.IO; S3-related media code | Keep the modular structure. Environment and release configuration need work. |
| Authentication | Email/password registration and login; email and phone OTP routes; session records; access and refresh token creation | Partial. SMS is a stub. Email proof is not bound to registration. Refresh/revocation flows are incomplete. |
| Onboarding | Screens for name, birthday, gender, orientation, intent, college, academic details, interests, lifestyle, photos, and rules | UI exists. Completion and verification are not consistently enforced by the server. |
| Student verification | A hardcoded IEM email-format check and a general verified flag | Insufficient. This does not implement verified institutional membership. |
| Profiles | Read/update endpoints; photos; video; display preferences; academic and lifestyle data | Partial. Media ownership, field contracts, and atomic updates need correction. |
| Discovery | Mutual filters; signed cursors; stable decks; delivery receipts; visibility acknowledgement; temporary exposure claims | Implemented and locally tested. Add student-membership and profile-readiness rules before college launch. |
| Ranking | Seven compatibility factors; explicit missing evidence; seeded ties; configurable reservations; exposure adjustment | Implemented. Weights and allocation effects are not validated by live outcomes. |
| Reciprocity | Conditional outgoing-decision estimator; decision-time snapshots; chronological evaluator | Implemented. Live activation coverage and current worst-case deck latency are not measured. |
| Shadow comparison | Both variants rank the same captured candidates and feature values | Implemented and locally tested. It is a diagnostic comparison, not proof of causal lift. |
| Matching | Shared swipe transaction; first-decision idempotency; mutual-like match creation; duplicate-match prevention | Stronger than other domains. Complete unmatch and account-state handling. |
| Chat | Conversations; message pagination; Socket.IO sending; read state; typing; edits; deletion; local retry queue | Substantial code exists. Authorization and retry correctness are release blockers. |
| Media | Owned upload tickets; signed private reads; signature inspection; normalized processing; thumbnails; voice waveforms; durable profile video previews | Implemented locally. Private object-store integration and processing capacity require staging evidence. |
| Notifications | Database records; owned device tokens; Expo provider delivery; invalid-token removal; mobile registration | Provider code is complete. EAS configuration and physical-device tests remain. |
| Safety | Block/unblock routes; reports; admin report resolution; automatic hiding | Partial. Duplicate-report abuse and incomplete account enforcement need correction. |
| Settings | Account information, logout, and discovery preferences | Partial. Deletion, privacy settings, session management, and notification controls are missing. |
| Administration | Admin API guard, reports, metrics, algorithm configuration | Backend foundation. No complete moderator workbench was found in the inspected app surfaces. |
| Quality assurance | Real recommendation tests; older health/flow files | Uneven. The default test scripts run recommendation tests. The older flow test contains placeholder assertions. |
| Operations | Migrations, local test services, recommendation maintenance and evaluation scripts | Useful local tools. No complete deployment/CI/restore process was verified. |

## 3. Confirmed defects and correction tickets

**P0:** Fix before external users can use the affected feature.  
**P1:** Complete before a controlled college beta.  
**P2:** Improve after the safety and reliability gates pass.

| ID | Priority | Finding and effect | Required correction | Evidence |
|---|---|---|---|---|
| AUTH-01 | P0 | JWT signing has fallback secrets. Access tokens last 30 days. A missing environment secret can produce predictable signing configuration. | Fail startup without independent secrets. Validate issuer, audience, algorithm, and token type. Use short access-token lifetime and rotating refresh sessions. | [jwt.ts](E:/IEM_Dating_App/apps/api/src/utils/jwt.ts:3) |
| AUTH-02 | P0 | HTTP and socket authentication verify the token but do not consistently check current account state or revoked sessions. Admin role comes from the token. | Share an authorization service across both transports. Reject suspended/deleted/revoked accounts. Recheck current admin privileges for privileged actions. Disconnect revoked sockets. | [auth.middleware.ts](E:/IEM_Dating_App/apps/api/src/middlewares/auth.middleware.ts), [adminGuard.middleware.ts](E:/IEM_Dating_App/apps/api/src/middlewares/adminGuard.middleware.ts), [socket.ts](E:/IEM_Dating_App/apps/api/src/socket.ts) |
| AUTH-06 | P0 | Any environment that used a fallback JWT secret can have access tokens signed with a known value. Those tokens remain valid for the configured 30-day lifetime unless all sessions become invalid. | Replace and rotate both JWT secrets. Increment `sessionVersion` for every account. Revoke stored sessions and force all users to authenticate again. Record the rotation as a release action. | [jwt.ts](E:/IEM_Dating_App/apps/api/src/utils/jwt.ts:3) |
| AUTH-03 | P1 | OTP generation uses `Math.random`. Send checks and OTP consumption use separate Redis operations. Concurrent requests can bypass intended single-use behavior. | Use cryptographic randomness. Bind challenges to identifier, purpose, and challenge ID. Use atomic send reservation and verification/consumption. Store a keyed digest. | [otp.service.ts](E:/IEM_Dating_App/apps/api/src/services/otp.service.ts:16) |
| AUTH-04 | P0 | Email verification returns a success response but does not create server-side proof required by registration. Phone verification sets a general `isVerified` flag. | Consume a verified email challenge during registration/linking. Separate phone verification, student verification, and optional photo verification. | [auth.controller.ts](E:/IEM_Dating_App/apps/api/src/controllers/auth.controller.ts:50), [auth.service.ts](E:/IEM_Dating_App/apps/api/src/services/auth.service.ts:91) |
| AUTH-05 | P1 | SMS sends only a development log. Some logs contain phone numbers, JWT user data, message content, or the complete credential action payload. | Implement a provider adapter with real delivery errors. Restrict fake transport to explicit test mode. Redact credentials, OTPs, identifiers, and message bodies. | [sms.service.ts](E:/IEM_Dating_App/apps/api/src/services/sms.service.ts), [authSlice.ts](E:/IEM_Dating_App/apps/mobile/src/store/authSlice.ts), [offlineQueue.ts](E:/IEM_Dating_App/apps/mobile/src/services/offlineQueue.ts) |
| CHAT-01 | P0 | Manual socket room joins accept a supplied match ID without a membership check. Typing events also lack membership checks. | Authorize every room join and event. A room ID must never act as a secret capability. Evict participants after block/unmatch/suspension. | [socket.ts](E:/IEM_Dating_App/apps/api/src/socket.ts:72) |
| CHAT-02 | P0 | Message history and read-marking routes do not establish match membership. Delete-for-me can mutate a message by ID without checking membership. | Centralize match access checks. Require an authorized participant on every read and mutation. Bind message ID to the authorized match. | [chat.controller.ts](E:/IEM_Dating_App/apps/api/src/controllers/chat.controller.ts:20), [chat.service.ts](E:/IEM_Dating_App/apps/api/src/services/chat.service.ts:139) |
| MEDIA-01 | P0 | A supplied media key can receive a signed read URL without viewer authorization. Chat upload generation does not validate membership. Private storage can fall back to the profile bucket. | Resolve a media asset through its owner/message/match. Require access before signing. Fail closed if private storage is not configured. | [chat.controller.ts](E:/IEM_Dating_App/apps/api/src/controllers/chat.controller.ts:87), [chat-media.service.ts](E:/IEM_Dating_App/apps/api/src/services/chat-media.service.ts:39) |
| CHAT-03 | P1 | The retry queue has temporary IDs, but the server send contract does not use them as idempotency keys. A lost acknowledgement can create duplicate messages. | Send `clientMessageId`; add a uniqueness constraint; return the original message on an identical retry. | [offlineQueue.ts](E:/IEM_Dating_App/apps/mobile/src/services/offlineQueue.ts), [chat.service.ts](E:/IEM_Dating_App/apps/api/src/services/chat.service.ts) |
| CHAT-04 | P1 | Message creation and session update are separate writes. Session handling is find-then-create without a unique match constraint. The comment calls it an upsert, but it is not one. | Use one transaction and a unique conversation record per match. Persist an event for delivery in that transaction. | [chat.service.ts](E:/IEM_Dating_App/apps/api/src/services/chat.service.ts:277), [schema.prisma](E:/IEM_Dating_App/apps/api/prisma/schema.prisma) |
| CHAT-05 | P1 | Incremental sync is unbounded and uses only a timestamp. HTTP sends do not use the same broadcast/push path as socket sends. | Use a bounded `(sentAt,id)` cursor and one message command/event pipeline for both transports. | [chat.service.ts](E:/IEM_Dating_App/apps/api/src/services/chat.service.ts:139), [chat.controller.ts](E:/IEM_Dating_App/apps/api/src/controllers/chat.controller.ts), [socket.ts](E:/IEM_Dating_App/apps/api/src/socket.ts) |
| MATCH-01 | P1 | Match-list message previews do not filter deleted or viewer-hidden messages. The separate chat list does. | Share a safe preview query and access policy. Do not display content that the viewer deleted or hid. | [match.service.ts](E:/IEM_Dating_App/apps/api/src/services/match.service.ts) |
| SAFE-01 | P0 | Automatic hiding counts report rows. The service does not deduplicate reports by reporter and incident. Repeated reports can drive the threshold. | Deduplicate, rate-limit, and preserve evidence. Use distinct reporters and severity for review triage. Do not treat a raw count as a permanent verdict. | [safety.service.ts](E:/IEM_Dating_App/apps/api/src/services/safety.service.ts:5) |
| SAFE-02 | P0 | Resolved. `accountStatus` controls access and moderation. `lastActiveAt` records recent activity. Restrictions revoke sessions and sockets. | Verify moderator actions and account restoration on staging. | [safety.service.ts](E:/IEM_Dating_App/apps/api/src/services/safety.service.ts), [access-session.service.ts](E:/IEM_Dating_App/apps/api/src/services/access-session.service.ts) |
| COLLEGE-01 | P1 | College is editable free text. Eligibility checks it but does not require verified enrollment. | Add an institution registry and verified membership records. Derive college eligibility from that record, not profile text. | [eligibility.service.ts](E:/IEM_Dating_App/apps/api/src/services/eligibility.service.ts), [profile.schema.ts](E:/IEM_Dating_App/apps/api/src/schemas/profile.schema.ts) |
| PROFILE-01 | P1 | Photo replacement deletes old records before the replacement and profile update succeed. | Update profile and photo references transactionally. Preserve old media until the new state commits. | [profile.service.ts](E:/IEM_Dating_App/apps/api/src/services/profile.service.ts) |
| PROFILE-02 | P1 | `degree` passes schema validation but is absent from the service allowlist. Preferences accept arbitrary JSON. Parsed Zod results are discarded. | Define one typed input contract. Assign parsed values to the validated request. Replace arbitrary preference JSON with bounded nested schemas. | [profile.schema.ts](E:/IEM_Dating_App/apps/api/src/schemas/profile.schema.ts), [profile.service.ts](E:/IEM_Dating_App/apps/api/src/services/profile.service.ts), [validate.middleware.ts](E:/IEM_Dating_App/apps/api/src/middlewares/validate.middleware.ts:8) |
| PROFILE-03 | P1 | Resolved. The API derives age from birthday. `yearOfStudy` and `graduationYear` now have separate contracts and storage columns. | Verify migrated graduation years in staging before rollout. | [schema.prisma](E:/IEM_Dating_App/apps/api/prisma/schema.prisma), [profile.schema.ts](E:/IEM_Dating_App/apps/api/src/schemas/profile.schema.ts) |
| ONBOARD-01 | P0 | Discovery requires `preferencesConfirmedAt`, but the normal onboarding flow does not collect discovery preferences. The only current caller is the settings panel inside discovery. After the new gate is deployed, every existing user without the timestamp is hidden and receives an empty deck. | Make discovery preferences a required onboarding step. Return `nextRequiredStep: discoveryPreferences` before discovery. Route existing users to that step. Set the timestamp only after the user explicitly confirms valid preferences. | [DiscoverySettings.tsx](E:/IEM_Dating_App/apps/mobile/src/features/discovery/components/DiscoverySettings.tsx), [eligibility.service.ts](E:/IEM_Dating_App/apps/api/src/services/eligibility.service.ts) |
| MEDIA-02 | P1 | Signed upload URLs are cached by user without matching the requested file list. A changed request can receive unrelated upload URLs. | Use a request-specific upload session/idempotency key or remove this cache. Validate count, type, size, and asset ownership. | [upload.controller.ts](E:/IEM_Dating_App/apps/api/src/controllers/upload.controller.ts:56) |
| MEDIA-03 | P1 | Resolved. Profile attachment creates a durable asset-ID job. The worker derives the source key from the ownership record, stores processing state, and writes an owner-scoped preview. | Test FFmpeg and object storage with production-equivalent media in staging. | [videoPreview.service.ts](E:/IEM_Dating_App/apps/api/src/services/videoPreview.service.ts), [profile.service.ts](E:/IEM_Dating_App/apps/api/src/services/profile.service.ts) |
| PUSH-01 | P1 | Resolved in code. The provider client sends Expo messages, removes invalid tokens, and uses the `iemdating` link scheme. | Configure the EAS project and test background and terminated delivery on devices. | [push.service.ts](E:/IEM_Dating_App/apps/api/src/services/push.service.ts), [notifications.ts](E:/IEM_Dating_App/apps/mobile/src/services/notifications.ts) |
| MOBILE-01 | P1 | Auth state, including its token, is persisted through AsyncStorage. Logout only clears the auth reducer. The offline queue uses one shared storage key. | Store credentials in secure platform storage. Scope private caches by account. Revoke sessions and clear queues, media, sockets, and memory on logout/account switch. | [store/index.ts](E:/IEM_Dating_App/apps/mobile/src/store/index.ts), [authSlice.ts](E:/IEM_Dating_App/apps/mobile/src/store/authSlice.ts), [offlineQueue.ts](E:/IEM_Dating_App/apps/mobile/src/services/offlineQueue.ts) |
| MOBILE-02 | P1 | The API base URL is a development tunnel. Onboarding completion relies partly on local department/year checks or a local completion action. | Use environment-specific configuration and server-owned onboarding status. Gate protected navigation after session restoration. | [api.ts](E:/IEM_Dating_App/apps/mobile/src/services/api.ts), [authSlice.ts](E:/IEM_Dating_App/apps/mobile/src/store/authSlice.ts) |
| TRUST-01 | P1 | The face-check screen describes required biometric verification, but its action navigates to photo upload and permits local completion. No matching verification backend was found. | Remove the unsupported claim. Implement a real, separately reviewed photo-verification workflow before offering that badge. | [FaceVerificationInfoScreen.tsx](E:/IEM_Dating_App/apps/mobile/src/features/auth/screens/FaceVerificationInfoScreen.tsx:197) |
| RECO-01 | P1 | Reciprocity coverage in live ranking and current maximum-size deck latency remain unmeasured. | Instrument coverage and rejection reasons. Benchmark model-enabled deck generation. `targetSignals` is now set in the swipe insert. | [reciprocity.service.ts](E:/IEM_Dating_App/apps/api/src/services/reciprocity.service.ts), [swipe.service.ts](E:/IEM_Dating_App/apps/api/src/services/swipe.service.ts) |
| QA-01 | P1 | Default tests cover discovery. Older app-flow tests contain `expect(true).toBe(true)` placeholders. | Replace placeholders with isolated, executable account/chat/safety/media scenarios. Run all suites in CI. | [flow.test.ts](E:/IEM_Dating_App/apps/api/tests/flow.test.ts), [API package.json](E:/IEM_Dating_App/apps/api/package.json) |

The media finding concerns authorization over configured bucket objects. The inspected preview code downloads through S3; this audit does not claim that it fetches arbitrary external hosts.

### Implementation progress: 6 September 2026

| Package | Implemented in the workspace | Remaining boundary |
|---|---|---|
| Existing-user discovery setup | The API returns `nextRequiredStep`; the mobile root sends eligible returning users with no confirmation timestamp to a required preference screen; valid submission returns and stores the timestamp. | Verify the complete onboarding sequence on physical devices. Do not bulk-backfill confirmation. |
| JWT and sessions | Startup rejects missing, weak, placeholder, or shared secrets. Tokens use HS256 with issuer, audience, type, session ID, and `sessionVersion`. Access tokens last 15 minutes. Refresh tokens rotate atomically. Reuse revokes the token family. Logout, logout-all, session listing, and purpose-bound password recovery are implemented. The mobile app stores the refresh token in platform secure storage and serializes refresh requests. | Run the production rotation procedure only under owner control. Add verified identifier-change commands. See [authentication secret rotation](E:/IEM_Dating_App/docs/auth-secret-rotation.md). |
| OTP and student membership | OTP codes use cryptographic randomness, keyed digests, atomic Redis issue/consume scripts, challenge IDs, purpose binding, and single-use proof tokens. The API has an institution registry and verified membership record. The mobile app requires membership before profile onboarding. College mode uses the verified institution ID. Phone verification no longer grants the general badge. | Configure and test the real SMS and email providers. Define manual review and graduation rules before beta. |
| Adult dating gate | Discovery, swipe, match, profile-media upload, chat HTTP routes, and chat sockets require an adult birthday and a current verified student membership. | Test renewal and expiry behavior on a physical device. |
| Profile contract | Validated Zod output replaces the raw request. College is not client editable. Preference fields and arrays have limits. Age derives from birthday. `graduationYear` and `yearOfStudy` are separate. Profile assets have owner records. Video preview work uses the transactional outbox. | Add file-signature inspection and moderation scanning. |
| Chat authorization and delivery | One access service protects history, send, read, edit, delete, upload, room join, typing, and socket operations. Client message IDs prevent duplicate writes. Incremental sync uses a bounded `(sentAt,id)` cursor. Message and match events use a transactional outbox. The worker sends socket and Expo push events. | Test two-device reconnect and terminated-app push behavior on physical devices. |
| Private chat media | The private bucket does not fall back to the public bucket. Each upload ticket has an owner, match, expected content type, size limit, and expiry. The API checks the stored object before it permits attachment. A read key must belong to an attached asset and a visible message in an active authorized match. | Add file-signature inspection, malware scanning, derivative generation, and cleanup jobs. |
| Account lifecycle and moderation | `accountStatus` separates activity from access state. Reports create moderation cases with priority, assignment, resolution, and account actions. Export requests exclude credentials and expire after seven days. Deletion has a 30-day cancellation period, deletes owned media, and erases profile data. The mobile settings screen exposes export and deletion controls. | Add moderation evidence storage, notices, appeals, and backup-restoration drills. |
| Security gate | A guarded integration suite uses only `localhost:55439/reco_test`. It checks cross-account chat routes, private media, socket join/send/read, session revocation, stale session versions, inactive accounts, JWT configuration, and existing-user preference confirmation. | Extend the table-driven sweep to every authenticated route, identifier, role, and socket event before beta. |
| Dependency and mobile runtime upgrade | The mobile app uses Expo SDK 57, React Native 0.86.3, React 19.2.3, current SDK-compatible Expo modules, Metro 0.84.6, and React Navigation 7. Deprecated `expo-av` use is replaced by `expo-audio` and `expo-video`. API direct dependencies and `tsx` are current. A version-specific React Navigation import patch permits the fixed `query-string` 9.5.1 package. Expo Doctor passes 21 of 21 checks. Android export succeeds. `npm audit` reports zero findings. | Keep both `patch-package` files when dependencies are installed. Review or remove each patch when its target package version changes. Create a new native development build before device testing because the Expo SDK and native modules changed. |

## 4. Intended college dating experience

The main journey should be:

1. Confirm adult eligibility and accept current terms and privacy information.
2. Verify a login method.
3. Verify membership of an approved college.
4. Complete the minimum public profile and upload approved photos.
5. Explicitly confirm discovery preferences and visibility choices.
6. Browse eligible profiles and choose like or pass.
7. Open a conversation only after a mutual like.
8. Use clear message delivery states and optional media controls.
9. Access block, report, unmatch, pause, and deletion from predictable locations.

Use the college context to help students meet. Do not expose room numbers, class timetables, precise GPS, student IDs, email addresses, or private verification evidence. Do not infer orientation from gender or targeting choices. Do not rank students by academic prestige or display public popularity scores.

Recommended initial profile requirement: name, adult birthday, approved college membership, intent, at least two approved photos, and three interests. Make biography, clubs, lifestyle, and personality details optional. Provide an accessibility/manual review path for people who cannot complete an optional selfie check.

Recommend separate controls for displayed gender, orientation, study details, online status, distance band, and message previews. College membership can remain an eligibility requirement without revealing department or year publicly.

## 5. Architecture and data contracts

Keep one modular API initially. The current scale does not justify splitting every domain into a separate service.

| Component | Responsibility |
|---|---|
| Mobile app | Navigation, input, accessible UI, secure credentials, account-scoped cache, retry state |
| API | Authentication, authorization, validated commands, domain transactions, public response allowlists |
| PostgreSQL | Authoritative accounts, membership, matches, messages, reports, media ownership, consent, event outbox |
| Redis | Rate limits, short-lived challenges, discovery decks, exposure claims, socket coordination |
| Background worker | Push delivery, media processing, deletion, exports, moderation jobs, retention |
| Private object storage | Chat media and verification evidence, separated by access policy |
| Profile media delivery | Only approved profile assets; revocable origin access and cache invalidation |
| Moderator web interface | Restricted cases, evidence, actions, appeals, and audit records |

A transactional outbox is a database table of events written in the same transaction as the user action. A worker sends each event and records completion. Use it for message delivery, match notifications, moderation actions, and deletion tasks. Retry events by ID so delivery cannot create duplicate application records.

### Proposed schema additions

| Entity/change | Fields and constraints |
|---|---|
| Account state | Separate `accountStatus`, `discoveryVisibility`, `onboardingStatus`, and `sessionVersion` |
| College and campus | Stable IDs, display names, approved email domains, active status, aliases |
| College membership | User/college/campus, verification method, status, verified/expiry dates, evidence reference; enforce one active primary membership |
| Verification challenge | Identifier digest, purpose, expiry, attempts, consumed state, provider reference |
| Session | Refresh-token digest, family ID, device label, expiry, revocation, last use; unique token ID |
| Media asset | Owner, purpose, storage key, bytes, detected MIME, moderation state, processing state, retention state |
| Message | `clientMessageId`, stable order key, delivery metadata; unique `(senderId, clientMessageId)` |
| Conversation | One row per match; participant-specific read cursors and mute settings |
| Moderation case | Reporter, target, incident references, severity, evidence, assignee, decision, appeal, audit trail |
| Consent record | User, document version, purpose, accepted/withdrawn time |
| Deletion/export request | User, authenticated request, state, retry details, completion time |
| Outbox event | Event ID, type, aggregate ID, payload version, attempts, due time, completion |

Use `birthday` as the source of age. Prefer `studyYear` and `graduationYear` over the overloaded `year`. Store academic text as catalog IDs where appropriate. Keep original display labels separate from comparison values.

Review the existing `relationMode = "prisma"`. It does not provide the same database foreign-key enforcement as PostgreSQL constraints, especially for raw SQL. Inventory orphans first. Add explicit constraints or retain documented transaction checks where a database constraint is unsuitable. Do not switch modes blindly on a live database.

## 6. Sector-by-sector implementation

### 6.1 Accounts, authentication, and recovery

**Keep:** password hashing, existing login screens, challenge routes, and session-table foundation.

**Implement in order:**

1. Require valid security configuration at startup. Remove fallback signing secrets.
2. Define one session service. Suggested access lifetime is 15 minutes; refresh lifetime is 30 days. Make both settings explicit and consistent with database expiry.
3. Rotate refresh tokens atomically. Detect reuse and revoke the affected token family.
4. Implement logout, logout-all, session listing, password reset, and verified identifier changes.
5. Bind OTP verification to the exact action. A login challenge must not authorize an email change or registration with another address.
6. Use atomic challenge issuance and consumption. Add limits per identifier, IP, account, and provider spend.
7. Make HTTP and Socket.IO authorization check account status and session validity. Minimize access-token claims.
8. Remove sensitive logs and return consistent public errors. Do not expose whether an identifier exists through unnecessary response differences.
9. Before any release from an environment that could have used fallback JWT secrets, rotate both secrets, increment every account's `sessionVersion`, revoke all stored sessions, and force re-login.

**Done when:** expired/reused/revoked credentials fail; duplicate OTP verification succeeds at most once; a banned account cannot send through an existing socket; a user can recover an account without changing ownership silently; the secret-rotation drill invalidates all tokens and active sockets issued before rotation.

### 6.2 Adult eligibility and student membership

**Keep:** birthday-based adult discovery checks and explicit preference confirmation.

**Implement:**

1. Add the college/domain registry. A domain match is an input to verification, not proof by itself.
2. Confirm an institutional email and bind the proof to the authenticated account and institution.
3. Provide a private manual-review route for supported students without usable institutional email. Define reviewer permissions and evidence deletion before enabling it.
4. Track membership separately from phone and photo verification. Replace the ambiguous verified badge with a precise label.
5. Make membership changes invalidate discovery eligibility. Reverify expired membership using a configurable policy; propose annual review or institutional expiry.
6. Gate all dating functionality with adult eligibility. Discovery-only checks do not protect chat, uploads, or other endpoints.
7. Define the graduation rule. Proposed default: freeze new discovery after membership expiry until reverified. Do not silently convert graduates to unrestricted users.

**Done when:** a phone-verified non-student cannot self-select a college and enter discovery; a valid verified student can recover and renew membership; an underage account cannot bypass the gate through an API request.

### 6.3 Onboarding and profile editing

Use a server response such as `nextRequiredStep` and `profileReadiness`. Preserve drafts across restarts. Avoid inferring completion from department and year.

Make `discoveryPreferences` a required server-owned step. Run it before the first discovery request. Existing users with `preferencesConfirmedAt = null` must see this step instead of an unexplained empty deck. The step must use the same validated command as later preference edits. Set `preferencesConfirmedAt` only when the user submits the form. Do not backfill the timestamp from gender, orientation, college, or old preference data.

Make required and optional steps clear. Explain why each required field is needed. Keep targeting separate from public identity. Do not require disclosure of orientation, height, residence status, astrology, or private social accounts.

Create shared input/output contracts for onboarding and editing. Store validated parsed values. Use bounded lists and explicit enums or normalized catalog values. Apply patch semantics to nested preferences so editing one lifestyle value does not erase the rest. Add optimistic version checks for concurrent edits.

Update photo references and profile state in one transaction. Use owned asset IDs. If all photos are removed, clear the avatar and update readiness. Never leave a deleted primary photo as the avatar. Derive age in every response, including match lists.

**Done when:** force-closing at each step resumes correctly; incomplete users cannot bypass server gates; every editable field persists; failed photo replacement preserves the prior profile; edits from two devices cannot silently overwrite unrelated values.

### 6.4 Photos, video, and optional photo verification

Implement a staged asset lifecycle: `requested → uploaded → inspected → approved/rejected → attached → retired`.

An upload request must specify purpose, detected/expected type, size, and checksum. The server assigns the key and owner. After upload, inspect the actual file, strip metadata where applicable, create derivatives, and moderate before publication. A claimed MIME type alone is insufficient.

Use separate access policies for public-facing profile media, private chat media, and verification evidence. Require ownership when attaching an asset. Require current match access when issuing private read URLs. Use short expiry and recognize that an already issued URL remains usable until expiry unless the object/access policy is revoked.

Move video processing to a worker. Set CPU, duration, size, concurrency, retry, and temporary-file limits. Record processing failure instead of returning a success state that never completes. Clean up abandoned uploads and retired assets.

Remove the biometric claim until a real verification system exists. If added, define its purpose, consent, evidence lifetime, human appeal, and precise badge meaning. A selfie match does not prove age, college membership, or that a person is safe.

**Done when:** an unrelated account cannot read, replace, attach, or process another user's asset; malformed files fail safely; worker retries do not create duplicate assets; removal propagates through profile references and caches.

### 6.5 Discovery and recommendation

Keep mutual category/age/location constraints, blocks, prior decisions, stable decks, signed cursors, transactional swipes, explicit compatibility evidence, incoming-like reservations, exposure controls, and identical-input shadow ranking.

Add verified membership, approved account state, profile readiness, and discovery pause to every eligibility path. Keep the SQL and TypeScript mirrors aligned. A ranking flag must not bypass these requirements.

Complete the remaining measured-quality work:

1. Store `targetSignals` in the swipe create operation. Preserve the same transaction and retry semantics.
2. Record reciprocity candidates considered, estimates available, below-history threshold, below-similarity threshold, missing inputs, query failures, and latency. Distinguish all-candidate coverage from coverage among candidates without an observed incoming like.
3. Report coverage by campus and account-age cohort only where groups are large enough to avoid identifying individuals. Do not lower evidence thresholds just to increase the activation percentage.
4. Benchmark the current code at candidate budgets 40, 400, and 800. Include model on/off, cold/warm database, sparse/dense campuses, heavy swipe histories, concurrent requests, and Redis latency.
5. Separate retrieval latency, model latency, ranking CPU, reservation latency, receipt writes, and total response latency. The historical 164 ms p95 is not a current model-enabled deck benchmark.
6. Add shadow metrics for top-20 overlap, rank movement, evidence coverage, incoming-like placement, and comparable-score distribution. Do not treat different compatibility distributions as proof of better dates.
7. Measure temporary capacity waits. The current cursor stops before a reserved card; this can delay cards behind it. First measure how often it occurs. If material, implement an explicit deferred-card queue with stable retry semantics, rather than silently skipping cards.

Use qualified two-way conversations as an initial outcome. Define it precisely, such as both participants sending a non-deleted message within seven days of matching. Pair it with reports, blocks, unwanted contact, and exposure concentration. Do not maximize swipe volume alone.

**Done when:** all hard-filter regression tests pass; coverage and failure dashboards exist; current benchmark results include reciprocity; no throughput claim uses the old benchmark; experimental reports identify policy/configuration versions and sample coverage.

### 6.6 Likes, matches, and unmatch

Keep one authoritative swipe command. Add a participant-authorized unmatch command with an idempotency key. Store who initiated it and when, but do not reveal a private reason to the other participant.

Define state transitions explicitly: active match to unmatched or blocked; account suspension can disable access without inventing a new match. Unblocking should not restore an old conversation automatically. A report must remain available after unmatch.

Commit the match transition and outbox event together. Stop message sends, remove socket access, and invalidate private media access through one shared policy. Recheck current eligibility before creating a match. Do not call an incoming like an unconditional future guarantee.

**Done when:** simultaneous like/unmatch/block operations produce a defined result; retries do not duplicate notifications; a blocked user cannot continue through a socket opened earlier.

### 6.7 Messaging and offline behavior

Implement `assertMatchAccess(actorId, matchId, action)` first. Use it for history, sync, read state, typing, joining, sending, editing, deleting, and media. Authentication alone is not authorization.

Then implement a single message command used by HTTP and Socket.IO:

1. Validate account and match access.
2. Validate content and owned/approved media.
3. Accept a stable client message ID.
4. Insert the message, update conversation state, and insert delivery events in one transaction.
5. Return the existing message for an identical retry. Reject conflicting reuse of the ID.
6. Deliver socket/push events through retryable workers.

Use a deterministic `(sentAt,id)` cursor or conversation sequence. Bound incremental sync. Define how edit/deletion events sync after an offline period. Store participant read cursors rather than inferring all delivery state from one global unread count.

Show pending, sent, failed, and read states without claiming delivery before acknowledgement. Partition the offline queue by authenticated user and match. Serialize local queue writes. Clear or securely retain it according to the logout policy; never replay one account's pending message as another account.

For initial launch, allow text and approved photos. Do not add calls, disappearing media, or read-receipt monetization until basic delivery and safety work correctly.

**Done when:** acknowledgement loss cannot duplicate a message; unauthorized users cannot read or mark another conversation; block/unmatch races reject later sends; reconnect recovers a bounded, ordered history; deleted content stays hidden in every preview.

### 6.8 Blocking, reports, and moderation

Place block and report controls on discovery profiles, match profiles, and chat. Do not require a match to report a displayed profile. Preserve the option after unmatch.

Bind reports to a profile/message/media reference and capture protected evidence. Prevent self-reporting and validate any supplied match reference. Deduplicate retries and repeated reports for the same incident. A reporter's immediate block must not depend on a moderator deciding the case.

Replace the raw three-report rule with severity-aware triage and reviewable temporary restrictions. Track distinct reporters, repeated abuse, case status, and reviewer decisions. Preserve rapid containment for credible severe reports. Provide an appeal route and an audit trail.

Build a restricted moderator interface. Include case queue, evidence access, assignment, action, notice, appeal, and history. Require strong admin authentication and current role checks. Record evidence access. Proposed operating target: urgent cases receive immediate alerts; ordinary cases receive review within one staffed day. Do not promise this publicly until staffing supports it.

**Done when:** one user cannot hide another by submitting three duplicate reports; banned users lose API/socket access; moderators cannot browse evidence without authorization; each decision has a reason and audit record.

### 6.9 Notifications

Use the outbox for match, message, and safety notices. Implement actual provider calls and delivery-result handling. Remove invalid device tokens. Deduplicate by event and destination. Do not log “dispatched” when only a payload was constructed.

Default lock-screen message content to a private preview such as “New message.” Let users opt into text previews. Add per-conversation mute and global categories. Avoid repeated engagement reminders when someone pauses discovery.

Use one URI scheme and a typed link resolver. Validate authentication and match access again after opening a notification. Test foreground, background, terminated app, logged-out app, deleted match, and revoked session cases.

**Done when:** a real test device receives exactly one notification for a committed event; rejected provider tokens are removed; muted conversations stay quiet; stale links fail safely.

### 6.10 Privacy, settings, and account lifecycle

Add settings for pause, public-field visibility, location removal, notification previews, blocked accounts, active sessions, support, privacy information, data export, and deletion.

Keep pause separate from suspension. Suggested behavior: paused users do not enter new discovery, but can access existing matches. Define how pending likes behave and state it in the UI.

Implement deletion as an authenticated, retryable workflow. Immediately revoke sessions and stop discovery. Then remove or anonymize relevant profile, media, token, cache, model-input, receipt, and analytics data. Preserve narrowly scoped moderation evidence only under a documented retention basis. Reapply deletion records after backup restoration. Do not claim all data is erased while shared media or backups still require scheduled processing.

Use secure platform storage for credentials. Expo SecureStore provides platform-backed protected key-value storage; handle platform-specific uninstall/backup behavior and invalidated credentials. Do not use it as an unrestricted message database. [Expo SecureStore documentation](https://docs.expo.dev/versions/latest/sdk/securestore/).

Apple requires in-app account deletion for apps that support account creation. Its guidance distinguishes deletion from temporary deactivation. [Apple account-deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

Google Play requires an account-deletion route in the app and an external web resource for qualifying account-creation apps. Plan both, including accessible request status and published retention exceptions. [Google Play deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).

**Done when:** an account switch reveals none of the previous account's private data; deletion revokes access immediately and completes across the asset inventory; export requires reauthentication and expires securely.

### 6.11 Mobile usability and accessibility

Retain the visual system where it works. Standardize reusable input, loading, empty, offline, error, and permission-denied components. Resolve parallel implementations of the same profile field or discovery state.

Provide buttons as alternatives to swipe gestures. Label controls for screen readers. Support large text, sufficient contrast, reduced motion, keyboard avoidance, and accessible focus. Test on a smaller Android device and at least one iPhone before their respective releases.

Explain unavailable compatibility, unverified membership, missing profile requirements, location denial, and capacity waiting without showing implementation terms. Let users choose same-college discovery without location permission.

**Done when:** a user can complete onboarding, like/pass, report, and message without relying on gesture precision, sound, or color alone.

### 6.12 College launch and monetization

Launch one verified campus cohort first. Monitor eligible supply and setup completion. If supply is too small, explain it and let users revise valid preferences. Never fill the deck with fabricated profiles or silently relax mutual filters.

Offer nearby approved colleges only through explicit selection and policy. Do not imply institutional endorsement without an agreement. Avoid public class rankings, attendance surveillance, campus gossip, or anonymous posting as launch features.

Keep billing outside the first safety-focused release unless it is a firm business requirement. If introduced, implement server-validated purchases, entitlements, renewal/cancellation/refund events, restore purchases, and clear pricing before showing a functional premium offer. Do not charge for safety controls or secretly change eligibility for paid users.

**Done when:** the owner can explain who is eligible, what verification proves, what is free, and how users leave the service.

### 6.13 Infrastructure and operations

Replace hardcoded tunnel endpoints with validated development, staging, and production configuration. Use separate credentials, buckets, databases, push projects, and telemetry destinations. Fail startup on missing required configuration.

Add liveness and dependency-aware readiness endpoints. Drain HTTP/socket traffic before disconnecting the database. Close Redis adapters and workers during shutdown. Remove obsolete comments about buffered impressions now that visibility writes are transactional.

Add structured request IDs, error tracking, latency histograms, queue depth, worker retries, storage growth, rate-limit events, and external-provider failures. Redact sensitive values. Give each metric an owner and a response action.

Establish backup/restore and migration rehearsal. Check index validity after interrupted concurrent migrations. Test PostgreSQL, Redis, object-store, SMS, and push failures. Use bounded retries and spend limits. A healthy HTTP process alone does not prove that login, chat, or media work.

**Done when:** a clean environment can build and migrate reproducibly; a backup restoration drill succeeds; alerts identify a broken dependency; stopping the API does not lose committed message events.

## 7. Implementation sequence and dependencies

Do not begin with another full algorithm rewrite.

| Phase | Work package | Main dependencies | Exit gate |
|---|---|---|---|
| 0 | Establish test database, fixtures, secret/configuration checks, a cross-account security harness, and a defect backlog | Current workspace | Reproducible isolated tests; no test touches production; account A cannot read or mutate account B data through any route or socket event |
| 1 | AUTH-01/02/06, CHAT-01/02, MEDIA-01, SAFE-01/02, ONBOARD-01 | Phase 0 | Cross-account access tests pass; suspension works on live sockets; secret rotation invalidates old sessions; incomplete existing users reach preference confirmation instead of an empty deck |
| 2 | OTP/provider integration, student registry, verification proof, server onboarding, truthful badges | Phase 1 | A genuine adult student completes setup; forged or unverified membership fails |
| 3 | Typed profile contract, transactional photo updates, asset ownership, media worker | Phase 2 | Approved profile is consistent across restart, edit, and discovery |
| 4 | Message idempotency, conversation uniqueness, outbox, bounded sync, unmatch, block races | Phase 1; assets from Phase 3 | Two-device message and safety lifecycle passes |
| 5 | Moderator interface, appeals, notification delivery, session/settings/deletion/export | Phases 1–4 | Safety and account-lifecycle drills pass |
| 6 | Reciprocity instrumentation, single-write snapshot, current load tests, reservation/shadow dashboards | Stable account and messaging outcomes | Current metrics and benchmark artifacts; no stale performance claims |
| 7 | Accessibility, real-device testing, store materials, operational rehearsal | Phases 1–6 | All release blockers closed with evidence |
| 8 | Owner-controlled staged production rollout | Phase 7 | Review live errors, safety response, data handling, and outcomes before expansion |

Backend, mobile, moderation operations, and QA are responsibilities, not necessarily separate employees. With one developer, execute the dependencies in this order. Do not assign a completion date until the first security and chat packages establish actual effort. Feature count is not a reliable effort estimate.

## 8. Concrete API and workflow backlog

Preserve the working routes where possible. New names below are proposed contracts.

| Workflow | Proposed commands | Important rule |
|---|---|---|
| Sessions | `POST /auth/refresh`, `/auth/logout`, `/auth/logout-all`; `GET /auth/sessions` | Rotation and revocation are authoritative on the server |
| Recovery | `POST /auth/recovery/start`, `/auth/recovery/complete` | Proof is purpose-bound and single-use |
| Membership | `GET /colleges`; `POST /membership/challenges`; `POST /membership/confirm` | Confirmation derives membership from a verified challenge |
| Onboarding | `GET /profile/readiness`; `POST /profile/complete` | Completion checks current server state |
| Media | `POST /media/uploads`; `POST /media/:id/complete`; `GET /media/:id/access` | Asset ownership and purpose determine authorization |
| Messaging | Existing send route plus `clientMessageId`; bounded history/sync cursor | HTTP and socket use one command service |
| Unmatch | `POST /match/:id/unmatch` | Idempotent state transition and access revocation |
| Privacy | `PATCH /settings/privacy`; `POST /account/export`; `DELETE /account` | Reauthenticate sensitive actions and track job completion |
| Moderation | Case queue, case action, evidence access, appeal commands | Current role, scoped access, immutable action history |

Use consistent error codes such as `SESSION_REVOKED`, `MEMBERSHIP_REQUIRED`, `PROFILE_INCOMPLETE`, `MATCH_UNAVAILABLE`, `MEDIA_NOT_AUTHORIZED`, and `REQUEST_CONFLICT`. Do not expose raw database or provider errors.

## 9. Data migration and compatibility plan

1. Inventory duplicate conversations, orphan references, unverified accounts, ambiguous academic values, and media without ownership records.
2. Add new nullable columns and tables first. Deploy readers that can handle both old and new state.
3. Backfill only facts that existing evidence proves. A phone OTP proves control of that phone at that time. It does not prove enrollment, age, or face verification.
4. Mark unknown membership and media ownership for review or user action. Do not invent proof or set confirmation timestamps in bulk. Existing users with `preferences_confirmed_at IS NULL` become ineligible and receive no discovery candidates. Route each such user to `nextRequiredStep: discoveryPreferences` before enabling the gate in the client.
5. Reconcile `year` values into study/graduation fields where unambiguous. Leave ambiguous values unresolved and prompt the user.
6. Deduplicate conversations and attach messages before adding uniqueness constraints.
7. Backfill asset records from verified storage metadata and ownership evidence. Restrict unresolved private assets.
8. Release compatible API/mobile versions before requiring new fields. Show a clear update requirement for unsupported old clients.
9. Add constraints after reconciliation. Validate concurrent indexes. Compare the resulting schema with the intended schema.
10. Rehearse rollback on a database copy. Retain eligibility and privacy fixes during a ranking rollback.

Do not run destructive cleanup directly against production as part of this plan. Production execution remains a separate owner-controlled operation.

## 10. Test matrix and release evidence

| Area | Required cases |
|---|---|
| Authentication | Bad/expired token; wrong token type; absent secrets; refresh race; reused refresh; logout-all; banned existing socket |
| OTP | Concurrent issue/verify; purpose mismatch; attempts exhausted; resend; expiry; provider timeout; no code in logs |
| Student/adult gate | Fake college text; unverified email; wrong domain; expired membership; underage birthday; incomplete account API bypass |
| Profile/media | Invalid nested fields; concurrent edit; interrupted replacement; foreign asset; wrong MIME; oversized file; processing retry |
| Discovery | Preserve current suite; add membership/pause; measure reciprocity coverage; capacity waits; 800-candidate model benchmark |
| Match/chat | Third-party history access; unauthorized join/read/typing; lost acknowledgement; block-send race; unmatch; duplicate client ID; hidden previews |
| Notifications | Worker retry; invalid token; muted thread; private preview; logged-out/deleted-match deep link |
| Moderation | Duplicate reports; distinct reporter handling; evidence access; temporary restriction; appeal; audit record |
| Lifecycle | Account switch; cache clearing; pause/resume; export auth; deletion retry; object/cache removal; restore after deletion |
| Operations | Clean migration; rolling restart; dependency outage; queue replay; backup restoration; secret rotation |
| Mobile | Two physical devices; offline/reconnect; background/terminated push; denied permissions; large text; screen reader; reduced motion |

Use generated synthetic users and media in automated tests. Do not copy student chats or verification documents into development fixtures. Run tests for all supported transports and roles, not only the happy path.

Add one release-level cross-account security sweep. Create account A, account B, and an unrelated account C. Enumerate every authenticated HTTP route and Socket.IO event. Replace all user, match, message, report, notification, media, and asset identifiers with identifiers owned by another account. Require denial without data disclosure or state change. Include inactive matches, blocks, suspension, stale tokens, admin-only routes, signed media access, pagination cursors, and reconnects. Run this sweep after all feature tests and before every beta or production build.

Proposed initial performance gates: total discovery response p95 below 500 ms on the defined warm staging fixture; committed text-message acknowledgement p95 below 500 ms; no sustained error rate above 1% during the agreed load test. These are starting engineering budgets, not current measurements. Record concurrency, dataset, hardware, network boundary, model flag, and cold-start behavior with every result. Adjust budgets deliberately for the intended deployment rather than hiding slow cases.

## 11. Product and safety measurements

Track these separately:

- Setup funnel: login verified → adult eligible → membership verified → profile ready → preferences confirmed → first card.
- Supply: eligible profiles per viewer; empty-deck reasons; campus coverage; age-of-account distribution.
- Ranking: model coverage, rejection reasons, model/query latency, known/cold/incoming/exploration placement, exposure concentration, capacity waits.
- Outcomes: mutual matches and qualified two-way conversations per eligible viewer. Exclude staff/test accounts.
- Safety: reports per active user, severe cases, response time, repeat-offender cases, appeals, blocks after initial messages.
- Reliability: failed sends, duplicate prevention hits, sync errors, upload failures, push failures, crash-free sessions, deletion completion.

Use minimum reporting group sizes for campus and demographic breakdowns. Avoid dashboards that let an operator infer a named student's orientation or dating behavior. A low report rate can indicate a poor report interface; interpret it with usability feedback.

## 12. Store and public-launch requirements

Apple's user-generated-content rules require filtering, reporting, blocking, and reachable contact information. Its guidelines also identify dating as an established category where a submission needs a meaningfully different or improved experience. Present the verified-college experience accurately. Do not imply that a generic swipe UI guarantees approval. [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

Google Play's Child Safety Standards apply to Social and Dating apps. Prepare published standards, an in-app reporting mechanism, a process for prohibited content, and a child-safety contact. An adults-only product still needs the applicable process. [Google Play Child Safety Standards](https://support.google.com/googleplay/android-developer/answer/14747720?hl=en).

Prepare privacy information, terms, community rules, support and deletion pages, truthful verification descriptions, current store declarations, screenshots, and reviewer access. Obtain jurisdiction-specific review of retention, student data, and any biometric processing before enabling those operations. The engineering defaults in this plan are not legal retention requirements.

## 13. Completion rule

A work package is complete only when its code, schema migration, mobile behavior, authorization rules, negative tests, failure handling, and operational instructions agree.

The durable media processor and cross-account security sweep now have local implementations. Phase 6 now has a concurrent HTTP load runner and a fail-closed ranking-readiness report. The next release work must collect representative staging evidence, then complete physical-device, accessibility, provider, backup, and restore drills.

Production can remain postponed. Local implementation can be completed against this plan, but real SMS/push delivery, physical-device behavior, operational staffing, and live recommendation quality require their own evidence before a public launch.
