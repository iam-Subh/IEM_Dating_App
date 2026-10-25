# IEM Connect codebase change report

**Snapshot:** 5 October 2026  
**Repository:** `E:\IEM_Dating_App`  
**Baseline:** `c3a8d22` on `main` (`origin/main`)

This report describes changes recorded in Git and files present in the working tree. Git records do not establish who wrote each change. A route, screen, or test file shows implementation work. It does not prove that the feature works on a device or in production.

## 1. Repository state

| Item | At this snapshot |
|---|---:|
| Commits in repository history | 13 |
| Modified tracked files | 172 |
| Deleted tracked files | 7 |
| Untracked files | 632 |
| Tracked working-tree diff | 22,558 added lines; 8,826 removed lines |
| Prisma migration files at `HEAD` | 35 |
| Additional local migration files | 41 |

The line counts exclude untracked files. The untracked set includes source code, tests, migrations, assets, design-review images, and Android `.gradle` cache files. None of the current local changes is in `origin/main` at this snapshot.

## 2. Changes already committed

| Date | Commit | Recorded change |
|---|---|---|
| 25 February 2026 | `78346e4` | Added the first login and Discover user interface. |
| 8–9 March 2026 | `0ff1741`, `b073ca9`, `fc6912b` | Changed the expanded profile design and added a premium profile preview. |
| 4 September 2026 | `d778f92` | Added chat media, voice notes, and profile edit screens. Other commits added setup guidance and a phone connection script. |
| 5 September 2026 | `e5d1f7c` | Added discovery location data and impression tracking. |
| 8 September 2026 | `c3a8d22` | Added verified onboarding, rebuilt discovery, and expanded chat, Stories, and Explore. |

The committed app uses Expo and React Native for mobile. The API uses Express, Prisma, PostgreSQL, Redis, and Socket.IO. See the [README](../README.md) and [implementation guide](chat-stories-search-implementation.md) for the committed architecture.

## 3. Current local app changes since `c3a8d22`

### Account, onboarding, and verification

- The API adds Google sign-in, account linking, password setup, account details, and session revocation routes. It removes phone one-time-password routes and the old SMS service. See [`auth.routes.ts`](../apps/api/src/routes/auth.routes.ts) and [`google-auth.service.ts`](../apps/api/src/services/google-auth.service.ts).
- The mobile app adds account screens and Google sign-in support. It removes the phone login and phone code screens. See [`AccountScreen.tsx`](../apps/mobile/src/screens/main/AccountScreen.tsx) and [`googleSignIn.ts`](../apps/mobile/src/services/googleSignIn.ts).
- Onboarding and verification add student verification controls, a real-person challenge, face review data, and a separate face-analysis service. See [`verification.routes.ts`](../apps/api/src/routes/verification.routes.ts), [`face-verification.service.ts`](../apps/api/src/services/face-verification.service.ts), [`RealPersonCheckScreen.tsx`](../apps/mobile/src/features/verification/RealPersonCheckScreen.tsx), and [`app.py`](../apps/face-service/app.py).

### Discovery, search, matches, and location

- Discovery adds Likes You, Roses, Standouts, and Rewind routes and screens. Matches add new-match and seen-state routes. See [`discover.routes.ts`](../apps/api/src/routes/discover.routes.ts), [`match.routes.ts`](../apps/api/src/routes/match.routes.ts), [`LikesYouScreen.tsx`](../apps/mobile/src/screens/main/LikesYouScreen.tsx), and [`StandoutsScreen.tsx`](../apps/mobile/src/screens/main/StandoutsScreen.tsx).
- Search adds people search and profile routes. Preferences add read, save, area-switch, and estimate routes. The mobile app adds Search and Preferences screens. See [`search.routes.ts`](../apps/api/src/routes/search.routes.ts), [`profile.routes.ts`](../apps/api/src/routes/profile.routes.ts), and [`SearchScreen.tsx`](../apps/mobile/src/features/search/SearchScreen.tsx).
- Location adds profile location settings, saved places, campus map data, and map screens. See [`location.service.ts`](../apps/api/src/services/location.service.ts), [`map.service.ts`](../apps/api/src/services/map.service.ts), and [`MapScreen.tsx`](../apps/mobile/src/features/location/MapScreen.tsx).
- The Discover and profile-card components have large local changes. See [`DiscoverScreen.tsx`](../apps/mobile/src/features/discovery/screens/DiscoverScreen.tsx), [`SwipeCard.tsx`](../apps/mobile/src/features/discovery/components/SwipeCard.tsx), and [`ProfileDetailModal.tsx`](../apps/mobile/src/features/discovery/components/profile-detail/ProfileDetailModal.tsx).

