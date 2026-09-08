import { prisma } from "../utils/prisma";
import { User, PrismaClient } from "@prisma/client";
import { compatibility, CompatibilityWeights } from "./compatibility.service";
import { rankCandidates, RankingCandidate } from "./ranking-policy";
import { ReciprocityService, ReciprocityStats } from "./reciprocity.service";
import { logger } from "../utils/logger";

export type RankingMetrics = { compatibilityMs: number; reciprocity: ReciprocityStats | null; candidates: number };
export class DiscoveryRankingService {
  static async rank(
    me: User,
    ids: string[],
    algorithm: number,
    weights: CompatibilityWeights,
    db: PrismaClient = prisma,
    seed: string = "default",
    coldSlots = 2,
    incomingSlots = 1,
    reciprocityEnabled = false,
    onSnapshot?: (candidates: RankingCandidate[]) => void,
    onMetrics?: (metrics: RankingMetrics) => void,
  ) {
    if (!ids.length) return [];
    const profiles = await db.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        preferences: true,
        seeking: true,
        clubs: true,
        discoveryMode: true,
        college: true,
        department: true,
        campus: true,
        yearOfStudy: true,
        isHosteller: true,
        hangoutSpots: true,
        lastActiveAt: true,
        createdAt: true,
        avatarUrl: true,
      },
    });
    const now = Date.now();
    // Control does not use exposure or incoming interest, so skip both reads.
    const exposure =
      algorithm === 1 || !!onSnapshot
        ? await db.discoveryReceipt.groupBy({
            by: ["candidateId"],
            where: {
              candidateId: { in: ids },
              visibleAt: { gte: new Date(now - 86400000) },
            },
            _count: true,
          })
        : [];
    const incoming =
      algorithm === 1 || !!onSnapshot
        ? await db.swipe.findMany({
            where: { targetId: me.id, swiperId: { in: ids }, action: "like" },
            select: { swiperId: true },
          })
        : [];
    const likes = new Set(incoming.map((p) => p.swiperId));
    const counts = new Map(exposure.map((p) => [p.candidateId, p._count]));
    let predictions = new Map<string, number>();
    let reciprocity: ReciprocityStats | null = null;
    if (reciprocityEnabled && (algorithm === 1 || onSnapshot)) {
      try {
        const result = await ReciprocityService.batchDetailed(me, ids, db);
        predictions = result.points;
        reciprocity = result.stats;
      } catch {
        logger.warn(
          "Reciprocity unavailable; ranking without model adjustment",
        );
      }
    }
    const compatibilityStarted = performance.now();
    const candidates = profiles.map((p) => ({
      id: p.id,
      score: compatibility(me, p, weights).score,
      visibleCount: counts.get(p.id) ?? 0,
      active: now - (p.lastActiveAt ?? p.createdAt).getTime() < 7 * 86400000,
      hasPhoto: !!p.avatarUrl,
      incomingLike: likes.has(p.id),
      reciprocityPoints: likes.has(p.id) ? 0 : (predictions.get(p.id) ?? 0),
    }));
    onMetrics?.({ compatibilityMs: performance.now() - compatibilityStarted, reciprocity, candidates: profiles.length });
    onSnapshot?.(candidates.map((p) => ({ ...p })));
    return rankCandidates(
      candidates,
      me.id,
      seed,
      algorithm === 1,
      coldSlots,
      incomingSlots,
    );
  }
}
