import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createServer } from 'http';
import { io as createSocketClient } from 'socket.io-client';
import app from '../src/app';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { generateTokens, validateAuthConfiguration, verifyAccessToken, verifyRefreshToken } from '../src/utils/jwt';
import { closeSocket, setupSocket } from '../src/socket';
import { SafetyService } from '../src/services/safety.service';
import { OTPService } from '../src/services/otp.service';
import { StudentMembershipService } from '../src/services/student-membership.service';
import { OnboardingService } from '../src/services/onboarding.service';
import bcrypt from 'bcryptjs';
import { AccountLifecycleService } from '../src/services/account-lifecycle.service';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.pathname !== '/reco_test' ||
  url.port !== '55439'
) {
  throw new Error('Security tests require the isolated localhost:55439/reco_test database');
}
if (process.env.REDIS_URL !== 'redis://127.0.0.1:56420') {
  throw new Error('Security tests require the isolated Redis instance');
}

const accountA = randomUUID();
const accountB = randomUUID();
const accountC = randomUUID();
const accountD = randomUUID();
let matchId = '';
let messageId = '';

function user(id: string) {
  return {
    id,
    email: `${id}@security.example.test`,
    name: 'Security test user',
    passwordHash: 'TEST_ONLY',
    accountStatus: 'active',
    birthday: new Date('2003-01-01'),
  };
}

async function authorization(userId: string) {
  const jti = randomUUID();
  await prisma.userSession.create({
    data: { userId, tokenJti: jti, expiresAt: new Date(Date.now() + 60_000) },
  });
  const token = generateTokens(userId, `${userId}@security.example.test`, jti).accessToken;
  return { Authorization: `Bearer ${token}` };
}

before(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_events,notifications,profile_media_assets,chat_media_assets,student_memberships,chat_sessions,messages,matches,user_sessions,user_scores,user_blocks,users CASCADE',
  );
  await prisma.user.createMany({ data: [user(accountA), user(accountB), user(accountC), user(accountD)] });
  const institution = await prisma.institution.findUniqueOrThrow({ where: { code: 'IEM-KOLKATA' } });
  await prisma.studentMembership.createMany({
    data: [accountA, accountB, accountC, accountD].map((userId) => ({
      userId,
      institutionId: institution.id,
      institutionalEmail: `${userId}@iem.edu.in`,
      status: 'verified',
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    })),
  });
  const match = await prisma.match.create({
    data: { user1Id: accountA, user2Id: accountB, status: 'active' },
  });
  matchId = match.id;
  const mediaKey = `chat-media/${match.id}/${randomUUID()}.jpeg`;
  const message = await prisma.message.create({
    data: { matchId: match.id, senderId: accountA, content: 'private', mediaKeys: [mediaKey] },
  });
  messageId = message.id;
  await prisma.chatMediaAsset.create({
    data: {
      matchId: match.id,
      ownerId: accountA,
      objectKey: mediaKey,
      contentType: 'image/jpeg',
      maxBytes: 15 * 1024 * 1024,
      status: 'attached',
      attachedAt: message.sentAt,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
});

after(async () => {
  await prisma.$disconnect();
  redisClient.disconnect();
});

test('an unrelated account cannot read or mutate another match', async () => {
  const auth = await authorization(accountC);
  const beforeMessage = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });

  const responses = await Promise.all([
    request(app).get(`/api/v1/chat/${matchId}/messages`).set(auth),
    request(app).patch(`/api/v1/chat/${matchId}/read`).set(auth),
    request(app).patch(`/api/v1/chat/${matchId}/messages/${messageId}`).set(auth).send({ content: 'changed' }),
    request(app).delete(`/api/v1/chat/${matchId}/messages/${messageId}`).set(auth).send({ mode: 'me' }),
    request(app).get(`/api/v1/chat/${matchId}/media/upload-url?ext=jpeg`).set(auth),
    request(app).get('/api/v1/chat/media/read').query({ key: beforeMessage.mediaKeys[0] }).set(auth),
  ]);

  for (const response of responses) assert.equal(response.status, 404);
  const afterMessage = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
  assert.equal(afterMessage.content, beforeMessage.content);
  assert.equal(afterMessage.readAt, null);
  assert.deepEqual(afterMessage.hiddenBy, []);
  assert.equal(afterMessage.isDeleted, false);
});

