/**
 * Regression tests for chat defects fixed on 2026-09-08.
 *
 * Each test fails against the previous implementation:
 *  1. A live socket was force-disconnected once its 15 minute access token
 *     expired, losing the event that triggered the check.
 *  2. Match rooms were joined without awaiting, so a client emitting straight
 *     after connect could miss its rooms.
 *  3. pingTimeout was below pingInterval, disconnecting healthy phones.
 *  4. A permanently undeliverable queued message blocked its conversation.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { io as createSocketClient } from 'socket.io-client';
import app from '../src/app';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { generateTokens } from '../src/utils/jwt';
import { closeSocket, getIO, setupSocket } from '../src/socket';
import { AccessSessionService } from '../src/services/access-session.service';
import {
  decideSendRetry,
  MAX_SEND_ATTEMPTS,
} from '../../mobile/src/services/queue/sendRetryPolicy';
import { createTypingPresence } from '../../mobile/src/features/chat/typingPresence';
import { ChatService } from '../src/services/chat.service';
import { ChatEventService } from '../src/services/chat-event.service';
import {
  insertMessageOrdered,
  isNewerMessage,
  pendingLocalMessages,
} from '../../mobile/src/features/chat/messageOrdering';
import chatReducer, { markMessagesReadByPeer, setMessages, replaceOptimisticMessage, removeMessage, addMessage, setConversations } from '../../mobile/src/store/chatSlice';

test('server acknowledgements replace temporary IDs so later deletion works', () => {
  const original = { id: 'temp-one', matchId: 'test-match', senderId: 'a', content: 'Hi', sentAt: '2026-09-08T10:00:00Z', readAt: null };
  const state = chatReducer(undefined, setMessages({ matchId: original.matchId, messages: [original] }));
  const confirmed = chatReducer(state, replaceOptimisticMessage({ tempId: original.id, realMessage: { ...original, id: 'server-one', messageSeq: 1 } }));
  assert.equal(confirmed.activeMessages[original.matchId][0].id, 'server-one');
  assert.equal(chatReducer(confirmed, removeMessage({ matchId: original.matchId, messageId: 'server-one' })).activeMessages[original.matchId].length, 0);
});

test('a sequenced arrival updates an older preview without a sequence number', () => {
  const state = chatReducer(undefined, setConversations([{ matchId: 'm', user: { id: 'b', name: 'B', avatar: null }, unreadCount: 0, createdAt: '2026-09-08T09:00:00Z', lastMessage: { id: 'old', senderId: 'b', content: 'Old', sentAt: '2026-09-08T10:00:00Z', readAt: null, isRead: false } }]));
  const next = chatReducer(state, addMessage({ id: 'new', senderId: 'b', matchId: 'm', content: 'New', sentAt: '2026-09-08T10:01:00Z', messageSeq: 2, readAt: null }));
  assert.equal(next.conversations[0].lastMessage?.id, 'new');
});

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.pathname !== '/reco_test' ||
  url.port !== '55439'
) {
  throw new Error('Chat regression tests require the isolated localhost:55439/reco_test database');
}
if (process.env.REDIS_URL !== 'redis://127.0.0.1:56420') {
  throw new Error('Chat regression tests require the isolated Redis instance');
}

const accountA = randomUUID();
const accountB = randomUUID();
let matchId = '';

function user(id: string) {
  return {
    id,
    email: id + '@chat-regression.example.test',
    name: 'Chat regression user',
    passwordHash: 'TEST_ONLY',
    accountStatus: 'active',
    birthday: new Date('2003-01-01'),
  };
}

/** Creates a session the socket can authenticate with, plus its identifiers. */
async function session(userId: string) {
  const jti = randomUUID();
  await prisma.userSession.create({
    data: { userId, tokenJti: jti, expiresAt: new Date(Date.now() + 60_000) },
  });
  const { accessToken } = generateTokens(userId, user(userId).email, jti);
  return { jti, token: accessToken, established: { sub: userId, jti, sv: 1 } };
}

