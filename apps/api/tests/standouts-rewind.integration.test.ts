/**
 * Integration tests for Standouts and Rewind (EXPLORE_SPEC.md, sections 11, 12
 * and 15).
 *
 * The properties worth testing here are the ones that stop each feature
 * becoming the thing it is deliberately not: Standouts must stay bounded and
 * personalised rather than a leaderboard, and Rewind must stay narrow rather
 * than a way to re-open dismissed profiles.
 *
 * Non-destructive: creates its own users and memberships under random ids and
 * deletes exactly those rows.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { SwipeService } from '../src/services/swipe.service';
import { RoseService } from '../src/services/rose.service';
import { RewindService } from '../src/services/rewind.service';
import { StandoutsService, STANDOUTS_SIZE } from '../src/services/standouts.service';
import { eligibleSql } from '../src/services/eligibility.service';

const viewer = randomUUID();
const other = randomUUID();
/** Enough candidates that a full Standouts set is possible. */
const candidates = Array.from({ length: STANDOUTS_SIZE + 4 }, () => randomUUID());
const users = [viewer, other, ...candidates];

const ID_COLUMNS = [
  'id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'sender_id', 'recipient_id', 'swiper_id', 'target_id',
  'swipe_id', 'candidate_id', 'shown_id', 'user1_id', 'user2_id', 'blocker_id', 'blocked_id', 'follower_id', 'followee_id',
];

async function makeUser(id: string, name: string, category: 'man' | 'woman', showMe: 'man' | 'woman', institutionId: string) {
  await prisma.user.create({
    data: {
      id,
      email: `${id}@standouts.example.test`,
      name,
      passwordHash: 'TEST_ONLY',
      accountStatus: 'active',
      birthday: new Date('2004-01-01'),
      age: 21,
      discoveryMode: 'college',
      discoveryCategory: category,
      showMeCategories: [showMe],
      minAgePref: 18,
      maxAgePref: 30,
      preferencesConfirmedAt: new Date(),
      // A profile field, not an eligibility test: college mode is decided by
      // the verified membership below. One test deliberately misspells it.
      college: 'Standouts Test College',
      department: 'CSE',
      lastActiveAt: new Date(),
      preferences: { interests: ['music', 'chess', 'travel'] },
      // Ready for Standouts (STANDOUTS_PLAN.md 5.1): a playable video and three photos.
      profileVideoUrl: `https://example.test/${id}/video.mp4`,
      videoPlaybackUrl: `https://example.test/${id}/playback.mp4`,
    },
  });
  await prisma.profilePhoto.createMany({
    data: [0, 1, 2].map((order) => ({ userId: id, photoUrl: `https://example.test/${id}/${order}.jpg`, order, isPrimary: order === 0 })),
  });
  await prisma.studentMembership.create({
    data: {
      userId: id,
      institutionId,
      institutionalEmail: `${id}@iem.example.test`,
      status: 'verified',
      verifiedAt: new Date(),
    },
  });
}

/** The day's set is a row per viewer, so a test that wants a fresh one says so. Only this file's viewers. */
async function clearStandoutsCache() {
  await prisma.standoutDay.deleteMany({ where: { viewerId: { in: users } } });
}

before(async () => {
  const institution = await prisma.institution.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  await makeUser(viewer, 'Standouts Viewer', 'man', 'woman', institution.id);
  await makeUser(other, 'Second Viewer', 'man', 'woman', institution.id);
  for (const [index, id] of candidates.entries()) {
    await makeUser(id, `Standout ${index}`, 'woman', 'man', institution.id);
  }
  await clearStandoutsCache();
});

