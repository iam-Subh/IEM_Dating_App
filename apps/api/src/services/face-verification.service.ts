import { PushService } from './push.service';
import { announceVerification } from './verification-live';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { s3Client } from '../middlewares/upload.middleware';
import { privateMediaBucket, publicMediaBucket } from '../config/storage';
import { objectKeyFromUrl } from './profile-media-processing.service';
import { istMidnight } from './verification-limits.service';

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * The real-person check (apps/mobile/src/features/verification/PHOTO_VERIFICATION_PLAN.md).
 *
 * A live selfie - random actions, checked again here from the face landmarks,
 * never trusted from the phone alone - proves who holds the phone; every
 * profile photo and the profile video must then show that person. What is
 * kept: the face key (128 numbers, encrypted, never a picture) and the
 * result. Snapshots are deleted after the check, except for a case a person
 * must review (deleted on decision, at most 7 days).
 *
 * Passing it is half of the blue badge: with a valid college verification
 * it earns the blue tick (blue-badge.ts). The selfie itself is never shown.
 */

// ---------------------------------------------------------------------------
// Numbers (PHOTO_VERIFICATION_PLAN.md 3, 8 - set for real by `npm run face:calibrate`)
// ---------------------------------------------------------------------------
/** dlib distance at or under which two faces are the same person. */
export const MATCH_DISTANCE = Number(process.env.FACE_MATCH_DISTANCE ?? 0.5);
/** Between the two: unsure - a person reviews it. Over it: not the same person. */
export const UNSURE_DISTANCE = Number(process.env.FACE_UNSURE_DISTANCE ?? 0.6);
/**
 * An extra photo (not the main one) this close counts as them: dlib's own
 * same-person line. A selfie and an older photo differ in light, angle and
 * time, so genuine extra photos land between 0.5 and 0.6 (one real account:
 * 0.505 and 0.556). Further than that is still "not you". The main photo and
 * the video keep the stricter MATCH_DISTANCE, with the team for the unsure band.
 */
export const EXTRA_PHOTO_DISTANCE = Number(process.env.FACE_EXTRA_PHOTO_DISTANCE ?? 0.6);
/** Review reasons that come from the photos, not from the selfie itself: a photo change can settle them. */
const MEDIA_REVIEW_REASONS = ['unsure', 'unsure_after_change'];
const ACTIONS = ['blink', 'left', 'right', 'smile'] as const;
type Action = (typeof ACTIONS)[number];
const FRAMES_PER_STEP = 2;
const CHALLENGE_MS = 3 * 60_000;
export const DAILY_ATTEMPTS = 5;
const STREAK_TO_REVIEW = 3;
const REVIEW_KEEP_MS = 7 * 24 * 60 * 60_000;
const VIDEO_FRAMES = 10;
const MODEL = 'dlib_face_recognition_resnet_model_v1';

// Liveness, from the landmarks (eye aspect ratio, nose offset, mouth width).
/** Closed: at most this, and at most CLOSED_SHARE of their own open eyes in the "look straight" step. */
const EYES_CLOSED = 0.22;
const CLOSED_SHARE = 0.8;
/**
 * A turn: at least this, up to a full side view. The app takes the first
 * frame of a turn early, mid-turn, so one frame usually still shows both eyes.
 */
const TURN_YAW = 0.15;
/**
 * How far a turned face may be from the front-view key and still be them. A
 * full side view measured 0.63-0.66 from the same person's front view, over
 * the 0.6 review line; another person is usually 0.8 or more.
 */
export const TURN_DISTANCE = Number(process.env.FACE_TURN_DISTANCE ?? 0.75);
/**
 * A photo whose face is turned this far (nose offset over eye distance) is a
 * side view: its likeness to a front-facing selfie can't be measured well.
 */
export const SIDE_YAW = 0.3;
const STRAIGHT_YAW = 0.15;
const SMILE_GROWTH = 1.06;
/**
 * Or the mouth corners rise this much above their highest straight-face
 * reading: a soft, closed smile lifts the corners while the mouth hardly
 * widens (measured 0.040-0.049 straight, 0.068 smiling).
 */
const SMILE_LIFT = 0.015;

export type Face = { box: number[]; descriptor: number[]; eyeOpen: number; yaw: number; smile: number; lift?: number };
/** `side`: a face turned to the side, within TURN_DISTANCE - can't be compared closely. */
export type MediaStatus = 'match' | 'unsure' | 'mismatch' | 'no_face' | 'side';
type Step = 'straight' | Action;

