import { prisma } from '../utils/prisma';

/**
 * A suspension from the admin panel ends on its own: the first sign-in after
 * `suspendedUntil` finds the account active again (ADMIN_PANEL_PLAN.md 4).
 */
export async function liftExpiredSuspension<T extends { id: string; accountStatus: string; suspendedUntil?: Date | null }>(user: T): Promise<T> {
  if (user.accountStatus !== 'suspended' || !user.suspendedUntil || user.suspendedUntil > new Date()) return user;
  await prisma.user.updateMany({
    where: { id: user.id, accountStatus: 'suspended' },
    data: { accountStatus: 'active', suspendedUntil: null, eligibilityVersion: { increment: 1 } },
  });
  return { ...user, accountStatus: 'active', suspendedUntil: null };
}
