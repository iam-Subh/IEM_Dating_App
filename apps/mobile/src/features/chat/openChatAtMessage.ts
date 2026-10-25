type ChatTarget = {
  matchId: string;
  focusMessageId: string;
  userName?: string;
  userAvatar?: string | null;
  userId?: string;
};

type Navigation = {
  getState: () => { routes: Array<{ name: string; params?: object }> } | undefined;
  popTo: (name: string, params: object, options: { merge: boolean }) => void;
  navigate: (name: string, params: object) => void;
};

/**
 * Shows a message in its conversation, reusing the chat that is already open.
 *
 * In React Navigation 7 `navigate` no longer returns to a screen further down
 * the stack; it pushes a new one. Opening a photo from Shared media therefore
 * built a second chat screen on top of Chat, Chat info and Shared media: a full
 * mount, a fresh history load, and a back button that led to Shared media.
 * Telegram returns to the chat you came from and scrolls it, which is what
 * `popTo` does here when that chat is in the stack.
 */
export function openChatAtMessage(navigation: Navigation, target: ChatTarget): void {
  const { matchId, focusMessageId, ...rest } = target;
  // A fresh nonce makes jumping to the same message twice scroll again.
  const params = { matchId, focusMessageId, focusNonce: Date.now() };
  const routes = navigation.getState()?.routes ?? [];
  const open = routes.some((route) => route.name === 'ChatScreen'
    && (route.params as { matchId?: string } | undefined)?.matchId === matchId);
  if (open) navigation.popTo('ChatScreen', params, { merge: true });
  else navigation.navigate('ChatScreen', { ...rest, ...params });
}
