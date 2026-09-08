import { prisma } from '../utils/prisma';

export type NextRequiredStep = 'studentVerification' | 'profile' | 'discoveryPreferences' | null;

export class OnboardingService {
  static statusFromUser(user: {
    department: string | null;
    graduationYear: number | null;
    preferencesConfirmedAt: Date | null;
  }, membershipValid = false) {
    let nextRequiredStep: NextRequiredStep = null;
    if (!membershipValid) nextRequiredStep = 'studentVerification';
    else if (!user.department || !user.graduationYear) nextRequiredStep = 'profile';
    else if (!user.preferencesConfirmedAt) nextRequiredStep = 'discoveryPreferences';
    return { profileReady: nextRequiredStep === null, nextRequiredStep };
  }

  static async getStatus(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        department: true,
        graduationYear: true,
        preferencesConfirmedAt: true,
        studentMembership: {
          select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true } } },
        },
      },
    });
    const membership = user.studentMembership;
    const membershipValid = !!(
      membership &&
      membership.status === 'verified' &&
      membership.verifiedAt &&
      (!membership.expiresAt || membership.expiresAt > new Date()) &&
      membership.institution.isActive
    );
    return {
      ...this.statusFromUser(user, membershipValid),
      membershipVerified: membershipValid,
      membershipExpiresAt: membershipValid ? membership?.expiresAt ?? null : null,
    };
  }
}
