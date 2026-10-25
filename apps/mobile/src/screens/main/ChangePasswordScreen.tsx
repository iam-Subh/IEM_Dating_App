import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SettingsPage, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { api } from '../../services/api';

const MIN_LENGTH = 8;

/**
 * Account > Change password: the current password, then the new one twice.
 * Other devices are signed out when it changes; this one stays signed in.
 */
export function ChangePasswordScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  // Shown under the confirm field as soon as it differs, not only on submit.
  const mismatch = repeat.length > 0 && repeat !== next;
  const sameAsCurrent = next.length > 0 && next === current;
  const ready = !!current && next.length >= MIN_LENGTH && repeat === next && !sameAsCurrent && !busy;

  const save = async () => {
    // Checked again here, whatever the button showed: never send a password
    // the person did not type the same way twice.
    if (repeat !== next) { setError("The new passwords don't match. Type the same password in both fields."); return; }
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      // Its own limit: a hung request must not leave the button spinning.
      const response = await api.put('/auth/account/password', { currentPassword: current, newPassword: next }, { timeout: 15_000 });
      const revoked = response.data?.data?.revoked ?? 0;
      Alert.alert('Password changed', revoked
        ? `Use your new password next time. ${revoked} other ${revoked === 1 ? 'device was' : 'devices were'} signed out.`
        : 'Use your new password next time you sign in.');
      navigation.goBack();
    } catch (cause: any) {
      const code = cause?.response?.data?.code;
      setError(code === 'WRONG_PASSWORD' ? 'Your current password is not right.'
        : code === 'SAME_PASSWORD' ? 'Choose a password different from your current one.'
          : cause?.response?.status === 429 ? 'Too many wrong passwords. Wait 15 minutes and try again.'
            : cause?.code === 'ECONNABORTED' ? 'This is taking too long. Check your connection and try again.'
              : 'The app could not change your password. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  return (
    <SettingsPage title="Change password">
      <KeyboardAwareScrollView bottomOffset={24} style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.card}>
          <Field label="Current password" value={current} onChange={(value) => { setCurrent(value); setError(''); }} visible={visible} autoComplete="current-password" editable={!busy} />
          <Field label="New password" value={next} onChange={(value) => { setNext(value); setError(''); }} visible={visible} autoComplete="new-password" editable={!busy}
            problem={tooShort ? `Use at least ${MIN_LENGTH} characters.` : sameAsCurrent ? 'Choose a password different from your current one.' : ''} />
          <Field label="Confirm new password" value={repeat} onChange={(value) => { setRepeat(value); setError(''); }} visible={visible} autoComplete="off" editable={!busy}
            problem={mismatch ? "The new passwords don't match." : ''} ok={repeat.length > 0 && !mismatch && next.length >= MIN_LENGTH} />
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: visible }} onPress={() => setVisible((value) => !value)} style={styles.show}>
            <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={18} color={palette.secondary} />
            <Text style={styles.showText}>{visible ? 'Hide passwords' : 'Show passwords'}</Text>
          </Pressable>
          <Text style={styles.hint}>At least {MIN_LENGTH} characters. Your other devices will be signed out.</Text>
          {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready, busy }} disabled={!ready} onPress={() => void save()}
          style={({ pressed }) => [styles.primary, !ready && styles.disabled, pressed && styles.pressed]}>
          {busy ? <ActivityIndicator color={palette.accentText} /> : <Text style={styles.primaryText}>Change password</Text>}
        </Pressable>
      </KeyboardAwareScrollView>
    </SettingsPage>
  );
}

function Field({ label, value, onChange, visible, autoComplete, editable, problem = '', ok = false }: {
  label: string; value: string; onChange: (value: string) => void; visible: boolean;
  autoComplete: 'current-password' | 'new-password' | 'off'; editable: boolean; problem?: string; ok?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} secureTextEntry={!visible} autoComplete={autoComplete} autoCapitalize="none" autoCorrect={false}
        editable={editable} accessibilityLabel={label} accessibilityHint={problem || undefined}
        style={[styles.input, !!problem && styles.inputProblem, ok && styles.inputOk]} placeholderTextColor={palette.muted} />
      {problem ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.fieldProblem}>{problem}</Text>
        : ok ? <Text style={styles.fieldOk}>✓ Passwords match</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 10, gap: 14 },
  card: { backgroundColor: palette.card, borderRadius: 18, padding: 16, gap: 12 },
  field: { gap: 6 },
  label: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.secondary },
  input: { height: 48, borderRadius: 12, paddingHorizontal: 14, backgroundColor: '#2E2C2F', color: palette.text, fontFamily: 'DMSans_500Medium', fontSize: 15, borderWidth: 1.5, borderColor: 'transparent' },
  inputProblem: { borderColor: palette.danger },
  inputOk: { borderColor: '#4CC38A' },
  fieldProblem: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: palette.danger },
  fieldOk: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#4CC38A' },
  show: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, alignSelf: 'flex-start' },
  showText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.secondary },
  hint: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, color: palette.muted },
  error: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.danger },
  primary: { height: 50, borderRadius: 16, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: palette.accentText },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
