import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
  Animated,
  Dimensions,
  Keyboard,
  ScrollView,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { EmojiKeyboard } from 'rn-emoji-keyboard';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useSelector, useDispatch } from 'react-redux';
import { VoiceRecordBar } from '../components/VoiceRecordBar';
import AnimatedReanimated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, withSpring } from 'react-native-reanimated';
import { useKeyboardHandler } from 'react-native-keyboard-controller';
import { RootState } from '../../../store';
import { api } from '../../../services/api';
import { getDeviceId } from '../../../services/deviceIdentity';
import { getSocket, initSocket } from '../../../services/socket';
import { addToOfflineQueue, getOfflineQueue, setupQueueRetry, retryOfflineMessages, removeFromQueue, triggerQueueRetry } from '../../../services/offlineQueue';
import {
  setMessages,
  prependMessages,
  addMessage,
  markConversationRead,
  setTyping,
  setLoadingMessages,
  replaceOptimisticMessage,
  removeMessage,
  applyMessageEdit,
  applyReaction,
  markMessagesReadByPeer,
  Message,
} from '../../../store/chatSlice';
import { colors } from '../../../core/theme/colors';
import { useNavigation, useRoute } from '@react-navigation/native';


const { width } = Dimensions.get('window');
const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop';

interface RouteParams {
  matchId: string;
  userName?: string;
  userAvatar?: string | null;
  userId?: string;
  focusMessageId?: string;
}

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// Group messages by date for section headers
function groupMessagesByDate(messages: Message[]): { date: string; data: Message[] }[] {
  const groups: Record<string, Message[]> = {};
  for (const msg of messages) {
    const dateKey = new Date(msg.sentAt).toDateString();
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(msg);
  }
  return Object.entries(groups).map(([date, data]) => ({
    date,
    data,
  }));
}

const TypingIndicator = () => {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animateDot = (dot: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
        ])
      );
    };
    const a1 = animateDot(dot1, 0);
    const a2 = animateDot(dot2, 150);
    const a3 = animateDot(dot3, 300);
    a1.start();
    a2.start();
    a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  return (
    <View style={styles.typingContainer}>
      <View style={styles.typingBubble}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View
            key={i}
            style={[
              styles.typingDot,
              { transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] },
            ]}
          />
        ))}
      </View>
    </View>
  );
};

import { MessageBubble } from '../components/MessageBubble';
import { CropModal } from '../components/CropModal';
import { MediaWorkspace } from '../components/MediaWorkspace';
import { createTypingPresence } from '../typingPresence';
import { discardDraftMedia, discardDraftMediaBatch } from '../draftMedia';

interface SelectedMedia {
  originalUri: string;
  currentUri: string;
  caption?: string;
}

