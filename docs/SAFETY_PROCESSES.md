# IEM Connect: safety and legal processes (internal)

How the team handles the serious cases. The public promises these back up are
in the Terms, Privacy Policy, Child Safety Standards and Grievance Redressal
documents (`apps/api/src/legal/documents.ts`, served at `/legal`). The
checklist they come from is [SAFETY_AND_LEGAL.md](SAFETY_AND_LEGAL.md).

Everything here happens in the admin panel (`admin/`), where every action is
in the audit log.

## Settings to fill in before launch

| Setting (API `.env`) | What | Now |
|---|---|---|
| `SUPPORT_EMAIL` | Support, grievances, appeals, police requests | `noreply.iemconnect@gmail.com` |
| `GRIEVANCE_OFFICER` | Name, title and postal address, as one line | not set: the documents say "to be appointed" |
| `PUBLIC_WEB_URL` | Where `/legal` and `/account/delete` are served | `http://localhost:3000` |
| App: `EXPO_PUBLIC_SUPPORT_EMAIL` | Same address, for the app's "Write to us" | default above |

A "noreply" address tells people not to write - consider a support address.
Raising `LEGAL_VERSION` (server `legal/documents.ts` and app
`features/legal/legal.ts`, together) asks everyone to agree again: only for a
real change to the Terms or Privacy Policy.

## Every day

1. Open the admin panel. Work the queues oldest first: **Reports** (under-18
   and other urgent ones are at the top), **Selfie checks** (they expire after
   7 days), **Birthday changes**, **College confirmations**.
2. Target: every report decided within **24 hours**.
3. Check the support inbox: acknowledge every complaint within **24 hours**.

## Child sexual abuse material (CSAM) or a minor at risk

Required by the POCSO Act section 19 and the IT Act 67B; the Supreme Court
(2024) held that a platform that only removes, without reporting, loses its
legal protection.

1. Do not download, forward or screenshot the material.
2. In the admin panel: ban the account (the reason goes in the audit log).
   The report's saved evidence stays in the database.
3. **Report to the police the same day**: the National Cyber Crime Reporting
   Portal, cybercrime.gov.in ("Report Women/Child related crime"), or call
   1930, or the local police station. Give the account ID, the time and what
   was seen - not the images.
4. Keep the evidence and records for the investigation; do not delete the
   account's data until the police say so.
5. Write down what was done and when (date, who, complaint number).

**An under-18 report with no abuse** (someone just too young): their profile
is hidden at once. Check the photos and birthday. Adult: dismiss (the profile
comes back). Under 18: ban, and delete the account.

## Intimate images shared without consent, or impersonation

The IT Rules 2021 require removal within **24 hours** of the person's
complaint.

1. Remove the photo (user page > photo > remove) or the message, and hide or
   ban the account.
2. Reply to the person within 24 hours to say it is removed, and point them to
   cybercrime.gov.in / 1930 if they want to report it.

## Threats, violence, self-harm

- Danger to life: tell the person reporting to call 112. If a police request
  arrives, it is an emergency request (below).
- Self-harm: the report sheet already shows Tele-MANAS (14416) and 112 to the
  reporter. Do not ban the person at risk; warn if they broke a rule.

## Police and government requests

Requests come to the support email with "Law enforcement request" in the
subject (Law Enforcement Guidelines).

1. Check it is genuine: an official email domain, letterhead, a legal basis.
2. Give only what is asked for, for the period asked.
3. Emergencies (risk of death or serious harm): answer first.
4. Keep a record of every request and what was given.

## Grievances

1. Acknowledge within **24 hours** ("We got your complaint, reference X").
2. Resolve within **15 days**; reply with the decision and how to appeal
   (Grievance Appellate Committee, 30 days; Data Protection Board for data).
3. Data requests (access, correction, erasure, nominee): access is Export my
   data; erasure is Delete account; do the rest by hand.

## Appeals

A hidden, suspended or banned person who signs in is told why, and to appeal at
`PUBLIC_WEB_URL/appeal` or by email (`account-standing.ts`). Appeals from the
page land in the admin panel's **Appeals** queue.

1. Read their appeal, the decision they're appealing, and the staff history on
   their user page.
2. Decide within 15 days: **Restore** or **Uphold**, with a note - they get it by
   email. Lifting a ban is owner or admin only, and also clears the ban's
   recorded identities. Appeals that came by email: answer by email, and
   restore from the user page.

## Data breach

The DPDP Rules require telling the affected people and the Data Protection
Board.

1. Contain it: rotate secrets (database, JWT, `FACE_KEY_SECRET`, storage
   keys), revoke sessions if accounts are at risk.
2. Tell the Data Protection Board at once, and send the full report within
   **72 hours**: what happened, whose data, what was done.
3. Tell the affected people in plain words: what, what it means for them,
   what to do.
4. Write it down.

## Retention

| Data | Kept | Where it happens |
|---|---|---|
| Account and profile | Until deletion + 30 days | `account-lifecycle.service.ts` |
| Selfie snapshots | Deleted after the check; at most 7 days if reviewed | `face-verification.service.ts` |
| Face key | Until removed or the account is deleted | `face_keys` |
| Banned identities | Unreadable hashes, kept | `banned_identifiers` |
| Reports, cases, audit log | Evidence in closed reports is cleared after 1 year; cases and the audit log are kept | `verification-reminders.worker.ts` (hourly) |
| Sessions | 30 days after last use | `user_sessions` |
| Bug report files | Deleted when the report is closed or marked duplicate, at most 90 days | `feedback.service.ts` (hourly) |

Inactive accounts are not deleted automatically. If that is ever added, the
DPDP Rules require a warning 48 hours before. Everyone gets an in-app reminder
of the rules once a year (IT Rules 2021), from the same hourly job.

## Google Play Console, before release

1. **App content > Target audience**: 18 and over only.
2. **App content > Data safety**: list what the Privacy Policy lists
   (account, profile, photos and video, messages, approximate location, face
   data, device IDs); encrypted in transit; deletion: in the app and at
   `PUBLIC_WEB_URL/account/delete`.
3. **App content > Child safety standards**: the published standards URL is
   `PUBLIC_WEB_URL/legal/child-safety`; in-app reporting: yes; contact: the
   support email (or the child safety contact once named).
4. **Store listing > Privacy policy**: `PUBLIC_WEB_URL/legal/privacy`.
5. Apple, if published there: the same links, and the reviewer notes should
   say reports are acted on within 24 hours.
