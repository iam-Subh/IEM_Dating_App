import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';
import { store } from '../../../store';
import { BACKGROUND_ACTIONS } from './categories';
import { forCurrentUser, recordOpened, runBackgroundAction } from './actions';
import { noteDelivery } from './lateDelivery';

/**
 * A tap on a notification, or one of its buttons (NOTIFICATIONS_PLAN.md 8, 10):
 * counted as opened, then either done in place (Reply, Accept...) or turned
 * into the screen to open. A tap while logged out opens the link after login.
 */

/** Where each opening button goes, when it isn't the notification's own link. */
const BUTTON_URL: Record<string, string> = {
  see_who: 'iemdating://main/matches?tab=likes',
  not_me: 'iemdating://settings/sessions',
};

let pendingUrl: string | null = null;
/** One response is handled once, even if the background task and the listener both see it. */
const handled = new Set<string>();

function claim(response: Notifications.NotificationResponse) {
  const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
  if (handled.has(key)) return false;
  handled.add(key);
  return true;
}

/** The link this response opens, or null when it is handled without opening anything. */
export function urlForResponse(response: Notifications.NotificationResponse): string | null {
  const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
  const action = response.actionIdentifier;
  if (!claim(response)) return null;
  noteDelivery(response.notification);
  if (!forCurrentUser(data)) return null;
  if (BACKGROUND_ACTIONS.has(action)) {
    void runBackgroundAction(response);
    return null;
  }
  recordOpened(data, action === Notifications.DEFAULT_ACTION_IDENTIFIER ? 'open' : action);
  const url = BUTTON_URL[action] ?? (typeof data.url === 'string' ? data.url : null);
  if (!url) return null;
  if (!store.getState().auth.token) {
    pendingUrl = url;
    return null;
  }
  return url;
}

/**
 * A chat notification drawn by the phone opens the chat with `?pushId=` in
 * its link: that tap counts as the push's open (NOTIFICATIONS_PLAN.md 13).
 */
export function recordOpenFromUrl(url: string | null | undefined) {
  const pushId = url?.match(/[?&]pushId=([0-9a-f-]{36})/i)?.[1];
  if (pushId) recordOpened({ pushId }, 'open');
}

/** After login: the notification tapped while logged out opens now. */
export function openPendingPushUrl() {
  if (!pendingUrl) return;
  const url = pendingUrl;
  pendingUrl = null;
  void Linking.openURL(url).catch(() => undefined);
}
