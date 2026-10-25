import { DiscoveryTelemetry, PageMetrics, pageMetrics, timed } from "./discovery-telemetry.service";
import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import { asViewer, isEligibilityParty, setupComplete } from "./eligibility.service";
import { AlgorithmConfigService } from "./algorithm-config.service";
import {
  DeckService,
  decodeCursor,
  encodeCursor,
  assignment,
} from "./deck.service";
import { RetrievalService } from "./retrieval.service";
import { DiscoveryRankingService } from "./discovery-ranking.service";
import {
  discoveryProfileSelect,
  publicProfile,
} from "./public-profile.service";
import { ShadowService } from "./shadow.service";
import { randomUUID } from "crypto";
import type { DiscoveryPage } from "@iem-dating/shared";
import { RankingCandidate } from "./ranking-policy";
import { ExposureReservationService } from "./exposure-reservation.service";

export class RecommendationService {
  static async getRecommendations(
    userId: string,
    cursor?: string,
    limit = 20,
    afterResponse?: (work: () => void) => void,
    onMetrics?: (metrics: PageMetrics) => void,
  ): Promise<DiscoveryPage> {
    const metrics = pageMetrics(), started = performance.now();
    try {
      const page = await this.page(userId, cursor, limit, afterResponse, metrics);
      metrics.state = page.state;
      metrics.delivered = page.cards.length;
      return page;
    } finally {
      metrics.totalMs = performance.now() - started;
      DiscoveryTelemetry.record(metrics);
      onMetrics?.(metrics);
    }
  }
  private static async page(userId: string, cursor: string | undefined, limit: number,
    afterResponse: ((work: () => void) => void) | undefined, metrics: PageMetrics): Promise<DiscoveryPage> {
    const found = await prisma.user.findUnique({ where: { id: userId } });
    if (!found) throw new HttpError(404, "User not found");
    // Browsing as a viewer: while hidden at a place, from the phone's private position.
    const me = asViewer(found);
    if (!setupComplete(me) || !(await isEligibilityParty(prisma, userId))) {
      metrics.kind = "setup";
      return {
        cards: [],
        nextCursor: null,
        state: "setup_required",
        deckId: null,
      };
    }
    const config = await AlgorithmConfigService.get();
    const algorithm =
      assignment(userId) < config.flags.reco_rollout_pct ? 1 : 0;
    metrics.algorithm = algorithm;
    let snapshot: RankingCandidate[] | undefined;
    const generate = async (seed: string, excluded: string[]) => {
      metrics.generations++;
      if (excluded.length) metrics.refills++;
      if (metrics.kind !== 'generate') metrics.kind = excluded.length ? 'refill' : 'generate';
      const ids = await timed(metrics, "retrievalMs", () => RetrievalService.ids(
        me,
        seed,
        config.flags.candidate_budget,
        excluded,
      ));
      const ranked = await timed(metrics, "rankingMs", () => DiscoveryRankingService.rank(
        me,
        ids,
        algorithm,
        config.weights,
        prisma,
        seed,
        config.flags.cold_slots_per_10,
        config.flags.incoming_slots_per_10,
        config.flags.reciprocity_enabled === 1,
        afterResponse && config.flags.shadow_enabled && !excluded.length
          ? (candidates) => {
              snapshot = candidates;
            }
          : undefined,
        (value) => metrics.ranking.push(value),
      ));
      // Inside your own radius, or your own college, before anyone reachable
      // only through "see further" or a wider college scope (LOCATION_SPEC.md 6.5, 8.4).
      return RetrievalService.nearFirst(me, await RetrievalService.preferenceFirst(me, ranked));
    };
    const decoded = cursor ? decodeCursor(cursor, userId) : null;
    let deck = await timed(metrics, "deckMs", () => decoded
      ? DeckService.load(decoded, me, config.version)
      : DeckService.create(me, config.version, algorithm, generate));
    let after = decoded?.after ?? -1;
    if (deck.ids.length - after - 1 < 40)
      deck = await timed(metrics, "deckMs", () => DeckService.refill(deck, generate));
    // Advance past invalid entries without changing the sequence of any stored entry.
    const selected: { id: string; sequence: number }[] = [];
    let capacityLimited = false;
    while (selected.length < limit && after + 1 < deck.ids.length) {
      const batch = deck.ids.slice(after + 1, after + 1 + Math.max(40, limit));
      const eligible = await RetrievalService.eligibleIds(me, batch);
      for (const id of batch) {
        if (eligible.has(id)) {
          const claim = await timed(metrics, "claimMs", () => ExposureReservationService.claimDetailed(
            id, ExposureReservationService.member(userId, deck.id, after + 1),
            config.flags.max_pending_per_profile, config.flags.exposure_reservation_seconds));
          if (!claim.claimed) {
            capacityLimited = true;
            metrics.capacityWait = { deckId: deck.id, sequence: after + 1, pendingCount: claim.pendingCount };
            break;
          }
        }
        after++;
        if (eligible.has(id)) selected.push({ id, sequence: after });
        if (selected.length === limit) break;
      }
      if (capacityLimited) break;
    }
    const profiles = await prisma.user.findMany({
      where: { id: { in: selected.map((x) => x.id) } },
      select: discoveryProfileSelect,
    });
    const viewer = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: discoveryProfileSelect,
    });
    const current = asViewer(await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    }));
    if (
      current.eligibilityVersion !== me.eligibilityVersion ||
      !setupComplete(current) ||
      !(await isEligibilityParty(prisma, userId))
    )
      throw new HttpError(409, "Restart discovery", "DECK_EXPIRED");
    const allowed = await RetrievalService.eligibleIds(
      current,
      selected.map((x) => x.id),
    );
    const deliverable = selected.filter(
      (item) => allowed.has(item.id) && profiles.some((p) => p.id === item.id),
    );
    await timed(metrics, "receiptMs", () => prisma.discoveryReceipt.createMany({
      data: deliverable.map((item) => ({
        id: randomUUID(),
        viewerId: userId,
        candidateId: item.id,
        deckId: deck.id,
        sequence: item.sequence,
        algorithm: deck.algorithm,
      })),
      skipDuplicates: true,
    }));
    const receipts = await prisma.discoveryReceipt.findMany({
      where: {
        viewerId: userId,
        deckId: deck.id,
        sequence: { in: deliverable.map((x) => x.sequence) },
      },
    });
    const cards = deliverable.map((item) => ({
      ...publicProfile(
        viewer,
        profiles.find((p) => p.id === item.id)!,
        config.weights,
      ),
      impressionId: receipts.find((r) => r.sequence === item.sequence)!.id,
    }));
    const remaining = after + 1 < deck.ids.length;
    const canRefill = !deck.exhausted && deck.ids.length < 2000;
    if (!decoded && afterResponse && snapshot) {
      const captured = snapshot;
      afterResponse(() => ShadowService.enqueue(me, deck, config, captured));
    }
    return {
      cards,
      nextCursor:
        remaining || canRefill
          ? encodeCursor({
              deck: deck.id,
              after,
              viewer: userId,
              expiry: deck.expiry,
              version: me.eligibilityVersion,
            })
          : null,
      state: capacityLimited
        ? "capacity_limited"
        : cards.length || canRefill
          ? "ready"
          : deck.ids.length >= 2000
            ? "generation_complete"
            : "exhausted",
      deckId: deck.id,
    };
  }
  static async invalidateCache(userId: string) {
    // Candidate eligibility is rechecked on delivery. Viewer cursors become stale.
    await prisma.user.update({
      where: { id: userId },
      data: { eligibilityVersion: { increment: 1 } },
    });
  }
}
