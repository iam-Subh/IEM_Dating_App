/**
 * Integration tests for Roses and Likes You (EXPLORE_SPEC.md, sections 10, 12
 * and 15). Roses are the only currency in the app, so the properties worth
 * testing are the ones a currency needs: the grant tops up rather than
 * accrues, spending is atomic with the Like it rides on, and the per-person
 * and per-day limits hold.
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
import { LikesService } from '../src/services/likes.service';
import { SearchPeopleService } from '../src/services/search-people.service';

const sender = randomUUID();
const recipient = randomUUID();
const plainLiker = randomUUID();
/** Liked plainly first, then offered a Rose: a Rose has to be the first move. */
const likedFirst = randomUUID();
const users = [sender, recipient, plainLiker, likedFirst];
const WEEK_MS = 7 * 24 * 60 * 60_000;

const ID_COLUMNS = [
  'id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'sender_id', 'recipient_id', 'swiper_id', 'target_id',
  'swipe_id', 'candidate_id', 'shown_id', 'user1_id', 'user2_id', 'blocker_id', 'blocked_id', 'follower_id', 'followee_id',
];

/** A verified member of a real institution, set up to be mutually eligible with the others. */
async function makeUser(id: string, name: string, category: 'man' | 'woman', showMe: 'man' | 'woman', institutionId: string) {
  await prisma.user.create({
    data: {
      id,
      email: `${id}@roses.example.test`,
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
      // A profile field `setupComplete` requires, not an eligibility test:
      // college mode is decided by the verified membership created below.
      college: 'Roses Test College',
      department: 'CSE',
      preferences: { interests: ['music'] },
    },
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

/**
 * A Like shows in Likes You only once the sender's Rewind window has closed
 * (LIKE_GRACE_MS). Tests age this file's own Likes past it rather than wait.
 */
async function settle() {
  await prisma.$executeRaw`UPDATE swipes SET created_at = created_at - interval '2 minutes'
    WHERE swiper_id = ANY(${users}::uuid[]) OR target_id = ANY(${users}::uuid[])`;
}
async function received(...args: Parameters<typeof LikesService.received>) {
  await settle();
  return LikesService.received(...args);
}
async function summary(...args: Parameters<typeof LikesService.summary>) {
  await settle();
  return LikesService.summary(...args);
}

before(async () => {
  const institution = await prisma.institution.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  await makeUser(sender, 'Rose Sender', 'man', 'woman', institution.id);
  await makeUser(recipient, 'Rose Recipient', 'woman', 'man', institution.id);
  await makeUser(plainLiker, 'Plain Liker', 'man', 'woman', institution.id);
  await makeUser(likedFirst, 'Liked First', 'woman', 'man', institution.id);
});

after(async () => {
  // Like notifications about this file's users (the outbox is keyed by swipe, not user).
  await prisma.$executeRaw`DELETE FROM outbox_events WHERE topic = 'like.received' AND payload->>'recipientId' = ANY(${users})`;
  const ids = [...users];
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

test('the weekly grant tops the balance up to the ceiling rather than adding to it', async () => {
  const fresh = await RoseService.balance(sender);
  // A new account starts at the grant, plus the one-time welcome Roses (STANDOUTS_PLAN.md 4.2).
  const { welcome } = await RoseService.limits();
  assert.equal(fresh.roses, Math.min(fresh.grant + welcome, Math.max(fresh.grant, fresh.maxHeld)), 'grant plus the welcome');
  const again0 = await RoseService.balance(sender);
  assert.equal(again0.roses, fresh.roses, 'the welcome is given once');

  // Three left, a week and a day ago: the top-up brings it to the grant, not grant + 3.
  await prisma.user.update({
    where: { id: sender },
    data: { roses: 3, rosesRefreshedAt: new Date(Date.now() - WEEK_MS - 60_000) },
  });
  const topped = await RoseService.balance(sender);
  assert.equal(topped.roses, topped.grant, 'tops up to the grant');
  assert.notEqual(topped.roses, topped.grant + 3, 'never accrues');

  // Reading again inside the same week changes nothing.
  const again = await RoseService.balance(sender);
  assert.equal(again.roses, topped.roses);
  assert.equal(again.refreshesAt, topped.refreshesAt);
});

test('a balance above the grant is never reduced by a top-up', async () => {
  await prisma.user.update({
    where: { id: sender },
    data: { roses: 40, rosesRefreshedAt: new Date(Date.now() - WEEK_MS - 60_000) },
  });
  const balance = await RoseService.balance(sender);
  assert.equal(balance.roses, 40, 'the top-up only ever raises');
  await prisma.user.update({ where: { id: sender }, data: { roses: 20, rosesRefreshedAt: new Date() } });
});

test('a Rose rides with a Like, spends exactly one, and reaches the top of Likes You with its comment', async () => {
  const before = await RoseService.balance(sender);

  // An ordinary Like from someone else, sent first, so ordering is tested rather than luck.
  await SwipeService.perform(plainLiker, recipient, 'like');
  await SwipeService.perform(sender, recipient, 'like', { comment: 'Loved your prompt' });

  const after = await prisma.user.findUniqueOrThrow({ where: { id: sender }, select: { roses: true } });
  assert.equal(after.roses, before.roses - 1, 'exactly one Rose is spent');

  const roses = await prisma.rose.findMany({ where: { senderId: sender, recipientId: recipient } });
  assert.equal(roses.length, 1);
  assert.equal(roses[0].comment, 'Loved your prompt');
  assert.ok(roses[0].swipeId, 'the Rose is tied to the Like it rode on');

  const { roses: roseCards, likes, roseCount } = await received(recipient);
  assert.equal(roseCount, 1);
  assert.equal(roseCards[0].id, sender, 'the Rose sits above the ordinary Like');
  assert.equal(roseCards[0].isRose, true);
  assert.equal(roseCards[0].roseComment, 'Loved your prompt');
  assert.equal(likes[0].id, plainLiker);
  assert.equal(likes[0].isRose, false);
});

test('replaying the same swipe does not spend a second Rose', async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: sender }, select: { roses: true } });
  const repeated = await SwipeService.perform(sender, recipient, 'like', { comment: 'again' });
  assert.equal((repeated as any).repeated, true);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: sender }, select: { roses: true } });
  assert.equal(after.roses, before.roses, 'a replay spends nothing');
  assert.equal(await prisma.rose.count({ where: { senderId: sender, recipientId: recipient } }), 1);
});

