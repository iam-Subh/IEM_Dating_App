/**
 * Integration tests for location (LOCATION_SPEC.md).
 *
 * The most important test here is the cross-check: `eligibleSql` (retrieval)
 * and `mutuallyEligible` (the swipe and follow gates) implement the same
 * rules twice, and they once disagreed, so a card could be shown and then
 * refused. Every ordered pair in a matrix of users - every campus, scope and
 * mode - must get the same answer from both.
 *
 * Non-destructive: creates its own users under random ids against the real
 * institutions and campuses, and deletes exactly those rows.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import {
  DAILY_CELL_CHANGES,
  DAILY_RADIUS_CHANGES,
  ERASED_POSITION,
  LocationService,
} from '../src/services/location.service';
import { DiscoverySettingsController } from '../src/controllers/discovery-settings.controller';
import { ProfileService } from '../src/services/profile.service';
import {
  eligibleSql,
  istMinuteOfDay,
  loadEligibilityParties,
  mutuallyEligible,
} from '../src/services/eligibility.service';
import { discoveryProfileSelect, publicProfile } from '../src/services/public-profile.service';
import { AlgorithmConfigService } from '../src/services/algorithm-config.service';
import { MAP_MIN_COUNT, MapService, mapBand, visibleTiles } from '../src/services/map.service';
import { StudentMembershipService } from '../src/services/student-membership.service';
import { ExploreService } from '../src/services/explore.service';
import { snapToGrid } from '@iem-dating/shared/location';

const created: string[] = [];
const ID_COLUMNS = [
  'id', 'user_id', 'owner_id', 'viewer_id', 'story_id', 'sender_id', 'recipient_id', 'swiper_id', 'target_id',
  'swipe_id', 'candidate_id', 'shown_id', 'user1_id', 'user2_id', 'blocker_id', 'blocked_id', 'follower_id', 'followee_id',
];

/** Real, public anchors from the campus table (Sector V and New Town), and a far city. */
const SALT_LAKE = { latitude: 22.57421, longitude: 88.43369 };
const NEW_TOWN = { latitude: 22.55986, longitude: 88.48994 };
const DELHI = { latitude: 28.61, longitude: 77.21 };
/** A point exactly on the 0.02 degree grid. */
const HERE = { latitude: 22.56, longitude: 88.36 };
/** ~9 km east of Sector V: clearly outside 5 km, clearly inside 10 km. */
const EAST_OF_NEW_TOWN = { latitude: 22.56, longitude: 88.52 };

let institutions: Record<'IEM' | 'UEM_KOL' | 'UEM_JAI', string>;
let campuses: Record<'GURUKUL' | 'ASHRAM' | 'MANAGEMENT_HOUSE' | 'NEW_TOWN' | 'JAIPUR', string>;

type Spec = {
  institution: keyof typeof institutions;
  campus?: keyof typeof campuses;
  mode: 'college' | 'distance';
  scope?: 'campus' | 'college' | 'city' | 'group';
  at?: { latitude: number; longitude: number };
  radius?: number;
  staleDays?: number;
  invisibleNow?: boolean;
  confirmed?: boolean;
  /** "Show people further away": on by default in the app, off here unless a case asks. */
  further?: boolean;
  /**
   * Not verified (GOOGLE_SIGNUP_PLAN.md 2.1): "chosen" - a Google sign-up that
   * chose `institution` in onboarding, with no membership; "expired" - a
   * verification at `institution` that has run out.
   */
  unverified?: 'chosen' | 'expired';
};

/** A verified member, mutually compatible with every other test user on category and age. */
async function makeUser(label: string, spec: Spec) {
  const id = randomUUID();
  created.push(id);
  const cell = spec.at ? snapToGrid(spec.at) : null;
  const updatedAt = new Date(Date.now() - (spec.staleDays ?? 0) * 24 * 60 * 60_000);
  const minute = istMinuteOfDay();
  await prisma.user.create({
    data: {
      id,
      email: `${id}@location.example.test`,
      name: label,
      passwordHash: 'TEST_ONLY',
      accountStatus: 'active',
      birthday: new Date('2004-01-01'),
      age: 22,
      college: 'Location Test College',
      discoveryMode: spec.mode,
      discoveryCategory: 'nonbinary',
      showMeCategories: ['nonbinary'],
      minAgePref: 18,
      maxAgePref: 40,
      distancePreference: spec.radius ?? 25,
      collegeScope: spec.scope ?? 'college',
      expandRadius: spec.further ?? false,
      campusId: spec.campus ? campuses[spec.campus] : null,
      claimedInstitutionId: spec.unverified === 'chosen' ? institutions[spec.institution] : null,
      preferencesConfirmedAt: new Date(),
      ...(cell
        ? {
          latitude: cell.latitude,
          longitude: cell.longitude,
          liveLatitude: cell.latitude,
          liveLongitude: cell.longitude,
          liveUpdatedAt: updatedAt,
          locationUpdatedAt: updatedAt,
          locationConsentAt: new Date(),
        }
        : {}),
      ...(spec.invisibleNow
        ? { invisibleStart: (minute + 1430) % 1440, invisibleEnd: (minute + 10) % 1440 }
        : {}),
    },
  });
  if (spec.unverified === 'chosen') return id;
  await prisma.studentMembership.create({
    data: {
      userId: id,
      institutionId: institutions[spec.institution],
      institutionalEmail: `${id}@member.example.test`,
      status: 'verified',
      verifiedAt: new Date(),
      ...(spec.unverified === 'expired' ? { expiresAt: new Date(Date.now() - 24 * 60 * 60_000) } : {}),
      campusConfirmed: spec.confirmed ?? true,
    },
  });
  return id;
}

