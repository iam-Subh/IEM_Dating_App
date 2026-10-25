import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../middlewares/upload.middleware';
import { privateMediaBucket, publicMediaBucket, publicObjectUrl } from '../config/storage';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';
import { ProfileNudity } from './profile-nudity.service';
import { FaceVerificationService } from './face-verification.service';
import { NudityService, verdictOf } from './nudity.service';
import { announceOwnProfile } from './verification-live';
import { transformToCdnUrl } from '../middlewares/upload.middleware';

const STORY_LIFETIME_MS = 24 * 60 * 60_000;
const MAX_PHOTOS = 6;

/**
 * The team's side of the nudity check (docs/NUDITY_CHECK.md): borderline
 * profile photos, videos and Stories waiting in the admin panel, and what
 * Approve and Remove do to each. The person hears either way.
 */
export class MediaModerationService {
  static async list(status: 'pending' | 'closed') {
    const rows = await prisma.mediaModeration.findMany({
      where: status === 'pending' ? { status: 'pending' } : { status: { in: ['approved', 'removed', 'blocked'] } },
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      take: 100,
    });
    const people = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.userId))] } },
      select: { id: true, name: true, accountStatus: true },
    });
    const strikes = await prisma.mediaModeration.groupBy({
      by: ['userId'], where: { userId: { in: people.map((person) => person.id) }, status: 'blocked' }, _count: { _all: true },
    });
    const bucket = privateMediaBucket();
    return Promise.all(rows.map(async (row) => ({
      ...row,
      user: people.find((person) => person.id === row.userId) ?? null,
      refusedBefore: strikes.find((item) => item.userId === row.userId)?._count._all ?? 0,
      // Stories are private: a link that works for five minutes.
      viewUrl: row.kind === 'story' && row.objectKey && bucket
        ? await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: row.objectKey }), { expiresIn: 300 }).catch(() => null)
        : row.mediaUrl,
      video: row.kind === 'profile_video' || (row.objectKey ? /\.(mp4|mov|webm)$/i.test(row.objectKey) : false),
    })));
  }

  static async decide(adminId: string, id: string, input: { decision: 'approve' | 'remove'; note?: string }) {
    const row = await prisma.mediaModeration.findUnique({ where: { id } });
    if (!row || row.status !== 'pending') throw new HttpError(404, 'This item was already decided or withdrawn', 'MODERATION_UNAVAILABLE');
    const note = input.note?.trim().slice(0, 300) || null;
    if (input.decision === 'approve') await this.approve(row);
    else await this.remove(row, note);
    await prisma.mediaModeration.update({
      where: { id }, data: { status: input.decision === 'approve' ? 'approved' : 'removed', decidedBy: adminId, decidedAt: new Date(), note },
    });
    return { status: input.decision === 'approve' ? 'approved' : 'removed' };
  }

  private static async approve(row: { userId: string; kind: string; assetId: string | null; storyId: string | null; mediaUrl: string | null }) {
    if (row.kind === 'story' && row.storyId) {
      // Posted now, for a full 24 hours, and announced as if it had just gone up.
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const story = await tx.story.updateMany({ where: { id: row.storyId!, state: 'in_review' }, data: { state: 'published', publishedAt: now, expiresAt: new Date(now.getTime() + STORY_LIFETIME_MS) } });
        if (story.count) {
          await OutboxService.enqueue(tx, { topic: OUTBOX_TOPICS.STORY_PUBLISHED, aggregateId: row.storyId!, deduplicationKey: `story.published:${row.storyId}`, payload: { ownerId: row.userId } });
        }
      });
      await this.tell(row.userId, 'Your Story is up', 'Thanks for waiting - it has been checked and is now posted.');
      return;
    }
    const asset = row.assetId ? await prisma.profileMediaAsset.findUnique({ where: { id: row.assetId } }) : null;
    if (!asset || !row.mediaUrl) return;
    // Picked but never saved (Edit profile checks a photo before Save): nothing
    // to add - if they save it later it goes straight on, as it is approved now.
    if (asset.status === 'uploaded') return;
    if (row.kind === 'profile_photo') {
      const photos = await prisma.profilePhoto.findMany({ where: { userId: row.userId }, orderBy: { order: 'asc' } });
      // Already up (it went live while the check was down, and was rescanned): nothing to add.
      if (photos.some((photo) => photo.photoUrl === row.mediaUrl)) return;
      if (photos.length >= MAX_PHOTOS) {
        await this.tell(row.userId, 'Your photo was approved', 'Your profile already has 6 photos, so it was not added. Remove one in Edit profile and add it again.');
        return;
      }
      await prisma.$transaction(async (tx) => {
        await tx.profilePhoto.create({
          data: {
            userId: row.userId, photoUrl: row.mediaUrl!, order: photos.length, isPrimary: photos.length === 0,
            cardUrl: asset.cardObjectKey ? transformToCdnUrl(publicObjectUrl(asset.cardObjectKey)) : null,
            thumbUrl: asset.thumbObjectKey ? transformToCdnUrl(publicObjectUrl(asset.thumbObjectKey)) : null,
          },
        });
        if (!photos.length) await tx.user.update({ where: { id: row.userId }, data: { avatarUrl: row.mediaUrl! } });
        await tx.profileMediaAsset.update({ where: { id: asset.id }, data: { status: 'attached', attachedAt: new Date() } });
      });
      await this.tell(row.userId, 'Your photo is on your profile', 'Thanks for waiting - it has been checked and added.');
    } else if (row.kind === 'profile_video') {
      const owner = await prisma.user.findUnique({ where: { id: row.userId }, select: { profileVideoUrl: true } });
      if (owner?.profileVideoUrl === row.mediaUrl) return;
      await prisma.$transaction(async (tx) => {
        await tx.profileMediaAsset.updateMany({ where: { ownerId: row.userId, purpose: 'video', status: 'attached' }, data: { status: 'retired' } });
        await tx.user.update({ where: { id: row.userId }, data: { profileVideoUrl: row.mediaUrl!, videoPreviewUrl: null, videoPosterUrl: null, videoPlaybackUrl: null } });
        await tx.profileMediaAsset.update({ where: { id: asset.id }, data: { status: 'attached', attachedAt: new Date(), processingStatus: 'pending', processingError: null } });
        await OutboxService.enqueue(tx, {
          topic: OUTBOX_TOPICS.PROFILE_VIDEO_PREVIEW_REQUESTED, aggregateId: asset.id,
          deduplicationKey: `${OUTBOX_TOPICS.PROFILE_VIDEO_PREVIEW_REQUESTED}:${asset.id}`, payload: { assetId: asset.id, ownerId: row.userId },
        });
      });
      await this.tell(row.userId, 'Your video is on your profile', 'Thanks for waiting - it has been checked and added.');
    }
    void FaceVerificationService.afterMediaChange(row.userId).catch(() => undefined);
    announceOwnProfile(row.userId);
  }

  private static async remove(row: { userId: string; kind: string; assetId: string | null; storyId: string | null; mediaUrl: string | null }, note: string | null) {
    const why = note ?? 'It does not follow our Community Guidelines.';
    if (row.kind === 'story' && row.storyId) {
      await prisma.story.updateMany({ where: { id: row.storyId }, data: { state: 'deleted', deletedAt: new Date() } });
      await this.tell(row.userId, "Your Story wasn't posted", why);
      return;
    }
    // Off the profile too, if it went up while the check was down.
    const removed = (row as { mediaUrl?: string | null }).mediaUrl;
    if (removed) {
      await prisma.profilePhoto.deleteMany({ where: { userId: row.userId, photoUrl: removed } });
      if (row.kind === 'profile_video') await prisma.user.updateMany({ where: { id: row.userId, profileVideoUrl: removed }, data: { profileVideoUrl: null, videoPlaybackUrl: null, videoPreviewUrl: null, videoPosterUrl: null } });
    }
    if (row.assetId) await ProfileNudity.deleteRenditions(row.assetId, true);
    await this.tell(row.userId, row.kind === 'profile_video' ? "Your video wasn't added" : "Your photo wasn't added", why);
    announceOwnProfile(row.userId);
  }

  private static async tell(userId: string, title: string, body: string) {
    await prisma.notification.create({ data: { userId, type: 'system', title, body } }).catch(() => undefined);
  }

  /**
   * Hourly: media that went through while the check was down is checked now.
   * Clear: done. Borderline: stays up, and waits for the team. Explicit: taken
   * down at once (a Story deleted, a photo or video removed) and the person told.
   */
  static async rescanUnchecked(limit = 50) {
    const rows = await prisma.mediaModeration.findMany({ where: { status: 'unchecked' }, orderBy: { createdAt: 'asc' }, take: limit });
    let done = 0;
    for (const row of rows) {
      const story = row.kind === 'story';
      const bucket = story ? privateMediaBucket() : publicMediaBucket();
      const asset = row.assetId
        ? story ? await prisma.storyMediaAsset.findUnique({ where: { id: row.assetId }, select: { objectKey: true, contentType: true } })
          : await prisma.profileMediaAsset.findUnique({ where: { id: row.assetId }, select: { objectKey: true, contentType: true } })
        : null;
      if (!bucket || !asset) { await prisma.mediaModeration.update({ where: { id: row.id }, data: { status: 'withdrawn' } }); continue; }
      const score = await NudityService.scoreObject(bucket, asset.objectKey, asset.contentType);
      if (score === null) break; // still down: try again next hour
      const verdict = verdictOf(score);
      if (verdict === 'clear') {
        await prisma.mediaModeration.update({ where: { id: row.id }, data: { status: 'approved', score, decidedAt: new Date(), note: 'Checked after upload' } });
      } else if (verdict === 'review') {
        await prisma.mediaModeration.update({ where: { id: row.id }, data: { status: 'pending', score } });
      } else {
        if (story && row.storyId) await prisma.story.updateMany({ where: { id: row.storyId }, data: { state: 'deleted', deletedAt: new Date() } });
        if (!story && row.mediaUrl) {
          await prisma.profilePhoto.deleteMany({ where: { userId: row.userId, photoUrl: row.mediaUrl } });
          if (row.kind === 'profile_video') await prisma.user.updateMany({ where: { id: row.userId, profileVideoUrl: row.mediaUrl }, data: { profileVideoUrl: null, videoPlaybackUrl: null, videoPreviewUrl: null, videoPosterUrl: null } });
          if (row.assetId) await ProfileNudity.deleteRenditions(row.assetId, true);
          announceOwnProfile(row.userId);
        }
        await prisma.mediaModeration.update({ where: { id: row.id }, data: { status: 'blocked', score, decidedAt: new Date(), note: 'Removed after a later check' } });
        await this.tell(row.userId, story ? 'Your Story was taken down' : 'A photo or video was removed from your profile', "It doesn't follow our Community Guidelines.");
        void NudityService.recordStrike(row.userId).catch(() => undefined);
      }
      done++;
    }
    if (done) logger.info(`[NUDITY] rescanned ${done} unchecked uploads`);
    return done;
  }
}
