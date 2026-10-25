# Verify reminders: design

How every college-verification and selfie-check reminder looks and moves.
Explore → Reminders (dev builds) walks through all of them with sample data
(`src/development/ReminderPreview.tsx`).

## Patterns, quietest first

At most one reminder per screen. Pink is for the action only; amber marks a
deadline, red a problem.

| Pattern | Where | Component |
|---|---|---|
| A. Row | Profile, Edit college, Account | `ReminderRow`, `BlueBadgeRow` (RealPerson.tsx) |
| B. Banner | Top of lists, the deck | `ReminderBanner`, `VerifyNudge` / `UnverifiedNudge` |
| C. Chat | Over / instead of the composer | `ChatVerificationReminder`, `ChatVerificationWaiting` |
| D. Deck card | In the cards' place: out of likes, paused | `DeckReminderCard` (DeckVerifyBanner.tsx) |
| E. Limit sheet | A limit was hit | `VerifyRulesScreen` - a bottom sheet with a countdown when it resets |
| F. On the photo | Edit profile | `PhotoReorderGrid` `issues`, `FaceMediaNote` |

Daily limits reset at midnight India time (`msUntilReset`), like the server.

## Artwork and motion

`ReminderArt.tsx`: satin-clay 3D objects everywhere, the kitten on the two
deck cards. Sources are in `assets/illustrations` with their prompts; the app
uses the trimmed WebP copies in `assets/illustrations/reminders`.

- `pop`: grows in with a soft spring, once - banners, rows.
- `float`: then drifts 4px and tilts 1.5° on a 3.2s loop - a sheet's art.
- `lively`: float, a breathing glow, and a bounce every 10s - deck cards, match.
- `ArtRing`: the blue badge in a ring that fills with its two steps.

Everything is still when the phone's Reduce motion is on.

## Pushes

Two in the first week (day 1 and 5), pause warnings on days 10 and 13, the
pause itself on day 14, and expiry at 30, 7 and 1 days - at most two reminders
in any 7 days. Each has a "Verify now" button
(`apps/api/src/services/verification-reminders.worker.ts`).
