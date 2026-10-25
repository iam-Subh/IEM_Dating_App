/**
 * Integration tests for profile media renditions and upload validation.
 *
 * Uses the configured database and public media bucket, without truncating
 * anything: it creates one user under a random id and removes exactly that
 * user's rows and objects afterwards.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import {
  DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand,
} from '@aws-sdk/client-s3';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { s3Client } from '../src/middlewares/upload.middleware';
import { UploadController } from '../src/controllers/upload.controller';
import { ProfileService } from '../src/services/profile.service';
import { VideoPreviewService } from '../src/services/videoPreview.service';
import { s3ObjectUrl } from '../src/services/profile-media-processing.service';

const run = promisify(execFile);
const me = randomUUID();
const bucket = process.env.AWS_S3_BUCKET_NAME!;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iem-profile-media-'));

const ID_COLUMNS = ['id', 'user_id', 'owner_id', 'actor_id', 'aggregate_id', 'audience_user_id', 'scope_id', 'entity_id'];

function response() {
  const result = { statusCode: 0, body: undefined as any };
  const res = {
    status(code: number) { result.statusCode = code; return res; },
    json(body: unknown) { result.body = body; return res; },
  };
  return { res: res as any, result };
}

async function complete(assetId: string) {
  const { res, result } = response();
  await UploadController.completePresignedUpload({ user: { sub: me }, params: { assetId } } as any, res);
  return result;
}

async function uploadTicket(purpose: 'photo' | 'video', ext: string, contentType: string, body: Buffer) {
  const objectKey = `profiles/${me}/${purpose === 'video' ? 'videos' : 'photos'}/${randomUUID()}.${ext}`;
  const asset = await prisma.profileMediaAsset.create({
    data: {
      ownerId: me, objectKey, purpose, contentType,
      maxBytes: purpose === 'video' ? 100 * 1024 * 1024 : 15 * 1024 * 1024,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body, ContentType: contentType }));
  return asset;
}

async function download(key: string) {
  const object = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await object.Body!.transformToByteArray());
}

before(async () => {
  await prisma.user.create({
    data: {
      id: me,
      email: `${me}@profile-media.example.test`,
      name: 'Media Test',
      passwordHash: 'TEST_ONLY',
      accountStatus: 'active',
      birthday: new Date('2003-01-01'),
    },
  });
});

after(async () => {
  const listed = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `profiles/${me}/` }));
  const keys = (listed.Contents ?? []).map((item) => ({ Key: item.Key! }));
  if (keys.length) await s3Client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(${ID_COLUMNS})`;
  for (let pass = 0; pass < 6; pass++) {
    let failures = 0;
    for (const { table_name, column_name } of columns) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "${column_name}" = $1::uuid`, me);
      } catch {
        failures += 1;
      }
    }
    if (!failures) break;
  }
  fs.rmSync(workDir, { recursive: true, force: true });
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('a profile photo loses its location metadata and gains card and thumbnail renditions that the profile keeps', async () => {
  const photo = await sharp({ create: { width: 1600, height: 2400, channels: 3, background: '#c86464' } })
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '22/1 34/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '88/1 22/1 0/1' } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(photo).metadata()).exif, 'fixture carries EXIF');

  const asset = await uploadTicket('photo', 'jpg', 'image/jpeg', photo);
  const result = await complete(asset.id);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));

  const stored = await prisma.profileMediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
  assert.equal(stored.status, 'uploaded');
  assert.ok(stored.cardObjectKey?.endsWith('.card.jpg'));
  assert.ok(stored.thumbObjectKey?.endsWith('.thumb.jpg'));

  const original = await sharp(await download(asset.objectKey)).metadata();
  assert.equal(original.exif, undefined, 'the public original no longer carries EXIF');
  const card = await sharp(await download(stored.cardObjectKey!)).metadata();
  assert.equal(card.width, 1080);
  assert.equal(card.exif, undefined);
  const thumb = await sharp(await download(stored.thumbObjectKey!)).metadata();
  assert.ok(Math.max(thumb.width!, thumb.height!) <= 360);

  await ProfileService.updateProfile(me, { photos: [s3ObjectUrl(asset.objectKey)] });
  const saved = await prisma.profilePhoto.findFirstOrThrow({ where: { userId: me } });
  assert.equal(saved.cardUrl, s3ObjectUrl(stored.cardObjectKey!));
  assert.equal(saved.thumbUrl, s3ObjectUrl(stored.thumbObjectKey!));

  // Saving the profile again, without a new upload, keeps the renditions.
  await ProfileService.updateProfile(me, { photos: [s3ObjectUrl(asset.objectKey)] });
  const resaved = await prisma.profilePhoto.findFirstOrThrow({ where: { userId: me } });
  assert.equal(resaved.cardUrl, saved.cardUrl);
});

test('bytes that are not the declared image are rejected and removed from the public bucket', async () => {
  const asset = await uploadTicket('photo', 'jpg', 'image/jpeg', Buffer.from('<html><script>alert(1)</script></html>'));
  const result = await complete(asset.id);
  assert.equal(result.statusCode, 400);
  const stored = await prisma.profileMediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
  assert.equal(stored.status, 'rejected');
  await assert.rejects(
    s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.objectKey })),
    'the rejected object is deleted',
  );
});

test('a profile video gets a poster and an H.264 playback file whose index comes first', async () => {
  const input = path.join(workDir, 'profile.mp4');
  await run(ffmpegStatic as unknown as string, [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input,
  ]);
  const asset = await uploadTicket('video', 'mp4', 'video/mp4', fs.readFileSync(input));
  const result = await complete(asset.id);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));

  await prisma.profileMediaAsset.update({
    where: { id: asset.id },
    data: { status: 'attached', attachedAt: new Date(), processingStatus: 'pending' },
  });
  await prisma.user.update({ where: { id: me }, data: { profileVideoUrl: s3ObjectUrl(asset.objectKey) } });
  await VideoPreviewService.generatePreview(asset.id);

  const processed = await prisma.profileMediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
  assert.equal(processed.processingStatus, 'completed');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me } });
  assert.equal(user.videoPlaybackUrl, s3ObjectUrl(processed.playbackObjectKey!));
  assert.equal(user.videoPosterUrl, s3ObjectUrl(processed.posterObjectKey!));

  const playback = await download(processed.playbackObjectKey!);
  const moov = playback.indexOf('moov');
  const mdat = playback.indexOf('mdat');
  assert.ok(moov >= 0 && mdat >= 0 && moov < mdat, 'the playback index precedes the media data');
  const poster = await sharp(await download(processed.posterObjectKey!)).metadata();
  assert.equal(poster.width, 720);
});

test('a file that is not a video is rejected at completion', async () => {
  const asset = await uploadTicket('video', 'mp4', 'video/mp4', Buffer.from('definitely not a video'.repeat(10)));
  const result = await complete(asset.id);
  assert.equal(result.statusCode, 400);
  assert.equal((await prisma.profileMediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, 'rejected');
});
