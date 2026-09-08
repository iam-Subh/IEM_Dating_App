import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../utils/redis';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10,
  message: 'Too many authentication attempts, please try again later',
});

// Short burst protection per authenticated account. No daily product quota.
function burstLimit(kind: string, maximum: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = (req as any).user.sub;
      const count = Number(await redisClient.eval(`local n=redis.call('incr',KEYS[1]); if n==1 then redis.call('expire',KEYS[1],60) end return n`, 1, `discovery:rate:${kind}:${id}:${Math.floor(Date.now()/60000)}`));
      if (count > maximum) { res.setHeader('Retry-After','60'); res.status(429).json({ success:false, message:'Too many requests. Retry in one minute.' }); return; }
      next();
    } catch { res.status(503).json({ success:false, message:'Discovery is temporarily unavailable.' }); }
  };
}
export const swipeRateLimiter = burstLimit('swipe', 120);
export const visibilityRateLimiter = burstLimit('visible', 120);
export const discoveryRateLimiter = burstLimit('pages', 60);
export const followRateLimiter = burstLimit('follow', 20);
export const storyPublishRateLimiter = burstLimit('story-publish', 10);
