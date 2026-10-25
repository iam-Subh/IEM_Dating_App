import { io, Socket } from 'socket.io-client';
import { store } from '../store';
import { updateUser } from '../store/authSlice';
import { AppState, Platform, type NativeEventSubscription } from 'react-native';
import { startPresenceHeartbeat, stopPresenceHeartbeat } from './presenceHeartbeat';

const apiOrigin = process.env.EXPO_PUBLIC_API_URL
  ? new URL(process.env.EXPO_PUBLIC_API_URL).origin
  : (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL?.replace(/\/$/, '') || apiOrigin;

let socket: Socket | null = null;
let socketUserId: string | null = null;
let socketToken: string | null = null;
let unsubscribeAuth: (() => void) | null = null;
let appStateSubscription: NativeEventSubscription | null = null;

/**
 * Screens listen through `onSocketChange` (or `useSocketEvent`), so a new
 * socket - after signing in again - gets their listeners too.
 */
const socketListeners = new Set<(socket: Socket | null) => void>();
export function onSocketChange(listener: (socket: Socket | null) => void) {
  socketListeners.add(listener);
  return () => { socketListeners.delete(listener); };
}
const announceSocket = () => socketListeners.forEach((listener) => listener(socket));

export const initSocket = () => {
  const { token, user } = store.getState().auth;
  if (!token || !user?.id) { disconnectSocket(); return; }
  if (socket && socketUserId === user.id) return;

  // Disconnect previous socket if exists but not connected
  if (socket) {
    disconnectSocket();
  }
  socketUserId = user.id;
  socketToken = token;

  socket = io(SOCKET_URL, {
    auth: (callback) => {
      const current = store.getState().auth;
      callback({ token: current.user?.id === socketUserId ? current.token : null });
    },
    transports: ['websocket'],
    extraHeaders: {
      'ngrok-skip-browser-warning': 'true',
    },
    // Never give up: Android pauses the connection in the background, and
    // ten failed tries there used to leave it dead until the app restarted.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  // Back on screen: connect now rather than waiting out the retry delay.
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active' && socket && !socket.connected) socket.connect();
  });

  unsubscribeAuth = store.subscribe(() => {
    const current = store.getState().auth;
    if (!current.token || current.user?.id !== socketUserId) {
      disconnectSocket();
      return;
    }
    if (current.token !== socketToken && socket) {
      socketToken = current.token;
      // Keep the instance and its listeners. The server authenticates each connection.
      socket.disconnect().connect();
    }
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected to WebSocket server');
  });
  // "Active now" follows the app on screen, not the open connection.
  startPresenceHeartbeat(socket);

  // App settings changed on another device: this one follows at once.
  socket.on('app_settings_changed', (state: { values?: Record<string, boolean> }) => {
    if (state?.values) store.dispatch(updateUser({ notificationPrefs: state.values, notifyLikes: state.values.likes }));
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });
  announceSocket();
};

export const getSocket = (): Socket | null => socket;

export const disconnectSocket = () => {
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  stopPresenceHeartbeat();
  appStateSubscription?.remove();
  appStateSubscription = null;
  const had = !!socket;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socketUserId = null;
  socketToken = null;
  if (had) announceSocket();
};
