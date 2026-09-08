import { Prisma, PrismaClient, User } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { boundingBox } from "../utils/geo";
import { eligibleSql, setupComplete } from "./eligibility.service";
import { createHash } from "crypto";

export class RetrievalService {
  static async ids(
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
          return this.ids(
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
    let box = Prisma.empty;
    if (me.discoveryMode === "distance") {
      const b = boundingBox(
        { latitude: Number(me.latitude), longitude: Number(me.longitude) },
        me.distancePreference ?? 100,
      );
      box = Prisma.sql`AND u.latitude BETWEEN ${b.minLat} AND ${b.maxLat} AND u.longitude BETWEEN ${b.minLng} AND ${b.maxLng}`;
    }
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
      return this.ids(me, seed, budget, excluded, db, false);
    return rows.map((r) => r.id);
  }
  static async eligibleIds(me: User, ids: string[]) {
    if (!ids.length || !setupComplete(me)) return new Set<string>();
    const rows = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT u.id FROM users u WHERE u.id = ANY(${ids}::uuid[]) AND ${eligibleSql(me)}`,
    );
    return new Set(rows.map((r) => r.id));
  }
}
