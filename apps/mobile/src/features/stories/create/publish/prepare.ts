import type { StoryBatchItemInput } from '../../../../../modules/chat-media';
import type { StoryDraftItem, StoryServerComposition } from '../composition/types';
import { storyDurationMs, toServerComposition, uuid, videoParts, videoRange } from '../composition/story';
import { filterById, isNeutral } from '../filters';
import { postDirectory } from '../render/renderStory';
import { keepFile, type PreparedStory } from './postingStore';

export type RenderedStory = {
  item: StoryDraftItem;
  /** The finished JPEG, for a photo. */
  photo?: { uri: string; size: number };
  /** Transparent decorations for a video, or null when it has none. */
  overlayUri?: string | null;
};

/** A part of a long video shows only its own captions, timed from the part's start. */
export function captionsForPart(composition: StoryServerComposition, offsetMs: number, lengthMs: number): StoryServerComposition {
  if (!composition.interactive.some((sticker) => sticker.type === 'captions')) return composition;
  return {
    ...composition,
    interactive: composition.interactive.map((sticker) => (sticker.type !== 'captions' ? sticker : {
      ...sticker,
      segments: sticker.segments
        .filter((segment) => segment.endMs > offsetMs && segment.startMs < offsetMs + lengthMs)
        .map((segment) => ({ ...segment, startMs: Math.max(0, segment.startMs - offsetMs), endMs: Math.min(lengthMs, segment.endMs - offsetMs) })),
    })),
  };
}

/**
 * One uploaded story per photo, and one per 60 second part of a video. Each
 * part carries the same edits and stickers; music continues from where the
 * previous part stopped.
 */
export async function prepareStories(batchId: string, rendered: RenderedStory[]): Promise<PreparedStory[]> {
  const dir = await postDirectory(batchId);
  const prepared: PreparedStory[] = [];
  for (const entry of rendered) {
    const { item } = entry;
    const composition = toServerComposition(item);
    if (item.media.kind === 'photo') {
      if (!entry.photo) throw new Error('A photo story was not rendered');
      const itemId = uuid();
      prepared.push({
        itemId,
        kind: 'photo',
        durationMs: storyDurationMs(item),
        composition,
        size: entry.photo.size,
        native: { itemId, kind: 'photo', sourceUri: entry.photo.uri },
      });
      continue;
    }

    const source = await keepFile(item.media.uri, dir, item.id);
    const range = videoRange(item);
    const filter = filterById(item.filterId).params;
    const stream = item.music?.track.streams.standard ?? item.music?.track.streams.preview ?? null;
    for (const part of videoParts(item)) {
      const itemId = uuid();
      const lengthMs = part.endMs - part.startMs;
      const musicOffset = part.startMs - range.startMs;
      const music = item.music && stream ? {
        url: stream,
        startMs: item.music.startMs + musicOffset,
        lengthMs,
        videoVolume: item.music.videoVolume ?? 1,
        musicVolume: item.music.musicVolume ?? 1,
      } : null;
      const native: StoryBatchItemInput = {
        itemId,
        kind: 'video',
        sourceUri: source,
        clipStartMs: part.startMs,
        clipEndMs: part.endMs,
        muted: item.muted,
        filter: isNeutral(filter) ? null : filter,
        transform: item.mediaTransform,
        fitMode: item.fitMode,
        background: item.background,
        overlayUri: entry.overlayUri ?? null,
        music,
      };
      prepared.push({
        itemId,
        kind: 'video',
        durationMs: lengthMs,
        partIndex: part.partIndex,
        partCount: part.partCount,
        composition: captionsForPart(
          item.music
            ? { ...composition, music: { ...composition.music!, startMs: item.music.startMs + musicOffset, lengthMs } }
            : composition,
          musicOffset,
          lengthMs,
        ),
        native,
      });
    }
  }
  return prepared;
}
