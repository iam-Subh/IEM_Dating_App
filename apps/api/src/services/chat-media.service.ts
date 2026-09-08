import { DeleteObjectCommand, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../middlewares/upload.middleware';
import { v4 as uuidv4 } from 'uuid';
import { MatchAccessService } from './match-access.service';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { PrivateMediaInspectionService } from './private-media-inspection.service';
import { PrivateMediaProcessingService } from './private-media-processing.service';

export class ChatMediaService {
  private static get bucketName(): string {
    const bucket = process.env.AWS_PRIVATE_MEDIA_BUCKET;
    if (!bucket) {
      throw new Error('AWS_PRIVATE_MEDIA_BUCKET is required for private chat media');
    }
    return bucket;
  }

  /**
   * Generates a pre-signed PUT URL for uploading a photo to a private bucket.
   * Valid for 5 minutes (300 seconds).
   */
  static async generateUploadUrl(userId: string, matchId: string, ext: string = 'jpeg') {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    const normalizedExt = ext.toLowerCase();
    const contentTypes: Record<string, string> = {
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      m4a: 'audio/mp4',
      wav: 'audio/wav',
    };
    const contentType = contentTypes[normalizedExt];
    if (!contentType) {
      throw new HttpError(400, 'Chat media type is not supported', 'UNSUPPORTED_MEDIA_TYPE');
    }
    const bucket = this.bucketName;
    // Organize by matchId to easily track/delete all media for a specific match
    const key = `chat-media/${matchId}/${uuidv4()}.${normalizedExt}`;
    const maxBytes = normalizedExt === 'm4a' || normalizedExt === 'wav' ? 10 * 1024 * 1024 : 15 * 1024 * 1024;
    const asset = await prisma.chatMediaAsset.create({
      data: { matchId, ownerId: userId, objectKey: key, contentType, maxBytes, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      select: { id: true },
    });
    
    // Do NOT include ACL: 'public-read'. This file must remain strictly private.
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    let uploadUrl;
    try { uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 }); }
    catch (error) { await prisma.chatMediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined); throw error; }

    return {
      uploadUrl,
      mediaKey: key,
      assetId: asset.id,
      contentType,
    };
  }

  static async completeUpload(userId: string, matchId: string, assetId: string) {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    const claimed = await prisma.chatMediaAsset.updateMany({
      where: { id: assetId, ownerId: userId, matchId, status: 'requested', expiresAt: { gt: new Date() } },
      data: { status: 'processing' },
    });
    if (claimed.count === 0) {
      const existing = await prisma.chatMediaAsset.findFirst({ where: { id: assetId, ownerId: userId, matchId } });
      if (existing && ['uploaded', 'attached'].includes(existing.status)) {
        return {
          assetId: existing.id,
          mediaKey: existing.objectKey,
          contentType: existing.contentType,
          thumbnailObjectKey: existing.thumbnailObjectKey,
          waveform: existing.waveform,
        };
      }
      if (existing?.status === 'processing') throw new HttpError(409, 'Media processing is in progress', 'MEDIA_PROCESSING_IN_PROGRESS');
      if (existing?.status === 'rejected') throw new HttpError(422, 'Media processing failed', 'MEDIA_PROCESSING_FAILED');
      throw new HttpError(404, 'Media upload is unavailable', 'MEDIA_UPLOAD_UNAVAILABLE');
    }
    const asset = await prisma.chatMediaAsset.findFirst({ where: { id: assetId, ownerId: userId, matchId, status: 'processing' } });
    if (!asset) throw new HttpError(409, 'Media processing state changed', 'MEDIA_PROCESSING_STATE_CHANGED');
    let head;
    let bucket: string;
    try {
      bucket = this.bucketName;
      head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.objectKey }));
    }
    catch (error: any) {
      await prisma.chatMediaAsset.updateMany({ where: { id: asset.id, status: 'processing' }, data: { status: 'requested' } });
      if (error?.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(error?.name)) {
        throw new HttpError(409, 'Finish the upload before completing it', 'MEDIA_UPLOAD_MISSING');
      }
      throw new HttpError(503, 'Media storage is temporarily unavailable. Retry completion', 'MEDIA_STORAGE_UNAVAILABLE');
    }
    let detectedType;
    try { detectedType = await PrivateMediaInspectionService.detect(bucket, asset.objectKey); }
    catch {
      await prisma.chatMediaAsset.updateMany({ where: { id: asset.id, status: 'processing' }, data: { status: 'requested' } });
      throw new HttpError(503, 'Media storage is temporarily unavailable. Retry completion', 'MEDIA_STORAGE_UNAVAILABLE');
    }
    if (!head.ContentLength || head.ContentLength > asset.maxBytes || head.ContentType !== asset.contentType || detectedType !== asset.contentType) {
      await prisma.chatMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } });
      // The presigned PUT cannot bound the uploaded size, so an oversized or
      // mistyped object is already in the bucket. Drop it now rather than
      // leaving it for the hourly sweep.
      await s3Client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.objectKey }))
        .catch(() => undefined);
      throw new HttpError(400, 'Uploaded media does not match its ticket', 'MEDIA_UPLOAD_INVALID');
    }
    let processed;
    try { processed = await PrivateMediaProcessingService.process(this.bucketName, asset.objectKey, `chat-media-approved/${matchId}`, asset.id, detectedType); }
    catch {
      await prisma.chatMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } });
      await s3Client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.objectKey }))
        .catch(() => undefined);
      throw new HttpError(422, 'Media processing failed', 'MEDIA_PROCESSING_FAILED');
    }
    try {
      await prisma.chatMediaAsset.update({ where: { id: asset.id }, data: { objectKey: processed.objectKey, contentType: processed.contentType, detectedType, thumbnailObjectKey: processed.thumbnailObjectKey, waveform: processed.waveform, processedAt: new Date(), status: 'uploaded' } });
    } catch (error) {
      await Promise.all([
        s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: processed.objectKey })),
        ...(processed.thumbnailObjectKey ? [s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: processed.thumbnailObjectKey }))] : []),
      ]).catch(() => undefined);
      await prisma.chatMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } }).catch(() => undefined);
      throw error;
    }
    await s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: asset.objectKey })).catch(() => undefined);
    return { assetId: asset.id, mediaKey: processed.objectKey, contentType: processed.contentType, thumbnailObjectKey: processed.thumbnailObjectKey, waveform: processed.waveform };
  }

  /**
   * Generates a pre-signed GET URL for securely reading a private photo.
   * Valid for 15 minutes (900 seconds).
   */
  static async generateReadUrl(userId: string, mediaKey: string) {
    const keyMatch = /^chat-media-approved\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpeg|jpg|png|webp|m4a|wav)$/i.exec(mediaKey);
    if (!keyMatch) {
      throw new HttpError(404, 'Media is unavailable', 'MEDIA_NOT_AUTHORIZED');
    }
    const matchId = keyMatch[1];
    await MatchAccessService.requireActiveMatch(userId, matchId);
    const asset = await prisma.chatMediaAsset.findUnique({ where: { objectKey: mediaKey }, select: { matchId: true, status: true } });
    if (!asset || asset.matchId !== matchId || asset.status !== 'attached') {
      throw new HttpError(404, 'Media is unavailable', 'MEDIA_NOT_AUTHORIZED');
    }
    const linkedMessage = await prisma.message.findFirst({
      where: {
        matchId,
        isDeleted: false,
        OR: [{ photoUrl: mediaKey }, { mediaKeys: { has: mediaKey } }],
        NOT: { hiddenBy: { has: userId } } as any,
      } as any,
      select: { id: true },
    });
    if (!linkedMessage) {
      throw new HttpError(404, 'Media is unavailable', 'MEDIA_NOT_AUTHORIZED');
    }
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: mediaKey,
    });

    const readUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    return readUrl;
  }
}
