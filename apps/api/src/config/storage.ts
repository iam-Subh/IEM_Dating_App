import { S3Client } from '@aws-sdk/client-s3';

/**
 * Where media is stored: AWS S3 or Cloudflare R2.
 *
 * R2 speaks the S3 API, so the same client, commands and signed URLs work on
 * both; only the endpoint, credentials, bucket names and public URL differ.
 * STORAGE_PROVIDER picks one. Both sets of settings can stay in .env, so
 * switching back is a one-line change.
 *
 * Every value is read when it is used, not at import, so tests and scripts
 * that set the environment late still see their values.
 */
export type StorageProvider = 'aws' | 'r2';

export function storageProvider(): StorageProvider {
  const value = (process.env.STORAGE_PROVIDER || 'aws').trim().toLowerCase();
  if (value !== 'aws' && value !== 'r2') throw new Error(`STORAGE_PROVIDER must be "aws" or "r2", not "${value}"`);
  return value;
}

/** Profile photos and videos, served publicly. */
export function publicMediaBucket(): string | undefined {
  return (storageProvider() === 'r2' ? process.env.R2_PUBLIC_BUCKET : process.env.AWS_S3_BUCKET_NAME) || undefined;
}

/** Chat media and Stories, only ever reached through signed URLs. */
export function privateMediaBucket(): string | undefined {
  return (storageProvider() === 'r2' ? process.env.R2_PRIVATE_BUCKET : process.env.AWS_PRIVATE_MEDIA_BUCKET) || undefined;
}

/** The public bucket's base URL, without a trailing slash. */
function publicBaseUrl(): string {
  if (storageProvider() === 'r2') {
    const base = process.env.R2_PUBLIC_URL;
    if (!base) throw new Error('R2_PUBLIC_URL is required (the public bucket\'s r2.dev or custom-domain URL)');
    return base.replace(/\/+$/, '');
  }
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!bucket) throw new Error('AWS_S3_BUCKET_NAME is required');
  return `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`;
}

/** The stored (pre-CDN) URL of a public profile object, like `photoUrl` values. */
export function publicObjectUrl(key: string): string {
  return `${publicBaseUrl()}/${key}`;
}

/** Hosts a profile media URL may point at: the public bucket, and the CDN if there is one. */
export function publicMediaHosts(): Set<string> {
  const hosts = new Set<string>();
  try { hosts.add(new URL(publicBaseUrl()).hostname); } catch { /* Unconfigured: nothing is allowed. */ }
  if (process.env.CDN_URL) {
    try { hosts.add(new URL(process.env.CDN_URL).hostname); } catch { /* Startup configuration handles invalid services. */ }
  }
  return hosts;
}

/** AWS Transcribe reads its input from S3, so Story captions work only on AWS. */
export function captionsSupported(): boolean {
  return storageProvider() === 'aws';
}

export function createS3Client(): S3Client {
  if (storageProvider() === 'r2') {
    const accountId = process.env.R2_ACCOUNT_ID;
    if (!accountId) throw new Error('R2_ACCOUNT_ID is required when STORAGE_PROVIDER=r2');
    return new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
      // Newer SDKs add checksum headers to every request by default; send them
      // only where the S3 API requires them, as Cloudflare recommends for R2.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  });
}
