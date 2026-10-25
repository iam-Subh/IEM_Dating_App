/**
 * Likes You and Standouts, second version (STANDOUTS_LIKES_SPEC.md section 11).
 *
 * Non-destructive: creates its own users and memberships under random ids and
 * deletes exactly those rows (and the outbox events about them) afterwards.
 * Never truncates anything.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { SwipeService } from '../src/services/swipe.service';
import { LikesService } from '../src/services/likes.service';
import { StandoutsService } from '../src/services/standouts.service';
import { OutboxDeliveryService } from '../src/services/outbox-delivery.service';
import { checkNote } from '../src/services/note-safety';

const recipient = randomUUID();
const noteSender = randomUUID();
const movedSender = randomUUID();
const excludedSender = randomUUID();
const quietSender = randomUUID();
const standoutViewer = randomUUID();
/** Enough plain likers to need two pages. */
const likers = Array.from({ length: 25 }, () => randomUUID());
const pool = Array.from({ length: 8 }, () => randomUUID());
const users = [recipient, noteSender, movedSender, excludedSender, quietSender, standoutViewer, ...likers, ...pool];

const ID_COLUMNS = [
  'id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'sender_id', 'recipient_id', 'swiper_id', 'target_id',
  'swipe_id', 'candidate_id', 'shown_id', 'user1_id', 'user2_id', 'blocker_id', 'blocked_id', 'follower_id', 'followee_id',
  'match_id', 'message_id', 'actor_id',
];

let institutionId = '';

