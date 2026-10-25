import { randomUUID } from 'crypto';
import { verdictOf } from './nudity.service';
import { Prisma, type StoryMediaAsset } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { checkLinkShape, isKnownUnsafe } from '../utils/linkSafety';
import { signStoryPublishToken, type StoryPublishClaims } from '../utils/storyPublishToken';
import { storyCompositionSchema, type StoryComposition } from '../schemas/story-composition.schema';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';
import { MusicService } from './music.service';
import { StoryService } from './story.service';
import { StoryStickerService } from './story-sticker.service';
import { StoryVisibilityService, type StoryAudience } from './story-visibility.service';
import { privateMediaBucket } from '../config/storage';
import {
  MULTIPART_TTL_SECONDS, abortUpload, assembleUpload, createUpload, listStoredParts, partLayout, presignParts,
} from './s3-multipart';

const KINDS = {
  photo: { ext: 'jpg', contentType: 'image/jpeg', maxBytes: 15 * 1024 * 1024 },
  // 60 s at about 6 Mbps is 45 MB; headroom for devices that encode higher.
  video: { ext: 'mp4', contentType: 'video/mp4', maxBytes: 100 * 1024 * 1024 },
} as const;

export const STORY_BATCH_MAX_ITEMS = 20;
const MAX_POSTING_BATCHES = 3;
const MAX_ACTIVE_STORIES = 20;
const PHOTO_DURATION_MS = { min: 1000, max: 15_000 };
export const STORY_VIDEO_MAX_MS = 60_000;
const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** A batch nobody has touched for this long is abandoned. */
const IDLE_LIMIT_MS = 24 * 60 * 60 * 1000;

export type StoryBatchItemInput = {
  itemId: string;
  kind: 'photo' | 'video';
  /** Optional: a video's size is only known once the device has exported it. */
  size?: number;
  durationMs: number;
  partIndex?: number;
  partCount?: number;
  composition: StoryComposition;
};

const REJECTION_REASONS: Record<string, string> = {
  STORY_UPLOAD_INVALID: 'The file is not a supported photo or video',
  STORY_PROCESSING_FAILED: 'The file could not be processed',
  STORY_UPLOAD_MISSING: 'The upload did not reach the server',
  STORY_UPLOAD_UNAVAILABLE: 'The upload is no longer available',
  STORY_VIDEO_TOO_LONG: 'Story videos can be up to 60 seconds',
  STORY_EXPLICIT: "This Story can't be posted. Stories must follow our Community Guidelines.",
};

/**
 * Stories shared from the editor and posted by the device in the background.
 *
 * The app creates a batch while the editor closes, then hands it to a native
 * WorkManager chain that uploads each item in parts and publishes it with a
 * publish token scoped to this batch. Items publish in order, publishing is
 * idempotent per item, and an abandoned batch is swept after a day.
 */
export class StoryBatchService {
  private static get bucket() {
    const value = privateMediaBucket();
    if (!value) throw new Error('AWS_PRIVATE_MEDIA_BUCKET is required for Stories');
    return value;
  }

