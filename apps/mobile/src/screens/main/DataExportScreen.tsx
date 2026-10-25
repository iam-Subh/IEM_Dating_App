import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File as FileSystemFile, Paths } from 'expo-file-system';
import { SettingsPage, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { api } from '../../services/api';
import { formatBytes, openLocalFile, saveLocalFileToFolder } from '../../services/localFiles';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const INCLUDED: { icon: IconName; text: string }[] = [
  { icon: 'person-outline', text: 'Your profile, photos (as links) and settings' },
  { icon: 'chatbubbles-outline', text: 'Your matches and the messages in them' },
  { icon: 'heart-outline', text: 'Your likes, passes and Roses' },
  { icon: 'aperture-outline', text: 'Your stories, follows and Close Friends list' },
  { icon: 'notifications-outline', text: 'Your notifications, blocks and reports' },
];

type Ready = { uri: string; fileName: string; size: number };

/**
 * Settings > Export my data: everything the app keeps about you, as one JSON
 * file on this phone - saved to a folder you pick, or opened in another app.
 */
export function DataExportScreen() {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);

  const prepare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await api.post('/account/exports');
      const request = await api.get(`/account/requests/${created.data.data.id}`);
      const data = request.data.data.result;
      if (!data) throw new Error('Export is empty');
      const day = new Date().toISOString().slice(0, 10);
      const fileName = `iem-connect-data-${day}.json`;
      const file = new FileSystemFile(Paths.cache, fileName);
      if (file.exists) file.delete();
      file.create();
      file.write(JSON.stringify(data, null, 2));
      setReady({ uri: file.uri, fileName, size: file.size ?? 0 });
    } catch {
      Alert.alert('Export failed', 'The app could not prepare your data. Check your connection and try again.');
    } finally { setBusy(false); }
  };
  const save = async () => {
    if (!ready) return;
    try {
      if (await saveLocalFileToFolder(ready.uri, ready.fileName, 'application/json')) Alert.alert('Saved', `${ready.fileName} was saved.`);
    } catch (error) {
      console.warn('[save] failed:', error instanceof Error ? error.message : error);
      Alert.alert('Save failed', 'The file could not be saved to that folder. Try another folder, such as Downloads.');
    }
  };
  const open = async () => {
    if (!ready) return;
    try { await openLocalFile(ready.uri, 'application/json'); }
    catch { Alert.alert('Open failed', 'No installed app can open JSON files. Save it instead.'); }
  };

  return (
    <SettingsPage title="Export my data">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.card}>
          <Text style={styles.heading}>What's included</Text>
          {INCLUDED.map((item) => (
            <View key={item.text} style={styles.point}>
              <Ionicons name={item.icon} size={19} color={palette.icon} />
              <Text style={styles.pointText}>{item.text}</Text>
            </View>
          ))}
          <Text style={styles.hint}>One JSON file, readable by any computer. It stays on this phone until you save or share it - keep it somewhere safe, it holds your private messages.</Text>
        </View>

        {ready ? (
          <View style={styles.card}>
            <View style={styles.file}>
              <View style={styles.fileIcon}><Ionicons name="document-text" size={22} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName} numberOfLines={1}>{ready.fileName}</Text>
                <Text style={styles.fileMeta}>{formatBytes(ready.size)} · Ready</Text>
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={() => void save()} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
              <Ionicons name="download-outline" size={18} color={palette.accentText} />
              <Text style={styles.primaryText}>Save to phone</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void open()} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
              <Text style={styles.secondaryText}>Open</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void prepare()} style={styles.link}>
              <Text style={styles.linkText}>{busy ? 'Preparing…' : 'Prepare again'}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityState={{ busy }} disabled={busy} onPress={() => void prepare()}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed, busy && styles.busy]}>
            {busy ? <ActivityIndicator color={palette.accentText} /> : <>
              <Ionicons name="archive-outline" size={18} color={palette.accentText} />
              <Text style={styles.primaryText}>Prepare my data</Text>
            </>}
          </Pressable>
        )}
      </ScrollView>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  card: { backgroundColor: palette.card, borderRadius: 18, padding: 16, gap: 12 },
  heading: { fontFamily: 'DMSans_700Bold', fontSize: 16, color: palette.text },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointText: { flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: palette.text },
  hint: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 18, color: palette.secondary },
  file: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fileIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#3E8BFF', alignItems: 'center', justifyContent: 'center' },
  fileName: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: palette.text },
  fileMeta: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: palette.muted, marginTop: 2 },
  primary: { height: 50, borderRadius: 16, backgroundColor: palette.accent, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: palette.accentText },
  secondary: { height: 46, borderRadius: 14, backgroundColor: '#363337', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: palette.text },
  link: { height: 36, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: palette.secondary },
  busy: { opacity: 0.7 },
  pressed: { opacity: 0.75 },
});
