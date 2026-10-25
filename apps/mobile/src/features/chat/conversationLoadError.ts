export type ConversationLoadError = { title: string; message: string };

/** Connection failures belong in the list UI. Canceled reads need no message. */
export function conversationLoadError(error: unknown): ConversationLoadError | null {
  const failure = error as { code?: string; isAxiosError?: boolean; response?: { status?: number } } | null;
  if (failure?.code === 'ERR_CANCELED') return null;
  if (failure?.code === 'ECONNABORTED' || failure?.code === 'ETIMEDOUT') {
    return { title: 'Connection timed out', message: 'The server took too long to respond. Try again.' };
  }
  if (failure?.code === 'ERR_NETWORK' || (failure?.isAxiosError && !failure.response)) {
    return { title: 'Cannot connect', message: 'Check your connection and try again.' };
  }
  if (failure?.response?.status === 401 || failure?.response?.status === 403) {
    return { title: 'Cannot load chats', message: 'Your session could not load chats. Try again.' };
  }
  return { title: 'Cannot load chats', message: 'Chats could not be loaded. Try again.' };
}
