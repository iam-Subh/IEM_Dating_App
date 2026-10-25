import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { Prisma } from '@prisma/client';
import { s3Client } from '../middlewares/upload.middleware';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { privateMediaBucket } from '../config/storage';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const BATCH_SIZE = 200;
const FREEZE_AFTER_MS = 48 * 60 * 60_000;
const PURGE_AFTER_MS = 72 * 60 * 60_000;

/**
 * Stories, Part 3 (STORY_ARCHIVE_SPEC.md, section 12): what happens to a
 * Story after it ends, on a clock rather than on request.
 *
 *  - 48 hours after publishing: the viewer list and likes are frozen into
 *    `story_insights` and their source rows deleted - irreversibly, the
 *    names are gone for good, matching Instagram (section 6).
 *  - 72 hours after publishing, for a Story posted with "Save story to
 *    archive" off: its media is deleted from S3.
 *  - Promptly for a deleted Story whose media is still present.
 *
 * The freeze step is the one that cannot be undone, so the whole worker does
 * nothing unless STORY_LIFECYCLE_JOBS=1 is set. Turning it on for the first
 * time immediately freezes every Story already past 48 hours - intended, but
 * worth knowing before flipping it in production.
 *
 * This does not yet reduce sticker interactions (poll votes, question
 * replies, link taps, Add Yours entries, Reveal unlocks) to anonymous
 * totals - a deliberate, disclosed scope cut from section 12's "per-viewer
 * sticker rows" wording. `StoryStickerService.results` keeps working with
 * real names past 48 hours; only the Insights total (`stickerTaps`) is
 * frozen here, from the counts, not the rows themselves.
 */
export class StoryLifecycleWorker {
  private static timer: NodeJS.Timeout | undefined;
  private static running = false;

  static get enabled(): boolean {
    return process.env.STORY_LIFECYCLE_JOBS === '1';
  }

  static start(): void {
    if (this.timer || !this.enabled) return;
    logger.info('Story lifecycle worker started (STORY_LIFECYCLE_JOBS=1)');
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
    void this.sweep();
  }

  static stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Runs one full pass: freeze, then the two purge steps. Safe to call directly (tests, a manual trigger). */
  static async sweep(): Promise<{ frozen: number; purgedUnarchived: number; purgedDeleted: number }> {
    if (this.running) return { frozen: 0, purgedUnarchived: 0, purgedDeleted: 0 };
    this.running = true;
    try {
      // Purging can only ever be correct once a Story has had the chance to
      // freeze first - freeze always runs first in a pass for that reason,
      // though the 24-hour gap between the two thresholds already prevents
      // the ordering from mattering in practice.
      const frozen = await this.freeze();
      const purgedUnarchived = await this.purgeUnarchived();
      const purgedDeleted = await this.purgeDeleted();
      if (frozen || purgedUnarchived || purgedDeleted) {
        logger.info('Story lifecycle sweep', { frozen, purgedUnarchived, purgedDeleted });
      }
      return { frozen, purgedUnarchived, purgedDeleted };
    } catch (error) {
      logger.error('Story lifecycle sweep failed', { error: (error as Error)?.message });
      return { frozen: 0, purgedUnarchived: 0, purgedDeleted: 0 };
    } finally {
      this.running = false;
    }
  }

  // --- Freeze: 48 hours after a Story ends --------------------------------

  private static async freeze(): Promise<number> {
    let count = 0;
    for (let i = 0; i < BATCH_SIZE; i += 1) {
      if (!(await this.freezeOne())) break;
      count += 1;
    }
    return count;
  }

