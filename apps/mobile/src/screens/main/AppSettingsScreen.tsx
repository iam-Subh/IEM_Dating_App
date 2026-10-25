import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import { blockedChannels, CHANNEL_OF_SETTING } from '../../features/notifications/push/channels';
import { phoneMaker } from '../../features/notifications/push/lateDelivery';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch } from 'react-redux';
import { api } from '../../services/api';
import { useSocketEvent } from '../../services/useSocketEvent';
import { updateUser } from '../../store/authSlice';
import { SettingsCard, SettingsEmptyState, SettingsPage, SettingsToggle, settingsLayout, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { VerifiedBadge } from '../../features/discovery/components/VerifiedBadge';
import { setShakeToReport, useShakeToReport } from '../../features/feedback/ShakeToReport';

/**
 * Settings > App settings: every notification, how they reach this phone,
 * and Team IEM Connect. The server sends the whole catalogue,
 * so what's listed here is exactly what it checks before every push.
 */

type Item = { key: string; title: string; detail: string; value: boolean; locked: boolean; required?: string; dependsOn?: string };
type State = {
  values: Record<string, boolean>;
  notifications: { pause: Item; groups: { id: string; title: string; items: Item[] }[]; required: Item[] };
  device: Item[];
  team: Item;
};

const GROUP_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  connections: 'chatbubbles-outline', likes: 'heart-outline', social: 'aperture-outline', verification: 'shield-checkmark-outline',
  from_us: 'sparkles-outline', quiet: 'moon-outline',
};

/** Android: sound and vibration live in the phone's settings, per channel (NOTIFICATIONS_PLAN.md 6). */
const PHONE_DECIDES = Platform.OS === 'android' ? new Set(['sound', 'vibration']) : new Set<string>();

/** The phone's own notification page for this app, or for one channel of it. */
async function openPhoneSettings(channelId?: string) {
  if (Platform.OS !== 'android') return Linking.openSettings();
  const extras: Record<string, string> = { 'android.provider.extra.APP_PACKAGE': Application.applicationId ?? '' };
  if (channelId) extras['android.provider.extra.CHANNEL_ID'] = channelId;
  try {
    await IntentLauncher.startActivityAsync(
      channelId ? 'android.settings.CHANNEL_NOTIFICATION_SETTINGS' : 'android.settings.APP_NOTIFICATION_SETTINGS', { extra: extras });
  } catch {
    await Linking.openSettings();
  }
}

