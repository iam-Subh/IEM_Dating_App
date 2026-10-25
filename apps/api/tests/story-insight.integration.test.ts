/**
 * Integration tests for Stories, Part 3 Phase B: Insights and reactions/
 * replies in Activity (STORY_ARCHIVE_SPEC.md, sections 7-8).
 *
 * Non-destructive: creates its own users, a match, and Stories under random
 * ids and deletes exactly those rows.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { StoryService } from '../src/services/story.service';
import { StoryInsightService } from '../src/services/story-insight.service';

const owner = randomUUID();
const matched = randomUUID();
const stranger = randomUUID();
const users = [owner, matched, stranger];

const ID_COLUMNS = [
  'id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'follower_id', 'followee_id', 'author_id', 'aggregate_id', 'actor_id',
  'blocker_id', 'blocked_id', 'friend_id', 'hidden_user_id', 'user1_id', 'user2_id', 'creator_id', 'thread_id', 'mentioned_user_id',
  'sender_id',
];

async function story(ownerId: string, minutesAgo = 5) {
  const asset = await prisma.storyMediaAsset.create({
    data: {
      ownerId, objectKey: `stories-approved/${ownerId}/${randomUUID()}.jpg`, contentType: 'image/jpeg',
      maxBytes: 1024, status: 'attached', expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const publishedAt = new Date(Date.now() - minutesAgo * 60_000);
  return prisma.story.create({
    data: { ownerId, assetId: asset.id, clientPublishId: randomUUID(), publishedAt, expiresAt: new Date(publishedAt.getTime() + 24 * 60 * 60_000) },
  });
}

let matchId: string;
let liveStory: { id: string };

before(async () => {
  await prisma.user.createMany({
    data: users.map((id, index) => ({
      id, email: `${id}@story-insight.example.test`, name: ['Owner', 'Matched', 'Stranger'][index],
      passwordHash: 'TEST_ONLY', accountStatus: 'active', birthday: new Date('2003-01-01'), storiesEnabled: true,
    })),
  });
  const match = await prisma.match.create({ data: { user1Id: owner, user2Id: matched, status: 'active' } });
  matchId = match.id;
  liveStory = await story(owner);
  // The Activity sheet's viewer rows come from story_views, so the matched
  // viewer needs one before the reaction/reply row test below can find them.
  await StoryService.recordView(matched, liveStory.id);
});

after(async () => {
  const storyIds = (await prisma.story.findMany({ where: { ownerId: { in: users } }, select: { id: true } })).map((row) => row.id);
  const ids = [...users, ...storyIds, matchId];
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

test('events for a Story the viewer cannot see, or their own Story, never move the counters', async () => {
  await StoryInsightService.recordEvents(stranger, randomUUID(), [{ storyId: liveStory.id, forward: 3 }]);
  await StoryInsightService.recordEvents(owner, randomUUID(), [{ storyId: liveStory.id, forward: 3 }]);
  const insight = await StoryInsightService.get(owner, liveStory.id);
  assert.equal(insight.forwardTaps, 0);
});

test('a matched viewer\'s batch increments the right counters, and repeating the same batchId is a no-op', async () => {
  const batchId = randomUUID();
  await StoryInsightService.recordEvents(matched, batchId, [{ storyId: liveStory.id, views: 2, forward: 1, back: 1, nextStory: 1, exited: 1 }]);
  let insight = await StoryInsightService.get(owner, liveStory.id);
  assert.equal(insight.views, 2);
  assert.equal(insight.forwardTaps, 1);
  assert.equal(insight.backTaps, 1);
  assert.equal(insight.nextStory, 1);
  assert.equal(insight.exits, 1);

  // Same batchId again (a retry after a timeout): nothing changes.
  await StoryInsightService.recordEvents(matched, batchId, [{ storyId: liveStory.id, views: 2, forward: 1, back: 1, nextStory: 1, exited: 1 }]);
  insight = await StoryInsightService.get(owner, liveStory.id);
  assert.equal(insight.views, 2);
  assert.equal(insight.forwardTaps, 1);
});

test('lifetime caps hold even across many separate batches', async () => {
  for (let i = 0; i < 5; i += 1) {
    await StoryInsightService.recordEvents(matched, randomUUID(), [{ storyId: liveStory.id, nextStory: 5, exited: 5 }]);
  }
  const insight = await StoryInsightService.get(owner, liveStory.id);
  // nextStory and exited each cap at 10; this batch already had 1 of each from the previous test.
  assert.ok(insight.nextStory <= 10, `nextStory ${insight.nextStory} exceeded its cap`);
  assert.ok(insight.exits <= 10, `exits ${insight.exits} exceeded its cap`);
  assert.equal(insight.nextStory, 10);
  assert.equal(insight.exits, 10);
});

test('a reaction reply must be one of the eight quick reactions, and counts separately from a text reply', async () => {
  await assert.rejects(
    StoryService.reply(matched, liveStory.id, 'not an emoji', randomUUID(), 'reaction'),
    (error: any) => error.code === 'INVALID_STORY_REACTION',
  );
  await StoryService.reply(matched, liveStory.id, '🔥', randomUUID(), 'reaction');
  await StoryService.reply(matched, liveStory.id, 'Love this!', randomUUID(), 'text');
  const insight = await StoryInsightService.get(owner, liveStory.id);
  assert.equal(insight.reactions, 1);
  assert.equal(insight.replies, 1);
});

test('the viewer row shows the most recent reaction emoji and a replied flag', async () => {
  const { items } = await StoryService.viewersPage(owner, liveStory.id);
  const row = items.find((item) => item.viewerId === matched);
  assert.ok(row, 'the matched viewer should have a row from recordView or the replies above');
  assert.equal(row!.reaction, '🔥');
  assert.equal(row!.replied, true);
});

test('unsending the text reply removes it from the row, but the Insight count stays', async () => {
  const message = await prisma.message.findFirst({ where: { matchId, type: 'story_reply', content: 'Love this!' } });
  assert.ok(message);
  await prisma.message.update({ where: { id: message!.id }, data: { isDeleted: true, content: '', deletedForEveryoneAt: new Date() } });
  const { items } = await StoryService.viewersPage(owner, liveStory.id);
  const row = items.find((item) => item.viewerId === matched);
  assert.equal(row!.replied, false);
  assert.equal(row!.reaction, '🔥', 'the reaction message is untouched');
  const insight = await StoryInsightService.get(owner, liveStory.id);
  assert.equal(insight.replies, 1, 'the total does not drop when a message is unsent');
});