async function connectedClient(token: string) {
  const httpServer = createServer(app);
  setupSocket(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const client = createSocketClient('http://127.0.0.1:' + address.port, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
  return { client, httpServer };
}

before(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_events,notifications,chat_media_assets,student_memberships,chat_sessions,messages,matches,user_sessions,user_scores,user_blocks,users CASCADE',
  );
  await prisma.user.createMany({ data: [user(accountA), user(accountB)] });
  const institution = await prisma.institution.findUniqueOrThrow({
    where: { code: 'IEM-KOLKATA' },
  });
  await prisma.studentMembership.createMany({
    data: [accountA, accountB].map((userId) => ({
      userId,
      institutionId: institution.id,
      institutionalEmail: userId + '@iem.edu.in',
      status: 'verified',
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    })),
  });
  const match = await prisma.match.create({
    data: { user1Id: accountA, user2Id: accountB, status: 'active' },
  });
  matchId = match.id;
});

after(async () => {
  await closeSocket();
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('an established connection stays authorized after its access token would expire', async () => {
  const { established } = await session(accountA);
  // authorizeEstablished deliberately does not verify token expiry. The prior
  // implementation re-verified the frozen handshake token, which disconnected
  // every socket 15 minutes after it connected.
  await AccessSessionService.authorizeEstablished(established);
});

test('an established connection loses authorization when its session is revoked', async () => {
  const { jti, established } = await session(accountA);
  await AccessSessionService.authorizeEstablished(established);
  await prisma.userSession.updateMany({
    where: { userId: accountA, tokenJti: jti },
    data: { revokedAt: new Date() },
  });
  await assert.rejects(() => AccessSessionService.authorizeEstablished(established));
});

test('an established connection loses authorization on session version and account changes', async () => {
  const { established } = await session(accountB);
  await AccessSessionService.authorizeEstablished(established);

  await prisma.user.update({ where: { id: accountB }, data: { sessionVersion: 2 } });
  await assert.rejects(() => AccessSessionService.authorizeEstablished(established));
  await prisma.user.update({ where: { id: accountB }, data: { sessionVersion: 1 } });

  await prisma.user.update({ where: { id: accountB }, data: { accountStatus: 'suspended' } });
  await assert.rejects(() => AccessSessionService.authorizeEstablished(established));
  await prisma.user.update({ where: { id: accountB }, data: { accountStatus: 'active' } });
});

test('a connection joins its active match rooms before it is usable', async () => {
  const { token } = await session(accountA);
  const { client, httpServer } = await connectedClient(token);
  try {
    // An acknowledged event only completes after the connection handler has
    // joined the account rooms, so membership is observable by then.
    const joined = await new Promise<{ success: boolean }>((resolve) =>
      client.emit('join_match_room', matchId, resolve),
    );
    assert.equal(joined.success, true);
    const sockets = await getIO()!.in(matchId).fetchSockets();
    assert.ok(sockets.length >= 1, 'the connected socket should be in its match room');
  } finally {
    client.close();
    await closeSocket();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

test('socket keepalive tolerates a slow mobile round trip', async () => {
  const httpServer = createServer(app);
  const io = setupSocket(httpServer);
  try {
    const { pingTimeout, pingInterval } = (io.engine as unknown as {
      opts: { pingTimeout: number; pingInterval: number };
    }).opts;
    // A timeout below the interval disconnected healthy phones on congested
    // networks, and every disconnect forced a full event replay.
    assert.ok(pingTimeout >= 20000, 'pingTimeout ' + pingTimeout + ' is too aggressive for mobile');
    assert.ok(
      pingTimeout >= pingInterval * 0.8,
      'pingTimeout should not sit far below pingInterval',
    );
  } finally {
    await closeSocket();
    httpServer.close();
  }
});

test('a queued send is dropped rather than blocking its conversation forever', () => {
  // Terminal server codes can never succeed on retry.
  assert.deepEqual(decideSendRetry(0, 'MATCH_UNAVAILABLE'), { action: 'drop', reason: 'terminal' });
  assert.deepEqual(decideSendRetry(0, 'MEDIA_REJECTED'), { action: 'drop', reason: 'terminal' });

  // Transient failures retry and carry the counter forward.
  assert.deepEqual(decideSendRetry(undefined, 'REQUEST_FAILED'), { action: 'retry', attempts: 1 });
  assert.deepEqual(decideSendRetry(1, null), { action: 'retry', attempts: 2 });

  // The counter must terminate, otherwise one message blocks the queue.
  assert.deepEqual(decideSendRetry(MAX_SEND_ATTEMPTS - 1, null), {
    action: 'drop',
    reason: 'exhausted',
  });
  assert.deepEqual(decideSendRetry(99, 'REQUEST_FAILED'), { action: 'drop', reason: 'exhausted' });
});

test('a retry that reorders metadata keys is the same command, not a conflict', async () => {
  const clientMessageId = randomUUID();
  const first = await ChatService.sendMessage(
    accountA,
    matchId,
    'ordering check',
    undefined,
    [],
    clientMessageId,
    { type: 'text', metadata: { alpha: 1, beta: 2 } },
  );

  // The same command with the metadata serialized in a different key order.
  // JSON.stringify preserves insertion order, so the previous fingerprint
  // differed and the retry was rejected as IDEMPOTENCY_MISMATCH. Clients treat
  // that as terminal and discard the message.
  const retry = await ChatService.sendMessage(
    accountA,
    matchId,
    'ordering check',
    undefined,
    [],
    clientMessageId,
    { type: 'text', metadata: { beta: 2, alpha: 1 } },
  );

  assert.equal(retry.id, first.id, 'a reordered retry must return the original message');
  const stored = await prisma.message.count({ where: { senderId: accountA, clientMessageId } });
  assert.equal(stored, 1, 'a reordered retry must not create a second message');
});

test('a genuinely different retry on the same client id still conflicts', async () => {
  const clientMessageId = randomUUID();
  await ChatService.sendMessage(accountA, matchId, 'first text', undefined, [], clientMessageId, {
    type: 'text',
  });
  await assert.rejects(
    () =>
      ChatService.sendMessage(accountA, matchId, 'different text', undefined, [], clientMessageId, {
        type: 'text',
      }),
    (error: { code?: string }) => error.code === 'IDEMPOTENCY_MISMATCH',
  );
});

test('an incoming typing indicator expires when typing_stop never arrives', () => {
  const changes: boolean[] = [];
  let fire: (() => void) | null = null;
  const clock = {
    setTimeout: (handler: () => void) => {
      fire = handler;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {
      fire = null;
    },
  };
  const presence = createTypingPresence((typing) => changes.push(typing), 6000, clock);

  presence.start();
  assert.deepEqual(changes, [true]);

  // A repeated keystroke must not redispatch the same visible state.
  presence.start();
  assert.deepEqual(changes, [true]);

  // The sender's socket drops, so typing_stop never arrives.
  assert.ok(fire, 'an expiry timer should be pending');
  (fire as unknown as () => void)();
  assert.deepEqual(changes, [true, false], 'the indicator must clear on its own');
});

test('an explicit typing stop clears the indicator and cancels its timer', () => {
  const changes: boolean[] = [];
  let cleared = 0;
  const clock = {
    setTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => {
      cleared += 1;
    },
  };
  const presence = createTypingPresence((typing) => changes.push(typing), 6000, clock);

  presence.start();
  presence.stop();
  assert.deepEqual(changes, [true, false]);
  assert.ok(cleared >= 1, 'the pending expiry timer must be cancelled');

  // Stopping twice must not redispatch.
  presence.stop();
  assert.deepEqual(changes, [true, false]);
});

const orderable = (id: string, seq: number | null, sentAt: string, clientMessageId?: string) => ({
  id,
  senderId: accountA,
  content: id,
  sentAt,
  messageSeq: seq,
  clientMessageId: clientMessageId ?? null,
});

test('a replayed older message is placed in order, not treated as the newest', () => {
  // The list is newest-first. Every arrival used to be unshifted to index 0,
  // so a message replayed after reconnect appeared as the latest.
  const list = [orderable('c', 3, '2026-09-08T10:03:00Z'), orderable('a', 1, '2026-09-08T10:01:00Z')];
  const merged = insertMessageOrdered(list, orderable('b', 2, '2026-09-08T10:02:00Z'));
  assert.deepEqual(merged.map((m) => m.id), ['c', 'b', 'a']);

  const newest = insertMessageOrdered(merged, orderable('d', 4, '2026-09-08T10:04:00Z'));
  assert.equal(newest[0]!.id, 'd');

  // An unsequenced optimistic message belongs at the newest end.
  const pending = insertMessageOrdered(newest, orderable('temp-1', null, '2026-09-08T10:05:00Z'));
  assert.equal(pending[0]!.id, 'temp-1');

  // Re-delivering the same id must not duplicate it.
  assert.equal(insertMessageOrdered(pending, orderable('b', 2, '2026-09-08T10:02:00Z')).length, pending.length);
});

test('identical repeated text is not discarded when the server response arrives', () => {
  // Pending messages used to be matched by content, so sending the same word
  // twice silently dropped the second copy.
  const existing = [
    orderable('temp-1', null, '2026-09-08T10:01:00Z', 'temp-1'),
    orderable('temp-2', null, '2026-09-08T10:02:00Z', 'temp-2'),
  ];
  const server = [{ ...orderable('server-1', 1, '2026-09-08T10:01:00Z'), clientMessageId: 'temp-1' }];
  const stillPending = pendingLocalMessages(existing, server);
  assert.deepEqual(stillPending.map((m) => m.id), ['temp-2']);
});

test('message ordering prefers server sequence over client timestamps', () => {
  const sequenced = orderable('a', 5, '2026-09-08T10:00:00Z');
  const older = orderable('b', 4, '2026-09-08T23:00:00Z');
  // A later client clock must not outrank the server sequence.
  assert.equal(isNewerMessage(sequenced, older), true);
});

test('a duplicate read receipt cannot move a read time backwards', () => {
  const matchIdLocal = 'match-1';
  const base = chatReducer(undefined, { type: '@@INIT' });
  const seeded = {
    ...base,
    activeMessages: {
      [matchIdLocal]: [
        { id: 'm1', content: 'hi', senderId: accountA, sentAt: '2026-09-08T10:00:00Z', readAt: null, matchId: matchIdLocal, messageSeq: 1 },
      ],
    },
  } as typeof base;

  const first = chatReducer(
    seeded,
    markMessagesReadByPeer({ matchId: matchIdLocal, messageIds: ['m1'], readAt: '2026-09-08T10:05:00Z' }),
  );
  assert.equal(first.activeMessages[matchIdLocal]![0]!.readAt, '2026-09-08T10:05:00Z');

  // A duplicate arriving later must not push the first-read time forward.
  const later = chatReducer(
    first,
    markMessagesReadByPeer({ matchId: matchIdLocal, messageIds: ['m1'], readAt: '2026-09-08T10:09:00Z' }),
  );
  assert.equal(later.activeMessages[matchIdLocal]![0]!.readAt, '2026-09-08T10:05:00Z');

  // An out-of-order earlier receipt is the true first read.
  const earlier = chatReducer(
    later,
    markMessagesReadByPeer({ matchId: matchIdLocal, messageIds: ['m1'], readAt: '2026-09-08T10:02:00Z' }),
  );
  assert.equal(earlier.activeMessages[matchIdLocal]![0]!.readAt, '2026-09-08T10:02:00Z');
});

test('the event cursor advances past events private to the other participant', async () => {
  // Delete-for-me writes an event only its actor may read. The cursor used to
  // stall below the high-water mark, so every sync rescanned the same range.
  const sent = await ChatService.sendMessage(accountA, matchId, 'private hide source', undefined, [], randomUUID(), { type: 'text' });
  await ChatService.deleteMessage(matchId, sent.id, accountB, 'me');

  const asSender = await ChatEventService.list(accountA, matchId, 0, 200);
  assert.equal(asSender.hasMore, false);
  assert.equal(
    asSender.nextSeq,
    asSender.highWaterSeq,
    'a caller with no further authorized events must reach the high-water mark',
  );
  assert.ok(
    !asSender.events.some((event) => event.audienceUserId === accountB),
    'events private to the other participant must not be returned',
  );
});
