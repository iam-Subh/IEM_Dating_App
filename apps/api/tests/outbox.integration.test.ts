import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { ChatService } from '../src/services/chat.service';
import { OutboxWorker } from '../src/services/outbox.worker';
import { PushService } from '../src/services/push.service';
import { createServer } from 'http';
import { redisClient } from '../src/utils/redis';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/reco_test' || url.port !== '55439') {
  throw new Error('Outbox tests require the isolated localhost:55439/reco_test database');
}

const userA = randomUUID();
const userB = randomUUID();
let matchId = '';

before(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE delivery_attempts,account_events,chat_device_cursors,outbox_events,notifications,chat_events,chat_participants,chat_sessions,messages,matches,user_sessions,user_scores,user_blocks,users CASCADE',
  );
  await prisma.user.createMany({
    data: [userA, userB].map((id) => ({
      id,
      email: `${id}@outbox.example.test`,
      name: id === userA ? 'Sender' : 'Recipient',
      passwordHash: 'TEST_ONLY',
      accountStatus: 'active',
      birthday: new Date('2003-01-01'),
    })),
  });
  const match = await prisma.match.create({ data: { user1Id: userA, user2Id: userB, status: 'active' } });
  matchId = match.id;
});

after(async () => {
  await OutboxWorker.stop();
  await prisma.$disconnect();
  redisClient.disconnect();
});

test('a message and its pending delivery event commit together', async () => {
  const message = await ChatService.sendMessage(userA, matchId, 'Committed message', undefined, [], randomUUID());
  const event = await prisma.outboxEvent.findUnique({ where: { deduplicationKey: `message.created:${message.id}` } });
  assert.equal(event?.status, 'pending');
  assert.equal(await prisma.notification.count(), 0);

  assert.equal(await OutboxWorker.runOnce(), true);
  const delivered = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event!.id } });
  assert.equal(delivered.status, 'completed');
  assert.equal(delivered.attempts, 1);
  assert.equal(await prisma.notification.count({ where: { outboxEventId: event!.id, userId: userB } }), 1);
});

test('a repeated event delivery does not duplicate a notification', async () => {
  const event = await prisma.outboxEvent.findFirstOrThrow({ where: { topic: 'message.created' } });
  await prisma.outboxEvent.update({
    where: { id: event.id },
    data: { status: 'pending', completedAt: null, availableAt: new Date(Date.now() - 1000) },
  });
  assert.equal(await OutboxWorker.runOnce(), true);
  assert.equal(await prisma.notification.count({ where: { outboxEventId: event.id, userId: userB } }), 1);
});

test('concurrent claims process each event once', async () => {
  const first = await ChatService.sendMessage(userA, matchId, 'First claim', undefined, [], randomUUID());
  const second = await ChatService.sendMessage(userA, matchId, 'Second claim', undefined, [], randomUUID());
  const results = await Promise.all([OutboxWorker.runOnce(), OutboxWorker.runOnce()]);
  assert.deepEqual(results, [true, true]);
  const events = await prisma.outboxEvent.findMany({
    where: { aggregateId: { in: [first.id, second.id] } },
    select: { status: true, attempts: true },
  });
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.status === 'completed' && event.attempts === 1));
});

test('a poison event enters the dead state at the retry limit', async () => {
  const event = await prisma.outboxEvent.create({
    data: {
      topic: 'unsupported.topic',
      aggregateId: randomUUID(),
      deduplicationKey: `unsupported:${randomUUID()}`,
      payload: {},
      attempts: 7,
    },
  });
  assert.equal(await OutboxWorker.runOnce(), true);
  const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
  assert.equal(failed.status, 'dead');
  assert.equal(failed.attempts, 8);
  assert.match(failed.lastError ?? '', /Unsupported outbox topic/);
});

test('push delivery sends the Expo payload and removes an invalid device token', async () => {
  let received: any[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const previousEndpoint = process.env.EXPO_PUSH_ENDPOINT;
  process.env.EXPO_PUSH_ENDPOINT = `http://127.0.0.1:${address.port}/push`;
  const token = `ExponentPushToken[${randomUUID().replace(/-/g, '')}]`;
  const deliveryEventId = randomUUID();
  try {
    await PushService.register(userB, token, 'android');
    await PushService.send(userB, { title: 'Test title', body: 'Test body', data: { url: 'iemdating://chat/test' }, category: 'messages' }, deliveryEventId);
    assert.equal(received.length, 1);
    assert.equal(received[0].to, token);
    assert.equal(received[0].data.url, 'iemdating://chat/test');
    assert.equal(await prisma.deviceToken.count({ where: { token } }), 0);
    const attempt = await prisma.deliveryAttempt.findFirstOrThrow({ where: { outboxEventId: deliveryEventId } });
    assert.equal(attempt.status, 'failed');
    assert.equal(attempt.attempts, 1);
    assert.equal(attempt.lastError, 'DeviceNotRegistered');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousEndpoint === undefined) delete process.env.EXPO_PUSH_ENDPOINT;
    else process.env.EXPO_PUSH_ENDPOINT = previousEndpoint;
  }
});
