import { redisClient } from '../utils/redis';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

export class MediaCacheService {
  /**
   * Safe JSON parse with error catching
   */
  private static parseJSON<T>(jsonStr: string | null): T | null {
    if (!jsonStr) return null;
    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      return null;
    }
  }

  /**
   * Cache user's media URLs for fast retrieval
   */
  static async cacheUserMedia(userId: string): Promise<void> {
    try {
      // Don't wait on failing redis immediately
      if (redisClient.status !== 'ready' && redisClient.status !== 'connecting') {
        logger.warn('[MediaCache] Redis not available, skipping cache write');
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          avatarUrl: true,
          profileVideoUrl: true,
          videoPreviewUrl: true,
          photos: {
            select: { photoUrl: true },
            orderBy: { order: 'asc' }
          }
        }
      });

      if (!user) return;

      const mediaData = {
        userId: user.id,
        avatarUrl: user.avatarUrl,
        profileVideoUrl: user.profileVideoUrl,
        videoPreviewUrl: user.videoPreviewUrl,
        photos: user.photos.map(p => p.photoUrl),
        cachedAt: Date.now(),
        expiresAt: Date.now() + Number(process.env.MEDIA_CACHE_TTL || 3600) * 1000 // default 1 hour
      };

      await redisClient.setex(
        `media:${userId}`,
        Number(process.env.MEDIA_CACHE_TTL || 3600),
        JSON.stringify(mediaData)
      );
    } catch (error) {
      logger.error('[MediaCache] Error caching media:', error);
    }
  }

  /**
   * Get cached media URLs (fast!)
   */
  static async getCachedMedia(userId: string): Promise<any | null> {
    try {
      if (redisClient.status !== 'ready') {
        logger.warn('[MediaCache] Redis unavailable, fetching from DB');
        return null;
      }

      const startTime = Date.now();
      const cached = await redisClient.get(`media:${userId}`);
      
      if (cached) {
        const data = this.parseJSON<any>(cached);
        if (data && data.expiresAt > Date.now()) {
          const loadTime = Date.now() - startTime;
          logger.info(`[MediaCache] Cache HIT - ${loadTime}ms`);
          return data;
        }
        // Expired - delete and refresh
        await redisClient.del(`media:${userId}`);
      }
      
      const loadTimeMs = Date.now() - startTime;
      logger.info(`[MediaCache] Cache MISS - check time ${loadTimeMs}ms`);
      
      // Cache miss - we do NOT block the caller here by filling it
      // The caller will fetch from DB, we can async cache it
      this.cacheUserMedia(userId).catch(e => logger.error('[MediaCache] background cache error', e));
      return null;
    } catch (error) {
      logger.error('[MediaCache] Error getting cached media:', error);
      return null; // Gracefully fail
    }
  }

  /**
   * Invalidate cache when media is updated/deleted
   */
  static async invalidateCache(userId: string): Promise<void> {
    try {
      if (redisClient.status !== 'ready') return;
      await redisClient.del(`media:${userId}`);
      await redisClient.del(`preview:${userId}`);
      logger.info('[MediaCache] Invalidated cache');
    } catch (error) {
      logger.error('[MediaCache] Error invalidating cache:', error);
    }
  }

  /**
   * Cache presigned URLs temporarily (prevent regeneration)
   */
  static async cachePresignedUrls(userId: string, urls: any[], ttlSeconds: number = 300): Promise<void> {
    try {
      if (redisClient.status !== 'ready') return;
      await redisClient.setex(
        `presigned:${userId}`,
        ttlSeconds,
        JSON.stringify({
          userId,
          urls,
          createdAt: Date.now()
        })
      );
    } catch (error) {
      logger.error('[MediaCache] Error caching presigned URLs:', error);
    }
  }

  static async getCachedPresignedUrls(userId: string): Promise<any | null> {
    try {
      if (redisClient.status !== 'ready') return null;
      const cached = await redisClient.get(`presigned:${userId}`);
      return this.parseJSON<any>(cached);
    } catch (error) {
      logger.error('[MediaCache] Error fetching cached presigned URLs:', error);
      return null;
    }
  }
}
