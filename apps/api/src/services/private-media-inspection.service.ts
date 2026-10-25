import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../middlewares/upload.middleware';

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function isMostlyText(bytes: Uint8Array) {
  if (!bytes.length) return false;
  let printable = 0;
  for (const byte of bytes) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 127)) printable += 1;
  }
  return printable / bytes.length > 0.92;
}

export function detectPrivateMediaType(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(bytes, 0, 4) === '%PDF') return 'application/pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08))) return 'application/zip';
  if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value)) {
    return 'application/x-ole-storage';
  }
  if (ascii(bytes, 0, 7) === 'Rar!\u001a\u0007\u0000' || ascii(bytes, 0, 8) === 'Rar!\u001a\u0007\u0001\u0000') return 'application/vnd.rar';
  if ([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c].every((value, index) => bytes[index] === value)) return 'application/x-7z-compressed';
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brands = ascii(bytes, 8, Math.min(bytes.length - 8, 56)).toLowerCase();
    if (brands.includes('avif') || brands.includes('avis')) return 'image/avif';
    if (brands.includes('heic') || brands.includes('heix') || brands.includes('hevc') || brands.includes('hevx')) return 'image/heic';
    if (brands.includes('mif1') || brands.includes('msf1')) return 'image/heif';
    const majorBrand = ascii(bytes, 8, 4).toLowerCase();
    return majorBrand.includes('m4a') ? 'audio/mp4' : 'video/mp4';
  }
  if (isMostlyText(bytes)) return 'text/plain';
  return null;
}

export class PrivateMediaInspectionService {
  static async detect(bucket: string, key: string): Promise<string | null> {
    const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-63' }));
    const bytes = await object.Body?.transformToByteArray();
    return bytes ? detectPrivateMediaType(bytes) : null;
  }
}
