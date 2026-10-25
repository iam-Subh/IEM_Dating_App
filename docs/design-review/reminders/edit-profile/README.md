# Profile editor review

Open http://localhost:8792/reminders/edit-profile/index.html.

This review renders all 19 mobile section editor components with sample answers. The mobile Edit profile page and section editors use #100F0D. The onboarding canvas remains #F2F3EE.

## Changes

- Section editors follow the corresponding onboarding layouts with a dark palette.
- Gender uses three choice rows and an optional label sheet. Orientation uses the ribbon artwork and a checkbox grid.
- Lifestyle and Personality use the shared illustrated onboarding topic cards. Their answers open in option sheets.
- Academic fields use the onboarding field layout and searchable course sheet. Birthday shares the onboarding date wheel.
- Intentions, attendance, residency, bio, and interests reuse the onboarding artwork.
- Headings use Cormorant Garamond. Form text uses DM Sans.
- Solid surfaces, larger labels, and immediate tap feedback replace the older outlined controls.
- Section forms appear immediately. The former 600 ms entrance animation is removed.
- Save stays disabled until the form changes. Cancel retains the native discard confirmation.
- Gender, orientation, intentions, lifestyle, personality, academic courses, and graduation years use shared onboarding option data.
- Interests uses the same InterestForm component as onboarding. Profile editing excludes clubs because clubs have a separate editor. The native selection review uses a navigator form sheet with Android's default sheet behaviour. The website uses a web sheet to preview its content.
- Specific gender labels remain loaded. Course search retains older saved course names.
- Failed profile saves keep the editor open.

## Website scope

Navigation, verification status, campuses, and profile requests use sample substitutes. Save does not write account data. Native discard dialogs, keyboard behaviour, image selection, and the native height wheel require the mobile app for complete device checks.

Run node scripts/build-profile-edit-preview.cjs after changing a component. The catalog contains sample values and no account credentials.
