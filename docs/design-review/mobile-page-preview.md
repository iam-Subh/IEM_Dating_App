# Mobile page preview

**Hidden after design review (7 October 2026).** App.tsx opens the normal app navigator. The preview toolbar, page list, and preview links are disabled. The preview components remain in the repository for development use.

Open `iemdating://design-preview` in the development build.

- Tap **Next** to show the next page without completing the form.
- Tap the left arrow to show the previous page.
- Tap the page title to open the page list.
- Tap **Exit design preview** in the page list to return to the app.
- Use `iemdating://design-preview?screen=38` to open a specific page. The index starts at zero.

The tour uses the current screen components. It includes 38 pages and states: account forms, core setup, optional details, camera access, face-check instructions, results, media correction, and profile review. College email verification and its related pages are outside the onboarding sequence.

The tour uses a separate store that does not persist data. Service reads return sample data. Service writes fail before a network request starts. Face-check screens show an illustration instead of a live camera. Google sign-in opens Good intentions.

Google accounts can open college email verification from **Settings → Account → College verification → Verify** after onboarding. College email sign-up still uses its sign-up verification code.

The preview link and screen overrides work only in development builds. The normal app flow remains available after closing the preview.
