import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../middlewares/upload.middleware';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

/**
 * The nudity check (docs/NUDITY_CHECK.md): Freepik's nsfw_image_detector
 * (MIT), run by our own face service, so photos never leave our servers. Each
 * photo - or frames spread across a video - gets the probability that it
 * shows nudity (the model's "medium" plus "high" levels; "low", suggestive
 * like swimwear, is allowed), and the score decides:
 *
 * - under NUDITY_REVIEW (0.5): fine, shown as usual;
 * - NUDITY_REVIEW to NUDITY_BLOCK (0.9): profile photos, videos and stories
 *   wait for the team (admin panel > Flagged media); chat media arrives blurred;
 * - NUDITY_BLOCK and over: profile photos, videos and stories are refused at
 *   upload; chat media arrives blurred.
 *
 * If the face service is down the upload is never held up: it goes through
 * as "unchecked" and the hourly job checks it later (rescanUnchecked).
 */
/**
 * Set from real photos: ordinary clothed photos scored 0.002-0.33, explicit
 * ones 1.000 (Bumble's model, used before, missed a nude collage at 0.36).
 * Tune with the backfill's report (scripts/nudity-backfill.ts).
 */
export const NUDITY_REVIEW = Number(process.env.NUDITY_REVIEW ?? 0.5);
export const NUDITY_BLOCK = Number(process.env.NUDITY_BLOCK ?? 0.9);
/** Frames looked at in a video, spread across its whole length. */
const VIDEO_SAMPLES = 8;
/** Refused uploads in a week that open a report case on the person. */
export const STRIKES_FOR_CASE = 3;

export type NudityVerdict = 'clear' | 'review' | 'block' | 'unchecked';

export function verdictOf(score: number | null | undefined): NudityVerdict {
  if (score === null || score === undefined || Number.isNaN(score)) return 'unchecked';
  if (score >= NUDITY_BLOCK) return 'block';
  if (score >= NUDITY_REVIEW) return 'review';
  return 'clear';
}

async function service(images: Buffer[]): Promise<number[] | null> {
  const url = process.env.FACE_SERVICE_URL;
  if (!url || !images.length) return null;
  try {
    const scores: number[] = [];
    for (let start = 0; start < images.length; start += 12) {
      const response = await fetch(`${url.replace(/\/$/, '')}/nudity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: images.slice(start, start + 12).map((image) => image.toString('base64')) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) { logger.warn(`[NUDITY] service answered ${response.status}`); return null; }
      scores.push(...((await response.json()) as { scores: number[] }).scores);
    }
    return scores;
  } catch (error) {
    logger.warn(`[NUDITY] service unavailable: ${(error as Error).message}`);
    return null;
  }
}

export async function readObject(bucket: string, key: string): Promise<Buffer | null> {
  try {
    const result = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

/** Frames spread evenly across the whole video (not just its start), as JPEGs. */
async function videoSamples(video: Buffer): Promise<Buffer[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nudity-video-'));
  try {
    const input = path.join(dir, 'video');
    await fs.writeFile(input, video);
    const duration = await new Promise<number>((resolve) => {
      ffmpeg.ffprobe(input, (error, data) => resolve(error ? 0 : Number(data?.format?.duration) || 0));
    });
    const fps = duration > 0 ? Math.min(2, VIDEO_SAMPLES / duration) : 1;
    await new Promise<void>((resolve, reject) => {
      ffmpeg(input)
        .outputOptions(['-vf', `fps=${fps.toFixed(4)},scale=640:-2`, '-frames:v', String(VIDEO_SAMPLES), '-q:v', '4'])
        .output(path.join(dir, 'frame-%02d.jpg'))
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
    const names = (await fs.readdir(dir)).filter((name) => name.startsWith('frame-')).sort();
    return Promise.all(names.map((name) => fs.readFile(path.join(dir, name))));
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export class NudityService {
  /** One photo's score, or null when it could not be checked. */
  static async scorePhoto(bytes: Buffer | null): Promise<number | null> {
    if (!bytes) return null;
    return (await service([bytes]))?.[0] ?? null;
  }

  /**
   * A video's score: its second most explicit frame, so one odd frame (a
   * flash of skin-coloured shirt) can't flag a whole video, while anything
   * explicit for more than a moment still does. Null when it could not be checked.
   */
  static async scoreVideo(bytes: Buffer | null): Promise<number | null> {
    if (!bytes) return null;
    let frames: Buffer[] = [];
    try { frames = await videoSamples(bytes); } catch (error) { logger.warn(`[NUDITY] video frames failed: ${(error as Error).message}`); return null; }
    const scores = await service(frames);
    if (!scores?.length) return null;
    const sorted = [...scores].sort((a, b) => b - a);
    return sorted.length >= 4 ? sorted[1] : sorted[0];
  }

  /** A stored object, by its type. */
  static async scoreObject(bucket: string, key: string, contentType: string | null | undefined) {
    const bytes = await readObject(bucket, key);
    if (!bytes) return null;
    return contentType?.startsWith('video/') ? this.scoreVideo(bytes) : contentType?.startsWith('image/') ? this.scorePhoto(bytes) : null;
  }

  /**
   * Someone who keeps trying to post explicit media: after STRIKES_FOR_CASE
   * refusals in a week, a report case opens on them for the team, once.
   */
  static async recordStrike(userId: string) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const strikes = await prisma.mediaModeration.count({ where: { userId, status: 'blocked', createdAt: { gte: since } } });
    if (strikes < STRIKES_FOR_CASE) return;
    const open = await prisma.moderationCase.findFirst({ where: { subjectUserId: userId, status: { in: ['open', 'restricted', 'reviewing'] } } });
    if (open) return;
    await prisma.moderationCase.create({
      data: { subjectUserId: userId, priority: 'high', resolution: null },
    });
    logger.warn('[NUDITY] repeated explicit uploads: case opened');
  }
}
