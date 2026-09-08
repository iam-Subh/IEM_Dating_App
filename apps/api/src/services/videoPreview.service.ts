import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { s3Client, transformToCdnUrl } from '../middlewares/upload.middleware';
import { prisma } from '../utils/prisma';
import { MediaCacheService } from './mediaCache.service';

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export class VideoPreviewService {
  static async generatePreview(assetId: string): Promise<void> {
    const bucket = process.env.AWS_S3_BUCKET_NAME;
    if (!bucket) throw new Error('AWS_S3_BUCKET_NAME is required');

    const asset = await prisma.profileMediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.purpose !== 'video' || asset.status !== 'attached') return;
    if (asset.processingStatus === 'completed' && asset.previewObjectKey) {
      await MediaCacheService.invalidateCache(asset.ownerId);
      await MediaCacheService.cacheUserMedia(asset.ownerId);
      return;
    }

    const claimed = await prisma.profileMediaAsset.updateMany({
      where: { id: asset.id, status: 'attached', processingStatus: { in: ['pending', 'failed', 'processing'] } },
      data: { processingStatus: 'processing', processingError: null },
    });
    if (claimed.count !== 1) throw new Error('Video preview asset is already being processed');

    const inputPath = path.join(os.tmpdir(), `profile_video_${asset.id}.input`);
    const outputPath = path.join(os.tmpdir(), `profile_video_${asset.id}.preview.mp4`);
    const previewObjectKey = `profiles/${asset.ownerId}/previews/${asset.id}.mp4`;

    try {
      const source = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: asset.objectKey }));
      if (!source.Body) throw new Error('Profile video has no content');
      await pipeline(source.Body as Readable, fs.createWriteStream(inputPath));

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .setStartTime(0)
          .setDuration(3)
          .videoCodec('libx264')
          .size('360x?')
          .videoBitrate('300k')
          .audioCodec('aac')
          .audioBitrate('64k')
          .outputOptions(['-preset ultrafast', '-movflags +faststart', '-pix_fmt yuv420p'])
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', reject)
          .run();
      });

      await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: previewObjectKey,
        Body: fs.createReadStream(outputPath),
        ContentType: 'video/mp4',
      }));

      const region = process.env.AWS_REGION || 'us-east-1';
      const previewUrl = transformToCdnUrl(`https://${bucket}.s3.${region}.amazonaws.com/${previewObjectKey}`);
      await prisma.$transaction(async (tx) => {
        const current = await tx.profileMediaAsset.findUnique({
          where: { id: asset.id },
          select: { status: true, processingStatus: true },
        });
        if (!current || current.status !== 'attached' || current.processingStatus !== 'processing') return;
        await tx.profileMediaAsset.update({
          where: { id: asset.id },
          data: {
            previewObjectKey,
            processingStatus: 'completed',
            processingError: null,
            processedAt: new Date(),
          },
        });
        await tx.user.update({ where: { id: asset.ownerId }, data: { videoPreviewUrl: previewUrl } });
      });

      await MediaCacheService.invalidateCache(asset.ownerId);
      await MediaCacheService.cacheUserMedia(asset.ownerId);
    } catch (error) {
      await prisma.profileMediaAsset.updateMany({
        where: { id: asset.id, processingStatus: 'processing' },
        data: { processingStatus: 'failed', processingError: errorText(error) },
      }).catch(() => undefined);
      throw error;
    } finally {
      await Promise.all([
        fs.promises.rm(inputPath, { force: true }),
        fs.promises.rm(outputPath, { force: true }),
      ]).catch(() => undefined);
    }
  }
}
