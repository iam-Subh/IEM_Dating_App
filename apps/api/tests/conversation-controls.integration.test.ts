/**
 * Integration tests for the Telegram-style chat controls: any-emoji reactions,
 * reaction pushes, pin, archive, mark as unread, clear history, delete chat and
 * auto-delete.
 *
 * Unlike chat-regression.test.ts this does NOT truncate anything, so it is safe
 * to run against a database that holds real accounts. It creates its own users
 * and matches under fresh random ids and deletes exactly those rows afterwards.
 *
 * A running API server polls the same database with its outbox and expiry
 * workers. Reaction pushes are therefore exercised with synthetic events
 * delivered in-process, and expiry assertions accept either sweeper finishing
 * the job, so neither can race these tests into a false failure.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { ChatService, isSingleEmoji } from '../src/services/chat.service';
import { ConversationControlsService, MAX_PINNED_CONVERSATIONS } from '../src/services/conversation-controls.service';
import { MessageExpiryWorker } from '../src/services/message-expiry.worker';
import { OutboxDeliveryService } from '../src/services/outbox-delivery.service';
import { OUTBOX_TOPICS } from '../src/services/outbox.service';

const me = randomUUID();
const partner = randomUUID();
const extras = Array.from({ length: MAX_PINNED_CONVERSATIONS }, () => randomUUID());
let matchId = '';
const extraMatches: string[] = [];

/** Every uuid column that can point at a row this suite created. */
const ID_COLUMNS = [
  'id', 'user_id', 'match_id', 'message_id', 'sender_id', 'recipient_id', 'actor_id',
  'audience_user_id', 'aggregate_id', 'owner_id', 'user1_id', 'user2_id', 'scope_id',
  'entity_id', 'outbox_event_id',
];

function user(id: string) {
  return {
    id,
    email: `${id}@conversation-controls.example.test`,
    name: `Controls ${id.slice(0, 6)}`,
    passwordHash: 'TEST_ONLY',
    accountStatus: 'active',
    birthday: new Date('2003-01-01'),
  };
}

const row = async (userId: string, folder: 'main' | 'archived' = 'main') =>
  (await ChatService.getConversationsPage(userId, undefined, undefined, 30, folder)).items.find((item) => item.matchId === matchId);

