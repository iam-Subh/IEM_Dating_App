import type { PushCategory } from './app-settings.service';

/**
 * How each kind of push travels (apps/mobile/src/features/notifications/NOTIFICATIONS_PLAN.md
 * 5 and 7): its Android channel, how urgent it is, how long it stays worth
 * delivering, and whether quiet hours hold it until morning.
 *
 * The channel ids must match the ones the app creates
 * (apps/mobile/src/features/notifications/push/channels.ts).
 */

export type ChannelId = 'messages' | 'matches' | 'likes' | 'social' | 'verification' | 'account' | 'picks';

type Policy = {
  channel: ChannelId;
  /** High rings at once, even in Doze. */
  priority: 'high' | 'normal';
  /** Seconds the push service keeps trying; an old notification is worse than none. */
  ttl: number;
  /** Quiet hours: 'always' never waits, 'messages' waits only with "Quiet for messages too", 'wait' always waits. */
  quiet: 'always' | 'messages' | 'wait';
  /** A "spicy" one (4): counted against the daily cap and the back-off. */
  spicy?: boolean;
};

const HOUR = 3600;
const DAY = 24 * HOUR;

export const PUSH_POLICY: Record<PushCategory, Policy> = {
  messages: { channel: 'messages', priority: 'high', ttl: 28 * DAY, quiet: 'messages' },
  reactions: { channel: 'messages', priority: 'normal', ttl: 2 * DAY, quiet: 'wait' },
  matches: { channel: 'matches', priority: 'high', ttl: 7 * DAY, quiet: 'messages' },
  likes: { channel: 'likes', priority: 'normal', ttl: DAY, quiet: 'wait' },
  roses: { channel: 'likes', priority: 'high', ttl: 2 * DAY, quiet: 'wait' },
  follow_requests: { channel: 'social', priority: 'normal', ttl: 2 * DAY, quiet: 'wait' },
  story_mentions: { channel: 'social', priority: 'normal', ttl: DAY, quiet: 'wait' },
  story_activity: { channel: 'social', priority: 'normal', ttl: DAY, quiet: 'wait' },
  story_countdowns: { channel: 'social', priority: 'normal', ttl: 6 * HOUR, quiet: 'wait' },
  story_problems: { channel: 'social', priority: 'normal', ttl: DAY, quiet: 'wait' },
  verify_reminders: { channel: 'verification', priority: 'normal', ttl: 3 * DAY, quiet: 'wait' },
  account_security: { channel: 'account', priority: 'high', ttl: 7 * DAY, quiet: 'always' },
  team_updates: { channel: 'picks', priority: 'normal', ttl: 3 * DAY, quiet: 'wait' },
  picks: { channel: 'picks', priority: 'normal', ttl: 6 * HOUR, quiet: 'wait', spicy: true },
  nudges: { channel: 'picks', priority: 'normal', ttl: 12 * HOUR, quiet: 'wait', spicy: true },
};

/** Button sets the app registers (push/categories.ts); a push names one by its kind. */
export const BUTTONS_OF_KIND: Record<string, string> = {
  message: 'message',
  match: 'match',
  waiting_match: 'match',
  like: 'like',
  rose: 'like',
  follow_request: 'follow_request',
  story_mention: 'story_mention',
  story_post_failed: 'story_failed',
  signin: 'signin',
  verify_reminder: 'verify',
  real_person_verified: 'selfie_verified',
};

// --- Quiet hours (IST) ----------------------------------------------------

const IST_OFFSET_MIN = 330;
export const QUIET_START_MIN = 23 * 60 + 30;
export const QUIET_END_MIN = 8 * 60 + 30;

/** Minutes after midnight in India. */
export function istMinute(now = new Date()) {
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MIN) % 1440;
}

export function istHour(now = new Date()) {
  return Math.floor(istMinute(now) / 60);
}

export function inQuietHours(now = new Date()) {
  const minute = istMinute(now);
  return minute >= QUIET_START_MIN || minute < QUIET_END_MIN;
}

/** The next 8:30 am IST after `now`, plus up to `spreadMin` minutes so a morning isn't one burst. */
export function quietHoursEnd(now = new Date(), spreadMin = 30) {
  const minute = istMinute(now);
  const wait = (QUIET_END_MIN - minute + 1440) % 1440 || 1440;
  return new Date(now.getTime() + (wait + Math.floor(Math.random() * spreadMin)) * 60_000);
}

