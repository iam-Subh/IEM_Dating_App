# Reminder screen review

Open http://localhost:8792/reminders/index.html.

The catalog contains 71 sample states: 3 approved concepts, 63 redesigned reminder states, 2 college verification captures, and 3 earlier proposals. The development mobile preview includes 68 states and excludes the earlier proposals.

## Scope

The website and development mobile preview share ReminderScenes.tsx. They use sample data. Production reminder triggers and production reminder components are unchanged. Preview actions do not change account data or reminder preferences.

## Presentations

- Chat: an inline message counter, waiting status, or composer restriction.
- Discovery limits: an amber activity count beside the current profile.
- Paused profile: a recovery screen that explains what remains available.
- Roses: a reward illustration with a single next action.
- Media: a centred overlay above the conversation or story.
- Campus: a section in Search or preferences that keeps the current campus visible.
- Selfie: separate required, review, and completion states.
- Media correction: affected media, failure reason, and specific correction instructions.
- Account: a verification row with optional benefit details.
- Preferences tutorial: a spotlight on the actual control.
- Match: the conversation action takes priority.
- Story: a small verification notice near the sharing action.
- Notifications: existing server text in a sample system layout. The phone controls the final appearance.

Use solid dark surfaces. Mint identifies conversation actions. Amber identifies limits and deadlines. Coral identifies campus access. Lavender identifies media actions. Rose identifies rewards. Blue identifies college verification.

Entrance motion uses a 260 ms fade and a 10 px movement. Reduce Motion disables movement. Buttons give immediate press feedback. The approved verification rosette rotates behind a fixed check mark.

## 3D artwork

Open http://localhost:8792/reminders/3d.html to compare the new 3D reminders.

Chat, Map visibility, campus access, paused profiles, media correction, mentions, matches, and preferences use separate transparent illustrations. Map visibility uses a compact notice below the map. Keep exploring removes that notice and keeps the map visible. Large illustrations sit directly on the dark background. Small activity limits use compact illustrations. Selfie entry uses the approved adult portrait. The approved Rose and rotating verification badge remain in the catalog.

Artwork settles once after loading with a 420 ms fade, 8 px movement, and scale from 0.96 to 1. Reduce Motion disables movement. Images are rendered 3D artwork, not interactive 3D models.

Generated assets and exact prompts are stored in apps/mobile/assets/illustrations/. They were created with the built-in imagegen tool.

## Review

Select a state from the catalog. Use Next and Previous to compare states. Use Reset preview to restore a dismissed state. Each state has a direct URL.

Open iemdating://reminders-preview in a development build for the mobile simulation. Use Next, Previous, Replay, and Choose. College verification uses test code 123456 and sends no email.

## Build

Run node scripts/build-reminder-preview.cjs after changing the shared components or catalog.cjs.
Run node scripts/serve-design-review.cjs to serve the website on loopback port 8792.

## Design references

Contextual instructions and limited interruptions follow these platform guidelines:

- https://developer.apple.com/design/human-interface-guidelines/onboarding
- https://developer.apple.com/design/human-interface-guidelines/alerts
- https://m3.material.io/components/snackbar/overview

College email verification stays outside onboarding for Google accounts.
