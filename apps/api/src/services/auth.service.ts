import { prisma } from '../utils/prisma';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { generateTokens } from '../utils/jwt';
import { OnboardingService } from './onboarding.service';
import { verifyRefreshToken } from '../utils/jwt';
import { HttpError } from '../utils/httpError';
import { disconnectUserSockets } from '../socket';
import { OTPService } from './otp.service';
import { EmailService } from './email.service';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;


export class AuthService {
  static async startRecovery(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const challenge = await OTPService.issue(email, 'password_recovery');
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
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
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!existing) throw new HttpError(400, 'Recovery request is invalid or expired', 'INVALID_RECOVERY');
    const passwordHash = await bcrypt.hash(data.newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data: { passwordHash, sessionVersion: { increment: 1 } } }),
      prisma.userSession.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'PASSWORD_RECOVERY' } }),
    ]);
    disconnectUserSockets(existing.id);
  }

  static async register(data: any) {
    const email = data.email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new HttpError(409, 'Email already registered', 'EMAIL_ALREADY_REGISTERED');
    }

    const domain = email.split('@')[1];
    const institution = await prisma.institution.findFirst({
      where: {
        isActive: true,
        allowedDomains: { has: domain },
        ...(data.institutionCode ? { code: data.institutionCode } : {}),
      },
    });
    if (!institution) {
      throw new HttpError(400, 'College email domain is not supported', 'INSTITUTION_NOT_SUPPORTED');
    }
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
          college: institution.name,
          emailVerifiedAt: verifiedAt,
          isVerified: false,
          lastActiveAt: verifiedAt,
        },
      });
      await tx.userScore.create({ data: { userId: created.id } });
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
    const email = data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !['active', 'deletion_pending'].includes(user.accountStatus)) {
      throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }

    if (!user.passwordHash) {
      // User registered via Phone OTP and hasn't set up an email password yet
      throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const isValid = await bcrypt.compare(data.password, user.passwordHash);
    if (!isValid) {
      throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
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

    const { passwordHash, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      accessToken,
      refreshToken,
      onboarding: await OnboardingService.getStatus(user.id),
    };
  }

  static async findOrCreateByPhone(phone: string) {
    let user;
    try {
      user = await prisma.user.findUnique({ where: { phone } });
    } catch (e) {
      throw e;
    }

    if (!user) {
      try {
        // Auto-create user with phone — they can add email/details later
        user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              phone,
              name: `User_${phone.slice(-4)}`,
              passwordHash: '',
              lastActiveAt: new Date(),
              phoneVerifiedAt: new Date(),
              isVerified: false,
            },
          });
          await tx.userScore.create({ data: { userId: created.id } });
          return created;
        });
      } catch (e) {
        throw e;
      }
    } else {
      if (!['active', 'deletion_pending'].includes(user.accountStatus)) throw new HttpError(403, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
      if (!user.phoneVerifiedAt) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { phoneVerifiedAt: new Date() },
        });
      }
    }

    const jti = randomUUID();
    const familyId = randomUUID();
    
    let tokens;
    try {
      tokens = generateTokens(user.id, user.email || user.phone || '', jti, user.role, user.sessionVersion);
    } catch (e) {
      throw e;
    }

    try {
      await prisma.userSession.create({
        data: {
          userId: user.id,
          tokenJti: jti,
          familyId,
          expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
          deviceInfo: {},
        },
      });
    } catch (e) {
      throw e;
    }

    const { passwordHash, ...userWithoutPassword } = user;
    return {
      user: userWithoutPassword,
      ...tokens,
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
      result.user.email || result.user.phone || '',
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

  static async listSessions(userId: string, currentJti: string) {
    const sessions = await prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tokenJti: true, deviceInfo: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    return sessions.map(({ tokenJti, ...session }) => ({ ...session, current: tokenJti === currentJti }));
  }

  static async revokeSession(userId: string, sessionId: string, currentJti: string) {
    const session = await prisma.userSession.findFirst({ where: { id: sessionId, userId, revokedAt: null }, select: { id: true, tokenJti: true } });
    if (!session) throw new HttpError(404, 'Session is unavailable', 'SESSION_UNAVAILABLE');
    await prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokeReason: 'USER_REVOKED' } });
    if (session.tokenJti === currentJti) disconnectUserSockets(userId);
    return { id: session.id, current: session.tokenJti === currentJti };
  }
}
