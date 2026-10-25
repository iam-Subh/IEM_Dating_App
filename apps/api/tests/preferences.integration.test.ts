/**
 * My preferences (PREFERENCES_SPEC.md): what Done changes, and that the SQL
 * retrieval and the swipe gate agree on it.
 *
 * Non-destructive: creates its own users under random ids and deletes exactly
 * those rows afterwards. Never truncates anything.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { User } from '@prisma/client';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { eligibleSql, loadEligibilityParties, mutuallyEligible } from '../src/services/eligibility.service';
import { PreferencesService, type PreferencesInput } from '../src/services/preferences.service';
import { SwipeService } from '../src/services/swipe.service';

const viewer = randomUUID();
const smoker = randomUUID();
const nonSmoker = randomUUID();
const older = randomUUID();
const users = [viewer, smoker, nonSmoker, older];

const ID_COLUMNS = ['id', 'user_id', 'owner_id', 'viewer_id', 'swiper_id', 'target_id', 'sender_id', 'recipient_id', 'candidate_id', 'shown_id', 'user1_id', 'user2_id'];

async function makeUser(id: string, name: string, category: 'man' | 'woman', showMe: 'man' | 'woman', extra: Record<string, unknown> = {}) {
  const institution = await prisma.institution.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  await prisma.user.create({
    data: {
      id, email: `${id}@prefs.example.test`, name, passwordHash: 'TEST_ONLY', accountStatus: 'active',
      birthday: new Date('2004-06-01'), age: 22, discoveryMode: 'college', discoveryCategory: category,
      showMeCategories: [showMe], minAgePref: 18, maxAgePref: 30, flexibleAge: false,
      preferencesConfirmedAt: new Date(), college: 'Prefs Test College', lastActiveAt: new Date(),
      preferences: { lifestyle: {} }, ...extra,
    },
  });
  await prisma.studentMembership.create({
    data: { userId: id, institutionId: institution.id, institutionalEmail: `${id}@iem.example.test`, status: 'verified', verifiedAt: new Date() },
  });
}

before(async () => {
  await makeUser(viewer, 'Prefs Viewer', 'man', 'woman', { preferences: { lifestyle: { smoke: 'no' } } });
  await makeUser(smoker, 'Prefs Smoker', 'woman', 'man', { preferences: { lifestyle: { smoke: 'regularly' } } });
  await makeUser(nonSmoker, 'Prefs NonSmoker', 'woman', 'man', { preferences: { lifestyle: { smoke: 'no' } } });
  // 31: just outside the viewer's 18-30.
  await makeUser(older, 'Prefs Older', 'woman', 'man', { birthday: new Date(new Date().getFullYear() - 31, 0, 1), age: 31 });
});

after(async () => {
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

const base = (): PreferencesInput => ({
  show: ['woman'], minimumAge: 18, maximumAge: 30, flexibleAge: false, area: 'college', distance: 25,
  flexibleArea: false, verifiedOnly: false, criteria: {},
});

/** Who the viewer's deck could hold, among this file's people. */
async function pool(id: string) {
  const me = await prisma.user.findUniqueOrThrow({ where: { id } });
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT u.id FROM users u WHERE u.id = ANY(${users}::uuid[]) AND ${eligibleSql(me)}`;
  return new Set(rows.map((row) => row.id));
}

/** The swipe gate's answer for the same pair - it must agree with the pool. */
async function gate(a: string, b: string) {
  const [ua, ub] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: a } }), prisma.user.findUniqueOrThrow({ where: { id: b } })]);
  const parties = await loadEligibilityParties(prisma, [a, b]);
  return mutuallyEligible(ua as User, ub as User, { a: parties.get(a), b: parties.get(b) });
}

test('a soft choice hides nobody', async () => {
  await PreferencesService.save(viewer, { ...base(), criteria: { smoke: { values: ['no'], required: false } } });
  const people = await pool(viewer);
  assert.ok(people.has(smoker) && people.has(nonSmoker), 'both still there');
});

test('"Must match" filters, and the swipe gate agrees', async () => {
  await PreferencesService.save(viewer, { ...base(), criteria: { smoke: { values: ['no'], required: true } } });
  const people = await pool(viewer);
  assert.ok(!people.has(smoker), 'the smoker is out');
  assert.ok(people.has(nonSmoker), 'the non-smoker stays');
  assert.equal(await gate(viewer, smoker), false);
  assert.equal(await gate(viewer, nonSmoker), true);
});

test('a dealbreaker is two-sided: the smoker no longer sees the viewer either', async () => {
  const people = await pool(smoker);
  assert.ok(!people.has(viewer), 'no one-way visibility');
  assert.equal(await gate(smoker, viewer), false);
});

test('"Must match" needs your own answer, and at most three', async () => {
  await assert.rejects(
    () => PreferencesService.save(viewer, { ...base(), criteria: { pets: { values: ['dog'], required: true } } }),
    (error: any) => error.code === 'CRITERION_NEEDS_OWN_ANSWER',
  );
  await prisma.user.update({
    where: { id: viewer },
    data: { preferences: { lifestyle: { smoke: 'no', drink: 'socially', exercise: 'often', pets: 'dog' } } },
  });
  await assert.rejects(
    () => PreferencesService.save(viewer, {
      ...base(),
      criteria: {
        smoke: { values: ['no'], required: true }, drink: { values: ['socially'], required: true },
        exercise: { values: ['often'], required: true }, pets: { values: ['dog'], required: true },
      },
    }),
    (error: any) => error.code === 'TOO_MANY_REQUIRED',
  );
});

test('keep age flexible lets in someone just outside the range, both ways', async () => {
  await PreferencesService.save(viewer, base());
  assert.ok(!(await pool(viewer)).has(older), 'strict: 31 is outside 18-30');
  await PreferencesService.save(viewer, { ...base(), flexibleAge: true });
  assert.ok((await pool(viewer)).has(older), 'flexible: within two years');
  assert.equal(await gate(viewer, older), true, 'and the swipe gate agrees');
});

test('verified only, both ways', async () => {
  // "Verified" is a valid college verification (GOOGLE_SIGNUP_PLAN.md 2.1):
  // the smoker's has expired, so they are an unverified party, reached by
  // the "group" scope only.
  await prisma.studentMembership.update({ where: { userId: smoker }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
  try {
    await PreferencesService.save(viewer, { ...base(), area: 'group' });
    assert.ok((await pool(viewer)).has(smoker), 'an unverified person is reachable with the group scope');
    assert.ok((await pool(smoker)).has(viewer));
    await PreferencesService.save(viewer, { ...base(), area: 'group', verifiedOnly: true });
    const people = await pool(viewer);
    assert.ok(people.has(nonSmoker) && !people.has(smoker), 'only the verified one');
    // Both ways: the unverified smoker no longer sees someone who wants verified only.
    assert.ok(!(await pool(smoker)).has(viewer));
    assert.equal(await gate(viewer, smoker), false);
  } finally {
    await prisma.studentMembership.update({ where: { userId: smoker }, data: { expiresAt: null } });
    await PreferencesService.save(viewer, base());
  }
});

test('the estimate is a band, never a number, and follows the draft', async () => {
  const open = await PreferencesService.estimate(viewer, base());
  assert.ok(['none', 'few', 'some', 'many'].includes(open.band));
  assert.equal((open as any).count, undefined, 'no exact count');
  const blocked = await PreferencesService.estimate(viewer, { ...base(), criteria: { pets: { values: ['cat'], required: true } } });
  assert.notEqual(blocked.band, 'blocked', 'the viewer answered pets now');
});

test("a Like from outside the recipient's dealbreaker is not listed, and Liking back is refused", async () => {
  await PreferencesService.save(viewer, base());
  await SwipeService.perform(smoker, viewer, 'like');
  await PreferencesService.save(viewer, { ...base(), criteria: { smoke: { values: ['no'], required: true } } });
  await assert.rejects(() => SwipeService.perform(viewer, smoker, 'like'), (error: any) => error.code === 'PROFILE_UNAVAILABLE');
});
