export type PreviewSize = {width: number; height: number};

export function fitPreviewPhoto(source: PreviewSize, viewport: PreviewSize): PreviewSize {
  if (source.width <= 0 || source.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return {width: 0, height: 0};
  const fit = Math.min(viewport.width / source.width, viewport.height / source.height);
  return {width: source.width * fit, height: source.height * fit};
}

/** Keep a zoomed photo over the viewport. Centre axes that do not overflow. */
export function clampPreviewPan(x: number, y: number, scale: number, image: PreviewSize, viewport: PreviewSize) {
  'worklet';
  const maxX = Math.max(0, (image.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (image.height * scale - viewport.height) / 2);
  return {
    x: maxX === 0 ? 0 : Math.max(-maxX, Math.min(x, maxX)),
    y: maxY === 0 ? 0 : Math.max(-maxY, Math.min(y, maxY)),
  };
}

export function previewZoomAtPoint(scale: number, nextScale: number, x: number, y: number,
  focalX: number, focalY: number, image: PreviewSize, viewport: PreviewSize) {
  'worklet';
  const next = Math.max(1, Math.min(nextScale, 5));
  const ratio = next / Math.max(scale, 1);
  return {scale: next, ...clampPreviewPan(focalX - (focalX - x) * ratio, focalY - (focalY - y) * ratio, next, image, viewport)};
}
