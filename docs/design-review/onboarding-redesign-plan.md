# Onboarding redesign plan

**Date:** 5 October 2026  
**Status:** Proposal for review. No app changes in this task.  
**Theme:** Rose plum in dark mode. The user selected this theme and the background approach. Plan light mode after the user supplies the references.

## 1. Design decision

Use Rose plum. Use deeper pink `#E47CA6` for primary buttons. Keep pale rose `#F1A3C4` for selection marks and small highlights. Use the same controls, spacing, and type throughout account setup, profile setup, and verification.

**User constraint:** Do not use campus images.

Use Hinge's focused questions and media guidance. Use Happn's clear selection rows, interest categories, and selection counts. Adapt these patterns to a college community.

The main change is the flow. Collect the information needed to enter discovery first. Offer other profile details as optional additions.

## 2. Review basis

- Current gallery: [index.html](./onboarding-current/index.html).
- Current source audit: [source-audit.json](./onboarding-current/source-audit.json).
- Reference library: [reference manifest](./onboarding-references/manifest.json).
- Product policy: `PHOTO_VERIFICATION_PLAN.md` and `GOOGLE_SIGNUP_PLAN.md`.

The current audit covers 29 account, onboarding, and verification routes. It includes 85 screen captures and one splash source asset. The captures include scroll positions, keyboard states, dialogs, and verification results. They are not 85 onboarding steps. The captures use component previews. They do not prove service or navigation behaviour.

The reference library contains 45 Hinge screenshots and 22 Happn screenshots. Some screenshots repeat a page or show an animation state. This plan covers onboarding and entry to discovery. It does not cover a full redesign of chat, maps, or settings.

## 3. Questions to remove, combine, or defer

| Finding | Proposed action | Reason |
|---|---|---|
| Distance appears in `DistancePreference` and discovery preferences. | Remove the separate distance page. Ask for radius once in matching preferences. | The user should not enter the same setting twice. |
| Academic details and personality details both ask about education. | Keep current studies in Academic details. Remove education from the personality questionnaire. | Current studies and completed qualifications need different labels. |
| Course, current year, and graduation batch use separate pages. | Combine them in Academic details. Make current year optional. | These fields share one subject. Current year and graduation year are not interchangeable. |
| College and campus use separate pages. | Combine them in Your campus. Skip the college picker when proof identifies one college. | Verified information should not need another entry. |
| Campus clubs and hobbies appear in separate long lists. | Put both in one optional Interests editor. Keep separate sections and data fields. | Club membership and hobbies are distinct, but the user can select them in one place. |
| Lifestyle and personality require complete answers before Continue works. | Move them to optional profile completion. Save partial answers. | A user should be able to keep some answers and leave other questions unanswered. |
| Orientation uses a separate setup page. | Offer it in optional profile details, with a clear visibility label. | Do not use orientation to infer matching preferences. |
| Photo guidance appears before media and again before the face check. | Move photo guidance into Media. Keep the separate face consent screen. | Guidance can combine. Consent must remain explicit. |
| Several routes show the same verification form or different result states. | Reuse components. Preserve the purpose, state, and return destination. | A result state is not an unnecessary duplicate page. |

Do not calculate graduation year from course length without confirmation. Transfers, gaps, and course durations can change the result. Do not label an enrolled degree as a completed qualification.

## 4. Proposed screen order

### Account entry

1. Welcome: choose Google or college email. Provide a separate Sign in link.
2. Complete the selected account method.
3. Complete college proof here only when the account service requires it.
4. Read and accept the community rules once.

### Core profile input: eight screens

| Order | Screen | Main input |
|---|---|---|
| 1 | Your name | Profile name. |
| 2 | Your birthday | Date of birth and age confirmation. |
| 3 | Your gender | Gender identity. Expand detailed options only when selected. |
| 4 | Your campus | College and campus. Show verified college information when available. |
| 5 | Your studies | Course, degree information, and graduation year. Current year is optional. |
| 6 | What are you looking for? | Relationship intention. |
| 7 | Your matching preferences | Matching category, people to show, age range, campus or distance mode, and applicable scope. |
| 8 | Your photos and profile video | Main photo, additional photos, and public profile video. |

After Media, show the face check at the point required by the current account policy. Then show one Profile review screen. Let the user inspect the public profile and correct entries before discovery.

Offer Interests and Bio from Profile review. Open each as an optional editor. Offer lifestyle, personality, orientation, and campus spots from profile completion after entry. Keep these options available in Edit profile.

This proposal has eight core input screens, one rules screen, and one review screen. Account screens and verification states are additional. The current flow has 18 profile setup routes before the live face check and discovery preferences. These counts do not measure completion time.

Use four progress stages: **Basics → Campus → Connections → Profile**. Show the active stage name. Do not include optional editors in a fixed required-step count. Use a separate action counter inside the face check.

