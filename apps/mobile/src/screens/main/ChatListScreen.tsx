import { UnverifiedNudge } from '../../features/verification/VerifyNudge';
import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  TextInput,
  Pressable,
  Modal,
  Alert,
  BackHandler,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector, useDispatch } from 'react-redux';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { RootState, store } from '../../store';
import { api } from '../../services/api';
import {
  setConversations,
  appendConversations,
  setLoadingConversations,
  patchConversation,
  removeConversation,
  addMessage, replaceOptimisticMessage,
  applyMessageEdit, markMessagesReadByPeer, markMessagesDeliveredByPeer, markVoicePlayed,
  clearMessagesThrough,
  Conversation,
} from '../../store/chatSlice';
import { colors } from '../../core/theme/colors';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { getSocket, initSocket } from '../../services/socket';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MuteSheet } from '../../features/chat/components/MuteSheet';
import { ConfirmDialog } from '../../features/chat/components/ConfirmDialog';
import { UndoSnackbar } from '../../features/chat/components/UndoSnackbar';
import { apiErrorMessage, conversationApi, isMuted } from '../../features/chat/conversationControls';
import { clearNativeChatMatch } from '../../../modules/chat-timeline';
import { conversationLoadError, type ConversationLoadError } from '../../features/chat/conversationLoadError';
import { conversationPreview } from '../../features/chat/conversationPreview';
import { ConversationPreviewGallery } from '../../features/chat/components/ConversationPreviewGallery';
import { ConversationPreviewLine } from '../../features/chat/components/ConversationPreviewLine';
import { loadChatDraft, subscribeChatDrafts, type ChatDraft } from '../../features/chat/chatDrafts';
import { createTypingPresence, type TypingPresence } from '../../features/chat/typingPresence';
import { PersonAvatar } from '../../features/search/PersonAvatar';

const DEFAULT_AVATAR =
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop';

/** How long a menu modal takes to fade before a follow-up dialog may open. */
const MENU_DISMISS_MS = 220;

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
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface NewMatchItem {
  matchId: string;
  /** Not opened yet on any of your devices: the "new" dot. */
  isNew?: boolean;
  /** Their Story ring, when you may watch one (matches can). */
  story?: { unseen: boolean; closeFriends: boolean; until: string } | null;
  user: {
    id: string;
    name: string;
    avatar?: string | null;
    age?: number;
    department?: string;
    /** On screen now - only when you both share your activity status. */
    online?: boolean;
  };
}

type RowProps = {
  item: Conversation;
  currentUserId: string;
  draft?: ChatDraft | null;
  activity?: 'typing' | 'recording' | null;
  selectionMode: boolean;
  selected: boolean;
  inArchive: boolean;
  onOpen: (item: Conversation) => void;
  onToggleSelect: (item: Conversation) => void;
  onSwipeArchive: (item: Conversation) => void;
};

const ConversationItem = React.memo(({
  item,
  currentUserId,
  draft, activity,
  selectionMode,
  selected,
  inArchive,
  onOpen,
  onToggleSelect,
  onSwipeArchive,
}: RowProps) => {
  const swipeRef = useRef<SwipeableMethods>(null);
  // Read from the timestamp, not the server's flag: a mute can run out while the
  // list is on screen.
  const muted = isMuted(item.mutedUntil);
  const unreadCount = item.unreadCount;
  // A manual "mark as unread" shows as a badge with no number, as in Telegram.
  const hasUnread = unreadCount > 0 || Boolean(item.markedUnread);
  const last = item.lastMessage;
  const preview = conversationPreview({ lastMessage: last, currentUserId, peerName: item.user.name, draft, activity, reaction: item.reactionPreview });

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      enabled={!selectionMode}
      friction={1.8}
      rightThreshold={80}
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.swipeAction}>
          <Ionicons name={inArchive ? 'arrow-undo' : 'archive'} size={22} color="#FFFFFF" />
          <Text style={styles.swipeActionText}>{inArchive ? 'Unarchive' : 'Archive'}</Text>
        </View>
      )}
      onSwipeableOpen={() => {
        swipeRef.current?.close();
        onSwipeArchive(item);
      }}
    >
      <TouchableOpacity
        style={[
          styles.conversationItem,
          hasUnread && styles.conversationItemUnread,
          selected && styles.conversationItemSelected,
        ]}
        activeOpacity={0.65}
        onPress={() => (selectionMode ? onToggleSelect(item) : onOpen(item))}
        onLongPress={() => onToggleSelect(item)}
        delayLongPress={300}
        accessibilityState={{ selected }}
      >
        <View style={styles.avatarContainer}>
          <Image
            source={{ uri: item.user.avatar || DEFAULT_AVATAR }}
            style={styles.avatar}
          />
          {selected ? (
            <View style={styles.selectedCheck}>
              <Ionicons name="checkmark" size={13} color="#FFFFFF" />
            </View>
          ) : hasUnread ? (
            <View style={[styles.unreadAvatarDot, muted && styles.mutedAvatarDot]} />
          ) : item.user.online && getSocket()?.connected ? (
            <View style={styles.onlineDot} accessibilityLabel="Online" />
          ) : null}
        </View>

        <View style={styles.conversationContent}>
          <View style={styles.conversationHeader}>
            <View style={styles.nameRow}>
              <Text
                style={[styles.userName, hasUnread && styles.userNameUnread]}
                numberOfLines={1}
              >
                {item.user.name}
              </Text>
              {muted ? (
                <Ionicons name="volume-mute" size={14} color={colors.text.tertiary} style={styles.nameIcon} />
              ) : null}
              {item.messageTtlSeconds ? (
                <Ionicons name="timer-outline" size={14} color={colors.text.tertiary} style={styles.nameIcon} />
              ) : null}
            </View>
            <Text style={[styles.timeText, hasUnread && !muted && styles.timeTextUnread]}>
              {formatTime(draft ? new Date(draft.updatedAt).toISOString() : item.reactionPreview?.at ?? last?.sentAt)}
            </Text>
          </View>

          <View style={styles.conversationFooter}>
            <View style={styles.lastMessageRow}>
              <ConversationPreviewLine preview={preview} unread={hasUnread} accountId={currentUserId} />
            </View>

            {hasUnread ? (
              <View style={[styles.unreadBadge, muted && styles.unreadBadgeMuted, unreadCount === 0 && styles.unreadBadgeDot]}>
                {unreadCount > 0 ? (
                  <Text style={styles.unreadText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                ) : null}
              </View>
            ) : item.pinned ? (
              <Ionicons name="pin" size={16} color={colors.text.tertiary} style={styles.pinIcon} />
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    </ReanimatedSwipeable>
  );
});

