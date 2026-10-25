import type { PhotoEdit } from './components/attachmentTypes';

export const normalRotation = (angle: number) => ((angle % 360) + 360) % 360;
export const hasPhotoEdit = (edit?: PhotoEdit) => Boolean(edit && (normalRotation(edit.rotation) !== 0 || edit.flipped));

/** Pixels rotate first, then flip across the displayed image's horizontal axis. */
export function rotatePhoto(edit?: PhotoEdit): PhotoEdit {
  return { rotation: normalRotation((edit?.rotation ?? 0) + (edit?.flipped ? -90 : 90)), flipped: edit?.flipped ?? false };
}
export function flipPhoto(edit?: PhotoEdit): PhotoEdit {
  return { rotation: normalRotation(edit?.rotation ?? 0), flipped: !edit?.flipped };
}
export function photoDimensions(width: number, height: number, edit?: PhotoEdit) {
  return normalRotation(edit?.rotation ?? 0) % 180 === 90 ? { width: height, height: width } : { width, height };
}
export function containPhoto(width: number, height: number, areaWidth: number, areaHeight: number, edit?: PhotoEdit) {
  const rotated = photoDimensions(width, height, edit);
  const scale = Math.min(areaWidth / Math.max(1, rotated.width), areaHeight / Math.max(1, rotated.height));
  return { width: width * scale, height: height * scale, displayWidth: rotated.width * scale, displayHeight: rotated.height * scale };
}
export function cropPixels(rect: { x: number; y: number; width: number; height: number }, renderedWidth: number, renderedHeight: number, imageWidth: number, imageHeight: number) {
  const originX = Math.max(0, Math.min(imageWidth - 1, Math.round(rect.x * imageWidth / renderedWidth)));
  const originY = Math.max(0, Math.min(imageHeight - 1, Math.round(rect.y * imageHeight / renderedHeight)));
  return { originX, originY, width: Math.max(1, Math.min(imageWidth - originX, Math.round(rect.width * imageWidth / renderedWidth))), height: Math.max(1, Math.min(imageHeight - originY, Math.round(rect.height * imageHeight / renderedHeight))) };
}
