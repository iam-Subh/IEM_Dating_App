import { Prisma, User } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { HttpError } from '../utils/httpError';
import { asViewer, eligibleSql, setupComplete } from './eligibility.service';
import { AlgorithmConfigService } from './algorithm-config.service';
import { DiscoveryRankingService } from './discovery-ranking.service';
import { RetrievalService } from './retrieval.service';
import { discoveryProfileSelect, publicProfile } from './public-profile.service';
import { buildCards, cacheGet, cacheSet } from './discovery-cards.service';

/**
 * Browse's filtered lists (EXPLORE_SPEC.md): the same eligible people the
 * deck draws from, narrowed by what arrives from elsewhere - a campus or spot
 * from the map, an interest from Search. The categories ("For you", "New
 * here" and the rest) are gone while Browse is rebuilt.
 *
 * Every filter is applied **in the query**, beside `eligibleSql`, never to a
 * page the recommender already chose - so a filter shows everyone who fits,
 * not whoever happened to be in someone's top 40.
 */

export const EXPLORE_ATTRIBUTES = [
  'hosteller', 'day_scholar', 'club', 'spot', 'degree',
  // Opened from the map (LOCATION_SPEC.md 9): a campus, or a map place.
  'campus', 'place',
] as const;
export type ExploreAttributeKey = (typeof EXPLORE_ATTRIBUTES)[number];
export type ExploreAttribute = { key: ExploreAttributeKey; value: string };

export const EXPLORE_MIN_COHORT = 10;
export const EXPLORE_MAX_FILTER_DIMENSIONS = 2;
/** How many eligible, filtered people are pulled and ranked before paging. */
const EXPLORE_BUDGET = 200;
/** The ranked list is held briefly so paging is stable while someone scrolls. */
const EXPLORE_CACHE_SECONDS = 15 * 60;

export type ExploreState = 'ok' | 'exhausted' | 'cohort_too_small' | 'setup_required';

/**
 * How the filtered set is ordered. `recommended` lets the recommender decide;
 * `compatibility` is a plain descending sort on the shown match percentage.
 * Hinge charges for the second one; it is only an ordering, so it is free here
 * (EXPLORE_SPEC.md, section 12).
 */
export const EXPLORE_SORTS = ['recommended', 'compatibility'] as const;
export type ExploreSort = (typeof EXPLORE_SORTS)[number];

export class ExploreService {
  static async page(userId: string, input: {
    cursor?: string; limit?: number; interests?: string[];
    attributes?: ExploreAttribute[]; sort?: ExploreSort;
  }) {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 40);
    const interests = [...new Set((input.interests ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))].slice(0, 2);
    const attributes = (input.attributes ?? []).slice(0, 2);
    // Sorting is not a filter: it reorders the same cohort, so it does not
    // count towards the two-dimension cap and cannot narrow anyone down.
    const sort: ExploreSort = EXPLORE_SORTS.includes(input.sort as ExploreSort)
      ? (input.sort as ExploreSort) : 'recommended';

    const dimensions = interests.length + attributes.length;
    if (dimensions > EXPLORE_MAX_FILTER_DIMENSIONS) {
      throw new HttpError(400, 'Use no more than two Explore filter dimensions', 'EXPLORE_FILTER_COMBINATION_LIMIT');
    }

