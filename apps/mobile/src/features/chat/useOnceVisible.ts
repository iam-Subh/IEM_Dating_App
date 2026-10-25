import { useRef } from 'react';

/**
 * True from the first moment `visible` is true, and true forever after.
 *
 * The chat's panels - the attachment picker, the media workspace, the mute and
 * auto-delete sheets - were part of the screen from the first render, so
 * opening any conversation paid for building all of them before the chat could
 * appear, and paid again on every keystroke. None of them is on screen when a
 * chat opens. Built on first use, and kept afterwards so a second opening is
 * immediate, which is how a chat app affords panels this heavy.
 */
export function useOnceVisible(visible: boolean): boolean {
  const seen = useRef(false);
  if (visible) seen.current = true;
  return seen.current;
}
