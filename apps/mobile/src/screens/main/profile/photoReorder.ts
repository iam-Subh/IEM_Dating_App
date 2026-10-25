export type PhotoGridSize = { width: number; height: number; gap: number };
export const PHOTO_FOOTER_HEIGHT = 36;

export function photoSlotPosition(index: number, size: PhotoGridSize) {
  'worklet';
  return { x: (index % 3) * (size.width + size.gap), y: Math.floor(index / 3) * (size.height + size.gap) };
}

/** Use the dragged card's position, not the finger's starting position. */
export function photoDropSlot(x: number, y: number, count: number, size: PhotoGridSize) {
  'worklet';
  const column = Math.max(0, Math.min(2, Math.round(x / (size.width + size.gap))));
  const row = Math.max(0, Math.min(1, Math.round(y / (size.height + size.gap))));
  return Math.max(0, Math.min(count - 1, row * 3 + column));
}

export function movePhotoOrder(order: string[], id: string, destination: number): string[] {
  'worklet';
  const from = order.indexOf(id);
  if (from < 0 || order.length < 2) return order;
  const to = Math.max(0, Math.min(order.length - 1, destination));
  if (from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

export function photoOrderMatches(left: string[], right: string[]) {
  'worklet';
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** Keep action buttons separate from the long-press drag area. */
export function photoActionTouch(x: number, y: number, size: PhotoGridSize, hasIssue = false) {
  'worklet';
  return x >= 0 && x <= size.width && y >= size.height - PHOTO_FOOTER_HEIGHT - (hasIssue ? 26 : 0);
}