## 5. Plan for every current page

### Account pages

| Current page or route | Action | Proposed design |
|---|---|---|
| Native opening | Keep. | Centre the existing logo on the charcoal background. Keep the opening brief. |
| `Welcome` | Redesign. | Use the logo, one short purpose statement, and an optional abstract background. Do not use campus images. Place Google and college email actions above the footer. |
| `Login` options | Combine with Welcome. | Put account choices on Welcome. Keep Sign in as a clear separate intent. |
| `Login` email form | Keep. | Use labelled email and password fields on a solid background. Add password visibility and recovery actions. Keep the keyboard from covering the action. |
| `SignUp` | Keep. | Explain which college email is accepted. Show field errors beside the relevant field. Keep account terms accessible. |
| `SignUpOTP` | Reuse code component. | Show the destination email, Edit email, resend state, and code error. Label the purpose as account creation. |
| `OTPVerification` | Reuse code component. | Use the same layout. Preserve this route's account purpose and service call. Support paste and platform code autofill. |
| `PasswordRecovery` | Keep its states. | Use the same form layout for email, code, and new password. Show the current step and a direct recovery action. |
| `StudentVerification` | Keep one reusable form. | Show college selection only when needed. Then show email proof, code, and any required password setup in order. Explain why a password is needed for that branch. |
| `VerifyCollege` | Share StudentVerification. | Keep its entry context and return destination. These routes already use the same screen component. Do not remove a caller without checking navigation. |

### Profile pages

| Current page or route | Action | Proposed design |
|---|---|---|
| `HouseRules` | Keep once. | Use three short rule rows: respect, consent, and report misuse. Keep policy links and an explicit acceptance action. Avoid a long sequence of introduction pages. |
| `NameSelection` | Keep. | Use one labelled field with focus on entry. Explain any restriction on later name changes before submission. Do not promise editing that the service does not support. |
| `BirthdaySelection` | Keep. | Use a clear date control. Show the calculated age before confirmation. Keep the adult eligibility check. Explain that the public profile shows age, not the full birth date. |
| `GenderSelection` | Keep. | Use large rows with a border and check mark. Put detailed identity options in an expandable picker. Keep the current inclusive choices. Show actual public visibility. |
| `CollegeSelection` | Combine with Campus. | Use search for unverified or ambiguous colleges. Show a verified summary when one institution is already known. |
| `AcademicSelection` | Combine with Batch. | Search for a course. Use course data for the degree label where available. Show graduation year next. Keep current year optional. |
| `BatchSelection` | Remove its separate step. | Place graduation year in Academic details. Preserve the saved value and existing identifiers. |
| `CampusSelection` | Expand to Your campus. | Show college and campus in one view. Use large campus rows. Move optional residence details to Edit profile. |
| `SocialSelection` | Move and combine. | Put campus clubs in Interests. Keep club selection limits. Move attendance style and favourite spot to optional profile details. |
| `OrientationSelection` | Move to optional details. | Explain visibility. Allow a user to leave the field unanswered. Keep it separate from the people shown in discovery. |
| `DistancePreference` | Remove its separate step. | Show radius inside matching preferences only for distance mode. Show the selected value and unit beside the slider. |
| `SeekingSelection` | Keep. | Use readable selection rows for relationship intentions. Avoid small cards that truncate labels. Keep the current selection rule. |
| `LifestyleHabits` | Move after entry. | Use labelled sections in an optional editor. Save partial answers. Use neutral wording. |
| `PersonalityTraits` | Move after entry. | Remove the education question. Keep other answers optional. Make zodiac display optional. Do not expose a derived value without the user's choice. |
| `Interests` | Keep as an optional editor. | Add search, collapsed categories, and a selected-item row. Show the actual selection count and existing limit. Put campus clubs in a separate section. |
| `ShareMore` | Keep as an optional Bio editor. | Offer three short writing questions above the field. Use them as writing help for the existing bio. Show the actual character limit. Preserve typed text on Back. |
| `FaceVerificationInfo` | Combine its guidance with Media. | Put short main-photo tips beside the upload control. Retain a separate consent screen in RealPersonCheck. |
| `PhotoUpload` | Redesign as Media. | Start with the required main photo. Show the six photo slots in a compact grid. Label extra slots as optional. Follow with the profile video card, duration, preview, and replace action. |

### Matching, verification, and entry pages

| Current page or route | Action | Proposed design |
|---|---|---|
| `RequiredDiscoveryPreferences` | Move earlier and combine with Distance. | Use one matching preferences screen. Group People, Age, and Location. Expand radius only for distance mode. Keep campus scope controls for campus mode. |
| `RealPersonCheck` | Keep every state. | Use explicit consent, a live camera view, an action counter, and specific results. See Section 6. |
| `VerifyRules` | Keep one contextual component. | Show the reason, applicable account restriction, and one verification action in a compact sheet. Preserve all entry contexts and reminder rules. |
| New Profile review | Add. | Preview the public profile. Give each section an Edit action. Show college and face verification statuses separately. Keep one Continue to discovery action. |
| Discovery entry | Keep. | Open discovery when the account is eligible. Show optional profile completion in one compact card. Show a separate verification reminder when policy requires it. |

