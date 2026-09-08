import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  insertMessageOrdered,
  isNewerMessage,
  pendingLocalMessages,
} from '../features/chat/messageOrdering';

export interface ChatUser {
  id: string;
  name: string;
  avatar: string | null;
}

export interface LastMessage {
  messageSeq?: number | null;
  id: string;
  content: string;
  senderId: string;
  sentAt: string;
  isRead: boolean;
  readAt: string | null;
  mediaKey?: string;
  mediaKeys?: string[];
}

export interface Conversation {
  matchId: string;
  user: ChatUser;
  lastMessage: LastMessage | null;
  unreadCount: number;
  createdAt: string;
}

export interface Message {
  id: string;
  content: string;
  senderId: string;
  sentAt: string;
  readAt: string | null;
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
  reactions?: Record<string, string>;
}

interface ChatState {
  conversations: Conversation[];
  activeMessages: Record<string, Message[]>; // keyed by matchId
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  typingUsers: Record<string, string | null>; // matchId -> senderId who is typing
}

const initialState: ChatState = {
  conversations: [],
  activeMessages: {},
  isLoadingConversations: false,
  isLoadingMessages: false,
  typingUsers: {},
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setConversations: (state, action: PayloadAction<Conversation[]>) => {
      state.conversations = action.payload;
      state.isLoadingConversations = false;
    },
    appendConversations: (state, action: PayloadAction<Conversation[]>) => {
      const existing = new Set(state.conversations.map((item) => item.matchId));
      state.conversations.push(...action.payload.filter((item) => !existing.has(item.matchId)));
      state.isLoadingConversations = false;
    },
    resetChatState: () => initialState,
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
      // For inverted list (newest first), older loaded messages belong at the end of the array
      const combined = [...existing, ...action.payload.messages];
      // Avoid duplicates
      state.activeMessages[action.payload.matchId] = combined.filter(
        (msg, index, self) => index === self.findIndex((m) => m.id === msg.id)
      );
      state.isLoadingMessages = false;
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
        state.conversations[convIndex].lastMessage = {
          id: msg.id,
          messageSeq: msg.messageSeq,
          content: msg.content,
          senderId: msg.senderId,
          sentAt: msg.sentAt,
          isRead: !!msg.readAt,
          readAt: msg.readAt,
        };
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
          // CRITICAL: Keep the temp ID for FlatList key stability.
          // Changing the ID causes FlatList to unmount/remount the bubble (visual flash).
          // Update metadata (readAt, sentAt, mediaKeys) from server but preserve the key.
          state.activeMessages[realMessage.matchId] = insertMessageOrdered(
            matchMessages.filter((message) => message.id !== tempId && message.id !== realMessage.id),
            realMessage,
          );
        }
      }
      // Conversation lastMessage uses the REAL server ID for server consistency
      const convIndex = state.conversations.findIndex((c) => c.matchId === realMessage.matchId);
      if (convIndex !== -1) {
        const conv = state.conversations[convIndex];
        if (conv.lastMessage && conv.lastMessage.id === tempId) {
          conv.lastMessage = {
            id: realMessage.id,
            content: realMessage.content,
            senderId: realMessage.senderId,
            sentAt: realMessage.sentAt,
            isRead: !!realMessage.readAt,
            readAt: realMessage.readAt,
            mediaKey: realMessage.mediaKey
          };
        }
      }
    },
    removeMessage: (state, action: PayloadAction<{ matchId: string; messageId: string }>) => {
      const { matchId, messageId } = action.payload;
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
           state.conversations[convIndex].lastMessage = {
             id: newLastMsg.id,
             content: newLastMsg.content,
             senderId: newLastMsg.senderId,
             sentAt: newLastMsg.sentAt,
             isRead: !!newLastMsg.readAt,
             readAt: newLastMsg.readAt,
             mediaKey: newLastMsg.mediaKey,
           };
        } else {
           state.conversations[convIndex].lastMessage = null;
        }
      }
    },
    applyMessageEdit: (state, action: PayloadAction<{ matchId: string; messageId: string; content: string; revision: number; editedAt: string }>) => {
      const message = state.activeMessages[action.payload.matchId]?.find((item) => item.id === action.payload.messageId);
      if (message && (message.revision ?? 1) <= action.payload.revision) Object.assign(message, action.payload);
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
  },
});

export const {
  setConversations,
  appendConversations,
  setLoadingConversations,
  setMessages,
  prependMessages,
  setLoadingMessages,
  addMessage,
  markConversationRead,
  setTyping,
  replaceOptimisticMessage,
  removeMessage,
  resetChatState,
  applyMessageEdit,
  applyReaction,
  markMessagesReadByPeer,
} = chatSlice.actions;
export default chatSlice.reducer;
