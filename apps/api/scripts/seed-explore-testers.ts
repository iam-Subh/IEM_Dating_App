/**
 * Seeds clearly-labelled test accounts so Explore, Likes You and Roses can be
 * exercised on a device (EXPLORE_SPEC.md, section 15).
 *
 * Every account it creates is named "T. <name>" with an @explore.test email,
 * so they are obvious in any list and easy to remove:
 *
 *   npx tsx scripts/seed-explore-testers.ts          # create / update
 *   npx tsx scripts/seed-explore-testers.ts --remove # delete them again
 *
 * It matches each real account's own settings, because two people are only
 * mutually eligible when their discovery modes agree - so testers are seeded
 * in both college and distance mode rather than one.
 *
 * Size and shape are deliberate. Explore refuses to answer a filtered query
 * whose cohort is under EXPLORE_MIN_COHORT (10), so a handful of varied
 * testers leaves every category reading "cohort_too_small". Each real account
 * therefore gets PER_ACCOUNT testers, and each facet - department, year,
 * campus, intent, hosteller, club, spot, degree, interest - is shared by
 * SHARED_PER_FACET of them, which clears the floor with room for two
 * dimensions at once.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { MapService } from '../src/services/map.service';
import { snapToGrid } from '@iem-dating/shared/location';

const EMAIL_DOMAIN = 'explore.test';
const PASSWORD_HASH = '$2a$10$TESTONLYTESTONLYTESTONLYTESTONLYTESTONLYTESTONLYTESTO';

/** Must stay well above EXPLORE_MIN_COHORT after the odd-one-out slices below. */
const PER_ACCOUNT = 24;
/** n % 4 === MINORITY_SLOT is the one tester in four that differs on a facet. */
const MINORITY_SLOT = (n: number, facet: number) => n % 4 === facet;

const WOMEN = [
  'Ananya', 'Ishita', 'Meera', 'Priya', 'Sneha', 'Tara', 'Kavya', 'Riya',
  'Aditi', 'Diya', 'Nandini', 'Shreya', 'Trisha', 'Ira', 'Mahi', 'Saanvi',
  'Anushka', 'Bhavya', 'Charvi', 'Esha', 'Gauri', 'Jiya', 'Lavanya', 'Naina',
];
const MEN = [
  'Arjun', 'Dev', 'Kabir', 'Nikhil', 'Rohan', 'Sahil', 'Vikram', 'Yash',
  'Aarav', 'Ayush', 'Dhruv', 'Harsh', 'Ishaan', 'Karan', 'Manav', 'Neel',
  'Om', 'Parth', 'Rudra', 'Shaurya', 'Tanmay', 'Uday', 'Varun', 'Zayan',
];

const OTHER_DEPARTMENTS = ['Electronics & Communication (ECE)', 'Information Technology (IT)', 'Mechanical Engineering'];
const OTHER_CAMPUS = 'Ashram';
const OTHER_SEEKING = 'Something casual';
const OTHER_DEGREE = 'Postgraduate (M.Tech)';

/** Everyone in the majority slice shares these, so an interest filter resolves. */
const COMMON_INTERESTS = ['music', 'coffee', 'movies'];
const VARIED_INTERESTS = [
  ['photography', 'poetry'], ['football', 'gym'], ['gaming', 'anime'],
  ['dancing', 'travel'], ['chess', 'reading'], ['cricket', 'road_trips'],
];
const COMMON_CLUB = 'Tech/Coding';
const OTHER_CLUBS = ['Chess', 'Music', 'Drama', 'Robotics'];
const COMMON_SPOT = 'Canteen';
const OTHER_SPOTS = ['Library', 'Cafe', 'RDB'];

