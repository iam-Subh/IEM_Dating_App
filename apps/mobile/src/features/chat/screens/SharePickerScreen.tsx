import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../services/api';
import { SettingsPage, settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import type { SharedContent } from '../../../../modules/chat-notify';

/**
 * "Share to…" (MESSAGE_NOTIFICATIONS_PLAN.md 12): something was shared to
 * IEM Connect from another app, not to a particular chat. Pick the chat; it
 * opens with the text or picture in the composer, ready to send.
 */
type Chat = { matchId: string; user?: { id?: string; name?: string; avatar?: string | null; avatarUrl?: string | null } };

export function SharePickerScreen() {
  const navigation = useNavigation<any>();
  const share = (useRoute().params as { share?: SharedContent } | undefined)?.share ?? {};
  const [chats, setChats] = useState<Chat[] | null>(null);

  useEffect(() => {
    api.get('/chat/conversations')
      .then((response) => {
        const data = response.data.data;
        setChats(Array.isArray(data) ? data : data?.items ?? []);
      })
      .catch(() => setChats([]));
  }, []);

  const open = (chat: Chat) => navigation.replace('ChatScreen', {
    matchId: chat.matchId,
    userId: chat.user?.id,
    userName: chat.user?.name,
    userAvatar: chat.user?.avatar ?? chat.user?.avatarUrl ?? null,
    sharedText: share.text ?? null,
    sharedFile: share.file ?? null,
    sharedMimeType: share.mimeType ?? null,
  });

  return <SettingsPage title="Share to…">
    {share.file || share.text ? <View style={styles.preview}>
      {share.file ? <Image source={{ uri: `file://${share.file}` }} style={styles.thumb} /> : <Ionicons name="document-text-outline" size={22} color={palette.secondary} />}
      <Text style={styles.previewText} numberOfLines={2}>{share.text || 'Photo'}</Text>
    </View> : null}
    {!chats ? <ActivityIndicator style={{ marginTop: 40 }} color={palette.accent} /> : <FlatList
      data={chats}
      keyExtractor={(chat) => chat.matchId}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      ListEmptyComponent={<Text style={styles.empty}>No chats yet - match with someone first.</Text>}
      renderItem={({ item }) => {
        const avatar = item.user?.avatar ?? item.user?.avatarUrl;
        return <Pressable onPress={() => open(item)} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
          {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarEmpty]}><Ionicons name="person" size={18} color="#888" /></View>}
          <Text style={styles.name} numberOfLines={1}>{item.user?.name ?? 'Chat'}</Text>
          <Ionicons name="paper-plane-outline" size={18} color={palette.secondary} />
        </Pressable>;
      }}
    />}
  </SettingsPage>;
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 14, backgroundColor: palette.card },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  previewText: { flex: 1, color: palette.text, fontFamily: 'DMSans_500Medium', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarEmpty: { backgroundColor: '#2A2A2A', alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 15 },
  empty: { color: palette.muted, textAlign: 'center', marginTop: 40, fontFamily: 'DMSans_400Regular' },
});
