import { Request, Response } from 'express';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, transformToCdnUrl } from '../middlewares/upload.middleware';
import { v4 as uuidv4 } from 'uuid';
import { MediaCacheService } from '../services/mediaCache.service';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';

export class UploadController {
  static async uploadFiles(req: Request, res: Response) {
    try {
      const files = (req.files ?? (req.file ? [req.file] : undefined)) as { [fieldname: string]: Express.MulterS3.File[] } | Express.MulterS3.File[] | undefined;
      
      if (!files) {
        return res.status(400).json({ status: 'error', message: 'No files were uploaded.' });
      }
      const userId = (req as any).user.sub;
      const uploadedFiles = (Array.isArray(files) ? files : Object.values(files).flat()) as Express.MulterS3.File[];
      if (uploadedFiles.some((file) => file.size > (file.mimetype.startsWith('video/') ? 100 * 1024 * 1024 : 15 * 1024 * 1024))) {
        return res.status(400).json({ status: 'error', message: 'Uploaded media exceeds its size limit' });
      }
      await prisma.profileMediaAsset.createMany({
        data: uploadedFiles.map((file) => ({
          ownerId: userId,
          objectKey: file.key,
          purpose: file.mimetype.startsWith('video/') ? 'video' : 'photo',
          contentType: file.mimetype,
          maxBytes: file.mimetype.startsWith('video/') ? 100 * 1024 * 1024 : 15 * 1024 * 1024,
          status: 'uploaded',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })),
        skipDuplicates: true,
      });

      // If it's single or array upload
      if (Array.isArray(files)) {
         const urls = files.map(file => transformToCdnUrl(file.location));
         
         await MediaCacheService.cacheUserMedia(userId);
         
         return res.status(200).json({ status: 'success', data: { urls } });
      }

      // If it's multiple fields (e.g. video and photos separated)
      const data: Record<string, string[]> = {};
      for (const field in files) {
        data[field] = files[field].map(file => transformToCdnUrl(file.location));
      }

      await MediaCacheService.cacheUserMedia(userId);

      return res.status(200).json({ status: 'success', data });
      
    } catch (error: any) {
      console.error('Upload Error:', error);
      return res.status(500).json({ status: 'error', message: error.message || 'Error uploading files' });
    }
  }

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

      const bucket = process.env.AWS_S3_BUCKET_NAME;
      if (!bucket) throw new Error('AWS_S3_BUCKET_NAME is required');
      const region = process.env.AWS_REGION || 'us-east-1';
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
        
        const s3FileUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
        
        return {
          uploadUrl,
          fileUrl: transformToCdnUrl(s3FileUrl),
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
      try { head = await s3Client.send(new HeadObjectCommand({ Bucket: process.env.AWS_S3_BUCKET_NAME || '', Key: asset.objectKey })); }
      catch { throw new HttpError(400, 'Media upload was not found', 'MEDIA_UPLOAD_MISSING'); }
      if (!head.ContentLength || head.ContentLength > asset.maxBytes || head.ContentType !== asset.contentType) {
        await prisma.profileMediaAsset.update({ where: { id: asset.id }, data: { status: 'rejected' } });
        throw new HttpError(400, 'Uploaded media does not match its ticket', 'MEDIA_UPLOAD_INVALID');
      }
      await prisma.profileMediaAsset.update({ where: { id: asset.id }, data: { status: 'uploaded' } });
      const region = process.env.AWS_REGION || 'us-east-1';
      return res.status(200).json({ status: 'success', data: { assetId: asset.id, fileUrl: transformToCdnUrl(`https://${process.env.AWS_S3_BUCKET_NAME}.s3.${region}.amazonaws.com/${asset.objectKey}`) } });
    } catch (error: any) {
      const status = error instanceof HttpError ? error.status : 500;
      return res.status(status).json({ status: 'error', message: error.message || 'Could not complete upload' });
    }
  }

}

