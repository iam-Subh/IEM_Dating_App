import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { PUSH_POLICY, waitsForMorning } from './push-policy.service';

/**
 * Settings > App settings (APP_SETTINGS in the app): every notification the
 * app can send, what reaches this phone and how, and updates from Team IEM
 * Connect.
 *
 * One catalogue drives both sides: the screen renders it, and every push goes
 * through `pushDecision` with its category, so a switch can never exist that
 * doesn't do anything, or a push that no switch controls. Turning a push off
 * never removes it from the in-app Notifications page - only from the phone.
 */

export type PushCategory =
  | 'account_security'
  | 'matches' | 'messages' | 'reactions'
  | 'likes' | 'roses'
  | 'follow_requests' | 'story_mentions' | 'story_activity' | 'story_countdowns' | 'story_problems'
  | 'team_updates'
  | 'verify_reminders'
  | 'picks' | 'nudges';

type Item = { key: string; title: string; detail: string; defaultOn: boolean; required?: string; dependsOn?: string };
type Group = { id: string; title: string; items: Item[] };

/** Always on: what the app must be able to tell you, and why. */
const REQUIRED: Item[] = [
  {
    key: 'account_security', title: 'Account and security', defaultOn: true,
    detail: 'Sign-in and phone number changes, account deletion and data export notices.',
    required: 'We have to be able to reach you about your account\'s safety and anything that changes it. These are rare and never promotional.',
  },
];

export const NOTIFICATION_GROUPS: Group[] = [
  {
    id: 'connections', title: 'Matches and messages', items: [
      { key: 'matches', title: 'New matches', detail: 'When you and someone like each other.', defaultOn: true },
      { key: 'messages', title: 'Messages', detail: 'New messages from your matches. Muted chats stay quiet.', defaultOn: true },
      // On by default, as in WhatsApp and Telegram: the lock screen still shows
      // only "New message" (the notification's public version, ChatNotifier).
      { key: 'message_previews', title: 'Show name and message', detail: "Your lock screen always shows only \"New message\". Off: the notification shade does too.", defaultOn: true, dependsOn: 'messages' },
      // MESSAGE_NOTIFICATIONS_PLAN.md 14: how chat notifications look on this person's phones.
      { key: 'message_photos', title: 'Show photos in notifications', detail: 'A small picture of photos and videos you receive. Needs "Show name and message"; never on the lock screen.', defaultOn: true, dependsOn: 'message_previews' },
      { key: 'voice_from_notifications', title: 'Play voice messages from notifications', detail: 'A Play button on voice messages, with a player in your status bar and lock screen.', defaultOn: true, dependsOn: 'messages' },
      { key: 'smart_replies', title: 'Smart reply suggestions', detail: "Quick replies your phone suggests under Reply. Made on your phone - nothing is sent anywhere.", defaultOn: true, dependsOn: 'messages' },
      { key: 'reactions', title: 'Reactions', detail: 'When a match reacts to one of your messages.', defaultOn: true },
    ],
  },
  {
    id: 'likes', title: 'Likes', items: [
      { key: 'likes', title: 'Likes', detail: 'Now and then when new people like you. Never says who.', defaultOn: true },
      { key: 'roses', title: 'Roses', detail: 'When someone sends you a Rose, at most 3 a day.', defaultOn: true },
    ],
  },
  {
    id: 'verification', title: 'College verification', items: [
      { key: 'verify_reminders', title: 'Verification reminders', detail: 'Before you verify: two reminders in your first week, and before your profile pauses. Before a verification ends.', defaultOn: true },
    ],
  },
  {
    id: 'social', title: 'Stories and follows', items: [
      { key: 'follow_requests', title: 'Follow requests', detail: 'When someone asks to follow you.', defaultOn: true },
      { key: 'story_mentions', title: 'Mentions', detail: 'When someone mentions you in their Story.', defaultOn: true },
      { key: 'story_activity', title: 'Story replies', detail: 'Answers to your question sticker and people joining your Add Yours.', defaultOn: true },
      { key: 'story_countdowns', title: 'Countdowns', detail: 'When a countdown you follow ends.', defaultOn: true },
      { key: 'story_problems', title: 'Story upload problems', detail: "If a Story couldn't be posted.", defaultOn: true },
    ],
  },
  {
    // NOTIFICATIONS_PLAN.md 3e: never more than 2 a day, and fewer if you ignore them.
    id: 'from_us', title: 'From IEM Connect', items: [
      { key: 'picks', title: 'Daily picks', detail: "When today's Standouts are ready, and new people join your campus. At most once a day.", defaultOn: true },
      { key: 'nudges', title: 'Tips and nudges', detail: "Profile tips, and a few reminders if you haven't opened the app in a while. Stops after two weeks away.", defaultOn: true },
    ],
  },
  {
    id: 'quiet', title: 'Quiet hours', items: [
      { key: 'quiet_hours', title: 'Quiet at night', detail: 'From 11:30 pm to 8:30 am only messages, matches and account notices come through. The rest waits till morning.', defaultOn: true },
      { key: 'quiet_messages', title: 'Messages and matches too', detail: 'Hold those till 8:30 am as well. Account and security notices always come through.', defaultOn: false, dependsOn: 'quiet_hours' },
    ],
  },
];

export const TEAM_ITEM: Item = {
  key: 'team_updates', title: 'Updates from Team IEM Connect',
  detail: 'New features, safety tips and campus events from the team. A few times a month at most.', defaultOn: true,
};

