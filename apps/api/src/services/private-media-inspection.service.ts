import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../middlewares/upload.middleware';

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

export class PrivateMediaInspectionService {
  static async detect(bucket: string, key: string): Promise<string | null> {
    const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-31' }));
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes || bytes.length < 4) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'image/png';
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'audio/wav';
    if (ascii(bytes, 4, 4) === 'ftyp') {
      const brand = ascii(bytes, 8, 4).toLowerCase();
      return brand.includes('m4a') ? 'audio/mp4' : 'video/mp4';
    }
    return null;
  }
}
