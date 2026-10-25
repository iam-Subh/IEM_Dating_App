# Stories, Part 1: Creating a story (Instagram parity)

This document specifies everything a person can do while making a story, how each feature works, and how the app, native code and server fit together to deliver it. It covers creation only. Who can see a story (Close Friends, hiding from people, reply controls) is Part 2. Viewing is already specified in `STORIES_SPEC.md`.

Each behaviour is marked by where it comes from:

- **[source]**: stated in a published reference, listed at the end.
- **[convention]**: how Instagram behaves in current builds without a published spec. Sizes and timings are starting values to tune on a device.
- **[decision]**: a choice made for this app, with the reason given.

---

## Contents

1. [The creation flow at a glance](#1-the-creation-flow-at-a-glance)
2. [Camera](#2-camera)
3. [Choosing from the gallery](#3-choosing-from-the-gallery)
4. [The editor canvas](#4-the-editor-canvas)
5. [Text](#5-text)
6. [Drawing](#6-drawing)
7. [Filters and effects](#7-filters-and-effects)
8. [Stickers](#8-stickers)
9. [Music](#9-music)
10. [Timing: photo duration and long videos](#10-timing-photo-duration-and-long-videos)
11. [Sharing and drafts](#11-sharing-and-drafts)
12. [Architecture](#12-architecture)
13. [Server: data model and API](#13-server-data-model-and-api)
14. [Limits](#14-limits)
15. [Safety for a college dating app](#15-safety-for-a-college-dating-app)
16. [Build plan](#16-build-plan)
17. [Verification](#17-verification)
18. [Sources](#sources)

---

## 1. The creation flow at a glance

```
Stories tray "+"  ──►  Camera  ──►  Editor  ──►  Share sheet  ──►  Upload + publish
                         │            ▲   │
                         └─ Gallery ──┘   └─► Save draft (on device, 7 days)
```

| Screen | What happens there |
| --- | --- |
| **Camera** | Capture a photo or video in one of the camera modes, or swipe up to open the gallery |
| **Editor** | One page per selected item. Add text, drawing, stickers, music and a filter; set photo duration; trim video |
| **Share sheet** | Choose the audience (Part 2), then share. Several items publish in order as consecutive stories |
| **Upload** | Runs in the background with a progress ring on your tray avatar; a failure keeps the draft so nothing is lost |

---

## 2. Camera

### 2.1 Capture

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Tap the shutter | Takes a photo | [source] |
| Hold the shutter | Records video while held, up to **60 s**. A ring round the shutter fills over the 60 s | [source: 60 s; convention: ring] |
| Zoom while recording | Slide the finger up from the shutter to zoom in and down to zoom out, without letting go | [convention] |
| Pinch | Zooms in any mode | [convention] |
| Flip camera | A button, or a double tap on the preview, switches front and back, also while recording | [convention] |
| Flash | Off / on / auto for photos; the torch stays on while recording. The front camera uses a white screen flash | [convention] |
| Focus | Tap the preview to focus and set exposure there | [convention] |
| Mode rail | A vertical rail on the left edge switches modes: Create, Boomerang, Layout, Hands-free, Dual | [source] |
| Close | ✕ asks to discard if anything was captured | [convention] |

### 2.2 Modes

| Mode | How it works | Basis |
| --- | --- | --- |
| **Normal** | Photo on tap, video on hold | [source] |
| **Create** | No camera. A full-screen colour or gradient background to type on, tap the background swatch to change it. Also offers ready prompts (for example "Add Yours" templates) | [source] |
| **Boomerang** | One tap records about one second of burst frames and plays them forward and back in a loop. The editor offers four variants: **Classic**, **SloMo** (half speed), **Echo** (motion blur trail) and **Duo** (speeds up then rewinds), plus a trim handle for the loop | [source] |
| **Layout** | Splits the screen into a grid. Choose a grid (2 side by side, 2 stacked, 3, 4 as 2×2, 6 as 2×3), then fill each cell by taking a photo or picking one from the gallery. Tap a filled cell to retake or remove it | [source] |
| **Hands-free** | Tap once to start recording and tap again to stop, up to 60 s | [source] |
| **Dual** | Records the front and back cameras at once, one as a movable inset over the other, switchable between picture-in-picture and split screen | [source] |

### 2.3 Gallery shortcut

A thumbnail of your latest photo sits beside the shutter. Tap it or swipe up on the preview to open the gallery (section 3). [source]

---

## 3. Choosing from the gallery

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Grid | Recent photos and videos, newest first, with album switching and a Videos filter | [convention] |
| Select multiple | A "Select" button enables multi-select of up to **10** items, numbered in tap order | [source] |
| Result | Each selected item becomes its own story, published in selection order | [source] |
| Per-item editing | The editor shows a strip of the selected items; each one is edited separately | [source] |
| Long videos | A video longer than 60 s is split into 60 s parts, each a story (section 10.2) | [source] |
| Layout from gallery | In Layout mode the picker fills the next empty cell | [source] |

---

## 4. The editor canvas

The editor works on a **1080 × 1920 canvas** (9:16) regardless of screen size. Every element is positioned in canvas coordinates, so a story looks the same on every phone.

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Media fit | A 9:16 photo or video fills the canvas. Any other shape is shown whole on a background sampled from its dominant colours, which can be changed | [convention] |
| Reposition media | Pinch to zoom, drag to move and two-finger twist to rotate the photo or video itself | [convention] |
| Background | Tap an empty area with the colour tool to cycle through gradient backgrounds sampled from the media | [convention] |
| Layers | Text, drawings and stickers stack in the order added. Pinch to resize, twist to rotate, drag to move any of them | [source] |
| Snap guides | Dragging near the centre lines or the safe margins shows a guide and snaps | [convention] |
| Safe area | Top and bottom bands where the viewer's progress bar, header and reply bar sit are marked while dragging, so nothing important hides under them | [convention] |
| Delete | Drag an element onto the bin at the bottom to remove it; the bin grows as the element nears it | [convention] |
| Undo | Undo steps back through the last actions in the current tool | [convention] |
| Toolbar | Top right: Text **Aa**, Stickers, Music, Draw, Effects, Save to device, Photo duration (photos only), More (mute, trim) | [source] |

---

## 5. Text

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Open | The **Aa** button, or tapping an empty area of the canvas | [source] |
| Fonts | A horizontal font picker. The classic set is **Classic, Modern, Neon, Typewriter, Strong**, and current builds add more, including **Signature, Editor, Bubble, Squeeze, Poster, Deco and Elegant** | [source] |
| Colour | A palette row; press and hold a swatch for a full spectrum; an eyedropper picks a colour from the photo | [source: palette; convention: eyedropper] |
| Background | A toggle cycles: none, a solid rounded highlight behind each line, and a translucent highlight | [convention] |
| Alignment | Left, centre, right | [convention] |
| Animation | An animate toggle plays an entry animation matched to the font (for example typewriter reveal for Typewriter) | [source] |
| Size | A vertical slider on the left while typing; pinch afterwards | [convention] |
| Mentions and hashtags | Typing `@name` or `#tag` offers suggestions and turns the text into a mention or hashtag (section 8) | [source] |
| Edit later | Tap existing text to edit it | [convention] |

---

## 6. Drawing

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Brushes | **Pen**, **Arrow** (draws a stroke with an arrowhead), **Marker** (flat chisel), **Neon** (glowing outline of the colour), **Highlighter** (translucent), **Eraser** | [source] |
| Size | A slider on the left sets the stroke width | [source] |
| Colour | Palette row, press and hold for the spectrum, eyedropper | [source] |
| Fill | Press and hold on the canvas with a colour selected to cover it with that colour; then erase to reveal the photo through it | [source] |
| Eraser | Rubs out strokes, and a fill, where the finger passes | [source] |
| Undo | Removes the last stroke | [convention] |
| Done | Returns to the editor; strokes stay editable until the story is shared | [convention] |

---

## 7. Filters and effects

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Colour filters | Swipe left or right across the editor to move through colour filters; the filter's name flashes on screen | [source] |
| Filter set | About a dozen colour looks (for example warm, cool, faded, high contrast, black and white), each a colour lookup applied to photo and video alike | [convention] |
| Camera effects | The camera offers effects before capture: face effects (masks, beauty/retouch), background effects and world effects, chosen from a row beside the shutter | [source] |
| Retouch | A light skin-smoothing toggle for the front camera | [convention] |

---

## 8. Stickers

The sticker tray opens from the sticker button as a sheet with a search field. Stickers fall into three groups.

### 8.1 Decorative stickers (become part of the image)

| Sticker | How it works | Basis |
| --- | --- | --- |
| **GIF** | Search animated GIFs (GIPHY) and place them. They animate in the story | [source] |
| **Emoji** | Any emoji as a large sticker | [convention] |
| **Time / Date** | Shows the capture time; tap it to cycle styles | [convention] |
| **Photo** | Places a photo from the gallery on top of the story, with shape styles (rounded, circle, border) | [source] |
| **Selfie** | Takes a front-camera photo right there and places it as a sticker with shape and effect styles | [source] |
| **Cutouts** | Pick a photo or video; the subject is cut out automatically and becomes a sticker, which is also saved for reuse | [source] |
| **Frames** | Wraps a photo in an instant-print frame with a caption. Viewers shake the phone, or tap "Shake to reveal", to develop it | [source] |

### 8.2 Interactive stickers (viewers act on them)

| Sticker | How the creator sets it up | What viewers do | What the creator sees | Basis |
| --- | --- | --- | --- | --- |
| **Mention** | Type `@` and choose a person | Tap it to open the person's profile. The person is notified and can share it to their own story | Who was mentioned | [source] |
| **Location** | Search a place | Tap it to see the place | — | [source] |
| **Hashtag** | Type a tag | Tap it to see the tag | — | [source] |
| **Link** | Paste a URL and optionally custom link text | Tap it to open the link | Link taps in Activity | [source] |
| **Poll** | A question and up to 4 options (2 by default), with colour styles | Tap an option; results appear as percentages right away | Vote counts and who voted for what | [source] |
| **Quiz** | A question, up to 4 options, and the correct answer marked | Tap an answer; it turns green or red and the correct one is shown | Who answered what, and the share correct | [source] |
| **Question** | A prompt such as "Ask me anything" | Type a reply into the sticker and send it | A list of replies; each can be shared as its own story, with the asker kept anonymous, or answered in chat | [source] |
| **Emoji slider** | A question and an emoji | Drag the emoji along a scale to rate | The average position and each person's rating | [source] |
| **Countdown** | A name and an end date and time | Tap "Remind me" to be notified when it ends | Who asked to be reminded; everyone subscribed is notified at the end | [source] |
| **Add Yours** | A prompt, such as "Show your hostel view" | Tap to add their own story to the prompt thread; see how many joined and browse the thread | Everyone who joined | [source] |
| **Add Yours Music** | A song prompt | Add the song that matches their mood to the thread | Everyone who joined | [source] |
| **Reveal** | A hint; the story is shown blurred | Send the creator a message to unblur it | Who messaged | [source] |
| **Captions** | Tap on a video with speech | Captions appear in time with the audio, in selectable styles | — | [source] |

### 8.3 Music (section 9)

---

## 9. Music

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Find | Search by song, artist or album; the sheet opens on **Trending** before you type | [source: search and browse; decision: the JioSaavn "Now Trending" playlist as the Trending list] |
| Song row | Artwork, title, artists, duration, an **E** badge for explicit songs, and a play button to preview | [convention] |
| Clip | Pick the section with a scrubber over the song; the clip length is up to **15 s** on a photo and matches the video length on a video | [source] |
| Display | Styles: **lyrics** (word by word in time, with several fonts), **album art card**, **title-and-artist card**, or **hidden** (music plays with no sticker) | [source] |
| Lyrics colour | A colour wheel changes the lyric colour | [source] |
| On a video | The song plays over the video; the video's own sound can be kept or muted | [convention] |
| Playback | Viewers hear the clip; tapping the sticker shows the song name and artist | [convention] |
| No lyrics found | The lyrics style is greyed out with "Lyrics aren't available for this song"; the other styles still work | [convention] |

### 9.1 Where songs and lyrics come from

**[decision]**, chosen by the product owner.

| Need | Source | What it provides |
| --- | --- | --- |
| Catalogue, artwork, audio | **JioSaavn**, through the unofficial API deployed at `https://my-saavan-api.vercel.app` (an instance of the open-source `sumitkolhe/jiosaavn-api`) | Search, song details, playlists, artwork in 50/150/500 px, and AAC streams at 12, 48, 96, 160 and 320 kbps |
| Timed lyrics | **LRCLIB** (`https://lrclib.net`), a free, open-source lyrics database with synced LRC lyrics. No API key, and no rate limit is published | Line-timed lyrics (`syncedLyrics`), plain lyrics (`plainLyrics`), and an `instrumental` flag |

LRCLIB was chosen over the alternatives for these reasons:

- It is the only free, keyless source with **time-synced** lyrics, which the lyrics style needs.
- Its code is open (MIT).
- It publishes database dumps, so it can be self-hosted if the public service ever becomes unreliable.
- JioSaavn's own lyrics are not exposed by this API.

**Checked against the live services on 2026-09-14:**

| Call | Result |
| --- | --- |
| `GET /api/search/songs?query=tum hi ho&limit=1` | `{ success, data: { total, start, results: [song] } }` |
| `GET /api/songs/{id}` and `GET /api/songs?ids=a,b` | `{ success, data: [song] }` |
| `GET /api/search/playlists?query=trending now` | "Now Trending" is playlist `47599074` |
| `GET /api/playlists?id=47599074&limit=n` | The playlist with its songs |
| `GET /api/search?query=` | Mixed results: top query, songs, albums, artists, playlists |
| `GET /api/songs/{id}/suggestions` | **HTTP 500** on this deployment. Not used |
| `GET /api/songs/{id}/lyrics` | **HTTP 404** (route does not exist). Lyrics come from LRCLIB |
| Song fields | `id, name, duration (s), language, explicitContent, hasLyrics, url, copyright, album{id,name}, artists{primary[], all[]}, image[{quality,url}], downloadUrl[{quality,url}]` |
| Stream (`aac.saavncdn.com/…_160.mp4`) | `200`, `Content-Type: audio/mp4`, `Accept-Ranges: bytes`, `Access-Control-Allow-Origin: *`, so it can be streamed and seeked directly |
| API caching | `Cache-Control: s-maxage=300, stale-while-revalidate` |
| LRCLIB `GET /api/get?track_name=Tum Hi Ho&artist_name=Arijit Singh&album_name=Aashiqui 2&duration=262` | Found (LRCLIB lists 261 s): exact match needs track, artist and album, with duration within about 2 s |
| LRCLIB `GET /api/search?q=kesariya arijit` | 20 candidates, each with `duration` and `syncedLyrics` |
| LRCLIB not found | `404 {"name":"TrackNotFound"}` |

### 9.2 How music is wired

```
Music sheet (app)
   │ GET /stories/music/trending | /search?q=&page= | /:trackId | /:trackId/lyrics
   ▼
MusicService (API server)  ── one provider adapter, so the source can be swapped in one file
   │  JioSaavnProvider ──► my-saavan-api.vercel.app   (Redis: search 5 min, song 24 h, trending 30 min)
   │  LrclibLyrics     ──► lrclib.net                 (Postgres: permanent once found, retry after 7 days if not)
   ▼
Normalised MusicTrack { id, title, artists, album, durationMs, language, explicit,
                        artwork{small,medium,large}, streams{preview,standard}, jiosaavnUrl, hasSyncedLyrics }
```

**Why the app never calls either API directly:**

1. The provider can be replaced or switched off without an app release.
2. Responses are cached, so a burst of students searching the same song makes one upstream call.
3. Explicit songs can be filtered in one place.
4. LRCLIB asks clients to identify themselves, which the server does with `User-Agent: IEMConnect/<version> (<contact URL>)`.
5. The Vercel deployment's outages and 500s are absorbed by the cache and turned into one clear error.

**Song search and details.**

- `JioSaavnProvider` maps the song fields to `MusicTrack`:
  - Primary artists are joined with ", ".
  - Artwork: 150 px for rows and 500 px for the sticker.
  - Streams: 96 kbps for previews and viewer playback, 160 kbps for mixing into video.
- HTML entities in names (`&quot;`, `&amp;`) are decoded.
- Explicit songs are hidden unless the viewer's settings allow them **[decision]**.

**Lyrics matching** (`LrclibLyrics`, run on the server when a song is first opened in the lyrics style):

1. Call `GET /api/get` with the track name, first primary artist, album and duration in whole seconds.
2. If that returns 404, call `GET /api/search?track_name=&artist_name=`. Keep candidates whose duration is within **3 s** of the song's, prefer ones with `syncedLyrics`, and take the one closest in duration.
3. If that also misses, search with the title cleaned of suffixes such as "(From …)", "- Remix" and "feat.", then repeat step 2.
4. Parse `syncedLyrics` (LRC `[mm:ss.xx] text`) into `[{ startMs, endMs, text }]`: each line ends where the next begins, and the last line ends at the song's end. Empty lines are kept as gaps.
5. Save the result in `music_lyrics`, which records `found`, `plain_only`, `instrumental` or `not_found`. A `not_found` result is retried after 7 days, since LRCLIB grows by contribution.

**Lyric display.** LRCLIB times lines, not words. The lyrics style shows the current line, revealing its words across the line's duration (each word's time proportional to its length) **[decision]**. The clip scrubber shows the lyric at the scrub position, so people can pick a clip by the words they want.

**In the editor.**

- The preview plays the 96 kbps stream with `expo-audio`, seeking to the clip start and looping the clip.
- On a **photo**, the clip plays over the photo and the story lasts the clip length (up to 15 s).
- On a **video**, the clip length equals the video length (up to 60 s per part). A toggle keeps or mutes the video's own sound, and a balance slider sets the mix.

**What a story stores.** The composition keeps the song's identity and a snapshot of what to show, never an audio URL: `provider`, `trackId`, `title`, `artists`, `artworkUrl`, `startMs`, `lengthMs`, `display`, `lyricStyle`, `color` and the sticker transform. The snapshot lets the sticker render even if the music API is down. Stream URLs are looked up fresh when played, so a changed CDN path never breaks old stories.

**How the audio reaches viewers.**

| Story | Audio path |
| --- | --- |
| **Video** | The background export step (11.2) downloads the 160 kbps AAC file into the job folder, and Media3 mixes the clip into the exported MP4, trimmed and faded 300 ms at each end. Viewers play one file with sound and picture in sync, and no music call happens at view time |
| **Photo** | The viewer's source loader (`storySources.ts`) calls `GET /stories/music/:trackId` (cached) together with the photo, pre-buffers the 96 kbps stream from `startMs`, and starts audio when the photo has drawn. The progress bar follows audio time, like video stories, so a buffering song holds the bar instead of drifting out of sync |
| **Lyrics sticker** | The viewer fetches `GET /stories/music/:trackId/lyrics` with the source and draws the lines against audio time (photo) or video time (video) |
| **Music unavailable at view time** | Photo stories play silently for their stored length; the sticker still shows title and artwork |

**Attribution.** Tapping the music sticker shows the song, artists and artwork, with **Open in JioSaavn** linking to the song's `url` **[decision]**.

---

## 10. Timing: photo duration and long videos

### 10.1 Photo duration

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Default | A photo story shows for **5 s** | [source] |
| Adjust | A clock button in the editor sets **1 to 15 s** | [source] |
| With music | A photo with music lasts as long as its music clip | [source] |

### 10.2 Videos

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Continuous length | A video story plays up to **60 s** as one story | [source] |
| Longer videos | A video over 60 s is cut into consecutive **60 s parts**, each its own story in sequence | [source] |
| Trim | A trim timeline selects the part to post; mute and a cover frame are available (already built for chat media) | [convention] |

---

## 11. Sharing and drafts

| Behaviour | Detail | Basis |
| --- | --- | --- |
| Share | "Your story" publishes. With several items they publish in order, a moment apart, as consecutive stories | [source] |
| Save to device | A download button saves the edited story with everything flattened | [source] |
| Drafts | Leaving the editor offers **Save draft**. Drafts live on the device, show a countdown and are deleted after **7 days** | [source] |
| Draft count | Up to 20 drafts at once | [source] |
| Resume | Drafts appear in the gallery picker's Drafts album and reopen in the editor with every layer still editable | [source] |
| Progress | While uploading, your tray avatar shows a progress ring; a failed upload offers Retry and keeps the draft | [convention] |

### 11.1 Posting in the background

On Instagram, tapping Share returns you to the feed straight away. The story finishes posting while you keep using the app, switch to another app or lock the phone. This app must do the same.

**What the person sees**

| Moment | Behaviour | Basis |
| --- | --- | --- |
| Tap Share | The editor closes within about 300 ms and you land back where you started. You never wait on a spinner | [convention] |
| While posting | Your avatar in the tray shows an animated ring filling with overall progress. Tapping it opens your story with a **Posting…** label at the bottom instead of the viewer count | [convention] |
| Several items | They post in order. Each one appears in your story as soon as it is done; the ring stays until the last one | [source: order; convention: ring] |
| App in background or closed | Posting continues. Android shows a quiet notification, "Posting your story", with a progress bar, as it must for long background work | [decision] |
| No connection | Posting waits and resumes by itself when the connection returns, from where it stopped rather than from zero | [convention] |
| Phone restarted | Posting resumes after the restart | [decision] |
| Posted | The ring turns into your normal story ring; the notification disappears. If you had left the app, a brief "Your story was posted" notification appears | [convention] |
| Failed | The tray ring turns red with a **!**. Tapping it opens **Couldn't post** with **Try again** and **Discard**. A notification with the same actions appears if you are outside the app. The story is kept as a draft either way | [convention] |
| Cancel | While posting, your story's **Posting…** label has a menu with **Cancel**, which stops the upload and keeps the draft | [convention] |

**What must never happen**

- A story that shows as posted but is missing for viewers, or posted twice after a retry or restart.
- Items appearing out of order.
- Anything posting after you cancelled it or deleted your account.
- The edit being lost because an upload failed.

### 11.2 How background posting works

**Why a JavaScript upload is not enough.** Android pauses JavaScript soon after the app leaves the screen and kills the process whenever it needs memory. A `fetch` PUT restarts from zero after any network drop. So every step after Share runs as an Android **WorkManager** job, and none of it needs JavaScript or an open screen. This is the same approach the chat's resumable uploads use (`modules/chat-media`: `ChatUploads.kt`, `ChatUploadWorker.kt`). Stories reuse it and add two steps, export and publish.

**What the app does before the editor closes** (well under a second):

1. Saves the draft: media file and composition JSON (section 12.2 `drafts/`).
2. Renders what only the app can render:
   - **Photo:** Skia snapshot of the whole story to a 1080 × 1920 JPEG file.
   - **Video:** Skia renders the decorative layers to a transparent PNG overlay. Animated layers (GIFs, animated text) are already stored as animated WebP files from the moment they were placed, so none of this is heavy.
3. Calls `POST /stories/batches` (13.3) with each item's type, duration and interactive stickers. The server checks limits up front and returns the items plus a **publish token**. Storage uploads start later, from the worker, once each file's final size is known.
4. Hands the batch to the native module with `enqueueStoryBatch` and closes the editor.

**What the WorkManager chain does**, one unique chain per batch named `story-batch-{batchId}`, with items run in order:

```
item 1: [export] ─► [upload parts] ─► [publish] ─► item 2: [export] ─► [upload parts] ─► [publish] ─► …
```

| Step | Work | Resume rule |
| --- | --- | --- |
| **Export** (videos only) | Media3 `Transformer` in the worker: trim, filter, overlay PNG and animated WebP layers, music mix, mute, split into 60 s parts. Writes the MP4s to app storage | Output is written to a temporary name and renamed when complete, so an interrupted export simply runs again |
| **Upload parts** | The existing `ChatUploadWorker` loop: 8 MB parts PUT to presigned S3 part URLs, progress saved after each part | The server lists the parts already stored, so a restart skips them. Expired part URLs (24 h) are replaced by asking the server for fresh ones |
| **Publish** | Calls `POST /stories/batches/:batchId/items/:itemId/publish` with the publish token. The server assembles the parts, inspects the bytes, moderates, makes the thumbnail and creates the story | Idempotent on `itemId`: calling it again after a crash returns the story already created |

**Worker settings** (as chat uploads already use):

- Network constraint `CONNECTED`, with exponential backoff from 15 s.
- An expedited request, falling back to normal work when out of quota.
- A foreground `dataSync` service with a low-importance "Media uploads" notification channel, whose permission is already declared in the module manifest.
- An `ExistingWorkPolicy.KEEP` unique name, so retrying never creates a second chain.

**Why a publish token.** The app's refresh tokens rotate on every use. A native worker refreshing them would race the JavaScript session and could log the user out. Instead, `POST /stories/batches` returns a signed token that can only upload and publish the items of this one batch, for this user, and expires after 24 hours. The server also rejects it when the user's `sessionVersion` has changed (logout everywhere, account deletion or a ban). The token is kept in the worker's private job file and is never logged.

**How the app learns about progress.**

- While JavaScript is running, the native module emits `storyBatchProgress` events (`batchId`, `itemId`, `step`, `bytesSent`, `totalBytes`).
- Because events stop while JavaScript is paused, the app also reads `getStoryBatch(batchId)` whenever it returns to the foreground. This is the same event-plus-poll pattern as chat's `waitForUpload`.
- `src/features/stories/create/publish/postingStore.ts` holds the posting state that the tray ring and the **Posting…** label read.
- When an item publishes, the app inserts the returned story into the tray cache (`STORY_TRAY_QUERY_KEY`) at once, without waiting for a refetch.

**Ending a batch.**

| Outcome | Device | Server |
| --- | --- | --- |
| All published | Deletes exported files, the job record and the draft | Batch marked `completed`; outbox `STORY_PUBLISHED` per item as today |
| Failed (retries exhausted, or the server rejected the file) | Keeps the draft and exported files; red ring and notification with Try again and Discard. **Try again** re-enqueues the same chain, and already-published items are skipped | Items already published stay published; the failed item's reason (for example moderation) is returned so the app can say why |
| Cancelled or discarded | `cancelUniqueWork`, deletes the exported files; the draft is kept on cancel and removed on discard | `DELETE /stories/batches/:batchId` aborts the multipart uploads; published items are not removed (delete them like any story) |
| Abandoned | Drafts expire after 7 days as usual | The existing upload sweeper aborts multipart uploads and expires batches that have been idle for 24 h |

**Order guarantee.** Items run in one chain, so item 2 cannot publish before item 1. The server double-checks by refusing to publish an item while an earlier item of the batch is unpublished, unless that item was cancelled or rejected. Published stories keep the batch order through `batch_id` and `part_index`.

---

## 12. Architecture

### 12.1 Principles

1. **One composition, two outputs.** The editor builds a `StoryComposition` (a JSON scene of layers). Everything **decorative** (media placement, filter, text, drawing, decorative stickers) is **flattened** into the uploaded photo or video. Everything **interactive** (poll, quiz, question, slider, countdown, mention, location, link, hashtag, Add Yours, Reveal, Frames, music, captions) stays as **data** and is drawn live by the viewer, so votes, taps and notifications work.
2. **Normalised coordinates.** Every layer stores position, scale and rotation in canvas units (1080 × 1920). The viewer maps them to its screen with the same fit rule the media uses, so a sticker sits on the same spot in every phone.
3. **Heavy work on device, verification on the server.** Rendering and encoding happen on the phone with hardware codecs; the server validates, re-inspects and stores. The server never re-renders a story.
4. **Reuse what exists.** Uploads use the resumable multipart path built for chat media. Video trim, mute and cover use the existing `chat-media` Media3 module. The server processing and inspection services are extended, not replaced.

### 12.2 App modules (`apps/mobile/src/features/stories/create`)

| Module | Responsibility |
| --- | --- |
| `camera/StoryCameraScreen` | Capture UI, mode rail, shutter gestures (tap, hold, slide-to-zoom), flash, flip, focus, effects row |
| `camera/modes/*` | Boomerang burst, Layout grid state, Hands-free, Dual |
| `picker/StoryGalleryPicker` | Media grid, albums, multi-select up to 10, Drafts album (reuses the chat `AttachmentPickerSheet` media loading) |
| `editor/StoryEditorScreen` | Canvas, layer stack, gestures, snap guides, bin, undo, per-item strip |
| `editor/canvas/*` | Skia rendering of media, filter, background, text, strokes, decorative stickers |
| `editor/tools/*` | Text tool, draw tool, filter carousel, duration clock, trim/mute |
| `editor/stickers/*` | Sticker tray, search, and one component per sticker type (creator side) |
| `music/*` | Music sheet (Trending, search, previews), clip scrubber with the lyric at the scrub position, lyric renderer driven by audio or video time, volume balance, `expo-audio` preview player (section 9.2) |
| `composition/` | `StoryComposition` types, reducer, undo history, serialisation, validation shared with the viewer |
| `render/` | Flatten a composition: photo snapshot through Skia, video through the native exporter |
| `drafts/` | Local draft store: media files plus composition JSON in the app's document directory, index in AsyncStorage, 7-day expiry sweep |
| `publish/` | Prepares a batch (render, `POST /stories/batches`), hands it to the native worker, and `postingStore` for the tray ring, **Posting…** label, retry, cancel and discard (section 11.2) |
| `viewer/overlays/*` | Viewer-side interactive stickers, added to the existing `StoryViewer` |

### 12.3 Native pieces

| Capability | Implementation |
| --- | --- |
| Camera preview, capture, hold-to-record, zoom, torch, focus | `react-native-vision-camera` (CameraX on Android). It exposes frame processors, which live filters and effects need; `expo-camera` does not |
| Live filters on the camera preview | Skia frame processor applying the selected colour lookup to each preview frame |
| Canvas rendering and photo export | `@shopify/react-native-skia` (text with custom fonts, strokes with blend modes for neon and highlighter, colour matrix and LUT filters, offscreen snapshot at 1080 × 1920) |
| Video export with overlays | Extend `modules/chat-media` (`VideoExports.kt`): Media3 `Transformer` with a `BitmapOverlay` for the flattened decorative layer, `RgbMatrix`/LUT `Effect` for the filter, clipping for trim, `removeAudio` for mute, and an audio mix of the music clip |
| Boomerang | Native: record about 1 s, extract frames, encode forward and reverse sequences into a looping clip; SloMo, Echo and Duo are frame-timing and blending variants of the same frames |
| Long video split | Native: Media3 clipping into consecutive 60 s exports before upload |
| Background posting | Extend `modules/chat-media` with `enqueueStoryBatch`, `getStoryBatch`, `retryStoryBatch`, `cancelStoryBatch` and a `storyBatchProgress` event: one WorkManager chain per batch of export, upload-parts (reusing `ChatUploadWorker`'s part loop) and publish workers, running as a foreground `dataSync` job (section 11.2) |
| Dual camera | CameraX concurrent camera API (Android 11+, device-dependent); hidden on devices that do not support two cameras at once |
| Cutouts | ML Kit Subject Segmentation on device, producing a transparent PNG (or a mask per video frame) |
| Captions | On-device speech recognition where available, otherwise server transcription of the extracted audio (12.5) |
| Face and background effects | A third-party AR SDK (for example DeepAR or Banuba) running in a frame processor; licence cost to confirm |
| GIF playback in the editor | Animated WebP decoded by Skia |

Adding VisionCamera, Skia and ML Kit requires a **development build rebuild**; each library's support for Expo SDK 57 and React Native 0.86 must be confirmed before installing.

### 12.4 `StoryComposition` (shared by editor, drafts, server and viewer)

```ts
type Transform = { x: number; y: number; scale: number; rotation: number }; // canvas units, degrees

type StoryComposition = {
  version: 1;
  canvas: { width: 1080; height: 1920 };
  media: {
    kind: 'photo' | 'video' | 'boomerang' | 'layout' | 'create';
    transform: Transform;
    background: { type: 'solid' | 'gradient'; colors: string[] };
    filter: string | null;              // filter id
    trim?: { startMs: number; endMs: number };
    muted?: boolean;
    layout?: { grid: 'h2' | 'v2' | 'g3' | 'g4' | 'g6'; cells: string[] };
  };
  durationMs: number;                   // photo 1000..15000; video = clip length
  flattened: Layer[];                   // text, strokes, decorative stickers: rendered into the media
  interactive: InteractiveSticker[];    // drawn live by the viewer
  music?: {
    provider: 'jiosaavn';
    trackId: string;
    title: string;                      // snapshot, so the sticker renders if the music API is down
    artists: string;
    artworkUrl: string;
    startMs: number;
    lengthMs: number;                   // photo ≤ 15000; video = video length
    display: 'lyrics' | 'album' | 'title' | 'hidden';
    lyricStyle?: string;
    color?: string;
    videoVolume?: number;               // 0..1, video stories only
    musicVolume?: number;               // 0..1
    transform?: Transform;
  };
};

type InteractiveSticker =
  | { id: string; type: 'mention'; userId: string; transform: Transform; style: string }
  | { id: string; type: 'location'; placeId: string; name: string; transform: Transform; style: string }
  | { id: string; type: 'hashtag'; tag: string; transform: Transform; style: string }
  | { id: string; type: 'link'; url: string; label?: string; transform: Transform; style: string }
  | { id: string; type: 'poll'; question: string; options: string[]; transform: Transform; style: string }
  | { id: string; type: 'quiz'; question: string; options: string[]; correctIndex: number; transform: Transform; style: string }
  | { id: string; type: 'question'; prompt: string; transform: Transform; style: string }
  | { id: string; type: 'slider'; question: string; emoji: string; transform: Transform; style: string }
  | { id: string; type: 'countdown'; title: string; endsAt: string; transform: Transform; style: string }
  | { id: string; type: 'addYours' | 'addYoursMusic'; promptId: string; transform: Transform }
  | { id: string; type: 'reveal'; hint: string }
  | { id: string; type: 'frame'; caption: string; transform: Transform }
  | { id: string; type: 'captions'; style: string; transform: Transform };
```

The flattened layers are kept only in drafts (so a draft stays editable). The published story sends the flattened media plus `interactive` and `music`; the server stores exactly that.

### 12.5 End-to-end: from shutter to a published story

```
Camera/Gallery ─► Editor (StoryComposition in memory, autosaved to draft)
                     │ Share
                     ▼
   In the app, before the editor closes (JavaScript)
                     │ save draft
                     │ render: photo → Skia JPEG 1080×1920; video → overlay PNG (+ animated WebP layers)
                     │ POST /stories/batches { items: [{ itemId, kind, size, durationMs, composition }] }
                     │    server: limits check → multipart upload per item → publish token
                     │ enqueueStoryBatch(...) → editor closes, tray ring starts
                     ▼
   WorkManager chain "story-batch-{batchId}" (native, survives app exit and restart)
                     │ per item, in order:
                     │ 1. export (video): Media3 trim + filter + overlays + music mix + 60 s split → MP4
                     │ 2. upload parts: 8 MB parts → presigned S3 part URLs (resumable)
                     │ 3. publish: POST /stories/batches/:batchId/items/:itemId/publish (publish token)
                     │       server: assemble parts → inspect bytes → moderate → thumbnail
                     │               → validate composition → store story + stickers
                     │               → outbox: STORY_PUBLISHED, mentions, Add Yours thread, countdown schedule
                     ▼
            Tray updates (story.published event) → viewers open it
                     │ interactive
                     ▼
     POST /stories/:id/stickers/:stickerId/responses  (vote, answer, rating, reply, remind)
                     │ server: validate against stored sticker → upsert → aggregate → notify owner
```

---

## 13. Server: data model and API

### 13.1 Changes to existing tables

| Table | Change |
| --- | --- |
| `stories` | Add `duration_ms`, `composition jsonb` (interactive stickers and music only), `batch_id` (items shared together), `part_index` and `part_count` (split videos), `music_track_id`, `reveal_hint` |
| `story_media_assets` | Raise the video limit for 60 s at 1080p; add `duration_ms`, `width`, `height`, `has_audio`, `moderation_status` |

### 13.2 New tables

| Table | Purpose | Key columns |
| --- | --- | --- |
| `story_batches` | One Share action being posted in the background | `id`, `owner_id`, `status` (`posting`, `completed`, `failed`, `cancelled`), `item_count`, `token_session_version`, `expires_at`, `updated_at` |
| `story_batch_items` | One item of a batch, in order | `id` (client `itemId`, unique per owner), `batch_id`, `position`, `asset_id`, `composition jsonb`, `status` (`uploading`, `published`, `rejected`, `cancelled`), `story_id`, `failure_reason` |
| `story_stickers` | One row per interactive sticker, extracted from the composition so it can be queried and validated | `id`, `story_id`, `type`, `config jsonb` |
| `story_sticker_responses` | Poll votes, quiz answers, slider ratings, question replies | `sticker_id`, `viewer_id`, `value jsonb`, unique (`sticker_id`, `viewer_id`) except questions |
| `story_countdown_subscriptions` | "Remind me" on countdowns | `sticker_id`, `user_id`, `notified_at` |
| `story_mentions` | Who was mentioned, for notification and re-share | `story_id`, `mentioned_user_id`, `reshared_story_id` |
| `story_link_taps` | Link sticker taps for Activity | `sticker_id`, `viewer_id`, `tapped_at` |
| `add_yours_prompts` | A prompt thread | `id`, `creator_id`, `text`, `kind` (`photo` or `music`), `participant_count` |
| `add_yours_entries` | A story that joined a prompt | `prompt_id`, `story_id`, `user_id` |
| `reveal_unlocks` | Viewers who unblurred a Reveal story by messaging | `story_id`, `viewer_id`, `message_id` |
| `music_tracks` | Snapshot of each song used in a story, so old stories and lyric lookups do not depend on the music API | `provider`, `provider_track_id` (unique together), `title`, `artists`, `album`, `duration_ms`, `language`, `explicit`, `artwork_url`, `jiosaavn_url`, `fetched_at` |
| `music_lyrics` | LRCLIB result per song | `provider`, `provider_track_id` (unique together), `lrclib_id`, `status` (`found`, `plain_only`, `instrumental`, `not_found`), `lines jsonb` (`[{startMs,endMs,text}]`), `plain_text`, `checked_at` |
| `story_cutouts` | Saved cutout stickers per user | `id`, `owner_id`, `object_key` |

Drafts are **not** stored on the server; they stay on the device, as on Instagram.

### 13.3 API

| Method and path | Purpose |
| --- | --- |
| `POST /stories/batches` | Start a background post of up to 10 items (plus the parts of split videos). Checks the active-story limit, durations, mentions and links, and returns the items and a publish token scoped to this batch. Idempotent on the client's `batchId` |
| `POST /stories/batches/:batchId/items/:itemId/parts` | Body `{ size, restart? }`. Starts the item's multipart upload the first time (a video's size is only known after export on the device), and returns URLs for every part plus the part numbers already stored. `restart` begins a fresh upload when the device had to produce the file again (publish token) |
| `POST /stories/batches/:batchId/items/:itemId/skip` | The device cannot produce this item (a video it cannot export): mark it failed so later items are not held back (publish token) |
| `POST /stories/batches/:batchId/items/:itemId/publish` | Assemble, inspect, moderate, thumbnail, validate the composition and create the story. Refuses while an earlier item is unfinished; returns the existing story if already published (publish token) |
| `GET /stories/batches/:batchId` | Status of every item, used after a restart to reconcile the device with the server |
| `DELETE /stories/batches/:batchId` | Cancel: abort multipart uploads of unpublished items |
| `GET /stories/:id/stickers` | Sticker data plus the viewer's own response and current aggregates |
| `POST /stories/:id/stickers/:stickerId/responses` | Vote, answer, rate, reply, or subscribe to a countdown |
| `GET /stories/:id/stickers/:stickerId/results` | Owner only: every response and aggregate |
| `POST /stories/:id/stickers/:stickerId/link-tap` | Record a link tap and return the safe-checked URL |
| `POST /stories/:id/reveal` | Send the unlock message and mark the story revealed for the viewer |
| `GET /stories/mentions/search?q=` | People who may be mentioned (section 15) |
| `GET /stories/locations/search?q=` | Place search through a server-side proxy |
| `GET /stories/gifs/search?q=` | GIPHY search through a server-side proxy with a content rating filter; the API key stays on the server |
| `GET /stories/music/trending` | Songs of the JioSaavn "Now Trending" playlist, normalised to `MusicTrack` (Redis 30 min) |
| `GET /stories/music/search?q=&page=` | Song search through the JioSaavn provider (Redis 5 min, 20 per page) |
| `GET /stories/music/:trackId` | One song with fresh stream URLs; saves the `music_tracks` snapshot (Redis 24 h) |
| `GET /stories/music/:trackId/lyrics` | Timed lyric lines from LRCLIB, matched and cached as in section 9.2; `404 LYRICS_NOT_FOUND` when none exist |

Configuration: `MUSIC_API_BASE_URL=https://my-saavan-api.vercel.app`, `LYRICS_API_BASE_URL=https://lrclib.net`, `MUSIC_API_TIMEOUT_MS=4000`, and a `music_enabled` flag that hides the music button and returns `503 MUSIC_UNAVAILABLE` when off.
| `GET /stories/add-yours/:promptId` | A prompt and its entries |
| `POST /stories/captions` | Transcribe an uploaded audio track into timed captions (fallback when on-device recognition is unavailable) |

### 13.4 Background work (outbox and workers)

| Event | Worker action |
| --- | --- |
| `story.published` with mentions | Push "*Name* mentioned you in their story" to each mentioned person, and allow re-share |
| `story.published` with Add Yours | Add the entry to the thread and notify the prompt's creator |
| Countdown created | Schedule a job at `endsAt`; at the end, push to every subscriber once |
| Question reply | Push "New reply to your question" to the owner (batched) |
| `story_media.completed` | Moderation check (section 15); on a hard fail the asset is rejected and the creator told |
| Upload sweeper (existing, every 15 min) | Also aborts multipart uploads of story batch items idle for 24 h and marks those batches `failed` |
| Batch item rejected or batch failed | Push "Couldn't post your story" to the owner, in case the device's worker never reports back |
| Story expiry | Existing expiry keeps stickers and responses for the viewer list's 48 hours, then removes them |

---

## 14. Limits

| Item | Limit | Basis |
| --- | --- | --- |
| Canvas | 1080 × 1920 | [convention] |
| Photo upload | 15 MB before rendering; exported JPEG under 2 MB | [decision] |
| Video story | 60 s per story; longer videos split into 60 s parts | [source] |
| Exported video | H.264 High, 1080 × 1920, 30 fps, about 6 Mbps, AAC 128 kbps (about 45 MB for 60 s) | [decision] |
| Items per share | 10 | [source] |
| Photo duration | 1–15 s, default 5 s | [source] |
| Music clip | Up to 15 s on a photo; the video's length (up to 60 s per part) on a video | [source] |
| Music API calls | Timeout 4 s; upstream failures served from cache when present; search results 20 per page | [decision] |
| Poll and quiz options | 2–4 | [source] |
| Drafts | 20, kept 7 days | [source] |
| Active stories | 20 per person (existing server rule); a batch that would exceed it is refused before upload | [decision] |
| Background batch | Publish token and part URLs valid 24 h (part URLs renewable); retries with exponential backoff from 15 s; batches idle 24 h are swept | [decision] |
| Batches posting at once | 3 per person; a fourth Share waits until one finishes | [decision] |

---

## 15. Safety for a college dating app

Instagram parity is the goal. Some features carry more risk on a dating app used by students, so each ships with a guard rather than being dropped. **[decision]** for every row.

| Feature | Risk | Guard |
| --- | --- | --- |
| Location sticker | Shows where a student is right now | Only named public places (campus buildings, cafés, venues), never exact coordinates or home addresses; a one-time warning the first time it is used |
| Mention | Tagging someone without consent | Only people who follow you or have matched with you; the mentioned person can remove the mention from their notification |
| Link | Scams and phishing | Server-side URL safety check before publish; links open through an interstitial showing the real domain |
| Question replies | Harassment | Replies go through the same abuse filters as chat; blocked users cannot reply |
| GIF search | Explicit content | Server proxy with the provider's content rating filter |
| Music | **Rights.** The songs come from JioSaavn through an unofficial API. JioSaavn's terms forbid access through unofficial interfaces, and the app has no music licence. The service could block the API or send a takedown, and app store review could flag it | The risk is accepted by the product owner. Guards: the provider sits behind one server adapter, so a licensed source can replace it without an app change; a `music_enabled` kill switch; no song audio is stored on our servers for photo stories; attribution with **Open in JioSaavn**; explicit songs filtered |
| Uploaded media | Nudity, violence | Moderation on completion (for example AWS Rekognition, already on AWS); hard fails are blocked, borderline cases held for review |
| Screenshots | Private stories captured | Android `FLAG_SECURE` on the story viewer (Part 2) |

---

## 16. Build plan

Each phase is usable on its own and testable in demo mode, with posting simulated locally in the demo.

| Phase | Scope |
| --- | --- |
| **A. Capture and core editing** | Camera (photo, hold to record 60 s, slide to zoom, flip, flash, focus, Hands-free), gallery multi-select up to 10, canvas (fit, reposition, background), text (fonts, colour, background, alignment, animation), drawing (all brushes, fill, eraser), colour filters, photo duration, video trim/mute, long video split, save to device, drafts, background posting of several items (section 11.2: tray ring, notification, retry, cancel) |
| **B. Interactive stickers** | Mention, location, hashtag, link, poll, quiz, question, emoji slider, countdown, GIF, time, photo, selfie; viewer overlays and owner results in Activity; notifications |
| **C. Music** | JioSaavn provider and LRCLIB lyrics on the server (section 9.2), music sheet with Trending and search, clip scrubber, all four display styles, audio mixing into video in the background export, synced playback over photos |
| **D. Advanced modes and stickers** | Boomerang (all four), Layout, Create mode, Add Yours and Add Yours Music, Reveal, Frames, Cutouts, Captions |
| **E. Camera extras** | Dual camera (supported devices), face and background effects, retouch |

Phase A needs the new native libraries (VisionCamera, Skia) and a development build rebuild before anything else.

### 16.1 Implementation status

All five phases are built. Where the build differs from Instagram, or needs something outside the code, it is listed here.

| Feature | How it is built | Differs from Instagram / needs |
| --- | --- | --- |
| GIF stickers | GIPHY search on the server; the GIF is a live sticker so it keeps animating | `GIPHY_API_KEY` in `apps/api/.env` |
| Sticker results | Activity has a Responses tab: votes by option, quiz answers, slider ratings, question replies (each can be shared as a story), reminders, link taps, Reveal unlocks, Add Yours participants | — |
| Selfie, Frames, Reveal | Selfie uses the front camera in a circle. A Frame is baked into the media, and the viewer covers its photo until shaken or tapped. For a Reveal story the server withholds the media URL until the viewer messages the owner, sending only a 12 × 21 px preview | Shake needs `expo-sensors` in the build. Only matches can message, so only matches can unlock a Reveal |
| Add Yours, Add Yours Music | Threads in `story_add_yours_threads` and `story_add_yours_entries`; the sticker opens a thread sheet; joining opens the camera with the sticker placed (and the music sheet for Music) | Thread stories are limited to people the viewer can already see |
| Animated text | Typewriter, Pop, Bounce, Pulse; animated text is drawn live by the viewer instead of baked | — |
| Eyedropper | Samples a snapshot of the stage for text and brush colours | — |
| Save edited video | The same Media3 export as posting, into the gallery | Needs the rebuilt development client |
| Boomerang | Classic, SloMo, Echo, Duo, made natively from a 1.2 s clip; the style can be changed in the editor | Needs the rebuilt development client |
| Layout | 2, 2, 3, 4 or 6 cells, filled from the camera or gallery, drawn into one photo | — |
| Dual | A photo with each camera a moment apart, the second in a corner | Not simultaneous: the VisionCamera multi-camera session API would be needed |
| Live camera filters | Swipe on the preview; the filter carries into the editor | — |
| Cutouts | ML Kit subject segmentation | Google Play services downloads the model on first use |
| Auto captions | The device extracts the sound; AWS Transcribe (en-IN, hi-IN, en-US) transcribes it from the private bucket; timed lines are drawn live | The AWS key needs `transcribe:StartTranscriptionJob` and `transcribe:GetTranscriptionJob`, plus S3 read/write on `story-captions/*` |
| Effects | Photo effects: background blur, black-and-white background, studio backdrop (ML Kit selfie segmentation); sunglasses, crown, hearts on faces (ML Kit face detection) | Not live AR on the camera preview: that needs a face-tracking SDK (for example Banuba or DeepAR, paid) |
| Reshare a mention | "Add to your story" on the mention card puts the story's picture and "@name" on a new story | — |
| Offline posting | A share made without a connection retries with backoff and when the app returns to the foreground | — |
| Nudity moderation | Not built | Planned separately |

---

## 17. Verification

- **Composition:** unit tests for the reducer, undo, serialisation, coordinate mapping between canvas and screen sizes, and validation of every sticker type.
- **Music:**
  - Unit tests for the LRC parser (multi-timestamp lines, empty lines, the last line's end).
  - Unit tests for lyric matching: exact hit, search fallback within 3 s, cleaned-title retry, not found.
  - Unit tests for normalising JioSaavn songs (entity decoding, artist joining, stream choice), using **saved response fixtures** so tests never call the live APIs.
  - A manual smoke script that calls both live services and prints the response shapes, to catch the unofficial API changing.
- **Server:** non-destructive integration tests for batch creation limits, publish ordering (an item refused while an earlier one is unfinished), publish idempotency, the publish token (wrong batch, expired, changed `sessionVersion`), part URL renewal, cancel, the sweeper expiring idle batches, split video parts, sticker response rules (one vote each, quiz correctness, slider range), countdown notifications, mention permissions, link safety rejection, and moderation rejection.
- **Rendering:** golden images comparing a composition flattened on the device with the editor preview; exported videos checked for duration, overlay position, filter and audio.
- **On device:**
  - Hold to record while sliding to zoom.
  - Multi-select 10 items and publish them in order.
  - Split a 2-minute video.
  - Draft, restart the phone, and resume.
  - Vote on a poll from a second account.
  - Receive a countdown reminder.
  - Background the app mid-upload, swipe it away from recents, and check the story still posts.
  - Turn on airplane mode mid-upload, then off, and check it resumes without starting over.
  - Restart the phone mid-upload and check it resumes after boot.
  - Post 3 items, kill the app after the first publishes, and check items 2 and 3 post in order with no duplicates.
  - Force a failure (for example a rejected file), then check the red ring, the notification, Try again and Discard.
  - Cancel while posting and check nothing more publishes and the draft remains.

---

## Sources

- [Instagram story length and photo duration (Outfy)](https://www.outfy.com/blog/instagram-story-length/)
- [Story time limits explained (Lilach Bullock)](https://www.lilachbullock.com/instagram-story-time-limits-explained/)
- [Videos under 60 seconds no longer split (Social Media Today)](https://www.socialmediatoday.com/news/Instagram-Announces-Videos-Under-60-Seconds-Stories-No-Longer-Split-Segments/632598/)
- [Instagram Stories video length (Moonb)](https://www.moonb.io/blog/instagram-stories-video-length)
- [New Boomerang modes and trimming (Social Media Today)](https://www.socialmediatoday.com/news/instagram-adds-new-boomerang-modes-and-capability-to-trim-boomerang-loops/570248/)
- [Layout for Stories and new Boomerangs (Search Engine Journal)](https://www.searchenginejournal.com/instagram-is-working-on-layouts-for-stories-new-boomerangs-more/321423/)
- [Dual camera in Instagram (TechCrunch)](https://techcrunch.com/2022/07/28/instagram-dual-camera-feature-copies-bereal-misses-point/embed/)
- [New stickers in Instagram Stories (About Meta)](https://about.fb.com/news/2024/05/new-stickers-in-instagram-stories/)
- [Four new stickers for Stories (About Instagram)](https://about.instagram.com/blog/announcements/new-stickers-for-stories)
- [Interactive stickers guide (Storrito)](https://storrito.com/resources/interactive-stickers-on-instagram-the-ultimative-guide/)
- [Type Mode in Instagram Stories (Social Media Examiner)](https://www.socialmediaexaminer.com/how-to-use-instagram-type-mode-in-instagram-stories/)
- [Fonts Instagram uses (Picsart)](https://picsart.com/blog/instagram-fonts/)
- [Drawing on Instagram Stories (JoinBrands)](https://joinbrands.com/blog/how-to-draw-on-instagram-stories/)
- [Eraser brush (Bustle)](https://www.bustle.com/p/how-to-use-instagrams-eraser-brush-streamline-your-story-creation-58013)
- [Multiple photos in one story (Outfy)](https://www.outfy.com/blog/how-to-put-multiple-pictures-on-instagram-story/)
- [Story drafts and the 7-day limit (ViewIGStory)](https://www.view-ig-story.com/blog/save-instagram-story-as-draft)
- [How many story drafts you can save (Lilach Bullock)](https://www.lilachbullock.com/how-many-instagram-story-drafts-can-you-save-at-once/)
- [Music sticker lyrics styles (Adweek)](https://www.adweek.com/performance-marketing/instagram-heres-how-to-change-the-lyrics-style-on-the-music-sticker/)
- [Adding lyrics to a story (artist.tools)](https://www.artist.tools/post/how-to-add-lyrics-to-instagram-story)
- [Music API deployment used by this app](https://my-saavan-api.vercel.app/)
- [sumitkolhe/jiosaavn-api (source of the music API)](https://github.com/sumitkolhe/jiosaavn-api)
- [JioSaavn terms of use](https://www.jiosaavn.com/corporate/terms/)
- [LRCLIB: free and open lyrics library](https://www.lrclib.net/)
- [LRCLIB server source (MIT)](https://github.com/tranxuanthang/lrclib)
- [LRCLIB on Hacker News: free synced lyrics API](https://news.ycombinator.com/item?id=39480390)
- [LRCLIB exact-match rule: album must agree, duration within about 2 s (beetdrop PR #20)](https://github.com/Breezyslasher/beetdrop/pull/20)
- [lrclib-api TypeScript wrapper docs](https://lrclib.js.org/)
