import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Android channels, one per type (NOTIFICATIONS_PLAN.md 7). The ids must match
 * the server's (apps/api/src/services/push-policy.service.ts PUSH_POLICY).
 * Android lets people switch each one off, or change its sound, in the
 * phone's settings; App settings reads that back (useChannelState).
 */
export const CHANNELS = [
  { id: 'messages', name: 'Messages', description: 'New messages and reactions from your matches.', importance: Notifications.AndroidImportance.HIGH },
  { id: 'matches', name: 'Matches', description: 'New matches, and matches waiting for a first message.', importance: Notifications.AndroidImportance.HIGH },
  { id: 'likes', name: 'Likes and Roses', description: 'When people like you or send you a Rose.', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'social', name: 'Stories and follows', description: 'Follow requests, mentions and Story activity.', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'verification', name: 'Verification', description: 'College and real-person verification.', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'account', name: 'Account and security', description: 'Sign-ins, account changes and report outcomes.', importance: Notifications.AndroidImportance.HIGH },
  { id: 'picks', name: 'Picks and tips', description: 'Daily Standouts, new people, tips and team updates.', importance: Notifications.AndroidImportance.LOW },
] as const;

export type ChannelId = (typeof CHANNELS)[number]['id'];

/** App settings' switches, by the channel that carries them. */
export const CHANNEL_OF_SETTING: Record<string, ChannelId> = {
  messages: 'messages', reactions: 'messages', message_previews: 'messages',
  matches: 'matches',
  likes: 'likes', roses: 'likes',
  follow_requests: 'social', story_mentions: 'social', story_activity: 'social', story_countdowns: 'social', story_problems: 'social',
  verify_reminders: 'verification',
  account_security: 'account',
  picks: 'picks', nudges: 'picks', team_updates: 'picks',
};

/** The four sound/vibration channels from before one-per-type. */
const OLD_CHANNELS = ['default', 'sound_only', 'vibrate_only', 'silent'];

export async function setUpChannels() {
  if (Platform.OS !== 'android') return;
  await Promise.all(CHANNELS.map((channel) => Notifications.setNotificationChannelAsync(channel.id, {
    name: channel.name,
    description: channel.description,
    importance: channel.importance,
    vibrationPattern: channel.importance >= Notifications.AndroidImportance.DEFAULT ? [0, 250, 250, 250] : [0],
    enableVibrate: channel.importance >= Notifications.AndroidImportance.DEFAULT,
    lightColor: '#FF5A5F',
    showBadge: channel.id !== 'picks',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  })));
  await Promise.all(OLD_CHANNELS.map((id) => Notifications.deleteNotificationChannelAsync(id).catch(() => undefined)));
}

/** Channels switched off in the phone's settings. */
export async function blockedChannels(): Promise<Set<string>> {
  if (Platform.OS !== 'android') return new Set();
  try {
    const channels = await Notifications.getNotificationChannelsAsync();
    return new Set(channels.filter((channel) => channel.importance === Notifications.AndroidImportance.NONE).map((channel) => channel.id));
  } catch {
    return new Set();
  }
}
