import React from 'react';
import { openReport } from '../../safety/ReportSheet';
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../../../services/api';
import { colors } from '../../../core/theme/colors';
import { recordSetback } from '../../feedback/engagement';

type ProfileAction = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  danger?: boolean;
  run: () => void | Promise<void>;
};

export const ChatProfileScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { matchId, userId, userName, userAvatar } = route.params;
  const confirm = (title: string, message: string, action: string, run: () => Promise<void>) => Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: () => void run() },
  ]);
  const exitChat = () => navigation.navigate('Main', { screen: 'Chats' });
  const rows: ProfileAction[] = [
    { icon: 'images-outline', label: 'Shared media', run: () => navigation.navigate('SharedMedia', { matchId, userId, userName, userAvatar }) },
    { icon: 'search-outline', label: 'Search', run: () => navigation.navigate('MessageSearch', { matchId }) },
    { icon: 'notifications-off-outline', label: 'Mute for 8 hours', run: async () => { await api.patch(`/chat/${matchId}/mute`, { mutedUntil: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() }); } },
    { icon: 'calendar-outline', label: 'Share date plans', run: () => navigation.navigate('ShareDate', { userName }) },
    // The report sheet, with a reason and "Also block" (features/safety/ReportSheet.tsx); blocking there closes the chat.
    { icon: 'flag-outline', label: 'Report', danger: true, run: async () => { const result = await openReport({ userId, name: userName, sourceType: 'profile', sourceId: userId, matchId }); if (result.blocked) exitChat(); } },
    { icon: 'close-circle-outline', label: 'Unmatch', danger: true, run: () => confirm('Unmatch?', 'This chat will close for both people.', 'Unmatch', async () => { await api.post(`/match/${matchId}/unmatch`); void recordSetback(); exitChat(); }) },
    { icon: 'ban-outline', label: 'Block', danger: true, run: () => confirm('Block account?', 'This person cannot contact or find you.', 'Block', async () => { await api.post('/block', { blockedId: userId }); void recordSetback(); exitChat(); }) },
  ];
  return <View style={styles.container}>
    <View style={styles.header}><TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="arrow-back" size={25} color="#fff" /></TouchableOpacity><Text style={styles.headerTitle}>Chat info</Text><View style={{ width: 25 }} /></View>
    <Image source={{ uri: userAvatar }} style={styles.avatar} />
    <Text style={styles.name}>{userName}</Text><Text style={styles.status}>Matched</Text>
    <View style={styles.card}>{rows.map((row) => <TouchableOpacity key={row.label} style={styles.row} onPress={() => void row.run()}><Ionicons name={row.icon} size={22} color={row.danger ? '#FF646A' : '#fff'} /><Text style={[styles.rowText, row.danger && styles.danger]}>{row.label}</Text><Ionicons name="chevron-forward" size={18} color={colors.text.tertiary} /></TouchableOpacity>)}</View>
  </View>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#100F0D', paddingTop: 42 },
  header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: '#fff', fontSize: 19, fontWeight: '700' },
  avatar: { width: 104, height: 104, borderRadius: 52, alignSelf: 'center', marginTop: 18, backgroundColor: '#272527' },
  name: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: 14 },
  status: { color: colors.text.tertiary, textAlign: 'center', marginTop: 3 },
  card: { margin: 18, marginTop: 28, backgroundColor: '#1C1C1C', borderRadius: 18, overflow: 'hidden' },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#343236' },
  rowText: { flex: 1, color: '#fff', fontSize: 16 }, danger: { color: '#FF646A' },
});
