import jwt from 'jsonwebtoken';

const ISSUER = process.env.JWT_ISSUER || 'iem-connect-api';
/** A different audience from access tokens, so neither can stand in for the other. */
const AUDIENCE = 'iem-connect-story-worker';
export const STORY_PUBLISH_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export type StoryPublishClaims = { sub: string; bid: string; sv: number };

function secret(): string {
  const value = process.env.JWT_ACCESS_SECRET;
  if (!value || value.length < 32) throw new Error('JWT_ACCESS_SECRET must be configured');
  return value;
}

/**
 * A token that can only upload and publish the items of one Story batch.
 *
 * The device's background worker holds it instead of the user's session: the
 * app's refresh tokens rotate on use, and a worker refreshing them would race
 * the app and could sign the user out.
 */
export function signStoryPublishToken(claims: StoryPublishClaims): string {
  return jwt.sign({ ...claims, type: 'story_batch' }, secret(), {
    algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, expiresIn: STORY_PUBLISH_TOKEN_TTL_SECONDS,
  });
}

export function verifyStoryPublishToken(token: string): StoryPublishClaims {
  const decoded = jwt.verify(token, secret(), { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
  if (
    typeof decoded === 'string' || decoded.type !== 'story_batch'
    || typeof decoded.sub !== 'string' || typeof decoded.bid !== 'string' || typeof decoded.sv !== 'number'
  ) {
    throw new Error('Invalid story publish token claims');
  }
  return { sub: decoded.sub, bid: decoded.bid, sv: decoded.sv };
}
