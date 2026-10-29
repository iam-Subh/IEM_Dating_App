# Standouts growing bouquet

The three prompt files use the same style block and pot geometry. Attach `apps/mobile/assets/illustrations/standouts-rose-bouquet.png` as the style reference. After the sprout image is generated, attach it too when generating the other stages.

| Swipes | Output |
|---|---|
| 0–4 | standouts-growing-sprout.png |
| 5–9 | standouts-growing-buds.png |
| 10–14 | standouts-growing-bloom.png |
| 15 | The existing Standouts unlock flow opens the real set. |

All three images were generated with the built-in OpenAI image generation tool.
They are transparent PNGs in `apps/mobile/assets/illustrations/`.
The sprout image supplied the pot reference for both later stages.
The selected prompts are saved at the top of the three prompt files.

`growingArtwork` in `apps/mobile/src/features/discovery/components/StandoutsLearning.tsx`
now loads a separate image for each range. The original full bouquet remains
in the About Standouts page.

The page reads the real swipe count and required count. It selects the three stages at one-third and two-thirds of the required count. The current requirement is 15 swipes.
The real Standouts screen refreshes when users return from Explore during learning.
The server unlocks the real set after 15 swipes. The preview controls simulate 0–15
swipes without changing account data.

First-visit flow:

1. Tap Standouts in Explore to open Learn more.
2. Select Close or Got it, or press Android Back, to show swipe progress.
3. After 15 swipes, tap Standouts again to load the real set.
4. The two cards inside the Standouts icon exchange places during loading.
   Each heart reveals after its card settles at the front.
   The icon then fades out over 180 ms.
   The profile list has no permanent bouquet, unlock heading, or swipe counter.

`StandoutsLoading` is shared by the app and browser preview. Reduce Motion
keeps the icon still. The icon frame does not move, tilt, or scale. Each card
selection takes 1100 ms. Two selections form one continuous loop. The cards
exchange layers while separated, so there is no visible depth jump.
Leaving the screen or backgrounding the app stops motion. Real requests
have no minimum animation delay. The browser preview uses a 2400 ms
simulated response so the complete loop can be reviewed.

In the phone app, open Demo tools → Standouts → Standouts animation.
This opens the shared Standouts screen in demo-only mode at 15 swipes.
The replay arrow runs the animation again. The Demo Standouts button also
supports Learn more and swipe progress. Demo counts, profiles, and welcome
state stay local to the demo. No real impressions or swipes are submitted.
