import { CANVAS } from '../composition/types';
import { drawToolLayout } from './drawToolLayout';
import { editorViewport } from './editorChromeLayout';

/** The content keeps one layout. Tool changes only scale its outer viewport. */
export function editorStageLayout(screenWidth: number, screenHeight: number, topInset: number, bottomInset: number, drawing: boolean, expandedPanel = false) {
  const available = Math.max(1, screenHeight - topInset - bottomInset - 76);
  const contentWidth = Math.min(screenWidth, available * CANVAS.width / CANVAS.height);
  const contentHeight = contentWidth * CANVAS.height / CANVAS.width;
  const viewport = drawing ? drawToolLayout(screenWidth, screenHeight, topInset, bottomInset)
    : editorViewport(screenWidth, screenHeight, topInset, bottomInset, expandedPanel);
  return {
    contentWidth, contentHeight, viewport,
    unit: contentWidth / CANVAS.width,
    touchUnit: viewport.width / CANVAS.width,
    scale: viewport.width / contentWidth,
  };
}

/** Convert a touch to saved canvas coordinates and the fixed render surface. */
export function drawingPoint(x: number, y: number, touchUnit: number, renderUnit: number) {
  'worklet';
  const canvasX = x / touchUnit;
  const canvasY = y / touchUnit;
  return { canvasX, canvasY, renderX: canvasX * renderUnit, renderY: canvasY * renderUnit };
}
