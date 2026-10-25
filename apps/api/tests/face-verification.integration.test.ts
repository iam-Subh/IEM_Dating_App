/**
 * The real-person check end to end (apps/mobile/src/features/verification/PHOTO_VERIFICATION_PLAN.md):
 * the face service, the face key, photo checks, the main-photo rule, and a
 * selfie through the private bucket. Needs the face service (docker compose up
 * face); skipped without it.
 *
 * Non-destructive: one user under a random id, its own rows and snapshots,
 * all deleted afterwards. Photos are served from a local web server.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { FaceVerificationService, sealDescriptor } from '../src/services/face-verification.service';

const userId = randomUUID();
const fixtures = path.join(__dirname, 'fixtures', 'faces');
const serviceUrl = (process.env.FACE_SERVICE_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
let server: http.Server;
let base = '';
let up = false;

before(async () => {
  up = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(2000) }).then((response) => response.ok).catch(() => false);
  process.env.FACE_SERVICE_URL = serviceUrl;
  server = http.createServer((req, res) => {
    const file = path.join(fixtures, path.basename(req.url ?? ''));
    if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', 'image/jpeg');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@face.example.test`, name: 'Face test', passwordHash: 'x', accountStatus: 'active' } });
});

after(async () => {
  await prisma.faceMediaCheck.deleteMany({ where: { userId } });
  await prisma.faceKey.deleteMany({ where: { userId } });
  await prisma.faceVerification.deleteMany({ where: { userId } });
  await prisma.faceReviewCase.deleteMany({ where: { userId } });
  await prisma.faceChallenge.deleteMany({ where: { userId } });
  await prisma.profilePhoto.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  server?.close();
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

async function keyOf(file: string) {
  const response = await fetch(`${serviceUrl}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: [fs.readFileSync(path.join(fixtures, file)).toString('base64')] }),
  });
  return ((await response.json()) as { images: { faces: { descriptor: number[] }[] }[] }).images[0].faces[0].descriptor;
}

async function setPhotos(files: string[]) {
  await prisma.profilePhoto.deleteMany({ where: { userId } });
  await prisma.profilePhoto.createMany({ data: files.map((file, order) => ({ userId, photoUrl: `${base}/${file}`, order, isPrimary: order === 0 })) });
}

test('photos are checked against the face key; a photo of someone else pauses the status', async (t) => {
  if (!up) return t.skip('face service not running');
  await prisma.faceKey.create({ data: { userId, cipher: sealDescriptor(await keyOf('person-a-1.jpg')), model: 'test' } });
  await prisma.faceVerification.create({ data: { userId, status: 'verified', verifiedAt: new Date() } });
  await prisma.user.update({ where: { id: userId }, data: { realPersonVerifiedAt: new Date() } });

  await setPhotos(['person-a-2.jpg']);
  await FaceVerificationService.onMediaChanged(userId);
  assert.equal((await FaceVerificationService.status(userId)).status, 'verified', 'their own photo keeps it');

  await setPhotos(['person-a-2.jpg', 'person-b-1.jpg']);
  await FaceVerificationService.onMediaChanged(userId);
  const status = await FaceVerificationService.status(userId);
  assert.equal(status.status, 'needs_fix');
  assert.equal(status.reason, 'photo');
  assert.deepEqual(status.media.map((item) => [item.url.endsWith('person-b-1.jpg'), item.status]), [[true, 'mismatch']]);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).realPersonVerifiedAt, null, 'paused while a photo is not them');

  await setPhotos(['person-a-2.jpg']);
  await FaceVerificationService.onMediaChanged(userId);
  assert.equal((await FaceVerificationService.status(userId)).status, 'verified', 'fixed: back at once');
});

test('a new main photo must show them', async (t) => {
  if (!up) return t.skip('face service not running');
  await assert.rejects(FaceVerificationService.assertMainPhoto(userId, `${base}/person-b-1.jpg`), (error: any) => error.code === 'MAIN_PHOTO_NOT_YOU');
  await FaceVerificationService.assertMainPhoto(userId, `${base}/person-a-2.jpg`);
});

test('a selfie goes through the private bucket and plain photos fail the liveness check', async (t) => {
  if (!up) return t.skip('face service not running');
  let challenge;
  try {
    challenge = await FaceVerificationService.challenge(userId);
  } catch (error: any) {
    return t.skip(`private bucket unavailable: ${error.code ?? error.message}`);
  }
  assert.equal(challenge.actions.length, 3);
  assert.equal(new Set(challenge.actions).size, 3, 'three different actions');
  const image = fs.readFileSync(path.join(fixtures, 'person-a-1.jpg'));
  for (const upload of challenge.uploads) {
    const response = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': upload.contentType }, body: image });
    if (!response.ok) return t.skip(`upload refused by storage: ${response.status}`);
  }
  const result = await FaceVerificationService.submit(userId, challenge.challengeId);
  assert.equal(result.status, 'failed');
  assert.match(String(result.reason), /^liveness/, 'a still photo cannot blink, turn or smile');
  await assert.rejects(FaceVerificationService.submit(userId, challenge.challengeId), (error: any) => error.code === 'FACE_CHALLENGE_EXPIRED', 'one use only');
});

test('removing it deletes the face key and every result', async (t) => {
  if (!up) return t.skip('face service not running');
  await FaceVerificationService.remove(userId);
  assert.equal(await prisma.faceKey.count({ where: { userId } }), 0);
  assert.equal(await prisma.faceMediaCheck.count({ where: { userId } }), 0);
  assert.equal((await FaceVerificationService.status(userId)).status, 'removed');
});
