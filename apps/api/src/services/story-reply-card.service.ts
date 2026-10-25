import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../middlewares/upload.middleware';
import { prisma } from '../utils/prisma';
import { StoryVisibilityService } from './story-visibility.service';
import { privateMediaBucket } from '../config/storage';

/**
 * The small Story card above a Story reply in chat, as on Instagram: which
 * Story the reply answers. Resolved each time the chat loads, never stored in
 * the message, so private media is not copied and an expired, deleted or
 * no-longer-visible Story simply shows "Story unavailable".
 */
export type StoryReplyCard = {
  id: string;
  available: boolean;
  thumbnailUrl: string | null;
  /** Only ever true while the Story is available, so nothing leaks afterwards. */
  closeFriends: boolean;
};

const CARD_URL_SECONDS = 15 * 60;

export class StoryReplyCardService {
  static unavailable(id: string): StoryReplyCard {
    return { id, available: false, thumbnailUrl: null, closeFriends: false };
  }

  static cardOf(cards: Map<string, StoryReplyCard>, storyId: string | null | undefined): StoryReplyCard | null {
    if (!storyId) return null;
    return cards.get(storyId) ?? this.unavailable(storyId);
  }

  /** Cards for the Story replies among these messages. */
  static cardsFor(viewerId: string, messages: Array<{ type?: string | null; storyId?: string | null }>) {
    const ids = [...new Set(messages.flatMap((message) => (message.type === 'story_reply' && message.storyId ? [message.storyId] : [])))];
    return this.cards(viewerId, ids);
  }

  static async cards(viewerId: string, storyIds: string[]): Promise<Map<string, StoryReplyCard>> {
    const cards = new Map<string, StoryReplyCard>(storyIds.map((id) => [id, this.unavailable(id)]));
    const bucket = privateMediaBucket();
    if (!storyIds.length || !bucket) return cards;
    const live = await prisma.story.findMany({
      where: { id: { in: storyIds }, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ownerId: true, audience: true, assetId: true },
    });
    const liveIds = new Set(live.map((story) => story.id));
    const remaining = storyIds.filter((id) => !liveIds.has(id));
    // Part 3: the owner may keep reopening their own Story card after it ends,
    // from their Archive. With no Highlights, nobody else's card ever resolves
    // once the Story has ended - StoryVisibilityService.canSeeEnded is owner-only.
    const ended = remaining.length
      ? await prisma.story.findMany({
        where: { id: { in: remaining }, ownerId: viewerId, state: 'published', deletedAt: null },
        select: { id: true, ownerId: true, audience: true, assetId: true },
      })
      : [];
    const stories = [...live, ...ended];
    if (!stories.length) return cards;
    const [visibility, assets] = await Promise.all([
      live.some((story) => story.ownerId !== viewerId) ? StoryVisibilityService.load(viewerId) : Promise.resolve(null),
      prisma.storyMediaAsset.findMany({
        where: { id: { in: stories.map((story) => story.assetId) }, status: 'attached' },
        select: { id: true, objectKey: true, thumbnailObjectKey: true, contentType: true },
      }),
    ]);
    const assetOf = new Map(assets.map((asset) => [asset.id, asset]));
    await Promise.all(stories.map(async (story) => {
      const asset = assetOf.get(story.assetId);
      if (!asset) return;
      const visible = liveIds.has(story.id)
        ? story.ownerId === viewerId || (visibility && StoryVisibilityService.canSee(visibility, story))
        : story.ownerId === viewerId;
      if (!visible) return;
      const key = asset.thumbnailObjectKey ?? (asset.contentType.startsWith('image/') ? asset.objectKey : null);
      const thumbnailUrl = key
        ? await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: CARD_URL_SECONDS }).catch(() => null)
        : null;
      cards.set(story.id, { id: story.id, available: true, thumbnailUrl, closeFriends: story.audience === 'close_friends' });
    }));
    return cards;
  }
}
