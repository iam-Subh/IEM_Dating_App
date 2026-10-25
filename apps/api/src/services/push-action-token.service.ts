import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { ApiResponse } from '../utils/ApiResponse';

/**
 * The push action token (apps/mobile/src/features/notifications/MESSAGE_NOTIFICATIONS_PLAN.md,
 * decisions): what the phone's native notification code uses for Reply, Mark
 * as read, Delivered, Played and voice links, with the app closed. The native
 * side can't read the app's encrypted login, so it gets this narrow one:
 *
 * - its own audience, so it never passes as a sign-in token anywhere else;
 * - tied to the login session it was issued under: logging out, or that
 *   session being revoked, ends it;
 * - tied to the phone's push registration and the account's session version.
 */

const ISSUER = process.env.JWT_ISSUER || 'iem-connect-api';
const AUDIENCE = 'iem-connect-push-action';
const LIFETIME = '60d';

function secret() {
  const value = process.env.JWT_ACCESS_SECRET;
  if (!value || value.length < 32) throw new Error('JWT_ACCESS_SECRET must be set');
  return value;
}

type Claims = { sub: string; fam: string; dev: string; sv: number; type: 'push_action' };

export class PushActionTokenService {
  /** For the phone that is signed in with session `jti` and registered push token `deviceToken`. */
  static async issue(userId: string, jti: string, deviceToken: string) {
    const [session, device, user] = await Promise.all([
      prisma.userSession.findUnique({ where: { tokenJti: jti }, select: { familyId: true, revokedAt: true, userId: true } }),
      prisma.deviceToken.findUnique({ where: { userId_token: { userId, token: deviceToken } }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } }),
    ]);
    if (!session || session.revokedAt || session.userId !== userId || !device || !user) return null;
    const claims: Claims = { sub: userId, fam: session.familyId, dev: device.id, sv: user.sessionVersion, type: 'push_action' };
    return jwt.sign(claims, secret(), { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, expiresIn: LIFETIME });
  }

  /** The person behind a push action token, if it is still valid. */
  static async verify(token: string): Promise<{ userId: string; deviceId: string } | null> {
    let claims: Claims;
    try {
      claims = jwt.verify(token, secret(), { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE }) as Claims;
    } catch {
      return null;
    }
    if (claims.type !== 'push_action' || !claims.sub || !claims.fam || !claims.dev) return null;
    const [user, device, session] = await Promise.all([
      prisma.user.findUnique({ where: { id: claims.sub }, select: { sessionVersion: true, accountStatus: true } }),
      prisma.deviceToken.findFirst({ where: { id: claims.dev, userId: claims.sub }, select: { id: true } }),
      prisma.userSession.findFirst({
        where: { userId: claims.sub, familyId: claims.fam, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      }),
    ]);
    if (!user || user.sessionVersion !== claims.sv || !['active', 'deletion_pending'].includes(user.accountStatus)) return null;
    if (!device || !session) return null;
    return { userId: claims.sub, deviceId: claims.dev };
  }
}

/** Express guard for the native routes: `Authorization: PushAction <token>`. */
export async function protectPushAction(req: Request, res: Response, next: NextFunction) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'PushAction' || !token) return res.status(401).json(ApiResponse.error('Not authorized'));
  const who = await PushActionTokenService.verify(token).catch(() => null);
  if (!who) return res.status(401).json(ApiResponse.error('Not authorized'));
  (req as any).user = { sub: who.userId, deviceId: who.deviceId };
  next();
}
