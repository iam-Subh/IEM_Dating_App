import React, { useEffect, useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  Dimensions,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../store';
import { api } from '../../services/api';
import {
  setConversations,
  appendConversations,
  setLoadingConversations,
  Conversation,
} from '../../store/chatSlice';
import { colors } from '../../core/theme/colors';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getSocket, initSocket } from '../../services/socket';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop';

function formatTime(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const ConversationItem = ({ item, currentUserId }: { item: Conversation; currentUserId: string }) => {
  const navigation = useNavigation<any>();
  const isUnread = item.unreadCount > 0;
  const isSentByMe = item.lastMessage?.senderId === currentUserId;

  return (
    <TouchableOpacity
      style={styles.conversationItem}
      activeOpacity={0.7}
      onPress={() =>
        navigation.navigate('ChatScreen', {
          matchId: item.matchId,
          userName: item.user.name,
          userAvatar: item.user.avatar,
          userId: item.user.id,
        })
      }
    >
      {/* Avatar */}
      <View style={styles.avatarContainer}>
        <Image
          source={{ uri: item.user.avatar || DEFAULT_AVATAR }}
          style={styles.avatar}
        />
        {isUnread && <View style={styles.onlineDot} />}
      </View>

      {/* Content */}
      <View style={styles.conversationContent}>
        <View style={styles.conversationHeader}>
          <Text style={[styles.userName, isUnread && styles.userNameUnread]} numberOfLines={1}>
            {item.user.name}
          </Text>
          <Text style={[styles.timeText, isUnread && styles.timeTextUnread]}>
            {formatTime(item.lastMessage?.sentAt)}
          </Text>
        </View>
        <View style={styles.conversationFooter}>
          <View style={styles.lastMessageRow}>
            {isSentByMe && item.lastMessage && (
              <Ionicons
                name={
                  item.lastMessage.id?.startsWith('temp-')
                    ? 'time-outline'
                    : item.lastMessage.readAt
                      ? 'checkmark-done'
                      : 'checkmark'
                }
                size={item.lastMessage.id?.startsWith('temp-') ? 13 : 14}
                color={
                  item.lastMessage.id?.startsWith('temp-')
                    ? colors.text.tertiary
                    : item.lastMessage.readAt
                      ? '#60a5fa'
                      : colors.text.tertiary
                }
                style={{ marginRight: 4 }}
              />
            )}
            <Text
              style={[styles.lastMessage, isUnread && styles.lastMessageUnread]}
              numberOfLines={1}
            >
              {item.lastMessage
                ? `${isSentByMe ? 'You: ' : ''}${item.lastMessage.content}`
                : 'Say hello! 👋'}
            </Text>
          </View>
          {isUnread && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>
                {item.unreadCount > 9 ? '9+' : item.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const EmptyState = () => (
  <View style={styles.emptyContainer}>
    <View style={styles.emptyIconContainer}>
      <LinearGradient
        colors={[colors.primary, colors.accent]}
        style={styles.emptyIconGradient}
      >
        <Ionicons name="chatbubbles-outline" size={48} color={colors.text.primary} />
      </LinearGradient>
    </View>
    <Text style={styles.emptyTitle}>No Messages Yet</Text>
    <Text style={styles.emptySubtitle}>
      When you match with someone, your{'\n'}conversations will appear here
    </Text>
  </View>
);

export const ChatListScreen = () => {
  const dispatch = useDispatch();
  const conversations = useSelector((state: RootState) => state.chat.conversations);
  const isLoading = useSelector((state: RootState) => state.chat.isLoadingConversations);
  const currentUserId = useSelector((state: RootState) => state.auth.user?.id);
  const navigation = useNavigation<any>();
  const [stories, setStories] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const conversationCursor = useRef<string | null>(null);
  const storyCursor = useRef<string | null>(null);

  const fetchStories = useCallback(async (restart = true) => {
    const response = await api.get('/stories/feed', { params: { limit: 50, ...(!restart && storyCursor.current ? { cursor: storyCursor.current } : {}) } });
    const page = response.data.data;
    setStories((current) => restart ? page.items : [...current, ...page.items.filter((item: any) => !current.some((existing) => existing.id === item.id))]);
    storyCursor.current = page.nextCursor;
  }, []);

  const fetchConversations = useCallback(async (restart = true) => {
    try {
      dispatch(setLoadingConversations(true));
      const response = await api.get('/chat/conversations', { params: { ...(query.trim() ? { q: query.trim() } : {}), ...(!restart && conversationCursor.current ? { cursor: conversationCursor.current } : {}), limit: 30 } });
      if (response.data?.success) {
        const page = response.data.data;
        dispatch(restart ? setConversations(page.items) : appendConversations(page.items));
        conversationCursor.current = page.nextCursor;
      }
    } catch (err) {
      console.error('[ChatList] Error fetching conversations:', err);
    } finally {
      dispatch(setLoadingConversations(false));
    }
  }, [dispatch, query]);

  const syncAccountEvents = useCallback(async () => {
    if (!currentUserId) return;
    const key = `account-event-seq:${currentUserId}`;
    let afterSeq = Number(await AsyncStorage.getItem(key) ?? 0);
    let changed = false;
    for (let page = 0; page < 10; page += 1) {
      const response = await api.get('/chat/account-events', { params: { afterSeq, limit: 200 } });
      const result = response.data.data;
      if (result.resetRequired) { afterSeq = result.highWaterSeq; changed = true; break; }
      changed = changed || result.events.length > 0;
      afterSeq = result.nextSeq;
      if (!result.hasMore) break;
    }
    await AsyncStorage.setItem(key, String(afterSeq));
    if (changed) await fetchConversations(true);
  }, [currentUserId, fetchConversations]);

  useEffect(() => {
    const timer = setTimeout(fetchConversations, 250);
    return () => clearTimeout(timer);
  }, [fetchConversations]);
  useFocusEffect(useCallback(() => {
    fetchStories(true).catch(() => undefined);
    fetchConversations();
    syncAccountEvents().catch(() => undefined);
    initSocket();
    const socket = getSocket();
    const refresh = () => fetchConversations();
    socket?.on('new_message', refresh);
    socket?.on('chat_event', refresh);
    return () => { socket?.off('new_message', refresh); socket?.off('chat_event', refresh); };
  }, [fetchConversations, fetchStories, syncAccountEvents]));

  const totalUnread = conversations.reduce((sum: number, c: Conversation) => sum + c.unreadCount, 0);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Messages</Text>
          {totalUnread > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{totalUnread}</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 16 }}><TouchableOpacity accessibilityLabel="Search messages" onPress={() => navigation.navigate('MessageSearch')}><Ionicons name="search-outline" size={24} color={colors.text.primary} /></TouchableOpacity><TouchableOpacity accessibilityLabel="Follow requests" onPress={() => navigation.navigate('FollowRequests')}><Ionicons name="person-add-outline" size={24} color={colors.text.primary} /></TouchableOpacity></View>
      </View>
      <View style={styles.searchBox}><Ionicons name="search" size={18} color={colors.text.tertiary} /><TextInput value={query} onChangeText={setQuery} placeholder="Search conversations" placeholderTextColor={colors.text.tertiary} style={styles.searchInput} /></View>

      <FlatList
        horizontal
        data={[{ id: 'create', create: true }, ...stories]}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.storyTray}
        onEndReached={() => { if (storyCursor.current) void fetchStories(false); }}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => item.create ? (
          <TouchableOpacity style={styles.storyItem} onPress={() => navigation.navigate('CreateStory')}>
            <View style={styles.createStory}><Ionicons name="add" size={25} color="#fff" /></View>
            <Text style={styles.storyName}>Your story</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.storyItem} onPress={() => navigation.navigate('StoryViewer', { stories, initialStoryId: item.id })}>
            <View style={styles.storyRing}><Image source={{ uri: item.owner?.avatarUrl || DEFAULT_AVATAR }} style={styles.storyAvatar} /></View>
            <Text style={styles.storyName} numberOfLines={1}>{item.owner?.name}</Text>
          </TouchableOpacity>
        )}
      />

      {/* Conversations List */}
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.matchId}
        renderItem={({ item }) => (
          <ConversationItem item={item} currentUserId={currentUserId} />
        )}
        contentContainerStyle={[
          styles.listContent,
          conversations.length === 0 && styles.listContentEmpty,
        ]}
        ListEmptyComponent={!isLoading ? <EmptyState /> : null}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchConversations}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        onEndReached={() => { if (conversationCursor.current && !isLoading) void fetchConversations(false); }}
        onEndReachedThreshold={0.4}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Header
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.text.primary,
    letterSpacing: -0.5,
  },
  headerBadge: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    minWidth: 24,
    alignItems: 'center',
  },
  headerBadgeText: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  // List
  listContent: {
    paddingTop: 8,
    paddingBottom: 120,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 88,
  },
  searchBox: { marginHorizontal: 20, marginTop: 10, height: 42, borderRadius: 14, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, color: colors.text.primary, fontSize: 15 },
  storyTray: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  storyItem: { width: 68, alignItems: 'center' },
  storyRing: { width: 62, height: 62, borderRadius: 31, padding: 2, borderWidth: 2, borderColor: colors.primary },
  storyAvatar: { width: '100%', height: '100%', borderRadius: 28, backgroundColor: colors.surface },
  createStory: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  storyName: { color: colors.text.secondary, fontSize: 11, marginTop: 5, width: 68, textAlign: 'center' },
  // Conversation Item
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    borderWidth: 2.5,
    borderColor: colors.background,
  },
  conversationContent: {
    flex: 1,
    justifyContent: 'center',
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.secondary,
    flex: 1,
    marginRight: 8,
  },
  userNameUnread: {
    color: colors.text.primary,
    fontWeight: '700',
  },
  timeText: {
    fontSize: 12,
    color: colors.text.tertiary,
  },
  timeTextUnread: {
    color: colors.primary,
    fontWeight: '600',
  },
  conversationFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  lastMessage: {
    fontSize: 14,
    color: colors.text.tertiary,
    flex: 1,
    marginRight: 8,
  },
  lastMessageUnread: {
    color: colors.text.secondary,
    fontWeight: '500',
  },
  unreadBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: colors.text.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
  },
  emptyIconContainer: {
    marginBottom: 24,
  },
  emptyIconGradient: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
