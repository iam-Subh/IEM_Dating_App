import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { ChatService } from '../src/services/chat.service';
import { FollowService } from '../src/services/follow.service';
import { StoryService } from '../src/services/story.service';
import { redisClient } from '../src/utils/redis';
import { AccountEventService } from '../src/services/account-event.service';
import { ChatMediaService } from '../src/services/chat-media.service';
import { followRequestSchema } from '../src/schemas/story.schema';
import { s3Client } from '../src/middlewares/upload.middleware';
import { PrivateMediaInspectionService } from '../src/services/private-media-inspection.service';
import { MatchAccessService } from '../src/services/match-access.service';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/reco_test' || url.port !== '55439') {
  throw new Error('Chat and Story tests require the isolated localhost:55439/reco_test database');
}

const userA = randomUUID();
const userB = randomUUID();
const outsider = randomUUID();
let matchId = '';
let storyId = '';

before(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE delivery_attempts, account_events, chat_device_cursors, outbox_events, notifications, chat_events, message_reactions, message_visibility, message_receipts, chat_participants, chat_media_assets, story_views, stories, story_media_assets, story_preferences, follows, student_memberships, chat_sessions, messages, matches, user_sessions, user_scores, user_blocks, users CASCADE');
  await prisma.institution.deleteMany({ where: { code: 'CHAT_TEST' } });
  const institution = await prisma.institution.create({ data: { code: 'CHAT_TEST', name: 'Chat Test College', allowedDomains: ['chat.test'] } });
  await prisma.user.createMany({ data: [userA, userB, outsider].map((id, index) => ({
    id, email: `${id}@chat.test`, name: `User ${index}`, passwordHash: 'TEST_ONLY', accountStatus: 'active',
    birthday: new Date('2003-01-01'), college: 'Chat Test College', discoveryCategory: index % 2 === 0 ? 'woman' : 'man', showMeCategories: index % 2 === 0 ? ['man'] : ['woman'],
    minAgePref: 18, maxAgePref: 30, discoveryMode: 'college', preferencesConfirmedAt: new Date(), storiesEnabled: true, allowFollowRequests: true,
  })) });
  await prisma.studentMembership.createMany({ data: [userA, userB, outsider].map((id) => ({ userId: id, institutionId: institution.id, institutionalEmail: `${id}@chat.test`, status: 'verified', verifiedAt: new Date() })) });
  const match = await prisma.match.create({ data: { user1Id: userA, user2Id: userB } });
  matchId = match.id;
});

after(async () => { await prisma.$disconnect(); redisClient.disconnect(); });

test('follow requests require explicit identity-disclosure acceptance', () => {
  assert.equal(followRequestSchema.safeParse({ body: { userId: userB } }).success, false);
  assert.equal(followRequestSchema.safeParse({ body: { userId: userB, disclosureAccepted: false } }).success, false);
  assert.equal(followRequestSchema.safeParse({ body: { userId: userB, disclosureAccepted: true } }).success, true);
});

test('message retries conflict when one client identifier has different content', async () => {
  const clientMessageId = randomUUID();
  const first = await ChatService.sendMessage(userA, matchId, 'First', undefined, [], clientMessageId);
  const repeated = await ChatService.sendMessage(userA, matchId, 'First', undefined, [], clientMessageId);
  assert.equal(repeated.id, first.id);
  await assert.rejects(() => ChatService.sendMessage(userA, matchId, 'Changed', undefined, [], clientMessageId), (error: any) => error.code === 'IDEMPOTENCY_MISMATCH');
});

test('chat mutations create ordered replay and keep delete-for-me private', async () => {
  const message = await ChatService.sendMessage(userB, matchId, 'Private message', undefined, [], randomUUID());
  await ChatService.setReaction(matchId, message.id, userA, '❤️');
  await ChatService.markAsRead(matchId, userA, [message.id]);
  await ChatService.deleteMessage(matchId, message.id, userA, 'me');
  const ownEvents = await ChatService.getEvents(userA, matchId, 0, 200);
  const peerEvents = await ChatService.getEvents(userB, matchId, 0, 200);
  assert.ok(ownEvents.events.some((event) => event.type === 'message.hidden'));
  assert.ok(!peerEvents.events.some((event) => event.type === 'message.hidden'));
  assert.ok(ownEvents.events.every((event, index, values) => index === 0 || event.eventSeq > values[index - 1].eventSeq));
});

