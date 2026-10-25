import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useDispatch } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { updateUser } from '../../store/authSlice';
import { logoutSession } from '../../services/sessionLogout';
import { acceptLegal, type LegalSlug } from './legal';

const DOCS: { slug: LegalSlug; title: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { slug: 'terms', title: 'Terms of Service', icon: 'document-text-outline' },
  { slug: 'privacy', title: 'Privacy Policy', icon: 'lock-closed-outline' },
  { slug: 'guidelines', title: 'Community Guidelines', icon: 'people-outline' },
];

/**
 * Before the app opens for an account that hasn't agreed to the current Terms
 * (an account from before they existed, or after a change in substance):
 * read them, agree, carry on. Signing out is the other way out.
 */
export function TermsUpdateScreen() {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const agree = async () => {
    setBusy(true); setError('');
    try {
      const result = await acceptLegal();
      dispatch(updateUser({ termsVersion: result.termsVersion } as any));
    } catch {
      setError('That did not go through. Check your connection and try again.');
    } finally { setBusy(false); }
  };
  return <View style={[styles.page, { paddingTop: insets.top }]}>
    <StatusBar barStyle="light-content" backgroundColor="#100F0D" />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
      <Image source={require('../../../assets/illustrations/community-shield-3d.png')} style={styles.art} resizeMode="contain" accessible={false} />
      <Text accessibilityRole="header" style={styles.title}>Our Terms and Privacy Policy</Text>
      <Text style={styles.body}>To keep using IEM Connect, read and agree to how the app works, how we look after your data, and the rules everyone follows.</Text>
      <View style={styles.docs}>
        {DOCS.map((doc, index) => <Pressable key={doc.slug} accessibilityRole="button" onPress={() => navigation.navigate('Legal', { slug: doc.slug })}
          style={({ pressed }) => [styles.doc, index > 0 && styles.docLine, pressed && styles.pressed]}>
          <Ionicons name={doc.icon} size={19} color={palette.icon} />
          <Text style={styles.docTitle}>{doc.title}</Text>
          <Ionicons name="chevron-forward" size={18} color={palette.muted} />
        </Pressable>)}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void agree()} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
        {busy ? <ActivityIndicator color={palette.accentText} /> : <Text style={styles.primaryText}>I agree</Text>}
      </Pressable>
      <Text style={styles.fine}>By tapping I agree, you accept the Terms of Service and Privacy Policy, and confirm you are 18 or over.</Text>
      <Pressable accessibilityRole="button" onPress={() => void logoutSession()} style={styles.secondary}>
        <Text style={styles.secondaryText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#100F0D' },
  content: { paddingHorizontal: 24, paddingTop: 24, maxWidth: 560, width: '100%', alignSelf: 'center' },
  art: { width: 140, height: 140, alignSelf: 'center' },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 24, lineHeight: 30, color: palette.text, textAlign: 'center', marginTop: 12 },
  body: { fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22, color: palette.secondary, textAlign: 'center', marginTop: 10 },
  docs: { marginTop: 24, backgroundColor: palette.card, borderRadius: 18 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 16 },
  docLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
  docTitle: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 15, color: palette.text },
  error: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.danger, textAlign: 'center', marginTop: 14 },
  primary: { minHeight: 52, borderRadius: 26, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: palette.accentText },
  fine: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, color: palette.muted, textAlign: 'center', marginTop: 12 },
  secondary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  secondaryText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: palette.secondary },
  pressed: { opacity: 0.75 },
});