async function removeTestRows() {
  const userIds = [me, partner, ...extras];
  const matchIds = [matchId, ...extraMatches].filter(Boolean);
  const messageIds = (await prisma.message.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } })).map((item) => item.id);
  const eventIds = (await prisma.chatEvent.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } })).map((item) => item.id);
  const seed = [...userIds, ...matchIds, ...messageIds, ...eventIds];
  const outboxIds = (await prisma.outboxEvent.findMany({ where: { aggregateId: { in: seed } }, select: { id: true } })).map((item) => item.id);
  const ids = [...new Set([...seed, ...outboxIds])];
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(${ID_COLUMNS})`;
  // Several passes, because foreign keys decide which deletes can go first.
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
  await prisma.user.createMany({ data: [me, partner, ...extras].map(user) });
  matchId = (await prisma.match.create({ data: { user1Id: me, user2Id: partner, status: 'active' } })).id;
  for (const other of extras) {
    extraMatches.push((await prisma.match.create({ data: { user1Id: me, user2Id: other, status: 'active' } })).id);
  }
});

after(async () => {
  await removeTestRows();
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('a reaction is exactly one emoji', () => {
  for (const valid of ['👍', '❤️', '🥹', '👍🏽', '👨‍👩‍👧‍👦', '🇮🇳', '1️⃣']) {
    assert.equal(isSingleEmoji(valid), true, `should accept ${valid}`);
  }
  for (const invalid of ['', 'a', '1', 'hi', '👍👍', ':)', ' 👍', null, 42]) {
    assert.equal(isSingleEmoji(invalid), false, `should reject ${String(invalid)}`);
  }
});

test('any emoji can be a reaction, only someone else reacting notifies the author, and reactors are listed', async () => {
  const message = await ChatService.sendMessage(me, matchId, 'React to this');
  const result = await ChatService.setReaction(matchId, message.id, partner, '🥹');
  assert.equal(result.emoji, '🥹');
  await assert.rejects(ChatService.setReaction(matchId, message.id, partner, 'hello'), /single emoji/);

  const queued = () => prisma.outboxEvent.count({ where: { topic: OUTBOX_TOPICS.REACTION_ADDED, aggregateId: message.id } });
  assert.equal(await queued(), 1);
  await ChatService.setReaction(matchId, message.id, me, '🔥');
  assert.equal(await queued(), 1, 'reacting to your own message tells nobody');

  const list = await ChatService.listReactions(matchId, message.id, me);
  assert.equal(list.total, 2);
  assert.deepEqual(list.counts.map((count) => count.emoji).sort(), ['🔥', '🥹'].sort());
  assert.equal(list.reactors.find((reactor) => reactor.userId === partner)?.emoji, '🥹');
  assert.equal(list.reactors.find((reactor) => reactor.userId === partner)?.name, user(partner).name);
});

test('a reaction push announces only the reaction that still stands, and respects mute', async () => {
  const message = await ChatService.sendMessage(me, matchId, 'Push check');
  await ChatService.setReaction(matchId, message.id, partner, '😮');
  const deliver = async (emoji: string) => {
    const id = randomUUID();
    await OutboxDeliveryService.deliver({
      id, topic: OUTBOX_TOPICS.REACTION_ADDED, aggregateId: message.id, payloadVersion: 1,
      payload: { reactorId: partner, emoji },
    });
    return id;
  };

  const stale = await deliver('😂');
  assert.equal(await prisma.notification.count({ where: { deliveryKey: `${stale}:${me}` } }), 0, 'a replaced reaction is not announced');

  const live = await deliver('😮');
  const sent = await prisma.notification.findUniqueOrThrow({ where: { deliveryKey: `${live}:${me}` } });
  assert.equal(sent.body, 'Reacted 😮 to your message');
  assert.ok(sent.pushSentAt, 'an author who has not muted the chat is pushed');

  await ChatService.setMuted(matchId, me, new Date(Date.now() + 60 * 60 * 1000));
  const muted = await deliver('😮');
  const held = await prisma.notification.findUniqueOrThrow({ where: { deliveryKey: `${muted}:${me}` } });
  assert.equal(held.pushSentAt, null, 'a muted author is not pushed');
  await ChatService.setMuted(matchId, me, null);
});

test('pinned chats lead the list, newest pin first, and are limited per folder', async () => {
  for (const id of extraMatches) await ConversationControlsService.setPinned(me, id, true);
  await assert.rejects(ConversationControlsService.setPinned(me, matchId, true), /pin up to/);

  await ConversationControlsService.setPinned(me, extraMatches[0], false);
  await ConversationControlsService.setPinned(me, matchId, true);
  const items = (await ChatService.getConversationsPage(me)).items;
  const pinnedCount = items.filter((item) => item.pinned).length;
  assert.equal(items[0].matchId, matchId, 'the newest pin comes first');
  assert.ok(items.slice(0, pinnedCount).every((item) => item.pinned), 'every pinned chat precedes every unpinned one');

  for (const id of [matchId, ...extraMatches]) await ConversationControlsService.setPinned(me, id, false);
});

test('an incoming message brings an archived chat back, unless the chat is muted', async () => {
  await ConversationControlsService.setArchived(me, matchId, true);
  assert.equal(await row(me), undefined, 'archived chats leave the main list');
  assert.ok(await row(me, 'archived'), 'and appear in the archive');
  assert.ok((await ChatService.getConversationsPage(me)).archivedCount >= 1);

  await ChatService.setMuted(matchId, me, new Date(Date.now() + 60 * 60 * 1000));
  await ChatService.sendMessage(partner, matchId, 'Still archived');
  assert.equal((await ConversationControlsService.getSettings(me, matchId)).archived, true, 'a muted chat stays archived');

  await ChatService.setMuted(matchId, me, null);
  await ChatService.sendMessage(partner, matchId, 'Back you come');
  assert.equal((await ConversationControlsService.getSettings(me, matchId)).archived, false);
});

test('mark as unread stays until the chat is read', async () => {
  await ConversationControlsService.setMarkedUnread(me, matchId, true);
  assert.equal((await row(me))?.markedUnread, true);
  await ChatService.markAsRead(matchId, me);
  assert.equal((await row(me))?.markedUnread, false);
});

test('clearing history hides it for this user only, everywhere it could surface', async () => {
  const cleared = await ChatService.sendMessage(partner, matchId, 'findable-before-clear');
  await ConversationControlsService.clear(me, matchId, { forEveryone: false, deleteChat: false });

  assert.equal((await ChatService.getMessages(matchId, me)).messages.length, 0);
  assert.ok((await ChatService.getMessages(matchId, partner)).messages.some((m) => m.id === cleared.id), 'the other person keeps their history');
  assert.equal((await ChatService.searchMessages(matchId, me, 'findable-before-clear')).length, 0);
  assert.equal((await ChatService.searchAllMessages(me, 'findable-before-clear')).length, 0);
  await assert.rejects(ChatService.messageContext(matchId, cleared.id, me), /unavailable/);
  assert.equal((await row(me))?.lastMessage, null);
  assert.equal((await row(me))?.unreadCount, 0);

  const later = await ChatService.sendMessage(partner, matchId, 'after the clear');
  assert.deepEqual((await ChatService.getMessages(matchId, me)).messages.map((m) => m.id), [later.id]);
});

test('clearing for everyone empties both sides', async () => {
  await ChatService.sendMessage(me, matchId, 'both sides');
  await ConversationControlsService.clear(partner, matchId, { forEveryone: true, deleteChat: false });
  assert.equal((await ChatService.getMessages(matchId, me)).messages.length, 0);
  assert.equal((await ChatService.getMessages(matchId, partner)).messages.length, 0);
});

test('a deleted chat stays out of the list until something new is said', async () => {
  await ChatService.sendMessage(partner, matchId, 'before delete');
  await ConversationControlsService.clear(me, matchId, { forEveryone: false, deleteChat: true });
  assert.equal(await row(me), undefined);
  assert.ok(await row(partner), 'deleting for yourself leaves theirs');

  await new Promise((resolve) => setTimeout(resolve, 5));
  await ChatService.sendMessage(partner, matchId, 'hello again');
  assert.ok(await row(me));
});

test('auto-delete stamps new messages, hides them on time, and the sweep removes them exactly once', async () => {
  await assert.rejects(ConversationControlsService.setMessageTtl(me, matchId, 30), /out of range/);

  const unreadBefore = (await row(partner))?.unreadCount ?? 0;
  const set = await ConversationControlsService.setMessageTtl(me, matchId, 60);
  assert.equal(set.changed, true);
  assert.equal((await ConversationControlsService.setMessageTtl(partner, matchId, 60)).changed, false, 'the same value records nothing');
  assert.equal((await row(partner))?.unreadCount, unreadBefore, 'a service notice is never unread');

  const notice = await prisma.message.findUniqueOrThrow({ where: { id: (set as { noticeId: string }).noticeId } });
  assert.equal(notice.type, 'service');
  assert.deepEqual(notice.metadata, { action: 'ttl.changed', seconds: 60 });
  assert.equal(notice.expiresAt, null, 'the notice itself does not disappear');
  await assert.rejects(ChatService.setReaction(matchId, notice.id, partner, '👍'), /cannot be reacted/);

  const sentAt = Date.now();
  const doomed = await ChatService.sendMessage(me, matchId, 'self-destructing');
  const stamped = await prisma.message.findUniqueOrThrow({ where: { id: doomed.id } });
  const lifetime = stamped.expiresAt!.getTime() - sentAt;
  assert.ok(Math.abs(lifetime - 60_000) < 5_000, `expected about 60s, got ${lifetime}ms`);

  await prisma.message.update({ where: { id: doomed.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await ChatService.getMessages(matchId, partner)).messages.some((m) => m.id === doomed.id), false, 'hidden the moment its deadline passes');

  await MessageExpiryWorker.sweep();
  const swept = await prisma.message.findUniqueOrThrow({ where: { id: doomed.id } });
  assert.equal(swept.isDeleted, true);
  assert.equal(swept.content, '');
  assert.equal(
    await prisma.chatEvent.count({ where: { matchId, entityId: doomed.id, type: 'message.deleted' } }),
    1,
    'announced exactly once, whichever sweeper got there',
  );

  await ConversationControlsService.setMessageTtl(me, matchId, null);
  const kept = await ChatService.sendMessage(me, matchId, 'permanent');
  assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: kept.id } })).expiresAt, null);
});
