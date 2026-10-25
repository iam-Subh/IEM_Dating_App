import type { Server } from 'socket.io';

/**
 * Activity status (ACTIVITY_STATUS in SETTINGS): who is around, and how it is
 * shown. Two audiences, two switches, both on by default:
 *
 * - Matches, in chats: "Online" and "Last seen", from live connections.
 *   `showOnlineStatus`.
 * - Everyone else, on cards (deck, Explore, Standouts, Likes You, a dating
 *   profile): "Active now" or "Recently active" - a band, never a time, so a
 *   stranger can't track someone's habits. `showRecentlyActive`.
 *
 * Both work both ways, as Instagram's activity status does: turn yours off
 * and you don't see anyone else's either.
 */

/** Used the app this recently: "Active now". The app pings every 2 minutes while on screen. */
export const ACTIVE_NOW_MINUTES = 10;
/** And this recently: "Recently active". Older shows nothing. */
export const RECENTLY_ACTIVE_HOURS = 24;

export type Activity = 'now' | 'recent' | null;

type Sharer = { showRecentlyActive: boolean };
type Shown = Sharer & { lastActiveAt: Date | null };

/** The band a card shows: nothing if either side keeps theirs private. */
export function activityOf(viewer: Sharer, candidate: Shown, now = Date.now()): Activity {
  if (!viewer.showRecentlyActive || !candidate.showRecentlyActive || !candidate.lastActiveAt) return null;
  const minutes = (now - candidate.lastActiveAt.getTime()) / 60_000;
  if (minutes <= ACTIVE_NOW_MINUTES) return 'now';
  if (minutes <= RECENTLY_ACTIVE_HOURS * 60) return 'recent';
  return null;
}

let io: Server | null = null;

/** socket.ts hands over the server once it exists. */
export function setPresenceServer(server: Server) {
  io = server;
}

/**
 * Of these people, who has the app open on screen right now: a live
 * connection that is not in the background. One adapter round-trip for all.
 */
export async function onlineAmong(userIds: string[]): Promise<Set<string>> {
  const online = new Set<string>();
  if (!io || !userIds.length) return online;
  try {
    const sockets = await io.in(userIds.map((id) => `user:${id}`)).fetchSockets();
    for (const socket of sockets) {
      const data = socket.data as { userId?: string; background?: boolean } | undefined;
      if (data?.userId && !data.background) online.add(data.userId);
    }
  } catch {
    // No presence is better than a failed chat list.
  }
  return online;
}

/** How many people have the app open on screen right now (the admin panel's live count). */
export async function onlineCount(): Promise<number> {
  if (!io) return 0;
  try {
    const people = new Set<string>();
    for (const socket of await io.fetchSockets()) {
      const data = socket.data as { userId?: string; background?: boolean } | undefined;
      if (data?.userId && !data.background) people.add(data.userId);
    }
    return people.size;
  } catch {
    return 0;
  }
}
