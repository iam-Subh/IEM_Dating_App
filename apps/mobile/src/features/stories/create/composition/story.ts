import {
  CANVAS, CENTER, PHOTO_DEFAULT_MS, PHOTO_MAX_MS, PHOTO_MIN_MS, VIDEO_PART_MS,
  type InteractiveSticker, type Layer, type MediaSource, type StoryDraftItem, type StoryServerComposition, type Transform,
} from './types';

let counter = 0;
/** A short unique id for layers and stickers. */
export function localId(prefix = 'l'): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** An RFC 4122 v4 id, for batches and items the server stores. */
export function uuid(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Portrait media close to 9:16 fills the canvas; anything else is shown whole
 * over a background, as Instagram does with landscape photos.
 */
export function fitModeFor(width: number, height: number): 'cover' | 'contain' {
  if (!width || !height) return 'cover';
  const aspect = width / height;
  return aspect <= 9 / 16 + 0.08 ? 'cover' : 'contain';
}

/** The media's size on the canvas before the user's own scale. */
export function baseMediaSize(media: Pick<MediaSource, 'width' | 'height'>, fitMode: 'cover' | 'contain') {
  const width = media.width || CANVAS.width;
  const height = media.height || CANVAS.height;
  const scale = fitMode === 'cover'
    ? Math.max(CANVAS.width / width, CANVAS.height / height)
    : Math.min(CANVAS.width / width, CANVAS.height / height);
  return { width: width * scale, height: height * scale };
}

export function newStoryItem(media: MediaSource, background: string[] = ['#262626', '#101010']): StoryDraftItem {
  return {
    id: uuid(),
    media,
    mediaTransform: { ...CENTER },
    fitMode: fitModeFor(media.width, media.height),
    background,
    filterId: 'normal',
    photoDurationMs: PHOTO_DEFAULT_MS,
    trim: media.kind === 'video' && media.durationMs ? { startMs: 0, endMs: media.durationMs } : null,
    muted: false,
    layers: [],
    drawing: [],
    music: null,
  };
}

export const isInteractiveLayer = (layer: Layer) => layer.kind === 'sticker';

/** The part of a story the server keeps: interactive stickers and music. */
/** Layers the viewer draws live rather than baked into the media: stickers, and text that animates. */
export const isLiveLayer = (layer: Layer) => layer.kind === 'sticker' || (layer.kind === 'text' && !!layer.animation);

export function toServerComposition(item: StoryDraftItem): StoryServerComposition {
  const all = item.layers.flatMap((layer): InteractiveSticker[] => {
    if (layer.kind === 'sticker') return [{ ...layer.sticker, transform: roundTransform(layer.sticker.transform) }];
    // The frame itself is in the media; the viewer only needs where its photo is.
    if (layer.kind === 'text' && layer.animation) {
      const { id, text, font, color, background, align, size, animation, wrap } = layer;
      return [{
        id, type: 'text', style: 'default', text, font, color, background, align, size, animation,
        ...(wrap ? { wrap: Math.round(wrap) } : {}),
        transform: roundTransform(layer.transform),
      }];
    }
    if (layer.kind === 'frame') {
      return [{ id: layer.id, type: 'frame', style: 'default', width: Math.round(layer.width), height: Math.round(layer.height), transform: roundTransform(layer.transform) }];
    }
    return [];
  });
  // One Reveal per story: the last one added.
  const lastReveal = all.map((sticker) => sticker.type).lastIndexOf('reveal');
  const interactive = all.filter((sticker, index) => sticker.type !== 'reveal' || index === lastReveal);
  const music = item.music
    ? (({ track: _track, ...rest }) => ({ ...rest, transform: rest.transform ? roundTransform(rest.transform) : undefined }))(item.music)
    : null;
  return { version: 1, interactive, music };
}

function roundTransform(transform: Transform): Transform {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return {
    x: Math.round(clamp(transform.x, -1080, 2160) * 10) / 10,
    y: Math.round(clamp(transform.y, -1920, 3840) * 10) / 10,
    scale: Math.round(clamp(transform.scale, 0.05, 20) * 1000) / 1000,
    rotation: Math.round(clamp(transform.rotation, -3600, 3600) * 10) / 10,
  };
}

export const clampPhotoDuration = (ms: number) => Math.min(PHOTO_MAX_MS, Math.max(PHOTO_MIN_MS, Math.round(ms / 1000) * 1000));

/** The selected stretch of a video. */
export function videoRange(item: StoryDraftItem) {
  const duration = item.media.durationMs ?? 0;
  const startMs = Math.max(0, Math.min(item.trim?.startMs ?? 0, duration));
  const endMs = Math.max(startMs, Math.min(item.trim?.endMs ?? duration, duration));
  return { startMs, endMs, lengthMs: endMs - startMs };
}

/** How long the story shows. A photo with music lasts as long as its clip. */
export function storyDurationMs(item: StoryDraftItem): number {
  if (item.media.kind === 'video') return Math.min(VIDEO_PART_MS, videoRange(item).lengthMs);
  if (item.music) return Math.min(PHOTO_MAX_MS, Math.max(PHOTO_MIN_MS, item.music.lengthMs));
  return clampPhotoDuration(item.photoDurationMs);
}

/**
 * A video longer than 60 seconds becomes consecutive 60 second stories, each
 * its own item. A last part shorter than a second is folded into the one before.
 */
export function videoParts(item: StoryDraftItem): Array<{ startMs: number; endMs: number; partIndex: number; partCount: number }> {
  const { startMs, endMs, lengthMs } = videoRange(item);
  if (lengthMs <= VIDEO_PART_MS + 500) return [{ startMs, endMs, partIndex: 1, partCount: 1 }];
  const bounds: Array<[number, number]> = [];
  for (let at = startMs; at < endMs; at += VIDEO_PART_MS) bounds.push([at, Math.min(endMs, at + VIDEO_PART_MS)]);
  const last = bounds[bounds.length - 1];
  if (bounds.length > 1 && last[1] - last[0] < 1000) {
    bounds.pop();
    bounds[bounds.length - 1][1] = endMs;
  }
  return bounds.map(([from, to], index) => ({ startMs: from, endMs: to, partIndex: index + 1, partCount: bounds.length }));
}

/** How many stories a selection will post, counting video parts. */
export function postedCount(items: StoryDraftItem[]): number {
  return items.reduce((total, item) => total + (item.media.kind === 'video' ? videoParts(item).length : 1), 0);
}
