import type { Message } from '../../store/chatSlice';

export type ChatRow = Message | { _kind: 'date'; date: string };

/** Inverted lists place the following date row above the day's oldest message. */
export function buildChatRows(messages: Message[]): ChatRow[] {
  const visible = messages.filter(message => message.type === 'service'
    || Boolean(message.content || message.mediaKeys?.length || message.mediaKey));
  const rows: ChatRow[] = [];
  for (let index = 0; index < visible.length; index += 1) {
    const message = visible[index];
    rows.push(message);
    const older = visible[index + 1];
    if (!older || new Date(message.sentAt).toDateString() !== new Date(older.sentAt).toDateString()) {
      rows.push({ _kind: 'date', date: message.sentAt });
    }
  }
  return rows;
}

/**
 * Distances from the two ends of the conversation.
 *
 * The list is inverted, so scroll offset zero is the newest message and the
 * offset grows as you move back through history.
 */
export function chatScrollDistances(offset: number, contentHeight: number, viewportHeight: number) {
  return {
    fromBottom: Math.max(0, offset),
    fromTop: Math.max(0, contentHeight - viewportHeight - offset),
  };
}

/**
 * The messages a list's viewability change reports, for read receipts. Each
 * row wraps its message (`{kind: 'message', message}`); date and service rows
 * are skipped. Reading `row.id` here instead once left every chat unread.
 */
export function visibleMessageIds(viewableItems: { item: { kind: string; message?: { id: string } } }[]): string[] {
  return viewableItems.flatMap(({ item }) => (item.kind === 'message' && item.message ? [item.message.id] : []));
}

type Receivable = { id: string; senderId: string; sentAt: string; messageSeq?: number | null; readAt?: string | null; type?: string };

/**
 * What seeing these messages reads, as in Telegram and WhatsApp: the newest
 * one seen and everything of theirs before it. A message the list never
 * counted as seen - the first one under the header, a tall video bubble -
 * is still read once a later one is.
 */
export function unreadThroughSeen(messages: Receivable[], seenIds: string[], me: string | null | undefined): string[] {
  const order = (message: Receivable) => message.messageSeq ?? Date.parse(message.sentAt);
  const seen = new Set(seenIds);
  let newest = -Infinity;
  for (const message of messages) {
    if (seen.has(message.id) && message.senderId !== me) newest = Math.max(newest, order(message));
  }
  if (newest === -Infinity) return [];
  return messages
    .filter((message) => message.senderId !== me && !message.readAt && message.type !== 'service' && order(message) <= newest)
    .map((message) => message.id);
}
