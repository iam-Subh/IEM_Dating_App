import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsEmptyState, SettingsPage, SettingsPersonRow, settingsLayout, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { writeToSupport } from '../../core/support';
import { api } from '../../services/api';
import { openReport } from './ReportSheet';

type Person = { id: string; name: string; photo: string | null; how: 'unmatched' | 'blocked' | 'blocked_you'; at: string; matchId: string | null };
const HOW: Record<Person['how'], string> = { unmatched: 'Match ended', blocked: 'You blocked them', blocked_you: 'No longer available' };

/**
 * Settings > Safety and help > Report someone (docs/SAFETY_AND_LEGAL.md 2.2):
 * people whose chat is gone - unmatched, blocked, or who blocked you - can
 * still be reported, as Tinder allows. Anything else goes to support by email.
 */
export function ReportSomeoneScreen() {
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const load = useCallback(async () => {
    setFailed(false);
    try { setPeople((await api.get('/safety/reportable')).data.data ?? []); } catch { setFailed(true); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const report = async (person: Person) => {
    const result = await openReport({
      userId: person.id, name: person.name, sourceType: 'profile', sourceId: person.id,
      ...(person.matchId ? { matchId: person.matchId } : {}),
      // Someone who blocked you, or you blocked, is already out of sight.
      canBlock: person.how === 'unmatched',
    });
    if (result.sent) setReported((current) => new Set(current).add(person.id));
  };

  return <SettingsPage title="Report someone">
    <View style={styles.header}>
      <View style={styles.privacy}>
        <Ionicons name="shield-checkmark-outline" size={18} color={palette.secondary} />
        <Text style={styles.privacyText}>Reports are private. The person will not see your name.</Text>
      </View>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Past connections</Text>
        {!!people?.length && <Text style={styles.count}>{people.length}</Text>}
      </View>
    </View>
    <View style={styles.body}>
    {!people ? (failed
      ? <SettingsEmptyState icon="cloud-offline-outline" title="Could not load" message="Check your connection and try again." onRetry={() => void load()} />
      : <View style={settingsLayout.loading}><ActivityIndicator color={palette.accent} /></View>)
      : <FlatList data={people} keyExtractor={(item) => item.id} showsVerticalScrollIndicator={false} style={styles.scroll}
        contentContainerStyle={[styles.list, people.length === 0 && styles.emptyList]}
        ListEmptyComponent={<View style={styles.empty}>
          <View style={styles.emptyIcon}><Ionicons name="person-remove-outline" size={22} color={palette.secondary} /></View>
          <Text style={styles.emptyTitle}>No profiles to show</Text>
          <Text style={styles.emptyText}>People you unmatch or block will appear here.</Text>
        </View>}
        renderItem={({ item, index }) => <Pressable accessibilityRole="button" accessibilityLabel={`Report ${item.name}`} onPress={() => void report(item)}
          style={({ pressed }) => pressed && styles.pressed}>
          <SettingsPersonRow name={item.name} uri={item.photo} note={HOW[item.how]} first={index === 0} last={index === people.length - 1}>
            {reported.has(item.id) ? <Text style={styles.done}>Reported</Text> : <Text style={styles.action}>Report</Text>}
          </SettingsPersonRow>
        </Pressable>} />}
    </View>
    <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
      <Pressable accessibilityRole="button" onPress={() => void writeToSupport('Report', 'Who (their name in the app):\nWhat happened:\nWhen:\n')}
        style={({ pressed }) => [styles.mail, pressed && styles.pressed]}>
        <Ionicons name="mail-outline" size={20} color={palette.text} />
        <View style={styles.mailCopy}>
          <Text style={styles.mailTitle}>Someone not listed?</Text>
          <Text style={styles.mailNote}>Email our team about another person or an offline incident.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.muted} />
      </Pressable>
    </View>
  </SettingsPage>;
}

const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  list: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  header: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  privacyText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: palette.secondary },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24 },
  sectionTitle: { fontFamily: 'DMSans_700Bold', fontSize: 15, lineHeight: 21, color: palette.text },
  count: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.muted },
  action: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: palette.accent },
  done: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.muted },
  empty: { paddingHorizontal: 16, paddingVertical: 24, alignItems: 'center' },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.card, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontFamily: 'DMSans_700Bold', fontSize: 16, lineHeight: 22, color: palette.text },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: palette.secondary, textAlign: 'center', marginTop: 6, maxWidth: 260 },
  footer: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 12 },
  mail: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, padding: 14, borderRadius: 16, backgroundColor: palette.card },
  mailCopy: { flex: 1, minWidth: 0 },
  mailTitle: { fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 20, color: palette.text },
  mailNote: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, color: palette.secondary, marginTop: 3 },
  pressed: { opacity: 0.7 },
});