export const ChatScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const params = route.params as RouteParams;
  const matchId = params.matchId;
  const dispatch = useDispatch();

  const currentUserId = useSelector((state: RootState) => state.auth.user?.id);
  const conversation = useSelector((state: RootState) => state.chat.conversations.find((item) => item.matchId === matchId));
  const userName = params.userName ?? conversation?.user.name ?? 'Chat';
  const userAvatar = params.userAvatar ?? conversation?.user.avatar ?? null;
  const userId = params.userId ?? conversation?.user.id ?? '';
  const messages = useSelector(
    (state: RootState) => state.chat.activeMessages[matchId] ?? [],
    (a, b) => {
      if (a.length !== b.length) return false;
      // Stable comparison: check if all IDs match in order
      for (let i = 0; i < a.length; i++) {
        if (a[i]?.id !== b[i]?.id) return false;
      }
      return true;
    }
  );
  const isLoading = useSelector((state: RootState) => state.chat.isLoadingMessages);
  const typingSenderId = useSelector((state: RootState) => state.chat.typingUsers[matchId] ?? null);

  const [text, setText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [selectedImages, setSelectedImages] = useState<SelectedMedia[]>([]);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [photoToCrop, setPhotoToCrop] = useState<string | null>(null);
  const [cropIndex, setCropIndex] = useState<number>(-1);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  const scrollBtnScale = useSharedValue(0);
  
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const optimisticIdsRef = useRef<Map<string, {tempId: string, realId?: string, sentAt: number, sequenceNum: number, content: string}>>(new Map());
  const messageSequenceRef = useRef<number>(0); // Track message order like WhatsApp
  const pendingServerAcksRef = useRef<Map<string, any>>(new Map()); // Buffer for out-of-order arrivals
  const processedServerIdsRef = useRef<Set<string>>(new Set()); // Server IDs already handled by callbacks — skip in new_message
  const lastEventSeqRef = useRef(0);
  const messageIdsRef = useRef<Set<string>>(new Set()); // Fresh dedup set, updated on every messages change
  const queueRetryInProgressRef = useRef(false); // Prevent double retry (mount + connect event)
  const isScrolledUpRef = useRef(false);
  const isScrollingDownRef = useRef(false);

  const emojiHeight = useSharedValue(0);
  const [keyboardHeight, setKeyboardHeight] = useState(300); // Dynamic fallback
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  const prevKeyboardHeight = useSharedValue(0);
  const savedKeyboardHeight = useSharedValue(keyboardHeight);
  const isAndroid = useSharedValue(Platform.OS === 'android');

  // Frame-by-frame synchronized keyboard positioning
  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        const absHeight = Math.abs(e.height);
        const isRising = absHeight > prevKeyboardHeight.value;
        prevKeyboardHeight.value = absHeight;

        // Only allow keyboard tracking to adjust spacer if Emoji is NOT open
        if (!showEmoji) {
          emojiHeight.value = absHeight;
        } else {
          // If emoji is open but keyboard starts RISING (e.g., tapped text input)
          if (isRising && absHeight > 10) {
            runOnJS(setShowEmoji)(false);
            // Smooth transition: deduce from fully loaded offset avoids collapse jumps
            emojiHeight.value = Math.max(0, savedKeyboardHeight.value - absHeight);
          }
        }
      },
      onEnd: (e) => {
        'worklet';
        const absHeight = Math.abs(e.height);
        prevKeyboardHeight.value = absHeight; // Sync at end frame

        if (e.height > 0) {
          savedKeyboardHeight.value = e.height; // Cache fully opened height
          runOnJS(setKeyboardHeight)(e.height);
          runOnJS(setIsKeyboardVisible)(true);
        } else {
          runOnJS(setIsKeyboardVisible)(false);
          if (!showEmoji) {
            emojiHeight.value = 0;
          }
        }
      },
    },
    [showEmoji]
  );

  // Keep messageIdsRef in sync with messages (avoids stale closure in socket handlers)
  useEffect(() => {
    const idSet = new Set(messages.map(m => m.id));
    messageIdsRef.current = idSet;
  }, [messages]);

  // Fetch messages — smart: uses cache if available, only fetches new ones
  const fetchMessages = useCallback(async (cursor?: string) => {
    try {
      dispatch(setLoadingMessages(true));
      const params: any = { limit: 30 };
      if (cursor) params.cursor = cursor;
      const response = await api.get(`/chat/${matchId}/messages`, { params });
      if (response.data?.success) {
        const result = response.data.data;
        // Messages come newest-first from API, keep as is for inverted list
        if (cursor) {
          dispatch(prependMessages({ matchId, messages: result.messages }));
        } else {
          dispatch(setMessages({ matchId, messages: result.messages }));
        }
        setNextCursor(result.nextCursor);
        setHasMore(result.hasMore);
      }
    } catch (err) {
      console.error('[Chat] Error fetching messages:', err);
    } finally {
      dispatch(setLoadingMessages(false));
    }
  }, [dispatch, matchId]);

  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    
    if (isScrollingDownRef.current) {
      if (offset < 10) isScrollingDownRef.current = false;
      return;
    }

    const isUp = offset > 100;
    setShowScrollDown(isUp);
    isScrolledUpRef.current = isUp;
    if (!isUp) {
      setUnreadCount(0);
    }
  }, []);

  useEffect(() => {
    if (showScrollDown) {
      scrollBtnScale.value = 1; // Instant show
    } else {
      scrollBtnScale.value = withTiming(0, { duration: 200 }); // Smooth vanish
    }
  }, [showScrollDown]);

  const animatedScrollBtnStyle = useAnimatedStyle(() => {
    return {
      opacity: scrollBtnScale.value,
      transform: [{ scale: scrollBtnScale.value }],
    };
  });

  // Fetch only new messages since our latest cached message
  const fetchNewMessages = useCallback(async () => {
    try {
      const cachedMessages = messages.filter(m => !m.id.startsWith('temp-'));
      if (cachedMessages.length === 0) return fetchMessages(); // No cache, full fetch

      // For the inverted list, index 0 is the newest confirmed message.
      let syncCursor = { sentAt: cachedMessages[0].sentAt, id: cachedMessages[0].id };
      for (let page = 0; page < 10; page += 1) {
        const response = await api.get(`/chat/${matchId}/messages`, {
          params: { since: syncCursor.sentAt, sinceId: syncCursor.id },
        });
        if (!response.data?.success) break;
        const newMsgs: Message[] = response.data.data.messages;
        // Messages come ASC from API (oldest first) when using 'since' param
        // This is CORRECT for adding to inverted list - they'll be prepended in right order
        for (const msg of newMsgs) {
          // Deduplication check
          if (!messages.some(m => m.id === msg.id)) {
            dispatch(addMessage(msg));
          }
        }
        if (!response.data.data.hasMore) break;
        syncCursor = response.data.data.syncCursor;
      }
    } catch (err) {
      console.error('[Chat] Error fetching new messages:', err);
    }
  }, [dispatch, matchId, messages, fetchMessages]);

  useEffect(() => {
    // If we have ANY cached messages (including temp/optimistic), sync delta only.
    // NEVER call fetchMessages() when temp messages exist — it would wipe them.
    if (params.focusMessageId) {
      api.get(`/chat/${matchId}/messages/${params.focusMessageId}/context`).then((response) => {
        dispatch(setMessages({ matchId, messages: [...response.data.data].reverse() }));
        setHasMore(false);
        setNextCursor(null);
      }).catch(() => fetchMessages());
    } else if (messages.length > 0) {
      fetchNewMessages();
    } else {
      fetchMessages();
    }
    // Cleanup on unmount: clear typing indicator
    return () => {
      const socket = getSocket();
      if (socket && isTypingRef.current) {
        socket.emit('typing_stop', { matchId });
        isTypingRef.current = false;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [matchId, params.focusMessageId]);

  useEffect(() => {
    if (!params.focusMessageId) return;
    const itemIndex = messages.findIndex((message) => message.id === params.focusMessageId);
    if (itemIndex >= 0) setTimeout(() => flatListRef.current?.scrollToIndex({ index: itemIndex, animated: false }), 50);
  }, [messages, params.focusMessageId]);

  const acknowledgeVisible = useCallback((ids: string[]) => {
    const unreadIds = ids.filter((id) => messages.some((message) => message.id === id && message.senderId !== currentUserId && !message.readAt));
    if (!unreadIds.length) return;
    const socket = getSocket();
    if (socket?.connected) socket.emit('message_read', { matchId, messageIds: unreadIds });
    else api.patch(`/chat/${matchId}/read`, { messageIds: unreadIds }).catch(() => undefined);
    dispatch(markConversationRead(matchId));
  }, [matchId, messages, currentUserId, dispatch]);

  // Socket.IO setup
  useEffect(() => {
    initSocket();
    const socket = getSocket();
    if (!socket) return;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setConnectionStatus(socket.connected ? 'connected' : 'disconnected');

    // Queue Retry Trigger Setup
    
    // Shared retry function — registers optimistic IDs, then retries with per-message callback
    const performQueueRetry = async () => {
      if (!active) return;
      if (queueRetryInProgressRef.current) {
        console.log('[Chat] Queue retry already in progress, skipping');
        return;
      }
      queueRetryInProgressRef.current = true;
      
      try {
        // Register queued messages into optimisticIdsRef BEFORE retry
        const queue = await getOfflineQueue();
        if (!active) return;
        const matchQueue = queue.filter(m => m.matchId === matchId);
        for (const item of matchQueue) {
          if (!optimisticIdsRef.current.has(item.tempId)) {
            optimisticIdsRef.current.set(item.tempId, {
              tempId: item.tempId,
              sentAt: item.queuedAt,
              sequenceNum: item.sequenceNum ?? 0,
              content: item.content,
            });
          }
        }
        
        // Per-message callback: fires IMMEDIATELY when server confirms each message
        // This beats the new_message broadcast, preventing duplicates and content swaps
        await triggerQueueRetry(socket, matchId, (queuedMsg, serverMessage) => {
          if (!active) return;
          console.log(`[Chat] Queue callback: ${queuedMsg.tempId} -> ${serverMessage.id}`);
          // Mark server ID as processed BEFORE broadcast arrives
          processedServerIdsRef.current.add(serverMessage.id);
          // Remove from optimistic tracking
          optimisticIdsRef.current.delete(queuedMsg.tempId);
          dispatch(replaceOptimisticMessage({ tempId: queuedMsg.tempId, realMessage: serverMessage }));
        });
        const failed = (await getOfflineQueue()).filter((message) => message.matchId === matchId && message.status === 'failed');
        if (active && failed.length) Alert.alert('Messages not sent', `${failed.length} message(s) could not be sent. Their drafts remain stored on this device. Later messages can still be sent.`);
      } catch (err) {
        console.error('[Chat] Queue retry failed:', err);
      } finally {
        queueRetryInProgressRef.current = false;
      }
    };
    
    if (socket.connected) {
      performQueueRetry();
    }

    // Join this match room
    socket.emit('join_match_room', matchId);

    const applyChatEvent = (event: any) => {
      if (event.matchId !== matchId || event.eventSeq <= lastEventSeqRef.current) return;
      lastEventSeqRef.current = event.eventSeq;
      const payload = event.payload || {};
      if (event.type === 'message.created' && payload.message) {
        const message = payload.message as Message;
        if (message.senderId === currentUserId && message.clientMessageId && optimisticIdsRef.current.has(message.clientMessageId)) {
          dispatch(replaceOptimisticMessage({ tempId: message.clientMessageId, realMessage: message }));
          optimisticIdsRef.current.delete(message.clientMessageId);
        } else dispatch(addMessage(message));
      }
      if (event.type === 'message.edited') dispatch(applyMessageEdit({ matchId, ...payload }));
      if (event.type === 'message.deleted' || event.type === 'message.hidden') dispatch(removeMessage({ matchId, messageId: payload.messageId }));
      if (event.type === 'reaction.set' || event.type === 'reaction.removed') dispatch(applyReaction({ matchId, messageId: payload.messageId, userId: payload.userId, emoji: payload.emoji }));
      if (event.type === 'messages.read' && payload.userId !== currentUserId) dispatch(markMessagesReadByPeer({ matchId, messageIds: payload.messageIds, throughMessageSeq: payload.throughMessageSeq, readAt: payload.readAt }));
    };

    let syncing = false;
    let syncRequested = false;
    const syncEvents = async (_apply: boolean) => {
      if (!active) return;
      if (syncing) { syncRequested = true; return; }
      syncing = true;
      try {
      do {
      syncRequested = false;
      let afterSeq = lastEventSeqRef.current;
      while (active) {
        const response = await api.get(`/chat/${matchId}/events`, { params: { afterSeq, limit: 200 } });
        const result = response.data.data;
        if (!active) return;
        if (result.resetRequired) {
          await fetchMessages();
          lastEventSeqRef.current = result.highWaterSeq;
          break;
        }
        result.events.forEach(applyChatEvent);
        if (result.hasMore && result.nextSeq <= afterSeq) throw new Error('Chat replay cursor did not advance');
        afterSeq = result.nextSeq;
        lastEventSeqRef.current = Math.max(lastEventSeqRef.current, afterSeq);
        if (!result.hasMore) break;
      }
      } while (syncRequested && active);
      if (!active) return;
      const deviceId = await getDeviceId();
      await api.put(`/chat/${matchId}/device-cursor`, { deviceId, eventSeq: lastEventSeqRef.current });
      } finally { syncing = false; }
    };
    const handleChatEvent = (event: any) => {
      if (event.matchId === matchId) void syncEvents(true).catch(() => undefined);
    };
    syncEvents(false).catch(() => undefined);

    // Listen for new messages
    const handleNewMessage = (msg: Message) => {
      if (!active || msg.matchId !== matchId) return;
      console.log('[Chat] new_message:', msg.id, 'from:', msg.senderId === currentUserId ? 'me' : 'other');
      
      if (msg.senderId === currentUserId) {
        if (processedServerIdsRef.current.has(msg.id) || messageIdsRef.current.has(msg.id)) return;
        if (msg.clientMessageId && optimisticIdsRef.current.has(msg.clientMessageId)) {
          optimisticIdsRef.current.delete(msg.clientMessageId);
          processedServerIdsRef.current.add(msg.id);
          dispatch(replaceOptimisticMessage({ tempId: msg.clientMessageId, realMessage: msg }));
          return;
        }
        if (processedServerIdsRef.current.has(msg.id)) return;
        dispatch(addMessage(msg));
        return;
      }
      
      // --- Only OTHER users' messages reach here ---
      
      // Deduplication check
      if (messageIdsRef.current.has(msg.id)) {
        return;
      }
      
      dispatch(addMessage(msg));
      
      // Add local unread count if scrolled up
      if (isScrolledUpRef.current) {
        setUnreadCount(prev => prev + 1);
      }

      if (!isScrolledUpRef.current) {
        if (socket.connected) socket.emit('message_read', { matchId, messageIds: [msg.id] });
        else api.patch(`/chat/${matchId}/read`, { messageIds: [msg.id] }).catch(() => {});
      }
    };

    // Listen for read receipts — DON'T re-fetch (would risk wiping temp messages)
    const handleMessagesRead = (data: { matchId: string; readBy: string; readAt?: string }) => {
      if (data.matchId === matchId && data.readBy !== currentUserId) {
        dispatch(markMessagesReadByPeer({ matchId, readAt: data.readAt ?? new Date().toISOString() }));
      }
    };

    // Typing indicators. typing_stop is not guaranteed to arrive, so the
    // indicator expires on its own. See features/chat/typingPresence.
    let typingSenderId: string | null = null;
    const typingPresence = createTypingPresence((typing) => {
      dispatch(setTyping({ matchId, senderId: typing ? typingSenderId : null }));
    });
    const handleTypingStart = (data: { senderId: string; matchId: string }) => {
      if (data.matchId === matchId && data.senderId !== currentUserId) {
        typingSenderId = data.senderId;
        typingPresence.start();
      }
    };
    const handleTypingStop = (data: { senderId: string; matchId: string }) => {
      if (data.matchId === matchId && data.senderId !== currentUserId) {
        typingPresence.stop();
      }
    };

    // Listen for deleted messages
    const handleMessageDeleted = (data: { messageId: string; matchId: string }) => {
      if (data.matchId === matchId) {
        dispatch(removeMessage({ matchId, messageId: data.messageId }));
      }
    };

    // Connection status monitoring with retry logic
    const handleConnect = async () => {
      setConnectionStatus('connected');
      // Wait for the acknowledged join before catching up. Emitting and then
      // syncing immediately could miss events broadcast to the room while the
      // join was still in flight.
      const joined = await new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (success = false) => {
          if (settled) return;
          settled = true;
          resolve(success);
        };
        const timer = setTimeout(done, 3000);
        socket.emit('join_match_room', matchId, (response: { success?: boolean }) => {
          clearTimeout(timer);
          done(response?.success === true);
        });
      });
      if (!active) return;
      if (!joined) { setConnectionStatus('disconnected'); return; }
      syncEvents(true).catch(() => undefined);
      // Trigger offline queue retry when connection is restored
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => performQueueRetry(), 1000);
    };
    const handleDisconnect = () => setConnectionStatus('disconnected');
    const handleReconnectAttempt = () => setConnectionStatus('reconnecting');

    socket.on('new_message', handleNewMessage);
    socket.on('messages_read', handleMessagesRead);
    socket.on('typing_start', handleTypingStart);
    socket.on('typing_stop', handleTypingStop);
    socket.on('message_deleted', handleMessageDeleted);
    socket.on('chat_event', handleChatEvent);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);

    return () => {
      active = false;
      clearTimeout(retryTimer);
      socket.off('new_message', handleNewMessage);
      socket.off('messages_read', handleMessagesRead);
      socket.off('typing_start', handleTypingStart);
      socket.off('typing_stop', handleTypingStop);
      typingPresence.dispose();
      socket.off('message_deleted', handleMessageDeleted);
      socket.off('chat_event', handleChatEvent);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      dispatch(setTyping({ matchId, senderId: null }));
    };
  }, [matchId, currentUserId, dispatch, fetchMessages]);

  // Send message — optimistic UI: show instantly, confirm with server
  const handleSend = useCallback(async () => {
    if ((!text.trim() && selectedImages.length === 0) || isSending) return;
    
    const captionsCount = selectedImages.filter(img => img.caption && img.caption.trim()).length;
    const shouldSplit = captionsCount > 1 && !replyingTo;
    const replyToId = replyingTo?.id;

    setIsSending(true);

    // Emit typing stop
    const socket = getSocket();
    if (socket && isTypingRef.current) {
      socket.emit('typing_stop', { matchId });
      isTypingRef.current = false;
    }

    try {
      if (shouldSplit) {
        // 1. Upload all images in parallel
        const uploadPromises = selectedImages.map(async (img) => {
          const ext = img.currentUri.split('.').pop() || 'jpeg';
          const urlResponse = await api.get(`/chat/${matchId}/media/upload-url?ext=${ext}`);
          if (urlResponse.data?.success) {
            const { uploadUrl, mediaKey, assetId, contentType } = urlResponse.data.data;
            const imgResponse = await fetch(img.currentUri);
            const blob = await imgResponse.blob();
            const uploadResponse = await fetch(uploadUrl, {
              method: 'PUT',
              body: blob,
              headers: { 'Content-Type': contentType },
            });
            if (!uploadResponse.ok) throw new Error('Failed to upload image');
            const completed = await api.post(`/chat/${matchId}/media/${assetId}/complete`, undefined, { timeout: 120000 });
            return { mediaKey: completed.data.data.mediaKey, caption: img.caption || '', localUri: img.currentUri };
          }
          throw new Error('Failed to upload image');
        });

        const uploadedMedia = await Promise.all(uploadPromises);

        // 2. Clear inputs
        setText('');
        setSelectedImages([]);
        setReplyingTo(null);

        // 3. Create optimistic messages with UNIQUE IDs and SEQUENCE NUMBERS (WhatsApp-style)
        const baseTime = Date.now();
        const messagesToSend = uploadedMedia.map((item, index) => {
          const tempId = `temp-${baseTime}-${index}-${Math.random().toString(36).slice(2, 7)}`;
          const sentAt = new Date(baseTime + index).toISOString(); // Ensure unique timestamps
          const sequenceNum = ++messageSequenceRef.current; // Increment sequence like WhatsApp
          
          const optimisticMsg: Message = {
            id: tempId,
            content: item.caption,
            mediaKeys: [`local-${item.localUri}`],
            senderId: currentUserId!,
            sentAt,
            readAt: null,
            matchId,
          };
          return { tempId, optimisticMsg, item, sentAt, sequenceNum };
        });

        messagesToSend.forEach(m => {
          dispatch(addMessage(m.optimisticMsg));
          optimisticIdsRef.current.set(m.tempId, { 
            tempId: m.tempId, 
            sentAt: Date.now(),
            sequenceNum: m.sequenceNum,
            content: m.item.caption // Store content for accurate matching
          });
        });

        // 4. Send SEQUENTIALLY to preserve order (with retry logic)
        for (const m of messagesToSend) {
          let sent = false;
          let attempts = 0;
          const maxAttempts = 3;
          
          while (!sent && attempts < maxAttempts) {
            try {
              // Check connection status BEFORE attempting
              const isConnected = socket?.connected === true;
              
              if (!isConnected && attempts === 0) {
                // Immediately queue if offline on first attempt
                await addToOfflineQueue({
                  tempId: m.tempId,
                  matchId,
                  content: m.item.caption,
                  mediaKeys: [m.item.mediaKey],
                  queuedAt: Date.now(),
                  status: 'pending',
                  sequenceNum: m.sequenceNum, // Preserve original send order
                });
                console.log(`[Chat] Message ${m.tempId} queued (offline) with sequence ${m.sequenceNum}`);
              }
              
              await new Promise<void>((resolve, reject) => {
                // Add to offline queue BEFORE sending (idempotent)
                addToOfflineQueue({
                  tempId: m.tempId,
                  matchId,
                  content: m.item.caption,
                  mediaKeys: [m.item.mediaKey],
                  queuedAt: Date.now(),
                  status: 'sending',
                  sequenceNum: m.sequenceNum, // Preserve original send order
                }).catch(err => console.error('[Chat] Failed to queue:', err));

                const socketTimeout = setTimeout(() => {
                  console.log(`[Chat] Socket timeout for message ${m.tempId}`);
                  reject(new Error('Socket timeout'));
                }, 10000); // 10 second timeout

                // Only try socket if connected
                if (isConnected) {
                  socket.emit('send_message', { 
                    matchId, 
                    content: m.item.caption, 
                    mediaKeys: [m.item.mediaKey] 
                    , clientMessageId: m.tempId
                  }, (response: any) => {
                    clearTimeout(socketTimeout);
                    if (response?.success && response.message) {
                      // Successfully sent - remove from queue and update UI
                      removeFromQueue(m.tempId).catch(err => console.error('[Chat] Failed to remove from queue:', err));
                      optimisticIdsRef.current.delete(m.tempId);
                      processedServerIdsRef.current.add(response.message.id);
                      dispatch(replaceOptimisticMessage({ tempId: m.tempId, realMessage: response.message }));
                      sent = true;
                    } else if (response?.error === 'duplicate') {
                      // Server detected duplicate - already handled
                      removeFromQueue(m.tempId).catch(err => console.error('[Chat] Failed to remove from queue:', err));
                      optimisticIdsRef.current.delete(m.tempId);
                      sent = true;
                    }
                    resolve();
                  });
                } else {
                  clearTimeout(socketTimeout);
                  // Don't reject immediately - let it queue and retry later
                  resolve();
                }
              });
              
              // If socket wasn't connected, break and wait for reconnection
              if (!isConnected) {
                console.log(`[Chat] Waiting for reconnection to send message ${m.tempId}`);
                break; // Exit retry loop, message stays in queue
              }
              
            } catch (err) {
              attempts++;
              console.log(`[Chat] Send attempt ${attempts}/${maxAttempts} failed for message ${m.tempId}`);
              
              if (attempts >= maxAttempts) {
                // Final fallback to REST API only if we have connection
                const isConnected = socket?.connected === true;
                if (isConnected) {
                  try {
                    const response = await api.post(`/chat/${matchId}/messages`, { 
                      content: m.item.caption, 
                      mediaKeys: [m.item.mediaKey],
                      clientMessageId: m.tempId,
                    });
                    if (response.data?.success && optimisticIdsRef.current.has(m.tempId)) {
                      optimisticIdsRef.current.delete(m.tempId);
                      processedServerIdsRef.current.add(response.data.data.id);
                      dispatch(replaceOptimisticMessage({ tempId: m.tempId, realMessage: response.data.data }));
                      removeFromQueue(m.tempId).catch(err => console.error('[Chat] Failed to remove from queue:', err));
                      sent = true;
                      console.log(`[Chat] Message ${m.tempId} sent via REST fallback`);
                    }
                  } catch (restErr) {
                    console.error('[Chat] REST fallback failed:', restErr);
                    // Message stays in queue for later retry
                  }
                } else {
                  console.log(`[Chat] Still offline, keeping message ${m.tempId} in queue`);
                }
              } else {
                // Wait before retry (exponential backoff)
                const delay = Math.pow(2, attempts) * 1000;
                console.log(`[Chat] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
          }
        }

      } else {
        // Condition B: Grouped send with retry logic
        let content = text.trim();
        const captions = selectedImages.map(img => img.caption).filter(Boolean);
        if (captions.length > 0) {
          content = content ? `${content}\n\n${captions.join('\n')}` : captions.join('\n');
        }
        
        const imageUris = selectedImages.map(img => img.currentUri);
        
        setText('');
        setSelectedImages([]);
        setReplyingTo(null);

        // Unique ID generation
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const sentAt = new Date().toISOString();
        const optimisticMsg: Message = {
          id: tempId,
          content,
          mediaKeys: imageUris.map(uri => `local-${uri}`),
          senderId: currentUserId!,
          sentAt,
          readAt: null,
          matchId,
          replyToId,
        };

        dispatch(addMessage(optimisticMsg));
        const seqNum = ++messageSequenceRef.current;
        optimisticIdsRef.current.set(tempId, { 
          tempId, 
          sentAt: Date.now(),
          sequenceNum: seqNum,
          content // Store COMPUTED content (with captions), not raw text
        });

        let finalMediaKeys: string[] = [];

        if (imageUris.length > 0) {
          const uploadPromises = imageUris.map(async (imageUri) => {
            const ext = imageUri.split('.').pop() || 'jpeg';
            const urlResponse = await api.get(`/chat/${matchId}/media/upload-url?ext=${ext}`);
            if (urlResponse.data?.success) {
              const { uploadUrl, mediaKey, assetId, contentType } = urlResponse.data.data;
              const imgResponse = await fetch(imageUri);
              const blob = await imgResponse.blob();
              const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                body: blob,
                headers: { 'Content-Type': contentType },
              });
              if (!uploadResponse.ok) throw new Error('Upload failed');
              const completed = await api.post(`/chat/${matchId}/media/${assetId}/complete`, undefined, { timeout: 120000 });
              return completed.data.data.mediaKey;
            }
            throw new Error('Upload failed');
          });

          finalMediaKeys = await Promise.all(uploadPromises);
        }

        // Send with retry logic
        let sent = false;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (!sent && attempts < maxAttempts) {
          try {
            // Check connection status BEFORE attempting
            const isConnected = socket?.connected === true;
            
            if (!isConnected && attempts === 0) {
              // Immediately queue if offline on first attempt
              await addToOfflineQueue({
                tempId,
                matchId,
                content,
                mediaKeys: finalMediaKeys,
                queuedAt: Date.now(),
                status: 'pending',
                sequenceNum: seqNum, // Use SAME sequence number (don't double-increment!)
                replyToId,
              });
              console.log(`[Chat] Message ${tempId} queued (offline) with sequence ${messageSequenceRef.current}`);
            }
            
            await new Promise<void>((resolve, reject) => {
              // Add to offline queue BEFORE sending (idempotent)
              addToOfflineQueue({
                tempId,
                matchId,
                content,
                mediaKeys: finalMediaKeys,
                queuedAt: Date.now(),
                status: 'sending',
                sequenceNum: seqNum, // Use SAME sequence number
                replyToId,
              }).catch(err => console.error('[Chat] Failed to queue:', err));

              const socketTimeout = setTimeout(() => {
                console.log(`[Chat] Socket timeout for message ${tempId}`);
                reject(new Error('Socket timeout'));
              }, 10000); // 10 second timeout

              // Only try socket if connected
              if (isConnected) {
                socket.emit('send_message', { matchId, content, mediaKeys: finalMediaKeys, clientMessageId: tempId, replyToId }, (response: any) => {
                  clearTimeout(socketTimeout);
                  if (response?.success && response.message) {
                    // Successfully sent - remove from queue and update UI
                    removeFromQueue(tempId).catch(err => console.error('[Chat] Failed to remove from queue:', err));
                    optimisticIdsRef.current.delete(tempId);
                    processedServerIdsRef.current.add(response.message.id);
                    dispatch(replaceOptimisticMessage({ tempId, realMessage: response.message }));
                    // Cropped and picked copies live in this app's cache. They
                    // are delivered now, so reclaim the space.
                    void discardDraftMediaBatch(imageUris);
                    sent = true;
                  } else if (response?.error === 'duplicate') {
                    // Server detected duplicate - already handled
                    removeFromQueue(tempId).catch(err => console.error('[Chat] Failed to remove from queue:', err));
                    optimisticIdsRef.current.delete(tempId);
                    sent = true;
                  }
                  resolve();
                });
              } else {
                clearTimeout(socketTimeout);
                // Don't reject immediately - let it queue and retry later
                resolve();
              }
            });
            
            // If socket wasn't connected, break and wait for reconnection
            if (!isConnected) {
              console.log(`[Chat] Waiting for reconnection to send message ${tempId}`);
              break; // Exit retry loop, message stays in queue
            }
            
          } catch (err) {
            attempts++;
            console.log(`[Chat] Send attempt ${attempts}/${maxAttempts} failed for message ${tempId}`);
            
            if (attempts >= maxAttempts) {
              // Final fallback to REST API only if we have connection
              const isConnected = socket?.connected === true;
              if (isConnected) {
                try {
                  const response = await api.post(`/chat/${matchId}/messages`, { content, mediaKeys: finalMediaKeys, clientMessageId: tempId, replyToId });
                  if (response.data?.success && optimisticIdsRef.current.has(tempId)) {
                    optimisticIdsRef.current.delete(tempId);
                    processedServerIdsRef.current.add(response.data.data.id);
                    dispatch(replaceOptimisticMessage({ tempId, realMessage: response.data.data }));
                    removeFromQueue(tempId).catch(err => console.error('[Chat] Failed to remove from queue:', err));
                    sent = true;
                    console.log(`[Chat] Message ${tempId} sent via REST fallback`);
                  }
                } catch (restErr) {
                  console.error('[Chat] REST fallback failed:', restErr);
                  // Message stays in queue for later retry
                }
              } else {
                console.log(`[Chat] Still offline, keeping message ${tempId} in queue`);
              }
            } else {
              // Wait before retry (exponential backoff)
              const delay = Math.pow(2, attempts) * 1000;
              console.log(`[Chat] Retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
      }
    } catch (err) {
      console.error('[Chat] Error sending message:', err);
    } finally {
      setIsSending(false);
    }
  }, [text, selectedImages, matchId, dispatch, isSending, currentUserId, replyingTo]);

  const handleToggleEmoji = () => {
    if (showEmoji) {
      setShowEmoji(false);
      emojiHeight.value = withTiming(0, { duration: 150 });
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setShowEmoji(true);
      if (isKeyboardVisible) {
        emojiHeight.value = keyboardHeight; // Seize height instant
        Keyboard.dismiss();
      } else {
        emojiHeight.value = withTiming(keyboardHeight, { duration: 150 }); // smooth expand
      }
    }
  };

  const handleInputFocus = () => {
    if (showEmoji) {
      setShowEmoji(false);
    }
  };

  const handleSendVoiceNote = async (uri: string, _durationSec?: number) => {
    setIsSending(true);
    // Unique ID for voice note
    const tempId = `temp-voice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const sentAt = new Date().toISOString();
    
    // Optimistic voice note message
    const optimisticMsg: Message = {
      id: tempId,
      content: _durationSec ? _durationSec.toString() : '',
      mediaKeys: [`local-voice-${uri}`], // recognized locally by Bubble layout
      senderId: currentUserId || '',
      sentAt,
      readAt: null,
      matchId,
    };
    
    dispatch(addMessage(optimisticMsg));
    optimisticIdsRef.current.set(tempId, { 
      tempId, 
      sentAt: Date.now(),
      sequenceNum: ++messageSequenceRef.current,
      content: optimisticMsg.content // Store content for accurate matching
    });

    let sent = false;
    let attempts = 0;
    const maxAttempts = 3;
    
    try {
      const sourceExt = uri.split('?')[0].split('.').pop()?.toLowerCase();
      const ext = sourceExt === 'm4a' ? 'm4a' : 'wav';
      const urlResponse = await api.get(`/chat/${matchId}/media/upload-url?ext=${ext}`);
      if (!urlResponse.data?.success) {
        throw new Error('Failed to get upload URL');
      }
      
      const { uploadUrl, mediaKey, assetId, contentType } = urlResponse.data.data;
      const fileResponse = await fetch(uri);
      const blob = await fileResponse.blob();
      
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': contentType },
      });
      if (!uploadResponse.ok) throw new Error('Voice upload failed');
      const completed = await api.post(`/chat/${matchId}/media/${assetId}/complete`, undefined, { timeout: 120000 });
      const approvedMediaKey = completed.data.data.mediaKey;
      const waveform = completed.data.data.waveform;

      // Send with retry logic
      while (!sent && attempts < maxAttempts) {
        try {
          await new Promise<void>((resolve, reject) => {
            addToOfflineQueue({
              tempId,
              matchId,
              content: _durationSec ? _durationSec.toString() : '',
              mediaKeys: [approvedMediaKey],
              queuedAt: Date.now(),
              status: 'pending',
              type: 'voice',
              metadata: { durationSeconds: _durationSec ?? 0, ...(Array.isArray(waveform) ? { waveform } : {}) },
            });

            const socketTimeout = setTimeout(() => {
              reject(new Error('Socket timeout'));
            }, 10000);

            const socket = getSocket();
            if (socket?.connected) {
              socket.emit('send_message', { 
                matchId, 
                content: _durationSec ? _durationSec.toString() : '', 
                mediaKeys: [approvedMediaKey],
                clientMessageId: tempId,
                type: 'voice',
                metadata: { durationSeconds: _durationSec ?? 0 },
              }, (response: any) => {
                clearTimeout(socketTimeout);
                if (response?.success && response.message) {
                  if (optimisticIdsRef.current.has(tempId)) {
                    optimisticIdsRef.current.delete(tempId);
                    processedServerIdsRef.current.add(response.message.id);
                    dispatch(replaceOptimisticMessage({ tempId, realMessage: response.message }));
                    removeFromQueue(tempId);
                    // The staged recording is uploaded and delivered; reclaim it.
                    void discardDraftMedia(uri);
                  }
                  sent = true;
                }
                resolve();
              });
            } else {
              clearTimeout(socketTimeout);
              reject(new Error('Socket not connected'));
            }
          });
        } catch (err) {
          attempts++;
          if (attempts >= maxAttempts) {
            console.error('[VoiceNote] All send attempts failed:', err);
            // Message stays in queue
          } else if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
          }
        }
      }
    } catch (err) {
      console.error('[VoiceNote] Error sending voice note:', err);
      // Keep in queue for retry
    } finally {
      setIsSending(false);
    }
  };

  // Handle Image Selection
  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets.length > 0) {
        const mediaItems = result.assets.map(asset => ({
          originalUri: asset.uri,
          currentUri: asset.uri,
        }));
        setSelectedImages(prev => [...prev, ...mediaItems]);
        setIsWorkspaceOpen(true);
      }
    } catch (error) {
      console.error('Error picking image:', error);
    }
  };

  const handleCropPress = (uri: string, index: number) => {
    setPhotoToCrop(uri);
    setCropIndex(index);
    setCropModalVisible(true);
  };

  const handleCropSave = (croppedUri: string) => {
    setSelectedImages(prev => {
      const newImages = [...prev];
      newImages[cropIndex] = {
        ...newImages[cropIndex],
        currentUri: croppedUri,
      };
      return newImages;
    });
    setCropModalVisible(false);
    setPhotoToCrop(null);
  };

  // Handle typing indicator
  const handleTextChange = useCallback((value: string) => {
    setText(value);
    const socket = getSocket();
    if (!socket) return;

    if (!isTypingRef.current && value.length > 0) {
      socket.emit('typing_start', { matchId });
      isTypingRef.current = true;
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        socket.emit('typing_stop', { matchId });
        isTypingRef.current = false;
      }
    }, 2000);
  }, [matchId]);

  // Load older messages
  const handleLoadMore = useCallback(() => {
    if (hasMore && nextCursor && !isLoading) {
      fetchMessages(nextCursor);
    }
  }, [hasMore, nextCursor, isLoading, fetchMessages]);

  // Build flat list data with date separators
  const renderData = React.useMemo(() => {
    const items: (Message | { type: 'date'; date: string })[] = [];
    let lastDateKey = '';
    for (const msg of messages) {
      const dateKey = msg.sentAt ? new Date(msg.sentAt).toDateString() : '';
      if (dateKey !== lastDateKey) {
        items.push({ type: 'date', date: msg.sentAt });
        lastDateKey = dateKey;
      }
      items.push(msg);
    }
    return items;
  }, [messages]);

  const animatedSubContentStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: -emojiHeight.value }],
    };
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={colors.text.primary} />
        </TouchableOpacity>
        <Image source={{ uri: userAvatar || DEFAULT_AVATAR }} style={styles.headerAvatar} />
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{userName}</Text>
          {typingSenderId ? (
            <Text style={styles.headerStatus}>typing...</Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
              <View style={[
                styles.connectionDot,
                connectionStatus === 'connected' ? styles.connected :
                connectionStatus === 'reconnecting' ? styles.reconnecting : styles.disconnected
              ]} />
              <Text style={styles.headerStatusOffline}>
                {connectionStatus === 'connected' ? 'connected' :
                 connectionStatus === 'reconnecting' ? 'connecting…' : 'offline'}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Search this chat" onPress={() => navigation.navigate('MessageSearch', { matchId })}>
          <Ionicons name="search-outline" size={23} color={colors.text.primary} />
        </TouchableOpacity>
      </View>

      {/* Clipper Frame Acceleration */}
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <AnimatedReanimated.View style={[{ flex: 1 }, animatedSubContentStyle]}>
          {/* Messages */}
          <MessageList
            ref={flatListRef}
            messages={messages}
            currentUserId={currentUserId}
            onLoadMore={handleLoadMore}
            isLoading={isLoading}
            hasMore={hasMore}
            typingSenderId={typingSenderId}
            onScroll={handleScroll}
            onVisibleMessages={acknowledgeVisible}
            onReply={setReplyingTo}
          />

          <AnimatedReanimated.View 
            style={[styles.scrollDownButtonWrapper, animatedScrollBtnStyle]}
            pointerEvents={showScrollDown ? 'auto' : 'none'}
          >
            <TouchableOpacity 
              style={styles.scrollDownButtonInner} 
              onPress={() => {
                isScrollingDownRef.current = true;
                flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
                setUnreadCount(0);
                setShowScrollDown(false);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="chevron-down" size={24} color="#fff" />
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </AnimatedReanimated.View>

          {/* Input Bar */}
          {replyingTo && <View style={styles.replyPreview}><View style={{ flex: 1 }}><Text style={styles.replyLabel}>Replying to a message</Text><Text style={styles.replyText} numberOfLines={1}>{replyingTo.content || 'Attachment'}</Text></View><TouchableOpacity onPress={() => setReplyingTo(null)}><Ionicons name="close" size={22} color={colors.text.secondary} /></TouchableOpacity></View>}
          <VoiceRecordBar
            ref={inputRef}
            text={text}
            setText={setText}
            onSend={handleSend}
            onPickImage={handlePickImage}
            onToggleEmoji={handleToggleEmoji}
            showEmoji={showEmoji}
            isSending={isSending}
            onSendVoiceNote={handleSendVoiceNote}
            onFocus={handleInputFocus}
          />
        </AnimatedReanimated.View>

        {/* Absolute Sibling for Touch & Fill Bounds (Android Fix) */}
        <AnimatedReanimated.View style={[{
          position: 'absolute',
          bottom: -350, // Expanded extends below glass edge 
          left: 0, right: 0,
          height: 350,
          backgroundColor: colors.surface
        }, animatedSubContentStyle]}>
          <EmojiKeyboard
            onEmojiSelected={(emoji: any) => {
              setText((prev: string) => prev + emoji.emoji);
            }}
            theme={{
              backdrop: 'transparent',
              knob: colors.text.tertiary,
              container: colors.surface,
              header: colors.text.primary,
              skinTonesContainer: colors.background,
              category: {
                icon: colors.text.tertiary,
                iconActive: colors.primary,
                container: colors.surface,
                containerActive: colors.background,
              },
              search: {
                text: colors.text.primary,
                placeholder: colors.text.tertiary,
                icon: colors.text.tertiary,
                background: colors.background,
              },
              emoji: {
                selected: colors.background,
              },
            }}
            styles={{
              category: {
                icon: { fontSize: 22 },
                container: { paddingVertical: 8 },
              },
            }}
            enableRecentlyUsed
            categoryPosition="top"
          />
        </AnimatedReanimated.View>
      </View>
      <MediaWorkspace
        visible={isWorkspaceOpen}
        images={selectedImages}
        setImages={setSelectedImages}
        onAddMore={handlePickImage}
        onClose={() => {
          setIsWorkspaceOpen(false);
          setSelectedImages([]);
        }}
        onSend={() => {
          setIsWorkspaceOpen(false);
          handleSend();
        }}
        onCropPress={(uri, index) => {
          setPhotoToCrop(uri);
          setCropIndex(index);
          setCropModalVisible(true);
        }}
      />

      {photoToCrop && (
        <CropModal
          visible={cropModalVisible}
          imageUri={photoToCrop}
          onCancel={() => {
            setCropModalVisible(false);
            setPhotoToCrop(null);
          }}
          onCropSave={handleCropSave}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  replyPreview: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 10 },
  replyLabel: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  replyText: { color: colors.text.secondary, fontSize: 13, marginTop: 2 },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    padding: 4,
    marginRight: 8,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text.primary,
  },
  headerStatus: {
    fontSize: 12,
    color: colors.success,
    fontWeight: '500',
    marginTop: 1,
  },
  headerStatusOffline: {
    fontSize: 12,
    color: colors.text.tertiary,
    marginTop: 1,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  connected: {
    backgroundColor: colors.success,
  },
  reconnecting: {
    backgroundColor: colors.accent,
  },
  disconnected: {
    backgroundColor: colors.error,
  },
  // Messages
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 8,
  },
  loadingMore: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  // Date Separator
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    paddingHorizontal: 4,
  },
  dateLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dateText: {
    fontSize: 12,
    color: colors.text.tertiary,
    marginHorizontal: 12,
    fontWeight: '600',
  },
  // Message Bubble
  messageRow: {
    marginBottom: 4,
  },
  messageRowRight: {
    alignItems: 'flex-end',
  },
  messageRowLeft: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: width * 0.75,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  bubbleSent: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleReceived: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTextSent: {
    color: '#fff',
  },
  bubbleTextReceived: {
    color: colors.text.primary,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  bubbleTime: {
    fontSize: 11,
  },
  bubbleTimeSent: {
    color: 'rgba(255,255,255,0.6)',
  },
  bubbleTimeReceived: {
    color: colors.text.tertiary,
  },
  // Typing Indicator
  typingContainer: {
    paddingVertical: 8,
    paddingLeft: 4,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignSelf: 'flex-start',
    gap: 4,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.text.tertiary,
  },
  // Input Bar
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingBottom: 10,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  imagePreviewScroll: {
    maxHeight: 100,
    marginBottom: 10,
  },
  imagePreviewContent: {
    gap: 16,
    paddingHorizontal: 12,
    paddingTop: 8, // Space for the remove button
  },
  imagePreviewContainer: {
    position: 'relative',
    width: 80,
    height: 80,
  },
  imagePreview: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  removeImageBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#fff',
    borderRadius: 12,
    zIndex: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  attachBtn: {
    padding: 4,
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 10,
    maxHeight: 120,
    justifyContent: 'center',
  },
  input: {
    fontSize: 15,
    color: colors.text.primary,
    maxHeight: 100,
  },
  sendButtonContainer: {
    alignSelf: 'center',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Emoji
  emojiToggle: {
    alignSelf: 'center',
    padding: 4,
  },
  scrollDownButtonWrapper: {
    position: 'absolute',
    bottom: 75,
    right: 16,
    zIndex: 10,
  },
  scrollDownButtonInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 2,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  unreadBadge: {
    position: 'absolute',
    top: -6,
    right: -4,
    backgroundColor: colors.primary,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});

interface MessageListProps {
  messages: any[];
  currentUserId: string | null;
  onLoadMore: () => void;
  isLoading: boolean;
  hasMore: boolean;
  typingSenderId: string | null;
  onScroll?: (event: any) => void;
  onVisibleMessages?: (ids: string[]) => void;
  onReply: (message: Message) => void;
}

const MessageList = React.memo(
  React.forwardRef<any, MessageListProps>(
    ({ messages, currentUserId, onLoadMore, isLoading, hasMore, typingSenderId, onScroll, onVisibleMessages, onReply }, ref) => {
      const visibleCallback = React.useRef(onVisibleMessages);
      visibleCallback.current = onVisibleMessages;
      const handleViewableItemsChanged = React.useRef(({ viewableItems }: any) => {
        visibleCallback.current?.(viewableItems.filter((item: any) => !('type' in item.item)).map((item: any) => item.item.id));
      }).current;
      // Build flat list data with date separators for inverted list (newest first)
      const renderData = React.useMemo(() => {
        const items: (any | { type: 'date'; date: string })[] = [];
        if (messages.length === 0) return items;

        // Messages are sorted DESC (newest first) for inverted list
        let currentDateKey = messages[0].sentAt ? new Date(messages[0].sentAt).toDateString() : '';
        let tempGroup: any[] = [];

        for (const msg of messages) {
          const msgDateKey = msg.sentAt ? new Date(msg.sentAt).toDateString() : '';
          if (msgDateKey !== currentDateKey) {
            // Flush current group (newer messages) then add date separator
            items.push(...tempGroup);
            // Date separator goes AFTER the newer group (appears BELOW in inverted list)
            if (tempGroup.length > 0) {
              // Use the FIRST message's date (oldest in this group)
              items.push({ type: 'date', date: tempGroup[tempGroup.length - 1].sentAt });
            }
            tempGroup = [];
            currentDateKey = msgDateKey;
          }
          tempGroup.push(msg);
        }
        // Flush final group
        if (tempGroup.length > 0) {
          items.push(...tempGroup);
          // Add date separator for oldest group
          items.push({ type: 'date', date: tempGroup[tempGroup.length - 1].sentAt });
        }
        return items;
      }, [messages]);

      const formatDateSeparator = (dateStr: string) => {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      };

      return (
        <FlatList
          ref={ref}
          data={renderData}
          keyExtractor={(item, index) => ('type' in item ? `date-${index}` : item.id)}
          inverted={true}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 70, minimumViewTime: 500 }}
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
            autoscrollToTopThreshold: 10,
          }}
          windowSize={15}
          maxToRenderPerBatch={10}
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={20}
          renderItem={({ item }) => {
            if ('type' in item && item.type === 'date') {
              return (
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginVertical: 12,
                  paddingHorizontal: 16,
                }}>
                  <View style={{ flex: 1, height: 0.5, backgroundColor: 'rgba(255,255,255,0.1)' }} />
                  <Text style={{
                    color: '#8E8E93',
                    fontSize: 12,
                    marginHorizontal: 12,
                    fontWeight: '500',
                  }}>{formatDateSeparator(item.date)}</Text>
                  <View style={{ flex: 1, height: 0.5, backgroundColor: 'rgba(255,255,255,0.1)' }} />
                </View>
              );
            }
            const msg = item;
            const isMe = msg.senderId === currentUserId;
            return <MessageBubble key={msg.id} message={msg} isMe={isMe} showTime={true} onReply={onReply} replyPreview={messages.find((item) => item.id === msg.replyToId)?.content} />;
          }}
          contentContainerStyle={{ paddingHorizontal: 12 }}
          showsVerticalScrollIndicator={false}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={typingSenderId ? <TypingIndicator /> : null}
          ListFooterComponent={
            isLoading && hasMore ? (
              <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                <ActivityIndicator color="#007AFF" size="small" />
              </View>
            ) : null
          }
        />
      );
    }
  )
);
