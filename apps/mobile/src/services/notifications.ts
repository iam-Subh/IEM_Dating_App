import * as Notifications from 'expo-notifications';
import { chatPushKey, clearChatNotifySession, drawsChatNotifications, setChatNotifyAppState, setChatNotifySession } from '../../modules/chat-notify';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { getActiveChat, watchActiveChat } from '../features/chat/activeChat';
import { store } from '../store';
import { setUpChannels } from '../features/notifications/push/channels';
import { setUpButtons } from '../features/notifications/push/categories';
import { dismissChatNotifications, forCurrentUser } from '../features/notifications/push/actions';
import { noteDelivery } from '../features/notifications/push/lateDelivery';

/** App settings for this phone; missing means the default (on). */
const deviceSetting = (key: 'in_app_banners' | 'sound') =>
  (store.getState().auth.user as any)?.notificationPrefs?.[key] !== false;

const TOKEN_KEY = 'push.expoToken';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data ?? {};
    noteDelivery(notification);
    // A silent "clear": a chat was read on another phone (NOTIFICATIONS_PLAN.md 10).
    if (data.type === 'clear') {
      if (typeof data.matchId === 'string') void dismissChatNotifications(data.matchId);
      return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false };
    }
    // Telegram stays quiet about a chat you are already looking at: the message
    // or reaction is right there, so a banner on top of it is only noise.
    const matchId = data.matchId;
    // App settings > Banners while using the app: off keeps the open app quiet;
    // everything still lands in the Notifications page. A push for another
    // account that once used this phone is never shown.
    const show = forCurrentUser(data) && deviceSetting('in_app_banners') && !(typeof matchId === 'string' && matchId === getActiveChat());
    return {
      shouldShowAlert: show,
      shouldPlaySound: show && deviceSetting('sound'),
      shouldSetBadge: false,
      shouldShowBanner: show,
      shouldShowList: show,
    };
  },
});

let setUp: Promise<void> | null = null;
/** Channels and buttons, once per launch: before any notification can arrive. */
export function setUpNotifications() {
  setUp ??= Promise.all([setUpChannels(), setUpButtons()]).then(() => undefined).catch(() => undefined);
  return setUp;
}

/**
 * This phone's push token, only when notifications are already allowed.
 * Asking is the permission flow's job (push/permission.ts), at a good
 * moment - never as soon as someone logs in (NOTIFICATIONS_PLAN.md 12).
 */
async function tokenIfAllowed() {
  await setUpNotifications();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return undefined;
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return undefined;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

export async function registerCurrentDeviceForPush() {
  if (Platform.OS === 'web') return;
  const token = await tokenIfAllowed();
  if (!token) return;
  // A build with the native chat module draws chat notifications itself
  // (MESSAGE_NOTIFICATIONS_PLAN.md); the server then sends it data, and a
  // narrow token for Reply / Mark as read / Play with the app closed.
  const response = await api.put('/notifications/devices', {
    token, platform: Platform.OS,
    // Its own key too, so chat pushes are encrypted end to end (MESSAGE_NOTIFICATIONS_PLAN.md 11).
    ...(drawsChatNotifications ? { capabilities: ['chat_v2'], pushKey: chatPushKey() ?? undefined } : {}),
  });
  const pushActionToken = response.data?.data?.pushActionToken;
  const userId = store.getState().auth.user?.id;
  if (pushActionToken && userId && api.defaults.baseURL) setChatNotifySession(api.defaults.baseURL, pushActionToken, userId);
  await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => undefined);
}

/** The token this phone last registered, so logging out can remove it. */
export async function registeredToken() {
  return AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
}

/** After logout: nothing of that account stays on the status bar or the icon. */
export async function clearPhoneNotifications() {
  // The native chat notifications, shortcuts, pictures and token go too.
  clearChatNotifySession();
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}

/**
 * Tells the native chat notifications what is on screen: no notification for
 * the open chat, none with in-app banners off (MESSAGE_NOTIFICATIONS_PLAN.md 10).
 */
export function watchScreenForChatNotifications() {
  const update = () => setChatNotifyAppState(AppState.currentState === 'active', getActiveChat(), deviceSetting('in_app_banners'));
  update();
  watchActiveChat(update);
  const subscription = AppState.addEventListener('change', update);
  return () => subscription.remove();
}

/** Google can rotate a phone's token; the server hears the new one at once (NOTIFICATIONS_PLAN.md 10). */
export function watchPushToken() {
  const subscription = Notifications.addPushTokenListener(() => {
    if (store.getState().auth.token) registerCurrentDeviceForPush().catch(() => undefined);
  });
  return () => subscription.remove();
}