test('partial and out-of-order receipts preserve unread counts, progress, and delivery time', async () => {
  const isolatedMatch = await prisma.match.create({ data: { user1Id: userA, user2Id: outsider } });
  const first = await ChatService.sendMessage(userA, isolatedMatch.id, 'First receipt', undefined, [], randomUUID());
  const second = await ChatService.sendMessage(userA, isolatedMatch.id, 'Second receipt', undefined, [], randomUUID());
  await ChatService.markDelivered(isolatedMatch.id, outsider, [second.id]);
  await ChatService.markDelivered(isolatedMatch.id, outsider, [first.id]);
  const earlierDelivery = new Date('2026-01-01T00:00:00Z');
  await prisma.messageReceipt.updateMany({ where: { messageId: first.id }, data: { deliveredAt: earlierDelivery } });
  await ChatService.markAsRead(isolatedMatch.id, outsider, [second.id]);
  let participant = await prisma.chatParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId: isolatedMatch.id, userId: outsider } } });
  assert.equal(participant.unreadCount, 1);
  assert.equal(participant.lastDeliveredMessageSeq, second.messageSeq);
  await ChatService.markAsRead(isolatedMatch.id, outsider, [first.id]);
  participant = await prisma.chatParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId: isolatedMatch.id, userId: outsider } } });
  assert.equal(participant.unreadCount, 0);
  assert.equal(participant.lastReadMessageSeq, second.messageSeq);
  assert.equal(participant.lastDeliveredMessageSeq, second.messageSeq);
  const receipt = await prisma.messageReceipt.findFirstOrThrow({ where: { messageId: first.id, recipientId: outsider } });
  assert.equal(receipt.deliveredAt?.toISOString(), earlierDelivery.toISOString());
  assert.equal((await ChatService.markAsRead(isolatedMatch.id, outsider, [first.id])).markedCount, 0);
});

test('replay recovers message content but excludes hidden and deleted message bodies', async () => {
  const message = await ChatService.sendMessage(userA, matchId, 'Reconnect recovery', undefined, [], randomUUID());
  const findCreated = async (userId: string) => (await ChatService.getEvents(userId, matchId, 0, 200)).events.find((event) => event.type === 'message.created' && event.entityId === message.id);
  assert.equal((await findCreated(userB))?.payload && ((await findCreated(userB))!.payload as any).message.content, 'Reconnect recovery');
  await ChatService.deleteMessage(matchId, message.id, userB, 'me');
  assert.equal(((await findCreated(userB))!.payload as any).message, null);
  assert.equal(((await findCreated(userA))!.payload as any).message.content, 'Reconnect recovery');
  await ChatService.deleteMessage(matchId, message.id, userA, 'everyone');
  assert.equal(((await findCreated(userA))!.payload as any).message, null);
});

test('recovery preserves all supported reaction characters', async () => {
  const message = await ChatService.sendMessage(userA, matchId, 'Reaction recovery', undefined, [], randomUUID());
  for (const emoji of ['❤️', '👍', '😂', '😮', '😢', '🔥']) {
    assert.equal((await ChatService.setReaction(matchId, message.id, userB, emoji)).emoji, emoji);
  }
  const stored = await prisma.messageReaction.findMany({ where: { messageId: message.id, userId: userB } });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].emoji, '🔥');

  const removed = await ChatService.setReaction(matchId, message.id, userB, null);
  assert.equal(removed.emoji, null);
  assert.equal(await prisma.messageReaction.count({ where: { messageId: message.id, userId: userB } }), 0);
  const replay = await ChatService.getEvents(userA, matchId, 0, 200);
  assert.ok(replay.events.some((event) => event.type === 'reaction.removed' && event.entityId === message.id));
});

