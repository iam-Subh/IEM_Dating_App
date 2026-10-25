import { FaceVerificationService } from './face-verification.service';
import { prisma } from '../utils/prisma';
import { MediaCacheService } from './mediaCache.service';
import { ProfileMediaProcessingService, s3ObjectUrl } from './profile-media-processing.service';

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Processes an attached profile video into its poster and playback rendition.
 *
 * This used to cut a three-second 360p preview that the app never played. The
 * name and outbox topic stay the same so events already queued still run.
 */
export class VideoPreviewService {
  static async generatePreview(assetId: string): Promise<void> {
    const asset = await prisma.profileMediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.purpose !== 'video' || asset.status !== 'attached') return;
    if (asset.processingStatus === 'completed' && asset.playbackObjectKey) {
      await MediaCacheService.invalidateCache(asset.ownerId);
      await MediaCacheService.cacheUserMedia(asset.ownerId);
      return;
    }

    const claimed = await prisma.profileMediaAsset.updateMany({
      where: { id: asset.id, status: 'attached', processingStatus: { in: ['pending', 'failed', 'processing'] } },
      data: { processingStatus: 'processing', processingError: null },
    });
    if (claimed.count !== 1) throw new Error('Profile video is already being processed');

    try {
      const { posterObjectKey, playbackObjectKey } = await ProfileMediaProcessingService.processVideo(asset.objectKey);
      await prisma.$transaction(async (tx) => {
        const current = await tx.profileMediaAsset.findUnique({
          where: { id: asset.id },
          select: { status: true, processingStatus: true },
        });
        if (!current || current.status !== 'attached' || current.processingStatus !== 'processing') return;
        await tx.profileMediaAsset.update({
          where: { id: asset.id },
          data: {
            posterObjectKey,
            playbackObjectKey,
            processingStatus: 'completed',
            processingError: null,
            processedAt: new Date(),
          },
        });
        await tx.user.update({
          where: { id: asset.ownerId },
          data: {
            videoPosterUrl: s3ObjectUrl(posterObjectKey),
            videoPlaybackUrl: s3ObjectUrl(playbackObjectKey),
            videoPreviewUrl: null,
          },
        });
      });

      await MediaCacheService.invalidateCache(asset.ownerId);
      await MediaCacheService.cacheUserMedia(asset.ownerId);
      // Real-person check: the video must show them (PHOTO_VERIFICATION_PLAN.md 4).
      void FaceVerificationService.onMediaChanged(asset.ownerId).catch(() => undefined);
    } catch (error) {
      await prisma.profileMediaAsset.updateMany({
        where: { id: asset.id, processingStatus: 'processing' },
        data: { processingStatus: 'failed', processingError: errorText(error) },
      }).catch(() => undefined);
      throw error;
    }
  }
}
