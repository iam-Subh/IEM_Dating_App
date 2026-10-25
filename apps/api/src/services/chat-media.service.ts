import { VerificationLimitsService } from './verification-limits.service';
import { NudityService, verdictOf } from './nudity.service';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../middlewares/upload.middleware';
import { v4 as uuidv4 } from 'uuid';
import { MatchAccessService } from './match-access.service';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { PrivateMediaInspectionService } from './private-media-inspection.service';
import { PrivateMediaProcessingService } from './private-media-processing.service';
import { logger } from '../utils/logger';
import { privateMediaBucket } from '../config/storage';
import {
  MULTIPART_TTL_SECONDS, abortUpload, assembleUpload, createUpload, isNoSuchUpload, partLayout, presignParts,
} from './s3-multipart';

export { MULTIPART_PART_BYTES, MULTIPART_TTL_SECONDS } from './s3-multipart';

const CHAT_MEDIA_CONTENT_TYPES: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
};

/** Time left to attach media to a message once processing has finished. */
const ATTACH_WINDOW_MS = 60 * 60 * 1000;

function ticketFor(ext: string) {
  const normalizedExt = ext.toLowerCase();
  const contentType = CHAT_MEDIA_CONTENT_TYPES[normalizedExt];
  if (!contentType) {
    throw new HttpError(400, 'Chat media type is not supported', 'UNSUPPORTED_MEDIA_TYPE');
  }
  const maxBytes = normalizedExt === 'm4a' || normalizedExt === 'wav'
    ? 10 * 1024 * 1024
    : ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z'].includes(normalizedExt)
      ? 100 * 1024 * 1024
    : normalizedExt === 'mp4'
      ? 500 * 1024 * 1024
      : 50 * 1024 * 1024;
  return { normalizedExt, contentType, maxBytes };
}

