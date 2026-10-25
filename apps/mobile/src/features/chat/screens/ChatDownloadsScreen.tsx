import React, { useMemo, useSyncExternalStore } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File as FileSystemFile } from 'expo-file-system';
import {
  chatDownloadVersion, downloadChatFile, getChatDownloads, pauseChatDownload, removeChatDownload, resumeChatDownload, subscribeChatDownloads,
  type ChatDownloadRecord,
} from '../chatDownloads';
import { SettingsPage, settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { extensionOf, formatBytes, mimeTypeOf, openLocalFile, saveLocalFileToFolder } from '../../../services/localFiles';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** An icon for the file's kind, as a file manager shows it. */
function iconFor(fileName: string): { name: IconName; color: string } {
  const ext = extensionOf(fileName);
  if (ext === 'pdf') return { name: 'document-text', color: '#E5484D' };
  if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) return { name: 'document-text', color: '#3E8BFF' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { name: 'grid', color: '#30A46C' };
  if (['ppt', 'pptx'].includes(ext)) return { name: 'easel', color: '#F76808' };
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return { name: 'image', color: '#8E4EC6' };
  if (['mp4', 'mov', 'webm'].includes(ext)) return { name: 'videocam', color: '#E54666' };
  if (['mp3', 'm4a', 'ogg', 'wav'].includes(ext)) return { name: 'musical-notes', color: '#12A594' };
  if (['zip', 'rar', '7z'].includes(ext)) return { name: 'archive', color: '#A18072' };
  return { name: 'document', color: '#8D8D8D' };
}

function sizeOf(record: ChatDownloadRecord) {
  if (record.status !== 'complete' || !record.localUri) return 0;
  try { return new FileSystemFile(record.localUri).size ?? 0; } catch { return 0; }
}

function statusLine(record: ChatDownloadRecord, size: number) {
  if (record.status === 'downloading') return `Downloading · ${record.progress}%`;
  if (record.status === 'paused') return `Paused · ${record.progress}%`;
  if (record.status === 'failed') return 'Failed · tap to retry';
  if (record.status === 'cancelled') return 'Cancelled · tap to retry';
  const date = new Date(record.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return [formatBytes(size), date].filter(Boolean).join(' · ');
}

/**
 * Settings > Chat downloads: the files saved from chats on this phone. Tap one
 * to open it; save a copy to a folder, or remove it to free space.
 */
export const ChatDownloadsScreen = () => {
  const insets = useSafeAreaInsets();
  const version = useSyncExternalStore(subscribeChatDownloads, chatDownloadVersion, chatDownloadVersion);
  const downloads = useMemo(() => getChatDownloads(), [version]);
  const sizes = useMemo(() => new Map(downloads.map((record) => [record.key, sizeOf(record)])), [downloads]);
  const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  const finished = downloads.filter((record) => record.status === 'complete');

  const open = async (record: ChatDownloadRecord) => {
    if (record.status === 'failed' || record.status === 'cancelled') {
      void downloadChatFile(record.key, record.url, record.fileName).catch(() => Alert.alert('Download failed', 'Check your connection and try again.'));
      return;
    }
    if (record.status !== 'complete' || !record.localUri) return;
    try { await openLocalFile(record.localUri, mimeTypeOf(record.fileName)); }
    catch { Alert.alert('Open failed', 'No installed app can open this file.'); }
  };
  const save = async (record: ChatDownloadRecord) => {
    if (!record.localUri) return;
    try {
      if (await saveLocalFileToFolder(record.localUri, record.fileName, mimeTypeOf(record.fileName))) Alert.alert('Saved', `${record.fileName} was saved.`);
    } catch (error) {
      console.warn('[save] failed:', error instanceof Error ? error.message : error);
      Alert.alert('Save failed', 'The file could not be saved to that folder. Try another folder, such as Downloads.');
    }
  };
  const remove = (record: ChatDownloadRecord) => Alert.alert('Remove this download?', 'It is removed from this phone. You can download it again from the chat.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => removeChatDownload(record.key) },
  ]);
  const clearAll = () => Alert.alert('Clear all downloads?', `${finished.length} ${finished.length === 1 ? 'file' : 'files'}, ${formatBytes(total) || '0 KB'}, are removed from this phone. Chats keep them, to download again.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear all', style: 'destructive', onPress: () => finished.forEach((record) => removeChatDownload(record.key)) },
  ]);

  return <SettingsPage title="Chat downloads" action={finished.length ? (
    <Pressable onPress={clearAll} accessibilityRole="button" accessibilityLabel="Clear all downloads" hitSlop={8} style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
      <Text style={styles.headerActionText}>Clear all</Text>
    </Pressable>
  ) : undefined}>
    <FlatList
      data={downloads}
      keyExtractor={(item) => item.key}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={downloads.length ? [styles.list, { paddingBottom: insets.bottom + 24 }] : styles.emptyList}
      ListHeaderComponent={downloads.length ? (
        <Text style={styles.summary}>{finished.length} {finished.length === 1 ? 'file' : 'files'} on this phone{total ? ` · ${formatBytes(total)}` : ''}</Text>
      ) : null}
      ListEmptyComponent={<View style={styles.empty}>
        <View style={styles.emptyIcon}><Ionicons name="download-outline" size={30} color={palette.accent} /></View>
        <Text style={styles.emptyTitle}>No downloads yet</Text>
        <Text style={styles.emptyText}>Files you open from your chats are kept here, ready without the internet.</Text>
      </View>}
      renderItem={({ item }) => {
        const icon = iconFor(item.fileName);
        const size = sizes.get(item.key) ?? 0;
        const moving = item.status === 'downloading' || item.status === 'paused';
        return <Pressable onPress={() => void open(item)} accessibilityRole="button" accessibilityLabel={`${item.fileName}, ${statusLine(item, size)}`}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <View style={[styles.icon, { backgroundColor: icon.color }]}><Ionicons name={icon.name} size={22} color="#fff" /></View>
          <View style={styles.copy}>
            <Text style={styles.name} numberOfLines={2}>{item.fileName}</Text>
            <Text style={[styles.status, item.status === 'failed' && { color: palette.danger }]}>{statusLine(item, size)}</Text>
            {moving ? <View style={styles.track}><View style={[styles.progress, { width: `${item.progress}%` }]} /></View> : null}
          </View>
          {item.status === 'downloading' ? <RowAction icon="pause" label="Pause download" onPress={() => void pauseChatDownload(item.key)} /> : null}
          {item.status === 'paused' ? <RowAction icon="play" label="Resume download" onPress={() => void resumeChatDownload(item.key)} /> : null}
          {item.status === 'complete' ? <RowAction icon="download-outline" label="Save to phone" onPress={() => void save(item)} /> : null}
          <RowAction icon="trash-outline" label="Remove download" danger onPress={() => remove(item)} />
        </Pressable>;
      }}
    />
  </SettingsPage>;
};

function RowAction({ icon, label, onPress, danger = false }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
    <Ionicons name={icon} size={20} color={danger ? palette.danger : palette.icon} />
  </Pressable>;
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 4 },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32 },
  summary: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.secondary, marginBottom: 8, marginLeft: 2 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.separator },
  icon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  name: { fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 20, color: palette.text },
  status: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: palette.muted, marginTop: 2 },
  track: { height: 3, backgroundColor: '#3A383C', borderRadius: 2, overflow: 'hidden', marginTop: 6 },
  progress: { height: '100%', backgroundColor: '#35D07F' },
  action: { width: 38, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerAction: { minWidth: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerActionText: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: palette.accent },
  empty: { alignItems: 'center' },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: palette.card, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontFamily: 'DMSans_700Bold', fontSize: 18, color: palette.text },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: palette.secondary, textAlign: 'center', marginTop: 6 },
  pressed: { opacity: 0.7 },
});
