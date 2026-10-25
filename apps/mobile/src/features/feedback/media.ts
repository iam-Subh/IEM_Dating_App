import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Report files (docs/FEEDBACK.md): photos shrunk to 1600 px JPEG before upload
 * (about 300 KB, fast on mobile data), one screen recording of up to 60 s and
 * 50 MB, checked the moment it is picked so nobody waits to hear it is too big.
 */
export const MAX_PHOTOS = 5;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_MAX_MS = 60_000;
const PHOTO_SIDE = 1600;

export async function shrinkPhoto(uri: string, width?: number, height?: number) {
  const context = ImageManipulator.manipulate(uri);
  let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    const longest = Math.max(width ?? 0, height ?? 0);
    if (!longest || longest > PHOTO_SIDE) context.resize((width ?? 0) >= (height ?? 0) ? { width: PHOTO_SIDE } : { height: PHOTO_SIDE });
    image = await context.renderAsync();
    return (await image.saveAsync({ compress: 0.75, format: SaveFormat.JPEG })).uri;
  } finally { image?.release(); context.release(); }
}

async function sizeOf(uri: string, known?: number | null) {
  if (known) return known;
  try { const info = await FileSystem.getInfoAsync(uri); return info.exists ? info.size ?? 0 : 0; } catch { return 0; }
}

export type PickProblem = { title: string; message: string };

export async function pickPhotos(room: number): Promise<{ uris: string[]; problem?: PickProblem }> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 1 });
  if (result.canceled) return { uris: [] };
  const uris: string[] = [];
  let tooBig = 0;
  for (const asset of result.assets.slice(0, room)) {
    if ((await sizeOf(asset.uri, asset.fileSize)) > PHOTO_MAX_BYTES) { tooBig += 1; continue; }
    try { uris.push(await shrinkPhoto(asset.uri, asset.width, asset.height)); } catch { tooBig += 1; }
  }
  return { uris, problem: tooBig ? { title: tooBig === 1 ? 'A photo was too big' : `${tooBig} photos were too big`, message: 'Photos can be up to 10 MB each.' } : undefined };
}

export async function pickRecording(): Promise<{ uri?: string; problem?: PickProblem }> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false, quality: 1 });
  if (result.canceled || !result.assets[0]) return {};
  const asset = result.assets[0];
  if ((asset.duration ?? 0) > VIDEO_MAX_MS + 500) return { problem: { title: 'That recording is too long', message: 'Screen recordings can be up to 60 seconds. Trim it in your gallery, then add it again.' } };
  if ((await sizeOf(asset.uri, asset.fileSize)) > VIDEO_MAX_BYTES) return { problem: { title: 'That recording is too big', message: 'Screen recordings can be up to 50 MB. A shorter one will fit.' } };
  return { uri: asset.uri };
}
