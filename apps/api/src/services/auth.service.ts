import { IdentityBanService } from './identity-ban.service';
import { standingError } from './account-standing';
import { liftExpiredSuspension } from './suspension';
import { prisma } from '../utils/prisma';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { generateTokens } from '../utils/jwt';
import { OnboardingService } from './onboarding.service';
import { verifyRefreshToken } from '../utils/jwt';
import { HttpError } from '../utils/httpError';
import { disconnectSessionSockets, disconnectUserSockets } from '../socket';
import { maskIp } from './session-device.service';
import { SignInNoticeService } from './sign-in-notice.service';
import { OTPService } from './otp.service';
import { EmailService } from './email.service';

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;


export class AuthService {
  /**
   * The account an email signs in to (GOOGLE_SIGNUP_PLAN.md 1.2): its main
   * email (a college email, or the Gmail of a Google sign-up), or the
   * verified college email of a Google account that verified later.
   */
  static async findAccountByEmail(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) return byEmail;
    const membership = await prisma.studentMembership.findFirst({
      where: { institutionalEmail: email, status: 'verified', verifiedAt: { not: null } },
      select: { userId: true },
    });
    return membership ? prisma.user.findUnique({ where: { id: membership.userId } }) : null;
  }

  /** Settings > Account > Add a password, for an account made with Google (1.2). */
  static async setPassword(userId: string, password: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (user.passwordHash) throw new HttpError(409, 'This account already has a password.', 'PASSWORD_ALREADY_SET');
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  }

  /**
   * Account > Change password: the current one first. Every other device is
   * signed out (whoever knew the old password); this one stays signed in.
   */
  static async changePassword(userId: string, currentPassword: string, nextPassword: string, currentJti: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!user.passwordHash) throw new HttpError(409, 'This account has no password yet. Add one instead.', 'NO_PASSWORD');
    if (!await bcrypt.compare(currentPassword, user.passwordHash)) {
      throw new HttpError(400, 'Your current password is not right.', 'WRONG_PASSWORD');
    }
    if (await bcrypt.compare(nextPassword, user.passwordHash)) {
      throw new HttpError(400, 'Choose a password you have not used here.', 'SAME_PASSWORD');
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(nextPassword, 10) } });
    return this.revokeOtherSessions(userId, currentJti);
  }

  static async startRecovery(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.findAccountByEmail(email);
    // A Google account without a password has nothing to recover: it signs in with Google (1.2).
    if (user && !user.passwordHash && user.googleSub) {
      throw new HttpError(409, 'This account signs in with Google.', 'USE_GOOGLE_SIGN_IN');
    }
    const challenge = await OTPService.issue(email, 'password_recovery');
    if (user) {
      try { await EmailService.sendOTP(email, challenge.code); }
      catch { await OTPService.cancel(challenge.challengeId); }
    }
    return { challengeId: challenge.challengeId, expiresIn: challenge.expiresIn };
  }

  static async completeRecovery(data: { email: string; challengeId: string; code: string; newPassword: string }) {
    const email = data.email.trim().toLowerCase();
    const verified = await OTPService.verify(email, 'password_recovery', data.challengeId, data.code);
    if (!verified.valid) throw new HttpError(400, verified.error || 'Recovery code is invalid', 'INVALID_OTP');
    const existing = await this.findAccountByEmail(email);
    if (!existing) throw new HttpError(400, 'Recovery request is invalid or expired', 'INVALID_RECOVERY');
    const passwordHash = await bcrypt.hash(data.newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data: { passwordHash, sessionVersion: { increment: 1 } } }),
      prisma.userSession.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'PASSWORD_RECOVERY' } }),
    ]);
    disconnectUserSockets(existing.id);
  }

  /**
   * Refuses sign-up for an email that already has an account, and says how
   * that account signs in, so the app can offer the right way in.
   */
  static async assertEmailFree(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email }, select: { googleSub: true, googleLinkedAt: true, createdAt: true } });
    if (!user) return;
    const madeWithGoogle = !!(user.googleSub && user.googleLinkedAt && Math.abs(user.googleLinkedAt.getTime() - user.createdAt.getTime()) < 60_000);
    throw new HttpError(409,
      madeWithGoogle ? 'This email already has an account. Sign in with Google.' : 'This email already has an account. Sign in instead.',
      'EMAIL_ALREADY_REGISTERED', { email, signIn: madeWithGoogle ? 'google' : 'password' });
  }

  static async register(data: any, androidId: string | null = null) {
    const email = data.email.trim().toLowerCase();
    // A banned person's email or phone can't sign up again (GOOGLE_SIGNUP_PLAN.md 6.1).
    await IdentityBanService.assertNotBanned({ emails: [email], androidId });
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new HttpError(409, 'Email already registered', 'EMAIL_ALREADY_REGISTERED');
    }

    const domain = email.split('@')[1];
    const matching = await prisma.institution.findMany({
      where: {
        isActive: true,
        allowedDomains: { has: domain },
        ...(data.institutionCode ? { code: data.institutionCode } : {}),
      },
    });
    if (!matching.length) {
      throw new HttpError(400, 'College email domain is not supported', 'INSTITUTION_NOT_SUPPORTED');
    }
    // A domain shared by several institutions (uem.edu.in: UEM Kolkata and
    // UEM Jaipur) cannot say which one this student attends. Rather than take
    // whichever the database returns first, create the account without a
    // membership: onboarding then routes to student verification, where the
    // student chooses and the campus is checked (LOCATION_SPEC.md 8.2).
    const institution = matching.length === 1 ? matching[0] : null;
    await OTPService.consumeProof(email, 'registration', data.verificationToken);
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const verifiedAt = new Date();
    const expiresAt = new Date(verifiedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
    let user;
    try { user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: data.name,
          passwordHash: hashedPassword,
          department: data.department,
          graduationYear: data.graduationYear,
          college: institution?.name ?? null,
          signupAndroidId: androidId,
          emailVerifiedAt: verifiedAt,
          isVerified: false,
          lastActiveAt: verifiedAt,
        },
      });
      await tx.userScore.create({ data: { userId: created.id } });
      if (institution) {
        await tx.studentMembership.create({
          data: {
            userId: created.id,
            institutionId: institution.id,
            institutionalEmail: email,
            status: 'verified',
            verifiedAt,
            expiresAt,
          },
        });
      }
      return created;
    }); } catch (error: any) {
      if (error?.code === 'P2002') throw new HttpError(409, 'Email already registered', 'EMAIL_ALREADY_REGISTERED');
      throw error;
    }

    // Strip password from returned object
    const { passwordHash, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  static async login(data: any) {
    const found = await this.findAccountByEmail(data.email);
    const user = found ? await liftExpiredSuspension(found) : null;
    if (!user || user.accountStatus === 'deleted') {
      throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }

    if (!user.passwordHash) {
      if (!['active', 'deletion_pending'].includes(user.accountStatus)) throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
      // A Google account without a password signs in with Google (1.2).
      throw new HttpError(401, 'This account signs in with Google.', user.googleSub ? 'USE_GOOGLE_SIGN_IN' : 'INVALID_CREDENTIALS');
    }

    const isValid = await bcrypt.compare(data.password, user.passwordHash);
    if (!isValid) {
      throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }
    // The right password, but the account can't sign in: say why, and how to appeal.
    if (!['active', 'deletion_pending'].includes(user.accountStatus)) {
      throw standingError(user) ?? new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const jti = randomUUID();
    const familyId = randomUUID();
    const { accessToken, refreshToken } = generateTokens(user.id, user.email ?? '', jti, user.role, user.sessionVersion);

    // Save session in DB for refresh token rotation handling
    await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenJti: jti,
        familyId,
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
        deviceInfo: data.deviceInfo || {}
      }
    });
    void SignInNoticeService.afterSignIn(user.id, familyId, data.deviceInfo);

    const { passwordHash, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      accessToken,
      refreshToken,
      onboarding: await OnboardingService.getStatus(user.id),
    };
  }

  static async refresh(refreshToken: string, deviceInfo?: unknown) {
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      throw new HttpError(401, 'Refresh token is invalid', 'INVALID_REFRESH_TOKEN');
    }
    const newJti = randomUUID();
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM user_sessions WHERE token_jti = ${decoded.jti} FOR UPDATE`;
      const session = await tx.userSession.findUnique({ where: { tokenJti: decoded.jti } });
      if (!session || session.userId !== decoded.sub) return { state: 'invalid' as const };
      if (session.revokedAt) {
        await tx.userSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: 'REUSE_DETECTED' },
        });
        await tx.user.update({
          where: { id: session.userId },
          data: { sessionVersion: { increment: 1 } },
        });
        return { state: 'reuse' as const, userId: session.userId };
      }
      const user = await tx.user.findUnique({ where: { id: session.userId } });
      if (
        !user ||
        !['active', 'deletion_pending'].includes(user.accountStatus) ||
        user.sessionVersion !== decoded.sv ||
        session.expiresAt <= new Date()
      ) return { state: 'invalid' as const };

      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
      await tx.userSession.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          revokeReason: 'ROTATED',
          replacedByJti: newJti,
          lastUsedAt: new Date(),
        },
      });
      await tx.userSession.create({
        data: {
          userId: user.id,
          tokenJti: newJti,
          familyId: session.familyId,
          expiresAt,
          deviceInfo: (deviceInfo ?? session.deviceInfo ?? {}) as any,
        },
      });
      return { state: 'ok' as const, user };
    });

    if (result.state === 'reuse') {
      disconnectUserSockets(result.userId);
      throw new HttpError(401, 'Refresh token reuse detected', 'SESSION_REVOKED');
    }
    if (result.state !== 'ok') {
      throw new HttpError(401, 'Refresh token is invalid', 'INVALID_REFRESH_TOKEN');
    }
    const tokens = generateTokens(
      result.user.id,
      result.user.email ?? '',
      newJti,
      result.user.role,
      result.user.sessionVersion,
    );
    const { passwordHash, ...user } = result.user;
    return { user, ...tokens, onboarding: await OnboardingService.getStatus(result.user.id) };
  }

  static async logout(userId: string, jti: string) {
    await prisma.userSession.updateMany({
      where: { userId, tokenJti: jti, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'LOGOUT' },
    });
  }

  static async logoutAll(userId: string) {
    await prisma.$transaction([
      prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'LOGOUT_ALL' },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      }),
    ]);
    disconnectUserSockets(userId);
  }

  /**
   * One row per signed-in device. A renewal replaces a session row, so the
   * device's sign-in time is the first row of its family, and "last active"
   * is when it last made a request (`touchSession`).
   */
  static async listSessions(userId: string, currentJti: string) {
    const sessions = await prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tokenJti: true, familyId: true, deviceInfo: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    const firsts = sessions.length
      ? await prisma.userSession.groupBy({
        by: ['familyId'],
        where: { familyId: { in: sessions.map((session) => session.familyId) } },
        _min: { createdAt: true },
      })
      : [];
    const signedInOf = new Map(firsts.map((row) => [row.familyId, row._min.createdAt]));
    return sessions.map(({ tokenJti, familyId, deviceInfo, ...session }) => {
      const info = (deviceInfo ?? {}) as Record<string, string | undefined>;
      const { ip, ...device } = info;
      return {
        ...session,
        deviceInfo: device,
        ip: maskIp(ip),
        signedInAt: (signedInOf.get(familyId) ?? session.createdAt).toISOString(),
        lastActiveAt: (session.lastUsedAt ?? session.createdAt).toISOString(),
        current: tokenJti === currentJti,
      };
    });
  }

  static async revokeSession(userId: string, sessionId: string, currentJti: string) {
    const session = await prisma.userSession.findFirst({ where: { id: sessionId, userId, revokedAt: null }, select: { id: true, tokenJti: true } });
    if (!session) throw new HttpError(404, 'Session is unavailable', 'SESSION_UNAVAILABLE');
    await prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: 'USER_REVOKED' } });
    // That device loses access on its next request; its live connection goes now.
    await disconnectSessionSockets(userId, [session.tokenJti]);
    return { id: session.id, current: session.tokenJti === currentJti };
  }

  /** Every device but this one. */
  static async revokeOtherSessions(userId: string, currentJti: string) {
    const others = await prisma.userSession.findMany({
      where: { userId, revokedAt: null, tokenJti: { not: currentJti } },
      select: { tokenJti: true },
    });
    if (!others.length) return { revoked: 0 };
    await prisma.userSession.updateMany({
      where: { userId, revokedAt: null, tokenJti: { in: others.map((row) => row.tokenJti) } },
      data: { revokedAt: new Date(), revokeReason: 'USER_REVOKED_OTHERS' },
    });
    await disconnectSessionSockets(userId, others.map((row) => row.tokenJti));
    return { revoked: others.length };
  }
}
