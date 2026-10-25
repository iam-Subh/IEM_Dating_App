import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { ReactionPreview } from '../features/chat/conversationPreview';
import {
  insertMessageOrdered,
  isNewerMessage,
  pendingLocalMessages,
} from '../features/chat/messageOrdering';

export interface ChatUser {
  id: string;
  name: string;
  avatar: string | null;
  /** On screen now, when you both share activity status. Live only: meaningless once offline. */
  online?: boolean;
}

export interface LastMessage {
  clientMessageId?: string | null;
  messageSeq?: number | null;
  id: string;
  content: string;
  senderId: string;
  sentAt: string;
  isRead: boolean;
  readAt: string | null;
  deliveredAt?: string | null;
  playedAt?: string | null;
  replyToId?: string | null;
  editedAt?: string | null;
  revision?: number;
  expiresAt?: string | null;
  localStatus?: 'queued' | 'sending' | 'failed';
  previewThumbnailKey?: string | null;
  mediaKey?: string;
  mediaKeys?: string[];
  type?: string;
  metadata?: Record<string, unknown> | null;
}

export interface Conversation {
  matchId: string;
  user: ChatUser;
  lastMessage: LastMessage | null;
  unreadCount: number;
  createdAt: string;
  activityAt?: string;
  reactionPreview?: ReactionPreview | null;
  pinned?: boolean;
  pinnedAt?: string | null;
  archived?: boolean;
  mutedUntil?: string | null;
  muted?: boolean;
  markedUnread?: boolean;
  messageTtlSeconds?: number | null;
}

export interface Message {
  id: string;
  content: string;
  senderId: string;
  sentAt: string;
  readAt: string | null;
  deliveredAt?: string | null;
  /** A voice message was listened to by its recipient: the blue microphone (MESSAGE_NOTIFICATIONS_PLAN.md 7). */
  playedAt?: string | null;
  matchId: string;
  mediaKey?: string;
  mediaKeys?: string[];
  clientMessageId?: string | null;
  messageSeq?: number | null;
  revision?: number;
  editedAt?: string | null;
  type?: string;
  metadata?: Record<string, unknown> | null;
  replyToId?: string | null;
  /** On a Story reply: the Story it answers. */
  storyId?: string | null;
  /**
   * The Story card above a Story reply, resolved by the server when the chat
   * loads. Absent on replies that arrived live; the card fetches it itself.
   */
  story?: { id: string; available: boolean; thumbnailUrl: string | null; closeFriends: boolean } | null;
  reactions?: Record<string, string>;
  /** When an auto-deleting message disappears; absent for ordinary messages. */
  expiresAt?: string | null;
  localStatus?: 'queued' | 'sending' | 'failed';
  localError?: string;
}

export type LocalMediaUploadStatus = 'queued' | 'uploading' | 'processing' | 'cancelled' | 'failed' | 'done';

/**
 * Upload stages only ever move forward.
 *
 * Progress reaches the bubble from three places - the pre-flight dispatch, the
 * transfer's own callback, and the dispatch after it resolves - and they can
 * land out of order. That is what made a finished attachment read "100%",
 * then "Sending", then bounce back and do it again. Ordering the stages here
 * rather than at each call site means no future caller can reintroduce it.
 *
 * `failed` sits outside the order: it must always be able to interrupt, and a
 * retry must always be able to leave it.
 */
const UPLOAD_STAGE_ORDER: Record<LocalMediaUploadStatus, number> = {
  queued: 0,
  uploading: 1,
  processing: 2,
  done: 3,
  failed: -1,
  cancelled: -1,
};

export interface LocalMediaUploadItem {
  progress: number;
  status: LocalMediaUploadStatus;
  error?: string;
}

interface ChatState {
  conversations: Conversation[];
  activeMessages: Record<string, Message[]>; // keyed by matchId
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  typingUsers: Record<string, string | null>; // matchId -> senderId who is typing
  /**
   * The last chat event applied to each conversation's cached messages.
   *
   * Opening a chat catches up on edits, deletes, reactions and receipts from the
   * event log. Without a remembered position that meant replaying the log from
   * the start on every open - the whole history, a dispatch per event, landing
   * while the chat was opening and while the first scroll or back press waited
   * behind it. Kept here, persisted with the messages it describes, so the two
   * always come from the same moment.
   */
  eventCursors: Record<string, number>;
}

const initialState: ChatState = {
  conversations: [],
  activeMessages: {},
  isLoadingConversations: false,
  isLoadingMessages: false,
  typingUsers: {},
  eventCursors: {},
};

