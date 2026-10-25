import { Request, Response, NextFunction } from 'express';
import { isValidCoords } from '../utils/geo';
import { LocationService } from '../services/location.service';
import { prisma } from '../utils/prisma';
import { ProfileService } from '../services/profile.service';
import { ApiResponse } from '../utils/ApiResponse';

import { MediaCacheService } from '../services/mediaCache.service';
import { RecommendationService } from '../services/recommendation.service';
import { OnboardingService } from '../services/onboarding.service';
import { MatchProfileService } from '../services/match-profile.service';

export class ProfileController {
  static async getMatchProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await MatchProfileService.get((req as any).user.sub, String(req.params.matchId));
      res.json(ApiResponse.success(profile));
    } catch (error) { next(error); }
  }
  static async getReadiness(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await OnboardingService.getStatus((req as any).user.sub);
      res.status(200).json(ApiResponse.success(status));
    } catch (error) {
      next(error);
    }
  }
  /** Withdraws location consent and erases every stored position, saved places included. */
  static async removeLocation(req: Request, res: Response, next: NextFunction) {
    try {
      await LocationService.erase((req as any).user.sub);
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
      const { latitude, longitude, accuracy, accuracyM } = req.body ?? {};

      if (!isValidCoords({ latitude, longitude })) {
        return res.status(400).json(ApiResponse.error('Invalid coordinates'));
      }
      if (accuracy !== undefined && accuracy !== 'precise' && accuracy !== 'approximate') {
        return res.status(400).json(ApiResponse.error('Invalid accuracy'));
      }
      if (accuracyM !== undefined && (typeof accuracyM !== 'number' || !Number.isFinite(accuracyM) || accuracyM < 0)) {
        return res.status(400).json(ApiResponse.error('Invalid accuracy radius'));
      }

      // The service invalidates the viewer's deck itself when the cell moves.
      const result = await LocationService.update(userId, { latitude, longitude }, { accuracy, accuracyM });

      // The snapped cell goes back to its owner, so the app can tell locally
      // whether a later fix has moved cells and skip writes that would not.
      return res.status(200).json(ApiResponse.success(result, 'Location updated'));
    } catch (error) {
      return next(error);
    }
  }
}