async function callSettings(userId: string, body: Record<string, unknown>) {
  let status = 200;
  let failure: any;
  const res: any = { status(code: number) { status = code; return res; }, json() { return res; } };
  await DiscoverySettingsController.update({ body, user: { sub: userId } } as any, res, (error: any) => { failure = error; });
  return { status: failure?.status ?? status, code: failure?.code };
}

const settings = (overrides: Record<string, unknown> = {}) => ({
  discoveryCategory: 'nonbinary',
  showMeCategories: ['nonbinary'],
  minAgePref: 18,
  maxAgePref: 40,
  discoveryMode: 'distance',
  distancePreference: 25,
  ...overrides,
});

const ageFix = (id: string, hours: number) =>
  prisma.user.update({ where: { id }, data: { liveUpdatedAt: new Date(Date.now() - hours * 3_600_000) } });

before(async () => {
  const rows = await prisma.institution.findMany({ select: { id: true, code: true } });
  const byCode = (code: string) => rows.find((row) => row.code === code)!.id;
  institutions = { IEM: byCode('IEM-KOLKATA'), UEM_KOL: byCode('UEM-KOLKATA'), UEM_JAI: byCode('UEM-JAIPUR') };
  const campusRows = await prisma.institutionCampus.findMany({ select: { id: true, code: true, institutionId: true } });
  const campus = (institution: string, code: string) =>
    campusRows.find((row) => row.institutionId === institution && row.code === code)!.id;
  campuses = {
    GURUKUL: campus(institutions.IEM, 'GURUKUL'),
    ASHRAM: campus(institutions.IEM, 'ASHRAM'),
    MANAGEMENT_HOUSE: campus(institutions.IEM, 'MANAGEMENT_HOUSE'),
    NEW_TOWN: campus(institutions.UEM_KOL, 'NEW_TOWN'),
    JAIPUR: campus(institutions.UEM_JAI, 'JAIPUR'),
  };
});

after(async () => {
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(${ID_COLUMNS})`;
  for (let pass = 0; pass < 6; pass++) {
    let failures = 0;
    for (const { table_name, column_name } of columns) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1::uuid[])`, created);
      } catch {
        failures += 1;
      }
    }
    if (!failures) break;
  }
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

// ---------------------------------------------------------------------------
// Writing a location (6.3, 6.7)
// ---------------------------------------------------------------------------

test('a fix in the same cell costs nothing but keeps the location fresh', async () => {
  const id = await makeUser('walker', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE });
  await prisma.user.update({ where: { id }, data: { locationUpdatedAt: new Date(Date.now() - 5 * 24 * 3_600_000) } });

  // A few hundred metres away: the same 0.02 degree cell, as a phone reports on every open.
  const again = await LocationService.update(id, { latitude: HERE.latitude + 0.003, longitude: HERE.longitude - 0.003 }, { accuracy: 'precise' });
  assert.equal(again.changed, false);
  const spent = await prisma.analyticsEvent.count({ where: { userId: id, eventType: 'location_cell_changed' } });
  assert.equal(spent, 0, 'staying put never spends the daily budget');
  const after = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.ok(after.locationUpdatedAt! > new Date(Date.now() - 60_000), 'but it does refresh, or daily users would go stale');
  assert.equal(after.locationAccuracy, 'precise');
});

test('a move to another cell is stored snapped to the 0.02 degree grid', async () => {
  const id = await makeUser('mover', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE });
  await ageFix(id, 1);
  const moved = await LocationService.update(id, { latitude: 22.5812, longitude: 88.3791 });
  assert.equal(moved.changed, true);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(Number(stored.latitude), 22.58);
  assert.equal(Number(stored.longitude), 88.38);
  assert.equal(Number(stored.liveLatitude), 22.58, 'the speed baseline follows the phone');
});

test('a jump no real journey could make is refused and recorded', async () => {
  const id = await makeUser('teleporter', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE });
  await ageFix(id, 1 / 60);
  await assert.rejects(() => LocationService.update(id, DELHI), (error: any) => error.code === 'LOCATION_IMPLAUSIBLE');
  const stored = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(Number(stored.latitude), snapToGrid(HERE).latitude, 'the old location stands');
  assert.equal(await prisma.analyticsEvent.count({ where: { userId: id, eventType: 'location_change_refused' } }), 1);

  await ageFix(id, 24); // the same trip over a day is a train ride
  assert.equal((await LocationService.update(id, DELHI)).changed, true);
});

test('the daily budget of cell changes holds', async () => {
  const id = await makeUser('budget', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE });
  let latitude = HERE.latitude;
  for (let n = 0; n < DAILY_CELL_CHANGES; n += 1) {
    latitude += 0.02;
    await ageFix(id, 1);
    await LocationService.update(id, { latitude, longitude: HERE.longitude });
  }
  await ageFix(id, 1);
  await assert.rejects(
    () => LocationService.update(id, { latitude: latitude + 0.02, longitude: HERE.longitude }),
    (error: any) => error.code === 'LOCATION_CHANGE_LIMIT',
  );
});

test('recorded events never contain coordinates', async () => {
  const events = await prisma.analyticsEvent.findMany({
    where: { userId: { in: created }, eventType: { in: ['location_cell_changed', 'location_change_refused', 'radius_changed'] } },
    select: { eventData: true },
  });
  assert.ok(events.length > 0);
  for (const { eventData } of events) {
    const text = JSON.stringify(eventData);
    assert.ok(!/latitude|longitude|"lat"|"lon"|\d+\.\d{2,}/.test(text), `an event carried a location: ${text}`);
  }
});

