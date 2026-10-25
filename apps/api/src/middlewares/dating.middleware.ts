import { NextFunction, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { ageAt, isEligibilityParty } from '../services/eligibility.service';
import { HttpError } from '../utils/httpError';

export async function requireDatingEligibility(req: Request, _res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, birthday: true },
    });
    // A verified student, or an unverified account with a college
    // (GOOGLE_SIGNUP_PLAN.md 2.1): what each may do is limited elsewhere.
    if (!user || user.accountStatus !== 'active' || (ageAt(user.birthday) ?? 0) < 18 || !(await isEligibilityParty(prisma, userId))) {
      throw new HttpError(403, 'Complete adult and student verification first', 'DATING_SETUP_REQUIRED');
    }
    next();
  } catch (error) { next(error); }
}
