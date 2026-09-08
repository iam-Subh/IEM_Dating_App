import { Prisma, PrismaClient } from '@prisma/client';
import { RankingMetrics } from './discovery-ranking.service';

export type PageMetrics = {
  capacityWait?: { deckId: string; sequence: number; pendingCount: number };
  kind: 'cached' | 'generate' | 'refill' | 'setup'; state: string; totalMs: number;
  deckMs: number; retrievalMs: number; rankingMs: number; claimMs: number; receiptMs: number;
  generations: number; refills: number; algorithm: number | null; delivered: number; ranking: RankingMetrics[];
};
export function pageMetrics(): PageMetrics {
  return { kind: 'cached', state: 'error', totalMs: 0, deckMs: 0, retrievalMs: 0,
    rankingMs: 0, claimMs: 0, receiptMs: 0, generations: 0, refills: 0, algorithm: null, delivered: 0, ranking: [] };
}
export async function timed<T>(metrics: PageMetrics, key: 'deckMs' | 'retrievalMs' | 'rankingMs' | 'claimMs' | 'receiptMs', work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await work(); } finally { metrics[key] += performance.now() - started; }
}

// One isolated connection and at most 200 queued events per process. Never await on the request path.
export class DiscoveryTelemetry {
  private static queue: Prisma.AnalyticsEventCreateManyInput[] = [];
  private static running: Promise<void> | undefined;
  private static dropped = 0;
  private static failed = 0;
  private static completed = 0;
  static status() { return { queued: this.queue.length, dropped: this.dropped, failed: this.failed, completed: this.completed, sampleRate: this.sampleRate() }; }
  private static sampleRate() {
    const value = Number(process.env.DISCOVERY_TELEMETRY_SAMPLE_RATE ?? '0.1');
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.1;
  }
  static record(metrics: PageMetrics) {
    if (Math.random() < this.sampleRate()) this.enqueue('discovery_page_timings', { ...metrics, sampleRate: this.sampleRate() });
    if (metrics.state !== 'ready') this.enqueue('discovery_deck_state', { state: metrics.state, kind: metrics.kind });
    if (metrics.state === 'capacity_limited') this.enqueue('discovery_capacity_wait', { ...metrics.capacityWait, delivered: metrics.delivered });
  }
  static enqueue(eventType: string, eventData: Prisma.InputJsonObject) {
    if (this.queue.length >= 200) { this.dropped++; return; }
    this.queue.push({ eventType, eventData });
    if (!this.running) this.running = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.drain());
  }
  private static async drain() {
    let db: PrismaClient | undefined;
    try {
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('connection_limit', '1');
      url.searchParams.set('connect_timeout', '2');
      db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
      while (this.queue.length) {
        const batch = this.queue.splice(0, 20);
        try {
          await db.$transaction(async tx => {
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout='1000ms'");
            await tx.analyticsEvent.createMany({ data: batch });
          }, { timeout: 2000, maxWait: 1000 });
          this.completed += batch.length;
        } catch { this.failed += batch.length; }
      }
    } catch { this.failed += this.queue.length; this.queue = []; }
    finally {
      await db?.$disconnect().catch(() => {});
      this.running = undefined;
      if (this.queue.length) this.running = this.drain();
    }
  }
  static async flush() { while (this.running) await this.running; }
}