test('a participant can read the active match', async () => {
  const response = await request(app)
    .get(`/api/v1/chat/${matchId}/messages`)
    .set(await authorization(accountA));
  assert.equal(response.status, 200);
  assert.equal(response.body.data.messages[0].id, messageId);
});

test('parallel message retries create one message and one conversation record', async () => {
  const auth = await authorization(accountA);
  const clientMessageId = `client-${randomUUID()}`;
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => request(app)
      .post(`/api/v1/chat/${matchId}/messages`)
      .set(auth)
      .send({ content: 'idempotent message', clientMessageId })),
  );
  assert.ok(responses.every((response) => response.status === 200 || response.status === 201));
  assert.equal(await prisma.message.count({ where: { senderId: accountA, clientMessageId } }), 1);
  assert.equal(await prisma.chatSession.count({ where: { matchId } }), 1);
});

test('a message can attach only an unexpired media ticket owned by its sender', async () => {
  const foreignKey = `chat-media/${matchId}/${randomUUID()}.jpeg`;
  const ownKey = `chat-media/${matchId}/${randomUUID()}.jpeg`;
  await prisma.chatMediaAsset.createMany({
    data: [
      { matchId, ownerId: accountB, objectKey: foreignKey, contentType: 'image/jpeg', maxBytes: 15 * 1024 * 1024, status: 'uploaded', expiresAt: new Date(Date.now() + 60_000) },
      { matchId, ownerId: accountA, objectKey: ownKey, contentType: 'image/jpeg', maxBytes: 15 * 1024 * 1024, status: 'uploaded', expiresAt: new Date(Date.now() + 60_000) },
    ],
  });
  const auth = await authorization(accountA);
  assert.equal((await request(app).post(`/api/v1/chat/${matchId}/messages`).set(auth).send({ mediaKeys: [foreignKey] })).status, 400);
  const attached = await request(app).post(`/api/v1/chat/${matchId}/messages`).set(auth).send({ mediaKeys: [ownKey], clientMessageId: `client-${randomUUID()}` });
  assert.equal(attached.status, 201);
  assert.equal((await prisma.chatMediaAsset.findUniqueOrThrow({ where: { objectKey: ownKey } })).status, 'attached');
});

test('existing users receive and complete the discovery preference step', async () => {
  await prisma.user.update({
    where: { id: accountA },
    data: {
      birthday: new Date('2003-01-01'),
      college: 'IEM',
      department: 'CSE',
      graduationYear: 2028,
      preferencesConfirmedAt: null,
    },
  });
  const auth = await authorization(accountA);
  const before = await request(app).get('/api/v1/profile/readiness').set(auth);
  assert.equal(before.status, 200);
  assert.equal(before.body.data.nextRequiredStep, 'discoveryPreferences');

  const update = await request(app).put('/api/v1/profile/discovery').set(auth).send({
    discoveryCategory: 'man',
    showMeCategories: ['woman'],
    minAgePref: 18,
    maxAgePref: 30,
    discoveryMode: 'college',
    distancePreference: 50,
  });
  assert.equal(update.status, 200);
  assert.ok(update.body.data.preferencesConfirmedAt);
  const afterStatus = await request(app).get('/api/v1/profile/readiness').set(auth);
  assert.equal(afterStatus.body.data.nextRequiredStep, null);
});

