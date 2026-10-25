import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../../store';
import type { SelectedChatMedia } from './components/attachmentTypes';

export interface ChatDraft {
  text: string;
  replyToId?: string;
  media: SelectedChatMedia[];
  updatedAt: number;
}

const listeners = new Set<() => void>();
export function subscribeChatDrafts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notifyDrafts() { listeners.forEach(listener => listener()); }

function draftKey(matchId: string): string | null {
  const userId = store.getState().auth.user?.id;
  return userId ? `@chat:draft:${userId}:${matchId}` : null;
}

export async function loadChatDraft(matchId: string): Promise<ChatDraft | null> {
  const key = draftKey(matchId);
  if (!key) return null;
  try {
    const value = await AsyncStorage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<ChatDraft>;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      replyToId: typeof parsed.replyToId === 'string' ? parsed.replyToId : undefined,
      media: Array.isArray(parsed.media) ? parsed.media : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function saveChatDraft(matchId: string, draft: Omit<ChatDraft, 'updatedAt'>): Promise<void> {
  const key = draftKey(matchId);
  if (!key) return;
  if (!draft.text.trim() && !draft.replyToId && draft.media.length === 0) {
    await AsyncStorage.removeItem(key);
    notifyDrafts();
    return;
  }
  await AsyncStorage.setItem(key, JSON.stringify({ ...draft, updatedAt: Date.now() }));
  notifyDrafts();
}

export async function clearChatDraft(matchId: string): Promise<void> {
  const key = draftKey(matchId);
  if (key) { await AsyncStorage.removeItem(key); notifyDrafts(); }
}
