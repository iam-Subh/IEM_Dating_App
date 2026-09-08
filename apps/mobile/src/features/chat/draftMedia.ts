/**
 * Lifecycle for locally staged chat attachments.
 *
 * Recording, cropping and picking all write files into the app cache. Nothing
 * removed them once the attachment had been uploaded, so every voice note and
 * every cropped image stayed on the device permanently.
 *
 * Uses the current expo-file-system API. The legacy `FileSystem.deleteAsync`
 * helper is now a stub that throws, so callers that still used it were
 * silently failing to reclaim anything.
 *
 * Only files this app wrote into its own cache or document directory are
 * touched. A picked asset still pointing at the shared photo library is left
 * alone: deleting there would remove the user's own photo.
 */
import { File, Paths } from 'expo-file-system';

function appOwnedRoots(): string[] {
  const roots: string[] = [];
  for (const directory of [Paths.cache, Paths.document]) {
    const uri = directory?.uri;
    if (typeof uri === 'string' && uri.length > 0) roots.push(uri);
  }
  return roots;
}

export function isAppOwnedDraft(uri: string | null | undefined): boolean {
  if (!uri || typeof uri !== 'string') return false;
  if (!uri.startsWith('file://')) return false;
  return appOwnedRoots().some((root) => uri.startsWith(root));
}

/**
 * Deletes a staged attachment once it is safely uploaded.
 * Never throws: failing to reclaim space must not fail a delivered message.
 */
export async function discardDraftMedia(uri: string | null | undefined): Promise<void> {
  if (!isAppOwnedDraft(uri)) return;
  try {
    const file = new File(uri as string);
    if (file.exists) file.delete();
  } catch {
    // Reclaiming cache space is best effort.
  }
}

export async function discardDraftMediaBatch(uris: Array<string | null | undefined>): Promise<void> {
  await Promise.all(uris.map((uri) => discardDraftMedia(uri)));
}