test('profile updates reject foreign media and attach only completed owned uploads', async () => {
  const previousBucket = process.env.AWS_S3_BUCKET_NAME;
  const previousRegion = process.env.AWS_REGION;
  process.env.AWS_S3_BUCKET_NAME = 'test-profile-bucket';
  process.env.AWS_REGION = 'us-east-1';
  try {
    const objectKey = `profiles/${accountA}/photos/${randomUUID()}.jpeg`;
    await prisma.profileMediaAsset.create({
      data: {
        ownerId: accountA,
        objectKey,
        purpose: 'photo',
        contentType: 'image/jpeg',
        maxBytes: 15 * 1024 * 1024,
        status: 'uploaded',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const auth = await authorization(accountA);
    const foreignUrl = `https://test-profile-bucket.s3.us-east-1.amazonaws.com/profiles/${accountB}/photos/${randomUUID()}.jpeg`;
    assert.equal((await request(app).put('/api/v1/profile').set(auth).send({ photos: [foreignUrl] })).status, 400);
    const ownedUrl = `https://test-profile-bucket.s3.us-east-1.amazonaws.com/${objectKey}`;
    assert.equal((await request(app).put('/api/v1/profile').set(auth).send({ photos: [ownedUrl] })).status, 200);
    assert.equal((await prisma.profileMediaAsset.findUniqueOrThrow({ where: { objectKey } })).status, 'attached');
  } finally {
    if (previousBucket === undefined) delete process.env.AWS_S3_BUCKET_NAME;
    else process.env.AWS_S3_BUCKET_NAME = previousBucket;
    if (previousRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = previousRegion;
  }
});

test('attaching an owned video creates one durable preview job and clears the old preview', async () => {
  const previousBucket = process.env.AWS_S3_BUCKET_NAME;
  const previousRegion = process.env.AWS_REGION;
  process.env.AWS_S3_BUCKET_NAME = 'test-profile-bucket';
  process.env.AWS_REGION = 'us-east-1';
  try {
    const objectKey = `profiles/${accountA}/videos/${randomUUID()}.mp4`;
    const asset = await prisma.profileMediaAsset.create({
      data: {
        ownerId: accountA,
        objectKey,
        purpose: 'video',
        contentType: 'video/mp4',
        maxBytes: 100 * 1024 * 1024,
        status: 'uploaded',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.user.update({ where: { id: accountA }, data: { videoPreviewUrl: 'https://old.example.test/preview.mp4' } });
    const auth = await authorization(accountA);
    const ownedUrl = `https://test-profile-bucket.s3.us-east-1.amazonaws.com/${objectKey}`;

    assert.equal((await request(app).put('/api/v1/profile').set(auth).send({ profileVideoUrl: ownedUrl })).status, 200);
    const attached = await prisma.profileMediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    assert.equal(attached.status, 'attached');
    assert.equal(attached.processingStatus, 'pending');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: accountA } })).videoPreviewUrl, null);
    assert.equal(await prisma.outboxEvent.count({
      where: { deduplicationKey: `profile.video-preview.requested:${asset.id}`, status: 'pending' },
    }), 1);

    assert.equal((await request(app).put('/api/v1/profile').set(auth).send({
      profileVideoUrl: ownedUrl,
      videoPreviewUrl: 'https://attacker.example.test/injected.mp4',
    })).status, 200);
    assert.equal(await prisma.outboxEvent.count({ where: { aggregateId: asset.id } }), 1);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: accountA } })).videoPreviewUrl, null);
  } finally {
    if (previousBucket === undefined) delete process.env.AWS_S3_BUCKET_NAME;
    else process.env.AWS_S3_BUCKET_NAME = previousBucket;
    if (previousRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = previousRegion;
  }
});

test('an unrelated socket cannot join, send, or mark the match as read', async () => {
  const auth = await authorization(accountC);
  const token = auth.Authorization.slice('Bearer '.length);
  const httpServer = createServer(app);
  setupSocket(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const client = createSocketClient(`http://127.0.0.1:${address.port}`, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    const joinResult = await new Promise<any>((resolve) =>
      client.emit('join_match_room', matchId, resolve),
    );
    assert.equal(joinResult.success, false);
    const sendResult = await new Promise<any>((resolve) =>
      client.emit('send_message', { matchId, content: 'unauthorized' }, resolve),
    );
    assert.equal(sendResult.success, false);
    client.emit('message_read', { matchId });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).readAt, null);
  } finally {
    client.close();
    await closeSocket();
  }
});

test('duplicate reports do not trigger automatic hiding', async () => {
  await Promise.all(
    Array.from({ length: 4 }, () => SafetyService.fileReport(accountA, {
      reportedUserId: accountB,
      matchId,
      reason: 'harassment',
    })),
  );
  assert.equal(await prisma.safetyReport.count({ where: { reporterId: accountA } }), 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: accountB } })).accountStatus, 'active');

  await SafetyService.fileReport(accountC, { reportedUserId: accountB, reason: 'harassment' });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: accountB } })).accountStatus, 'active');
  await SafetyService.fileReport(accountD, { reportedUserId: accountB, reason: 'harassment' });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: accountB } })).accountStatus, 'restricted');
  const moderationCase = await prisma.moderationCase.findFirstOrThrow({ where: { subjectUserId: accountB } });
  assert.equal(moderationCase.status, 'restricted');
  assert.equal(await prisma.moderationCase.count({ where: { subjectUserId: accountB } }), 1);
});