### Chat and media

- Chat adds message marks, shared-media access, conversation settings, pin, archive, unread, clear, delete, automatic message expiry, and multipart media upload routes. See [`chat.routes.ts`](../apps/api/src/routes/chat.routes.ts) and [`conversation-controls.service.ts`](../apps/api/src/services/conversation-controls.service.ts).
- The mobile chat changes include a revised chat screen, message bubbles, conversation list, shared-media screen, downloads screen, persistent media queue, and resumable upload code. See [`ChatScreen.tsx`](../apps/mobile/src/features/chat/screens/ChatScreen.tsx), [`MessageBubble.tsx`](../apps/mobile/src/features/chat/components/MessageBubble.tsx), and [`persistentMediaQueue.ts`](../apps/mobile/src/features/chat/persistentMediaQueue.ts).
- New Android modules handle chat media, notifications, and the local chat timeline. Their source is under [`apps/mobile/modules`](../apps/mobile/modules). Some untracked files in these module directories are Gradle cache files.

### Stories and notifications

- Stories add creation tools, captions, music, stickers, audience controls, archive, insights, and batch publishing routes. The old mobile Story creation and viewer screens are removed and replaced by files under [`features/stories`](../apps/mobile/src/features/stories). See [`story.routes.ts`](../apps/api/src/routes/story.routes.ts) and [`story-batch.routes.ts`](../apps/api/src/routes/story-batch.routes.ts).
- Notifications add a feed, unread state, device registration, open and action routes, push policy code, and mobile notification screens. See [`notification.routes.ts`](../apps/api/src/routes/notification.routes.ts), [`push-policy.service.ts`](../apps/api/src/services/push-policy.service.ts), and [`NotificationsScreen.tsx`](../apps/mobile/src/features/notifications/NotificationsScreen.tsx).

### Profile, settings, and app structure

- Profile editing adds video processing, photo renditions, profile preview, degree editing, and revised profile screens. See [`profile.routes.ts`](../apps/api/src/routes/profile.routes.ts), [`profile-media-processing.service.ts`](../apps/api/src/services/profile-media-processing.service.ts), and [`EditProfileScreen.tsx`](../apps/mobile/src/screens/main/EditProfileScreen.tsx).
- Settings add account, activity status, app notification settings, active-session controls, and blocked-account controls. See [`app-settings.service.ts`](../apps/api/src/services/app-settings.service.ts), [`SettingsScreen.tsx`](../apps/mobile/src/screens/main/SettingsScreen.tsx), and [`RootNavigator.tsx`](../apps/mobile/src/navigation/RootNavigator.tsx).
- The main navigator registers Dashboard (the Discover screen), Search, Matches, Chats, and Profile tabs. See [`MainTabNavigator.tsx`](../apps/mobile/src/navigation/MainTabNavigator.tsx).

## 4. Data and test changes

The 41 local Prisma migrations cover message marks, conversation controls, media, Stories, Roses, location, search, Standouts, preferences, account settings, Google sign-in, verification, and notifications. See [`prisma/migrations`](../apps/api/prisma/migrations) and [`schema.prisma`](../apps/api/prisma/schema.prisma). This scan did not apply the migrations.

The working tree adds API integration tests and mobile unit tests for several of these areas. The scan did not run the full test suites. These checks passed on this snapshot:

| Check | Result |
|---|---|
| `npm run typecheck --workspace=@iem-dating/api` | Passed |
| `npm run typecheck --workspace=mobile` | Passed |

No device run, database integration run, signed build, or production deployment was verified for this report.

## 5. Repository observations

- [`updated-app-runbook.md`](updated-app-runbook.md) says that 25 migrations exist. The repository contains 76 migration directories at this snapshot. Update this count when the runbook is revised.
- The untracked Android `.gradle` directories contain local build cache files. Review them before staging the source modules.
- The local changes span the mobile app, API, database, and native Android modules. Type checks pass, but integration and device behavior remain unverified in this report.