test('a Rose cannot ride on a Pass', async () => {
  await assert.rejects(
    () => SwipeService.perform(sender, plainLiker, 'pass', { comment: 'no' }),
    (error: any) => error.code === 'ROSE_REQUIRES_LIKE',
  );
});

test('a refused swipe leaves the balance untouched', async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: sender }, select: { roses: true } });
  // Blocked in one direction: the swipe is refused, so nothing may be spent.
  await prisma.userBlock.create({ data: { blockerId: plainLiker, blockedId: sender } });
  await assert.rejects(
    () => SwipeService.perform(sender, plainLiker, 'like', { comment: 'hi' }),
    (error: any) => error.code === 'PROFILE_UNAVAILABLE',
  );
  const after = await prisma.user.findUniqueOrThrow({ where: { id: sender }, select: { roses: true } });
  assert.equal(after.roses, before.roses, 'an atomic failure spends no Rose');
  assert.equal(await prisma.rose.count({ where: { senderId: sender, recipientId: plainLiker } }), 0);
  await prisma.userBlock.deleteMany({ where: { blockerId: plainLiker, blockedId: sender } });
});

test('the same person cannot be rosed twice', async () => {
  await assert.rejects(
    () => prisma.$transaction((tx) => RoseService.spendWithin(tx, sender, recipient, 'second')),
    (error: any) => error.code === 'ROSE_ALREADY_SENT',
  );
});

