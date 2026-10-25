/**
 * Message notifications (apps/mobile/src/features/notifications/MESSAGE_NOTIFICATIONS_PLAN.md):
 * the chat push payload, previews, per-phone push kinds, quiet hours for
 * chats, played receipts, and the push action token.
 *
 * Non-destructive: its own users under random ids; pushes go to a fake push
 * service on localhost.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { AddressInfo } from 'net';
import crypto, { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { PushService } from '../src/services/push.service';
import { ChatNotificationService } from '../src/services/chat-notification.service';
import { ChatService } from '../src/services/chat.service';
import { PushActionTokenService } from '../src/services/push-action-token.service';
import { verifyAccessToken } from '../src/utils/jwt';

const QUIET = new Date('2026-10-04T19:00:00Z');     // 00:30 IST
const AFTERNOON = new Date('2026-10-05T08:30:00Z'); // 14:00 IST

const riya = randomUUID();   // sends
const arjun = randomUUID();  // receives; one new phone, one old
const users = [riya, arjun];
let matchId = '';
const NEW_PHONE = `ExponentPushToken[new${arjun.replace(/-/g, '').slice(0, 18)}]`;
const OLD_PHONE = `ExponentPushToken[old${arjun.replace(/-/g, '').slice(0, 18)}]`;

const ID_COLUMNS = ['id', 'user_id', 'user1_id', 'user2_id', 'sender_id', 'recipient_id', 'match_id', 'actor_id'];

type Sent = { to: string; title?: string; body?: string; channelId?: string; priority?: string; _contentAvailable?: boolean; data: Record<string, any> };
let sent: Sent[] = [];
let server: http.Server;

async function makeUser(id: string, name: string, prefs: Record<string, boolean> = {}) {
  await prisma.user.create({
    data: {
      id, email: `${id}@chatpush.example.test`, name, passwordHash: 'TEST_ONLY', accountStatus: 'active',
      birthday: new Date('2004-01-01'), age: 22, discoveryMode: 'college', discoveryCategory: 'nonbinary', showMeCategories: ['nonbinary'],
      minAgePref: 18, maxAgePref: 40, collegeScope: 'group', preferencesConfirmedAt: new Date(), notificationPrefs: prefs,
    },
  });
}

async function message(data: { content?: string; type?: string; mediaKeys?: string[]; metadata?: object; sentAt?: Date }) {
  const created = await prisma.message.create({
    data: {
      matchId, senderId: riya, content: data.content ?? '', type: data.type ?? 'text', mediaKeys: data.mediaKeys ?? [],
      metadata: data.metadata ?? undefined, sentAt: data.sentAt ?? new Date(),
    },
  });
  await prisma.messageReceipt.create({ data: { messageId: created.id, recipientId: arjun } });
  return created;
}

const toNew = () => sent.filter((item) => item.to === NEW_PHONE);
const toOld = () => sent.filter((item) => item.to === OLD_PHONE);
const setPreviews = (on: boolean) => prisma.user.update({ where: { id: arjun }, data: { notificationPrefs: { message_previews: on } } });

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const items = JSON.parse(body) as Sent[];
      sent.push(...items);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: items.map(() => ({ status: 'ok', id: randomUUID() })) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.EXPO_PUSH_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push`;
  await makeUser(riya, 'Riya Sen');
  await makeUser(arjun, 'Arjun Das', { message_previews: true });
  await PushService.register(arjun, NEW_PHONE, 'android', ['chat_v2']);
  await PushService.register(arjun, OLD_PHONE, 'android');
  matchId = (await prisma.match.create({ data: { user1Id: riya, user2Id: arjun } })).id;
});

beforeEach(() => { sent = []; });

after(async () => {
  server.close();
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(${ID_COLUMNS})`;
  const messageIds = (await prisma.message.findMany({ where: { matchId }, select: { id: true } })).map((m) => m.id);
  await prisma.messageReceipt.deleteMany({ where: { messageId: { in: messageIds } } });
  const ids = [...users, matchId, ...messageIds];
  for (let pass = 0; pass < 6; pass++) {
    for (const { table_name, column_name } of columns) {
      if (table_name === 'users') continue;
      await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1::uuid[])`, ids).catch(() => undefined);
    }
  }
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test('the chat payload: everything with previews on, only "a message" with them off', async () => {
  const text = await message({ content: 'x'.repeat(800) });
  const on = await ChatNotificationService.payload(arjun, text.id);
  assert.equal(on?.type, 'chat');
  assert.equal(on?.kind, 'text');
  assert.equal(on?.sender?.name, 'Riya Sen');
  assert.equal(on?.text?.length, 500, 'cut at 500');
  assert.equal(on?.newMatch, true, 'first message after the match');

  await setPreviews(false);
  const off = await ChatNotificationService.payload(arjun, text.id);
  assert.equal(off?.previews, false);
  assert.equal(off?.sender, undefined);
  assert.equal(off?.text, undefined);
  await setPreviews(true);

  const voice = await message({ type: 'voice', mediaKeys: [`chat-media-approved/${matchId}/${randomUUID()}.m4a`], metadata: { durationSeconds: 12.4 } });
  const voicePayload = await ChatNotificationService.payload(arjun, voice.id);
  assert.equal(voicePayload?.kind, 'voice');
  assert.equal(voicePayload?.media?.durationSec, 12);
  assert.equal(voicePayload?.newMatch, undefined);
  assert.equal(voicePayload?.text, undefined, 'never the duration as text');
  assert.deepEqual(ChatNotificationService.legacyText(voicePayload, { title: 'x', body: 'y' }), { title: 'Riya Sen', body: '🎤 Voice message' });

  const doc = await message({ type: 'document', mediaKeys: [`chat-media-approved/${matchId}/${randomUUID()}.pdf`], metadata: { document: { fileName: 'notes.pdf', mimeType: 'application/pdf', size: 2_200_000 } } });
  const docPayload = await ChatNotificationService.payload(arjun, doc.id);
  assert.equal(docPayload?.kind, 'document');
  assert.equal(docPayload?.media?.fileName, 'notes.pdf');
  // Nothing for the sender's own message.
  assert.equal(await ChatNotificationService.payload(riya, doc.id), null);
});

test('a new phone gets data to draw; an old phone gets a ready-made notification', async () => {
  const text = await message({ content: 'canteen at 2?' });
  const native = await ChatNotificationService.payload(arjun, text.id);
  await PushService.send(arjun, {
    ...ChatNotificationService.legacyText(native, { title: 'New message', body: 'x' }),
    data: { url: `iemdating://chat/${matchId}`, matchId }, category: 'messages', kind: 'message', native: native!,
  }, undefined, { now: AFTERNOON });
  const [drawn] = toNew();
  const [ready] = toOld();
  assert.equal(drawn.title, undefined, 'data only');
  assert.equal(drawn.priority, 'high');
  assert.equal(drawn.data.type, 'chat');
  assert.equal(drawn.data.kind, 'text', "the payload's kind, not the push's");
  assert.equal(drawn.data.text, 'canteen at 2?');
  assert.equal(drawn.data.userId, arjun);
  assert.ok(drawn.data.pushId);
  assert.equal(ready.title, 'Riya Sen');
  assert.equal(ready.body, 'canteen at 2?');
  assert.equal(ready.channelId, 'messages');
});

test('quiet hours: a chat message is never held - it arrives silently', async () => {
  await prisma.user.update({ where: { id: arjun }, data: { notificationPrefs: { message_previews: true, quiet_messages: true } } });
  const text = await message({ content: 'good night' });
  const native = await ChatNotificationService.payload(arjun, text.id);
  await PushService.send(arjun, { title: 'Riya Sen', body: 'good night', data: { matchId }, category: 'messages', kind: 'message', native: native! }, undefined, { now: QUIET });
  assert.equal(await prisma.pushQueue.count({ where: { userId: arjun } }), 0, 'not held');
  assert.equal(toNew()[0].data.silent, true);
  assert.equal(toOld()[0].channelId, 'picks', 'the quiet channel on old phones');
  assert.equal(toOld()[0].sound ?? null, null);
  await setPreviews(true);
});

test('updates and clears go at normal priority, to the right phones', async () => {
  await ChatNotificationService.sendUpdate(arjun, { action: 'delete', matchId, messageId: randomUUID() });
  assert.equal(toNew().length, 1);
  assert.equal(toOld().length, 0, 'old phones have nothing to update');
  assert.equal(toNew()[0].priority, 'normal');
  assert.equal(toNew()[0].data.type, 'chat_update');
  sent = [];
  await PushService.clear(arjun, { matchId, end: true });
  assert.equal(sent.length, 2);
  for (const item of sent) {
    assert.equal(item.priority, 'normal', 'Firebase downgrades high-priority pushes that show nothing');
    assert.equal(item.data.end, true);
  }
});

test('played receipts: once, only by the listener, only for voice', async () => {
  const voice = await message({ type: 'voice', mediaKeys: [`chat-media-approved/${matchId}/${randomUUID()}.m4a`], metadata: { durationSeconds: 5 } });
  await assert.rejects(ChatService.markPlayed(matchId, riya, voice.id), /unavailable/i, 'not by the sender');
  const first = await ChatService.markPlayed(matchId, arjun, voice.id);
  assert.equal(first.played, true);
  const again = await ChatService.markPlayed(matchId, arjun, voice.id);
  assert.equal(again.played, false);
  const receipt = await prisma.messageReceipt.findUniqueOrThrow({ where: { messageId_recipientId: { messageId: voice.id, recipientId: arjun } } });
  assert.ok(receipt.playedAt);
  assert.equal(await prisma.chatEvent.count({ where: { matchId, type: 'message.played', entityId: voice.id } }), 1);
  const text = await message({ content: 'hi' });
  await assert.rejects(ChatService.markPlayed(matchId, arjun, text.id), /unavailable/i, 'not a voice message');
});

test('the push action token: works for its phone and session, nowhere else', async () => {
  const jti = randomUUID();
  await prisma.userSession.create({ data: { userId: arjun, tokenJti: jti, familyId: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) } });
  const token = await PushActionTokenService.issue(arjun, jti, NEW_PHONE);
  assert.ok(token);
  assert.equal((await PushActionTokenService.verify(token!))?.userId, arjun);
  // Never a sign-in token.
  assert.throws(() => verifyAccessToken(token!));
  // Not for a phone that isn't registered.
  assert.equal(await PushActionTokenService.issue(arjun, jti, 'ExponentPushToken[nope]'), null);
  // Logged out (session revoked): dead.
  await prisma.userSession.update({ where: { tokenJti: jti }, data: { revokedAt: new Date() } });
  assert.equal(await PushActionTokenService.verify(token!), null);
  await prisma.userSession.update({ where: { tokenJti: jti }, data: { revokedAt: null } });
  assert.ok(await PushActionTokenService.verify(token!));
  // The phone removed (logout deletes it): dead.
  await PushService.unregister(arjun, NEW_PHONE);
  assert.equal(await PushActionTokenService.verify(token!), null);
  await PushService.register(arjun, NEW_PHONE, 'android', ['chat_v2']);
});

test("encrypted pushes: Google sees only ciphertext; the phone's key opens it", async () => {
  const key = crypto.randomBytes(32);
  await PushService.register(arjun, NEW_PHONE, 'android', ['chat_v2'], key.toString('base64'));
  const stored = await prisma.deviceToken.findFirstOrThrow({ where: { token: NEW_PHONE } });
  assert.ok(stored.pushKey?.startsWith('v1.'), 'kept sealed');
  assert.ok(!stored.pushKey!.includes(key.toString('base64')), 'never stored as given');

  const text = await message({ content: 'a secret 🤫' });
  const native = await ChatNotificationService.payload(arjun, text.id);
  await PushService.send(arjun, { title: 'Riya Sen', body: 'a secret 🤫', data: { matchId }, category: 'messages', kind: 'message', native: native! }, undefined, { now: AFTERNOON });
  const [push] = toNew();
  assert.deepEqual(Object.keys(push.data).sort(), ['ct', 'iv', 'type', 'v']);
  assert.equal(push.data.type, 'enc');
  assert.ok(!JSON.stringify(push).includes('secret'), 'no text in the clear');
  // What the phone does (PushCrypto.kt): AES-256-GCM, tag at the end.
  const body = Buffer.from(push.data.ct, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(push.data.iv, 'base64'));
  decipher.setAuthTag(body.subarray(body.length - 16));
  const opened = JSON.parse(Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]).toString('utf8'));
  assert.equal(opened.type, 'chat');
  assert.equal(opened.text, 'a secret 🤫');
  assert.equal(opened.userId, arjun);
  // Old phones still get the ready-made notification.
  assert.equal(toOld()[0].title, 'Riya Sen');

  // A huge message still fits a push once encrypted.
  sent = [];
  const long = await message({ content: '🔥'.repeat(500) });
  const big = await ChatNotificationService.payload(arjun, long.id);
  await PushService.send(arjun, { title: 'Riya Sen', body: 'x', data: { matchId }, category: 'messages', kind: 'message', native: big! }, undefined, { now: AFTERNOON });
  assert.ok(Buffer.byteLength(JSON.stringify(toNew()[0].data)) < 3900, 'under the 4 KB push limit');

  await PushService.register(arjun, NEW_PHONE, 'android', ['chat_v2']);
});
