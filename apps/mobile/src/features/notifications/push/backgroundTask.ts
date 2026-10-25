import * as Notifications from 'expo-notifications';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { BACKGROUND_ACTIONS } from './categories';
import { dismissChatNotifications, runBackgroundAction } from './actions';

/**
 * The background side of notifications (NOTIFICATIONS_PLAN.md 8, 10), run by
 * Android even when the app is killed:
 *
 * - a button that doesn't open the app (Reply, Mark as read, Accept, Decline,
 *   It was me);
 * - a silent "clear" push: a chat was read on another phone, or ended.
 *
 * Defined at module scope from index.ts, as expo-task-manager requires. A
 * build without the native module (an older dev client) simply skips it.
 */
export const PUSH_TASK = 'iem-push-task';

type Payload = Notifications.NotificationTaskPayload;

function dataOf(payload: Payload): Record<string, unknown> {
  if ('actionIdentifier' in payload) return (payload.notification.request.content.data ?? {}) as Record<string, unknown>;
  const raw = payload.data ?? {};
  if (typeof raw.dataString === 'string') {
    try { return JSON.parse(raw.dataString); } catch { return {}; }
  }
  // FCM data messages carry their fields as strings under `body` on some versions.
  if (typeof raw.body === 'string') {
    try { return JSON.parse(raw.body); } catch { /* not JSON */ }
  }
  return raw as Record<string, unknown>;
}

export async function handlePushTask(payload: Payload) {
  if ('actionIdentifier' in payload) {
    if (BACKGROUND_ACTIONS.has(payload.actionIdentifier)) await runBackgroundAction(payload);
    return;
  }
  const data = dataOf(payload);
  if (data.type === 'clear' && typeof data.matchId === 'string') await dismissChatNotifications(data.matchId);
}

export function definePushTask() {
  if (!requireOptionalNativeModule('ExpoTaskManager')) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
  if (TaskManager.isTaskDefined(PUSH_TASK)) return;
  TaskManager.defineTask<Payload>(PUSH_TASK, async ({ data, error }) => {
    if (error || !data) return;
    try {
      await handlePushTask(data);
    } catch {
      // A background task must never throw; the notification stays as it was.
    }
  });
  Notifications.registerTaskAsync(PUSH_TASK).catch(() => undefined);
}
