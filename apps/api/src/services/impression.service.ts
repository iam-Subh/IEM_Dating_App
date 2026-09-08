import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { ExposureReservationService } from "./exposure-reservation.service";
import { logger } from "../utils/logger";

export class ImpressionService {
  static async recordVisible(viewerId: string, id: string) {
    const recorded = await prisma.$transaction(async (tx) => {
      const receipt = await tx.discoveryReceipt.findUnique({ where: { id } });
      if (!receipt || receipt.viewerId !== viewerId)
        throw new HttpError(404, "Impression not found");
      if (receipt.deliveredAt.getTime() < Date.now() - 86400000)
        throw new HttpError(410, "Impression expired");
      // Raw compare-and-set: relationMode=prisma can split updateMany into read/write queries.
      const claimed = await tx.$queryRaw<
        { id: string }[]
      >`UPDATE discovery_receipts SET visible_at=now() WHERE id=${id}::uuid AND visible_at IS NULL RETURNING id`;
      if (!claimed.length) return receipt;
      const users = await tx.user.count({
        where: { id: { in: [viewerId, receipt.candidateId] } },
      });
      if (users !== 2) return;
      await tx.$executeRaw(Prisma.sql`INSERT INTO profile_impressions (id,viewer_id,shown_id,day,count,best_position,acted,first_seen_at,last_seen_at)
        VALUES (gen_random_uuid(),${viewerId}::uuid,${receipt.candidateId}::uuid,(now() AT TIME ZONE 'UTC')::date,1,${receipt.sequence},
        EXISTS(SELECT 1 FROM swipes WHERE swiper_id=${viewerId}::uuid AND target_id=${receipt.candidateId}::uuid),now(),now())
        ON CONFLICT (viewer_id,shown_id,day) DO UPDATE SET count=profile_impressions.count+1,
        best_position=LEAST(profile_impressions.best_position,EXCLUDED.best_position),
        acted=profile_impressions.acted OR EXCLUDED.acted,last_seen_at=now()`);
      return receipt;
    });
    if (recorded) {
      try {
        await ExposureReservationService.release(
          recorded.candidateId,
          ExposureReservationService.member(
            viewerId,
            recorded.deckId,
            recorded.sequence,
          ),
        );
      } catch {
        logger.warn("Exposure reservation release deferred to expiry");
      }
    }
  }
  static async markActed(viewerId: string, shownId: string) {
    await prisma.profileImpression.updateMany({
      where: {
        viewerId,
        shownId,
        day: new Date(new Date().toISOString().slice(0, 10)),
      },
      data: { acted: true },
    });
  }
  static async getExposureBatch(ids: string[]) {
    const rows = await prisma.discoveryReceipt.groupBy({
      by: ["candidateId"],
      where: {
        candidateId: { in: ids },
        visibleAt: { gte: new Date(Date.now() - 86400000) },
      },
      _count: true,
    });
    return new Map(rows.map((r) => [r.candidateId, r._count]));
  }
  // Visibility is committed directly. No in-memory or Redis buffer needs draining.
  static startFlushLoop() {}
  static async stopFlushLoop() {}
}
