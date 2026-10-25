import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

/**
 * One password, asked in place: "Add a password" in Settings > Account, and
 * "enter your password once to connect Google" at sign-in
 * (features/auth/GOOGLE_SIGNUP_PLAN.md 1.2). Android has no prompt dialog, so
 * this is a small sheet of its own.
 */
export function PasswordPromptModal({ visible, title, message, confirmLabel, minLength = 1, busy, error, onSubmit, onCancel }: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** 8 when the password is new; 1 when it is an existing one being checked. */
  minLength?: number;
  busy?: boolean;
  error?: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!visible) { setPassword(''); setShown(false); } }, [visible]);
  const ready = password.length >= minLength && !busy;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} accessibilityLabel="Cancel" />
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!shown}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Password"
            placeholderTextColor="#A58F9F"
            editable={!busy}
            onSubmitEditing={() => ready && onSubmit(password)}
            returnKeyType="done"
          />
          <Pressable onPress={() => setShown((value) => !value)} hitSlop={10} accessibilityRole="button">
            <Text style={styles.show}>{shown ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>
        {minLength > 1 && <Text style={styles.hint}>At least {minLength} characters.</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.buttons}>
          <Pressable style={styles.secondary} onPress={onCancel} disabled={busy} accessibilityRole="button">
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
          <Pressable style={[styles.primary, !ready && styles.disabled]} disabled={!ready} onPress={() => onSubmit(password)} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#FBF1F7" /> : <Text style={styles.primaryText}>{confirmLabel}</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#251C24', borderRadius: 22, padding: 22 },
  title: { fontFamily: 'DMSans_400Regular', color: '#FBF1F7', fontSize: 19, fontWeight: '700' },
  message: { fontFamily: 'DMSans_400Regular', color: '#C7B4C2', fontSize: 14, lineHeight: 20, marginTop: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#887181', borderRadius: 14, marginTop: 18, paddingRight: 14 },
  input: { flex: 1, color: '#FBF1F7', fontSize: 16, padding: 14 },
  show: { fontFamily: 'DMSans_400Regular', color: '#F1A3C4', fontSize: 13, fontWeight: '600' },
  hint: { fontFamily: 'DMSans_400Regular', color: '#A58F9F', fontSize: 12, marginTop: 6 },
  error: { fontFamily: 'DMSans_400Regular', color: '#FF9B99', fontSize: 13, marginTop: 10 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 20 },
  secondary: { flex: 1, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#887181', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: 'DMSans_400Regular', color: '#FBF1F7', fontSize: 15, fontWeight: '600' },
  primary: { flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: '#E47CA6', alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'DMSans_400Regular', color: '#2A1922', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