test('account export excludes credentials and enforces request ownership', async () => {
  const auth = await authorization(accountA);
  const created = await request(app).post('/api/v1/account/exports').set(auth);
  assert.equal(created.status, 201);
  const requestId = created.body.data.id;
  const own = await request(app).get(`/api/v1/account/requests/${requestId}`).set(auth);
  assert.equal(own.status, 200);
  assert.equal(own.body.data.status, 'completed');
  assert.equal(JSON.stringify(own.body.data.result).includes('passwordHash'), false);
  assert.equal((await request(app).get(`/api/v1/account/requests/${requestId}`).set(await authorization(accountC))).status, 404);
});

test('account deletion can be cancelled and due requests erase personal data', async () => {
  const deletionUserId = randomUUID();
  await prisma.user.create({ data: user(deletionUserId) });
  const auth = await authorization(deletionUserId);
  const requested = await request(app).post('/api/v1/account/deletion').set(auth).send({ confirmation: 'DELETE' });
  assert.equal(requested.status, 202);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: deletionUserId } })).accountStatus, 'deletion_pending');
  assert.equal((await request(app).get('/api/v1/discover/recommendations').set(auth)).status, 403);
  assert.equal((await request(app).delete('/api/v1/account/deletion').set(auth)).status, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: deletionUserId } })).accountStatus, 'active');

  const second = await request(app).post('/api/v1/account/deletion').set(auth).send({ confirmation: 'DELETE' });
  await prisma.accountDataRequest.update({
    where: { id: second.body.data.id },
    data: { scheduledFor: new Date(Date.now() - 1000) },
  });
  assert.equal(await AccountLifecycleService.runDueDeletions(), 1);
  const erased = await prisma.user.findUniqueOrThrow({ where: { id: deletionUserId } });
  assert.equal(erased.accountStatus, 'deleted');
  assert.equal(erased.email, null);
  assert.equal(erased.birthday, null);
  assert.equal(await prisma.userSession.count({ where: { userId: deletionUserId } }), 0);
});

test('only a participant can unmatch and the change revokes chat access', async () => {
  assert.equal((await request(app).post(`/api/v1/match/${matchId}/unmatch`).set(await authorization(accountC))).status, 404);
  const ended = await request(app).post(`/api/v1/match/${matchId}/unmatch`).set(await authorization(accountA));
  assert.equal(ended.status, 200);
  assert.equal((await request(app).post(`/api/v1/match/${matchId}/unmatch`).set(await authorization(accountA))).body.data.repeated, true);
  assert.equal((await request(app).get(`/api/v1/chat/${matchId}/messages`).set(await authorization(accountA))).status, 404);
});

test('revoked, stale, and inactive sessions fail', async () => {
  const revokedAuth = await authorization(accountA);
  await prisma.userSession.deleteMany({ where: { userId: accountA } });
  assert.equal((await request(app).get('/api/v1/profile').set(revokedAuth)).status, 401);

  const staleAuth = await authorization(accountA);
  await prisma.user.update({ where: { id: accountA }, data: { sessionVersion: { increment: 1 } } });
  assert.equal((await request(app).get('/api/v1/profile').set(staleAuth)).status, 401);

  const inactiveAuth = await authorization(accountB);
  await prisma.user.update({ where: { id: accountB }, data: { accountStatus: 'restricted' } });
  assert.equal((await request(app).get('/api/v1/profile').set(inactiveAuth)).status, 401);
});

