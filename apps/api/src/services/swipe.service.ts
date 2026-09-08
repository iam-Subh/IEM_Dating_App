import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { mutuallyEligible } from "./eligibility.service";
import { interestSignals } from "./reciprocity.service";
import { OUTBOX_TOPICS, OutboxService } from "./outbox.service";
import { AccountEventService } from "./account-event.service";
export class SwipeService {
  static async perform(
    viewerId: string,
    targetId: string,
    action: "like" | "pass",
  ) {
    if (viewerId === targetId || !["like", "pass"].includes(action))
      throw new HttpError(400, "Invalid swipe");
    const [a, b] = [viewerId, targetId].sort();
    return prisma.$transaction(
      async (tx) => {
        // Pair-level transaction lock covers both swipe directions and reversed match pairs.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${a}:${b}`}, 0))`;
        await tx.$queryRaw`SELECT id FROM users WHERE id IN (${a}::uuid,${b}::uuid) ORDER BY id FOR UPDATE`;
        const previous = await tx.swipe.findUnique({
          where: { swiperId_targetId: { swiperId: viewerId, targetId } },
        });
        if (previous) {
          if (previous.action !== action)
            throw new HttpError(
              409,
              "This profile already has a different decision",
              "SWIPE_CONFLICT",
            );
          const match = await tx.match.findFirst({
            where: {
              OR: [
                { user1Id: a, user2Id: b },
                { user1Id: b, user2Id: a },
              ],
              status: "active",
            },
          });
          return {
            status: "recorded",
            targetId,
            action,
            matchCreated: false,
            matched: !!match,
            matchId: match?.id,
            repeated: true,
          };
        }
        const [viewer, target, blocked, matched, reverse, memberships] = await Promise.all([
          tx.user.findUnique({ where: { id: viewerId } }),
          tx.user.findUnique({ where: { id: targetId } }),
          tx.userBlock.findFirst({
            where: {
              OR: [
                { blockerId: a, blockedId: b },
                { blockerId: b, blockedId: a },
              ],
            },
          }),
          tx.match.findFirst({
            where: {
              OR: [
                { user1Id: a, user2Id: b },
                { user1Id: b, user2Id: a },
              ],
            },
          }),
          tx.swipe.findUnique({
            where: {
              swiperId_targetId: { swiperId: targetId, targetId: viewerId },
            },
          }),
          tx.studentMembership.findMany({
            where: {
              userId: { in: [viewerId, targetId] },
              status: 'verified',
              verifiedAt: { not: null },
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              institution: { isActive: true },
            },
            select: { userId: true, institutionId: true },
          }),
        ]);
        const sameInstitution = memberships.length === 2 && memberships[0].institutionId === memberships[1].institutionId;
        if (
          !viewer ||
          !target ||
          blocked ||
          matched ||
          reverse?.action === "pass" ||
          memberships.length !== 2 ||
          (viewer?.discoveryMode === 'college' && !sameInstitution) ||
          !mutuallyEligible(viewer, target)
        )
          throw new HttpError(
            409,
            "This profile is no longer available",
            "PROFILE_UNAVAILABLE",
          );
        // Snapshot only model inputs at decision time. Do not infer historical inputs later.
        const swipe = await tx.swipe.create({
          data: { swiperId: viewerId, targetId, action, targetSignals: interestSignals(target) },
        });
        await tx.userScore.upsert({
          where: { userId: viewerId },
          create: {
            userId: viewerId,
            totalSwipesOut: 1,
            totalRightSwipes: action === "like" ? 1 : 0,
          },
          update: {
            totalSwipesOut: { increment: 1 },
            totalRightSwipes: { increment: action === "like" ? 1 : 0 },
          },
        });
        await tx.userScore.upsert({
          where: { userId: targetId },
          create: {
            userId: targetId,
            totalSwipesReceived: 1,
            totalLikesReceived: action === "like" ? 1 : 0,
          },
          update: {
            totalSwipesReceived: { increment: 1 },
            totalLikesReceived: { increment: action === "like" ? 1 : 0 },
          },
        });
        await tx.user.update({
          where: { id: viewerId },
          data: { lastActiveAt: new Date() },
        });
        await tx.profileImpression.updateMany({
          where: {
            viewerId,
            shownId: targetId,
            day: new Date(new Date().toISOString().slice(0, 10)),
          },
          data: { acted: true },
        });
        let matchId: string | undefined;
        if (action === "like" && reverse?.action === "like") {
          const match = await tx.match.create({
            data: { user1Id: a, user2Id: b, status: "active" },
          });
          matchId = match.id;
          await AccountEventService.append(tx, { userIds: [a, b], type: 'conversation.updated', matchId, payload: { reason: 'match_created' } });
          await OutboxService.enqueue(tx, {
            topic: OUTBOX_TOPICS.MATCH_CREATED,
            aggregateId: matchId,
            deduplicationKey: `match.created:${matchId}`,
            payload: { user1Id: a, user2Id: b },
          });
          await tx.analyticsEvent.create({
            data: {
              userId: viewerId,
              eventType: "match_created",
              eventData: { matchId, user1Id: a, user2Id: b },
            },
          });
        }
        await tx.analyticsEvent.create({
          data: {
            userId: viewerId,
            eventType: "swipe",
            eventData: {
              swipeId: swipe.id,
              targetId,
              action,
              matchId: matchId ?? null,
            },
          },
        });
        return {
          status: "recorded",
          targetId,
          action,
          matchCreated: !!matchId,
          matched: !!matchId,
          matchId,
          repeated: false,
        };
      },
      { timeout: 15000 },
    );
  }
}
