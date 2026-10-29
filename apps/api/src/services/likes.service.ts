import { LikeCommentService, type CommentShown } from './like-comment.service';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { AlgorithmConfigService } from './algorithm-config.service';
import { discoveryProfileSelect, publicProfile } from './public-profile.service';
import { datingProfileReady, likeBackSql } from './eligibility.service';
import { REWIND_WINDOW_SECONDS } from './rewind.service';
import { getIO } from '../socket';
import { NotificationFeedService } from './notification-feed.service';

/**
 * Likes You (STANDOUTS_LIKES_SPEC.md section 4): the people who have liked
 * you and are still waiting on your answer.
 *
 * Who is listed is `likeBackSql` - the same rule the swipe accepts a Like
 * back under (`likeBackAllowed`) - so every card here can be answered. The
 * first version listed every unanswered Like and the swipe then re-checked
 * full eligibility, so a sender who had since moved out of range left a card
 * that failed on every attempt.
 *
 * Roses are read on their own, so they sit on top however many Likes arrived
 * after them; the ordinary Likes are paged underneath in the chosen sort.
 */

const PAGE_SIZE = 20;
/** At most 20 Roses a week can be sent to anyone, so this is a ceiling, not a page. */
const ROSES_MAX = 50;
/** "Your type" is ranked in memory, over this many of the newest Likes. */
const TYPE_POOL = 200;

/**
 * A Like shows up only once its sender's Rewind window has closed. Likes You
 * is live, so without this a Like taken back within the window would appear
 * and then vanish - telling the recipient someone liked them and changed
 * their mind. The live nudge and the push wait the same time.
 */
export const LIKE_GRACE_MS = (REWIND_WINDOW_SECONDS + 1) * 1000;

/**
 * Likes sent before this are "seen". A Like becomes visible LIKE_GRACE_MS
 * after it is sent, so one sent just before you opened Likes You, but shown
 * only after, is still new: compared by when it became visible, not sent.
 */
export function seenCutoff(likesSeenAt: Date | null) {
  return likesSeenAt ? new Date(likesSeenAt.getTime() - LIKE_GRACE_MS) : new Date(0);
}

export const LIKES_SORTS = ['recent', 'type'] as const;
export type LikesSort = (typeof LIKES_SORTS)[number];

type Incoming = { id: string; liked_at: Date; rose_id: string | null; rose_comment: string | null; verified?: number };

/**
 * 1 when the sender holds a valid college verification, else 0: Likes and
 * Roses from unverified accounts are listed after verified ones
 * (GOOGLE_SIGNUP_PLAN.md 3) - shown, never hidden.
 */
const VERIFIED_SENDER = Prisma.sql`(CASE WHEN EXISTS (SELECT 1 FROM student_memberships sm
  WHERE sm.user_id = s.swiper_id AND sm.status = 'verified' AND sm.verified_at IS NOT NULL
    AND (sm.expires_at IS NULL OR sm.expires_at > now())) THEN 1 ELSE 0 END)`;

export class LikesService {
  /** Unanswered incoming Likes that can be answered, as SQL over `s` (the Like) and `u` (the sender). */
  private static pending(meId: string, rule: Prisma.Sql) {
    return Prisma.sql`s.target_id = ${meId}::uuid AND s.action = 'like' AND ${rule}
      AND s.created_at <= ${new Date(Date.now() - LIKE_GRACE_MS)}
      AND NOT EXISTS (SELECT 1 FROM swipes mine WHERE mine.swiper_id = ${meId}::uuid AND mine.target_id = s.swiper_id)
      AND NOT EXISTS (SELECT 1 FROM matches m WHERE
        (m.user1_id = ${meId}::uuid AND m.user2_id = s.swiper_id) OR (m.user2_id = ${meId}::uuid AND m.user1_id = s.swiper_id))`;
  }

  /** The Rose that rode on this Like, if any. */
  private static roseJoin(meId: string) {
    return Prisma.sql`LEFT JOIN LATERAL (
      SELECT r.id, r.comment FROM roses r
      WHERE r.recipient_id = ${meId}::uuid AND r.sender_id = s.swiper_id AND (r.swipe_id = s.id OR r.swipe_id IS NULL)
      ORDER BY r.created_at DESC LIMIT 1) rose ON true`;
  }

