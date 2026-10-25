import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

/**
 * Who may see a Story (Part 2 of the Stories spec).
 *
 * One place decides this for every route, so the tray, a single Story, its
 * media, replies, stickers and Add Yours threads can never disagree.
 *
 * A viewer V may see a Story S owned by O when:
 *   1. V is O, or V follows O (accepted) or V and O have an active match;
 *   2. no block exists between them, either way;
 *   3. V is not on O's "Hide story from" list;
 *   4. if S is a Close Friends Story, V is on O's Close Friends list.
 *
 * Muting is deliberately not part of this: a muted author is left out of the
 * tray, but their Stories still open from their profile or a link.
 */

export const STORY_AUDIENCES = ['followers', 'close_friends'] as const;
export type StoryAudience = (typeof STORY_AUDIENCES)[number];

export type StoryVisibility = {
  viewerId: string;
  /** Owners whose ordinary Stories this viewer may see. Excludes the viewer. */
  audience: Set<string>;
  /** Owners whose Close Friends list includes this viewer. */
  closeFriendOf: Set<string>;
  /** Owners this viewer has muted. Kept out of the tray only. */
  muted: Set<string>;
};

type StoryLike = { ownerId: string; audience: string };
type EndedStoryLike = StoryLike & { state: string };

export class StoryVisibilityService {
  /** Everything needed to judge any number of Stories for one viewer. */
  static async load(viewerId: string): Promise<StoryVisibility> {
    const [follows, matches, blocks, hidden, closeFriends, muted] = await Promise.all([
      prisma.follow.findMany({ where: { followerId: viewerId, status: 'accepted' }, select: { followeeId: true } }),
      prisma.match.findMany({
        where: { status: 'active', OR: [{ user1Id: viewerId }, { user2Id: viewerId }] },
        select: { user1Id: true, user2Id: true },
      }),
      prisma.userBlock.findMany({ where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] }, select: { blockerId: true, blockedId: true } }),
      prisma.storyHiddenFrom.findMany({ where: { hiddenUserId: viewerId }, select: { ownerId: true } }),
      prisma.storyCloseFriend.findMany({ where: { friendId: viewerId }, select: { ownerId: true } }),
      prisma.storyPreference.findMany({ where: { viewerId, mutedUntil: { gt: new Date() } }, select: { authorId: true } }),
    ]);
    const blocked = new Set(blocks.flatMap((block) => [block.blockerId, block.blockedId]));
    blocked.delete(viewerId);
    const hiddenBy = new Set(hidden.map((row) => row.ownerId));
    const audience = new Set<string>();
    for (const follow of follows) audience.add(follow.followeeId);
    for (const match of matches) audience.add(match.user1Id === viewerId ? match.user2Id : match.user1Id);
    audience.delete(viewerId);
    for (const id of [...audience]) {
      if (blocked.has(id) || hiddenBy.has(id)) audience.delete(id);
    }
    return {
      viewerId,
      audience,
      closeFriendOf: new Set(closeFriends.map((row) => row.ownerId).filter((id) => audience.has(id))),
      muted: new Set(muted.map((row) => row.authorId)),
    };
  }

  /** True when this viewer may see this Story, given a loaded visibility. */
  static canSee(visibility: StoryVisibility, story: StoryLike): boolean {
    if (story.ownerId === visibility.viewerId) return true;
    if (!visibility.audience.has(story.ownerId)) return false;
    return story.audience !== 'close_friends' || visibility.closeFriendOf.has(story.ownerId);
  }

  /** The same judgement for a single Story, loading what it needs. */
  static async check(viewerId: string, story: StoryLike): Promise<boolean> {
    if (story.ownerId === viewerId) return true;
    const visibility = await this.load(viewerId);
    return this.canSee(visibility, story);
  }

  /**
   * The Part 3 rule for a Story that has already ended (Archive, an owner
   * reopening their own story card in chat): with no Highlights, the Archive
   * is private, so an ended Story is visible to nobody but its owner, however
   * recently it ended and however clearly they were in its live audience. The
   * row must still be `published` - a deleted or purged Story is never
   * reachable this way.
   */
  static canSeeEnded(viewerId: string, story: EndedStoryLike): boolean {
    return story.state === 'published' && story.ownerId === viewerId;
  }

  /**
   * A `where` for Story queries: the viewer's own, plus everyone whose Stories
   * they may see. `excludeMuted` is for the tray, where muted authors drop out.
   */
  static filter(visibility: StoryVisibility, options: { excludeMuted?: boolean } = {}): Prisma.StoryWhereInput {
    const audience = [...visibility.audience].filter((id) => !options.excludeMuted || !visibility.muted.has(id));
    const closeFriendOf = [...visibility.closeFriendOf].filter((id) => !options.excludeMuted || !visibility.muted.has(id));
    return {
      OR: [
        { ownerId: visibility.viewerId },
        {
          ownerId: { in: audience },
          OR: [{ audience: { not: 'close_friends' } }, { ownerId: { in: closeFriendOf } }],
        },
      ],
    };
  }

  /** Whether a Story may be shared with these people, used when mentions are checked. */
  static async audienceOf(ownerId: string): Promise<Set<string>> {
    const [followers, matches, blocks, hidden] = await Promise.all([
      prisma.follow.findMany({ where: { followeeId: ownerId, status: 'accepted' }, select: { followerId: true } }),
      prisma.match.findMany({
        where: { status: 'active', OR: [{ user1Id: ownerId }, { user2Id: ownerId }] },
        select: { user1Id: true, user2Id: true },
      }),
      prisma.userBlock.findMany({ where: { OR: [{ blockerId: ownerId }, { blockedId: ownerId }] }, select: { blockerId: true, blockedId: true } }),
      prisma.storyHiddenFrom.findMany({ where: { ownerId }, select: { hiddenUserId: true } }),
    ]);
    const blocked = new Set(blocks.flatMap((block) => [block.blockerId, block.blockedId]));
    const hiddenIds = new Set(hidden.map((row) => row.hiddenUserId));
    const ids = new Set<string>([
      ...followers.map((row) => row.followerId),
      ...matches.map((row) => (row.user1Id === ownerId ? row.user2Id : row.user1Id)),
    ]);
    ids.delete(ownerId);
    return new Set([...ids].filter((id) => !blocked.has(id) && !hiddenIds.has(id)));
  }

  /** The owner's Close Friends, as ids. */
  static async closeFriendIds(ownerId: string): Promise<Set<string>> {
    const rows = await prisma.storyCloseFriend.findMany({ where: { ownerId }, select: { friendId: true } });
    return new Set(rows.map((row) => row.friendId));
  }

  /** Who may see a Story with this audience, for mention checks before publishing. */
  static async recipientsFor(ownerId: string, audience: StoryAudience): Promise<Set<string>> {
    const people = await this.audienceOf(ownerId);
    if (audience !== 'close_friends') return people;
    const closeFriends = await this.closeFriendIds(ownerId);
    return new Set([...people].filter((id) => closeFriends.has(id)));
  }
}
