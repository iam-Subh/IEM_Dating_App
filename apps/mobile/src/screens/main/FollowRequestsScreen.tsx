import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../services/api';
import { SettingsAvatar, SettingsEmptyState, SettingsPage, settingsLayout, settingsPalette as palette } from '../../core/settings/SettingsLayout';

type Request = { id: string; requester?: { name?: string; avatarUrl?: string | null } };

export const FollowRequestsScreen = () => {
  const insets = useSafeAreaInsets();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<{ id: string; accept: boolean } | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    try { const response = await api.get('/stories/follow-requests'); setRequests(response.data.data ?? []); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const respond = async (id: string, accept: boolean) => {
    if (pending) return;
    setPending({ id, accept }); setErrorId(null);
    try {
      await api.patch(`/stories/follows/${id}`, { accept });
      setRequests((items) => items.filter((item) => item.id !== id));
    } catch { setErrorId(id); }
    finally { setPending(null); }
  };
  return <SettingsPage title="Follow requests">
    <FlatList accessibilityLabel="Pending follow requests" data={requests} keyExtractor={(item) => item.id} showsVerticalScrollIndicator={false}
      contentContainerStyle={[settingsLayout.content, { paddingBottom: insets.bottom + 20 }]}
      ListHeaderComponent={<View style={settingsLayout.listIntro}>
        <Text style={settingsLayout.intro}>Choose who can follow your stories.</Text>
        {requests.length > 0 && <Text style={settingsLayout.listHeading}>{requests.length} pending {requests.length === 1 ? 'request' : 'requests'}</Text>}
        {failed && requests.length > 0 && <Pressable onPress={load}><Text style={styles.error}>Could not refresh. Tap to retry.</Text></Pressable>}
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator color={palette.accent} style={{ marginTop: 24 }} />
        : <SettingsEmptyState icon={failed ? 'cloud-offline-outline' : 'mail-open-outline'} title={failed ? 'Could not load requests' : 'No pending requests'}
          message={failed ? 'Check your connection and try again.' : 'New follow requests will appear here.'} onRetry={failed ? load : undefined} />}
      renderItem={({ item }) => <View style={styles.card}>
        <View style={styles.identity}>
          <SettingsAvatar name={item.requester?.name ?? 'IEM student'} uri={item.requester?.avatarUrl} />
          <View style={styles.copy}><Text style={styles.name}>{item.requester?.name ?? 'IEM student'}</Text><Text style={styles.note}>Wants to follow your stories</Text></View>
        </View>
        <View style={styles.actions}>
          {([false, true] as const).map((accept) => <Pressable key={String(accept)} accessibilityRole="button"
            accessibilityLabel={`${accept ? 'Accept' : 'Delete'} follow request from ${item.requester?.name ?? 'this student'}`}
            accessibilityState={{ disabled: pending !== null, busy: pending?.id === item.id && pending.accept === accept }}
            disabled={pending !== null} onPress={() => void respond(item.id, accept)}
            style={({ pressed }) => [styles.action, !accept && styles.secondary, pressed && settingsLayout.pressed]}>
            {pending?.id === item.id && pending.accept === accept ? <ActivityIndicator size="small" color={accept ? palette.accentText : palette.text} />
              : <Text style={[styles.actionText, !accept && styles.secondaryText]}>{accept ? 'Accept' : 'Delete'}</Text>}
          </Pressable>)}
        </View>
        {errorId === item.id && <Text style={styles.error}>Could not update this request. Try again.</Text>}
      </View>} />
  </SettingsPage>;
};
const styles = StyleSheet.create({
  card: { backgroundColor: palette.card, borderRadius: 18, padding: 14, gap: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  copy: { flex: 1, minWidth: 0 },
  name: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  note: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, marginTop: 3 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, minHeight: 44, borderRadius: 22, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: '#3A3337' },
  actionText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 13 },
  secondaryText: { color: palette.text },
  error: { color: palette.danger, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17 },
});
