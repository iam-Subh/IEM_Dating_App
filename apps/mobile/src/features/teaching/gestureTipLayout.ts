export type TipFrame = {x: number; y: number; width: number; height: number};
export const TIP_HAND_SIZE = 64;
export const TIP_HAND_HEIGHT = TIP_HAND_SIZE * 194 / 128;
export const TIP_FINGER_X = 53 * TIP_HAND_SIZE / 128;
export const TIP_FINGER_Y = 26 * TIP_HAND_SIZE / 128;
const EDGE = 16;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** Hand coordinates depend only on the contact point, never on caption size. */
export function gestureTipLayout(point: {x: number; y: number}, layer: TipFrame, captionHeight: number) {
  const x = point.x - layer.x, y = point.y - layer.y;
  const captionWidth = Math.min(260, Math.max(1, layer.width - EDGE * 2));
  const above = y - captionHeight - 40;
  const below = y - TIP_FINGER_Y + TIP_HAND_HEIGHT + 14;
  const captionTop = above >= EDGE ? above : below + captionHeight <= layer.height - EDGE ? below : Math.max(EDGE, layer.height - captionHeight - EDGE);
  return {
    hand: {left: x - TIP_FINGER_X, top: y - TIP_FINGER_Y},
    caption: {left: clamp(x - captionWidth / 2, EDGE, layer.width - captionWidth - EDGE), top: captionTop, width: captionWidth},
    contact: {x, y},
  };
}
