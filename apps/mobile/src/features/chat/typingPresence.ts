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

export const INCOMING_TYPING_TIMEOUT_MS = 6000;

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
