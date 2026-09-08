import { prisma } from '../utils/prisma';
import { verifyAccessToken } from '../utils/jwt';

export class AccessSessionService {
  static async authenticate(token: string) {
    const decoded = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, role: true, accountStatus: true, sessionVersion: true },
    });
    if (!user || !['active', 'deletion_pending'].includes(user.accountStatus) || user.sessionVersion !== decoded.sv) {
      throw new Error('Account or session is unavailable');
    }
    const session = await prisma.userSession.findFirst({
      where: {
        userId: user.id,
        tokenJti: decoded.jti,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!session) {
      throw new Error('Session is revoked or expired');
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
      throw new Error('Account or session is unavailable');
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
      throw new Error('Session is revoked or expired');
    }
  }
}
