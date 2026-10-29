# Teaching artwork: the 2D set

Artwork for the welcome cards, the "How IEM Connect works" guide and the gesture tips. One family, built on the look of the Standouts bouquet (`standouts-rose-bouquet.prompt.txt`): flat, hand-drawn editorial line art, never 3D. Every picture is different; none reuses another's subject.

## How to use this file

1. Paste the **shared style block**, then one **picture prompt** below it, into the image tool. Send them as one message.
2. Attach `apps/mobile/assets/illustrations/standouts-rose-bouquet.png` as a style reference only (line, colour, finish), so the set matches it. It is not a subject reference.
3. If the edges come out rough, run the **clean-up prompt** on the result.
4. Save as `apps/mobile/assets/illustrations/teach-<name>.png` (names below). Keep the prompt that worked beside it here, as the other files in this folder do.

The gesture hand (last section) is not generated. It is drawn as a vector in the app, so it can move.

## Shared style block

```
STYLE (applies to the whole set):
Minimal hand-drawn editorial line art in the same style as the attached reference: clean flowing contours, slightly organic curves, simple flat matte pastel fills, at most one soft flat shade per shape. No 3D rendering, no gradients, no shine, no glow, no texture.

LINE: one consistent outline weight across the whole picture, warm pale-ivory outer contour so the shape stays visible on a warm near-black page (#100F0D), with fine slightly darker warm-brown inner detail lines. Rounded line ends. Never black exterior outlines.

COLOURS (use only these families): dusty pink #E39A9A, blush #F2C1BE, warm amber #F2B45A, sage green #7E9A6B, dusty lavender #8A809E, pale warm ivory #F6E7D6 for skin and paper, warm brown #7A4A44 for inner lines. No neon, no saturated blue except the single verification tick where a picture asks for it (#4A90E2).

PEOPLE: hands and objects only. No faces, no full people, no hair. A hand is natural with coherent five-finger anatomy, pale warm ivory, with a simple sleeve end in dusty lavender and an ivory cuff, as in the reference.

COMPOSITION: one clear subject, centred in a square canvas, silhouette about 80 percent of the height, compact and balanced, readable at 120 pixels. Whole subject visible, nothing cropped, a small clear margin.

OUTPUT: one transparent PNG, 1254 by 1254 pixels, true alpha transparency everywhere outside the drawing, opaque fills inside. No text, letters, numbers, logos, user interface, frame, card, floor, ground shadow, backdrop, scattered sparkles, glitter, confetti or decorative background.
```

## Clean-up prompt

```
Refine this illustration only. Keep the same subject, pose, anatomy, colours, shapes and positions. Remove stray speckles, isolated coloured pixels, rough cutout fringes and any marks outside the illustration. Make the outer edges clean, smooth, antialiased curves with true alpha transparency. Keep the warm pale-ivory outline around the main shapes for contrast on #100F0D. Flat matte pastel fills, minimal shading. Do not add anything. No background, glow, shadow, text, sparkles or glitter. Return a 1254 by 1254 transparent PNG with the whole illustration visible.
```

## Picture prompts

### 1. Welcome: meet people on campus (`teach-welcome-campus.png`)

```
SUBJECT: A hand enters from the lower right and passes a small folded paper note, sealed with a tiny dusty-pink heart, through the open bars of a simple arched college gate. The gate is drawn in sage green with an ivory arch and two short pillars; one small amber pennant flag on top of the left pillar. The note is pale ivory with one fold line. The feeling is a friendly first hello across campus.
```

### 2. Welcome: stand out (`teach-welcome-rose.png`)

```
SUBJECT: A hand enters from the lower left and holds up a single long-stemmed blush-pink rose, upright and proud. A small amber star-shaped paper tag hangs from the stem on a short thread, just below the bloom. Two sage leaves on the stem. One rose only, not a bouquet.
```

### 3. Welcome: you're in control (`teach-welcome-shield.png`)

```
SUBJECT: A hand enters from the bottom centre, palm up, holding a rounded shield shape that stands upright on the palm. The shield is dusty lavender with an ivory rim and a large, simple ivory tick in the middle. Calm and reassuring, not aggressive.
```

### 4. Guide, Explore: swiping (`teach-guide-explore.png`)

```
SUBJECT: A hand with its index finger flicking the top card of a small stack of three rounded rectangular cards, the top card tilted and sliding to the right. The cards are pale ivory with a dusty-pink inner panel, blank (no faces, no text). A small solid dusty-pink heart floats off to the upper right of the moving card, and a small sage-green cross floats off to the upper left. Only these two small symbols, no other marks.
```

