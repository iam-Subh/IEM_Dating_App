import { clearVerificationStatus } from '../features/verification/useVerificationStatus';
import { resetHiddenWords } from '../features/safety/hiddenWords';
import { clearPhoneNotifications, registeredToken } from './notifications';
import axios from 'axios';
import { api } from './api';
import { store } from '../store';
import { logout } from '../store/authSlice';
import { resetChatState } from '../store/chatSlice';
import { resetDiscoverState } from '../store/discoverSlice';
import { credentialStore } from './credentialStore';
import { clearOfflineQueue } from './offlineQueue';
import { disconnectSocket } from './socket';
import { resetLocationSession } from '../features/location/locationClient';
import { resetRoses } from '../features/discovery/useRoses';
import { resetUnread } from '../features/notifications/useUnreadNotifications';
import { clearNativeChatAccount } from '../../modules/chat-timeline';

export function clearLocalSession(): Promise<boolean> {
  // Capture the account queue and enqueue credential deletion before another login.
  const accountId = store.getState().auth.user?.id;
  const cleanup = Promise.allSettled([
    clearOfflineQueue(), credentialStore.clear(), clearNativeChatAccount(accountId ?? ''),
  ]);
  disconnectSocket();
  // Location memory is per account; the next one starts clean.
  resetLocationSession();
  clearVerificationStatus();
  resetRoses();
  resetUnread();
  resetHiddenWords();
  store.dispatch(resetChatState());
  store.dispatch(resetDiscoverState());
  store.dispatch(logout());
  return cleanup.then(results => results.every(result => result.status === 'fulfilled'));
}

/**
 * Signs out this phone, or with `everywhere` every device this account is
 * signed in on (Settings > Log out > All devices).
 */
export function logoutSession({ everywhere = false }: { everywhere?: boolean } = {}) {
  const token = store.getState().auth.token;
  // This phone stops getting the account's pushes (NOTIFICATIONS_PLAN.md 10).
  if (token) {
    void registeredToken().then((pushToken) => pushToken ? axios.delete(`${api.defaults.baseURL}/notifications/devices`, {
      data: { token: pushToken }, timeout: 10000,
      headers: { Authorization: `Bearer ${token}`, 'ngrok-skip-browser-warning': 'true' },
    }) : undefined).catch(() => undefined).finally(() => void clearPhoneNotifications());
  }
  // Use a captured token without the shared refresh interceptor. A late response
  // must never retry with another account's token or clear its local state.
  const revoked = (async () => {
    if (!token) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await axios.post(`${api.defaults.baseURL}/auth/${everywhere ? 'logout-all' : 'logout'}`, undefined, {
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
