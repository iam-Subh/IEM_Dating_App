import type { Message } from '../../store/chatSlice';
import { messagePreviewBody } from './conversationPreview';

export type MarkKind = 'pin' | 'star';
export type MarkedMessage = Message & { markedAt: string };
export const chatMarksKey = (userId: string | undefined, matchId: string, kind?: MarkKind) =>
  kind ? ['chat-marks', userId, matchId, kind] : ['chat-marks', userId, matchId];

export function markedMessagePreview(message: Message) {
  return messagePreviewBody({ ...message, readAt: message.readAt ?? null, isRead: false });
}

export function visibleMarkedMessages(messages: MarkedMessage[], now = Date.now()) {
  return messages.filter(message => !message.expiresAt || Date.parse(message.expiresAt) > now);
}

export function filterMarkedMessages(messages: MarkedMessage[], search: string, userId?: string, peerName = '') {
  const query = search.trim().toLocaleLowerCase();
  return query ? messages.filter(message => `${message.senderId === userId ? 'You' : peerName} ${markedMessagePreview(message).text}`.toLocaleLowerCase().includes(query)) : messages;
}