after(async () => {
  // Like notifications about this file's users (the outbox is keyed by swipe, not user).
  await prisma.$executeRaw`DELETE FROM outbox_events WHERE topic = 'like.received' AND payload->>'recipientId' = ANY(${users})`;
  await clearStandoutsCache();
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(${ID_COLUMNS})`;
  for (let pass = 0; pass < 6; pass++) {
    let failures = 0;
    for (const { table_name, column_name } of columns) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1::uuid[])`, users);
      } catch {
        failures += 1;
      }
    }
    if (!failures) break;
  }
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('Standouts is bounded, eligible, and the same set for the whole day', async () => {
  const first = await StandoutsService.today(viewer);
  assert.equal(first.state, 'ok');
  assert.ok(first.cards.length > 0, 'expected a set');
  assert.ok(first.cards.length <= STANDOUTS_SIZE, `expected at most ${STANDOUTS_SIZE}, got ${first.cards.length}`);

  const ids = new Set(first.cards.map((card: any) => card.id));
  assert.equal(ids.size, first.cards.length, 'the same person must not appear twice');
  assert.ok(!ids.has(viewer), 'never yourself');
  assert.ok(!ids.has(other), 'never someone your preferences exclude');

  // Called again the same day, it is the same set in the same order.
  const again = await StandoutsService.today(viewer);
  assert.deepEqual(
    again.cards.map((card: any) => card.id),
    first.cards.map((card: any) => card.id),
  );
});

test('nothing in a Standouts card reports how much attention anyone has', async () => {
  const { cards } = await StandoutsService.today(viewer);
  const forbidden = ['likesReceived', 'totalLikesReceived', 'rosesReceived', 'likeCount', 'roseCount', 'popularity'];
  for (const card of cards as any[]) {
    for (const key of forbidden) {
      assert.ok(!(key in card), `a Standouts card must not carry ${key}`);
    }
  }
});

test('a Standout you have answered drops out of the day\'s set', async () => {
  const before = await StandoutsService.today(viewer);
  const target = (before.cards as any[])[0];
  await SwipeService.perform(viewer, target.id, 'pass');

  const after = await StandoutsService.today(viewer);
  const ids = (after.cards as any[]).map((card) => card.id);
  assert.ok(!ids.includes(target.id), 'an answered Standout is a dead card, not a suggestion');
  // The set is not refilled: the day's picks are fixed.
  assert.equal(after.cards.length, before.cards.length - 1);
});

test('Rewind takes back the last swipe and puts the card back in play', async () => {
  const target = candidates[candidates.length - 1];
  await SwipeService.perform(viewer, target, 'pass');

  const status = await RewindService.available(viewer);
  assert.equal(status.available, true);
  assert.equal(status.targetId, target);
  assert.ok(status.secondsLeft > 0 && status.secondsLeft <= 60);

  const undone = await RewindService.rewind(viewer);
  assert.equal(undone.targetId, target);
  assert.equal(undone.action, 'pass');

  const swipe = await prisma.swipe.findFirst({ where: { swiperId: viewer, targetId: target } });
  assert.equal(swipe, null, 'the swipe row is gone, so the person is undecided again');
});

