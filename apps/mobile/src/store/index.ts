import { configureStore } from '@reduxjs/toolkit';
import { persistStore, persistReducer, createTransform } from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import authReducer from './authSlice';
import discoverReducer from './discoverSlice';
import chatReducer from './chatSlice';

const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  blacklist: ['token'],
};

const persistedAuthReducer = persistReducer(persistConfig, authReducer);

/**
 * How many messages per conversation survive a restart.
 *
 * Enough that opening any recent chat is instant, small enough that a user with
 * many conversations is not writing megabytes to AsyncStorage on every change.
 * Messages are stored newest-first, so the newest are the ones kept.
 */
const MAX_CACHED_MESSAGES_PER_MATCH = 60;

/**
 * Trims the message cache on its way to storage.
 *
 * Local messages remain in this cache. Their text or media jobs are stored in a
 * durable queue, so the app can continue them after a process restart.
 */
const trimChatCache = createTransform(
  (inbound: unknown, key) => {
    if (key !== 'activeMessages') return inbound;
    const byMatch = (inbound ?? {}) as Record<string, Array<{ id: string; expiresAt?: string | null }>>;
    const trimmed: Record<string, Array<{ id: string; expiresAt?: string | null }>> = {};
    const now = Date.now();
    for (const [matchId, messages] of Object.entries(byMatch)) {
      if (!Array.isArray(messages)) continue;
      // An auto-deleted message must not come back from the cache after a restart,
      // even when the app was closed before the server's delete reached it.
      const live = messages.filter((message) => !(message?.expiresAt && new Date(message.expiresAt).getTime() <= now));
      if (live.length) trimmed[matchId] = live.slice(0, MAX_CACHED_MESSAGES_PER_MATCH);
    }
    return trimmed;
  },
  (outbound: unknown) => outbound,
  { whitelist: ['activeMessages'] },
);

/**
 * The chat cache, so reopening a conversation shows it rather than a spinner.
 *
 * Only the two fields worth restoring are listed. The loading flags must never
 * be: they would rehydrate as whatever they were when the app was killed, and a
 * restored `isLoadingMessages: true` is a spinner nothing ever clears. Typing
 * state is momentary and meaningless a restart later.
 */
const chatPersistConfig = {
  key: 'chat',
  storage: AsyncStorage,
  whitelist: ['conversations', 'activeMessages', 'eventCursors'],
  transforms: [trimChatCache],
  // Without this, every dispatch wrote the whole cache to storage: opening a
  // chat serialised each conversation's messages again for the loading flag,
  // the restored page and each arriving message, all on the thread drawing the
  // transition. At most one write a second loses nothing - the cache only has
  // to be current when the app is killed.
  throttle: 1000,
};

const persistedChatReducer = persistReducer(chatPersistConfig, chatReducer);

export const store = configureStore({
  reducer: {
    auth: persistedAuthReducer,
    discover: discoverReducer,
    chat: persistedChatReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // Development-only checks that walk the whole state on every dispatch.
      // Over the message cache that walk costs more than the update itself, and
      // it ran on every arriving message and every page of history, which is
      // what made opening and leaving a chat stall in the dev client.
      immutableCheck: { ignoredPaths: ['chat.activeMessages', 'chat.conversations'] },
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE', 'persist/REGISTER', 'persist/PAUSE', 'persist/PURGE', 'persist/FLUSH'],
        ignoredPaths: ['chat.activeMessages', 'chat.conversations'],
      },
    }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