// ---------------------------------------------------------------------------
// Radius (6.5)
// ---------------------------------------------------------------------------

test('radius is rounded up to a preset, and only a real change is budgeted', async () => {
  const id = await makeUser('radius', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE, radius: 25 });
  assert.equal((await callSettings(id, settings({ distancePreference: 7 }))).status, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id } })).distancePreference, 10, '7 km becomes 10, never 5');

  for (let n = 0; n < DAILY_RADIUS_CHANGES + 2; n += 1) {
    assert.equal((await callSettings(id, settings({ distancePreference: 10 }))).status, 200, 'an unchanged radius is free');
  }
  const already = await prisma.analyticsEvent.count({ where: { userId: id, eventType: 'radius_changed' } });
  // Alternate away from the current 10 km so every save is a real change.
  for (let n = already; n < DAILY_RADIUS_CHANGES; n += 1) {
    assert.equal((await callSettings(id, settings({ distancePreference: (n - already) % 2 === 0 ? 15 : 10 }))).status, 200);
  }
  assert.equal(await prisma.analyticsEvent.count({ where: { userId: id, eventType: 'radius_changed' } }), DAILY_RADIUS_CHANGES);
  const refused = await callSettings(id, settings({ distancePreference: 50 }));
  assert.equal(refused.code, 'RADIUS_CHANGE_LIMIT');
});

test('the profile route is no longer a way round the radius presets and budget', async () => {
  const id = await makeUser('profile-radius', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE, radius: 25 });
  await ProfileService.updateProfile(id, { distancePreference: 3 });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id } })).distancePreference, 5);
  assert.equal(await prisma.analyticsEvent.count({ where: { userId: id, eventType: 'radius_changed' } }), 1);
});

// ---------------------------------------------------------------------------
// Erasure and staleness (6.8)
// ---------------------------------------------------------------------------

test('switching to college mode erases every stored position', async () => {
  const id = await makeUser('switcher', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE });
  assert.equal((await callSettings(id, settings({ discoveryMode: 'college' }))).status, 200);
  const after = await prisma.user.findUniqueOrThrow({ where: { id } });
  for (const key of Object.keys(ERASED_POSITION) as (keyof typeof ERASED_POSITION)[]) {
    assert.deepEqual((after as any)[key], ERASED_POSITION[key], `${key} was not erased`);
  }
  assert.ok(after.locationConsentAt, 'the consent record stays for audit');
  assert.equal((await callSettings(id, settings())).code, 'LOCATION_REQUIRED', 'distance mode asks again');
});

test('a fix in college mode is never displayed, is promoted on switching to distance, and is swept within the hour', async () => {
  const id = await makeUser('college-sharer', { institution: 'IEM', campus: 'GURUKUL', mode: 'college' });
  const fix = await LocationService.update(id, HERE, { accuracy: 'approximate' });
  assert.equal(fix.cell, null);
  let me = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(me.latitude, null, 'college mode stores no discoverable location');
  assert.equal(Number(me.liveLatitude), snapToGrid(HERE).latitude, 'only the short-lived baseline');

  assert.equal((await callSettings(id, settings())).status, 200, 'switching straight away uses the fix just shared');
  me = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(Number(me.latitude), snapToGrid(HERE).latitude);
  assert.ok(me.locationUpdatedAt! > new Date(Date.now() - 60_000));

  const other = await makeUser('college-leftover', { institution: 'IEM', campus: 'GURUKUL', mode: 'college' });
  await LocationService.update(other, HERE);
  await prisma.user.update({ where: { id: other }, data: { liveUpdatedAt: new Date(Date.now() - 61 * 60_000) } });
  await LocationService.sweep();
  const leftover = await prisma.user.findUniqueOrThrow({ where: { id: other } });
  assert.equal(leftover.liveLatitude, null, 'an unused college-mode fix is gone within the hour');
});

test('the retention sweep erases 30-day-old positions and 90-day-old places', async () => {
  const id = await makeUser('stale', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE, staleDays: 31 });
  await prisma.savedPlace.create({
    data: { userId: id, label: 'Old', latitude: 22.6, longitude: 88.4, lastVisitedAt: new Date(Date.now() - 91 * 24 * 3_600_000) },
  });
  await LocationService.sweep();
  const after = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(after.latitude, null);
  assert.equal(after.liveLatitude, null);
  assert.equal(await prisma.savedPlace.count({ where: { userId: id } }), 0);
});

// ---------------------------------------------------------------------------
// Saved places (7)
// ---------------------------------------------------------------------------

test('a place can only be saved where the phone actually is, three at most', async () => {
  const id = await makeUser('saver', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE });
  await ageFix(id, 1);
  await assert.rejects(() => LocationService.savePlace(id, 'Hostel'), (error: any) => error.code === 'PLACE_NEEDS_LIVE_FIX');

  await ageFix(id, 0);
  const hostel = await LocationService.savePlace(id, '  Hostel  ');
  assert.equal(hostel.label, 'Hostel');
  const stored = await prisma.savedPlace.findUniqueOrThrow({ where: { id: hostel.id } });
  assert.equal(Number(stored.latitude), snapToGrid(HERE).latitude, 'stored as the live cell, never a point');
  await assert.rejects(() => LocationService.savePlace(id, 'Again'), (error: any) => error.code === 'PLACE_ALREADY_SAVED');

  for (const [n, label] of ['Home', 'PG'].entries()) {
    await ageFix(id, 1);
    await LocationService.update(id, { latitude: HERE.latitude + 0.04 * (n + 1), longitude: HERE.longitude });
    await LocationService.savePlace(id, label);
  }
  await ageFix(id, 1);
  await LocationService.update(id, { latitude: HERE.latitude + 0.2, longitude: HERE.longitude });
  await assert.rejects(() => LocationService.savePlace(id, 'Fourth'), (error: any) => error.code === 'PLACE_LIMIT');
});

