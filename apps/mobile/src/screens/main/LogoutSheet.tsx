import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { logoutSession } from '../../services/sessionLogout';

/**
 * Settings > Log out, as a sheet (like DiscardChangesSheet): one clear Log out
 * and Cancel, as Instagram and Hinge ask it, with every device as the quieter
 * choice under them. Logging out drops the token, so RootNavigator's
 * navigationKey closes this sheet and Settings, and Welcome shows.
 */
export function LogoutSheet() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<'here' | 'everywhere' | null>(null);

  const leave = async (everywhere: boolean) => {
    if (busy) return;
    setBusy(everywhere ? 'everywhere' : 'here');
    // Clearing this phone is near instant and closes the sheet at once; hold
    // "Logging out…" long enough to be read, so the tap visibly did something.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const result = await logoutSession({ everywhere });
    // This phone is signed out either way; only the server side can lag behind.
    if (!result.localCleared || !result.serverRevoked) {
      Alert.alert('Logged out on this phone', everywhere
        ? 'Other devices may still be signed in. Check Active sessions next time you log in.'
        : "Some cleanup didn't finish, but this phone is signed out.");
    }
  };

  return <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
    {Platform.OS === 'android' && <View style={styles.handle} />}
    <Text style={styles.title} accessibilityRole="header">Log out of IEM Connect?</Text>
    <Text style={styles.message}>Your profile, matches and chats stay as they are. Log back in any time.</Text>
    <Pressable onPress={() => void leave(false)} disabled={!!busy} accessibilityRole="button"
      accessibilityState={{ busy: busy === 'here', disabled: !!busy }}
      style={({ pressed }) => [styles.button, styles.logout, pressed && styles.pressed, busy === 'everywhere' && styles.waiting]}>
      {/* Says what it is doing while it does it, so the tap clearly worked. */}
      {busy === 'here'
        ? <View style={styles.working}><ActivityIndicator size="small" color="#C9272D" /><Text style={styles.logoutText}>Logging out…</Text></View>
        : <Text style={styles.logoutText}>Log out</Text>}
    </Pressable>
    <Pressable onPress={() => navigation.goBack()} disabled={!!busy} accessibilityRole="button"
      style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed, !!busy && styles.waiting]}>
      <Text style={styles.cancelText}>Cancel</Text>
    </Pressable>
    <Pressable onPress={() => void leave(true)} disabled={!!busy} accessibilityRole="button" hitSlop={8}
      accessibilityHint="Signs you out on this phone and every other device"
      style={({ pressed }) => [styles.everywhere, pressed && styles.pressed, busy === 'here' && styles.waiting]}>
      {busy === 'everywhere'
        ? <View style={styles.working}><ActivityIndicator size="small" color="#DDD0D5" /><Text style={[styles.everywhereText, styles.everywhereBusy]}>Logging out of all devices…</Text></View>
        : <Text style={styles.everywhereText}>Log out of all devices</Text>}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: palette.card, paddingHorizontal: 20, paddingTop: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#716A70', alignSelf: 'center', marginBottom: 14 },
  title: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 21, marginTop: 4 },
  message: { color: '#DDD0D5', fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 20 },
  button: { minHeight: 46, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  logout: { backgroundColor: '#FFDAD8' },
  logoutText: { color: '#C9272D', fontFamily: 'DMSans_700Bold', fontSize: 14 },
  cancel: { backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 8 },
  cancelText: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 14 },
  everywhere: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  everywhereText: { color: '#B9AEB4', fontFamily: 'DMSans_500Medium', fontSize: 13, textDecorationLine: 'underline' },
  working: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  everywhereBusy: { color: '#DDD0D5', textDecorationLine: 'none' },
  // The choices not taken fade while one runs.
  waiting: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
