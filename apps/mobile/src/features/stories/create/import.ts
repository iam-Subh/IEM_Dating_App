import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { ChatMedia } from '../../../../modules/chat-media';
import type { MediaSource } from './composition/types';

/** Longest edge kept for a story photo: twice the canvas, enough to zoom in. */
const MAX_PHOTO_EDGE = 2160;

/**
 * A photo ready for the editor: orientation applied, size capped, saved as a
 * JPEG. Skia draws decoded pixels as stored, so a camera photo with an EXIF
 * rotation would otherwise appear sideways.
 */
export async function importPhoto(uri: string, preserveResolution = false): Promise<MediaSource> {
  const context = ImageManipulator.manipulate(uri);
  if (!preserveResolution) {
    // The size from the file's header, not a full decode: decoding every photo
    // twice was most of the wait after Next. A header that ignores rotation
    // only picks the other edge to cap - the photo is still sized down.
    const original = await imageSize(uri);
    const longest = original ? Math.max(original.width, original.height) : Infinity;
    if (longest > MAX_PHOTO_EDGE) {
      context.resize(!original || original.width >= original.height ? { width: MAX_PHOTO_EDGE } : { height: MAX_PHOTO_EDGE });
    }
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: preserveResolution ? SaveFormat.PNG : SaveFormat.JPEG, compress: preserveResolution ? 1 : 0.92 });
  return { kind: 'photo', uri: saved.uri, width: saved.width, height: saved.height };
}

function imageSize(uri: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve(null));
  });
}

/**
 * Several picks at once, in their order: each is decoded and saved in native
 * code, so a few in parallel finish far sooner than one after another.
 */
export async function importAll<T>(items: readonly T[], one: (item: T) => Promise<MediaSource>, concurrency = 3): Promise<MediaSource[]> {
  const out: MediaSource[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await one(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export async function importVideo(uri: string, durationHintMs?: number | null): Promise<MediaSource> {
  const info = await ChatMedia?.getVideoInfo(uri).catch(() => null);
  return {
    kind: 'video',
    uri,
    width: info?.width || 1080,
    height: info?.height || 1920,
    durationMs: info?.durationMs || durationHintMs || 0,
    hasAudio: info?.hasAudio ?? true,
  };
}
