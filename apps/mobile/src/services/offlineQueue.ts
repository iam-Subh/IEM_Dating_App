import AsyncStorage from '@react-native-async-storage/async-storage';
import { Socket } from 'socket.io-client';
import { store } from '../store';
import { decideSendRetry } from './queue/sendRetryPolicy';

export interface QueuedMessage {
  tempId: string;           // Optimistic ID shown in UI
  realId?: string;          // Server-assigned ID (if received)
  matchId: string;
  content: string;
  mediaKeys: string[];
  queuedAt: number;
  status: 'pending' | 'sending' | 'failed' | 'sent';
  sequenceNum?: number;     // Track original send order (WhatsApp-style)
  type?: string;
  metadata?: Record<string, unknown>;
  replyToId?: string;
  /** Failed send count. Used to drop a message that can never be delivered. */
  attempts?: number;
}



let queueMutation: Promise<void> = Promise.resolve();
const serialize = <T>(work: () => Promise<T>): Promise<T> => {
  const result = queueMutation.then(work, work);
  queueMutation = result.then(() => undefined, () => undefined);
  return result;
};

const queueKey = () => {
  const userId = store.getState().auth.user?.id;
  return userId ? `@chat:offlineQueue:${userId}` : null;
};

export const addToOfflineQueue = async (message: QueuedMessage) => {
  const key = queueKey();
  return serialize(async () => {
  try {
    if (!key) return;
    const existing = await readQueue(key);
    const exists = existing.some(m => m.tempId === message.tempId);
    if (!exists) {
      await AsyncStorage.setItem(
        key,
        JSON.stringify([...existing, message])
      );
    }
  } catch (err) {
    console.error('[OfflineQueue] Failed to queue message:', err);
  }
  });
};

const readQueue = async (key: string | null): Promise<QueuedMessage[]> => {
  try {
    if (!key) return [];
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

export const getOfflineQueue = async (): Promise<QueuedMessage[]> => readQueue(queueKey());

const recordAttempt = async (tempId: string, key: string | null, attempts: number, failed = false) =>
  serialize(async () => {
    try {
      if (!key) return;
      const existing = await readQueue(key);
      await AsyncStorage.setItem(
        key,
        JSON.stringify(existing.map((m) => (m.tempId === tempId ? { ...m, attempts, ...(failed ? { status: 'failed' } : {}) } : m))),
      );
    } catch (err) {
      console.error('[OfflineQueue] Failed to record a send attempt:', err);
    }
  });

const removeFromAccountQueue = async (tempId: string, key: string | null) => serialize(async () => {
  try {
    if (!key) return;
    const existing = await readQueue(key);
    const filtered = existing.filter(m => m.tempId !== tempId);
    await AsyncStorage.setItem(key, JSON.stringify(filtered));
  } catch (err) {
    console.error('[OfflineQueue] Failed to remove from queue:', err);
  }
});

export const removeFromQueue = async (tempId: string) => removeFromAccountQueue(tempId, queueKey());

export const clearOfflineQueue = async () => {
  const key = queueKey();
  return serialize(async () => {
    if (!key) return;
    for (let attempt = 0; ; attempt++) {
      try { await AsyncStorage.removeItem(key); return; }
      catch (error) { if (attempt === 2) throw error; }
    }
  });
};

// Retry messages when connection restores.
// onMessageConfirmed fires IMMEDIATELY per-message (not batched) to prevent
// race condition with the server's new_message broadcast.
export const retryOfflineMessages = async (
  socket: Socket,
  matchId: string,
  onMessageConfirmed?: (queuedMsg: QueuedMessage, serverMessage: any) => void,
): Promise<QueuedMessage[]> => {
  const key = queueKey();
  const token = store.getState().auth.token;
  const isCurrentAccount = () => !!key && queueKey() === key && store.getState().auth.token === token;
  const queue = await readQueue(key);
  const matchQueue = queue.filter(m => m.matchId === matchId && m.status !== 'failed');

  if (matchQueue.length === 0 || !socket.connected || !isCurrentAccount()) return [];

  console.log('[OfflineQueue] Retrying queued messages');

  // CRITICAL: Sort by sequence number to preserve original send order
  matchQueue.sort((a, b) => {
    if (a.sequenceNum !== undefined && b.sequenceNum !== undefined) {
      return a.sequenceNum - b.sequenceNum;
    }
    return a.queuedAt - b.queuedAt;
  });

  const successfulSends: QueuedMessage[] = [];

  // Send sequentially in correct order
  for (const item of matchQueue) {
    if (!socket.connected || !isCurrentAccount()) break;
    let failureCode: string | null = null;
    try {
      await new Promise<void>((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          settled = true;
          console.log('[OfflineQueue] Send timed out');
          resolve();
        }, 15000);

        socket.emit('send_message', {
          matchId: item.matchId,
          content: item.content,
          mediaKeys: item.mediaKeys,
          clientMessageId: item.tempId,
          type: item.type,
          metadata: item.metadata,
          replyToId: item.replyToId,
        }, (response: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (!isCurrentAccount()) { resolve(); return; }
          if (response?.success) {
            successfulSends.push(item);
            // CRITICAL: Fire callback IMMEDIATELY so processedServerIdsRef is updated
            // BEFORE the new_message broadcast arrives (prevents race condition)
            if (onMessageConfirmed && response.message) {
              onMessageConfirmed(item, response.message);
            }
            console.log('[OfflineQueue] Queued message sent');
          } else {
            failureCode = typeof response?.code === 'string' ? response.code : 'REQUEST_FAILED';
            console.log('[OfflineQueue] Queued message failed');
          }
          resolve();
        });
      });
    } catch (err) {
      console.error('[OfflineQueue] Queued message retry failed');
    }
    // Keep later messages queued until this message has a server
    // acknowledgement, but never let one undeliverable message block the
    // conversation permanently.
    if (!successfulSends.includes(item)) {
      if (!isCurrentAccount()) break;
      const decision = decideSendRetry(item.attempts, failureCode);
      if (decision.action === 'drop') {
        await recordAttempt(item.tempId, key, (item.attempts ?? 0) + 1, true);
        continue;
      }
      await recordAttempt(item.tempId, key, decision.attempts);
      break;
    }
  }

  // Remove successfully sent messages from queue
  for (const item of successfulSends) {
    await removeFromAccountQueue(item.tempId, key);
  }

  return successfulSends;
};

// Listen for connection restore - don't auto-retry here
export const setupQueueRetry = (socket: Socket) => {
  socket.on('reconnect', async () => {
    console.log('[OfflineQueue] Connection restored, queue ready for retry');
  });
};

// Manual trigger for retry - called from ChatScreen
export const triggerQueueRetry = async (
  socket: Socket,
  matchId: string,
  onMessageConfirmed?: (queuedMsg: QueuedMessage, serverMessage: any) => void,
) => {
  const successfulSends = await retryOfflineMessages(socket, matchId, onMessageConfirmed);
  console.log('[OfflineQueue] Retry complete, sent ' + successfulSends.length + ' messages');
  return successfulSends;
};
