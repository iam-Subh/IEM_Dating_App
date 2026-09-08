import { SwipeService } from './swipe.service';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { ImpressionService } from './impression.service';
import { logger } from '../utils/logger';
import { ageAt } from './eligibility.service';
import { HttpError } from '../utils/httpError';
import { evictMatchRoom } from '../socket';
import { AccountEventService } from './account-event.service';

export class MatchService {
  static async unmatch(userId: string, matchId: string) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${matchId}, 1))`;
      const match = await tx.match.findFirst({
        where: { id: matchId, OR: [{ user1Id: userId }, { user2Id: userId }] },
        select: { id: true, status: true, user1Id: true, user2Id: true },
      });
      if (!match) throw new HttpError(404, 'Match is unavailable', 'MATCH_UNAVAILABLE');
      if (match.status !== 'active') return { matchId, repeated: true };
      await tx.match.update({ where: { id: matchId }, data: { status: 'unmatched' } });
      await tx.follow.updateMany({
        where: { OR: [{ followerId: match.user1Id, followeeId: match.user2Id }, { followerId: match.user2Id, followeeId: match.user1Id }] },
        data: { status: 'removed', removedAt: new Date(), revision: { increment: 1 } },
      });
      await AccountEventService.append(tx, {
        userIds: [match.user1Id, match.user2Id], type: 'access.revoked', matchId, payload: { reason: 'unmatched' },
      });
      return { matchId, repeated: false };
    });
    evictMatchRoom(matchId);
    return result;
  }
  /**
   * Get all active matches for a user, with the other user's profile info.
   */
  static async getMatches(userId: string) {
    const matches = await prisma.match.findMany({
      where: {
        status: 'active',
        OR: [
          { user1Id: userId },
          { user2Id: userId },
        ],
      },
      include: {
        user1: {
          select: {
            id: true,
            name: true,
            birthday: true,
            department: true,
            avatarUrl: true,
            photos: {
              where: { isPrimary: true },
              select: { photoUrl: true },
              take: 1,
            },
          },
        },
        user2: {
          select: {
            id: true,
            name: true,
            birthday: true,
            department: true,
            avatarUrl: true,
            photos: {
              where: { isPrimary: true },
              select: { photoUrl: true },
              take: 1,
            },
          },
        },
        messages: {
          where: { isDeleted: false, NOT: { hiddenBy: { has: userId } } },
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: {
            content: true,
            sentAt: true,
            senderId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return matches.map((match) => {
      const otherUser = match.user1Id === userId ? match.user2 : match.user1;
      const lastMsg = match.messages[0] || null;

      return {
        matchId: match.id,
        user: {
          id: otherUser.id,
          name: otherUser.name,
          age: ageAt(otherUser.birthday),
          department: otherUser.department,
          avatar: otherUser.avatarUrl || otherUser.photos[0]?.photoUrl || null,
        },
        lastMessage: lastMsg
          ? { content: lastMsg.content, sentAt: lastMsg.sentAt, senderId: lastMsg.senderId }
          : null,
        matchedAt: match.createdAt,
      };
    });
  }

  static async performSwipe(userId: string, targetUserId: string, action: 'like' | 'pass') {
    return SwipeService.perform(userId, targetUserId, action);
  }
}
