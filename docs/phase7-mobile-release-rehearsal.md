# Phase 7 mobile release and device rehearsal

Date: 8 September 2026

Use this procedure after the API, PostgreSQL, Redis, object storage, media processor, and push provider are available in staging. This procedure does not authorize a production release.

## Implemented release controls

- The application name is `IEM Connect`.
- The Expo slug is `iem-connect`.
- Android and iOS use `com.iemconnect.app`.
- The deep-link scheme is `iemdating`.
- Android uses version code `1`.
- iOS uses build number `1`.
- Camera, photo library, microphone, and location permission text describes the user action.
- EAS has development, preview, production, and production submission profiles.
- App icon, adaptive icon, splash artwork, and web favicon use the IEM Connect speech-and-heart mark instead of Expo placeholder artwork.
- `npm run release:validate --workspace apps/mobile` checks the static release configuration.
- `npm run release:validate:environment --workspace apps/mobile` rejects missing or unsafe release endpoints and a missing EAS project ID.
- Primary navigation, Explore filters and actions, Story controls, Matches, follow requests, message search, active sessions, and blocked accounts have explicit accessibility names and states.
- Story creation displays a corrective message when the user denies photo access.

## One-time Expo project setup

Perform these steps with the account that owns the application.

1. Confirm that `com.iemconnect.app` is available in Google Play Console and App Store Connect.
2. If the identifier is not available, change both platform identifiers before the first store upload. Do not change an identifier after release.
3. Install the EAS command-line tool through the approved development setup.
4. Sign in to the owner Expo account.
5. Run `eas init` from `apps/mobile`.
6. Confirm that Expo writes the correct project ID to the application configuration.
7. Configure Android and iOS signing credentials in the owner account.
8. Configure the Expo push project. Keep provider credentials outside the repository.

## Release environment check

Set the staging values in the current shell. Use the real project ID from `eas init`.

```powershell
cd E:\IEM_Dating_App
$env:EXPO_PUBLIC_API_URL='https://staging-api.example.edu/api/v1'
$env:EXPO_PUBLIC_SOCKET_URL='https://staging-api.example.edu'
$env:EAS_PROJECT_ID='replace-with-the-linked-project-id'
npm run release:validate --workspace apps/mobile
npm run release:validate:environment --workspace apps/mobile
npm run typecheck --workspace apps/mobile
cd apps\mobile
npx expo config --type public
```

Inspect the public Expo output. Confirm the application name, identifiers, version, scheme, permission text, and plugins. Do not continue if the output contains a development host or a placeholder value.

## Build sequence

Build an internal preview before a production binary.

```powershell
cd E:\IEM_Dating_App\apps\mobile
eas build --profile preview --platform android
eas build --profile preview --platform ios
```

Install each signed preview binary on a physical device. Do not use Expo Go as release evidence. After the preview rehearsal passes, create production builds from the reviewed commit.

```powershell
eas build --profile production --platform android
eas build --profile production --platform ios
```

Record the Git commit, EAS build IDs, application version, Android version code, iOS build number, API release, migration set, test date, tester, and device operating-system version.

## Required device matrix

Use at least these devices:

| Device | Required coverage |
|---|---|
| Current Android release | Complete functional and accessibility rehearsal |
| Oldest supported Android release | Complete critical-flow rehearsal |
| Current iOS release | Complete functional and accessibility rehearsal |
| Oldest supported iOS release | Complete critical-flow rehearsal |

Use two accounts on two devices for chat, match, follow, block, unmatch, delivery, read state, and account-event recovery.

## Functional rehearsal

Run these steps in order.

1. Create a new adult student account. Complete verification and discovery preferences.
2. Sign in again after application termination. Confirm session restoration.
3. Deny camera, photo, microphone, location, and notification permissions one at a time. Confirm that each flow explains the required correction.
4. Browse discovery and Explore. Confirm Like, Pass, follow disclosure, the two-filter limit, and the small-cohort response.
5. Create a match. Confirm that both devices receive the match state.
6. Send text, reply, reaction, photo, video, and voice messages.
7. Confirm queued, sent, delivered, and read states under their defined conditions.
8. Edit and delete a message. Confirm the 15-minute policy and another-device update.
9. Terminate the recipient app. Send a message. Open the correct conversation from the push notification.
10. Disable the network during a send. Restore the network. Confirm one idempotent message and no duplicate.
11. Use the same account on two devices. Confirm conversation-list recovery and access-revocation events.
12. Publish image and video Stories. Confirm processing, playback, pause, previous, next, expiry, viewer pagination, reply, mute, report, and deletion.
13. Accept and decline follow requests. Confirm immediate sender disclosure and private Story access.
14. Block and unmatch accounts. Confirm immediate route, socket, media, Story, and conversation revocation.
15. Revoke a non-current session. Confirm that the revoked device loses HTTP and socket access.
16. Request account export and deletion. Confirm status, download authorization, delay, cancellation rules, and final access removal.

## Accessibility rehearsal

Run the full critical flow with Android TalkBack and iOS VoiceOver.

- Confirm that focus follows visual order.
- Confirm that each icon-only control has one clear name.
- Confirm that selected tabs, selected filters, disabled buttons, busy buttons, and Story progress report their state.
- Confirm that Story previous, next, close, menu, reply, and viewer controls work without swipe gestures.
- Set the largest supported text size. Confirm that text does not hide account, safety, consent, or submission controls.
- Enable bold text, reduced motion, high contrast, and screen zoom where the platform supports them.
- Use a hardware keyboard or switch input for sign-in, discovery preferences, chat, Story reply, report, and settings.
- Confirm that errors and asynchronous status changes are announced once.

## Network and lifecycle rehearsal

Repeat chat, Story, and Explore flows with high latency, packet loss, offline mode, background execution, application termination, and device restart. Confirm bounded retries and clear recoverable states. Confirm that the app does not show stale private data after sign-out or account switch.

## Store material and policy records

Prepare these records before submission:

- App icon, phone screenshots, store description, support URL, and privacy-policy URL.
- Data-safety and privacy labels that match the implemented data flows.
- Account-deletion instructions and an in-app deletion path.
- Dating, user-generated-content, reporting, blocking, moderation, and appeals policy text.
- Age-rating answers and evidence for the adult-only access gate.
- Demo account and reviewer instructions for student verification.
- Contact details for safety, privacy, and store review.

## Exit record

Phase 7 passes only when all required device rows and rehearsal steps have dated evidence. Record each failure, owner, correction commit, rebuild ID, and repeat result. A local TypeScript check or Expo export does not replace signed-device evidence.

Do not start the production rollout until the Phase 6 target-infrastructure gates and this Phase 7 exit record both pass.
