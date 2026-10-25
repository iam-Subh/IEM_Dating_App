import { ChatVerificationReminder, ChatVerificationWaiting } from '../../verification/ChatVerificationReminder';
import { looksHurtful } from '../../safety/hurtfulLanguage';
import { ChatSafetyNotice } from '../../safety/ChatSafetyNotice';
import { reportChatShortcut } from '../../../../modules/chat-notify';
import { clearChatNotification } from '../../../../modules/chat-notify';
import { askAtMoment } from '../../notifications/push/permission';
import { dismissChatNotifications } from '../../notifications/push/actions';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createHistoryPrefetch } from '../historyPrefetch';
import { buildChatRows, chatScrollDistances, unreadThroughSeen, visibleMessageIds, type ChatRow } from '../messageListModel';
import {
  Alert,
  AppState,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  Image,
  Platform,
  ActivityIndicator,
  Animated,
  Dimensions,
  Keyboard,
  ScrollView,
  BackHandler,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { File as FileSystemFile, UploadType as FileSystemUploadType } from 'expo-file-system';
import { EmojiKeyboard } from 'rn-emoji-keyboard';
import { useSelector, useDispatch, useStore } from 'react-redux';
import { VoiceRecordBar } from '../components/VoiceRecordBar';
import { useChatAllowance } from '../useChatAllowance';
import { openVerifyRules } from '../../verification/verifyGate';
import AnimatedReanimated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, runOnUI, withSpring, Easing, useFrameCallback } from 'react-native-reanimated';
import { useKeyboardHandler, KeyboardController, AndroidSoftInputModes } from 'react-native-keyboard-controller';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootState, store } from '../../../store';
import { api } from '../../../services/api';
import { MatchIntroCard, PhotoChoiceSheet, useMatchIntro } from '../components/MatchIntro';
import { PersonAvatar } from '../../search/PersonAvatar';
import { getDeviceId } from '../../../services/deviceIdentity';
import { getSocket, initSocket } from '../../../services/socket';
import { addToOfflineQueue, getOfflineQueue, removeFromQueue, retryQueuedMessage, triggerQueueRetry, updateQueuedMessage } from '../../../services/offlineQueue';
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
  markMessagesDeliveredByPeer,
  markVoicePlayed,
  updateLocalMessageStatus,
  updateLocalMediaUpload,
  Message,
} from '../../../store/chatSlice';
import { colors } from '../../../core/theme/colors';
import { createComposerDraft } from '../composerDraft';
import { useComposerDraftText } from '../useComposerDraftText';
import { createChatAutoScroll } from '../chatAutoScroll';
import { createChatSendMotion, TELEGRAM_SEND_MS, type ChatSendMotion, type Rise } from '../chatSendMotion';
import { OutgoingMessageTransition, RisingRow } from '../components/OutgoingMessageTransition';
import { mediaRetryIndexes, mediaTicketsExpired } from '../messageSendState';
import { CHAT_HEADER_HEIGHT, MESSAGE_LIST_PADDING_H, matchIntroViewportInsets } from '../chatLayout';
import { useFocusEffect, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { PinnedMessageBar } from '../components/PinnedMessageBar';
import { useChatMarks } from '../useChatMarks';
import { chatMarksKey, visibleMarkedMessages, type MarkKind } from '../messageMarks';
import { ChatHeaderMenu } from '../components/ChatHeaderMenu';
import { MuteSheet } from '../components/MuteSheet';
import { AutoDeleteSheet } from '../components/AutoDeleteSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ServiceMessage } from '../components/ServiceMessage';
import { getActiveChat, setActiveChat } from '../activeChat';
import { apiErrorMessage, conversationApi, describeTtlNotice, formatDuration, isMuted } from '../conversationControls';
import { clearMessagesThrough, expireMessages, mergeMessages, patchConversation, removeConversation, setEventCursor } from '../../../store/chatSlice';
import { isNewerMessage } from '../messageOrdering';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MarkedMessagesMenu } from '../components/MarkedMessagesMenu';


const { width, height: screenHeight } = Dimensions.get('window');

function getRequestErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'The upload failed.';
  const candidate = error as {
    message?: string;
    response?: { data?: { message?: string; error?: string | { message?: string } } };
  };
  const apiError = candidate.response?.data?.error;
  if (typeof apiError === 'string') return apiError;
  return apiError?.message ?? candidate.response?.data?.message ?? candidate.message ?? 'The upload failed.';
}

type UploadStage = 'uploading' | 'processing';

type MediaUploadJob = {
  items: SelectedChatMedia[];
  mediaKeys: Array<string | null>;
  content: string;
  replyToId?: string;
  messageType?: 'media' | 'document' | 'voice';
  messageMetadata?: Record<string, unknown>;
  sending: boolean;
  queuedAt: number;
  resumable?: Array<ResumableUploadRef | null>;
};

type UploadOptions = {
  /** Cover frame, in milliseconds of the uploaded file. */
  coverTimeMs?: number;
  resumable?: ResumableUploadRef | null;
  onResumable?: (ref: ResumableUploadRef | null) => void;
};

/** Video lengths for the bubble's duration badge, as sent. */
function mediaInfoFor(items: SelectedChatMedia[]) {
  if (!items.some((item) => item.kind === 'video')) return undefined;
  return {
    mediaInfo: items.map((item) => {
      if (item.kind !== 'video') return null;
      const full = item.durationMs ?? 0;
      const trimmed = item.edit ? Math.min(item.edit.endMs || full, full || item.edit.endMs) - item.edit.startMs : full;
      return { durationMs: Math.max(0, Math.round(trimmed)) };
    }),
  };
}

async function uploadChatAttachment(
  matchId: string,
  item: SelectedChatMedia,
  onProgress?: (progress: number, stage: UploadStage) => void,
  signal?: AbortSignal,
  options: UploadOptions = {},
): Promise<{ mediaKey: string; waveform?: number[] }> {
  const uploadUri = item.currentUri;
  let extension: 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'heic' | 'heif' | 'mp4'
    | 'm4a' | 'wav' | 'pdf' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx' | 'txt' | 'csv' | 'zip' | 'rar' | '7z';

  try {
    if (item.kind === 'voice') {
      extension = item.currentUri.split('?')[0].toLowerCase().endsWith('.m4a') ? 'm4a' : 'wav';
    } else if (item.kind === 'video') {
      // Keep the selected MP4 bytes unchanged. The server validates the bytes.
      extension = 'mp4';
    } else if (item.kind === 'file') {
      const detected = await detectChatAttachmentFormatFromUri(uploadUri, item.fileName, item.mimeType);
      if (!detected) throw new Error('The document format is not supported.');
      extension = detected;
    } else {
      const detected = await detectChatImageFormatFromUri(uploadUri);
      if (!detected) throw new Error('The image format is not supported.');
      extension = detected;
    }
  } catch (error) {
    throw new Error(`Could not prepare ${item.kind}: ${getRequestErrorMessage(error)}`);
  }

  // Android recorders can return `file:/data/...` instead of the canonical
  // `file:///data/...` URI. Do not prefix that value as a plain path because
  // it becomes `file://file:/data/...` and the native uploader cannot find it.
  const nativeUri = uploadUri.startsWith('file:/') && !uploadUri.startsWith('file://')
    ? `file://${uploadUri.slice('file:'.length)}`
    : uploadUri.startsWith('file://') || uploadUri.startsWith('content://')
      ? uploadUri
      : `file://${uploadUri}`;

  let size = item.size ?? 0;
  if (Platform.OS !== 'web' && !size) {
    try { size = new FileSystemFile(nativeUri).size ?? 0; } catch { size = 0; }
  }

  // Held in an object because the callbacks below replace it.
  const session: { ref: ResumableUploadRef | null } = { ref: options.resumable ?? null };
  let assetId: string;

  if (Platform.OS === 'android' && size > 0 && shouldUploadResumably(size, options.resumable)) {
    onProgress?.(0, 'uploading');
    try {
      assetId = await sendResumably({
        matchId,
        extension,
        uri: nativeUri,
        size,
        title: item.kind === 'video' ? 'Sending video' : item.kind === 'file' ? `Sending ${item.fileName ?? 'file'}` : 'Sending photo',
        existing: options.resumable,
        onSession: (ref) => {
          session.ref = ref;
          options.onResumable?.(ref);
        },
        onProgress: (percent) => onProgress?.(percent, 'uploading'),
        signal,
      });
    } catch (error) {
      if (signal?.aborted && session.ref) {
        await discardResumable(matchId, session.ref);
        options.onResumable?.(null);
      } else if (error instanceof ResumableUploadLostError) {
        options.onResumable?.(null);
      }
      throw error;
    }
  } else {
    const urlResponse = await api.get(`/chat/${matchId}/media/upload-url?ext=${extension}`);
    if (!urlResponse.data?.success) throw new Error('The server did not create an upload ticket.');

    const ticket = urlResponse.data.data as { uploadUrl: string; assetId: string; contentType: string };
    const { uploadUrl, contentType } = ticket;
    assetId = ticket.assetId;
    onProgress?.(0, 'uploading');

    if (Platform.OS === 'web') {
      const mediaResponse = await fetch(uploadUri);
      if (!mediaResponse.ok) throw new Error(`Could not read the selected ${item.kind}.`);
      const raw = await mediaResponse.blob();
      const body = raw.type === contentType ? raw : new Blob([raw], { type: contentType });
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': contentType },
      });
      if (!uploadResponse.ok) throw new Error(`The ${item.kind} upload failed (${uploadResponse.status}).`);
      onProgress?.(100, 'uploading');
    } else {
      const uploadResult = await new FileSystemFile(nativeUri).createUploadTask(uploadUrl, {
        httpMethod: 'PUT',
        uploadType: FileSystemUploadType.BINARY_CONTENT,
        mimeType: contentType,
        headers: { 'Content-Type': contentType },
        signal,
        onProgress: ({ bytesSent, totalBytes }) => {
          if (totalBytes > 0) {
            onProgress?.(Math.min(100, Math.round(bytesSent * 100 / totalBytes)), 'uploading');
          }
        },
      }).uploadAsync();
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`The ${item.kind} upload failed (${uploadResult.status}).`);
      }
    }
  }

  onProgress?.(100, 'processing');
  let completed;
  try {
    completed = await api.post(
      `/chat/${matchId}/media/${assetId}/complete`,
      options.coverTimeMs != null ? { coverTimeMs: options.coverTimeMs } : undefined,
      { timeout: 120000 },
    );
  } catch (error) {
    // The stored parts are unusable (expired, or never all sent), so the next
    // retry must start a new upload rather than resume this one.
    if (session.ref && /incomplete|expired|unavailable/i.test(getRequestErrorMessage(error))) {
      await discardResumable(matchId, session.ref);
      options.onResumable?.(null);
    }
    throw error;
  }
  if (!completed.data?.success || !completed.data?.data?.mediaKey) {
    throw new Error('The server did not complete the upload.');
  }
  if (session.ref) {
    forgetResumable(session.ref);
    options.onResumable?.(null);
  }
  return {
    mediaKey: completed.data.data.mediaKey,
    ...(Array.isArray(completed.data.data.waveform) ? { waveform: completed.data.data.waveform } : {}),
  };
}
/**
 * Height to open the emoji panel at before the real keyboard has ever been
 * measured. A flat 300 was short on taller phones, so the panel opened stunted
 * and only corrected itself once the keyboard had been shown once.
 *
 * Android keyboards land around 36% of the window height, which is far closer
 * than a fixed number across screen sizes. The measured height replaces this as
 * soon as one is available, and is remembered for next time.
 */
/**
 * Roughly how long the message context menu takes to fade out and give up
 * window focus. Focusing the composer before that is silently dropped, so the
 * first attempt is timed to land just after it.
 */
const CONTEXT_MENU_DISMISS_MS = 260;

/**
 * Android grants focus to the input but refuses to raise the keyboard while
 * another window still holds focus, and says nothing when it declines. The only
 * way to know it worked is to check afterwards, so the focus is retried until
 * the keyboard is actually up or the window closes.
 */
const FOCUS_RETRY_INTERVAL_MS = 90;
const FOCUS_RETRY_WINDOW_MS = 800;

/**
 * The keyboard's own motion curve on Android 11+ (`PathInterpolator(0.2, 0, 0, 1)`).
 * Matching it is what makes the content look attached to the keyboard rather
 * than merely arriving at the same time.
 */
const KEYBOARD_EASING = Easing.bezier(0.2, 0, 0, 1);
/** Used only if the system reports no duration for the transition. */
const KEYBOARD_FALLBACK_DURATION_MS = 250;

/**
 * How far the animated offset may drift from the keyboard before the keyboard
 * wins.
 *
 * onStart animates to the target on the same curve and duration the system
 * uses, so in a healthy frame budget the two agree to within a pixel or two and
 * this never fires. It exists for the transition that does not get its frames -
 * measured at 0.13 of 328 by the time the keyboard had fully opened - where the
 * composer sat still while the keyboard slid past it and then snapped up once
 * the animation finally ran. Where the keyboard actually is beats where the
 * clock says it should be.
 */
const KEYBOARD_DRIFT_TOLERANCE = 24;

/** Resting offset of the scroll-to-bottom button; the animation offsets from here. */
const SCROLL_BTN_BOTTOM = 100;

const KEYBOARD_HEIGHT_KEY = 'chat:lastKeyboardHeight';
const DEFAULT_KEYBOARD_HEIGHT = Math.round(Dimensions.get('window').height * 0.36);
const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop';

type ChatLinkPreview = {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
};

function firstHttpUrl(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s<>{}\[\]]+/i);
  return match?.[0]?.replace(/[),.!?]+$/, '') ?? null;
}

function formatLastSeen(value: string | null): string {
  if (!value) return 'matched';
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return 'last seen just now';
  if (elapsed < 60 * 60_000) return `last seen ${Math.floor(elapsed / 60_000)} min ago`;
  if (date.toDateString() === new Date().toDateString()) return `last seen at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return `last seen ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function isReplyDocument(message: Message): boolean {
  const keys = message.mediaKeys?.length ? message.mediaKeys : message.mediaKey ? [message.mediaKey] : [];
  return message.type === 'document'
    || Boolean(message.metadata?.document)
    || keys.some(key => /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar|7z)(?:$|\?)/i.test(key));
}

type ReplyDocumentIcon = 'document-text' | 'document' | 'grid' | 'easel' | 'archive';

function getReplyDocumentIcon(message: Message): ReplyDocumentIcon {
  const document = message.metadata?.document as { fileName?: string; mimeType?: string } | undefined;
  const value = `${document?.fileName ?? ''} ${document?.mimeType ?? ''}`.toLowerCase();
  if (/\.(xls|xlsx)\b|spreadsheet|excel|text\/csv/.test(value)) return 'grid';
  if (/\.(ppt|pptx)\b|presentation|powerpoint/.test(value)) return 'easel';
  if (/\.(zip|rar|7z)\b|zip|compressed|archive/.test(value)) return 'archive';
  if (/\.(doc|docx)\b|wordprocessing|msword/.test(value)) return 'document';
  return 'document-text';
}

function getReplyPreview(message: Message): string {
  if (isReplyDocument(message)) {
    const document = message.metadata?.document as { fileName?: string } | undefined;
    return document?.fileName ?? 'Document';
  }

  if (isReplyVoice(message)) return 'Voice message';

  const mediaKeys = message.mediaKeys?.length ? message.mediaKeys : message.mediaKey ? [message.mediaKey] : [];
  const content = message.content?.replace(/\s+/g, ' ').trim();
  if (content) return content;
  if (mediaKeys.length > 1) return `${mediaKeys.length} photos`;
  if (mediaKeys.length === 1) return 'Photo';
  return 'Message';
}

function isReplyVoice(message: Message): boolean {
  const mediaKeys = message.mediaKeys?.length ? message.mediaKeys : message.mediaKey ? [message.mediaKey] : [];
  return message.type === 'voice' || mediaKeys.some((key) => {
    const value = key.toLowerCase();
    return value.includes('voice') || value.includes('audio') || /\.(m4a|mp3|wav|pcm)$/.test(value);
  });
}

interface RouteParams {
  matchId: string;
  userName?: string;
  userAvatar?: string | null;
  userId?: string;
  focusMessageId?: string;
  /** Changes on every jump, so jumping to the same message twice still scrolls. */
  focusNonce?: number;
  /** Shared from another app (MESSAGE_NOTIFICATIONS_PLAN.md 12): put in the composer, not sent. */
  sharedText?: string | null;
  sharedFile?: string | null;
  sharedMimeType?: string | null;
}

