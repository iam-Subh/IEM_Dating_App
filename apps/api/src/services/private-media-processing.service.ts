import { CopyObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFile } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { Worker } from 'worker_threads';
import sharp from 'sharp';
import { s3Client } from '../middlewares/upload.middleware';

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

const documentExtensions: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z',
};

function run(command: ffmpeg.FfmpegCommand) {
  return new Promise<void>((resolve, reject) => command.on('end', () => resolve()).on('error', reject).run());
}

/**
 * A media file's duration from ffmpeg's own report. ffmpeg-static ships no
 * ffprobe, and `ffmpeg -i` with no output prints the container duration before
 * exiting with an error, which is expected here.
 */
function probeDurationMs(input: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(ffmpegStatic as unknown as string, ['-hide_banner', '-i', input], { timeout: 30_000 }, (_error, _stdout, stderr) => {
      const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(String(stderr));
      resolve(match ? Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000) : null);
    });
  });
}

/** A video longer than a Story allows. */
export class VideoTooLongError extends Error {}

function waveform(buffer: Buffer, bins = 64) {
  const marker = buffer.indexOf(Buffer.from('data'));
  if (marker < 0) return [];
  const start = marker + 8;
  const count = Math.floor((buffer.length - start) / 2);
  const size = Math.max(1, Math.floor(count / bins));
  return Array.from({ length: bins }, (_, bin) => {
    let peak = 0;
    for (let sample = bin * size; sample < Math.min(count, (bin + 1) * size); sample++) peak = Math.max(peak, Math.abs(buffer.readInt16LE(start + sample * 2)));
    return Number((peak / 32768).toFixed(3));
  });
}

type DecodedHeic = { data: Buffer; width: number; height: number };

