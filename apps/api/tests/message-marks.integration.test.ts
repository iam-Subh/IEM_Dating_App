import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/utils/prisma';
import { MessageMarksService } from '../src/services/message-marks.service';
import { ChatEventService } from '../src/services/chat-event.service';

const database = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (!['localhost', '127.0.0.1'].includes(database.hostname) || database.port !== '55439' || database.pathname !== '/reco_test') {
  throw new Error('Message mark tests require the isolated localhost:55439/reco_test database.');
}
const a = randomUUID(), b = randomUUID();
let matchId: string;
const createMessage = (content = 'Meet at the library 👋', extra = {}) => prisma.message.create({ data: { matchId, senderId: a, content, ...extra } });

before(async () => {
  await prisma.user.createMany({ data: [a, b].map(id => ({ id, email: `${id}@marks.example.test`, name: 'Marks test', passwordHash: 'TEST_ONLY', accountStatus: 'active', birthday: new Date('2003-01-01') })) });
  matchId = (await prisma.match.create({ data: { user1Id: a, user2Id: b, status: 'active' } })).id;
});
after(async () => { await prisma.$disconnect(); });

test('stars are private; pins and pin removal are shared; events use the correct audience', async () => {
  const message = await createMessage();
  await MessageMarksService.set(a, matchId, message.id, 'star', true);
  assert.equal((await MessageMarksService.get(a, matchId, message.id)).starred, true);
  assert.equal((await MessageMarksService.get(b, matchId, message.id)).starred, false);
  assert.equal((await MessageMarksService.list(b, matchId, 'star')).some(item => item.id === message.id), false);
  const privateEvents = await ChatEventService.list(b, matchId);
  assert.equal(privateEvents.events.some(event => event.type === 'message.mark_changed'), false);
  await MessageMarksService.set(a, matchId, message.id, 'pin', true);
  assert.equal((await MessageMarksService.get(b, matchId, message.id)).pinned, true);
  const events = await prisma.chatEvent.findMany({ where: { matchId, entityId: message.id }, orderBy: { eventSeq: 'asc' } });
  assert.equal(events[0].audienceUserId, a);
  assert.equal(events[1].audienceUserId, null);
  const count = events.length;
  await MessageMarksService.set(a, matchId, message.id, 'pin', true);
  assert.equal(await prisma.chatEvent.count({ where: { matchId, entityId: message.id } }), count);
  await MessageMarksService.set(b, matchId, message.id, 'pin', false);
  assert.equal((await MessageMarksService.get(a, matchId, message.id)).pinned, false);
});

test('hidden, deleted, expired and cleared messages cannot appear in lists or accept new marks', async () => {
  const hidden = await createMessage('hidden', { hiddenBy: [b] });
  await MessageMarksService.set(a, matchId, hidden.id, 'pin', true);
  await assert.rejects(MessageMarksService.set(b, matchId, hidden.id, 'star', true));
  const expired = await createMessage('expires');
  const deleted = await createMessage('deleted');
  const cleared = await createMessage('cleared', { messageSeq: 1 });
  for (const message of [expired, deleted, cleared]) await MessageMarksService.set(a, matchId, message.id, 'pin', true);
  await prisma.message.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await prisma.message.update({ where: { id: deleted.id }, data: { isDeleted: true } });
  await prisma.chatParticipant.upsert({ where: { matchId_userId: { matchId, userId: b } }, create: { matchId, userId: b, clearedThroughSeq: 1 }, update: { clearedThroughSeq: 1 } });
  const visible = await MessageMarksService.list(b, matchId, 'pin');
  for (const message of [hidden, expired, deleted, cleared]) {
    assert.equal(visible.some(item => item.id === message.id), false);
    await assert.rejects(MessageMarksService.set(b, matchId, message.id, 'star', true));
  }
  await assert.rejects(MessageMarksService.list(randomUUID(), matchId, 'pin'));
});

test('saved messages include typed preview data and page without gaps when timestamps match', async () => {
  const ids = Array.from({ length: 102 }, () => randomUUID());
  await prisma.message.createMany({ data: ids.map(id => ({ id, matchId, senderId: a, content: '5.64', type: 'voice', metadata: { durationSeconds: 5.64 }, mediaKeys: ['chat-media-approved/test/note.wav'] })) });
  await prisma.chatMessageMark.createMany({ data: ids.map(messageId => ({ messageId, scopeId: a, kind: 'star', createdAt: new Date('2026-10-23T12:00:00Z') })) });
  const first = await MessageMarksService.list(a, matchId, 'star');
  assert.equal(first.length, 100);
  const last = first[first.length - 1];
  const second = await MessageMarksService.list(a, matchId, 'star', { at: last.markedAt, id: last.id });
  const all = [...first, ...second];
  assert.equal(new Set(all.map(item => item.id)).size, all.length);
  assert.equal(ids.every(id => all.some(item => item.id === id)), true);
  const voice = all.find(item => ids.includes(item.id)) as any;
  assert.equal(voice.type, 'voice');
  assert.equal(voice.metadata.durationSeconds, 5.64);
  assert.equal(voice.senderId, a);
  assert.ok(voice.sentAt);
});
