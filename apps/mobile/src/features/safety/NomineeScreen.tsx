import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsPage, settingsLayout, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { api } from '../../services/api';

type Nominee = { name: string; contact: string; relation?: string };

/**
 * Settings > Account > Nominee (DPDP Act, section 14): someone who may use
 * your data rights - a copy, or deleting your account - if you die or can't.
 * They are not told, and get no access to the app.
 */
export function NomineeScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<Nominee | null>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [relation, setRelation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/account/nominee').then((response) => {
      const value = response.data.data as Nominee | null;
      setSaved(value);
      if (value) { setName(value.name); setContact(value.contact); setRelation(value.relation ?? ''); }
    }).catch(() => setError('Could not load. Check your connection.')).finally(() => setLoading(false));
  }, []);
  const save = async (next: Nominee | null) => {
    setBusy(true); setError('');
    try {
      await api.put('/account/nominee', { nominee: next });
      navigation.goBack();
    } catch {
      setError(next ? 'Add a name and a phone number or email.' : 'Could not remove. Try again.');
    } finally { setBusy(false); }
  };
  const ready = name.trim().length >= 2 && contact.trim().length >= 5 && !busy;
  return <SettingsPage title="Nominee">
    {loading ? <View style={settingsLayout.loading}><ActivityIndicator color={palette.accent} /></View>
      : <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.intro}>Under India's data protection law you can name someone to ask us for a copy of your data, or to delete your account, if you die or can't do it yourself. They aren't told, and can't see or use your account.</Text>
        <Field label="Their name" value={name} onChange={setName} />
        <Field label="Their phone number or email" value={contact} onChange={setContact} email />
        <Field label="How you know them (optional)" value={relation} onChange={setRelation} short />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={!ready}
          onPress={() => void save({ name: name.trim(), contact: contact.trim(), ...(relation.trim() ? { relation: relation.trim() } : {}) })}
          style={({ pressed }) => [styles.primary, !ready && styles.disabled, pressed && styles.pressed]}>
          {busy ? <ActivityIndicator color={palette.accentText} /> : <Text style={styles.primaryText}>Save</Text>}
        </Pressable>
        {saved ? <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary}
          onPress={() => Alert.alert('Remove your nominee?', undefined, [
            { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void save(null) },
          ])}><Text style={styles.secondaryText}>Remove nominee</Text></Pressable> : null}
      </KeyboardAwareScrollView>}
  </SettingsPage>;
}

function Field({ label, value, onChange, email = false, short = false }: { label: string; value: string; onChange: (value: string) => void; email?: boolean; short?: boolean }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} maxLength={short ? 40 : 120} keyboardType={email ? 'email-address' : 'default'}
      autoCapitalize={email ? 'none' : 'words'} style={styles.input} accessibilityLabel={label} placeholderTextColor={palette.muted} />
  </View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8 },
  intro: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: palette.secondary },
  field: { marginTop: 16, gap: 6 },
  label: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.secondary },
  input: { height: 48, borderRadius: 14, backgroundColor: palette.card, color: palette.text, paddingHorizontal: 14, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  error: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.danger, marginTop: 12 },
  primary: { minHeight: 52, borderRadius: 26, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: palette.accentText },
  secondary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  secondaryText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: palette.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
