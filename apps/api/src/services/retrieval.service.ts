import { Prisma, PrismaClient, User } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { boundingBox, haversineKm } from "../utils/geo";
import { ageAt, effectiveRadiusKm, eligibleSql, loadEligibilityParties, setupComplete } from "./eligibility.service";
import { preferenceFirst } from "./match-criteria";
import { createHash } from "crypto";

export class RetrievalService {
  /**
   * The deck's candidates. "Show people slightly out of my range" and "show
   * people further away" only apply once you run out: the people inside your
   * own range and area come first, and the wider pool only fills what is left
   * of the budget.
   */
  static async ids(
    me: User,
    seed: string,
    budget: number,
    excluded: string[] = [],
    db: PrismaClient = prisma,
    bounded = true,
  ): Promise<string[]> {
    if (!me.flexibleAge && !me.expandRadius) return this.pool(me, seed, budget, excluded, db, bounded);
    const strictViewer: User = { ...me, flexibleAge: false, expandRadius: false };
    const strict = await this.pool(strictViewer, seed, budget, excluded, db, bounded);
    if (strict.length >= budget) return strict;
    const wider = await this.pool(me, seed, budget - strict.length, [...excluded, ...strict], db, bounded);
    return [...strict, ...wider];
  }

  private static async pool(
    me: User,
    seed: string,
    budget: number,
    excluded: string[] = [],
    db: PrismaClient = prisma,
    bounded = true,
  ): Promise<string[]> {
    if (!setupComplete(me)) return [];
    if (db === prisma)
      return prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('jit','off',true), set_config('plan_cache_mode','force_custom_plan',true), set_config('statement_timeout','2000ms',true)`;
          return this.pool(
            me,
            seed,
            budget,
            excluded,
            tx as unknown as PrismaClient,
            bounded,
          );
        },
        { timeout: 3000 },
      );
    const box = this.distanceBox(me);
    const base = Prisma.sql`${eligibleSql(me)} ${box} AND NOT (u.id = ANY(${excluded}::uuid[]))`;
    const start =
      createHash("sha256").update(seed).digest().readUInt32BE(0) % 1048576;
    // Indexed ring traversal gives stable exploration without hashing every eligible row.
    // Each source receives identical hard constraints; unused quotas transfer to exploration.
    const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH incoming AS (SELECT u.id FROM swipes s JOIN users u ON u.id=s.swiper_id
        WHERE s.target_id=${me.id}::uuid AND s.action='like' AND ${base}
        ORDER BY s.created_at DESC,s.swiper_id LIMIT ${Math.ceil(budget * 0.1)}),
      affinity AS (SELECT u.id FROM (SELECT * FROM users WHERE account_status = 'active' AND preferences_confirmed_at IS NOT NULL
        AND discovery_sample>=${start} ORDER BY discovery_sample,id OFFSET 0) u
        WHERE ${base} LIMIT ${Math.floor(budget * 0.4)}),
      fresh AS (SELECT u.id FROM (SELECT * FROM users WHERE account_status = 'active' AND preferences_confirmed_at IS NOT NULL ORDER BY created_at DESC,id LIMIT ${budget * 4}) u WHERE ${base} LIMIT ${Math.floor(budget * 0.2)}),
      explore_high AS (SELECT u.id FROM (SELECT * FROM users WHERE account_status = 'active' AND preferences_confirmed_at IS NOT NULL AND discovery_sample>=${start} ORDER BY discovery_sample,id LIMIT ${bounded ? budget * 8 : 2147483647}) u WHERE ${base} LIMIT ${budget}),
      explore_low AS (SELECT u.id FROM (SELECT * FROM users WHERE account_status = 'active' AND preferences_confirmed_at IS NOT NULL AND discovery_sample<${start} ORDER BY discovery_sample,id LIMIT ${bounded ? budget * 8 : 2147483647}) u WHERE ${base} LIMIT ${budget}),
      combined AS (SELECT id, -1 AS priority FROM incoming UNION ALL SELECT id, 0 FROM affinity UNION ALL SELECT id, 1 FROM fresh UNION ALL SELECT id, 2 FROM explore_high UNION ALL SELECT id, 3 FROM explore_low)
      SELECT id FROM combined GROUP BY id ORDER BY min(priority), md5(id::text || ${seed}), id LIMIT ${budget}`);
    // A bounded probe must not turn insufficient sampling into a false exhausted deck.
    if (bounded && rows.length < budget)
      return this.pool(me, seed, budget, excluded, db, false);
    return rows.map((r) => r.id);
  }
  /**
   * Explore's retrieval (EXPLORE_SPEC.md, section 7): the eligible people who
   * also match a category, interest or attribute filter, with the filter in
   * the query rather than applied to a page the deck already chose.
   *
   * Unlike `ids` above there is no stratification: Explore is a browse along
   * an axis the person picked, so the only job here is to find the filtered
   * set; ranking happens after.
   */
  static async exploreIds(me: User, filters: Prisma.Sql, budget: number): Promise<string[]> {
    if (!setupComplete(me)) return [];
    const box = this.distanceBox(me);
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('jit','off',true), set_config('statement_timeout','2000ms',true)`;
        const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT u.id FROM users u
          WHERE ${eligibleSql(me)} ${box} ${filters}
          ORDER BY u.discovery_sample, u.id
          LIMIT ${budget}
        `);
        return rows.map((row) => row.id);
      },
      { timeout: 3000 },
    );
  }

  /**
   * The indexed bounding-box prefilter for a distance-mode viewer, sized to
   * their effective radius (a superset of every radius that can bind).
   *
   * It applies to distance-mode candidates only. A college-mode candidate has
   * no personal location at all - they are reached through their campus
   * anchor (LOCATION_SPEC.md 8.5) - so boxing on `u.latitude` would silently
   * drop every one of them.
   */
  static distanceBox(me: User) {
    if (me.discoveryMode !== "distance" || me.latitude === null || me.longitude === null)
      return Prisma.empty;
    const b = boundingBox(
      { latitude: Number(me.latitude), longitude: Number(me.longitude) },
      effectiveRadiusKm(me),
    );
    return Prisma.sql`AND (u.discovery_mode <> 'distance' OR (u.latitude BETWEEN ${b.minLat} AND ${b.maxLat} AND u.longitude BETWEEN ${b.minLng} AND ${b.maxLng}))`;
  }

  /**
   * Keeps the ranked order but moves two groups behind everyone else:
   * - distance mode: people beyond the viewer's own radius, who are only
   *   eligible because the viewer asked to see further once they run out
   *   (LOCATION_SPEC.md 6.5);
   * - college mode: people from another institution, who are only eligible
   *   through a wider college scope (8.4) - your own college comes first, as
   *   Tinder U puts your own school first.
   * A stable partition, so the ranking inside each group is untouched.
   */
  /** Soft preferences and the flexible-age margin, as a stable reorder (PREFERENCES_SPEC.md). */
  static async preferenceFirst(me: User, ids: string[]): Promise<string[]> {
    if (ids.length < 2) return ids;
    const people = await prisma.user.findMany({ where: { id: { in: ids } } });
    return preferenceFirst(me, ids, new Map(people.map((person) => [person.id, person])), (person) => ageAt(person.birthday));
  }

  static async nearFirst(me: User, ids: string[]): Promise<string[]> {
    if (ids.length < 2) return ids;
    const later = new Set<string>();
    if (me.discoveryMode === "distance" && me.latitude !== null && me.longitude !== null) {
      if (!me.expandRadius) return ids;
      const mine = { latitude: Number(me.latitude), longitude: Number(me.longitude) };
      const rows = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, discoveryMode: true, latitude: true, longitude: true,
          campusRef: { select: { latitude: true, longitude: true } },
        },
      });
      for (const row of rows) {
        const position =
          row.discoveryMode === "distance" && row.latitude !== null && row.longitude !== null
            ? { latitude: Number(row.latitude), longitude: Number(row.longitude) }
            : row.campusRef?.latitude != null && row.campusRef?.longitude != null
              ? { latitude: Number(row.campusRef.latitude), longitude: Number(row.campusRef.longitude) }
              : null;
        if (!position || haversineKm(mine, position) > (me.distancePreference ?? 100)) later.add(row.id);
      }
    } else if (me.discoveryMode === "college") {
      // Each person's college as matching sees it: verified, or chosen in
      // onboarding before verifying (GOOGLE_SIGNUP_PLAN.md 2.1). Reading only
      // verified memberships let an unverified person from the other college
      // jump ahead of your own college.
      const parties = await loadEligibilityParties(prisma, [me.id, ...ids]);
      const mine = parties.get(me.id)?.institutionId;
      if (!mine) return ids;
      for (const id of ids) if (parties.get(id)?.institutionId !== mine) later.add(id);
      // "All IEM campuses" or both colleges: own campus first, then the rest of
      // your college, then the other college.
      if (me.campusId) {
        const elsewhere = await prisma.user.findMany({
          where: { id: { in: ids.filter((id) => !later.has(id)) }, NOT: { campusId: me.campusId } },
          select: { id: true },
        });
        for (const row of elsewhere) later.add(row.id);
      }
    }
    if (!later.size) return ids;
    return [...ids.filter((id) => !later.has(id)), ...ids.filter((id) => later.has(id))];
  }

  static async eligibleIds(me: User, ids: string[]) {
    if (!ids.length || !setupComplete(me)) return new Set<string>();
    const rows = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT u.id FROM users u WHERE u.id = ANY(${ids}::uuid[]) AND ${eligibleSql(me)}`,
    );
    return new Set(rows.map((r) => r.id));
  }
}
