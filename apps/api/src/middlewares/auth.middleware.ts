import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { AccessSessionService } from '../services/access-session.service';

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

    // Track activity (async, non-blocking)
    updateLastActive(decoded.sub);

    next();
  } catch (error) {
    return res.status(401).json(ApiResponse.error('Not authorized, token validation failed'));
  }
};
