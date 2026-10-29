import { blueBadge } from './blue-badge';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { HttpError } from '../utils/httpError';
import { asViewer, eligibleSql, setupComplete, UNDER_AGE_HOLD_SQL } from './eligibility.service';
import { buildCards, istDay, secondsLeftToday } from './discovery-cards.service';
import { StoryService } from './story.service';
import { transformToCdnUrl } from '../middlewares/upload.middleware';

/**
 * Name search over your own verified college (SEARCH_SPEC.md).
 *
 * Search is the social layer: who can be found depends only on college,
 * discoverability, account state and blocks - never on swipes, matches or
 * dating preferences, or the results would read other people's swipes back
 * (section 10). The dating layer is one endpoint that opens exactly where a
 * deck Like would already be allowed, and refuses every other case the same way.
 */

export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_QUERY = 60;
export const SEARCH_RESULT_CAP = 30;
/** Distinct profiles returned per account per day before Search slows and flags (8.3). */
export const SEARCH_DAILY_CEILING = Number(process.env.SEARCH_DAILY_CEILING ?? 400);
/**
 * Before verifying: different people Search may show in a day
 * (GOOGLE_SIGNUP_PLAN.md, Search). People, not searches - the app searches as
 * you type, and people are what a name-collector is after.
 */
export const UNVERIFIED_SEARCH_DAILY_PEOPLE = 30;

/** Who is searching: their college, and - before verifying - the campus they are held to. */
type Searcher = { verified: boolean; institutionId: string; campusId: string | null };
const SLOW_DOWN_MS = 1500;

export type SearchPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  department: string | null;
  year: number | null;
  /**
   * What a classmate recognises someone by (5.1): the college facts already
   * on their profile. Never dating fields - no seeking, bio, match or where
   * they live (hosteller or not).
   */
  degree: string | null;
  yearOfStudy: number | null;
  graduationYear: number | null;
  campus: string | null;
  clubs: string[];
  isVerified: boolean;
  /** College verified and face check passed (blue-badge.ts). */
  blueBadge: boolean;
  followStatus: 'pending' | 'accepted' | null;
  /** They follow you (accepted): "Follows you", and "Follow back" on the button. */
  followsYou: boolean;
  /**
   * How many people you follow also follow them (both accepted): "You both
   * follow 3 people". A number only - never who - and only in search results.
   */
  mutualFollows?: number;
  /**
   * Accepted followers and following - only for someone with Stories on, who
   * has joined the social layer, and who has not turned off "Show follower
   * counts". Null otherwise, never 0, so a hidden count does not read as an
   * empty one. Counts, never the lists (5.4).
   */
  followersCount: number | null;
  followingCount: number | null;
  /** Their Story ring as this viewer may see it; null when there is nothing they may watch. */
  story: { unseen: boolean; closeFriends: boolean; until: string } | null;
  /**
   * Your own dating decision about them, and nothing of theirs: a Like or Rose
   * you sent shows the same whether they saw it, passed or haven't opened the
   * app, so it can't reveal how they answered. A match both of you know.
   */
  dating: MyDatingState | null;
};

export type MyDatingState =
  | { kind: 'matched'; matchId: string; at: string }
  | { kind: 'rose'; at: string }
  | { kind: 'liked'; at: string }
  | { kind: 'passed'; at: string };

type Row = {
  id: string;
  verified: boolean;
  real_person: boolean;
  name: string;
  avatar_url: string | null;
  department: string | null;
  graduation_year: number | null;
  year_of_study: number | null;
  degree: string | null;
  campus_name: string | null;
  clubs: string[] | null;
  follow_status: string | null;
  follows_you: boolean;
  followers_count: number | null;
  following_count: number | null;
};

/** The same normalisation as the SQL `search_name()`: lower case, no accents, single spaces. */
export function searchTokens(query: string): string[] {
  return query
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 4);
}

