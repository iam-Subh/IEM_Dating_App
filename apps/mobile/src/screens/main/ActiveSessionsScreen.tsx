import React, { useCallback, useMemo, useState } from 'react';
import { useSocketEvent } from '../../services/useSocketEvent';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../services/api';
import { SettingsEmptyState, SettingsPage, settingsLayout, settingsPalette as palette } from '../../core/settings/SettingsLayout';

/**
 * Every device signed in to this account: what it is, when it signed in, when
 * it was last active, and the network it used - and a way to sign any of them
 * out, or all but this one. A signed-out device loses access on its next
 * request and its live connection is dropped at once.
 */

type Session = {
  id: string;
  current: boolean;
  signedInAt: string;
  lastActiveAt: string;
  expiresAt?: string;
  ip?: string | null;
  deviceInfo?: { platform?: string; brand?: string; model?: string; osVersion?: string; appVersion?: string; deviceName?: string } | null;
};

function deviceName(session: Session) {
  const info = session.deviceInfo ?? {};
  const named = [info.brand, info.model].filter(Boolean).join(' ').trim();
  if (named) return named;
  if (info.platform === 'android') return 'Android phone';
  if (info.platform === 'ios') return 'iPhone';
  if (info.platform === 'web') return 'Web browser';
  return 'Unknown device';
}

function deviceIcon(session: Session): React.ComponentProps<typeof Ionicons>['name'] {
  const info = session.deviceInfo ?? {};
  if (/ipad|tablet/i.test(info.model ?? '')) return 'tablet-portrait-outline';
  if (info.platform === 'android' || info.platform === 'ios') return 'phone-portrait-outline';
  if (info.platform === 'web') return 'laptop-outline';
  return 'hardware-chip-outline';
}

function fullDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** "Active now", "12 min ago", "3 h ago", or the date. */
function activeLabel(session: Session) {
  if (session.current) return 'Active now';
  const minutes = Math.round((Date.now() - new Date(session.lastActiveAt).getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return 'Not available';
  if (minutes < 6) return 'Active now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return fullDate(session.lastActiveAt);
}

export const ActiveSessionsScreen = () => {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setFailed(false);
    try {
      const response = await api.get('/auth/sessions');
      setItems(response.data.data ?? []);
    } catch { if (!quiet) setFailed(true); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // Live: a phone or browser signing in or out anywhere - and after a
  // reconnect, whatever changed meanwhile - shows here without a spinner.
  useSocketEvent('sessions_changed', () => { void load(true); }, { onReconnect: true });

  const sorted = useMemo(
    () => [...items].sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt)),
    [items],
  );
  const others = items.filter((item) => !item.current).length;

  const revoke = (item: Session) => {
    if (busyId) return;
    Alert.alert(`Sign out ${deviceName(item)}?`, 'That device will be signed out and will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        setBusyId(item.id);
        try {
          await api.delete(`/auth/sessions/${item.id}`);
          setItems((current) => current.filter((entry) => entry.id !== item.id));
        } catch { Alert.alert('Could not sign out', 'Check your connection and try again.'); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  const revokeOthers = () => {
    if (busyId || !others) return;
    Alert.alert(
      'Sign out of all other devices?',
      `${others} ${others === 1 ? 'device' : 'devices'} will be signed out. This phone stays signed in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out others', style: 'destructive', onPress: async () => {
          setBusyId('others');
          try {
            await api.post('/auth/sessions/revoke-others');
            setItems((current) => current.filter((entry) => entry.current));
          } catch { Alert.alert('Could not sign out', 'Check your connection and try again.'); }
          finally { setBusyId(null); }
        } },
      ],
    );
  };

  return <SettingsPage title="Active sessions">
    <FlatList accessibilityLabel="Active sessions" data={sorted} style={styles.list}
      keyExtractor={(item) => item.id} showsVerticalScrollIndicator={false}
      contentContainerStyle={[settingsLayout.content, { paddingBottom: others > 0 ? 12 : insets.bottom + 20 }]}
      ListHeaderComponent={<View style={styles.intro}>
        <Text style={settingsLayout.intro}>Devices signed in to your account. If you don't recognise one, sign it out and change how you sign in.</Text>
        {items.length > 0 && <Text style={styles.sectionTitle}>{items.length} {items.length === 1 ? 'active session' : 'active sessions'}</Text>}
        {failed && items.length > 0 && <Pressable onPress={() => void load()} accessibilityRole="button" style={styles.refreshError}>
          <Ionicons name="refresh-outline" size={16} color={palette.accent} />
          <Text style={styles.refreshText}>Could not refresh. Tap to retry.</Text>
        </Pressable>}
      </View>}
      renderItem={({ item }) => <View style={[styles.sessionCard, item.current && styles.currentCard]}>
        <View style={styles.deviceRow}>
          <View style={styles.deviceIcon}><Ionicons name={deviceIcon(item)} size={23} color={item.current ? palette.accent : palette.icon} /></View>
          <View style={styles.copy}>
            <Text style={styles.name} numberOfLines={1}>{deviceName(item)}</Text>
            <Text style={styles.deviceInfo} numberOfLines={1}>
              {[item.deviceInfo?.osVersion, item.deviceInfo?.appVersion ? `App ${item.deviceInfo.appVersion}` : null].filter(Boolean).join(' · ') || 'Details appear after its next use'}
            </Text>
          </View>
          {item.current && <View style={styles.currentBadge}><Text style={styles.currentText}>This device</Text></View>}
        </View>
        <View style={styles.details}>
          <Detail icon="pulse-outline" label="Last active" value={activeLabel(item)} highlight={activeLabel(item) === 'Active now'} />
          <Detail icon="log-in-outline" label="Signed in" value={fullDate(item.signedInAt)} />
          {!!item.ip && <Detail icon="globe-outline" label="Network" value={item.ip} />}
        </View>
        {!item.current && <Pressable onPress={() => revoke(item)} disabled={busyId !== null}
          accessibilityRole="button" accessibilityLabel={`Sign out ${deviceName(item)}`}
          accessibilityState={{ disabled: busyId !== null, busy: busyId === item.id }}
          style={({ pressed }) => [styles.signOut, pressed && settingsLayout.pressed, busyId && busyId !== item.id && styles.disabled]}>
          {busyId === item.id ? <ActivityIndicator size="small" color={palette.danger} /> : <>
            <Ionicons name="log-out-outline" size={16} color={palette.danger} />
            <Text style={styles.signOutText}>Sign out this device</Text>
          </>}
        </Pressable>}
      </View>}
      ItemSeparatorComponent={() => <View style={styles.gap} />}
      ListEmptyComponent={loading ? <View style={settingsLayout.loading}><ActivityIndicator color={palette.accent} /><Text style={settingsLayout.intro}>Loading sessions…</Text></View>
        : <SettingsEmptyState icon={failed ? 'cloud-offline-outline' : 'phone-portrait-outline'} title={failed ? 'Could not load sessions' : 'No active sessions'}
          message={failed ? 'Check your connection and try again.' : 'Signed-in devices will appear here.'} onRetry={failed ? () => void load() : undefined} />}
    />
    {others > 0 && <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.footerContent}>
        <Pressable onPress={revokeOthers} disabled={busyId !== null}
          accessibilityRole="button" accessibilityLabel="Sign out of all other devices"
          accessibilityState={{ disabled: busyId !== null, busy: busyId === 'others' }}
          style={({ pressed }) => [styles.signOutAll, pressed && settingsLayout.pressed, busyId !== null && styles.disabled]}>
          {busyId === 'others' ? <ActivityIndicator size="small" color={palette.danger} /> : <>
            <Ionicons name="shield-checkmark-outline" size={18} color={palette.danger} />
            <Text style={styles.signOutAllText}>Sign out of all other devices</Text>
          </>}
        </Pressable>
      </View>
    </View>}
  </SettingsPage>;
};

function Detail({ icon, label, value, highlight }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; highlight?: boolean }) {
  return <View style={styles.detail}>
    <Ionicons name={icon} size={15} color={palette.secondary} />
    <Text style={styles.detailLabel}>{label}</Text>
    <Text selectable style={[styles.detailValue, highlight && styles.detailHighlight]}>{value}</Text>
  </View>;
}

const styles = StyleSheet.create({
  list: { flex: 1, minHeight: 0 },
  intro: { gap: 12, paddingBottom: 12 },
  sectionTitle: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 16 },
  gap: { height: 10 },
  sessionCard: { backgroundColor: palette.card, borderRadius: 18, padding: 14 },
  currentCard: { borderWidth: 1, borderColor: 'rgba(189,228,202,0.25)' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deviceIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#2D2B2D', alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  name: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 15 },
  deviceInfo: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
  currentBadge: { backgroundColor: '#293A31', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12 },
  currentText: { color: '#BDE4CA', fontFamily: 'DMSans_700Bold', fontSize: 11 },
  details: { marginTop: 12, paddingTop: 10, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
  detail: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  detailLabel: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, width: 78, flexShrink: 0 },
  detailValue: { flex: 1, minWidth: 0, color: palette.text, fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18 },
  detailHighlight: { color: '#BDE4CA' },
  signOut: { marginTop: 12, minHeight: 42, borderRadius: 21, backgroundColor: palette.dangerSurface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  signOutText: { color: palette.danger, fontFamily: 'DMSans_700Bold', fontSize: 13 },
  footer: { paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator, backgroundColor: '#100F0D' },
  footerContent: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 16 },
  signOutAll: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,140,147,0.4)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  signOutAllText: { flexShrink: 1, color: palette.danger, fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  refreshError: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  refreshText: { flex: 1, color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 12 },
});
