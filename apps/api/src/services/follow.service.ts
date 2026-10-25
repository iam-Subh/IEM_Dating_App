import { VerificationLimitsService } from './verification-limits.service';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';
import { asViewer, loadEligibilityParties, mutuallyEligible } from './eligibility.service';
import { StoryService } from './story.service';
import { NotificationFeedService } from './notification-feed.service';

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
    const validMembership = (membership: (typeof memberships)[number] | undefined) => membership?.status === 'verified' && !!membership.verifiedAt && (!membership.expiresAt || membership.expiresAt > new Date());
    // Each person's college: the verified one, else the one an unverified
    // account chose (GOOGLE_SIGNUP_PLAN.md 1.3, 2.7).
    const collegeOf = (user: (typeof users)[number] | undefined) => {
      const membership = memberships.find((item) => item.userId === user?.id);
      return validMembership(membership) ? membership!.institutionId : user?.claimedInstitutionId ?? null;
    };
    if (!follower || !followee || blocked || follower.accountStatus !== 'active' || followee.accountStatus !== 'active') {
      throw new HttpError(404, 'Account is unavailable', 'FOLLOW_ACCOUNT_UNAVAILABLE');
    }
    const followerCollege = collegeOf(follower);
    if (!followerCollege || followerCollege !== collegeOf(followee)) {
      throw new HttpError(404, 'Account is unavailable', 'FOLLOW_ACCOUNT_UNAVAILABLE');
    }
    if (!followee.preferencesConfirmedAt || !followee.storiesEnabled || !followee.allowFollowRequests) throw new HttpError(404, 'Account is unavailable', 'FOLLOW_ACCOUNT_UNAVAILABLE');
    // Follows stay inside one institution (checked above) even when a wider
    // college scope lets two people match: Stories are a campus-social space,
    // and that boundary is a product decision separate from discovery.
    const parties = await loadEligibilityParties(prisma, [followerId, followeeId]);
    // asViewer: someone hidden at a place can still follow, and be followed back.
    if (!activeMatch && (!mutuallyEligible(asViewer(follower), asViewer(followee), { a: parties.get(followerId), b: parties.get(followeeId) }) || disqualifyingPass)) {
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
      // Before verifying: 10 follow requests a day (GOOGLE_SIGNUP_PLAN.md 2.7).
      await VerificationLimitsService.requireCanFollow(tx, followerId);
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
    NotificationFeedService.readWhere(userId, ['follow_request'], { path: 'followId', equals: followId });
    const updated = await prisma.$transaction(async (tx) => {
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
    // "Requested" becomes "Following" (and a ring may appear) on the other
    // person's open profile of you, and "Follows you" on yours of them.
    void StoryService.nudgeRelationship(follow.followeeId, [follow.followerId], false).catch(() => undefined);
    void StoryService.nudgeRelationship(follow.followerId, [follow.followeeId], false).catch(() => undefined);
    // N12 (NOTIFICATIONS_PLAN.md 3c): the one who asked hears yes - never no.
    if (accept) void this.tellAccepted(follow.id, follow.followerId, follow.followeeId).catch(() => undefined);
    return updated;
  }

  private static async tellAccepted(followId: string, followerId: string, followeeId: string) {
    const followee = await prisma.user.findUnique({ where: { id: followeeId }, select: { name: true } });
    if (!followee) return;
    const title = `${followee.name.split(' ')[0]} accepted your follow request`;
    const body = 'You can see their Stories now.';
    const deliveryKey = `follow_accepted:${followId}`;
    const existing = await prisma.notification.findUnique({ where: { deliveryKey }, select: { id: true } });
    if (existing) return;
    const notification = await prisma.notification.create({
      data: { userId: followerId, type: 'follow_accepted', title, body, data: { followId, userId: followeeId }, deliveryKey },
    });
    const { PushService } = await import('./push.service');
    await PushService.send(followerId, {
      title, body, category: 'follow_requests', kind: 'follow_accepted', notificationId: notification.id,
      data: { url: 'iemdating://main/Dashboard', followId },
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
    if (result.count) {
      void StoryService.nudgeRelationship(userId, [otherUserId], false).catch(() => undefined);
      void StoryService.nudgeRelationship(otherUserId, [userId], false).catch(() => undefined);
    }
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
