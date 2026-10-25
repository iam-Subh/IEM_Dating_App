export const DRAW_HEADER_HEIGHT = 60;
export const DRAW_DOCK_HEIGHT = 162;
const MARGIN = 12;
const GAP = 8;

/** Fit the 9:16 story between the controls without changing canvas coordinates. */
export function drawToolLayout(screenWidth: number, screenHeight: number, topInset: number, bottomInset: number) {
  const top = topInset + DRAW_HEADER_HEIGHT + GAP;
  const bottom = screenHeight - bottomInset - DRAW_DOCK_HEIGHT - GAP;
  const availableHeight = Math.max(1, bottom - top);
  const availableWidth = Math.max(1, screenWidth - MARGIN * 2);
  const width = Math.min(availableWidth, availableHeight * 9 / 16);
  const height = width * 16 / 9;
  return {
    width, height,
    left: (screenWidth - width) / 2,
    top: top + (availableHeight - height) / 2,
  };
}