const TypingIndicator = ({ recording = false }: { recording?: boolean }) => {
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
      <View style={styles.typingBubble} accessible accessibilityLabel={recording ? 'Recording a voice message' : 'Typing'}>
        {recording ? <Ionicons name="mic" size={14} color={colors.primary} style={styles.typingMic} /> : null}
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
import { EditMessagePreview } from '../components/EditMessagePreview';
import { canEditMessage, canSaveMessageEdit } from '../messageEditing';
import { CropModal } from '../components/CropModal';
import { MediaWorkspace } from '../components/MediaWorkspace';
import { createAttachmentPickerRequest, cancelAttachmentPickerRequest } from '../attachmentPickerRequests';
import { MAX_CHAT_ALBUM_ITEMS, SelectedChatMedia } from '../components/attachmentTypes';
import { detectChatAttachmentFormatFromUri, detectChatImageFormatFromUri } from '../attachmentFormat';
import { createTypingPresence, shouldSendTyping, TYPING_IDLE_MS } from '../typingPresence';
import { createMediaSendNotice } from '../mediaSendNotice';
import { discardDraftMedia } from '../draftMedia';
import { adoptSentMedia } from '../sentMediaCache';
import { ChatMedia } from '../../../../modules/chat-media';
import {
  clearNativeChatMatch, deleteNativeChatMessages, readNativeChatMessages, saveNativeChatMessages,
} from '../../../../modules/chat-timeline';
import { createMessageWindow } from '../messageWindow';
import { uploadedCoverMs, videoEditNeedsExport } from '../components/attachmentTypes';
import { preparePhoto } from '../exportPhoto';
import {
  discardResumable, forgetResumable, ResumableUploadLostError, ResumableUploadRef, sendResumably, shouldUploadResumably,
} from '../resumableUpload';
import { videoPosterKey } from '../videoPosters';
import { clearChatDraft, loadChatDraft, saveChatDraft } from '../chatDrafts';
import { useOnceVisible } from '../useOnceVisible';
import {
  getPersistentMediaJobs,
  removePersistentMediaJob,
  savePersistentMediaJob,
} from '../persistentMediaQueue';

export const ChatScreen = () => {
  const isFocused = useIsFocused();
  const marksQueryClient = useQueryClient();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  // Composer height lives in a shared value, not React state. The composer
  // resizes itself natively as the text wraps; routing that height back through
  // setState re-rendered this whole screen (the message list included) before the
  // chevron could move, so the button visibly trailed the input. A shared value
  // updates the dependent styles on the UI thread with no render at all.
  const composerH = useSharedValue(80);
  const route = useRoute();
  const params = route.params as RouteParams;
  const matchId = params.matchId;
  const sendMotion = useMemo(() => createChatSendMotion(), [matchId]);
  const dispatch = useDispatch();
  // Read synchronously after a dispatch, where the rendered `messages` is stale.
  const store = useStore<RootState>();

  const currentUserId = useSelector((state: RootState) => state.auth.user?.id);
  const conversation = useSelector((state: RootState) => state.chat.conversations.find((item) => item.matchId === matchId));
  const userName = params.userName ?? conversation?.user.name ?? 'Chat';
  // Before verifying: 30 messages, no photos or videos; and the other side's
  // quiet "waiting to verify" line (GOOGLE_SIGNUP_PLAN.md 2.3).
  const { allowance, noteSent } = useChatAllowance(matchId);
  const userAvatar = params.userAvatar ?? conversation?.user.avatar ?? null;
  const userId = params.userId ?? conversation?.user.id ?? '';
  const myAvatar = useSelector((state: RootState) => state.auth.user?.avatar ?? state.auth.user?.avatarUrl ?? state.auth.user?.photos?.[0]?.photoUrl ?? null);
  // What the header menu reflects. Seeded from the list row so it is right on the
  // first frame, then confirmed from the server.
  const [mutedUntil, setMutedUntil] = useState<string | null>(conversation?.mutedUntil ?? null);
  const [ttlSeconds, setTtlSeconds] = useState<number | null>(conversation?.messageTtlSeconds ?? null);
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);
  const [autoDeleteOpen, setAutoDeleteOpen] = useState(false);
  const [markedOpen, setMarkedOpen] = useState(false);
  const [markedKind, setMarkedKind] = useState<MarkKind>('pin');
  const [pendingConfirm, setPendingConfirm] = useState<'clear' | 'delete' | null>(null);
  const messages = useSelector(
    (state: RootState) => state.chat.activeMessages[matchId] ?? [],
    (a, b) => {
      if (a.length !== b.length) return false;
      // Immer preserves object references for messages that did not change.
      // Compare the references so receipts, edits, and reactions can update.
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }
  );
  const isLoading = useSelector((state: RootState) => state.chat.isLoadingMessages);
  const typingSenderId = useSelector((state: RootState) => state.chat.typingUsers[matchId] ?? null);
  // What they are doing: typing, or recording a voice message.
  const [peerActivity, setPeerActivity] = useState<'typing' | 'recording'>('typing');
  useEffect(() => {
    if (!currentUserId || store.getState().chat.activeMessages[matchId]?.length) return;
    let active = true;
    void readNativeChatMessages(currentUserId, matchId).then((cached) => {
      if (active && cached.length && !store.getState().chat.activeMessages[matchId]?.length) {
        dispatch(setMessages({ matchId, messages: cached }));
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [currentUserId, dispatch, matchId, store]);
  useEffect(() => {
    if (!currentUserId || !messages.length) return;
    const timer = setTimeout(() => {
      void saveNativeChatMessages(currentUserId, matchId, messages).catch((error) => {
        if (__DEV__) console.warn('[Chat] Native message cache write failed:', error);
      });
    }, 160);
    return () => clearTimeout(timer);
  }, [currentUserId, matchId, messages]);

  const composerDraft = useMemo(() => createComposerDraft(), [matchId]);
  const text = useComposerDraftText(composerDraft);
  const setText = composerDraft.set;
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  // Keep the unsent draft separate from the message being edited.
  const [editTarget, setEditTarget] = useState<Message | null>(null);
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const editRequest = useRef(false);
  const editGeneration = useRef(0);
  const voiceComposerBusy = useRef(false);
  const onVoiceBusyChange = useCallback((busy: boolean) => { voiceComposerBusy.current = busy; }, []);
  useEffect(() => {
    setEditTarget(null); setEditText(''); setEditError(null); setSavingEdit(false); editRequest.current = false;
    return () => { editGeneration.current += 1; };
  }, [matchId]);
  const [composerLinkPreview, setComposerLinkPreview] = useState<ChatLinkPreview | null>(null);
  const [dismissedLinkUrl, setDismissedLinkUrl] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<SelectedChatMedia[]>([]);
  // Shared from another app: into the composer once, for the person to send (MESSAGE_NOTIFICATIONS_PLAN.md 12).
  const sharedApplied = useRef<string | null>(null);
  useEffect(() => {
    const key = `${params.sharedText ?? ''}|${params.sharedFile ?? ''}`;
    if (key === '|' || sharedApplied.current === key) return;
    sharedApplied.current = key;
    if (params.sharedText) setText((current) => (current ? `${current} ${params.sharedText}` : params.sharedText!));
    if (params.sharedFile) {
      const uri = params.sharedFile.startsWith('file://') ? params.sharedFile : `file://${params.sharedFile}`;
      setSelectedImages((current) => [...current, {
        id: `shared-${Date.now()}`, originalUri: uri, currentUri: uri, kind: 'image', mimeType: params.sharedMimeType ?? 'image/jpeg',
      }]);
    }
  }, [params.sharedText, params.sharedFile, params.sharedMimeType]);
  const attachmentRequestRef = useRef<string | null>(null);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [photoToCrop, setPhotoToCrop] = useState<string | null>(null);
  const [cropIndex, setCropIndex] = useState<number>(-1);
  const [hasMore, setHasMore] = useState(true);
  /**
   * Set while the list shows a window around a jumped-to message rather than the
   * latest messages - Telegram's model for "go to message". The window pages in
   * both directions, and the latest messages wait in `latestSnapshotRef` so the
   * scroll-down button can bring them back instantly.
   */
  const [hasNewer, setHasNewer] = useState(false);
  const detachedRef = useRef(false);
  const newerCursorRef = useRef<{ sentAt: string; id: string } | null>(null);
  const latestSnapshotRef = useRef<{ messages: Message[]; hasMore: boolean } | null>(null);
  const loadingNewerRef = useRef(false);
  const [isSending, setIsSending] = useState(false);
  const consumedMediaRef = useRef<SelectedChatMedia[] | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  // Mount on first use and retain it for keyboard handoffs.
  const [emojiMounted, setEmojiMounted] = useState(false);
  /**
   * False until the chat has finished sliding in.
   *
   * Everything that is not the conversation itself waits for it: the settings
   * request, the media queue, the delta sync. Each of those ends in a dispatch,
   * and a dispatch mid-transition re-renders the screen in the frames the
   * animation needs, which is what made opening a chat feel heavy.
   */
  const [screenReady, setScreenReady] = useState(false);
  const pinnedQuery = useChatMarks(currentUserId, matchId, 'pin', isFocused && screenReady);
  const starredQuery = useChatMarks(currentUserId, matchId, 'star', isFocused && screenReady);
  const pinnedMessages = useMemo(() => visibleMarkedMessages(pinnedQuery.data ?? []), [pinnedQuery.data]);
  const starredIds = useMemo(() => new Set(visibleMarkedMessages(starredQuery.data ?? []).map(message => message.id)), [starredQuery.data]);
  const pinnedIds = useMemo(() => new Set(pinnedMessages.map(message => message.id)), [pinnedMessages]);
  const openMarked = useCallback((kind: MarkKind) => { Keyboard.dismiss(); setMarkedKind(kind); setMarkedOpen(true); }, []);
  useFocusEffect(useCallback(() => {
    void marksQueryClient.invalidateQueries({ queryKey: chatMarksKey(currentUserId, matchId) });
  }, [currentUserId, matchId, marksQueryClient]));
  const screenReadyRef = useRef(false);
  const afterReadyRef = useRef<Array<() => void>>([]);
  /** Runs now if the chat is already on screen, otherwise the moment it is. */
  const runWhenReady = useCallback((task: () => void) => {
    if (screenReadyRef.current) task();
    else afterReadyRef.current.push(task);
  }, []);
  const inputModeRef = useRef<'closed' | 'keyboard' | 'emoji'>('closed');
  // Keep the picker mounted during a keyboard handoff, independently of intent.
  const pickerHeld = useSharedValue(false);
  const focusGeneration = useRef(0);
  const focusFrameRef = useRef<number | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  // Bumped to send the list back to the newest message. The list resets its own
  // window there, so the jump lands on a short list it can draw at once rather
  // than on a row somewhere inside a long one it would have to build first.
  const [newestRequest, setNewestRequest] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  const [peerPresence, setPeerPresence] = useState<{ online: boolean; lastSeenAt: string | null } | null>(null);
  const scrollBtnScale = useSharedValue(0);

  const flatListRef = useRef<FlashListRef<DisplayRow>>(null);
  const inputRef = useRef<TextInput>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const lastTypingSentRef = useRef(0);
  const optimisticIdsRef = useRef<Map<string, { tempId: string, realId?: string, sentAt: number, sequenceNum: number, content: string }>>(new Map());
  const messageSequenceRef = useRef<number>(0); // Track message order like WhatsApp
  const pendingServerAcksRef = useRef<Map<string, any>>(new Map()); // Buffer for out-of-order arrivals
  const processedServerIdsRef = useRef<Set<string>>(new Set()); // Server IDs already handled by callbacks — skip in new_message
  const lastEventSeqRef = useRef(0);
  const messageIdsRef = useRef<Set<string>>(new Set()); // Fresh dedup set, updated on every messages change
  const queueRetryInProgressRef = useRef(false); // Prevent double retry (mount + connect event)
  const requestQueueRetryRef = useRef<() => void>(() => undefined);
  const messageRetriesRef = useRef(new Set<string>());
  const mediaUploadJobsRef = useRef<Map<string, MediaUploadJob>>(new Map());
  const mediaUploadAbortRef = useRef<Map<string, Map<number, AbortController>>>(new Map());
  const draftLoadedRef = useRef(false);
  const isScrolledUpRef = useRef(false);
  const isScrollingDownRef = useRef(false);
  const scrollDownVisibleRef = useRef(false);

  const emojiHeight = useSharedValue(0);
  const [keyboardHeight, setKeyboardHeight] = useState(DEFAULT_KEYBOARD_HEIGHT);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  const prevKeyboardHeight = useSharedValue(0);
  const savedKeyboardHeight = useSharedValue(keyboardHeight);
  const isAndroid = useSharedValue(Platform.OS === 'android');

  // Take the window out of the OS's hands for this screen only.
  //
  // With adjustResize Android shrinks the window itself when the keyboard
  // opens, while this screen *also* translates its content by emojiHeight. The
  // two are not synchronised: the translation unwinds smoothly frame by frame,
  // the OS resize lands in one step. Swapping the emoji panel for the keyboard
  // therefore dropped the composer to the bottom before it snapped back.
  //
  // adjustNothing stops the resize, so the translation below is the only thing
  // moving the composer - the same manual approach Telegram takes with its
  // SizeNotifierFrameLayout. Restored on blur so every other screen keeps the
  // resize behaviour its inputs depend on.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    return () => KeyboardController.setDefaultMode();
  }, []);

  // Reuse the keyboard height measured on a previous visit, so the very first
  // tap on the emoji icon opens the panel at the right size instead of at a
  // guess that only gets corrected once the keyboard has been shown.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEYBOARD_HEIGHT_KEY)
      .then(stored => {
        const remembered = Number(stored);
        // Ignore junk and stale values from a different screen size.
        if (cancelled || !Number.isFinite(remembered) || remembered <= 0) return;
        if (remembered > Dimensions.get('window').height * 0.8) return;
        setKeyboardHeight(remembered);
        savedKeyboardHeight.value = remembered;
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [savedKeyboardHeight]);

  const rememberKeyboardHeight = useCallback((measured: number) => {
    AsyncStorage.setItem(KEYBOARD_HEIGHT_KEY, String(Math.round(measured))).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!screenReady) return;
    screenReadyRef.current = true;
    const queued = afterReadyRef.current;
    afterReadyRef.current = [];
    let cancelled = false;
    let idle: ReturnType<typeof requestIdleCallback> | undefined;
    const next = () => {
      if (cancelled || !queued.length) return;
      idle = requestIdleCallback(() => {
        if (cancelled) return;
        queued.shift()?.();
        next();
      }, { timeout: 500 });
    };
    next();
    return () => {
      cancelled = true;
      if (idle !== undefined) cancelIdleCallback(idle);
    };
  }, [screenReady]);

  useEffect(() => {
    const ready = () => setScreenReady(true);
    const unsubscribe = navigation.addListener('transitionEnd' as never, ready);
    // transitionEnd is the precise moment; a timer covers navigators that do
    // not emit it, and an instant open where it has already passed.
    const fallback = setTimeout(ready, 400);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [navigation]);

  // Build the emoji panel on its first use, not during chat navigation.

  const closeEmojiPanel = useCallback(() => {
    inputModeRef.current = 'closed';
    focusGeneration.current += 1;
    pickerHeld.value = false;
    setShowEmoji(false);
    emojiHeight.value = withTiming(0, { duration: 150 });
  }, [emojiHeight]);

  const finishPickerHandoff = useCallback((height: number) => {
    // An old keyboard completion must not override a newer picker tap.
    if (inputModeRef.current !== 'keyboard' || !KeyboardController.isVisible()) return;
    // onStart has already carried the offset to this height over the keyboard's
    // own duration, so there is normally nothing left to do. Assigning the
    // height here unconditionally is what produced a jolt at the exact moment
    // the keyboard settled: the offset had been held at the picker's panel
    // height, and this snapped it to the keyboard's real one in a single frame.
    // Correct only a genuine drift, and move rather than jump.
    if (Math.abs(emojiHeight.value - height) > 1) {
      emojiHeight.value = withTiming(height, { duration: 120, easing: KEYBOARD_EASING });
    }
    pickerHeld.value = false;
    setShowEmoji(false);
  }, [emojiHeight, pickerHeld]);

  // The picker is a panel this screen draws, not a route, so the system back
  // press knew nothing about it and popped the whole chat instead. Treat it as
  // one level of "open thing" to dismiss first.
  useEffect(() => {
    if (!showEmoji) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeEmojiPanel();
      return true; // consumed: do not let navigation pop the screen
    });
    return () => subscription.remove();
  }, [showEmoji, closeEmojiPanel]);

  // Frame-by-frame synchronized keyboard positioning
  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';
        // The opening target is available before the first animation frame.
        if (e.height > 0) savedKeyboardHeight.value = e.height;

        // Animate to the target on Reanimated's own clock rather than stepping
        // to whatever onMove last reported.
        //
        // onMove is driven by the window insets animation, and on this screen
        // each of those callbacks costs ~25ms of UI-thread work, so only about
        // nine of them arrive per transition, spaced 30-60ms apart. The system
        // draws the keyboard itself every frame, so following those samples is
        // what made the content step while the keyboard glided. The target and
        // the duration are both known up front, so there is nothing to sample:
        // interpolating between them uses every frame that renders.

        // The one case that must not follow the keyboard is the emoji button
        // dismissing it: the panel is taking the keyboard's place, so the
        // offset stays exactly where it is while the keyboard drops away.
        if (pickerHeld.value && e.height <= 0) return;

        // Everything else follows the keyboard to its real height - including a
        // handoff out of the picker. Holding at the panel height instead left
        // the offset wrong whenever this keyboard came up a different size than
        // the one the panel was sized from, and the gap between the composer
        // and the shorter keyboard is where a strip of emoji picker showed
        // through. Following the real target closes that gap on the way up.
        emojiHeight.value = withTiming(Math.abs(e.height), {
          duration: e.duration > 0 ? e.duration : KEYBOARD_FALLBACK_DURATION_MS,
          easing: KEYBOARD_EASING,
        });
      },
      onMove: (e) => {
        'worklet';
        const absHeight = Math.abs(e.height);
        prevKeyboardHeight.value = absHeight;

        // The offset is normally owned by the animation started in onStart;
        // correcting it on every sample is what made the content step. Only a
        // drift this large means that animation is not running, and then the
        // live position is the only thing worth following. Assigning the value
        // cancels the stalled animation, so the samples take over cleanly.
        if (pickerHeld.value) return;
        if (Math.abs(emojiHeight.value - absHeight) > KEYBOARD_DRIFT_TOLERANCE) {
          emojiHeight.value = absHeight;
        }
      },
      onEnd: (e) => {
        'worklet';
        const absHeight = Math.abs(e.height);
        prevKeyboardHeight.value = absHeight; // Sync at end frame

        if (e.height > 0) {
          savedKeyboardHeight.value = e.height; // Cache fully opened height
          // Land exactly on the final height. Reaching here short of it means
          // the animation was cancelled or starved, so close the remainder as a
          // movement instead of leaving the composer parked below the keyboard.
          if (!pickerHeld.value && Math.abs(emojiHeight.value - e.height) > 1) {
            emojiHeight.value = withTiming(e.height, { duration: 100, easing: KEYBOARD_EASING });
          }
          runOnJS(setKeyboardHeight)(e.height);
          runOnJS(rememberKeyboardHeight)(e.height);
          runOnJS(setIsKeyboardVisible)(true);
          if (pickerHeld.value) {
            // Keyboard has settled and now covers the picker exactly. Pin the
            // offset to the final height first, so retiring the picker cannot
            // change what the next frame renders.
            runOnJS(finishPickerHandoff)(e.height);
          }
        } else {
          runOnJS(setIsKeyboardVisible)(false);
          if (!pickerHeld.value) {
            emojiHeight.value = 0;
          }
        }
      },
    },
    [finishPickerHandoff]
  );

  // Keep messageIdsRef in sync with messages (avoids stale closure in socket handlers)
  useEffect(() => {
    const idSet = new Set(messages.map(m => m.id));
    messageIdsRef.current = idSet;
  }, [messages]);

  useEffect(() => {
    let active = true;
    draftLoadedRef.current = false;
    const initialRevision = composerDraft.getRevision();
    void loadChatDraft(matchId).then(async (draft) => {
      if (!active) return;
      if (draft && composerDraft.getRevision() === initialRevision) {
        setText(draft.text);
        setSelectedImages(draft.media.filter((item) => {
          try { return new FileSystemFile(item.currentUri).exists; } catch { return false; }
        }));
        if (draft.replyToId) {
          let reply = messages.find((message) => message.id === draft.replyToId) ?? null;
          if (!reply) {
            try {
              const response = await api.get(`/chat/${matchId}/messages/${draft.replyToId}/context`);
              reply = (response.data?.data as Message[] | undefined)?.find((message) => message.id === draft.replyToId) ?? null;
            } catch {
              reply = null;
            }
          }
          if (active) setReplyingTo(reply);
        }
      }
      draftLoadedRef.current = true;
    });
    return () => { active = false; };
    // Load once for this conversation. The server sync runs independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    if (!draftLoadedRef.current) return;
    const timer = setTimeout(() => {
      void saveChatDraft(matchId, {
        text: composerDraft.getSnapshot(),
        replyToId: replyingTo?.id,
        media: selectedImages,
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [matchId, replyingTo?.id, selectedImages, text]);

  useEffect(() => {
    const url = firstHttpUrl(text);
    if (!url) {
      setComposerLinkPreview(null);
      setDismissedLinkUrl(null);
      return;
    }
    if (dismissedLinkUrl === url) {
      setComposerLinkPreview(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      api.get('/chat/link-preview', { params: { url } })
        .then((response) => {
          if (active && firstHttpUrl(composerDraft.getSnapshot()) === url) setComposerLinkPreview(response.data?.data ?? null);
        })
        .catch(() => { if (active) setComposerLinkPreview(null); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [dismissedLinkUrl, text]);

  // Fetch messages — smart: uses cache if available, only fetches new ones
  /**
   * The page cursor is always the oldest confirmed message on screen, not a value
   * remembered from the last response. A remembered cursor went stale whenever
   * the list changed underneath it - restored from the cache, a jump, a reply
   * context - and history then stopped loading at that message for good.
   */
  const oldestLoaded = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (!messages[index].id.startsWith('temp-')) return messages[index];
    }
    return null;
  }, [messages]);
  const oldestLoadedRef = useRef(oldestLoaded);
  oldestLoadedRef.current = oldestLoaded;

  const historyPrefetch = useMemo(() => createHistoryPrefetch((cursor: string) => {
    // The timestamp lets the server keep paging when the cursor message itself
    // has since been auto-deleted or cleared.
    const anchor = oldestLoadedRef.current?.id === cursor ? oldestLoadedRef.current : null;
    return api.get(`/chat/${matchId}/messages`, {
      params: { cursor, limit: 40, ...(anchor ? { cursorSentAt: anchor.sentAt } : {}) },
    });
  }), [matchId]);
  const historyRequests = useMemo(() => new Set<string>(), [matchId]);
  const messageWindow = useMemo(() => createMessageWindow(), [matchId]);
  useEffect(() => () => { messageWindow.invalidate(); }, [messageWindow]);

  useEffect(() => {
    if (hasMore && oldestLoaded) {
      // A failure clears the slot. Reaching the threshold retries normally.
      void historyPrefetch.prime(oldestLoaded.id).catch(() => undefined);
    }
  }, [hasMore, oldestLoaded, historyPrefetch]);

  /** Leaves a jumped-to window. The caller decides what the list shows next. */
  const attachToLatest = useCallback(() => {
    messageWindow.invalidate();
    loadingNewerRef.current = false;
    detachedRef.current = false;
    latestSnapshotRef.current = null;
    newerCursorRef.current = null;
    setHasNewer(false);
  }, [messageWindow]);

  const fetchMessages = useCallback(async (cursor?: string) => {
    const ticket = messageWindow.capture();
    const requestKey = `${ticket}:${cursor ?? 'latest'}`;
    if (historyRequests.has(requestKey)) return;
    historyRequests.add(requestKey);
    try {
      if (!cursor) {
        dispatch(setLoadingMessages(true));
      }
      // Older pages are prefetched without changing the list header height.
      const params: any = { limit: 50 };
      if (cursor) params.cursor = cursor;
      const response = cursor
        ? await historyPrefetch.take(cursor)
        : await api.get(`/chat/${matchId}/messages`, { params });
      if (!messageWindow.isCurrent(ticket)) return;
      if (response.data?.success) {
        // The latest page replaces the list, which ends any jumped-to window.
        if (!cursor) { dispatch(setLoadingMessages(false)); attachToLatest(); }
        const result = response.data.data;
        const deliveredIds = (result.messages as Message[])
          .filter((message) => message.senderId !== currentUserId && !message.deliveredAt)
          .map((message) => message.id);
        if (deliveredIds.length) {
          const socket = getSocket();
          if (socket?.connected) socket.emit('messages_delivered', { matchId, messageIds: deliveredIds });
          else void api.patch(`/chat/${matchId}/delivered`, { messageIds: deliveredIds });
        }
        // Keep the store newest-first. MessageList reverses the rows for its
        // chronological FlashList without changing pagination cursors.
        if (cursor) {
          dispatch(prependMessages({ matchId, messages: result.messages }));
        } else {
          dispatch(setMessages({ matchId, messages: result.messages }));
        }
        setHasMore(result.hasMore);
      }
    } catch (err) {
      console.error('[Chat] Error fetching messages:', err);
    } finally {
      historyRequests.delete(requestKey);
      if (!cursor && messageWindow.isCurrent(ticket)) dispatch(setLoadingMessages(false));
    }
  }, [dispatch, matchId, currentUserId, historyPrefetch, historyRequests, attachToLatest, messageWindow, store]);

  const loadOlder = useCallback(() => {
    const oldest = oldestLoadedRef.current;
    if (!hasMore || !oldest) return;
    void fetchMessages(oldest.id);
  }, [hasMore, fetchMessages, historyRequests]);

  /** Pages toward the present from a jumped-to window. */
  const loadNewer = useCallback(async () => {
    const cursor = newerCursorRef.current;
    if (!detachedRef.current || !cursor || loadingNewerRef.current) return;
    loadingNewerRef.current = true;
    const ticket = messageWindow.capture();
    try {
      const response = await api.get(`/chat/${matchId}/messages`, { params: { since: cursor.sentAt, sinceId: cursor.id } });
      const result = response.data?.data;
      if (!messageWindow.isCurrent(ticket) || !result || !detachedRef.current) return;
      if (result.messages.length) dispatch(mergeMessages({ matchId, messages: result.messages }));
      newerCursorRef.current = result.syncCursor;
      // Caught up: the window has grown into the present and is the latest list.
      if (!result.hasMore) attachToLatest();
    } catch (err) {
      console.error('[Chat] Error fetching newer messages:', err);
    } finally {
      if (messageWindow.isCurrent(ticket)) loadingNewerRef.current = false;
    }
  }, [attachToLatest, dispatch, matchId, messageWindow]);

  // The scroll handler is stable; it reaches the current loaders through refs.
  const loadOlderRef = useRef(loadOlder);
  loadOlderRef.current = loadOlder;
  const loadNewerRef = useRef(loadNewer);
  loadNewerRef.current = loadNewer;

  const handleScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const viewport = layoutMeasurement?.height ?? 0;
    const { fromBottom, fromTop } = chatScrollDistances(contentOffset.y, contentSize.height, viewport);
    if (screenReadyRef.current && viewport > 0) {
      if (fromTop < viewport * 3) loadOlderRef.current();
      if (fromBottom < viewport) void loadNewerRef.current();
    }

    const isUp = fromBottom > 100;
    // Always update state at the newest edge, including programmatic scrolling.
    // Do not use the ref as a state-change guard: the button press also writes it.
    if (!isUp) isScrollingDownRef.current = false;
    isScrolledUpRef.current = isUp;
    const visible = isUp && !isScrollingDownRef.current;
    if (scrollDownVisibleRef.current !== visible) {
      scrollDownVisibleRef.current = visible;
      setShowScrollDown(visible);
      scrollBtnScale.value = visible || detachedRef.current ? 1 : 0;
    }
    if (!isUp) setUnreadCount(0);
  }, [scrollBtnScale]);

  const handleScrollBeginDrag = useCallback(() => {
    // A finger can interrupt the animated trip to the latest message.
    isScrollingDownRef.current = false;
  }, []);

  useEffect(() => {
    scrollBtnScale.value = showScrollDown || hasNewer ? 1 : 0;
  }, [showScrollDown, hasNewer, scrollBtnScale]);

  const animatedScrollBtnStyle = useAnimatedStyle(() => {
    return {
      // Tracks the composer in the same frame the composer resizes. Expressed
      // as a translation rather than by writing `bottom`, so following it never
      // costs a layout pass - the static style anchors it at SCROLL_BTN_BOTTOM.
      opacity: scrollBtnScale.value,
      transform: [
        { translateY: SCROLL_BTN_BOTTOM - (composerH.value + 2) },
        { scale: scrollBtnScale.value },
      ],
    };
  });

  // Fetch only new messages since our latest cached message
  const fetchNewMessages = useCallback(async () => {
    // A jumped-to window syncs forward through loadNewer instead.
    if (detachedRef.current) return;
    const ticket = messageWindow.capture();
    try {
      const current = store.getState().chat.activeMessages[matchId] ?? [];
      const cachedMessages = current.filter(m => !m.id.startsWith('temp-'));
      if (cachedMessages.length === 0) return fetchMessages(); // No cache, full fetch

      // The store remains newest-first, so index 0 is the newest confirmed message.
      let syncCursor = { sentAt: cachedMessages[0].sentAt, id: cachedMessages[0].id };
      for (let page = 0; page < 10; page += 1) {
        const response = await api.get(`/chat/${matchId}/messages`, {
          params: { since: syncCursor.sentAt, sinceId: syncCursor.id },
        });
        if (!messageWindow.isCurrent(ticket) || detachedRef.current) return;
        if (!response.data?.success) break;
        const newMsgs: Message[] = response.data.data.messages;
        const deliveredIds = newMsgs
          .filter((message) => message.senderId !== currentUserId && !message.deliveredAt)
          .map((message) => message.id);
        if (deliveredIds.length) {
          const socket = getSocket();
          if (socket?.connected) socket.emit('messages_delivered', { matchId, messageIds: deliveredIds });
          else void api.patch(`/chat/${matchId}/delivered`, { messageIds: deliveredIds });
        }
        // One ordered, de-duplicated insert for the whole page: a dispatch per
        // message re-rendered the chat once for each while it was opening.
        if (newMsgs.length) dispatch(mergeMessages({ matchId, messages: newMsgs }));
        if (!response.data.data.hasMore) break;
        syncCursor = response.data.data.syncCursor;
      }
    } catch (err) {
      console.error('[Chat] Error fetching new messages:', err);
    }
  }, [currentUserId, dispatch, matchId, store, fetchMessages, messageWindow]);

  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashMessage = useCallback((messageId: string) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedMessageId(messageId);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId((current) => current === messageId ? null : current);
    }, 1600);
  }, []);

  /**
   * Shows a message in the conversation.
   *
   * Loaded already: scroll to it, no request. Otherwise the server returns the
   * messages around it. A window that overlaps what is loaded joins it; one that
   * does not replaces the list, with the latest messages set aside rather than
   * thrown away. Previously the window always replaced the list and switched
   * history paging off, so after one jump nothing older or newer would load.
   */
  const jumpToMessage = useCallback(async (messageId: string) => {
    if (messageIdsRef.current.has(messageId)) {
      flashMessage(messageId);
      return true;
    }
    messageWindow.invalidate();
    loadingNewerRef.current = false;
    dispatch(setLoadingMessages(false));
    const ticket = messageWindow.capture();
    let context: Message[];
    try {
      const response = await api.get(`/chat/${matchId}/messages/${messageId}/context`);
      if (!messageWindow.isCurrent(ticket)) return false;
      context = (response.data?.data as Message[] | undefined) ?? [];
    } catch {
      if (!messageWindow.isCurrent(ticket)) return false;
      Alert.alert('Message unavailable', 'This message is no longer available.');
      return false;
    }
    if (!context.length) return false;
    const around = [...context].reverse(); // server sends oldest first
    const current = store.getState().chat.activeMessages[matchId] ?? [];
    const loadedIds = new Set(current.map((message) => message.id));
    if (around.some((message) => loadedIds.has(message.id))) {
      dispatch(mergeMessages({ matchId, messages: around }));
    } else {
      if (!detachedRef.current) {
        latestSnapshotRef.current = { messages: current.filter((message) => !message.id.startsWith('temp-')), hasMore };
      }
      detachedRef.current = true;
      newerCursorRef.current = { sentAt: around[0].sentAt, id: around[0].id };
      setHasNewer(true);
      setHasMore(true); // an empty page switches it off
      dispatch(setMessages({ matchId, messages: around }));
    }
    flashMessage(messageId);
    return true;
  }, [dispatch, flashMessage, hasMore, matchId, store, messageWindow]);

  /** Back to the present from a jumped-to window, from memory when it can be. */
  const returnToLatest = useCallback((sync = true) => {
    const snapshot = latestSnapshotRef.current;
    const windowMessages = store.getState().chat.activeMessages[matchId] ?? [];
    attachToLatest();
    if (!snapshot?.messages.length) {
      if (sync) void fetchMessages();
      return;
    }
    dispatch(setMessages({ matchId, messages: snapshot.messages }));
    // Anything that arrived while away is newer than the snapshot; keep it.
    const newest = snapshot.messages[0];
    const arrived = windowMessages.filter((message) => !message.id.startsWith('temp-') && isNewerMessage(message, newest));
    if (arrived.length) dispatch(mergeMessages({ matchId, messages: arrived }));
    setHasMore(snapshot.hasMore);
    if (sync) void fetchNewMessages();
  }, [attachToLatest, dispatch, fetchMessages, fetchNewMessages, matchId, store]);
  const returnToLatestRef = useRef(returnToLatest);
  returnToLatestRef.current = returnToLatest;

  useEffect(() => {
    if (!screenReady) return;
    let active = true;
    conversationApi.settings(matchId)
      .then((settings) => {
        if (!active) return;
        // One pass, not two: each render of this screen rebuilds the message
        // list's element tree.
        React.startTransition(() => {
          setMutedUntil(settings.mutedUntil);
          setTtlSeconds(settings.messageTtlSeconds);
        });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [matchId, screenReady]);

  // The chat on screen is the one notifications stay quiet about.
  useFocusEffect(useCallback(() => {
    setActiveChat(matchId);
    // Opened: this chat's notifications leave the status bar (NOTIFICATIONS_PLAN.md 7).
    void dismissChatNotifications(matchId);
    clearChatNotification(matchId);
    // Its shortcut: Android's Conversations section and "Share to …" (MESSAGE_NOTIFICATIONS_PLAN.md 12).
    if (userName && userName !== 'Chat') reportChatShortcut(matchId, userName, params.userAvatar ?? null);
    return () => {
      if (getActiveChat() === matchId) setActiveChat(null);
    };
  }, [matchId]));

  // Auto-deleted messages leave the screen at their deadline, not whenever the
  // server's sweep next runs. Only the soonest deadline needs a timer: removing
  // that message re-renders with the next one.
  const nextExpiry = useMemo(() => {
    let soonest = Infinity;
    for (const message of messages) {
      if (!message.expiresAt) continue;
      const at = new Date(message.expiresAt).getTime();
      if (at < soonest) soonest = at;
    }
    return soonest;
  }, [messages]);
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    // setTimeout overflows past about 24.8 days and would fire at once; a year-long
    // deadline just waits the maximum and is checked again then.
    const delay = Math.min(Math.max(0, nextExpiry - Date.now()) + 50, 2 ** 31 - 1);
    const timer = setTimeout(() => dispatch(expireMessages({ matchId, now: Date.now() })), delay);
    return () => clearTimeout(timer);
  }, [dispatch, matchId, nextExpiry]);

  const reactorAvatars = useMemo(() => ({
    ...(currentUserId ? { [currentUserId]: myAvatar } : {}),
    ...(userId ? { [userId]: userAvatar } : {}),
  }), [currentUserId, myAvatar, userAvatar, userId]);

  const updateMute = useCallback(async (until: string | null) => {
    const previous = mutedUntil;
    setMutedUntil(until);
    dispatch(patchConversation({ matchId, changes: { mutedUntil: until, muted: isMuted(until) } }));
    try {
      await conversationApi.mute(matchId, until);
    } catch (error) {
      setMutedUntil(previous);
      dispatch(patchConversation({ matchId, changes: { mutedUntil: previous, muted: isMuted(previous) } }));
      Alert.alert('Could not change notifications', apiErrorMessage(error, 'Try again.'));
    }
  }, [dispatch, matchId, mutedUntil]);

  const updateTtl = useCallback(async (seconds: number | null) => {
    const previous = ttlSeconds;
    setTtlSeconds(seconds);
    dispatch(patchConversation({ matchId, changes: { messageTtlSeconds: seconds } }));
    try {
      await conversationApi.ttl(matchId, seconds);
    } catch (error) {
      setTtlSeconds(previous);
      dispatch(patchConversation({ matchId, changes: { messageTtlSeconds: previous } }));
      Alert.alert('Could not change auto-delete', apiErrorMessage(error, 'Try again.'));
    }
  }, [dispatch, matchId, ttlSeconds]);

  const confirmClearOrDelete = useCallback(async (kind: 'clear' | 'delete', forEveryone: boolean) => {
    setPendingConfirm(null);
    try {
      if (kind === 'clear') {
        const { throughSeq } = await conversationApi.clear(matchId, forEveryone);
        void clearNativeChatMatch(currentUserId ?? '', matchId);
        dispatch(clearMessagesThrough({ matchId, throughSeq }));
      } else {
        const { throughSeq } = await conversationApi.remove(matchId, forEveryone);
        void clearNativeChatMatch(currentUserId ?? '', matchId);
        dispatch(clearMessagesThrough({ matchId, throughSeq }));
        dispatch(removeConversation(matchId));
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.navigate('Main');
      }
    } catch (error) {
      Alert.alert(kind === 'clear' ? 'Could not clear history' : 'Could not delete chat', apiErrorMessage(error, 'Try again.'));
    }
  }, [currentUserId, dispatch, matchId, navigation]);

  // Jumps requested through the route: shared media, search, starred messages.
  const handledFocusRef = useRef<string | null>(null);
  const focusKey = params.focusMessageId ? `${params.focusMessageId}:${params.focusNonce ?? ''}` : null;

  useEffect(() => {
    // A chat opened from inside another chat reuses this screen, so the window
    // state of the conversation just left must not carry over - and the restore
    // below has to be the one bound to that conversation, not to this one.
    const restoreLatest = returnToLatestRef.current;
    attachToLatest();
    setHasMore(true);
    // A cached conversation draws immediately and is brought up to date once the
    // screen has settled, below. Only an empty one has to fetch to show anything.
    if (params.focusMessageId) {
      handledFocusRef.current = focusKey;
      void jumpToMessage(params.focusMessageId);
    } else if ((store.getState().chat.activeMessages[matchId] ?? []).length === 0) {
      void fetchMessages();
    }
    // Cleanup on unmount: clear typing indicator
    return () => {
      // Leave the cache holding the latest messages, not a jumped-to window, so
      // the next visit opens at the bottom of the conversation.
      if (detachedRef.current) restoreLatest(false);
      messageWindow.invalidate();
      dispatch(setLoadingMessages(false));
      const socket = getSocket();
      if (socket && isTypingRef.current) {
        socket.emit('typing_stop', { matchId });
        isTypingRef.current = false;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
    // Runs once per conversation; later jumps are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Catching up with the server: deferred, because the cache is already drawn.
  useEffect(() => {
    if (!screenReady || detachedRef.current || historyRequests.has(`${messageWindow.capture()}:latest`)) return;
    if ((store.getState().chat.activeMessages[matchId] ?? []).length > 0) void fetchNewMessages();
    else void fetchMessages();
    // Runs when the screen settles, and again only for another conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, screenReady]);

  useEffect(() => {
    if (!focusKey || !params.focusMessageId || handledFocusRef.current === focusKey) return;
    handledFocusRef.current = focusKey;
    void jumpToMessage(params.focusMessageId);
  }, [focusKey, jumpToMessage, params.focusMessageId]);

  const receiptMessagesById = React.useMemo(
    () => new Map(messages.map(message => [message.id, message])),
    [messages],
  );
  // Read only while the app is on screen: in the background a message that
  // lands in this list is delivered, not read - its notification stays, and
  // the sender doesn't get blue ticks for something nobody has seen.
  const pendingReadRef = useRef<Set<string>>(new Set());
  const acknowledgeVisible = useCallback((ids: string[]) => {
    if (AppState.currentState !== 'active') ids.forEach((id) => pendingReadRef.current.add(id));
    const received = ids
      .map((id) => receiptMessagesById.get(id))
      .filter((message): message is Message => Boolean(message && message.senderId !== currentUserId));
    const undeliveredIds = received.filter((message) => !message.deliveredAt).map((message) => message.id);
    const unreadIds = unreadThroughSeen(messages, ids, currentUserId);
    const socket = getSocket();
    if (undeliveredIds.length) {
      if (socket?.connected) socket.emit('messages_delivered', { matchId, messageIds: undeliveredIds });
      else api.patch(`/chat/${matchId}/delivered`, { messageIds: undeliveredIds }).catch(() => undefined);
    }
    if (!unreadIds.length || AppState.currentState !== 'active') return;
    // The server takes up to 100 ids a call.
    for (let start = 0; start < unreadIds.length; start += 100) {
      const messageIds = unreadIds.slice(start, start + 100);
      if (socket?.connected) socket.emit('message_read', { matchId, messageIds });
      else api.patch(`/chat/${matchId}/read`, { messageIds }).catch(() => undefined);
    }
    dispatch(markConversationRead(matchId));
  }, [matchId, messages, receiptMessagesById, currentUserId, dispatch]);

  // Back on screen: what arrived meanwhile is read now.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !pendingReadRef.current.size) return;
      const ids = [...pendingReadRef.current];
      pendingReadRef.current.clear();
      acknowledgeVisible(ids);
    });
    return () => subscription.remove();
  }, [acknowledgeVisible]);

  // Socket.IO setup
  useEffect(() => {
    // Each conversation resumes from its own position in the event log. The
    // screen is reused when one chat opens another, so the previous chat's
    // position must not carry over.
    lastEventSeqRef.current = store.getState().chat.eventCursors?.[matchId] ?? 0;
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
          if (!messageIdsRef.current.has(item.tempId)) {
            dispatch(addMessage({
              id: item.tempId,
              clientMessageId: item.tempId,
              content: item.content,
              mediaKeys: item.mediaKeys,
              senderId: currentUserId ?? '',
              sentAt: new Date(item.queuedAt).toISOString(),
              deliveredAt: null,
              readAt: null,
              matchId,
              type: item.type,
              metadata: item.metadata,
              replyToId: item.replyToId,
              localStatus: item.status === 'failed' ? 'failed' : 'queued',
              localError: item.error,
            }));
          }
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
        }, (queuedMsg, status, error) => {
          dispatch(updateLocalMessageStatus({ matchId, messageId: queuedMsg.tempId, status, error }));
        });
        const pending = (await getOfflineQueue()).filter(message => message.matchId === matchId && message.status === 'pending');
        if (active && socket.connected && pending.length) {
          const attempts = Math.max(...pending.map(message => message.attempts ?? 0));
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => void performQueueRetry(), Math.min(30000, 1500 * 2 ** attempts));
        }
      } catch (err) {
        console.error('[Chat] Queue retry failed:', err);
      } finally {
        queueRetryInProgressRef.current = false;
      }
    };
    requestQueueRetryRef.current = () => {
      clearTimeout(retryTimer);
      if (active && socket.connected) retryTimer = setTimeout(() => void performQueueRetry(), 1500);
    };

    // Sending what is queued can wait for the transition; nothing is lost by
    // starting it a few frames later, and it is several dispatches deep.
    if (socket.connected) {
      runWhenReady(() => { if (active) void performQueueRetry(); });
    }

    // Join this match room
    socket.emit('join_match_room', matchId);
    const queryPresence = () => {
      if (!userId) return;
      socket.emit('presence_query', { matchId, userId }, (response: { success?: boolean; online?: boolean; lastSeenAt?: string | null }) => {
        if (active && response?.success) setPeerPresence({ online: response.online === true, lastSeenAt: response.lastSeenAt ?? null });
      });
    };
    const handlePresenceChanged = (presence: { userId?: string; online?: boolean; lastSeenAt?: string | null }) => {
      if (!active || presence.userId !== userId) return;
      // Both ways: with your own activity status off, you don't see theirs.
      if (store.getState().auth.user?.showOnlineStatus === false) return setPeerPresence({ online: false, lastSeenAt: null });
      setPeerPresence({ online: presence.online === true, lastSeenAt: presence.lastSeenAt ?? null });
    };
    queryPresence();

    const applyChatEvent = (event: any) => {
      if (event.matchId !== matchId || event.eventSeq <= lastEventSeqRef.current) return;
      lastEventSeqRef.current = event.eventSeq;
      const payload = event.payload || {};
      if (event.type === 'message.created' && payload.message) {
        const message = payload.message as Message;
        if (message.senderId === currentUserId && message.clientMessageId && optimisticIdsRef.current.has(message.clientMessageId)) {
          dispatch(replaceOptimisticMessage({ tempId: message.clientMessageId, realMessage: message }));
          optimisticIdsRef.current.delete(message.clientMessageId);
        } else {
          // A replayed event for a message already on screen is not news. Every
          // one of them used to be counted, so scrolling up while a chat was
          // catching up put old messages on the jump button as unread.
          const alreadyShown = messageIdsRef.current.has(message.id);
          dispatch(addMessage(message));
          if (message.senderId !== currentUserId && !alreadyShown) {
            socket.emit('messages_delivered', { matchId, messageIds: [message.id] });
            if (isScrolledUpRef.current) setUnreadCount((count) => count + 1);
            else socket.emit('message_read', { matchId, messageIds: [message.id] });
          }
        }
      }
      if (event.type === 'message.edited') dispatch(applyMessageEdit({ matchId, ...payload }));
      if (['message.mark_changed', 'message.edited', 'message.deleted', 'message.hidden', 'history.cleared'].includes(event.type)) {
        void marksQueryClient.invalidateQueries({ queryKey: chatMarksKey(currentUserId, matchId) });
        if (payload.messageId) void marksQueryClient.invalidateQueries({ queryKey: ['message-marks', currentUserId, matchId, payload.messageId] });
      }
      if (event.type === 'message.deleted' || event.type === 'message.hidden') {
        void deleteNativeChatMessages(currentUserId ?? '', matchId, [payload.messageId]);
        dispatch(removeMessage({ matchId, messageId: payload.messageId }));
      }
      if (event.type === 'history.cleared') {
        void clearNativeChatMatch(currentUserId ?? '', matchId);
        dispatch(clearMessagesThrough({ matchId, throughSeq: Number(payload.throughSeq ?? 0) }));
      }
      if (event.type === 'conversation.ttl_changed') setTtlSeconds(typeof payload.seconds === 'number' ? payload.seconds : null);
      if (event.type === 'reaction.set' || event.type === 'reaction.removed') dispatch(applyReaction({ matchId, messageId: payload.messageId, userId: payload.userId, emoji: payload.emoji }));
      if (event.type === 'messages.read' && payload.userId !== currentUserId) dispatch(markMessagesReadByPeer({ matchId, messageIds: payload.messageIds, throughMessageSeq: payload.throughMessageSeq, readAt: payload.readAt }));
      if (event.type === 'messages.delivered' && payload.userId !== currentUserId) dispatch(markMessagesDeliveredByPeer({ matchId, messageIds: payload.messageIds, throughMessageSeq: payload.throughMessageSeq, deliveredAt: payload.deliveredAt }));
      // The blue microphone, live: they listened (MESSAGE_NOTIFICATIONS_PLAN.md 7).
      if (event.type === 'message.played' && payload.userId !== currentUserId) dispatch(markVoicePlayed({ matchId, messageId: payload.messageId, playedAt: payload.playedAt }));
    };

    let syncing = false;
    let syncRequested = false;
    let cursorTimer: ReturnType<typeof setTimeout> | null = null;
    const persistEventCursor = () => {
      if (cursorTimer) clearTimeout(cursorTimer);
      cursorTimer = setTimeout(() => {
        dispatch(setEventCursor({ matchId, seq: lastEventSeqRef.current }));
        void getDeviceId()
          .then(deviceId => api.put(`/chat/${matchId}/device-cursor`, { deviceId, eventSeq: lastEventSeqRef.current }))
          .catch(() => undefined);
      }, 250);
    };
    const syncEvents = async (_apply: boolean) => {
      if (!active) return;
      if (syncing) { syncRequested = true; return; }
      syncing = true;
      try {
        if (lastEventSeqRef.current === 0) {
          lastEventSeqRef.current = store.getState().chat.eventCursors?.[matchId] ?? 0;
        }
        if (lastEventSeqRef.current === 0) {
          // Never caught up on this device. Replaying from the first event would
          // walk the conversation's whole history; instead do what the server
          // does for a cursor too old to replay - reload the latest messages and
          // continue from its high-water mark.
          const head = await api.get(`/chat/${matchId}/events`, { params: { afterSeq: 0, limit: 1 } });
          if (!active) return;
          const highWaterSeq = Number(head.data?.data?.highWaterSeq ?? 0);
          if (highWaterSeq > 0) {
            await fetchMessages();
            if (!active) return;
            lastEventSeqRef.current = Math.max(lastEventSeqRef.current, highWaterSeq);
          }
        }
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
        dispatch(setEventCursor({ matchId, seq: lastEventSeqRef.current }));
        const deviceId = await getDeviceId();
        await api.put(`/chat/${matchId}/device-cursor`, { deviceId, eventSeq: lastEventSeqRef.current });
      } finally { syncing = false; }
    };
    const handleChatEvent = (event: any) => {
      if (event.matchId !== matchId) return;
      // Their message arrived: they are no longer typing it (Telegram and
      // WhatsApp clear the status the moment the message lands).
      const author = event.actorId ?? event.payload?.message?.senderId;
      if (event.type === 'message.created' && author && author !== currentUserId) typingPresence.stop();
      const eventSeq = Number(event.eventSeq);
      // The outbox sends the complete event. Apply the next event immediately
      // so reactions change on the other phone without an extra HTTP request.
      // Replay remains the source of truth when a sequence gap is detected.
      if (
        Number.isSafeInteger(eventSeq)
        && eventSeq === lastEventSeqRef.current + 1
        && typeof event.type === 'string'
        && event.payload
      ) {
        applyChatEvent({ ...event, eventSeq });
        persistEventCursor();
        return;
      }
      if (!Number.isSafeInteger(eventSeq) || eventSeq > lastEventSeqRef.current) {
        void syncEvents(true).catch(() => undefined);
      }
    };
    // The replay catches this chat up on everything missed while it was closed.
    // It can dispatch a long run of events, so it waits for the screen too.
    runWhenReady(() => { if (active) syncEvents(false).catch(() => undefined); });

    // Typing indicators. typing_stop is not guaranteed to arrive, so the
    // indicator expires on its own. See features/chat/typingPresence.
    let typingSenderId: string | null = null;
    const typingPresence = createTypingPresence((typing) => {
      dispatch(setTyping({ matchId, senderId: typing ? typingSenderId : null }));
    });
    const handleTypingStart = (data: { senderId: string; matchId: string; activity?: 'typing' | 'recording' }) => {
      if (data.matchId === matchId && data.senderId !== currentUserId) {
        typingSenderId = data.senderId;
        setPeerActivity(data.activity === 'recording' ? 'recording' : 'typing');
        typingPresence.start();
      }
    };
    const handleTypingStop = (data: { senderId: string; matchId: string }) => {
      if (data.matchId === matchId && data.senderId !== currentUserId) {
        typingPresence.stop();
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
      queryPresence();
      syncEvents(true).catch(() => undefined);
      // Trigger offline queue retry when connection is restored
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => performQueueRetry(), 1000);
    };
    const handleDisconnect = () => setConnectionStatus('disconnected');
    const handleReconnectAttempt = () => setConnectionStatus('reconnecting');

    socket.on('typing_start', handleTypingStart);
    socket.on('typing_stop', handleTypingStop);
    socket.on('presence_changed', handlePresenceChanged);
    socket.on('chat_event', handleChatEvent);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);
    // Back on screen - from a notification, the bubble, or the app switcher:
    // catch up at once, like Telegram. In the background Android often holds
    // the connection's traffic without dropping it, so no reconnect would.
    const resume = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncEvents(true).catch(() => undefined);
        requestQueueRetryRef.current();
      }
    });

    return () => {
      active = false;
      requestQueueRetryRef.current = () => undefined;
      resume.remove();
      clearTimeout(retryTimer);
      if (cursorTimer) clearTimeout(cursorTimer);
      socket.off('typing_start', handleTypingStart);
      socket.off('typing_stop', handleTypingStop);
      socket.off('presence_changed', handlePresenceChanged);
      typingPresence.dispose();
      socket.off('chat_event', handleChatEvent);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      dispatch(setTyping({ matchId, senderId: null }));
    };
  }, [matchId, currentUserId, dispatch, fetchMessages, userId, runWhenReady, marksQueryClient]);

  const reportRecordingActivity = useCallback((active: boolean) => {
    getSocket()?.emit(active ? 'typing_start' : 'typing_stop', { matchId, activity: 'recording' });
  }, [matchId]);

  const runMediaUploadJob = useCallback(async (tempId: string, retryIndex?: number) => {
    const job = mediaUploadJobsRef.current.get(tempId);
    if (!job || job.sending) return;
    job.sending = true;
    dispatch(updateLocalMessageStatus({ matchId, messageId: tempId, status: 'sending' }));

    const indexes = mediaRetryIndexes(job.mediaKeys, retryIndex);
    // The status bar shows this message's sending (not for voice notes, which are quick).
    const notice = job.messageType === 'voice' ? null : createMediaSendNotice(
      tempId,
      job.items.map((item) => (item.kind === 'video' ? 'video' : item.kind === 'file' ? 'file' : 'photo')),
      job.items.some((item) => shouldUploadResumably(item.size ?? 0, null)),
    );
    job.mediaKeys.forEach((key, index) => { if (key) notice?.update(index, 100); });
    notice?.start();
    const cancelledItems = new Set<number>();
    job.mediaKeys.forEach((key, index) => {
      if (key) dispatch(updateLocalMediaUpload({ matchId, messageId: tempId, itemIndex: index, progress: 100, status: 'processing' }));
    });

    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, indexes.length) }, async () => {
      while (cursor < indexes.length) {
        const index = indexes[cursor++];
        const item = job.items[index];
        let lastUpdate = 0;
        const controller = new AbortController();
        let controllers = mediaUploadAbortRef.current.get(tempId);
        if (!controllers) {
          controllers = new Map();
          mediaUploadAbortRef.current.set(tempId, controllers);
        }
        controllers.set(index, controller);
        try {
          dispatch(updateLocalMediaUpload({
            matchId,
            messageId: tempId,
            itemIndex: index,
            progress: 0,
            status: 'uploading',
          }));
          let uploadItem = item;
          // Drafts restored after restart can reach Send without reopening the editor.
          if (uploadItem.kind === 'image' && uploadItem.imageEdit) {
            uploadItem = await preparePhoto(uploadItem);
            job.items[index] = uploadItem;
            if (controller.signal.aborted) throw new Error('Upload cancelled');
          }
          // Progress after an export in this run starts at 20%, the share the
          // export itself was shown as, so the ring never runs backwards.
          let progressBase = 0;
          if (uploadItem.kind === 'video' && ChatMedia && videoEditNeedsExport(uploadItem.edit, uploadItem.durationMs)) {
            const edit = uploadItem.edit!;
            const exportId = `${tempId}:${index}`;
            const exportProgress = ChatMedia.addListener('exportProgress', (event) => {
              if (event.id !== exportId) return;
              dispatch(updateLocalMediaUpload({
                matchId,
                messageId: tempId,
                itemIndex: index,
                progress: Math.round(event.progress * 20),
                status: 'uploading',
              }));
            });
            const cancelExport = () => ChatMedia?.cancelExport(exportId);
            controller.signal.addEventListener('abort', cancelExport);
            try {
              const trimsEnd = uploadItem.durationMs == null || edit.endMs < uploadItem.durationMs - 50;
              const exported = await ChatMedia.exportVideo({
                id: exportId,
                uri: uploadItem.currentUri,
                startMs: edit.startMs,
                endMs: trimsEnd ? edit.endMs : null,
                removeAudio: edit.muted,
              });
              uploadItem = {
                ...uploadItem,
                currentUri: exported.uri,
                size: exported.size,
                durationMs: exported.durationMs || Math.max(0, edit.endMs - edit.startMs),
                edit: { ...edit, applied: true },
              };
              job.items[index] = uploadItem;
              progressBase = 20;
              void savePersistentMediaJob({
                tempId,
                matchId,
                items: job.items,
                mediaKeys: job.mediaKeys,
                content: job.content,
                replyToId: job.replyToId,
                messageType: job.messageType ?? 'media',
                messageMetadata: job.messageMetadata,
                resumable: job.resumable,
                queuedAt: job.queuedAt,
              });
            } finally {
              exportProgress.remove();
              controller.signal.removeEventListener('abort', cancelExport);
            }
          }
          const uploaded = await uploadChatAttachment(matchId, uploadItem, (progress, stage) => {
            const now = Date.now();
            if (progress < 100 && now - lastUpdate < 100) return;
            lastUpdate = now;
            const shown = stage === 'uploading' ? progressBase + Math.round(progress * (100 - progressBase) / 100) : progress;
            notice?.update(index, shown);
            dispatch(updateLocalMediaUpload({
              matchId,
              messageId: tempId,
              itemIndex: index,
              progress: shown,
              status: stage,
            }));
          }, controller.signal, {
            coverTimeMs: uploadItem.kind === 'video' ? uploadedCoverMs(uploadItem.edit) : undefined,
            resumable: job.resumable?.[index] ?? null,
            onResumable: (ref) => {
              job.resumable = job.items.map((_, itemIndex) => (itemIndex === index ? ref : job.resumable?.[itemIndex] ?? null));
              void savePersistentMediaJob({
                tempId,
                matchId,
                items: job.items,
                mediaKeys: job.mediaKeys,
                content: job.content,
                replyToId: job.replyToId,
                messageType: job.messageType ?? 'media',
                messageMetadata: job.messageMetadata,
                resumable: job.resumable,
                queuedAt: job.queuedAt,
              });
            },
          });
          job.mediaKeys[index] = uploaded.mediaKey;
          if (job.messageType === 'voice' && uploaded.waveform) {
            job.messageMetadata = { ...job.messageMetadata, waveform: uploaded.waveform };
          }
          void savePersistentMediaJob({
            tempId,
            matchId,
            items: job.items,
            mediaKeys: job.mediaKeys,
            content: job.content,
            replyToId: job.replyToId,
            messageType: job.messageType ?? 'media',
            messageMetadata: job.messageMetadata,
            resumable: job.resumable,
            queuedAt: job.queuedAt,
          });
          dispatch(updateLocalMediaUpload({
            matchId,
            messageId: tempId,
            itemIndex: index,
            progress: 100,
            status: 'processing',
          }));
        } catch (error) {
          const cancelled = controller.signal.aborted;
          if (cancelled) cancelledItems.add(index);
          dispatch(updateLocalMediaUpload({
            matchId,
            messageId: tempId,
            itemIndex: index,
            status: cancelled ? 'cancelled' : 'failed',
            error: cancelled ? 'Upload cancelled' : getRequestErrorMessage(error),
          }));
        } finally {
          controllers?.delete(index);
        }
      }
    });

    await Promise.all(workers);
    if (job.mediaKeys.some((key) => !key)) {
      job.sending = false;
      // Cancelled by the person: nothing to report. Otherwise it needs them.
      if (job.items.every((_, index) => job.mediaKeys[index] || cancelledItems.has(index))) notice?.cancel();
      else notice?.failed();
      dispatch(updateLocalMessageStatus({ matchId, messageId: tempId, status: 'failed', error: 'One or more attachments need attention.' }));
      return;
    }

    try {
      const response = await api.post(`/chat/${matchId}/messages`, {
        content: job.content,
        mediaKeys: job.mediaKeys,
        clientMessageId: tempId,
        replyToId: job.replyToId,
        type: job.messageType,
        metadata: job.messageMetadata,
      });
      if (!response.data?.success || !response.data?.data) {
        throw new Error('The server did not send the message.');
      }
      mediaUploadJobsRef.current.delete(tempId);
      mediaUploadAbortRef.current.delete(tempId);
      notice?.done();
      void removePersistentMediaJob(tempId);
      optimisticIdsRef.current.delete(tempId);
      processedServerIdsRef.current.add(response.data.data.id);
      dispatch(replaceOptimisticMessage({ tempId, realMessage: response.data.data }));
      // Keep the uploaded bytes, filed under the key the server just gave them,
      // instead of deleting them and downloading the same picture back. Keyed
      // off the server's own mediaKeys so a miss can only ever cost a fetch.
      // A chosen cover is the very frame the server made the poster from, so
      // it is filed under the poster's key the same way.
      const serverKeys: Array<string | null> = response.data.data.mediaKeys ?? job.mediaKeys;
      const posterKeys = job.items.map((item, itemIndex) => (
        item.kind === 'video' && item.edit?.coverUri && serverKeys[itemIndex] ? videoPosterKey(serverKeys[itemIndex]!) : null
      ));
      void adoptSentMedia(
        [...serverKeys, ...posterKeys.filter(Boolean)],
        [
          ...job.items.map((item) => item.currentUri),
          ...job.items.flatMap((item, itemIndex) => (posterKeys[itemIndex] ? [item.edit!.coverUri!] : [])),
        ],
      );
    } catch (error) {
      // Refresh uploads only after an explicit expired-ticket response. A lost
      // acknowledgement must retry the same payload and client message ID.
      if (mediaTicketsExpired(error)) {
        job.mediaKeys = job.items.map(() => null);
        job.resumable = job.items.map(() => null);
      }
      // All files reached storage. Keep the bubble and mark each item so one
      // tap can retry the final message operation.
      job.mediaKeys.forEach((_, index) => dispatch(updateLocalMediaUpload({
        matchId,
        messageId: tempId,
        itemIndex: index,
        status: 'failed',
        error: getRequestErrorMessage(error),
      })));
      dispatch(updateLocalMessageStatus({ matchId, messageId: tempId, status: 'failed', error: getRequestErrorMessage(error) }));
      notice?.failed();
      void savePersistentMediaJob({
        tempId,
        matchId,
        items: job.items,
        mediaKeys: job.mediaKeys,
        content: job.content,
        replyToId: job.replyToId,
        messageType: job.messageType ?? 'media',
        messageMetadata: job.messageMetadata,
        resumable: job.resumable,
        queuedAt: job.queuedAt,
      });
    } finally {
      job.sending = false;
    }
  }, [dispatch, matchId]);

  const handleRetryMediaUpload = useCallback((messageId: string, itemIndex: number) => {
    const job = mediaUploadJobsRef.current.get(messageId);
    if (!job || job.sending) return;
    void runMediaUploadJob(messageId, itemIndex);
  }, [runMediaUploadJob]);

  const handleCancelMediaUpload = useCallback((messageId: string, itemIndex: number) => {
    const job = mediaUploadJobsRef.current.get(messageId);
    if (!job || job.mediaKeys[itemIndex]) return;
    mediaUploadAbortRef.current.get(messageId)?.get(itemIndex)?.abort();
    job.mediaKeys[itemIndex] = null;
    const resumableRef = job.resumable?.[itemIndex];
    if (resumableRef) {
      void discardResumable(matchId, resumableRef);
      job.resumable = job.resumable?.map((ref, refIndex) => (refIndex === itemIndex ? null : ref));
    }
    dispatch(updateLocalMediaUpload({
      matchId,
      messageId,
      itemIndex,
      status: 'cancelled',
      error: 'Upload cancelled',
    }));
    void savePersistentMediaJob({
      tempId: messageId,
      matchId,
      items: job.items,
      mediaKeys: job.mediaKeys,
      content: job.content,
      replyToId: job.replyToId,
      messageType: job.messageType ?? 'media',
      messageMetadata: job.messageMetadata,
      resumable: job.resumable,
      queuedAt: job.queuedAt,
    });
  }, [currentUserId, dispatch, matchId]);

  // Adding the reply's context messages one by one used to leave a hole in the
  // middle of history that paging could never fill.
  const handleOpenReply = useCallback((messageId: string) => {
    void jumpToMessage(messageId);
  }, [jumpToMessage]);

  const handleRetryMessage = useCallback(async (messageId: string) => {
    if (messageRetriesRef.current.has(messageId)) return;
    messageRetriesRef.current.add(messageId);
    try {
      if (mediaUploadJobsRef.current.has(messageId)) {
        await runMediaUploadJob(messageId);
        return;
      }
      const queuedMessage = (await getOfflineQueue()).find(item => item.tempId === messageId && item.matchId === matchId);
      if (!queuedMessage) {
        Alert.alert('Cannot retry message', 'The local send data is unavailable. Select the attachment or write the message again.');
        return;
      }
      optimisticIdsRef.current.set(messageId, {
        tempId: messageId,
        sentAt: queuedMessage.queuedAt,
        sequenceNum: queuedMessage.sequenceNum ?? 0,
        content: queuedMessage.content,
      });
      await retryQueuedMessage(messageId);
      dispatch(updateLocalMessageStatus({ matchId, messageId, status: 'queued' }));
      const socket = getSocket();
      if (!socket?.connected) return;
      await triggerQueueRetry(socket, matchId, (queued, serverMessage) => {
        processedServerIdsRef.current.add(serverMessage.id);
        optimisticIdsRef.current.delete(queued.tempId);
        dispatch(replaceOptimisticMessage({ tempId: queued.tempId, realMessage: serverMessage }));
      }, (queued, status, error) => dispatch(updateLocalMessageStatus({ matchId, messageId: queued.tempId, status, error })));
      requestQueueRetryRef.current();
    } catch (error) {
      dispatch(updateLocalMessageStatus({ matchId, messageId, status: 'failed', error: getRequestErrorMessage(error) }));
    } finally {
      messageRetriesRef.current.delete(messageId);
    }
  }, [dispatch, matchId, runMediaUploadJob]);

  useEffect(() => {
    if (!screenReady) return;
    let active = true;
    void getPersistentMediaJobs().then((storedJobs) => {
      if (!active) return;
      const jobs = storedJobs
        .filter((job) => job.matchId === matchId)
        .sort((first, second) => first.queuedAt - second.queuedAt);
      for (const stored of jobs) {
        const job: MediaUploadJob = {
          items: stored.items,
          mediaKeys: stored.mediaKeys,
          content: stored.content,
          replyToId: stored.replyToId,
          messageType: stored.messageType,
          messageMetadata: stored.messageMetadata,
          queuedAt: stored.queuedAt,
          resumable: stored.resumable,
          sending: false,
        };
        mediaUploadJobsRef.current.set(stored.tempId, job);
        if (!messageIdsRef.current.has(stored.tempId)) {
          dispatch(addMessage({
            id: stored.tempId,
            clientMessageId: stored.tempId,
            content: stored.content,
            mediaKeys: stored.items.map((item) => `${item.kind === 'video' ? 'local-video-' : item.kind === 'file' ? 'local-file-' : item.kind === 'voice' ? 'local-voice-' : 'local-'}${item.currentUri}`),
            senderId: currentUserId ?? '',
            sentAt: new Date(stored.queuedAt).toISOString(),
            deliveredAt: null,
            readAt: null,
            matchId,
            type: stored.messageType,
            replyToId: stored.replyToId,
            metadata: {
              ...(stored.messageMetadata ?? {}),
              localMediaUpload: {
                items: stored.items.map((item, index) => ({
                  progress: stored.mediaKeys[index] ? 100 : 0,
                  status: stored.mediaKeys[index] ? 'processing' : 'queued',
                  fileName: item.fileName,
                  size: item.size,
                  mimeType: item.mimeType,
                  posterUri: item.edit?.coverUri ?? undefined,
                })),
              },
            },
            localStatus: 'queued',
          }));
        }
        optimisticIdsRef.current.set(stored.tempId, {
          tempId: stored.tempId,
          sentAt: stored.queuedAt,
          sequenceNum: ++messageSequenceRef.current,
          content: stored.content,
        });
        void runMediaUploadJob(stored.tempId);
      }
    });
    return () => { active = false; };
  }, [currentUserId, dispatch, matchId, runMediaUploadJob, screenReady]);

  // Show media immediately. Upload work continues without locking the composer.
  const handleSend = useCallback(async (preparedMedia?: SelectedChatMedia[]) => {
    let selectedMedia = Array.isArray(preparedMedia) ? preparedMedia : selectedImages;
    if (consumedMediaRef.current === selectedMedia) selectedMedia = [];
    const draftText = composerDraft.getSnapshot().trim();
    if (!draftText && selectedMedia.length === 0) return;
    // "Are you sure?" (as Tinder asks): something hurtful gets one chance to be
    // rethought. Edit keeps the text in the box; nothing is ever blocked.
    if (draftText && looksHurtful(draftText)) {
      const sendAnyway = await new Promise<boolean>((resolve) => Alert.alert(
        'Are you sure?',
        'This might come across as hurtful. Messages like this can get an account warned or banned.',
        [{ text: 'Edit', style: 'cancel', onPress: () => resolve(false) }, { text: 'Send anyway', onPress: () => resolve(true) }],
        { cancelable: true, onDismiss: () => resolve(false) },
      ));
      if (!sendAnyway) return;
    }
    if (selectedMedia.length > 0) consumedMediaRef.current = selectedMedia;
    const draftLinkPreview = composerLinkPreview?.url === firstHttpUrl(draftText) ? composerLinkPreview : null;
    // A good moment to ask for notifications: they'll want to see the reply (NOTIFICATIONS_PLAN.md 12).
    setTimeout(() => void askAtMoment({ kind: 'reply', name: userName.split(' ')[0] }), 1200);
    const draftMedia = selectedMedia.map((item) => ({ ...item }));
    const replyToId = replyingTo?.id;
    const socket = getSocket();
    if (socket && isTypingRef.current) {
      socket.emit('typing_stop', { matchId });
      isTypingRef.current = false;
    }

    setText('');
    setSelectedImages([]);
    setReplyingTo(null);
    setComposerLinkPreview(null);
    setDismissedLinkUrl(null);
    setIsWorkspaceOpen(false);
    void clearChatDraft(matchId);
    // Sending is a deliberate move to the present: show it, wherever the list
    // was. Arrivals from the other side only follow the list down when it is
    // already near the bottom, which is the list's own rule.
    if (detachedRef.current) returnToLatest();
    setNewestRequest((request) => request + 1);

    if (draftMedia.length > 0) {
      const chunks: SelectedChatMedia[][] = [];
      for (const item of draftMedia) {
        // Documents are independent messages. Photo and video selections keep
        // their album order and use Telegram's ten-item album limit.
        if (item.kind === 'file') {
          chunks.push([item]);
          continue;
        }
        const current = chunks[chunks.length - 1];
        if (current && current[0]?.kind !== 'file' && current.length < MAX_CHAT_ALBUM_ITEMS) current.push(item);
        else chunks.push([item]);
      }

      const tempIds: string[] = [];
      const baseTime = Date.now();
      chunks.forEach((items, chunkIndex) => {
        const isDocument = items.length === 1 && items[0].kind === 'file';
        const documentItem = isDocument ? items[0] : undefined;
        let documentSize = documentItem?.size ?? 0;
        if (documentItem && !documentSize) {
          try { documentSize = new FileSystemFile(documentItem.currentUri).size ?? 0; } catch { documentSize = 0; }
        }
        const documentMetadata = documentItem ? {
          document: {
            fileName: documentItem.fileName?.trim() || 'Document',
            mimeType: documentItem.mimeType?.trim() || 'application/octet-stream',
            size: Math.max(0, Math.round(documentSize)),
          },
        } : undefined;
        const messageMetadata = documentMetadata ?? mediaInfoFor(items);
        const tempId = `temp-${baseTime}-media-${chunkIndex}-${Math.random().toString(36).slice(2, 7)}`;
        const captions = items.map((item) => item.caption?.trim()).filter(Boolean) as string[];
        const content = [chunkIndex === 0 ? draftText : '', ...captions].filter(Boolean).join('\n');
        const sequenceNum = ++messageSequenceRef.current;
        const optimisticMsg: Message = {
          id: tempId,
          clientMessageId: tempId,
          content,
          mediaKeys: items.map((item) => `${item.kind === 'video' ? 'local-video-' : item.kind === 'file' ? 'local-file-' : 'local-'}${item.currentUri}`),
          senderId: currentUserId!,
          sentAt: new Date(baseTime + chunkIndex).toISOString(),
          readAt: null,
          matchId,
          type: isDocument ? 'document' : 'media',
          replyToId: chunkIndex === 0 ? replyToId : undefined,
          localStatus: 'queued',
          metadata: {
            ...messageMetadata,
            localMediaUpload: {
              items: items.map((item) => ({ progress: 0, status: 'queued', fileName: item.fileName, size: item.size, mimeType: item.mimeType, posterUri: item.edit?.coverUri ?? undefined })),
            },
          },
        };
        mediaUploadJobsRef.current.set(tempId, {
          items,
          mediaKeys: items.map(() => null),
          content,
          replyToId: chunkIndex === 0 ? replyToId : undefined,
          messageType: isDocument ? 'document' : 'media',
          messageMetadata,
          sending: false,
          queuedAt: baseTime + chunkIndex,
        });
        void savePersistentMediaJob({
          tempId,
          matchId,
          items,
          mediaKeys: items.map(() => null),
          content,
          replyToId: chunkIndex === 0 ? replyToId : undefined,
          messageType: isDocument ? 'document' : 'media',
          messageMetadata,
          queuedAt: baseTime + chunkIndex,
        });
        optimisticIdsRef.current.set(tempId, {
          tempId,
          sentAt: baseTime + chunkIndex,
          sequenceNum,
          content,
        });
        dispatch(addMessage(optimisticMsg));
        tempIds.push(tempId);
      });

      // Process two albums at a time. Each album uploads at most three files
      // concurrently. This prevents a 100-item selection from opening 100
      // network streams at once.
      void (async () => {
        let next = 0;
        const workers = Array.from({ length: Math.min(2, tempIds.length) }, async () => {
          while (next < tempIds.length) {
            const tempId = tempIds[next++];
            await runMediaUploadJob(tempId);
          }
        });
        await Promise.all(workers);
      })();
      return;
    }

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimisticMsg: Message = {
      id: tempId,
      clientMessageId: tempId,
      content: draftText,
      senderId: currentUserId!,
      sentAt: new Date().toISOString(),
      readAt: null,
      matchId,
      replyToId,
      metadata: draftLinkPreview ? { linkPreview: draftLinkPreview } : undefined,
      localStatus: 'queued',
    };
    const sequenceNum = ++messageSequenceRef.current;
    optimisticIdsRef.current.set(tempId, {
      tempId,
      sentAt: Date.now(),
      sequenceNum,
      content: draftText,
    });
    sendMotion.register(tempId);
    dispatch(addMessage(optimisticMsg));
    await addToOfflineQueue({
      tempId,
      matchId,
      content: draftText,
      mediaKeys: [],
      queuedAt: Date.now(),
      status: 'pending',
      sequenceNum,
      replyToId,
      metadata: draftLinkPreview ? { linkPreview: draftLinkPreview } : undefined,
    });

    try {
      dispatch(updateLocalMessageStatus({ matchId, messageId: tempId, status: 'sending' }));
      await updateQueuedMessage(tempId, { status: 'sending' });
      const response = await api.post(`/chat/${matchId}/messages`, {
        content: draftText,
        clientMessageId: tempId,
        replyToId,
        metadata: draftLinkPreview ? { linkPreview: draftLinkPreview } : undefined,
      });
      if (!response.data?.success || !response.data?.data) throw new Error('The server did not send the message.');
      optimisticIdsRef.current.delete(tempId);
      processedServerIdsRef.current.add(response.data.data.id);
      dispatch(replaceOptimisticMessage({ tempId, realMessage: response.data.data }));
      await removeFromQueue(tempId);
      noteSent();
    } catch (error) {
      optimisticIdsRef.current.delete(tempId);
      openVerifyRules(navigation, error);
      const statusCode = (error as { response?: { status?: number } })?.response?.status;
      const permanent = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429;
      dispatch(updateLocalMessageStatus({
        matchId,
        messageId: tempId,
        status: permanent ? 'failed' : 'queued',
        error: getRequestErrorMessage(error),
      }));
      await updateQueuedMessage(tempId, { status: permanent ? 'failed' : 'pending', error: getRequestErrorMessage(error) });
      if (!permanent) requestQueueRetryRef.current();
    }
  }, [composerDraft, composerLinkPreview, currentUserId, dispatch, matchId, navigation, noteSent, replyingTo, runMediaUploadJob, selectedImages, sendMotion, setText]);

  // --- New match: the intro, their Story ring, and a tap on their photo ---
  const { intro, refresh: refreshIntro } = useMatchIntro(matchId);
  const [photoChoiceOpen, setPhotoChoiceOpen] = useState(false);
  // "Say hi" sends at once: the text goes into the composer, then out.
  const [quickSend, setQuickSend] = useState<string | null>(null);
  useEffect(() => {
    if (quickSend === null || text !== quickSend) return;
    setQuickSend(null);
    void handleSend();
  }, [quickSend, text, handleSend]);
  const sayHi = useCallback(() => {
    setText('Hey 👋');
    setQuickSend('Hey 👋');
  }, []);
  // An opener goes into the composer to edit, not straight out.
  const applyOpener = useCallback((opener: string) => {
    setText(opener);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  /** Their Stories over the chat; back here, the ring re-reads (grey once watched). */
  const watchTheirStory = useCallback(async () => {
    try {
      const response = await api.get(`/stories/owners/${userId}`);
      navigation.navigate('StoryViewer', { groups: [response.data.data.group], startGroupIndex: 0 });
    } catch {
      // Ended a moment ago: the ring goes.
      refreshIntro();
    }
  }, [navigation, refreshIntro, userId]);
  const focusRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopFocusRetries = useCallback(() => {
    focusGeneration.current += 1;
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    if (focusRetryRef.current) {
      clearTimeout(focusRetryRef.current);
      focusRetryRef.current = null;
    }
  }, []);

  /**
   * Brings the keyboard up on the composer, and keeps asking until it is.
   *
   * Two separate ways a single focus() call gets dropped:
   *
   * - focus() on an already-focused input is a no-op, and Android will not
   *   re-show a keyboard for an input that never lost focus - which is the
   *   state the emoji picker leaves behind. Dropping focus first makes the
   *   refocus a real transition. Invisible either way, since the keyboard is
   *   down.
   * - while another window holds focus (the context menu fading out), the
   *   input takes focus but showSoftInput is refused outright.
   *
   * Neither reports failure, so each attempt is checked against the keyboard's
   * real state and repeated until it takes or the window expires.
   */
  const focusComposer = useCallback(() => {
    stopFocusRetries();
    inputModeRef.current = 'keyboard';
    const generation = focusGeneration.current;
    const deadline = Date.now() + FOCUS_RETRY_WINDOW_MS;

    const attempt = () => {
      if (generation !== focusGeneration.current || inputModeRef.current !== 'keyboard') return;
      const input = inputRef.current;
      if (!input) return;

      if (input.isFocused() && KeyboardController.isVisible()) {
        // Visibility can still describe the keyboard that is closing, so a hold
        // that is about to be ended by an incoming transition is left alone.
        if (pickerHeld.value) {
          focusRetryRef.current = setTimeout(() => {
            focusRetryRef.current = null;
            if (generation !== focusGeneration.current || inputModeRef.current !== 'keyboard') return;
            if (!pickerHeld.value) return;
            if (Date.now() < deadline) { attempt(); return; }
            // Nothing came. The keyboard was already up, so no transition was
            // ever going to fire, and onEnd is the only thing that releases the
            // hold - which left the picker wedged at panel height behind a
            // keyboard that never moved. That is the strip of emoji that kept
            // appearing under it. End the handoff here instead.
            finishPickerHandoff(KeyboardController.state()?.height ?? savedKeyboardHeight.value);
          }, FOCUS_RETRY_INTERVAL_MS);
        }
        return;
      }

      if (input.isFocused()) {
        input.blur();
        focusFrameRef.current = requestAnimationFrame(() => {
          focusFrameRef.current = null;
          if (generation === focusGeneration.current && inputModeRef.current === 'keyboard') inputRef.current?.focus();
        });
      } else {
        input.focus();
      }

      focusRetryRef.current = setTimeout(() => {
        focusRetryRef.current = null;
        if (generation !== focusGeneration.current || inputModeRef.current !== 'keyboard' || KeyboardController.isVisible() || Date.now() >= deadline) return;
        attempt();
      }, FOCUS_RETRY_INTERVAL_MS);
    };

    attempt();
  }, [stopFocusRetries, finishPickerHandoff, savedKeyboardHeight]);

  useEffect(() => stopFocusRetries, [stopFocusRetries]);

  const cancelEdit = useCallback(() => {
    if (editRequest.current) return;
    setEditTarget(null); setEditText(''); setEditError(null);
  }, []);

  useEffect(() => {
    if (!editTarget || showEmoji) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      cancelEdit();
      return true;
    });
    return () => subscription.remove();
  }, [cancelEdit, editTarget, showEmoji]);

  useFocusEffect(useCallback(() => {
    if (selectedMessageIds.size === 0) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedMessageIds(new Set());
      return true;
    });
    return () => subscription.remove();
  }, [selectedMessageIds.size]));

  const handleEdit = useCallback((message: Message) => {
    if (editRequest.current) return;
    if (voiceComposerBusy.current) {
      Alert.alert('Voice message in progress', 'Finish or discard the voice message before editing.');
      return;
    }
    if (!canEditMessage(message, currentUserId)) {
      Alert.alert('Cannot edit message', 'You can edit your messages for 15 minutes after sending.');
      return;
    }
    setEditTarget(message); setEditText(message.content); setEditError(null);
    stopFocusRetries();
    const generation = focusGeneration.current;
    focusRetryRef.current = setTimeout(() => {
      focusRetryRef.current = null;
      if (generation === focusGeneration.current) focusComposer();
    }, CONTEXT_MENU_DISMISS_MS);
  }, [currentUserId, focusComposer, stopFocusRetries]);

  const saveEdit = useCallback(async () => {
    if (!editTarget || editRequest.current || !canSaveMessageEdit(editTarget.content, editText)) return;
    if (!canEditMessage(editTarget, currentUserId)) {
      setEditError('The 15-minute edit limit has expired.');
      return;
    }
    editRequest.current = true; setSavingEdit(true); setEditError(null);
    const generation = editGeneration.current;
    try {
      const response = await api.patch(`/chat/${editTarget.matchId}/messages/${editTarget.id}`, {
        content: editText.trim(), expectedRevision: editTarget.revision ?? 1,
      });
      const value = response.data.data;
      dispatch(applyMessageEdit({ matchId: editTarget.matchId, messageId: editTarget.id,
        content: value.content, revision: value.revision, editedAt: value.editedAt }));
      if (generation === editGeneration.current) { setEditTarget(null); setEditText(''); }
    } catch (error) {
      if (generation === editGeneration.current) setEditError(apiErrorMessage(error, 'Could not save the edit. Try again.'));
    } finally {
      if (generation === editGeneration.current) { editRequest.current = false; setSavingEdit(false); }
    }
  }, [currentUserId, dispatch, editTarget, editText]);

  const handleReply = useCallback((replyTarget: Message) => {
    if (editRequest.current) return;
    setEditTarget(null); setEditError(null);
    setReplyingTo(replyTarget);
    // Replying is an invitation to type, so bring the keyboard with it rather
    // than making it a second tap.
    //
    // Deferred because Reply is tapped inside the context menu's Modal. That
    // Modal still owns the window focus while it fades out, so focusing the
    // composer in the same tick is swallowed and the keyboard never appears -
    // which is exactly what showing the quote box but no keyboard looked like.
    stopFocusRetries();
    const generation = focusGeneration.current;
    focusRetryRef.current = setTimeout(() => {
      focusRetryRef.current = null;
      if (generation === focusGeneration.current) focusComposer();
    }, CONTEXT_MENU_DISMISS_MS);
  }, [focusComposer, stopFocusRetries]);

  const toggleMessageSelection = useCallback((messageId: string) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const copySelectedMessages = useCallback(async () => {
    const value = messages
      .filter((message) => selectedMessageIds.has(message.id) && message.content)
      .sort((first, second) => new Date(first.sentAt).getTime() - new Date(second.sentAt).getTime())
      .map((message) => message.content)
      .join('\n\n');
    if (!value) return;
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(value);
    setSelectedMessageIds(new Set());
  }, [messages, selectedMessageIds]);

  const deleteSelectedMessages = useCallback(() => {
    const ids = [...selectedMessageIds];
    Alert.alert('Delete messages?', `${ids.length} message${ids.length === 1 ? '' : 's'} will be removed from your chat.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void (async () => {
        await Promise.all(ids.filter((id) => !id.startsWith('temp-')).map((id) => api.delete(`/chat/${matchId}/messages/${id}`, { data: { mode: 'me' } })));
        void deleteNativeChatMessages(currentUserId ?? '', matchId, ids);
        ids.forEach((id) => dispatch(removeMessage({ matchId, messageId: id })));
        setSelectedMessageIds(new Set());
      })() },
    ]);
  }, [currentUserId, dispatch, matchId, selectedMessageIds]);

  const starSelectedMessages = useCallback(async () => {
    const ids = [...selectedMessageIds].filter((id) => !id.startsWith('temp-'));
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => api.put(`/chat/${matchId}/messages/${id}/marks`, { kind: 'star', active: true })));
      void marksQueryClient.invalidateQueries({ queryKey: chatMarksKey(currentUserId, matchId, 'star') });
      ids.forEach(id => { void marksQueryClient.invalidateQueries({ queryKey: ['message-marks', currentUserId, matchId, id] }); });
      setSelectedMessageIds(new Set());
    } catch {
      Alert.alert('Star failed', 'Some messages could not be starred. Try again.');
    }
  }, [matchId, selectedMessageIds, currentUserId, marksQueryClient]);

  const handleToggleEmoji = () => {
    if (inputModeRef.current === 'emoji') {
      // Swap to the keyboard in place: focus, and let onMove hold the offset
      // while the keyboard rises. Collapsing the panel here and focusing 100ms
      // later is what made the composer drop before the keyboard appeared.
      focusComposer();
    } else {
      // Any focus retry still in flight would fight the picker for the slot.
      stopFocusRetries();
      // Asked for before the deferred build ran; it is needed now.
      setEmojiMounted(true);
      inputModeRef.current = 'emoji';
      pickerHeld.value = true;
      setShowEmoji(true);
      // Size the panel from the measured keyboard height the worklet holds on
      // to, not the React state copy. Any difference between the two shows up
      // as a jump the moment the swap hands control back to the keyboard.
      const panelHeight = savedKeyboardHeight.value || keyboardHeight;
      if (KeyboardController.isVisible() || showEmoji) {
        emojiHeight.value = panelHeight; // Seize height instant
      } else {
        emojiHeight.value = withTiming(panelHeight, { duration: 150 }); // smooth expand
      }
      inputRef.current?.blur();
      Keyboard.dismiss();
    }
  };

  const handleInputFocus = () => {
    // A native focus event may arrive after a newer picker request.
    // Only a user touch or focusComposer may change that request.
    if (inputModeRef.current !== 'keyboard') {
      inputRef.current?.blur();
      Keyboard.dismiss();
      return;
    }
    // Deliberately does not close the picker. Focus fires before the keyboard
    // has moved, so hiding it here collapsed the panel a beat early - the same
    // flicker the switcher button had. onMove retires the picker once the
    // keyboard has actually risen to cover it, for both entry points.
  };

  const handleSendVoiceNote = async (uri: string, durationSec = 0) => {
    const tempId = `temp-voice-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const queuedAt = Date.now();
    const isM4a = uri.split('?')[0].toLowerCase().endsWith('.m4a');
    const item: SelectedChatMedia = {
      id: tempId,
      originalUri: uri,
      currentUri: uri,
      kind: 'voice',
      fileName: `Voice message.${isM4a ? 'm4a' : 'wav'}`,
      mimeType: isM4a ? 'audio/mp4' : 'audio/wav',
      durationMs: durationSec * 1000,
    };
    const metadata = { durationSeconds: durationSec };
    const optimisticMsg: Message = {
      id: tempId,
      clientMessageId: tempId,
      content: durationSec ? durationSec.toString() : '',
      mediaKeys: [`local-voice-${uri}`],
      senderId: currentUserId || '',
      sentAt: new Date(queuedAt).toISOString(),
      readAt: null,
      matchId,
      type: 'voice',
      localStatus: 'queued',
      metadata: {
        ...metadata,
        localMediaUpload: { items: [{ progress: 0, status: 'queued', fileName: item.fileName, mimeType: item.mimeType }] },
      },
    };
    if (detachedRef.current) returnToLatest();
    setNewestRequest(request => request + 1);
    sendMotion.register(tempId);
    dispatch(addMessage(optimisticMsg));
    optimisticIdsRef.current.set(tempId, {
      tempId,
      sentAt: queuedAt,
      sequenceNum: ++messageSequenceRef.current,
      content: optimisticMsg.content,
    });
    const job: MediaUploadJob = {
      items: [item],
      mediaKeys: [null],
      content: optimisticMsg.content,
      messageType: 'voice',
      messageMetadata: metadata,
      sending: false,
      queuedAt,
    };
    mediaUploadJobsRef.current.set(tempId, job);
    await savePersistentMediaJob({
      tempId,
      matchId,
      items: job.items,
      mediaKeys: job.mediaKeys,
      content: job.content,
      messageType: 'voice',
      messageMetadata: metadata,
      queuedAt,
    });
    void runMediaUploadJob(tempId).then(() => {
      if (!mediaUploadJobsRef.current.has(tempId)) void discardDraftMedia(uri);
    });
  };

  const openAttachmentPicker = useCallback(() => {
    if (attachmentRequestRef.current) return;
    const requestId = createAttachmentPickerRequest(selectedImages, items => {
      attachmentRequestRef.current = null;
      const selection = items ?? selectedImages;
      if (selection.length) {
        setSelectedImages(selection);
        setIsWorkspaceOpen(true);
      }
    });
    attachmentRequestRef.current = requestId;
    try { navigation.navigate('ChatAttachments', { requestId }); }
    catch {
      cancelAttachmentPickerRequest(requestId);
      attachmentRequestRef.current = null;
      Alert.alert('Cannot open attachments', 'Try opening the attachment picker again.');
    }
  }, [navigation, selectedImages]);
  useEffect(() => () => {
    if (attachmentRequestRef.current) cancelAttachmentPickerRequest(attachmentRequestRef.current);
    attachmentRequestRef.current = null;
  }, [matchId]);

  const handleOpenAttachments = useCallback(() => {
    if (allowance.limited) {
      navigation.navigate('VerifyRules', { reason: 'media' });
      return;
    }
    stopFocusRetries();
    closeEmojiPanel();
    inputRef.current?.blur();
    Keyboard.dismiss();
    openAttachmentPicker();
  }, [allowance.limited, closeEmojiPanel, navigation, openAttachmentPicker, stopFocusRetries]);

  const handleCropPress = (uri: string, index: number) => {
    setPhotoToCrop(uri);
    setCropIndex(index);
    setCropModalVisible(true);
  };

  const handleCropSave = (croppedUri: string) => {
    setSelectedImages(prev => {
      if (!prev[cropIndex]) return prev;
      const newImages = [...prev];
      newImages[cropIndex] = {
        ...newImages[cropIndex],
        currentUri: croppedUri,
        imageEdit: undefined,
        mimeType: 'image/png',
        size: undefined,
      };
      return newImages;
    });
    setCropModalVisible(false);
    setPhotoToCrop(null);
  };

  // Left the app mid-word: stopped typing, now - not when the other phone's
  // timeout runs out.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' || !isTypingRef.current) return;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      getSocket()?.emit('typing_stop', { matchId });
      isTypingRef.current = false;
    });
    return () => subscription.remove();
  }, [matchId]);

  // Handle typing indicator
  const handleTextChange = useCallback((value: string) => {
    setText(value);
    const socket = getSocket();
    if (!socket) return;

    // Cleared the box: stopped typing, now.
    if (!value.length) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) socket.emit('typing_stop', { matchId });
      isTypingRef.current = false;
      return;
    }
    // Said again every few seconds while typing goes on (typingPresence).
    const now = Date.now();
    if (shouldSendTyping(isTypingRef.current, lastTypingSentRef.current, now)) {
      socket.emit('typing_start', { matchId, activity: 'typing' });
      isTypingRef.current = true;
      lastTypingSentRef.current = now;
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        socket.emit('typing_stop', { matchId });
        isTypingRef.current = false;
      }
    }, TYPING_IDLE_MS);
  }, [matchId]);

  // Load older messages
  const handleLoadMore = loadOlder;
  const handleLoadNewer = useCallback(() => { void loadNewer(); }, [loadNewer]);

  const animatedSubContentStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: -emojiHeight.value }],
    };
  });

  const animatedComposerInsetStyle = useAnimatedStyle(() => {
    // Keep layout and list padding stable. Remove the navigation inset through
    // a UI-thread translation in the same frames as the keyboard movement.
    const progress = Math.min(1, Math.max(0, emojiHeight.value / Math.max(1, savedKeyboardHeight.value)));
    return {
      transform: [{ translateY: (Math.max(insets.bottom, 6) - 4) * progress }],
    };
  });
  const animatedIntroViewportStyle = useAnimatedStyle(() => (
    matchIntroViewportInsets(0, emojiHeight.value, savedKeyboardHeight.value, insets.bottom)
  ));

  // Panels are built the first time they are asked for, then kept.
  const workspaceMounted = useOnceVisible(isWorkspaceOpen);
  const muteMounted = useOnceVisible(muteSheetOpen);
  const autoDeleteMounted = useOnceVisible(autoDeleteOpen);
  const confirmMounted = useOnceVisible(pendingConfirm !== null);
  const markedMounted = useOnceVisible(markedOpen);
  const leavingChat = useRef(false);
  const leaveChat = useCallback(() => {
    if (leavingChat.current) return;
    leavingChat.current = true;
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main');
  }, [navigation]);
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPressIn={leaveChat}
          onPress={leaveChat}
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.65 }]}
        >
          <Ionicons name="arrow-back" size={25} color={colors.text.primary} />
        </Pressable>
        <TouchableOpacity
          style={styles.headerProfileTarget}
          activeOpacity={0.72}
          onPress={() => navigation.navigate('ChatProfile', { matchId, userId, userName, userAvatar })}
          accessibilityRole="button"
          accessibilityLabel={`Open ${userName} chat info`}
        >
          <Pressable
            onPress={() => setPhotoChoiceOpen(true)}
            hitSlop={4}
            accessibilityRole="imagebutton"
            accessibilityLabel={intro?.story ? `${userName}: watch their story or see their photo` : `See ${userName}'s photo`}
          >
            {intro?.story ? (
              <View style={styles.headerAvatarRing}>
                <PersonAvatar person={{ name: userName, avatarUrl: userAvatar || DEFAULT_AVATAR, story: intro.story }} size={32} background={colors.background} />
              </View>
            ) : (
              <Image source={{ uri: userAvatar || DEFAULT_AVATAR }} style={styles.headerAvatar} />
            )}
            {ttlSeconds ? (
              <View style={styles.headerTimerBadge} accessibilityLabel={`Messages auto-delete after ${formatDuration(ttlSeconds)}`}>
                <Ionicons name="timer-outline" size={11} color="#fff" />
              </View>
            ) : null}
          </Pressable>
          <View style={styles.headerInfo}>
            <View style={styles.headerNameRow}>
              <Text style={[styles.headerName, styles.headerNameInRow]} numberOfLines={1}>{userName}</Text>
              {isMuted(mutedUntil) ? <Ionicons name="volume-mute" size={14} color={colors.text.tertiary} style={styles.headerMutedIcon} /> : null}
            </View>
            {typingSenderId ? (
              <Text style={styles.headerStatus}>{peerActivity === 'recording' ? 'recording audio…' : 'typing…'}</Text>
            ) : connectionStatus === 'reconnecting' ? (
              <Text style={styles.headerStatusOffline}>connecting…</Text>
            ) : connectionStatus === 'disconnected' ? (
              <Text style={styles.headerStatusOffline}>waiting for network…</Text>
            ) : peerPresence?.online ? (
              <Text style={styles.headerStatus}>online</Text>
            ) : (
              <Text style={styles.headerStatusOffline}>{formatLastSeen(peerPresence?.lastSeenAt ?? null)}</Text>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Search this chat"
          activeOpacity={0.65}
          style={styles.headerAction}
          onPress={() => navigation.navigate('MessageSearch', { matchId })}
        >
          <Ionicons name="search-outline" size={23} color={colors.text.primary} />
        </TouchableOpacity>
        <ChatHeaderMenu
          muted={isMuted(mutedUntil)}
          ttlSeconds={ttlSeconds}
          onMute={() => setMuteSheetOpen(true)}
          onUnmute={() => void updateMute(null)}
          onAutoDelete={() => setAutoDeleteOpen(true)}
          onMarked={openMarked}
          onClear={() => setPendingConfirm('clear')}
          onDelete={() => setPendingConfirm('delete')}
        />
        {markedMounted ? <MarkedMessagesMenu matchId={matchId} peerName={userName} initialKind={markedKind} open={markedOpen} onClose={() => setMarkedOpen(false)} onSelect={id => void jumpToMessage(id)} /> : null}
        {selectedMessageIds.size > 0 ? (
          <View style={[styles.selectionHeader, { paddingTop: insets.top }]}>
            <TouchableOpacity onPress={() => setSelectedMessageIds(new Set())} style={styles.headerAction} accessibilityLabel="Close selection"><Ionicons name="close" size={25} color="#fff" /></TouchableOpacity>
            <Text style={styles.selectionCount}>{selectedMessageIds.size}</Text>
            <TouchableOpacity onPress={() => void starSelectedMessages()} style={styles.headerAction} accessibilityLabel="Star selected messages"><Ionicons name="star-outline" size={22} color="#fff" /></TouchableOpacity>
            <TouchableOpacity onPress={() => void copySelectedMessages()} style={styles.headerAction} accessibilityLabel="Copy selected messages"><Ionicons name="copy-outline" size={22} color="#fff" /></TouchableOpacity>
            <TouchableOpacity onPress={deleteSelectedMessages} style={styles.headerAction} accessibilityLabel="Delete selected messages"><Ionicons name="trash-outline" size={22} color="#FF696F" /></TouchableOpacity>
          </View>
        ) : null}
      </View>

      {/* Messages and composer */}
      <PinnedMessageBar key={matchId} messages={pinnedMessages} onSelect={id => void jumpToMessage(id)} onOpenList={() => openMarked('pin')} />
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <AnimatedReanimated.View style={[{ flex: 1 }, animatedSubContentStyle]}>
          {/* Messages */}
          <AnimatedReanimated.View
            style={[{ flex: 1 }, animatedComposerInsetStyle]}
          >
            <MessageList
              key={matchId}
              ref={flatListRef}
              messages={messages}
              currentUserId={currentUserId}
              otherUserName={userName}
              onLoadMore={handleLoadMore}
              onLoadNewer={handleLoadNewer}
              hasNewer={hasNewer}
              ready={screenReady}
              newestRequest={newestRequest}
              sendMotion={sendMotion}
              isLoading={isLoading}
              hasMore={hasMore}
              typingSenderId={typingSenderId}
              typingActivity={peerActivity}
              onScroll={handleScroll}
              onScrollBeginDrag={handleScrollBeginDrag}
              onVisibleMessages={acknowledgeVisible}
              onReply={handleReply}
              onEdit={handleEdit}
              onRetryMediaUpload={handleRetryMediaUpload}
              onCancelMediaUpload={handleCancelMediaUpload}
              onOpenReply={handleOpenReply}
              onRetryMessage={handleRetryMessage}
              highlightedMessageId={editTarget?.id ?? highlightedMessageId}
              selectedMessageIds={selectedMessageIds}
              onToggleMessageSelection={toggleMessageSelection}
              reactorAvatars={reactorAvatars}
              starredMessageIds={starredIds}
              pinnedMessageIds={pinnedIds}
            />
            {screenReady && !isLoading && messages.length === 0 && intro ? (
              <AnimatedReanimated.View style={[styles.introViewport, animatedIntroViewportStyle]}>
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.introScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  overScrollMode="never"
                >
                  <MatchIntroCard
                    intro={intro}
                    onPhoto={() => setPhotoChoiceOpen(true)}
                    onSayHi={sayHi}
                    onOpener={applyOpener}
                  />
                </ScrollView>
              </AnimatedReanimated.View>
            ) : null}
            <PhotoChoiceSheet
              visible={photoChoiceOpen}
              name={userName}
              avatar={intro?.other.avatar ?? userAvatar ?? null}
              hasStory={!!intro?.story}
              onWatchStory={() => void watchTheirStory()}
              onProfile={() => navigation.navigate('ChatProfile', { matchId, userId, userName, userAvatar })}
              onClose={() => setPhotoChoiceOpen(false)}
            />
          </AnimatedReanimated.View>

          <AnimatedReanimated.View
            style={[styles.scrollDownButtonWrapper, animatedScrollBtnStyle]}
            pointerEvents={showScrollDown || hasNewer ? 'auto' : 'none'}
          >
            <TouchableOpacity
              style={styles.scrollDownButtonInner}
              onPress={() => {
                isScrollingDownRef.current = true;
                isScrolledUpRef.current = false;
                // From a jumped-to window, bring the latest messages back first;
                // animating across the swapped list would only show a blur.
                if (detachedRef.current) returnToLatest();
                setNewestRequest((request) => request + 1);
                setUnreadCount(0);
                scrollDownVisibleRef.current = false;
                setShowScrollDown(false);
                scrollBtnScale.value = 0;
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
          <AnimatedReanimated.View
            pointerEvents="box-none"
            style={animatedComposerInsetStyle}
            onLayout={event => { composerH.value = event.nativeEvent.layout.height; }}
          >
            {/* Links, numbers or money from them: a once-per-chat scam warning (features/safety). */}
            <ChatSafetyNotice matchId={matchId} messages={messages} currentUserId={currentUserId} />
            {allowance.otherWaitingToVerify && (
              <ChatVerificationWaiting name={userName} />
            )}
            {allowance.limited && allowance.left > 0 && allowance.left <= allowance.limit - allowance.warnFrom && (
              <ChatVerificationReminder remaining={allowance.left} limit={allowance.limit} onVerify={() => navigation.navigate('VerifyCollege')} />
            )}
            {!editTarget && allowance.limited && allowance.left <= 0 ? (
              <ChatVerificationReminder remaining={0} limit={allowance.limit} onVerify={() => navigation.navigate('VerifyCollege')} />
            ) : <VoiceRecordBar
                onRecordingActivity={reportRecordingActivity}
              replyPreview={editTarget ? (
                <EditMessagePreview content={editTarget.content} error={editError} saving={savingEdit} onCancel={cancelEdit} />
              ) : replyingTo || composerLinkPreview ? (
                <View style={styles.replyPreview}>
                  <View style={styles.replyPreviewLine} pointerEvents="none" />
                  <View style={styles.replyPreviewContent}>
                    {replyingTo ? (
                      <>
                        <Text style={styles.replyLabel} numberOfLines={1}>
                          {replyingTo.senderId === currentUserId ? 'You' : userName}
                        </Text>
                        <Text style={styles.replyText} numberOfLines={1}>
                          {isReplyDocument(replyingTo) && <Ionicons name={getReplyDocumentIcon(replyingTo)} size={14} color={colors.primary} />}
                          {isReplyVoice(replyingTo) && <Ionicons name="mic" size={14} color={colors.primary} />}
                          {isReplyDocument(replyingTo) || isReplyVoice(replyingTo) ? ' ' : ''}{getReplyPreview(replyingTo)}
                        </Text>
                      </>
                    ) : composerLinkPreview ? (
                      <>
                        <Text style={styles.replyLabel} numberOfLines={1}>{composerLinkPreview.siteName ?? 'Link preview'}</Text>
                        <Text style={styles.replyText} numberOfLines={1}>{composerLinkPreview.title}</Text>
                      </>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={replyingTo ? 'Cancel reply' : 'Remove link preview'}
                    activeOpacity={0.65}
                    style={styles.replyCloseButton}
                    onPress={() => {
                      if (replyingTo) setReplyingTo(null);
                      else if (composerLinkPreview) {
                        setDismissedLinkUrl(firstHttpUrl(text));
                        setComposerLinkPreview(null);
                      }
                    }}
                  >
                    <Ionicons name="close" size={21} color="#A7A6AD" />
                  </TouchableOpacity>
                </View>
              ) : null}
              ref={inputRef}
              text={editTarget ? editText : text}
              draft={editTarget ? undefined : composerDraft}
              setText={editTarget ? (value) => { if (!editRequest.current) { setEditText(value); setEditError(null); } } : handleTextChange}
              onSend={editTarget ? saveEdit : handleSend}
              onSendOrigin={sendMotion.setOrigin}
              editMode={Boolean(editTarget)}
              canSaveEdit={Boolean(editTarget && canSaveMessageEdit(editTarget.content, editText))}
              onVoiceBusyChange={onVoiceBusyChange}
              onPickImage={handleOpenAttachments}
              onToggleEmoji={handleToggleEmoji}
              showEmoji={showEmoji}
              isSending={editTarget ? savingEdit : isSending}
              onSendVoiceNote={handleSendVoiceNote}
              onFocus={handleInputFocus}
              onInputTouch={() => { inputModeRef.current = 'keyboard'; }}
            />}
          </AnimatedReanimated.View>
        </AnimatedReanimated.View>
        {/* Absolute Sibling for Touch & Fill Bounds (Android Fix) */}
        <AnimatedReanimated.View style={[{
          position: 'absolute',
          bottom: -350, // Expanded extends below glass edge 
          left: 0, right: 0,
          height: 350,
          backgroundColor: colors.surface
        }, animatedSubContentStyle]}>
          {emojiMounted && <EmojiKeyboard
            onEmojiSelected={(emoji: any) => {
              if (editRequest.current) return;
              if (editTarget) setEditText((prev) => prev + emoji.emoji);
              else setText((prev: string) => prev + emoji.emoji);
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
          />}
        </AnimatedReanimated.View>
      </View>
      {workspaceMounted ? <MediaWorkspace
        visible={isWorkspaceOpen && !cropModalVisible}
        images={selectedImages}
        setImages={setSelectedImages}
        onAddMore={() => {
          setIsWorkspaceOpen(false);
          openAttachmentPicker();
        }}
        onClose={() => {
          setIsWorkspaceOpen(false);
          setSelectedImages([]);
        }}
        onSend={(items) => {
          setIsWorkspaceOpen(false);
          handleSend(items);
        }}
        onCropPress={(uri, index) => {
          setPhotoToCrop(uri);
          setCropIndex(index);
          setCropModalVisible(true);
        }}
      /> : null}

      {muteMounted ? <MuteSheet
        visible={muteSheetOpen}
        onClose={() => setMuteSheetOpen(false)}
        mutedUntil={mutedUntil}
        onMute={(until) => { setMuteSheetOpen(false); void updateMute(until); }}
      /> : null}
      {autoDeleteMounted ? <AutoDeleteSheet
        visible={autoDeleteOpen}
        onClose={() => setAutoDeleteOpen(false)}
        seconds={ttlSeconds}
        onChange={(seconds) => { setAutoDeleteOpen(false); void updateTtl(seconds); }}
      /> : null}
      {confirmMounted ? <ConfirmDialog
        visible={pendingConfirm !== null}
        title={pendingConfirm === 'delete' ? 'Delete chat' : 'Clear history'}
        message={pendingConfirm === 'delete'
          ? `Are you sure you want to delete the chat with ${userName}?`
          : `Are you sure you want to clear your chat history with ${userName}?`}
        confirmLabel={pendingConfirm === 'delete' ? 'Delete' : 'Clear'}
        destructive
        checkboxLabel={pendingConfirm === 'delete' ? `Also delete for ${userName}` : `Also clear for ${userName}`}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={(forEveryone) => { if (pendingConfirm) void confirmClearOrDelete(pendingConfirm, forEveryone); }}
      /> : null}

      {photoToCrop && (
        <CropModal
          visible={cropModalVisible}
          imageUri={photoToCrop}
          imageEdit={selectedImages[cropIndex]?.imageEdit}
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
  waitingLine: { alignSelf: 'center', color: '#8E8D93', fontSize: 12, marginBottom: 6, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  limitCounter: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, backgroundColor: 'rgba(58,30,32,0.92)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, marginBottom: 6 },
  limitCounterText: { color: '#FFD6D7', fontSize: 12, fontWeight: '600' },
  lockedComposer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 12, marginBottom: 12, minHeight: 50, borderRadius: 25, backgroundColor: '#E84A3B' },
  lockedComposerText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  replyPreview: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'rgba(83,105,118,0.18)',
    borderRadius: 13,
    marginTop: 4,
    marginHorizontal: 4,
    paddingLeft: 0,
    paddingRight: 4,
    paddingVertical: 0,
    overflow: 'hidden',
  },
  replyPreviewLine: {
    width: 4,
    backgroundColor: colors.primary,
    marginRight: 9,
    borderTopLeftRadius: 13,
    borderBottomLeftRadius: 13,
  },
  replyPreviewContent: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingVertical: 7,
  },
  replyLabel: { color: colors.primary, fontSize: 14, lineHeight: 18, fontWeight: '600', includeFontPadding: false },
  replyText: { color: '#D0CFD5', fontSize: 14, lineHeight: 18, includeFontPadding: false },
  replyCloseButton: { width: 40, alignItems: 'center', justifyContent: 'center' },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    // Shared with the context menu, which positions itself below the header.
    minHeight: CHAT_HEADER_HEIGHT,
    paddingHorizontal: 4,
    paddingBottom: 4,
    backgroundColor: '#171516',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  backButton: {
    width: 44,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerProfileTarget: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionHeader: {
    ...StyleSheet.absoluteFill,
    paddingBottom: 4,
    paddingHorizontal: 4,
    backgroundColor: '#171516',
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 20,
  },
  selectionCount: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', marginLeft: 6 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center' },
  headerNameInRow: { flexShrink: 1 },
  headerMutedIcon: { marginLeft: 5 },
  headerTimerBadge: {
    position: 'absolute',
    right: 6,
    bottom: -1,
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  headerAvatarRing: { marginRight: 6, marginLeft: -4 },
  introViewport: { position: 'absolute', left: 0, right: 0, overflow: 'hidden' },
  introScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 12 },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    marginRight: 10,
  },
  headerInfo: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  headerName: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.text.primary,
  },
  headerStatus: {
    fontSize: 13,
    lineHeight: 17,
    color: colors.primary,
  },
  headerStatusOffline: {
    fontSize: 13,
    lineHeight: 17,
    color: colors.text.tertiary,
  },
  headerAction: {
    width: 44,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  datePill: {
    minHeight: 24,
    justifyContent: 'center',
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(42,39,40,0.92)',
  },
  dateText: {
    fontSize: 12,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.82)',
    fontWeight: '500',
  },
  messageListSurface: {
    flex: 1,
    backgroundColor: colors.background,
  },
  messageListFrame: {
    flex: 1,
  },
  // The copy of the newest rows: transparent, so the real list shows through
  // wherever the copy has no row of its own.
  messageListPinned: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  messageListContent: {
    // Shared with the selection highlight, which bleeds past it.
    paddingHorizontal: MESSAGE_LIST_PADDING_H,
    paddingTop: 6,
    paddingBottom: 5,
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
  typingMic: { marginRight: 2 },
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
    bottom: SCROLL_BTN_BOTTOM,
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
  sendMotion: ChatSendMotion;
  messages: Message[];
  currentUserId: string | null;
  otherUserName: string;
  onLoadMore: () => void;
  onLoadNewer: () => void;
  hasNewer: boolean;
  /** True once the chat has finished opening. */
  ready: boolean;
  /** Changes when the list should return to the newest message. */
  newestRequest: number;
  isLoading: boolean;
  hasMore: boolean;
  typingSenderId: string | null;
  typingActivity?: 'typing' | 'recording';
  onScroll?: (event: any) => void;
  onScrollBeginDrag?: () => void;
  onVisibleMessages?: (ids: string[]) => void;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onRetryMediaUpload: (messageId: string, itemIndex: number) => void;
  onCancelMediaUpload: (messageId: string, itemIndex: number) => void;
  onOpenReply: (messageId: string) => void;
  onRetryMessage: (messageId: string) => void;
  highlightedMessageId: string | null;
  selectedMessageIds: Set<string>;
  onToggleMessageSelection: (messageId: string) => void;
  reactorAvatars: Record<string, string | null>;
  starredMessageIds: Set<string>;
  pinnedMessageIds: Set<string>;
}

type MessageGroupPosition = 'single' | 'top' | 'middle' | 'bottom';

/** A row of the conversation: a message, or the date above a day's messages. */
type ListEntry = ChatRow;

/**
 * A row as the list draws it: the message plus everything about its look that
 * depends on the rest of the conversation - its neighbours, the message it
 * replies to, whether it is highlighted or selected.
 *
 * FlashList re-renders a row only when its item changes. Handing it bare
 * messages meant the renderer had to look all of that up itself, so it
 * depended on the whole conversation, changed whenever any message did, and
 * made every row on screen render again for a single read receipt. Worked out
 * here, a row's object changes exactly when what it shows changes, and the
 * renderer never needs to change at all.
 */
type DisplayRow =
  | { kind: 'date'; key: string; date: string }
  | { kind: 'service'; key: string; message: Message; text: string }
  | {
      kind: 'message';
      key: string;
      message: Message;
      isMe: boolean;
      currentUserId: string;
      groupPosition: MessageGroupPosition;
      replyIsDocument: boolean;
      replyDocumentIcon?: ReturnType<typeof getReplyDocumentIcon>;
      replyIsVoice: boolean;
      replyPreview?: string;
      replyAuthor?: string;
      highlighted: boolean;
      selectionMode: boolean;
      selected: boolean;
      reactorAvatars: Record<string, string | null>;
      starred: boolean;
      pinned: boolean;
    };

function sameDisplayRow(a: DisplayRow, b: DisplayRow): boolean {
  if (a.kind !== b.kind || a.key !== b.key) return false;
  if (a.kind === 'date') return a.date === (b as typeof a).date;
  if (a.kind === 'service') return a.message === (b as typeof a).message && a.text === (b as typeof a).text;
  const other = b as typeof a;
  return a.message === other.message && a.isMe === other.isMe && a.currentUserId === other.currentUserId
    && a.groupPosition === other.groupPosition && a.replyIsDocument === other.replyIsDocument
    && a.replyDocumentIcon === other.replyDocumentIcon && a.replyIsVoice === other.replyIsVoice
    && a.replyPreview === other.replyPreview && a.replyAuthor === other.replyAuthor
    && a.highlighted === other.highlighted && a.selectionMode === other.selectionMode
    && a.selected === other.selected && a.reactorAvatars === other.reactorAvatars
    && a.starred === other.starred && a.pinned === other.pinned;
}

function displayRowKey(row: DisplayRow): string {
  return row.key;
}

function displayRowType(row: DisplayRow): string {
  if (row.kind === 'date') return 'date';
  if (row.kind === 'service') return 'service';
  return messageRowType(row.message);
}

/**
 * How many of the newest rows are kept ready for a jump back to the bottom.
 * More than a screen of ordinary messages, so the copy covers what the jump
 * shows; anything taller than that is already built in the real list above.
 */
const PINNED_NEWEST_ROWS = 12;

/** Enough rows to cover a screen before the list's first paint. */
const INITIAL_DRAW_BATCH = { initialDrawBatchSize: 16 };
const FOLLOW_LATEST_CONFIG = { autoscrollToTopThreshold: 100 };

/**
 * How much of a conversation the list is given when it opens, and how much more
 * each time you reach the top of it.
 *
 * The list lays out and measures everything it is handed before it can show the
 * first frame, and that cost is what the chat opens on: sixty rows took a
 * quarter of a second, a hundred and thirty took one and a quarter, while React
 * built the rows themselves in twenty milliseconds. Handing it the whole cached
 * history meant the longest conversations opened slowest, which is backwards.
 *
 * Telegram opens a chat on twenty to thirty messages and fetches the rest as you
 * scroll (`ChatActivity.loadMessages(dialog_id, 30, ...)`). This is the same
 * idea against a list we already hold: the newest rows are shown, the rest are
 * behind them, and reaching the top brings the next stretch in.
 */
const INITIAL_CHAT_WINDOW = 30;
/**
 * How much more of the conversation each step brings in.
 *
 * Every step is laid out and measured in one go, so a large one is a long pause
 * in the middle of a scroll - the scroll stopping dead against the top of the
 * window. Smaller steps, taken earlier, spread that cost into pieces short
 * enough to pass for a scroll that never stopped.
 */
const CHAT_WINDOW_STEP = 20;

const formatDateSeparator = (dateStr: string) => {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
};

function messageRowKey(item: ListEntry): string {
  return '_kind' in item ? `date-${new Date(item.date).toDateString()}` : (item.clientMessageId ?? item.id);
}

function messageRowType(item: ListEntry): string {
  if ('_kind' in item) return 'date';
  if (item.type === 'service') return 'service';
  if (item.type === 'voice') return 'voice';
  if (item.type === 'document') return 'document';
  if (item.storyId || item.story) return 'story';
  if (item.mediaKey || item.mediaKeys?.length) return 'media';
  return 'text';
}

function isSameMessageGroup(first?: Message, second?: Message): boolean {
  if (!first || !second || first.senderId !== second.senderId) return false;
  const firstTime = new Date(first.sentAt).getTime();
  const secondTime = new Date(second.sentAt).getTime();
  if (!Number.isFinite(firstTime) || !Number.isFinite(secondTime)) return false;
  return (
    new Date(first.sentAt).toDateString() === new Date(second.sentAt).toDateString() &&
    Math.abs(firstTime - secondTime) <= 5 * 60 * 1000
  );
}

/**
 * Reports when a view for the newest row is on screen. It mounts exactly when
 * the list gives a view the newest row - on first render, or when a recycled
 * view is handed it after a jump - and unmounts when that view moves on.
 */
function NewestRowMarker({ active, onShown, onGone, children }: {
  active: boolean;
  onShown: () => void;
  onGone: () => void;
  children: React.ReactNode;
}) {
  React.useLayoutEffect(() => {
    if (!active) return;
    onShown();
    return onGone;
  }, [active, onGone, onShown]);
  return <>{children}</>;
}

const MessageList = React.memo(
  React.forwardRef<FlashListRef<DisplayRow>, MessageListProps>(
    ({ messages, currentUserId, otherUserName, onLoadMore, onLoadNewer, hasNewer, ready, newestRequest, sendMotion, isLoading, hasMore, typingSenderId, typingActivity, onScroll, onScrollBeginDrag, onVisibleMessages, onReply, onEdit, onRetryMediaUpload, onCancelMediaUpload, onOpenReply, onRetryMessage, highlightedMessageId, selectedMessageIds, onToggleMessageSelection, reactorAvatars, starredMessageIds, pinnedMessageIds }, ref) => {
      const visibleCallback = React.useRef(onVisibleMessages);
      visibleCallback.current = onVisibleMessages;
      const handleViewableItemsChanged = React.useRef(({ viewableItems }: any) => {
        visibleCallback.current?.(visibleMessageIds(viewableItems));
      }).current;
      const viewabilityConfig = React.useRef({
        itemVisiblePercentThreshold: 70,
        minimumViewTime: 500,
      }).current;
      // Newest-first indices stay unchanged when older history is appended.
      // FlashList measures each message type and reuses its native cells.
      const renderData = React.useMemo(() => buildChatRows(messages), [messages]);

      const messageIndex = React.useMemo(
        () => new Map(messages.map((message, index) => [message.id, index])),
        [messages],
      );
      const messageById = React.useMemo(
        () => new Map(messages.map((message) => [message.id, message])),
        [messages],
      );


      // Newest first, which is the order buildChatRows already produces and the
      // order an inverted list wants.
      const allRows = renderData;
      const [windowRows, setWindowRows] = React.useState(INITIAL_CHAT_WINDOW);
      /** When the list was last sent back to the newest message. */
      const jumpedAt = React.useRef(0);
      /** Where the list is, so a trim can check it is still at the newest end. */
      const lastOffset = React.useRef(0);
      const autoScroll = React.useRef(createChatAutoScroll(newestRequest)).current;
      const newestKey = messages[0] ? messageRowKey(messages[0]) : null;
      const latestLayout = React.useRef({ key: newestKey, newestRequest, hasNewer });
      latestLayout.current = { key: newestKey, newestRequest, hasNewer };
      const followFrame = React.useRef<number | null>(null);
      const followNewestAfterLayout = React.useCallback(() => {
        const latest = latestLayout.current;
        if (!autoScroll.commit(latest.key, latest.newestRequest, latest.hasNewer)) return;
        const list = (ref as React.MutableRefObject<FlashListRef<DisplayRow> | null>)?.current;
        list?.scrollToOffset({ offset: 0, animated: false });
        // Native anchoring can run after the React commit. Correct it once in
        // the next frame, after the new row has its final measured height.
        if (followFrame.current !== null) cancelAnimationFrame(followFrame.current);
        followFrame.current = requestAnimationFrame(() => {
          followFrame.current = null;
          if (autoScroll.isFollowing() && !latestLayout.current.hasNewer) list?.scrollToOffset({ offset: 0, animated: false });
        });
      }, [autoScroll, ref]);
      React.useLayoutEffect(followNewestAfterLayout, [followNewestAfterLayout, newestKey, newestRequest, hasNewer]);
      React.useEffect(() => () => {
        if (followFrame.current !== null) cancelAnimationFrame(followFrame.current);
      }, []);
      const trackScroll = React.useCallback((event: any) => {
        lastOffset.current = event.nativeEvent?.contentOffset?.y ?? 0;
        autoScroll.scroll(lastOffset.current);
        onScroll?.(event);
      }, [autoScroll, onScroll]);
      const visibleData = React.useMemo(
        () => (allRows.length <= windowRows ? allRows : allRows.slice(0, windowRows)),
        [allRows, windowRows],
      );

      // An arriving message must not push the row at the top of the window out
      // of it. A page of history is a different matter: it belongs behind the
      // window until scrolling asks for it.
      const totalRows = React.useRef(allRows.length);
      React.useEffect(() => {
        const growth = allRows.length - totalRows.current;
        totalRows.current = allRows.length;
        if (growth > 0 && growth <= 5) setWindowRows((rows) => rows + growth);
      }, [allRows.length]);

      // Reaching the oldest end brings in the next stretch of what is already
      // loaded, and asks the server for more once little is left behind it.
      const handleOlderReached = React.useCallback(() => {
        // A fling upwards can leave this in flight as the newest button is
        // pressed. Widening the window then changes the data just as the jump
        // lands, and the list holds its old position across a data change -
        // which is the blank that sometimes followed the jump.
        if (Date.now() - jumpedAt.current < 600) return;
        const behindWindow = allRows.length - windowRows;
        if (behindWindow > 0) setWindowRows((rows) => rows + CHAT_WINDOW_STEP);
        // Ask the server while there is still a stretch of history in hand, so
        // the next pages arrive before the scroll reaches the end of them.
        if (behindWindow <= CHAT_WINDOW_STEP * 3) onLoadMore();
      }, [allRows.length, onLoadMore, windowRows]);

      /**
       * Back to the newest message, in one move and without touching the data.
       *
       * Two things made this slow. Animating the scroll walks the list through
       * everything in between, building and discarding rows the whole way, and
       * leaves nothing built where it lands. Cutting the window back at the same
       * time was worse: the list keeps the content you are looking at in place
       * across a data change unless told otherwise, so shrinking the data while
       * jumping had it working to hold the position being left behind.
       *
       * The window is left alone, so nothing has to settle after the move.
       *
       * Offset zero includes the typing indicator and the newest message.
       */
      const jumpedToNewest = React.useRef(newestRequest);
      /**
       * True while a jump to the newest message is landing.
       *
       * A jump arrives somewhere nothing is built yet, and the list builds the
       * rows on screen together with a buffer of rows past them - one pass, so
       * the rows you are looking at wait for the ones you are not. Measured, that
       * was six visible rows waiting on nine off-screen ones: ~175 ms of rows
       * before the first of them could paint. While landing there is no buffer,
       * so the first pass is only what is on screen; the buffer comes back once
       * that has painted and fills in above, out of sight.
       */
      const [landing, setLanding] = React.useState(false);
      /**
       * The newest rows, kept built for a jump back to the bottom.
       *
       * A jump lands on rows the list has not built - it recycled them while
       * you scrolled up - and in React Native the scroll arrives before they can
       * be. Measured in a production build: ~100 ms after landing before they
       * commit, six or seven frames of nothing where your newest messages go.
       * Telegram never shows this because its cells bind in the same frame; the
       * way to get the same result here is to have them built already.
       *
       * So once the chat has opened and the thread goes idle, a second copy of
       * this list, holding only the newest rows, is kept mounted and invisible
       * over the real one. It is built in idle time on purpose: built when the
       * down button first appeared, it landed in the middle of the scroll that
       * made the button appear, and a fling has no frames to spare. It is the same list with the same rows, header and
       * padding, so its bubbles sit on exactly the pixels the real list will use.
       * On a jump it shows in the same frame the scroll lands, and hides once the
       * real list has painted underneath - identical pixels, so nothing changes.
       */
      const [pinReady, setPinReady] = React.useState(false);
      React.useEffect(() => {
        if (!ready || pinReady) return;
        const idle = requestIdleCallback(() => setPinReady(true));
        return () => cancelIdleCallback(idle);
      }, [pinReady, ready]);
      /**
       * Whether the real list currently has a view showing the newest row, and
       * who to tell when it gets one. The copy of the newest rows must stay up
       * until then: it used to come down on a fixed timer, and a jump made during
       * a fling lands behind whatever the fling was still rendering - the real
       * rows arrived after the timer, and the copy came down over nothing.
       */
      const newestOnScreen = React.useRef(false);
      const onNewestShown = React.useRef<(() => void) | null>(null);
      const markNewestShown = React.useCallback(() => {
        newestOnScreen.current = true;
        onNewestShown.current?.();
      }, []);
      const markNewestGone = React.useCallback(() => {
        newestOnScreen.current = false;
      }, []);

      const pendingJump = React.useRef(false);
      React.useEffect(() => {
        if (jumpedToNewest.current === newestRequest) return;
        jumpedToNewest.current = newestRequest;
        jumpedAt.current = Date.now();
        // The newest cell is already built here. Keep it visible so its send
        // transition is not covered by the static landing copy.
        if (lastOffset.current <= 100 && !hasNewer) {
          followNewestAfterLayout();
          return;
        }
        pendingJump.current = true;
        // Tapped before the copy was built: build it now, in the same render as
        // the landing, so the scroll below lands with it already in place. A
        // few frames' wait before moving is better than a flash of nothing.
        if (!pinReady) setPinReady(true);
        setLanding(true);
        // Only a new jump request starts this; pinReady is read, not watched.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [newestRequest]);
      // The scroll waits for the render that removed the buffer and built the
      // copy, or it would land before either had happened.
      React.useLayoutEffect(() => {
        if (!landing || !pendingJump.current) return;
        pendingJump.current = false;
        const list = (ref as React.MutableRefObject<FlashListRef<DisplayRow> | null>)?.current;
        list?.scrollToOffset({ offset: 0, animated: false });
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          onNewestShown.current = null;
          // Two frames: the real row has committed, now let it paint before the
          // copy over it goes.
          requestAnimationFrame(() => requestAnimationFrame(() => setLanding(false)));
        };
        if (newestOnScreen.current) finish();
        else onNewestShown.current = finish;
        // A safety net only; normally the real row reports in well before this.
        const safety = setTimeout(finish, 2000);
        return () => {
          clearTimeout(safety);
          onNewestShown.current = null;
        };
      }, [landing, ref]);

      // A message jumped to from search or shared media can sit behind the
      // window. Open the window far enough to reach it before scrolling there.
      React.useEffect(() => {
        if (!highlightedMessageId) return;
        if (visibleData.some((item) => !('_kind' in item) && item.id === highlightedMessageId)) return;
        const index = allRows.findIndex((item) => !('_kind' in item) && item.id === highlightedMessageId);
        if (index >= 0) setWindowRows(index + CHAT_WINDOW_STEP);
      }, [allRows, highlightedMessageId, visibleData]);


      const lastJumpedMessage = React.useRef<string | null>(null);
      React.useEffect(() => {
        if (!highlightedMessageId) {
          lastJumpedMessage.current = null;
          return;
        }
        if (lastJumpedMessage.current === highlightedMessageId) return;
        const index = visibleData.findIndex((item) => !('_kind' in item) && item.id === highlightedMessageId);
        if (index < 0) return;
        const timer = setTimeout(() => {
          autoScroll.drag();
          lastJumpedMessage.current = highlightedMessageId;
          const list = (ref as React.MutableRefObject<FlashListRef<DisplayRow> | null>)?.current;
          if (list) void list.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
        }, 40);
        return () => clearTimeout(timer);
      }, [autoScroll, highlightedMessageId, ref, visibleData]);

      const rowCache = React.useRef(new Map<string, DisplayRow>());
      const pinnedRowsCache = React.useRef<DisplayRow[]>([]);
      const displayRows = React.useMemo(() => {
        const previous = rowCache.current;
        const next = new Map<string, DisplayRow>();
        const me = currentUserId ?? 'me';
        const selectionMode = selectedMessageIds.size > 0;
        const rows = visibleData.map((item): DisplayRow => {
          let candidate: DisplayRow;
          if ('_kind' in item) {
            candidate = { kind: 'date', key: messageRowKey(item), date: item.date };
          } else if (item.type === 'service') {
            const seconds = typeof item.metadata?.seconds === 'number' ? item.metadata.seconds : null;
            candidate = {
              kind: 'service',
              key: messageRowKey(item),
              message: item,
              text: describeTtlNotice(seconds, item.senderId === currentUserId ? 'You' : otherUserName),
            };
          } else {
            const replied = item.replyToId ? messageById.get(item.replyToId) : undefined;
            const index = messageIndex.get(item.id) ?? -1;
            const joinsAbove = isSameMessageGroup(item, index >= 0 ? messages[index + 1] : undefined);
            const joinsBelow = isSameMessageGroup(item, index > 0 ? messages[index - 1] : undefined);
            const repliedIsDocument = replied ? isReplyDocument(replied) : false;
            candidate = {
              kind: 'message',
              key: messageRowKey(item),
              message: item,
              isMe: item.senderId === currentUserId,
              currentUserId: me,
              groupPosition: joinsAbove ? (joinsBelow ? 'middle' : 'bottom') : (joinsBelow ? 'top' : 'single'),
              replyIsDocument: repliedIsDocument,
              replyDocumentIcon: replied && repliedIsDocument ? getReplyDocumentIcon(replied) : undefined,
              replyIsVoice: replied ? isReplyVoice(replied) : false,
              replyPreview: replied ? getReplyPreview(replied) : undefined,
              replyAuthor: replied ? (replied.senderId === currentUserId ? 'You' : otherUserName) : undefined,
              highlighted: highlightedMessageId === item.id,
              selectionMode,
              selected: selectedMessageIds.has(item.id),
              reactorAvatars,
              starred: starredMessageIds.has(item.id),
              pinned: pinnedMessageIds.has(item.id),
            };
          }
          const kept = previous.get(candidate.key);
          const row = kept && sameDisplayRow(kept, candidate) ? kept : candidate;
          next.set(row.key, row);
          return row;
        });
        rowCache.current = next;
        return rows;
      }, [visibleData, messages, messageById, messageIndex, currentUserId, otherUserName,
        highlightedMessageId, selectedMessageIds, reactorAvatars, starredMessageIds, pinnedMessageIds]);

      // Rows keep their identity across rebuilds, so the copy only re-renders a
      // row when that row itself changed.
      const pinnedRows = React.useMemo(() => {
        const next = displayRows.slice(0, PINNED_NEWEST_ROWS);
        const previous = pinnedRowsCache.current;
        const same = previous.length === next.length && next.every((row, index) => row === previous[index]);
        if (!same) pinnedRowsCache.current = next;
        return pinnedRowsCache.current;
      }, [displayRows]);

      // The row callbacks come from the screen and can change identity with its
      // state. Bubbles are handed fixed wrappers that always call the latest
      // one, so the renderer - and every row with it - never has to change.
      const handlers = React.useRef({ onReply, onEdit, onRetryMediaUpload, onCancelMediaUpload, onOpenReply, onRetryMessage, onToggleMessageSelection });
      handlers.current = { onReply, onEdit, onRetryMediaUpload, onCancelMediaUpload, onOpenReply, onRetryMessage, onToggleMessageSelection };
      const stable = React.useMemo(() => ({
        onReply: (message: Message) => handlers.current.onReply(message),
        onEdit: (message: Message) => handlers.current.onEdit(message),
        onRetryMediaUpload: (messageId: string, itemIndex: number) => handlers.current.onRetryMediaUpload(messageId, itemIndex),
        onCancelMediaUpload: (messageId: string, itemIndex: number) => handlers.current.onCancelMediaUpload(messageId, itemIndex),
        onOpenReply: (messageId: string) => handlers.current.onOpenReply(messageId),
        onRetryMessage: (messageId: string) => handlers.current.onRetryMessage(messageId),
        onToggleSelection: (messageId: string) => handlers.current.onToggleMessageSelection(messageId),
      }), []);

      const renderRow = React.useCallback((row: DisplayRow) => {
        if (row.kind === 'date') {
          return (
            <View style={styles.dateSeparator}>
              <View style={styles.datePill}>
                <Text style={styles.dateText}>{formatDateSeparator(row.date)}</Text>
              </View>
            </View>
          );
        }
        if (row.kind === 'service') return <ServiceMessage text={row.text} />;
        return (
          <MessageBubble
            message={row.message}
            isMe={row.isMe}
            currentUserId={row.currentUserId}
            showTime
            groupPosition={row.groupPosition}
            onReply={stable.onReply}
            onEdit={stable.onEdit}
            replyIsDocument={row.replyIsDocument}
            replyDocumentIcon={row.replyDocumentIcon}
            replyIsVoice={row.replyIsVoice}
            replyPreview={row.replyPreview}
            replyAuthor={row.replyAuthor}
            onRetryMediaUpload={stable.onRetryMediaUpload}
            onCancelMediaUpload={stable.onCancelMediaUpload}
            onOpenReply={stable.onOpenReply}
            onRetryMessage={stable.onRetryMessage}
            highlighted={row.highlighted}
            selectionMode={row.selectionMode}
            selected={row.selected}
            onToggleSelection={stable.onToggleSelection}
            reactorAvatars={row.reactorAvatars}
            starred={row.starred}
            pinned={row.pinned}
          />
        );
      }, [stable]);

      // The real list marks its newest row, so a jump knows when that row is
      // actually on screen. The copy renders the same rows unmarked.
      // Telegram's list animator: a sent message rises into place while the
      // rows above lift by its height, on one clock. Each send's lift adds to
      // the others, so rapid sends move together instead of resetting.
      const rises = useSharedValue<Rise[]>([]);
      const riseNow = useSharedValue(0);
      const riseClock = React.useMemo(() => ({ rises, now: riseNow }), [rises, riseNow]);
      const riseTicker = useFrameCallback(() => { riseNow.value = Date.now(); }, false);
      const riseStop = React.useRef<ReturnType<typeof setTimeout> | null>(null);
      React.useEffect(() => sendMotion.onRise((id, height) => {
        const t0 = Date.now();
        runOnUI(() => {
          'worklet';
          rises.value = [...rises.value.filter(rise => t0 - rise.t0 < TELEGRAM_SEND_MS * 2), { id, height, t0 }];
          riseNow.value = t0;
        })();
        riseTicker.setActive(true);
        if (riseStop.current) clearTimeout(riseStop.current);
        riseStop.current = setTimeout(() => {
          riseTicker.setActive(false);
          runOnUI(() => { 'worklet'; riseNow.value = Date.now(); })();
        }, TELEGRAM_SEND_MS + 150);
      }), [rises, riseNow, riseTicker, sendMotion]);
      React.useEffect(() => () => { if (riseStop.current) clearTimeout(riseStop.current); }, []);
      const renderItem = React.useCallback(({ item, index, target }: { item: DisplayRow; index: number; target?: string }) => {
        const realCell = target === undefined || target === 'Cell';
        const mine = realCell && item.kind === 'message' && item.isMe;
        const row = mine
          ? <OutgoingMessageTransition key={item.key} id={item.key} motion={sendMotion} clock={riseClock}>{renderRow(item)}</OutgoingMessageTransition>
          : renderRow(item);
        return <NewestRowMarker active={index === 0 && realCell} onShown={markNewestShown} onGone={markNewestGone}>
          {realCell ? <RisingRow clock={riseClock} selfId={mine ? item.key : null}>{row}</RisingRow> : row}
        </NewestRowMarker>;
      }, [markNewestGone, markNewestShown, renderRow, riseClock, sendMotion]);
      const renderCopyItem = React.useCallback(({ item }: { item: DisplayRow }) => renderRow(item), [renderRow]);
      // The list ends above the composer. No virtualized spacer is needed.
      const listHeader = React.useMemo(() => (
        typingSenderId ? <TypingIndicator recording={typingActivity === 'recording'} /> : null
      ), [typingSenderId, typingActivity]);
      const listFooter = React.useMemo(() => isLoading && hasMore ? (
        <View style={{ paddingVertical: 12, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} size="small" />
        </View>
      ) : null, [isLoading, hasMore]);

      const list = (
        <FlashList<DisplayRow>
          ref={ref}
          data={displayRows}
          // Selection and highlighting can change without a message update.
          keyExtractor={displayRowKey}
          getItemType={displayRowType}
          // Turned upside down, so scroll offset zero is the newest message.
          //
          // Anchoring to the bottom of a chronological list is what made a chat
          // open badly: to know where the bottom is, the list has to lay out
          // everything above it, and until a row is measured its height is taken
          // as zero. So it drew one bubble against an empty screen, measured a
          // few rows, grew, corrected the anchor, and repeated - the jumping.
          // Inverted there is nothing to anchor: the newest message is at offset
          // zero, where the list already is, and history extends away from the
          // screen where its height costs nothing to be wrong about.
          inverted
          maintainVisibleContentPosition={FOLLOW_LATEST_CONFIG}
          onCommitLayoutEffect={followNewestAfterLayout}
          onContentSizeChange={followNewestAfterLayout}
          onLayout={followNewestAfterLayout}
          onScroll={trackScroll}
          onScrollBeginDrag={() => {
            autoScroll.drag();
            // The copy stands still; the list is about to move under it.
            if (landing) setLanding(false);
            onScrollBeginDrag?.();
          }}
          scrollEventThrottle={32}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          // Draw the first screenful in one pass.
          //
          // FlashList fills a new list progressively: two rows, measure, a few
          // more, measure again, widening only every fifth pass. Each pass is a
          // render and a layout round trip, so a screen of message rows - media,
          // audio, gestures, reactions - took a string of them, and until the
          // last one the list had nothing laid out to show. That empty stretch
          // is the black the chat opened on, and it is what the native stand-in
          // was covering up. Asking for a screenful in the first batch spends
          // the same work on the rows that have to be drawn anyway, and spends
          // it once.
          overrideProps={INITIAL_DRAW_BATCH}
          // How far past the screen rows are built, in dp.
          //
          // One screen while opening, because everything built off screen then
          // is time the chat is not on screen. Four once it is up: a fling
          // crosses a screen in a couple of frames, and a row that is not built
          // when it arrives is a blank. Building ahead is the only answer to
          // that, and by then it is not competing with anything.
          drawDistance={landing ? 0 : ready ? screenHeight * 4 : screenHeight}

          renderItem={renderItem}
          style={styles.messageListSurface}
          contentContainerStyle={styles.messageListContent}
          showsVerticalScrollIndicator={false}
          // The end of the data is the oldest message, which is the top of an
          // inverted list; index zero is the newest, at the bottom.
          onEndReached={ready ? handleOlderReached : undefined}
          // A screen and a half of warning. Half a screen left the next stretch
          // arriving under the scroll rather than ahead of it, which is what the
          // scroll caught up with and stopped against.
          onEndReachedThreshold={1.5}
          onStartReached={ready && hasNewer ? onLoadNewer : undefined}
          onStartReachedThreshold={0.5}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
        />
      );
      return (
        <View style={styles.messageListFrame}>
          {list}
          {pinReady ? (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: landing ? 1 : 0 }]}>
              <FlashList<DisplayRow>
                data={pinnedRows}
                inverted
                scrollEnabled={false}
                keyExtractor={displayRowKey}
                getItemType={displayRowType}
                renderItem={renderCopyItem}
                overrideProps={INITIAL_DRAW_BATCH}
                drawDistance={screenHeight}
                style={styles.messageListPinned}
                contentContainerStyle={styles.messageListContent}
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={listHeader}
              />
            </View>
          ) : null}
        </View>
      );
    }
  )
);
