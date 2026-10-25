/**
 * The conversation currently on screen, if any.
 *
 * Telegram stays quiet about a chat you are already looking at: the message or
 * reaction is right there, so a banner on top of it is only noise. The push
 * handler asks this module rather than the navigator, because notifications can
 * arrive before navigation state is ready and must never throw.
 */
let activeMatchId: string | null = null;

export function setActiveChat(matchId: string | null): void {
  activeMatchId = matchId;
  // Native chat notifications ask the same question (MESSAGE_NOTIFICATIONS_PLAN.md 10).
  onActiveChatChange?.(matchId);
}

let onActiveChatChange: ((matchId: string | null) => void) | null = null;
/** Lets the notification code follow the open chat without this module importing it. */
export function watchActiveChat(listener: (matchId: string | null) => void): void {
  onActiveChatChange = listener;
}

export function getActiveChat(): string | null {
  return activeMatchId;
}