function SelectionAction({ icon, label, onPress, danger }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.selectionAction}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={21} color={danger ? '#FF666C' : colors.text.primary} />
    </TouchableOpacity>
  );
}

const EmptyState = ({ onExplore }: { onExplore: () => void }) => (
  <View style={styles.emptyContainer}>
    <Image source={require('../../../assets/illustrations/messages-kitten.png')}
      style={styles.messagesKitten} resizeMode="contain" fadeDuration={0} accessible={false} />
    <Text style={styles.emptyTitle}>No messages yet</Text>
    <Text style={styles.emptySubtitle}>
      Match with someone and say hello. Your conversations will appear here.
    </Text>

    <TouchableOpacity
      style={styles.emptyCtaButton}
      onPress={onExplore}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={[colors.primary, '#be185d']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.emptyCtaGradient}
      >
        <Ionicons name="sparkles" size={17} color="#FFFFFF" style={{ marginRight: 8 }} />
        <Text style={styles.emptyCtaText}>Discover New Matches</Text>
      </LinearGradient>
    </TouchableOpacity>
  </View>
);

const ArchiveEmpty = () => (
  <View style={styles.emptyContainer}>
    <Ionicons name="archive-outline" size={48} color={colors.text.tertiary} />
    <Text style={[styles.emptyTitle, styles.archiveEmptyTitle]}>No archived chats</Text>
    <Text style={styles.emptySubtitle}>Swipe a chat to the left to archive it.</Text>
  </View>
);

type PendingUndo = {
  id: number;
  message: string;
  /** Carries the action out once the countdown ends. */
  commit: () => Promise<void>;
  /** Puts things back if UNDO is pressed. */
  revert: () => void;
};

type ConfirmState = { kind: 'clear' | 'delete'; rows: Conversation[] } | null;

/**
 * The archived rows from the last visit.
 *
 * The archive is a second copy of this screen with its own state, so every
 * visit started from nothing and waited on the network before it could show a
 * single row - which is what made opening the archive, right after archiving
 * something into it, feel like a pause. The main list has the store for this;
 * the archive keeps its rows here, outside the component, for the same reason:
 * something to draw immediately while the refresh runs.
 */
let archivedCache: Conversation[] = [];

