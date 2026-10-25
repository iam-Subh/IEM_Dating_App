export const MIN_HEIGHT = 91;
export const MAX_HEIGHT = 244;
export const HEIGHT_ROW_SIZE = 60;

/** Use the same row for the highlight, selected value and Save during momentum. */
export function heightSelectionIndex(offset: number): number {
  'worklet';
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(MAX_HEIGHT - MIN_HEIGHT, Math.round(offset / HEIGHT_ROW_SIZE)));
}