  private static validateItems(items: StoryBatchItemInput[]) {
    if (!items.length || items.length > STORY_BATCH_MAX_ITEMS) {
      throw new HttpError(400, `Share 1 to ${STORY_BATCH_MAX_ITEMS} stories at once`, 'STORY_BATCH_SIZE');
    }
    if (new Set(items.map((item) => item.itemId)).size !== items.length) {
      throw new HttpError(400, 'Each story in a batch needs its own id', 'STORY_BATCH_INVALID');
    }
    for (const item of items) {
      const kind = KINDS[item.kind];
      if (!kind) throw new HttpError(400, 'Stories are photos or videos', 'STORY_BATCH_INVALID');
      if (item.size !== undefined && (!Number.isSafeInteger(item.size) || item.size <= 0)) throw new HttpError(400, 'Upload size is invalid', 'MEDIA_SIZE_INVALID');
      if (item.size !== undefined && item.size > kind.maxBytes) {
        throw new HttpError(413, `This ${item.kind} is larger than ${Math.round(kind.maxBytes / (1024 * 1024))} MB`, 'MEDIA_TOO_LARGE');
      }
      if (item.kind === 'photo' && (item.durationMs < PHOTO_DURATION_MS.min || item.durationMs > PHOTO_DURATION_MS.max)) {
        throw new HttpError(400, 'A photo shows for 1 to 15 seconds', 'STORY_DURATION_INVALID');
      }
      if (item.kind === 'video' && (item.durationMs < 1 || item.durationMs > STORY_VIDEO_MAX_MS + 500)) {
        throw new HttpError(400, 'Story videos can be up to 60 seconds', 'STORY_VIDEO_TOO_LONG');
      }
      if (item.kind === 'photo' && item.composition.music && item.composition.music.lengthMs > PHOTO_DURATION_MS.max) {
        throw new HttpError(400, 'Music on a photo can be up to 15 seconds', 'STORY_MUSIC_INVALID');
      }
      const partial = item.partIndex !== undefined || item.partCount !== undefined;
      if (partial && !(Number.isInteger(item.partCount) && item.partCount! >= 2 && item.partCount! <= STORY_BATCH_MAX_ITEMS
        && Number.isInteger(item.partIndex) && item.partIndex! >= 1 && item.partIndex! <= item.partCount!)) {
        throw new HttpError(400, 'Video part numbering is invalid', 'STORY_BATCH_INVALID');
      }
    }
  }

