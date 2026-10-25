import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { AccessSessionService, AuthRejected } from '../services/access-session.service';
import { touchSession } from '../services/session-device.service';

/**
 * Debounced update of user's lastActiveAt.
 * Only writes to DB if last update was >5 minutes ago (tracked via Redis).
 */
async function updateLastActive(userId: string): Promise<void> {
  try {
    const cacheKey = `lastActive:${userId}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) return; // Updated recently — skip

    // Set Redis TTL of 5 minutes to debounce
    await redisClient.setex(cacheKey, 300, '1');

    // Update DB in background (don't await — fire-and-forget)
    prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date() },
    }).catch(() => {}); // Silently ignore errors
    // The hour they use the app, for timed pushes (NOTIFICATIONS_PLAN.md 5).
    // Lazily: the push services import much of the app.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PushEngagementService } = require('../services/push-engagement.service') as typeof import('../services/push-engagement.service');
    PushEngagementService.touch(userId).catch(() => {});
  } catch {
    // Redis not connected — skip tracking
  }
}

export const protect = async (req: Request, res: Response, next: NextFunction) => {
  let authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json(ApiResponse.error('Not authorized, no token provided'));
  }

  // If multiple Authorization headers are sent, they are comma-separated. Take the first one.
  if (authHeader.includes(',')) {
    authHeader = authHeader.split(',')[0].trim();
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token || token === 'undefined' || token === 'null') {
    return res.status(401).json(ApiResponse.error('Not authorized, token is invalid'));
  }

  try {
    const decoded = await AccessSessionService.authenticate(token);
    (req as any).user = decoded;

    // Track activity (async, non-blocking): the account, and this device's session.
    updateLastActive(decoded.sub);
    if (decoded.jti) touchSession(decoded.jti, req);

    next();
  } catch (error) {
    if (error instanceof AuthRejected) {
      return res.status(401).json(ApiResponse.error('Not authorized, token validation failed'));
    }
    // The server could not check the sign-in (the database restarting, a
    // dropped connection). A 401 here made the app renew its session for
    // nothing - in a loop - and could even sign people out.
    console.warn(`[AUTH] Sign-in check failed on the server: ${(error as Error).message}`);
    return res.status(503).json({ success: false, message: 'The server is busy. Try again in a moment.', code: 'AUTH_CHECK_UNAVAILABLE' });
  }
};
