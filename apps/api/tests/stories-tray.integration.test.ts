/**
 * Integration tests for the Stories tray and Story likes.
 *
 * Non-destructive: creates its own users, follows and Stories under random ids
 * and deletes exactly those rows. Media rows are written directly, since the
 * tray never reads the objects themselves.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { StoryService } from '../src/services/story.service';

const me = randomUUID();
const alice = randomUUID();
const bob = randomUUID();
const stranger = randomUUID();
const users = [me, alice, bob, stranger];

const ID_COLUMNS = ['id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'follower_id', 'followee_id', 'author_id', 'aggregate_id', 'actor_id', 'blocker_id', 'blocked_id'];

async function story(ownerId: string, minutesAgo: number) {
  const asset = await prisma.storyMediaAsset.create({
    data: {
      ownerId, objectKey: `stories-approved/${ownerId}/${randomUUID()}.jpg`, contentType: 'image/jpeg',
      maxBytes: 1024, status: 'attached', expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const publishedAt = new Date(Date.now() - minutesAgo * 60_000);
  return prisma.story.create({
    data: {
      ownerId, assetId: asset.id, clientPublishId: randomUUID(), publishedAt,
      expiresAt: new Date(publishedAt.getTime() + 24 * 60 * 60_000),
    },
  });
}

let aliceFirst: { id: string };
let aliceSecond: { id: string };
let bobOnly: { id: string };
let mine: { id: string };
let strangers: { id: string };

before(async () => {
  await prisma.user.createMany({
    data: users.map((id, index) => ({
      id,
      email: `${id}@stories-tray.example.test`,
      name: ['Me', 'Alice', 'Bob', 'Stranger'][index],
      passwordHash: 'TEST_ONLY',
      accountStatus: 'active',
      birthday: new Date('2003-01-01'),
      storiesEnabled: true,
    })),
  });
  await prisma.follow.createMany({
    data: [
      { followerId: me, followeeId: alice, status: 'accepted' },
      { followerId: me, followeeId: bob, status: 'accepted' },
      { followerId: alice, followeeId: me, status: 'accepted' },
    ],
  });
  aliceFirst = await story(alice, 50);
  aliceSecond = await story(alice, 40);
  bobOnly = await story(bob, 5);
  mine = await story(me, 30);
  strangers = await story(stranger, 1);
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

test('the tray shows you first, then unseen people newest first, then people you have watched', async () => {
  await StoryService.recordView(me, bobOnly.id);
  await StoryService.recordView(me, aliceFirst.id);

  const { groups } = await StoryService.tray(me);
  assert.deepEqual(groups.map((group) => group.owner.id), [me, alice, bob], 'a stranger is not in the tray');

  const [own, aliceGroup, bobGroup] = groups;
  assert.equal(own.isOwn, true);
  assert.equal(own.hasUnseen, false, 'your own Stories are never unseen');
  assert.deepEqual(own.stories.map((item) => item.id), [mine.id]);

  assert.deepEqual(aliceGroup.stories.map((item) => item.id), [aliceFirst.id, aliceSecond.id], 'oldest first, as played');
  assert.equal(aliceGroup.hasUnseen, true);
  assert.equal(aliceGroup.firstUnseenIndex, 1, 'opens at the first Story not yet seen');
  assert.deepEqual(aliceGroup.stories.map((item) => item.seen), [true, false]);

  assert.equal(bobGroup.hasUnseen, false, 'Bob moves to the end once watched, despite posting most recently');
  assert.equal(bobGroup.firstUnseenIndex, 0);
  void strangers;
});

test('a like is private to the author: it shows in the tray for the liker and in the viewer list for the author', async () => {
  assert.deepEqual(await StoryService.setLike(me, aliceSecond.id, true), { liked: true });
  await StoryService.setLike(me, aliceSecond.id, true); // idempotent
  await StoryService.recordView(me, aliceSecond.id);

  const { groups } = await StoryService.tray(me);
  const aliceGroup = groups.find((group) => group.owner.id === alice)!;
  assert.deepEqual(aliceGroup.stories.map((item) => item.liked), [false, true]);
  assert.equal(aliceGroup.hasUnseen, false);

  const viewers = await StoryService.viewersPage(alice, aliceSecond.id);
  assert.equal(viewers.items.find((row) => row.viewerId === me)?.liked, true);

  const aliceTray = await StoryService.tray(alice);
  const aliceOwn = aliceTray.groups[0];
  assert.equal(aliceOwn.isOwn, true);
  const counted = aliceOwn.stories.find((item) => item.id === aliceSecond.id) as { viewCount?: number; likeCount?: number };
  assert.equal(counted.viewCount, 1);
  assert.equal(counted.likeCount, 1);

  assert.deepEqual(await StoryService.setLike(me, aliceSecond.id, false), { liked: false });
  assert.equal((await StoryService.viewersPage(alice, aliceSecond.id)).items.find((row) => row.viewerId === me)?.liked, false);
});

test('you cannot like your own Story, or one you cannot see', async () => {
  await assert.rejects(StoryService.setLike(me, mine.id, true), (error: any) => error.code === 'INVALID_STORY_LIKE');
  await assert.rejects(StoryService.setLike(me, strangers.id, true), (error: any) => error.code === 'STORY_UNAVAILABLE');
});