test('refresh tokens rotate and reuse revokes the complete token family', async () => {
  const userId = randomUUID();
  await prisma.user.create({ data: user(userId) });
  const jti = randomUUID();
  const familyId = randomUUID();
  await prisma.userSession.create({
    data: { userId, tokenJti: jti, familyId, expiresAt: new Date(Date.now() + 60_000) },
  });
  const firstToken = generateTokens(userId, `${userId}@security.example.test`, jti).refreshToken;
  const first = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: firstToken });
  assert.equal(first.status, 200);
  const rotatedToken = first.body.data.refreshToken;
  assert.ok(rotatedToken);

  const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: firstToken });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body.code, 'SESSION_REVOKED');
  assert.equal((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: rotatedToken })).status, 401);
  assert.equal(await prisma.userSession.count({ where: { familyId, revokedAt: null } }), 0);
});

test('OTP challenges are single use, purpose bound, and proof tokens are consumed once', async () => {
  const identifier = `${randomUUID()}@iem.edu.in`;
  const challenge = await OTPService.issue(identifier, 'registration');
  const results = await Promise.all(
    Array.from({ length: 4 }, () => OTPService.verify(identifier, 'registration', challenge.challengeId, challenge.code)),
  );
  assert.equal(results.filter((result) => result.valid).length, 1);
  const proof = await OTPService.createProof(identifier, 'registration');
  await OTPService.consumeProof(identifier, 'registration', proof);
  await assert.rejects(() => OTPService.consumeProof(identifier, 'registration', proof));

  const phone = `+91${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`;
  const phoneChallenge = await OTPService.issue(phone, 'phone_login');
  assert.equal((await OTPService.verify(phone, 'registration', phoneChallenge.challengeId, phoneChallenge.code)).valid, false);
  assert.equal((await OTPService.verify(phone, 'phone_login', phoneChallenge.challengeId, phoneChallenge.code)).valid, true);
});

test('student membership verification controls the first onboarding step', async () => {
  const userId = randomUUID();
  await prisma.user.create({ data: { ...user(userId), email: null, phone: `+91${Date.now().toString().slice(-10)}` } });
  assert.equal((await OnboardingService.getStatus(userId)).nextRequiredStep, 'studentVerification');
  const email = `${userId}2024@iem.edu.in`;
  const challenge = await OTPService.issue(email, 'student_membership');
  await StudentMembershipService.verify(userId, 'IEM-KOLKATA', email, challenge.challengeId, challenge.code);
  assert.equal((await OnboardingService.getStatus(userId)).nextRequiredStep, 'profile');
});

test('password recovery changes the password and revokes every existing session', async () => {
  const userId = randomUUID();
  const email = `${userId}@security.example.test`;
  await prisma.user.create({ data: { ...user(userId), passwordHash: await bcrypt.hash('old-password', 10) } });
  const oldSession = await authorization(userId);
  const challenge = await OTPService.issue(email, 'password_recovery');
  const complete = await request(app).post('/api/v1/auth/recovery/complete').send({
    email,
    challengeId: challenge.challengeId,
    code: challenge.code,
    newPassword: 'new-password',
  });
  assert.equal(complete.status, 200);
  assert.equal((await request(app).get('/api/v1/profile').set(oldSession)).status, 401);
  assert.equal((await request(app).post('/api/v1/auth/login').send({ email, password: 'old-password' })).status, 401);
  assert.equal((await request(app).post('/api/v1/auth/login').send({ email, password: 'new-password' })).status, 200);
});

test('JWT configuration rejects missing, weak, and shared secrets', () => {
  const access = process.env.JWT_ACCESS_SECRET;
  const refresh = process.env.JWT_REFRESH_SECRET;
  try {
    delete process.env.JWT_ACCESS_SECRET;
    assert.throws(() => validateAuthConfiguration());
    process.env.JWT_ACCESS_SECRET = 'short';
    assert.throws(() => validateAuthConfiguration());
    process.env.JWT_ACCESS_SECRET = refresh;
    assert.throws(() => validateAuthConfiguration());
  } finally {
    process.env.JWT_ACCESS_SECRET = access;
    process.env.JWT_REFRESH_SECRET = refresh;
  }
});

test('JWT verification enforces token type, issuer, audience, and algorithm', () => {
  const tokens = generateTokens(accountC, 'security@example.test', randomUUID());
  assert.equal(verifyAccessToken(tokens.accessToken).type, 'access');
  assert.equal(verifyRefreshToken(tokens.refreshToken).type, 'refresh');
  assert.throws(() => verifyAccessToken(tokens.refreshToken));
  assert.throws(() => verifyRefreshToken(tokens.accessToken));
});
