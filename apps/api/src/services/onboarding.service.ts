import { prisma } from '../utils/prisma';

export type NextRequiredStep = 'studentVerification' | 'profile' | 'discoveryPreferences' | null;

/**
 * Where onboarding goes next.
 *
 * Google accounts verify their college email from Settings after onboarding.
 * An expired membership does not block access. The verification badge expires.
 * All users must complete their profile. Unverified users choose a college there.
 */
export class OnboardingService {
  static statusFromUser(user: {
    department: string | null;
    graduationYear: number | null;
    preferencesConfirmedAt: Date | null;
    college?: string | null;
    googleSub?: string | null;
    verifyLaterAt?: Date | null;
  }, membershipValid = false, everVerified = membershipValid) {
    let nextRequiredStep: NextRequiredStep = null;
    const mayVerifyLater = everVerified || !!user.googleSub;
    if (!membershipValid && !mayVerifyLater) nextRequiredStep = 'studentVerification';
    else if (!user.department || !user.graduationYear) nextRequiredStep = 'profile';
    else if (!membershipValid && !user.college) nextRequiredStep = 'profile';
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
        college: true,
        googleSub: true,
        verifyLaterAt: true,
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
      ...this.statusFromUser(user, membershipValid, !!membership?.verifiedAt),
      membershipVerified: membershipValid,
      membershipExpiresAt: membershipValid ? membership?.expiresAt ?? null : null,
    };
  }
}
