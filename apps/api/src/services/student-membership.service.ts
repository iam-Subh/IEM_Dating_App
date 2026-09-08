import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { OTPService } from './otp.service';
import { EmailService } from './email.service';

export class StudentMembershipService {
  static async listInstitutions() {
    return prisma.institution.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, campuses: true },
    });
  }

  static async requireInstitution(institutionCode: string, email: string) {
    const domain = email.trim().toLowerCase().split('@')[1];
    const institution = await prisma.institution.findFirst({
      where: { code: institutionCode, isActive: true, allowedDomains: { has: domain } },
    });
    if (!institution) {
      throw new HttpError(400, 'Email domain does not match the selected college', 'INSTITUTION_EMAIL_MISMATCH');
    }
    return institution;
  }

  static async sendChallenge(institutionCode: string, email: string) {
    await this.requireInstitution(institutionCode, email);
    const challenge = await OTPService.issue(email, 'student_membership');
    try {
      await EmailService.sendOTP(email, challenge.code);
    } catch (error) {
      await OTPService.cancel(challenge.challengeId);
      throw error;
    }
    return { challengeId: challenge.challengeId, expiresIn: challenge.expiresIn };
  }

  static async verify(userId: string, institutionCode: string, email: string, challengeId: string, code: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const institution = await this.requireInstitution(institutionCode, normalizedEmail);
    const result = await OTPService.verify(normalizedEmail, 'student_membership', challengeId, code);
    if (!result.valid) throw new HttpError(400, result.error, 'INVALID_OTP');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.studentMembership.upsert({
          where: { userId },
          create: {
            userId,
            institutionId: institution.id,
            institutionalEmail: normalizedEmail,
            status: 'verified',
            verifiedAt: now,
            expiresAt,
          },
          update: {
            institutionId: institution.id,
            institutionalEmail: normalizedEmail,
            status: 'verified',
            verificationMethod: 'institution_email',
            verifiedAt: now,
            expiresAt,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            college: institution.name,
            emailVerifiedAt: now,
            eligibilityVersion: { increment: 1 },
          },
        });
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new HttpError(409, 'College email is linked to another account', 'MEMBERSHIP_EMAIL_IN_USE');
      }
      throw error;
    }
    return { status: 'verified', institution: { code: institution.code, name: institution.name }, verifiedAt: now, expiresAt };
  }

  static async hasValidMembership(userId: string, now = new Date()) {
    return !!(await prisma.studentMembership.findFirst({
      where: {
        userId,
        status: 'verified',
        verifiedAt: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        institution: { isActive: true },
      },
      select: { id: true },
    }));
  }

  static async compatibleMemberships(userIds: [string, string], requireSameInstitution: boolean, now = new Date()) {
    const memberships = await prisma.studentMembership.findMany({
      where: {
        userId: { in: userIds },
        status: 'verified',
        verifiedAt: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        institution: { isActive: true },
      },
      select: { userId: true, institutionId: true },
    });
    if (memberships.length !== 2) return false;
    return !requireSameInstitution || memberships[0].institutionId === memberships[1].institutionId;
  }
}
