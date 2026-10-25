import { NextFunction, Request, Response } from 'express';
import { announceVerification } from '../services/verification-live';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';

/**
 * Admin review of memberships whose campus could not be confirmed
 * (LOCATION_SPEC.md 8.2): a shared email domain, and either no location or a
 * location that did not match the chosen institution. Until confirmed, the
 * member uses the app inside their own institution only.
 */
export class MembershipReviewController {
  static async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const rows = await prisma.studentMembership.findMany({
        where: { campusConfirmed: false, status: 'verified' },
        orderBy: { verifiedAt: 'asc' },
        take: 200,
        select: {
          userId: true,
          institutionalEmail: true,
          verifiedAt: true,
          institution: { select: { code: true, name: true } },
          user: { select: { name: true } },
        },
      });
      res.json({ success: true, data: rows });
    } catch (error) { next(error); }
  }

  /** Confirm the chosen institution, or move the member to the right one. */
  static async confirm(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = z.string().uuid().safeParse(req.params.userId);
      if (!userId.success) throw new HttpError(404, 'Membership not found', 'MEMBERSHIP_NOT_FOUND');
      const body = z.object({ institutionCode: z.string().max(40).optional() }).strict().safeParse(req.body ?? {});
      if (!body.success) throw new HttpError(400, 'Invalid request', 'INVALID_REVIEW');
      const membership = await prisma.studentMembership.findUnique({
        where: { userId: userId.data },
        select: { institutionId: true, institutionalEmail: true },
      });
      if (!membership) throw new HttpError(404, 'Membership not found', 'MEMBERSHIP_NOT_FOUND');

      let institutionId = membership.institutionId;
      let institutionName: string | null = null;
      if (body.data.institutionCode) {
        const domain = membership.institutionalEmail.split('@')[1];
        const target = await prisma.institution.findFirst({
          where: { code: body.data.institutionCode, isActive: true, allowedDomains: { has: domain } },
          select: { id: true, name: true },
        });
        if (!target) throw new HttpError(400, "That institution does not accept this student's email domain", 'INSTITUTION_EMAIL_MISMATCH');
        institutionId = target.id;
        institutionName = target.name;
      }
      const moved = institutionId !== membership.institutionId;
      await prisma.$transaction([
        prisma.studentMembership.update({
          where: { userId: userId.data },
          data: { institutionId, campusConfirmed: true },
        }),
        prisma.user.update({
          where: { id: userId.data },
          data: {
            eligibilityVersion: { increment: 1 },
            // A campus belongs to one institution; moving clears it.
            ...(moved ? { campusId: null, campus: null, college: institutionName } : {}),
          },
        }),
      ]);
      announceVerification(userId.data);
      res.json({ success: true, data: { userId: userId.data, institutionId, moved } });
    } catch (error) { next(error); }
  }
}
