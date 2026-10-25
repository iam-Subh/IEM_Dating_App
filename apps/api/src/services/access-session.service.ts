import { prisma } from '../utils/prisma';
import { verifyAccessToken } from '../utils/jwt';

/**
 * The sign-in itself is not good: a bad or expired token, a revoked session,
 * an account that can't sign in. Anything else thrown while checking - the
 * database restarting, a dropped connection - is the server's problem, and
 * must not look like this (auth.middleware.ts answers it with a 503).
 */
export class AuthRejected extends Error {}

export class AccessSessionService {
  static async authenticate(token: string) {
    let decoded: ReturnType<typeof verifyAccessToken>;
    try { decoded = verifyAccessToken(token); }
    catch (error) { throw new AuthRejected((error as Error).message); }
    // Every request waits on this. Both reads need only the token, so they
    // share one round trip to the database instead of two.
    const [user, session] = await Promise.all([
      prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { id: true, email: true, role: true, accountStatus: true, sessionVersion: true },
      }),
      prisma.userSession.findFirst({
        where: {
          userId: decoded.sub,
          tokenJti: decoded.jti,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      }),
    ]);
    if (!user || !['active', 'deletion_pending'].includes(user.accountStatus) || user.sessionVersion !== decoded.sv) {
      throw new AuthRejected('Account or session is unavailable');
    }
    if (!session) {
      throw new AuthRejected('Session is revoked or expired');
    }
    return { ...decoded, sub: user.id, email: user.email ?? '', role: user.role };
  }

  /**
   * Re-authorize an already established connection.
   *
   * A socket outlives the 15 minute access token, so re-verifying the frozen
   * handshake token would disconnect every live connection on the user's next
   * event. The security property a long-lived connection needs is revocation,
   * not token expiry: account status, session version, and an unrevoked
   * session row still bound its lifetime.
   */
  static async authorizeEstablished(session: { sub: string; jti: string; sv: number }) {
    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { id: true, accountStatus: true, sessionVersion: true },
    });
    if (
      !user ||
      !['active', 'deletion_pending'].includes(user.accountStatus) ||
      user.sessionVersion !== session.sv
    ) {
      throw new AuthRejected('Account or session is unavailable');
    }
    const row = await prisma.userSession.findFirst({
      where: {
        userId: user.id,
        tokenJti: session.jti,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!row) {
      throw new AuthRejected('Session is revoked or expired');
    }
  }
}