export class ChatMediaService {
  private static get bucketName(): string {
    const bucket = privateMediaBucket();
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
    await VerificationLimitsService.requireCanUpload(userId, ext);
    const { normalizedExt, contentType, maxBytes } = ticketFor(ext);
    const bucket = this.bucketName;
    // Organize by matchId to easily track/delete all media for a specific match
    const key = `chat-media/${matchId}/${uuidv4()}.${normalizedExt}`;
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

  /**
   * Starts a resumable upload and returns a presigned URL for every part.
   *
   * This is the path for large media. The device uploads parts in any order,
   * from a background job that survives the app being closed, and retries only
   * the parts that failed. Completion goes through `completeUpload` like any
   * other ticket, which assembles the parts before validating the bytes.
   */
  static async createMultipartUpload(userId: string, matchId: string, ext: string, size: number) {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    await VerificationLimitsService.requireCanUpload(userId, ext);
    const { normalizedExt, contentType, maxBytes } = ticketFor(ext);
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new HttpError(400, 'Upload size is invalid', 'MEDIA_SIZE_INVALID');
    }
    if (size > maxBytes) {
      throw new HttpError(413, `This file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`, 'MEDIA_TOO_LARGE');
    }
    const { partSize, partCount } = partLayout(size);
    const bucket = this.bucketName;
    const key = `chat-media/${matchId}/${uuidv4()}.${normalizedExt}`;
    const uploadId = await createUpload(bucket, key, contentType);
    const abort = () => abortUpload(bucket, key, uploadId).catch(() => undefined);

    const expiresAt = new Date(Date.now() + MULTIPART_TTL_SECONDS * 1000);
    let asset;
    try {
      asset = await prisma.chatMediaAsset.create({
        data: {
          matchId, ownerId: userId, objectKey: key, contentType, maxBytes, expiresAt,
          uploadId, partSize, partCount, declaredBytes: BigInt(size),
        },
        select: { id: true },
      });
    } catch (error) {
      await abort();
      throw error;
    }

    try {
      const parts = await presignParts(bucket, key, uploadId, Array.from({ length: partCount }, (_, index) => index + 1));
      return { assetId: asset.id, mediaKey: key, contentType, partSize, partCount, parts, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      await abort();
      await prisma.chatMediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
      throw error;
    }
  }

  /** Cancels a resumable upload the sender gave up on and frees its stored parts. */
  static async abortMultipartUpload(userId: string, matchId: string, assetId: string) {
    const asset = await prisma.chatMediaAsset.findFirst({
      where: { id: assetId, ownerId: userId, matchId, status: 'requested', uploadId: { not: null } },
      select: { id: true, objectKey: true, uploadId: true },
    });
    if (!asset?.uploadId) return { aborted: false };
    await abortUpload(this.bucketName, asset.objectKey, asset.uploadId);
    await prisma.chatMediaAsset.updateMany({
      where: { id: asset.id, status: 'requested' },
      data: { status: 'rejected', uploadId: null },
    });
    return { aborted: true };
  }

  /**
   * Aborts resumable uploads whose window has closed.
   *
   * S3 keeps and bills the parts of an unfinished multipart upload forever, so
   * an upload abandoned by a phone that never came back has to be aborted here.
   */
  static async sweepExpiredMultipartUploads(limit = 50): Promise<number> {
    const now = Date.now();
    const stale = await prisma.chatMediaAsset.findMany({
      where: {
        uploadId: { not: null },
        OR: [
          { status: 'requested', expiresAt: { lt: new Date(now) } },
          // A completion that crashed mid-flight leaves the claim behind.
          { status: 'processing', expiresAt: { lt: new Date(now - ATTACH_WINDOW_MS) } },
          { status: 'rejected' },
        ],
      },
      select: { id: true, objectKey: true, uploadId: true, status: true },
      take: limit,
    });
    let swept = 0;
    for (const asset of stale) {
      try {
        await abortUpload(this.bucketName, asset.objectKey, asset.uploadId!);
      } catch (error) {
        logger.warn('Could not abort expired multipart upload', { assetId: asset.id, error: (error as Error)?.message });
        continue;
      }
      await prisma.chatMediaAsset.updateMany({
        where: { id: asset.id, status: asset.status, uploadId: asset.uploadId },
        data: { uploadId: null, ...(asset.status === 'rejected' ? {} : { status: 'expired' }) },
      });
      swept += 1;
    }
    return swept;
  }

  /** Assembles the uploaded parts into one object (see `assembleUpload`). */
  private static async assembleMultipart(bucket: string, asset: { id: string; objectKey: string; uploadId: string; partSize: number | null; partCount: number | null }) {
    const result = await assembleUpload(bucket, asset);
    if (result.outcome === 'expired') throw new HttpError(409, 'This upload expired. Send the file again', 'MEDIA_UPLOAD_EXPIRED');
    if (result.outcome === 'incomplete') throw new HttpError(409, result.message, 'MEDIA_UPLOAD_INCOMPLETE');
    await prisma.chatMediaAsset.update({ where: { id: asset.id }, data: { uploadId: null } });
  }

  static async completeUpload(userId: string, matchId: string, assetId: string, options: { coverTimeMs?: number } = {}) {
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
    if (asset.uploadId) {
      try {
        await this.assembleMultipart(this.bucketName, { ...asset, uploadId: asset.uploadId });
      } catch (error) {
        await prisma.chatMediaAsset.updateMany({ where: { id: asset.id, status: 'processing' }, data: { status: 'requested' } });
        if (error instanceof HttpError) throw error;
        logger.warn('Could not assemble multipart upload', { assetId: asset.id, error: (error as Error)?.message });
        throw new HttpError(503, 'Media storage is temporarily unavailable. Retry completion', 'MEDIA_STORAGE_UNAVAILABLE');
      }
    }
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
    const zipOfficeTypes = new Set([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]);
    const oleOfficeTypes = new Set(['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint']);
    const detectedTypeMatches = detectedType === asset.contentType
      || (detectedType === 'application/zip' && zipOfficeTypes.has(asset.contentType))
      || (detectedType === 'application/x-ole-storage' && oleOfficeTypes.has(asset.contentType))
      || (detectedType === 'text/plain' && asset.contentType === 'text/csv');
    if (!head.ContentLength || head.ContentLength > asset.maxBytes || head.ContentType !== asset.contentType || !detectedTypeMatches) {
      const reason = !head.ContentLength
        ? 'empty object'
        : head.ContentLength > asset.maxBytes
          ? `size ${head.ContentLength} exceeds ${asset.maxBytes}`
          : head.ContentType !== asset.contentType
            ? `stored Content-Type ${head.ContentType ?? 'missing'} differs from ${asset.contentType}`
            : `detected type ${detectedType ?? 'unknown'} differs from ${asset.contentType}`;
      logger.warn('Rejected chat media upload', { assetId: asset.id, matchId, reason });
      await prisma.chatMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } });
      // The presigned PUT cannot bound the uploaded size, so an oversized or
      // mistyped object is already in the bucket. Drop it now rather than
      // leaving it for the hourly sweep.
      await s3Client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.objectKey }))
        .catch(() => undefined);
      throw new HttpError(
        400,
        process.env.NODE_ENV === 'production' ? 'Uploaded media does not match its ticket' : `Uploaded media does not match its ticket: ${reason}`,
        'MEDIA_UPLOAD_INVALID',
      );
    }
    let processed;
    try { processed = await PrivateMediaProcessingService.process(this.bucketName, asset.objectKey, `chat-media-approved/${matchId}`, asset.id, asset.contentType, { coverTimeMs: options.coverTimeMs }); }
    catch {
      await prisma.chatMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } });
      await s3Client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.objectKey }))
        .catch(() => undefined);
      throw new HttpError(422, 'Media processing failed', 'MEDIA_PROCESSING_FAILED');
    }
    // The nudity check (docs/NUDITY_CHECK.md): photos and videos that may be
    // explicit reach the receiver blurred, with View and Report. Never blocks a
    // message; if the check is down the media goes as usual.
    const visual = processed.contentType.startsWith('image/') || processed.contentType.startsWith('video/');
    const nudityScore = visual ? await NudityService.scoreObject(this.bucketName, processed.objectKey, processed.contentType) : null;
    const sensitive = nudityScore !== null && verdictOf(nudityScore) !== 'clear';
    try {
      await prisma.chatMediaAsset.update({ where: { id: asset.id }, data: { objectKey: processed.objectKey, contentType: processed.contentType, detectedType, thumbnailObjectKey: processed.thumbnailObjectKey, waveform: processed.waveform, processedAt: new Date(), status: 'uploaded', nudityScore, sensitive, expiresAt: new Date(Math.max(asset.expiresAt.getTime(), Date.now() + ATTACH_WINDOW_MS)) } });
    } catch (error) {
      await Promise.all([
        s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: processed.objectKey })),
        ...(processed.thumbnailObjectKey ? [s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: processed.thumbnailObjectKey }))] : []),
      ]).catch(() => undefined);
      await prisma.chatMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } }).catch(() => undefined);
      throw error;
    }
    await s3Client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: asset.objectKey })).catch(() => undefined);
    return { assetId: asset.id, mediaKey: processed.objectKey, contentType: processed.contentType, thumbnailObjectKey: processed.thumbnailObjectKey, waveform: processed.waveform, sensitive };
  }

  /**
   * Generates a pre-signed GET URL for securely reading a private photo.
   * Valid for 15 minutes (900 seconds).
   */
  static async generateReadUrl(userId: string, mediaKey: string) {
    const keyMatch = /^chat-media-approved\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpeg|jpg|png|webp|gif|avif|heic|heif|mp4|m4a|wav|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z)$/i.exec(mediaKey);
    // A video's poster. It is readable by exactly the people who can read the
    // video it was taken from, so authorization runs against that video's key.
    const posterMatch = keyMatch ? null : /^chat-media-approved\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.thumbnail\.jpg$/i.exec(mediaKey);
    if (!keyMatch && !posterMatch) {
      throw new HttpError(404, 'Media is unavailable', 'MEDIA_NOT_AUTHORIZED');
    }
    const matchId = (keyMatch ?? posterMatch)![1];
    await MatchAccessService.requireActiveMatch(userId, matchId);
    const asset = posterMatch
      ? await prisma.chatMediaAsset.findFirst({ where: { id: posterMatch[2], thumbnailObjectKey: mediaKey }, select: { matchId: true, status: true, objectKey: true } })
      : await prisma.chatMediaAsset.findUnique({ where: { objectKey: mediaKey }, select: { matchId: true, status: true, objectKey: true } });
    if (!asset || asset.matchId !== matchId || asset.status !== 'attached') {
      throw new HttpError(404, 'Media is unavailable', 'MEDIA_NOT_AUTHORIZED');
    }
    const sourceKey = asset.objectKey;
    const linkedMessage = await prisma.message.findFirst({
      where: {
        matchId,
        isDeleted: false,
        OR: [{ photoUrl: sourceKey }, { mediaKeys: { has: sourceKey } }],
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
