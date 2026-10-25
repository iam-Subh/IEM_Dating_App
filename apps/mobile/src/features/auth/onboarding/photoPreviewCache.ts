import type {PreviewSize} from './photoPreviewGeometry';

const dimensions = new Map<string, PreviewSize>();

// Reuse dimensions from the displayed thumbnail before opening the preview.
export function rememberPreviewPhoto(uri: string, size: PreviewSize) {
  if (!uri || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return;
  dimensions.delete(uri);
  dimensions.set(uri, {width: size.width, height: size.height});
  if (dimensions.size > 64) dimensions.delete(dimensions.keys().next().value!);
}

export function previewPhotoSize(uri: string) {
  return dimensions.get(uri);
}
