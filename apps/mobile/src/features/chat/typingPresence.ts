/**
 * Expiry tracker for incoming typing indicators.
 *
 * typing_stop is not guaranteed to arrive. The sender's socket can drop
 * mid-typing, which previously left "typing..." on screen indefinitely, so an
 * indicator expires on its own unless it is refreshed.
 *
 * Kept free of React and React Native imports so it can be unit tested with an
 * injected clock.
 */

// Telegram's typing status lasts 5 s unless the sender repeats it; ours is
// repeated every TYPING_REFRESH_MS, so 5 s only runs out when they stopped
// and the "stopped" signal was lost.
export const INCOMING_TYPING_TIMEOUT_MS = 5000;
/** A pause this long after the last keystroke is "stopped typing": short, so "typing…" leaves soon after they stop. */
export const TYPING_IDLE_MS = 1200;
/** How often the sender says "typing" again while typing goes on: well inside the expiry above. */
export const TYPING_REFRESH_MS = 3000;

/**
 * Whether this keystroke should send "typing". The first one does, then one
 * every TYPING_REFRESH_MS: a single signal per burst let a long message
 * expire on the other phone while it was still being written.
 */
export function shouldSendTyping(typing: boolean, lastSentAt: number, now: number) {
  return !typing || now - lastSentAt >= TYPING_REFRESH_MS;
}

type Timer = ReturnType<typeof setTimeout>;

export type TypingClock = {
  setTimeout: (handler: () => void, ms: number) => Timer;
  clearTimeout: (timer: Timer) => void;
};

const systemClock: TypingClock = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

export type TypingPresence = {
  /** A peer reported typing. Restarts the expiry window. */
  start: () => void;
  /** A peer reported stopping, or the indicator is no longer relevant. */
  stop: () => void;
  /** Releases the pending timer. Safe to call more than once. */
  dispose: () => void;
};

/**
 * @param onChange receives true when the indicator should show, false when it
 *   should hide. Only called when the visible state actually changes, so a
 *   repeated keystroke does not redispatch.
 */
export function createTypingPresence(
  onChange: (typing: boolean) => void,
  timeoutMs: number = INCOMING_TYPING_TIMEOUT_MS,
  clock: TypingClock = systemClock,
): TypingPresence {
  let timer: Timer | null = null;
  let visible = false;

  const clear = () => {
    if (timer !== null) {
      clock.clearTimeout(timer);
      timer = null;
    }
  };

  const setVisible = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    onChange(next);
  };

  return {
    start() {
      clear();
      setVisible(true);
      timer = clock.setTimeout(() => {
        timer = null;
        setVisible(false);
      }, timeoutMs);
    },
    stop() {
      clear();
      setVisible(false);
    },
    dispose() {
      clear();
      visible = false;
    },
  };
}
