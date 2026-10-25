# Onboarding redesign

Date: 5 October 2026.

## Design

- Use Rose plum dark mode.
- Use `#191218` for the page background and `#251C24` for cards.
- Use `#E47CA6` for primary buttons and `#F1A3C4` for selected controls.
- Use `#FBF1F7` for text. Use dark text on pink buttons.
- Use DM Sans for headings, labels, and body text.
- Use a soft gradient on Welcome. Use solid backgrounds on forms.
- Remove campus images from onboarding.
- Use a fixed primary button and a scrollable form.
- Show four progress stages: Basics, Campus, Matching, Profile.
- Keep green for face verification and blue for college verification.

## Flow

Sign-in or account creation → Rules → Name → Birthday → Gender → College and campus → Studies → Intention → Matching preferences → Photos and profile video → Face check → Profile review → Discovery.

College email verification remains an account requirement where the account policy requires it. Google accounts retain the existing verification policy.

| Previous pages | Current design |
| --- | --- |
| College, campus | One page with college and campus controls |
| Studies, batch | One page with degree, course, and graduation year |
| Distance, matching | One matching preferences page |
| Media introduction, media upload | Photo guidance appears in the media upload page |
| Mandatory detail questionnaire | Optional details open from Profile review |
| Media upload completion | Face check opens before Profile review |

Saved route names remain valid for existing links. These routes open the combined pages.

## Screens and behavior

- Welcome provides Google, college email, and sign-in actions.
- Account forms have visible field labels and a fixed primary button.
- Verification code forms support six-digit input, paste, and resend.
- Birthday rejects invalid dates and ages below 18.
- Gender selection and profile visibility use separate controls.
- College selection loads current institutions and campuses from the API.
- Studies preserves existing degree values and provides course search.
- Matching checks the age range and retains campus and distance modes.
- Media retains library selection, camera capture, cropping, compression, and upload.
- Media requires at least one photo and a profile video of 15–60 seconds.
- Face check retains private capture, consent, challenge steps, result states, and retry actions.
- Profile review provides core edit actions, verification status, and optional detail links.
- Optional pages include interests, clubs, bio, orientation, lifestyle, connection style, and life at college.
- A saved onboarding draft retains the current step after session renewal.
- Another account or logout clears the draft.
- Draft fields exclude credentials, verification codes, upload tickets, and private face captures.
- Only final profile completion enters discovery after matching preferences are confirmed.

## Checks

- TypeScript check: passed.
- Onboarding tests: 6 passed.
- Authentication and credential tests: 12 passed.
- Profile session restore tests: 5 passed.
- Android production bundle export: passed, 2,991 modules.
- Browser layout checks: 390 × 844 and 320 × 640 pixels.
- Browser checks covered date validation, visibility controls, course selection, prompt insertion, interest search, empty search results, media requirements, matching age validation, code retry errors, and review links.
- The gallery checks coverage for every registered account, onboarding, and verification screen route.
- The production app entry is restored. Temporary preview components are removed.

## Test limits

Browser previews use sample account data and sample verification results. Camera previews use a placeholder. The preview rejects service writes.

The connected Android phone was locked during device checks. Live camera capture, Google sign-in, email delivery, uploads, and biometric submission still require device and service checks.

Light mode is a separate task.

## Files

- [Screen gallery](onboarding-current/index.html)
- [Source coverage record](onboarding-current/source-audit.json)
- [Capture manifest](onboarding-current/review-manifest.json)
