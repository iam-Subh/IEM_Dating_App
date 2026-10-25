import { PERSON_WITH_BADGE, personWithBadge } from './blue-badge';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { NudityService, verdictOf } from './nudity.service';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import type { Story } from '@prisma/client';
import sharp from 'sharp';
import { s3Client } from '../middlewares/upload.middleware';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { logger } from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { revealOf } from '../schemas/story-composition.schema';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';
import { ChatService } from './chat.service';
import { StoryVisibilityService } from './story-visibility.service';
import { PrivateMediaInspectionService } from './private-media-inspection.service';
import { PrivateMediaProcessingService, VideoTooLongError } from './private-media-processing.service';
import { privateMediaBucket } from '../config/storage';
import { getIO } from '../socket';

const TYPES: Record<string, { contentType: string; maxBytes: number }> = {
  jpg: { contentType: 'image/jpeg', maxBytes: 15 * 1024 * 1024 },
  jpeg: { contentType: 'image/jpeg', maxBytes: 15 * 1024 * 1024 },
  png: { contentType: 'image/png', maxBytes: 15 * 1024 * 1024 },
  webp: { contentType: 'image/webp', maxBytes: 15 * 1024 * 1024 },
  mp4: { contentType: 'video/mp4', maxBytes: 50 * 1024 * 1024 },
};

/** Instagram's eight quick reactions, in its order. Mirrors QUICK_REACTIONS in StoryFooter.tsx. */
export const QUICK_STORY_REACTIONS = ['😂', '😮', '😍', '😢', '👏', '🔥', '🎉', '💯'] as const;

export const STORY_SETTINGS_SELECT = {
  storiesEnabled: true, allowFollowRequests: true, storyReplies: true, storyMentions: true, storyResharing: true, storyScreenshotBlock: true,
  storyArchive: true, storySaveToGallery: true, showFollowerCount: true,
} as const;

/** The Story settings as the app sees them. */
export function storySettingsOf(user: {
  storiesEnabled: boolean; allowFollowRequests: boolean; storyReplies: string; storyMentions: string; storyResharing: boolean; storyScreenshotBlock: boolean;
  storyArchive: boolean; storySaveToGallery: boolean; showFollowerCount: boolean;
}) {
  return {
    storiesEnabled: user.storiesEnabled,
    allowFollowRequests: user.allowFollowRequests,
    replies: user.storyReplies,
    mentions: user.storyMentions,
    resharing: user.storyResharing,
    screenshotBlock: user.storyScreenshotBlock,
    archive: user.storyArchive,
    saveToGallery: user.storySaveToGallery,
    showFollowerCount: user.showFollowerCount,
  };
}

export class StoryService {
  private static get bucket() {
    const value = privateMediaBucket();
    if (!value) throw new Error('AWS_PRIVATE_MEDIA_BUCKET is required for Stories');
    return value;
  }

  /** Whether this viewer may see this Story. See `StoryVisibilityService` for the rule. */
  private static canView(viewerId: string, story: { ownerId: string; audience: string }) {
    return StoryVisibilityService.check(viewerId, story);
  }

  /**
   * A Story this viewer may open right now: live and in their audience, or -
   * Part 3 - their own, ended, and still in their Archive. Used by routes that
   * a chat story card or a direct link can reach outside the tray, so an
   * owner can keep reopening their own Story after it ends, while nobody else
   * ever can. See `StoryVisibilityService.canSeeEnded`.
   */
  private static async findForViewer(viewerId: string, storyId: string) {
    const live = await prisma.story.findFirst({ where: { id: storyId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } });
    if (live && (await this.canView(viewerId, live))) return live;
    const ended = await prisma.story.findFirst({ where: { id: storyId, state: 'published', deletedAt: null } });
    if (ended && StoryVisibilityService.canSeeEnded(viewerId, ended)) return ended;
    return null;
  }

  /**
   * Whether a viewer may reply to an owner's Stories, and the reason the app
   * may show when not. Replies set to Close Friends look exactly like "off" to
   * anyone not on the list, so the list stays private.
   */
  private static replyState(viewerId: string, ownerId: string, setting: string, matched: boolean, closeFriend: boolean): {
    canReply: boolean; replyBlockedReason: 'own' | 'off' | 'not_matched' | null;
  } {
    if (viewerId === ownerId) return { canReply: false, replyBlockedReason: 'own' };
    if (setting === 'off' || (setting === 'close_friends' && !closeFriend)) return { canReply: false, replyBlockedReason: 'off' };
    if (!matched) return { canReply: false, replyBlockedReason: 'not_matched' };
    return { canReply: true, replyBlockedReason: null };
  }

