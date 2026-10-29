/** A retry keeps its message ID because the server might already have saved it. */
export function createMatchMessageSender(send: (content: string, clientMessageId: string) => Promise<unknown>) {
  let attempt: { content: string; id: string } | null = null;
  let pending: Promise<void> | null = null;
  return (text: string): Promise<void> => {
    if (pending) return pending;
    const content = text.trim();
    if (!content || content.length > 2000) return Promise.reject(new Error('Enter a message of 1 to 2000 characters.'));
    if (attempt?.content !== content) attempt = { content, id: `match-${Date.now()}-${Math.random().toString(36).slice(2, 12)}` };
    const id = attempt.id;
    pending = Promise.resolve().then(() => send(content, id)).then(() => undefined).finally(() => { pending = null; });
    return pending;
  };
}