test('using a saved place moves you there, spends the budget, and does not trip the speed check on return', async () => {
  const id = await makeUser('commuter', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE });
  await ageFix(id, 0);
  const hostel = await LocationService.savePlace(id, 'Hostel');
  // Travel home over a day, save Home there.
  await ageFix(id, 24);
  const home = { latitude: 22.9, longitude: 88.4 };
  await LocationService.update(id, home);
  const homePlace = await LocationService.savePlace(id, 'Home');

  // From home, appear from the hostel.
  const used = await LocationService.useSource(id, hostel.id);
  assert.equal(used.source, 'place');
  let me = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(Number(me.latitude), snapToGrid(HERE).latitude);
  assert.equal(Number(me.liveLatitude), snapToGrid(home).latitude, 'the live baseline stays at home');

  // Live fixes at home do not move the displayed cell while the place is in use.
  const fix = await LocationService.update(id, home);
  assert.equal(fix.source, 'place');
  assert.equal(fix.matchedPlace?.id, homePlace.id, 'and the fix is recognised as Home');
  me = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(Number(me.latitude), snapToGrid(HERE).latitude);

  // Back to live: the next fix at home is compared with home, not the hostel, so it is no "jump".
  await LocationService.useSource(id, null);
  const back = await LocationService.update(id, home);
  assert.equal(back.changed, true);
});

test('"hide me here" stores nothing there and stops showing you there at once', async () => {
  const id = await makeUser('hider', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE });
  await ageFix(id, 0);
  const place = await LocationService.savePlace(id, 'Home');
  await LocationService.updatePlace(id, place.id, { hideHere: true });
  let me = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(me.latitude, null, 'the place being shown was hidden, so it stops being shown');

  const fix = await LocationService.update(id, HERE);
  assert.equal(fix.hiddenHere, true);
  me = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(me.latitude, null, 'a fix inside a hidden place stores nothing');
  await assert.rejects(() => LocationService.useSource(id, place.id), (error: any) => error.code === 'PLACE_HIDDEN');
});

// ---------------------------------------------------------------------------
// Eligibility: retrieval and the swipe gate must agree (2, 6, 8)
// ---------------------------------------------------------------------------

