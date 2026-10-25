/**
 * Likes, the trial Rose, the grace period and the reminders before verifying
 * a college (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 2.2-2.6, 4, 5).
 *
 * Non-destructive: its own users under random ids; every worker run is scoped
 * to them (`only`), so nobody else is reminded or paused.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { SwipeService } from '../src/services/swipe.service';
import { RoseService } from '../src/services/rose.service';
import { VerificationLimitsService, DAILY_LIKE_LIMIT } from '../src/services/verification-limits.service';
import { VerificationRemindersWorker } from '../src/services/verification-reminders.worker';
import { eligibleSql } from '../src/services/eligibility.service';
import { VerificationLimitsService as Limits } from '../src/services/verification-limits.service';

const DAY = 24 * 60 * 60_000;
const google = randomUUID();          // unverified, chose IEM, signed up today
const late = randomUUID();            // unverified, signed up 15 days ago
const verifiedViewer = randomUUID();  // a verified student on the group scope
const expiring = randomUUID();        // verified, ends in 5 days
const googleVerified = randomUUID();  // made with Google, college verified, no selfie, 15 days old
const targets = Array.from({ length: DAILY_LIKE_LIMIT + 1 }, () => randomUUID());
const users = [google, late, verifiedViewer, expiring, googleVerified, ...targets];
let institutionId = '';

const ID_COLUMNS = ['id', 'user_id', 'swiper_id', 'target_id', 'sender_id', 'recipient_id', 'swipe_id', 'viewer_id', 'candidate_id',
  'owner_id', 'user1_id', 'user2_id', 'aggregate_id', 'follower_id', 'followee_id', 'subject_user_id', 'reporter_id', 'reported_user_id'];

async function makeUser(id: string, extra: Record<string, unknown>) {
  await prisma.user.create({
    data: {
      id, email: `${id}@grace.example.test`, name: `Grace ${id.slice(0, 4)}`, passwordHash: 'TEST_ONLY', accountStatus: 'active',
      birthday: new Date('2004-01-01'), age: 22, discoveryMode: 'college', discoveryCategory: 'nonbinary', showMeCategories: ['nonbinary'],
      minAgePref: 18, maxAgePref: 40, preferencesConfirmedAt: new Date(), college: 'Grace College', lastActiveAt: new Date(),
      collegeScope: 'group', ...extra,
    },
  });
}
async function verify(id: string, expiresAt: Date | null = null) {
  await prisma.studentMembership.create({
    data: { userId: id, institutionId, institutionalEmail: `${id}@grace.example.test`, status: 'verified', verifiedAt: new Date(), expiresAt },
  });
}

before(async () => {
  institutionId = (await prisma.institution.findFirstOrThrow({ where: { code: 'IEM-KOLKATA' } })).id;
  await makeUser(google, { googleSub: `g-${google}`, claimedInstitutionId: institutionId });
  await makeUser(late, { googleSub: `g-${late}`, claimedInstitutionId: institutionId, createdAt: new Date(Date.now() - 15 * DAY) });
  await makeUser(verifiedViewer, {});
  await verify(verifiedViewer);
  await makeUser(expiring, {});
  await verify(expiring, new Date(Date.now() + 5 * DAY));
  for (const id of targets) { await makeUser(id, {}); await verify(id); }
  const fifteenDaysAgo = new Date(Date.now() - 15 * DAY);
  await makeUser(googleVerified, { googleSub: `g-${googleVerified}`, googleLinkedAt: fifteenDaysAgo, createdAt: fifteenDaysAgo });
  await verify(googleVerified);
});

after(async () => {
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(${ID_COLUMNS})`;
  const matchIds = (await prisma.match.findMany({ where: { OR: [{ user1Id: { in: users } }, { user2Id: { in: users } }] }, select: { id: true } })).map((m) => m.id);
  const ids = [...users, ...matchIds];
  for (let pass = 0; pass < 6; pass++) {
    let failures = 0;
    for (const { table_name, column_name } of columns) {
      try { await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1::uuid[])`, ids); }
      catch { failures += 1; }
    }
    if (!failures) break;
  }
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('one trial Rose, once - then the rules screen', async () => {
  assert.equal((await RoseService.balance(google)).trial, true);
  assert.equal((await RoseService.balance(google)).roses, 1);
  await SwipeService.perform(google, targets[0], 'like', { comment: null });
  assert.equal((await RoseService.balance(google)).roses, 0);
  await assert.rejects(SwipeService.perform(google, targets[1], 'like', { comment: null }), (error: any) => error.code === 'ROSE_VERIFY_REQUIRED');
});

test('25 likes a day before verifying; a pass is always allowed', async () => {
  // The trial Rose above was a Like too.
  for (const id of targets.slice(1, DAILY_LIKE_LIMIT)) await SwipeService.perform(google, id, 'like');
  assert.equal(await VerificationLimitsService.likesLeft(google), 0);
  await assert.rejects(SwipeService.perform(google, targets[DAILY_LIKE_LIMIT], 'like'), (error: any) => error.code === 'LIKE_LIMIT_UNVERIFIED');
  await SwipeService.perform(google, targets[DAILY_LIKE_LIMIT], 'pass');
  assert.equal(await VerificationLimitsService.likesLeft(verifiedViewer), null, 'verified: no limit');
});

test('day 1 / 5 reminders, latest only, two at most', async () => {
  await prisma.user.update({ where: { id: google }, data: { createdAt: new Date(Date.now() - 6 * DAY) } });
  const first = await VerificationRemindersWorker.verifyReminders(new Date(), [google]);
  assert.equal(first, 1, 'one push, not a burst');
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: google } })).verifyPushLevel, 2);
  assert.equal(await VerificationRemindersWorker.verifyReminders(new Date(), [google]), 0, 'never twice');
});

test('day 14: paused, out of decks, cannot like; verifying unpauses', async () => {
  const run = await VerificationRemindersWorker.runOnce(new Date(), [late]);
  assert.equal(run.paused, 1);
  const pausedUser = await prisma.user.findUniqueOrThrow({ where: { id: late } });
  assert.ok(pausedUser.pausedAt);
  const viewer = await prisma.user.findUniqueOrThrow({ where: { id: verifiedViewer } });
  const seen = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT u.id FROM users u WHERE u.id = ${late}::uuid AND ${eligibleSql(viewer)}`);
  assert.equal(seen.length, 0, 'hidden from other people');
  await assert.rejects(SwipeService.perform(late, verifiedViewer, 'like'), (error: any) => error.code === 'PROFILE_PAUSED');
  assert.equal((await VerificationLimitsService.status(late)).paused, true);
  // The grace warnings were sent before the pause - only the latest, once.
  assert.equal(pausedUser.graceWarningLevel, 3);
});

test('expiry reminders, once per step', async () => {
  const sent = await VerificationRemindersWorker.expiryReminders(new Date(), [expiring]);
  assert.equal(sent, 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: expiring } })).expiryReminderLevel, 2, 'the 7-day step');
  assert.equal(await VerificationRemindersWorker.expiryReminders(new Date(), [expiring]), 0);
});

test('a Google account must also pass the real-person check by day 14, once required', async () => {
  const before = process.env.REAL_PERSON_REQUIRED;
  try {
    process.env.REAL_PERSON_REQUIRED = 'false';
    assert.equal((await VerificationRemindersWorker.runOnce(new Date(), [googleVerified])).paused, 0, 'off: the college email is enough');
    process.env.REAL_PERSON_REQUIRED = 'true';
    assert.equal((await VerificationRemindersWorker.runOnce(new Date(), [googleVerified])).paused, 1, 'on: no selfie by day 14 pauses');
    assert.equal((await Limits.status(googleVerified)).owesRealPerson, true);
    await prisma.user.update({ where: { id: googleVerified }, data: { realPersonVerifiedAt: new Date(), realPersonPassedAt: new Date() } });
    assert.equal(await Limits.refreshPause(googleVerified), true, 'the selfie unpauses at once');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: googleVerified } })).pausedAt, null);

    // Later a photo isn't them: the status pauses, the profile never does.
    await prisma.user.update({ where: { id: googleVerified }, data: { realPersonVerifiedAt: null } });
    assert.equal((await VerificationRemindersWorker.runOnce(new Date(), [googleVerified])).paused, 0, 'a photo to fix never pauses the profile');
    assert.equal((await Limits.status(googleVerified)).owesRealPerson, false);
    assert.equal((await Limits.status(googleVerified)).realPersonVerified, false, 'but the status is paused until fixed');
  } finally {
    if (before === undefined) delete process.env.REAL_PERSON_REQUIRED; else process.env.REAL_PERSON_REQUIRED = before;
  }
});
