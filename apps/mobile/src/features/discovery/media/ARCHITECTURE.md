# Explore media architecture

## Preparation budget

| Resource | Implemented budget |
| --- | --- |
| Profile data | Pages of 20; request the next page at six remaining cards |
| Mounted cards | Current card and next card |
| Image preparation | First two photos of the current card, first two of the next card, first photo of the third card; prepare the following photo as the current card advances |
| Concurrent speculative image requests | Two |
| Video players in the card stack | At most two; only the current card plays |
| Current video buffer target | 10 seconds; Android byte target 16 MiB |
| Next video buffer target | 2 seconds; Android byte target 4 MiB |

These are initial tuning values, not measured guarantees. Native players can exceed a target for individual samples. No image or video is recompressed by this pipeline.

## Ownership and rendering

`DiscoverScreen` owns the data queue, swipe state, and preparation policy. `SwipeCard` owns its selected media index and progress. `CardVideo` owns one native player and its retry lifecycle. The player remains mounted when the next card becomes current. It changes buffer policy without replacing its source.

The front card mounts its selected photo plus the next two and the previous one, so a tap shows a decoded photo at once; the card behind it mounts only the photo it shows. Mounted image views download outside the request budget, which is why the window stays this small. The selected media index and the progress bar are shared values written by the tap itself, so the photo changes on the UI thread before React re-renders. The image queue replaces obsolete pending requests when the stack changes. Native image requests already in flight cannot be cancelled; they are limited to two. Completed-request bookkeeping is bounded to 128 URLs and does not itself guarantee native cache retention.

A video uses its original URL with Expo caching enabled. The card cover is a poster until the first video frame appears. It is a profile photo, not a generated video thumbnail. On rebuffering, keep the last frame and stop progress updates. Left/right taps remain available. Media failure never automatically skips a profile or photo.

## Playback and connection pressure

1. Load the current item first. Start videos muted.
2. After priority photos finish preparing and current media reports ready for one second, permit the next card's video to preload.
3. If current media loads, buffers, or fails, release the next video player. Continue the three-card photo preparation window independently of video state. Photo failure prevents speculative video preparation but does not prevent current playback or manual photo navigation.
4. Pause playback and progress during a drag. Resume the saved position when the card returns. End the outgoing playback when its card unmounts.
5. Pause autoplay when the app loses focus or settings or the demo cover the screen, and stop new speculative work. In the expanded profile photos do not auto-advance (taps still change them), a video plays only while the photo area is on screen, and later photos sit between sections and download as they scroll near.
6. Retry video errors automatically at 1.5 and 4 seconds, at most twice per manual retry cycle. Preserve playback position. Manual Retry uses asynchronous source replacement and reuses cached bytes.
7. After eight seconds without readiness, show a neutral slow-loading message with Retry. Error state also exposes Retry. Swipe and photo taps remain available.

Buffering is the pressure signal. This implementation does not classify Wi-Fi, mobile data, or airplane mode. Cached video ranges can play offline; missing ranges still require a connection. The active paused player can retain its bounded buffer. App-wide disk-cache size follows the existing Expo configuration and is not changed here.

## Server follow-up: not implemented in this change

- Verify CDN byte-range requests, correct content types, stable cache keys, and signed-URL validity for the entire viewing session.
- Generate an actual poster and provide media duration and dimensions in the discovery response.
- Consider optional adaptive streaming renditions for poor connections. Preserve the original upload. This needs separate quality controls and server processing; client buffering cannot overcome bandwidth below the original video's bitrate.
- Add measured first-frame time, buffering time, cache-hit rate, and swipe-to-ready latency before changing the budgets.

## Verification

Automated: TypeScript, Babel worklet compilation, and `node --test tests/discoveryMedia.test.cjs` from `apps/mobile`.

Device checks still required: alternate photo/video cards, swipe ten cards quickly, pause a half-played video with a drag, open/close expanded profiles, background/foreground the app, throttle bandwidth below the video bitrate, disable the network after caching, and retry failed media. Confirm there is never background audio, duplicate media advancement, or more than two stack players. Record cold and cached first-frame times before claiming a latency target.

References:
- https://docs.expo.dev/versions/latest/sdk/video/
- https://developer.android.com/media/media3/exoplayer/preloading-media/preloadmanager
- https://developer.android.com/blog/posts/elevating-media-playback-a-deep-dive-into-media3-part-2
