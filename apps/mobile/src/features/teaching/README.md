# Teaching artwork

The set contains 13 transparent PNG illustrations. Each PNG is 1254 × 1254 pixels.
The assets use flat editorial line art and the Standouts bouquet palette.

## App components

Use `TeachingArt` with a name from `TeachingArtName`:

```tsx
<TeachingArt name="guide-comments" size={160}/>
```

Use the SVG hand for a gesture tip:

```tsx
<GestureTeachingHand pose="hold" text="Hold to pause."/>
```

The supported poses are `point`, `hold`, `swipe`, and `longPress`.
Swipe directions are `left`, `right`, and `down`.
Each animation plays two 1500 ms cycles, then fades for 220 ms.
Reduce Motion shows a still hand and text.
Change `replayKey` to replay a gesture. `onComplete` runs after its fade.

## Review

In a development build, open **Explore → flask icon → Artwork**.
The development link is `iemdating://teaching-artwork`.

Run `node scripts/build-teaching-artwork-preview.cjs` from the repository root
to rebuild the browser gallery at `/reminders/teaching-artwork/index.html`.
The gallery uses the app's SVG hand paths. It includes a light canvas toggle
for checking the transparent edges.

## Demo swipe lesson

Open **Explore → flask icon → Demo cards**. The swipe lesson opens first.
Use **Learn → Swipe lesson** to replay it.

The lesson demonstrates each direction once, then accepts practice swipes.
Both directions must complete before **Start exploring** appears.
Skip closes the lesson at any time. Buttons provide the same practice actions.
The component does not import the API client, storage, or real swipe handlers.
Reduce Motion skips the demonstration and removes release animations.

Run `node scripts/build-swipe-lesson-preview.cjs` to build the same component
for `/reminders/swipe-lesson/index.html`. The browser preview uses a sample photo.
`TeachingHandArt.tsx` supplies the hand geometry to both gesture components.

`GestureTip` measures the target control after the overlay mounts. Its hand
position uses the fingertip coordinates. Caption wrapping does not move it.
Tap and hold reach the contact point at the press peak. The caption stays
outside the hand and target area. A tap outside closes the tip.

## Files

- Assets: `apps/mobile/assets/illustrations/teach-*.png`.
- Original brief: `docs/illustration-prompts/teaching-2d-set.prompts.md`.
- Individual prompts: `docs/illustration-prompts/teach-*.prompt.txt`.
- Selected source files: `docs/illustration-prompts/teaching-2d-set.manifest.json`.

The PNG files use the built-in OpenAI imagegen tool. The gesture hand is an SVG
component drawn in code.
