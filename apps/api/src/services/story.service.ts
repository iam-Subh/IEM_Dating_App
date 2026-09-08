import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { s3Client } from '../middlewares/upload.middleware';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';
import { ChatService } from './chat.service';
import { PrivateMediaInspectionService } from './private-media-inspection.service';
import { PrivateMediaProcessingService } from './private-media-processing.service';

const TYPES: Record<string, { contentType: string; maxBytes: number }> = {
  jpg: { contentType: 'image/jpeg', maxBytes: 15 * 1024 * 1024 },
  jpeg: { contentType: 'image/jpeg', maxBytes: 15 * 1024 * 1024 },
  png: { contentType: 'image/png', maxBytes: 15 * 1024 * 1024 },
  webp: { contentType: 'image/webp', maxBytes: 15 * 1024 * 1024 },
  mp4: { contentType: 'video/mp4', maxBytes: 50 * 1024 * 1024 },
};

export class StoryService {
  private static get bucket() {
    const value = process.env.AWS_PRIVATE_MEDIA_BUCKET;
    if (!value) throw new Error('AWS_PRIVATE_MEDIA_BUCKET is required for Stories');
    return value;
  }

  private static async canView(viewerId: string, ownerId: string) {
    if (viewerId === ownerId) return true;
    const [follow, block] = await Promise.all([
      prisma.follow.findUnique({ where: { followerId_followeeId: { followerId: viewerId, followeeId: ownerId } }, select: { status: true } }),
      prisma.userBlock.count({ where: { OR: [{ blockerId: viewerId, blockedId: ownerId }, { blockerId: ownerId, blockedId: viewerId }] } }),
    ]);
    return follow?.status === 'accepted' && block === 0;
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

  static async completeUpload(ownerId: string, assetId: string) {
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
    try { processed = await PrivateMediaProcessingService.process(this.bucket, asset.objectKey, `stories-approved/${ownerId}`, asset.id, detectedType); }
    catch (error) { await prisma.storyMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } }); throw new HttpError(422, 'Story media processing failed', 'STORY_PROCESSING_FAILED'); }
    let ready;
    try {
      ready = await prisma.storyMediaAsset.update({
        where: { id: asset.id },
        data: { objectKey: processed.objectKey, contentType: processed.contentType, thumbnailObjectKey: processed.thumbnailObjectKey, status: 'ready', detectedType, checksum: head.ChecksumSHA256 ?? null, processedAt: new Date() },
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
    return ready;
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
      const story = await tx.story.create({
        data: { ownerId, assetId: asset.id, clientPublishId: input.clientPublishId, caption: input.caption?.trim(), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) },
      });
      await tx.storyMediaAsset.update({ where: { id: asset.id }, data: { status: 'attached' } });
      await OutboxService.enqueue(tx, { topic: OUTBOX_TOPICS.STORY_PUBLISHED, aggregateId: story.id, deduplicationKey: `story.published:${story.id}`, payload: { ownerId } });
      return { ...story, repeated: false };
    });
  }

  static async feed(viewerId: string) {
    return (await this.feedPage(viewerId, undefined, 200)).items;
  }

  static async feedPage(viewerId: string, cursor?: string, limit = 50) {
    const follows = await prisma.follow.findMany({ where: { followerId: viewerId, status: 'accepted' }, select: { followeeId: true } });
    const blocked = await prisma.userBlock.findMany({ where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] }, select: { blockerId: true, blockedId: true } });
    const blockedIds = new Set(blocked.flatMap((item) => [item.blockerId, item.blockedId]));
    blockedIds.delete(viewerId);
    const muted = await prisma.storyPreference.findMany({
      where: { viewerId, mutedUntil: { gt: new Date() } },
      select: { authorId: true },
    });
    const mutedIds = new Set(muted.map((item) => item.authorId));
    const ownerIds = [viewerId, ...follows.map((item) => item.followeeId).filter((id) => !blockedIds.has(id) && !mutedIds.has(id))];
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
        ownerId: { in: ownerIds }, state: 'published', deletedAt: null, expiresAt: { gt: new Date() }, publishedAt: { lte: highWater },
        ...(lastPublishedAt && decoded ? { OR: [{ publishedAt: { lt: lastPublishedAt } }, { publishedAt: lastPublishedAt, id: { lt: decoded.id } }] } : {}),
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    const hasMore = stories.length > take;
    const page = hasMore ? stories.slice(0, take) : stories;
    const assets = await prisma.storyMediaAsset.findMany({ where: { id: { in: page.map((item) => item.assetId) }, status: 'attached' } });
    const users = await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, avatarUrl: true } });
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
    const story = await prisma.story.findFirst({ where: { id: storyId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } });
    if (!story || !(await this.canView(viewerId, story.ownerId))) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    const asset = await prisma.storyMediaAsset.findFirst({ where: { id: story.assetId, status: 'attached' } });
    if (!asset) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: this.bucket, Key: asset.objectKey }), { expiresIn: 60 });
    const thumbnailUrl = asset.thumbnailObjectKey ? await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: this.bucket, Key: asset.thumbnailObjectKey }), { expiresIn: 60 }) : null;
    return { url, thumbnailUrl, expiresIn: 60, contentType: asset.contentType };
  }

  static async get(viewerId: string, storyId: string) {
    const story = await prisma.story.findFirst({ where: { id: storyId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } });
    if (!story || !(await this.canView(viewerId, story.ownerId))) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    const owner = await prisma.user.findUnique({ where: { id: story.ownerId }, select: { id: true, name: true, avatarUrl: true } });
    return { ...story, owner };
  }

  static async recordView(viewerId: string, storyId: string) {
    const story = await prisma.story.findFirst({ where: { id: storyId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } });
    if (!story || !(await this.canView(viewerId, story.ownerId))) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    if (viewerId === story.ownerId) return { recorded: false };
    const view = await prisma.storyView.upsert({ where: { storyId_viewerId: { storyId, viewerId } }, create: { storyId, viewerId }, update: {} });
    return { recorded: true, firstVisibleAt: view.firstVisibleAt };
  }

  static async viewers(ownerId: string, storyId: string) {
    const story = await prisma.story.findFirst({ where: { id: storyId, ownerId } });
    if (!story) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    return prisma.storyView.findMany({ where: { storyId }, orderBy: [{ firstVisibleAt: 'desc' }, { id: 'desc' }], take: 500 });
  }

  static async viewersPage(ownerId: string, storyId: string, cursor?: string, limit = 50) {
    const story = await prisma.story.findFirst({ where: { id: storyId, ownerId } });
    if (!story) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await prisma.storyView.findMany({
      where: { storyId },
      orderBy: [{ firstVisibleAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const users = await prisma.user.findMany({
      where: { id: { in: page.map((row) => row.viewerId) } },
      select: { id: true, name: true, avatarUrl: true },
    });
    const userMap = new Map(users.map((user) => [user.id, user]));
    return {
      items: page.map((row) => ({ ...row, viewer: userMap.get(row.viewerId) ?? null })),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  static async remove(ownerId: string, storyId: string) {
    const result = await prisma.story.updateMany({ where: { id: storyId, ownerId, deletedAt: null }, data: { state: 'deleted', deletedAt: new Date(), revision: { increment: 1 } } });
    if (!result.count) throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
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

  static async settings(userId: string, input: { storiesEnabled: boolean; allowFollowRequests: boolean }) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: input, select: { storiesEnabled: true, allowFollowRequests: true } });
      if (!input.storiesEnabled) {
        await tx.story.updateMany({ where: { ownerId: userId, state: 'published' }, data: { state: 'deleted', deletedAt: new Date(), revision: { increment: 1 } } });
      }
      if (!input.allowFollowRequests) {
        await tx.follow.updateMany({ where: { followeeId: userId, status: 'pending' }, data: { status: 'rejected', respondedAt: new Date(), revision: { increment: 1 } } });
      }
      return user;
    });
  }

  static async reply(viewerId: string, storyId: string, content: string, clientMessageId: string) {
    const story = await prisma.story.findFirst({ where: { id: storyId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } });
    if (!story || !(await this.canView(viewerId, story.ownerId)) || viewerId === story.ownerId) {
      throw new HttpError(404, 'Story is unavailable', 'STORY_UNAVAILABLE');
    }
    const match = await prisma.match.findFirst({
      where: { status: 'active', OR: [{ user1Id: viewerId, user2Id: story.ownerId }, { user1Id: story.ownerId, user2Id: viewerId }] },
      select: { id: true },
    });
    if (!match) throw new HttpError(403, 'You can reply after you match', 'STORY_REPLY_REQUIRES_MATCH');
    return ChatService.sendMessage(viewerId, match.id, content, undefined, [], clientMessageId, {
      type: 'story_reply', storyId, metadata: { storyOwnerId: story.ownerId },
    });
  }
}
