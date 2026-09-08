/**
 * Ordering and merge rules for the local message projection.
 *
 * The store keeps each conversation newest-first for an inverted list. Events
 * do not always arrive newest-first: reconnect replay, out-of-order delivery
 * and HTTP fallback can all deliver an older message after a newer one, so
 * position has to be derived rather than assumed.
 *
 * Kept free of React and Redux imports so it can be unit tested directly.
 */

export type OrderableMessage = {
  id: string;
  senderId: string;
  content: string;
  sentAt: string;
  clientMessageId?: string | null;
  messageSeq?: number | null;
};

/**
 * Sort key, descending. A message the server has sequenced uses that sequence.
 * An unsent optimistic message has no sequence yet and belongs at the newest
 * end, which is where the sender expects to see it.
 */
function rank(message: OrderableMessage): number {
  if (typeof message.messageSeq === 'number') return message.messageSeq;
  return Number.MAX_SAFE_INTEGER;
}

function sentAtMs(message: OrderableMessage): number {
  const parsed = Date.parse(message.sentAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** True when `candidate` belongs later in the conversation than `current`. */
export function isNewerMessage(candidate: OrderableMessage, current: OrderableMessage): boolean {
  // Older snapshots may omit sequence numbers. Compare dates in that case.
  if ((!candidate.id.startsWith('temp-') && candidate.messageSeq == null) ||
      (!current.id.startsWith('temp-') && current.messageSeq == null)) {
    return sentAtMs(candidate) > sentAtMs(current);
  }
  const candidateRank = rank(candidate);
  const currentRank = rank(current);
  if (candidateRank !== currentRank) return candidateRank > currentRank;
  return sentAtMs(candidate) > sentAtMs(current);
}

/**
 * Inserts into a newest-first list at its ordered position.
 *
 * Previously every arrival was unshifted to index 0, so a replayed older
 * message appeared as the newest in the conversation.
 */
export function insertMessageOrdered<T extends OrderableMessage>(list: T[], message: T): T[] {
  if (list.some((item) => item.id === message.id)) return list;
  const index = list.findIndex((item) => isNewerMessage(message, item));
  if (index === -1) return [...list, message];
  return [...list.slice(0, index), message, ...list.slice(index)];
}

/**
 * Optimistic messages still waiting for their server acknowledgement.
 *
 * Matching is by client message id. Matching on content silently dropped a
 * genuine second copy of the same text, which is why the same message sent
 * twice could vanish from the conversation.
 */
export function pendingLocalMessages<T extends OrderableMessage>(
  existing: T[],
  serverMessages: OrderableMessage[],
  isPending: (message: T) => boolean = (message) => message.id.startsWith('temp-'),
): T[] {
  const confirmed = new Set(
    serverMessages
      .map((message) => message.clientMessageId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const serverIds = new Set(serverMessages.map((message) => message.id));
  return existing.filter((message) => {
    if (!isPending(message)) return false;
    if (serverIds.has(message.id)) return false;
    const key = message.clientMessageId ?? message.id;
    return !confirmed.has(key);
  });
}