    const found = await prisma.user.findUnique({ where: { id: userId } });
    if (!found) throw new HttpError(404, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
    // Browsing as a viewer: while hidden at a place, from the phone's private position.
    const me = asViewer(found);
    if (!setupComplete(me)) return this.empty('setup_required');

    const filters = this.filterSql(interests, attributes);
    if (dimensions > 0) {
      const cohort = await this.cohortSize(me, filters);
      if (cohort < EXPLORE_MIN_COHORT) return this.empty('cohort_too_small');
    }

    const signature = this.signature(me.id, interests, attributes, sort);
    const ranked = await this.rankedIds(me, filters, signature, sort);
    const start = this.decodeCursor(input.cursor, signature);
    // The ranked list is cached for 15 minutes, so every page is re-checked
    // against live eligibility and the filter before anyone is returned: a
    // block, "hide me from maps", a swipe from another screen or a change of
    // campus takes effect now, not when the cache expires.
    const { ids: slice, nextIndex } = await this.livePage(me, ranked, start, limit, filters);
    if (!slice.length) {
      // Nothing left to show can mean two different things, and the app says
      // different things for them: everyone here has been answered already
      // ("seen everyone"), or nobody matches at all ("not enough people").
      const answeredEveryone = ranked.length > 0 || (await this.anyoneIncludingAnswered(me, filters));
      return { ...this.empty(answeredEveryone ? 'exhausted' : 'cohort_too_small'), total: ranked.length };
    }

    const cards = await buildCards(me, slice, signature);
    return {
      cards,
      nextCursor: nextIndex < ranked.length ? this.encodeCursor(signature, nextIndex) : null,
      sort,
      state: 'ok' as const,
    };
  }

  private static empty(state: ExploreState) {
    return { cards: [] as unknown[], nextCursor: null, state };
  }

  /** Interest and attribute predicates, as SQL that sits beside `eligibleSql`. */
  private static filterSql(interests: string[], attributes: ExploreAttribute[]): Prisma.Sql {
    const clauses: Prisma.Sql[] = [];

    if (interests.length) {
      // Every chosen interest must be present, so two interests narrow rather than widen.
      clauses.push(Prisma.sql`(u.preferences->'interests') ?& ${interests}::text[]`);
    }
    for (const attribute of attributes) {
      if (attribute.key === 'hosteller') clauses.push(Prisma.sql`u.is_hosteller = true`);
      if (attribute.key === 'day_scholar') clauses.push(Prisma.sql`u.is_hosteller = false`);
      if (attribute.key === 'club') clauses.push(Prisma.sql`${attribute.value} = ANY(u.clubs)`);
      if (attribute.key === 'spot') clauses.push(Prisma.sql`${attribute.value} = ANY(u.hangout_spots)`);
      if (attribute.key === 'degree') clauses.push(Prisma.sql`u.degree = ${attribute.value}`);
      // A campus list is only ever opened from the map, so it honours "hide
      // me from maps" exactly as the map and the place list do.
      if (attribute.key === 'campus') {
        clauses.push(Prisma.sql`NOT u.hide_from_maps AND u.campus_id = ${attribute.value}::uuid`);
      }
      if (attribute.key === 'place') {
        // A map-place list honours "hide me from maps", like the map itself.
        clauses.push(Prisma.sql`NOT u.hide_from_maps AND EXISTS (
          SELECT 1 FROM user_map_places ump WHERE ump.user_id = u.id AND ump.place_id = ${attribute.value}::uuid)`);
      }
    }
    return clauses.length ? Prisma.sql`AND ${Prisma.join(clauses, ' AND ')}` : Prisma.empty;
  }

