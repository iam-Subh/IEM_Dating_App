import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { StudentMembershipService } from '../services/student-membership.service';
import { OnboardingService } from '../services/onboarding.service';
import { GoogleAuthService } from '../services/google-auth.service';
import { VerificationLimitsService } from '../services/verification-limits.service';

export class VerificationController {
  static async institutions(_req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await StudentMembershipService.listInstitutions())); }
    catch (error) { next(error); }
  }

  static async send(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await StudentMembershipService.sendChallenge(req.body.institutionCode, req.body.email);
      res.json(ApiResponse.success(data, 'Verification code sent'));
    } catch (error) { next(error); }
  }

  /** What the app shows about verifying: the badge, limits left, grace period, expiry. */
  static async status(req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await VerificationLimitsService.status((req as any).user.sub))); }
    catch (error) { next(error); }
  }

  static async later(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      await StudentMembershipService.verifyLater(userId);
      res.json(ApiResponse.success({ onboarding: await OnboardingService.getStatus(userId) }));
    } catch (error) { next(error); }
  }

  /** "Use that one?": signs in to the account the college email already has (GOOGLE_SIGNUP_PLAN.md 1.4). */
  static async switchAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const target = await StudentMembershipService.switchAccount((req as any).user.sub, req.body.switchToken);
      res.json(ApiResponse.success(await GoogleAuthService.issueSession(target, req.body.deviceInfo), 'Switched account'));
    } catch (error) { next(error); }
  }

  static async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const membership = await StudentMembershipService.verify(
        userId,
        req.body.institutionCode,
        req.body.email,
        req.body.challengeId,
        req.body.code,
        req.body.location,
        req.body.password,
      );
      res.json(ApiResponse.success({ membership, onboarding: await OnboardingService.getStatus(userId) }));
    } catch (error) { next(error); }
  }
}