export const AppSettingsScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch();
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'undetermined' | null>(null);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const pending = useRef(0);
  const shake = useShakeToReport();

  const adopt = useCallback((next: State) => {
    setState(next);
    dispatch(updateUser({ notificationPrefs: next.values, notifyLikes: next.values.likes }));
  }, [dispatch]);

  const load = useCallback(async () => {
    setFailed(false);
    try { adopt((await api.get('/profile/app-settings')).data.data); }
    catch { setFailed(true); }
  }, [adopt]);

  const readPermission = useCallback(async () => {
    try { setPermission((await Notifications.getPermissionsAsync()).status as any); } catch { setPermission(null); }
    // Types switched off in the phone's own settings show as such here.
    setBlocked(await blockedChannels());
  }, []);

  useFocusEffect(useCallback(() => { void load(); void readPermission(); }, [load, readPermission]));
  // Back from the phone's settings: the permission may have changed.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void readPermission(); });
    return () => subscription.remove();
  }, [readPermission]);
  // Live: a change on another device shows here at once (unless one of ours is in flight).
  useSocketEvent<State>('app_settings_changed', (next) => { if (!pending.current && next?.values) setState(next); });

  const setNotification = async (key: string, value: boolean) => {
    if (!state) return;
    const before = state;
    setState({ ...state, values: { ...state.values, [key]: value } });
    pending.current += 1;
    try {
      adopt((await api.put('/profile/app-settings/notifications', { key, value })).data.data);
    } catch {
      setState(before);
      Alert.alert('Update failed', 'The app could not change this setting. Try again.');
    } finally { pending.current -= 1; }
  };


  const askPermission = async () => {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted' && current.canAskAgain) {
      const next = await Notifications.requestPermissionsAsync();
      setPermission(next.status as any);
      if (next.status === 'granted') return;
    }
    void Linking.openSettings();
  };

  if (!state) {
    return <SettingsPage title="App settings">
      {failed ? <SettingsEmptyState icon="cloud-offline-outline" title="Could not load settings" message="Check your connection and try again." onRetry={load} />
        : <View style={settingsLayout.loading}><ActivityIndicator color={palette.accent} /></View>}
    </SettingsPage>;
  }

  const paused = state.values.pause_all;
  const row = (item: Item, options: { disabled?: boolean } = {}) => {
    const parentOff = !!item.dependsOn && !state.values[item.dependsOn];
    const disabled = item.locked || options.disabled || parentOff;
    const channel = CHANNEL_OF_SETTING[item.key];
    const offOnPhone = !!channel && blocked.has(channel) && permission === 'granted';
    return <View key={item.key}>
      <ToggleRow title={item.title} detail={item.detail} reason={item.required}
        value={item.locked ? true : state.values[item.key]} locked={item.locked} faded={disabled} indent={!!item.dependsOn}
        onChange={(value) => void setNotification(item.key, value)} />
      {offOnPhone && !item.dependsOn && <Pressable onPress={() => void openPhoneSettings(channel)} accessibilityRole="button"
        style={({ pressed }) => [styles.phoneOff, pressed && settingsLayout.pressed]}>
        <Ionicons name="phone-portrait-outline" size={13} color={palette.danger} />
        <Text style={styles.phoneOffText}>Off in phone settings · Turn on</Text>
      </Pressable>}
    </View>;
  };
  const maker = phoneMaker();

  return <SettingsPage title="App settings">
    <ScrollView contentContainerStyle={[settingsLayout.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
      {permission && permission !== 'granted' && <Pressable onPress={() => void askPermission()} accessibilityRole="button"
        style={({ pressed }) => [styles.permission, pressed && settingsLayout.pressed]}>
        <Ionicons name="notifications-off-outline" size={20} color={palette.danger} />
        <View style={styles.flex}>
          <Text style={styles.permissionTitle}>Notifications are off on this phone</Text>
          <Text style={styles.permissionDetail}>Nothing below can reach you until you allow them. Tap to turn them on.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.danger} />
      </Pressable>}

      <Text style={styles.sectionTitle}>Notifications</Text>
      <SettingsCard title="All notifications" icon="notifications-outline">
        {row(state.notifications.pause)}
      </SettingsCard>
      {paused && <Text style={styles.pausedNote}>Paused. Everything still appears in your Notifications page.</Text>}
      {state.notifications.groups.map((group) => <SettingsCard key={group.id} title={group.title} icon={group.id === 'verification' ? <VerifiedBadge size={24}/> : GROUP_ICON[group.id] ?? 'notifications-outline'}>
        {group.items.map((item) => row(item, { disabled: paused }))}
      </SettingsCard>)}
      <SettingsCard title="Always on" icon="lock-closed-outline">
        {state.notifications.required.map((item) => row(item))}
      </SettingsCard>

      <Text style={styles.sectionTitle}>On this phone</Text>
      <SettingsCard title="How notifications arrive" icon="phone-portrait-outline">
        {state.device.filter((item) => !PHONE_DECIDES.has(item.key)).map((item) => row(item, { disabled: paused }))}
        {Platform.OS === 'android' && <LinkRow title="Sound and vibration" detail="Set for each type in your phone's settings - Messages, Matches, Likes and more."
          onPress={() => void openPhoneSettings()} />}
        {maker !== 'other' && <LinkRow title="Notifications arriving late?" detail="Your phone may be holding them back to save battery. Two settings fix it."
          onPress={() => navigation.navigate('NotificationHelp')} />}
      </SettingsCard>


      <Text style={styles.sectionTitle}>Team IEM Connect</Text>
      <SettingsCard title="From the team" icon="megaphone-outline">
        {row(state.team, { disabled: paused })}
      </SettingsCard>

      <Text style={styles.sectionTitle}>Help</Text>
      <SettingsCard title="Reporting problems" icon="construct-outline">
        <ToggleRow title="Shake to report a problem" detail="Shake your phone to open a report. You can remove the screenshot before sending." value={shake} onChange={setShakeToReport} />
      </SettingsCard>

      <Text style={styles.footnote}>These control alerts on your phone. Every notification still appears in the Notifications page in the app. Changes apply on all your devices straight away.</Text>
    </ScrollView>
  </SettingsPage>;
};

function LinkRow({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && settingsLayout.pressed]}>
    <View style={styles.flex}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={palette.muted} />
  </Pressable>;
}

function ToggleRow({ title, detail, reason, value, locked = false, faded = false, indent = false, onChange }: {
  title: string; detail: string; reason?: string; value: boolean; locked?: boolean; faded?: boolean; indent?: boolean;
  onChange: (value: boolean) => void;
}) {
  return <View style={[styles.row, indent && styles.indent]}>
    <View style={[styles.flex, faded && styles.faded]}>
      <View style={styles.titleLine}>
        <Text style={styles.title}>{title}</Text>
        {locked && <Ionicons name="lock-closed" size={12} color={palette.muted} />}
      </View>
      <Text style={styles.detail}>{detail}</Text>
      {reason && <Text style={styles.reason}>{reason}</Text>}
    </View>
    <View style={faded ? styles.faded : undefined} pointerEvents={faded ? 'none' : 'auto'}
      accessibilityElementsHidden={false} accessibilityState={{ disabled: faded }}>
      <SettingsToggle label={title} hint={locked ? reason : detail} value={value} onChange={onChange} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  sectionTitle: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 18, marginTop: 10, paddingHorizontal: 2 },
  permission: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 16, backgroundColor: palette.dangerSurface },
  permissionTitle: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 13 },
  permissionDetail: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 2 },
  pausedNote: { color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 12, paddingHorizontal: 4, marginTop: -4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  indent: { paddingLeft: 14 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  detail: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
  reason: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, marginTop: 5, fontStyle: 'italic' },
  faded: { opacity: 0.45 },
  phoneOff: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: -4, marginBottom: 8, paddingVertical: 4 },
  phoneOffText: { color: palette.danger, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  footnote: { color: palette.muted, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, paddingHorizontal: 4, marginTop: 4 },
});