  static async received(userId: string, options: { sort?: LikesSort; cursor?: string; limit?: number } = {}) {
    const sort: LikesSort = options.sort ?? 'recent';
    const take = Math.min(Math.max(Math.floor(options.limit ?? PAGE_SIZE) || PAGE_SIZE, 1), 40);
    const empty = { roses: [], likes: [], nextCursor: null as string | null, sort, roseCount: 0 };
    const me = await prisma.user.findUnique({ where: { id: userId } });
    if (!me || !datingProfileReady(me)) return empty;

    const where = this.pending(me.id, likeBackSql(me));
    const rose = this.roseJoin(me.id);
    const firstPage = !options.cursor;

    const roses = firstPage
      ? await prisma.$queryRaw<Incoming[]>`
          SELECT s.swiper_id AS id, s.created_at AS liked_at, rose.id AS rose_id, rose.comment AS rose_comment
          FROM swipes s JOIN users u ON u.id = s.swiper_id ${rose}
          WHERE ${where} AND rose.id IS NOT NULL
          ORDER BY ${VERIFIED_SENDER} DESC, s.created_at DESC, s.swiper_id DESC
          LIMIT ${ROSES_MAX}`
      : [];

    let likes: Incoming[];
    let nextCursor: string | null = null;
    if (sort === 'recent') {
      const after = this.recentCursor(options.cursor);
      const rows = await prisma.$queryRaw<Incoming[]>`
        SELECT s.swiper_id AS id, s.created_at AS liked_at, NULL::uuid AS rose_id, NULL::text AS rose_comment,
          ${VERIFIED_SENDER} AS verified
        FROM swipes s JOIN users u ON u.id = s.swiper_id ${rose}
        WHERE ${where} AND rose.id IS NULL
          ${after ? Prisma.sql`AND (${VERIFIED_SENDER}, s.created_at, s.swiper_id) < (${after.verified}, ${after.at}, ${after.id}::uuid)` : Prisma.empty}
        ORDER BY ${VERIFIED_SENDER} DESC, s.created_at DESC, s.swiper_id DESC
        LIMIT ${take + 1}`;
      likes = rows.slice(0, take);
      const last = likes[likes.length - 1];
      if (rows.length > take && last) nextCursor = `r:${last.verified ?? 1}:${last.liked_at.toISOString()}:${last.id}`;
    } else {
      const offset = this.typeCursor(options.cursor);
      const pool = await prisma.$queryRaw<Incoming[]>`
        SELECT s.swiper_id AS id, s.created_at AS liked_at, NULL::uuid AS rose_id, NULL::text AS rose_comment,
          ${VERIFIED_SENDER} AS verified
        FROM swipes s JOIN users u ON u.id = s.swiper_id ${rose}
        WHERE ${where} AND rose.id IS NULL
        ORDER BY s.created_at DESC, s.swiper_id DESC
        LIMIT ${TYPE_POOL}`;
      const scores = await this.scores(me.id, pool.map((row) => row.id));
      const ranked = [...pool].sort(
        (a, b) => (b.verified ?? 1) - (a.verified ?? 1) ||
          (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1) || b.liked_at.getTime() - a.liked_at.getTime(),
      );
      likes = ranked.slice(offset, offset + take);
      if (ranked.length > offset + take) nextCursor = `t:${offset + take}`;
    }

    const [cards, counts] = await Promise.all([
      this.cards(me.id, [...roses, ...likes], seenCutoff(me.likesSeenAt)),
      // The section headers' numbers, whatever page this is.
      firstPage ? this.summary(userId) : Promise.resolve(null),
    ]);
    return {
      roses: roses.flatMap((row) => cards.get(row.id) ?? []),
      likes: likes.flatMap((row) => cards.get(row.id) ?? []),
      nextCursor,
      sort,
      roseCount: roses.length,
      counts,
    };
  }

