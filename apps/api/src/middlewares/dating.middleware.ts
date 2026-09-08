import { NextFunction, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { ageAt } from '../services/eligibility.service';
import { HttpError } from '../utils/httpError';

export async function requireDatingEligibility(req: Request, _res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountStatus: true,
        birthday: true,
        studentMembership: {
          select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true } } },
        },
      },
    });
    const membership = user?.studentMembership;
    const validMembership = membership?.status === 'verified' && !!membership.verifiedAt &&
      membership.institution.isActive && (!membership.expiresAt || membership.expiresAt > new Date());
    if (!user || user.accountStatus !== 'active' || (ageAt(user.birthday) ?? 0) < 18 || !validMembership) {
      throw new HttpError(403, 'Complete adult and student verification first', 'DATING_SETUP_REQUIRED');
    }
    next();
  } catch (error) { next(error); }
}
