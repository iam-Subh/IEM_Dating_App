/**
 * Integration tests for resumable chat media uploads and video covers.
 *
 * Runs against the configured database and private media bucket. Like the
 * conversation-controls suite it never truncates anything: it creates its own
 * users and match under fresh random ids, and removes exactly those rows and
 * the S3 objects it wrote.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegStatic from 'ffmpeg-static';
import { DeleteObjectCommand, ListPartsCommand } from '@aws-sdk/client-s3';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { s3Client } from '../src/middlewares/upload.middleware';
import { ChatMediaService, MULTIPART_PART_BYTES } from '../src/services/chat-media.service';
import { ChatService } from '../src/services/chat.service';

const run = promisify(execFile);
const me = randomUUID();
const partner = randomUUID();
const outsider = randomUUID();
let matchId = '';
let outsiderMatchId = '';
const writtenKeys = new Set<string>();
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iem-multipart-'));
const bucket = process.env.AWS_PRIVATE_MEDIA_BUCKET!;

const ID_COLUMNS = ['id', 'user_id', 'match_id', 'message_id', 'sender_id', 'recipient_id', 'actor_id',
  'audience_user_id', 'aggregate_id', 'owner_id', 'user1_id', 'user2_id', 'scope_id', 'entity_id', 'outbox_event_id'];

function user(id: string) {
  return {
    id,
    email: `${id}@media-multipart.example.test`,
    name: `Media ${id.slice(0, 6)}`,
    passwordHash: 'TEST_ONLY',
    accountStatus: 'active',
    birthday: new Date('2003-01-01'),
  };
}

/** Incompressible video at a fixed bitrate, so its size is predictable. */
async function makeVideo(name: string, seconds: number, bitrate: string) {
  const output = path.join(workDir, name);
  await run(ffmpegStatic as unknown as string, [
    '-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30,noise=alls=100:allf=t+u`,
    '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-b:v', bitrate, '-minrate', bitrate, '-maxrate', bitrate, '-bufsize', bitrate, '-movflags', '+faststart', output,
  ]);
  return fs.readFileSync(output);
}

async function putPart(url: string, body: Buffer) {
  const response = await fetch(url, { method: 'PUT', body });
  assert.equal(response.status, 200, `part upload failed: ${await response.text()}`);
}

async function removeTestRows() {
  const userIds = [me, partner, outsider];
  const matchIds = [matchId, outsiderMatchId].filter(Boolean);
  const messageIds = (await prisma.message.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } })).map((item) => item.id);
  const eventIds = (await prisma.chatEvent.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } })).map((item) => item.id);
  const seed = [...userIds, ...matchIds, ...messageIds, ...eventIds];
  const outboxIds = (await prisma.outboxEvent.findMany({ where: { aggregateId: { in: seed } }, select: { id: true } })).map((item) => item.id);
  const ids = [...new Set([...seed, ...outboxIds])];
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(${ID_COLUMNS})`;
  for (let pass = 0; pass < 6; pass++) {
    let failures = 0;
    for (const { table_name, column_name } of columns) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1::uuid[])`, ids);
      } catch {
        failures += 1;
      }
    }
    if (!failures) return;
  }
  throw new Error('Test rows could not be removed');
}

before(async () => {
  await prisma.user.createMany({ data: [me, partner, outsider].map(user) });
  // Verified students: photos and videos wait for verification (GOOGLE_SIGNUP_PLAN.md 2.2).
  const institution = await prisma.institution.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  await prisma.studentMembership.createMany({
    data: [me, partner, outsider].map((id) => ({
      userId: id, institutionId: institution.id, institutionalEmail: `${id}@multipart.example.test`, status: 'verified', verifiedAt: new Date(),
    })),
  });
  matchId = (await prisma.match.create({ data: { user1Id: me, user2Id: partner, status: 'active' } })).id;
  outsiderMatchId = (await prisma.match.create({ data: { user1Id: outsider, user2Id: partner, status: 'active' } })).id;
});

after(async () => {
  const assets = await prisma.chatMediaAsset.findMany({
    where: { ownerId: { in: [me, partner, outsider] } },
    select: { objectKey: true, thumbnailObjectKey: true },
  });
  for (const asset of assets) {
    writtenKeys.add(asset.objectKey);
    if (asset.thumbnailObjectKey) writtenKeys.add(asset.thumbnailObjectKey);
  }
  await Promise.all([...writtenKeys].map((Key) => s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key })).catch(() => undefined)));
  await removeTestRows();
  fs.rmSync(workDir, { recursive: true, force: true });
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('a resumable upload refuses files over the type limit', async () => {
  await assert.rejects(
    ChatMediaService.createMultipartUpload(me, matchId, 'mp4', 600 * 1024 * 1024),
    (error: any) => error.code === 'MEDIA_TOO_LARGE',
  );
  await assert.rejects(
    ChatMediaService.createMultipartUpload(me, matchId, 'exe', 1024),
    (error: any) => error.code === 'UNSUPPORTED_MEDIA_TYPE',
  );
});

