import { S3Client } from '@aws-sdk/client-s3';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const CDN_DOMAIN = process.env.CDN_URL || '';

// Transform S3 URLs to CDN URLs
export const transformToCdnUrl = (s3Url: string): string => {
  // If CDN is disabled or not configured, return original S3 URL
  if (!CDN_DOMAIN || CDN_DOMAIN === '' || CDN_DOMAIN.includes('todo')) {
    return s3Url;
  }

  if (!s3Url) return s3Url;

  try {
    const urlObj = new URL(s3Url);
    // Only replace if it's our S3 bucket domain and NOT already the CDN domain
    if (
      urlObj.hostname.includes('s3') && 
      urlObj.hostname.includes('amazonaws.com') &&
      !s3Url.includes(CDN_DOMAIN)
    ) {
      // Logic check: only transform if we actually want CDN enabled
      // FOR NOW: Let's log it to debug
      // console.log(`[CDN] Transforming ${urlObj.hostname} to ${CDN_DOMAIN}`);
      return `${CDN_DOMAIN}${urlObj.pathname}`;
    }
    return s3Url;
  } catch (e) {
    return s3Url;
  }
};

export const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const generateFileName = (req: any, file: Express.Multer.File): string => {
  const ext = path.extname(file.originalname);
  const type = file.mimetype.startsWith('video') ? 'videos' : 'photos';
  return `profiles/${req.user.sub}/${type}/${uuidv4()}${ext.toLowerCase()}`;
};

export const uploadMedia = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET_NAME || '',
    key: function (req, file, cb) {
      cb(null, generateFileName(req, file));
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check if the file is an image or video
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type, only images and video are allowed!'));
    }
  },
});
