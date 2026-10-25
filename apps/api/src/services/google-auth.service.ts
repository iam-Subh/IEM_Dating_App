import { IdentityBanService } from './identity-ban.service';
import { standingError } from './account-standing';
import { liftExpiredSuspension } from './suspension';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import type { User } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { OnboardingService } from './onboarding.service';
import { StudentMembershipService } from './student-membership.service';
import { generateTokens } from '../utils/jwt';
import { AuthService, SESSION_LIFETIME_MS } from './auth.service';
import { SignInNoticeService } from './sign-in-notice.service';

/**
 * Sign in with Google (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 1.1, 1.2).
 *
 * The app sends the ID token Google gave it. It is checked here with Google's
 * own library - signature, expiry, issuer, and that it was issued for one of
 * our client IDs - before anything is trusted. Then:
 *
 * - a Google account linked to an account here signs in to it - after a
 *   reinstall too, with no password;
 * - a Google email that already belongs to an account with a password asks
 *   for that password once, then links Google to it (`linkWithPassword`) -
 *   never merged behind the person's back;
 * - otherwise a new account is created, with no password;
 * - and when the Google address is a verified college email whose domain
 *   belongs to exactly one college, the account is verified at once, as if
 *   it had signed up with that college email.
 *
 * Settings > Account can also connect Google to a signed-in account, and
 * disconnect it - only when the account has a password, so nobody is locked out.
 */

const client = new OAuth2Client();