  /**
   * Claims and freezes exactly one Story per call, `FOR UPDATE SKIP LOCKED`
   * inside its own transaction, so a second instance running the same sweep
   * simply moves on to the next row instead of colliding with this one.
   */
  private static async freezeOne(): Promise<boolean> {
    const cutoff = new Date(Date.now() - FREEZE_AFTER_MS);
    return prisma.$transaction(async (tx) => {
      const [candidate] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM stories
        WHERE viewers_closed_at IS NULL AND state = 'published' AND deleted_at IS NULL AND published_at < ${cutoff}
        ORDER BY published_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (!candidate) return false;
      const [reach, likes, stickerTaps] = await Promise.all([
        tx.storyView.count({ where: { storyId: candidate.id } }),
        tx.storyLike.count({ where: { storyId: candidate.id } }),
        this.stickerTapsFor(tx, candidate.id),
      ]);
      await tx.storyInsight.upsert({
        where: { storyId: candidate.id },
        create: { storyId: candidate.id, reach, likes, stickerTaps },
        update: { reach, likes, stickerTaps },
      });
      await tx.storyView.deleteMany({ where: { storyId: candidate.id } });
      await tx.storyLike.deleteMany({ where: { storyId: candidate.id } });
      await tx.story.update({ where: { id: candidate.id }, data: { viewersClosedAt: new Date() } });
      return true;
    });
  }

  /** The same total `StoryInsightService` computes live, frozen once at 48 hours. */
  private static async stickerTapsFor(tx: Prisma.TransactionClient, storyId: string): Promise<number> {
    const [responses, questions, linkTaps] = await Promise.all([
      tx.storyStickerResponse.count({ where: { storyId } }),
      tx.storyQuestionReply.count({ where: { storyId } }),
      tx.storyLinkTap.count({ where: { storyId } }),
    ]);
    return responses + questions + linkTaps;
  }

  // --- Purge: media deleted once it is no longer needed -------------------

  /** A Story that ended without "Save story to archive" on, 72 hours after it was posted. */
  private static async purgeUnarchived(): Promise<number> {
    const cutoff = new Date(Date.now() - PURGE_AFTER_MS);
    const candidates = await prisma.story.findMany({
      where: { archive: false, state: 'published', deletedAt: null, purgedAt: null, publishedAt: { lt: cutoff } },
      orderBy: { publishedAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, assetId: true },
    });
    let purged = 0;
    for (const story of candidates) {
      if (await this.purgeMedia(story.id, story.assetId, 'purged')) purged += 1;
    }
    return purged;
  }

  /** A deleted Story whose media has not been removed yet - no extra wait, since the owner already asked for it to go. */
  private static async purgeDeleted(): Promise<number> {
    const candidates = await prisma.story.findMany({
      where: { state: 'deleted', purgedAt: null },
      orderBy: { deletedAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, assetId: true },
    });
    let purged = 0;
    for (const story of candidates) {
      if (await this.purgeMedia(story.id, story.assetId, 'deleted')) purged += 1;
    }
    return purged;
  }

  /**
   * Deletes the Story's media and thumbnail from S3, then marks it purged -
   * in that order. A failed S3 call leaves `purgedAt` null, so the row is
   * simply retried on the next sweep; no row ever claims its media is gone
   * when it is not. `finalState` is `'deleted'` for an already-deleted Story
   * (its `state` says so already) and `'purged'` for one that just ended.
   */
  private static async purgeMedia(storyId: string, assetId: string, finalState: 'purged' | 'deleted'): Promise<boolean> {
    const bucket = privateMediaBucket();
    if (bucket) {
      const asset = await prisma.storyMediaAsset.findUnique({ where: { id: assetId }, select: { objectKey: true, thumbnailObjectKey: true } });
      if (asset) {
        try {
          await Promise.all([
            s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.objectKey })),
            ...(asset.thumbnailObjectKey ? [s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.thumbnailObjectKey }))] : []),
          ]);
        } catch (error) {
          logger.warn('Could not delete Story media during the lifecycle sweep', { storyId, error: (error as Error)?.message });
          return false;
        }
      }
    }
    const result = await prisma.story.updateMany({ where: { id: storyId, purgedAt: null }, data: { state: finalState, purgedAt: new Date() } });
    return result.count > 0;
  }
}