test('edit rechecks deletion after the initial message lookup', async (context) => {
  const message = await ChatService.sendMessage(userA, matchId, 'Delete before edit', undefined, [], randomUUID());
  const original = MatchAccessService.requireMessage.bind(MatchAccessService);
  context.mock.method(MatchAccessService, 'requireMessage', async (userId: string, roomId: string, messageId: string) => {
    const snapshot = await original(userId, roomId, messageId);
    await prisma.message.update({ where: { id: messageId }, data: { isDeleted: true, content: '', deletedForEveryoneAt: new Date() } });
    return snapshot;
  });
  try {
    await assert.rejects(() => ChatService.updateMessage(matchId, message.id, userA, 'Must not return'), (error: any) => error.code === 'MESSAGE_DELETED');
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).content, '');
  } finally { context.mock.restoreAll(); }
});

test('attachment retries preserve set ordering and normalized message type', async () => {
  const keys = [randomUUID(), randomUUID()].map((id) => `chat-media-approved/${matchId}/${id}.jpg`);
  for (const objectKey of keys) await prisma.chatMediaAsset.create({ data: { ownerId: userA, matchId, objectKey, contentType: 'image/jpeg', maxBytes: 1000, status: 'uploaded', expiresAt: new Date(Date.now() + 60_000) } });
  const clientId = randomUUID();
  const first = await ChatService.sendMessage(userA, matchId, 'Photos', undefined, keys, clientId);
  const retry = await ChatService.sendMessage(userA, matchId, 'Photos', undefined, [...keys].reverse(), clientId, { type: 'media' });
  assert.equal(retry.id, first.id);
});

test('special metadata property names remain part of the fingerprint', async () => {
  const clientId = randomUUID();
  const metadata = JSON.parse('{"__proto__":{"flag":1}}');
  await ChatService.sendMessage(userA, matchId, 'Metadata', undefined, [], clientId, { metadata });
  await assert.rejects(() => ChatService.sendMessage(userA, matchId, 'Metadata', undefined, [], clientId, { metadata: {} }), (error: any) => error.code === 'IDEMPOTENCY_MISMATCH');
});

test('account events are ordered and device replay cursors are monotonic', async () => {
  const accountEvents = await AccountEventService.list(userA, 0, 200);
  assert.ok(accountEvents.events.length > 0);
  assert.ok(accountEvents.events.every((event, index, values) => index === 0 || event.accountSeq > values[index - 1].accountSeq));
  const deviceId = `device_${randomUUID().replace(/-/g, '')}`;
  const highWater = (await prisma.chatSession.findUniqueOrThrow({ where: { matchId } })).lastEventSeq;
  await AccountEventService.saveDeviceCursor(userA, matchId, deviceId, highWater);
  await AccountEventService.saveDeviceCursor(userA, matchId, deviceId, 3);
  const cursor = await prisma.chatDeviceCursor.findUniqueOrThrow({ where: { userId_deviceId_matchId: { userId: userA, deviceId, matchId } } });
  assert.equal(cursor.lastAppliedEventSeq, highWater);
  await assert.rejects(() => AccountEventService.saveDeviceCursor(userA, matchId, deviceId, highWater + 1), (error: any) => error.code === 'DEVICE_CURSOR_AHEAD');
  await assert.rejects(() => AccountEventService.saveDeviceCursor(outsider, matchId, deviceId, 0), (error: any) => error.code === 'MATCH_UNAVAILABLE');
});