test('eligibleSql and mutuallyEligible agree on every pair, and the rules hold', async () => {
  const people = {
    gurukulCollege: await makeUser('Gurukul college', { institution: 'IEM', campus: 'GURUKUL', mode: 'college' }),
    ashramCollege: await makeUser('Ashram college', { institution: 'IEM', campus: 'ASHRAM', mode: 'college' }),
    ashramCampusOnly: await makeUser('Ashram campus-only', { institution: 'IEM', campus: 'ASHRAM', mode: 'college', scope: 'campus' }),
    ashramCampusFurther: await makeUser('Ashram campus, further', { institution: 'IEM', campus: 'ASHRAM', mode: 'college', scope: 'campus', further: true }),
    newTownCollegeFurther: await makeUser('New Town college, further', { institution: 'UEM_KOL', campus: 'NEW_TOWN', mode: 'college', further: true }),
    gurukulCity: await makeUser('Gurukul city', { institution: 'IEM', campus: 'GURUKUL', mode: 'college', scope: 'city' }),
    gurukulGroup: await makeUser('Gurukul group', { institution: 'IEM', campus: 'GURUKUL', mode: 'college', scope: 'group' }),
    newTownCollege: await makeUser('New Town college', { institution: 'UEM_KOL', campus: 'NEW_TOWN', mode: 'college' }),
    newTownCity: await makeUser('New Town city', { institution: 'UEM_KOL', campus: 'NEW_TOWN', mode: 'college', scope: 'city' }),
    jaipurGroup: await makeUser('Jaipur group', { institution: 'UEM_JAI', campus: 'JAIPUR', mode: 'college', scope: 'group' }),
    jaipurUnconfirmed: await makeUser('Jaipur unconfirmed', { institution: 'UEM_JAI', campus: 'JAIPUR', mode: 'college', scope: 'group', confirmed: false }),
    iemDistanceNear: await makeUser('IEM distance near', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: SALT_LAKE, radius: 10 }),
    newTownDistance5: await makeUser('New Town distance 5km', { institution: 'UEM_KOL', campus: 'NEW_TOWN', mode: 'distance', at: EAST_OF_NEW_TOWN, radius: 5 }),
    newTownDistance10: await makeUser('New Town distance 10km', { institution: 'UEM_KOL', campus: 'NEW_TOWN', mode: 'distance', at: NEW_TOWN, radius: 10 }),
    delhiDistance: await makeUser('Delhi distance', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: DELHI, radius: 100 }),
    staleDistance: await makeUser('Stale distance', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: SALT_LAKE, radius: 25, staleDays: 20 }),
    invisibleDistance: await makeUser('Invisible distance', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: SALT_LAKE, radius: 25, invisibleNow: true }),
    // Unverified (GOOGLE_SIGNUP_PLAN.md 2.1): their saved scope is ignored - they always reach the group.
    googleIem: await makeUser('Google, chose IEM', { institution: 'IEM', mode: 'college', unverified: 'chosen' }),
    googleJaipur: await makeUser('Google, chose UEM Jaipur', { institution: 'UEM_JAI', mode: 'college', scope: 'campus', unverified: 'chosen' }),
    expiredIem: await makeUser('Expired IEM', { institution: 'IEM', campus: 'GURUKUL', mode: 'college', unverified: 'expired' }),
    googleGurukul: await makeUser('Google, chose IEM Gurukul', { institution: 'IEM', campus: 'GURUKUL', mode: 'college', unverified: 'chosen' }),
    googleNearby: await makeUser('Google, people nearby', { institution: 'IEM', mode: 'distance', at: SALT_LAKE, radius: 10, unverified: 'chosen' }),
  };
  const ids = Object.values(people);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: ids } } })).map((user) => [user.id, user]));
  const parties = await loadEligibilityParties(prisma, ids);
  const name = (id: string) => Object.entries(people).find(([, value]) => value === id)![0];

  const sqlSees = new Map<string, Set<string>>();
  for (const viewer of ids) {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT u.id FROM users u WHERE u.id = ANY(${ids}::uuid[]) AND ${eligibleSql(users.get(viewer)!)}`);
    sqlSees.set(viewer, new Set(rows.map((row) => row.id)));
  }
  const js = (a: string, b: string) =>
    mutuallyEligible(users.get(a)!, users.get(b)!, { a: parties.get(a), b: parties.get(b) });
  const sql = (viewer: string, candidate: string) => sqlSees.get(viewer)!.has(candidate);

  // 1. Agreement, pair by pair. Invisible hours are visibility only, so the
  //    one allowed difference is SQL hiding an invisible candidate.
  for (const viewer of ids) {
    for (const candidate of ids) {
      if (viewer === candidate) continue;
      const expected = js(viewer, candidate) && candidate !== people.invisibleDistance;
      assert.equal(sql(viewer, candidate), expected,
        `${name(viewer)} -> ${name(candidate)}: SQL ${sql(viewer, candidate)}, JS ${js(viewer, candidate)}`);
    }
  }
  // Mutual means symmetric.
  for (const a of ids) for (const b of ids) if (a !== b) assert.equal(js(a, b), js(b, a), `${name(a)} / ${name(b)} not symmetric`);

  // 2. The rules themselves.
  const yes = (a: string, b: string, why: string) => assert.equal(js(a, b), true, why);
  const no = (a: string, b: string, why: string) => assert.equal(js(a, b), false, why);
  yes(people.gurukulCollege, people.ashramCollege, 'Gurukul and Ashram are one institution');
  no(people.gurukulCollege, people.ashramCampusOnly, '"My campus" on Ashram excludes Gurukul');
  no(people.gurukulCollege, people.newTownCollege, 'IEM and UEM New Town are different institutions');
  no(people.gurukulCity, people.newTownCollege, 'both sides must widen: New Town is on "My college"');
  yes(people.gurukulCollege, people.ashramCampusFurther, '"further away" widens "My campus" to the whole college');
  yes(people.gurukulCity, people.newTownCollegeFurther, '"further away" widens "My college" to the city');
  no(people.gurukulCollege, people.newTownCollegeFurther, 'widening one side is not enough: Gurukul is on "My college"');
  yes(people.gurukulCity, people.newTownCity, 'both chose "in my city", same group, same city');
  no(people.gurukulCity, people.jaipurGroup, 'Jaipur is another city, and Gurukul only chose its city');
  // UEM Jaipur is not live yet (switched off): nobody reaches it, whatever the scope.
  no(people.gurukulGroup, people.jaipurGroup, 'UEM Jaipur is switched off');
  no(people.gurukulGroup, people.jaipurUnconfirmed, 'an unconfirmed campus stays inside its own institution');
  yes(people.gurukulCollege, people.iemDistanceNear, 'same institution; the Gurukul anchor is inside the 10 km radius');
  no(people.gurukulCollege, people.newTownDistance10, 'Gurukul on "My college" does not reach UEM');
  no(people.gurukulCity, people.newTownDistance5, 'Sector V is ~9 km away, outside a 5 km radius');
  yes(people.gurukulCity, people.newTownDistance10, 'within 10 km, and Gurukul reaches UEM Kolkata');
  yes(people.iemDistanceNear, people.newTownDistance10, 'two distance users within both radii');
  no(people.iemDistanceNear, people.newTownDistance5, 'the smaller radius binds');
  no(people.delhiDistance, people.iemDistanceNear, 'Delhi is outside every Kolkata radius');
  no(people.jaipurGroup, people.delhiDistance, 'Jaipur has no campus pin yet, so it anchors nothing');
  for (const other of ids) {
    if (other !== people.staleDistance) no(people.staleDistance, other, 'a 20-day-old location matches nobody');
  }
  // Unverified people (rule 5): they reach only the campus they chose (their
  // college with none chosen); verified people reach them by their own scope.
  yes(people.gurukulGroup, people.googleIem, 'a verified scope reaches an unverified person at its college');
  yes(people.gurukulCollege, people.googleIem, '"All IEM campuses" reaches an unverified IEM person');
  yes(people.gurukulCity, people.googleIem, '"IEM & UEM Newtown" too');
  no(people.newTownCity, people.googleIem, 'an unverified person stays inside their own college');
  no(people.ashramCampusOnly, people.googleIem, '"My campus" on Ashram: no campus chosen is not Ashram');
  no(people.jaipurGroup, people.googleIem, 'UEM Jaipur is switched off');
  no(people.jaipurUnconfirmed, people.googleIem, 'an unconfirmed campus stays inside its own institution');
  no(people.googleIem, people.googleJaipur, 'a college that is switched off is no party at all');
  yes(people.gurukulCollege, people.googleGurukul, 'chose Gurukul: meets Gurukul');
  no(people.ashramCollege, people.googleGurukul, 'chose Gurukul: not Ashram, until verified');
  yes(people.googleGurukul, people.expiredIem, 'two unverified people on the same campus');
  no(people.ashramCollege, people.expiredIem, 'an expired verification is held to its own campus too');
  yes(people.gurukulCollege, people.expiredIem, '...and meets its campus');
  yes(people.googleGurukul, people.iemDistanceNear, 'a chosen campus anchors college mode, inside the radius');
  no(people.googleIem, people.iemDistanceNear, 'no campus chosen, no campus pin to anchor');
  yes(people.iemDistanceNear, people.googleNearby, 'People near me: two distance users within both radii');
  yes(people.gurukulGroup, people.googleNearby, 'a verified scope with its campus pin inside the radius');
  assert.equal(js(people.gurukulCollege, people.invisibleDistance), true, 'invisible hours do not unmake a pair...');
  assert.equal(sql(people.gurukulCollege, people.invisibleDistance), false, '...but keep the person out of retrieval');
});

// ---------------------------------------------------------------------------
// Card labels (6.6, 8.6)
// ---------------------------------------------------------------------------

test('cards carry bands only for distance viewers, honour "hide my distance", and label other campuses', async () => {
  const viewer = await makeUser('Label viewer', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: SALT_LAKE });
  const collegeViewer = await makeUser('Label college viewer', { institution: 'IEM', campus: 'GURUKUL', mode: 'college' });
  const near = await makeUser('Label near', { institution: 'IEM', campus: 'ASHRAM', mode: 'distance', at: NEW_TOWN });
  const hidden = await makeUser('Label hidden', { institution: 'IEM', campus: 'ASHRAM', mode: 'distance', at: NEW_TOWN });
  await prisma.user.update({ where: { id: hidden }, data: { hideDistance: true } });
  const uem = await makeUser('Label UEM', { institution: 'UEM_KOL', campus: 'NEW_TOWN', mode: 'college' });
  const jaipur = await makeUser('Label Jaipur', { institution: 'UEM_JAI', campus: 'JAIPUR', mode: 'college' });
  const visitor = await makeUser('Label visitor', { institution: 'UEM_KOL', campus: 'NEW_TOWN', mode: 'distance', at: DELHI });

  const config = await AlgorithmConfigService.get();
  const load = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: discoveryProfileSelect });
  const card = async (me: string, them: string) => publicProfile(await load(me), await load(them), config.weights);

  const nearCard = await card(viewer, near);
  assert.ok(nearCard.distanceLabel, 'a distance viewer sees a band');
  assert.ok(!/^(Less than|1-5)/.test(nearCard.distanceLabel!), 'never finer than "Under 5 km"');
  assert.equal((await card(viewer, hidden)).distanceLabel, null, '"hide my distance" hides the band');
  assert.equal((await card(collegeViewer, near)).distanceLabel, null, 'college viewers get no band at all');

  const uemCard = await card(collegeViewer, uem);
  assert.equal(uemCard.institutionLabel, 'UEM Kolkata');
  assert.equal(uemCard.cityLabel, null, 'same city, so no city label');
  const jaipurCard = await card(collegeViewer, jaipur);
  assert.equal(jaipurCard.institutionLabel, 'UEM Jaipur');
  assert.equal(jaipurCard.cityLabel, 'Jaipur');
  assert.equal((await card(collegeViewer, near)).institutionLabel, null, 'your own institution is not labelled');
  assert.equal((await card(collegeViewer, visitor)).visitingLabel, 'Visiting · UEM Kolkata', 'far from every New Town campus');
  for (const value of [nearCard, uemCard, jaipurCard]) {
    const text = JSON.stringify(value);
    assert.ok(!text.includes('"latitude"') && !text.includes('"longitude"'), 'a card never carries coordinates');
  }
});

// ---------------------------------------------------------------------------
// The map (9)
// ---------------------------------------------------------------------------

test('map bands and tile suppression', () => {
  assert.equal(mapBand(0), 'none');
  assert.equal(mapBand(MAP_MIN_COUNT - 1), 'few');
  assert.equal(mapBand(MAP_MIN_COUNT), '10+');
  assert.equal(mapBand(30), '25+');
  assert.equal(mapBand(120), '100+');

  const tiles = new Map<string, number>([
    ['0:0', 40], ['0:1', 12], // a busy area with a busy neighbour: shown
    ['9:9', 50], // a lone busy tile far from anything: the Strava case, suppressed
    ['5:5', 9], ['5:6', 30], // one side below the floor, so 5:6 has no qualifying neighbour
  ]);
  const shown = visibleTiles(tiles).map((tile) => `${tile.i}:${tile.j}`).sort();
  assert.deepEqual(shown, ['0:0', '0:1']);
});

test('the map never names a person and leaves out anyone hidden from maps', async () => {
  const viewer = await makeUser('Map viewer', { institution: 'IEM', campus: 'GURUKUL', mode: 'college' });
  const shown = await makeUser('Map shown', { institution: 'IEM', campus: 'GURUKUL', mode: 'college' });
  const hiddenOne = await makeUser('Map hidden', { institution: 'IEM', campus: 'ASHRAM', mode: 'college' });
  await prisma.user.update({ where: { id: hiddenOne }, data: { hideFromMaps: true } });
  const map = await MapService.map(viewer);
  assert.equal(map.state, 'ok');
  const text = JSON.stringify(map);
  for (const id of created) assert.ok(!text.includes(id), 'no user id appears anywhere in the map');
  assert.ok(map.campuses.length > 0, 'the viewer sees their own institution\'s campuses');
  for (const campus of map.campuses) {
    assert.ok(['none', 'few', '10+', '25+', '50+', '100+'].includes(campus.band));
    if (campus.band === 'few' || campus.band === 'none') assert.equal(campus.canList, false, 'no list below the floor');
  }
  assert.ok(shown);
});

// ---------------------------------------------------------------------------
// Shared email domain (8.2)
// ---------------------------------------------------------------------------

test('a shared email domain needs a location that matches a mapped campus of the chosen institution', async () => {
  const list = await StudentMembershipService.listInstitutions();
  const byCode = (code: string) => list.find((row) => row.code === code)!;
  // UEM Jaipur is switched off until it launches: uem.edu.in is UEM Newtown's
  // alone for now, and Jaipur is in no list. Switched back on, the domain is
  // shared again and the location check below applies.
  assert.equal(list.some((row) => row.code === 'UEM-JAIPUR'), false);
  assert.equal(byCode('UEM-KOLKATA').domainShared, false);
  assert.equal(byCode('IEM-KOLKATA').domainShared, false);

  assert.equal(await StudentMembershipService.locationConfirms(institutions.UEM_KOL, NEW_TOWN), true, 'in Kolkata, chose Kolkata');
  assert.equal(await StudentMembershipService.locationConfirms(institutions.UEM_KOL, { latitude: 26.91, longitude: 75.79 }), false, 'in Jaipur, chose Kolkata');
  assert.equal(await StudentMembershipService.locationConfirms(institutions.UEM_KOL, undefined), false, 'no location, no confirmation');
  assert.equal(
    await StudentMembershipService.locationConfirms(institutions.UEM_JAI, { latitude: 26.91, longitude: 75.79 }),
    false,
    'Jaipur has no campus pin yet, so it goes to review rather than being guessed',
  );
});

// ---------------------------------------------------------------------------
// Review fixes: hidden places, leaving a saved place, map privacy in lists,
// live re-checks, and atomic limits
// ---------------------------------------------------------------------------

const seesInDistance = async (viewer: string, candidate: string) => {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: viewer } });
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u.id FROM users u WHERE u.id = ${candidate}::uuid AND ${eligibleSql(me)}`);
  return rows.length === 1;
};