  /** For the heart in the Explore header: something new, and whether a Rose is among it (4.4). */
  static async summary(userId: string) {
    const me = await prisma.user.findUnique({ where: { id: userId } });
    if (!me || !datingProfileReady(me)) return { total: 0, roses: 0, likes: 0, unseen: 0, unseenRoses: 0, rosesReceived: 0 };
    const seen = seenCutoff(me.likesSeenAt);
    const [row] = await prisma.$queryRaw<{ total: number; roses: number; unseen: number; unseen_roses: number }[]>`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE rose.id IS NOT NULL)::int AS roses,
        COUNT(*) FILTER (WHERE s.created_at > ${seen})::int AS unseen,
        COUNT(*) FILTER (WHERE s.created_at > ${seen} AND rose.id IS NOT NULL)::int AS unseen_roses
      FROM swipes s JOIN users u ON u.id = s.swiper_id ${this.roseJoin(me.id)}
      WHERE ${this.pending(me.id, likeBackSql(me))}`;
    const total = row?.total ?? 0;
    const roses = row?.roses ?? 0;
    // Every Rose you have ever received, answered or not - yours alone to
    // see, never shown on your profile to anyone. A Rose still inside its
    // sender's Rewind window is not counted yet, so the number never drops.
    const rosesReceived = await prisma.rose.count({
      where: { recipientId: me.id, createdAt: { lte: new Date(Date.now() - LIKE_GRACE_MS) } },
    });
    return { total, roses, likes: total - roses, unseen: row?.unseen ?? 0, unseenRoses: row?.unseen_roses ?? 0, rosesReceived };
  }

  /**
   * "Your Likes You changed - re-read it", live, to each of these people's
   * devices: a new Like landed, one was answered on another device, or a
   * block took one away. It carries nothing; the app re-reads the list
   * through the same rules, so the event can never say more than the list.
   */
  static nudge(userIds: string[]) {
    const io = getIO();
    if (!io) return;
    for (const id of new Set(userIds)) io.to(`user:${id}`).emit('likes_changed', {});
  }

  /** Opening Likes You marks everything that has arrived so far as seen. */
  static async markSeen(userId: string) {
    await prisma.user.update({ where: { id: userId }, data: { likesSeenAt: new Date() } });
    // Seen in Likes You, so read in the notification centre too.
    NotificationFeedService.readWhere(userId, ['like', 'rose']);
  }

  private static recentCursor(cursor?: string) {
    if (!cursor) return null;
    // r:<verified 1|0>:<liked at>:<id>; an older cursor without the group reads as verified.
    const match = /^r:(?:([01]):)?(.+):([0-9a-f-]{36})$/i.exec(cursor);
    const at = match ? new Date(match[2]) : null;
    if (!match || !at || Number.isNaN(at.getTime())) throw new HttpError(400, 'Cursor is invalid', 'INVALID_LIKES_CURSOR');
    return { verified: match[1] === undefined ? 1 : Number(match[1]), at, id: match[3] };
  }

  private static typeCursor(cursor?: string) {
    if (!cursor) return 0;
    const match = /^t:(\d{1,4})$/.exec(cursor);
    if (!match) throw new HttpError(400, 'Cursor is invalid', 'INVALID_LIKES_CURSOR');
    return Number(match[1]);
  }

  private static async scores(meId: string, ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const [viewer, profiles, config] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: meId }, select: discoveryProfileSelect }),
      prisma.user.findMany({ where: { id: { in: ids } }, select: discoveryProfileSelect }),
      AlgorithmConfigService.get(),
    ]);
    return new Map(
      profiles.map((profile) => [profile.id, publicProfile(viewer, profile, config.weights).compatibilityScore ?? -1]),
    );
  }

  private static async cards(meId: string, rows: Incoming[], seen: Date) {
    const out = new Map<string, ReturnType<typeof publicProfile> & {
      likedAt: string; isRose: boolean; roseId: string | null; roseComment: string | null; isNew: boolean;
      comment: CommentShown | null;
    }>();
    if (!rows.length) return out;
    const [viewer, profiles, config, comments] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: meId }, select: discoveryProfileSelect }),
      prisma.user.findMany({ where: { id: { in: rows.map((row) => row.id) } }, select: discoveryProfileSelect }),
      AlgorithmConfigService.get(),
      LikeCommentService.received(meId, rows.map((row) => row.id)),
    ]);
    for (const row of rows) {
      const profile = profiles.find((entry) => entry.id === row.id);
      if (!profile) continue;
      out.set(row.id, {
        ...publicProfile(viewer, profile, config.weights),
        likedAt: row.liked_at.toISOString(),
        isRose: !!row.rose_id,
        roseId: row.rose_id,
        roseComment: row.rose_comment,
        // A comment on a photo or the bio; for a Rose sent with one, the same words as roseComment.
        comment: comments.get(row.id) ?? null,
        // Arrived since you last opened Likes You: a "New" mark on the card.
        isNew: row.liked_at > seen,
      });
    }
    return out;
  }
}