async function remove() {
  const testers = await prisma.user.findMany({
    where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true, name: true },
  });
  if (!testers.length) {
    console.log('No seeded testers found.');
    return;
  }
  const ids = testers.map((t) => t.id);
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(ARRAY[
      'id','user_id','owner_id','viewer_id','sender_id','recipient_id','swiper_id','target_id','swipe_id',
      'candidate_id','shown_id','user1_id','user2_id','blocker_id','blocked_id','follower_id','followee_id','story_id'
    ])`;
  for (let pass = 0; pass < 6; pass += 1) {
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
  console.log(`Removed ${testers.length} seeded testers.`);
}

const days = (count: number) => count * 24 * 60 * 60_000;

async function main() {
  if (process.argv.includes('--remove')) return remove();

  // The real accounts decide what a tester has to look like to be eligible.
  const allSetUp = await prisma.user.findMany({
    where: { accountStatus: 'active', preferencesConfirmedAt: { not: null } },
    select: {
      email: true,
      id: true, name: true, age: true, birthday: true, college: true, campus: true, campusId: true, department: true,
      degree: true, seeking: true, yearOfStudy: true, graduationYear: true, clubs: true, hangoutSpots: true, preferences: true,
      discoveryMode: true, discoveryCategory: true, showMeCategories: true,
      minAgePref: true, maxAgePref: true, latitude: true, longitude: true, distancePreference: true,
      studentMembership: { select: { institutionId: true } },
    },
  });
  // A null email is common here (phone signups), and `not endsWith` drops
  // those rows in SQL, so the exclusion happens in JS instead.
  const realAccounts = allSetUp.filter((account) => !account.email?.endsWith(`@${EMAIL_DOMAIN}`));
  if (!realAccounts.length) throw new Error('No real set-up account to model testers on.');

  console.log('Seeding testers to be eligible for:');
  for (const account of realAccounts) {
    console.log(`  ${account.name} — ${account.discoveryMode} mode, ${account.discoveryCategory} seeing ${JSON.stringify(account.showMeCategories)}, ages ${account.minAgePref}-${account.maxAgePref}`);
  }

  let created = 0;
  for (const target of realAccounts) {
    const institutionId = target.studentMembership?.institutionId;
    if (!institutionId || !target.discoveryCategory || !target.showMeCategories.length) {
      console.log(`  (skipping ${target.name}: no verified membership or preferences)`);
      continue;
    }
    // The category this person wants to see, an age inside their range, and
    // the same discovery mode - otherwise the two never meet at all.
    const wanted = target.showMeCategories[0] as 'man' | 'woman';
    const pool = wanted === 'man' ? MEN : WOMEN;
    const age = Math.min(Math.max(target.minAgePref ?? 18, 20), target.maxAgePref ?? 24);
    const birthday = new Date(Date.UTC(new Date().getUTCFullYear() - age, 5, 15));
    const targetSpot = target.hangoutSpots?.[0]?.trim() || COMMON_SPOT;
    const ownInterests = (target.preferences as { interests?: unknown } | null)?.interests;
    const targetInterests = (Array.isArray(ownInterests) ? ownInterests : [])
      .filter((item): item is string => typeof item === 'string');
    // Campuses by id, within this person's own institution (LOCATION_SPEC.md 8.1).
    const institutionCampuses = await prisma.institutionCampus.findMany({ where: { institutionId, isActive: true } });
    const otherCampus = institutionCampuses.find((campus) => campus.name === OTHER_CAMPUS && campus.id !== target.campusId)
      ?? institutionCampuses.find((campus) => campus.id !== target.campusId)
      ?? null;
    // Distance testers sit in two neighbouring map tiles (0.06 degrees apart),
    // twelve in each, so the map's "areas" layer has two qualifying tiles that
    // are each other's neighbour - a lone tile would be suppressed by design.
    const home = target.latitude !== null && target.longitude !== null
      ? { latitude: Number(target.latitude), longitude: Number(target.longitude) }
      : null;
    const testerIds: string[] = [];

    for (let n = 0; n < PER_ACCOUNT; n += 1) {
      const name = `T. ${pool[n % pool.length]}`;
      const email = `tester-${target.discoveryMode}-${n}@${EMAIL_DOMAIN}`;
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      const id = existing?.id ?? randomUUID();

      // One in four differs on each facet, on a different slot per facet, so
      // the majorities overlap and two filters at once still find a cohort.
      const sameDepartment = !MINORITY_SLOT(n, 3);
      const sameYear = !MINORITY_SLOT(n, 2);
      const sameCampus = !MINORITY_SLOT(n, 1);
      const sameIntent = !MINORITY_SLOT(n, 0);
      const common = !MINORITY_SLOT(n, 0); // interests, club, spot, degree, hosteller

      const data = {
        name,
        passwordHash: PASSWORD_HASH,
        accountStatus: 'active',
        birthday,
        age,
        gender: wanted === 'man' ? 'Cis man' : 'Cis woman',
        discoveryMode: target.discoveryMode,
        discoveryCategory: wanted,
        // Sees the real account back, which is what makes it mutual.
        showMeCategories: [target.discoveryCategory],
        minAgePref: 18,
        maxAgePref: 40,
        preferencesConfirmedAt: new Date(),
        college: target.college,
        campus: sameCampus ? target.campus : otherCampus?.name ?? OTHER_CAMPUS,
        campusId: sameCampus ? target.campusId : otherCampus?.id ?? null,
        department: sameDepartment ? target.department : OTHER_DEPARTMENTS[n % OTHER_DEPARTMENTS.length],
        yearOfStudy: sameYear ? target.yearOfStudy ?? 3 : ((n % 4) + 1),
        graduationYear: sameYear ? target.graduationYear ?? 2026 : 2027 + (n % 2),
        degree: common ? target.degree ?? OTHER_DEGREE : OTHER_DEGREE,
        isHosteller: common,
        clubs: common ? [COMMON_CLUB] : [OTHER_CLUBS[n % OTHER_CLUBS.length]],
        hangoutSpots: common ? [targetSpot] : [OTHER_SPOTS[n % OTHER_SPOTS.length]],
        seeking: sameIntent ? target.seeking ?? 'Long-term partner' : OTHER_SEEKING,
        preferences: {
          interests: [
            // Two of the real account's own interests, so "Shared interests"
            // has a cohort - that category matches against the viewer's list,
            // not a fixed one, so generic tags would never satisfy it.
            ...(common ? targetInterests.slice(0, 2) : []),
            ...(common ? COMMON_INTERESTS : []),
            ...VARIED_INTERESTS[n % VARIED_INTERESTS.length],
          ],
          bio: `Test account ${n + 1} for Explore.`,
        },
        // Distance mode needs a fresh, consented location near the person -
        // snapped to the grid like every stored location, never raw.
        ...(target.discoveryMode === 'distance' && home
          ? (() => {
            const cell = snapToGrid({
              latitude: home.latitude,
              longitude: home.longitude + (n % 2 === 0 ? 0 : 0.06),
            });
            return {
              latitude: cell.latitude,
              longitude: cell.longitude,
              liveLatitude: cell.latitude,
              liveLongitude: cell.longitude,
              liveUpdatedAt: new Date(),
              locationConsentAt: new Date(),
              locationUpdatedAt: new Date(),
              locationSource: 'live',
              distancePreference: 100,
            };
          })()
          : {}),
        // Spread joining dates so "New here" and "Active" each have a cohort:
        // the first 14 joined this month, the first 18 were active this week.
        createdAt: new Date(Date.now() - days(n < 14 ? n : 90 + n)),
        lastActiveAt: new Date(Date.now() - days(n < 18 ? n % 6 : 40)),
      };
      if (existing) {
        await prisma.user.update({ where: { id }, data });
      } else {
        await prisma.user.create({ data: { id, email, ...data } });
        created += 1;
      }
      await prisma.studentMembership.upsert({
        where: { userId: id },
        create: {
          userId: id,
          institutionId,
          institutionalEmail: `tester-${target.discoveryMode}-${n}@iem.${EMAIL_DOMAIN}`,
          status: 'verified',
          verifiedAt: new Date(),
        },
        update: { institutionId, status: 'verified', verifiedAt: new Date() },
      });
      testerIds.push(id);
    }

    // Map spots (LOCATION_SPEC.md 9.2): two real public places near the
    // person, found through the same search the app uses and pinned through
    // the same service, so they obey the same rules. 18 testers pin the first
    // and 12 the second: both clear the floor of 10 and open a list.
    const near = home ?? (() => {
      const campus = institutionCampuses.find((entry) => entry.id === target.campusId);
      return campus?.latitude != null && campus.longitude != null
        ? { latitude: Number(campus.latitude), longitude: Number(campus.longitude) }
        : null;
    })();
    if (near) {
      try {
        const found = await MapService.searchPlaces('cafe', near);
        const [first, second] = found;
        for (const [n, id] of testerIds.entries()) {
          await prisma.userMapPlace.deleteMany({ where: { userId: id } });
          if (first && !MINORITY_SLOT(n, 0)) await MapService.addMyPlace(id, first.externalId);
          if (second && n < 12) await MapService.addMyPlace(id, second.externalId);
        }
        console.log(`  map spots for ${target.name}'s testers: ${[first, second].filter(Boolean).map((place) => place!.name).join(', ') || 'none found'}`);
      } catch (error) {
        console.log(`  (map spots skipped for ${target.name}: ${(error as Error).message})`);
      }
    }
  }
  const total = await prisma.user.count({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  console.log(`\n${created} created, ${total} seeded testers in total.`);
  console.log('Remove them with: npx tsx scripts/seed-explore-testers.ts --remove');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await prisma.$disconnect();
    redisClient.disconnect();
  });
