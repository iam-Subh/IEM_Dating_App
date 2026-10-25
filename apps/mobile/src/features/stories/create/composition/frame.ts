/**
 * An instant-print frame, in canvas units: an even border around the photo and
 * a deeper strip below it for the caption. The editor draws the frame from this
 * and the viewer covers the photo with it, so both must use the same numbers.
 */
export const FRAME_BORDER = 34;
export const FRAME_CAPTION = 170;
/** The photo's longest edge when it is first placed. */
export const FRAME_PHOTO_EDGE = 560;

export function frameLayout(photoWidth: number, photoHeight: number) {
  return {
    width: photoWidth + FRAME_BORDER * 2,
    height: photoHeight + FRAME_BORDER + FRAME_CAPTION,
    photo: { left: FRAME_BORDER, top: FRAME_BORDER, width: photoWidth, height: photoHeight },
  };
}
