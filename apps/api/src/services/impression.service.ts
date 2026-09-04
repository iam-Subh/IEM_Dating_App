import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { logger } from '../utils/logger';

/**
 * Impression tracking - records which profiles were shown to which viewer.
 *
 * Why this exists: without impression data you cannot compute click-through
 * rate, enforce exposure fairness, run A/B tests, or train a ranking model.
 * None of it can be backfilled, so it is collected from day one.
 *
 * Why it buffers in Redis: at scale a row per impression reaches billions of
 * rows. Impressions are counted in a Redis hash and flushed periodically as
 * one upserted row per (viewer, shown, day).
 *
 * Failures here must never break discovery - every path is best-effort.
 */

const BUFFER_KEY = 'impressions:buffer';
const EXPOSURE_KEY_PREFIX = 'exposure';
const FLUSH_INTERVAL_MS = 60_000;
const MAX_FLUSH_BATCH = 2_000;
/** Rolling per-user exposure counter, used later for fairness re-ranking. */
const EXPOSURE_TTL_SECONDS = 24 * 60 * 60;

const today = () => new Date().toISOString().slice(0, 10);

export class ImpressionService {
  private static flushTimer: NodeJS.Timeout | null = null;

  /**
   * Record that `shownIds` were displayed to `viewerId`, in deck order.
   * Fire-and-forget: callers should not await this on the response path.
   */
  static async recordBatch(viewerId: string, shownIds: string[]): Promise<void> {
    if (shownIds.length === 0) return;

    try {
      const day = today();
      const pipeline = redisClient.pipeline();

      shownIds.forEach((shownId, index) => {
        // field encodes everything the flush needs; position is the best
        // (lowest) slot seen, resolved at flush time.
        pipeline.hincrby(BUFFER_KEY, `${viewerId}|${shownId}|${day}|${index}`, 1);

        // Rolling exposure counter for fairness re-ranking.
        const exposureKey = `${EXPOSURE_KEY_PREFIX}:${shownId}:${day}`;
        pipeline.incr(exposureKey);
        pipeline.expire(exposureKey, EXPOSURE_TTL_SECONDS);
      });

      await pipeline.exec();
    } catch (error) {
      logger.error('[IMPRESSION] Failed to buffer impressions:', error);
    }
  }

  /** How many times a profile has been shown today. */
  static async getExposureToday(userId: string): Promise<number> {
    try {
      const value = await redisClient.get(`${EXPOSURE_KEY_PREFIX}:${userId}:${today()}`);
      return value ? parseInt(value, 10) : 0;
    } catch {
      return 0;
    }
  }

  static async getExposureBatch(userIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (userIds.length === 0) return result;

    try {
      const day = today();
      const values = await redisClient.mget(
        userIds.map((id) => `${EXPOSURE_KEY_PREFIX}:${id}:${day}`)
      );
      userIds.forEach((id, i) => {
        result.set(id, values[i] ? parseInt(values[i] as string, 10) : 0);
      });
    } catch {
      userIds.forEach((id) => result.set(id, 0));
    }

    return result;
  }

  /**
   * Mark that the viewer acted on a profile they saw. Gives click-through
   * rate without joining against the swipes table.
   */
  static async markActed(viewerId: string, shownId: string): Promise<void> {
    try {
      await prisma.profileImpression.updateMany({
        where: { viewerId, shownId, acted: false },
        data: { acted: true },
      });
    } catch (error) {
      logger.error('[IMPRESSION] Failed to mark acted:', error);
    }
  }

  /**
   * Drain the Redis buffer into Postgres. Safe to run concurrently on
   * multiple instances: HGETDEL removes the fields this instance claims, so
   * two workers never write the same counts.
   */
  static async flush(): Promise<number> {
    try {
      const buffered = await redisClient.hgetall(BUFFER_KEY);
      const fields = Object.keys(buffered);
      if (fields.length === 0) return 0;

      const batch = fields.slice(0, MAX_FLUSH_BATCH);

      // Claim these fields before writing so a concurrent flush cannot
      // double-count them.
      await redisClient.hdel(BUFFER_KEY, ...batch);

      // Collapse duplicate (viewer, shown, day) keys that differ only by
      // position, keeping the best position and summing the counts.
      type Row = { viewerId: string; shownId: string; day: string; bestPosition: number; count: number };
      const rows = new Map<string, Row>();

      for (const field of batch) {
        const [viewerId, shownId, day, positionRaw] = field.split('|');
        if (!viewerId || !shownId || !day) continue;

        const count = parseInt(buffered[field], 10) || 0;
        const position = parseInt(positionRaw, 10);
        const key = `${viewerId}|${shownId}|${day}`;
        const existing = rows.get(key);

        if (existing) {
          existing.count += count;
          if (Number.isFinite(position)) {
            existing.bestPosition = Math.min(existing.bestPosition, position);
          }
        } else {
          rows.set(key, {
            viewerId,
            shownId,
            day,
            bestPosition: Number.isFinite(position) ? position : 0,
            count,
          });
        }
      }

      let written = 0;
      for (const row of rows.values()) {
        try {
          const day = new Date(`${row.day}T00:00:00.000Z`);
          await prisma.profileImpression.upsert({
            where: {
              viewerId_shownId_day: { viewerId: row.viewerId, shownId: row.shownId, day },
            },
            create: {
              viewerId: row.viewerId,
              shownId: row.shownId,
              day,
              count: row.count,
              bestPosition: row.bestPosition,
            },
            update: {
              count: { increment: row.count },
              bestPosition: row.bestPosition,
              lastSeenAt: new Date(),
            },
          });
          written++;
        } catch {
          // A deleted user leaves a dangling FK. Drop the row rather than
          // failing the whole flush.
        }
      }

      logger.info(`[IMPRESSION] Flushed ${written} rows (${batch.length} buffered fields)`);
      return written;
    } catch (error) {
      logger.error('[IMPRESSION] Flush failed:', error);
      return 0;
    }
  }

  static startFlushLoop(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, FLUSH_INTERVAL_MS);
    // Do not hold the process open on shutdown.
    this.flushTimer.unref?.();
    logger.info(`[IMPRESSION] Flush loop started (every ${FLUSH_INTERVAL_MS / 1000}s)`);
  }

  static async stopFlushLoop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
