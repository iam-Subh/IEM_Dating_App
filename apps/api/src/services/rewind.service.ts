import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';

/**
 * Rewind (EXPLORE_SPEC.md, section 12): undoing the swipe you just made.
 *
 * Every other app sells this. It is free here, but deliberately narrow: the
 * **last** swipe, within REWIND_WINDOW_SECONDS, and **once** for a given
 * person. That is enough to fix a misplaced thumb, which is the only thing it
 * is for. A longer window turns Rewind into a way to re-open and re-examine
 * profiles you already dismissed, which is a different feature wearing this
 * one's name.
 *
 * Three things it refuses outright:
 *
 * - A swipe that created a match. The other person can already see the
 *   conversation; taking it back would delete something real from under them.
 * - A second rewind of the same person, so swipe-rewind-swipe cannot become an
 *   unlimited re-examination loop.
 * - Anything but the most recent swipe.
 */

export const REWIND_WINDOW_SECONDS = 60;
/** How long a rewind blocks another one for the same person. */
const REWIND_COOLDOWN_HOURS = 24;

export class RewindService {
  /** What the app needs to decide whether to offer the button at all. */
  static async available(viewerId: string) {
    const last = await prisma.swipe.findFirst({
      where: { swiperId: viewerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, targetId: true, action: true, createdAt: true },
    });
    if (!last) return { available: false as const, secondsLeft: 0 };
    const secondsLeft = Math.ceil(
      (last.createdAt.getTime() + REWIND_WINDOW_SECONDS * 1000 - Date.now()) / 1000,
    );
    if (secondsLeft <= 0) return { available: false as const, secondsLeft: 0 };
    if (await this.alreadyRewound(viewerId, last.targetId)) {
      return { available: false as const, secondsLeft: 0 };
    }
    return {
      available: true as const,
      secondsLeft,
      targetId: last.targetId,
      action: last.action,
    };
  }

  /**
   * @param expectedTargetId who the caller believes it is undoing. The app
   *   always sends it: "undo my last swipe" and "undo the swipe this button is
   *   offering" are different things the moment another surface records a
   *   swipe in between, and undoing the wrong person silently is worse than
   *   refusing.
   */
  static async rewind(viewerId: string, expectedTargetId?: string) {
    const last = await prisma.swipe.findFirst({
      where: { swiperId: viewerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, targetId: true, action: true, createdAt: true },
    });
    if (!last) throw new HttpError(404, 'There is nothing to undo', 'NOTHING_TO_REWIND');
    if (expectedTargetId && expectedTargetId !== last.targetId) {
      throw new HttpError(
        409,
        'You have swiped on someone else since. Only the last swipe can be undone.',
        'REWIND_TARGET_MISMATCH',
      );
    }
    if (Date.now() - last.createdAt.getTime() > REWIND_WINDOW_SECONDS * 1000) {
      throw new HttpError(
        409,
        `Rewind only works within ${REWIND_WINDOW_SECONDS} seconds of a swipe`,
        'REWIND_WINDOW_PASSED',
      );
    }
    if (await this.alreadyRewound(viewerId, last.targetId)) {
      throw new HttpError(409, 'You have already undone a swipe on this person', 'REWIND_ALREADY_USED');
    }

    const [a, b] = [viewerId, last.targetId].sort();
    return prisma.$transaction(async (tx) => {
      // The same pair lock the swipe itself takes, so a rewind cannot race the
      // other person's swipe landing and turning this into a match.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${a}:${b}`}, 0))`;

      const match = await tx.match.findFirst({
        where: {
          OR: [{ user1Id: a, user2Id: b }, { user1Id: b, user2Id: a }],
          status: 'active',
        },
        select: { id: true },
      });
      if (match) {
        throw new HttpError(
          409,
          'That was a match. Unmatch from the conversation instead.',
          'REWIND_WOULD_UNMATCH',
        );
      }

      // Re-read inside the lock: the row may already be gone.
      const swipe = await tx.swipe.findUnique({ where: { id: last.id }, select: { id: true, action: true } });
      if (!swipe) throw new HttpError(404, 'There is nothing to undo', 'NOTHING_TO_REWIND');

      // A Rose spent on this swipe comes back, because the Like it bought is
      // being taken back with it.
      const rose = await tx.rose.findFirst({ where: { swipeId: swipe.id }, select: { id: true } });
      if (rose) {
        await tx.rose.delete({ where: { id: rose.id } });
        await tx.user.update({ where: { id: viewerId }, data: { roses: { increment: 1 } } });
      }

      await tx.swipe.delete({ where: { id: swipe.id } });
      const liked = swipe.action === 'like';
      await tx.userScore.updateMany({
        where: { userId: viewerId },
        data: {
          totalSwipesOut: { decrement: 1 },
          totalRightSwipes: { decrement: liked ? 1 : 0 },
        },
      });
      await tx.userScore.updateMany({
        where: { userId: last.targetId },
        data: {
          totalSwipesReceived: { decrement: 1 },
          totalLikesReceived: { decrement: liked ? 1 : 0 },
        },
      });
      // The card is undecided again, so the impression is unacted again.
      await tx.profileImpression.updateMany({
        where: { viewerId, shownId: last.targetId, day: new Date(new Date().toISOString().slice(0, 10)) },
        data: { acted: false },
      });
      // Recorded rather than erased: this is both the audit trail and the
      // thing that stops a second rewind on the same person.
      await tx.analyticsEvent.create({
        data: {
          userId: viewerId,
          eventType: 'swipe_rewound',
          eventData: { targetId: last.targetId, action: swipe.action, roseRefunded: !!rose },
        },
      });
      return { targetId: last.targetId, action: swipe.action, roseRefunded: !!rose };
    });
  }

  private static async alreadyRewound(viewerId: string, targetId: string) {
    const since = new Date(Date.now() - REWIND_COOLDOWN_HOURS * 60 * 60_000);
    const previous = await prisma.analyticsEvent.findFirst({
      where: {
        userId: viewerId,
        eventType: 'swipe_rewound',
        createdAt: { gte: since },
        eventData: { path: ['targetId'], equals: targetId },
      },
      select: { id: true },
    });
    return !!previous;
  }
}
