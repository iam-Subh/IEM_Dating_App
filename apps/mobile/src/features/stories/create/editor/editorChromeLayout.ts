export const EDITOR_HEADER_HEIGHT = 44;
export const EDITOR_PANEL_HEIGHT = 144;
export const EDITOR_RAIL_WIDTH = 44;
export const EDITOR_RAIL_RIGHT = 8;
export const EDITOR_SHARE_HEIGHT = 64;
export const EDITOR_PREVIEW_MARGIN = 6;
export const EDITOR_PREVIEW_GAP = 6;

export function editorHasTopPanel(tool: string) {
  return tool === 'trim';
}

export function editorViewport(screenWidth: number, screenHeight: number, topInset: number, bottomInset: number, expandedPanel: boolean) {
  const toolsHeight = expandedPanel ? EDITOR_PANEL_HEIGHT : 0;
  const top = topInset + EDITOR_HEADER_HEIGHT + toolsHeight + EDITOR_PREVIEW_GAP;
  const bottom = screenHeight - bottomInset - EDITOR_SHARE_HEIGHT - EDITOR_PREVIEW_GAP;
  const width = Math.min(Math.max(1, screenWidth - EDITOR_PREVIEW_MARGIN * 2), Math.max(1, bottom - top) * 9 / 16);
  const height = width * 16 / 9;
  return { width, height, left: (screenWidth - width) / 2, top: top + (Math.max(1, bottom - top) - height) / 2 };
}
