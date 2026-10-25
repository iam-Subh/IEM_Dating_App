/**
 * Integration tests for background Story posting and interactive stickers.
 *
 * Runs against the configured database and private media bucket. It never
 * truncates anything: it creates its own users under random ids and removes
 * exactly those rows and the S3 objects it wrote.
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
import { DeleteObjectCommand, ListPartsCommand } from '@aws-sdk/client-s3';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { s3Client } from '../src/middlewares/upload.middleware';
import { verifyStoryPublishToken, type StoryPublishClaims } from '../src/utils/storyPublishToken';
import { StoryBatchService } from '../src/services/story-batch.service';
import { StoryStickerService } from '../src/services/story-sticker.service';
import { StoryService } from '../src/services/story.service';

const run = promisify(execFile);
const me = randomUUID();
const friend = randomUUID();
const stranger = randomUUID();
const users = [me, friend, stranger];
const bucket = process.env.AWS_PRIVATE_MEDIA_BUCKET!;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iem-story-batch-'));
const transform = { x: 540, y: 960, scale: 1, rotation: 0 };
const composition = (interactive: unknown[] = []) => ({ version: 1 as const, interactive: interactive as any });

const ID_COLUMNS = ['id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'batch_id', 'sticker_id', 'mentioned_user_id',
  'follower_id', 'followee_id', 'author_id', 'aggregate_id', 'asset_id'];

async function makeVideo(name: string, seconds: number) {
  const output = path.join(workDir, name);
  await run(ffmpegStatic as unknown as string, [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x568:rate=15', '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-b:v', '150k', '-movflags', '+faststart', output,
  ]);
  return fs.readFileSync(output);
}

async function upload(claims: StoryPublishClaims, batchId: string, itemId: string, bytes: Buffer) {
  const item = await StoryBatchService.parts(claims, batchId, itemId, { size: bytes.length });
  for (const part of item.parts) {
    const body = bytes.subarray((part.partNumber - 1) * item.partSize!, part.partNumber * item.partSize!);
    const response = await fetch(part.url, { method: 'PUT', body });
    assert.equal(response.status, 200, `part upload failed: ${await response.text()}`);
  }
}

before(async () => {
  await prisma.user.createMany({
    data: users.map((id, index) => ({
      id, email: `${id}@story-batch.example.test`, name: ['Me', 'Friend', 'Stranger'][index], passwordHash: 'TEST_ONLY',
      accountStatus: 'active', birthday: new Date('2003-01-01'), storiesEnabled: true,
    })),
  });
  // Verified students: before verifying, mentions reach matches only (GOOGLE_SIGNUP_PLAN.md 2.7).
  const institution = await prisma.institution.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  await prisma.studentMembership.createMany({
    data: users.map((id) => ({ userId: id, institutionId: institution.id, institutionalEmail: `${id}@story-batch.example.test`, status: 'verified', verifiedAt: new Date() })),
  });
  await prisma.follow.createMany({
    data: [
      { followerId: friend, followeeId: me, status: 'accepted' },
      { followerId: me, followeeId: friend, status: 'accepted' },
    ],
  });
});

after(async () => {
  const assets = await prisma.storyMediaAsset.findMany({ where: { ownerId: { in: users } } });
  for (const asset of assets) {
    if (asset.uploadId) await s3Client.send(new ListPartsCommand({ Bucket: bucket, Key: asset.objectKey, UploadId: asset.uploadId })).then(
      () => import('../src/services/s3-multipart').then((m) => m.abortUpload(bucket, asset.objectKey, asset.uploadId!)),
      () => undefined,
    ).catch(() => undefined);
    for (const Key of [asset.objectKey, asset.thumbnailObjectKey]) {
      if (Key) await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key })).catch(() => undefined);
    }
  }
  const storyIds = (await prisma.story.findMany({ where: { ownerId: { in: users } }, select: { id: true } })).map((row) => row.id);
  const batchIds = (await prisma.storyBatch.findMany({ where: { ownerId: { in: users } }, select: { id: true } })).map((row) => row.id);
  const stickerIds = (await prisma.storySticker.findMany({ where: { storyId: { in: storyIds } }, select: { id: true } })).map((row) => row.id);
  const ids = [...users, ...storyIds, ...batchIds, ...stickerIds, ...assets.map((asset) => asset.id)];
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
    if (!failures) break;
  }
  fs.rmSync(workDir, { recursive: true, force: true });
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('a batch refuses mentions of strangers and unsafe links before anything uploads', async () => {
  await assert.rejects(
    StoryBatchService.create(me, { batchId: randomUUID(), items: [{ itemId: randomUUID(), kind: 'photo', size: 1000, durationMs: 5000, composition: composition([{ id: 'm', type: 'mention', userId: stranger, name: 'Stranger', transform }]) }] }),
    (error: any) => error.code === 'STORY_MENTION_NOT_ALLOWED',
  );
  await assert.rejects(
    StoryBatchService.create(me, { batchId: randomUUID(), items: [{ itemId: randomUUID(), kind: 'photo', size: 1000, durationMs: 5000, composition: composition([{ id: 'l', type: 'link', url: 'http://10.0.0.1/', transform }]) }] }),
    (error: any) => error.code === 'STORY_LINK_REJECTED',
  );
  await assert.rejects(
    StoryBatchService.create(me, { batchId: randomUUID(), items: [{ itemId: randomUUID(), kind: 'photo', size: 1000, durationMs: 20_000, composition: composition() }] }),
    (error: any) => error.code === 'STORY_DURATION_INVALID',
  );
  assert.equal(await prisma.storyBatch.count({ where: { ownerId: me } }), 0);
});

test('items publish in order, once each, with their stickers, and the batch completes', async () => {
  const photo = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#aa3366' } }).jpeg({ quality: 70 }).toBuffer();
  const video = await makeVideo('clip.mp4', 2);
  const batchId = randomUUID();
  const photoId = randomUUID();
  const videoId = randomUUID();
  const stickers = [
    { id: 'poll', type: 'poll', question: 'Canteen or cafe?', options: ['Canteen', 'Cafe'], transform },
    { id: 'quiz', type: 'quiz', question: 'Fest day?', options: ['Fri', 'Sat'], correctIndex: 1, transform },
    { id: 'ask', type: 'question', prompt: 'Ask me anything', transform },
    { id: 'friend', type: 'mention', userId: friend, name: 'Friend', transform },
    { id: 'site', type: 'link', url: 'https://example.com/fest', transform },
  ];
  const ticket = await StoryBatchService.create(me, {
    batchId,
    items: [
      { itemId: photoId, kind: 'photo', size: photo.length, durationMs: 7000, composition: composition(stickers) },
      { itemId: videoId, kind: 'video', size: video.length, durationMs: 2000, composition: composition() },
    ],
  });
  assert.equal(ticket.status, 'posting');
  assert.equal(ticket.items.length, 2);
  const claims = verifyStoryPublishToken(ticket.publishToken);
  assert.equal(claims.bid, batchId);

  const again = await StoryBatchService.create(me, { batchId, items: [] as any });
  assert.equal(again.items.length, 2, 'creating the same batch again returns it');

  await upload(claims, batchId, videoId, video);
  await assert.rejects(StoryBatchService.publishItem(claims, batchId, videoId), (error: any) => error.code === 'STORY_BATCH_ORDER');
  await assert.rejects(StoryBatchService.publishItem(claims, batchId, photoId), (error: any) => error.code === 'STORY_UPLOAD_INCOMPLETE', 'the upload has not started');
  await assert.rejects(StoryBatchService.parts(claims, batchId, photoId), (error: any) => error.code === 'STORY_UPLOAD_SIZE_REQUIRED');

  const parts = await StoryBatchService.parts(claims, batchId, photoId, { size: photo.length });
  assert.equal(parts.parts.length, 1);
  assert.deepEqual(parts.uploadedPartNumbers, []);
  await assert.rejects(StoryBatchService.publishItem(claims, batchId, photoId), (error: any) => error.code === 'STORY_UPLOAD_INCOMPLETE', 'nothing uploaded yet');
  await upload(claims, batchId, photoId, photo);
  const first = await StoryBatchService.publishItem(claims, batchId, photoId);
  assert.equal(first.repeated, false);
  assert.equal(first.story.durationMs, 7000);
  const repeat = await StoryBatchService.publishItem(claims, batchId, photoId);
  assert.equal(repeat.repeated, true);
  assert.equal(repeat.story.id, first.story.id);

  const second = await StoryBatchService.publishItem(claims, batchId, videoId);
  assert.ok(Math.abs((second.story.durationMs ?? 0) - 2000) < 300, `video duration measured by the server: ${second.story.durationMs}`);
  assert.equal((await StoryBatchService.status(me, batchId)).status, 'completed');
  assert.equal(await prisma.storyMention.count({ where: { storyId: first.story.id, mentionedUserId: friend } }), 1);
  assert.equal(await prisma.outboxEvent.count({ where: { topic: 'story.published', aggregateId: first.story.id } }), 1);

  const tray = await StoryService.tray(friend);
  const mine = tray.groups.find((group) => group.owner.id === me)!;
  assert.deepEqual(mine.stories.map((story) => story.id), [first.story.id, second.story.id], 'in batch order');
  assert.equal((mine.stories[0].composition as any).interactive.length, 5);

  // Stickers, seen by a follower.
  const state = await StoryStickerService.forStory(friend, first.story.id);
  const poll = state.stickers.find((sticker) => sticker.key === 'poll')!;
  const quiz = state.stickers.find((sticker) => sticker.key === 'quiz')!;
  const ask = state.stickers.find((sticker) => sticker.key === 'ask')!;
  const link = state.stickers.find((sticker) => sticker.key === 'site')!;
  assert.equal(poll.results, null, 'results stay hidden until you vote');
  assert.equal((quiz.config as any).correctIndex, undefined, 'the quiz answer is hidden until you answer');

  const voted = await StoryStickerService.respond(friend, first.story.id, poll.id, { option: 1 });
  assert.deepEqual(voted?.results, { counts: [0, 1], total: 1 });
  const unchanged = await StoryStickerService.respond(friend, first.story.id, poll.id, { option: 0 });
  assert.deepEqual(unchanged?.results, { counts: [0, 1], total: 1 }, 'a vote cannot be changed');
  const answered = await StoryStickerService.respond(friend, first.story.id, quiz.id, { option: 0 });
  assert.equal((answered?.results as any).correctIndex, 1);
  await StoryStickerService.respond(friend, first.story.id, ask.id, { text: 'Which fest events?' });
  assert.deepEqual(await StoryStickerService.linkTap(friend, first.story.id, link.id), { url: 'https://example.com/fest' });
  await assert.rejects(StoryStickerService.respond(me, first.story.id, poll.id, { option: 0 }), (error: any) => error.code === 'STICKER_OWNER');
  await assert.rejects(StoryStickerService.forStory(stranger, first.story.id), (error: any) => error.code === 'STORY_UNAVAILABLE');

  const ownerView = await StoryStickerService.forStory(me, first.story.id);
  assert.deepEqual(ownerView.stickers.find((sticker) => sticker.key === 'ask')?.results, { replies: 1 });
  assert.deepEqual(ownerView.stickers.find((sticker) => sticker.key === 'site')?.results, { taps: 1 });
  const replies = await StoryStickerService.results(me, first.story.id, ask.id);
  assert.equal(replies.items[0].person?.id, friend);
  assert.equal((replies.items[0] as any).text, 'Which fest events?');
});

test('a publish token only works for its batch and dies with the session', async () => {
  const one = await StoryBatchService.create(me, { batchId: randomUUID(), items: [{ itemId: randomUUID(), kind: 'photo', size: 2000, durationMs: 5000, composition: composition() }] });
  const two = await StoryBatchService.create(me, { batchId: randomUUID(), items: [{ itemId: randomUUID(), kind: 'photo', size: 2000, durationMs: 5000, composition: composition() }] });
  const claims = verifyStoryPublishToken(one.publishToken);
  await assert.rejects(StoryBatchService.parts(claims, two.batchId, two.items[0].itemId), (error: any) => error.code === 'STORY_TOKEN_SCOPE');

  await prisma.user.update({ where: { id: me }, data: { sessionVersion: { increment: 1 } } });
  try {
    await assert.rejects(StoryBatchService.parts(claims, one.batchId, one.items[0].itemId), (error: any) => error.code === 'STORY_TOKEN_REVOKED');
  } finally {
    await prisma.user.update({ where: { id: me }, data: { sessionVersion: { decrement: 1 } } });
  }

  // Cancelling stops the batch and frees its storage.
  await StoryBatchService.parts(claims, one.batchId, one.items[0].itemId, { size: 2000 });
  const asset = await prisma.storyMediaAsset.findUniqueOrThrow({ where: { id: one.items[0].assetId } });
  const cancelled = await StoryBatchService.cancel(me, one.batchId);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.items[0].status, 'cancelled');
  await assert.rejects(StoryBatchService.publishItem(claims, one.batchId, one.items[0].itemId), (error: any) => error.code === 'STORY_BATCH_CANCELLED');
  await assert.rejects(
    s3Client.send(new ListPartsCommand({ Bucket: bucket, Key: asset.objectKey, UploadId: asset.uploadId! })),
    (error: any) => error.name === 'NoSuchUpload',
  );
  await StoryBatchService.cancel(me, two.batchId);
});

test('an item the device cannot produce is skipped, and the stories after it still post', async () => {
  const photo = await sharp({ create: { width: 540, height: 960, channels: 3, background: '#3366aa' } }).jpeg({ quality: 60 }).toBuffer();
  const batchId = randomUUID();
  const broken = randomUUID();
  const next = randomUUID();
  const ticket = await StoryBatchService.create(me, {
    batchId,
    items: [
      { itemId: broken, kind: 'video', durationMs: 5000, composition: composition() },
      { itemId: next, kind: 'photo', durationMs: 5000, composition: composition() },
    ],
  });
  const claims = verifyStoryPublishToken(ticket.publishToken);
  await upload(claims, batchId, next, photo);
  await assert.rejects(StoryBatchService.publishItem(claims, batchId, next), (error: any) => error.code === 'STORY_BATCH_ORDER');
  assert.deepEqual(await StoryBatchService.skipItem(claims, batchId, broken, 'Export failed'), { status: 'rejected' });
  const published = await StoryBatchService.publishItem(claims, batchId, next);
  assert.equal(published.repeated, false);
  const status = await StoryBatchService.status(me, batchId);
  assert.deepEqual(status.items.map((item) => item.status), ['rejected', 'published']);
  assert.equal(status.status, 'failed', 'a batch with a skipped story reports the failure');
  assert.equal(await prisma.outboxEvent.count({ where: { topic: 'story.batch.failed', aggregateId: batchId } }), 0, 'no push: the phone already shows it');
});

test('a video over 60 seconds is rejected, the item fails, and the owner is told once', async () => {
  const video = await makeVideo('long.mp4', 62);
  const batchId = randomUUID();
  const itemId = randomUUID();
  const ticket = await StoryBatchService.create(me, { batchId, items: [{ itemId, kind: 'video', size: video.length, durationMs: 60_000, composition: composition() }] });
  await upload(verifyStoryPublishToken(ticket.publishToken), batchId, itemId, video);
  await assert.rejects(StoryBatchService.publishItem(verifyStoryPublishToken(ticket.publishToken), batchId, itemId), (error: any) => error.code === 'STORY_VIDEO_TOO_LONG');
  const status = await StoryBatchService.status(me, batchId);
  assert.equal(status.status, 'failed');
  assert.equal(status.items[0].status, 'rejected');
  assert.equal(await prisma.outboxEvent.count({ where: { topic: 'story.batch.failed', aggregateId: batchId } }), 1);
});
