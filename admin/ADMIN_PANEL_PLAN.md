# IEM Connect admin panel

A web page for running the app: the review queues, reports, people, and a
record of every staff action. It talks to the same API as the app
(`apps/api`, `/api/v1`).

## Run it

```
cd admin
npm install      # once
npm run dev      # http://localhost:5174
```

Sign in with an app account that has a staff role. `VITE_API_URL` points the
panel at another API (default `http://localhost:3000/api/v1`).

The folder sits outside the npm workspaces (`apps/*`, `packages/*`) so its
packages never change the app's `node_modules` or lockfile.

## 1. Roles

| Role | Can |
|---|---|
| owner | Everything, including giving roles. One owner. Protected from actions in the panel. |
| admin | Everything except giving roles. |
| moderator | Reviews, reports, warn, hide, suspend, ban, remove photos, reset the selfie check. |
| support | Look people up, sign them out everywhere, send a warning. |

Every request reads the role from the database, so a change applies at once.
Permissions live in `apps/api/src/middlewares/adminGuard.middleware.ts`.

**Audit log**: every change made through `/admin`, `/admin/panel` and the
admin safety routes is written to `admin_audit_logs` (who, what, on whom,
result, IP), including refused attempts. Nothing edits or deletes it.

## 2. Dashboard

- Live (read fresh every 15 seconds): online now (app open on screen,
  `presence.service.ts`), phones with the app by platform (device tokens), new
  phones today, sign-ups today.
- Play Store installs: Google reports these once a day, after the app is
  published. Until then "phones with the app" is the install count.
- Waiting work with the oldest item's age; trust and verification rates;
  today's activity; 30-day sign-ups, new phones and matches. Days in India time.

## 3. Review queues

| Queue | API | Keys |
|---|---|---|
| Selfie checks | `/admin/face-reviews` | A approve · T retake · R reject |
| Birthday changes | `/admin/birthday-requests` | A approve · R refuse |
| College confirmations | `/admin/memberships/unconfirmed` | - |

Selfie reviews expire after 7 days (`purgeOldReviews`), so the queue shows the
days left.

## 4. Reports

One case per person (`moderation_cases`), most urgent first. An **under-18**
report hides the profile at once (`safety.service.ts`); the team checks, and
dismissing restores it. Three different reporters also hide a profile.

Decisions: dismiss (D), warn (W), resolve and hide (H), ban (B). A ban signs
the person out for good and records their Google account, emails, college
email and phone so none of them can sign up again (`identity-ban.service.ts`) -
from a report, from a case, or from the user page alike.

## 5. Users

Search by name, email, college email or ID (Ctrl K anywhere). A person's page
shows their photos with face-check scores, account and college details,
reports against them, phones and sessions, and the staff history on them.

Actions: warn, sign out everywhere, hide / restore, suspend for 1-30 days
(ends on its own at their next sign-in, `suspension.ts`), reset the selfie
check, remove a photo, ban, change role (owner only).

Privacy: staff never read private chats - only messages that were reported,
as saved with the report.

## Design

Quiet and dense, after Linear, Stripe and Vercel's dashboards and moderation
tools (Reddit's mod queue, Moderation API):

- Near-monochrome surfaces separated by hairlines; colour only for meaning
  (green done, amber waiting, red danger), always with a word or icon too.
  The app's pink is the one primary action on a screen.
- Queues are a list to scan beside the open item, worked from the keyboard:
  J / K to move, one key per decision, shortcuts off while typing or in a
  dialog. The next item opens after a decision.
- Anything that affects a person asks first and needs a reason when it is
  serious (ban, hide, suspend, reject); the reason goes in the audit log, and
  the person reads it where it is meant for them (warning, rejection).
- Dark by default, light theme in the sidebar. DM Sans, numbers tabular.

## Later phases

- Phase 2: colleges, campuses and map places; pending deletions and exports;
  announcements to groups; algorithm and Standouts; push stats.
- Phase 3: growth funnels and retention; flagged-photo queue; music library;
  maintenance mode and minimum app version; support inbox; two-step sign-in.