Matching category, gender identity, orientation, and people to show have different meanings. Do not merge their stored values. Ask the user to confirm matching preferences explicitly. A suggested default must remain editable.

## 6. Face verification design

### Separate public media from the live face check

Rename **Vibe Check Video** to **Profile video**. Add **Visible on your profile**. Keep the current requirement for a video of 15–60 seconds and at least one photo in the first redesign.

Name the other process **Live selfie check**. Explain the comparison with the main photo and profile video. Explain the face key in simple words: stored face measurements used to check later media changes. Use consent text that matches the implemented storage and deletion rules.

| State | Proposed design and action |
|---|---|
| Introduction and consent | Short explanation, data-use link, explicit consent, and Start check. Show Do it later only when policy permits it. |
| Camera permission | Explain the camera use when the user starts the check. For denied permission, offer Open settings and an exit action. |
| Look straight | Show the camera, face guide, and one instruction. Keep lighting and framing help beside the camera. |
| Blink | Show one instruction and the current action number. |
| Turn left | Use a directional icon and text. |
| Turn right | Use the same layout with the opposite direction. |
| Smile | Use the same layout. Do not add another introduction. |
| Checking | Show progress text. Prevent duplicate submission. Restore the result after reconnection. |
| Verified | Show the face status and Continue. Explain where the face status appears. |
| Pending review | Explain the pending state. Offer Continue when allowed. Show a review time only if the service has a confirmed target. |
| Main photo needs a change | Open the main-photo editor. Keep other media. |
| Another photo needs a change | Identify the affected item. Open that item's editor. |
| Profile video needs a change | Open the video editor. Keep uploaded photos. |
| Live check failed | State the supported reason. Offer Retry with specific capture guidance. |
| Camera error | Explain the error. Offer Retry or Open settings, as applicable. |
| Upload or connection error | Show a retry action. Preserve capture data only under the approved retention rules. |

The existing sequence uses a straight-facing capture and three selected actions. Keep the four-action progress indicator. Use the term live selfie check consistently. Do not describe continuous video recording if the implementation collects snapshots.

Keep these product rules:

- The blue tick means college email verification.
- Face verification uses the green face-scan mark on photos in the expanded profile only. Keep the user's status in Profile and Settings.
- The face check is optional for college-email accounts.
- Google accounts must complete the face check within the 14-day period when `REAL_PERSON_REQUIRED` is enabled.
- Keep the college verification grace period, restrictions, and reminder schedule.
- A later media change can pause face verification status. It does not automatically pause the profile.
- Keep all 12 VerifyRules contexts. They are conditional states, not 12 onboarding steps.

Check these rules against active service settings during implementation. Do not present a disabled requirement as active. Show an actual deadline when the service supplies one.

## 7. Dark colour system

![Proposed dark colour system](./onboarding-palette.svg)

| Role | Colour | Use |
|---|---|---|
| Canvas | `#191218` | Screen background. |
| Surface | `#251C24` | Cards and fields. |
| Raised surface | `#312431` | Sheets and raised controls. |
| Deep rose | `#E47CA6` | Primary button background. |
| Pale rose | `#F1A3C4` | Focus, selected border, and check mark. |
| Button text | `#2A1922` | Text on the deep rose button. |
| Main text | `#FBF1F7` | Headings and answers. |
| Supporting text | `#C7B4C2` | Explanations and field labels. |
| Hint text | `#A58F9F` | Hints on the specified dark surfaces. |
| Control border | `#887181` | Boundaries needed to identify controls. |
| Selected fill | `#3D2835` | Selected option background. Add a pale rose border and check mark. |
| Lavender | `#CBC1F3` | Small illustration accents. |
| Success | `#9AD8B8` | Face status and successful actions. |
| Warning | `#EEC777` | Deadlines and pending actions. |
| Error | `#FF9B99` | Errors, with explanatory text. |
| College badge | `#8FBAFF` | College verification only. |

Use deep rose for the primary action across the flow. Use green for success status. Limit gradients to Welcome artwork. Use solid surfaces for forms. Keep errors separate from the action colour through icons and text.

### Background image recommendation

Use a soft gradient on Welcome. Use a solid background for account forms, questions, matching preferences, media controls, and verification instructions. Keep the live camera view clear. Do not use campus images.

Welcome can use a soft plum and rose colour glow. Keep the artwork away from buttons and text. Do not add a full-screen image between each question. Use one small illustration or brief animation for completion.

