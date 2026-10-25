import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsEmptyState, SettingsPage, settingsLayout, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { SUPPORT_EMAIL, writeToSupport } from '../../core/support';
import { cachedLegal, loadLegal, type LegalBlock, type LegalDocument, type LegalSlug } from './legal';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** India's numbers for help now (Safety Centre). */
export const HELPLINES: { label: string; number: string; icon: IconName; note: string }[] = [
  { label: 'Emergency', number: '112', icon: 'alert-circle', note: 'Police, fire, ambulance' },
  { label: "Women's helpline", number: '181', icon: 'shield-half', note: '24 hours, across India' },
  { label: 'Cyber crime', number: '1930', icon: 'globe-outline', note: 'Or cybercrime.gov.in' },
  { label: 'Mental health (Tele-MANAS)', number: '14416', icon: 'heart-circle-outline', note: 'Free, confidential' },
];

/**
 * Settings > Safety and help / Legal: one published document, drawn natively
 * from the server (legal/documents.ts) - the same text as the public web page.
 */
export function LegalScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const slug = (route.params?.slug ?? 'terms') as LegalSlug;
  const [doc, setDoc] = useState<LegalDocument | null>(() => cachedLegal(slug));
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try { setDoc(await loadLegal(slug)); } catch { if (!cachedLegal(slug)) setFailed(true); }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  return <SettingsPage title={doc?.title ?? (slug === 'safety' ? 'Safety Centre' : 'Legal')}>
    {!doc ? (failed
      ? <SettingsEmptyState icon="cloud-offline-outline" title="Could not load this page" message="Check your connection and try again." onRetry={() => void load()} />
      : <View style={settingsLayout.loading}><ActivityIndicator color={palette.accent} /></View>)
      : <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.summary}>{doc.summary}</Text>
        <Text style={styles.updated}>Last updated {new Date(doc.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</Text>

        {slug === 'safety' ? <View style={styles.helpCard}>
          <Text style={styles.helpTitle}>Get help now</Text>
          {HELPLINES.map((line) => <Pressable key={line.number} accessibilityRole="button" accessibilityLabel={`Call ${line.label}, ${line.number}`}
            onPress={() => void Linking.openURL(`tel:${line.number}`)} style={({ pressed }) => [styles.helpRow, pressed && styles.pressed]}>
            <View style={styles.helpIcon}><Ionicons name={line.icon} size={18} color={palette.accent} /></View>
            <View style={{ flex: 1 }}><Text style={styles.helpLabel}>{line.label}</Text><Text style={styles.helpNote}>{line.note}</Text></View>
            <Text style={styles.helpNumber}>{line.number}</Text>
            <View style={styles.callButton}><Ionicons name="call" size={16} color={palette.accent} /></View>
          </Pressable>)}
        </View> : null}

        {doc.sections.map((section) => <View key={section.heading} style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>{section.heading}</Text>
          {section.blocks.map((block, index) => <Block key={index} block={block} />)}
        </View>)}

        {slug === 'safety' ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ReportSomeone')} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Ionicons name="flag-outline" size={18} color={palette.text} /><Text style={styles.actionText}>Report someone you met here</Text>
          <Ionicons name="chevron-forward" size={18} color={palette.muted} />
        </Pressable> : null}
        <Pressable accessibilityRole="button" onPress={() => void writeToSupport(slug === 'grievance' ? 'Grievance' : slug === 'child-safety' ? 'Child safety' : `Question about the ${doc.title}`)}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Ionicons name="mail-outline" size={18} color={palette.text} />
          <Text style={styles.actionText}>{slug === 'grievance' ? 'Write to the Grievance Officer' : 'Write to us'}</Text>
          <Ionicons name="chevron-forward" size={18} color={palette.muted} />
        </Pressable>
        <Text style={styles.contact}>{SUPPORT_EMAIL}</Text>
      </ScrollView>}
  </SettingsPage>;
}

function Block({ block }: { block: LegalBlock }) {
  if (block.type === 'list') {
    return <View style={styles.list}>{block.items.map((item) => <View key={item} style={styles.item}>
      <Text style={styles.bullet}>•</Text><Text style={styles.body}>{item}</Text>
    </View>)}</View>;
  }
  if (block.type === 'note') return <View style={styles.note}><Text style={styles.noteText}>{block.text}</Text></View>;
  return <Text style={styles.body}>{block.text}</Text>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6 },
  summary: { fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22, color: palette.secondary },
  updated: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: palette.muted, marginTop: 8 },
  section: { marginTop: 24 },
  heading: { fontFamily: 'DMSans_700Bold', fontSize: 16, lineHeight: 22, color: palette.text, marginBottom: 8 },
  body: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, color: palette.secondary, marginBottom: 6 },
  list: { gap: 2, marginBottom: 4 },
  item: { flexDirection: 'row', gap: 8 },
  bullet: { fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 21, color: palette.accent },
  note: { backgroundColor: palette.card, borderRadius: 14, padding: 14 },
  noteText: { fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 21, color: palette.text },
  helpCard: { marginTop: 20, backgroundColor: palette.card, borderRadius: 18, paddingVertical: 6 },
  helpTitle: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: palette.secondary, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, letterSpacing: 0.3 },
  helpRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  helpIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.dangerSurface, alignItems: 'center', justifyContent: 'center' },
  helpLabel: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: palette.text },
  helpNote: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: palette.muted, marginTop: 1 },
  helpNumber: { fontFamily: 'DMSans_700Bold', fontSize: 16, color: palette.text, fontVariant: ['tabular-nums'] },
  callButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#343234', alignItems: 'center', justifyContent: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, borderRadius: 16, backgroundColor: palette.card, marginTop: 12 },
  actionText: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 14, color: palette.text },
  contact: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: palette.muted, textAlign: 'center', marginTop: 14 },
  pressed: { opacity: 0.7 },
});