test('follow approval gates the Story feed and access', async () => {
  const follow = await FollowService.request(userA, userB);
  const asset = await prisma.storyMediaAsset.create({ data: { ownerId: userB, objectKey: `stories/${userB}/${randomUUID()}.jpg`, contentType: 'image/jpeg', maxBytes: 1000, status: 'ready', expiresAt: new Date(Date.now() + 60_000) } });
  const story = await StoryService.publish(userB, { assetId: asset.id, clientPublishId: randomUUID(), caption: 'Private story' });
  storyId = story.id;
  assert.equal((await StoryService.feed(userA)).length, 0);
  await assert.rejects(() => StoryService.get(userA, story.id), (error: any) => error.code === 'STORY_UNAVAILABLE');
  await FollowService.respond(userB, follow.id, true);
  assert.equal((await StoryService.feed(userA))[0].id, story.id);
  assert.equal((await StoryService.get(userA, story.id)).id, story.id);
  await assert.rejects(() => StoryService.get(outsider, story.id), (error: any) => error.code === 'STORY_UNAVAILABLE');
});

test('Story views are idempotent and viewer lists are owner-only', async () => {
  await StoryService.recordView(userA, storyId);
  await StoryService.recordView(userA, storyId);
  assert.equal(await prisma.storyView.count({ where: { storyId, viewerId: userA } }), 1);
  assert.equal((await StoryService.viewers(userB, storyId)).length, 1);
  const page = await StoryService.viewersPage(userB, storyId, undefined, 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].viewer?.id, userA);
  await assert.rejects(() => StoryService.viewers(userA, storyId), (error: any) => error.code === 'STORY_UNAVAILABLE');
});

test('only a match can reply to an approved follower Story', async () => {
  const reply = await StoryService.reply(userA, storyId, 'Story reply', randomUUID());
  assert.equal(reply.type, 'story_reply');
  assert.equal(reply.storyId, storyId);
  await FollowService.request(outsider, userB);
  const request = await prisma.follow.findUniqueOrThrow({ where: { followerId_followeeId: { followerId: outsider, followeeId: userB } } });
  await FollowService.respond(userB, request.id, true);
  await assert.rejects(() => StoryService.reply(outsider, storyId, 'No match', randomUUID()), (error: any) => error.code === 'STORY_REPLY_REQUIRES_MATCH');
});