test('parts upload in any order, completion waits for all of them, and the chosen cover becomes a readable poster', async () => {
  const video = await makeVideo('large.mp4', 4, '24M');
  assert.ok(video.length > MULTIPART_PART_BYTES, `fixture is ${video.length} bytes; it must span two parts`);

  const ticket = await ChatMediaService.createMultipartUpload(me, matchId, 'mp4', video.length);
  writtenKeys.add(ticket.mediaKey);
  assert.equal(ticket.partCount, Math.ceil(video.length / ticket.partSize));
  assert.equal(ticket.parts.length, ticket.partCount);
  assert.ok(new Date(ticket.expiresAt).getTime() > Date.now() + 23 * 60 * 60 * 1000, 'part URLs outlive a long background upload');

  const slice = (partNumber: number) => video.subarray((partNumber - 1) * ticket.partSize, partNumber * ticket.partSize);
  const [first, ...rest] = ticket.parts;
  for (const part of rest.reverse()) await putPart(part.url, slice(part.partNumber));

  await assert.rejects(
    ChatMediaService.completeUpload(me, matchId, ticket.assetId, { coverTimeMs: 2000 }),
    (error: any) => error.code === 'MEDIA_UPLOAD_INCOMPLETE',
  );
  const reopened = await prisma.chatMediaAsset.findUniqueOrThrow({ where: { id: ticket.assetId } });
  assert.equal(reopened.status, 'requested', 'an incomplete upload can be finished and completed again');

  await putPart(first.url, slice(first.partNumber));
  const completed = await ChatMediaService.completeUpload(me, matchId, ticket.assetId, { coverTimeMs: 2000 });
  assert.match(completed.mediaKey, /^chat-media-approved\/.+\.mp4$/);
  assert.equal(completed.thumbnailObjectKey, completed.mediaKey.replace(/\.mp4$/, '.thumbnail.jpg'));

  const stored = await prisma.chatMediaAsset.findUniqueOrThrow({ where: { id: ticket.assetId } });
  assert.equal(stored.status, 'uploaded');
  assert.equal(stored.uploadId, null);

  // Completing again is idempotent and returns the same media.
  const again = await ChatMediaService.completeUpload(me, matchId, ticket.assetId);
  assert.equal(again.mediaKey, completed.mediaKey);

  await ChatService.sendMessage(me, matchId, '', undefined, [completed.mediaKey], randomUUID(), { type: 'media' });

  const posterUrl = await ChatMediaService.generateReadUrl(partner, completed.thumbnailObjectKey!);
  const poster = await fetch(posterUrl);
  assert.equal(poster.status, 200);
  assert.equal(poster.headers.get('content-type'), 'image/jpeg');
  const posterBytes = Buffer.from(await poster.arrayBuffer());
  assert.ok(posterBytes.length > 1000, 'poster has real image data');

  await assert.rejects(
    ChatMediaService.generateReadUrl(outsider, completed.thumbnailObjectKey!),
    'someone outside the chat cannot read the poster',
  );
  await assert.rejects(
    ChatMediaService.generateReadUrl(partner, completed.mediaKey.replace(/\.mp4$/, '.other.jpg')),
    'only the poster key shape is accepted',
  );
});

test('a cover past the end of the video falls back to the first frame instead of rejecting the upload', async () => {
  const video = await makeVideo('short.mp4', 1, '400k');
  const ticket = await ChatMediaService.generateUploadUrl(me, matchId, 'mp4');
  writtenKeys.add(ticket.mediaKey);
  const response = await fetch(ticket.uploadUrl, { method: 'PUT', body: video, headers: { 'Content-Type': ticket.contentType } });
  assert.equal(response.status, 200);
  const completed = await ChatMediaService.completeUpload(me, matchId, ticket.assetId, { coverTimeMs: 60 * 60 * 1000 });
  assert.ok(completed.thumbnailObjectKey);
});

test('an abandoned upload can be aborted by its owner, and an expired one is swept', async () => {
  const aborted = await ChatMediaService.createMultipartUpload(me, matchId, 'mp4', 20 * 1024 * 1024);
  assert.deepEqual(await ChatMediaService.abortMultipartUpload(partner, matchId, aborted.assetId), { aborted: false }, 'only the owner can abort');
  assert.deepEqual(await ChatMediaService.abortMultipartUpload(me, matchId, aborted.assetId), { aborted: true });
  const abortedRow = await prisma.chatMediaAsset.findUniqueOrThrow({ where: { id: aborted.assetId } });
  assert.equal(abortedRow.status, 'rejected');
  assert.equal(abortedRow.uploadId, null);

  const expired = await ChatMediaService.createMultipartUpload(me, matchId, 'mp4', 20 * 1024 * 1024);
  const uploadId = (await prisma.chatMediaAsset.findUniqueOrThrow({ where: { id: expired.assetId } })).uploadId!;
  await prisma.chatMediaAsset.update({ where: { id: expired.assetId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.ok(await ChatMediaService.sweepExpiredMultipartUploads() >= 1);
  const expiredRow = await prisma.chatMediaAsset.findUniqueOrThrow({ where: { id: expired.assetId } });
  assert.equal(expiredRow.status, 'expired');
  assert.equal(expiredRow.uploadId, null);
  await assert.rejects(
    s3Client.send(new ListPartsCommand({ Bucket: bucket, Key: expired.mediaKey, UploadId: uploadId })),
    (error: any) => error.name === 'NoSuchUpload',
    'S3 no longer holds the upload',
  );
});
