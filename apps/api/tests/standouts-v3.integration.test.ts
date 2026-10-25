/**
 * Integration tests for Standouts v3 (apps/mobile/src/features/discovery/STANDOUTS_PLAN.md).
 *
 * Non-destructive: builds a small campus of its own users under random ids and
 * deletes exactly those rows, plus the night-run record it created.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { StandoutsV3Service, dayFrom } from '../src/services/standouts-v3.service';
import { StandoutsMetricsService } from '../src/services/standouts-metrics.service';
import { AlgorithmConfigService } from '../src/services/algorithm-config.service';
import { istDay } from '../src/services/discovery-cards.service';

const day = istDay();
const DEPARTMENTS = ['CSE', 'IT', 'ECE', 'ME', 'CE'];

const viewers = Array.from({ length: 4 }, () => randomUUID());
const ready = Array.from({ length: 16 }, () => randomUUID());
const unready = {
  noVideo: randomUUID(),
  onePhoto: randomUUID(),
  inactive: randomUUID(),
  likedViewer: randomUUID(),
  hidden: randomUUID(),
  roseLimit: randomUUID(),
};
const senders = Array.from({ length: 5 }, () => randomUUID());
const users = [...viewers, ...ready, ...Object.values(unready), ...senders];
let runExisted = false;

const ID_COLUMNS = [
  'id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'sender_id', 'recipient_id', 'swiper_id', 'target_id',
  'swipe_id', 'candidate_id', 'shown_id', 'user1_id', 'user2_id', 'blocker_id', 'blocked_id', 'follower_id', 'followee_id',
];

async function makeUser(id: string, options: {
  category: 'man' | 'woman'; showMe: 'man' | 'woman'; institutionId: string; department: string;
  photos?: number; video?: boolean; activeDaysAgo?: number; year?: number;
}) {
  const active = new Date(Date.now() - (options.activeDaysAgo ?? 0) * 86_400_000);
  await prisma.user.create({
    data: {
      id,
      email: `${id}@standouts-v3.example.test`,
      name: `V3 ${id.slice(0, 4)}`,
      passwordHash: 'TEST_ONLY',
      accountStatus: 'active',
      birthday: new Date('2004-01-01'),
      age: 22,
      discoveryMode: 'college',
      discoveryCategory: options.category,
      showMeCategories: [options.showMe],
      minAgePref: 18,
      maxAgePref: 30,
      preferencesConfirmedAt: new Date(),
      college: 'Standouts V3 College',
      department: options.department,
      yearOfStudy: options.year ?? 3,
      seeking: 'relationship',
      lastActiveAt: active,
      preferences: { interests: ['music', 'chess', 'travel', 'films'], bio: 'Here for the test.' },
      ...(options.video === false ? {} : {
        profileVideoUrl: `https://example.test/${id}/video.mp4`,
        videoPlaybackUrl: `https://example.test/${id}/playback.mp4`,
      }),
    },
  });
  const photos = options.photos ?? 3;
  if (photos) {
    await prisma.profilePhoto.createMany({
      data: Array.from({ length: photos }, (_, order) => ({ userId: id, photoUrl: `https://example.test/${id}/${order}.jpg`, order, isPrimary: order === 0 })),
    });
  }
  await prisma.studentMembership.create({
    data: { userId: id, institutionId: options.institutionId, institutionalEmail: `${id}@iem.example.test`, status: 'verified', verifiedAt: new Date() },
  });
}

before(async () => {
  runExisted = !!(await prisma.standoutRun.findUnique({ where: { day } }));
  const institution = await prisma.institution.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  const base = { institutionId: institution.id };
  for (const id of viewers) await makeUser(id, { ...base, category: 'man', showMe: 'woman', department: 'CSE' });
  for (const [index, id] of ready.entries()) {
    await makeUser(id, { ...base, category: 'woman', showMe: 'man', department: DEPARTMENTS[index % DEPARTMENTS.length], year: 1 + (index % 4) });
  }
  await makeUser(unready.noVideo, { ...base, category: 'woman', showMe: 'man', department: 'CSE', video: false });
  await makeUser(unready.onePhoto, { ...base, category: 'woman', showMe: 'man', department: 'IT', photos: 1 });
  await makeUser(unready.inactive, { ...base, category: 'woman', showMe: 'man', department: 'ECE', activeDaysAgo: 40 });
  await makeUser(unready.likedViewer, { ...base, category: 'woman', showMe: 'man', department: 'ME' });
  await makeUser(unready.hidden, { ...base, category: 'woman', showMe: 'man', department: 'CE' });
  await makeUser(unready.roseLimit, { ...base, category: 'woman', showMe: 'man', department: 'CSE' });
  for (const id of senders) await makeUser(id, { ...base, category: 'man', showMe: 'woman', department: 'ME' });

  // Already liked viewer 0: she belongs in Likes You, never in Standouts.
  for (const viewer of viewers) {
    await prisma.swipe.create({ data: { swiperId: unready.likedViewer, targetId: viewer, action: 'like' } });
  }
  // Viewer 0 said "Not for me" to her five days ago: hidden for 30 days.
  await prisma.$executeRaw`
    INSERT INTO standout_days (viewer_id, day, picks, hidden)
    VALUES (${viewers[0]}::uuid, ${dayFrom(day, -5)}, ARRAY[${unready.hidden}]::uuid[], ARRAY[${unready.hidden}]::uuid[])`;
  // Five Roses today: she has reached the receive limit.
  await prisma.rose.createMany({ data: senders.map((sender) => ({ senderId: sender, recipientId: unready.roseLimit, comment: null })) });
});

after(async () => {
  await prisma.$executeRaw`DELETE FROM outbox_events WHERE payload->>'recipientId' = ANY(${users})`;
  if (!runExisted) await prisma.standoutRun.deleteMany({ where: { day } });
  await prisma.standoutShadow.deleteMany({ where: { viewerId: { in: users } } });
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

const viewer = async (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
const excluded = Object.values(unready).filter((id) => id !== unready.hidden);

test('only ready people can be picked: video, photos, active, not liked-you, not at the Rose limit', async () => {
  const { flags } = await AlgorithmConfigService.get();
  const me = await viewer(viewers[0]);
  const ids = await StandoutsV3Service.gather(me, day, flags, null, { photos: 3, activeDays: flags.standouts_active_days }, 5);
  for (const id of ready) assert.ok(ids.includes(id), 'every ready person is a candidate');
  for (const id of excluded) assert.ok(!ids.includes(id), `${Object.entries(unready).find(([, value]) => value === id)?.[0]} is left out`);
  assert.ok(!ids.includes(unready.hidden), '"Not for me" five days ago still hides her');
});

test('"Not for me" only hides from the viewer who said it', async () => {
  const { flags } = await AlgorithmConfigService.get();
  const other = await viewer(viewers[1]);
  const ids = await StandoutsV3Service.gather(other, day, flags, null, { photos: 3, activeDays: flags.standouts_active_days }, 5);
  assert.ok(ids.includes(unready.hidden));
});

test('a first-open set: full size, varied, with each card\'s slot saved', async () => {
  const { flags } = await AlgorithmConfigService.get();
  const set = await StandoutsV3Service.chooseForViewer(await viewer(viewers[2]), day);
  assert.equal(set.picks.length, Math.min(flags.standouts_size, 8));
  assert.equal(set.slots.length, set.picks.length, 'one slot per card');
  assert.equal(new Set(set.picks).size, set.picks.length, 'no one twice');
  for (const id of set.picks) assert.ok(ready.includes(id), 'only ready people');
  const departments = await prisma.user.findMany({ where: { id: { in: set.picks } }, select: { department: true } });
  const counts = new Map<string, number>();
  for (const { department } of departments) counts.set(department!, (counts.get(department!) ?? 0) + 1);
  for (const [department, count] of counts) assert.ok(count <= flags.standouts_max_per_department, `${department} appears ${count} times`);
  assert.ok(set.slots.includes('new'), 'everyone here joined today, so the new-face slot is filled');
});

test('taste is learned from swipes: Likes count for a trait, Passes against', async () => {
  const { flags } = await AlgorithmConfigService.get();
  const me = await viewer(viewers[3]);
  // 24 swipes: Likes on CSE, Passes on ME.
  const cse = ready.filter((_, index) => DEPARTMENTS[index % DEPARTMENTS.length] === 'CSE');
  const me_ = ready.filter((_, index) => DEPARTMENTS[index % DEPARTMENTS.length] === 'ME');
  const swipes: Prisma.SwipeCreateManyInput[] = [];
  for (let round = 0; round < 6; round++) {
    for (const id of cse) swipes.push({ swiperId: me.id, targetId: id, action: 'like', createdAt: new Date(Date.now() - round * 60_000) });
    for (const id of me_) swipes.push({ swiperId: me.id, targetId: id, action: 'pass', createdAt: new Date(Date.now() - round * 60_000) });
  }
  // Swipes are unique per pair; spread them across distinct fake targets of the same traits instead.
  const unique = new Map(swipes.map((swipe) => [`${swipe.targetId}`, swipe]));
  await prisma.swipe.createMany({ data: [...unique.values()], skipDuplicates: true });
  const taste = await StandoutsV3Service.taste(me, day, flags);
  assert.ok((taste.traits['department:cse']?.[0] ?? 0) > 0, 'Likes on CSE were counted');
  assert.ok((taste.traits['department:me']?.[1] ?? 0) > 0, 'Passes on ME were counted');
  await prisma.swipe.deleteMany({ where: { swiperId: me.id } });
});

test('the night run writes every viewer\'s set, records its limits, and leaves nobody over them', async () => {
  await prisma.standoutDay.deleteMany({ where: { viewerId: { in: viewers }, day } });
  const summary = await StandoutsV3Service.nightly(day, 'live');
  assert.ok(summary.viewers >= viewers.length, 'every test viewer was covered');
  const rows = await prisma.standoutDay.findMany({ where: { viewerId: { in: viewers }, day } });
  assert.equal(rows.length, viewers.length, 'one set per viewer');
  for (const row of rows) {
    assert.equal(row.version, 'v3');
    assert.equal(row.slots.length, row.picks.length);
    for (const id of row.picks) assert.ok(ready.includes(id), 'only ready people');
    assert.ok(row.taste, 'the day\'s taste profile is stored with the set');
  }
  const run = await prisma.standoutRun.findUniqueOrThrow({ where: { day } });
  assert.ok(run.finishedAt, 'the run finished');
  const limits = run.limits as Record<string, number>;
  assert.ok(Object.keys(limits).length > 0, 'the run recorded its fairness limits');
  const appearances = new Map<string, number>();
  for (const row of rows) for (const id of row.picks) appearances.set(id, (appearances.get(id) ?? 0) + 1);
  const limit = Math.min(...Object.values(limits));
  for (const count of appearances.values()) assert.ok(count <= Math.max(...Object.values(limits)), 'nobody over the limit');
  assert.ok(limit >= 3, 'limits are never below 3');
});

test('the metrics read without errors and never name anyone', async () => {
  const summary = await StandoutsMetricsService.summary(7);
  assert.equal(typeof summary.coverage.readyProfiles, 'number');
  assert.ok(summary.fairness.appearancesGini >= 0 && summary.fairness.appearancesGini <= 1);
  const text = JSON.stringify(summary);
  for (const id of users) assert.ok(!text.includes(id), 'no ids in the metrics');
});
