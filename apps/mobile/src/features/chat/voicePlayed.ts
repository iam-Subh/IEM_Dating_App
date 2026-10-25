import { api } from '../../services/api';
import { store } from '../../store';
import { markVoicePlayed } from '../../store/chatSlice';

/**
 * A voice message was listened to (MESSAGE_NOTIFICATIONS_PLAN.md 7): its
 * sender sees the blue microphone. Once per message; the server ignores repeats.
 */
const reported = new Set<string>();

export function reportVoicePlayed(matchId: string, messageId: string) {
  if (!matchId || !messageId || messageId.startsWith('temp-') || reported.has(messageId)) return;
  reported.add(messageId);
  store.dispatch(markVoicePlayed({ matchId, messageId, playedAt: new Date().toISOString() }));
  api.patch(`/chat/${matchId}/messages/${messageId}/played`).catch(() => reported.delete(messageId));
}
