import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { transformToCdnUrl } from '../middlewares/upload.middleware';
import { INTEREST_CATEGORIES, normalizeInterests } from '@iem-dating/shared/interest-catalog';
import { StoryService } from './story.service';

/**
 * New matches, as Tinder shows them: the matches where nobody has said
 * anything yet, above the conversations. The first message from either side
 * moves a match down into Messages. Nothing expires - Bumble's 24 hours would
 * quietly erase matches in a small college.
 */

const INTEREST_LABEL = new Map(INTEREST_CATEGORIES.flatMap((category) => category.interests.map((item) => [item.id, item.label])));
const labelOf = (id: string) => INTEREST_LABEL.get(id) ?? id;
const interestsOf = (preferences: unknown) =>
  normalizeInterests(preferences && typeof preferences === 'object' ? (preferences as Record<string, unknown>).interests : undefined);

const avatarOf = (user: { avatarUrl: string | null; photos: { photoUrl: string }[] }) => {
  const url = user.photos[0]?.photoUrl ?? user.avatarUrl;
  return url ? transformToCdnUrl(url) : null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A malformed id is the same answer as any other unavailable match. */
function requireId(matchId: string) {
  if (!UUID.test(matchId)) throw new HttpError(404, 'Match is unavailable', 'MATCH_UNAVAILABLE');
}

const personSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  department: true,
  preferences: true,
  photos: { where: { isPrimary: true }, select: { photoUrl: true }, take: 1 },
} as const;

export class NewMatchService {
  /** Matches with no message yet, newest first, each with its "new" dot and Story ring. */
  static async list(userId: string) {
    const matches = await prisma.match.findMany({
      where: {
        status: 'active',
        OR: [{ user1Id: userId }, { user2Id: userId }],
        // Not one message from either person, deleted ones included: once a
        // conversation has started, it lives in Messages.
        messages: { none: {} },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user1: { select: personSelect }, user2: { select: personSelect } },
    });
    const others = matches.map((match) => (match.user1Id === userId ? match.user2 : match.user1));
    const rings = await StoryService.ringsFor(userId, others.map((other) => other.id)).catch(() => new Map());
    return matches.map((match, index) => {
      const other = others[index];
      const mine = match.user1Id === userId ? match.user1SeenAt : match.user2SeenAt;
      return {
        matchId: match.id,
        matchedAt: match.createdAt.toISOString(),
        isNew: !mine,
        user: { id: other.id, name: other.name, avatar: avatarOf(other) },
        story: rings.get(other.id) ?? null,
      };
    });
  }

  /** Opened: the "new" dot goes, on every device. */
  static async markSeen(userId: string, matchId: string) {
    requireId(matchId);
    const match = await prisma.match.findFirst({
      where: { id: matchId, status: 'active', OR: [{ user1Id: userId }, { user2Id: userId }] },
      select: { user1Id: true, user1SeenAt: true, user2SeenAt: true },
    });
    if (!match) throw new HttpError(404, 'Match is unavailable', 'MATCH_UNAVAILABLE');
    const mineIsFirst = match.user1Id === userId;
    if (mineIsFirst ? match.user1SeenAt : match.user2SeenAt) return { seen: true };
    await prisma.match.update({
      where: { id: matchId },
      data: mineIsFirst ? { user1SeenAt: new Date() } : { user2SeenAt: new Date() },
    });
    return { seen: true };
  }

  /**
   * What an empty chat opens with: who, since when, what brought you
   * together - a Rose, shared interests - and a few ways to start.
   */
  static async intro(userId: string, matchId: string) {
    requireId(matchId);
    const match = await prisma.match.findFirst({
      where: { id: matchId, status: 'active', OR: [{ user1Id: userId }, { user2Id: userId }] },
      include: { user1: { select: personSelect }, user2: { select: personSelect } },
    });
    if (!match) throw new HttpError(404, 'Match is unavailable', 'MATCH_UNAVAILABLE');
    const [me, other] = match.user1Id === userId ? [match.user1, match.user2] : [match.user2, match.user1];
    const [rose, rings] = await Promise.all([
      prisma.rose.findFirst({
        where: { OR: [{ senderId: userId, recipientId: other.id }, { senderId: other.id, recipientId: userId }] },
        orderBy: { createdAt: 'desc' },
        select: { senderId: true },
      }),
      StoryService.ringsFor(userId, [other.id]).catch(() => new Map()),
    ]);
    const mine = new Set(interestsOf(me.preferences));
    const theirs = interestsOf(other.preferences);
    const shared = theirs.filter((id) => mine.has(id)).map(labelOf);
    const firstName = other.name.split(/\s+/)[0];
    return {
      matchId,
      matchedAt: match.createdAt.toISOString(),
      other: { id: other.id, name: other.name, avatar: avatarOf(other), department: other.department },
      story: rings.get(other.id) ?? null,
      rose: rose ? { from: rose.senderId === userId ? ('me' as const) : ('them' as const) } : null,
      sharedInterests: shared.slice(0, 4),
      self: { avatar: avatarOf(me) },
      openers: this.openers(firstName, shared, theirs.map(labelOf), other.department),
    };
  }

  /** A few ways to start, from what the two of you share, then from what they like. */
  private static openers(firstName: string, shared: string[], theirs: string[], department: string | null) {
    const out: string[] = [];
    if (shared[0]) out.push(`You're into ${shared[0]} too! How did you get into it?`);
    if (shared[1]) out.push(`${shared[1]} or ${shared[0]}: which one wins?`);
    const other = theirs.find((label) => !shared.includes(label));
    if (other && out.length < 2) out.push(`I saw you like ${other}. What's the best thing about it?`);
    if (department && out.length < 3) out.push(`How's ${department} treating you this semester?`);
    if (out.length < 3) out.push(`Hey ${firstName}! What's your go-to spot on campus?`);
    return out.slice(0, 3);
  }
}
