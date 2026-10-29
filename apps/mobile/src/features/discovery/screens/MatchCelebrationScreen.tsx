import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard } from 'react-native';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { api } from '../../../services/api';
import { MatchContent } from '../components/MatchSheet';
import { createMatchMessageSender } from '../matchMessage';
import { recordGoodMoment } from '../../feedback/engagement';
import { looksHurtful } from '../../safety/hurtfulLanguage';
import type { MatchIntroData } from '../../chat/components/MatchIntro';

export type MatchCelebrationParams = {
  name: string; userId?: string; photo?: string | null; matchId?: string; demo?: boolean; roseTrial?: boolean;
};

export function MatchCelebrationScreen({ route, navigation }: any) {
  const match = route.params as MatchCelebrationParams;
  const ownPhoto = useSelector((state: RootState) => {
    const user = state.auth.user;
    const firstPhoto = user?.photos?.[0]?.photoUrl ?? user?.photos?.[0];
    const photo = typeof firstPhoto === 'string' ? firstPhoto : user?.avatarUrl ?? user?.avatar;
    return typeof photo === 'string' ? photo : null;
  });
  const [intro, setIntro] = useState<MatchIntroData | null>(null);
  useEffect(() => {
    setIntro(null);
    if (match.demo || !match.matchId) return;
    void recordGoodMoment();
    let active = true;
    api.get(`/match/${match.matchId}/intro`).then(response => { if (active) setIntro(response.data.data); }).catch(() => undefined);
    return () => { active = false; };
  }, [match.demo, match.matchId]);
  const chat = () => {
    Keyboard.dismiss();
    if (match.demo || !match.matchId) {
      Alert.alert('Demo match', 'A real match opens your conversation here.');
      return;
    }
    navigation.replace('ChatScreen', { matchId: match.matchId, userId: match.userId, userName: match.name, userAvatar: intro ? intro.other.avatar : match.photo });
  };
  const sender = useMemo(() => createMatchMessageSender(async (content, clientMessageId) => {
    if (match.demo || !match.matchId) throw new Error('This preview does not send messages.');
    await api.post(`/chat/${match.matchId}/messages`, { content, clientMessageId, type: 'text' });
  }), [match.demo, match.matchId]);
  const send = async (content: string) => {
    if (match.demo || !match.matchId) { Alert.alert('Demo message', content); return; }
    if (looksHurtful(content)) {
      const confirmed = await new Promise<boolean>(resolve => Alert.alert('Are you sure?', 'This message might come across as hurtful.', [
        { text: 'Edit', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Send anyway', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) }));
      if (!confirmed) return;
    }
    await sender(content);
    chat();
  };
  return <MatchContent match={{ name: match.name, ownPhoto: intro?.self ? intro.self.avatar : ownPhoto, photo: intro ? intro.other.avatar : match.photo, sharedInterest: intro?.sharedInterests[0] }}
    onClose={() => { Keyboard.dismiss(); if (match.roseTrial) navigation.replace('VerifyRules', {reason: 'roseSent'}); else navigation.goBack(); }} onOpenChat={chat} onSend={send}/>;
}