### 5. Guide, Stories (`teach-guide-stories.png`)

```
SUBJECT: A hand holds a simple upright phone, seen from the front, with rounded corners and a lavender body. On the phone's screen, a single large circle (an abstract photo: a soft amber sun over a sage hill) is surrounded by a thick ring made of a dusty-pink to amber band drawn as two flat colour segments, not a gradient. Nothing else on the screen. No icons, no text.
```

### 6. Guide, Comments (`teach-guide-comments.png`)

```
SUBJECT: A slightly tilted polaroid-style photo, ivory frame, with an abstract picture inside (a small amber sun and two sage hills). A dusty-pink speech bubble, drawn with three small ivory dots inside, is pinned to the top right corner of the polaroid with a small amber pushpin. The bubble overlaps the frame a little. No hand in this one.
```

### 7. Guide, Likes You (`teach-guide-likes.png`)

```
SUBJECT: A closed ivory envelope, three-quarter front view, slightly tilted, with its flap sealed by a round dusty-pink wax seal pressed with a simple heart. A small blush heart floats just above the envelope's top right corner. No hand, no stamps, no writing.
```

### 8. Guide, Chats (`teach-guide-chats.png`)

```
SUBJECT: Two rounded speech bubbles overlapping in a gentle diagonal. The back bubble is sage green with three ivory dots. The front bubble is dusty pink and contains a simple ivory voice waveform made of five rounded vertical bars of different heights. Each bubble has a small tail, pointing to opposite sides.
```

### 9. Guide, Verification (`teach-guide-verify.png`)

```
SUBJECT: A hand enters from the lower left holding up a rounded student ID card in landscape. The card is ivory with a lavender top band, a plain dusty-pink square where a photo would go (no face, just a simple abstract circle and shoulders shape in blush), and two short sage lines for text (lines only, no letters). In the card's top right corner, a round blue badge (#4A90E2) with a white tick.
```

### 10. Guide, Map: hide at a place (`teach-guide-hide-place.png`)

```
SUBJECT: A large rounded map pin, dusty pink with an ivory rim, standing upright. In the pin's round head, instead of a dot, a simple closed eye: one curved ivory eyelid line with three short lashes. Under the pin's point, a small flat folded paper map piece in sage and ivory, with one short dotted path line. Calm and private.
```

### 11. Guide, Staying safe (`teach-guide-safety.png`)

```
SUBJECT: A hand raised palm-out toward the viewer, fingers together, in a gentle "stop" gesture, with a lavender sleeve and ivory cuff. A small amber padlock, closed, hangs from a short ivory ribbon tied around the wrist. Firm but kind, not angry.
```

### 12. Guide, Shake to report (`teach-guide-shake.png`)

```
SUBJECT: A simple upright phone with a lavender body and a plain ivory screen, tilted slightly, with three short curved motion lines on each side showing it being shaken. On the screen, one small friendly bug drawn as a simple round amber beetle with six short legs and two antennae. Cute, not creepy.
```

### 13. Guide cover: How IEM Connect works (`teach-guide-cover.png`)

```
SUBJECT: An open small paper booklet, ivory pages, lying slightly tilted, seen from the front. On the left page, a simple dusty-pink heart; on the right page, a small sage-green map pin and an amber star, arranged like contents. A lavender ribbon bookmark hangs from the top of the booklet. No writing, no letters, only these simple shapes.
```

## The gesture hand (drawn in the app, not generated)

The moving hand in the gesture tips is a vector shape drawn in code (react-native-svg), so it stays sharp at any size and moves smoothly. It follows the shared style: pale warm ivory fill #F6E7D6, warm-brown inner lines #7A4A44, warm pale-ivory outer contour, lavender sleeve end #8A809E with an ivory cuff.

Poses, one shape with the index finger extended:

| Pose | Used for | Motion |
|---|---|---|
| Point | Tap (Story next, expand a profile) | Presses down 6 px with a soft ripple at the fingertip |
| Hold | Hold to pause, hold to record | Presses and stays; a ring fills around the fingertip |
| Swipe | Deck right and left, Story swipe down | Slides along the path with a short fading trail |
| Long press | Header icons | Presses, stays 0.6 s, then a small label appears |

Each plays twice (about 3 s in all), then fades. With Reduce motion on, the hand stands still in place, beside its one line of text.
