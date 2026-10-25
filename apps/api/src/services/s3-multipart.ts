import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, HeadObjectCommand, ListPartsCommand, UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../middlewares/upload.middleware';

/**
 * Parts are 8 MB, S3's 5 MB floor plus headroom. A dropped connection costs at
 * most one part, and a 500 MB video is 63 requests.
 */
export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;
const MULTIPART_MAX_PARTS = 10_000;

/**
 * How long a resumable upload may take, and how long its part URLs stay valid.
 *
 * The device's background uploader has no access token, so every part URL is
 * issued up front and must outlive a phone that sits in a pocket on a poor
 * connection for hours. Presigned URLs signed with IAM user keys may last up
 * to seven days; a day bounds how long abandoned parts are stored.
 */
export const MULTIPART_TTL_SECONDS = 24 * 60 * 60;

export type StoredPart = { PartNumber?: number; ETag?: string; Size?: number };

export function isNoSuchUpload(error: any) {
  return error?.name === 'NoSuchUpload' || error?.Code === 'NoSuchUpload' || error?.$metadata?.httpStatusCode === 404;
}

export function partLayout(size: number) {
  const partSize = Math.max(MULTIPART_PART_BYTES, Math.ceil(size / MULTIPART_MAX_PARTS));
  return { partSize, partCount: Math.ceil(size / partSize) };
}

export async function createUpload(bucket: string, key: string, contentType: string) {
  const created = await s3Client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
  if (!created.UploadId) throw new Error('S3 did not return a multipart upload id');
  return created.UploadId;
}

export function abortUpload(bucket: string, key: string, uploadId: string) {
  return s3Client
    .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
    .catch((error) => { if (!isNoSuchUpload(error)) throw error; });
}

/** A presigned URL for every part, valid for the upload's whole window. */
export function presignParts(bucket: string, key: string, uploadId: string, partNumbers: number[], expiresIn = MULTIPART_TTL_SECONDS) {
  return Promise.all(partNumbers.map(async (partNumber) => ({
    partNumber,
    url: await getSignedUrl(s3Client, new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn }),
  })));
}

/** The parts S3 holds for an upload, or null when S3 no longer knows it. */
export async function listStoredParts(bucket: string, key: string, uploadId: string): Promise<StoredPart[] | null> {
  const parts: StoredPart[] = [];
  try {
    let marker: string | undefined;
    do {
      const page = await s3Client.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
      parts.push(...(page.Parts ?? []));
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
  } catch (error) {
    if (isNoSuchUpload(error)) return null;
    throw error;
  }
  return parts;
}

export type AssembleResult =
  | { outcome: 'assembled' | 'already-assembled' }
  | { outcome: 'expired' }
  | { outcome: 'incomplete'; message: string };

/**
 * Assembles the uploaded parts into one object.
 *
 * The part list comes from S3, not from the device, so a client cannot claim
 * parts it never sent. Every part must be present and full-sized except the
 * last. When S3 no longer knows the upload, an earlier completion may already
 * have assembled it and failed afterwards; the object's existence decides.
 */
export async function assembleUpload(
  bucket: string,
  upload: { objectKey: string; uploadId: string; partSize: number | null; partCount: number | null },
): Promise<AssembleResult> {
  const parts = await listStoredParts(bucket, upload.objectKey, upload.uploadId);
  if (!parts) {
    const assembled = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: upload.objectKey })).then(() => true, () => false);
    return assembled ? { outcome: 'already-assembled' } : { outcome: 'expired' };
  }
  const expected = upload.partCount ?? 0;
  const byNumber = new Map(parts.map((part) => [part.PartNumber, part]));
  const missing = Array.from({ length: expected }, (_, index) => index + 1).filter((number) => !byNumber.get(number)?.ETag);
  if (missing.length || parts.length !== expected) {
    return { outcome: 'incomplete', message: `Upload is incomplete: ${missing.length} of ${expected} parts are missing` };
  }
  const short = parts.find((part) => part.PartNumber !== expected && upload.partSize && part.Size !== upload.partSize);
  if (short) return { outcome: 'incomplete', message: `Upload part ${short.PartNumber} has the wrong size` };
  await s3Client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket,
    Key: upload.objectKey,
    UploadId: upload.uploadId,
    MultipartUpload: {
      Parts: [...parts]
        .sort((first, second) => (first.PartNumber ?? 0) - (second.PartNumber ?? 0))
        .map((part) => ({ PartNumber: part.PartNumber, ETag: part.ETag })),
    },
  }));
  return { outcome: 'assembled' };
}
