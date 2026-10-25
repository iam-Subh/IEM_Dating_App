import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { colors } from '../../../core/theme/colors';
import { Message } from '../../../store/chatSlice';
import { videoPosterKey } from '../videoPosters';
import { peekSentMediaUri, resolveCachedMedia } from '../sentMediaCache';
import { openChatAtMessage } from '../openChatAtMessage';
import {
  fileNameOf, formatSize, formatVoiceDuration, hostOf, itemsFor, SharedItem, SharedPage, SharedType,
} from '../sharedMediaItems';

const TABS: Array<{ key: SharedType; label: string }> = [
  { key: 'media', label: 'Media' },
  { key: 'document', label: 'Files' },
  { key: 'voice', label: 'Voice' },
  { key: 'link', label: 'Links' },
];

/**
 * Thumbnails come from the same on-disk cache as the chat bubbles, keyed by
 * media key. The grid used to ask for a fresh presigned URL per cell on every
 * visit, and a presigned URL is a new address to the image cache, so every
 * photo downloaded again each time the tab was opened.
 */
function SharedThumbnail({ mediaKey }: { mediaKey: string }) {
  const posterKey = videoPosterKey(mediaKey);
  const readKey = posterKey ?? mediaKey;
  // The file this cell wants is usually already on the device, and its path can
  // be had without waiting. Asking for it through the query alone left the cell
  // empty for as long as that took to answer, which is a grid of blanks filling
  // in one by one on a tab that has been opened before.
  const onDevice = peekSentMediaUri(readKey);
  const { data } = useQuery({
    queryKey: ['chat-media-file', readKey],
    queryFn: () => resolveCachedMedia(readKey, async () => {
      const response = await api.get('/chat/media/read', { params: { key: readKey } });
      if (!response.data?.success || typeof response.data.data !== 'string') throw new Error('Media URL unavailable');
      return response.data.data as string;
    }),
    initialData: onDevice ?? undefined,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
  const uri = data ?? onDevice;
  return (
    <View style={styles.thumbnail}>
      {uri ? <Image source={{ uri }} style={styles.thumbnail} resizeMode="cover" fadeDuration={0} /> : null}
      {posterKey ? <View pointerEvents="none" style={styles.playBadge}><Ionicons name="play" size={16} color="#fff" /></View> : null}
    </View>
  );
}

/**
 * Each tab is its own cached query, the way Telegram keeps a separate shared
 * media list per type. The old screen kept one array for every tab: switching
 * tabs while a page was loading let the previous tab's response land in the new
 * tab (media messages drawn as rows named "Document"), and the in-flight guard
 * skipped the new tab's own request, so the grid showed only a few photos.
 * Separate keys make that impossible, and a visited tab reopens from memory.
 */
function useSharedList(matchId: string, type: SharedType) {
  return useInfiniteQuery({
    queryKey: ['chat-shared', matchId, type],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const response = await api.get(`/chat/${matchId}/shared`, {
        params: { type, limit: type === 'media' ? 60 : 40, ...(pageParam ? { cursor: pageParam } : {}) },
      });
      return response.data.data as SharedPage & { messages: Message[] };
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : null),
    staleTime: 30 * 1000,
  });
}

export const SharedMediaScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { matchId, userName, userAvatar, userId } = route.params;
  const [type, setType] = useState<SharedType>('media');
  const query = useSharedList(matchId, type);
  const items = useMemo(() => itemsFor(type, query.data?.pages), [type, query.data]);

  const openMessage = useCallback((message: Message) => {
    openChatAtMessage(navigation, { matchId, userName, userAvatar, userId, focusMessageId: message.id });
  }, [matchId, navigation, userAvatar, userId, userName]);

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const renderItem = useCallback(({ item }: { item: SharedItem<Message> }) => {
    if (item.kind === 'media') {
      return (
        <TouchableOpacity style={styles.mediaCell} activeOpacity={0.8} onPress={() => openMessage(item.message)}>
          <SharedThumbnail mediaKey={item.mediaKey} />
        </TouchableOpacity>
      );
    }
    const { message } = item;
    const date = new Date(message.sentAt).toLocaleDateString();
    if (type === 'link' && item.url) {
      const url = item.url;
      const rest = message.content.trim() !== url ? message.content.trim() : '';
      // Tapping a link opens it, as in Telegram; the arrow shows it in the chat.
      return (
        <TouchableOpacity style={styles.row} onPress={() => void Linking.openURL(url)} onLongPress={() => openMessage(message)} accessibilityRole="link">
          <View style={styles.rowIcon}><Ionicons name="link" size={23} color="#fff" /></View>
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle} numberOfLines={1}>{hostOf(url)}</Text>
            <Text style={styles.rowLink} numberOfLines={1}>{url}</Text>
            {rest ? <Text style={styles.rowMeta} numberOfLines={1}>{rest}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => openMessage(message)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Show in chat">
            <Ionicons name="chevron-forward" size={20} color={colors.text.tertiary} />
          </TouchableOpacity>
        </TouchableOpacity>
      );
    }
    const isVoice = type === 'voice';
    const document = message.metadata?.document as { size?: number } | undefined;
    const title = isVoice ? 'Voice message' : fileNameOf(message);
    const detail = isVoice ? formatVoiceDuration(message.content) : formatSize(document?.size);
    return (
      <TouchableOpacity style={styles.row} onPress={() => openMessage(message)}>
        <View style={styles.rowIcon}><Ionicons name={isVoice ? 'mic' : 'document-text'} size={23} color="#fff" /></View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.rowMeta}>{detail ? `${detail} · ${date}` : date}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.text.tertiary} />
      </TouchableOpacity>
    );
  }, [openMessage, type]);

  const firstLoad = query.isPending;
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back"><Ionicons name="arrow-back" size={25} color="#fff" /></TouchableOpacity>
        <Text style={styles.title}>Shared media</Text><View style={{ width: 25 }} />
      </View>
      <View style={styles.tabs}>
        {TABS.map((tab) => <TouchableOpacity key={tab.key} onPress={() => setType(tab.key)} style={[styles.tab, type === tab.key && styles.tabActive]}><Text style={[styles.tabText, type === tab.key && styles.tabTextActive]}>{tab.label}</Text></TouchableOpacity>)}
      </View>
      <FlatList
        key={type}
        data={items}
        numColumns={type === 'media' ? 3 : 1}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        initialNumToRender={type === 'media' ? 24 : 12}
        windowSize={9}
        contentContainerStyle={items.length ? styles.list : styles.emptyList}
        ListEmptyComponent={firstLoad
          ? <ActivityIndicator color={colors.primary} />
          : query.isError
            ? <TouchableOpacity onPress={() => void query.refetch()}><Text style={styles.empty}>Couldn't load. Tap to retry.</Text></TouchableOpacity>
            : <Text style={styles.empty}>No {TABS.find((tab) => tab.key === type)?.label.toLowerCase()} yet.</Text>}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: 18 }} /> : null}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#100F0D', paddingTop: 42 },
  header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 19, fontWeight: '700' },
  tabs: { flexDirection: 'row', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#343236' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { color: colors.text.tertiary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: colors.primary },
  list: { padding: 2 }, emptyList: { flexGrow: 1, justifyContent: 'center' },
  mediaCell: { width: '33.333%', aspectRatio: 1, padding: 1 },
  thumbnail: { width: '100%', height: '100%', backgroundColor: '#1C1C1C' },
  playBadge: { position: 'absolute', right: 6, bottom: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  row: { marginHorizontal: 12, minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#302E31' },
  rowIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1 }, rowTitle: { color: '#fff', fontSize: 15, lineHeight: 19 }, rowMeta: { color: colors.text.tertiary, fontSize: 12, marginTop: 2 },
  rowLink: { color: colors.primary, fontSize: 13, marginTop: 1 },
  empty: { color: colors.text.tertiary, textAlign: 'center' },
});
