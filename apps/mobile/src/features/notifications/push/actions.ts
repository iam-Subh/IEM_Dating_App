import * as Notifications from 'expo-notifications';
import { api } from '../../../services/api';
import { persistor, store } from '../../../store';

/**
 * What a notification button does without opening the app
 * (NOTIFICATIONS_PLAN.md 8): one call to POST /notifications/action, which
 * checks every rule again. Runs from the background task (app killed or in
 * the background) or from the response listener (app running).
 */

type PushData = Record<string, unknown>;

/** The saved session is back in the store (a killed app starts from storage). */
async function sessionReady() {
  if (persistor.getState().bootstrapped) return;
  await new Promise<void>((resolve) => {
    const stop = persistor.subscribe(() => {
      if (persistor.getState().bootstrapped) { stop(); resolve(); }
    });
    setTimeout(() => { stop(); resolve(); }, 5000);
  });
}

/** True: the push is for whoever is signed in on this phone now (NOTIFICATIONS_PLAN.md 10). */
export function forCurrentUser(data: PushData | undefined) {
  const owner = typeof data?.userId === 'string' ? data.userId : null;
  const current = store.getState().auth.user?.id;
  return !owner || !current || owner === current;
}

export function recordOpened(data: PushData | undefined, action = 'open') {
  const pushId = typeof data?.pushId === 'string' ? data.pushId : null;
  if (!pushId) return;
  api.post('/notifications/opened', { pushId, action }).catch(() => undefined);
}

const running = new Set<string>();

/**
 * Runs one background button. The notification goes away on success; on
 * failure it is replaced by "Couldn't send - tap to try again", which opens
 * the right screen.
 */
export async function runBackgroundAction(response: {
  actionIdentifier: string;
  userText?: string;
  notification: Notifications.Notification;
}) {
  const request = response.notification.request;
  const data = (request.content.data ?? {}) as PushData;
  const action = response.actionIdentifier;
  // The background task and the running app's listener can both see one tap.
  const key = `${request.identifier}:${action}`;
  if (running.has(key)) return;
  running.add(key);
  await sessionReady();
  if (!store.getState().auth.user?.id || !forCurrentUser(data)) {
    await Notifications.dismissNotificationAsync(request.identifier).catch(() => undefined);
    return;
  }
  const pushId = typeof data.pushId === 'string' ? data.pushId : undefined;
  let body: Record<string, unknown> | null = null;
  if (action === 'reply' && typeof data.matchId === 'string' && response.userText?.trim()) {
    body = { action: 'reply', matchId: data.matchId, text: response.userText.trim().slice(0, 2000), pushId };
  } else if (action === 'read' && typeof data.matchId === 'string') {
    body = { action: 'read', matchId: data.matchId, pushId };
  } else if ((action === 'accept' || action === 'decline') && typeof data.followId === 'string') {
    body = { action, followId: data.followId, pushId };
  } else if (action === 'mine') {
    body = { action: 'mine', pushId };
  }
  if (!body) return;
  try {
    await api.post('/notifications/action', body);
    await Notifications.dismissNotificationAsync(request.identifier).catch(() => undefined);
  } catch (error: any) {
    const refused = error?.response?.status && error.response.status < 500;
    await Notifications.dismissNotificationAsync(request.identifier).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: refused ? (error.response.data?.message ?? 'Not available any more') : (action === 'reply' ? "Couldn't send your reply" : "Couldn't do that"),
        body: refused ? 'Open the app to see what changed.' : 'Tap to try again in the app.',
        data: { url: typeof data.url === 'string' ? data.url : 'iemdating://notifications', userId: data.userId },
      },
      trigger: { channelId: data.category === 'messages' ? 'messages' : 'account' },
    }).catch(() => undefined);
  }
}

/** A chat's notifications leave the status bar: it was read, here or on another phone (NOTIFICATIONS_PLAN.md 7). */
export async function dismissChatNotifications(matchId: string) {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(shown
      .filter((item) => item.request.content.data?.matchId === matchId)
      .map((item) => Notifications.dismissNotificationAsync(item.request.identifier)));
  } catch {
    // Nothing shown, or not supported here.
  }
}