test('storage failures leave upload completion retryable and wrong-owner completion is denied', async (context) => {
  const previousBucket = process.env.AWS_PRIVATE_MEDIA_BUCKET;
  process.env.AWS_PRIVATE_MEDIA_BUCKET = 'isolated-test-bucket';
  try {
    const asset = await prisma.chatMediaAsset.create({ data: {
      ownerId: userA, matchId, objectKey: `chat-media/${matchId}/${randomUUID()}.jpg`,
      contentType: 'image/jpeg', maxBytes: 1000, expiresAt: new Date(Date.now() + 60_000),
    } });
    const beforeCount = await prisma.chatMediaAsset.count();
    delete process.env.AWS_PRIVATE_MEDIA_BUCKET;
    await assert.rejects(() => ChatMediaService.generateUploadUrl(userA, matchId, 'jpg'), /AWS_PRIVATE_MEDIA_BUCKET/);
    assert.equal(await prisma.chatMediaAsset.count(), beforeCount);
    process.env.AWS_PRIVATE_MEDIA_BUCKET = 'isolated-test-bucket';
    const send = context.mock.method(s3Client, 'send', async () => { throw new Error('Storage timeout'); });
    await assert.rejects(() => ChatMediaService.completeUpload(userB, matchId, asset.id), (error: any) => error.code === 'MEDIA_UPLOAD_UNAVAILABLE');
    assert.equal(send.mock.callCount(), 0);
    await assert.rejects(() => ChatMediaService.completeUpload(userA, matchId, asset.id), (error: any) => error.code === 'MEDIA_STORAGE_UNAVAILABLE');
    assert.equal((await prisma.chatMediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, 'requested');
    send.mock.mockImplementation(async () => { throw Object.assign(new Error('Missing object'), { name: 'NotFound' }); });
    await assert.rejects(() => ChatMediaService.completeUpload(userA, matchId, asset.id), (error: any) => error.code === 'MEDIA_UPLOAD_MISSING');
    assert.equal((await prisma.chatMediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, 'requested');
    send.mock.mockImplementation(async () => ({ ContentLength: 100, ContentType: 'image/jpeg' }) as any);
    const detect = context.mock.method(PrivateMediaInspectionService, 'detect', async () => { throw new Error('Read timeout'); });
    await assert.rejects(() => ChatMediaService.completeUpload(userA, matchId, asset.id), (error: any) => error.code === 'MEDIA_STORAGE_UNAVAILABLE');
    assert.equal((await prisma.chatMediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, 'requested');
    detect.mock.mockImplementation(async () => null);
    await assert.rejects(() => ChatMediaService.completeUpload(userA, matchId, asset.id), (error: any) => error.code === 'MEDIA_UPLOAD_INVALID');
    assert.equal((await prisma.chatMediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status, 'rejected');
  } finally {
    context.mock.restoreAll();
    if (previousBucket === undefined) delete process.env.AWS_PRIVATE_MEDIA_BUCKET;
    else process.env.AWS_PRIVATE_MEDIA_BUCKET = previousBucket;
  }
});

test('media completion reports processing and returns completed assets idempotently', async () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const processingChat = await prisma.chatMediaAsset.create({
    data: { matchId, ownerId: userA, objectKey: `chat-media/${matchId}/${randomUUID()}.jpg`, contentType: 'image/jpeg', maxBytes: 1000, status: 'processing', expiresAt },
  });
  await assert.rejects(
    () => ChatMediaService.completeUpload(userA, matchId, processingChat.id),
    (error: any) => error.code === 'MEDIA_PROCESSING_IN_PROGRESS',
  );
  const completedChat = await prisma.chatMediaAsset.create({
    data: {
      matchId,
      ownerId: userA,
      objectKey: `chat-media-approved/${matchId}/${randomUUID()}.jpg`,
      contentType: 'image/jpeg',
      maxBytes: 1000,
      status: 'uploaded',
      thumbnailObjectKey: `chat-media-approved/${matchId}/${randomUUID()}.thumbnail.jpg`,
      processedAt: new Date(),
      expiresAt,
    },
  });
  const chatResult = await ChatMediaService.completeUpload(userA, matchId, completedChat.id);
  assert.equal(chatResult.mediaKey, completedChat.objectKey);

  const processingStory = await prisma.storyMediaAsset.create({
    data: { ownerId: userB, objectKey: `stories/${userB}/${randomUUID()}.jpg`, contentType: 'image/jpeg', maxBytes: 1000, status: 'processing', expiresAt },
  });
  await assert.rejects(
    () => StoryService.completeUpload(userB, processingStory.id),
    (error: any) => error.code === 'STORY_PROCESSING_IN_PROGRESS',
  );
  const completedStory = await prisma.storyMediaAsset.create({
    data: { ownerId: userB, objectKey: `stories-approved/${userB}/${randomUUID()}.jpg`, contentType: 'image/jpeg', maxBytes: 1000, status: 'ready', processedAt: new Date(), expiresAt },
  });
  const storyResult = await StoryService.completeUpload(userB, completedStory.id);
  assert.equal(storyResult.id, completedStory.id);
  assert.equal(storyResult.status, 'ready');
});

test('unmatch revokes follow-based Story access through the contact-ending service', async () => {
  const { MatchService } = await import('../src/services/match.service');
  await MatchService.unmatch(userA, matchId);
  await assert.rejects(() => ChatMediaService.generateUploadUrl(userA, matchId), (error: any) => error.code === 'MATCH_UNAVAILABLE');
  await assert.rejects(() => ChatMediaService.completeUpload(userA, matchId, randomUUID()), (error: any) => error.code === 'MATCH_UNAVAILABLE');
  await assert.rejects(() => ChatMediaService.generateReadUrl(userA, `chat-media-approved/${matchId}/${randomUUID()}.jpg`), (error: any) => error.code === 'MATCH_UNAVAILABLE');
  await assert.rejects(() => StoryService.get(userA, storyId), (error: any) => error.code === 'STORY_UNAVAILABLE');
  const events = await AccountEventService.list(userA, 0, 200);
  assert.ok(events.events.some((event) => event.type === 'access.revoked' && event.matchId === matchId));
});
