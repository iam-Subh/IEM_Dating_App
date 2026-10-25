import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, FlatList, ActivityIndicator, TextInput, StyleSheet, Keyboard, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { RootState } from '../../../store';
import { api } from '../../../services/api';
import { useChatMarks } from '../useChatMarks';
import { chatMarksKey, filterMarkedMessages, markedMessagePreview, visibleMarkedMessages, type MarkKind, type MarkedMessage } from '../messageMarks';

/**
 * Pinned and starred messages for a chat.
 *
 * Opened from the chat header's overflow menu, which now owns the trigger, so
 * this is a controlled panel rather than a button of its own.
 */
export function MarkedMessagesMenu({ matchId, open, initialKind = 'pin', peerName, onClose, onSelect }: {
  matchId: string;
  open: boolean;
  initialKind?: MarkKind;
  peerName: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [kind, setKind] = useState<MarkKind>(initialKind);
  const [search, setSearch] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const userId = useSelector((state: RootState) => state.auth.user?.id);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useChatMarks(userId, matchId, kind, open);
  useEffect(() => { if (open) { setKind(initialKind); setSearch(''); } }, [initialKind, open]);
  const data = useMemo(() => filterMarkedMessages(visibleMarkedMessages(query.data ?? []), search, userId, peerName), [query.data, search, userId, peerName]);
  const pin = kind === 'pin';
  const accent = pin ? '#F3C1CA' : '#E5C688';
  const remove = async (message: MarkedMessage) => {
    if (removing) return;
    setRemoving(message.id);
    try {
      const response = await api.put(`/chat/${matchId}/messages/${message.id}/marks`, { kind, active: false });
      queryClient.setQueryData(['message-marks', userId, matchId, message.id], response.data.data);
      queryClient.setQueryData<MarkedMessage[]>(chatMarksKey(userId, matchId, kind), old => old?.filter(item => item.id !== message.id));
      void queryClient.invalidateQueries({ queryKey: chatMarksKey(userId, matchId, kind) });
    } catch { Alert.alert('Could not update message', 'Try again.'); }
    finally { setRemoving(null); }
  };
  return <Modal visible={open} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Back to chat"><Ionicons name="arrow-back" size={25} color="#F8F5F3" /></Pressable>
        <View style={styles.heading}><Text style={styles.title}>{pin ? 'Pinned messages' : 'Starred messages'}</Text><Text style={styles.subtitle}>{pin ? 'Visible to both of you' : 'Only you can see your stars'}</Text></View>
        <Ionicons name={pin ? 'pin' : 'star'} size={22} color={accent} style={styles.headingIcon} />
      </View>
      <View style={styles.tabs}>{(['pin', 'star'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} onPress={() => { setKind(value); setSearch(''); }} style={[styles.tab, kind === value && styles.activeTab]}>
        <Ionicons name={value === 'pin' ? 'pin-outline' : 'star-outline'} size={16} color={kind === value ? '#F8F1F4' : '#9F969C'} /><Text style={[styles.tabText, kind === value && styles.activeTabText]}>{value === 'pin' ? 'Pinned' : 'Starred'}</Text>
      </Pressable>)}</View>
      <View style={styles.search}><Ionicons name="search-outline" size={19} color="#ABA3A8" /><TextInput value={search} onChangeText={setSearch} placeholder={pin ? 'Search pinned messages' : 'Search starred messages'} placeholderTextColor="#958D92" accessibilityLabel="Search saved messages" style={styles.searchInput} autoCorrect={false} />{search ? <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search" style={styles.clear}><Ionicons name="close-circle" size={19} color="#ABA3A8" /></Pressable> : null}</View>
      {query.isLoading ? <View style={styles.center}><ActivityIndicator color={accent} /></View> : query.isError ? <View style={styles.center}><Text style={styles.emptyTitle}>Could not load messages</Text><Pressable onPress={() => void query.refetch()} style={styles.retry}><Text style={{ color: accent }}>Try again</Text></Pressable></View> :
        <FlatList data={data} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={data.length ? styles.content : styles.emptyContent}
          ListEmptyComponent={<View style={styles.center}><View style={[styles.emptyIcon, { backgroundColor: pin ? '#33262D' : '#302B20' }]}><Ionicons name={search ? 'search-outline' : pin ? 'pin-outline' : 'star-outline'} size={32} color={accent} /></View><Text style={styles.emptyTitle}>{search ? 'No messages found' : pin ? 'No pinned messages' : 'No starred messages'}</Text><Text style={styles.emptyText}>{search ? 'Try another word.' : `Touch and hold a message, then select ${pin ? 'Pin' : 'Star'}.`}</Text></View>}
          renderItem={({ item }) => {
            const preview = markedMessagePreview(item);
            return <View style={styles.item}>
              <Pressable onPress={() => { Keyboard.dismiss(); onClose(); setTimeout(() => onSelect(item.id), 220); }} accessibilityRole="button" accessibilityLabel={`Open message from ${item.senderId === userId ? 'You' : peerName}: ${preview.text}`} style={({ pressed }) => [styles.message, pressed && styles.pressed]}>
                <View style={styles.messageHeading}><Text style={[styles.author, { color: accent }]} numberOfLines={1}>{item.senderId === userId ? 'You' : peerName}</Text><Text style={styles.date}>{new Date(item.sentAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</Text></View>
                <Text style={styles.body} numberOfLines={5}>{preview.icon ? <Ionicons name={preview.icon} size={16} color="#C9C0C6" /> : null}{preview.icon ? ' ' : ''}{preview.text}</Text>
                <View style={styles.messageFooter}><Text style={styles.time}>{item.editedAt ? 'edited · ' : ''}{new Date(item.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text><Ionicons name="chevron-forward" size={14} color="#989095" /></View>
              </Pressable>
              <Pressable disabled={Boolean(removing)} onPress={() => {
                if (pin) Alert.alert('Unpin message?', 'This removes the pin for both of you.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Unpin', onPress: () => void remove(item) }]);
                else void remove(item);
              }} accessibilityRole="button" accessibilityLabel={pin ? 'Unpin message' : 'Unstar message'} style={styles.remove}>{removing === item.id ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name={pin ? 'pin-outline' : 'star'} size={21} color={accent} />}</Pressable>
            </View>;
          }} />}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#100F0D' }, header: { flexDirection: 'row', alignItems: 'center', minHeight: 68, backgroundColor: '#191617' },
  headerButton: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }, heading: { flex: 1, gap: 3 }, title: { color: '#F8F5F3', fontSize: 19, fontWeight: '600' }, subtitle: { color: '#A99EA5', fontSize: 12 }, headingIcon: { marginHorizontal: 20 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 14, gap: 6, backgroundColor: '#211D1F', borderRadius: 22, padding: 4 }, tab: { flex: 1, height: 36, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, borderRadius: 18 }, activeTab: { backgroundColor: '#49323D' }, tabText: { color: '#9F969C', fontSize: 13, fontWeight: '600' }, activeTabText: { color: '#F8F1F4' },
  search: { flexDirection: 'row', alignItems: 'center', margin: 16, gap: 10, borderRadius: 23, backgroundColor: '#252123', paddingLeft: 14 }, searchInput: { flex: 1, height: 44, color: '#F8F5F3', fontSize: 14 }, clear: { width: 42, height: 44, justifyContent: 'center', alignItems: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 24 }, item: { flexDirection: 'row', marginBottom: 15, alignItems: 'center' }, message: { flex: 1, minWidth: 0, backgroundColor: '#242022', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 }, messageHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: 7, gap: 10 }, author: { flex: 1, fontSize: 13, fontWeight: '600' }, date: { color: '#91898F', fontSize: 11 }, body: { color: '#F1ECEF', fontSize: 15, lineHeight: 22 }, messageFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 5, marginTop: 7 }, time: { fontSize: 11, color: '#A79DA3' }, remove: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' }, pressed: { backgroundColor: '#322B2F' },
  emptyContent: { flexGrow: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 }, emptyIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }, emptyTitle: { color: '#EEE8EC', fontSize: 18, fontWeight: '600', textAlign: 'center' }, emptyText: { color: '#A69AA2', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, maxWidth: 260 }, retry: { padding: 16 },
});
