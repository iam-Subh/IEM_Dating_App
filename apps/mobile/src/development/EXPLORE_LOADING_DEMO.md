# Explore loading review

The user approved this design for the real Explore screen.
The scenario controls below remain isolated development tools.

Open **Explore → flask icon → Demo cards → Learn → Loading**.
The browser preview is `/reminders/explore-loading/index.html`.
Add `?mode=empty` to start with the existing cat empty state.
Build it with `node scripts/build-explore-loading-preview.cjs`.

The demo uses the signed-in avatar passed from the existing profile cache.
The browser uses a sample avatar. The result card is a sample profile.
No preferences, location, Likes, or account data are written.

Scenarios: app opening, preferences, location, slow response, failure, empty
results, and an instant result. Retry recovers from the simulated failure.
Empty results use `discover-kitten.png`, the existing copy, and all three
existing action labels. The buttons only change demo states. Standouts opens
a local sample profile; Back returns to the cat screen.
**Show result now** ends the simulation immediately. Switching scenarios
cancels the previous timers. Closing the demo cancels all timers and motion.

Two rings expand and fade in 1600 ms cycles, staggered by 800 ms. They start
after 600 ms. The first profile fades in over 180 ms. Reduce Motion uses one
static ring. Backgrounding the app stops the ring motion.

`DiscoverScreen` uses `ProfileSearchLoading` for real recommendation requests
and actual phone location acquisition. It uses the signed-in profile photo.
The demo and the real screen share the same ring renderer.

Real loading stops when the response and first media are ready. Media can
hold the reveal for at most two seconds after the response. The card then
shows its existing media fallback. No demo completion timers run in Explore.
The newest refresh cancels an older request and rejects stale responses.
Permission denial keeps the location gate. Failed requests show Retry.
Empty results keep the existing cat and navigation actions.
