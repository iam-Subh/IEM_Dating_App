import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';
import { mutuallyEligible } from './eligibility.service';

export class FollowService {
  private static async requireAllowedPair(followerId: string, followeeId: string) {
    if (followerId === followeeId) throw new HttpError(400, 'You cannot follow your own account', 'INVALID_FOLLOW');
    const [users, memberships, blocked, activeMatch, disqualifyingPass] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: [followerId, followeeId] } } }),
      prisma.studentMembership.findMany({ where: { userId: { in: [followerId, followeeId] } } }),
      prisma.userBlock.count({
        where: { OR: [{ blockerId: followerId, blockedId: followeeId }, { blockerId: followeeId, blockedId: followerId }] },
      }),
      prisma.match.count({ where: { status: 'active', OR: [{ user1Id: followerId, user2Id: followeeId }, { user1Id: followeeId, user2Id: followerId }] } }),
      prisma.swipe.count({ where: { action: 'pass', OR: [{ swiperId: followerId, targetId: followeeId }, { swiperId: followeeId, targetId: followerId }] } }),
    ]);
    const follower = users.find((item) => item.id === followerId);
    const followee = users.find((item) => item.id === followeeId);
    const followerMembership = memberships.find((item) => item.userId === followerId);
    const followeeMembership = memberships.find((item) => item.userId === followeeId);
    const validMembership = (membership: typeof followerMembership) => membership?.status === 'verified' && !!membership.verifiedAt && (!membership.expiresAt || membership.expiresAt > new Date());
    if (!follower || !followee || blocked || follower.accountStatus !== 'active' || followee.accountStatus !== 'active') {
      throw new HttpError(404, 'Account is unavailable', 'FOLLOW_ACCOUNT_UNAVAILABLE');
    }
    if (!validMembership(followerMembership) || !validMembership(followeeMembership) || followerMembership!.institutionId !== followeeMembership!.institutionId) {
      throw new HttpError(404, 'Account is unavailable', 'FOLLOW_ACCOUNT_UNAVAILABLE');
    }
    if (!followee.preferencesConfirmedAt || !followee.storiesEnabled || !followee.allowFollowRequests) throw new HttpError(404, 'Account is unavailable', 'FOLLOW_ACCOUNT_UNAVAILABLE');
    if (!activeMatch && (!mutuallyEligible(follower, followee) || disqualifyingPass)) {
      throw new HttpError(404, 'Account is unavailable', 'FOLLOW_ACCOUNT_UNAVAILABLE');
    }
    return { follower, followee };
  }

  static async request(followerId: string, followeeId: string) {
    return prisma.$transaction(async (tx) => {
      const key = [followerId, followeeId].sort().join(':');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const { follower, followee } = await this.requireAllowedPair(followerId, followeeId);
      const current = await tx.follow.findUnique({ where: { followerId_followeeId: { followerId, followeeId } } });
      if (current?.status === 'accepted' || current?.status === 'pending') return { ...current, repeated: true };
      if (current?.cooldownUntil && current.cooldownUntil > new Date()) {
        throw new HttpError(429, 'Wait before you send another follow request', 'FOLLOW_COOLDOWN');
      }
      const follow = await tx.follow.upsert({
        where: { followerId_followeeId: { followerId, followeeId } },
        create: { followerId, followeeId },
        update: { status: 'pending', requestedAt: new Date(), respondedAt: null, removedAt: null, revision: { increment: 1 } },
      });
      await OutboxService.enqueue(tx, {
        topic: OUTBOX_TOPICS.FOLLOW_REQUESTED,
        aggregateId: follow.id,
        deduplicationKey: `follow.requested:${follow.id}:${follow.revision}`,
        payload: { recipientId: followee.id, requesterName: follower.name },
      });
      return { ...follow, repeated: false };
    });
  }

  static async respond(userId: string, followId: string, accept: boolean) {
    const follow = await prisma.follow.findFirst({ where: { id: followId, followeeId: userId, status: 'pending' } });
    if (!follow) throw new HttpError(404, 'Follow request is unavailable', 'FOLLOW_REQUEST_UNAVAILABLE');
    return prisma.$transaction(async (tx) => {
      const key = [follow.followerId, follow.followeeId].sort().join(':');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      await this.requireAllowedPair(follow.followerId, follow.followeeId);
      const current = await tx.follow.findFirst({ where: { id: follow.id, followeeId: userId, status: 'pending' } });
      if (!current) throw new HttpError(404, 'Follow request is unavailable', 'FOLLOW_REQUEST_UNAVAILABLE');
      return tx.follow.update({
        where: { id: current.id },
        data: {
          status: accept ? 'accepted' : 'rejected', respondedAt: new Date(),
          cooldownUntil: accept ? null : new Date(Date.now() + 30 * 24 * 60 * 60_000), revision: { increment: 1 },
        },
      });
    });
  }

  static async remove(userId: string, otherUserId: string, direction: 'following' | 'follower' = 'following') {
    const result = await prisma.follow.updateMany({
      where: {
        status: { in: ['accepted', 'pending'] },
        followerId: direction === 'following' ? userId : otherUserId,
        followeeId: direction === 'following' ? otherUserId : userId,
      },
      data: { status: 'removed', removedAt: new Date(), cooldownUntil: new Date(Date.now() + 30 * 24 * 60 * 60_000), revision: { increment: 1 } },
    });
    return { removed: result.count > 0 };
  }

  static async requests(userId: string) {
    const requests = await prisma.follow.findMany({
      where: { followeeId: userId, status: 'pending' },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const users = await prisma.user.findMany({ where: { id: { in: requests.map((item) => item.followerId) } }, select: { id: true, name: true, avatarUrl: true } });
    const map = new Map(users.map((item) => [item.id, item]));
    return requests.map((item) => ({ ...item, requester: map.get(item.followerId) }));
  }

  static async list(userId: string, direction: 'followers' | 'following') {
    const rows = await prisma.follow.findMany({
      where: direction === 'followers' ? { followeeId: userId, status: 'accepted' } : { followerId: userId, status: 'accepted' },
      orderBy: [{ respondedAt: 'desc' }, { id: 'desc' }], take: 200,
    });
    const ids = rows.map((item) => direction === 'followers' ? item.followerId : item.followeeId);
    const users = await prisma.user.findMany({ where: { id: { in: ids }, accountStatus: 'active' }, select: { id: true, name: true, avatarUrl: true } });
    const map = new Map(users.map((item) => [item.id, item]));
    return rows.flatMap((item) => {
      const id = direction === 'followers' ? item.followerId : item.followeeId;
      const user = map.get(id);
      return user ? [{ followId: item.id, user, followedAt: item.respondedAt }] : [];
    });
  }
}
