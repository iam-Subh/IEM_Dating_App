/**
 * Retry policy for queued chat sends.
 *
 * A queued send stops on the first failure so message order is preserved.
 * Without a give-up rule an undeliverable message blocks every later message
 * in that conversation forever, so failures are counted and server codes that
 * can never succeed on retry are dropped immediately.
 *
 * Kept free of React Native imports so it can be unit tested directly.
 */

export const MAX_SEND_ATTEMPTS = 5;

/** Server codes where retrying the identical command can never succeed. */
export const TERMINAL_SEND_CODES: ReadonlySet<string> = new Set([
  'MATCH_UNAVAILABLE',
  'PROFILE_UNAVAILABLE',
  'IDEMPOTENCY_MISMATCH',
  'MESSAGE_UNAVAILABLE',
  'INVALID_MEDIA_TICKET',
  'MEDIA_REJECTED',
]);

export type SendRetryDecision =
  | { action: 'drop'; reason: 'terminal' | 'exhausted' }
  | { action: 'retry'; attempts: number };

/**
 * @param previousAttempts failures already recorded for this message
 * @param failureCode server error code, or null when the send timed out
 */
export function decideSendRetry(
  previousAttempts: number | undefined,
  failureCode: string | null,
): SendRetryDecision {
  const attempts = Math.max(0, previousAttempts ?? 0) + 1;
  if (failureCode !== null && TERMINAL_SEND_CODES.has(failureCode)) {
    return { action: 'drop', reason: 'terminal' };
  }
  if (attempts >= MAX_SEND_ATTEMPTS) {
    return { action: 'drop', reason: 'exhausted' };
  }
  return { action: 'retry', attempts };
}
