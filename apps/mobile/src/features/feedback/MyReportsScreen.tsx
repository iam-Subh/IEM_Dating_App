import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsEmptyState, SettingsPage, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { api } from '../../services/api';
import { useSocketEvent } from '../../services/useSocketEvent';

type Report = { id: string; reference: string; area: string; description: string; status: string; fixedInVersion: string | null; createdAt: string; files: number };

const STATUS: Record<string, { label: string; tone: string; text: string }> = {
  received: { label: 'Received', tone: 'rgba(255,255,255,0.1)', text: palette.text },
  investigating: { label: 'Looking into it', tone: '#F3DDB4', text: '#49351F' },
  fixed: { label: 'Fixed', tone: '#BCE5D0', text: '#173B2A' },
  closed: { label: 'Closed', tone: 'rgba(255,255,255,0.06)', text: palette.secondary },
  duplicate: { label: 'Already known', tone: 'rgba(255,255,255,0.06)', text: palette.secondary },
};
const AREA: Record<string, string> = { chat: 'Chat', photos: 'Photos & video', matches: 'Matches', explore: 'Explore', stories: 'Stories', login: 'Login', notifications: 'Notifications', other: 'Something else' };

/** Settings > My reports: each bug report and where it is (docs/FEEDBACK.md). */
export function MyReportsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try { setReports((await api.get('/feedback/reports')).data.data ?? []); } catch { setFailed(true); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // A status change arrives as a notification: refresh while open.
  useSocketEvent('notifications_changed', () => { void load(); }, { onReconnect: true });

  const action = <Pressable onPress={() => navigation.navigate('ReportProblem')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Report a new problem"
    style={styles.newButton}><Ionicons name="add" size={24} color="#FFFFFF" /></Pressable>;

  return <SettingsPage title="My reports" action={action}>
    {failed ? <SettingsEmptyState icon="cloud-offline-outline" title="Couldn't load your reports" message="Check your connection and try again." onRetry={() => void load()} />
      : !reports ? <ActivityIndicator style={{ marginTop: 40 }} color={palette.accent} />
      : !reports.length ? <SettingsEmptyState icon="construct-outline" title="No reports yet" message="If something in the app isn't working, report it and you can follow it here." />
      : <FlatList data={reports} keyExtractor={(item) => item.id} contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        renderItem={({ item }) => {
          const status = STATUS[item.status] ?? STATUS.received;
          return <View style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.reference}>{item.reference}</Text>
              <View style={[styles.pill, { backgroundColor: status.tone }]}><Text style={[styles.pillText, { color: status.text }]}>{status.label}</Text></View>
            </View>
            <Text style={styles.area}>{AREA[item.area] ?? item.area} · {new Date(item.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}{item.files ? ` · ${item.files} ${item.files === 1 ? 'file' : 'files'}` : ''}</Text>
            <Text style={styles.description} numberOfLines={3}>{item.description}</Text>
            {item.status === 'fixed' && item.fixedInVersion ? <Text style={styles.fixed}>Fixed in version {item.fixedInVersion} - update the app to get it.</Text> : null}
          </View>;
        }} />}
  </SettingsPage>;
}

const styles = StyleSheet.create({
  newButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  list: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  card: { borderRadius: 16, backgroundColor: palette.card, padding: 14, gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reference: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 15 },
  pill: { height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: 'center' },
  pillText: { fontFamily: 'DMSans_700Bold', fontSize: 11 },
  area: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 12 },
  description: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20 },
  fixed: { color: '#BCE5D0', fontFamily: 'DMSans_500Medium', fontSize: 13 },
});