/** How notifications behave on the phone, for every category. */
export const DEVICE_ITEMS: Item[] = [
  { key: 'in_app_banners', title: 'Banners while using the app', detail: 'Show notifications at the top of the screen while the app is open.', defaultOn: true },
  { key: 'sound', title: 'Sound', detail: 'Play a sound with notifications.', defaultOn: true },
  { key: 'vibration', title: 'Vibration', detail: 'Vibrate with notifications.', defaultOn: true },
];

const PAUSE_ITEM: Item = { key: 'pause_all', title: 'Pause all notifications', detail: 'Everything stays in the app. Account and security notices still come through.', defaultOn: false };

const ALL_ITEMS: Item[] = [...REQUIRED, ...NOTIFICATION_GROUPS.flatMap((group) => group.items), TEAM_ITEM, ...DEVICE_ITEMS, PAUSE_ITEM];
const BY_KEY = new Map(ALL_ITEMS.map((item) => [item.key, item]));
const TOGGLEABLE = new Set(ALL_ITEMS.filter((item) => !item.required).map((item) => item.key));

type PrefsUser = { notificationPrefs: Prisma.JsonValue; notifyLikes: boolean };

function prefsOf(user: PrefsUser): Record<string, boolean> {
  const raw = (user.notificationPrefs && typeof user.notificationPrefs === 'object' && !Array.isArray(user.notificationPrefs)
    ? user.notificationPrefs : {}) as Record<string, unknown>;
  const values: Record<string, boolean> = {};
  for (const item of ALL_ITEMS) {
    values[item.key] = item.required ? true : typeof raw[item.key] === 'boolean' ? (raw[item.key] as boolean) : item.defaultOn;
  }
  // Likes predates this page and keeps its column, which the Likes delivery also reads.
  values.likes = user.notifyLikes;
  return values;
}

/**
 * Whether a push of this category goes to this person's phones, and how.
 * Null: it doesn't (the in-app row is still written by the caller).
 */
export function pushDecision(user: PrefsUser, category: PushCategory, now = new Date()): { sound: boolean; channelId: string; waitForMorning: boolean } | null {
  const values = prefsOf(user);
  if (category !== 'account_security') {
    if (values.pause_all) return null;
    if (!values[category]) return null;
  }
  // Android: one channel per type (NOTIFICATIONS_PLAN.md 7) - sound and
  // vibration are the person's to set per channel in the phone's settings.
  // iOS: the Sound switch here.
  return {
    sound: values.sound,
    channelId: PUSH_POLICY[category].channel,
    waitForMorning: waitsForMorning(category, { quiet_hours: values.quiet_hours, quiet_messages: values.quiet_messages }, now),
  };
}

/** Message pushes name the sender and quote the text unless turned off. */
export function showsMessagePreviews(user: PrefsUser) {
  return prefsOf(user).message_previews === true;
}

/** How chat notifications are drawn on the phone (MESSAGE_NOTIFICATIONS_PLAN.md 14). */
export function messageNotificationPrefs(user: PrefsUser) {
  const values = prefsOf(user);
  return {
    previews: values.message_previews === true,
    photos: values.message_photos !== false,
    voicePlay: values.voice_from_notifications !== false,
    smartReplies: values.smart_replies !== false,
  };
}

const SELECT = {
  notificationPrefs: true, notifyLikes: true,
} as const;

function announce(userId: string, state: unknown) {
  // Lazily: the socket module imports services that import this one.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getIO } = require('../socket') as typeof import('../socket');
  // Every device of this person follows at once: the screen, and how pushes are shown.
  getIO()?.to(`user:${userId}`).emit('app_settings_changed', state);
}

export class AppSettingsService {
  static async read(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: SELECT });
    return this.shape(user);
  }

  private static shape(user: Prisma.UserGetPayload<{ select: typeof SELECT }>) {
    const values = prefsOf(user);
    const view = (item: Item) => ({ ...item, value: values[item.key], locked: !!item.required });
    return {
      values,
      notifications: {
        pause: view(PAUSE_ITEM),
        groups: NOTIFICATION_GROUPS.map((group) => ({ id: group.id, title: group.title, items: group.items.map(view) })),
        required: REQUIRED.map(view),
      },
      device: DEVICE_ITEMS.map(view),
      team: view(TEAM_ITEM),
    };
  }

  static async setNotification(userId: string, key: string, value: boolean) {
    if (!BY_KEY.has(key)) throw new HttpError(400, 'Unknown setting', 'UNKNOWN_SETTING');
    if (!TOGGLEABLE.has(key)) throw new HttpError(400, "This notification can't be turned off", 'SETTING_REQUIRED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: SELECT });
    const raw = (user.notificationPrefs && typeof user.notificationPrefs === 'object' && !Array.isArray(user.notificationPrefs)
      ? user.notificationPrefs : {}) as Record<string, unknown>;
    const updated = await prisma.user.update({
      where: { id: userId },
      data: key === 'likes' ? { notifyLikes: value } : { notificationPrefs: { ...raw, [key]: value } as Prisma.InputJsonValue },
      select: SELECT,
    });
    const state = this.shape(updated);
    announce(userId, state);
    // Switched off right after one arrived: that line was too much (NOTIFICATIONS_PLAN.md 13).
    if (!value) {
      await prisma.pushLog.updateMany({
        where: { userId, category: key, turnedOffAt: null, sentAt: { gte: new Date(Date.now() - 10 * 60_000) } },
        data: { turnedOffAt: new Date() },
      }).catch(() => undefined);
    }
    return state;
  }

}