/** LIKE treats `%`, `_` and `\` specially; a typed name never means them. */
function escapeLike(token: string) {
  return token.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function validMembership(alias: string, now: Date) {
  return Prisma.sql`${Prisma.raw(alias)}.status = 'verified'
    AND ${Prisma.raw(alias)}.verified_at IS NOT NULL
    AND (${Prisma.raw(alias)}.expires_at IS NULL OR ${Prisma.raw(alias)}.expires_at > ${now})`;
}

export class SearchPeopleService {
  static async people(viewerId: string, rawQuery: string, limit = SEARCH_RESULT_CAP) {
    const query = rawQuery.trim().replace(/\s+/g, ' ').slice(0, SEARCH_MAX_QUERY);
    const tokens = searchTokens(query);
    // The app calls on every keystroke, so short input is an empty answer, not an error.
    if (query.length < SEARCH_MIN_QUERY || !tokens.length) return { people: [] as SearchPerson[], truncated: false };
    const cap = Math.min(Math.max(1, Math.floor(limit) || SEARCH_RESULT_CAP), SEARCH_RESULT_CAP);
    const now = new Date();

    // Every token must be a prefix of some word of the name ("sub pat").
    const prefixes = tokens.map(
      (token) => Prisma.sql`search_name(u.name) LIKE ${`% ${escapeLike(token)}%`}`,
    );
    // An exact whole word ranks above a prefix of one (section 6).
    const exact = Prisma.join(
      tokens.map((token) => Prisma.sql`(search_name(u.name) || ' ') LIKE ${`% ${escapeLike(token)} %`}`),
      ' AND ',
    );

    const searcher = await this.searcher(viewerId, now);
    if (!searcher) return { people: [] as SearchPerson[], truncated: false };
    const rows = await this.rows(
      viewerId,
      searcher,
      Prisma.join(prefixes, ' AND '),
      Prisma.sql`(${exact}) DESC,`,
      cap + 1,
      now,
    );

    const truncated = rows.length > cap;
    if (!searcher.verified) await this.requireUnverifiedAllowance(viewerId, rows.slice(0, cap).map((row) => row.id));
    const people = await this.withMutualFollows(viewerId, await this.cards(viewerId, rows.slice(0, cap)));
    await this.countDistinct(viewerId, people.map((person) => person.id));
    return { people, truncated };
  }

  /**
   * One person's social layer, re-read for a live update while it is open
   * (a new photo, a Story posted or removed). Null - the same as not found -
   * when they are no longer findable by this viewer: blocked, discoverability
   * off, account closed. Nothing says which.
   */
  static async person(viewerId: string, targetId: string): Promise<SearchPerson | null> {
    const now = new Date();
    const searcher = await this.searcher(viewerId, now);
    if (!searcher) return null;
    const rows = await this.rows(viewerId, searcher, Prisma.sql`u.id = ${targetId}::uuid`, Prisma.empty, 1, now);
    if (!rows.length) return null;
    const [person] = await this.cards(viewerId, rows);
    return person ?? null;
  }

  /**
   * The searcher: a verified student's college; or, before verifying, the
   * college and campus they chose - Search then reaches that campus only,
   * as Discover does (GOOGLE_SIGNUP_PLAN.md 2.1). Null: nowhere to search.
   */
  /** Each result's count of people you follow who follow them too. */
  private static async withMutualFollows(viewerId: string, people: SearchPerson[]) {
    if (!people.length) return people;
    const following = (await prisma.follow.findMany({
      where: { followerId: viewerId, status: 'accepted' }, select: { followeeId: true },
    })).map((row) => row.followeeId);
    if (!following.length) return people.map((person) => ({ ...person, mutualFollows: 0 }));
    const counts = await prisma.follow.groupBy({
      by: ['followeeId'],
      where: { status: 'accepted', followerId: { in: following }, followeeId: { in: people.map((person) => person.id) } },
      _count: { _all: true },
    });
    const countOf = new Map(counts.map((row) => [row.followeeId, row._count._all]));
    return people.map((person) => ({ ...person, mutualFollows: countOf.get(person.id) ?? 0 }));
  }

  private static async searcher(viewerId: string, now: Date): Promise<Searcher | null> {
    const [me, membership] = await Promise.all([
      prisma.user.findUnique({ where: { id: viewerId }, select: { claimedInstitutionId: true, campusId: true } }),
      prisma.studentMembership.findUnique({
        where: { userId: viewerId },
        select: { status: true, verifiedAt: true, expiresAt: true, institutionId: true, institution: { select: { isActive: true } } },
      }),
    ]);
    if (!me) return null;
    const verified = !!(membership?.status === 'verified' && membership.verifiedAt && membership.institution.isActive &&
      (!membership.expiresAt || membership.expiresAt > now));
    const institutionId = verified ? membership!.institutionId : me.claimedInstitutionId ?? membership?.institutionId ?? null;
    if (!institutionId) return null;
    const institution = await prisma.institution.findUnique({ where: { id: institutionId }, select: { isActive: true } });
    if (!institution?.isActive) return null;
    const campus = !verified && me.campusId
      ? await prisma.institutionCampus.findFirst({ where: { id: me.campusId, institutionId, isActive: true }, select: { id: true } })
      : null;
    return { verified, institutionId, campusId: campus?.id ?? null };
  }

  /** Before verifying: 30 different people a day (GOOGLE_SIGNUP_PLAN.md, Search). */
  private static async requireUnverifiedAllowance(viewerId: string, ids: string[]) {
    if (!ids.length) return;
    const key = `search:unverified:${viewerId}:${istDay()}`;
    const count = await redisClient.multi().pfadd(key, ...ids).expire(key, secondsLeftToday() + 3600).pfcount(key).exec()
      .then((replies) => {
        const value = replies?.[2]?.[1];
        return typeof value === 'number' ? value : 0;
      })
      .catch(() => 0);
    if (count > UNVERIFIED_SEARCH_DAILY_PEOPLE) {
      throw new HttpError(429, "You've reached today's search limit. Verify your college to search freely.", 'SEARCH_LIMIT_UNVERIFIED');
    }
  }

  /**
   * Who may be found (section 4), with everything a result row carries:
   *
   * - people of the searcher's college - verified students, and unverified
   *   accounts that chose it (shown after, never with the tick);
   * - before verifying, only on the searcher's own campus, and a verified
   *   student only if they let unverified accounts find them ("Who can find me
   *   by name");
   * - never someone paused, hidden from Search, or blocked either way.
   */
  private static rows(viewerId: string, searcher: Searcher, match: Prisma.Sql, rank: Prisma.Sql, limit: number, now: Date) {
    return prisma.$queryRaw<Row[]>`
      SELECT u.id, candidate.verified, u.real_person_verified_at IS NOT NULL AS real_person, u.name, u.avatar_url, u.department, u.graduation_year, u.year_of_study,
        u.degree, u.clubs,
        COALESCE((SELECT c.name FROM institution_campuses c WHERE c.id = u.campus_id AND c.is_active
          AND c.institution_id = candidate.institution_id), NULLIF(trim(u.campus), '')) AS campus_name,
        outgoing.status AS follow_status,
        EXISTS (SELECT 1 FROM follows incoming WHERE incoming.follower_id = u.id
          AND incoming.followee_id = ${viewerId}::uuid AND incoming.status = 'accepted') AS follows_you,
        CASE WHEN u.stories_enabled AND u.show_follower_count THEN (SELECT COUNT(*)::int FROM follows f JOIN users fu ON fu.id = f.follower_id
          WHERE f.followee_id = u.id AND f.status = 'accepted' AND fu.account_status = 'active') END AS followers_count,
        CASE WHEN u.stories_enabled AND u.show_follower_count THEN (SELECT COUNT(*)::int FROM follows f JOIN users fu ON fu.id = f.followee_id
          WHERE f.follower_id = u.id AND f.status = 'accepted' AND fu.account_status = 'active') END AS following_count
      FROM users u
      -- Each person's college: their verified one, else the one they chose.
      CROSS JOIN LATERAL (SELECT
        EXISTS (SELECT 1 FROM student_memberships cm JOIN institutions ci ON ci.id = cm.institution_id
          WHERE cm.user_id = u.id AND ${validMembership('cm', now)} AND ci.is_active) AS verified,
        COALESCE(
          (SELECT cm.institution_id FROM student_memberships cm JOIN institutions ci ON ci.id = cm.institution_id
            WHERE cm.user_id = u.id AND ${validMembership('cm', now)} AND ci.is_active),
          (SELECT ci.id FROM institutions ci WHERE ci.is_active AND ci.id = COALESCE(u.claimed_institution_id,
            (SELECT xm.institution_id FROM student_memberships xm WHERE xm.user_id = u.id)))) AS institution_id) candidate
      LEFT JOIN follows outgoing ON outgoing.follower_id = ${viewerId}::uuid AND outgoing.followee_id = u.id
        AND outgoing.status IN ('pending', 'accepted')
      WHERE u.account_status = 'active' AND u.search_discoverable AND u.paused_at IS NULL AND u.id <> ${viewerId}::uuid
        AND ${UNDER_AGE_HOLD_SQL}
        AND ${match}
        AND candidate.institution_id = ${searcher.institutionId}::uuid
        ${searcher.verified ? Prisma.empty : Prisma.sql`
        AND (NOT candidate.verified OR u.search_by_unverified)
        ${searcher.campusId ? Prisma.sql`AND u.campus_id = ${searcher.campusId}::uuid` : Prisma.empty}`}
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
          (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = u.id) OR (b.blocked_id = ${viewerId}::uuid AND b.blocker_id = u.id))
      ORDER BY
        (outgoing.status = 'accepted' OR EXISTS (SELECT 1 FROM matches m WHERE m.status = 'active' AND
          ((m.user1_id = ${viewerId}::uuid AND m.user2_id = u.id) OR (m.user2_id = ${viewerId}::uuid AND m.user1_id = u.id)))) DESC NULLS LAST,
        EXISTS (SELECT 1 FROM follows incoming WHERE incoming.follower_id = u.id
          AND incoming.followee_id = ${viewerId}::uuid AND incoming.status = 'accepted') DESC,
        -- Verified students first: a fake name never sits above the real one.
        candidate.verified DESC,
        ${rank}
        lower(u.name), u.id
      LIMIT ${limit}`;
  }

  /** Rows as the app sees them, with each person's Story ring for this viewer. */
  private static async cards(viewerId: string, rows: Row[]): Promise<SearchPerson[]> {
    const [rings, states] = await Promise.all([
      StoryService.ringsFor(viewerId, rows.map((row) => row.id)).catch(() => new Map()),
      this.myStates(viewerId, rows.map((row) => row.id)),
    ]);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      avatarUrl: row.avatar_url ? transformToCdnUrl(row.avatar_url) : null,
      department: row.department,
      year: row.graduation_year ?? row.year_of_study,
      degree: row.degree?.trim() || null,
      yearOfStudy: row.year_of_study,
      graduationYear: row.graduation_year,
      campus: row.campus_name,
      clubs: (row.clubs ?? []).filter(Boolean).slice(0, 3),
      // Unverified accounts are found too, without the badge (GOOGLE_SIGNUP_PLAN.md, Search).
      isVerified: row.verified,
      blueBadge: blueBadge(row.verified, row.real_person),
      followStatus: row.follow_status === 'pending' || row.follow_status === 'accepted' ? row.follow_status : null,
      followsYou: row.follows_you,
      followersCount: row.followers_count,
      followingCount: row.following_count,
      story: rings.get(row.id) ?? null,
      dating: ((state) => (state && state !== 'ended' ? state : null))(states.get(row.id)),
    }));
  }

  /**
   * Your decisions about these people: an active match first, then your own
   * swipe (a Rose is a Like with a Rose on it). A match that has ended says
   * nothing - those two don't see each other again.
   */
  static async myStates(viewerId: string, ids: string[]): Promise<Map<string, MyDatingState | 'ended'>> {
    const states = new Map<string, MyDatingState | 'ended'>();
    if (!ids.length) return states;
    const [matches, swipes] = await Promise.all([
      prisma.match.findMany({
        where: {
          OR: [
            { user1Id: viewerId, user2Id: { in: ids } },
            { user2Id: viewerId, user1Id: { in: ids } },
          ],
        },
        select: { id: true, user1Id: true, user2Id: true, status: true, createdAt: true },
      }),
      prisma.swipe.findMany({
        where: { swiperId: viewerId, targetId: { in: ids } },
        select: { id: true, targetId: true, action: true, createdAt: true },
      }),
    ]);
    const roses = swipes.length
      ? new Set((await prisma.rose.findMany({ where: { swipeId: { in: swipes.map((swipe) => swipe.id) } }, select: { swipeId: true } }))
        .map((rose) => rose.swipeId))
      : new Set<string>();
    for (const swipe of swipes) {
      const at = swipe.createdAt.toISOString();
      states.set(swipe.targetId, swipe.action === 'pass'
        ? { kind: 'passed', at }
        : roses.has(swipe.id) ? { kind: 'rose', at } : { kind: 'liked', at });
    }
    for (const match of matches) {
      const other = match.user1Id === viewerId ? match.user2Id : match.user1Id;
      states.set(other, match.status === 'active'
        ? { kind: 'matched', matchId: match.id, at: match.createdAt.toISOString() }
        : 'ended');
    }
    return states;
  }

  /**
   * The soft daily ceiling on distinct profiles returned (8.3): a HyperLogLog
   * of ids per account per day - counts, never the query text. Past it, the
   * answer still comes, slowly, and the account is flagged once for review.
   * Redis being down never holds a search up.
   */
  private static async countDistinct(viewerId: string, ids: string[]) {
    if (!ids.length) return;
    const day = istDay();
    const key = `search:distinct:${viewerId}:${day}`;
    const seconds = secondsLeftToday() + 3600;
    const count = await Promise.race([
      redisClient
        .multi()
        .pfadd(key, ...ids)
        .expire(key, seconds)
        .pfcount(key)
        .exec()
        .then((replies) => {
          const value = replies?.[2]?.[1];
          return typeof value === 'number' ? value : null;
        })
        .catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    if (count === null || count <= SEARCH_DAILY_CEILING) return;
    const flagKey = `search:flagged:${viewerId}:${day}`;
    const first = await redisClient.set(flagKey, '1', 'EX', seconds, 'NX').catch(() => null);
    if (first === 'OK') {
      console.warn(`[search] account ${viewerId} passed the daily distinct-profile ceiling (${count} > ${SEARCH_DAILY_CEILING})`);
    }
    await new Promise((resolve) => setTimeout(resolve, SLOW_DOWN_MS));
  }

  /**
   * The dating layer (5.2, 8.2): the full card, only when a deck Like would be
   * allowed - the pair passes `eligibleSql` with swipes excluded, which also
   * rules out blocks, their pass and any match. Every other case is the same
   * opaque 403, decided here so the app never holds a reason.
   */
  static async datingProfile(viewerId: string, targetId: string): Promise<
    { state: MyDatingState; card: null } | { state: { kind: 'available' }; card: Awaited<ReturnType<typeof buildCards>>[number] }
  > {
    const refuse = () => new HttpError(403, "You can't Like this profile right now.", 'DATING_PROFILE_UNAVAILABLE');
    const found = await prisma.user.findUnique({ where: { id: viewerId } });
    if (!found || targetId === viewerId) throw refuse();
    // Only someone Search would show at all (blocks, discoverability, college).
    if (!(await this.person(viewerId, targetId))) throw refuse();
    // Your own decision first: "You liked Rohan", not a refusal that reads as
    // something they did. No card - the same whatever they did since.
    const mine = (await this.myStates(viewerId, [targetId])).get(targetId);
    if (mine === 'ended') throw refuse();
    if (mine) return { state: mine, card: null };
    const me = asViewer(found);
    if (!setupComplete(me)) throw refuse();
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM users u
      WHERE u.id = ${targetId}::uuid AND u.search_discoverable
        AND ${eligibleSql(me, new Date(), true)}
      LIMIT 1`;
    if (!rows.length) throw refuse();
    const [card] = await buildCards(me, [targetId], `search:${viewerId}:${istDay()}`);
    if (!card) throw refuse();
    return { state: { kind: 'available' }, card };
  }
}