async function makeUser(
  id: string,
  name: string,
  category: 'man' | 'woman' | 'nonbinary',
  showMe: string[],
  extra: Record<string, unknown> = {},
) {
  await prisma.user.create({
    data: {
      id,
      email: `${id}@likes.example.test`,
      name,
      passwordHash: 'TEST_ONLY',
      accountStatus: 'active',
      birthday: new Date('2004-01-01'),
      age: 21,
      discoveryMode: 'college',
      discoveryCategory: category,
      showMeCategories: showMe,
      minAgePref: 18,
      maxAgePref: 30,
      preferencesConfirmedAt: new Date(),
      college: 'Likes Test College',
      department: 'CSE',
      lastActiveAt: new Date(),
      preferences: { interests: ['music'] },
      ...extra,
    },
  });
  await prisma.studentMembership.create({
    data: { userId: id, institutionId, institutionalEmail: `${id}@iem.example.test`, status: 'verified', verifiedAt: new Date() },
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
  institutionId = (await prisma.institution.findFirstOrThrow({ where: { isActive: true }, select: { id: true } })).id;
  await makeUser(recipient, 'Likes Recipient', 'woman', ['man', 'nonbinary']);
  await makeUser(noteSender, 'Note Sender', 'man', ['woman']);
  await makeUser(movedSender, 'Moved Sender', 'man', ['woman']);
  await makeUser(excludedSender, 'Excluded Sender', 'nonbinary', ['woman']);
  await makeUser(quietSender, 'Quiet Sender', 'man', ['woman']);
  await makeUser(standoutViewer, 'Standout Viewer', 'man', ['woman']);
  for (const [index, id] of likers.entries()) await makeUser(id, `Liker ${index}`, 'man', ['woman']);
  // Ready for Standouts v3 (STANDOUTS_PLAN.md 5.1): a playable video, photos and a bio.
  for (const [index, id] of pool.entries()) {
    await makeUser(id, `Pool ${index}`, 'woman', ['man'], {
      profileVideoUrl: `https://example.test/${id}/video.mp4`,
      videoPlaybackUrl: `https://example.test/${id}/video.m3u8`,
      preferences: { bio: 'Pool member', interests: ['music'] },
    });
    await prisma.profilePhoto.createMany({
      data: Array.from({ length: 3 }, (_, order) => ({ userId: id, photoUrl: `https://example.test/${id}/${order}.jpg`, order, isPrimary: order === 0 })),
    });
  }
});

after(async () => {
  await prisma.$executeRaw`DELETE FROM outbox_events WHERE topic = 'like.received' AND payload->>'recipientId' = ANY(${users})`;
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(${ID_COLUMNS})`;
  const matchIds = (await prisma.match.findMany({ where: { OR: [{ user1Id: { in: users } }, { user2Id: { in: users } }] }, select: { id: true } })).map((m) => m.id);
  const ids = [...users, ...matchIds];
  for (let pass = 0; pass < 6; pass++) {
    let failures = 0;
    for (const { table_name, column_name } of columns) {
      // `id` columns are only ours for these ids; everything else keys on a user.
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

async function pages(sort: 'recent' | 'type') {
  const seen: string[] = [];
  let cursor: string | undefined;
  let first: Awaited<ReturnType<typeof LikesService.received>> | null = null;
  // Aged once: shifting the Likes between pages would move them under the cursor.
  await settle();
  for (let page = 0; page < 5; page++) {
    const data = await LikesService.received(recipient, { sort, cursor, limit: 20 });
    first ??= data;
    seen.push(...data.likes.map((like) => like.id));
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  return { first: first!, seen };
}

test('a Rose sent after 25 Likes is on top of page one, and no card appears on two pages', async () => {
  for (const id of likers) await SwipeService.perform(id, recipient, 'like');
  await SwipeService.perform(noteSender, recipient, 'like', { comment: 'Your playlist is great' });

  for (const sort of ['recent', 'type'] as const) {
    const { first, seen } = await pages(sort);
    assert.equal(first.roses[0]?.id, noteSender, `${sort}: the Rose leads page one`);
    assert.equal(first.roses[0]?.roseComment, 'Your playlist is great');
    assert.equal(new Set(seen).size, seen.length, `${sort}: no duplicates across pages`);
    for (const id of likers) assert.ok(seen.includes(id), `${sort}: every Like is reachable`);
    assert.ok(!seen.includes(noteSender), `${sort}: the Rose is not repeated below`);
  }
});

test('a new Like stays out of Likes You until the sender can no longer Rewind it', async () => {
  const other = randomUUID();
  users.push(other);
  await makeUser(other, 'Fresh Liker', 'man', ['woman']);
  await SwipeService.perform(other, recipient, 'like');
  const hidden = await LikesService.received(recipient, { limit: 40 });
  assert.ok(![...hidden.likes, ...hidden.roses].some((like) => like.id === other), 'not while it can still be taken back');
  const shown = await received(recipient, { limit: 40 });
  assert.ok(shown.likes.some((like) => like.id === other), 'listed once the window has closed');
});

test('a Like whose geography changed since stays listed, and Liking back matches', async () => {
  await SwipeService.perform(movedSender, recipient, 'like');
  // The recipient narrows their scope to one campus; neither has a campus,
  // so ordinary eligibility no longer holds - but the Like was made in range.
  await prisma.user.update({ where: { id: recipient }, data: { collegeScope: 'campus' } });
  const { likes } = await received(recipient, { limit: 40 });
  assert.ok(likes.some((like) => like.id === movedSender), 'still listed');
  const answer = await SwipeService.perform(recipient, movedSender, 'like');
  assert.equal(answer.matchCreated, true, 'and it can be answered');
  await prisma.user.update({ where: { id: recipient }, data: { collegeScope: 'college' } });
});

test('a Like the recipient\'s own new preferences exclude is neither listed nor accepted', async () => {
  await SwipeService.perform(excludedSender, recipient, 'like');
  await prisma.user.update({ where: { id: recipient }, data: { showMeCategories: ['man'] } });
  const { likes, roses } = await received(recipient, { limit: 40 });
  assert.ok(![...likes, ...roses].some((like) => like.id === excludedSender), 'not listed');
  await assert.rejects(
    () => SwipeService.perform(recipient, excludedSender, 'like'),
    (error: any) => error.code === 'PROFILE_UNAVAILABLE',
    'and not accepted - the list and the swipe agree',
  );
  await prisma.user.update({ where: { id: recipient }, data: { showMeCategories: ['man', 'nonbinary'] } });
});

test('a Like from someone quiet for 31 days is hidden, and returns when they come back', async () => {
  await SwipeService.perform(quietSender, recipient, 'like');
  await prisma.user.update({ where: { id: quietSender }, data: { lastActiveAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) } });
  let all = await pages('recent');
  assert.ok(!all.seen.includes(quietSender), 'hidden while quiet');
  await prisma.user.update({ where: { id: quietSender }, data: { lastActiveAt: new Date() } });
  all = await pages('recent');
  assert.ok(all.seen.includes(quietSender), 'back once active');
});

test('the summary counts what is new, and opening Likes You clears it', async () => {
  const before = await summary(recipient);
  assert.ok(before.total > 0 && before.unseen === before.total, 'everything is new');
  assert.equal(before.roses, 1);
  assert.equal(before.unseenRoses, 1);
  await LikesService.markSeen(recipient);
  const after = await summary(recipient);
  assert.equal(after.unseen, 0);
  assert.equal(after.total, before.total, 'seeing is not answering');
});

test('cards are marked new until Likes You is opened, and the counts match the list', async () => {
  await prisma.user.update({ where: { id: recipient }, data: { likesSeenAt: null } });
  const before = await received(recipient, { limit: 40 });
  const all = [...before.roses, ...before.likes];
  assert.ok(all.length > 0 && all.every((card) => card.isNew), 'everything is new before the first open');
  assert.equal(before.counts?.roses, before.roses.length);
  assert.equal(before.counts?.unseen, before.counts?.total);
  await LikesService.markSeen(recipient);
  const after = await LikesService.received(recipient, { limit: 40 });
  assert.ok([...after.roses, ...after.likes].every((card) => !card.isNew), 'nothing is new once seen');
  assert.equal(after.counts?.unseen, 0);
  assert.equal(after.counts?.total, before.counts?.total, 'seeing is not answering');
});

test('the note filter refuses contact details and slurs, and a refused note spends no Rose', async () => {
  for (const text of ['call me 98765 43210', 'mail me at a.b@gmail.com', 'insta @rupsa.draws', 'see www.example.com', 'send n u d e s']) {
    assert.equal(checkNote(text).ok, false, text);
  }
  for (const text of ['Your playlist is great', 'That thorny plant photo!', 'Class of 2027 too', '']) {
    assert.equal(checkNote(text).ok, true, text);
  }
  const target = pool[0];
  const before = await prisma.user.findUniqueOrThrow({ where: { id: standoutViewer }, select: { roses: true } });
  await assert.rejects(
    () => SwipeService.perform(standoutViewer, target, 'like', { comment: 'text me on 9876543210' }),
    (error: any) => error.code === 'ROSE_COMMENT_REJECTED',
  );
  const after = await prisma.user.findUniqueOrThrow({ where: { id: standoutViewer }, select: { roses: true } });
  assert.equal(after.roses, before.roses, 'the Rose is not spent');
  assert.equal(await prisma.swipe.count({ where: { swiperId: standoutViewer, targetId: target } }), 0, 'and no Like was recorded');
});

test('a Rose note becomes the first message of the match it starts', async () => {
  const result = await SwipeService.perform(recipient, noteSender, 'like');
  assert.equal(result.matchCreated, true);
  const messages = await prisma.message.findMany({ where: { matchId: result.matchId! }, orderBy: { messageSeq: 'asc' } });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].senderId, noteSender, 'sent by the Rose sender');
  assert.equal(messages[0].content, 'Your playlist is great');
  assert.equal(messages[0].messageSeq, 1);
  const unread = await prisma.chatParticipant.findUnique({
    where: { matchId_userId: { matchId: result.matchId!, userId: recipient } },
    select: { unreadCount: true },
  });
  assert.equal(unread?.unreadCount, 1);
});

test('ten Likes produce one batched push, and no push names anyone', async () => {
  const target = pool[1];
  await prisma.user.update({ where: { id: target }, data: { likesPushedAt: null, likesSeenAt: null } });
  for (const id of likers.slice(0, 10)) await SwipeService.perform(id, target, 'like').catch(() => undefined);
  const events = await prisma.outboxEvent.findMany({
    where: { topic: 'like.received', payload: { path: ['recipientId'], equals: target } },
  });
  assert.ok(events.length >= 1);
  for (const event of events) await OutboxDeliveryService.deliver(event as any);
  const notes = await prisma.notification.findMany({ where: { userId: target } });
  const likeNotes = notes.filter((note) => note.type === 'like');
  assert.equal(likeNotes.length, 1, 'one batched push');
  for (const note of notes) {
    for (const name of ['Liker', 'Note', 'Standout']) assert.ok(!note.body?.includes(name) && !note.title.includes(name), 'never a name');
  }
});

test('Standouts leaves out anyone who liked you, survives losing its cache, and "Not for me" is not a Pass', async () => {
  // pool[2] liked the viewer: they belong in Likes You, not behind a Rose.
  await SwipeService.perform(pool[2], standoutViewer, 'like');
  const first = await StandoutsService.today(standoutViewer);
  assert.equal(first.state, 'ok');
  const ids = (first.cards as any[]).map((card) => card.id);
  assert.ok(!ids.includes(pool[2]), 'someone who liked you is not a Standout');
  for (const card of first.cards as any[]) {
    assert.ok(Array.isArray(card.reasons) && card.reasons.length <= 2);
    assert.equal(card.roseSent, false);
  }

  // Redis is not where the day lives: the same set comes back regardless.
  const keys = await redisClient.keys(`standouts:v1:${standoutViewer}:*`);
  if (keys.length) await redisClient.unlink(...keys);
  const again = await StandoutsService.today(standoutViewer);
  assert.deepEqual((again.cards as any[]).map((card) => card.id), ids);

  const hideTarget = ids[0];
  const hidden = await StandoutsService.hide(standoutViewer, hideTarget);
  assert.equal(hidden.hidden, true);
  assert.equal(await prisma.swipe.count({ where: { swiperId: standoutViewer, targetId: hideTarget } }), 0, 'no swipe written');
  const afterHide = await StandoutsService.today(standoutViewer);
  assert.ok(!(afterHide.cards as any[]).some((card) => card.id === hideTarget), 'hidden for the day');

  // A Rose keeps its card, marked, for the rest of the day.
  const roseTarget = ids.find((id) => id !== hideTarget)!;
  await SwipeService.perform(standoutViewer, roseTarget, 'like', { comment: null });
  const afterRose = await StandoutsService.today(standoutViewer);
  const marked = (afterRose.cards as any[]).find((card) => card.id === roseTarget);
  assert.ok(marked, 'still in the set');
  assert.equal(marked.roseSent, true);
});
