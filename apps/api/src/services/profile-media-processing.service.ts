import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { s3Client } from '../middlewares/upload.middleware';
import { publicMediaBucket, publicObjectUrl } from '../config/storage';
import { detectPrivateMediaType } from './private-media-inspection.service';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Sizes follow what the app draws. A card is at most a phone's width at 3x
 * density; a thumbnail covers avatars and lists. Originals are capped rather
 * than kept at camera resolution, since nothing shows more than this.
 */
export const PROFILE_MEDIA_SIZES = {
  originalEdge: 2560,
  cardWidth: 1080,
  cardHeight: 1920,
  thumbEdge: 360,
  videoWidth: 720,
  posterWidth: 720,
} as const;

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMMUTABLE = 'public, max-age=31536000, immutable';
const MAX_INPUT_PIXELS = 80_000_000;

function bucketName(): string {
  const bucket = publicMediaBucket();
  if (!bucket) throw new Error('The public media bucket is not configured');
  return bucket;
}

/** The stored (pre-CDN) URL of a public profile object, like `photoUrl` values. */
export function s3ObjectUrl(key: string): string {
  return publicObjectUrl(key);
}

/** The object key behind a stored or CDN profile media URL. */
export function objectKeyFromUrl(value: string): string | null {
  try {
    return decodeURIComponent(new URL(value).pathname).replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

/** Renditions sit beside their original: `photos/<id>.jpg` -> `photos/<id>.card.jpg`. */
export function renditionKey(objectKey: string, suffix: string): string {
  return `${objectKey.replace(/\.[^./]+$/, '')}${suffix}`;
}

function run(command: ffmpeg.FfmpegCommand) {
  return new Promise<void>((resolve, reject) => command.on('end', () => resolve()).on('error', reject).run());
}

async function put(key: string, body: Buffer | fs.ReadStream, contentType: string, cacheControl?: string) {
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName(),
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(cacheControl ? { CacheControl: cacheControl } : {}),
  }));
}

