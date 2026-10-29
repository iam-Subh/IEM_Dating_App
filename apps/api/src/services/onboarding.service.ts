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
  }, membershipValid = false, everVerified = membershipValid, media: { photo: boolean; video: boolean } = { photo: true, video: true }) {
    let nextRequiredStep: NextRequiredStep = null;
    const mayVerifyLater = everVerified || !!user.googleSub;
    if (!membershipValid && !mayVerifyLater) nextRequiredStep = 'studentVerification';
    else if (!user.department || !user.graduationYear) nextRequiredStep = 'profile';
    else if (!membershipValid && !user.college) nextRequiredStep = 'profile';
    // The review page asks for a main photo and the profile video before
    // "Start discovering"; so does this. Without it, someone whose sign-up
    // progress was lost on the phone (logged out, reinstalled) was let into
    // Explore with no photo at all.
    else if (!media.photo || !media.video) nextRequiredStep = 'profile';
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
        profileVideoUrl: true,
        _count: { select: { photos: true } },
        studentMembership: {
          select: { status: true, verifiedAt: true, expiresAt: true, institution: { select: { isActive: true } } },
        },
      },
    });
    // Media still with the nudity check's team counts: it is theirs, only waiting.
    const waiting = await prisma.mediaModeration.groupBy({
      by: ['kind'], where: { userId, status: { in: ['pending', 'unchecked'] }, kind: { in: ['profile_photo', 'profile_video'] } }, _count: { _all: true },
    });
    const media = {
      photo: user._count.photos > 0 || waiting.some((row) => row.kind === 'profile_photo'),
      video: !!user.profileVideoUrl || waiting.some((row) => row.kind === 'profile_video'),
    };
    const membership = user.studentMembership;
    const membershipValid = !!(
      membership &&
      membership.status === 'verified' &&
      membership.verifiedAt &&
      (!membership.expiresAt || membership.expiresAt > new Date()) &&
      membership.institution.isActive
    );
    return {
      ...this.statusFromUser(user, membershipValid, !!membership?.verifiedAt, media),
      membershipVerified: membershipValid,
      membershipExpiresAt: membershipValid ? membership?.expiresAt ?? null : null,
    };
  }
}
