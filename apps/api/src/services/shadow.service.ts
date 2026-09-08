import { shadowMetrics } from "./shadow-metrics";
import { PrismaClient, User } from "@prisma/client";
import { AlgorithmConfig } from "./algorithm-config.service";
import { Deck } from "./deck.service";
import { logger } from "../utils/logger";
import { rankCandidates, RankingCandidate } from "./ranking-policy";
export class ShadowService {
  private static active = false;
  private static queue: {
    me: User;
    deck: Deck;
    config: AlgorithmConfig;
    candidates: RankingCandidate[];
  }[] = [];
  private static outcomes: boolean[] = [];
  private static disabled = false;
  private static db: PrismaClient | undefined;
  private static dropped = 0;
  private static completed = 0;
  private static failed = 0;
  static status() {
    return {
      queued: this.queue.length,
      active: this.active,
      circuitOpen: this.disabled,
      dropped: this.dropped,
      completed: this.completed,
      failed: this.failed,
    };
  }
  static enqueue(
    me: User,
    deck: Deck,
    config: AlgorithmConfig,
    candidates: RankingCandidate[],
  ) {
    if (
      !config.flags.shadow_enabled ||
      this.disabled ||
      Math.random() >= config.flags.shadow_sample_rate
    )
      return;
    if (this.queue.length >= config.flags.shadow_max_queue) {
      this.dropped++;
      return;
    }
    this.queue.push({
      me,
      deck: { ...deck, ids: [...deck.ids] },
      config,
      candidates: candidates.map((p) => ({ ...p })),
    });
    if (!this.active) setImmediate(() => void this.drain());
  }
  private static async drain() {
    if (this.active) return;
    this.active = true;
    try {
      if (!this.db) {
        const url = new URL(process.env.DATABASE_URL!);
        url.searchParams.set("connection_limit", "1");
        this.db = new PrismaClient({
          datasources: { db: { url: url.toString() } },
        });
      }
      while (this.queue.length && !this.disabled) {
        const job = this.queue.shift()!;
        const started = Date.now();
        try {
          const enabled = await this.db.algorithmConfig.findUnique({
            where: { key: "shadow_enabled" },
          });
          if (enabled?.value !== 1) {
            this.queue = [];
            break;
          }
          const rank = (policy: boolean) =>
            rankCandidates(
              job.candidates,
              job.me.id,
              job.deck.seed,
              policy,
              job.config.flags.cold_slots_per_10,
              job.config.flags.incoming_slots_per_10,
            );
          const policyOff = rank(false), policyOn = rank(true);
          const ids = job.deck.algorithm === 1 ? policyOff : policyOn;
          const controlIds = job.deck.algorithm === 1 ? policyOn : policyOff;
          await this.db.shadowRanking.create({
            data: {
              viewerId: job.me.id,
              deckId: job.deck.id,
              report: {
                kind: "ranking_diagnostic",
                experimentScope: "rebuilt_scoring_policy_on_vs_off",
                legacyBaseline: false,
                inputVersion: job.me.eligibilityVersion,
                configVersion: job.config.version,
                controlAlgorithm: job.deck.algorithm,
                shadowAlgorithm: job.deck.algorithm === 1 ? 0 : 1,
                elapsedMs: Date.now() - started,
                candidateIds: ids.slice(0, 100),
                controlIds: controlIds.slice(0, 100),
                identicalInputs: true,
                metricsVersion: 2,
                ...shadowMetrics(policyOff, policyOn, job.candidates),
                candidateCount: ids.length,
              },
            },
          });
          this.outcomes.push(false);
          this.completed++;
        } catch (error) {
          this.failed++;
          this.outcomes.push(true);
          logger.warn("Shadow job failed", { message: String(error) });
        }
        this.outcomes = this.outcomes.slice(-100);
        if (
          this.outcomes.length === 100 &&
          this.outcomes.filter(Boolean).length > 5
        ) {
          this.disabled = true;
          this.queue = [];
        }
      }
    } catch (error) {
      logger.warn("Shadow worker unavailable", { message: String(error) });
      this.queue = [];
    } finally {
      this.active = false;
    }
  }
  static async stop() {
    this.disabled = true;
    this.queue = [];
    if (this.db) await this.db.$disconnect();
  }
}
