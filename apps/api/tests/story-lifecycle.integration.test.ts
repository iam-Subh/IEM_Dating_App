/**
 * Integration tests for Stories, Part 3 Phase C: the lifecycle worker
 * (STORY_ARCHIVE_SPEC.md, section 12). Calls `StoryLifecycleWorker.sweep()`
 * directly, bypassing the `STORY_LIFECYCLE_JOBS` flag (which only gates
 * `start()`'s timer, not `sweep()` itself), against fake object keys that
 * were never uploaded, so the S3 deletes are harmless no-ops.
 *
 * Non-destructive: creates its own users and Stories under random ids and
 * deletes exactly those rows.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { StoryService } from '../src/services/story.service';
import { StoryInsightService } from '../src/services/story-insight.service';
import { StoryLifecycleWorker } from '../src/services/story-lifecycle.worker';

const owner = randomUUID();
const viewer = randomUUID();
const users = [owner, viewer];

const ID_COLUMNS = [
  'id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'follower_id', 'followee_id', 'author_id', 'aggregate_id', 'actor_id',
  'blocker_id', 'blocked_id', 'friend_id', 'hidden_user_id', 'user1_id', 'user2_id', 'creator_id', 'thread_id', 'mentioned_user_id',
];

async function story(options: { publishedHoursAgo: number; archive?: boolean; state?: string }) {
  const asset = await prisma.storyMediaAsset.create({
    data: {
      ownerId: owner, objectKey: `stories-approved/${owner}/${randomUUID()}.jpg`, contentType: 'image/jpeg',
      maxBytes: 1024, status: 'attached', expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const publishedAt = new Date(Date.now() - options.publishedHoursAgo * 60 * 60_000);
  return prisma.story.create({
    data: {
      ownerId: owner, assetId: asset.id, clientPublishId: randomUUID(), publishedAt,
      expiresAt: new Date(publishedAt.getTime() + 24 * 60 * 60_000),
      archive: options.archive ?? true, state: options.state ?? 'published',
      ...(options.state === 'deleted' ? { deletedAt: new Date() } : {}),
    },
  });
}

before(async () => {
  await prisma.user.createMany({
    data: users.map((id, index) => ({
      id, email: `${id}@story-lifecycle.example.test`, name: ['Owner', 'Viewer'][index],
      passwordHash: 'TEST_ONLY', accountStatus: 'active', birthday: new Date('2003-01-01'), storiesEnabled: true,
    })),
  });
  // So `viewer` can see and record a view/like on `owner`'s Stories at all.
  await prisma.follow.create({ data: { followerId: viewer, followeeId: owner, status: 'accepted' } });
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

test('a Story younger than 48 hours is left alone', async () => {
  const fresh = await story({ publishedHoursAgo: 10 });
  await StoryService.recordView(viewer, fresh.id);
  await StoryLifecycleWorker.sweep();
  const reloaded = await prisma.story.findUniqueOrThrow({ where: { id: fresh.id } });
  assert.equal(reloaded.viewersClosedAt, null);
  const views = await prisma.storyView.count({ where: { storyId: fresh.id } });
  assert.equal(views, 1, 'the view row is untouched before 48 hours');
});

test('freeze: at 48 hours, the viewer list and likes move into story_insights and their rows are deleted', async () => {
  const old = await story({ publishedHoursAgo: 50 });
  // Recorded directly: by the time a Story is old enough to freeze it has
  // already expired for a day, so the live, expiry-gated recordView/setLike
  // API (exercised elsewhere) can no longer be used - this simulates a view
  // and a like that genuinely happened while the Story was still live.
  await prisma.storyView.create({ data: { storyId: old.id, viewerId: viewer } });
  await prisma.storyLike.create({ data: { storyId: old.id, viewerId: viewer } });

  await StoryLifecycleWorker.sweep();

  const reloaded = await prisma.story.findUniqueOrThrow({ where: { id: old.id } });
  assert.ok(reloaded.viewersClosedAt, 'viewersClosedAt should now be set');

  const [views, likes] = await Promise.all([
    prisma.storyView.count({ where: { storyId: old.id } }),
    prisma.storyLike.count({ where: { storyId: old.id } }),
  ]);
  assert.equal(views, 0, 'story_views rows are deleted once frozen');
  assert.equal(likes, 0, 'story_likes rows are deleted once frozen');

  const insight = await prisma.storyInsight.findUniqueOrThrow({ where: { storyId: old.id } });
  assert.equal(insight.reach, 1);
  assert.equal(insight.likes, 1);

  // Both read paths agree the list is closed, not merely empty.
  const page = await StoryService.viewersPage(owner, old.id);
  assert.deepEqual(page, { items: [], nextCursor: null, closed: true });
  const insights = await StoryInsightService.get(owner, old.id);
  assert.equal(insights.closed, true);
  assert.equal(insights.reach, 1);
  assert.equal(insights.likes, 1);
});

test('freeze never touches a Story younger than 48 hours, even when older ones exist', async () => {
  const fresh = await story({ publishedHoursAgo: 5 });
  await StoryLifecycleWorker.sweep();
  const reloaded = await prisma.story.findUniqueOrThrow({ where: { id: fresh.id } });
  assert.equal(reloaded.viewersClosedAt, null);
});

test('running the sweep twice in a row freezes nothing the second time', async () => {
  const old = await story({ publishedHoursAgo: 60 });
  const first = await StoryLifecycleWorker.sweep();
  assert.ok(first.frozen >= 1);
  const before2 = await prisma.story.findUniqueOrThrow({ where: { id: old.id } });
  const second = await StoryLifecycleWorker.sweep();
  const after2 = await prisma.story.findUniqueOrThrow({ where: { id: old.id } });
  assert.deepEqual(after2.viewersClosedAt, before2.viewersClosedAt, 'freezing again does not move the timestamp');
});

test('purge: a Story posted with the archive off is purged once 72 hours have passed, not before', async () => {
  const notYet = await story({ publishedHoursAgo: 70, archive: false });
  const due = await story({ publishedHoursAgo: 73, archive: false });

  await StoryLifecycleWorker.sweep();

  const notYetReloaded = await prisma.story.findUniqueOrThrow({ where: { id: notYet.id } });
  assert.equal(notYetReloaded.state, 'published');
  assert.equal(notYetReloaded.purgedAt, null);

  const dueReloaded = await prisma.story.findUniqueOrThrow({ where: { id: due.id } });
  assert.equal(dueReloaded.state, 'purged');
  assert.ok(dueReloaded.purgedAt);
});

test('purge never touches an archived Story, however old', async () => {
  const old = await story({ publishedHoursAgo: 200, archive: true });
  await StoryLifecycleWorker.sweep();
  const reloaded = await prisma.story.findUniqueOrThrow({ where: { id: old.id } });
  assert.equal(reloaded.state, 'published');
  assert.equal(reloaded.purgedAt, null);
});

test('a deleted Story has its media purged promptly, with no 72-hour wait, and keeps state: deleted', async () => {
  const removed = await story({ publishedHoursAgo: 1, state: 'deleted' });
  await StoryLifecycleWorker.sweep();
  const reloaded = await prisma.story.findUniqueOrThrow({ where: { id: removed.id } });
  assert.equal(reloaded.state, 'deleted');
  assert.ok(reloaded.purgedAt, 'a deleted Story is purged without waiting for 72 hours');
});

test('the owner can still open their own ended, archived Story after the freeze - the Archive keeps working', async () => {
  const old = await story({ publishedHoursAgo: 51 });
  await StoryLifecycleWorker.sweep();
  const opened = await StoryService.get(owner, old.id);
  assert.equal(opened.id, old.id);
});
