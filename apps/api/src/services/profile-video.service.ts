import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { transformToCdnUrl } from '../middlewares/upload.middleware';
import { objectKeyFromUrl } from './profile-media-processing.service';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';

/**
 * The profile video, as Edit profile shows it: what is there, and where its
 * processing stands. Uploading and replacing reuse the ordinary media path
 * (presigned upload, complete, `PUT /profile { profileVideoUrl }`); this only
 * reads the state and restarts a processing run that failed.
 */

export type ProfileVideoStatus = 'none' | 'processing' | 'ready' | 'failed';

export class ProfileVideoService {
  static async read(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { profileVideoUrl: true, videoPosterUrl: true, videoPlaybackUrl: true },
    });
    if (!user.profileVideoUrl) return { status: 'none' as ProfileVideoStatus, url: null, posterUrl: null };
    const asset = await this.assetOf(userId, user.profileVideoUrl);
    // Videos from before processing existed have no asset row: they play as uploaded.
    const status: ProfileVideoStatus = !asset
      ? 'ready'
      : asset.processingStatus === 'completed' || asset.processingStatus === 'not_required'
        ? 'ready'
        : asset.processingStatus === 'failed'
          ? 'failed'
          : 'processing';
    const playable = user.videoPlaybackUrl ?? user.profileVideoUrl;
    return {
      status,
      url: transformToCdnUrl(playable),
      posterUrl: user.videoPosterUrl ? transformToCdnUrl(user.videoPosterUrl) : null,
    };
  }

  /** Processing failed: run it again on the same upload. */
  static async retry(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { profileVideoUrl: true } });
    if (!user.profileVideoUrl) throw new HttpError(404, 'There is no video to process', 'NO_PROFILE_VIDEO');
    const asset = await this.assetOf(userId, user.profileVideoUrl);
    if (!asset || asset.processingStatus !== 'failed') return this.read(userId);
    await prisma.$transaction(async (tx) => {
      await tx.profileMediaAsset.update({ where: { id: asset.id }, data: { processingStatus: 'pending', processingError: null } });
      await OutboxService.enqueue(tx, {
        topic: OUTBOX_TOPICS.PROFILE_VIDEO_PREVIEW_REQUESTED,
        aggregateId: asset.id,
        // A new key per retry: the first run's event is already spent.
        deduplicationKey: `${OUTBOX_TOPICS.PROFILE_VIDEO_PREVIEW_REQUESTED}:${asset.id}:retry:${Date.now()}`,
        payload: { assetId: asset.id, ownerId: userId },
      });
    });
    return this.read(userId);
  }

  private static assetOf(userId: string, url: string) {
    const objectKey = objectKeyFromUrl(url);
    if (!objectKey) return Promise.resolve(null);
    return prisma.profileMediaAsset.findFirst({
      where: { ownerId: userId, objectKey, purpose: 'video' },
      select: { id: true, processingStatus: true },
    });
  }
}
