import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
import { ImpressionService } from './impression.service';
import { logger } from '../utils/logger';

export class MatchService {
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
            age: true,
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
            age: true,
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
          age: otherUser.age,
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

  /**
   * Perform a swipe action with daily limit enforcement.
   * Creates a Match record on mutual like.
   */
  static async performSwipe(
    userId: string,
    targetUserId: string,
    action: 'like' | 'pass'
  ) {
    // Enforce daily swipe limit via Redis
    const dateStr = new Date().toISOString().split('T')[0];
    const limitKey = `swipes:${userId}:${dateStr}`;

    const swipeCount = await redisClient.incr(limitKey);
    if (swipeCount === 1) {
      await redisClient.expire(limitKey, 86400);
    }

    if (swipeCount > 100) {
      throw new Error('Daily swipe limit (100) reached. Try again tomorrow!');
    }

    // Record swipe
    await prisma.swipe.upsert({
      where: {
        swiperId_targetId: {
          swiperId: userId,
          targetId: targetUserId,
        },
      },
      update: { action },
      create: {
        swiperId: userId,
        targetId: targetUserId,
        action,
      },
    });

    // Close the loop on the impression that led to this swipe, so
    // click-through rate is available without joining the swipes table.
    ImpressionService.markActed(userId, targetUserId).catch(() => {});

    // Check for mutual match
    let matchCreated = false;
    let matchId: string | undefined;

    if (action === 'like') {
      const mutualLike = await prisma.swipe.findUnique({
        where: {
          swiperId_targetId: {
            swiperId: targetUserId,
            targetId: userId,
          },
        },
      });

      if (mutualLike && mutualLike.action === 'like') {
        // Check if match already exists
        const existingMatch = await prisma.match.findFirst({
          where: {
            OR: [
              { user1Id: userId, user2Id: targetUserId },
              { user1Id: targetUserId, user2Id: userId },
            ],
          },
        });

        if (!existingMatch) {
          const match = await prisma.match.create({
            data: {
              user1Id: userId,
              user2Id: targetUserId,
              status: 'active',
            },
          });
          matchCreated = true;
          matchId = match.id;
          logger.info(`[MATCH] New match created: ${match.id} between ${userId.slice(0, 8)} and ${targetUserId.slice(0, 8)}`);
        } else {
          matchCreated = true;
          matchId = existingMatch.id;
        }
      }
    }

    return {
      status: 'recorded',
      action,
      swipeCount,
      matchCreated,
      matchId,
    };
  }
}
