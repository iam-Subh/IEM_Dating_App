import { Skia, TileMode, type SkImageFilter } from '@shopify/react-native-skia';

/**
 * A light unsharp mask, the crisp look of a phone camera's own photos: each
 * pixel is pushed away from the average of its four neighbours. `strength`
 * 0.25–0.4 is subtle; higher starts to show halos along edges.
 */
export function makeSharpenFilter(strength: number): SkImageFilter {
  const s = strength;
  return Skia.ImageFilter.MakeMatrixConvolution(
    3,
    3,
    [0, -s, 0, -s, 1 + 4 * s, -s, 0, -s, 0],
    1,
    0,
    1,
    1,
    TileMode.Clamp,
    false,
    null,
    null,
  );
}

/** Sharpening for the editor preview, at the screen's own pixel size. */
export const PREVIEW_SHARPEN = 0.35;
/** Sharpening for the posted story, at 1080 × 1920. */
export const STORY_SHARPEN = 0.3;
