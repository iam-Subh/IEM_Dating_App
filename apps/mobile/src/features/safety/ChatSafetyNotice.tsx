import React, { useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ReminderBanner } from '../verification/ReminderParts';
import { looksRisky } from './scamSignals';

/**
 * A once-per-chat warning when the other person sends a link, a number, a
 * payment app or talk of money (scamSignals.ts). Closed, it stays closed for
 * that chat.
 */
export function ChatSafetyNotice({ matchId, messages, currentUserId }: {
  matchId: string;
  messages: { senderId: string; content?: string | null; type?: string }[];
  currentUserId?: string | null;
}) {
  const navigation = useNavigation<any>();
  const risky = useMemo(() => messages.some((message) => message.senderId !== currentUserId && message.type !== 'service' && looksRisky(message.content)), [messages, currentUserId]);
  if (!risky) return null;
  return <ReminderBanner icon="shield-checkmark-outline" tone="warn" dismissKey={`chat-safety-${matchId}`} dismissDays={Infinity}
    text="Never send money, and be careful with links or moving to another app with someone you haven't met."
    action="Tips" onPress={() => navigation.navigate('Legal', { slug: 'safety' })} />;
}
