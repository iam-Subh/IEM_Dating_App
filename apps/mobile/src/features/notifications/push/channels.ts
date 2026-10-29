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
  { id: 'likes_v2', name: 'Likes and Roses', description: 'When people like you or send you a Rose.', importance: Notifications.AndroidImportance.HIGH },
  { id: 'social', name: 'Stories and follows', description: 'Follow requests, mentions and Story activity.', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'verification_v2', name: 'Verification', description: 'College and real-person verification.', importance: Notifications.AndroidImportance.HIGH },
  { id: 'account', name: 'Account and security', description: 'Sign-ins, account changes and report outcomes.', importance: Notifications.AndroidImportance.HIGH },
  { id: 'standouts', name: 'Standouts', description: "When today's Standouts are ready. At most once a day.", importance: Notifications.AndroidImportance.HIGH },
  { id: 'picks_v2', name: 'Picks and tips', description: 'New people on your campus, tips and team updates.', importance: Notifications.AndroidImportance.DEFAULT },
] as const;

export type ChannelId = (typeof CHANNELS)[number]['id'];

/** App settings' switches, by the channel that carries them. */
export const CHANNEL_OF_SETTING: Record<string, ChannelId> = {
  messages: 'messages', reactions: 'messages', message_previews: 'messages',
  matches: 'matches',
  likes: 'likes_v2', roses: 'likes_v2',
  follow_requests: 'social', story_mentions: 'social', story_activity: 'social', story_countdowns: 'social', story_problems: 'social',
  verify_reminders: 'verification_v2',
  account_security: 'account',
  // "Daily picks" is mostly today's Standouts, which have their own channel.
  picks: 'standouts', nudges: 'picks_v2', team_updates: 'picks_v2',
};

/**
 * Channels no longer used: the four sound/vibration ones from before
 * one-per-type, and the first likes, verification and picks channels - made
 * too quiet (no banner; picks silent), and Android lets only the person raise
 * a channel once it exists, so they were replaced by louder ones (`_v2`).
 */
const OLD_CHANNELS = ['default', 'sound_only', 'vibrate_only', 'silent', 'likes', 'verification', 'picks'];

/**
 * Channels the audio libraries make for voice notes, with their own raw
 * names ("expo_audio_channel", "Recording Service"). Made here first, with
 * names people understand; the libraries keep a channel that already exists.
 * Quiet on purpose: they only show while a voice note plays or records.
 */
/** Chat messages in quiet hours arrive here: shown, without a sound (server: push.service.ts). */
export const QUIET_CHANNEL = 'quiet_hours';

const LIBRARY_CHANNELS = [
  { id: QUIET_CHANNEL, name: 'Quiet hours', description: 'Messages that arrive during your quiet hours, without a sound.' },
  { id: 'expo_audio_channel', name: 'Voice note playing', description: 'Shown while a voice note plays.' },
  { id: 'expo_audio_recording_channel', name: 'Voice note recording', description: 'Shown while you record a voice note.' },
  { id: 'recording_service', name: 'Voice note recording', description: 'Shown while you record a voice note.' },
  { id: 'audio_recording_channel', name: 'Voice note recording', description: 'Shown while you record a voice note.' },
];

export async function setUpChannels() {
  if (Platform.OS !== 'android') return;
  await Promise.all(CHANNELS.map((channel) => Notifications.setNotificationChannelAsync(channel.id, {
    name: channel.name,
    description: channel.description,
    importance: channel.importance,
    vibrationPattern: channel.importance >= Notifications.AndroidImportance.DEFAULT ? [0, 250, 250, 250] : [0],
    enableVibrate: channel.importance >= Notifications.AndroidImportance.DEFAULT,
    lightColor: '#FF5A5F',
    showBadge: channel.id !== 'picks_v2',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  })));
  await Promise.all(OLD_CHANNELS.map((id) => Notifications.deleteNotificationChannelAsync(id).catch(() => undefined)));
  await Promise.all(LIBRARY_CHANNELS.map((channel) => Notifications.setNotificationChannelAsync(channel.id, {
    name: channel.name,
    description: channel.description,
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    enableVibrate: false,
    showBadge: false,
  }).catch(() => undefined)));
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
