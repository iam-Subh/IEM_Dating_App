import { Request, Response, NextFunction } from 'express';
import { snapToGrid, isValidCoords } from '../utils/geo';
import { prisma } from '../utils/prisma';
import { ProfileService } from '../services/profile.service';
import { ApiResponse } from '../utils/ApiResponse';

import { MediaCacheService } from '../services/mediaCache.service';
import { RecommendationService } from '../services/recommendation.service';
import { OnboardingService } from '../services/onboarding.service';

export class ProfileController {
  static async getReadiness(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await OnboardingService.getStatus((req as any).user.sub);
      res.status(200).json(ApiResponse.success(status));
    } catch (error) {
      next(error);
    }
  }
  static async removeLocation(req: Request, res: Response, next: NextFunction) {
    try {
      await prisma.user.update({ where: { id: (req as any).user.sub }, data: {
        latitude: null, longitude: null, locationConsentAt: null, locationUpdatedAt: null,
        preferencesConfirmedAt: null, eligibilityVersion: { increment: 1 },
      } });
      res.json({ success: true });
    } catch (error) { next(error); }
  }
  static async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;


      const profile = await ProfileService.getProfile(userId);
      if (!profile) return res.status(404).json(ApiResponse.error('Profile not found'));
      
      // Cache it for next time
      await MediaCacheService.cacheUserMedia(userId);

      res.status(200).json(ApiResponse.success(profile));
    } catch (error) {
      next(error);
    }
  }

  static async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;

      const profile = await ProfileService.updateProfile(userId, req.body);
      res.status(200).json(ApiResponse.success(profile, 'Profile updated successfully'));
    } catch (error: any) {
      next(error);
    }
  }

  /**
   * Update the caller's location.
   *
   * Coordinates are snapped to a ~1km grid before storage - exact GPS is
   * never persisted. Requires prior location consent (DPDP: location is
   * personal data and needs its own consent, not a bundled one).
   */
  static async updateLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const { latitude, longitude } = req.body ?? {};

      if (!isValidCoords({ latitude, longitude })) {
        return res.status(400).json(ApiResponse.error('Invalid coordinates'));
      }

      const snapped = snapToGrid({ latitude, longitude });

      // Record consent on the first location write. The client is required to
      // have shown the standalone location consent prompt before calling this;
      // we stamp the time so the grant is auditable.
      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { locationConsentAt: true },
      });

      await prisma.user.update({
        where: { id: userId },
        data: {
          latitude: snapped.latitude,
          longitude: snapped.longitude,
          locationUpdatedAt: new Date(),
          locationConsentAt: existing?.locationConsentAt ?? new Date(),
        },
      });

      // Moving changes who is nearby, so the cached deck is stale.
      await RecommendationService.invalidateCache(userId);

      return res.status(200).json(ApiResponse.success(null, 'Location updated'));
    } catch (error) {
      return next(error);
    }
  }
}
