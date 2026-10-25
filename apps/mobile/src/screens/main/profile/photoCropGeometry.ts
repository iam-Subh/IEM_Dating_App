export type PhotoCrop = { x: number; y: number; width: number; height: number };
export type CropBounds = { width: number; height: number };
export type PhotoCropHandle = 'topLeft' | 'top' | 'topRight' | 'right' | 'bottomRight' | 'bottom' | 'bottomLeft' | 'left';

/** Use one physical-pixel boundary for the crop border and its shading. */
export function alignPhotoCrop(crop: PhotoCrop, density: number): PhotoCrop {
  'worklet';
  const left = Math.round(crop.x * density) / density;
  const top = Math.round(crop.y * density) / density;
  const right = Math.round((crop.x + crop.width) * density) / density;
  const bottom = Math.round((crop.y + crop.height) * density) / density;
  return {x: left, y: top, width: right - left, height: bottom - top};
}

export function initialPhotoCrop(bounds: CropBounds, aspectRatio = 0.75): PhotoCrop {
  'worklet';
  const width = Math.min(bounds.width, bounds.height * aspectRatio) * 0.9;
  const height = width / aspectRatio;
  return { x: (bounds.width - width) / 2, y: (bounds.height - height) / 2, width, height };
}

// Initialize this helper before resizePhotoCrop captures it for the UI runtime.
/** Keep the output proportions fixed. Corners retain their opposite anchor. */
function resizeFixedPhotoCrop(start: PhotoCrop, handle: PhotoCropHandle, dx: number, dy: number,
  bounds: CropBounds, minimum: number, ratio: number): PhotoCrop {
  'worklet';
  const left = handle === 'left' || handle.endsWith('Left');
  const top = handle === 'top' || handle.startsWith('top');
  const horizontal = handle === 'left' || handle === 'right';
  const vertical = handle === 'top' || handle === 'bottom';
  const centerX = start.x + start.width / 2;
  const centerY = start.y + start.height / 2;
  const anchorX = left ? start.x + start.width : start.x;
  const anchorY = top ? start.y + start.height : start.y;
  const deltaX = left ? -dx : dx;
  const deltaY = (top ? -dy : dy) * ratio;
  const delta = horizontal ? deltaX : vertical ? deltaY : Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
  const availableWidth = vertical ? 2 * Math.min(centerX, bounds.width - centerX) : left ? anchorX : bounds.width - anchorX;
  const availableHeight = horizontal ? 2 * Math.min(centerY, bounds.height - centerY) : top ? anchorY : bounds.height - anchorY;
  const maximum = Math.min(availableWidth, availableHeight * ratio);
  const minWidth = Math.min(maximum, Math.max(minimum, minimum * ratio));
  const width = Math.max(minWidth, Math.min(start.width + delta, maximum));
  const height = width / ratio;
  return {
    x: vertical ? centerX - width / 2 : left ? anchorX - width : anchorX,
    y: horizontal ? centerY - height / 2 : top ? anchorY - height : anchorY,
    width, height,
  };
}

/** Keep the opposite edges fixed. Each selected edge can move independently. */
export function resizePhotoCrop(start: PhotoCrop, handle: PhotoCropHandle, dx: number, dy: number,
  bounds: CropBounds, minimum: number, aspectRatio?: number): PhotoCrop {
  'worklet';
  if (aspectRatio) return resizeFixedPhotoCrop(start, handle, dx, dy, bounds, minimum, aspectRatio);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  const minWidth = Math.min(minimum, bounds.width);
  const minHeight = Math.min(minimum, bounds.height);
  if (handle === 'left' || handle.endsWith('Left')) left = Math.max(0, Math.min(left + dx, right - minWidth));
  if (handle === 'right' || handle.endsWith('Right')) right = Math.min(bounds.width, Math.max(right + dx, left + minWidth));
  if (handle === 'top' || handle.startsWith('top')) top = Math.max(0, Math.min(top + dy, bottom - minHeight));
  if (handle === 'bottom' || handle.startsWith('bottom')) bottom = Math.min(bounds.height, Math.max(bottom + dy, top + minHeight));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function movePhotoCrop(start: PhotoCrop, dx: number, dy: number, bounds: CropBounds): PhotoCrop {
  'worklet';
  return { ...start,
    x: Math.max(0, Math.min(start.x + dx, bounds.width - start.width)),
    y: Math.max(0, Math.min(start.y + dy, bounds.height - start.height)),
  };
}

/** Convert the displayed frame to whole source pixels without crossing the image boundary. */
export function photoCropPixels(crop: PhotoCrop, displayed: CropBounds, source: CropBounds, aspectRatio?: number) {
  const originX = Math.max(0, Math.min(source.width - 1, Math.round(crop.x * source.width / displayed.width)));
  const originY = Math.max(0, Math.min(source.height - 1, Math.round(crop.y * source.height / displayed.height)));
  let width = Math.max(1, Math.min(source.width - originX, Math.round(crop.width * source.width / displayed.width)));
  let height = Math.max(1, Math.min(source.height - originY, Math.round(crop.height * source.height / displayed.height)));
  if (aspectRatio) {
    width = Math.max(1, Math.min(width, Math.floor(height * aspectRatio)));
    height = Math.max(1, Math.min(height, Math.round(width / aspectRatio)));
  }
  return {originX, originY, width, height};
}
