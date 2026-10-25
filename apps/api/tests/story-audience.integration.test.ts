/**
 * Integration tests for Stories, Part 2: who can see a Story and who can
 * respond (STORY_AUDIENCE_SPEC.md).
 *
 * Non-destructive: creates its own users, follows, a match, lists and Stories
 * under random ids and deletes exactly those rows. Media rows are written
 * directly, since visibility never reads the objects themselves.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { StoryService } from '../src/services/story.service';
import { StoryStickerService } from '../src/services/story-sticker.service';
import { StoryAudienceService } from '../src/services/story-audience.service';
import { StoryReplyCardService } from '../src/services/story-reply-card.service';

const owner = randomUUID();
const follower = randomUUID();
const matched = randomUUID();
const friend = randomUUID();
const hidden = randomUUID();
const blocked = randomUUID();
const stranger = randomUUID();
const other = randomUUID();
const users = [owner, follower, matched, friend, hidden, blocked, stranger, other];
const threadId = randomUUID();

const ID_COLUMNS = [
  'id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'follower_id', 'followee_id', 'author_id', 'aggregate_id', 'actor_id',
  'blocker_id', 'blocked_id', 'friend_id', 'hidden_user_id', 'user1_id', 'user2_id', 'creator_id', 'thread_id', 'mentioned_user_id',
];

async function story(ownerId: string, minutesAgo: number, audience: 'followers' | 'close_friends' = 'followers') {
  const asset = await prisma.storyMediaAsset.create({
    data: {
      ownerId, objectKey: `stories-approved/${ownerId}/${randomUUID()}.jpg`, contentType: 'image/jpeg',
      maxBytes: 1024, status: 'attached', expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const publishedAt = new Date(Date.now() - minutesAgo * 60_000);
  return prisma.story.create({
    data: {
      ownerId, assetId: asset.id, clientPublishId: randomUUID(), publishedAt, audience,
      expiresAt: new Date(publishedAt.getTime() + 24 * 60 * 60_000),
    },
  });
}

const unavailable = (error: any) => error?.code === 'STORY_UNAVAILABLE';

let ownerPublic: { id: string };
let ownerPrivate: { id: string };
let otherPublic: { id: string };

before(async () => {
  await prisma.user.createMany({
    data: users.map((id, index) => ({
      id,
      email: `${id}@story-audience.example.test`,
      name: ['Owner', 'Follower', 'Matched', 'Friend', 'Hidden', 'Blocked', 'Stranger', 'Other'][index],
      passwordHash: 'TEST_ONLY',
      accountStatus: 'active',
      birthday: new Date('2003-01-01'),
      storiesEnabled: true,
    })),
  });
  // Verified students: before verifying, mentions reach matches only (GOOGLE_SIGNUP_PLAN.md 2.7).
  const institution = await prisma.institution.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  await prisma.studentMembership.createMany({
    data: users.map((id) => ({ userId: id, institutionId: institution.id, institutionalEmail: `${id}@story-audience.example.test`, status: 'verified', verifiedAt: new Date() })),
  });
  await prisma.follow.createMany({
    data: [
      { followerId: follower, followeeId: owner, status: 'accepted' },
      { followerId: friend, followeeId: owner, status: 'accepted' },
      { followerId: hidden, followeeId: owner, status: 'accepted' },
      { followerId: blocked, followeeId: owner, status: 'accepted' },
      { followerId: friend, followeeId: other, status: 'accepted' },
    ],
  });
  await prisma.match.create({ data: { user1Id: owner, user2Id: matched, status: 'active' } });
  await prisma.storyCloseFriend.create({ data: { ownerId: owner, friendId: friend } });
  await StoryAudienceService.hide(owner, hidden);
  await prisma.userBlock.create({ data: { blockerId: owner, blockedId: blocked } });
  ownerPublic = await story(owner, 30);
  ownerPrivate = await story(owner, 20, 'close_friends');
  otherPublic = await story(other, 1);
});

after(async () => {
  const storyIds = (await prisma.story.findMany({ where: { ownerId: { in: users } }, select: { id: true } })).map((row) => row.id);
  const ids = [...users, ...storyIds, threadId];
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
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('followers and matches see "Your story"; strangers, hidden and blocked people do not', async () => {
  for (const viewer of [follower, matched, friend]) {
    assert.equal((await StoryService.get(viewer, ownerPublic.id)).id, ownerPublic.id);
  }
  for (const viewer of [stranger, hidden, blocked]) {
    await assert.rejects(StoryService.get(viewer, ownerPublic.id), unavailable);
    await assert.rejects(StoryService.readUrl(viewer, ownerPublic.id), unavailable);
  }
});

test('a Close Friends story reaches only the list, and looks exactly like a deleted one to everyone else', async () => {
  assert.equal((await StoryService.get(friend, ownerPrivate.id)).id, ownerPrivate.id);
  for (const viewer of [follower, matched, stranger]) {
    await assert.rejects(StoryService.get(viewer, ownerPrivate.id), unavailable);
  }
  const hiddenError = await StoryService.get(follower, ownerPrivate.id).catch((error) => error);
  const missingError = await StoryService.get(follower, randomUUID()).catch((error) => error);
  assert.deepEqual([hiddenError.statusCode ?? hiddenError.status, hiddenError.code, hiddenError.message], [missingError.statusCode ?? missingError.status, missingError.code, missingError.message]);

  // Hiding wins over Close Friends.
  await prisma.storyCloseFriend.create({ data: { ownerId: owner, friendId: hidden } });
  await assert.rejects(StoryService.get(hidden, ownerPrivate.id), unavailable);
  await prisma.storyCloseFriend.deleteMany({ where: { ownerId: owner, friendId: hidden } });

  const followerTray = await StoryService.tray(follower);
  const ownerForFollower = followerTray.groups.find((group) => group.owner.id === owner)!;
  assert.deepEqual(ownerForFollower.stories.map((item) => item.id), [ownerPublic.id]);
  assert.equal(ownerForFollower.closeFriendsUnseen, false);

  const friendTray = await StoryService.tray(friend);
  const ownerForFriend = friendTray.groups.find((group) => group.owner.id === owner)!;
  assert.deepEqual(ownerForFriend.stories.map((item) => [item.id, item.audience]), [[ownerPublic.id, 'followers'], [ownerPrivate.id, 'close_friends']]);
  assert.equal(ownerForFriend.closeFriendsUnseen, true);
});

test('a person whose only live stories are Close Friends ones does not appear at all', async () => {
  await prisma.story.update({ where: { id: ownerPublic.id }, data: { audience: 'close_friends' } });
  try {
    const tray = await StoryService.tray(follower);
    assert.equal(tray.groups.some((group) => group.owner.id === owner), false);
  } finally {
    await prisma.story.update({ where: { id: ownerPublic.id }, data: { audience: 'followers' } });
  }
});

test('people with an unseen Close Friends story come first in the tray', async () => {
  const before = await StoryService.tray(friend);
  assert.deepEqual(before.groups.map((group) => group.owner.id), [owner, other], 'Close Friends first, though Other posted more recently');
  await StoryService.recordView(friend, ownerPublic.id);
  await StoryService.recordView(friend, ownerPrivate.id);
  const afterWatching = await StoryService.tray(friend);
  assert.deepEqual(afterWatching.groups.map((group) => group.owner.id), [other, owner], 'once watched, the usual order returns');
  await prisma.storyView.deleteMany({ where: { viewerId: friend } });
  void otherPublic;
});

test('a close friend who stops following loses access at once, and their list row stays, flagged', async () => {
  await prisma.follow.updateMany({ where: { followerId: friend, followeeId: owner }, data: { status: 'removed' } });
  try {
    await assert.rejects(StoryService.get(friend, ownerPrivate.id), unavailable);
    await assert.rejects(StoryService.get(friend, ownerPublic.id), unavailable);
    const list = await StoryAudienceService.list(owner, 'close_friends');
    assert.deepEqual(list.people.map((person) => [person.id, person.inAudience]), [[friend, false]]);
  } finally {
    await prisma.follow.updateMany({ where: { followerId: friend, followeeId: owner }, data: { status: 'accepted' } });
  }
});

test("a match ends, and so does that person's access", async () => {
  await prisma.match.updateMany({ where: { user1Id: owner, user2Id: matched }, data: { status: 'unmatched' } });
  try {
    await assert.rejects(StoryService.get(matched, ownerPublic.id), unavailable);
  } finally {
    await prisma.match.updateMany({ where: { user1Id: owner, user2Id: matched }, data: { status: 'active' } });
  }
});

test('muting leaves the author out of your tray, but their stories still open', async () => {
  await StoryService.mute(follower, owner, true);
  try {
    const tray = await StoryService.tray(follower);
    assert.equal(tray.groups.some((group) => group.owner.id === owner), false);
    assert.equal((await StoryService.get(follower, ownerPublic.id)).id, ownerPublic.id);
    assert.deepEqual((await StoryAudienceService.muted(follower)).people.map((person) => person.id), [owner]);
  } finally {
    await StoryService.mute(follower, owner, false);
  }
});

test('replies: off refuses everyone, Close Friends admits only matches on the list, matches need a match', async () => {
  try {
    await prisma.user.update({ where: { id: owner }, data: { storyReplies: 'off' } });
    assert.deepEqual(pick(await StoryService.get(matched, ownerPublic.id)), { canReply: false, replyBlockedReason: 'off' });
    await assert.rejects(StoryService.reply(matched, ownerPublic.id, 'hi', randomUUID()), (error: any) => error.code === 'STORY_REPLIES_OFF');

    await prisma.user.update({ where: { id: owner }, data: { storyReplies: 'close_friends' } });
    assert.deepEqual(pick(await StoryService.get(matched, ownerPublic.id)), { canReply: false, replyBlockedReason: 'off' }, 'looks like off, so the list stays private');
    await assert.rejects(StoryService.reply(matched, ownerPublic.id, 'hi', randomUUID()), (error: any) => error.code === 'STORY_REPLIES_OFF');
    await prisma.storyCloseFriend.create({ data: { ownerId: owner, friendId: matched } });
    assert.deepEqual(pick(await StoryService.get(matched, ownerPublic.id)), { canReply: true, replyBlockedReason: null });
    await prisma.storyCloseFriend.deleteMany({ where: { ownerId: owner, friendId: matched } });
    assert.deepEqual(pick(await StoryService.get(friend, ownerPublic.id)), { canReply: false, replyBlockedReason: 'not_matched' }, 'a close friend still needs a match to chat');

    await prisma.user.update({ where: { id: owner }, data: { storyReplies: 'matches' } });
    assert.deepEqual(pick(await StoryService.get(matched, ownerPublic.id)), { canReply: true, replyBlockedReason: null });
    assert.deepEqual(pick(await StoryService.get(follower, ownerPublic.id)), { canReply: false, replyBlockedReason: 'not_matched' });
    assert.deepEqual(pick(await StoryService.get(owner, ownerPublic.id)), { canReply: false, replyBlockedReason: 'own' });

    const matchedTray = await StoryService.tray(matched);
    assert.equal(matchedTray.groups.find((group) => group.owner.id === owner)?.canReply, true);
  } finally {
    await prisma.user.update({ where: { id: owner }, data: { storyReplies: 'matches' } });
    await prisma.storyCloseFriend.deleteMany({ where: { ownerId: owner, friendId: matched } });
  }
});

function pick(value: { canReply: boolean; replyBlockedReason: string | null }) {
  return { canReply: value.canReply, replyBlockedReason: value.replyBlockedReason };
}

test("mentions follow the story's audience and the mentioned person's own setting", async () => {
  const everyone = [follower, matched, friend, hidden, stranger, blocked];
  try {
    assert.deepEqual(sorted(await StoryStickerService.mentionableIds(owner, 'followers', everyone)), sorted([follower, matched, friend]));
    assert.deepEqual(sorted(await StoryStickerService.mentionableIds(owner, 'close_friends', everyone)), [friend]);

    await prisma.user.update({ where: { id: friend }, data: { storyMentions: 'off' } });
    assert.deepEqual(sorted(await StoryStickerService.mentionableIds(owner, 'close_friends', everyone)), []);

    await prisma.user.update({ where: { id: friend }, data: { storyMentions: 'following' } });
    await prisma.user.update({ where: { id: matched }, data: { storyMentions: 'following' } });
    assert.deepEqual(
      sorted(await StoryStickerService.mentionableIds(owner, 'followers', everyone)),
      sorted([follower, friend]),
      'a match who does not follow you, and only allows people they follow, drops out',
    );
    await assert.rejects(StoryStickerService.assertMentionable(owner, [stranger]), (error: any) => error.code === 'STORY_MENTION_NOT_ALLOWED');
    await assert.rejects(StoryStickerService.assertMentionable(owner, [follower], 'close_friends'), (error: any) => error.code === 'STORY_MENTION_NOT_ALLOWED');
  } finally {
    await prisma.user.updateMany({ where: { id: { in: [friend, matched] } }, data: { storyMentions: 'everyone' } });
  }
});

function sorted(ids: Iterable<string>) {
  return [...ids].sort();
}

test('Close Friends are chosen from your audience, and hiding someone takes them off the list', async () => {
  await assert.rejects(StoryAudienceService.addCloseFriend(owner, stranger), (error: any) => error.code === 'CLOSE_FRIEND_NOT_IN_AUDIENCE');
  await assert.rejects(StoryAudienceService.addCloseFriend(owner, blocked), (error: any) => error.code === 'CLOSE_FRIEND_NOT_IN_AUDIENCE');
  await assert.rejects(StoryAudienceService.addCloseFriend(owner, hidden), (error: any) => error.code === 'CLOSE_FRIEND_NOT_IN_AUDIENCE');
  await assert.rejects(StoryAudienceService.addCloseFriend(owner, owner), (error: any) => error.code === 'CLOSE_FRIEND_INVALID');

  await StoryAudienceService.addCloseFriend(owner, follower);
  await StoryAudienceService.addCloseFriend(owner, follower); // idempotent
  const people = await StoryAudienceService.people(owner, 'close_friends', '');
  const ids = people.people.map((person) => person.id);
  assert.equal(people.people.filter((person) => person.onList).length, 2);
  assert.deepEqual(sorted(ids.slice(0, 2)), sorted([friend, follower]), 'people on the list come first');
  assert.equal(ids.includes(stranger) || ids.includes(blocked) || ids.includes(hidden), false);
  assert.equal(people.people.find((person) => person.id === matched)?.isMatch, true);

  await StoryAudienceService.hide(owner, follower);
  assert.equal(await prisma.storyCloseFriend.count({ where: { ownerId: owner, friendId: follower } }), 0);
  await assert.rejects(StoryService.get(follower, ownerPublic.id), unavailable);
  await StoryAudienceService.unhide(owner, follower);
  assert.equal((await StoryService.get(follower, ownerPublic.id)).id, ownerPublic.id);

  const settings = await StoryAudienceService.settings(owner);
  assert.deepEqual(settings.counts, { closeFriends: 1, hidden: 1, muted: 0, followers: 4, following: 0, followRequests: 0 });
  assert.equal(settings.replies, 'matches');
  assert.equal(settings.screenshotBlock, true);
});

test('an Add Yours thread shows each entry only to people who may see that story', async () => {
  await prisma.storyAddYoursThread.create({ data: { id: threadId, creatorId: other, sourceKey: `test:${threadId}`, prompt: 'Test prompt' } });
  await prisma.storyAddYoursEntry.createMany({
    data: [
      { threadId, storyId: ownerPublic.id, ownerId: owner },
      { threadId, storyId: ownerPrivate.id, ownerId: owner },
    ],
  });
  const forFollower = await StoryService.addYoursThread(follower, threadId);
  assert.deepEqual(forFollower.groups.flatMap((group) => group.stories.map((item) => item.id)), [ownerPublic.id]);
  assert.equal(forFollower.thread.count, 2, 'the count is the whole thread');
  const forFriend = await StoryService.addYoursThread(friend, threadId);
  assert.deepEqual(forFriend.groups.flatMap((group) => group.stories.map((item) => item.id)), [ownerPublic.id, ownerPrivate.id]);
  const forStranger = await StoryService.addYoursThread(stranger, threadId);
  assert.deepEqual(forStranger.groups, []);
});

test('Story cards in chat are unavailable to anyone who may not see the story', { skip: !process.env.AWS_PRIVATE_MEDIA_BUCKET }, async () => {
  const forMatch = await StoryReplyCardService.cards(matched, [ownerPublic.id, ownerPrivate.id, randomUUID()]);
  const cards = [...forMatch.values()];
  assert.equal(cards[0].available, true);
  assert.equal(cards[0].closeFriends, false);
  assert.ok(cards[0].thumbnailUrl);
  assert.deepEqual({ ...cards[1], id: '' }, { id: '', available: false, thumbnailUrl: null, closeFriends: false });
  assert.equal(cards[2].available, false);

  const forFriend = await StoryReplyCardService.cards(friend, [ownerPrivate.id]);
  assert.deepEqual([...forFriend.values()].map((card) => [card.available, card.closeFriends]), [[true, true]]);
});