A Hinge-style sky image can be tested on Welcome as an alternative. Use original or licensed artwork. Do not reuse Hinge's image. The app can keep its identity through colour, type, and layout without a background photograph.

Calculated contrast ratios for the proposed pairs:

| Pair | Ratio |
|---|---|
| Main text on canvas | 16.68:1 |
| Supporting text on surface | 8.45:1 |
| Hint text on raised surface | 4.93:1 |
| Dark button text on deep rose | 6.13:1 |
| Control border on raised surface | 3.31:1 |

Use at least 4.5:1 for normal text and 3:1 for qualifying large text. These are the [WCAG text contrast thresholds](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The calculations above cover these named pairs only. Check each final state, including disabled controls and overlays.

## 8. Layout and control rules

- Use DM Sans for the interface. Use sizes of 28–32 for headings, 16 for body text, and 14 for helper text. Scale text with the device setting.
- Use 24 dp horizontal spacing. Use an 8 dp spacing grid. Use 24–32 dp between sections.
- Use a 56 dp primary button with a 16 dp corner radius. Keep one primary action per screen.
- Give each interactive target at least 48 × 48 dp, following [Android accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views).
- Place Back and stage progress at the top. Place the primary action above the bottom safe area and keyboard.
- Use visible field labels. Do not rely on placeholder text as a label.
- Show selection with a check mark and border. Do not rely on colour alone.
- Use full-width rows for long answers. Use chips for short interests.
- Show an inline error with a correction action. Avoid a generic alert for every field error.
- Save the profile draft. Preserve answers on Back. Resume at the last incomplete required step.
- Use short transitions of approximately 150–250 ms. Respect reduced-motion settings.
- Request camera, microphone, media, or location permission when the selected action needs it. Campus mode should not require location permission solely to select a campus.
- Mark fields as public, private, or optional where needed. Implement visibility controls only where the data model supports them.

## 9. Reference patterns to adopt

| Reference | Adopt | Application |
|---|---|---|
| Hinge | Focused question and readable heading. | Name, birthday, gender, and intention. |
| Hinge | Guidance beside media slots. | Main-photo quality and additional-photo suggestions. |
| Hinge | Explicit face-check explanation. | Consent before the live selfie check. |
| Hinge | Writing prompts. | Optional help for the existing bio field. |
| Happn | Clear progress and selected rows. | Setup stage header and choice controls. |
| Happn | Interest count and selected chips. | Optional Interests editor. |
| Happn | Local places. | Optional campus spots after entry. |

Avoid a series of full-screen photo transitions. Use one review screen for completion. Keep the current inclusive gender choices. Add fields only when the app needs them. Do not add a waitlist, screenshot blocking claim, or contact blocking claim from a reference without a working feature and a product requirement.

Use the reference images to study layout. Do not reuse their people, branding, or artwork in the app.

## 10. Implementation order after approval

1. Create design previews for Welcome, a question page, Your campus, matching preferences, Media, and the face check. Review them together in dark mode.
2. Create shared colour, type, spacing, button, field, selection, sheet, and progress components. Replace conflicting hardcoded styles.
3. Combine the selected pages. Update navigation, draft storage, and resume behaviour. Check account-service gates before changing route order.
4. Move optional questions. Update profile-completion validation so partial answers can save.
5. Apply the verification design. Preserve consent, account deadlines, media checks, and badge rules.
6. Check the full account and onboarding branches on a device. Update the screen gallery with the revised states.

## 11. Completion checks

- Check Google and college-email accounts, including already verified colleges and ambiguous college domains.
- Check code errors, expired codes, resend, password recovery, and required password setup.
- Confirm that the app asks for radius once. Confirm that campus mode hides radius.
- Confirm that current studies do not imply a completed degree.
- Confirm that optional editors save partial answers and do not block entry.
- Confirm that public profile media and private face-check consent have distinct labels.
- Check every face result, denied permission, upload failure, and pending review.
- Check all verification return destinations and existing reminder restrictions.
- Check narrow screens at 320 dp width and text scaling at 200%. Check scrolling, labels, and bottom actions.
- Confirm that colour is not the only way to identify selection, error, or verification status.
- Confirm that the public preview does not expose full birth date, account email, face measurements, or private matching settings.
- Measure completion rate and time per required step before and after release. Use the results to assess the redesign. Do not assume a conversion increase from fewer pages alone.

## 12. Product changes included in this proposal

Moving optional questions and allowing partial answers can require service validation changes. Making current academic year optional is also a proposed requirement change. Review these changes with the route changes.

Keep the profile video requirement in this version. Making the video optional would be a separate product decision. Structured public prompt cards would also require a separate data-model change; the first version uses questions as bio writing help.

Keep current verification eligibility and grace-period rules. Use one theme token system now so a later light palette can use the same component roles.