test('"hide me while I am here" takes the person out of discovery, and a fix elsewhere brings them back', async () => {
  const viewer = await makeUser('hide-viewer', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE, radius: 50 });
  const hider = await makeUser('hide-hider', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE, radius: 50 });
  // Save Home two cells away, marked hidden, while standing there.
  await ageFix(hider, 1);
  await LocationService.update(hider, { latitude: HERE.latitude + 0.04, longitude: HERE.longitude });
  const home = await LocationService.savePlace(hider, 'Home');
  await LocationService.updatePlace(hider, home.id, { hideHere: true });
  assert.equal(await seesInDistance(viewer, hider), false, 'hiding the place you are in hides you at once');

  // Back at HERE, then home again: hidden, not left visible at HERE.
  await ageFix(hider, 1);
  await LocationService.update(hider, HERE);
  assert.equal(await seesInDistance(viewer, hider), true);
  await ageFix(hider, 1);
  const atHome = await LocationService.update(hider, { latitude: HERE.latitude + 0.04, longitude: HERE.longitude });
  assert.equal(atHome.hiddenHere, true);
  assert.equal(await seesInDistance(viewer, hider), false, 'no longer discoverable from the previous cell');
  assert.equal((await LocationService.status(hider)).hiddenHere, true);

  await ageFix(hider, 1);
  await LocationService.update(hider, HERE);
  assert.equal(await seesInDistance(viewer, hider), true, 'a fix outside the hidden place ends it');
});