/** Midnight IST today, as an instant. */
export function istMidnight(now = new Date()) {
  return new Date(now.getTime() - istMinute(now) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
}

/**
 * Whether this push waits for the morning. Account and security never waits;
 * messages and matches wait only when the person asked for that too.
 */
export function waitsForMorning(category: PushCategory, prefs: { quiet_hours: boolean; quiet_messages: boolean }, now = new Date()) {
  const policy = PUSH_POLICY[category];
  if (policy.quiet === 'always' || !prefs.quiet_hours || !inQuietHours(now)) return false;
  return policy.quiet === 'wait' || prefs.quiet_messages;
}

// --- Spicy lines (4) ------------------------------------------------------

export type Line = { id: string; title: string; body: string };

/**
 * Every line has a few versions; one is picked at random and its id is logged,
 * so the open rates show which ones work (13). Only ever sent when true:
 * the caller checks the facts before choosing a set.
 */
export const LINES = {
  like_one: [
    { id: 'like_one_1', title: 'Someone from {campus} just liked you 👀', body: 'Open Likes You to see who.' },
    { id: 'like_one_2', title: "Psst... someone's got a crush on you 🤫", body: 'Open Likes You to see who.' },
    { id: 'like_one_3', title: 'Someone just liked you 👀', body: 'Go on, take a look.' },
  ],
  like_many: [
    { id: 'like_many_1', title: "{count} people like you. That's not nothing 🔥", body: 'Open Likes You to see who.' },
    { id: 'like_many_2', title: "Your profile's doing numbers today 📈", body: '{count} people like you. Go see.' },
    { id: 'like_many_3', title: '{count} people like you 🔥', body: 'Open Likes You to see who.' },
  ],
  rose: [
    { id: 'rose_1', title: 'A Rose 🌹 for you', body: 'Someone really wants to meet you.' },
    { id: 'rose_2', title: 'Okay, someone went all out 🌹', body: 'You got a Rose. Open Likes You to see it.' },
  ],
  match: [
    { id: 'match_1', title: "It's a match! 🎉", body: "Don't let {name} wait." },
    { id: 'match_2', title: "It's a match! 💘", body: "You and {name}. It's happening. Say hi first?" },
    { id: 'match_3', title: "It's a match! 🎉", body: 'You and {name} liked each other.' },
  ],
  waiting_match: [
    { id: 'waiting_1', title: "{name}'s waiting... 😅", body: 'Say something, anything.' },
    { id: 'waiting_2', title: "A 'hi' takes 2 seconds ⏳", body: "{name}'s still here." },
  ],
  standouts: [
    { id: 'standouts_1', title: 'Your Standouts just dropped 🔥', body: 'Fresh picks from {campus}.' },
    { id: 'standouts_2', title: 'Chai break? ☕', body: "Today's Standouts are waiting." },
    { id: 'standouts_3', title: "Today's Standouts are here 😌", body: 'Might be worth a look.' },
  ],
  new_people: [
    { id: 'new_people_1', title: '{count} new people from {campus} joined this week 👋', body: 'Say hello.' },
    { id: 'new_people_2', title: 'New faces at {campus} 👀', body: '{count} people joined this week. Just saying.' },
  ],
  comeback_likes: [
    { id: 'comeback_likes_1', title: "You have {count} likes you haven't seen 👀", body: 'They are waiting in Likes You.' },
    { id: 'comeback_likes_2', title: 'We kept your spot 💌', body: '{count} people liked you while you were away.' },
  ],
  comeback_people: [
    { id: 'comeback_people_1', title: '{count} new people joined since you left 👋', body: 'Come see who.' },
    { id: 'comeback_people_2', title: 'Your matches miss you. Well, probably 😄', body: 'Pop back in and say hi.' },
  ],
  tip_video: [
    { id: 'tip_video_1', title: 'Add a video to your profile 🎥', body: 'A few seconds of you says more than any bio.' },
  ],
  tip_photos: [
    { id: 'tip_photos_1', title: 'Add a couple more photos 📸', body: 'Fuller profiles get more right swipes.' },
  ],
  tip_bio: [
    { id: 'tip_bio_1', title: 'Your bio is empty ✍️', body: 'One line is enough. Give people something to reply to.' },
  ],
} satisfies Record<string, Line[]>;

export function pickLine(set: Line[], values: Record<string, string | number> = {}): Line {
  const line = set[Math.floor(Math.random() * set.length)];
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
  return { id: line.id, title: fill(line.title), body: fill(line.body) };
}
