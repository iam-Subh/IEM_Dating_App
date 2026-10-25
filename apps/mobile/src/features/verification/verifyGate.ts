import type { VerifyReason } from './VerifyRulesScreen';
import { navigationRef } from '../../navigation/navigationRef';

/**
 * Server refusals that wait for a college verification
 * (features/auth/GOOGLE_SIGNUP_PLAN.md 7.4), and the rules-screen reason for
 * each. Anything else is an ordinary error.
 */
const REASON_BY_CODE: Record<string, VerifyReason> = {
  VERIFY_TO_CHAT: 'chat',
  VERIFY_TO_SEND_MEDIA: 'media',
  ROSE_VERIFY_REQUIRED: 'rose',
  LIKE_LIMIT_UNVERIFIED: 'likes',
  PROFILE_PAUSED: 'paused',
  FOLLOW_LIMIT_UNVERIFIED: 'follows',
  MENTION_VERIFY_REQUIRED: 'mention',
  SEARCH_LIMIT_UNVERIFIED: 'search',
};

export function verifyReasonOf(error: unknown): VerifyReason | null {
  const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
  return code ? REASON_BY_CODE[code] ?? null : null;
}

let lastOpenedAt = 0;

/**
 * Opens the rules screen for one of those refusals. Every API refusal comes
 * through here once (services/api.ts), whichever screen made the request -
 * the deck, Explore, Likes You, the map, a chat - so screens only need
 * `verifyReasonOf` to skip their own error message.
 */
export function showVerifyRules(error: unknown) {
  const reason = verifyReasonOf(error);
  if (!reason || !navigationRef.isReady()) return false;
  const now = Date.now();
  if (now - lastOpenedAt < 1500 || navigationRef.getCurrentRoute()?.name === 'VerifyRules') return true;
  lastOpenedAt = now;
  navigationRef.navigate('VerifyRules', { reason });
  return true;
}

/** For a screen's catch: true when the refusal is one the rules screen already answered. */
export function openVerifyRules(_navigation: unknown, error: unknown) {
  return showVerifyRules(error);
}