  /**
   * "Are there at least ten?", never "how many?" - the count is bounded by the
   * floor itself, because an exact size is a disclosure about a small group.
   */
  private static async cohortSize(me: User, filters: Prisma.Sql) {
    const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT count(*)::int AS count FROM (
        -- Everyone who matches, answered or not: the floor is about how big
        -- the group is, and it must not flip to "not enough people" just
        -- because the viewer has swiped through it (EXPLORE_SPEC.md 15).
        SELECT 1 FROM users u WHERE ${eligibleSql(me, new Date(), false)} ${filters}
        LIMIT ${EXPLORE_MIN_COHORT}
      ) bounded_cohort
    `);
    return rows[0]?.count ?? 0;
  }

  /**
   * Walks the ranked list from `start`, keeping only people who are eligible
   * and match the filter right now, until `limit` are found or the list ends.
   */
  private static async livePage(me: User, ranked: string[], start: number, limit: number, filters: Prisma.Sql) {
    const ids: string[] = [];
    let index = start;
    while (ids.length < limit && index < ranked.length) {
      const chunk = ranked.slice(index, index + limit);
      const live = await this.stillEligible(me, chunk, filters);
      for (const id of chunk) {
        index += 1;
        if (live.has(id)) ids.push(id);
        if (ids.length === limit) break;
      }
    }
    return { ids, nextIndex: index };
  }

  private static async stillEligible(me: User, ids: string[], filters: Prisma.Sql) {
    if (!ids.length) return new Set<string>();
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT u.id FROM users u WHERE u.id = ANY(${ids}::uuid[]) AND ${eligibleSql(me)} ${filters}`);
    return new Set(rows.map((row) => row.id));
  }

  /** Whether anyone matches at all, counting people the viewer already swiped on. */
  private static async anyoneIncludingAnswered(me: User, filters: Prisma.Sql) {
    const rows = await prisma.$queryRaw<{ found: number }[]>(Prisma.sql`
      SELECT 1 AS found FROM users u WHERE ${eligibleSql(me, new Date(), false)} ${filters} LIMIT 1`);
    return rows.length > 0;
  }

  /**
   * The filtered, eligible people in ranked order, held in Redis for the life
   * of one browse so paging does not re-rank - and does not shift under the
   * reader as they swipe, the way an offset over a live query would.
   */
  private static async rankedIds(me: User, filters: Prisma.Sql, signature: string, sort: ExploreSort): Promise<string[]> {
    const key = `explore:v1:${signature}`;
    const cached = await cacheGet(key);
    if (cached) {
      try { return JSON.parse(cached) as string[]; } catch { /* fall through and rebuild */ }
    }
    const ids = await RetrievalService.exploreIds(me, filters, EXPLORE_BUDGET);
    if (!ids.length) return [];
    const config = await AlgorithmConfigService.get();
    // Ranked ids, in order - the recommender decides the order of the filtered
    // set rather than deciding its membership (EXPLORE_SPEC.md, section 7.1).
    const ranked = sort === 'compatibility'
      ? await this.byCompatibility(me, ids, config.weights)
      : await DiscoveryRankingService.rank(me, ids, 1, config.weights, prisma, signature);
    // Your own radius and your own college first (LOCATION_SPEC.md 6.5, 8.4).
    const order = await RetrievalService.nearFirst(me, ranked);
    cacheSet(key, JSON.stringify(order), EXPLORE_CACHE_SECONDS);
    return order;
  }

  /**
   * The same people, ordered by the match percentage the reader is shown, so
   * the ordering and the number on the card agree. Anyone without enough
   * evidence to score sorts last rather than being dropped.
   */
  private static async byCompatibility(me: User, ids: string[], weights: Parameters<typeof publicProfile>[2]) {
    const [viewer, profiles] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: discoveryProfileSelect }),
      prisma.user.findMany({ where: { id: { in: ids } }, select: discoveryProfileSelect }),
    ]);
    return profiles
      .map((profile) => ({
        id: profile.id,
        score: publicProfile(viewer, profile, weights).compatibilityScore ?? -1,
      }))
      .sort((first, second) => second.score - first.score || first.id.localeCompare(second.id))
      .map((entry) => entry.id);
  }


  /** One browse: the viewer and the exact filter they chose. A changed filter is a new list. */
  private static signature(userId: string, interests: string[], attributes: ExploreAttribute[], sort: ExploreSort) {
    const parts = [userId, [...interests].sort().join(','), attributes.map((a) => `${a.key}:${a.value}`).sort().join(','), sort];
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
  }

  private static encodeCursor(signature: string, index: number) {
    return Buffer.from(JSON.stringify({ s: signature, i: index })).toString('base64url');
  }

  private static decodeCursor(cursor: string | undefined, signature: string): number {
    if (!cursor) return 0;
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { s?: string; i?: number };
      // A cursor from a different filter is simply the start of this one.
      if (decoded.s !== signature || typeof decoded.i !== 'number' || decoded.i < 0) return 0;
      return Math.min(decoded.i, 10_000);
    } catch {
      throw new HttpError(400, 'Explore cursor is invalid', 'INVALID_EXPLORE_CURSOR');
    }
  }
}
