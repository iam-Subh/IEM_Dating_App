import { prisma } from '../utils/prisma';

/**
 * Settings > Account: how this account signs in - its email, or Google once
 * Google sign-in exists (features/auth/GOOGLE_SIGNUP_PLAN.md) - and the
 * college email that verifies it.
 */

export type SignInMethod = 'email' | 'google';

export class AccountIdentityService {
  static async read(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true, emailVerifiedAt: true, passwordHash: true, createdAt: true,
        googleSub: true, googleEmail: true, googleLinkedAt: true,
        studentMembership: { select: { institutionalEmail: true, status: true, verifiedAt: true, expiresAt: true } },
      },
    });
    // Made with Google: linked the moment it was created (adding a password
    // later does not change how it was made).
    const madeWithGoogle = !!user.googleLinkedAt && Math.abs(user.googleLinkedAt.getTime() - user.createdAt.getTime()) < 60_000;
    const signUpMethod: SignInMethod = user.googleSub && (madeWithGoogle || !user.passwordHash) ? 'google' : 'email';
    const membership = user.studentMembership;
    return {
      signUpMethod,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      collegeEmail: membership?.status === 'verified' && membership.institutionalEmail !== user.email
        ? membership.institutionalEmail : null,
      collegeEmailVerifiedAt: membership?.status === 'verified' ? membership.verifiedAt : null,
      // Ended (GOOGLE_SIGNUP_PLAN.md 5): the badge is gone until they re-verify.
      collegeVerificationExpired: !!(membership?.status === 'verified' && membership.expiresAt && membership.expiresAt <= new Date()),
      google: user.googleSub && user.googleEmail
        ? { email: user.googleEmail, linkedAt: (user.googleLinkedAt ?? user.createdAt).toISOString() }
        : null,
      hasPassword: Boolean(user.passwordHash),
      memberSince: user.createdAt,
    };
  }
}