test('the verified institution decides college mode, not the typed college name', async () => {
  // The defect this pins down: retrieval matched on institution while the
  // swipe gate also compared the free-text `college` string, so a card could
  // be shown and then refused. The string is onboarding text and varies by
  // spelling; the membership is verified.
  const target = candidates[0];
  // Earlier tests swipe whichever people the day's set happened to contain, so
  // each of these clears its own candidates rather than assuming a clean slate.
  await prisma.swipe.deleteMany({ where: { swiperId: viewer, targetId: target } });
  await prisma.user.update({
    where: { id: target },
    data: { college: 'standouts   TEST college' }, // same place, typed differently
  });

  const eligible = await prisma.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM users u WHERE u.id = ${target}::uuid AND ${eligibleSql(
      await prisma.user.findUniqueOrThrow({ where: { id: viewer } }),
    )}`;
  assert.equal(eligible.length, 1, 'retrieval still reaches them');

  const result = await SwipeService.perform(viewer, target, 'pass');
  assert.equal(result.status, 'recorded', 'and the swipe gate agrees, rather than 409-ing');
  await prisma.swipe.deleteMany({ where: { swiperId: viewer, targetId: target } });
});

test('Rewind refuses to undo a swipe the caller did not mean', async () => {
  const first = candidates[1];
  const second = candidates[2];
  await prisma.swipe.deleteMany({ where: { swiperId: viewer, targetId: { in: [first, second] } } });
  await SwipeService.perform(viewer, first, 'pass');
  await SwipeService.perform(viewer, second, 'pass');

  // The app names who it believes it is undoing. `first` is no longer last.
  await assert.rejects(
    () => RewindService.rewind(viewer, first),
    (error: any) => error.code === 'REWIND_TARGET_MISMATCH',
    'undoing the wrong person silently is worse than refusing',
  );
  const stillThere = await prisma.swipe.findFirst({ where: { swiperId: viewer, targetId: second } });
  assert.ok(stillThere, 'and it left the actual last swipe alone');

  const undone = await RewindService.rewind(viewer, second);
  assert.equal(undone.targetId, second);
});

test('a swipe reports its own rewind deadline', async () => {
  const target = candidates[3];
  await prisma.swipe.deleteMany({ where: { swiperId: viewer, targetId: target } });
  const before = Date.now();
  const result: any = await SwipeService.perform(viewer, target, 'pass');
  assert.ok(result.rewindableUntil, 'the app cannot compute this itself without losing the round-trip');
  const until = Date.parse(result.rewindableUntil);
  assert.ok(until > before, 'the window is still open when the response is written');
  assert.ok(until <= Date.now() + 61_000, 'and it is the server window, not an open-ended one');
  await RewindService.rewind(viewer, target);
});

test('Rewind refuses a second undo on the same person', async () => {
  const target = candidates[candidates.length - 1];
  // Same person as the previous test, already rewound once.
  await SwipeService.perform(viewer, target, 'pass');
  assert.equal((await RewindService.available(viewer)).available, false);
  await assert.rejects(
    () => RewindService.rewind(viewer),
    (error: any) => error.code === 'REWIND_ALREADY_USED',
    'swipe-rewind-swipe must not become an unlimited re-examination loop',
  );
});

test('Rewind refuses once the window has passed', async () => {
  const target = candidates[candidates.length - 2];
  await SwipeService.perform(viewer, target, 'pass');
  // Age everything else further back first, so this swipe is unambiguously the
  // most recent one - Rewind only ever considers the latest.
  await prisma.swipe.updateMany({
    where: { swiperId: viewer, targetId: { not: target } },
    data: { createdAt: new Date(Date.now() - 60 * 60_000) },
  });
  // Then age this one past the window rather than waiting out a real minute.
  await prisma.swipe.updateMany({
    where: { swiperId: viewer, targetId: target },
    data: { createdAt: new Date(Date.now() - 5 * 60_000) },
  });

  assert.equal((await RewindService.available(viewer)).available, false);
  await assert.rejects(
    () => RewindService.rewind(viewer),
    (error: any) => error.code === 'REWIND_WINDOW_PASSED',
  );
});

test('Rewind refuses to undo a swipe that made a match', async () => {
  const target = candidates[candidates.length - 3];
  // They like first, so the viewer's Like completes the match.
  await SwipeService.perform(target, viewer, 'like');
  const result = await SwipeService.perform(viewer, target, 'like');
  assert.equal(result.matchCreated, true);

  await assert.rejects(
    () => RewindService.rewind(viewer),
    (error: any) => error.code === 'REWIND_WOULD_UNMATCH',
    'the other person can already see the conversation',
  );
  const swipe = await prisma.swipe.findFirst({ where: { swiperId: viewer, targetId: target } });
  assert.ok(swipe, 'a refused rewind leaves the swipe in place');
});

test('rewinding a Rose gives the Rose back', async () => {
  const target = candidates[candidates.length - 4];
  const before = await RoseService.balance(viewer);
  await SwipeService.perform(viewer, target, 'like', { comment: 'Hello' });
  const spent = await RoseService.balance(viewer);
  assert.equal(spent.roses, before.roses - 1, 'the Rose was spent with the Like');

  const undone = await RewindService.rewind(viewer);
  assert.equal(undone.roseRefunded, true);
  const after = await RoseService.balance(viewer);
  assert.equal(after.roses, before.roses, 'the Like was taken back, so the Rose it bought comes back too');
  const rose = await prisma.rose.findFirst({ where: { senderId: viewer, recipientId: target } });
  assert.equal(rose, null, 'and the Rose record goes with it');
});
