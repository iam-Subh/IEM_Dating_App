import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDispatch } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { colors } from '../../core/theme/colors';
import { api } from '../../services/api';
import { logoutSession } from '../../services/sessionLogout';
import { updateUser } from '../../store/authSlice';

/**
 * Signed in to an account that is waiting to be deleted: it is kept off
 * everyone's screens until the person decides. Keep my account cancels the
 * deletion and opens the app; Log out leaves it to be erased on the date.
 */
export function AccountDeletionPendingScreen() {
  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<'keep' | 'logout' | null>(null);

  useEffect(() => {
    let live = true;
    api.get('/account/deletion')
      .then((response) => { if (live) setScheduledFor(response.data?.data?.scheduledFor ?? null); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  const keep = async () => {
    if (busy) return;
    setBusy('keep');
    try {
      await api.delete('/account/deletion');
      dispatch(updateUser({ accountStatus: 'active' }));
    } catch (error: any) {
      // Nothing pending any more: the account is already active.
      if (error?.response?.data?.code === 'DELETION_REQUEST_UNAVAILABLE') dispatch(updateUser({ accountStatus: 'active' }));
      else Alert.alert('Request failed', 'The app could not keep your account. Check your connection and try again.');
    } finally { setBusy(null); }
  };

  const leave = async () => {
    if (busy) return;
    setBusy('logout');
    await logoutSession();
  };

  const date = scheduledFor
    ? new Date(scheduledFor).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  return (
    <View style={[styles.page, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.icon}><Ionicons name="time-outline" size={30} color={palette.accent} /></View>
      <Text style={styles.title} accessibilityRole="header">Your account is set to be deleted</Text>
      <Text style={styles.body}>
        {date ? `On ${date}` : 'In 30 days from your request'}, your profile, photos, matches, chats and stories will be erased for good.
        Until then nobody can see your profile.
      </Text>
      <View style={{ flex: 1 }} />
      <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => void keep()}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
        {busy === 'keep' ? <ActivityIndicator color={palette.accentText} /> : <Text style={styles.primaryText}>Keep my account</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => void leave()}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
        {busy === 'logout' ? <ActivityIndicator color={palette.text} /> : <Text style={styles.secondaryText}>Log out</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 },
  icon: { width: 64, height: 64, borderRadius: 22, backgroundColor: palette.card, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 26, lineHeight: 32, color: palette.text },
  body: { fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22, color: palette.secondary, marginTop: 12 },
  primary: { height: 52, borderRadius: 16, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 16, color: palette.accentText },
  secondary: { height: 52, borderRadius: 16, backgroundColor: palette.card, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryText: { fontFamily: 'DMSans_700Bold', fontSize: 16, color: palette.text },
  pressed: { opacity: 0.75 },
});
