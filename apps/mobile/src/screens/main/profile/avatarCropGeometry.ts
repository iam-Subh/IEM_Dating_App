export type CropSquare = { x: number; y: number; size: number };
export type CropCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

/** Resize a square around its opposite corner, within the displayed image. */
export function resizeAvatarCrop(start: CropSquare, corner: CropCorner, dx: number, dy: number,
  bounds: { width: number; height: number }, minimum: number): CropSquare {
  'worklet';
  const left = corner === 'topLeft' || corner === 'bottomLeft';
  const top = corner === 'topLeft' || corner === 'topRight';
  const anchorX = left ? start.x + start.size : start.x;
  const anchorY = top ? start.y + start.size : start.y;
  const maximum = Math.min(left ? anchorX : bounds.width - anchorX, top ? anchorY : bounds.height - anchorY);
  const delta = ((left ? -dx : dx) + (top ? -dy : dy)) / 2;
  const size = Math.max(Math.min(minimum, maximum), Math.min(start.size + delta, maximum));
  return { x: left ? anchorX - size : anchorX, y: top ? anchorY - size : anchorY, size };
}
