import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { StudentMembershipService } from '../services/student-membership.service';
import { OnboardingService } from '../services/onboarding.service';

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

  static async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user.sub;
      const membership = await StudentMembershipService.verify(
        userId,
        req.body.institutionCode,
        req.body.email,
        req.body.challengeId,
        req.body.code,
      );
      res.json(ApiResponse.success({ membership, onboarding: await OnboardingService.getStatus(userId) }));
    } catch (error) { next(error); }
  }
}
