import { randomUUID } from 'crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetTranscriptionJobCommand, StartTranscriptionJobCommand, TranscribeClient, type LanguageCode } from '@aws-sdk/client-transcribe';
import { s3Client } from '../middlewares/upload.middleware';
import { redisClient } from '../utils/redis';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { captionsSupported, privateMediaBucket } from '../config/storage';

export type CaptionSegment = { startMs: number; endMs: number; text: string };
type TranscriptItem = { type?: string; start_time?: string; end_time?: string; alternatives?: Array<{ content?: string }> };

const DAILY_LIMIT = 30;
const LANGUAGES = ['en-IN', 'hi-IN', 'en-US'] as LanguageCode[];

const transcribe = new TranscribeClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

/**
 * Caption lines from an AWS Transcribe transcript: a new line after a
 * sentence ends, after seven words, or at a pause of more than 0.8 seconds.
 * Each line stays on screen at least 0.7 seconds, until the next one starts.
 */
export function captionSegments(items: TranscriptItem[]): CaptionSegment[] {
  const segments: CaptionSegment[] = [];
  let words: string[] = [];
  let start = 0;
  let end = 0;
  const flush = () => {
    if (words.length) segments.push({ startMs: start, endMs: end, text: words.join(' ').slice(0, 160) });
    words = [];
  };
  for (const item of items) {
    const content = item.alternatives?.[0]?.content?.trim() ?? '';
    if (!content) continue;
    if (item.type === 'punctuation') {
      if (words.length) {
        words[words.length - 1] += content;
        if (/[.?!।]/.test(content)) flush();
      }
      continue;
    }
    const wordStart = Math.round(Number(item.start_time) * 1000);
    const wordEnd = Math.round(Number(item.end_time) * 1000);
    if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) continue;
    if (words.length && (words.length >= 7 || wordStart - end > 800)) flush();
    if (!words.length) start = wordStart;
    words.push(content);
    end = wordEnd;
  }
  flush();
  return segments.slice(0, 400).map((segment, index, all) => {
    const next = all[index + 1]?.startMs ?? Number.MAX_SAFE_INTEGER;
    return { ...segment, endMs: Math.max(segment.endMs, Math.min(segment.startMs + 700, next)) };
  });
}

/**
 * Auto captions for a video story. The device uploads the video's sound
 * straight to the private bucket, AWS Transcribe writes a transcript next to
 * it, and both files are deleted as soon as the captions are read.
 */
export class StoryCaptionService {
  private static get bucket() {
    const value = privateMediaBucket();
    if (!value) throw new Error('AWS_PRIVATE_MEDIA_BUCKET is required for captions');
    return value;
  }

  private static keys(ownerId: string, jobId: string) {
    return { audio: `story-captions/${ownerId}/${jobId}.m4a`, transcript: `story-captions/${ownerId}/${jobId}.json` };
  }

  private static unavailable(error: unknown, jobId: string) {
    logger.warn('Captions are unavailable', { jobId, error: (error as Error)?.message, name: (error as { name?: string })?.name });
    return new HttpError(503, 'Captions are not available right now', 'CAPTIONS_UNAVAILABLE');
  }

  static async create(ownerId: string) {
    // Transcribe reads only from S3; on R2 there is nothing it can reach.
    if (!captionsSupported()) throw new HttpError(503, 'Captions are not available right now', 'CAPTIONS_UNAVAILABLE');
    const counter = `captions:daily:${ownerId}`;
    const used = await redisClient.incr(counter).catch(() => 1);
    if (used === 1) await redisClient.expire(counter, 24 * 60 * 60).catch(() => undefined);
    if (used > DAILY_LIMIT) throw new HttpError(429, 'You have made a lot of captions today. Try again tomorrow.', 'CAPTIONS_LIMIT');
    const jobId = randomUUID();
    const uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: this.bucket, Key: this.keys(ownerId, jobId).audio, ContentType: 'audio/mp4' }),
      { expiresIn: 600 },
    );
    await redisClient.set(`captions:job:${jobId}`, ownerId, 'EX', 60 * 60);
    return { jobId, uploadUrl };
  }

  private static async assertOwner(ownerId: string, jobId: string) {
    const owner = await redisClient.get(`captions:job:${jobId}`);
    if (owner !== ownerId) throw new HttpError(404, 'These captions are unavailable', 'CAPTIONS_NOT_FOUND');
  }

  static async start(ownerId: string, jobId: string) {
    await this.assertOwner(ownerId, jobId);
    const keys = this.keys(ownerId, jobId);
    try {
      await transcribe.send(new StartTranscriptionJobCommand({
        TranscriptionJobName: `iem-captions-${jobId}`,
        Media: { MediaFileUri: `s3://${this.bucket}/${keys.audio}` },
        MediaFormat: 'mp4',
        IdentifyLanguage: true,
        LanguageOptions: LANGUAGES,
        OutputBucketName: this.bucket,
        OutputKey: keys.transcript,
      }));
    } catch (error) {
      // Started already (a retried request).
      if ((error as { name?: string })?.name === 'ConflictException') return { started: true };
      throw this.unavailable(error, jobId);
    }
    return { started: true };
  }

  static async status(ownerId: string, jobId: string) {
    await this.assertOwner(ownerId, jobId);
    const cached = await redisClient.get(`captions:result:${jobId}`).catch(() => null);
    if (cached) return JSON.parse(cached);
    const keys = this.keys(ownerId, jobId);
    let job;
    try {
      job = (await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: `iem-captions-${jobId}` }))).TranscriptionJob;
    } catch (error) {
      throw this.unavailable(error, jobId);
    }
    const state = job?.TranscriptionJobStatus;
    if (state !== 'COMPLETED' && state !== 'FAILED') return { status: 'processing' };

    let result: { status: 'done' | 'failed'; language?: string | null; segments?: CaptionSegment[] };
    if (state === 'FAILED') {
      logger.warn('A captions job failed', { jobId, reason: job?.FailureReason });
      result = { status: 'failed' };
    } else {
      try {
        const object = await s3Client.send(new GetObjectCommand({ Bucket: this.bucket, Key: keys.transcript }));
        const transcript = JSON.parse(await object.Body!.transformToString());
        result = { status: 'done', language: job?.LanguageCode ?? null, segments: captionSegments(transcript?.results?.items ?? []) };
      } catch (error) {
        throw this.unavailable(error, jobId);
      }
    }
    await redisClient.set(`captions:result:${jobId}`, JSON.stringify(result), 'EX', 60 * 60).catch(() => undefined);
    await Promise.all([keys.audio, keys.transcript].map((Key) => s3Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key })).catch(() => undefined)));
    return result;
  }
}
