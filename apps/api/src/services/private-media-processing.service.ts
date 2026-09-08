import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { s3Client } from '../middlewares/upload.middleware';

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

function run(command: ffmpeg.FfmpegCommand) {
  return new Promise<void>((resolve, reject) => command.on('end', () => resolve()).on('error', reject).run());
}

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

export class PrivateMediaProcessingService {
  static async process(bucket: string, sourceKey: string, prefix: string, assetId: string, sourceType: string) {
    const base = path.join(os.tmpdir(), `iem_private_${assetId}`);
    const input = `${base}.input`;
    const extension = sourceType.startsWith('video/') ? 'mp4' : sourceType.startsWith('audio/') ? 'm4a' : sourceType === 'image/png' ? 'png' : sourceType === 'image/webp' ? 'webp' : 'jpg';
    const contentType = sourceType.startsWith('video/') ? 'video/mp4' : sourceType.startsWith('audio/') ? 'audio/mp4' : sourceType;
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
      if (sourceType.startsWith('image/')) {
        await run(ffmpeg(input).frames(1).videoFilters("scale='min(1920,iw)':-2").outputOptions(['-map_metadata -1']).output(output));
        await run(ffmpeg(output).frames(1).size('480x?').outputOptions(['-map_metadata -1']).output(thumbnail));
        hasThumbnail = true;
      } else if (sourceType.startsWith('video/')) {
        await run(ffmpeg(input).setDuration(15).videoCodec('libx264').audioCodec('aac').videoFilters("scale='min(1080,iw)':-2").outputOptions(['-preset veryfast', '-movflags +faststart', '-pix_fmt yuv420p', '-map_metadata -1']).output(output));
        await run(ffmpeg(output).setStartTime(0).frames(1).size('480x?').outputOptions(['-map_metadata -1']).output(thumbnail));
        hasThumbnail = true;
      } else {
        await run(ffmpeg(input).setDuration(60).noVideo().audioCodec('aac').audioBitrate('96k').outputOptions(['-map_metadata -1']).output(output));
        await run(ffmpeg(input).setDuration(60).audioChannels(1).audioFrequency(8000).format('wav').output(wave));
        samples = waveform(await fs.promises.readFile(wave));
      }
      await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: fs.createReadStream(output), ContentType: contentType }));
      if (hasThumbnail) await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: thumbnailObjectKey, Body: fs.createReadStream(thumbnail), ContentType: 'image/jpeg' }));
      return { objectKey, contentType, thumbnailObjectKey: hasThumbnail ? thumbnailObjectKey : null, waveform: samples };
    } finally {
      await Promise.all([input, output, thumbnail, wave].map((file) => fs.promises.rm(file, { force: true }))).catch(() => undefined);
    }
  }
}
