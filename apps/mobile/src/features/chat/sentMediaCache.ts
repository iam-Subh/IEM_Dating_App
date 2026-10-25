/**
 * Makes a server media key resolve to the file the bubble was already showing.
 *
 * Sending an attachment used to end like this: the optimistic message carried a
 * `local-<uri>` key and rendered straight off disk, the server replied with a
 * real media key, and the draft file was deleted. The bubble was then holding a
 * path to a file that no longer existed, so it went black - and stayed black
 * until a `/chat/media/read` round trip produced a presigned URL and the image
 * downloaded over the network. The picture reappearing "after some ms" was the
 * app re-fetching a photo that had been on the device all along.
 *
 * Telegram solves this in `ImageLoader.replaceImageInCache(oldKey, newKey, ...)`:
 * when an upload completes it re-files the already-decoded bitmap from the
 * local-path key onto the server key, so the instant the message flips from its
 * local representation to the server one the image is already there under the
 * new key. Nothing is refetched and nothing blinks.
 *
 * This is the same move against the image pipeline we actually have. React
 * Native's image cache is keyed by URI, so rather than relocating the bytes and
 * inventing a new URI - which would be a cold cache miss, a disk read and a
 * decode before anything painted - the server key is simply pointed at the URI
 * the optimistic bubble was already using. Replacing the message remounts the
 * row, but the remount asks for a URI whose decoded bitmap is still in memory.
 *
 * The mapping is the cache. The files are wherever they already were: our own
 * cache directory for a crop or a recording, the shared photo library for an
 * untouched pick. Either can disappear underneath us, so every lookup can fail
 * and callers must fall back to the remote URL - see `forgetSentMedia`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { discardDraftMedia } from './draftMedia';

const STORAGE_KEY = 'chat:sentMediaIndex';

/**
 * How many sent attachments keep a local copy.
 *
 * Draft files used to be deleted the moment a message was delivered, and that
 * cleanup is what this replaces, so it cannot be unbounded. Oldest entries are
 * dropped first, and only files we wrote ourselves are deleted with them.
 */
const MAX_ENTRIES = 300;

/** Server media key -> the URI the bubble should render. Oldest first. */
const index = new Map<string, string>();

/** Memoised existence checks, so a list of bubbles does not re-stat per frame. */
const usable = new Map<string, boolean>();

let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Lets a bubble re-render when the index changes.
 *
 * Needed because hydration is asynchronous: on a cold start the first render
 * happens before the stored mapping is back, and without this the bubble would
 * settle on the remote URL and re-download media that is already on disk.
 */
export function subscribeSentMedia(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function sentMediaVersion(): number {
  return version;
}

function persist(): void {
  // Best effort: losing the index costs a re-download, never a message.
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...index])).catch(() => undefined);
}

let hydration: Promise<void> | undefined;
export function hydrateSentMediaCache(): Promise<void> {
  return hydration ??= restoreIndex();
}

async function restoreIndex(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const entries = JSON.parse(stored) as unknown;
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
        if (!index.has(entry[0])) index.set(entry[0], entry[1]);
      }
    }
    notify();
  } catch {
    // A corrupt index is simply an empty one.
  }
}
void hydrateSentMediaCache();

/**
 * True unless we can prove the file is gone.
 *
 * Only `file://` URIs can be checked cheaply. A `content://` pick is trusted and
 * left to fail through `onError` instead, which is the same outcome one render
 * later and avoids guessing wrong about a URI we cannot stat.
 */
function stillThere(uri: string): boolean {
  const remembered = usable.get(uri);
  if (remembered !== undefined) return remembered;

  let exists = true;
  if (uri.startsWith('file://')) {
    try {
      exists = new File(uri).exists;
    } catch {
      exists = false;
    }
  }
  usable.set(uri, exists);
  return exists;
}

/** Render-only lookup. Validation belongs to the loader, never a React render. */
export function peekSentMediaUri(mediaKey: string | null | undefined): string | null {
  if (!mediaKey || mediaKey.startsWith('local-')) return null;
  const uri = index.get(mediaKey);
  return uri && usable.get(uri) !== false ? uri : null;
}

/** The local file for a sent attachment, or null to use the remote URL. */
export function sentMediaUri(mediaKey: string | null | undefined): string | null {
  if (!mediaKey || mediaKey.startsWith('local-')) return null;
  const uri = index.get(mediaKey);
  if (!uri) return null;
  return stillThere(uri) ? uri : null;
}

/**
 * Drops an entry after the image failed to load from it.
 *
 * Our cache directory is evictable and a shared-library asset can be deleted by
 * the user, so a remembered URI is never a guarantee. Callers report the failure
 * here and fall back to the remote URL.
 */
