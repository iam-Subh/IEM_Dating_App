import { objectKeyFromUrl } from './profile-media-processing.service';
import { abortUpload } from './s3-multipart';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { s3Client } from '../middlewares/upload.middleware';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { Prisma } from '@prisma/client';
import { privateMediaBucket, publicMediaBucket } from '../config/storage';

const DELETION_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

export class AccountLifecycleService {
  private static timer: NodeJS.Timeout | null = null;

  static async createExport(userId: string) {
    const request = await prisma.accountDataRequest.create({ data: { userId, type: 'export', status: 'processing' } });
    try {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: {
          photos: true,
          studentMembership: { include: { institution: { select: { code: true, name: true } } } },
          swipesMade: true,
          matchesAsUser1: { include: { messages: true } },
          matchesAsUser2: { include: { messages: true } },
          reportsFiled: true,
          blocksGiven: true,
          notifications: true,
        },
      });
      const { passwordHash: _passwordHash, ...safeUser } = user;
      // Fetched first: the person's own Story ids, so insight totals - which
      // have no owner column of their own - can be looked up by them.
      const stories = await prisma.story.findMany({ where: { ownerId: userId } });
      const [follows, storyPreferences, storyCloseFriends, storyHiddenFrom, storyInsights, storyViews, reactions, messageVisibility, receipts, chatParticipants, accountEvents, deviceCursors] = await Promise.all([
        prisma.follow.findMany({ where: { OR: [{ followerId: userId }, { followeeId: userId }] } }),
        prisma.storyPreference.findMany({ where: { OR: [{ viewerId: userId }, { authorId: userId }] } }),
        // Only the person's own lists: whose lists they are on stays private to those owners.
        prisma.storyCloseFriend.findMany({ where: { ownerId: userId } }),
        prisma.storyHiddenFrom.findMany({ where: { ownerId: userId } }),
        // Insight totals for the person's own Stories only - nobody else's numbers.
        stories.length ? prisma.storyInsight.findMany({ where: { storyId: { in: stories.map((story) => story.id) } } }) : Promise.resolve([]),
        prisma.storyView.findMany({ where: { viewerId: userId } }),
        prisma.messageReaction.findMany({ where: { userId } }),
        prisma.messageVisibility.findMany({ where: { userId } }),
        prisma.messageReceipt.findMany({ where: { recipientId: userId } }),
        prisma.chatParticipant.findMany({ where: { userId } }),
        prisma.accountEvent.findMany({ where: { userId } }),
        prisma.chatDeviceCursor.findMany({ where: { userId } }),
      ]);
      return prisma.accountDataRequest.update({
        where: { id: request.id },
        data: {
          status: 'completed',
          result: jsonValue({ ...safeUser, follows, storyPreferences, storyCloseFriends, storyHiddenFrom, stories, storyInsights, storyViews, reactions, messageVisibility, receipts, chatParticipants, accountEvents, deviceCursors }),
          completedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
        select: { id: true, type: true, status: true, createdAt: true, completedAt: true },
      });
    } catch (error) {
      await prisma.accountDataRequest.update({
        where: { id: request.id },
        data: { status: 'failed', error: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
      });
      throw error;
    }
  }

  static async getRequest(userId: string, requestId: string) {
    const request = await prisma.accountDataRequest.findFirst({ where: { id: requestId, userId } });
    if (!request) throw new HttpError(404, 'Account request is unavailable', 'ACCOUNT_REQUEST_UNAVAILABLE');
    return request;
  }