test('one Rose per person for good: a Rose from months ago still counts', async () => {
  await prisma.rose.updateMany({
    where: { senderId: sender, recipientId: recipient },
    data: { createdAt: new Date(Date.now() - 90 * 24 * 60 * 60_000) },
  });
  await assert.rejects(
    () => prisma.$transaction((tx) => RoseService.spendWithin(tx, sender, recipient, 'again')),
    (error: any) => error.code === 'ROSE_ALREADY_SENT',
  );
});

test('a Like already sent cannot become a Rose, and spends nothing trying', async () => {
  await SwipeService.perform(sender, likedFirst, 'like');
  const before = await prisma.user.findUniqueOrThrow({ where: { id: sender }, select: { roses: true } });
  await assert.rejects(
    () => SwipeService.perform(sender, likedFirst, 'like', { comment: null }),
    (error: any) => error.code === 'ROSE_NOT_FIRST',
  );
  const after = await prisma.user.findUniqueOrThrow({ where: { id: sender }, select: { roses: true } });
  assert.equal(after.roses, before.roses, 'no Rose spent');
  assert.equal(await prisma.rose.count({ where: { senderId: sender, recipientId: likedFirst } }), 0);
  // A plain Like retried is still a harmless replay.
  const replay = await SwipeService.perform(sender, likedFirst, 'like');
  assert.equal(replay.repeated, true);
});

test('search shows your own decision, never theirs', async () => {
  const states = await SearchPeopleService.myStates(sender, [recipient, likedFirst, plainLiker]);
  assert.equal((states.get(recipient) as any)?.kind, 'rose', 'a Rose you sent');
  assert.equal((states.get(likedFirst) as any)?.kind, 'liked', 'a plain Like you sent');
  assert.equal(states.get(plainLiker), undefined, 'nothing decided, nothing shown');
  // Opening their dating profile again says so instead of refusing.
  const profile = await SearchPeopleService.datingProfile(sender, likedFirst);
  assert.equal(profile.state.kind, 'liked');
  assert.equal(profile.card, null, 'no card: the same whatever they did since');
});

test('the daily limit holds, and an empty balance refuses before anything else', async () => {
  const { perDayLimit } = await RoseService.balance(sender);
  const others = Array.from({ length: perDayLimit }, () => randomUUID());
  await prisma.rose.createMany({
    data: others.map((id) => ({ senderId: sender, recipientId: id, comment: null })),
  });
  await assert.rejects(
    () => prisma.$transaction((tx) => RoseService.spendWithin(tx, sender, randomUUID(), null)),
    (error: any) => error.code === 'ROSE_DAILY_LIMIT',
  );
  await prisma.rose.deleteMany({ where: { senderId: sender, recipientId: { in: others } } });

  await prisma.user.update({ where: { id: sender }, data: { roses: 0, rosesRefreshedAt: new Date() } });
  await assert.rejects(
    () => prisma.$transaction((tx) => RoseService.spendWithin(tx, sender, randomUUID(), null)),
    (error: any) => error.code === 'NO_ROSES_LEFT',
  );
});

test('Likes You hides anyone you have already answered, and anyone blocked', async () => {
  // The recipient answers the Rose: the sender leaves their Likes You.
  await SwipeService.perform(recipient, sender, 'like');
  const { likes } = await received(recipient);
  assert.equal([...likes, ...(await received(recipient)).roses].some((like) => like.id === sender), false, 'an answered Like is gone');

  await prisma.userBlock.create({ data: { blockerId: recipient, blockedId: plainLiker } });
  const afterBlock = await received(recipient);
  assert.equal(afterBlock.likes.some((like) => like.id === plainLiker), false, 'a blocked liker is hidden');
  await prisma.userBlock.deleteMany({ where: { blockerId: recipient, blockedId: plainLiker } });
});