/** HEIC decoding is CPU-heavy. Run the WASM decoder outside the API event loop. */
function decodeHeic(input: string): Promise<DecodedHeic> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const fs = require('node:fs');
      const decode = require('heic-decode');
      (async () => {
        try {
          const decoded = await decode({ buffer: fs.readFileSync(workerData.input) });
          if (!decoded.width || !decoded.height || decoded.width * decoded.height > 40000000) {
            throw new Error('HEIC dimensions exceed the processing limit');
          }
          const source = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
          const data = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
          parentPort.postMessage({ data, width: decoded.width, height: decoded.height }, [data]);
        } catch (error) {
          parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
        }
      })();
    `, {
      eval: true,
      workerData: { input },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new Error('HEIC decoding timed out'));
    }, 30_000);
    worker.once('message', (message: { data?: ArrayBuffer; width?: number; height?: number; error?: string }) => {
      settled = true;
      clearTimeout(timeout);
      if (message.error || !message.data || !message.width || !message.height) {
        reject(new Error(message.error ?? 'HEIC decoder returned invalid data'));
        return;
      }
      resolve({ data: Buffer.from(message.data), width: message.width, height: message.height });
    });
    worker.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`HEIC decoder stopped with code ${code}`));
    });
  });
}

export class PrivateMediaProcessingService {
  static async process(bucket: string, sourceKey: string, prefix: string, assetId: string, sourceType: string, options: { coverTimeMs?: number; maxDurationMs?: number } = {}) {
    const base = path.join(os.tmpdir(), `iem_private_${assetId}`);
    const input = `${base}.input`;
    const extension = documentExtensions[sourceType]
      ?? (sourceType.startsWith('video/')
        ? 'mp4'
        : sourceType.startsWith('audio/')
          ? 'm4a'
          : sourceType === 'image/png'
            ? 'png'
            : sourceType === 'image/webp'
              ? 'webp'
              : sourceType === 'image/avif'
                ? 'avif'
                : sourceType === 'image/heic'
                  ? 'heic'
                  : sourceType === 'image/heif'
                    ? 'heif'
                    : sourceType === 'image/gif'
                      ? 'gif'
                      : 'jpg');
    const contentType = documentExtensions[sourceType]
      ? sourceType
      : sourceType.startsWith('video/')
      ? sourceType
      : sourceType.startsWith('audio/')
        ? 'audio/mp4'
        : extension === 'jpg'
          ? 'image/jpeg'
          : `image/${extension}`;
    const output = `${base}.${extension}`;
    const thumbnail = `${base}.thumbnail.jpg`;
    const wave = `${base}.waveform.wav`;
    const objectKey = `${prefix}/${assetId}.${extension}`;
    const thumbnailObjectKey = `${prefix}/${assetId}.thumbnail.jpg`;
    try {
      const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: sourceKey }));
      if (!object.Body) throw new Error('Private media object has no content');
      await pipeline(object.Body as Readable, fs.createWriteStream(input));
      let samples: number[] | undefined;
      let hasThumbnail = false;
      let durationMs: number | null = null;
      if (sourceType.startsWith('image/')) {
        const heic = ['image/heic', 'image/heif'].includes(sourceType)
          ? await decodeHeic(input)
          : null;
        const createImagePipeline = (animated = false) => heic
          ? sharp(heic.data, { raw: { width: heic.width, height: heic.height, channels: 4 } })
          : sharp(input, {
            animated: sourceType === 'image/gif' && animated,
            limitInputPixels: 40_000_000,
          });
        // Keep the original object bytes. Only the compact preview is encoded.
        await createImagePipeline()
          .rotate()
          .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(thumbnail);
        hasThumbnail = true;
      } else if (sourceType.startsWith('video/')) {
        durationMs = await probeDurationMs(input);
        // Half a second of slack for container rounding between the device's
        // encoder and ffmpeg's reading of it.
        if (options.maxDurationMs && (durationMs === null || durationMs > options.maxDurationMs + 500)) {
          throw new VideoTooLongError(`Video is ${durationMs ?? 'of unknown'} ms; the limit is ${options.maxDurationMs} ms`);
        }
        // Do not transcode or shorten video. Extract one preview frame only:
        // the cover the sender picked, or the first frame when they did not.
        // It is the poster every chat bubble shows, so it is sized for a bubble
        // on a 1080p screen rather than for a list thumbnail.
        const extract = (seconds: number) => run(ffmpeg(input).setStartTime(seconds).frames(1).size('720x?').outputOptions(['-map_metadata -1']).output(thumbnail));
        const coverSeconds = Math.max(0, (options.coverTimeMs ?? 0) / 1000);
        const produced = async () => (await fs.promises.stat(thumbnail).catch(() => null))?.size ?? 0;
        try {
          await extract(coverSeconds);
          if (!(await produced())) throw new Error('No frame at the requested cover time');
        } catch (error) {
          // A cover past the real end of the stream (a rounding difference
          // between the device's duration and ffmpeg's) must not reject the
          // video. Fall back to the first frame instead.
          if (coverSeconds === 0) throw error;
          await fs.promises.rm(thumbnail, { force: true });
          await extract(0);
        }
        hasThumbnail = true;
      } else if (sourceType.startsWith('audio/')) {
        await run(ffmpeg(input).setDuration(60).noVideo().audioCodec('aac').audioBitrate('96k').outputOptions(['-map_metadata -1']).output(output));
        await run(ffmpeg(input).setDuration(60).audioChannels(1).audioFrequency(8000).format('wav').output(wave));
        samples = waveform(await fs.promises.readFile(wave));
      }
      const preservesOriginal = sourceType.startsWith('image/') || sourceType.startsWith('video/') || Boolean(documentExtensions[sourceType]);
      if (preservesOriginal) {
        await s3Client.send(new CopyObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          CopySource: `${bucket}/${sourceKey}`,
          ContentType: contentType,
          MetadataDirective: 'REPLACE',
        }));
      } else {
        await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: fs.createReadStream(output), ContentType: contentType }));
      }
      if (hasThumbnail) await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: thumbnailObjectKey, Body: fs.createReadStream(thumbnail), ContentType: 'image/jpeg' }));
      return { objectKey, contentType, thumbnailObjectKey: hasThumbnail ? thumbnailObjectKey : null, waveform: samples, durationMs };
    } finally {
      await Promise.all([input, output, thumbnail, wave].map((file) => fs.promises.rm(file, { force: true }))).catch(() => undefined);
    }
  }
}
