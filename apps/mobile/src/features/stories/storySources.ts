import { Image } from 'react-native';
import { api } from '../../services/api';

export type StorySource = {
  /** Empty while `locked`. */
  url: string;
  thumbnailUrl: string | null;
  contentType: string;
  /** Epoch ms after which the signed URL no longer works. */
  expiresAt: number;
  /**
   * A Reveal story you have not unlocked: the server sends only its hint and a
   * few pixels of colour, until you message its owner.
   */
  locked?: { hint: string; preview: string | null } | null;
};

/** The still shown for a Story before it plays, and in the cube turn. */
export const storyStill = (source: StorySource) =>
  source.locked ? source.locked.preview : source.contentType.startsWith('image/') ? source.url : source.thumbnailUrl;

/** Drops a cached URL, so the next load asks the server again (after a Reveal story is unlocked). */
export function forgetStorySource(storyId: string): void {
  cache.delete(storyId);
}

const cache = new Map<string, StorySource>();
const pending = new Map<string, Promise<StorySource>>();
const photos = new Map<string, Promise<boolean>>();

/** Share downloads between the tray, its opening check, and the viewer. */
export function prepareStoryPhoto(url: string): Promise<boolean> {
  const existing = photos.get(url);
  if (existing) return existing;
  const request = Image.prefetch(url).then(loaded => {
    if (!loaded && photos.get(url) === request) photos.delete(url);
    return loaded;
  }).catch(() => {
    if (photos.get(url) === request) photos.delete(url);
    return false;
  });
  photos.set(url, request);
  if (photos.size > 128) photos.delete(photos.keys().next().value!);
  return request;
}

/** Leave a minute of margin so a URL does not expire while a video plays. */
const EXPIRY_MARGIN_MS = 60_000;

export function cachedStorySource(storyId: string): StorySource | null {
  const source = cache.get(storyId);
  return source && source.expiresAt - EXPIRY_MARGIN_MS > Date.now() ? source : null;
}

/**
 * The signed media URL for a Story, fetched once and reused while it is valid.
 *
 * Photos are also downloaded here, so opening or tapping to a prepared Story
 * shows the picture at once instead of loading it on screen.
 */
export function loadStorySource(storyId: string): Promise<StorySource> {
  const cached = cachedStorySource(storyId);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(storyId);
  if (inflight) return inflight;
  const request = (async () => {
    const response = await api.get(`/stories/${storyId}/media`);
    const data = response.data?.data as { url: string | null; thumbnailUrl: string | null; contentType: string; expiresIn: number; locked?: StorySource['locked'] };
    const source: StorySource = {
      url: data.url ?? '',
      thumbnailUrl: data.thumbnailUrl ?? null,
      contentType: data.contentType,
      expiresAt: Date.now() + (data.expiresIn ?? 60) * 1000,
      locked: data.locked ?? null,
    };
    cache.set(storyId, source);
    const still = source.locked ? null : storyStill(source);
    if (still) await prepareStoryPhoto(still);
    return source;
  })().finally(() => pending.delete(storyId));
  pending.set(storyId, request);
  return request;
}

/** Records media whose URL is already known (demo Stories), and warms photos. */
export function registerStorySource(storyId: string, source: StorySource): void {
  cache.set(storyId, source);
  const still = source.contentType.startsWith('image/') ? source.url : source.thumbnailUrl;
  if (still) void prepareStoryPhoto(still);
}
