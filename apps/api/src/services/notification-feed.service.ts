import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { transformToCdnUrl } from '../middlewares/upload.middleware';

const VIDEO_KEY = /\.(mp4|mov|m4v|webm)$/i;
type PreviewSource = { content: string | null; type: string; mediaKeys: string[]; photoUrl: string | null; metadata: Prisma.JsonValue };

/**
 * A message as one line, the way the chat list says it: the text itself, or
 * 📷 Photo, 🎥 Video, 🎤 Voice message, 📄 the file's name. In the app only -
 * the stored title and body stay what a lock screen may show.
 */
export function messagePreviewLine(message: PreviewSource): string {
  const text = message.content?.trim() ?? '';
  const keys = message.mediaKeys.length ? message.mediaKeys : message.photoUrl ? [message.photoUrl] : [];
  const metadata = (message.metadata && typeof message.metadata === 'object' ? message.metadata : {}) as Record<string, unknown>;
  const withText = (label: string) => (text ? `${label} · ${text}` : label);
  if (message.type === 'voice') return '🎤 Voice message';
  if (message.type === 'document') return `📄 ${typeof metadata.fileName === 'string' && metadata.fileName ? metadata.fileName : 'Document'}`;
  if (message.type === 'story_reply') return text ? `Replied to your story: ${text}` : 'Replied to your story';
  if (keys.length && keys.every((key) => VIDEO_KEY.test(key))) return withText('🎥 Video');
  if (keys.length) return withText(keys.length > 1 ? `📷 ${keys.length} photos` : '📷 Photo');
  return text || 'Message';
}

/**
 * The in-app notification centre (the bell on the deck): every kind of
 * notification the app creates, read and cleared in one place, and live.
 *
 * Rows are written where each event happens (outbox deliveries, the story
 * countdown, the account notices). This service only reads them, fills in who
 * each is from, and keeps "read" honest - a Like you have already seen in
 * Likes You, or a message you have read in the chat, is not still "unread"
 * here.
 */