  static async requestUpload(ownerId: string, ext: string) {
    const enabled = await prisma.user.findFirst({ where: { id: ownerId, storiesEnabled: true, accountStatus: 'active' }, select: { id: true } });
    if (!enabled) throw new HttpError(409, 'Enable Stories before you upload', 'STORIES_NOT_ENABLED');
    const type = TYPES[ext.toLowerCase()];
    if (!type) throw new HttpError(400, 'Story media type is not supported', 'UNSUPPORTED_STORY_MEDIA');
    const key = `stories/${ownerId}/${randomUUID()}.${ext.toLowerCase()}`;
    const asset = await prisma.storyMediaAsset.create({
      data: { ownerId, objectKey: key, contentType: type.contentType, maxBytes: type.maxBytes, expiresAt: new Date(Date.now() + 10 * 60_000) },
    });
    try {
      const uploadUrl = await getSignedUrl(s3Client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: type.contentType }), { expiresIn: 300 });
      return { assetId: asset.id, uploadUrl, contentType: type.contentType, maxBytes: type.maxBytes };
    } catch (error) {
      await prisma.storyMediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
      throw error;
    }
  }

  /** The Story, if it is live and the viewer may see it. */
  static async requireVisibleStory(viewerId: string, storyId: string) {
    const story = await prisma.story.findFirst({ where: { id: storyId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } });
    if (!story || !(await this.canView(viewerId, story))) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    return story;
  }

  static async completeUpload(ownerId: string, assetId: string, options: { maxDurationMs?: number } = {}): Promise<{ id: string; status: string; durationMs?: number | null }> {
    const claimed = await prisma.storyMediaAsset.updateMany({
      where: { id: assetId, ownerId, status: 'requested', expiresAt: { gt: new Date() } },
      data: { status: 'processing' },
    });
    if (claimed.count === 0) {
      const existing = await prisma.storyMediaAsset.findFirst({ where: { id: assetId, ownerId } });
      if (existing && ['ready', 'attached'].includes(existing.status)) return { id: existing.id, status: existing.status };
      if (existing?.status === 'processing') throw new HttpError(409, 'Story media processing is in progress', 'STORY_PROCESSING_IN_PROGRESS');
      if (existing?.status === 'rejected') throw new HttpError(422, 'Story media processing failed', 'STORY_PROCESSING_FAILED');
      throw new HttpError(404, 'Story upload is unavailable', 'STORY_UPLOAD_UNAVAILABLE');
    }
    const asset = await prisma.storyMediaAsset.findFirst({ where: { id: assetId, ownerId, status: 'processing' } });
    if (!asset) throw new HttpError(409, 'Story processing state changed', 'STORY_PROCESSING_STATE_CHANGED');
    let head;
    try { head = await s3Client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: asset.objectKey })); }
    catch {
      await prisma.storyMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } });
      throw new HttpError(400, 'Story upload was not found', 'STORY_UPLOAD_MISSING');
    }
    const detectedType = await PrivateMediaInspectionService.detect(this.bucket, asset.objectKey).catch(() => null);
    if (!head.ContentLength || head.ContentLength > asset.maxBytes || head.ContentType !== asset.contentType || detectedType !== asset.contentType) {
      await prisma.storyMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } });
      throw new HttpError(400, 'Story media does not match its upload ticket', 'STORY_UPLOAD_INVALID');
    }
    let processed;
    try { processed = await PrivateMediaProcessingService.process(this.bucket, asset.objectKey, `stories-approved/${ownerId}`, asset.id, detectedType, { maxDurationMs: options.maxDurationMs }); }
    catch (error) {
      await prisma.storyMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } });
      if (error instanceof VideoTooLongError) throw new HttpError(422, 'Story videos can be up to 60 seconds', 'STORY_VIDEO_TOO_LONG');
      throw new HttpError(422, 'Story media processing failed', 'STORY_PROCESSING_FAILED');
    }
    // The nudity check (docs/NUDITY_CHECK.md): an explicit Story is refused
    // here; a borderline one is kept, and posted only once the team approves it.
    const nudityScore = await NudityService.scoreObject(this.bucket, processed.objectKey, processed.contentType);
    if (verdictOf(nudityScore) === 'block') {
      await Promise.all([
        s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: processed.objectKey })),
        ...(processed.thumbnailObjectKey ? [s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: processed.thumbnailObjectKey }))] : []),
        s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: asset.objectKey })),
      ]).catch(() => undefined);
      await prisma.storyMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected', nudityScore } });
      await prisma.mediaModeration.create({ data: { userId: ownerId, kind: 'story', assetId: asset.id, score: nudityScore, status: 'blocked' } });
      void NudityService.recordStrike(ownerId).catch(() => undefined);
      throw new HttpError(422, "This Story can't be posted. Stories must follow our Community Guidelines.", 'STORY_EXPLICIT');
    }
    let ready;
    try {
      ready = await prisma.storyMediaAsset.update({
        where: { id: asset.id },
        data: { objectKey: processed.objectKey, contentType: processed.contentType, thumbnailObjectKey: processed.thumbnailObjectKey, status: 'ready', detectedType, checksum: head.ChecksumSHA256 ?? null, processedAt: new Date(), nudityScore },
        select: { id: true, status: true },
      });
    } catch (error) {
      await Promise.all([
        s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: processed.objectKey })),
        ...(processed.thumbnailObjectKey ? [s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: processed.thumbnailObjectKey }))] : []),
      ]).catch(() => undefined);
      await prisma.storyMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } }).catch(() => undefined);
      throw error;
    }
    await s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: asset.objectKey })).catch(() => undefined);
    return { ...ready, durationMs: processed.durationMs };
  }

  static async publish(ownerId: string, input: { assetId: string; clientPublishId: string; caption?: string }) {
    const existing = await prisma.story.findUnique({ where: { ownerId_clientPublishId: { ownerId, clientPublishId: input.clientPublishId } } });
    if (existing) {
      if (existing.assetId !== input.assetId || (existing.caption ?? '') !== (input.caption?.trim() ?? '')) {
        throw new HttpError(409, 'Publish identifier has different content', 'IDEMPOTENCY_MISMATCH');
      }
      return { ...existing, repeated: true };
    }
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 4))`;
      const activeCount = await tx.story.count({ where: { ownerId, state: 'published', expiresAt: { gt: new Date() } } });
      if (activeCount >= 20) throw new HttpError(429, 'You can have a maximum of 20 active Stories', 'STORY_QUOTA');
      const asset = await tx.storyMediaAsset.findFirst({ where: { id: input.assetId, ownerId, status: 'ready' } });
      if (!asset) throw new HttpError(404, 'Story media is unavailable', 'STORY_MEDIA_UNAVAILABLE');
      const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { storyArchive: true } });
      // Borderline: held as "in review" until the team approves it (docs/NUDITY_CHECK.md).
      const nudity = verdictOf(asset.nudityScore);
      const story = await tx.story.create({
        data: {
          ownerId, assetId: asset.id, clientPublishId: input.clientPublishId, caption: input.caption?.trim(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000), archive: owner?.storyArchive ?? true,
          ...(nudity === 'review' ? { state: 'in_review' } : {}),
        },
      });
      await tx.storyMediaAsset.update({ where: { id: asset.id }, data: { status: 'attached' } });
      if (nudity === 'review' || nudity === 'unchecked') {
        await tx.mediaModeration.create({ data: { userId: ownerId, kind: 'story', assetId: asset.id, storyId: story.id, objectKey: asset.objectKey, score: asset.nudityScore, status: nudity === 'review' ? 'pending' : 'unchecked' } });
      }
      if (nudity !== 'review') await OutboxService.enqueue(tx, { topic: OUTBOX_TOPICS.STORY_PUBLISHED, aggregateId: story.id, deduplicationKey: `story.published:${story.id}`, payload: { ownerId } });
      return { ...story, repeated: false };
    });
  }

  static async feed(viewerId: string) {
    return (await this.feedPage(viewerId, undefined, 200)).items;
  }

  /**
   * The Stories tray, grouped by person, in Instagram's order.
   *
   * Your own Stories come first. Then people with an unseen Close Friends
   * Story, then others with a Story you have not seen, newest first, then
   * people you have fully watched. Muted authors are left out. Within a person
   * the Stories run oldest to newest, as they are played, and each person
   * carries the index of the first one you have not seen, which is where
   * opening them starts.
   */
  static async tray(viewerId: string) {
    const visibility = await StoryVisibilityService.load(viewerId);
    const stories = await prisma.story.findMany({
      where: {
        AND: [
          StoryVisibilityService.filter(visibility, { excludeMuted: true }),
          { state: 'published', deletedAt: null, expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      take: 2000,
    });
    return this.groupStories(viewerId, stories);
  }

  /**
   * One person's live Stories as a tray group, for opening them from their
   * profile (Search's social layer). The same visibility rule as the tray,
   * but a muted author still opens from their profile, as the spec says.
   */
  static async ownerGroup(viewerId: string, ownerId: string) {
    const visibility = await StoryVisibilityService.load(viewerId);
    const stories = await prisma.story.findMany({
      where: {
        AND: [
          StoryVisibilityService.filter(visibility),
          { ownerId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    const { groups } = await this.groupStories(viewerId, stories);
    return groups[0] ?? null;
  }

  /**
   * The Story ring for each of these people, as this viewer may see it:
   * unseen (gradient), Close Friends unseen (green), or all watched (grey),
   * and until when it lasts. Absent when there is nothing this viewer may see
   * - so the ring itself never tells anyone they are left out.
   */
  static async ringsFor(viewerId: string, ownerIds: string[]) {
    const rings = new Map<string, { unseen: boolean; closeFriends: boolean; until: string }>();
    const others = ownerIds.filter((id) => id !== viewerId);
    if (!others.length) return rings;
    const visibility = await StoryVisibilityService.load(viewerId);
    const stories = await prisma.story.findMany({
      where: {
        AND: [
          StoryVisibilityService.filter(visibility),
          { ownerId: { in: others }, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } },
        ],
      },
      select: { id: true, ownerId: true, audience: true, expiresAt: true, assetId: true },
      take: 2000,
    });
    if (!stories.length) return rings;
    const [assets, views] = await Promise.all([
      prisma.storyMediaAsset.findMany({ where: { id: { in: stories.map((story) => story.assetId) }, status: 'attached' }, select: { id: true } }),
      prisma.storyView.findMany({ where: { viewerId, storyId: { in: stories.map((story) => story.id) } }, select: { storyId: true } }),
    ]);
    const playable = new Set(assets.map((asset) => asset.id));
    const seen = new Set(views.map((view) => view.storyId));
    for (const story of stories) {
      // A story whose media never attached is not in the tray, so no ring for it either.
      if (!playable.has(story.assetId)) continue;
      const ring = rings.get(story.ownerId) ?? { unseen: false, closeFriends: false, until: story.expiresAt.toISOString() };
      const unseen = !seen.has(story.id);
      ring.unseen ||= unseen;
      ring.closeFriends ||= unseen && story.audience === 'close_friends';
      if (story.expiresAt.toISOString() > ring.until) ring.until = story.expiresAt.toISOString();
      rings.set(story.ownerId, ring);
    }
    return rings;
  }

  /**
   * A live nudge that someone's Stories changed, to everyone who could see
   * them - the same audience `story_published` goes to. It carries no Story,
   * so it never says what or for whom; the app re-reads through the rules.
   */
  static async nudgeRemoved(ownerId: string) {
    const io = getIO();
    if (!io) return;
    const audience = await StoryVisibilityService.audienceOf(ownerId);
    for (const recipientId of audience) io.to(`user:${recipientId}`).emit('story_removed', { ownerId });
  }

  /**
   * "Your relationship with this person changed - re-read them", to each of
   * `viewerIds`: a Close Friends or hidden list edit, or a follow accepted or
   * removed. It names nobody and says nothing about which list; the app
   * re-reads the tray and any open profile through the visibility rules, and
   * the ring shows whatever those rules now allow.
   *
   * `onlyIfLive`: for list edits, sent only while the owner has a live Story,
   * because only then does anything visible change - no signal otherwise.
   */
  static async nudgeRelationship(ownerId: string, viewerIds: string[], onlyIfLive = true) {
    const io = getIO();
    const targets = [...new Set(viewerIds)].filter((id) => id && id !== ownerId);
    if (!io || !targets.length) return;
    if (onlyIfLive) {
      const live = await prisma.story.count({
        where: { ownerId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!live) return;
    }
    for (const id of targets) io.to(`user:${id}`).emit('relationship_changed', { userId: ownerId });
  }

  /** Stories (oldest first) grouped by person in tray order, with what this viewer has seen and liked. */
  private static async groupStories(viewerId: string, stories: Story[]) {
    const assets = await prisma.storyMediaAsset.findMany({
      where: { id: { in: stories.map((story) => story.assetId) }, status: 'attached' },
      select: { id: true, contentType: true },
    });
    const assetTypes = new Map(assets.map((asset) => [asset.id, asset.contentType]));
    const visible = stories.filter((story) => assetTypes.has(story.assetId));
    const ids = visible.map((story) => story.id);
    const ownIds = visible.filter((story) => story.ownerId === viewerId).map((story) => story.id);
    const otherOwnerIds = [...new Set(visible.map((story) => story.ownerId))].filter((id) => id !== viewerId);
    const [views, likes, owners, viewCounts, likeCounts, replySettings, matches, closeFriendOf] = await Promise.all([
      prisma.storyView.findMany({ where: { viewerId, storyId: { in: ids } }, select: { storyId: true } }),
      prisma.storyLike.findMany({ where: { viewerId, storyId: { in: ids } }, select: { storyId: true } }),
      prisma.user.findMany({ where: { id: { in: [...new Set(visible.map((story) => story.ownerId))] } }, select: PERSON_WITH_BADGE }).then((rows) => rows.map(personWithBadge)),
      ownIds.length ? prisma.storyView.groupBy({ by: ['storyId'], where: { storyId: { in: ownIds } }, _count: { _all: true } }) : Promise.resolve([]),
      ownIds.length ? prisma.storyLike.groupBy({ by: ['storyId'], where: { storyId: { in: ownIds } }, _count: { _all: true } }) : Promise.resolve([]),
      // Who may reply, per owner. Kept out of `owners`, which is sent to the app as is.
      otherOwnerIds.length ? prisma.user.findMany({ where: { id: { in: otherOwnerIds } }, select: { id: true, storyReplies: true } }) : Promise.resolve([]),
      otherOwnerIds.length ? prisma.match.findMany({
        where: { status: 'active', OR: [{ user1Id: viewerId, user2Id: { in: otherOwnerIds } }, { user2Id: viewerId, user1Id: { in: otherOwnerIds } }] },
        select: { id: true, user1Id: true, user2Id: true },
      }) : Promise.resolve([]),
      otherOwnerIds.length ? prisma.storyCloseFriend.findMany({ where: { friendId: viewerId, ownerId: { in: otherOwnerIds } }, select: { ownerId: true } }) : Promise.resolve([]),
    ]);
    const seen = new Set(views.map((view) => view.storyId));
    const liked = new Set(likes.map((like) => like.storyId));
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
    const replySettingOf = new Map(replySettings.map((row) => [row.id, row.storyReplies]));
    // Lets the app offer "view profile" on an owner's name only when there is
    // somewhere to send it to - a match, exactly as the Activity sheet's own
    // "Message" row action already requires (section 17.3's "tap the name").
    const matchIdOf = new Map(matches.map((match) => [match.user1Id === viewerId ? match.user2Id : match.user1Id, match.id]));
    const onCloseFriendsOf = new Set(closeFriendOf.map((row) => row.ownerId));
    const viewCountMap = new Map((viewCounts as Array<{ storyId: string; _count: { _all: number } }>).map((row) => [row.storyId, row._count._all]));
    const likeCountMap = new Map((likeCounts as Array<{ storyId: string; _count: { _all: number } }>).map((row) => [row.storyId, row._count._all]));

    const groups = new Map<string, typeof visible>();
    for (const story of visible) {
      const list = groups.get(story.ownerId) ?? [];
      list.push(story);
      groups.set(story.ownerId, list);
    }
    const result = [...groups.entries()].flatMap(([ownerId, list]) => {
      const owner = ownerMap.get(ownerId);
      if (!owner) return [];
      const isOwn = ownerId === viewerId;
      const items = list.map((story) => ({
        id: story.id,
        ownerId,
        contentType: assetTypes.get(story.assetId)!,
        caption: story.caption,
        publishedAt: story.publishedAt.toISOString(),
        expiresAt: story.expiresAt.toISOString(),
        durationMs: story.durationMs ?? null,
        composition: story.composition ?? null,
        audience: story.audience === 'close_friends' ? 'close_friends' as const : 'followers' as const,
        // Your own Stories are never "unseen" to you.
        seen: isOwn || seen.has(story.id),
        liked: liked.has(story.id),
        ...(isOwn ? { viewCount: viewCountMap.get(story.id) ?? 0, likeCount: likeCountMap.get(story.id) ?? 0 } : {}),
      }));
      const firstUnseen = items.findIndex((item) => !item.seen);
      return [{
        owner,
        isOwn,
        hasUnseen: firstUnseen >= 0,
        // Drives the green ring, and puts this person first in the tray.
        closeFriendsUnseen: items.some((item) => !item.seen && item.audience === 'close_friends'),
        firstUnseenIndex: Math.max(0, firstUnseen),
        latestPublishedAt: items[items.length - 1].publishedAt,
        matchId: isOwn ? null : matchIdOf.get(ownerId) ?? null,
        ...this.replyState(viewerId, ownerId, replySettingOf.get(ownerId) ?? 'matches', matchIdOf.has(ownerId), onCloseFriendsOf.has(ownerId)),
        stories: items,
      }];
    });
    result.sort((first, second) => {
      if (first.isOwn !== second.isOwn) return first.isOwn ? -1 : 1;
      if (first.closeFriendsUnseen !== second.closeFriendsUnseen) return first.closeFriendsUnseen ? -1 : 1;
      if (first.hasUnseen !== second.hasUnseen) return first.hasUnseen ? -1 : 1;
      return second.latestPublishedAt.localeCompare(first.latestPublishedAt);
    });
    return { groups: result };
  }

  /**
   * An Add Yours thread: its prompt, how many stories joined it, and the ones
   * this viewer may watch, grouped like the tray so the viewer can play them.
   */
  static async addYoursThread(viewerId: string, threadId: string) {
    const thread = await prisma.storyAddYoursThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new HttpError(404, 'This Add Yours is unavailable', 'ADD_YOURS_UNAVAILABLE');
    const visibility = await StoryVisibilityService.load(viewerId);
    const [count, entries, creator] = await Promise.all([
      prisma.storyAddYoursEntry.count({ where: { threadId } }),
      prisma.storyAddYoursEntry.findMany({ where: { threadId }, orderBy: { createdAt: 'desc' }, take: 300, select: { storyId: true } }),
      prisma.user.findFirst({ where: { id: thread.creatorId, accountStatus: 'active' }, select: { id: true, name: true, avatarUrl: true } }),
    ]);
    // Judged per Story, not per person: a Close Friends entry shows only to that owner's close friends.
    const stories = (await prisma.story.findMany({
      where: { id: { in: entries.map((entry) => entry.storyId) }, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
    })).filter((story) => StoryVisibilityService.canSee(visibility, story));
    const { groups } = await this.groupStories(viewerId, stories);
    return { thread: { id: thread.id, prompt: thread.prompt, music: thread.music, count, creator }, groups };
  }

  /** Likes or unlikes someone else's Story. */
  static async setLike(viewerId: string, storyId: string, liked: boolean) {
    const story = await prisma.story.findFirst({ where: { id: storyId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } });
    if (!story || !(await this.canView(viewerId, story))) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    if (story.ownerId === viewerId) throw new HttpError(400, 'You cannot like your own Story', 'INVALID_STORY_LIKE');
    if (liked) {
      await prisma.storyLike.upsert({ where: { storyId_viewerId: { storyId, viewerId } }, create: { storyId, viewerId }, update: {} });
    } else {
      await prisma.storyLike.deleteMany({ where: { storyId, viewerId } });
    }
    return { liked };
  }

  static async feedPage(viewerId: string, cursor?: string, limit = 50) {
    const visibility = await StoryVisibilityService.load(viewerId);
    let decoded: { highWater: string; publishedAt: string; id: string } | null = null;
    if (cursor) {
      try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!decoded?.highWater || !decoded.publishedAt || !decoded.id) throw new Error('missing fields');
      } catch { throw new HttpError(400, 'Story cursor is invalid', 'INVALID_STORY_CURSOR'); }
    }
    const highWater = decoded ? new Date(decoded.highWater) : new Date();
    const lastPublishedAt = decoded ? new Date(decoded.publishedAt) : null;
    if (Number.isNaN(highWater.getTime()) || (lastPublishedAt && Number.isNaN(lastPublishedAt.getTime()))) throw new HttpError(400, 'Story cursor is invalid', 'INVALID_STORY_CURSOR');
    const take = Math.min(Math.max(limit, 1), 100);
    const stories = await prisma.story.findMany({
      where: {
        AND: [
          StoryVisibilityService.filter(visibility, { excludeMuted: true }),
          { state: 'published', deletedAt: null, expiresAt: { gt: new Date() }, publishedAt: { lte: highWater } },
          ...(lastPublishedAt && decoded ? [{ OR: [{ publishedAt: { lt: lastPublishedAt } }, { publishedAt: lastPublishedAt, id: { lt: decoded.id } }] }] : []),
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    const hasMore = stories.length > take;
    const page = hasMore ? stories.slice(0, take) : stories;
    const assets = await prisma.storyMediaAsset.findMany({ where: { id: { in: page.map((item) => item.assetId) }, status: 'attached' } });
    const users = (await prisma.user.findMany({ where: { id: { in: [...new Set(page.map((item) => item.ownerId))] } }, select: PERSON_WITH_BADGE })).map(personWithBadge);
    const assetMap = new Map(assets.map((item) => [item.id, item]));
    const userMap = new Map(users.map((item) => [item.id, item]));
    const items = page.filter((story) => assetMap.has(story.assetId)).map((story) => ({
      ...story,
      owner: userMap.get(story.ownerId),
      contentType: assetMap.get(story.assetId)!.contentType,
    }));
    const last = page[page.length - 1];
    return {
      items,
      highWater: highWater.toISOString(),
      nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ highWater: highWater.toISOString(), publishedAt: last.publishedAt.toISOString(), id: last.id })).toString('base64url') : null,
    };
  }

  static async readUrl(viewerId: string, storyId: string) {
    const story = await this.findForViewer(viewerId, storyId);
    if (!story) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    const asset = await prisma.storyMediaAsset.findFirst({ where: { id: story.assetId, status: 'attached' } });
    if (!asset) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    // Long enough to preload a Story, pause it, and let a video buffer again.
    // A 60 second URL expired under a paused or buffering video.
    const expiresIn = 15 * 60;
    // A Reveal story's media stays on the server until the viewer has messaged
    // its owner. They get the hint and a few pixels of colour to blur instead.
    const reveal = revealOf(story.composition);
    if (reveal && story.ownerId !== viewerId) {
      const unlocked = await prisma.storyRevealUnlock.findUnique({ where: { storyId_viewerId: { storyId, viewerId } }, select: { id: true } });
      if (!unlocked) {
        return { url: null, thumbnailUrl: null, expiresIn, contentType: asset.contentType, locked: { hint: reveal.hint, preview: await this.revealPreview(story.id, asset) } };
      }
    }
    const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: this.bucket, Key: asset.objectKey }), { expiresIn });
    const thumbnailUrl = asset.thumbnailObjectKey ? await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: this.bucket, Key: asset.thumbnailObjectKey }), { expiresIn }) : null;
    return { url, thumbnailUrl, expiresIn, contentType: asset.contentType, locked: null };
  }

  /** 12 × 21 pixels of a Reveal story: its colours, nothing recognisable. Cached for the Story's lifetime. */
  private static async revealPreview(storyId: string, asset: { objectKey: string; thumbnailObjectKey: string | null; contentType: string }) {
    const cacheKey = `story:reveal-preview:${storyId}`;
    const cached = await redisClient.get(cacheKey).catch(() => null);
    if (cached) return cached;
    const key = asset.contentType.startsWith('image/') ? asset.objectKey : asset.thumbnailObjectKey;
    if (!key) return null;
    try {
      const object = await s3Client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = Buffer.from(await object.Body!.transformToByteArray());
      const tiny = await sharp(bytes).rotate().resize(12, 21, { fit: 'cover' }).blur(1).jpeg({ quality: 60 }).toBuffer();
      const preview = `data:image/jpeg;base64,${tiny.toString('base64')}`;
      await redisClient.set(cacheKey, preview, 'EX', 26 * 60 * 60).catch(() => undefined);
      return preview;
    } catch (error) {
      logger.warn('Could not make a Reveal preview', { storyId, error: (error as Error)?.message });
      return null;
    }
  }

  static async get(viewerId: string, storyId: string) {
    const story = await this.findForViewer(viewerId, storyId);
    if (!story) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    const [owner, settings, match, closeFriend, asset, view, like] = await Promise.all([
      prisma.user.findUnique({ where: { id: story.ownerId }, select: PERSON_WITH_BADGE }).then((row) => (row ? personWithBadge(row) : null)),
      prisma.user.findUnique({ where: { id: story.ownerId }, select: { storyReplies: true } }),
      prisma.match.findFirst({
        where: { status: 'active', OR: [{ user1Id: viewerId, user2Id: story.ownerId }, { user1Id: story.ownerId, user2Id: viewerId }] },
        select: { id: true },
      }),
      prisma.storyCloseFriend.findUnique({ where: { ownerId_friendId: { ownerId: story.ownerId, friendId: viewerId } }, select: { id: true } }),
      prisma.storyMediaAsset.findFirst({ where: { id: story.assetId, status: 'attached' }, select: { contentType: true } }),
      prisma.storyView.findUnique({ where: { storyId_viewerId: { storyId, viewerId } }, select: { id: true } }),
      prisma.storyLike.findUnique({ where: { storyId_viewerId: { storyId, viewerId } }, select: { id: true } }),
    ]);
    return {
      ...story,
      owner,
      // Enough to play a Story opened on its own (from a chat reply or a link), outside the tray.
      contentType: asset?.contentType ?? null,
      seen: story.ownerId === viewerId || !!view,
      liked: !!like,
      matchId: story.ownerId === viewerId ? null : match?.id ?? null,
      ...this.replyState(viewerId, story.ownerId, settings?.storyReplies ?? 'matches', !!match, !!closeFriend),
    };
  }

  static async recordView(viewerId: string, storyId: string) {
    const story = await prisma.story.findFirst({ where: { id: storyId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } });
    if (!story || !(await this.canView(viewerId, story))) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    if (viewerId === story.ownerId) return { recorded: false };
    const view = await prisma.storyView.upsert({ where: { storyId_viewerId: { storyId, viewerId } }, create: { storyId, viewerId }, update: {} });
    return { recorded: true, firstVisibleAt: view.firstVisibleAt };
  }

  static async viewers(ownerId: string, storyId: string) {
    const story = await prisma.story.findFirst({ where: { id: storyId, ownerId } });
    if (!story) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    return prisma.storyView.findMany({ where: { storyId }, orderBy: [{ firstVisibleAt: 'desc' }, { id: 'desc' }], take: 500 });
  }

  static async viewersPage(ownerId: string, storyId: string, cursor?: string, limit = 50, query?: string) {
    const story = await prisma.story.findFirst({ where: { id: storyId, ownerId } });
    if (!story) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    // Part 3, section 6: 48 hours after it ended, the freeze job removes the
    // rows below entirely. Reported explicitly, so an empty page here never
    // reads the same as "nobody has viewed it yet".
    if (story.viewersClosedAt !== null) return { items: [], nextCursor: null, closed: true as const };
    const take = Math.min(Math.max(limit, 1), 100);
    // The sheet's search: did someone in particular see it? Their name, among this Story's viewers.
    const search = query?.trim().slice(0, 60);
    let matchingViewers: string[] | undefined;
    if (search) {
      const viewerIds = (await prisma.storyView.findMany({ where: { storyId }, select: { viewerId: true } })).map((row) => row.viewerId);
      matchingViewers = (await prisma.user.findMany({
        where: { id: { in: viewerIds }, name: { contains: search, mode: 'insensitive' } }, select: { id: true },
      })).map((user) => user.id);
    }
    const rows = await prisma.storyView.findMany({
      where: { storyId, ...(matchingViewers ? { viewerId: { in: matchingViewers } } : {}) },
      orderBy: [{ firstVisibleAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const users = (await prisma.user.findMany({
      where: { id: { in: page.map((row) => row.viewerId) } },
      select: PERSON_WITH_BADGE,
    })).map(personWithBadge);
    const userMap = new Map(users.map((user) => [user.id, user]));
    const likes = await prisma.storyLike.findMany({
      where: { storyId, viewerId: { in: page.map((row) => row.viewerId) } },
      select: { viewerId: true },
    });
    const likedBy = new Set(likes.map((like) => like.viewerId));
    // What the owner may do from each row: hide, Close Friends, remove follower, message.
    const viewerIds = page.map((row) => row.viewerId);
    const [closeFriends, hidden, followers, matches, replies] = viewerIds.length ? await Promise.all([
      prisma.storyCloseFriend.findMany({ where: { ownerId, friendId: { in: viewerIds } }, select: { friendId: true } }),
      prisma.storyHiddenFrom.findMany({ where: { ownerId, hiddenUserId: { in: viewerIds } }, select: { hiddenUserId: true } }),
      prisma.follow.findMany({ where: { followeeId: ownerId, followerId: { in: viewerIds }, status: 'accepted' }, select: { followerId: true } }),
      prisma.match.findMany({
        where: { status: 'active', OR: [{ user1Id: ownerId, user2Id: { in: viewerIds } }, { user2Id: ownerId, user1Id: { in: viewerIds } }] },
        select: { id: true, user1Id: true, user2Id: true },
      }),
      // Part 3, section 8.1: each row's reaction emoji and reply icon.
      prisma.message.findMany({
        where: { type: 'story_reply', storyId, senderId: { in: viewerIds }, isDeleted: false },
        orderBy: { sentAt: 'desc' },
        select: { senderId: true, content: true, metadata: true },
      }),
    ]) : [[], [], [], [], []] as const;
    const closeFriendIds = new Set(closeFriends.map((row) => row.friendId));
    const hiddenIds = new Set(hidden.map((row) => row.hiddenUserId));
    const followerIds = new Set(followers.map((row) => row.followerId));
    const matchOf = new Map(matches.map((match) => [match.user1Id === ownerId ? match.user2Id : match.user1Id, match.id]));
    // Rows come back newest first, so the first reaction seen per sender is their most recent one.
    const reactionOf = new Map<string, string>();
    const repliedBy = new Set<string>();
    for (const message of replies) {
      if ((message.metadata as { storyReplyKind?: string } | null)?.storyReplyKind === 'reaction') {
        if (!reactionOf.has(message.senderId)) reactionOf.set(message.senderId, message.content);
      } else {
        repliedBy.add(message.senderId);
      }
    }
    return {
      items: page.map((row) => ({
        ...row,
        viewer: userMap.get(row.viewerId) ?? null,
        liked: likedBy.has(row.viewerId),
        reaction: reactionOf.get(row.viewerId) ?? null,
        replied: repliedBy.has(row.viewerId),
        relation: {
          closeFriend: closeFriendIds.has(row.viewerId),
          hidden: hiddenIds.has(row.viewerId),
          followsYou: followerIds.has(row.viewerId),
          matchId: matchOf.get(row.viewerId) ?? null,
        },
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
      closed: false as const,
    };
  }

  static async remove(ownerId: string, storyId: string) {
    const result = await prisma.story.updateMany({ where: { id: storyId, ownerId, deletedAt: null }, data: { state: 'deleted', deletedAt: new Date(), revision: { increment: 1 } } });
    if (!result.count) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    void this.nudgeRemoved(ownerId).catch(() => undefined);
    return { deleted: true };
  }

  static async mute(viewerId: string, authorId: string, muted: boolean) {
    if (viewerId === authorId) throw new HttpError(400, 'You cannot mute your own Stories', 'INVALID_STORY_MUTE');
    return prisma.storyPreference.upsert({
      where: { viewerId_authorId: { viewerId, authorId } },
      create: { viewerId, authorId, mutedUntil: muted ? new Date('9999-12-31T00:00:00.000Z') : null },
      update: { mutedUntil: muted ? new Date('9999-12-31T00:00:00.000Z') : null },
    });
  }

  /** Changes any of the Story settings; only the fields given are changed. */
  static async settings(userId: string, input: {
    storiesEnabled?: boolean; allowFollowRequests?: boolean; replies?: 'matches' | 'close_friends' | 'off';
    mentions?: 'everyone' | 'following' | 'off'; resharing?: boolean; screenshotBlock?: boolean;
    archive?: boolean; saveToGallery?: boolean; showFollowerCount?: boolean;
  }) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.storiesEnabled !== undefined ? { storiesEnabled: input.storiesEnabled } : {}),
          ...(input.allowFollowRequests !== undefined ? { allowFollowRequests: input.allowFollowRequests } : {}),
          ...(input.replies !== undefined ? { storyReplies: input.replies } : {}),
          ...(input.mentions !== undefined ? { storyMentions: input.mentions } : {}),
          ...(input.resharing !== undefined ? { storyResharing: input.resharing } : {}),
          ...(input.screenshotBlock !== undefined ? { storyScreenshotBlock: input.screenshotBlock } : {}),
          ...(input.archive !== undefined ? { storyArchive: input.archive } : {}),
          ...(input.saveToGallery !== undefined ? { storySaveToGallery: input.saveToGallery } : {}),
          ...(input.showFollowerCount !== undefined ? { showFollowerCount: input.showFollowerCount } : {}),
        },
        select: STORY_SETTINGS_SELECT,
      });
      // Counts shown or hidden, Stories on or off: an open profile re-reads.
      setImmediate(() => getIO()?.to(`profile-watch:${userId}`).emit('profile_changed', { userId }));
      if (input.storiesEnabled === false) {
        await tx.story.updateMany({ where: { ownerId: userId, state: 'published' }, data: { state: 'deleted', deletedAt: new Date(), revision: { increment: 1 } } });
        setImmediate(() => void StoryService.nudgeRemoved(userId).catch(() => undefined));
      }
      if (input.allowFollowRequests === false) {
        await tx.follow.updateMany({ where: { followeeId: userId, status: 'pending' }, data: { status: 'rejected', respondedAt: new Date(), revision: { increment: 1 } } });
      }
      return storySettingsOf(user);
    });
  }

  /**
   * A reply or a quick reaction to someone else's Story, both sent as a chat
   * message. `kind` tells the two apart for Activity and Insights (Part 3,
   * section 8.2): `reaction` is accepted only when the content is exactly one
   * of the eight quick-reaction emoji, the same set StoryFooter offers.
   */
  static async reply(viewerId: string, storyId: string, content: string, clientMessageId: string, kind: 'text' | 'reaction' = 'text') {
    const story = await prisma.story.findFirst({ where: { id: storyId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } });
    if (!story || !(await this.canView(viewerId, story)) || viewerId === story.ownerId) {
      throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    }
    if (kind === 'reaction' && !(QUICK_STORY_REACTIONS as readonly string[]).includes(content.trim())) {
      throw new HttpError(400, 'That is not a quick reaction', 'INVALID_STORY_REACTION');
    }
    const [owner, closeFriend] = await Promise.all([
      prisma.user.findUnique({ where: { id: story.ownerId }, select: { storyReplies: true } }),
      prisma.storyCloseFriend.findUnique({ where: { ownerId_friendId: { ownerId: story.ownerId, friendId: viewerId } }, select: { id: true } }),
    ]);
    const setting = owner?.storyReplies ?? 'matches';
    // Replies limited to Close Friends are refused exactly like replies that are off.
    if (setting === 'off' || (setting === 'close_friends' && !closeFriend)) {
      throw new HttpError(403, 'Replies are turned off for this story', 'STORY_REPLIES_OFF');
    }
    const match = await prisma.match.findFirst({
      where: { status: 'active', OR: [{ user1Id: viewerId, user2Id: story.ownerId }, { user1Id: story.ownerId, user2Id: viewerId }] },
      select: { id: true },
    });
    if (!match) throw new HttpError(403, 'You can reply after you match', 'STORY_REPLY_REQUIRES_MATCH');
    const message = await ChatService.sendMessage(viewerId, match.id, content, undefined, [], clientMessageId, {
      type: 'story_reply', storyId, metadata: { storyOwnerId: story.ownerId, storyReplyKind: kind },
    });
    // Messaging the owner unblurs a Reveal story, and the other parts of the same video.
    if (revealOf(story.composition)) {
      const parts = story.batchId
        ? await prisma.story.findMany({ where: { batchId: story.batchId, ownerId: story.ownerId }, select: { id: true, composition: true } })
        : [story];
      const ids = parts.filter((part) => revealOf(part.composition)).map((part) => part.id);
      await prisma.storyRevealUnlock.createMany({ data: ids.map((id) => ({ storyId: id, viewerId })), skipDuplicates: true });
    }
    // Counted at send time, so it survives an unsend, like Instagram's own totals (section 7.6).
    await prisma.storyInsight.upsert({
      where: { storyId },
      create: { storyId, replies: kind === 'text' ? 1 : 0, reactions: kind === 'reaction' ? 1 : 0 },
      update: kind === 'text' ? { replies: { increment: 1 } } : { reactions: { increment: 1 } },
    }).catch(() => undefined);
    return message;
  }
}