export class ProfileMediaProcessingService {
  /**
   * Validates an uploaded profile photo and writes its renditions.
   *
   * The bytes must really be the image type the upload declared, and must
   * decode. The original is re-encoded in place with rotation applied and all
   * metadata dropped, because profile photos are public and a phone photo can
   * carry the GPS position it was taken at. `rewriteOriginal: false` leaves
   * the original untouched, for backfilling photos uploaded before this.
   */
  static async processPhoto(
    objectKey: string,
    options: { contentType?: string; maxBytes?: number; rewriteOriginal?: boolean } = {},
  ) {
    const bucket = bucketName();
    const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    const bytes = Buffer.from(await object.Body!.transformToByteArray());
    if (options.maxBytes && bytes.length > options.maxBytes) {
      throw new HttpError(400, 'The photo is larger than allowed', 'MEDIA_UPLOAD_INVALID');
    }
    const detected = detectPrivateMediaType(bytes.subarray(0, 64));
    if (!detected || !PHOTO_TYPES.has(detected) || (options.contentType && detected !== options.contentType)) {
      throw new HttpError(400, 'The file is not the photo it was uploaded as', 'MEDIA_UPLOAD_INVALID');
    }
    try {
      const metadata = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      if (!metadata.width || !metadata.height) throw new Error('No dimensions');
    } catch {
      throw new HttpError(400, 'The photo could not be read', 'MEDIA_UPLOAD_INVALID');
    }

    // sharp drops EXIF, XMP and ICC-embedded metadata unless told to keep it.
    const image = () => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    const card = await image()
      .resize({ width: PROFILE_MEDIA_SIZES.cardWidth, height: PROFILE_MEDIA_SIZES.cardHeight, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const thumb = await image()
      .resize({ width: PROFILE_MEDIA_SIZES.thumbEdge, height: PROFILE_MEDIA_SIZES.thumbEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
    const cardObjectKey = renditionKey(objectKey, '.card.jpg');
    const thumbObjectKey = renditionKey(objectKey, '.thumb.jpg');
    const writes = [put(cardObjectKey, card, 'image/jpeg', IMMUTABLE), put(thumbObjectKey, thumb, 'image/jpeg', IMMUTABLE)];

    if (options.rewriteOriginal !== false) {
      const capped = image().resize({
        width: PROFILE_MEDIA_SIZES.originalEdge,
        height: PROFILE_MEDIA_SIZES.originalEdge,
        fit: 'inside',
        withoutEnlargement: true,
      });
      const original = detected === 'image/png'
        ? await capped.png({ compressionLevel: 9 }).toBuffer()
        : detected === 'image/webp'
          ? await capped.webp({ quality: 90 }).toBuffer()
          : await capped.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      writes.push(put(objectKey, original, detected));
    }
    await Promise.all(writes);
    return { cardObjectKey, thumbObjectKey };
  }

  /**
   * Writes a profile video's poster frame and playback rendition.
   *
   * The playback file is H.264/AAC at most 720 pixels wide with its index at the
   * front, so any Android phone can decode it and playback starts after the
   * first bytes instead of after a seek to the end of the file. The upload
   * itself may be HEVC, 4K or a QuickTime file with a trailing index.
   */
  static async processVideo(objectKey: string) {
    const bucket = bucketName();
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const input = path.join(os.tmpdir(), `profile_video_${id}.input`);
    const poster = path.join(os.tmpdir(), `profile_video_${id}.poster.jpg`);
    const playback = path.join(os.tmpdir(), `profile_video_${id}.playback.mp4`);
    try {
      const head = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey, Range: 'bytes=0-63' }));
      const detected = detectPrivateMediaType(await head.Body!.transformToByteArray());
      if (!detected?.startsWith('video/')) {
        throw new HttpError(400, 'The file is not a video', 'MEDIA_UPLOAD_INVALID');
      }
      const source = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
      await pipeline(source.Body as Readable, fs.createWriteStream(input));

      const extractPoster = (seconds: number) => run(
        ffmpeg(input)
          .setStartTime(seconds)
          .frames(1)
          .videoFilters(`scale='min(${PROFILE_MEDIA_SIZES.posterWidth},iw)':-2`)
          .outputOptions(['-map_metadata -1'])
          .output(poster),
      );
      // Half a second in skips the black frame many recordings open with.
      try {
        await extractPoster(0.5);
        if (!(await fs.promises.stat(poster).catch(() => null))?.size) throw new Error('No frame at 0.5s');
      } catch {
        await fs.promises.rm(poster, { force: true });
        await extractPoster(0);
      }

      // Some devices (notably Android emulators, whose virtual microphone can
      // write a malformed AAC track) hand ffmpeg an audio stream it cannot
      // decode, even though the video itself is fine. Rather than lose the
      // whole preview to that, the transcode is retried once with the audio
      // dropped so a usable video still comes out the other side.
      const transcode = (withAudio: boolean) => {
        const command = ffmpeg(input)
          .videoCodec('libx264')
          .videoFilters(`scale='min(${PROFILE_MEDIA_SIZES.videoWidth},iw)':-2`)
          .outputOptions([
            '-preset veryfast',
            '-crf 23',
            '-maxrate 2500k',
            '-bufsize 5000k',
            '-profile:v high',
            '-pix_fmt yuv420p',
            '-movflags +faststart',
            '-map_metadata -1',
          ]);
        if (withAudio) command.audioCodec('aac').audioBitrate('128k');
        else command.noAudio();
        return command.output(playback);
      };
      try {
        await run(transcode(true));
      } catch (error) {
        logger.warn('Video transcode failed with audio, retrying without it', { objectKey, error: (error as Error)?.message });
        await fs.promises.rm(playback, { force: true }).catch(() => undefined);
        await run(transcode(false));
      }

      const posterObjectKey = renditionKey(objectKey, '.poster.jpg');
      const playbackObjectKey = renditionKey(objectKey, '.playback.mp4');
      await Promise.all([
        put(posterObjectKey, fs.readFileSync(poster), 'image/jpeg', IMMUTABLE),
        put(playbackObjectKey, fs.createReadStream(playback), 'video/mp4', IMMUTABLE),
      ]);
      return { posterObjectKey, playbackObjectKey };
    } finally {
      await Promise.all([input, poster, playback].map((file) => fs.promises.rm(file, { force: true }))).catch(() => undefined);
    }
  }
}
