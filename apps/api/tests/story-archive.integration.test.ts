/**
 * Integration tests for Stories, Part 3: the Archive (STORY_ARCHIVE_SPEC.md).
 * No Highlights - removed by decision, see the spec.
 *
 * Non-destructive: creates its own users and Stories under random ids and
 * deletes exactly those rows, the same pattern as story-audience.integration.test.ts.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { StoryService } from '../src/services/story.service';
import { StoryArchiveService } from '../src/services/story-archive.service';
import { StoryReplyCardService } from '../src/services/story-reply-card.service';
import { StoryVisibilityService } from '../src/services/story-visibility.service';

const owner = randomUUID();
const follower = randomUUID();
const stranger = randomUUID();
const users = [owner, follower, stranger];

const ID_COLUMNS = [
  'id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'follower_id', 'followee_id', 'author_id', 'aggregate_id', 'actor_id',
  'blocker_id', 'blocked_id', 'friend_id', 'hidden_user_id', 'user1_id', 'user2_id', 'creator_id', 'thread_id', 'mentioned_user_id',
];

/** A Story published `minutesAgo` minutes ago, ending `endedMinutesAgo` minutes ago (default: still live). */
async function story(ownerId: string, options: { publishedMinutesAgo: number; endedMinutesAgo?: number; archive?: boolean; state?: string }) {
  const asset = await prisma.storyMediaAsset.create({
    data: {
      ownerId, objectKey: `stories-approved/${ownerId}/${randomUUID()}.jpg`, contentType: 'image/jpeg',
      maxBytes: 1024, status: 'attached', expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const publishedAt = new Date(Date.now() - options.publishedMinutesAgo * 60_000);
  const expiresAt = options.endedMinutesAgo !== undefined
    ? new Date(Date.now() - options.endedMinutesAgo * 60_000)
    : new Date(publishedAt.getTime() + 24 * 60 * 60_000);
  return prisma.story.create({
    data: {
      ownerId, assetId: asset.id, clientPublishId: randomUUID(), publishedAt, expiresAt,
      archive: options.archive ?? true, state: options.state ?? 'published',
    },
  });
}

const unavailable = (error: any) => error?.code === 'STORY_UNAVAILABLE';

let liveOwn: { id: string };
let endedArchived: { id: string };
let endedNotArchived: { id: string };
let endedDeleted: { id: string };

before(async () => {
  await prisma.user.createMany({
    data: users.map((id, index) => ({
      id,
      email: `${id}@story-archive.example.test`,
      name: ['Owner', 'Follower', 'Stranger'][index],
      passwordHash: 'TEST_ONLY',
      accountStatus: 'active',
      birthday: new Date('2003-01-01'),
      storiesEnabled: true,
    })),
  });
  await prisma.follow.create({ data: { followerId: follower, followeeId: owner, status: 'accepted' } });
  liveOwn = await story(owner, { publishedMinutesAgo: 5 });
  endedArchived = await story(owner, { publishedMinutesAgo: 60 * 25, endedMinutesAgo: 60, archive: true });
  endedNotArchived = await story(owner, { publishedMinutesAgo: 60 * 25, endedMinutesAgo: 60, archive: false });
  endedDeleted = await story(owner, { publishedMinutesAgo: 60 * 25, endedMinutesAgo: 60, archive: true, state: 'deleted' });
});

after(async () => {
  const storyIds = (await prisma.story.findMany({ where: { ownerId: { in: users } }, select: { id: true } })).map((row) => row.id);
  const ids = [...users, ...storyIds];
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

test('an ended Story is private to its owner - nobody else can reach it, however recently it ended', async () => {
  // The owner can still open it: this is what makes the Archive work at all.
  assert.equal((await StoryService.get(owner, endedArchived.id)).id, endedArchived.id);
  assert.ok((await StoryService.readUrl(owner, endedArchived.id)).url);

  // A follower who could see it live loses access the moment it ends. No
  // Highlights means no exception - this is the whole point of section 10.3.
  await assert.rejects(StoryService.get(follower, endedArchived.id), unavailable);
  await assert.rejects(StoryService.readUrl(follower, endedArchived.id), unavailable);
  await assert.rejects(StoryService.get(stranger, endedArchived.id), unavailable);
});

test('canSeeEnded refuses a deleted Story even for its own owner', () => {
  assert.equal(StoryVisibilityService.canSeeEnded(owner, { ownerId: owner, audience: 'followers', state: 'deleted' }), false);
  assert.equal(StoryVisibilityService.canSeeEnded(owner, { ownerId: owner, audience: 'followers', state: 'published' }), true);
  assert.equal(StoryVisibilityService.canSeeEnded(follower, { ownerId: owner, audience: 'followers', state: 'published' }), false);
});

test('a deleted Story never reopens for its owner either', async () => {
  await assert.rejects(StoryService.get(owner, endedDeleted.id), unavailable);
});

test('the Archive lists only ended, archived Stories - not live ones, not ones posted with the setting off', async () => {
  const { items } = await StoryArchiveService.list(owner);
  const ids = items.map((item) => item.id);
  assert.ok(ids.includes(endedArchived.id));
  assert.ok(!ids.includes(liveOwn.id), 'a live Story is in the tray, not the Archive');
  assert.ok(!ids.includes(endedNotArchived.id), 'archive: false is never listed');
  assert.ok(!ids.includes(endedDeleted.id));
});

test('a non-archived Story that has ended is still reachable by its owner directly, just never listed', async () => {
  // It survives until the 72-hour purge job removes it (section 12); "archive"
  // controls listing and eventual deletion, not immediate owner access.
  assert.equal((await StoryService.get(owner, endedNotArchived.id)).id, endedNotArchived.id);
});

test('a Story card in chat resolves for the owner after it ends, and never for anyone else', async () => {
  const ownerCards = await StoryReplyCardService.cards(owner, [endedArchived.id]);
  assert.equal(ownerCards.get(endedArchived.id)?.available, true);

  const followerCards = await StoryReplyCardService.cards(follower, [endedArchived.id]);
  assert.equal(followerCards.get(endedArchived.id)?.available, false);
});

test('a live Story still works exactly as before through the same card lookup', async () => {
  const cards = await StoryReplyCardService.cards(follower, [liveOwn.id]);
  assert.equal(cards.get(liveOwn.id)?.available, true);
});
