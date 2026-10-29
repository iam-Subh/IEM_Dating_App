import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsPage, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { api } from '../../services/api';
import { clearLocalSession, logoutSession } from '../../services/sessionLogout';
import { showAccountGoodbye } from '../../features/auth/accountGoodbye';

const REASONS = [
  { id: 'found_someone', label: 'I met someone' },
  { id: 'taking_a_break', label: "I'm taking a break" },
  { id: 'not_enough_matches', label: 'Not enough matches' },
  { id: 'not_working', label: "Something isn't working" },
  { id: 'privacy', label: 'Privacy concerns' },
  { id: 'other', label: 'Something else' },
] as const;

type Reason = (typeof REASONS)[number]['id'];

/**
 * Settings > Delete account: what deleting does, in plain words, an optional
 * reason, and DELETE typed to confirm. The account leaves discovery and every
 * device signs out now; signing in within 30 days offers to keep it.
 */
export function DeleteAccountScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmed = confirmation.trim().toUpperCase() === 'DELETE';

  const remove = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      const response = await api.post('/account/deletion', {
        confirmation: 'DELETE',
        ...(reason ? { reason } : {}),
        ...(reason === 'other' && note.trim() ? { note: note.trim() } : {}),
      });
      // The server has signed out every device, this one too. A goodbye
      // with the erase date shows before Welcome.
      showAccountGoodbye(response.data?.data?.scheduledFor ?? null);
      if (!await clearLocalSession()) {
        Alert.alert('Storage cleanup failed', 'Your account is scheduled for deletion and you are signed out. Some data on this phone could not be removed.');
      }
    } catch {
      setBusy(false);
      Alert.alert('Request failed', 'The app could not schedule account deletion. Check your connection and try again.');
    }
  };

  return (
    <SettingsPage title="Delete account">
      {/* The typing box scrolls up to sit above the keyboard. */}
      <KeyboardAwareScrollView bottomOffset={24} style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.card}>
            <Text style={styles.heading}>What happens</Text>
            <Point icon="eye-off-outline" text="Your profile leaves Discover, Explore and Search right away. Your matches can't message you." />
            <Point icon="log-out-outline" text="You're signed out on every device." />
            <Point icon="time-outline" text="You have 30 days to change your mind: sign in and choose Keep my account." />
            <Point icon="trash-outline" text="After 30 days your profile, photos, matches, chats and stories are erased for good. This can't be undone." danger />
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>Why are you leaving?</Text>
            <Text style={styles.hint}>Optional. Only our team sees this.</Text>
            {REASONS.map((option) => {
              const selected = reason === option.id;
              return (
                <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} disabled={busy}
                  onPress={() => setReason(selected ? null : option.id)} style={({ pressed }) => [styles.reason, pressed && styles.pressed]}>
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? palette.accent : palette.muted} />
                  <Text style={styles.reasonText}>{option.label}</Text>
                </Pressable>
              );
            })}
            {reason === 'other' ? (
              <TextInput value={note} onChangeText={setNote} editable={!busy} maxLength={500} multiline placeholder="Tell us more (optional)"
                placeholderTextColor={palette.muted} style={styles.note} />
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>Just need a break?</Text>
            <Text style={styles.hint}>Log out instead. Your profile, matches and chats stay as they are.</Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void logoutSession()}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
              <Text style={styles.secondaryText}>Log out instead</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>Type DELETE to confirm</Text>
            <TextInput value={confirmation} onChangeText={setConfirmation} editable={!busy} autoCapitalize="characters" autoCorrect={false}
              accessibilityLabel="Type DELETE to confirm" placeholder="DELETE" placeholderTextColor={palette.muted} style={styles.confirm} />
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !confirmed || busy }} disabled={!confirmed || busy}
              onPress={() => void remove()} style={({ pressed }) => [styles.danger, (!confirmed || busy) && styles.disabled, pressed && styles.pressed]}>
              {busy ? <ActivityIndicator color={palette.danger} /> : <Text style={styles.dangerText}>Delete my account</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => navigation.goBack()} style={styles.cancel}>
              <Text style={styles.cancelText}>Keep my account</Text>
            </Pressable>
          </View>
      </KeyboardAwareScrollView>
    </SettingsPage>
  );
}

function Point({ icon, text, danger = false }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; danger?: boolean }) {
  return (
    <View style={styles.point}>
      <Ionicons name={icon} size={19} color={danger ? palette.danger : palette.icon} style={{ marginTop: 1 }} />
      <Text style={[styles.pointText, danger && { color: palette.danger }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  card: { backgroundColor: palette.card, borderRadius: 18, padding: 16, gap: 10 },
  heading: { fontFamily: 'DMSans_700Bold', fontSize: 16, color: palette.text },
  hint: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 18, color: palette.secondary, marginTop: -4 },
  point: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  pointText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: palette.text },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  reasonText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: palette.text },
  note: { minHeight: 80, borderRadius: 12, padding: 12, backgroundColor: '#2E2C2F', color: palette.text, fontFamily: 'DMSans_400Regular', fontSize: 14, textAlignVertical: 'top' },
  secondary: { height: 44, borderRadius: 14, backgroundColor: '#363337', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: palette.text },
  confirm: { height: 48, borderRadius: 12, paddingHorizontal: 14, backgroundColor: '#2E2C2F', color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 16, letterSpacing: 2 },
  danger: { height: 48, borderRadius: 14, backgroundColor: palette.dangerSurface, alignItems: 'center', justifyContent: 'center' },
  dangerText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: palette.danger },
  disabled: { opacity: 0.45 },
  cancel: { height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: palette.secondary },
  pressed: { opacity: 0.75 },
});