/** The client IDs a token may be issued to: the Web client (the app asks for tokens issued to it). */
function audiences() {
  const ids = (process.env.GOOGLE_CLIENT_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (!ids.length) throw new HttpError(503, 'Google sign-in is not set up yet', 'GOOGLE_NOT_CONFIGURED');
  return ids;
}

type DeviceInfo = Record<string, unknown> | undefined;
const SIGN_IN_STATUSES = ['active', 'deletion_pending'];

export class GoogleAuthService {
  /** The Google account behind an ID token, once Google's signature and our client ID check out. */
  static async verify(idToken: string) {
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: audiences() });
      payload = ticket.getPayload();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401, 'Google sign-in could not be verified. Try again.', 'GOOGLE_TOKEN_INVALID');
    }
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new HttpError(401, 'Google did not confirm this email address.', 'GOOGLE_EMAIL_UNVERIFIED');
    }
    return { sub: payload.sub, email: payload.email.trim().toLowerCase(), name: payload.name ?? null };
  }

  static async signIn(idToken: string, deviceInfo?: DeviceInfo, androidId: string | null = null) {
    const google = await this.verify(idToken);
    let user = await prisma.user.findUnique({ where: { googleSub: google.sub } });
    if (user) user = await liftExpiredSuspension(user);
    if (user) {
      if (!SIGN_IN_STATUSES.includes(user.accountStatus)) {
        // Google has proved who they are: say why, and how to appeal.
        throw standingError(user) ?? new HttpError(403, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
      }
    } else {
      const existing = await AuthService.findAccountByEmail(google.email);
      if (existing) {
        // Never linked silently: the account's password proves it is theirs (1.2).
        if (existing.passwordHash) {
          throw new HttpError(409, 'This email already has an account. Enter its password once to connect Google.',
            'GOOGLE_NEEDS_PASSWORD', { email: google.email });
        }
        throw new HttpError(409, 'This email already has an account. Sign in with your email and password.', 'GOOGLE_EMAIL_HAS_ACCOUNT');
      }
      // A banned person's Google account, email or phone can't sign up again,
      // and one phone makes at most two Google accounts (GOOGLE_SIGNUP_PLAN.md 6.1).
      await IdentityBanService.assertNotBanned({ googleSub: google.sub, emails: [google.email], androidId });
      await IdentityBanService.assertDeviceAllowsGoogleSignup(androidId);
      const now = new Date();
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            signupAndroidId: androidId,
            email: google.email,
            emailVerifiedAt: now,
            googleSub: google.sub,
            googleEmail: google.email,
            googleLinkedAt: now,
            name: (google.name ?? google.email.split('@')[0]).slice(0, 255),
            passwordHash: '',
            lastActiveAt: now,
            isVerified: false,
          },
        });
        await tx.userScore.create({ data: { userId: created.id } });
        return created;
      });
      await this.verifyCollegeAddress(user.id, google.email);
    }
    return this.issueSession(user, deviceInfo);
  }

  /** "Enter your password once": the Google email's account, its password, then Google linked and signed in. */
  static async linkWithPassword(idToken: string, password: string, deviceInfo?: DeviceInfo) {
    const google = await this.verify(idToken);
    const user = await AuthService.findAccountByEmail(google.email);
    if (!user || !user.passwordHash || !SIGN_IN_STATUSES.includes(user.accountStatus) ||
        !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, 'That password is not right.', 'INVALID_CREDENTIALS');
    }
    await this.attach(user.id, google);
    return this.issueSession(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), deviceInfo);
  }

  /** Settings > Account > Connect with Google. */
  static async connect(userId: string, idToken: string) {
    const google = await this.verify(idToken);
    await this.attach(userId, google);
    return { email: google.email };
  }

  /** Settings > Account > Disconnect Google - only with a password to sign in with instead. */
  static async disconnect(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, googleSub: true } });
    if (!user.googleSub) return { disconnected: false };
    if (!user.passwordHash) {
      throw new HttpError(409, 'Add a password first, so you can still sign in.', 'PASSWORD_REQUIRED');
    }
    await prisma.user.update({ where: { id: userId }, data: { googleSub: null, googleEmail: null, googleLinkedAt: null } });
    return { disconnected: true };
  }

  /** Links a Google account to `userId`, refusing one already linked to someone else. */
  private static async attach(userId: string, google: { sub: string; email: string }) {
    const [owner, me] = await Promise.all([
      prisma.user.findUnique({ where: { googleSub: google.sub }, select: { id: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { googleSub: true } }),
    ]);
    if (owner && owner.id !== userId) {
      throw new HttpError(409, 'This Google account is already linked to another account.', 'GOOGLE_LINKED_ELSEWHERE');
    }
    if (me.googleSub && me.googleSub !== google.sub) {
      throw new HttpError(409, 'Another Google account is connected. Disconnect it first.', 'GOOGLE_ALREADY_CONNECTED');
    }
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { googleSub: google.sub, googleEmail: google.email, googleLinkedAt: new Date() },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new HttpError(409, 'This Google account is already linked to another account.', 'GOOGLE_LINKED_ELSEWHERE');
      }
      throw error;
    }
  }

  /** A new session for `user`, as every sign-in returns it. */
  static async issueSession(user: User, deviceInfo?: DeviceInfo) {
    const jti = randomUUID();
    const familyId = randomUUID();
    const tokens = generateTokens(user.id, user.email ?? '', jti, user.role, user.sessionVersion);
    await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenJti: jti,
        familyId,
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
        deviceInfo: (deviceInfo ?? {}) as object,
      },
    });
    void SignInNoticeService.afterSignIn(user.id, familyId, deviceInfo);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const { passwordHash: _hidden, ...safe } = fresh;
    return { user: safe, ...tokens, onboarding: await OnboardingService.getStatus(user.id) };
  }

  /**
   * The shortcut (GOOGLE_SIGNUP_PLAN.md 1.1): Google has verified the address,
   * so a college address needs no code. Only when exactly one college uses
   * the domain - a shared domain needs the location check of the normal flow.
   */
  private static async verifyCollegeAddress(userId: string, email: string) {
    const domain = email.split('@')[1];
    const institutions = await StudentMembershipService.sharedDomainInstitutions(domain);
    if (institutions.length !== 1) return;
    const institution = await prisma.institution.findUniqueOrThrow({ where: { id: institutions[0].id } });
    const now = new Date();
    try {
      await prisma.$transaction(async (tx) => {
        await tx.studentMembership.create({
          data: {
            userId,
            institutionId: institution.id,
            institutionalEmail: email,
            status: 'verified',
            verificationMethod: 'google_email',
            verifiedAt: now,
            expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
            campusConfirmed: true,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: { college: institution.name, pausedAt: null, expiryReminderLevel: 0, eligibilityVersion: { increment: 1 } },
        });
      });
    } catch (error) {
      // Already linked to another account: they verify through the normal flow instead.
      logger.warn(`Google college shortcut skipped: ${(error as Error).message}`);
    }
  }
}
