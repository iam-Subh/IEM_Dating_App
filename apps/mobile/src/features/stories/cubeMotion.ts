/** Keep a new drag continuous with the last rendered cube position. */
export function dragCubePosition(anchor: number, origin: number, translationX: number, width: number): number {
  'worklet';
  const originX = (anchor - origin) * width;
  // Undo existing edge resistance before applying the new finger movement.
  const rawOrigin = anchor === 0 && originX > 0 ? originX / 0.2 : originX;
  const raw = rawOrigin + translationX;
  const distance = anchor === 0 && raw > 0 ? raw * 0.2 : raw;
  return anchor - Math.max(-width, Math.min(width, distance)) / width;
}
