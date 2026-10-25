import { Platform, Linking } from 'react-native';
import { Directory, File as FileSystemFile } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
};

export function extensionOf(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : '';
}

/** The file's type from its name, for opening it in the right app. */
export function mimeTypeOf(fileName: string) {
  return MIME_BY_EXTENSION[extensionOf(fileName)] ?? 'application/octet-stream';
}

/** A file on this phone, opened in whichever app handles its type. Throws when none can. */
export async function openLocalFile(uri: string, mimeType: string) {
  if (Platform.OS !== 'android') {
    await Linking.openURL(uri);
    return;
  }
  const contentUri = uri.startsWith('content://') ? uri : await getContentUriAsync(uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, type: mimeType, flags: 1 });
}

/**
 * A copy of a file on this phone in a folder the person picks (Downloads,
 * Documents...). False when they cancelled the folder picker.
 */
export async function saveLocalFileToFolder(uri: string, fileName: string, mimeType: string): Promise<boolean> {
  let destination: Directory;
  try {
    destination = await Directory.pickDirectoryAsync();
  } catch (error) {
    if (/cancel/i.test(error instanceof Error ? error.message : '')) return false;
    throw error;
  }
  // createFile makes the (empty) file in the folder; the bytes are written
  // into it. copy() cannot fill a picked folder's file: with overwrite it
  // deletes the new file and then fails to find it, without it it refuses
  // because the file exists.
  const target = destination.createFile(safName(fileName, mimeType), mimeType);
  target.write(await new FileSystemFile(uri).bytes());
  return true;
}

/**
 * The name to ask the storage framework for. For a known type Android adds
 * the extension itself ("data.json" became "data.json.json", and the copy then
 * looked for the name it had asked for and failed), so it goes without one.
 */
export function safName(fileName: string, mimeType: string) {
  const ext = extensionOf(fileName);
  return ext && mimeType !== 'application/octet-stream' && MIME_BY_EXTENSION[ext] === mimeType
    ? fileName.slice(0, -(ext.length + 1))
    : fileName;
}

/** "1.2 MB", for a file's size in a list. */
export function formatBytes(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
