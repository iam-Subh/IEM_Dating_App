import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { PushService } from './push.service';

/**
 * Updates from Team IEM Connect: an in-app notice and a push, only for people
 * who keep "Updates from Team IEM Connect" on (App settings). Sent in the
 * background, in small batches, so one announcement can't stall the server.
 */

const BATCH = 200;

export class TeamUpdatesService {
  static async send(input: { title: string; body: string; url?: string }) {
    // Missing key means the default, which is on.
    const recipients = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE account_status = 'active'
        AND COALESCE((notification_prefs ->> 'team_updates')::boolean, true)`;
    void this.deliver(recipients.map((row) => row.id), input);
    return { recipients: recipients.length };
  }

  private static async deliver(ids: string[], input: { title: string; body: string; url?: string }) {
    for (let index = 0; index < ids.length; index += BATCH) {
      const batch = ids.slice(index, index + BATCH);
      try {
        await prisma.notification.createMany({
          data: batch.map((userId) => ({
            userId, type: 'team', title: input.title, body: input.body, data: {}, actionUrl: input.url ?? null,
          })),
        });
        await Promise.allSettled(batch.map((userId) => PushService.send(userId, {
          title: input.title,
          body: input.body,
          data: { url: input.url ? `iemdating:/${input.url.startsWith('/') ? '' : '/'}${input.url}` : 'iemdating://main', kind: 'team' },
          category: 'team_updates',
        })));
      } catch (error) {
        logger.error(`Team update batch failed: ${(error as Error).message}`);
      }
    }
  }
}