  /** Mentions must be allowed, links must be safe. Checked before anything is uploaded. */
  private static async validateCompositions(ownerId: string, compositions: StoryComposition[], audience: StoryAudience) {
    const stickers = compositions.flatMap((composition) => composition.interactive);
    // A Reveal story unlocks when a viewer replies, so it needs replies on.
    if (stickers.some((sticker) => sticker.type === 'reveal')) {
      const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { storyReplies: true } });
      if (owner?.storyReplies === 'off') throw new HttpError(422, 'Turn on replies to use Reveal', 'REVEAL_NEEDS_REPLIES');
    }
    // Add Yours Music: every story in the thread carries a song.
    const threadIds = stickers.flatMap((sticker) => (sticker.type === 'addYours' && sticker.threadId ? [sticker.threadId] : []));
    const musicThreads = new Set((threadIds.length
      ? await prisma.storyAddYoursThread.findMany({ where: { id: { in: threadIds }, music: true }, select: { id: true } })
      : []).map((thread) => thread.id));
    for (const composition of compositions) {
      const addYours = composition.interactive.find((sticker) => sticker.type === 'addYours');
      if (addYours?.type !== 'addYours' || composition.music) continue;
      if (addYours.threadId ? musicThreads.has(addYours.threadId) : addYours.music) {
        throw new HttpError(422, 'Add a song to join Add Yours Music', 'ADD_YOURS_NEEDS_MUSIC');
      }
    }
    await StoryStickerService.assertMentionable(ownerId, stickers.flatMap((sticker) => (sticker.type === 'mention' ? [sticker.userId] : [])), audience);
    for (const sticker of stickers) {
      if (sticker.type !== 'link') continue;
      const shape = checkLinkShape(sticker.url);
      if (!shape.ok) throw new HttpError(422, shape.reason, 'STORY_LINK_REJECTED');
      let unsafe = false;
      try {
        unsafe = await isKnownUnsafe(shape.url);
      } catch (error) {
        // A Safe Browsing outage must not block posting; the shape checks still hold.
        logger.warn('Safe Browsing lookup failed', { error: (error as Error)?.message });
      }
      if (unsafe) throw new HttpError(422, 'This link was flagged as unsafe', 'STORY_LINK_REJECTED');
    }
  }

  static async create(ownerId: string, input: { batchId: string; audience?: StoryAudience; items: StoryBatchItemInput[] }) {
    const audience: StoryAudience = input.audience === 'close_friends' ? 'close_friends' : 'followers';
    const user = await prisma.user.findFirst({ where: { id: ownerId, accountStatus: 'active' }, select: { storiesEnabled: true, sessionVersion: true } });
    if (!user) throw new HttpError(404, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
    if (!user.storiesEnabled) throw new HttpError(409, 'Enable Stories before you upload', 'STORIES_NOT_ENABLED');

    const existing = await prisma.storyBatch.findUnique({ where: { id: input.batchId } });
    if (existing) {
      if (existing.ownerId !== ownerId) throw new HttpError(409, 'This batch id is already used', 'STORY_BATCH_ID_TAKEN');
      return this.ticket(ownerId, existing.id);
    }

    const items = input.items.map((item) => ({ ...item, composition: storyCompositionSchema.parse(item.composition) }));
    this.validateItems(items);
    await this.validateCompositions(ownerId, items.map((item) => item.composition), audience);

    const postingBatches = await prisma.storyBatch.findMany({ where: { ownerId, status: 'posting' }, select: { id: true } });
    if (postingBatches.length >= MAX_POSTING_BATCHES) {
      throw new HttpError(429, 'Wait for your stories to finish posting', 'STORY_BATCH_LIMIT');
    }
    const [active, pending] = await Promise.all([
      prisma.story.count({ where: { ownerId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } }),
      prisma.storyBatchItem.count({ where: { batchId: { in: postingBatches.map((batch) => batch.id) }, status: 'uploading' } }),
    ]);
    if (active + pending + items.length > MAX_ACTIVE_STORIES) {
      throw new HttpError(429, `You can have a maximum of ${MAX_ACTIVE_STORIES} active Stories`, 'STORY_QUOTA');
    }

    // Storage uploads start later, in `parts`, once the worker knows each file's
    // final size: a video's size is only known after it is exported on the device.
    const expiresAt = new Date(Date.now() + MULTIPART_TTL_SECONDS * 1000);
    const prepared = items.map((item, position) => {
      const kind = KINDS[item.kind];
      const assetId = randomUUID();
      return { item, position, assetId, kind, key: `stories/${ownerId}/${assetId}.${kind.ext}` };
    });
    try {
      await prisma.$transaction(async (tx) => {
        await tx.storyBatch.create({ data: { id: input.batchId, ownerId, itemCount: items.length, sessionVersion: user.sessionVersion, audience, expiresAt } });
        await tx.storyMediaAsset.createMany({
          data: prepared.map((entry) => ({
            id: entry.assetId, ownerId, objectKey: entry.key, contentType: entry.kind.contentType, maxBytes: entry.kind.maxBytes, expiresAt,
          })),
        });
        await tx.storyBatchItem.createMany({
          data: prepared.map((entry) => ({
            id: entry.item.itemId, batchId: input.batchId, ownerId, position: entry.position, assetId: entry.assetId,
            kind: entry.item.kind, durationMs: Math.round(entry.item.durationMs), composition: entry.item.composition as Prisma.InputJsonValue,
            partIndex: entry.item.partIndex ?? null, partCount: entry.item.partCount ?? null,
          })),
        });
      });
    } catch (error) {
      // Two requests for the same batch raced; the other one won.
      if ((error as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
        const raced = await prisma.storyBatch.findFirst({ where: { id: input.batchId, ownerId } });
        if (raced) return this.ticket(ownerId, raced.id);
      }
      throw error;
    }
    return this.ticket(ownerId, input.batchId);
  }

  private static async load(ownerId: string, batchId: string) {
    const batch = await prisma.storyBatch.findFirst({ where: { id: batchId, ownerId } });
    if (!batch) throw new HttpError(404, 'This post is unavailable', 'STORY_BATCH_UNAVAILABLE');
    const items = await prisma.storyBatchItem.findMany({ where: { batchId }, orderBy: { position: 'asc' } });
    return { batch, items };
  }

  private static describe(batch: { id: string; status: string; expiresAt: Date }, items: Array<{ id: string; position: number; assetId: string; kind: string; status: string; storyId: string | null; failureReason: string | null; durationMs: number; partIndex: number | null; partCount: number | null }>) {
    return {
      batchId: batch.id,
      status: batch.status,
      expiresAt: batch.expiresAt.toISOString(),
      items: items.map((item) => ({
        itemId: item.id, assetId: item.assetId, position: item.position, kind: item.kind, status: item.status, storyId: item.storyId,
        failureReason: item.failureReason, durationMs: item.durationMs, partIndex: item.partIndex, partCount: item.partCount,
      })),
    };
  }

  /** What the device's worker needs to start: the items and a publish token. Part URLs come from `parts`. */
  static async ticket(ownerId: string, batchId: string) {
    const { batch, items } = await this.load(ownerId, batchId);
    return {
      ...this.describe(batch, items),
      publishToken: signStoryPublishToken({ sub: ownerId, bid: batch.id, sv: batch.sessionVersion }),
    };
  }

  static async status(ownerId: string, batchId: string) {
    const { batch, items } = await this.load(ownerId, batchId);
    return this.describe(batch, items);
  }

  /** Checks a publish token against the batch, the account and its sessions. */
  static async authorize(claims: StoryPublishClaims, batchId: string) {
    if (claims.bid !== batchId) throw new HttpError(403, 'This token is for another post', 'STORY_TOKEN_SCOPE');
    const [user, batch] = await Promise.all([
      prisma.user.findUnique({ where: { id: claims.sub }, select: { accountStatus: true, sessionVersion: true } }),
      prisma.storyBatch.findUnique({ where: { id: batchId } }),
    ]);
    if (!user || user.accountStatus !== 'active' || user.sessionVersion !== claims.sv || !batch || batch.ownerId !== claims.sub || batch.sessionVersion !== claims.sv) {
      throw new HttpError(401, 'This post can no longer be published', 'STORY_TOKEN_REVOKED');
    }
    return batch;
  }

  /**
   * Starts the item's storage upload once the worker knows the file's size,
   * and returns a URL for every part with the part numbers S3 already holds.
   * The worker calls it again after a restart or when URLs expire. `restart`
   * begins a fresh upload when the device had to produce the file again, so
   * parts of two different files are never assembled together.
   */
  static async parts(claims: StoryPublishClaims, batchId: string, itemId: string, input: { size?: number; restart?: boolean } = {}) {
    const batch = await this.authorize(claims, batchId);
    const item = await prisma.storyBatchItem.findFirst({ where: { id: itemId, batchId } });
    if (!item) throw new HttpError(404, 'This story is unavailable', 'STORY_BATCH_ITEM_UNAVAILABLE');
    if (batch.status !== 'posting' || item.status !== 'uploading') {
      return { status: batch.status === 'cancelled' ? 'cancelled' : item.status, storyId: item.storyId, partSize: null, partCount: null, parts: [], uploadedPartNumbers: [] };
    }
    let asset = await prisma.storyMediaAsset.findFirst({ where: { id: item.assetId } });
    if (!asset) throw new HttpError(404, 'This story is unavailable', 'STORY_BATCH_ITEM_UNAVAILABLE');
    const assembled = !asset.uploadId && asset.partCount !== null;
    if (assembled && !input.restart) {
      return { status: item.status, storyId: null, partSize: asset.partSize, partCount: asset.partCount, parts: [], uploadedPartNumbers: Array.from({ length: asset.partCount ?? 0 }, (_, index) => index + 1) };
    }
    const sizeChanged = input.size !== undefined && asset.declaredBytes !== null && Number(asset.declaredBytes) !== input.size;
    if (!asset.uploadId || input.restart || sizeChanged) asset = await this.startUpload(item, asset, input.size);

    const bucket = this.bucket;
    const stored = await listStoredParts(bucket, asset.objectKey, asset.uploadId!);
    if (!stored) {
      await this.rejectItem(item, 'The upload expired before it finished');
      throw new HttpError(409, 'The upload expired before it finished', 'STORY_UPLOAD_EXPIRED');
    }
    await prisma.storyBatch.update({ where: { id: batchId }, data: { updatedAt: new Date() } });
    return {
      status: item.status,
      storyId: null,
      partSize: asset.partSize,
      partCount: asset.partCount,
      parts: await presignParts(bucket, asset.objectKey, asset.uploadId!, Array.from({ length: asset.partCount ?? 0 }, (_, index) => index + 1)),
      uploadedPartNumbers: stored.filter((part) => part.ETag && part.PartNumber).map((part) => part.PartNumber!),
    };
  }

  private static async startUpload(item: { id: string; batchId: string; assetId: string; ownerId: string }, asset: StoryMediaAsset, size?: number) {
    if (size === undefined || !Number.isSafeInteger(size) || size <= 0) {
      throw new HttpError(400, 'Send the file size to start the upload', 'STORY_UPLOAD_SIZE_REQUIRED');
    }
    if (size > asset.maxBytes) {
      const reason = `The file is larger than ${Math.round(asset.maxBytes / (1024 * 1024))} MB`;
      await this.rejectItem(item, reason);
      throw new HttpError(413, reason, 'MEDIA_TOO_LARGE');
    }
    const bucket = this.bucket;
    if (asset.uploadId) await abortUpload(bucket, asset.objectKey, asset.uploadId).catch(() => undefined);
    const uploadId = await createUpload(bucket, asset.objectKey, asset.contentType);
    const { partSize, partCount } = partLayout(size);
    const claimed = await prisma.storyMediaAsset.updateMany({
      where: { id: asset.id, status: 'requested', uploadId: asset.uploadId },
      data: { uploadId, partSize, partCount, declaredBytes: BigInt(size) },
    });
    if (!claimed.count) {
      // Another request started it first; use theirs.
      await abortUpload(bucket, asset.objectKey, uploadId).catch(() => undefined);
      const current = await prisma.storyMediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
      if (!current.uploadId) throw new HttpError(409, 'The upload changed. Ask again', 'STORY_UPLOAD_CONFLICT');
      return current;
    }
    return prisma.storyMediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
  }

  static async publishItem(claims: StoryPublishClaims, batchId: string, itemId: string) {
    const batch = await this.authorize(claims, batchId);
    const item = await prisma.storyBatchItem.findFirst({ where: { id: itemId, batchId } });
    if (!item) throw new HttpError(404, 'This story is unavailable', 'STORY_BATCH_ITEM_UNAVAILABLE');
    if (item.status === 'published' && item.storyId) return this.published(item.storyId, true);
    if (item.status === 'rejected') throw new HttpError(422, item.failureReason ?? 'This story could not be posted', 'STORY_ITEM_REJECTED');
    if (batch.status === 'cancelled' || item.status === 'cancelled') throw new HttpError(409, 'This post was cancelled', 'STORY_BATCH_CANCELLED');

    const earlier = await prisma.storyBatchItem.count({ where: { batchId, position: { lt: item.position }, status: 'uploading' } });
    if (earlier) throw new HttpError(409, 'The stories before this one have not posted yet', 'STORY_BATCH_ORDER');

    const bucket = this.bucket;
    const asset = await prisma.storyMediaAsset.findFirst({ where: { id: item.assetId, ownerId: batch.ownerId } });
    if (!asset) {
      await this.rejectItem(item, REJECTION_REASONS.STORY_UPLOAD_UNAVAILABLE);
      throw new HttpError(422, REJECTION_REASONS.STORY_UPLOAD_UNAVAILABLE, 'STORY_ITEM_REJECTED');
    }
    if (!asset.uploadId && asset.partCount === null) throw new HttpError(409, 'The upload has not started', 'STORY_UPLOAD_INCOMPLETE');
    if (asset.uploadId) {
      const assembled = await assembleUpload(bucket, { objectKey: asset.objectKey, uploadId: asset.uploadId, partSize: asset.partSize, partCount: asset.partCount });
      if (assembled.outcome === 'expired') {
        await this.rejectItem(item, 'The upload expired before it finished');
        throw new HttpError(409, 'The upload expired before it finished', 'STORY_UPLOAD_EXPIRED');
      }
      if (assembled.outcome === 'incomplete') throw new HttpError(409, assembled.message, 'STORY_UPLOAD_INCOMPLETE');
      await prisma.storyMediaAsset.update({ where: { id: asset.id }, data: { uploadId: null } });
    }

    let completed: { durationMs?: number | null };
    try {
      completed = await StoryService.completeUpload(batch.ownerId, asset.id, { maxDurationMs: item.kind === 'video' ? STORY_VIDEO_MAX_MS : undefined });
    } catch (error) {
      const code = (error as HttpError)?.code;
      if (code && REJECTION_REASONS[code]) await this.rejectItem(item, REJECTION_REASONS[code]);
      throw error;
    }

    const composition = storyCompositionSchema.parse(item.composition);
    const durationMs = item.kind === 'video'
      ? Math.min(STORY_VIDEO_MAX_MS, completed.durationMs ?? item.durationMs)
      : item.durationMs;
    const audience: StoryAudience = batch.audience === 'close_friends' ? 'close_friends' : 'followers';
    // Mentions are checked again here: a list or setting may have changed since
    // the batch began. Only people who can open the Story are recorded and told.
    const requested = [...new Set(composition.interactive.flatMap((sticker) => (sticker.type === 'mention' ? [sticker.userId] : [])))]
      .filter((id) => id !== batch.ownerId);
    const allowed = requested.length ? await StoryStickerService.mentionableIds(batch.ownerId, audience, requested) : new Set<string>();
    const mentioned = requested.filter((id) => allowed.has(id));
    // Part 3: whether this Story goes to the owner's Archive when it ends,
    // taken fresh at the moment it actually publishes (a batch can take a
    // while to upload), not frozen at the start of the share action.
    const owner = await prisma.user.findUnique({ where: { id: batch.ownerId }, select: { storyArchive: true } });
    const archive = owner?.storyArchive ?? true;

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${batch.ownerId}, 4))`;
      const fresh = await tx.storyBatchItem.findUnique({ where: { id: item.id } });
      if (fresh?.status === 'published' && fresh.storyId) return { storyId: fresh.storyId, repeated: true };
      const activeCount = await tx.story.count({ where: { ownerId: batch.ownerId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } } });
      if (activeCount >= MAX_ACTIVE_STORIES) return { quota: true as const };
      const ready = await tx.storyMediaAsset.findFirst({ where: { id: asset.id, status: 'ready' } });
      if (!ready) throw new HttpError(409, 'Story media is not ready', 'STORY_MEDIA_UNAVAILABLE');
      // Borderline (docs/NUDITY_CHECK.md): kept as "in review" - seen by nobody,
      // announced to nobody - until the team approves it (AdminPanelService).
      const nudity = verdictOf(ready.nudityScore);
      const inReview = nudity === 'review';
      // Add Yours: join the thread the sticker names, or start one. Every part
      // of a long video shares the thread its sticker started.
      let stored = composition;
      let thread: { id: string; creatorId: string; prompt: string } | null = null;
      const addYours = composition.interactive.find((sticker) => sticker.type === 'addYours');
      if (addYours?.type === 'addYours') {
        const joined = addYours.threadId ? await tx.storyAddYoursThread.findUnique({ where: { id: addYours.threadId } }) : null;
        const found = joined ?? await tx.storyAddYoursThread.upsert({
          where: { sourceKey: `${batchId}:${addYours.id}` },
          create: { creatorId: batch.ownerId, sourceKey: `${batchId}:${addYours.id}`, prompt: addYours.prompt, music: !!addYours.music },
          update: {},
        });
        thread = found;
        stored = {
          ...composition,
          interactive: composition.interactive.map((sticker) => (sticker.id === addYours.id ? { ...addYours, threadId: found.id, prompt: found.prompt, music: found.music } : sticker)),
        };
      }
      const now = new Date();
      const story = await tx.story.create({
        data: {
          ownerId: batch.ownerId, assetId: asset.id, clientPublishId: item.id, durationMs, audience, archive,
          composition: stored as Prisma.InputJsonValue, batchId, partIndex: item.partIndex, partCount: item.partCount,
          musicTrackId: composition.music?.trackId ?? null, publishedAt: now, expiresAt: new Date(now.getTime() + STORY_LIFETIME_MS),
          ...(inReview ? { state: 'in_review' } : {}),
        },
      });
      if (inReview || nudity === 'unchecked') {
        await tx.mediaModeration.create({ data: { userId: batch.ownerId, kind: 'story', assetId: asset.id, storyId: story.id, objectKey: ready.objectKey, score: ready.nudityScore, status: inReview ? 'pending' : 'unchecked' } });
      }
      if (stored.interactive.length) {
        await tx.storySticker.createMany({
          data: stored.interactive.map((sticker) => ({
            storyId: story.id, stickerKey: sticker.id, type: sticker.type, config: sticker as Prisma.InputJsonValue,
            endsAt: sticker.type === 'countdown' ? new Date(sticker.endsAt) : null,
          })),
        });
      }
      if (mentioned.length) {
        await tx.storyMention.createMany({ data: mentioned.map((userId) => ({ storyId: story.id, mentionedUserId: userId })), skipDuplicates: true });
      }
      if (thread) {
        await tx.storyAddYoursEntry.createMany({ data: [{ threadId: thread.id, storyId: story.id, ownerId: batch.ownerId }], skipDuplicates: true });
      }
      await tx.storyMediaAsset.update({ where: { id: asset.id }, data: { status: 'attached' } });
      await tx.storyBatchItem.update({ where: { id: item.id }, data: { status: 'published', storyId: story.id } });
      // A Story in review is announced when it's approved, not now.
      if (!inReview) await OutboxService.enqueue(tx, {
        topic: OUTBOX_TOPICS.STORY_PUBLISHED, aggregateId: story.id, deduplicationKey: `story.published:${story.id}`,
        payload: { ownerId: batch.ownerId, mentionedUserIds: mentioned },
      });
      await this.settle(tx, batchId);
      return { storyId: story.id, repeated: false, thread };
    });

    if ('quota' in outcome) {
      await this.rejectItem(item, `You already have ${MAX_ACTIVE_STORIES} active stories`);
      throw new HttpError(429, `You can have a maximum of ${MAX_ACTIVE_STORIES} active Stories`, 'STORY_QUOTA');
    }
    if (composition.music) void MusicService.recordUse(composition.music).catch(() => undefined);
    if ('thread' in outcome && outcome.thread && outcome.thread.creatorId !== batch.ownerId) {
      const { creatorId, id: threadId, prompt } = outcome.thread;
      const storyId = outcome.storyId;
      // The creator is only told when they can open the Story that joined.
      void StoryVisibilityService.check(creatorId, { ownerId: batch.ownerId, audience })
        .then((canSee) => (canSee ? StoryStickerService.notifyAddYoursJoin(creatorId, threadId, prompt, storyId) : undefined))
        .catch(() => undefined);
    }
    return this.published(outcome.storyId, outcome.repeated);
  }

  /** What the app puts straight into the tray once an item is live. */
  private static async published(storyId: string, repeated: boolean) {
    const story = await prisma.story.findUniqueOrThrow({ where: { id: storyId } });
    const asset = await prisma.storyMediaAsset.findUnique({ where: { id: story.assetId }, select: { contentType: true } });
    return {
      repeated,
      story: {
        id: story.id, ownerId: story.ownerId, contentType: asset?.contentType ?? 'image/jpeg', caption: story.caption,
        publishedAt: story.publishedAt.toISOString(), expiresAt: story.expiresAt.toISOString(),
        durationMs: story.durationMs, composition: story.composition, seen: true, liked: false, viewCount: 0, likeCount: 0,
      },
    };
  }

  /** Marks the batch finished once no item is still uploading. */
  private static async settle(tx: Prisma.TransactionClient, batchId: string) {
    const items = await tx.storyBatchItem.findMany({ where: { batchId }, select: { status: true } });
    const batch = await tx.storyBatch.findUnique({ where: { id: batchId }, select: { status: true } });
    if (!batch || batch.status !== 'posting') return;
    if (items.some((item) => item.status === 'uploading')) {
      await tx.storyBatch.update({ where: { id: batchId }, data: { updatedAt: new Date() } });
      return;
    }
    await tx.storyBatch.update({ where: { id: batchId }, data: { status: items.some((item) => item.status === 'rejected') ? 'failed' : 'completed' } });
  }

  /** An item that can never post. The owner is told once per batch, in case the device never reports back. */
  private static async rejectItem(item: { id: string; batchId: string; assetId: string; ownerId: string }, reason: string) {
    const asset = await prisma.storyMediaAsset.findUnique({ where: { id: item.assetId } });
    if (asset?.uploadId) await abortUpload(this.bucket, asset.objectKey, asset.uploadId).catch(() => undefined);
    await prisma.$transaction(async (tx) => {
      const updated = await tx.storyBatchItem.updateMany({ where: { id: item.id, status: 'uploading' }, data: { status: 'rejected', failureReason: reason.slice(0, 200) } });
      if (asset) await tx.storyMediaAsset.updateMany({ where: { id: asset.id, status: { in: ['requested', 'processing'] } }, data: { status: 'rejected', uploadId: null } });
      if (!updated.count) return;
      const deduplicationKey = `story.batch.failed:${item.batchId}`;
      if (!(await tx.outboxEvent.findUnique({ where: { deduplicationKey } }))) {
        await OutboxService.enqueue(tx, { topic: OUTBOX_TOPICS.STORY_BATCH_FAILED, aggregateId: item.batchId, deduplicationKey, payload: { ownerId: item.ownerId, reason } });
      }
      await this.settle(tx, item.batchId);
    });
  }

  /**
   * The device gives up on one story it cannot produce (a video it cannot
   * export), so the stories after it are not held back by the order rule.
   * No push: the app on that phone already shows the failure.
   */
  static async skipItem(claims: StoryPublishClaims, batchId: string, itemId: string, reason?: string) {
    await this.authorize(claims, batchId);
    const item = await prisma.storyBatchItem.findFirst({ where: { id: itemId, batchId } });
    if (!item) throw new HttpError(404, 'This story is unavailable', 'STORY_BATCH_ITEM_UNAVAILABLE');
    if (item.status !== 'uploading') return { status: item.status };
    const asset = await prisma.storyMediaAsset.findUnique({ where: { id: item.assetId } });
    if (asset?.uploadId) await abortUpload(this.bucket, asset.objectKey, asset.uploadId).catch(() => undefined);
    await prisma.$transaction(async (tx) => {
      await tx.storyBatchItem.updateMany({ where: { id: item.id, status: 'uploading' }, data: { status: 'rejected', failureReason: (reason ?? 'This story could not be prepared on the device').slice(0, 200) } });
      if (asset) await tx.storyMediaAsset.updateMany({ where: { id: asset.id, status: { in: ['requested', 'processing'] } }, data: { status: 'rejected', uploadId: null } });
      await this.settle(tx, batchId);
    });
    return { status: 'rejected' };
  }

  /** Stops a batch: nothing more publishes. Stories already posted stay posted. */
  static async cancel(ownerId: string, batchId: string) {
    const { batch, items } = await this.load(ownerId, batchId);
    if (batch.status === 'posting') {
      const pending = items.filter((item) => item.status === 'uploading');
      const assets = await prisma.storyMediaAsset.findMany({ where: { id: { in: pending.map((item) => item.assetId) } } });
      await Promise.all(assets.filter((asset) => asset.uploadId).map((asset) => abortUpload(this.bucket, asset.objectKey, asset.uploadId!).catch(() => undefined)));
      await prisma.$transaction([
        prisma.storyBatchItem.updateMany({ where: { batchId, status: 'uploading' }, data: { status: 'cancelled' } }),
        prisma.storyMediaAsset.updateMany({ where: { id: { in: assets.map((asset) => asset.id) }, status: { in: ['requested', 'processing'] } }, data: { status: 'rejected', uploadId: null } }),
        prisma.storyBatch.update({ where: { id: batchId }, data: { status: 'cancelled' } }),
      ]);
    }
    return this.status(ownerId, batchId);
  }

  /** Fails batches that stopped moving, and frees their stored parts. */
  static async sweep(limit = 20): Promise<number> {
    const now = Date.now();
    const stale = await prisma.storyBatch.findMany({
      where: { status: 'posting', OR: [{ expiresAt: { lt: new Date(now) } }, { updatedAt: { lt: new Date(now - IDLE_LIMIT_MS) } }] },
      take: limit,
    });
    for (const batch of stale) {
      const items = await prisma.storyBatchItem.findMany({ where: { batchId: batch.id, status: 'uploading' } });
      for (const item of items) {
        try {
          await this.rejectItem(item, 'Posting stopped before it finished');
        } catch (error) {
          logger.warn('Could not sweep story batch item', { itemId: item.id, error: (error as Error)?.message });
        }
      }
      await prisma.storyBatch.updateMany({ where: { id: batch.id, status: 'posting' }, data: { status: 'failed' } });
    }
    return stale.length;
  }
}
