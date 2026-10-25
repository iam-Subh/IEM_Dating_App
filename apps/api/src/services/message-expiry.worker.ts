import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { ChatEventService } from './chat-event.service';

const SWEEP_INTERVAL_MS = 15_000;
const BATCH_SIZE = 200;

/**
 * Deletes messages whose auto-delete deadline has passed.
 *
 * Reads already hide a message the moment its deadline passes, so this is not
 * what makes it disappear on time; it is what makes it actually gone. Content
 * and attachment keys are wiped the same way an unsend wipes them, and both
 * clients receive the same `message.deleted` event, so nothing new is needed on
 * the device to drop it.
 */
export class MessageExpiryWorker {
  private static timer: NodeJS.Timeout | undefined;
  private static running = false;

  static start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
    void this.sweep();
  }

  static async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const deadline = Date.now() + 5_000;
    while (this.running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** Runs one sweep to completion and returns how many messages it removed. */
  static async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let removed = 0;
    try {
      for (;;) {
        const due = await prisma.message.findMany({
          where: { isDeleted: false, expiresAt: { lte: new Date() } },
          orderBy: { expiresAt: 'asc' },
          take: BATCH_SIZE,
          select: { id: true, matchId: true, senderId: true },
        });
        if (!due.length) break;
        for (const message of due) {
          const expired = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${message.matchId}, 1))`;
            // Conditional, so a message unsent in the meantime - or swept by another
            // server instance - is not deleted twice or announced twice.
            const wiped = await tx.message.updateMany({
              where: { id: message.id, isDeleted: false },
              data: { isDeleted: true, content: '', mediaKeys: [], photoUrl: null, deletedForEveryoneAt: new Date(), revision: { increment: 1 } },
            });
            if (!wiped.count) return false;
            const { revision } = await tx.message.findUniqueOrThrow({ where: { id: message.id }, select: { revision: true } });
            await ChatEventService.append(tx, {
              matchId: message.matchId,
              type: 'message.deleted',
              actorId: message.senderId,
              entityId: message.id,
              entityRevision: revision,
              payload: { messageId: message.id, mode: 'expired', revision },
            });
            return true;
          });
          if (expired) removed += 1;
        }
        if (due.length < BATCH_SIZE) break;
      }
    } catch (error) {
      logger.error('Message expiry sweep failed', { message: String(error) });
    } finally {
      this.running = false;
    }
    return removed;
  }
}
