import { useEffect, useRef } from 'react';

type Handler = () => boolean;
type Entry = { ref: { current: Handler } };

const stack: Entry[] = [];

/**
 * Registers what the back button does in the story creator. The most recently
 * opened piece (a tool, a sticker creator, the gallery) handles it first, as
 * each screen of Instagram's creator closes on back before the one under it.
 *
 * One stack rather than BackHandler listeners, because the creator also runs
 * inside a React Native Modal, whose back press never reaches BackHandler.
 */
export function useStoryBack(handler: Handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const entry: Entry = { ref };
    stack.push(entry);
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [enabled]);
}

/** Runs handlers from the top until one handles the press. False when none did. */
export function dispatchStoryBack(): boolean {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].ref.current()) return true;
  }
  return false;
}
