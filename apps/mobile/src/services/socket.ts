import { io, Socket } from 'socket.io-client';
import { store } from '../store';
import { Platform } from 'react-native';

const apiOrigin = process.env.EXPO_PUBLIC_API_URL
  ? new URL(process.env.EXPO_PUBLIC_API_URL).origin
  : (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL?.replace(/\/$/, '') || apiOrigin;

let socket: Socket | null = null;
let socketUserId: string | null = null;
let socketToken: string | null = null;
let unsubscribeAuth: (() => void) | null = null;

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
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
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

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });
};

export const getSocket = (): Socket | null => socket;

export const disconnectSocket = () => {
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socketUserId = null;
  socketToken = null;
};
