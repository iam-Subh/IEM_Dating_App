# Stories: Instagram parity spec

This is the target behaviour for Stories in IEM Connect, taken from Instagram, and the plan to get there. Each behaviour is marked by where it comes from:

- **[source]**: stated in a published reference, linked at the end.
- **[convention]**: how Instagram behaves in current builds, without a published spec. Timings and sizes are starting values to tune on a device.

## 1. Stories tray

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Row of circular avatars | Horizontal scroll above the content, name under each avatar | [source] |
| Unseen ring | Orange → pink → purple gradient ring around the avatar | [source] |
| Seen ring | Thin grey ring once every story from that person has been watched | [source] |
| Order | Your own story first. Then people with unseen stories, newest first. People you have fully watched move to the end | [source] |
| Your story | Your avatar with a small "+" badge when you have no active story. Tap opens the composer. With active stories, tap opens them and the badge adds another | [convention] |
| Opening | Tap opens that person at their **first unseen** story, or the first story if all are seen | [convention] |
| Loading | While the first story loads, the ring animates as a spinner in place of the gradient | [convention] |
| Close Friends | Green ring | [source]; built in Part 2 (`STORY_AUDIENCE_SPEC.md`) |

## 2. Viewer layout

- Full-screen black background. Media is shown 9:16, fitted to the width, with the corners slightly rounded. [convention]
- A soft dark gradient behind the top (progress bar and header) and behind the bottom (reply bar), so white UI stays readable on bright media. [convention]
- **Progress bar** (top): one segment **per story of the person being viewed**, not per story in the whole tray. About 2 dp tall with gaps of about 4 dp. The track is translucent white and the fill is solid white. [source: segments; convention: sizes]
- **Header** (under the bars): avatar, name, and time since posting ("5h"). On the right: mute/unmute (video stories only), the more menu (…), and close (✕). [source]
- **Footer** (someone else's story): "Send message" pill input, a heart like button, and a share (paper plane) button. [source]
- **Footer** (your own story): viewer count with avatars ("Activity"). Tap or swipe up opens the viewer list; the more menu holds delete. [source: viewer list; convention: layout]

## 3. Timing and the progress bar

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Photo duration | 5 s by default | [source] |
| Video duration | The video's own length. Uploads here are capped at 15 s by the composer, and the server limit is 50 MB | [source] |
| Fill | Only the active segment moves, linearly from 0 to 100%. Earlier segments are full and later ones empty | [source] |
| Video sync | The fill follows playback time, so it stops while the video buffers | [convention] |
| Waiting for media | The bar does not start until the story's media is on screen | [convention] |
| Jumping | Tapping to another story resets the segments before and after it | [source] |

## 4. Gestures

| Gesture | Result | Basis |
| --- | --- | --- |
| Tap right side | Next story. On the person's last story, moves to the next person | [source] |
| Tap left side | Previous story. On the person's first story, moves to the previous person | [source] |
| Tap zones | About the left third is "back" and the rest is "forward", since forward is far more common | [convention] |
| Press and hold | Pauses the bar and the video. After a short hold (~200 ms) the header, bars and footer fade out, and they fade back in on release | [source: pause; convention: hiding] |
| Swipe left / right | Next / previous person, with a 3D cube rotation that follows the finger. Released past the midpoint or with enough speed it completes, otherwise it springs back | [source: navigation; convention: cube] |
| Swipe down | Closes the viewer. The story shrinks and the background fades as the finger moves; a short drag springs back | [source] |
| Swipe up | Opens the reply keyboard, or the viewer list on your own story | [source: reactions] |
| Finishing the last person | The viewer closes | [convention] |

## 5. Replies, reactions and likes

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Reply | Typing in "Send message" pauses the story. Sending delivers it as a direct message that references the story | [source] |
| Quick reactions | With the reply keyboard open and nothing typed, a panel of eight emojis appears: 😂 😮 😍 😢 👏 🔥 🎉 💯. Tapping one sends it as a reply, shows the emoji burst across the screen and confirms "Sent" | [source: eight emojis; convention: burst] |
| Like | The heart toggles a private like. The author sees it in their viewer list, and it does not send a message | [source] |
| Share | Instagram only allows sharing a story from a public account. Stories here are followers-only, so there is **no share button**, which is what Instagram shows on a private account's story | [source] |

## 6. Seen state and loading

- A story counts as seen once its media has actually been on screen, not when the viewer opens. [convention]
- The ring turns grey when every active story from that person has been seen, and updates when the viewer closes. [source]
- The next two stories' media is fetched ahead of time, so a tap forward shows it at once. [convention]
- Playback pauses while the app is in the background, while a sheet or menu is open, and while the reply keyboard is open. [convention]

## 7. Current app compared with the target

| Area | Today | Target |
| --- | --- | --- |
| Tray | None in the app. The demo tray exists only in demo mode | Real tray on Explore |
| Progress bar | One segment per story across **all** people; a React state update every 80 ms | Segments per person, driven on the UI thread |
| Photo / video duration | 6 s for everything; videos loop | 5 s for photos; videos use their own length |
| Pause | **Any** touch pauses, including a tap | Only a press and hold pauses; a hold hides the UI |
| Between people | Not possible | Swipe with a cube transition, plus tap past the ends |
| Close | ✕ button only | Swipe down to close, plus ✕ |
| Reactions / like | None | Eight quick reactions and a heart like |
| Seen state | Recorded 700 ms after opening, even if the media never loaded | Recorded once the media is on screen; the tray ring reflects it |
| Media URL | Expires after **60 s**, so a paused or buffering video fails partway | Valid long enough to finish watching |
| Header | Name only | Avatar, name, time posted, mute for video, more menu, close |
| Your story | Viewer list behind the more menu | Footer with viewer count; swipe up opens the list |

## 8. Implementation plan

### Server (`apps/api`)

1. **`GET /stories/tray`**: active stories grouped by person, in tray order (you first, then unseen by newest, then seen). Each story carries `seen`, `liked` and `contentType`; your own stories also carry `viewCount` and `likeCount`. A video's length comes from the player once it loads, since the server does not store it. Each person carries `hasUnseen` and the index of their first unseen story.
2. **Story likes**: a `story_likes` table and `PUT /stories/:storyId/like { liked }`. The viewer list gains a `liked` flag for each viewer.
3. **Media URLs**: signed read URLs last 15 minutes instead of 60 seconds.
4. **Views**: unchanged, but the app now records a view only once the media is on screen.
5. Existing rules stay the same: followers-only visibility, blocks, mutes, replies only between matches, and a limit of 20 active stories.

### App (`apps/mobile/src/features/stories`)

- `StoryTray`: the ring row (gradient, grey or loading spinner) and "Your story", placed on Explore under the page header. The custom bottom navbar is not touched.
- `StoryViewerScreen`: rewritten. It opens on a person and walks all of them in tray order.
- `StoryProgressBar`: segments for one person, filled from a Reanimated shared value. For a photo the fill is a 5 s timing; for a video it follows playback time. Pausing cancels the timing and resuming continues from the current value.
- `StoryPlayer`: the photo or video for a story. It reports when the media is ready (which starts the bar and records the view) and when the video ends.
- Gestures with Gesture Handler: tap zones, long press (pause, then hide the UI), horizontal pan (cube between people), vertical pan (close or reply).
- `StoryFooter`: the reply input, the quick reaction panel with its emoji burst, and the like heart. On your own story it becomes the viewer count and opens the viewer sheet.
- Media for the next two stories is fetched ahead of time; source URLs are cached for the length of their validity.

### Demo mode

The Explore demo shows the same tray and viewer built from the demo profiles. Each demo person has up to three photo Stories, and the first also has a 10 s sample video. One person is partly watched and two are fully watched, so every ring state appears. There is also a demo "Your story" with sample viewers and likes. Nothing reaches the server: views, likes and replies stay local, and posting is turned off. In demo mode the viewer opens in a modal, because the demo is itself shown in one.

### Out of scope for this phase

- The composer (camera, text, stickers, music, custom photo duration). It stays the current pick-and-post screen.
- Close Friends, highlights, and splitting long videos into 15 s segments (uploads are already capped at 15 s).

## 9. Verification

- **Server:** a non-destructive integration test for tray grouping and order, seen and liked flags, likes, and the viewer list. It creates its own users and removes only them.
- **App:** type-check, plus unit tests for tray ordering, first-unseen selection, and the next and previous story rules across people.
- **On device:**
  - Tap through a person and on into the next.
  - Hold to pause and check the UI hides and returns.
  - Swipe between people and cancel a swipe halfway.
  - Swipe down to close.
  - React and like.
  - Background the app mid-video.
  - Check the ring turns grey after watching.

## 10. Revision 2: Activity sheet, auto-advance and swipes

### Activity sheet on your own Story

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Opening | Swipe up on your own Story, or tap "Activity" in the footer. The footer shows up to three viewers' avatars | [source] |
| Sheet type | A Material 3 **standard** bottom sheet, the kind Android uses. It has no scrim, so the Story above is not darkened | [source] |
| Shape | 28 dp top corners, `colorSurfaceContainerLow` background, 1 dp elevation, up to 640 dp wide | [source] |
| Drag handle | A 32 × 4 dp pill inside a 48 dp touch area | [source] |
| States | Opens half expanded (50%), drags up to fully expanded, and drags down to close. A fling faster than 500 px/s moves one state in its direction | [source] |
| The Story | Shrinks into the space above the sheet while its bars, header and footer fade out. A tap above the sheet closes it | [convention] |
| Back | Closes the sheet first, then the viewer | [convention] |
| List | Name, avatar and a heart for viewers who liked the Story | [source] |

### Photos skipping after a Story ends

- **Cause:** the photo timer read the bar's value from JavaScript. That read returns the UI thread's current value, and a reset to zero sent a moment earlier had not reached it yet. A photo that followed a finished photo saw a full bar, got a zero-length timer and advanced at once. The next photo did the same, until a video (which does not use the timer) stopped the chain.
- **Fix:** every reset, pause and timer start runs on the UI thread in the order it was issued. A finished timer moves on only if its own Story is still showing.

### Swipes

| Gesture | Detail | Basis |
| --- | --- | --- |
| Swipe left / right | Next or previous person, with the cube following the finger; springs back when released early. After the last person, it closes | [source] |
| Swipe down | Closes the viewer; the Story shrinks and the background fades with the finger | [source] |
| Swipe after a hold | Resting a finger to pause and then moving it still swipes. Holding used to block the swipe | [convention] |
| Diagonal down on a first Story | Instagram skips to the next person's first Story. **Not implemented**, since it is easy to trigger by accident | [source] |

## Sources

- [Instagram Story length and photo duration (Outfy)](https://www.outfy.com/blog/instagram-story-length/)
- [Instagram Story length guide (SocialRails)](https://socialrails.com/blog/instagram-story-length-complete-guide)
- [Rebuilding Instagram's segmented progress bars (DEV)](https://dev.to/dev48v/i-rebuilt-instagram-stories-segmented-progress-bars-4bil)
- [Instagram's story swipe and tap protocol (GoodUX)](https://goodux.appcues.com/blog/instagrams-story-swipe-and-tap-protocol)
- [Instagram Stories navigation explained (Flinque)](https://www.flinque.com/blog/instagram-stories-navigation-explained/)
- [Instagram Story icons explained (Slidy)](https://slidycreator.com/blog/instagram-story-icons-explained/)
- [Instagram quick emoji reactions (.ART)](https://www.art.art/post/instagram-quick-emoji-reactions-to-use-or-to-disable)
- [How to react to an Instagram Story (InstantDM)](https://instantdm.com/blog/how-to-react-on-instagram-story)
- [Story ring colours (Techlicious)](https://www.techlicious.com/tip/instagram-icon-meanings-explained/)
- [Green ring for Close Friends (Alphr)](https://www.alphr.com/instagram-stories-green-circle/)
- [Instagram testing a bottom progress bar (PiunikaWeb)](https://piunikaweb.com/2026/05/13/instagram-testing-stories-progress-bottom/)
- [Material 3 bottom sheets](https://m3.material.io/components/bottom-sheets/overview)
- [Material Components for Android: BottomSheet](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md)
- [Instagram Story viewer list (Pallyy)](https://pallyy.com/blog/how-does-instagram-organize-story-views)
- [Instagram Story gestures (AndroidGuias)](https://en.androidguias.com/instagram-stories-gestures/)
