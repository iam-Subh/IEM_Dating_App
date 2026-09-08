import axios from 'axios';
import { api } from './api';
import { store } from '../store';
import { logout } from '../store/authSlice';
import { resetChatState } from '../store/chatSlice';
import { resetDiscoverState } from '../store/discoverSlice';
import { credentialStore } from './credentialStore';
import { clearOfflineQueue } from './offlineQueue';
import { disconnectSocket } from './socket';

export function clearLocalSession(): Promise<boolean> {
  // Capture the account queue and enqueue credential deletion before another login.
  const cleanup = Promise.allSettled([clearOfflineQueue(), credentialStore.clear()]);
  disconnectSocket();
  store.dispatch(resetChatState());
  store.dispatch(resetDiscoverState());
  store.dispatch(logout());
  return cleanup.then(results => results.every(result => result.status === 'fulfilled'));
}

export function logoutSession() {
  const token = store.getState().auth.token;
  // Use a captured token without the shared refresh interceptor. A late response
  // must never retry with another account's token or clear its local state.
  const revoked = (async () => {
    if (!token) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await axios.post(`${api.defaults.baseURL}/auth/logout`, undefined, {
          timeout: 10000,
          headers: { Authorization: `Bearer ${token}`, 'ngrok-skip-browser-warning': 'true' },
        });
        return true;
      } catch (error: any) {
        const status = error.response?.status;
        if (status && status < 500 && status !== 429) return false;
      }
    }
    return false;
  })();
  const cleared = clearLocalSession();
  return Promise.all([cleared, revoked]).then(([localCleared, serverRevoked]) => ({ localCleared, serverRevoked }));
}
