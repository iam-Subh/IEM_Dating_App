import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { STORY_SETTINGS_SELECT, StoryService, storySettingsOf } from './story.service';

/** A ring may have changed for these people: tell them, never why (fire and forget). */
function nudge(ownerId: string, viewerIds: string[]) {
  void StoryService.nudgeRelationship(ownerId, viewerIds).catch(() => undefined);
}

export type AudienceList = 'close_friends' | 'hidden';

const PAGE_SIZE = 50;

/** An offset cursor over a list that is sorted in memory. */
function pageOf<T>(items: T[], cursor?: string) {
  const start = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
  const page = items.slice(start, start + PAGE_SIZE);
  return { page, nextCursor: start + PAGE_SIZE < items.length ? String(start + PAGE_SIZE) : null };
}

/**
 * The people a Story owner can choose from, and their own lists (Part 2 of
 * the Stories spec): Close Friends, Hide story from, and muted authors, plus
 * the Story settings screen's summary.
 *
 * Every list is private to its owner. Nothing here ever reads another
 * person's list, and nobody is told when they are added or removed.
 */
export class StoryAudienceService {
  /** All Story settings, with the counts shown beside each row. */
  static async settings(userId: string) {
    const [user, closeFriends, hidden, muted, followers, following, followRequests] = await Promise.all([
      prisma.user.findFirst({ where: { id: userId, accountStatus: 'active' }, select: STORY_SETTINGS_SELECT }),
      prisma.storyCloseFriend.count({ where: { ownerId: userId } }),
      prisma.storyHiddenFrom.count({ where: { ownerId: userId } }),
      prisma.storyPreference.count({ where: { viewerId: userId, mutedUntil: { gt: new Date() } } }),
      prisma.follow.count({ where: { followeeId: userId, status: 'accepted' } }),
      prisma.follow.count({ where: { followerId: userId, status: 'accepted' } }),
      prisma.follow.count({ where: { followeeId: userId, status: 'pending' } }),
    ]);
    if (!user) throw new HttpError(404, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
    return { ...storySettingsOf(user), counts: { closeFriends, hidden, muted, followers, following, followRequests } };
  }

  /**
   * Followers and matches, with what the owner needs to pick from them: who
   * matched, who follows, when they last connected, and each list's rows.
   */
  private static async relationships(ownerId: string) {
    const [followers, matches, blocks, hiddenRows, closeFriendRows] = await Promise.all([
      prisma.follow.findMany({ where: { followeeId: ownerId, status: 'accepted' }, select: { followerId: true, respondedAt: true, requestedAt: true } }),
      prisma.match.findMany({
        where: { status: 'active', OR: [{ user1Id: ownerId }, { user2Id: ownerId }] },
        select: { user1Id: true, user2Id: true, createdAt: true },
      }),
      prisma.userBlock.findMany({ where: { OR: [{ blockerId: ownerId }, { blockedId: ownerId }] }, select: { blockerId: true, blockedId: true } }),
      prisma.storyHiddenFrom.findMany({ where: { ownerId }, select: { hiddenUserId: true, createdAt: true } }),
      prisma.storyCloseFriend.findMany({ where: { ownerId }, select: { friendId: true, createdAt: true } }),
    ]);
    const blocked = new Set(blocks.flatMap((block) => [block.blockerId, block.blockedId]));
    blocked.delete(ownerId);
    const followsYou = new Set<string>();
    const matched = new Set<string>();
    const connectedAt = new Map<string, number>();
    const touch = (id: string, at: Date | null) => {
      const time = at ? at.getTime() : 0;
      connectedAt.set(id, Math.max(connectedAt.get(id) ?? 0, time));
    };
    for (const follow of followers) {
      followsYou.add(follow.followerId);
      touch(follow.followerId, follow.respondedAt ?? follow.requestedAt);
    }
    for (const match of matches) {
      const other = match.user1Id === ownerId ? match.user2Id : match.user1Id;
      matched.add(other);
      touch(other, match.createdAt);
    }
    // Everyone who can see "Your story", before the hidden list is applied.
    const reachable = new Set([...followsYou, ...matched].filter((id) => id !== ownerId && !blocked.has(id)));
    return {
      blocked,
      followsYou,
      matched,
      reachable,
      connectedAt,
      hidden: new Map(hiddenRows.map((row) => [row.hiddenUserId, row.createdAt])),
      closeFriends: new Map(closeFriendRows.map((row) => [row.friendId, row.createdAt])),
    };
  }

  /**
   * People for a list editor: those already on the list first, then everyone
   * else by how recently you connected. Close Friends can be chosen from your
   * audience; "Hide story from" from everyone who can reach your Stories.
   */
  static async people(ownerId: string, list: AudienceList, query: string, cursor?: string) {
    const ties = await this.relationships(ownerId);
    const onList = list === 'close_friends' ? ties.closeFriends : ties.hidden;
    const candidates = new Set<string>(
      list === 'close_friends'
        ? [...ties.reachable].filter((id) => !ties.hidden.has(id))
        : [...ties.reachable],
    );
    // Rows already on the list stay visible even after the person drifted out of your audience.
    for (const id of onList.keys()) if (!ties.blocked.has(id)) candidates.add(id);
    candidates.delete(ownerId);
    const q = query.trim();
    const users = candidates.size
      ? await prisma.user.findMany({
        where: { id: { in: [...candidates] }, accountStatus: 'active', ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
        select: { id: true, name: true, avatarUrl: true },
      })
      : [];
    const rows = users.map((user) => ({
      ...user,
      onList: onList.has(user.id),
      isMatch: ties.matched.has(user.id),
      followsYou: ties.followsYou.has(user.id),
      inAudience: ties.reachable.has(user.id) && !(list === 'close_friends' && ties.hidden.has(user.id)),
    }));
    rows.sort((first, second) => {
      if (first.onList !== second.onList) return first.onList ? -1 : 1;
      const recent = (ties.connectedAt.get(second.id) ?? 0) - (ties.connectedAt.get(first.id) ?? 0);
      return recent || first.name.localeCompare(second.name);
    });
    const { page, nextCursor } = pageOf(rows, cursor);
    return { people: page, nextCursor, total: rows.length };
  }

  /** The owner's own list, newest first. Inactive rows are kept and flagged. */
  static async list(ownerId: string, list: AudienceList, cursor?: string) {
    const ties = await this.relationships(ownerId);
    const rows = [...(list === 'close_friends' ? ties.closeFriends : ties.hidden).entries()]
      .filter(([id]) => !ties.blocked.has(id))
      .sort((first, second) => second[1].getTime() - first[1].getTime());
    const users = rows.length
      ? await prisma.user.findMany({ where: { id: { in: rows.map(([id]) => id) }, accountStatus: 'active' }, select: { id: true, name: true, avatarUrl: true } })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    const people = rows.flatMap(([id, addedAt]) => {
      const user = byId.get(id);
      if (!user) return [];
      return [{
        ...user,
        addedAt,
        isMatch: ties.matched.has(id),
        followsYou: ties.followsYou.has(id),
        inAudience: ties.reachable.has(id) && !(list === 'close_friends' && ties.hidden.has(id)),
      }];
    });
    const { page, nextCursor } = pageOf(people, cursor);
    return { people: page, nextCursor, total: people.length };
  }

  static async addCloseFriend(ownerId: string, friendId: string) {
    if (friendId === ownerId) throw new HttpError(400, 'You cannot add yourself', 'CLOSE_FRIEND_INVALID');
    const ties = await this.relationships(ownerId);
    const active = await prisma.user.count({ where: { id: friendId, accountStatus: 'active' } });
    if (!active || !ties.reachable.has(friendId) || ties.hidden.has(friendId)) {
      throw new HttpError(422, 'You can add people who follow you or have matched with you', 'CLOSE_FRIEND_NOT_IN_AUDIENCE');
    }
    await prisma.storyCloseFriend.createMany({ data: [{ ownerId, friendId }], skipDuplicates: true });
    nudge(ownerId, [friendId]);
    return { userId: friendId, onList: true };
  }

  static async removeCloseFriend(ownerId: string, friendId: string) {
    await prisma.storyCloseFriend.deleteMany({ where: { ownerId, friendId } });
    nudge(ownerId, [friendId]);
    return { userId: friendId, onList: false };
  }

  static async clearCloseFriends(ownerId: string) {
    const friends = await prisma.storyCloseFriend.findMany({ where: { ownerId }, select: { friendId: true } });
    const { count } = await prisma.storyCloseFriend.deleteMany({ where: { ownerId } });
    nudge(ownerId, friends.map((row) => row.friendId));
    return { removed: count };
  }

  /**
   * Hides your Stories from someone. They stay a follower or match and can
   * still message you; they simply see none of your Stories, Close Friends
   * ones included. Hiding also takes them off Close Friends.
   */
  static async hide(ownerId: string, userId: string) {
    if (userId === ownerId) throw new HttpError(400, 'You cannot hide your story from yourself', 'STORY_HIDE_INVALID');
    const active = await prisma.user.count({ where: { id: userId, accountStatus: 'active' } });
    if (!active) throw new HttpError(404, 'This person is unavailable', 'PERSON_UNAVAILABLE');
    await prisma.$transaction([
      prisma.storyHiddenFrom.createMany({ data: [{ ownerId, hiddenUserId: userId }], skipDuplicates: true }),
      prisma.storyCloseFriend.deleteMany({ where: { ownerId, friendId: userId } }),
    ]);
    nudge(ownerId, [userId]);
    return { userId, hidden: true };
  }

  static async unhide(ownerId: string, userId: string) {
    await prisma.storyHiddenFrom.deleteMany({ where: { ownerId, hiddenUserId: userId } });
    nudge(ownerId, [userId]);
    return { userId, hidden: false };
  }

  /** Authors you have muted, most recently muted first is not recorded, so by name. */
  static async muted(viewerId: string, cursor?: string) {
    const rows = await prisma.storyPreference.findMany({ where: { viewerId, mutedUntil: { gt: new Date() } }, select: { authorId: true } });
    const users = rows.length
      ? await prisma.user.findMany({ where: { id: { in: rows.map((row) => row.authorId) }, accountStatus: 'active' }, select: { id: true, name: true, avatarUrl: true }, orderBy: { name: 'asc' } })
      : [];
    const { page, nextCursor } = pageOf(users, cursor);
    return { people: page, nextCursor, total: users.length };
  }
}
