import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../utils/redis';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10,
  // Only failures count: a guess is what this stops, not a working sign-in or
  // the app's own token refreshes, which used to use the allowance up.
  skipSuccessfulRequests: true,
  message: 'Too many authentication attempts, please try again later',
});

/**
 * Change password: wrong current passwords, per account - 5 in 15 minutes.
 * Runs after `protect`, so the account is known.
 */
export const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => `password-change:${(req as any).user?.sub ?? 'unknown'}`,
  message: { success: false, message: 'Too many wrong passwords. Wait 15 minutes and try again.', code: 'TOO_MANY_ATTEMPTS' },
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
/** Location writes (LOCATION_SPEC.md 6.4): a real phone sends one on open, not a stream. */
export const locationRateLimiter = burstLimit('location', 6);
export const storyPublishRateLimiter = burstLimit('story-publish', 10);
/** Close Friends and Hide story from changes, and the people search: stops scripted list probing. */
export const storyAudienceRateLimiter = burstLimit('story-audience', 120);
/** Insight event batches: one every few seconds per viewer at most (section 7.5). */
export const storyInsightRateLimiter = burstLimit('story-insight', 60);
/** People search (SEARCH_SPEC.md 8.3): typing is fast; scraping is faster. */
export const searchRateLimiter = burstLimit('search', 30);