  /**
   * Leaves discovery now and erases everything in 30 days. Every device is
   * signed out and stops getting pushes at once; signing in again within the
   * 30 days offers to keep the account. The reason, if given, is kept with the
   * request until the erase - for us to learn from, never shown to anyone.
   */
  static async requestDeletion(userId: string, details: { reason?: string | null; note?: string | null } = {}) {
    const existing = await prisma.accountDataRequest.findFirst({
      where: { userId, type: 'deletion', status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { id: existing.id, scheduledFor: existing.scheduledFor };
    const reason = details.reason || details.note ? { reason: details.reason ?? null, note: details.note?.trim().slice(0, 500) || null } : undefined;
    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.accountDataRequest.create({
        data: { userId, type: 'deletion', scheduledFor: new Date(Date.now() + DELETION_DELAY_MS), ...(reason ? { result: reason } : {}) },
      });
      await tx.user.update({
        where: { id: userId },
        data: { accountStatus: 'deletion_pending', sessionVersion: { increment: 1 }, eligibilityVersion: { increment: 1 } },
      });
      await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'ACCOUNT_DELETION' } });
      await tx.deviceToken.deleteMany({ where: { userId } });
      return created;
    });
    return { id: request.id, scheduledFor: request.scheduledFor };
  }

  /** The pending deletion, for the "your account will be deleted" screen after signing in. */
  static async pendingDeletion(userId: string) {
    const request = await prisma.accountDataRequest.findFirst({
      where: { userId, type: 'deletion', status: 'pending' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, scheduledFor: true },
    });
    return request ? { id: request.id, scheduledFor: request.scheduledFor } : null;
  }

  /**
   * Deletes at once - the empty account left behind when someone switches to
   * the account their college email already has (GOOGLE_SIGNUP_PLAN.md 1.4).
   * Signed out now; the data goes with the next deletion run, within a minute.
   */
  static async deleteNow(userId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.accountDataRequest.create({ data: { userId, type: 'deletion', scheduledFor: new Date() } });
      await tx.user.update({
        where: { id: userId },
        data: { accountStatus: 'deletion_pending', sessionVersion: { increment: 1 }, eligibilityVersion: { increment: 1 } },
      });
      await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'ACCOUNT_SWITCHED' } });
    });
  }

  static async cancelDeletion(userId: string) {
    return prisma.$transaction(async (tx) => {
      const request = await tx.accountDataRequest.findFirst({
        where: { userId, type: 'deletion', status: 'pending' },
        orderBy: { createdAt: 'desc' },
      });
      if (!request) throw new HttpError(404, 'Pending deletion request was not found', 'DELETION_REQUEST_UNAVAILABLE');
      await tx.accountDataRequest.update({
        where: { id: request.id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      await tx.user.update({
        where: { id: userId },
        data: { accountStatus: 'active', eligibilityVersion: { increment: 1 } },
      });
      return { id: request.id, status: 'cancelled' };
    });
  }

  static async runDueDeletions(limit = 20): Promise<number> {
    await prisma.accountDataRequest.updateMany({
      where: { type: 'export', status: 'completed', expiresAt: { lte: new Date() } },
      data: { status: 'expired', result: Prisma.JsonNull },
    });
    const due = await prisma.accountDataRequest.findMany({
      where: { type: 'deletion', status: 'pending', scheduledFor: { lte: new Date() }, userId: { not: null } },
      orderBy: { scheduledFor: 'asc' },
      take: limit,
    });
    let completed = 0;
    for (const request of due) {
      const claimed = await prisma.accountDataRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: { status: 'processing' },
      });
      if (!claimed.count || !request.userId) continue;
      try {
        await this.eraseAccount(request.userId);
        await prisma.accountDataRequest.update({
          where: { id: request.id },
          data: { userId: null, status: 'completed', completedAt: new Date(), result: Prisma.JsonNull },
        });
        completed++;
      } catch (error) {
        await prisma.accountDataRequest.update({
          where: { id: request.id },
          data: { status: 'pending', error: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
        });
      }
    }
    return completed;
  }

  private static async eraseAccount(userId: string) {
    // Renditions written by the backfill have no asset row; their URLs are on the profile.
    const legacyRenditions = await prisma.user.findUnique({
      where: { id: userId },
      select: { videoPosterUrl: true, videoPlaybackUrl: true, photos: { select: { cardUrl: true, thumbUrl: true } } },
    });
    const [profileAssets, chatAssets, storyAssets, ownedStories, devices] = await Promise.all([
      prisma.profileMediaAsset.findMany({ where: { ownerId: userId }, select: { objectKey: true, previewObjectKey: true, cardObjectKey: true, thumbObjectKey: true, posterObjectKey: true, playbackObjectKey: true } }),
      prisma.chatMediaAsset.findMany({ where: { ownerId: userId }, select: { objectKey: true, thumbnailObjectKey: true } }),
      prisma.storyMediaAsset.findMany({ where: { ownerId: userId }, select: { id: true, objectKey: true, thumbnailObjectKey: true, uploadId: true } }),
      prisma.story.findMany({ where: { ownerId: userId }, select: { id: true } }),
      prisma.deviceToken.findMany({ where: { userId }, select: { id: true } }),
    ]);
    const ownedStoryIds = ownedStories.map((item) => item.id);
    const ownedStickerIds = (await prisma.storySticker.findMany({ where: { storyId: { in: ownedStoryIds } }, select: { id: true } })).map((item) => item.id);
    // Story posts still uploading in the background would otherwise leave parts in S3.
    if (privateMediaBucket()) {
      await Promise.all(storyAssets.filter((asset) => asset.uploadId).map((asset) => (
        abortUpload(privateMediaBucket()!, asset.objectKey, asset.uploadId!).catch(() => undefined)
      )));
    }
    const publicKeys = [...new Set([
      ...profileAssets.flatMap((asset) => [
        asset.objectKey, asset.previewObjectKey, asset.cardObjectKey, asset.thumbObjectKey, asset.posterObjectKey, asset.playbackObjectKey,
      ]),
      ...[
        legacyRenditions?.videoPosterUrl,
        legacyRenditions?.videoPlaybackUrl,
        ...(legacyRenditions?.photos ?? []).flatMap((photo) => [photo.cardUrl, photo.thumbUrl]),
      ].map((url) => (url ? objectKeyFromUrl(url) : null)),
    ].filter((key): key is string => !!key))];
    const privateKeys = [...new Set([
      ...chatAssets.flatMap((asset) => [asset.objectKey, asset.thumbnailObjectKey]),
      ...storyAssets.flatMap((asset) => [asset.objectKey, asset.thumbnailObjectKey]),
    ].filter((key): key is string => !!key))];
    const bucket = publicMediaBucket();
    const privateBucket = privateMediaBucket();
    if (publicKeys.length && !bucket) throw new Error('AWS_S3_BUCKET_NAME is required to delete profile media');
    if (privateKeys.length && !privateBucket) throw new Error('AWS_PRIVATE_MEDIA_BUCKET is required to delete private media');
    for (let offset = 0; offset < publicKeys.length; offset += 1000) {
      await s3Client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: publicKeys.slice(offset, offset + 1000).map((Key) => ({ Key })), Quiet: true },
      }));
    }
    for (let offset = 0; offset < privateKeys.length; offset += 1000) {
      await s3Client.send(new DeleteObjectsCommand({ Bucket: privateBucket, Delete: { Objects: privateKeys.slice(offset, offset + 1000).map((Key) => ({ Key })), Quiet: true } }));
    }

    await prisma.$transaction(async (tx) => {
      await Promise.all([
        tx.profilePhoto.deleteMany({ where: { userId } }),
        tx.profileMediaAsset.deleteMany({ where: { ownerId: userId } }),
        tx.chatMediaAsset.deleteMany({ where: { ownerId: userId } }),
        tx.studentMembership.deleteMany({ where: { userId } }),
        // Real-person check: the face key and every result (PHOTO_VERIFICATION_PLAN.md 10).
        tx.faceKey.deleteMany({ where: { userId } }),
        tx.faceMediaCheck.deleteMany({ where: { userId } }),
        tx.faceVerification.deleteMany({ where: { userId } }),
        tx.faceChallenge.deleteMany({ where: { userId } }),
        tx.userSession.deleteMany({ where: { userId } }),
        tx.userScore.deleteMany({ where: { userId } }),
        tx.deviceToken.deleteMany({ where: { userId } }),
        tx.deliveryAttempt.deleteMany({ where: { deviceId: { in: devices.map((device) => device.id) } } }),
        tx.accountEvent.deleteMany({ where: { userId } }),
        tx.chatDeviceCursor.deleteMany({ where: { userId } }),
        tx.notification.deleteMany({ where: { userId } }),
        tx.matchPreference.deleteMany({ where: { userId } }),
        tx.swipe.deleteMany({ where: { OR: [{ swiperId: userId }, { targetId: userId }] } }),
        tx.userBlock.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }),
        tx.storyView.deleteMany({ where: { OR: [{ viewerId: userId }, { storyId: { in: ownedStories.map((item) => item.id) } }] } }),
        tx.storyLike.deleteMany({ where: { OR: [{ viewerId: userId }, { storyId: { in: ownedStories.map((item) => item.id) } }] } }),
        tx.storyStickerResponse.deleteMany({ where: { OR: [{ viewerId: userId }, { storyId: { in: ownedStoryIds } }] } }),
        tx.storyQuestionReply.deleteMany({ where: { OR: [{ viewerId: userId }, { storyId: { in: ownedStoryIds } }] } }),
        tx.storyLinkTap.deleteMany({ where: { OR: [{ viewerId: userId }, { storyId: { in: ownedStoryIds } }] } }),
        tx.storyRevealUnlock.deleteMany({ where: { OR: [{ viewerId: userId }, { storyId: { in: ownedStoryIds } }] } }),
        tx.storyAddYoursEntry.deleteMany({ where: { OR: [{ ownerId: userId }, { storyId: { in: ownedStoryIds } }] } }),
        tx.storyAddYoursThread.deleteMany({ where: { creatorId: userId } }),
        tx.storyCountdownSubscription.deleteMany({ where: { OR: [{ userId }, { stickerId: { in: ownedStickerIds } }] } }),
        tx.storyMention.deleteMany({ where: { OR: [{ mentionedUserId: userId }, { storyId: { in: ownedStoryIds } }] } }),
        tx.storySticker.deleteMany({ where: { storyId: { in: ownedStoryIds } } }),
        tx.storyInsight.deleteMany({ where: { storyId: { in: ownedStoryIds } } }),
        tx.storyBatchItem.deleteMany({ where: { ownerId: userId } }),
        tx.storyBatch.deleteMany({ where: { ownerId: userId } }),
        tx.story.deleteMany({ where: { ownerId: userId } }),
        tx.storyMediaAsset.deleteMany({ where: { ownerId: userId } }),
        tx.storyPreference.deleteMany({ where: { OR: [{ viewerId: userId }, { authorId: userId }] } }),
        tx.storyCloseFriend.deleteMany({ where: { OR: [{ ownerId: userId }, { friendId: userId }] } }),
        tx.storyHiddenFrom.deleteMany({ where: { OR: [{ ownerId: userId }, { hiddenUserId: userId }] } }),
        tx.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followeeId: userId }] } }),
        tx.messageReaction.deleteMany({ where: { userId } }),
        tx.messageVisibility.deleteMany({ where: { userId } }),
        tx.messageReceipt.deleteMany({ where: { recipientId: userId } }),
        tx.chatParticipant.deleteMany({ where: { userId } }),
        tx.chatEvent.deleteMany({ where: { OR: [{ actorId: userId }, { audienceUserId: userId }] } }),
      ]);
      await tx.user.update({
        where: { id: userId },
        data: {
          email: null,
          googleSub: null,
          googleEmail: null,
          googleLinkedAt: null,
          claimedInstitutionId: null,
          verifyLaterAt: null,
          name: 'Deleted User',
          passwordHash: randomUUID(),
          accountStatus: 'deleted',
          college: null,
          department: null,
          graduationYear: null,
          yearOfStudy: null,
          birthday: null,
          age: null,
          discoveryCategory: null,
          showMeCategories: [],
          minAgePref: null,
          maxAgePref: null,
          discoveryMode: null,
          preferencesConfirmedAt: null,
          storiesEnabled: false,
          allowFollowRequests: false,
          gender: null,
          showGender: false,
          orientation: [],
          showOrientation: false,
          seeking: null,
          distancePreference: null,
          preferences: Prisma.JsonNull,
          emailVerifiedAt: null,
          avatarUrl: null,
          profileVideoUrl: null,
          videoPreviewUrl: null,
          videoPosterUrl: null,
          videoPlaybackUrl: null,
          locationArea: null,
          latitude: null,
          longitude: null,
          locationUpdatedAt: null,
          locationConsentAt: null,
          attendanceMood: null,
          campus: null,
          height: null,
          degree: null,
          clubs: [],
          hangoutSpots: [],
          isHosteller: null,
          sessionVersion: { increment: 1 },
          eligibilityVersion: { increment: 1 },
        },
      });
    });
  }

  static start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.runDueDeletions().catch(() => undefined), 60_000);
    this.timer.unref();
  }

  static stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
