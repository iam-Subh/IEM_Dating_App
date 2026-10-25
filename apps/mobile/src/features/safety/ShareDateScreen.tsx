import React, { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsPage, settingsPalette as palette } from '../../core/settings/SettingsLayout';

/**
 * Chat info > Share date plans (as Tinder and Hinge's "Save my date"): who,
 * where and when, sent to a friend through any app the phone has. Nothing is
 * stored, and the match is not told.
 */
export function ShareDateScreen() {
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const name: string = route.params?.userName ?? 'my match';
  const [where, setWhere] = useState('');
  const [when, setWhen] = useState('');
  const [back, setBack] = useState('');
  const ready = !!where.trim() && !!when.trim();
  const share = () => {
    const lines = [
      `Heads up: I'm meeting ${name} (from IEM Connect).`,
      `Where: ${where.trim()}`,
      `When: ${when.trim()}`,
      back.trim() ? `If you haven't heard from me by ${back.trim()}, please check on me.` : "Check on me if you don't hear from me after.",
      '',
      'In an emergency call 112.',
    ];
    void Share.share({ message: lines.join('\n') }).catch(() => undefined);
  };
  return <SettingsPage title="Share date plans">
    <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.intro}>Let a friend know who you're meeting, where and when. It goes through WhatsApp, SMS or any app you choose - {name} isn't told.</Text>
      <Field label="Where" value={where} onChange={setWhere} placeholder="Cafe near the Gurukul gate" />
      <Field label="When" value={when} onChange={setWhen} placeholder="Saturday, 5 pm" />
      <Field label="Check on me if I'm not back by (optional)" value={back} onChange={setBack} placeholder="8 pm" />
      <Pressable accessibilityRole="button" disabled={!ready} onPress={share} style={({ pressed }) => [styles.primary, !ready && styles.disabled, pressed && styles.pressed]}>
        <Ionicons name="share-outline" size={18} color={palette.accentText} /><Text style={styles.primaryText}>Share with a friend</Text>
      </Pressable>
      <Text style={styles.tip}>Meet somewhere public, keep your phone charged, and leave whenever you want to.</Text>
    </KeyboardAwareScrollView>
  </SettingsPage>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={palette.muted} maxLength={120}
      style={styles.input} accessibilityLabel={label} />
  </View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8 },
  intro: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: palette.secondary, marginBottom: 6 },
  field: { marginTop: 16, gap: 6 },
  label: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.secondary },
  input: { height: 48, borderRadius: 14, backgroundColor: palette.card, color: palette.text, paddingHorizontal: 14, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  primary: { flexDirection: 'row', gap: 8, minHeight: 52, borderRadius: 26, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: palette.accentText },
  tip: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, color: palette.muted, textAlign: 'center', marginTop: 14 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