test('unhiding or deleting a hidden place never exposes the previous cell', async () => {
  const viewer = await makeUser('unhide-viewer', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE, radius: 50 });
  const hider = await makeUser('unhide-hider', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE, radius: 50 });
  const hiddenCell = { latitude: HERE.latitude + 0.04, longitude: HERE.longitude };

  await ageFix(hider, 1);
  await LocationService.update(hider, hiddenCell);
  const place = await LocationService.savePlace(hider, 'Home');
  await LocationService.updatePlace(hider, place.id, { hideHere: true });
  assert.equal(await seesInDistance(viewer, hider), false);

  await LocationService.updatePlace(hider, place.id, { hideHere: false });
  assert.equal((await LocationService.status(hider)).hiddenHere, true, 'unhiding waits for a fresh fix');
  assert.equal(await seesInDistance(viewer, hider), false, 'the previous displayed cell stays private');

  await ageFix(hider, 1);
  await LocationService.update(hider, hiddenCell);
  assert.equal((await LocationService.status(hider)).hiddenHere, false);
  assert.equal(await seesInDistance(viewer, hider), true, 'the fresh fix publishes the current cell');

  await LocationService.updatePlace(hider, place.id, { hideHere: true });
  assert.equal(await seesInDistance(viewer, hider), false);
  await LocationService.deletePlace(hider, place.id);
  assert.equal((await LocationService.status(hider)).hiddenHere, true, 'deleting also waits for a fresh fix');
  assert.equal(await seesInDistance(viewer, hider), false);

  await ageFix(hider, 1);
  await LocationService.update(hider, hiddenCell);
  assert.equal(await seesInDistance(viewer, hider), true);
});