export const NOTIFICATION_CATEGORIES = ['likes', 'matches', 'messages', 'stories', 'follows', 'account'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

const TYPES_OF: Record<NotificationCategory, string[]> = {
  likes: ['like', 'rose'],
  matches: ['match'],
  messages: ['message', 'reaction'],
  stories: ['story_mention', 'story_countdown', 'story_post_failed'],
  follows: ['follow_request', 'follow_accepted'],
  account: ['system', 'team'],
};
const CATEGORY_OF: Record<string, NotificationCategory> = Object.fromEntries(
  Object.entries(TYPES_OF).flatMap(([category, types]) => types.map((type) => [type, category])),
) as Record<string, NotificationCategory>;

/** The centre shows two months; older rows are swept by the cleanup job. */
const WINDOW_MS = 60 * 24 * 60 * 60_000;
const PAGE = 30;

type Actor = { id: string; name: string; avatarUrl: string | null };
export type FeedTarget =
  /** `empty`: no message yet - the row offers a one-tap hello. */
  | { kind: 'chat'; matchId: string; empty?: boolean }
  | { kind: 'likes' }
  /**
   * A follow request, answerable in the row: its state now, and whether you
   * follow them back - so Confirm / Delete, then Follow back, stay honest.
   */
  | {
      kind: 'follow_requests';
      followId?: string;
      state?: 'pending' | 'accepted' | 'declined' | 'gone';
      followBack?: 'none' | 'pending' | 'accepted';
    }
  | { kind: 'story'; storyId: string }
  | null;

// ---------------------------------------------------------------------------
// Live: "your notifications changed - re-read them", to every device of one
// person. It carries nothing; the app re-reads through this service.
// ---------------------------------------------------------------------------
const pendingAnnounce = new Map<string, ReturnType<typeof setTimeout>>();
export function announceNotifications(userId: string) {
  // Coalesced: a burst (ten Likes, a multi-photo Story) is one re-read.
  if (pendingAnnounce.has(userId)) return;
  pendingAnnounce.set(
    userId,
    setTimeout(() => {
      pendingAnnounce.delete(userId);
      // Required lazily: the socket module imports the Prisma client this is
      // installed on, so a top-level import would be circular.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getIO } = require('../socket') as typeof import('../socket');
      getIO()?.to(`user:${userId}`).emit('notifications_changed', {});
    }, 250),
  );
}

/**
 * Every notification row written anywhere is announced to its owner, so no
 * code path that creates one can forget to - including ones added later.
 */
export function installNotificationLive(client: PrismaClient) {
  client.$use(async (params, next) => {
    const result = await next(params);
    if (params.model === 'Notification' && (params.action === 'create' || params.action === 'upsert' || params.action === 'createMany')) {
      const rows = params.action === 'createMany'
        ? ([] as Array<{ userId?: string }>).concat(params.args?.data ?? [])
        : [result as { userId?: string } | null];
      for (const row of rows) if (row?.userId) announceNotifications(row.userId);
    }
    return result;
  });
}

export class NotificationFeedService {
  static categoryOf(type: string): NotificationCategory {
    return CATEGORY_OF[type] ?? 'account';
  }

  /** Newest first, with who each is from and where tapping it goes. */
  static async feed(userId: string, options: { cursor?: string; category?: NotificationCategory; limit?: number } = {}) {
    const take = Math.min(Math.max(Math.floor(options.limit ?? PAGE) || PAGE, 1), 60);
    const after = this.parseCursor(options.cursor);
    const since = new Date(Date.now() - WINDOW_MS);
    const rows = await prisma.notification.findMany({
      where: {
        userId,
        createdAt: { gte: since },
        ...(options.category ? { type: { in: TYPES_OF[options.category] } } : {}),
        ...(after ? { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    const page = rows.slice(0, take);
    const [people, extras, previews] = await Promise.all([this.actors(userId, page), this.actionState(userId, page), this.messagePreviews(userId, page)]);
    const items = page.flatMap((row) => {
      const data = (row.data ?? {}) as Record<string, unknown>;
      const resolved = people.get(row.id);
      // From someone you have since blocked, or who blocked you: gone.
      if (resolved === 'hidden') return [];
      return [{
        id: row.id,
        type: row.type,
        category: this.categoryOf(row.type),
        title: row.title,
        body: row.body,
        emoji: typeof data.emoji === 'string' ? data.emoji : null,
        // The message itself, read now: an edit shows, a deleted one says so.
        messageText: typeof data.messageId === 'string' ? previews.get(data.messageId) ?? null : null,
        createdAt: row.createdAt.toISOString(),
        isRead: row.isRead,
        actor: resolved ?? null,
        target: this.withState(this.targetOf(row.type, data, !!resolved), data, extras, resolved ? resolved.id : null),
      }];
    });
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > take && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
      unread: await this.unread(userId),
    };
  }

  /** Unread, in total and per category - the bell's badge and the filter chips. */
  static async unread(userId: string) {
    const groups = await prisma.notification.groupBy({
      by: ['type'],
      where: { userId, isRead: false, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
      _count: { _all: true },
    });
    const byCategory = Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, 0])) as Record<NotificationCategory, number>;
    let total = 0;
    for (const group of groups) {
      byCategory[this.categoryOf(group.type)] += group._count._all;
      total += group._count._all;
    }
    return { total, byCategory };
  }

  static async markRead(userId: string, ids: string[]) {
    const unique = [...new Set(ids)].slice(0, 200);
    if (!unique.length) return { updated: 0 };
    const { count } = await prisma.notification.updateMany({ where: { userId, id: { in: unique }, isRead: false }, data: { isRead: true } });
    if (count) announceNotifications(userId);
    return { updated: count };
  }

  static async markAll(userId: string, category?: NotificationCategory) {
    const { count } = await prisma.notification.updateMany({
      where: { userId, isRead: false, ...(category ? { type: { in: TYPES_OF[category] } } : {}) },
      data: { isRead: true },
    });
    if (count) announceNotifications(userId);
    return { updated: count };
  }

  /**
   * Seen elsewhere, so read here too: Likes You opened, a chat read, a follow
   * request answered. Fire and forget - never holds up the action itself.
   */
  static readWhere(userId: string, types: string[], data?: { path: string; equals: string }) {
    void prisma.notification
      .updateMany({
        where: {
          userId,
          isRead: false,
          type: { in: types },
          ...(data ? { data: { path: [data.path], equals: data.equals } } : {}),
        },
        data: { isRead: true },
      })
      .then(({ count }) => {
        if (count) announceNotifications(userId);
      })
      .catch(() => undefined);
  }

  /**
   * A block, either way: each person's notifications about the other go, so
   * the badge never counts something the centre will not show.
   */
  static async forgetBetween(a: string, b: string) {
    const [matches, follows, stories] = await Promise.all([
      prisma.match.findMany({ where: { OR: [{ user1Id: a, user2Id: b }, { user1Id: b, user2Id: a }] }, select: { id: true } }),
      prisma.follow.findMany({ where: { OR: [{ followerId: a, followeeId: b }, { followerId: b, followeeId: a }] }, select: { id: true } }),
      prisma.story.findMany({ where: { ownerId: { in: [a, b] } }, select: { id: true } }),
    ]);
    const matchIds = matches.map((row) => row.id);
    const followIds = follows.map((row) => row.id);
    const storyIds = stories.map((row) => row.id);
    if (!matchIds.length && !followIds.length && !storyIds.length) return;
    const removed = await prisma.$executeRaw`
      DELETE FROM notifications WHERE user_id IN (${a}::uuid, ${b}::uuid) AND (
        data->>'matchId' = ANY(${matchIds}::text[])
        OR data->>'followId' = ANY(${followIds}::text[])
        OR (type = 'story_mention' AND data->>'storyId' = ANY(${storyIds}::text[])))`;
    if (removed) {
      announceNotifications(a);
      announceNotifications(b);
    }
  }

  static async markUnread(userId: string, ids: string[]) {
    const unique = [...new Set(ids)].slice(0, 200);
    if (!unique.length) return { updated: 0 };
    const { count } = await prisma.notification.updateMany({ where: { userId, id: { in: unique }, isRead: true }, data: { isRead: false } });
    if (count) announceNotifications(userId);
    return { updated: count };
  }

  /** Removed from the centre (a row, or a whole stack). The thing it was about is untouched. */
  static async remove(userId: string, ids: string[]) {
    const unique = [...new Set(ids)].slice(0, 200);
    if (!unique.length) return { removed: 0 };
    const { count } = await prisma.notification.deleteMany({ where: { userId, id: { in: unique } } });
    if (count) announceNotifications(userId);
    return { removed: count };
  }

  /** What the row actions need: each follow request's state, and which new chats are still empty. */
  /** Each message row's message, as one line (messagePreviewLine). */
  private static async messagePreviews(userId: string, rows: Array<{ type: string; data: Prisma.JsonValue }>) {
    const ids = new Set<string>();
    for (const row of rows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      if ((row.type === 'message' || row.type === 'story_reply') && typeof data.messageId === 'string') ids.add(data.messageId);
    }
    if (!ids.size) return new Map<string, string>();
    const messages = await prisma.message.findMany({
      where: { id: { in: [...ids] }, senderId: { not: userId } },
      select: { id: true, content: true, type: true, mediaKeys: true, photoUrl: true, metadata: true, isDeleted: true, hiddenBy: true, expiresAt: true },
    });
    const now = new Date();
    return new Map(messages.map((message) => [message.id,
      message.isDeleted || message.hiddenBy.includes(userId) || (message.expiresAt && message.expiresAt <= now)
        ? 'This message was deleted'
        : messagePreviewLine(message)]));
  }

  private static async actionState(userId: string, rows: Array<{ type: string; data: Prisma.JsonValue }>) {
    const followIds = new Set<string>();
    const matchIds = new Set<string>();
    for (const row of rows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      if (row.type === 'follow_request' && typeof data.followId === 'string') followIds.add(data.followId);
      if (row.type === 'match' && typeof data.matchId === 'string') matchIds.add(data.matchId);
    }
    const [follows, talked] = await Promise.all([
      followIds.size
        ? prisma.follow.findMany({ where: { id: { in: [...followIds] }, followeeId: userId }, select: { id: true, status: true, followerId: true } })
        : Promise.resolve([]),
      matchIds.size
        ? prisma.message.groupBy({ by: ['matchId'], where: { matchId: { in: [...matchIds] } }, _count: { _all: true } })
        : Promise.resolve([]),
    ]);
    const back = follows.length
      ? await prisma.follow.findMany({
        where: { followerId: userId, followeeId: { in: follows.map((row) => row.followerId) }, status: { in: ['pending', 'accepted'] } },
        select: { followeeId: true, status: true },
      })
      : [];
    const backOf = new Map(back.map((row) => [row.followeeId, row.status as 'pending' | 'accepted']));
    return {
      follow: new Map(follows.map((row) => [row.id, {
        state: (row.status === 'pending' ? 'pending' : row.status === 'accepted' ? 'accepted' : row.status === 'rejected' ? 'declined' : 'gone') as 'pending' | 'accepted' | 'declined' | 'gone',
        followBack: backOf.get(row.followerId) ?? ('none' as const),
      }])),
      talked: new Set(talked.map((row) => row.matchId)),
    };
  }

  private static withState(
    target: FeedTarget,
    data: Record<string, unknown>,
    extras: Awaited<ReturnType<typeof NotificationFeedService.actionState>>,
    actorId: string | null,
  ): FeedTarget {
    if (!target) return target;
    if (target.kind === 'follow_requests' && typeof data.followId === 'string') {
      const found = extras.follow.get(data.followId);
      // Answerable only while you can see who asked.
      return found && actorId
        ? { ...target, followId: data.followId, state: found.state, followBack: found.followBack }
        : { ...target, followId: data.followId, state: 'gone' };
    }
    if (target.kind === 'chat') return { ...target, empty: !extras.talked.has(target.matchId) };
    return target;
  }

  private static parseCursor(cursor?: string) {
    if (!cursor) return null;
    const [at, id] = cursor.split('|');
    const date = new Date(at ?? '');
    if (!id || Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new HttpError(400, 'Cursor is invalid', 'INVALID_NOTIFICATION_CURSOR');
    }
    return { at: date, id };
  }

  private static targetOf(type: string, data: Record<string, unknown>, hasActor: boolean): FeedTarget {
    const matchId = typeof data.matchId === 'string' ? data.matchId : null;
    const storyId = typeof data.storyId === 'string' ? data.storyId : null;
    switch (type) {
      case 'message':
      case 'reaction':
      case 'match':
        // Only while the chat still exists for you to open.
        return matchId && hasActor ? { kind: 'chat', matchId } : null;
      case 'like':
      case 'rose':
        return { kind: 'likes' };
      case 'follow_request':
        return { kind: 'follow_requests' };
      case 'story_mention':
      case 'story_countdown':
        return storyId ? { kind: 'story', storyId } : null;
      default:
        return null;
    }
  }

  /**
   * Who each notification is from, when the app may say: the other person of
   * a match that is still active, a follower asking, the owner of a Story that
   * mentioned you. 'hidden' drops the row - a block either way. Likes and
   * Roses name nobody here; Likes You is where they are seen.
   */
  private static async actors(userId: string, rows: Array<{ id: string; type: string; data: Prisma.JsonValue }>) {
    const out = new Map<string, Actor | 'hidden'>();
    const matchIds = new Set<string>();
    const followIds = new Set<string>();
    const storyIds = new Set<string>();
    for (const row of rows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      if (['message', 'reaction', 'match'].includes(row.type) && typeof data.matchId === 'string') matchIds.add(data.matchId);
      if (row.type === 'follow_request' && typeof data.followId === 'string') followIds.add(data.followId);
      if (row.type === 'story_mention' && typeof data.storyId === 'string') storyIds.add(data.storyId);
    }
    const [matches, follows, stories, blocks] = await Promise.all([
      matchIds.size
        ? prisma.match.findMany({ where: { id: { in: [...matchIds] } }, select: { id: true, status: true, user1Id: true, user2Id: true } })
        : Promise.resolve([]),
      followIds.size
        ? prisma.follow.findMany({ where: { id: { in: [...followIds] } }, select: { id: true, followerId: true } })
        : Promise.resolve([]),
      storyIds.size
        ? prisma.story.findMany({ where: { id: { in: [...storyIds] } }, select: { id: true, ownerId: true } })
        : Promise.resolve([]),
      prisma.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } }),
    ]);
    const blocked = new Set(blocks.flatMap((block) => [block.blockerId, block.blockedId]));
    blocked.delete(userId);
    const personOfMatch = new Map(matches.map((match) => [match.id, {
      id: match.user1Id === userId ? match.user2Id : match.user1Id,
      active: match.status === 'active',
    }]));
    const personOfFollow = new Map(follows.map((follow) => [follow.id, follow.followerId]));
    const personOfStory = new Map(stories.map((story) => [story.id, story.ownerId]));
    const ids = new Set<string>([
      ...[...personOfMatch.values()].map((entry) => entry.id),
      ...personOfFollow.values(),
      ...personOfStory.values(),
    ]);
    const users = ids.size
      ? await prisma.user.findMany({ where: { id: { in: [...ids] }, accountStatus: 'active' }, select: { id: true, name: true, avatarUrl: true } })
      : [];
    const userOf = new Map(users.map((user) => [user.id, {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl ? transformToCdnUrl(user.avatarUrl) : null,
    }]));
    for (const row of rows) {
      const data = (row.data ?? {}) as Record<string, unknown>;
      let personId: string | null = null;
      if (typeof data.matchId === 'string' && personOfMatch.has(data.matchId)) {
        const entry = personOfMatch.get(data.matchId)!;
        // An ended match names nobody: the row stays, as a plain notice.
        personId = entry.active ? entry.id : null;
        if (blocked.has(entry.id)) {
          out.set(row.id, 'hidden');
          continue;
        }
      } else if (row.type === 'follow_request' && typeof data.followId === 'string') {
        personId = personOfFollow.get(data.followId) ?? null;
      } else if (row.type === 'story_mention' && typeof data.storyId === 'string') {
        personId = personOfStory.get(data.storyId) ?? null;
      }
      if (personId && blocked.has(personId)) {
        out.set(row.id, 'hidden');
        continue;
      }
      const person = personId ? userOf.get(personId) : undefined;
      if (person) out.set(row.id, person);
    }
    return out;
  }
}
