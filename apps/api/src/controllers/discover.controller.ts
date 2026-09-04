import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { prisma } from '../utils/prisma';
import { RecommendationService } from '../services/recommendation.service';
import { ImpressionService } from '../services/impression.service';
import { scoreUpdateQueue } from '../services/score-update.worker';
import { AnalyticsService } from '../services/analytics.service';
import { NotificationService } from '../services/notification.service';

import { transformToCdnUrl } from '../middlewares/upload.middleware';

export class DiscoverController {

  /**
   * GET /recommendations — Returns scored, ranked recommendations.
   * Uses the 3-step pipeline: hard filter → pre-rank → score.
   * Results are cached in Redis for 5 minutes.
   */
  static async getRecommendations(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const startTime = Date.now();
      const recommendations = await RecommendationService.getRecommendations(userId, page, limit);
      const durationMs = Date.now() - startTime;

      // Format for frontend
      const formatted = recommendations.map((rec) => {
        const user = rec.user;
        const rawPrimaryPhoto = user.avatarUrl
          || user.photos.find((p) => p.isPrimary)?.photoUrl
          || user.photos[0]?.photoUrl
          || null;

        return {
          ...user,
          id: user.id,
          name: user.name,
          age: user.age,
          department: user.department,
          year: user.year ? `${user.year} Year` : '',
          campus: user.campus,
          isHosteller: user.isHosteller,
          primaryPhoto: rawPrimaryPhoto ? transformToCdnUrl(rawPrimaryPhoto) : null,
          photos: user.photos.map((p) => transformToCdnUrl(p.photoUrl)),
          video: user.profileVideoUrl ? transformToCdnUrl(user.profileVideoUrl) : null,
          videoPreview: user.videoPreviewUrl ? transformToCdnUrl(user.videoPreviewUrl) : null,
          seeking: user.seeking,
          isVerified: user.isVerified || !!(user as any).phone,
          matchPercentage: rec.matchPercentage,
        };
      });

      // Record what was shown, in deck order. Fire-and-forget: impression
      // tracking must never delay or fail the discovery response.
      ImpressionService.recordBatch(userId, formatted.map((u) => u.id)).catch(() => {});

      // Track analytics
      AnalyticsService.trackRecommendation({
        userId,
        candidatesScored: recommendations.length,
        topScore: recommendations[0]?.score || 0,
        cacheHit: durationMs < 10, // Cache hits are typically <10ms
        durationMs,
      });

      res.status(200).json(ApiResponse.success(formatted));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /swipe — Record a swipe action (like/pass).
   * 
   * Flow:
   * 1. Validate input
   * 2. Record swipe in DB
   * 3. Queue async ELO update (non-blocking)
   * 4. Check for mutual like → create Match
   * 5. Return result
   */
  static async swipe(req: Request, res: Response, next: NextFunction) {
    try {
      const { targetId, action } = req.body;
      const userId = (req as any).user.sub;

      // Validate input
      if (!targetId || !['like', 'pass'].includes(action)) {
        res.status(400).json(ApiResponse.error('Invalid targetId or action'));
        return;
      }

      // Verify target exists
      const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
      if (!targetUser) {
        res.status(404).json(ApiResponse.error('Target user not found'));
        return;
      }

      // ── Transaction: swipe + match creation (atomic) ──────────────────
      const result = await prisma.$transaction(async (tx) => {
        // Record swipe
        await tx.swipe.upsert({
          where: {
            swiperId_targetId: {
              swiperId: userId,
              targetId,
            },
          },
          update: { action },
          create: {
            swiperId: userId,
            targetId,
            action,
          },
        });

        let matchCreated = false;
        let matchId: string | undefined;

        if (action === 'like') {
          const mutualLike = await tx.swipe.findUnique({
            where: {
              swiperId_targetId: {
                swiperId: targetId,
                targetId: userId,
              },
            },
          });

          if (mutualLike && mutualLike.action === 'like') {
            const existingMatch = await tx.match.findFirst({
              where: {
                OR: [
                  { user1Id: userId, user2Id: targetId },
                  { user1Id: targetId, user2Id: userId },
                ],
              },
            });

            if (!existingMatch) {
              const match = await tx.match.create({
                data: {
                  user1Id: userId,
                  user2Id: targetId,
                  status: 'active',
                },
              });
              matchCreated = true;
              matchId = match.id;
            } else {
              matchCreated = true;
              matchId = existingMatch.id;
            }
          }
        }

        return { matchCreated, matchId };
      }, {
        timeout: 15000, // 15 seconds to allow for multiple DB ops + potential network jitter
      });

      const { matchCreated, matchId } = result;

      // ── Post-transaction: async operations (non-blocking) ───────────
      // Queue ELO update
      scoreUpdateQueue.add({ swiperId: userId, targetId, action });

      // Send notifications on new match
      if (matchCreated && matchId) {
        AnalyticsService.trackMatch({
          matchId,
          user1Id: userId,
          user2Id: targetId,
        });
        const currentUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });
        NotificationService.sendMatchNotification(userId, matchId, targetUser.name);
        NotificationService.sendMatchNotification(targetId, matchId, currentUser?.name || 'Someone');
      }

      // Track swipe analytics
      AnalyticsService.trackSwipe({
        swiperId: userId,
        targetId,
        action,
        matchCreated,
        matchId,
      });

      res.status(200).json(ApiResponse.success({
        targetId,
        action,
        matchCreated,
        matchId,
      }, matchCreated ? "It's a match! 🎉" : 'Swipe recorded successfully'));
    } catch (error) {
      next(error);
    }
  }
}
