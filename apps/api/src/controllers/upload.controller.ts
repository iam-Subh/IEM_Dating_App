import { Request, Response } from 'express';
import { ProfileNudity } from '../services/profile-nudity.service';
import type { NudityVerdict } from '../services/nudity.service';
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, transformToCdnUrl } from '../middlewares/upload.middleware';
import { v4 as uuidv4 } from 'uuid';
import { MediaCacheService } from '../services/mediaCache.service';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { ProfileMediaProcessingService } from '../services/profile-media-processing.service';
import { PrivateMediaInspectionService } from '../services/private-media-inspection.service';
import { publicMediaBucket, publicObjectUrl } from '../config/storage';

export class UploadController {
  static async getPresignedUrls(req: Request, res: Response) {
    try {
      const { files } = req.body;
      
      if (!files || !Array.isArray(files) || files.length < 1 || files.length > 7) {
        return res.status(400).json({ status: 'error', message: 'Missing or invalid files payload' });
      }

      const userId = (req as any).user.sub;
      const allowed: Record<string, Set<string>> = {
        photo: new Set(['jpg', 'jpeg', 'png', 'webp']),
        video: new Set(['mp4', 'mov']),
      };
      if (files.some((file: any) => !allowed[file?.type]?.has(String(file?.ext || '').toLowerCase()))) {
        return res.status(400).json({ status: 'error', message: 'Unsupported media type' });
      }
      if (files.filter((file: any) => file.type === 'photo').length > 6 || files.filter((file: any) => file.type === 'video').length > 1) {
        return res.status(400).json({ status: 'error', message: 'Media count exceeds the profile limit' });
      }

      const bucket = publicMediaBucket();
      if (!bucket) throw new Error('The public media bucket is not configured');
      const presignedUrls = await Promise.all(files.map(async (file) => {
        const folder = file.type === 'video' ? 'videos' : 'photos';
        const ext = String(file.ext).toLowerCase();
        const key = `profiles/${userId}/${folder}/${uuidv4()}.${ext}`;
        const contentTypes: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
          mp4: 'video/mp4', mov: 'video/quicktime',
        };
        const contentType = contentTypes[ext];
        const maxBytes = file.type === 'video' ? 100 * 1024 * 1024 : 15 * 1024 * 1024;
        const asset = await prisma.profileMediaAsset.create({
          data: { ownerId: userId, objectKey: key, purpose: file.type, contentType, maxBytes, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
        });

        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
        });

        let uploadUrl;
        try { uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); }
        catch (error) { await prisma.profileMediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined); throw error; }
        
        return {
          uploadUrl,
          fileUrl: transformToCdnUrl(publicObjectUrl(key)),
          type: file.type
          , assetId: asset.id
          , contentType
        };
      }));

      return res.status(200).json({ status: 'success', data: presignedUrls });

    } catch (error: any) {
      console.error('Presigned URL Error:', error);
      return res.status(500).json({ status: 'error', message: error.message || 'Error generating presigned URLs' });
    }
  }

  static async completePresignedUpload(req: Request, res: Response) {
    try {
      const userId = (req as any).user.sub;
      const asset = await prisma.profileMediaAsset.findFirst({
        where: { id: req.params.assetId as string, ownerId: userId, status: 'requested', expiresAt: { gt: new Date() } },
      });
      if (!asset) throw new HttpError(404, 'Media upload is unavailable', 'MEDIA_UPLOAD_UNAVAILABLE');
      let head;
      try { head = await s3Client.send(new HeadObjectCommand({ Bucket: publicMediaBucket() || '', Key: asset.objectKey })); }
      catch { throw new HttpError(400, 'Media upload was not found', 'MEDIA_UPLOAD_MISSING'); }
      let nudity: NudityVerdict = 'unchecked';
      if (!head.ContentLength || head.ContentLength > asset.maxBytes) {
        await prisma.profileMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } });
        throw new HttpError(400, 'Uploaded media does not match its ticket', 'MEDIA_UPLOAD_INVALID');
      }
      // The Content-Type the client's PUT actually sent is not trustworthy: on
      // some devices (notably Android emulators, where a fetch()+Blob upload
      // does not reliably carry the header we set) it can differ from what was
      // declared when the ticket was issued, even though the bytes are a
      // perfectly valid photo. The real bytes are sniffed instead, and that is
      // what decides whether the upload is accepted.
      const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
      try {
        const detected = await PrivateMediaInspectionService.detect(publicMediaBucket() || '', asset.objectKey);
        if (asset.purpose === 'photo') {
          if (!detected || !ALLOWED_PHOTO_TYPES.has(detected)) throw new HttpError(400, 'The file is not a supported photo', 'MEDIA_UPLOAD_INVALID');
          const renditions = await ProfileMediaProcessingService.processPhoto(asset.objectKey, {
            contentType: detected,
            maxBytes: asset.maxBytes,
          });
          await prisma.profileMediaAsset.update({
            where: { id: asset.id },
            data: { status: 'uploaded', contentType: detected, ...renditions, processingStatus: 'completed', processedAt: new Date() },
          });
        } else {
          if (!detected?.startsWith('video/')) throw new HttpError(400, 'The file is not a video', 'MEDIA_UPLOAD_INVALID');
          await prisma.profileMediaAsset.update({ where: { id: asset.id }, data: { status: 'uploaded', contentType: detected } });
        }
        // The nudity check (docs/NUDITY_CHECK.md): refused at once when explicit,
        // held for the team when borderline. Never holds the upload up when the
        // check itself is down - that is "unchecked", and checked later.
        nudity = await ProfileNudity.check(userId, { ...asset, contentType: detected }, transformToCdnUrl(publicObjectUrl(asset.objectKey)));
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        await prisma.profileMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } });
        await s3Client
          .send(new DeleteObjectCommand({ Bucket: publicMediaBucket() || '', Key: asset.objectKey }))
          .catch(() => undefined);
        throw error;
      }
      return res.status(200).json({ status: 'success', data: {
        assetId: asset.id, fileUrl: transformToCdnUrl(publicObjectUrl(asset.objectKey)),
        // "review": saved, but only shown once the team approves it.
        review: nudity === 'review',
      } });
    } catch (error: any) {
      const status = error instanceof HttpError ? error.status : 500;
      return res.status(status).json({ status: 'error', message: error.message || 'Could not complete upload', ...(error instanceof HttpError ? { code: error.code } : {}) });
    }
  }

}

