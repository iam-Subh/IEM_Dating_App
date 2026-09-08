import { Prisma, User } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { RecommendationService } from './recommendation.service';
import { eligibleSql, setupComplete } from './eligibility.service';

export type ExploreCategory = 'for_you' | 'new_here' | 'active' | 'shared_interests' | 'same_department';
export const EXPLORE_MIN_COHORT = 10;
export const EXPLORE_MAX_FILTER_DIMENSIONS = 2;

export class SearchService {
  static async explore(userId: string, input: { cursor?: string; limit?: number; category?: ExploreCategory; interests?: string[] }) {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 40);
    const category = input.category ?? 'for_you';
    const interests = [...new Set((input.interests ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean))];
    const filterDimensions = interests.length + (category === 'for_you' ? 0 : 1);
    if (filterDimensions > EXPLORE_MAX_FILTER_DIMENSIONS) {
      throw new HttpError(400, 'Use no more than two Explore filter dimensions', 'EXPLORE_FILTER_COMBINATION_LIMIT');
    }
    const me = await prisma.user.findUnique({ where: { id: userId } });
    if (!me) throw new HttpError(404, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
    if (!setupComplete(me)) throw new HttpError(409, 'Complete discovery setup before Explore', 'DISCOVERY_SETUP_REQUIRED');
    if (filterDimensions > 0) {
      const cohortSize = await this.filteredCohortSize(me, category, interests);
      if (cohortSize < EXPLORE_MIN_COHORT) {
        throw new HttpError(409, 'This filter is unavailable because the eligible group is too small', 'EXPLORE_COHORT_TOO_SMALL');
      }
    }
    const page = await RecommendationService.getRecommendations(userId, input.cursor, 40);
    const ids = page.cards.map((card) => card.id);
    const metadata = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, createdAt: true, lastActiveAt: true, department: true } });
    const metadataMap = new Map(metadata.map((item) => [item.id, item]));
    const ownInterests = this.interests(me.preferences);
    const cards = page.cards.filter((card) => {
      const item = metadataMap.get(card.id);
      const candidateInterests = this.interests(card.preferences);
      if (interests.length && !interests.every((value) => candidateInterests.has(value))) return false;
      if (category === 'new_here') return !!item && item.createdAt >= new Date(Date.now() - 30 * 24 * 60 * 60_000);
      if (category === 'active') return !!item?.lastActiveAt && item.lastActiveAt >= new Date(Date.now() - 7 * 24 * 60 * 60_000);
      if (category === 'same_department') return !!me.department && item?.department === me.department;
      if (category === 'shared_interests') return [...candidateInterests].some((value) => ownInterests.has(value));
      return true;
    }).slice(0, limit);
    const follows = cards.length ? await prisma.follow.findMany({
      where: { followerId: userId, followeeId: { in: cards.map((card) => card.id) }, status: { in: ['pending', 'accepted'] } },
      select: { followeeId: true, status: true },
    }) : [];
    const followMap = new Map(follows.map((follow) => [follow.followeeId, follow.status]));
    return { ...page, cards: cards.map((card) => ({ ...card, followStatus: followMap.get(card.id) ?? null })), category };
  }

  private static interests(value: unknown): Set<string> {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const list = Array.isArray(record.interests) ? record.interests : [];
    return new Set(list.filter((item): item is string => typeof item === 'string').map((item) => item.trim().toLowerCase()));
  }

  private static async filteredCohortSize(me: User, category: ExploreCategory, interests: string[]) {
    const clauses: Prisma.Sql[] = [];
    if (interests.length) {
      clauses.push(Prisma.sql`(u.preferences->'interests') @> to_jsonb(${interests}::text[])`);
    }
    if (category === 'new_here') clauses.push(Prisma.sql`u.created_at >= now() - interval '30 days'`);
    if (category === 'active') clauses.push(Prisma.sql`u.last_active_at >= now() - interval '7 days'`);
    if (category === 'same_department') {
      if (!me.department?.trim()) return 0;
      clauses.push(Prisma.sql`u.department = ${me.department}`);
    }
    if (category === 'shared_interests') {
      const ownInterests = [...this.interests(me.preferences)];
      if (!ownInterests.length) return 0;
      clauses.push(Prisma.sql`(u.preferences->'interests') ?| ${ownInterests}::text[]`);
    }
    const filterSql = clauses.length ? Prisma.sql`AND ${Prisma.join(clauses, ' AND ')}` : Prisma.empty;
    const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT count(*)::int AS count FROM (
        SELECT 1 FROM users u WHERE ${eligibleSql(me)} ${filterSql}
        LIMIT ${EXPLORE_MIN_COHORT}
      ) bounded_cohort
    `);
    return rows[0]?.count ?? 0;
  }
}
