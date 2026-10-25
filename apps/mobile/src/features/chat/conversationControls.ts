import { api } from '../../services/api';

/**
 * "Mute forever", as a date the server will never reach.
 *
 * The mute endpoint stores a timestamp, and Telegram's own "forever" is also
 * just the largest date it can represent. Anything past 2099 is read as forever.
 */
export const MUTE_FOREVER_ISO = '2100-01-01T00:00:00.000Z';

export const MUTE_PRESETS = [
  { label: 'Mute for 1 hour', seconds: 60 * 60 },
  { label: 'Mute for 8 hours', seconds: 8 * 60 * 60 },
  { label: 'Mute for 1 day', seconds: 24 * 60 * 60 },
  { label: 'Mute for 1 week', seconds: 7 * 24 * 60 * 60 },
] as const;

/** Telegram's auto-delete choices. A month is Telegram's 31 days. */
export const AUTO_DELETE_PRESETS = [
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '1 week', seconds: 7 * 24 * 60 * 60 },
  { label: '1 month', seconds: 31 * 24 * 60 * 60 },
] as const;

/** The custom picker works in hours; the server accepts down to a minute. */
export const MIN_CUSTOM_TTL_SECONDS = 60 * 60;
export const MAX_TTL_SECONDS = 366 * 24 * 60 * 60;

export type ConversationSettings = {
  matchId: string;
  mutedUntil: string | null;
  muted: boolean;
  pinned: boolean;
  archived: boolean;
  markedUnread: boolean;
  messageTtlSeconds: number | null;
};

export type ReactionList = {
  total: number;
  counts: Array<{ emoji: string; count: number }>;
  reactors: Array<{ userId: string; name: string; avatar: string | null; emoji: string; reactedAt: string }>;
};

export function isMuted(until: string | null | undefined): boolean {
  return Boolean(until && new Date(until).getTime() > Date.now());
}

export function isMutedForever(until: string | null | undefined): boolean {
  return Boolean(until && new Date(until).getUTCFullYear() >= 2099);
}

/** "1 hour", "2 weeks", "1 month", or "3 days 4 hours" for a custom value. */
export function formatDuration(seconds: number): string {
  const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;
  const units: Array<[number, string]> = [
    [31 * 24 * 60 * 60, 'month'],
    [7 * 24 * 60 * 60, 'week'],
    [24 * 60 * 60, 'day'],
    [60 * 60, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size && seconds % size === 0) return plural(seconds / size, unit);
  }
  // A mixed value reads as days plus hours, the granularity the picker offers.
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [
    days ? plural(days, 'day') : '',
    hours ? plural(hours, 'hour') : '',
    !days && minutes ? plural(minutes, 'minute') : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : plural(seconds, 'second');
}

export function formatMutedUntil(until: string | null | undefined): string {
  if (!isMuted(until)) return 'Notifications are on';
  if (isMutedForever(until)) return 'Muted forever';
  const date = new Date(until as string);
  const sameDay = date.toDateString() === new Date().toDateString();
  return `Muted until ${sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

/** Telegram's wording for the service notice an auto-delete change leaves. */
export function describeTtlNotice(seconds: number | null, actor: string): string {
  return seconds
    ? `${actor} set messages to automatically delete after ${formatDuration(seconds)}`
    : `${actor} disabled the auto-delete timer`;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null) return fallback;
  const candidate = error as {
    message?: string;
    response?: { data?: { message?: string; error?: string | { message?: string } } };
  };
  const apiError = candidate.response?.data?.error;
  if (typeof apiError === 'string') return apiError;
  return apiError?.message ?? candidate.response?.data?.message ?? fallback;
}

export const conversationApi = {
  settings: async (matchId: string) =>
    (await api.get(`/chat/${matchId}/settings`)).data.data as ConversationSettings,
  mute: (matchId: string, mutedUntil: string | null) => api.patch(`/chat/${matchId}/mute`, { mutedUntil }),
  pin: (matchId: string, pinned: boolean) => api.patch(`/chat/${matchId}/pin`, { pinned }),
  archive: (matchId: string, archived: boolean) => api.patch(`/chat/${matchId}/archive`, { archived }),
  unread: (matchId: string, unread: boolean) => api.patch(`/chat/${matchId}/unread`, { unread }),
  clear: async (matchId: string, forEveryone: boolean) =>
    (await api.post(`/chat/${matchId}/clear`, { forEveryone })).data.data as { throughSeq: number },
  remove: async (matchId: string, forEveryone: boolean) =>
    (await api.post(`/chat/${matchId}/delete`, { forEveryone })).data.data as { throughSeq: number },
  ttl: (matchId: string, seconds: number | null) => api.patch(`/chat/${matchId}/ttl`, { seconds }),
  reactions: async (matchId: string, messageId: string) =>
    (await api.get(`/chat/${matchId}/messages/${messageId}/reactions`)).data.data as ReactionList,
};
