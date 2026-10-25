import { PushService } from '../services/push.service';
import { Router } from 'express';
import { protect } from '../middlewares/auth.middleware';
import { prisma } from '../utils/prisma';
import { ApiResponse } from '../utils/ApiResponse';
import { evictMatchRoom } from '../socket';
import { transformToCdnUrl } from '../middlewares/upload.middleware';
import { AccountEventService } from '../services/account-event.service';
import { LikesService } from '../services/likes.service';
import { NotificationFeedService } from '../services/notification-feed.service';

const router = Router();

/**
 * POST /block — Block a user.
 * Prevents them from appearing in recommendations and messaging.
 */
router.post('/', protect, async (req, res, next) => {
  try {
    const userId = (req as any).user.sub;
    const { blockedId } = req.body;

    if (typeof blockedId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(blockedId)) {
      res.status(400).json(ApiResponse.error('blockedId is required'));
      return;
    }

    if (userId === blockedId) {
      res.status(400).json(ApiResponse.error('Cannot block yourself'));
      return;
    }

    const [a, b] = [userId, blockedId].sort();
    const blockedMatchIds = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${a}:${b}`}, 0))`;
      await tx.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId: userId, blockedId } },
        update: {}, create: { blockerId: userId, blockedId },
      });
      const matches = await tx.match.findMany({
        where: { OR: [{ user1Id: userId, user2Id: blockedId }, { user1Id: blockedId, user2Id: userId }], status: 'active' },
        select: { id: true },
      });
      await tx.match.updateMany({ where: { id: { in: matches.map((match) => match.id) } }, data: { status: 'blocked' } });
      await tx.follow.updateMany({
        where: { OR: [{ followerId: userId, followeeId: blockedId }, { followerId: blockedId, followeeId: userId }] },
        data: { status: 'removed', removedAt: new Date(), revision: { increment: 1 } },
      });
      await tx.storyPreference.deleteMany({
        where: { OR: [{ viewerId: userId, authorId: blockedId }, { viewerId: blockedId, authorId: userId }] },
      });
      // Close Friends is a trust list: blocking ends that, either way, so an
      // unblock later cannot silently restore private Stories. "Hide story
      // from" rows stay, since they only ever withhold more.
      await tx.storyCloseFriend.deleteMany({
        where: { OR: [{ ownerId: userId, friendId: blockedId }, { ownerId: blockedId, friendId: userId }] },
      });
      for (const match of matches) {
        await AccountEventService.append(tx, {
          userIds: [userId, blockedId], type: 'access.revoked', matchId: match.id, payload: { reason: 'blocked' },
        });
      }
      return matches.map((match) => match.id);
    });
    blockedMatchIds.forEach(evictMatchRoom);
    // A Like either of them sent the other leaves both lists, live.
    LikesService.nudge([userId, blockedId]);
    void NotificationFeedService.forgetBetween(userId, blockedId).catch(() => undefined);
    // Their chat's notifications leave both people's status bars too.
    for (const matchId of blockedMatchIds) {
      for (const id of [userId, blockedId]) void PushService.clear(id, { matchId, end: true }).catch(() => undefined);
    }

    res.status(200).json(ApiResponse.success({ blockedId }, 'User blocked successfully'));
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /block/:blockedId — Unblock a user.
 */
router.delete('/:blockedId', protect, async (req, res, next) => {
  try {
    const userId = (req as any).user.sub;
    const blockedId = req.params.blockedId as string;

    await prisma.userBlock.deleteMany({
      where: {
        blockerId: userId,
        blockedId,
      },
    });
    LikesService.nudge([userId, blockedId]);

    res.status(200).json(ApiResponse.success({ blockedId }, 'User unblocked'));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /block — Get list of blocked users.
 */
router.get('/', protect, async (req, res, next) => {
  try {
    const userId = (req as any).user.sub;

    const blocks = await prisma.userBlock.findMany({
      where: { blockerId: userId },
      include: {
        blocked: {
          select: { id: true, name: true, avatarUrl: true, department: true, photos: { where: { isPrimary: true }, select: { photoUrl: true }, take: 1 } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = blocks.map((b) => {
      const photo = b.blocked.photos[0]?.photoUrl ?? b.blocked.avatarUrl;
      return {
        userId: b.blocked.id,
        name: b.blocked.name,
        avatar: photo ? transformToCdnUrl(photo) : null,
        department: b.blocked.department,
        blockedAt: b.createdAt,
      };
    });

    res.status(200).json(ApiResponse.success(formatted));
  } catch (error) {
    next(error);
  }
});

export default router;
