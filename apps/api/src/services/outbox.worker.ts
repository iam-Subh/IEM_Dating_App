import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { OutboxDeliveryService } from './outbox-delivery.service';

type ClaimedEvent = {
  id: string;
  topic: string;
  aggregateId: string;
  payloadVersion: number;
  payload: Prisma.JsonValue;
  attempts: number;
};

const MAX_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 500;
const CLAIM_LEASE_MINUTES = 5;

export class OutboxWorker {
  private static timer: NodeJS.Timeout | undefined;
  private static running = false;
  private static stopping = false;
  private static readonly workerId = `${process.pid}:${randomUUID()}`;

  static start(): void {
    if (this.timer || this.running) return;
    this.stopping = false;
    this.timer = setInterval(() => void this.drain(), POLL_INTERVAL_MS);
    this.timer.unref();
    void this.drain();
  }

  static async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const deadline = Date.now() + 10_000;
    while (this.running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  static async runOnce(): Promise<boolean> {
    const event = await this.claimNext();
    if (!event) return false;
    try {
      await OutboxDeliveryService.deliver(event);
      await prisma.outboxEvent.updateMany({
        where: { id: event.id, status: 'processing', lockedBy: this.workerId },
        data: { status: 'completed', completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
      });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 500);
      const terminal = event.attempts >= MAX_ATTEMPTS;
      const delaySeconds = Math.min(300, 2 ** Math.min(event.attempts, 8));
      await prisma.outboxEvent.updateMany({
        where: { id: event.id, status: 'processing', lockedBy: this.workerId },
        data: {
          status: terminal ? 'dead' : 'pending',
          availableAt: terminal ? new Date() : new Date(Date.now() + delaySeconds * 1000),
          lockedAt: null,
          lockedBy: null,
          lastError: message,
        },
      });
      logger.warn('Outbox delivery failed', { eventId: event.id, topic: event.topic, attempts: event.attempts });
    }
    return true;
  }

  private static async drain(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      for (let count = 0; count < 100 && !this.stopping; count++) {
        if (!(await this.runOnce())) break;
      }
    } catch (error) {
      logger.error('Outbox worker failed', { message: String(error) });
    } finally {
      this.running = false;
    }
  }

  private static async claimNext(): Promise<ClaimedEvent | null> {
    const rows = await prisma.$queryRaw<ClaimedEvent[]>(Prisma.sql`
      WITH candidate AS (
        SELECT id
        FROM outbox_events
        WHERE attempts < ${MAX_ATTEMPTS}
          AND (
            (status = 'pending' AND available_at <= now())
            OR (status = 'processing' AND locked_at < now() - (${CLAIM_LEASE_MINUTES} * interval '1 minute'))
          )
        ORDER BY available_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE outbox_events AS event
      SET status = 'processing',
          attempts = event.attempts + 1,
          locked_at = now(),
          locked_by = ${this.workerId}
      FROM candidate
      WHERE event.id = candidate.id
      RETURNING event.id,
                event.topic,
                event.aggregate_id AS "aggregateId",
                event.payload_version AS "payloadVersion",
                event.payload,
                event.attempts
    `);
    return rows[0] ?? null;
  }
}
