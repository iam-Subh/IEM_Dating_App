import type { PrismaClient } from '@prisma/client';

/**
 * Live sessions: "your signed-in devices changed - re-read them", to every
 * device of one person, whenever a phone or browser signs in or is signed out
 * - by them, by a password change, by the team. Carries nothing; the
 * Active sessions page re-reads `/auth/sessions`.
 *
 * Installed once on the Prisma client, so no code path that signs someone in
 * or out can forget to announce it. A token refresh (every 15 minutes per
 * device) is not news: it is skipped.
 */
const pending = new Map<string, ReturnType<typeof setTimeout>>();
export function announceSessions(userId: string) {
  if (pending.has(userId)) return;
  pending.set(userId, setTimeout(() => {
    pending.delete(userId);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getIO } = require('../socket') as typeof import('../socket');
    getIO()?.to(`user:${userId}`).emit('sessions_changed', {});
  }, 250));
}

const signsOut = (data: any) => !!data?.revokedAt && data?.revokeReason !== 'ROTATED';

export function installSessionLive(client: PrismaClient) {
  client.$use(async (params, next) => {
    const result = await next(params);
    if (params.model !== 'UserSession') return result;
    try {
      if (params.action === 'create') {
        const row = result as { id: string; userId: string; familyId: string };
        // A refresh adds a row to an existing family; a sign-in starts one.
        const family = await client.userSession.count({ where: { familyId: row.familyId, id: { not: row.id } } });
        if (!family) announceSessions(row.userId);
      } else if (params.action === 'update' && signsOut(params.args?.data)) {
        const row = result as { userId?: string };
        if (row?.userId) announceSessions(row.userId);
      } else if ((params.action === 'updateMany' && signsOut(params.args?.data)) || params.action === 'deleteMany') {
        const where = params.args?.where ?? {};
        if (typeof where.userId === 'string') announceSessions(where.userId);
        else if (typeof where.familyId === 'string') {
          // A whole device signed out at once (a stolen refresh token): whose it was.
          const row = await client.userSession.findFirst({ where: { familyId: where.familyId }, select: { userId: true } });
          if (row) announceSessions(row.userId);
        }
      }
    } catch {
      // Live updates are a nicety; the write itself already succeeded.
    }
    return result;
  });
}
