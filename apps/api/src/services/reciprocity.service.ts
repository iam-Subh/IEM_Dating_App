import { normalizeInterests, interestLookupValues } from "@iem-dating/shared/interest-catalog";
import { Prisma, PrismaClient, User } from "@prisma/client";
import { prisma } from "../utils/prisma";

export type InterestSignals = { interests: string[]; seeking: string | null };
export function interestSignals(profile: {
  preferences: unknown;
  seeking: string | null;
}): InterestSignals {
  const p = profile.preferences as Record<string, unknown> | null;
  const raw = p && typeof p === "object" ? p.interests : [];
  return {
    interests: normalizeInterests(raw).map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 100),
    seeking: profile.seeking?.trim().toLowerCase() || null,
  };
}
export function similarSignals(a: InterestSignals, b: InterestSignals) {
  return (
    !!a.seeking &&
    a.seeking === b.seeking &&
    a.interests.some((x) => b.interests.includes(x))
  );
}
export function estimateReciprocity(
  n: number,
  likes: number,
  similar: number,
  similarLikes: number,
) {
  if (
    ![n, likes, similar, similarLikes].every(Number.isSafeInteger) ||
    n < 50 ||
    similar < 20 ||
    likes < 0 ||
    likes > n ||
    similar > n ||
    similarLikes < 0 ||
    similarLikes > similar ||
    similarLikes > likes ||
    likes - similarLikes > n - similar
  )
    return null;
  const baseline = (likes + 5) / (n + 10);
  // Ten pseudo-observations shrink the conditional estimate toward this actor's rate.
  const probability = (similarLikes + 10 * baseline) / (similar + 10);
  return {
    probability,
    baseline,
    samples: n,
    similarSamples: similar,
    points: Math.max(-5, Math.min(5, 10 * (probability - baseline))),
    version: 1,
  };
}
export type ReciprocityStats = {
  candidates: number; withEstimate: number; belowHistory: number; belowSimilarity: number;
  malformed: number; missingViewerSignals: number; elapsedMs: number; failed: number; attempted: boolean;
};
export class ReciprocityService {
  static async batch(me: User, ids: string[], db: PrismaClient = prisma) {
    return (await this.batchDetailed(me, ids, db)).points;
  }
  static async batchDetailed(me: User, ids: string[], db: PrismaClient = prisma) {
    const started = performance.now();
    ids = [...new Set(ids)];
    const signals = interestSignals(me);
    const stats: ReciprocityStats = { candidates: ids.length, withEstimate: 0, belowHistory: 0,
      belowSimilarity: 0, malformed: 0, missingViewerSignals: 0, elapsedMs: 0, failed: 0, attempted: false };
    const points = new Map<string, number>();
    const finish = () => { stats.elapsedMs = performance.now() - started; return { points, stats }; };
    if (!ids.length || !signals.seeking || !signals.interests.length) {
      stats.missingViewerSignals = ids.length;
      return finish();
    }
    stats.attempted = true;
    const lookup = interestLookupValues(signals.interests);
    const query = Prisma.sql`SELECT c.id,
      COUNT(s.action) FILTER (WHERE s.valid)::int AS n,
      COUNT(*) FILTER (WHERE s.action='like' AND s.valid)::int AS likes,
      COUNT(s.action) FILTER (WHERE NOT s.valid)::int AS malformed,
      COUNT(*) FILTER (WHERE s.valid AND s.target_signals->>'seeking'=${signals.seeking}
        AND (s.target_signals->'interests') ?| ${lookup}::text[])::int AS similar,
      COUNT(*) FILTER (WHERE s.valid AND s.action='like' AND s.target_signals->>'seeking'=${signals.seeking}
        AND (s.target_signals->'interests') ?| ${lookup}::text[])::int AS "similarLikes"
      FROM unnest(${ids}::uuid[]) AS c(id)
      LEFT JOIN LATERAL (SELECT action,target_signals,
        (jsonb_typeof(target_signals->'interests')='array' AND jsonb_typeof(target_signals->'seeking')='string'
         AND NOT jsonb_path_exists(target_signals, '$.interests[*] ? (@.type() != "string")')) IS TRUE AS valid
        FROM (SELECT action,target_signals FROM swipes WHERE swiper_id=c.id
        AND target_id<>${me.id}::uuid
        AND created_at >= now()-interval '90 days' AND action IN ('like','pass')
        ORDER BY created_at DESC,id LIMIT 200) recent WHERE target_signals IS NOT NULL) s ON true GROUP BY c.id`;
    type Row = {
      id: string;
      n: number;
      malformed: number;
      likes: number;
      similar: number;
      similarLikes: number;
    };
    try {
    const rows =
      db === prisma
        ? await prisma.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT set_config('statement_timeout','2000ms',true)`;
              return tx.$queryRaw<Row[]>(query);
            },
            { timeout: 3000 },
          )
        : await db.$queryRaw<Row[]>(query);
    for (const r of rows) {
      const estimate = estimateReciprocity(r.n, r.likes, r.similar, r.similarLikes);
      if (estimate) { points.set(r.id, estimate.points); stats.withEstimate++; }
      else if (r.n < 50 && r.malformed > 0) stats.malformed++;
      else if (r.n < 50) stats.belowHistory++;
      else if (r.similar < 20) stats.belowSimilarity++;
      else stats.malformed++;
    }
    } catch {
      stats.failed = ids.length;
    }
    return finish();
  }
}
