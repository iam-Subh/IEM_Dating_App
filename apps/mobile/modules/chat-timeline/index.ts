import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Message } from '../../src/store/chatSlice';

type ChatTimelineNative = {
  upsert(accountId: string, matchId: string, messagesJson: string): Promise<void>;
  latest(accountId: string, matchId: string, limit: number): Promise<string>;
  deleteMessages(accountId: string, matchId: string, ids: string[]): Promise<void>;
  clearMatch(accountId: string, matchId: string): Promise<void>;
  clearAccount(accountId: string): Promise<void>;
};

const native: ChatTimelineNative | null = Platform.OS === 'android'
  ? requireOptionalNativeModule('ChatTimeline') as ChatTimelineNative | null
  : null;

export const hasNativeChatTimeline = native !== null;

// Keep writes ordered. A delete or logout must not race an earlier cache write.
let pendingWrite: Promise<void> = Promise.resolve();
function enqueueWrite(work: () => Promise<void>): Promise<void> {
  const result = pendingWrite.then(work);
  pendingWrite = result.catch(() => undefined);
  return result;
}

export async function saveNativeChatMessages(accountId: string, matchId: string, messages: Message[]) {
  if (!native || !accountId || !matchId || messages.length === 0) return;
  // The offline send queue owns temporary messages. Only confirmed IDs belong
  // in this index, or a server acknowledgement leaves two cached copies.
  const confirmed = messages.filter((message) => !message.id.startsWith('temp-'));
  if (confirmed.length === 0) return;
  const serialized = JSON.stringify(confirmed);
  await enqueueWrite(() => native.upsert(accountId, matchId, serialized));
}

export async function readNativeChatMessages(accountId: string, matchId: string, limit = 80): Promise<Message[]> {
  if (!native || !accountId || !matchId) return [];
  const raw = await native.latest(accountId, matchId, limit);
  return JSON.parse(raw) as Message[];
}

export async function deleteNativeChatMessages(accountId: string, matchId: string, ids: string[]) {
  if (native && accountId && matchId && ids.length) await enqueueWrite(() => native.deleteMessages(accountId, matchId, ids));
}

export async function clearNativeChatMatch(accountId: string, matchId: string) {
  if (native && accountId && matchId) await enqueueWrite(() => native.clearMatch(accountId, matchId));
}

export async function clearNativeChatAccount(accountId: string) {
  if (native && accountId) await enqueueWrite(() => native.clearAccount(accountId));
}
