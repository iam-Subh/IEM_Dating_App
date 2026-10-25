# Remaining onboarding designs

Checked against the active screen components on 7 October 2026.

## Completed in this change

- Face check: verified result.
- Face check: pending review result.
- College verification: apply the shared email form and inbox code design.
- Profile media correction: one page for main photo, another photo, and profile video.

## Remaining page designs: 0

`MediaCorrectionPage.tsx` handles all three media correction types. It shows one expanded card and compact cards for the other affected items. Passed items and items under review remain separate.

The college verification reminder sheet also needs redesign. `VerifyRulesScreen.tsx` uses one layout for 12 entry reasons.

The active 17-step profile setup flow has no other page awaiting an initial redesign. Its forms, pickers, camera, failure page, and profile review use the current design. This count does not mean that all device sizes and service states have completed testing.

The saved Batch, Campus, and Distance routes reuse the combined Studies, College, and Matching pages. They are not additional designs. The unused media introduction route is not part of the active setup flow.
