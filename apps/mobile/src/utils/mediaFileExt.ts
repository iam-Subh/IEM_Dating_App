/**
 * A safe file extension for a picked photo or video, to send to the server's
 * `/upload/presigned-urls` (which only accepts jpg/jpeg/png/webp for photos
 * and mp4/mov for videos).
 *
 * On some devices and emulators (notably Android's system Photo Picker),
 * `expo-image-picker` returns a `content://` URI with no file extension in
 * its path, or one whose "extension" is really a long numeric id. Naively
 * doing `uri.split('.').pop()` there produced a garbage string like
 * `content:/media/picker/0/…/media/1000000123`, which the server rejected
 * with `400 Unsupported media type`. This looks first at the picker's own
 * `mimeType`, the most reliable signal, then at a real extension in the URI,
 * and only then falls back to a sensible default.
 */

const PHOTO_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PHOTO_EXT = /\.(jpe?g|png|webp)$/i;
const VIDEO_EXT = /\.(mp4|mov)$/i;

/** Strips a query string, so `…/file.jpg?alt=media` still matches. */
function lastPathSegment(uri: string): string {
  return uri.split('?')[0].split('#')[0];
}

export function photoExtFromAsset(uri: string, mimeType?: string | null): string {
  if (mimeType) {
    const fromMime = PHOTO_MIME_EXT[mimeType.toLowerCase()];
    if (fromMime) return fromMime;
  }
  const match = PHOTO_EXT.exec(lastPathSegment(uri));
  return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

export function videoExtFromAsset(uri: string, mimeType?: string | null): string {
  if (mimeType === 'video/quicktime') return 'mov';
  if (mimeType === 'video/mp4') return 'mp4';
  const match = VIDEO_EXT.exec(lastPathSegment(uri));
  return match ? match[1].toLowerCase() : 'mp4';
}
