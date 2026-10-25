/**
 * Layout constants shared between the chat screen and the overlays that have to
 * position themselves against it.
 *
 * Kept in its own module so the context menu can respect the header without
 * importing ChatScreen, which would be a cycle: ChatScreen -> MessageBubble ->
 * MessageContextMenu -> ChatScreen.
 */

/**
 * Height of the chat header measured from the bottom of the status bar.
 *
 * The header sits at `paddingTop: insets.top`, so the first pixel below it is
 * `insets.top + CHAT_HEADER_HEIGHT`. Anything that floats over the conversation
 * must stay below that line rather than merely below the status bar.
 */
export const CHAT_HEADER_HEIGHT = 56;

/** Minimum height of the visible composer above the bottom safe area. */
export const CHAT_COMPOSER_MIN_HEIGHT = 54;

/**
 * Horizontal padding on the message list's content container.
 *
 * The selection highlight cancels this with a negative margin so the band runs
 * edge to edge, so the two have to stay in step.
 */
export const MESSAGE_LIST_PADDING_H = 7;

export const CHAT_INTRO_COMPOSER_GAP = 12;

/** Keep the empty-chat scroll area between the header and the measured composer. */
export function matchIntroViewportInsets(composerHeight: number, panelHeight: number, keyboardHeight: number, bottomInset: number) {
  'worklet';
  const progress = Math.min(1, Math.max(0, panelHeight / Math.max(1, keyboardHeight)));
  const navigationShift = (Math.max(bottomInset, 6) - 4) * progress;
  return {
    top: Math.max(0, panelHeight - navigationShift),
    bottom: Math.max(0, composerHeight) + CHAT_INTRO_COMPOSER_GAP,
  };
}