/** Keep all preview fields when a message enters or changes in the cache. */
export function lastMessageFrom(message: Message): LastMessage {
  return { ...message, isRead: Boolean(message.readAt) };
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setConversations: (state, action: PayloadAction<Conversation[]>) => {
      // A refresh returns the same rows most of the time. Keeping the stored
      // object for an unchanged row keeps its reference, so the memoised list
      // rows skip re-rendering instead of the whole list redrawing on every
      // return from a chat.
      const previous = new Map(state.conversations.map((item) => [item.matchId, item]));
      state.conversations = action.payload.map((item) => {
        const current = previous.get(item.matchId);
        if (current?.lastMessage?.localStatus && item.lastMessage?.clientMessageId !== current.lastMessage.id && (!item.lastMessage || Date.parse(current.lastMessage.sentAt) >= Date.parse(item.lastMessage.sentAt))) item = { ...item, lastMessage: current.lastMessage };
        return current && JSON.stringify(current) === JSON.stringify(item) ? current : item;
      });
      state.isLoadingConversations = false;
    },
    appendConversations: (state, action: PayloadAction<Conversation[]>) => {
      const existing = new Set(state.conversations.map((item) => item.matchId));
      state.conversations.push(...action.payload.filter((item) => !existing.has(item.matchId)));
      state.isLoadingConversations = false;
    },
    resetChatState: () => initialState,
    setEventCursor: (state, action: PayloadAction<{ matchId: string; seq: number }>) => {
      const { matchId, seq } = action.payload;
      if (!Number.isSafeInteger(seq) || seq <= 0) return;
      if (!state.eventCursors) state.eventCursors = {};
      // Only forwards: an event already applied is never applied again.
      if ((state.eventCursors[matchId] ?? 0) >= seq) return;
      state.eventCursors[matchId] = seq;
    },
    setLoadingConversations: (state, action: PayloadAction<boolean>) => {
      state.isLoadingConversations = action.payload;
    },
    setMessages: (state, action: PayloadAction<{ matchId: string; messages: Message[] }>) => {
      const serverMessages = action.payload.messages.filter(
        (msg, index, self) => index === self.findIndex((m) => m.id === msg.id)
      );
      
      // Preserve optimistic messages the server has not confirmed yet.
      // Matching is by client message id: the previous content match discarded
      // a genuine second copy of the same text.
      const existing = state.activeMessages[action.payload.matchId] || [];
      const pendingTempMessages = pendingLocalMessages(existing, serverMessages);
      
      // Merge: server messages + surviving temp messages (temp at front = newest)
      state.activeMessages[action.payload.matchId] = [
        ...pendingTempMessages,
        ...serverMessages,
      ];
      state.isLoadingMessages = false;
    },
    prependMessages: (state, action: PayloadAction<{ matchId: string; messages: Message[] }>) => {
      if (!state.activeMessages[action.payload.matchId]) {
        state.activeMessages[action.payload.matchId] = [];
      }
      const existing = state.activeMessages[action.payload.matchId];
      // For inverted list (newest first), older loaded messages belong at the end
      // of the array. A Set keeps this linear: the findIndex scan it replaces was
      // quadratic and grew with every page of a long history.
      const known = new Set(existing.map((msg) => msg.id));
      for (const msg of action.payload.messages) {
        if (known.has(msg.id)) continue;
        known.add(msg.id);
        existing.push(msg);
      }
      state.isLoadingMessages = false;
    },
    /** Inserts many messages at their ordered positions in one render. */
    mergeMessages: (state, action: PayloadAction<{ matchId: string; messages: Message[] }>) => {
      let list = state.activeMessages[action.payload.matchId] ?? [];
      for (const msg of action.payload.messages) list = insertMessageOrdered(list, msg);
      state.activeMessages[action.payload.matchId] = list;
    },
    setLoadingMessages: (state, action: PayloadAction<boolean>) => {
      state.isLoadingMessages = action.payload;
    },
    addMessage: (state, action: PayloadAction<Message>) => {
      const msg = action.payload;
      // Initialize if doesn't exist
      if (!state.activeMessages[msg.matchId]) {
        state.activeMessages[msg.matchId] = [];
      }
      // Insert at the ordered position. Replay and out-of-order delivery mean
      // an arrival is not always the newest message in the conversation.
      state.activeMessages[msg.matchId] = insertMessageOrdered(
        state.activeMessages[msg.matchId],
        msg,
      );
      // Update the conversation preview only when this really is the latest
      // message, otherwise a replayed older message rewrites the preview.
      const convIndex = state.conversations.findIndex((c) => c.matchId === msg.matchId);
      const currentPreview = convIndex === -1 ? null : state.conversations[convIndex].lastMessage;
      const previewIsStale =
        !currentPreview ||
        isNewerMessage(msg, {
          id: currentPreview.id,
          senderId: currentPreview.senderId,
          content: currentPreview.content,
          sentAt: currentPreview.sentAt,
          messageSeq: currentPreview.messageSeq,
        });
      if (convIndex !== -1 && previewIsStale) {
        const conversation = state.conversations[convIndex];
        conversation.lastMessage = lastMessageFrom(msg);
        conversation.activityAt = msg.sentAt;
        if (conversation.reactionPreview && Date.parse(conversation.reactionPreview.at) <= Date.parse(msg.sentAt)) conversation.reactionPreview = null;
      }
    },
    markConversationRead: (state, action: PayloadAction<string>) => {
      const convIndex = state.conversations.findIndex((c) => c.matchId === action.payload);
      if (convIndex !== -1) {
        state.conversations[convIndex].unreadCount = 0;
        if (state.conversations[convIndex].lastMessage) {
          state.conversations[convIndex].lastMessage!.isRead = true;
        }
      }
    },
    setTyping: (state, action: PayloadAction<{ matchId: string; senderId: string | null }>) => {
      state.typingUsers[action.payload.matchId] = action.payload.senderId;
    },
    replaceOptimisticMessage: (state, action: PayloadAction<{ tempId: string; realMessage: Message }>) => {
      const { tempId, realMessage } = action.payload;
      const matchMessages = state.activeMessages[realMessage.matchId];
      if (matchMessages) {
        const index = matchMessages.findIndex((m) => m.id === tempId);
        if (index !== -1) {
          const optimistic = matchMessages[index];
          const localMediaFallback = optimistic.mediaKeys?.filter((key) => key.startsWith('local-')) ?? [];
          const mergedMessage: Message = {
            ...realMessage,
            clientMessageId: realMessage.clientMessageId ?? tempId,
            metadata: {
              ...(realMessage.metadata ?? {}),
              ...(localMediaFallback.length ? { localMediaFallback } : {}),
            },
          };
          state.activeMessages[realMessage.matchId] = insertMessageOrdered(
            matchMessages.filter((message) => message.id !== tempId && message.id !== realMessage.id),
            mergedMessage,
          );
        }
      }
      // Conversation lastMessage uses the REAL server ID for server consistency
      const convIndex = state.conversations.findIndex((c) => c.matchId === realMessage.matchId);
      if (convIndex !== -1) {
        const conv = state.conversations[convIndex];
        if (conv.lastMessage && conv.lastMessage.id === tempId) {
          conv.lastMessage = lastMessageFrom(realMessage);
        }
      }
    },
    removeMessage: (state, action: PayloadAction<{ matchId: string; messageId: string }>) => {
      const { matchId, messageId } = action.payload;
      const conversation = state.conversations.find(item => item.matchId === matchId);
      if (conversation?.reactionPreview?.messageId === messageId) conversation.reactionPreview = null;
      if (state.activeMessages[matchId]) {
        state.activeMessages[matchId] = state.activeMessages[matchId].filter(
          (msg) => msg.id !== messageId
        );
      }
      
      // If we deleted the last message, null it out in the conversations list
      const convIndex = state.conversations.findIndex((c) => c.matchId === matchId);
      if (convIndex !== -1 && state.conversations[convIndex].lastMessage?.id === messageId) {
        const remainingMessages = state.activeMessages[matchId] || [];
        if (remainingMessages.length > 0) {
           // With newest-first storage, index 0 is the latest message
           const newLastMsg = remainingMessages[0];
           state.conversations[convIndex].lastMessage = lastMessageFrom(newLastMsg);
        } else {
           state.conversations[convIndex].lastMessage = null;
        }
      }
    },
    updateLocalMediaUpload: (state, action: PayloadAction<{
      matchId: string;
      messageId: string;
      itemIndex: number;
      progress?: number;
      status?: LocalMediaUploadStatus;
      error?: string;
    }>) => {
      const message = state.activeMessages[action.payload.matchId]?.find((item) => item.id === action.payload.messageId);
      const upload = message?.metadata?.localMediaUpload as { items?: LocalMediaUploadItem[] } | undefined;
      const item = upload?.items?.[action.payload.itemIndex];
      if (!item) return;

      const { progress, status, error } = action.payload;
      const retrying = (item.status === 'failed' || item.status === 'cancelled')
        && status !== undefined
        && status !== 'failed'
        && status !== 'cancelled';
      const goingBackwards = status !== undefined
        && !retrying
        && status !== 'failed'
        && status !== 'cancelled'
        && UPLOAD_STAGE_ORDER[status] < UPLOAD_STAGE_ORDER[item.status];

      const nextStatus = status === undefined || goingBackwards ? item.status : status;
      // A retry restarts the bar; otherwise the fraction only ever grows, so a
      // late callback from an earlier stage cannot rewind a finished one.
      const nextProgress = progress === undefined
        ? item.progress
        : retrying || nextStatus === 'failed'
          ? progress
          : Math.max(item.progress, progress);
      const nextError = error !== undefined
        ? error
          : nextStatus !== 'failed' && nextStatus !== 'cancelled' && status !== undefined
          ? undefined
          : item.error;

      // Writing identical values would still produce a new state object and
      // re-render every bubble in the list for nothing.
      if (nextStatus === item.status && nextProgress === item.progress && nextError === item.error) return;

      item.progress = nextProgress;
      item.status = nextStatus;
      if (nextError === undefined) delete item.error;
      else item.error = nextError;
      const preview = state.conversations.find(row => row.matchId === action.payload.matchId)?.lastMessage;
      if (message && preview?.id === message.id) preview.metadata = message.metadata;
    },
    applyMessageEdit: (state, action: PayloadAction<{ matchId: string; messageId: string; content: string; revision: number; editedAt: string }>) => {
      const message = state.activeMessages[action.payload.matchId]?.find((item) => item.id === action.payload.messageId);
      if (message && (message.revision ?? 1) <= action.payload.revision) Object.assign(message, action.payload);
      const row = state.conversations.find(item => item.matchId === action.payload.matchId);
      if (row?.lastMessage?.id === action.payload.messageId && (row.lastMessage.revision ?? 1) <= action.payload.revision) Object.assign(row.lastMessage, action.payload);
      if (row?.reactionPreview?.messageId === action.payload.messageId) row.reactionPreview.content = action.payload.content;
    },
    /**
     * Drops cached messages up to a cleared-history watermark.
     *
     * Optimistic messages have no sequence yet and were written after the clear,
     * so they stay; anything else without a sequence predates sequencing and goes.
     */
    clearMessagesThrough: (state, action: PayloadAction<{ matchId: string; throughSeq: number }>) => {
      const { matchId, throughSeq } = action.payload;
      const list = state.activeMessages[matchId];
      if (list) {
        state.activeMessages[matchId] = list.filter((message) => (message.messageSeq == null
          ? message.id.startsWith('temp-')
          : message.messageSeq > throughSeq));
      }
      const conversation = state.conversations.find((item) => item.matchId === matchId);
      if (conversation && (conversation.lastMessage?.messageSeq ?? 0) <= throughSeq) {
        conversation.lastMessage = null;
        conversation.reactionPreview = null;
        conversation.unreadCount = 0;
      }
    },
    /** Removes auto-deleted messages whose deadline has passed. */
    expireMessages: (state, action: PayloadAction<{ matchId: string; now: number }>) => {
      const list = state.activeMessages[action.payload.matchId];
      const row = state.conversations.find(item => item.matchId === action.payload.matchId);
      if (row?.lastMessage?.expiresAt && Date.parse(row.lastMessage.expiresAt) <= action.payload.now) row.lastMessage = null;
      if (!list) return;
      const remaining = list.filter((message) => !message.expiresAt || new Date(message.expiresAt).getTime() > action.payload.now);
      if (remaining.length !== list.length) {
        state.activeMessages[action.payload.matchId] = remaining;
        if (row && !row.lastMessage && remaining[0]) row.lastMessage = lastMessageFrom(remaining[0]);
      }
    },
    patchConversation: (state, action: PayloadAction<{ matchId: string; changes: Partial<Conversation> }>) => {
      const conversation = state.conversations.find((item) => item.matchId === action.payload.matchId);
      if (conversation) Object.assign(conversation, action.payload.changes);
    },
    removeConversation: (state, action: PayloadAction<string>) => {
      state.conversations = state.conversations.filter((item) => item.matchId !== action.payload);
    },
    applyReaction: (state, action: PayloadAction<{ matchId: string; messageId: string; userId: string; emoji: string | null }>) => {
      const message = state.activeMessages[action.payload.matchId]?.find((item) => item.id === action.payload.messageId);
      if (!message) return;
      message.reactions = message.reactions || {};
      if (action.payload.emoji) message.reactions[action.payload.userId] = action.payload.emoji;
      else delete message.reactions[action.payload.userId];
    },
    markMessagesReadByPeer: (state, action: PayloadAction<{ matchId: string; messageIds?: string[]; throughMessageSeq?: number; readAt: string }>) => {
      const ids = new Set(action.payload.messageIds ?? []);
      const preview = state.conversations.find(row => row.matchId === action.payload.matchId)?.lastMessage;
      if (preview && ((!action.payload.messageIds && action.payload.throughMessageSeq === undefined) || ids.has(preview.id) || (action.payload.throughMessageSeq !== undefined && (preview.messageSeq ?? Infinity) <= action.payload.throughMessageSeq))) {
        if (!preview.readAt || Date.parse(action.payload.readAt) < Date.parse(preview.readAt)) preview.readAt = action.payload.readAt;
        preview.isRead = Boolean(preview.readAt);
      }
      for (const message of state.activeMessages[action.payload.matchId] ?? []) {
        if ((!action.payload.messageIds && action.payload.throughMessageSeq === undefined) || ids.has(message.id) || (action.payload.throughMessageSeq !== undefined && (message.messageSeq ?? Infinity) <= action.payload.throughMessageSeq)) {
          // Receipts are monotonic: a duplicate or out-of-order acknowledgement
          // must never move a read time backwards or clear it.
          const incoming = Date.parse(action.payload.readAt);
          const current = message.readAt ? Date.parse(message.readAt) : NaN;
          if (!Number.isNaN(incoming) && (Number.isNaN(current) || incoming < current)) {
            message.readAt = action.payload.readAt;
          }
        }
      }
    },
    markVoicePlayed: (state, action: PayloadAction<{ matchId: string; messageId: string; playedAt: string }>) => {
      const message = state.activeMessages[action.payload.matchId]?.find((item) => item.id === action.payload.messageId);
      if (message && !message.playedAt) message.playedAt = action.payload.playedAt;
      const preview = state.conversations.find(row => row.matchId === action.payload.matchId)?.lastMessage;
      if (preview?.id === action.payload.messageId && !preview.playedAt) preview.playedAt = action.payload.playedAt;
    },
    markMessagesDeliveredByPeer: (state, action: PayloadAction<{ matchId: string; messageIds?: string[]; throughMessageSeq?: number; deliveredAt: string }>) => {
      const ids = new Set(action.payload.messageIds ?? []);
      const preview = state.conversations.find(row => row.matchId === action.payload.matchId)?.lastMessage;
      if (preview && ((!action.payload.messageIds && action.payload.throughMessageSeq === undefined) || ids.has(preview.id) || (action.payload.throughMessageSeq !== undefined && (preview.messageSeq ?? Infinity) <= action.payload.throughMessageSeq))) {
        if (!preview.deliveredAt || Date.parse(action.payload.deliveredAt) < Date.parse(preview.deliveredAt)) preview.deliveredAt = action.payload.deliveredAt;
        
      }
      for (const message of state.activeMessages[action.payload.matchId] ?? []) {
        if ((!action.payload.messageIds && action.payload.throughMessageSeq === undefined) || ids.has(message.id) || (action.payload.throughMessageSeq !== undefined && (message.messageSeq ?? Infinity) <= action.payload.throughMessageSeq)) {
          const incoming = Date.parse(action.payload.deliveredAt);
          const current = message.deliveredAt ? Date.parse(message.deliveredAt) : NaN;
          if (!Number.isNaN(incoming) && (Number.isNaN(current) || incoming < current)) {
            message.deliveredAt = action.payload.deliveredAt;
          }
        }
      }
    },
    updateLocalMessageStatus: (state, action: PayloadAction<{ matchId: string; messageId: string; status: 'queued' | 'sending' | 'failed'; error?: string }>) => {
      const message = state.activeMessages[action.payload.matchId]?.find((item) => item.id === action.payload.messageId);
      const preview = state.conversations.find(row => row.matchId === action.payload.matchId)?.lastMessage;
      if (preview?.id === action.payload.messageId) preview.localStatus = action.payload.status;
      if (!message) return;
      message.localStatus = action.payload.status;
      if (action.payload.error) message.localError = action.payload.error;
      else delete message.localError;
    },
  },
});

export const {
  setConversations,
  appendConversations,
  setLoadingConversations,
  setMessages,
  prependMessages,
  mergeMessages,
  setLoadingMessages,
  addMessage,
  markConversationRead,
  setTyping,
  setEventCursor,
  replaceOptimisticMessage,
  updateLocalMediaUpload,
  removeMessage,
  resetChatState,
  applyMessageEdit,
  applyReaction,
  clearMessagesThrough,
  expireMessages,
  patchConversation,
  removeConversation,
  markMessagesReadByPeer,
  markMessagesDeliveredByPeer,
  markVoicePlayed,
  updateLocalMessageStatus,
} = chatSlice.actions;
export default chatSlice.reducer;