test('going back to the phone never keeps showing the saved place', async () => {
  const id = await makeUser('leaver', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE });
  await ageFix(id, 0);
  const place = await LocationService.savePlace(id, 'Hostel');
  await ageFix(id, 24);
  const elsewhere = { latitude: 22.9, longitude: 88.4 };
  await LocationService.update(id, elsewhere);
  await LocationService.useSource(id, place.id);

  // Without a fix: the place stops being shown; nothing is shown until one arrives.
  await LocationService.useSource(id, null);
  let me = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(me.latitude, null);
  assert.equal(me.locationSource, 'live');

  // With a fix: source and position change together.
  await LocationService.useSource(id, place.id);
  const back = await LocationService.useSource(id, null, elsewhere);
  assert.equal(back.fix?.changed, true);
  me = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(Number(me.latitude), snapToGrid(elsewhere).latitude);

  // Deleting the place in use behaves the same way.
  await LocationService.useSource(id, place.id);
  await LocationService.deletePlace(id, place.id);
  me = await prisma.user.findUniqueOrThrow({ where: { id } });
  assert.equal(me.latitude, null);
  assert.equal(me.activePlaceId, null);
});

test('the place and spot limits hold under concurrent requests', async () => {
  const id = await makeUser('racer', { institution: 'IEM', campus: 'GURUKUL', mode: 'distance', at: HERE });
  await ageFix(id, 0);
  // Two places already; four saves race for the third. They share one live
  // cell, so the unique cell also stops duplicates - the lock is what stops a
  // fourth place when the cells differ, and the count is what we check.
  await prisma.savedPlace.createMany({
    data: [
      { userId: id, label: 'A', latitude: 22.9, longitude: 88.9 },
      { userId: id, label: 'B', latitude: 22.92, longitude: 88.9 },
    ],
  });
  await Promise.allSettled(['C', 'D', 'E', 'F'].map((label) => LocationService.savePlace(id, label)));
  assert.equal(await prisma.savedPlace.count({ where: { userId: id } }), 3, 'never more than three saved places');

  // Five different spots racing for three slots: here only the lock can hold the limit.
  const served = [1, 2, 3, 4, 5].map((n) => ({
    externalId: `osm:test-${id}-${n}`,
    name: `Test cafe ${n}`,
    subtitle: 'Test',
    category: 'Cafe',
    latitude: 22.5 + n / 1000,
    longitude: 88.4,
  }));
  for (const place of served) {
    await redisClient.set(`mapplace:served:${place.externalId}`, JSON.stringify(place), 'EX', 300);
  }
  await Promise.allSettled(served.map((place) => MapService.addMyPlace(id, place.externalId)));
  assert.equal(await prisma.userMapPlace.count({ where: { userId: id } }), 3, 'never more than three map spots');
  await prisma.mapPlace.deleteMany({ where: { externalId: { in: served.map((place) => place.externalId) } } });
});

test('a campus list from the map honours "hide me from maps", and pages are re-checked live', async () => {
  const viewer = await makeUser('list-viewer', { institution: 'IEM', campus: 'GURUKUL', mode: 'college' });
  const members: string[] = [];
  for (let n = 0; n < 12; n += 1) {
    members.push(await makeUser(`list-member-${n}`, { institution: 'IEM', campus: 'MANAGEMENT_HOUSE', mode: 'college' }));
  }
  const hidden = members[0];
  await prisma.user.update({ where: { id: hidden }, data: { hideFromMaps: true } });
  const attributes = [{ key: 'campus' as const, value: campuses.MANAGEMENT_HOUSE }];

  const first = await ExploreService.page(viewer, { attributes, limit: 5 });
  assert.equal(first.state, 'ok');
  const firstIds = (first.cards as any[]).map((card) => card.id);
  assert.ok(!firstIds.includes(hidden), 'hidden from maps means hidden from map lists');

  // Someone on a later page hides after the list was cached: they must not appear.
  const later = members.find((member) => member !== hidden && !firstIds.includes(member))!;
  await prisma.user.update({ where: { id: later }, data: { hideFromMaps: true } });
  let cursor = (first as any).nextCursor as string | null;
  const seen: string[] = [...firstIds];
  while (cursor) {
    const page = await ExploreService.page(viewer, { attributes, limit: 5, cursor });
    seen.push(...(page.cards as any[]).map((card) => card.id));
    cursor = (page as any).nextCursor ?? null;
  }
  assert.ok(!seen.includes(later), 'the cached list is re-checked before a page is returned');
  assert.ok(!seen.includes(hidden));
  assert.equal(seen.length, 10, 'everyone else still appears exactly once');
});

test('leaving the map invalidates every cached map snapshot', async () => {
  const id = await makeUser('epoch', { institution: 'IEM', campus: 'GURUKUL', mode: 'college' });
  const before = Number((await redisClient.get('map:epoch')) ?? 0);
  await LocationService.updateSettings(id, { hideFromMaps: true });
  const after = Number((await redisClient.get('map:epoch')) ?? 0);
  assert.equal(after, before + 1);
  await LocationService.updateSettings(id, { hideFromMaps: true });
  assert.equal(Number((await redisClient.get('map:epoch')) ?? 0), after, 'only a real change bumps it');
});