export const ChatListScreen = () => {
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const inArchive = (route.params as { folder?: string } | undefined)?.folder === 'archived';

  const storedConversations = useSelector((state: RootState) => state.chat.conversations);
  const isLoading = useSelector((state: RootState) => state.chat.isLoadingConversations);
  // Signed in again after an offline start: what showed was saved chats, so
  // read the real list now instead of waiting for the next visit.
  const authToken = useSelector((state: RootState) => state.auth.token);
  const hadToken = useRef(!!authToken);
  const currentUserId = useSelector((state: RootState) => state.auth.user?.id);

  // The archive keeps its rows to itself. The main list lives in the store, is
  // persisted, and is read by the chat screen; putting archived rows there would
  // replace the main list for everything that reads it.
  const [archivedItems, setArchivedItems] = useState<Conversation[]>(archivedCache);
  const [archiveLoading, setArchiveLoading] = useState(false);
  // Only a pull the person made shows the refresh spinner. Background refreshes
  // (returning from a chat, a socket event) update the rows silently, as
  // Telegram and WhatsApp do - the list on screen is already current.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [archiveSummary, setArchiveSummary] = useState({ count: 0, unread: 0 });
  const [newMatches, setNewMatches] = useState<NewMatchItem[]>([]);
  const [query, setQuery] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadError, setLoadError] = useState<ConversationLoadError | null>(null);
  const conversationCursor = useRef<string | null>(null);
  const conversationRequest = useRef<{ version: number; controller: AbortController | null }>({ version: 0, controller: null });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [muteTargets, setMuteTargets] = useState<Conversation[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [undo, setUndo] = useState<PendingUndo | null>(null);
  const undoRef = useRef<PendingUndo | null>(null);

  const source = inArchive ? archivedItems : storedConversations;
  // A chat deleted with its undo still counting down stays out of view, even if a
  // refetch in the meantime brings it back from the server.
  const conversations = useMemo(
    () => source.filter((item) => !hiddenIds.has(item.matchId)),
    [source, hiddenIds],
  );
  const [drafts, setDrafts] = useState<Record<string, ChatDraft | null>>({});
  const [activities, setActivities] = useState<Record<string, 'typing' | 'recording' | null>>({});
  const draftIds = source.map(row => row.matchId).join('|');
  useFocusEffect(useCallback(() => {
    let active = true;
    let version = 0;
    const load = async () => {
      const request = ++version;
      const ids = draftIds ? draftIds.split('|') : [];
      const entries = await Promise.all(ids.map(async id => [id, await loadChatDraft(id)] as const));
      if (active && request === version && store.getState().auth.user?.id === currentUserId) setDrafts(Object.fromEntries(entries));
    };
    setDrafts({});
    void load();
    const unsubscribe = subscribeChatDrafts(() => { void load(); });
    return () => { active = false; unsubscribe(); };
  }, [currentUserId, draftIds]));
  const loading = inArchive ? archiveLoading : isLoading;
  const selectionMode = selectedIds.size > 0;
  const selectedRows = useMemo(
    () => conversations.filter((item) => selectedIds.has(item.matchId)),
    [conversations, selectedIds],
  );

  const fetchMatches = useCallback(async () => {
    try {
      // Only matches where nobody has written yet, as Tinder's row: the first
      // message from either side moves a match down into the conversations.
      const response = await api.get('/match/new');
      if (response.data?.data && Array.isArray(response.data.data)) {
        setNewMatches(response.data.data);
      }
    } catch {
      // Silently continue if pending matches are unavailable
    }
  }, []);

  const fetchConversations = useCallback(
    async (restart = true) => {
      if (!restart && conversationRequest.current.controller) return;
      conversationRequest.current.controller?.abort();
      const controller = new AbortController();
      const version = conversationRequest.current.version + 1;
      conversationRequest.current = { version, controller };
      const isCurrent = () => conversationRequest.current.version === version && !controller.signal.aborted;
      try {
        if (inArchive) setArchiveLoading(true);
        else dispatch(setLoadingConversations(true));
        const response = await api.get('/chat/conversations', {
          signal: controller.signal,
          params: {
            ...(query.trim() ? { q: query.trim() } : {}),
            ...(!restart && conversationCursor.current
              ? { cursor: conversationCursor.current }
              : {}),
            limit: 30,
            ...(inArchive ? { folder: 'archived' } : {}),
          },
        });
        if (!isCurrent()) return;
        if (response.data?.success) {
          const page = response.data.data;
          // Receiving a preview confirms delivery only. Opening the chat controls read receipts.
          const socket = getSocket();
          if (socket?.connected) for (const row of page.items as Conversation[]) {
            const last = row.lastMessage;
            if (last && last.senderId !== currentUserId && last.type !== 'service' && !last.deliveredAt && !last.id.startsWith('temp-')) {
              socket.emit('messages_delivered', { matchId: row.matchId, messageIds: [last.id] });
            }
          }
          if (inArchive) {
            setArchivedItems((current) => {
              const next = restart
                ? page.items
                : [...current, ...page.items.filter((item: Conversation) => !new Set(current.map((row) => row.matchId)).has(item.matchId))];
              archivedCache = next;
              return next;
            });
          } else {
            dispatch(
              restart ? setConversations(page.items) : appendConversations(page.items)
            );
            setArchiveSummary({ count: page.archivedCount ?? 0, unread: page.archivedUnreadCount ?? 0 });
          }
          conversationCursor.current = page.nextCursor;
          setLoadError(null);
        } else {
          setLoadError(conversationLoadError(null));
        }
      } catch (err) {
        if (isCurrent()) {
          const failure = conversationLoadError(err);
          if (failure) setLoadError(failure);
        }
      } finally {
        if (conversationRequest.current.version === version) {
          conversationRequest.current.controller = null;
          if (inArchive) setArchiveLoading(false);
          else dispatch(setLoadingConversations(false));
        }
      }
    },
    [dispatch, inArchive, query, currentUserId]
  );

  const syncAccountEvents = useCallback(async () => {
    if (!currentUserId) return;
    const key = `account-event-seq:${currentUserId}`;
    let afterSeq = Number((await AsyncStorage.getItem(key)) ?? 0);
    let changed = false;
    for (let page = 0; page < 10; page += 1) {
      const response = await api.get('/chat/account-events', {
        params: { afterSeq, limit: 200 },
      });
      const result = response.data.data;
      if (result.resetRequired) {
        afterSeq = result.highWaterSeq;
        changed = true;
        break;
      }
      changed = changed || result.events.length > 0;
      afterSeq = result.nextSeq;
      if (!result.hasMore) break;
    }
    await AsyncStorage.setItem(key, String(afterSeq));
    if (changed) {
      await fetchConversations(true);
      if (!inArchive) await fetchMatches();
    }
  }, [currentUserId, fetchConversations, fetchMatches, inArchive]);

  // Re-run the search as the query changes. The first run is the focus effect's.
  const searchRan = useRef(false);
  useEffect(() => {
    if (!searchRan.current) {
      searchRan.current = true;
      return;
    }
    const timer = setTimeout(() => {
      fetchConversations(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchConversations]);

  useEffect(() => {
    const had = hadToken.current;
    hadToken.current = !!authToken;
    if (had || !authToken) return;
    initSocket();
    fetchConversations();
    if (!inArchive) fetchMatches().catch(() => undefined);
    syncAccountEvents().catch(() => undefined);
    // Only the moment the sign-in comes back, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  useFocusEffect(
    useCallback(() => {
      // A list with rows on screen refreshes quietly once the transition is
      // over: re-rendering it while a chat is still sliding away is what made
      // going back feel slow. A list with nothing to show has to fetch at once,
      // or the screen sits empty for the length of the animation - which is how
      // the archive folder, whose rows are not in the store, came to feel slow
      // to open.
      const refreshNow = () => {
        if (!inArchive) fetchMatches().catch(() => undefined);
        fetchConversations();
        syncAccountEvents().catch(() => undefined);
      };
      const cold = (inArchive ? archivedCache : storedConversations).length === 0;
      // requestIdleCallback waits for the thread to be free, which is what this
      // wants and what React Native now recommends over InteractionManager. The
      // timeout is the promise that it runs regardless.
      const task = cold ? null : requestIdleCallback(refreshNow, { timeout: 1200 });
      if (cold) refreshNow();
      initSocket();
      const socket = getSocket();
      const refresh = () => {
        fetchConversations();
        if (!inArchive) fetchMatches().catch(() => undefined);
      };
      let refreshTimer: ReturnType<typeof setTimeout> | null = null;
      const changed = (event: any) => {
        const payload = event.payload ?? {};
        const matchId = event.matchId;
        if (event.type === 'message.created' && payload.message) {
          const message = payload.message;
          const last = store.getState().chat.conversations.find(row => row.matchId === matchId)?.lastMessage;
          if (message.clientMessageId && last?.id === message.clientMessageId) dispatch(replaceOptimisticMessage({ tempId: message.clientMessageId, realMessage: message }));
          else dispatch(addMessage(message));
          trackers.get(matchId)?.stop();
        }
        if (event.type === 'message.edited') dispatch(applyMessageEdit({ matchId, ...payload }));
        if (payload.userId !== currentUserId) {
          if (event.type === 'messages.read') dispatch(markMessagesReadByPeer({ matchId, ...payload }));
          if (event.type === 'messages.delivered') dispatch(markMessagesDeliveredByPeer({ matchId, ...payload }));
          if (event.type === 'message.played') dispatch(markVoicePlayed({ matchId, ...payload }));
        }
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 160);
      };
      socket?.on('chat_event', changed);
      const trackers = new Map<string, TypingPresence>();
      const activityStart = (event: { matchId: string; senderId: string; activity?: string }) => {
        if (event.senderId === currentUserId) return;
        const kind = event.activity === 'recording' ? 'recording' : 'typing';
        trackers.get(event.matchId)?.dispose();
        const tracker = createTypingPresence(visible => setActivities(current => ({ ...current, [event.matchId]: visible ? kind : null })));
        trackers.set(event.matchId, tracker);
        tracker.start();
      };
      const activityStop = (event: { matchId: string; senderId: string }) => {
        if (event.senderId === currentUserId) return;
        trackers.get(event.matchId)?.stop();
      };
      const clearActivity = () => {
        trackers.forEach(tracker => tracker.dispose());
        trackers.clear();
        setActivities({});
      };
      socket?.on('typing_start', activityStart);
      socket?.on('typing_stop', activityStop);
      socket?.on('disconnect', clearActivity);
      // Online dots, live: matches coming to and leaving the app.
      const presence = (event: { userId?: string; online?: boolean }) => {
        if (!event.userId) return;
        const rows = (inArchive ? archivedCache : store.getState().chat.conversations as Conversation[])
          .filter((row) => row.user.id === event.userId && !!row.user.online !== !!event.online);
        if (!rows.length) return;
        const online = event.online === true;
        if (inArchive) {
          setArchivedItems((items) => {
            const next = items.map((item) => (item.user.id === event.userId ? { ...item, user: { ...item.user, online } } : item));
            archivedCache = next;
            return next;
          });
        } else {
          rows.forEach((row) => dispatch(patchConversation({ matchId: row.matchId, changes: { user: { ...row.user, online } } })));
        }
      };
      socket?.on('presence_changed', presence);
      const reconnect = () => {
        refresh();
        void syncAccountEvents().catch(() => undefined);
      };
      socket?.on('connect', reconnect);
      const appState = AppState.addEventListener('change', (state) => {
        if (state === 'active') reconnect();
      });
      return () => {
        if (task !== null) cancelIdleCallback(task);
        socket?.off('chat_event', changed);
        if (refreshTimer) clearTimeout(refreshTimer);
        socket?.off('typing_start', activityStart);
        socket?.off('typing_stop', activityStop);
        socket?.off('disconnect', clearActivity);
        clearActivity();
        socket?.off('presence_changed', presence);
        socket?.off('connect', reconnect);
        appState.remove();
        conversationRequest.current.controller?.abort();
      };
      // storedConversations is read only to tell a cold list from a warm one;
      // re-running this on every change to it would refetch continuously.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchConversations, fetchMatches, inArchive, syncAccountEvents, currentUserId, dispatch])
  );

  const expiryTimes = source.map(row => row.lastMessage?.expiresAt).filter(Boolean).join('|');
  useFocusEffect(useCallback(() => {
    const times = expiryTimes.split('|').map(Date.parse).filter(Number.isFinite);
    if (!times.length) return;
    const delay = Math.max(0, Math.min(...times) - Date.now()) + 50;
    const timer = setTimeout(() => { void fetchConversations(); }, Math.min(delay, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [expiryTimes, fetchConversations]));

  // ---- Row bookkeeping, for whichever folder this screen is showing ----------

  const updateRows = useCallback((ids: string[], changes: Partial<Conversation>) => {
    if (inArchive) {
      setArchivedItems((items) => {
        const next = items.map((item) => (ids.includes(item.matchId) ? { ...item, ...changes } : item));
        archivedCache = next;
        return next;
      });
    } else {
      ids.forEach((matchId) => dispatch(patchConversation({ matchId, changes })));
    }
  }, [dispatch, inArchive]);

  const dropRows = useCallback((ids: string[]) => {
    if (inArchive) setArchivedItems((items) => {
      const next = items.filter((item) => !ids.includes(item.matchId));
      archivedCache = next;
      return next;
    });
    else ids.forEach((matchId) => dispatch(removeConversation(matchId)));
  }, [dispatch, inArchive]);

  const restoreRows = useCallback((rows: Conversation[]) => {
    if (inArchive) {
      setArchivedItems((items) => {
        const next = [...rows, ...items.filter((item) => !rows.some((row) => row.matchId === item.matchId))];
        archivedCache = next;
        return next;
      });
    } else {
      dispatch(appendConversations(rows));
    }
  }, [dispatch, inArchive]);

  // ---- Undo ------------------------------------------------------------------

  const showUndo = useCallback((message: string, commit: () => Promise<void>, revert: () => void) => {
    // A new undoable action ends the previous countdown by carrying it out, as
    // Telegram does, rather than quietly dropping it.
    const previous = undoRef.current;
    if (previous) void previous.commit().catch(() => undefined);
    const next: PendingUndo = { id: Date.now(), message, commit, revert };
    undoRef.current = next;
    setUndo(next);
  }, []);

  const settleUndo = useCallback((id: number, outcome: 'commit' | 'revert') => {
    const pending = undoRef.current;
    if (!pending || pending.id !== id) return;
    undoRef.current = null;
    setUndo(null);
    if (outcome === 'revert') {
      pending.revert();
      return;
    }
    pending.commit()
      .catch((error) => Alert.alert('Action failed', apiErrorMessage(error, 'Try again.')))
      .finally(() => void fetchConversations(true));
  }, [fetchConversations]);

  // Leaving the screen mid-countdown carries the action out: the person saw it
  // happen and never pressed undo.
  useEffect(() => () => {
    const pending = undoRef.current;
    if (pending) void pending.commit().catch(() => undefined);
  }, []);

  // ---- Selection ---------------------------------------------------------------

  const exitSelection = useCallback(() => setSelectedIds(new Set()), []);

  const toggleSelect = useCallback((item: Conversation) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(item.matchId)) next.delete(item.matchId);
      else next.add(item.matchId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!selectionMode) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelection();
      return true;
    });
    return () => subscription.remove();
  }, [exitSelection, selectionMode]);

  const openChat = useCallback((item: Conversation) => {
    navigation.navigate('ChatScreen', {
      matchId: item.matchId,
      userName: item.user.name,
      userAvatar: item.user.avatar,
      userId: item.user.id,
    });
  }, [navigation]);

  // ---- Actions -----------------------------------------------------------------

  const archiveRows = useCallback(async (rows: Conversation[]) => {
    if (!rows.length) return;
    const archive = !inArchive;
    const ids = rows.map((row) => row.matchId);
    dropRows(ids);
    if (archive) {
      // The archive folder can be opened before the refresh lands, so put the
      // rows where it will look for them.
      archivedCache = [...rows, ...archivedCache.filter((item) => !ids.includes(item.matchId))];
      setArchiveSummary((summary) => ({
        count: summary.count + rows.length,
        unread: summary.unread + rows.reduce((sum, row) => sum + row.unreadCount, 0),
      }));
    } else {
      archivedCache = archivedCache.filter((item) => !ids.includes(item.matchId));
    }
    const count = rows.length;
    // The undo bar used to wait for every archive request to come back, so the
    // row vanished and the bar that explains it arrived a round trip later. The
    // action is already shown as done; the bar says so at the same moment, and
    // a failure puts the row back and says why.
    showUndo(
      archive
        ? (count === 1 ? 'Chat archived' : `${count} chats archived`)
        : (count === 1 ? 'Chat unarchived' : `${count} chats unarchived`),
      // Archiving already happened; there is nothing left to do when the
      // countdown ends, only something to reverse if UNDO is pressed.
      async () => undefined,
      () => {
        restoreRows(rows);
        if (archive) archivedCache = archivedCache.filter((item) => !ids.includes(item.matchId));
        void Promise.all(ids.map((matchId) => conversationApi.archive(matchId, !archive)))
          .catch(() => undefined)
          .finally(() => void fetchConversations(true));
      },
    );
    try {
      await Promise.all(ids.map((matchId) => conversationApi.archive(matchId, archive)));
    } catch (error) {
      restoreRows(rows);
      void fetchConversations(true);
      Alert.alert(archive ? 'Could not archive' : 'Could not unarchive', apiErrorMessage(error, 'Try again.'));
    }
  }, [dropRows, fetchConversations, inArchive, restoreRows, showUndo]);

  const swipeArchive = useCallback((item: Conversation) => {
    void archiveRows([item]);
  }, [archiveRows]);

  const pinSelected = useCallback(async () => {
    const rows = selectedRows;
    exitSelection();
    // Pin if anything selected is unpinned, otherwise unpin: the button's label.
    const pin = rows.some((row) => !row.pinned);
    const targets = rows.filter((row) => Boolean(row.pinned) !== pin);
    updateRows(targets.map((row) => row.matchId), { pinned: pin, pinnedAt: pin ? new Date().toISOString() : null });
    const results = await Promise.allSettled(targets.map((row) => conversationApi.pin(row.matchId, pin)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) Alert.alert(pin ? 'Could not pin' : 'Could not unpin', apiErrorMessage(failed.reason, 'Try again.'));
    void fetchConversations(true);
  }, [exitSelection, fetchConversations, selectedRows, updateRows]);

  const applyMute = useCallback(async (rows: Conversation[], until: string | null) => {
    updateRows(rows.map((row) => row.matchId), { mutedUntil: until, muted: isMuted(until) });
    const results = await Promise.allSettled(rows.map((row) => conversationApi.mute(row.matchId, until)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) Alert.alert('Could not change notifications', apiErrorMessage(failed.reason, 'Try again.'));
    void fetchConversations(true);
  }, [fetchConversations, updateRows]);

  const muteSelected = useCallback(() => {
    const rows = selectedRows;
    exitSelection();
    // Everything selected is already muted: the button reads "Unmute" and acts at once.
    if (rows.every((row) => isMuted(row.mutedUntil))) void applyMute(rows, null);
    else setMuteTargets(rows);
  }, [applyMute, exitSelection, selectedRows]);

  const markSelected = useCallback(async () => {
    const rows = selectedRows;
    setMoreOpen(false);
    exitSelection();
    const unread = !rows.some((row) => row.unreadCount > 0 || row.markedUnread);
    updateRows(
      rows.map((row) => row.matchId),
      unread ? { markedUnread: true } : { markedUnread: false, unreadCount: 0 },
    );
    const results = await Promise.allSettled(rows.map((row) => conversationApi.unread(row.matchId, unread)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) Alert.alert('Could not update chats', apiErrorMessage(failed.reason, 'Try again.'));
    void fetchConversations(true);
  }, [exitSelection, fetchConversations, selectedRows, updateRows]);

  const runConfirmed = useCallback((kind: 'clear' | 'delete', rows: Conversation[], forEveryone: boolean) => {
    const ids = rows.map((row) => row.matchId);
    const execute = async () => {
      const results = await Promise.all(
        ids.map((matchId) => (kind === 'delete'
          ? conversationApi.remove(matchId, forEveryone)
          : conversationApi.clear(matchId, forEveryone))),
      );
      // Drop the cached history as well, or the chat screen would go on showing it
      // from the local cache until something forced a full reload.
      results.forEach((result, index) => {
        void clearNativeChatMatch(currentUserId ?? '', ids[index]);
        dispatch(clearMessagesThrough({ matchId: ids[index], throughSeq: result.throughSeq }));
      });
    };
    const count = rows.length;
    if (kind === 'delete') {
      setHiddenIds((current) => new Set([...current, ...ids]));
      const unhide = () => setHiddenIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      showUndo(
        count === 1 ? 'Chat deleted' : `${count} chats deleted`,
        async () => {
          try {
            await execute();
            dropRows(ids);
          } finally {
            unhide();
          }
        },
        unhide,
      );
    } else {
      const snapshots = rows.map((row) => ({
        matchId: row.matchId,
        lastMessage: row.lastMessage,
        unreadCount: row.unreadCount,
        markedUnread: row.markedUnread,
      }));
      updateRows(ids, { lastMessage: null, unreadCount: 0, markedUnread: false });
      showUndo(
        count === 1 ? 'History cleared' : `History cleared in ${count} chats`,
        execute,
        () => snapshots.forEach(({ matchId, ...previous }) => updateRows([matchId], previous)),
      );
    }
  }, [currentUserId, dispatch, dropRows, showUndo, updateRows]);

  // ---- Derived UI state ----------------------------------------------------------

  const allPinned = selectedRows.length > 0 && selectedRows.every((row) => row.pinned);
  const allMuted = selectedRows.length > 0 && selectedRows.every((row) => isMuted(row.mutedUntil));
  const anyUnread = selectedRows.some((row) => row.unreadCount > 0 || row.markedUnread);

  // Telegram's unread total leaves out muted chats; archived ones are not in this list.
  const totalUnread = conversations.reduce(
    (sum: number, c: Conversation) => sum + (isMuted(c.mutedUntil) ? 0 : c.unreadCount),
    0
  );

  const archivedRow = !inArchive && !query.trim() && archiveSummary.count > 0 ? (
    <TouchableOpacity
      style={styles.archivedRow}
      activeOpacity={0.65}
      onPress={() => navigation.navigate('ArchivedChats')}
      accessibilityRole="button"
      accessibilityLabel={`Archived chats, ${archiveSummary.count}`}
    >
      <View style={styles.archivedIcon}>
        <Ionicons name="archive" size={24} color="#FFFFFF" />
      </View>
      <View style={styles.conversationContent}>
        <Text style={styles.userName} numberOfLines={1}>Archived Chats</Text>
        <Text style={styles.lastMessage} numberOfLines={1}>
          {archiveSummary.count === 1 ? '1 chat' : `${archiveSummary.count} chats`}
        </Text>
      </View>
      {archiveSummary.unread > 0 ? (
        <View style={[styles.unreadBadge, styles.unreadBadgeMuted]}>
          <Text style={styles.unreadText}>{archiveSummary.unread > 99 ? '99+' : archiveSummary.unread}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  ) : null;

  const confirmTitle = confirm
    ? confirm.kind === 'delete'
      ? (confirm.rows.length === 1 ? 'Delete chat' : `Delete ${confirm.rows.length} chats`)
      : (confirm.rows.length === 1 ? 'Clear history' : `Clear history in ${confirm.rows.length} chats`)
    : '';
  const confirmMessage = confirm
    ? confirm.kind === 'delete'
      ? (confirm.rows.length === 1
        ? `Are you sure you want to delete the chat with ${confirm.rows[0].user.name}?`
        : `Are you sure you want to delete ${confirm.rows.length} chats?`)
      : (confirm.rows.length === 1
        ? `Are you sure you want to clear your chat history with ${confirm.rows[0].user.name}?`
        : `Are you sure you want to clear the history of ${confirm.rows.length} chats?`)
    : '';

  return (
    <View style={styles.container}>
      {/* Header */}
      {selectionMode ? (
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={exitSelection}
              style={styles.headerIconButton}
              accessibilityRole="button"
              accessibilityLabel="Cancel selection"
            >
              <Ionicons name="close" size={20} color={colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.selectionCount}>{selectedIds.size}</Text>
          </View>
          <View style={styles.selectionActions}>
            <SelectionAction icon={allPinned ? 'pin' : 'pin-outline'} label={allPinned ? 'Unpin' : 'Pin'} onPress={() => void pinSelected()} />
            <SelectionAction icon={allMuted ? 'notifications-outline' : 'notifications-off-outline'} label={allMuted ? 'Unmute' : 'Mute'} onPress={muteSelected} />
            <SelectionAction
              icon={inArchive ? 'arrow-undo-outline' : 'archive-outline'}
              label={inArchive ? 'Unarchive' : 'Archive'}
              onPress={() => {
                const rows = selectedRows;
                exitSelection();
                void archiveRows(rows);
              }}
            />
            <SelectionAction
              icon="trash-outline"
              label="Delete"
              danger
              onPress={() => {
                setConfirm({ kind: 'delete', rows: selectedRows });
                exitSelection();
              }}
            />
            <SelectionAction icon="ellipsis-vertical" label="More" onPress={() => setMoreOpen(true)} />
          </View>
        </View>
      ) : inArchive ? (
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.headerIconButton}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="arrow-back" size={20} color={colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Archived Chats</Text>
          </View>
        </View>
      ) : (
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Messages</Text>
            {totalUnread > 0 && (
              <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>{totalUnread}</Text>
              </View>
            )}
          </View>

          <View style={styles.headerActions}>
            {__DEV__ && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Message preview gallery" style={styles.headerIconButton} onPress={() => setPreviewOpen(true)}>
              <Ionicons name="flask-outline" size={19} color="#F3C1CA" />
            </TouchableOpacity>}
            <TouchableOpacity
              accessibilityLabel="Follow requests"
              style={styles.headerIconButton}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('FollowRequests')}
            >
              <Ionicons name="person-add-outline" size={20} color={colors.text.primary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {__DEV__ && <Modal visible={previewOpen} animationType="slide" onRequestClose={() => setPreviewOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#100F0D', paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <ConversationPreviewGallery onClose={() => setPreviewOpen(false)} />
        </View>
      </Modal>}

      {/* Search Input Bar */}
      {!inArchive && (
        <View style={styles.searchContainer}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={19} color="#FFFFFF" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search conversations..."
              placeholderTextColor="rgba(255, 255, 255, 0.5)"
              style={styles.searchInput}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-circle" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* New Matches Section (If Any Exist) */}
      {loadError && conversations.length > 0 && <View style={styles.connectionNotice} accessibilityLiveRegion="polite">
        <Ionicons name="cloud-offline-outline" size={18} color="#F3C1CA" />
        <Text style={styles.connectionNoticeText}>{loadError.title}. Showing saved chats.</Text>
        <Pressable onPress={() => void fetchConversations(true)} disabled={loading} accessibilityRole="button"
          accessibilityLabel="Retry loading chats" accessibilityState={{ disabled: loading }} style={styles.connectionRetry}>
          <Text style={styles.connectionRetryText}>Retry</Text>
        </Pressable>
      </View>}
      {!inArchive && newMatches.length > 0 && (
        <View style={styles.matchesSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>New Matches</Text>
            <View style={styles.sectionBadge}>
              <Text style={styles.sectionBadgeText}>{newMatches.length}</Text>
            </View>
          </View>

          <FlatList
            horizontal
            data={newMatches}
            keyExtractor={(item) => item.matchId}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.matchesTray}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.matchItem}
                activeOpacity={0.75}
                onPress={() => {
                  // Opened now: the dot goes here at once; the chat tells the server.
                  setNewMatches((current) => current.map((match) => (match.matchId === item.matchId ? { ...match, isNew: false } : match)));
                  navigation.navigate('ChatScreen', {
                    matchId: item.matchId,
                    userId: item.user.id,
                    userName: item.user.name,
                    userAvatar: item.user.avatar,
                  });
                }}
                accessibilityLabel={`${item.user?.name}${item.isNew ? ', new match' : ''}${item.story?.unseen ? ', has a new story' : ''}`}
              >
                <View>
                  <PersonAvatar
                    person={{ name: item.user?.name ?? '', avatarUrl: item.user?.avatar || DEFAULT_AVATAR, story: item.story ?? null }}
                    size={56}
                    background={colors.background}
                  />
                  {item.isNew && <View style={styles.newMatchDot} />}
                </View>
                <Text style={styles.matchName} numberOfLines={1}>
                  {item.user?.name}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Conversations List */}
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.matchId}
        extraData={{ selectedIds, drafts, activities }}
        renderItem={({ item }) => (
          <ConversationItem
            item={item}
            currentUserId={currentUserId ?? ''}
            draft={drafts[item.matchId]}
            activity={activities[item.matchId]}
            selectionMode={selectionMode}
            selected={selectedIds.has(item.matchId)}
            inArchive={inArchive}
            onOpen={openChat}
            onToggleSelect={toggleSelect}
            onSwipeArchive={swipeArchive}
          />
        )}
        ListHeaderComponent={<>
          {/* Reminder 25 (GOOGLE_SIGNUP_PLAN.md 4): at most once a week. */}
          {!inArchive && <UnverifiedNudge art="chat" icon="chatbubbles-outline" text="Verify your college for unlimited chat and photos." dismissKey="chats-header" dismissDays={7} />}
          {archivedRow}
        </>}
        contentContainerStyle={[
          styles.listContent,
          conversations.length === 0 && !archivedRow && styles.listContentEmpty,
        ]}
        ListEmptyComponent={
          loading ? null : loadError ? (
            <View style={styles.emptyContainer} accessibilityLiveRegion="polite">
              <Ionicons name="cloud-offline-outline" size={42} color="#F3C1CA" />
              <Text style={styles.emptyTitle}>{loadError.title}</Text>
              <Text style={styles.emptySubtitle}>{loadError.message}</Text>
              <Pressable onPress={() => void fetchConversations(true)} accessibilityRole="button" style={styles.loadRetry}>
                <Text style={styles.loadRetryText}>Try again</Text>
              </Pressable>
            </View>
          ) : inArchive ? (
            <ArchiveEmpty />
          ) : archivedRow ? null : (
            // The deck is the tab named Dashboard; only its label reads "Explore".
            <EmptyState onExplore={() => navigation.navigate('Main', { screen: 'Dashboard' })} />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => {
              setPullRefreshing(true);
              void Promise.all([
                fetchConversations(true),
                inArchive ? Promise.resolve() : fetchMatches(),
              ]).finally(() => setPullRefreshing(false));
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        onEndReached={() => {
          if (conversationCursor.current && !loading && !loadError) {
            void fetchConversations(false);
          }
        }}
        onEndReachedThreshold={0.4}
      />

      <Modal visible={moreOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMoreOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMoreOpen(false)} accessibilityLabel="Close menu" />
        <View style={[styles.moreMenu, { top: Math.max(insets.top, 16) + 12 }]} accessibilityViewIsModal>
          <Pressable style={({ pressed }) => [styles.moreRow, pressed && styles.moreRowPressed]} onPress={() => void markSelected()} accessibilityRole="button">
            <Ionicons name={anyUnread ? 'mail-open-outline' : 'mail-unread-outline'} size={20} color="#FFFFFF" />
            <Text style={styles.moreText}>{anyUnread ? 'Mark as read' : 'Mark as unread'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.moreRow, pressed && styles.moreRowPressed]}
            onPress={() => {
              const rows = selectedRows;
              setMoreOpen(false);
              exitSelection();
              setTimeout(() => setConfirm({ kind: 'clear', rows }), MENU_DISMISS_MS);
            }}
            accessibilityRole="button"
          >
            <Ionicons name="brush-outline" size={20} color="#FFFFFF" />
            <Text style={styles.moreText}>Clear history</Text>
          </Pressable>
        </View>
      </Modal>

      <MuteSheet
        visible={muteTargets.length > 0}
        onClose={() => setMuteTargets([])}
        mutedUntil={muteTargets.length === 1 ? muteTargets[0].mutedUntil ?? null : null}
        onMute={(until) => {
          const rows = muteTargets;
          setMuteTargets([]);
          void applyMute(rows, until);
        }}
      />

      <ConfirmDialog
        visible={confirm !== null}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirm?.kind === 'delete' ? 'Delete' : 'Clear'}
        destructive
        // Acting for the other person is only offered for a single chat, as in Telegram.
        checkboxLabel={confirm && confirm.rows.length === 1
          ? `Also ${confirm.kind === 'delete' ? 'delete' : 'clear'} for ${confirm.rows[0].user.name}`
          : undefined}
        onCancel={() => setConfirm(null)}
        onConfirm={(forEveryone) => {
          if (confirm) runConfirmed(confirm.kind, confirm.rows, forEveryone);
          setConfirm(null);
        }}
      />

      {undo ? (
        <UndoSnackbar
          key={undo.id}
          message={undo.message}
          bottom={inArchive ? Math.max(insets.bottom, 12) + 8 : 104}
          onUndo={() => settleUndo(undo.id, 'revert')}
          onTimeout={() => settleUndo(undo.id, 'commit')}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  connectionNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginBottom: 8, paddingLeft: 12, paddingRight: 6, borderRadius: 14, backgroundColor: '#232323' },
  connectionNoticeText: { flex: 1, color: '#BDB7C0', fontSize: 12, lineHeight: 17, paddingVertical: 10 },
  connectionRetry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  connectionRetryText: { color: '#F3C1CA', fontSize: 12, fontWeight: '700' },
  loadRetry: { minHeight: 44, paddingHorizontal: 24, borderRadius: 22, backgroundColor: '#F3C1CA', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  loadRetryText: { color: '#331C23', fontWeight: '700', fontSize: 14 },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Header
  header: {
    paddingHorizontal: 22,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text.primary,
    letterSpacing: -0.4,
  },
  headerBadge: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Selection mode
  selectionCount: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text.primary,
  },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreMenu: {
    position: 'absolute',
    right: 12,
    minWidth: 200,
    backgroundColor: '#242424',
    borderRadius: 14,
    paddingVertical: 6,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  moreRow: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
  },
  moreRowPressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  moreText: {
    color: '#FFFFFF',
    fontSize: 15,
  },

  // Search
  searchContainer: {
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  searchBox: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#232323',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    paddingVertical: 0,
  },

  // New Matches Section
  matchesSection: {
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    marginBottom: 10,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionBadge: {
    backgroundColor: 'rgba(242, 13, 128, 0.15)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sectionBadgeText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  matchesTray: {
    paddingHorizontal: 18,
    gap: 14,
  },
  matchItem: {
    width: 66,
    alignItems: 'center',
  },
  newMatchDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    borderWidth: 2.5,
    borderColor: colors.background,
  },
  matchAvatarRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    padding: 2.5,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  matchAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
  },
  matchName: {
    color: colors.text.primary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    width: 66,
    textAlign: 'center',
  },

  // Conversations List
  listContent: {
    paddingTop: 6,
    paddingBottom: 110,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginLeft: 88,
  },

  // Archived chats row
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 20,
  },
  archivedIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#3A3A3C',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },

  // Swipe
  swipeAction: {
    width: 96,
    backgroundColor: '#3A7BD5',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },

  // Conversation Item
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 20,
    // Opaque, so the swipe action underneath shows only where the row has moved.
    backgroundColor: colors.background,
  },
  conversationItemUnread: {
    backgroundColor: '#161113',
  },
  conversationItemSelected: {
    backgroundColor: '#241A1D',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.surface,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: colors.background,
  },
  unreadAvatarDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.background,
  },
  mutedAvatarDot: {
    backgroundColor: colors.text.tertiary,
  },
  selectedCheck: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conversationContent: {
    flex: 1,
    justifyContent: 'center',
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  nameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  nameIcon: {
    marginLeft: 5,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E2E8F0',
    flexShrink: 1,
  },
  userNameUnread: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  timeText: {
    fontSize: 12,
    color: colors.text.tertiary,
    fontWeight: '500',
  },
  timeTextUnread: {
    color: colors.primary,
    fontWeight: '700',
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
  statusCheckmark: {
    marginRight: 4,
  },
  lastMessage: {
    fontSize: 14,
    color: colors.text.tertiary,
    flex: 1,
    marginRight: 8,
    lineHeight: 18,
  },
  lastMessageUnread: {
    color: '#CBD5E1',
    fontWeight: '600',
  },
  lastMessageService: {
    fontStyle: 'italic',
  },
  unreadBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  // Muted chats still show their count, greyed, as Telegram does.
  unreadBadgeMuted: {
    backgroundColor: '#5A5A5E',
    shadowOpacity: 0,
    elevation: 0,
  },
  unreadBadgeDot: {
    minWidth: 12,
    width: 12,
    height: 12,
    borderRadius: 6,
    paddingHorizontal: 0,
  },
  pinIcon: {
    transform: [{ rotate: '45deg' }],
  },
  unreadText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingBottom: 40,
  },
  messagesKitten: { width: 124, height: 186, marginBottom: 16 },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text.primary,
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  archiveEmptyTitle: {
    marginTop: 14,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#D2C9CD',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
  },
  emptyCtaButton: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyCtaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    paddingHorizontal: 24,
  },
  emptyCtaText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
