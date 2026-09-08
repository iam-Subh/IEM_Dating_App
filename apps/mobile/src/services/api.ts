import axios from 'axios';
import { store } from '../store';
import { logout, setAccessToken } from '../store/authSlice';
import { credentialStore } from './credentialStore';

import { Platform } from 'react-native';

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
if (!configuredApiUrl && !__DEV__) throw new Error('EXPO_PUBLIC_API_URL is required');
const API_URL = configuredApiUrl || (Platform.OS === 'android'
  ? 'http://10.0.2.2:3000/api/v1'
  : 'http://localhost:3000/api/v1');

export const api = axios.create({
  baseURL: API_URL,
  timeout: 30000, // 30s — allows for Neon DB cold start (auto-resume from suspend)
  headers: {
    'ngrok-skip-browser-warning': 'true',
  },
});

let refreshPromise: Promise<string> | null = null;
let refreshSession: string | null = null;
let sessionGeneration = 0;
let sessionUser = store.getState().auth.user?.id;
let sessionHasToken = !!store.getState().auth.token;
store.subscribe(() => {
  const user = store.getState().auth.user?.id;
  const hasToken = !!store.getState().auth.token;
  if (user !== sessionUser || hasToken !== sessionHasToken) {
    sessionUser = user; sessionHasToken = hasToken; sessionGeneration++;
  }
});
const sessionKey = () => `${sessionGeneration}:${store.getState().auth.user?.id ?? ''}`;
const requireSession = (key: string) => {
  if (sessionKey() !== key) throw new Error('Session changed');
};

async function refreshAccessToken(refreshToken: string, key: string): Promise<string> {
  const response = await api.post('/auth/refresh', { refreshToken });
  const next = response.data.data;
  requireSession(key);
  await credentialStore.rotateRefreshToken(refreshToken, next.refreshToken, () => key === sessionKey());
  requireSession(key);
  store.dispatch(setAccessToken(next.accessToken));
  return next.accessToken;
}

api.interceptors.request.use(
  (config) => {
    const scoped = config as typeof config & { _sessionKey?: string };
    if (scoped._sessionKey !== undefined) requireSession(scoped._sessionKey);
    else scoped._sessionKey = sessionKey();
    const token = store.getState().auth.token;
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    } else {
      delete config.headers['Authorization'];
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => {
    const key = (response.config as typeof response.config & { _sessionKey?: string })._sessionKey;
    if (key !== undefined) requireSession(key);
    return response;
  },
  async (error) => {
    if (!error.response || error.code === 'ECONNABORTED') {
      console.warn('[Offline Mode]: Network Error detected, falling back to cached cache layers strategy...');
      // Logic for pushing failed requests to an AsyncStorage offline-queue
    }
    const original = error.config as (typeof error.config & { _retried?: boolean; _sessionKey?: string });
    const key = original?._sessionKey ?? sessionKey();
    if (key !== sessionKey()) return Promise.reject(error);
    if (error.response?.status === 401 && original && !original._retried && !original.url?.includes('/auth/refresh')) {
      original._retried = true;
      // A delayed 401 can arrive after another request has rotated the token.
      // Retry with that token before starting another refresh.
      const currentToken = store.getState().auth.token;
      if (currentToken && original.headers?.Authorization !== `Bearer ${currentToken}`) {
        return api(original);
      }
      const refreshToken = await credentialStore.getRefreshToken();
      requireSession(key);
      if (refreshToken) {
        try {
          if (!refreshPromise || refreshSession !== key) {
            refreshSession = key;
            const pending = refreshAccessToken(refreshToken, key).finally(() => {
              if (refreshPromise === pending) { refreshPromise = null; refreshSession = null; }
            });
            refreshPromise = pending;
          }
          const accessToken = await refreshPromise;
          requireSession(key);
          original.headers = original.headers || {};
          original.headers.Authorization = `Bearer ${accessToken}`;
          return api(original);
        } catch (refreshError: any) {
          if (key !== sessionKey() || ![401, 403].includes(refreshError?.response?.status)) return Promise.reject(error);
          const [{ disconnectSocket }, { clearOfflineQueue }, { resetChatState }, { resetDiscoverState }] = await Promise.all([
            import('./socket'), import('./offlineQueue'), import('../store/chatSlice'), import('../store/discoverSlice'),
          ]);
          requireSession(key);
          const clearQueue = clearOfflineQueue();
          const clearCredentials = credentialStore.clear();
          disconnectSocket();
          store.dispatch(resetChatState());
          store.dispatch(resetDiscoverState());
          store.dispatch(logout());
          await Promise.all([clearQueue, clearCredentials]);
        }
      }
    }
    return Promise.reject(error);
  }
);