// ---------------------------------------------------------------------------
// The face service and storage
// ---------------------------------------------------------------------------
async function analyze(images: Buffer[]): Promise<Face[][]> {
  const url = process.env.FACE_SERVICE_URL;
  if (!url) throw new HttpError(503, 'The real-person check is not available right now.', 'FACE_SERVICE_UNAVAILABLE');
  const out: Face[][] = [];
  // The service takes up to 24 images a call.
  for (let start = 0; start < images.length; start += 20) {
    const response = await fetch(`${url.replace(/\/$/, '')}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: images.slice(start, start + 20).map((image) => image.toString('base64')) }),
      signal: AbortSignal.timeout(60_000),
    }).catch((error) => {
      throw new HttpError(503, 'The real-person check is not available right now.', `FACE_SERVICE_UNAVAILABLE`, { cause: String(error) });
    });
    if (!response.ok) throw new HttpError(503, 'The real-person check is not available right now.', 'FACE_SERVICE_UNAVAILABLE');
    const body = await response.json() as { images: { faces: Face[] }[] };
    out.push(...body.images.map((image) => image.faces));
  }
  return out;
}

function privateBucket() {
  const bucket = privateMediaBucket();
  if (!bucket) throw new HttpError(503, 'The real-person check is not available right now.', 'FACE_STORAGE_UNAVAILABLE');
  return bucket;
}

async function readObject(bucket: string, key: string): Promise<Buffer | null> {
  try {
    const result = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

/** A profile photo or video by its address: from our bucket, else over HTTP. */
async function readMedia(url: string): Promise<Buffer | null> {
  const bucket = publicMediaBucket();
  const key = objectKeyFromUrl(url);
  if (bucket && key) {
    const fromBucket = await readObject(bucket, key);
    if (fromBucket) return fromBucket;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function deleteSnapshots(keys: string[]) {
  if (!keys.length) return;
  await s3Client.send(new DeleteObjectsCommand({
    Bucket: privateBucket(),
    Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
  })).catch((error) => logger.warn(`[FACE] snapshots not deleted: ${(error as Error).message}`));
}

/** Up to ten frames of a video, one a second, as JPEGs. */
export async function videoFrames(video: Buffer): Promise<Buffer[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'face-video-'));
  try {
    const input = path.join(dir, 'video');
    await fs.writeFile(input, video);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(input)
        .outputOptions(['-vf', 'fps=1,scale=640:-2', '-frames:v', String(VIDEO_FRAMES), '-q:v', '4'])
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

// ---------------------------------------------------------------------------
// The face key: encrypted at rest
// ---------------------------------------------------------------------------
function keySecret() {
  const secret = process.env.FACE_KEY_SECRET;
  if (secret && secret.length >= 32) return createHash('sha256').update(secret).digest();
  if (process.env.NODE_ENV === 'production') throw new Error('FACE_KEY_SECRET (32+ characters) is required');
  return createHash('sha256').update(`dev-face-key:${process.env.JWT_REFRESH_SECRET ?? 'local'}`).digest();
}

export function sealDescriptor(descriptor: number[]) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keySecret(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(descriptor), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.');
}

export function openDescriptor(sealed: string): number[] {
  const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', keySecret(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
}

export function distance(a: number[], b: number[]) {
  let sum = 0;
  for (let index = 0; index < a.length; index++) sum += (a[index] - b[index]) ** 2;
  return Math.sqrt(sum);
}

function mean(descriptors: number[][]) {
  return descriptors[0].map((_, index) => descriptors.reduce((sum, item) => sum + item[index], 0) / descriptors.length);
}

/** Closest face in an image to the key. */
/** A checked item as it counts now: an extra photo inside EXTRA_PHOTO_DISTANCE is a match. */
export function effectiveStatus(item: { kind: string; main: boolean; status: MediaStatus; distance: number | null }): MediaStatus {
  if (item.kind === 'photo' && !item.main && item.status === 'unsure' && item.distance !== null && item.distance <= EXTRA_PHOTO_DISTANCE) return 'match';
  // A side view is fine as an extra photo; the main photo has to show the face, so the team looks.
  if (item.status === 'side') return item.kind === 'photo' && !item.main ? 'match' : 'unsure';
  return item.status;
}

export function verdict(faces: Face[], key: number[]): { status: MediaStatus; distance: number | null } {
  if (!faces.length) return { status: 'no_face', distance: null };
  const scored = faces.map((face) => ({ face, distance: distance(face.descriptor, key) }));
  const best = scored.reduce((closest, item) => (item.distance < closest.distance ? item : closest));
  const rounded = Math.round(best.distance * 1000) / 1000;
  if (best.distance <= MATCH_DISTANCE) return { status: 'match', distance: rounded };
  // A face turned to the side drifts from a front-facing key even for the same person.
  if (Math.abs(best.face.yaw) >= SIDE_YAW && best.distance <= TURN_DISTANCE) return { status: 'side', distance: rounded };
  return { status: best.distance <= UNSURE_DISTANCE ? 'unsure' : 'mismatch', distance: rounded };
}

/** Is the account required to pass the check (D1)? Made with Google. */
export async function realPersonRequired(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { googleSub: true, googleLinkedAt: true, createdAt: true } });
  return !!(user?.googleSub && user.googleLinkedAt && Math.abs(user.googleLinkedAt.getTime() - user.createdAt.getTime()) < 60_000);
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------
/**
 * Local testing only: keep failing snapshots in the private bucket so a
 * developer can look at their own attempt. Never in production.
 */
function debugKeep() {
  return process.env.FACE_DEBUG_KEEP === 'true' && process.env.NODE_ENV !== 'production';
}

function steps(actions: string[]): Step[] {
  return ['straight', ...(actions as Action[])];
}
function snapshotKey(userId: string, challengeId: string, step: Step, index: number) {
  return `face-checks/${userId}/${challengeId}/${step}-${index}.jpg`;
}

/** What a failed check says, by its recorded reason. */
function failureMessage(reason: string) {
  if (reason === 'no_snapshots') return "The selfie didn't upload. Check your connection and try again.";
  if (reason === 'no_face') return 'We need to see only your face, clearly, in every step. Try again in good light.';
  if (reason === 'not_one_person') return "We couldn't confirm it's a live selfie. Try again in good light.";
  if (reason.startsWith('liveness')) return "We couldn't confirm it's a live selfie. Follow each step, in good light, and try again.";
  return 'The real-person check is not available right now.';
}

export class FaceVerificationService {
  /** A new attempt: three random actions in a random order, and private upload slots for the snapshots. */
  static async challenge(userId: string) {
    const attempts = await prisma.faceChallenge.count({ where: { userId, usedAt: { gte: istMidnight() } } });
    if (attempts >= DAILY_ATTEMPTS) {
      throw new HttpError(429, `You can try ${DAILY_ATTEMPTS} times a day. Try again tomorrow.`, 'FACE_ATTEMPTS_LIMIT');
    }
    const pool = [...ACTIONS];
    for (let index = pool.length - 1; index > 0; index--) {
      const other = randomInt(index + 1);
      [pool[index], pool[other]] = [pool[other], pool[index]];
    }
    const actions = pool.slice(0, 3);
    const challenge = await prisma.faceChallenge.create({
      data: { userId, actions, expiresAt: new Date(Date.now() + CHALLENGE_MS) },
    });
    const bucket = privateBucket();
    const uploads = await Promise.all(steps(actions).flatMap((step) => Array.from({ length: FRAMES_PER_STEP }, async (_, index) => {
      const key = snapshotKey(userId, challenge.id, step, index);
      const uploadUrl = await getSignedUrl(s3Client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'image/jpeg' }), { expiresIn: 300 });
      return { step, index, uploadUrl, contentType: 'image/jpeg' };
    })));
    return { challengeId: challenge.id, actions, expiresAt: challenge.expiresAt.toISOString(), framesPerStep: FRAMES_PER_STEP, uploads, attemptsLeft: DAILY_ATTEMPTS - attempts - 1 };
  }

  /** The snapshots are uploaded: check them, then every photo and the video. */
  static async submit(userId: string, challengeId: string) {
    const challenge = await prisma.faceChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.userId !== userId) throw new HttpError(404, 'This check is unavailable. Start again.', 'FACE_CHALLENGE_UNAVAILABLE');
    const claimed = await prisma.faceChallenge.updateMany({
      where: { id: challengeId, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (!claimed.count) throw new HttpError(410, 'This check has expired. Start again.', 'FACE_CHALLENGE_EXPIRED');
    try {
      return await this.check(userId, challenge);
    } catch (error) {
      // Recorded, so an app that lost this answer reads "failed", not "still checking".
      await prisma.faceChallenge.update({ where: { id: challengeId }, data: { result: 'service' } }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * How a submitted check ended, for an app that lost the answer to submit -
   * a slow check outlasting its request, or a Wi-Fi drop. `not_submitted`:
   * submit never arrived, so the app can send it again while the check is open.
   */
  static async challengeResult(userId: string, challengeId: string) {
    const challenge = await prisma.faceChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.userId !== userId) throw new HttpError(404, 'This check is unavailable. Start again.', 'FACE_CHALLENGE_UNAVAILABLE');
    if (!challenge.usedAt) return { state: challenge.expiresAt > new Date() ? 'not_submitted' as const : 'expired' as const };
    if (!challenge.result) return { state: 'checking' as const };
    if (challenge.result === 'verified' || challenge.result === 'needs_fix' || challenge.result === 'pending_review') {
      const current = await this.status(userId);
      return { state: 'done' as const, result: { status: challenge.result, reason: current.status === challenge.result ? current.reason : null, items: current.items } };
    }
    return { state: 'done' as const, result: { status: 'failed' as const, reason: challenge.result, message: failureMessage(challenge.result) } };
  }

  /** The snapshots of a claimed challenge, then every photo and the video. */
  private static async check(userId: string, challenge: { id: string; actions: string[] }) {
    const challengeId = challenge.id;

    const bucket = privateBucket();
    const plan = steps(challenge.actions).flatMap((step) => Array.from({ length: FRAMES_PER_STEP }, (_, index) => ({ step, key: snapshotKey(userId, challengeId, step, index) })));
    const files = await Promise.all(plan.map((item) => readObject(bucket, item.key)));
    const present = plan.map((item, index) => ({ ...item, file: files[index] })).filter((item): item is typeof item & { file: Buffer } => !!item.file);
    const keys = plan.map((item) => item.key);
    const previous = await prisma.faceVerification.findUnique({ where: { userId } });
    const streak = previous?.failureStreak ?? 0;

    const fail = async (reason: string) => {
      const message = failureMessage(reason);
      await deleteSnapshots(keys);
      await prisma.faceChallenge.update({ where: { id: challengeId }, data: { result: reason } });
      // Only a suspicious failure - another face appearing mid-check - counts
      // towards sending the next attempt to a person. Missed actions, bad
      // light and no face are what honest people do (PHOTO_VERIFICATION_PLAN.md 2.4).
      const suspicious = reason === 'not_one_person';
      await prisma.faceVerification.upsert({
        where: { userId },
        create: { userId, status: 'failed', reason, failureStreak: suspicious ? 1 : 0 },
        update: { ...(previous?.status === 'verified' ? {} : { status: 'failed', reason }), ...(suspicious ? { failureStreak: { increment: 1 } } : {}) },
      });
      return { status: 'failed' as const, reason, message };
    };

    if (!present.length) return fail('no_snapshots');
    const faces = await analyze(present.map((item) => item.file));
    const good = present.map((item, index) => ({ step: item.step as Step, key: item.key, face: faces[index].length === 1 ? faces[index][0] : null }))
      .filter((item): item is { step: Step; key: string; face: Face } => !!item.face);
    const byStep = (step: Step) => good.filter((item) => item.step === step).map((item) => item.face);
    // Every step needs at least one frame with their face. A full side turn
    // can lose the face in its later frame; the earlier, mid-turn one counts.
    if (steps(challenge.actions).some((step) => !byStep(step).length)) {
      return fail('no_face');
    }

    // One person throughout: nobody swaps faces between the actions. The key
    // is the front-facing frames; a turned face drifts - a full side view by
    // 0.63-0.66 for the same person - so the turns get the wider TURN_DISTANCE.
    const front = good.filter((item) => item.step !== 'left' && item.step !== 'right');
    const key = mean(front.map((item) => item.face.descriptor));
    if (good.some((item) => distance(item.face.descriptor, key) > (item.step === 'left' || item.step === 'right' ? TURN_DISTANCE : MATCH_DISTANCE))) {
      return fail('not_one_person');
    }

    // Liveness, checked again here from the landmarks.
    const straight = byStep('straight').reduce((best, face) => (Math.abs(face.yaw) < Math.abs(best.yaw) ? face : best));
    // Their own eyes, open: the widest in the "look straight" frames.
    const openEyes = Math.max(...byStep('straight').map((face) => face.eyeOpen));
    // Their mouth at rest: the highest corners in the "look straight" frames.
    const restingLift = Math.max(...byStep('straight').map((face) => face.lift ?? 0));
    const turnSign = (step: Action) => {
      const turned = byStep(step).filter((face) => Math.abs(face.yaw - straight.yaw) >= TURN_YAW);
      return turned.length ? Math.sign(turned[0].yaw - straight.yaw) : 0;
    };
    const passed: Record<Action, () => boolean> = {
      blink: () => byStep('blink').some((face) => face.eyeOpen <= Math.min(EYES_CLOSED, openEyes * CLOSED_SHARE)),
      left: () => turnSign('left') !== 0,
      right: () => turnSign('right') !== 0,
      smile: () => byStep('smile').some((face) => face.smile >= straight.smile * SMILE_GROWTH
        || (face.lift !== undefined && face.lift >= restingLift + SMILE_LIFT)),
    };
    const actions = challenge.actions as Action[];
    const missed = [
      ...(Math.abs(straight.yaw) <= STRAIGHT_YAW ? [] : ['straight']),
      ...actions.filter((action) => !passed[action]()),
      // Left and right are opposite ways, whichever way the camera mirrors.
      ...(actions.includes('left') && actions.includes('right') && turnSign('left') === turnSign('right') ? ['same_side'] : []),
    ];
    if (missed.length) {
      // Numbers only - never a picture - so a failing step can be tuned.
      logger.info(`[FACE] liveness missed ${missed.join(',')}: ${JSON.stringify(good.map((item) => ({ step: item.step, eyeOpen: item.face.eyeOpen, yaw: item.face.yaw, smile: item.face.smile, lift: item.face.lift })))}`);
      if (debugKeep()) keys.length = 0;
      return fail(`liveness:${missed.join(',')}`.slice(0, 30));
    }

    // The face key, then every photo and the video against it.
    await prisma.faceKey.upsert({
      where: { userId },
      create: { userId, cipher: sealDescriptor(key), model: MODEL },
      update: { cipher: sealDescriptor(key), model: MODEL, createdAt: new Date() },
    });
    await prisma.faceMediaCheck.deleteMany({ where: { userId } });
    const media = await this.checkMedia(userId, key, true);
    const outcome = this.outcome(media);
    const review = outcome.status === 'pending_review' || streak >= STREAK_TO_REVIEW;
    if (review) {
      await prisma.faceReviewCase.create({
        data: {
          userId,
          reason: streak >= STREAK_TO_REVIEW && outcome.status !== 'pending_review' ? 'repeated_failures' : outcome.reason ?? 'unsure',
          snapshotKeys: good.map((item) => item.key),
          details: { media: media.items, liveness: good.map((item) => ({ step: item.step, eyeOpen: item.face.eyeOpen, yaw: item.face.yaw, smile: item.face.smile })) },
        },
      });
      await deleteSnapshots(keys.filter((item) => !good.some((entry) => entry.key === item)));
    } else {
      await deleteSnapshots(keys);
    }
    const status = review ? 'pending_review' : outcome.status;
    await this.setStatus(userId, status, review ? (outcome.reason ?? 'review') : outcome.reason, streak);
    await prisma.faceChallenge.update({ where: { id: challengeId }, data: { result: status } });
    return { status, reason: review ? 'review' : outcome.reason, items: media.items.map((item) => ({ ...item, status: effectiveStatus(item) })) };
  }

  /**
   * Each photo (and the video) against the key. `all`: check everything;
   * otherwise only what has not been checked at its address yet.
   */
  private static async checkMedia(userId: string, key: number[], all: boolean) {
    const [photos, user, known] = await Promise.all([
      prisma.profilePhoto.findMany({ where: { userId }, orderBy: { order: 'asc' }, select: { photoUrl: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { videoPlaybackUrl: true, profileVideoUrl: true } }),
      prisma.faceMediaCheck.findMany({ where: { userId } }),
    ]);
    const cached = new Map(known.map((row) => [row.mediaUrl, row]));
    const items: { url: string; kind: 'photo' | 'video'; main: boolean; status: MediaStatus; distance: number | null }[] = [];
    const toCheck = photos.filter((photo) => all || !cached.has(photo.photoUrl));
    if (toCheck.length) {
      const files = await Promise.all(toCheck.map((photo) => readMedia(photo.photoUrl)));
      const readable = toCheck.map((photo, index) => ({ photo, file: files[index] })).filter((item): item is { photo: typeof item.photo; file: Buffer } => !!item.file);
      const results = readable.length ? await analyze(readable.map((item) => item.file)) : [];
      for (const [index, item] of readable.entries()) {
        const result = verdict(results[index], key);
        cached.set(item.photo.photoUrl, { ...result, mediaUrl: item.photo.photoUrl, kind: 'photo' } as never);
        await prisma.faceMediaCheck.upsert({
          where: { userId_mediaUrl: { userId, mediaUrl: item.photo.photoUrl } },
          create: { userId, mediaUrl: item.photo.photoUrl, kind: 'photo', status: result.status, distance: result.distance },
          update: { status: result.status, distance: result.distance, checkedAt: new Date() },
        });
      }
    }
    for (const [index, photo] of photos.entries()) {
      const row = cached.get(photo.photoUrl) as { status: MediaStatus; distance: number | null } | undefined;
      if (row) items.push({ url: photo.photoUrl, kind: 'photo', main: index === 0, status: row.status, distance: row.distance });
    }
    const videoUrl = user.videoPlaybackUrl ?? user.profileVideoUrl;
    if (videoUrl) {
      let row = cached.get(videoUrl) as { status: MediaStatus; distance: number | null } | undefined;
      if (all || !row) {
        row = await this.checkVideo(videoUrl, key);
        if (row) {
          await prisma.faceMediaCheck.upsert({
            where: { userId_mediaUrl: { userId, mediaUrl: videoUrl } },
            create: { userId, mediaUrl: videoUrl, kind: 'video', status: row.status, distance: row.distance },
            update: { status: row.status, distance: row.distance, checkedAt: new Date() },
          });
        }
      }
      if (row) items.push({ url: videoUrl, kind: 'video', main: false, status: row.status, distance: row.distance });
    }
    // Rows for photos no longer on the profile go.
    const live = new Set([...photos.map((photo) => photo.photoUrl), ...(videoUrl ? [videoUrl] : [])]);
    await prisma.faceMediaCheck.deleteMany({ where: { userId, mediaUrl: { notIn: [...live] } } });
    return { items };
  }

  /** The video shows them in at least two frames (PHOTO_VERIFICATION_PLAN.md 4). */
  private static async checkVideo(url: string, key: number[]): Promise<{ status: MediaStatus; distance: number | null } | undefined> {
    const file = await readMedia(url);
    if (!file) return undefined;
    let frames: Buffer[] = [];
    try { frames = await videoFrames(file); } catch (error) { logger.warn(`[FACE] video frames failed: ${(error as Error).message}`); return undefined; }
    if (!frames.length) return undefined;
    // A frame where they look away counts as unsure, never as "not them".
    const results = (await analyze(frames)).map((faces) => verdict(faces, key))
      .map((result) => (result.status === 'side' ? { ...result, status: 'unsure' as const } : result));
    const matches = results.filter((result) => result.status === 'match').length;
    const distances = results.map((result) => result.distance).filter((value): value is number => value !== null);
    const best = distances.length ? Math.min(...distances) : null;
    if (matches >= 2) return { status: 'match', distance: best };
    if (!distances.length) return { status: 'no_face', distance: null };
    if (matches === 1 || results.some((result) => result.status === 'unsure')) return { status: 'unsure', distance: best };
    return { status: 'mismatch', distance: best };
  }

  /** What the photos and video add up to (PHOTO_VERIFICATION_PLAN.md 2.4, 3, 4). */
  private static outcome(media: { items: { kind: string; main: boolean; status: MediaStatus; distance: number | null }[] }): { status: 'verified' | 'needs_fix' | 'pending_review'; reason: string | null } {
    const items = media.items.map((item) => ({ ...item, status: effectiveStatus(item) }));
    media = { items };
    const main = media.items.find((item) => item.main);
    if (!main || main.status === 'no_face' || main.status === 'mismatch') return { status: 'needs_fix', reason: 'main_photo' };
    const video = media.items.find((item) => item.kind === 'video');
    if (video && (video.status === 'mismatch' || video.status === 'no_face')) return { status: 'needs_fix', reason: 'video' };
    if (media.items.some((item) => item.kind === 'photo' && item.status === 'mismatch')) return { status: 'needs_fix', reason: 'photo' };
    if (media.items.some((item) => item.status === 'unsure')) return { status: 'pending_review', reason: 'unsure' };
    return { status: 'verified', reason: null };
  }

  private static async setStatus(userId: string, status: string, reason: string | null, streak = 0) {
    const verified = status === 'verified';
    await prisma.faceVerification.upsert({
      where: { userId },
      create: { userId, status, reason, verifiedAt: verified ? new Date() : null, failureStreak: verified ? 0 : streak },
      update: { status, reason, verifiedAt: verified ? new Date() : null, ...(verified ? { failureStreak: 0 } : {}) },
    });
    // The current status follows every change; "passed once" is kept while a
    // later photo needs fixing, so that never pauses the profile.
    await prisma.user.update({
      where: { id: userId },
      data: { realPersonVerifiedAt: verified ? new Date() : null, ...(verified ? { realPersonPassedAt: new Date() } : {}) },
    });
    // A Google account paused for want of this check comes back at once (D1).
    if (verified) {
      const { VerificationLimitsService } = await import('./verification-limits.service');
      await VerificationLimitsService.refreshPause(userId);
    }
    // Their Profile and Account pages follow at once, not on the next visit.
    announceVerification(userId);
  }

  /**
   * A photo or video changed (PHOTO_VERIFICATION_PLAN.md 5): checked against
   * the face key in the background. The status follows - paused when a
   * photo isn't them, back when it's fixed. A pending review is left alone.
   */
  static async onMediaChanged(userId: string) {
    const [row, current] = await Promise.all([
      prisma.faceKey.findUnique({ where: { userId } }),
      prisma.faceVerification.findUnique({ where: { userId } }),
    ]);
    // A review the photos caused is settled by a photo change too; one the selfie caused waits for the team.
    const mediaReview = current?.status === 'pending_review' && MEDIA_REVIEW_REASONS.includes(current.reason ?? '');
    if (!row || !current || !(['verified', 'needs_fix'].includes(current.status) || mediaReview)) return;
    const media = await this.checkMedia(userId, openDescriptor(row.cipher), false);
    const outcome = this.outcome(media);
    const open = await prisma.faceReviewCase.findMany({ where: { userId, status: 'pending', reason: { in: MEDIA_REVIEW_REASONS } }, select: { id: true, snapshotKeys: true } });
    if (outcome.status === 'pending_review') {
      // One open case per person, showing the photos as they are now.
      if (open.length) await prisma.faceReviewCase.update({ where: { id: open[0].id }, data: { details: { media: media.items } } });
      else await prisma.faceReviewCase.create({ data: { userId, reason: 'unsure_after_change', snapshotKeys: [], details: { media: media.items } } });
    } else if (open.length) {
      // The photo that needed a look is gone or now counts: nothing left to review.
      await deleteSnapshots(open.flatMap((item) => item.snapshotKeys));
      await prisma.faceReviewCase.updateMany({ where: { id: { in: open.map((item) => item.id) } }, data: { status: 'superseded', snapshotKeys: [] } });
    }
    const next = outcome.status === 'pending_review' ? 'pending_review' : outcome.status;
    if (next !== current.status || outcome.reason !== current.reason) await this.setStatus(userId, next, outcome.reason, current.failureStreak);
    // N18: was verified, now a photo or the video isn't them - tell them, once.
    if (current.status === 'verified' && next === 'needs_fix') {
      const title = outcome.reason === 'video' ? 'Your video needs a look' : 'One of your photos needs a look';
      const body = "It doesn't seem to show you. Replace or remove it to keep your real-person check.";
      const notification = await prisma.notification.create({ data: { userId, type: 'system', title, body } }).catch(() => null);
      void PushService.send(userId, {
        title, body, category: 'verify_reminders', kind: 'real_person_paused', notificationId: notification?.id,
        data: { url: 'iemdating://EditProfile' },
      }).catch(() => undefined);
    }
  }

  /**
   * Any photo or video change. While the person is fixing media the check
   * asked for, the re-check finishes before their save returns, so the status
   * they read next is the new one rather than a stale "needs fix". Otherwise
   * it runs in the background and never holds the save up.
   */
  static async afterMediaChange(userId: string) {
    const current = await prisma.faceVerification.findUnique({ where: { userId }, select: { status: true } });
    const recheck = this.onMediaChanged(userId)
      .catch((error) => logger.warn(`[FACE] media re-check failed: ${(error as Error).message}`));
    if (current?.status === 'needs_fix') await recheck;
  }

  /**
   * Before a new main photo is saved (PHOTO_VERIFICATION_PLAN.md 5): it must
   * show them. Only for someone with a face key; if the face service is down,
   * the photo is saved and checked afterwards instead of blocking the person.
   */
  static async assertMainPhoto(userId: string, url: string) {
    const row = await prisma.faceKey.findUnique({ where: { userId } });
    if (!row) return;
    const checked = await prisma.faceMediaCheck.findUnique({ where: { userId_mediaUrl: { userId, mediaUrl: url } } });
    let status = checked?.status as MediaStatus | undefined;
    if (!status) {
      try {
        const file = await readMedia(url);
        if (!file) return;
        status = verdict((await analyze([file]))[0], openDescriptor(row.cipher)).status;
      } catch (error) {
        logger.warn(`[FACE] main photo not checked: ${(error as Error).message}`);
        return;
      }
    }
    if (status === 'mismatch' || status === 'no_face') {
      throw new HttpError(400, "This doesn't look like you. Your main photo has to show your face.", 'MAIN_PHOTO_NOT_YOU');
    }
  }

  /** What the app shows (PHOTO_VERIFICATION_PLAN.md 6, 11). */
  static async status(userId: string) {
    const [row, checks, required, attempts, photos, user] = await Promise.all([
      prisma.faceVerification.findUnique({ where: { userId } }),
      prisma.faceMediaCheck.findMany({ where: { userId }, select: { mediaUrl: true, kind: true, status: true, distance: true } }),
      realPersonRequired(userId),
      prisma.faceChallenge.count({ where: { userId, usedAt: { gte: istMidnight() } } }),
      prisma.profilePhoto.findMany({ where: { userId }, orderBy: { order: 'asc' }, select: { photoUrl: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { videoPlaybackUrl: true, profileVideoUrl: true } }),
    ]);
    const main = photos[0];
    // A photo with no face (a view, food, a pet) is fine - unless it's the main photo (3).
    const counted = (check: (typeof checks)[number]) => effectiveStatus({ kind: check.kind, main: check.mediaUrl === main?.photoUrl, status: check.status as MediaStatus, distance: check.distance });
    const flagged = checks.filter((check) => counted(check) !== 'match'
      && !(check.status === 'no_face' && check.kind === 'photo' && check.mediaUrl !== main?.photoUrl));
    // Every checked photo and the video, in profile order, as a check result
    // lists them: after a fix the app shows where things stand without a new selfie.
    const byUrl = new Map(checks.map((check) => [check.mediaUrl, check]));
    const video = [user?.videoPlaybackUrl, user?.profileVideoUrl].map((url) => (url ? byUrl.get(url) : undefined)).find(Boolean);
    const items = [
      ...photos.flatMap((photo, index) => {
        const check = byUrl.get(photo.photoUrl);
        return check ? [{ url: photo.photoUrl, kind: 'photo' as const, main: index === 0, status: counted(check), distance: check.distance }] : [];
      }),
      ...(video ? [{ url: video.mediaUrl, kind: 'video' as const, main: false, status: video.status as MediaStatus, distance: video.distance }] : []),
    ];
    return {
      status: (row?.status ?? 'none') as 'none' | 'verified' | 'needs_fix' | 'pending_review' | 'failed' | 'removed',
      reason: row?.reason ?? null,
      verifiedAt: row?.verifiedAt?.toISOString() ?? null,
      required,
      attemptsLeft: Math.max(0, DAILY_ATTEMPTS - attempts),
      // Only what is not them, for the "Not you - replace" marks.
      media: flagged.map((check) => ({ url: check.mediaUrl, kind: check.kind, status: counted(check) })),
      items,
    };
  }

  /** "Remove my real-person check": the face key and every result go. */
  static async remove(userId: string) {
    await prisma.$transaction([
      prisma.faceKey.deleteMany({ where: { userId } }),
      prisma.faceMediaCheck.deleteMany({ where: { userId } }),
      prisma.faceVerification.upsert({ where: { userId }, create: { userId, status: 'removed' }, update: { status: 'removed', reason: null, verifiedAt: null } }),
      // Removed on purpose: an account that must have it owes it again.
      prisma.user.update({ where: { id: userId }, data: { realPersonVerifiedAt: null, realPersonPassedAt: null } }),
    ]);
    const cases = await prisma.faceReviewCase.findMany({ where: { userId, status: 'pending' }, select: { id: true, snapshotKeys: true } });
    await deleteSnapshots(cases.flatMap((item) => item.snapshotKeys));
    await prisma.faceReviewCase.updateMany({ where: { userId, status: 'pending' }, data: { status: 'withdrawn', snapshotKeys: [] } });
    announceVerification(userId);
  }

  // -------------------------------------------------------------------------
  // Admin review (PHOTO_VERIFICATION_PLAN.md 12)
  // -------------------------------------------------------------------------
  static async pendingReviews() {
    const cases = await prisma.faceReviewCase.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, take: 50 });
    const bucket = privateMediaBucket();
    const people = await prisma.user.findMany({ where: { id: { in: cases.map((item) => item.userId) } }, select: { id: true, name: true, accountStatus: true } });
    return Promise.all(cases.map(async (item) => ({
      id: item.id,
      userId: item.userId,
      user: people.find((person) => person.id === item.userId) ?? null,
      reason: item.reason,
      createdAt: item.createdAt,
      details: item.details,
      snapshots: bucket
        ? await Promise.all(item.snapshotKeys.map((Key) => getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key }), { expiresIn: 300 })))
        : [],
      photos: (await prisma.profilePhoto.findMany({ where: { userId: item.userId }, orderBy: { order: 'asc' }, select: { photoUrl: true } })).map((photo) => photo.photoUrl),
    })));
  }

  /** approve: verified · reject: not verified, with a note they see · retake: asked for a new selfie. */
  static async decide(adminId: string, caseId: string, decision: 'approve' | 'reject' | 'retake', note?: string) {
    const item = await prisma.faceReviewCase.findUnique({ where: { id: caseId } });
    if (!item || item.status !== 'pending') throw new HttpError(404, 'Review case is unavailable', 'FACE_REVIEW_UNAVAILABLE');
    await deleteSnapshots(item.snapshotKeys);
    await prisma.faceReviewCase.update({
      where: { id: caseId },
      data: { status: decision, decidedBy: adminId, decidedAt: new Date(), note: note?.slice(0, 300) ?? null, snapshotKeys: [] },
    });
    if (decision === 'approve') await this.setStatus(item.userId, 'verified', null);
    else {
      if (decision === 'reject') {
        await prisma.faceKey.deleteMany({ where: { userId: item.userId } });
        await prisma.user.update({ where: { id: item.userId }, data: { realPersonPassedAt: null } });
      }
      await this.setStatus(item.userId, 'failed', decision === 'reject' ? (note?.slice(0, 60) || 'rejected') : 'retake');
    }
    const title = decision === 'approve' ? 'Selfie check complete' : decision === 'retake' ? 'Please take a new selfie' : "We couldn't verify you";
    const body = decision === 'approve' ? 'Your profile photos match your selfie.' : note || 'Make sure your main photo shows your face, then try again.';
    // N19 (NOTIFICATIONS_PLAN.md 3d): the team's answer, in the app and on the phone.
    const notification = await prisma.notification.create({ data: { userId: item.userId, type: 'system', title, body } }).catch(() => null);
    void PushService.send(item.userId, {
      title, body, category: 'verify_reminders', kind: decision === 'approve' ? 'real_person_verified' : 'real_person_review', notificationId: notification?.id,
      data: { url: decision === 'approve' ? 'iemdating://main/Profile' : 'iemdating://verify/real-person' },
    }).catch(() => undefined);
    return { status: decision };
  }

  /** Hourly: review cases older than 7 days lose their snapshots (PHOTO_VERIFICATION_PLAN.md 10). */
  static async purgeOldReviews(now = new Date()) {
    const old = await prisma.faceReviewCase.findMany({
      where: { status: 'pending', createdAt: { lt: new Date(now.getTime() - REVIEW_KEEP_MS) } },
      select: { id: true, userId: true, snapshotKeys: true },
    });
    for (const item of old) {
      await deleteSnapshots(item.snapshotKeys);
      await prisma.faceReviewCase.update({ where: { id: item.id }, data: { status: 'expired', snapshotKeys: [] } });
      await prisma.faceVerification.updateMany({ where: { userId: item.userId, status: 'pending_review' }, data: { status: 'failed', reason: 'review_expired' } });
    }
    return old.length;
  }
}