export function forgetSentMedia(mediaKey: string | null | undefined): void {
  if (!mediaKey) return;
  const uri = index.get(mediaKey);
  if (uri) usable.set(uri, false);
  if (index.delete(mediaKey)) {
    persist();
    notify();
  }
}

/** Drops the oldest entries once the index outgrows its cap. */
async function evictOverflow(): Promise<void> {
  if (index.size <= MAX_ENTRIES) return;
  const doomed = [...index.keys()].slice(0, index.size - MAX_ENTRIES);
  const uris: string[] = [];
  for (const key of doomed) {
    const uri = index.get(key);
    if (uri) uris.push(uri);
    index.delete(key);
  }
  // Only ever reclaim files this app wrote. A pick still pointing at the shared
  // photo library is the user's own photo and is left alone.
  const retainedUris = new Set(index.values());
  await Promise.all([...new Set(uris)]
    .filter(uri => !retainedUris.has(uri))
    .map((uri) => discardDraftMedia(uri)));
}

/**
 * Points each server key at the file its upload came from.
 *
 * Call this instead of discarding drafts on send: these files are now the local
 * copy of a delivered message, and deleting them is what made the bubble go
 * black. Anything that failed to produce a key has no message to serve and is
 * still reclaimed.
 */
export async function adoptSentMedia(
  mediaKeys: Array<string | null>,
  localUris: Array<string | null>,
): Promise<void> {
  const orphans: Array<string | null> = [];
  let changed = false;

  localUris.forEach((uri, position) => {
    const key = mediaKeys[position] ?? null;
    if (!key || !uri) {
      orphans.push(uri);
      return;
    }
    // Re-insert so the entry counts as most recently used for eviction.
    index.delete(key);
    index.set(key, uri);
    usable.delete(uri);
    changed = true;
  });

  await evictOverflow();
  await Promise.all(orphans.map((uri) => discardDraftMedia(uri)));

  if (changed) {
    persist();
    notify();
  }
}


/** Where media downloaded from the server is kept. */
const DOWNLOAD_DIR = 'chat-media';

/** Deterministic per key, so a retry overwrites rather than accumulating. */
function downloadNameFor(mediaKey: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < mediaKey.length; index += 1) {
    hash ^= mediaKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}-${mediaKey.replace(/[^A-Za-z0-9._-]/g, '_').slice(-60)}`;
}

const downloading = new Map<string, Promise<string>>();
let activeDownloads = 0;
const waiting: Array<() => void> = [];

async function acquireDownload(): Promise<void> {
  if (activeDownloads < 3) {
    activeDownloads += 1;
    return;
  }
  await new Promise<void>(resolve => waiting.push(resolve));
}

function releaseDownload(): void {
  const next = waiting.shift();
  if (next) next();
  else activeDownloads -= 1;
}

/**
 * Keeps a copy of received media, so it is fetched from the server once.
 *
 * Read URLs are presigned and expire after fifteen minutes, so the URL for the
 * same attachment differs on every visit. That defeats the image pipeline's own
 * disk cache, which is keyed by URL: identical bytes under a new signature look
 * like a new image and are downloaded again. Keying on the media key instead
 * keeps the file reusable until cache eviction. Resolve the local file before
 * requesting a URL. Concurrent callers share one download and one local URI.
 */
export async function resolveCachedMedia(mediaKey: string, loadUrl: () => Promise<string>): Promise<string> {
  await hydrateSentMediaCache();
  const cached = sentMediaUri(mediaKey);
  if (cached) return cached;
  const pending = downloading.get(mediaKey);
  if (pending) return pending;
  const task = (async () => {
    await acquireDownload();
    try {
      // Another sender or download may have supplied the file while queued.
      const supplied = sentMediaUri(mediaKey);
      if (supplied) return supplied;
      index.delete(mediaKey);
      const directory = new Directory(Paths.cache, DOWNLOAD_DIR);
      if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
      const destination = new File(directory, downloadNameFor(mediaKey));
      if (destination.exists) destination.delete();
      const url = await loadUrl();
      const downloaded = await File.downloadFileAsync(url, destination);
      index.delete(mediaKey);
      index.set(mediaKey, downloaded.uri);
      usable.set(downloaded.uri, true);
      await evictOverflow();
      persist();
      notify();
      return downloaded.uri;
    } finally {
      releaseDownload();
    }
  })();
  downloading.set(mediaKey, task);
  try { return await task; }
  finally { downloading.delete(mediaKey); }
}
