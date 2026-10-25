import { VerificationLimitsService } from './verification-limits.service';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { AlgorithmConfigService } from './algorithm-config.service';

/**
 * Roses (EXPLORE_SPEC.md, section 10): a scarce, higher-priority Like, and
 * the only currency in the app. Free for now.
 *
 * Two rules do most of the work here:
 *
 *  - The weekly grant **tops the balance up to** the ceiling rather than
 *    adding to it. Hinge's free Roses behave the same way, and the reason is
 *    that accrual turns a dormant account into a spam budget: two months away
 *    would otherwise buy 160 Roses.
 *  - Five a week (STANDOUTS_PLAN.md 4.2): rare enough that a Rose is a
 *    choice, with at most two a day and one per person, ever.
 *
 * New accounts get a one-time welcome of three in their first week, and Roses
 * earned later (invites) are capped at 15 held. All of it is admin-tunable.
 */

const WEEK_MS = 7 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
export const ROSE_COMMENT_MAX = 140;

export type RoseBalance = {
  roses: number; grant: number; perDayLimit: number; refreshesAt: string; maxHeld: number;
  /** Before verifying: one Rose, once, as a trial (GOOGLE_SIGNUP_PLAN.md 2.5). */
  trial?: boolean;
};

export class RoseService {
  /** The configured numbers (algorithm config), so they change without a release. */
  static async limits() {
    const { flags } = await AlgorithmConfigService.get();
    return {
      grant: Math.max(0, Math.floor(flags.roses_weekly_grant)),
      perDay: Math.max(1, Math.floor(flags.roses_per_day)),
      receiveLimit: Math.max(1, Math.floor(flags.roses_receive_limit)),
      maxHeld: Math.max(1, Math.floor(flags.roses_max_held)),
      welcome: Math.max(0, Math.floor(flags.roses_welcome)),
    };
  }

  /**
   * The one-time welcome Roses, for an account in its first week that hasn't
   * had them. Atomic: two requests at once give them once. Never past maxHeld.
   */
  private static async giveWelcome(db: Prisma.TransactionClient | typeof prisma, userId: string, welcome: number, maxHeld: number) {
    if (welcome <= 0) return;
    await db.$executeRaw`
      UPDATE users SET roses = LEAST(roses + ${welcome}, GREATEST(roses, ${maxHeld})), welcome_roses_at = now()
      WHERE id = ${userId}::uuid AND welcome_roses_at IS NULL AND created_at > now() - interval '7 days'`;
  }

  /**
   * Roses earned outside the weekly grant (the invite plan): added, but never
   * past maxHeld. Returns the new balance.
   */
  static async award(userId: string, amount: number) {
    const { maxHeld } = await this.limits();
    const rows = await prisma.$queryRaw<{ roses: number }[]>`
      UPDATE users SET roses = LEAST(roses + ${Math.max(0, Math.floor(amount))}, GREATEST(roses, ${maxHeld}))
      WHERE id = ${userId}::uuid RETURNING roses`;
    return rows[0]?.roses ?? 0;
  }

  /**
   * The balance, after any overdue weekly top-up. Lazy: there is no job
   * sweeping every account once a week.
   */
  static async balance(userId: string): Promise<RoseBalance> {
    const { grant, perDay, maxHeld, welcome } = await this.limits();
    // Before verifying (2.5): the trial Rose, until it is sent. No weekly
    // grant and no welcome yet - both come with verifying.
    if (await VerificationLimitsService.isLimited(userId)) {
      const sent = await prisma.rose.count({ where: { senderId: userId } });
      return { roses: sent ? 0 : 1, grant, perDayLimit: 1, maxHeld, refreshesAt: new Date(Date.now() + WEEK_MS).toISOString(), trial: true };
    }
    await this.giveWelcome(prisma, userId, welcome, maxHeld);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { roses: true, rosesRefreshedAt: true },
    });
    let { roses, rosesRefreshedAt } = user;
    if (Date.now() - rosesRefreshedAt.getTime() >= WEEK_MS) {
      // Top up to the grant; never past it, and never downwards.
      const topped = Math.max(roses, grant);
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { roses: topped, rosesRefreshedAt: new Date() },
        select: { roses: true, rosesRefreshedAt: true },
      });
      roses = updated.roses;
      rosesRefreshedAt = updated.rosesRefreshedAt;
    }
    return {
      roses,
      grant,
      perDayLimit: perDay,
      maxHeld,
      refreshesAt: new Date(rosesRefreshedAt.getTime() + WEEK_MS).toISOString(),
    };
  }

  /**
   * Checks and spends one Rose **inside the caller's swipe transaction**, so a
   * Rose is never deducted for a Like that did not land, and a replayed swipe
   * never spends twice. Throws with a precise code the app can act on.
   */
  static async spendWithin(
    tx: Prisma.TransactionClient,
    senderId: string,
    recipientId: string,
    comment: string | null,
  ) {
    const { grant, perDay, maxHeld, welcome } = await this.limits();
    // Before verifying: one Rose, once - the trial (GOOGLE_SIGNUP_PLAN.md 2.5).
    // It spends nothing from the balance, which waits for verifying.
    if (await VerificationLimitsService.isLimited(senderId, tx)) {
      if (await tx.rose.count({ where: { senderId } })) {
        throw new HttpError(403, 'Verified students get 5 Roses every week. Verify your college to get yours.', 'ROSE_VERIFY_REQUIRED');
      }
      return { comment: comment?.trim().slice(0, ROSE_COMMENT_MAX) || null };
    }
    await this.giveWelcome(tx, senderId, welcome, maxHeld);
    const sender = await tx.user.findUniqueOrThrow({
      where: { id: senderId },
      select: { roses: true, rosesRefreshedAt: true },
    });
    // The same lazy top-up as `balance`, so spending is never blocked by a
    // refresh that simply has not been read yet.
    const due = Date.now() - sender.rosesRefreshedAt.getTime() >= WEEK_MS;
    const available = due ? Math.max(sender.roses, grant) : sender.roses;
    if (available < 1) throw new HttpError(409, 'You have no Roses left this week', 'NO_ROSES_LEFT');

    // One Rose per person, for good - as Hinge's, Tinder's Super Like and
    // Bumble's SuperSwipe. Rewind is the only way back: it deletes the Rose and
    // refunds it (rewind.service.ts), so a rewound Rose doesn't count here.
    const repeat = await tx.rose.findFirst({ where: { senderId, recipientId }, select: { id: true } });
    if (repeat) throw new HttpError(409, 'You already sent this person a Rose', 'ROSE_ALREADY_SENT');

    const today = await tx.rose.count({ where: { senderId, createdAt: { gte: new Date(Date.now() - DAY_MS) } } });
    if (today >= perDay) throw new HttpError(429, `You can send ${perDay} Roses a day`, 'ROSE_DAILY_LIMIT');

    await tx.user.update({
      where: { id: senderId },
      data: { roses: available - 1, ...(due ? { rosesRefreshedAt: new Date() } : {}) },
    });
    return { comment: comment?.trim().slice(0, ROSE_COMMENT_MAX) || null };
  }

  /** Records the Rose once its swipe exists, in the same transaction. */
  static async recordWithin(
    tx: Prisma.TransactionClient,
    senderId: string,
    recipientId: string,
    swipeId: string,
    comment: string | null,
  ) {
    await tx.rose.create({ data: { senderId, recipientId, swipeId, comment } });
  }
}
