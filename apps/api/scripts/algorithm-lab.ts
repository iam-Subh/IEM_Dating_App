/**
 * Algorithm lab: does Discovery and Standouts behave well with many people?
 *
 * Builds a fake college in the LOCAL database - students across IEM Gurukul,
 * Ashram, Management House and UEM Newtown, some of them unverified, some on
 * "People near me", some who passed the real-person check (and a few whose
 * photo now fails it), a few paused and a few with an open "Under 18" report -
 * runs the real Discover deck and Standouts for every one of them, lets them
 * swipe, and prints a report: gender and age both ways, the radius, coverage,
 * fairness, campus-first, the unverified and real-person rules, Standouts,
 * the hidden groups, mutual visibility and speed.
 *
 *   npm run algorithm:lab                       400 students, 15% unverified
 *   npm run algorithm:lab -- --students=800 --unverified=0.3 --seed=7
 *   npm run algorithm:lab -- --keep             keep the fake students to look at in the app
 *   npm run algorithm:lab -- --cleanup          remove fake students left by an earlier run
 *
 * Safe by design: it refuses any database but localhost, every fake student
 * is "Lab ..." with an @algo-lab.test email, and everything it created is
 * deleted at the end (unless --keep). It never touches anyone else.
 */
import { randomUUID } from 'crypto';
import { Prisma, User } from '@prisma/client';
import { INTEREST_CATEGORIES } from '@iem-dating/shared/interest-catalog';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { RecommendationService } from '../src/services/recommendation.service';
import { SwipeService } from '../src/services/swipe.service';
import { StandoutsService } from '../src/services/standouts.service';
import { effectiveRadiusKm, eligibleSql } from '../src/services/eligibility.service';
import { AGE_FLEX_YEARS } from '../src/services/match-criteria';
import { haversineKm } from '../src/utils/geo';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
const arg = (name: string, fallback: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const flag = (name: string) => process.argv.includes(`--${name}`);
const STUDENTS = Number(arg('students', '400'));
const UNVERIFIED = Number(arg('unverified', '0.15'));
const SEED = Number(arg('seed', '1'));
const SWIPES_PER_VIEWER = Number(arg('swipes', '20'));
const KEEP = flag('keep');
const LAB_DOMAIN = 'algo-lab.test';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
  console.error(`Refusing to run: DATABASE_URL points at ${url.hostname}. The lab only runs against the local database.`);
  process.exit(1);
}

// A small seeded random, so a run can be repeated exactly.
let state = SEED * 2654435761 % 4294967296 || 1;
const random = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
const weighted = <T>(entries: [T, number][]) => {
  let roll = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of entries) if ((roll -= weight) <= 0) return value;
  return entries[entries.length - 1][0];
};

// ---------------------------------------------------------------------------
// The fake college
// ---------------------------------------------------------------------------
type LabStudent = {
  id: string;
  campus: string;
  college: 'IEM' | 'UEM Newtown';
  verified: boolean;
  scope: 'campus' | 'college' | 'city';
  category: string;
  showMe: string[];
  age: number;
  minAge: number;
  maxAge: number;
  flexibleAge: boolean;
  appeal: number;
  /** "People near me" instead of a college choice. */
  nearMe: boolean;
  /** Passed the real-person check; photoIssue: passed once, a photo now fails it. */
  realPerson: boolean;
  photoIssue: boolean;
  /** Hidden from everyone: paused after 14 days unverified, or an open "Under 18" report. */
  paused: boolean;
  underAgeReport: boolean;
};

const FIRST = ['Aarav', 'Riya', 'Ankit', 'Priya', 'Rahul', 'Sneha', 'Arjun', 'Isha', 'Kabir', 'Meera', 'Rohan', 'Tara', 'Dev', 'Ananya', 'Vikram', 'Diya'];
const DEPARTMENTS = ['CSE', 'IT', 'ECE', 'EE', 'ME', 'BBA', 'BCA', 'CSBS'];
const INTERESTS = INTEREST_CATEGORIES.flatMap((category) => category.interests.map((interest) => interest.label));
const LIFESTYLE = { drink: ['never', 'socially', 'often'], smoke: ['no', 'socially', 'regularly'], exercise: ['never', 'sometimes', 'often'], pets: ['dog', 'cat', 'none'] };
const SEEKING = ['Long-term partner', 'Long-term, but short-term OK', 'Short-term, but long-term OK', 'New friends'];

async function buildCollege(): Promise<LabStudent[]> {
  const institutions = await prisma.institution.findMany({ where: { code: { in: ['IEM-KOLKATA', 'UEM-KOLKATA'] } }, include: { campusList: { where: { isActive: true } } } });
  const iem = institutions.find((row) => row.code === 'IEM-KOLKATA')!;
  const uem = institutions.find((row) => row.code === 'UEM-KOLKATA')!;
  const campusOf = (institution: typeof iem, code: string) => institution.campusList.find((campus) => campus.code === code)!;
  const campuses: [{ name: string; id: string; institution: typeof iem; college: LabStudent['college'] }, number][] = [
    [{ name: 'Gurukul', id: campusOf(iem, 'GURUKUL').id, institution: iem, college: 'IEM' }, 35],
    [{ name: 'Ashram', id: campusOf(iem, 'ASHRAM').id, institution: iem, college: 'IEM' }, 15],
    [{ name: 'Management House', id: campusOf(iem, 'MANAGEMENT_HOUSE').id, institution: iem, college: 'IEM' }, 15],
    [{ name: 'New Town', id: campusOf(uem, 'NEW_TOWN').id, institution: uem, college: 'UEM Newtown' }, 35],
  ];
  const students: LabStudent[] = [];
  const now = Date.now();
  for (let index = 0; index < STUDENTS; index++) {
    const id = randomUUID();
    const campus = weighted(campuses);
    const verified = random() >= UNVERIFIED;
    const nearMe = random() < 0.15;
    const realPerson = random() < 0.4;
    const photoIssue = !realPerson && random() < 0.05;
    const paused = random() < 0.02;
    const underAgeReport = !paused && random() < 0.02;
    // A cell near their campus, snapped to the ~2 km grid the app stores.
    const anchor = campus.institution.campusList.find((row) => row.id === campus.id)!;
    const snap = (value: number) => Math.round(value / 0.02) * 0.02;
    const latitude = snap(Number(anchor.latitude) + (random() - 0.5) * 0.06);
    const longitude = snap(Number(anchor.longitude) + (random() - 0.5) * 0.06);
    const category = weighted([['man', 47], ['woman', 47], ['nonbinary', 6]] as [string, number][]);
    const showMe = category === 'nonbinary'
      ? weighted([[['man', 'woman', 'nonbinary'], 1]] as [string[], number][])
      : weighted([[[category === 'man' ? 'woman' : 'man'], 85], [['man', 'woman'], 10], [[category], 5]] as [string[], number][]);
    const scope = weighted([['campus', 20], ['college', 45], ['city', 35]] as [LabStudent['scope'], number][]);
    const age = 18 + Math.floor(random() * 6);
    const appeal = Math.round(random() * 100) / 100;
    const maxAge = 24 + Math.floor(random() * 4);
    const flexibleAge = random() < 0.7;
    students.push({
      id, campus: campus.name, college: campus.college, verified, scope, category, showMe, age, minAge: 18, maxAge, flexibleAge,
      appeal, nearMe, realPerson, photoIssue, paused, underAgeReport,
    });
    await prisma.user.create({
      data: {
        id,
        email: `${id}@${LAB_DOMAIN}`,
        name: `Lab ${pick(FIRST)} ${index}`,
        passwordHash: verified ? 'LAB_ONLY' : '',
        googleSub: verified ? null : `lab-${id}`,
        claimedInstitutionId: verified ? null : campus.institution.id,
        accountStatus: 'active',
        birthday: new Date(Date.UTC(new Date().getUTCFullYear() - age, Math.floor(random() * 12), 1 + Math.floor(random() * 27))),
        age,
        college: campus.institution.name,
        campus: campus.name,
        campusId: campus.id,
        department: pick(DEPARTMENTS),
        yearOfStudy: 1 + Math.floor(random() * 4),
        graduationYear: new Date().getUTCFullYear() + 1 + Math.floor(random() * 4),
        discoveryMode: nearMe ? 'distance' : 'college',
        collegeScope: verified ? scope : 'campus',
        ...(nearMe ? {
          latitude, longitude, locationConsentAt: new Date(), locationUpdatedAt: new Date(),
          distancePreference: weighted([[5, 1], [10, 2], [25, 1]] as [number, number][]),
        } : {}),
        discoveryCategory: category,
        showMeCategories: showMe,
        minAgePref: 18,
        maxAgePref: maxAge,
        flexibleAge,
        realPersonVerifiedAt: realPerson ? new Date() : null,
        realPersonPassedAt: realPerson || photoIssue ? new Date() : null,
        pausedAt: paused ? new Date() : null,
        expandRadius: random() < 0.5,
        seeking: pick(SEEKING),
        isHosteller: random() < 0.4,
        preferencesConfirmedAt: new Date(),
        lastActiveAt: new Date(now - Math.floor(random() * 3 * 24 * 3600_000)),
        createdAt: new Date(now - Math.floor(random() * 10 * 24 * 3600_000)),
        avatarUrl: `https://example.test/lab/${id}/0.jpg`,
        profileVideoUrl: `https://example.test/lab/${id}/video.mp4`,
        videoPlaybackUrl: `https://example.test/lab/${id}/video.m3u8`,
        preferences: {
          bio: 'Lab student',
          interests: Array.from(new Set(Array.from({ length: 5 }, () => pick(INTERESTS)))),
          lifestyle: Object.fromEntries(Object.entries(LIFESTYLE).map(([key, values]) => [key, pick(values)])),
        },
      },
    });
    await prisma.userScore.create({ data: { userId: id } });
    await prisma.profilePhoto.createMany({
      data: Array.from({ length: 3 }, (_, order) => ({ userId: id, photoUrl: `https://example.test/lab/${id}/${order}.jpg`, order, isPrimary: order === 0 })),
    });
    if (underAgeReport) {
      await prisma.moderationCase.create({ data: { subjectUserId: id, status: 'open', priority: 'urgent' } });
    }
    if (verified) {
      await prisma.studentMembership.create({
        data: { userId: id, institutionId: campus.institution.id, institutionalEmail: `${id}@m.${LAB_DOMAIN}`, status: 'verified', verifiedAt: new Date(), expiresAt: new Date(now + 300 * 86_400_000) },
      });
    }
  }
  return students;
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------
const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
function gini(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((a, b) => a + b, 0);
  if (!n || !total) return 0;
  return sorted.reduce((sum, value, index) => sum + (2 * (index + 1) - n - 1) * value, 0) / (n * total);
}
const pct = (part: number, whole: number) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : '-');
type Check = { name: string; value: string; pass: boolean; note: string };
const checks: Check[] = [];
const check = (name: string, value: string, pass: boolean, note: string) => checks.push({ name, value, pass, note });

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
async function run() {
  console.log(`Algorithm lab: ${STUDENTS} students, ${Math.round(UNVERIFIED * 100)}% unverified, seed ${SEED}`);
  const started = Date.now();
  const students = await buildCollege();
  const byId = new Map(students.map((student) => [student.id, student]));
  console.log(`  built the college in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  // 1. The Discover deck, first page, for everyone.
  const decks = new Map<string, string[]>();
  const latency: number[] = [];
  const shown = new Map<string, number>(students.map((student) => [student.id, 0]));
  for (const student of students) {
    const t0 = performance.now();
    const page = await RecommendationService.getRecommendations(student.id, undefined, 20);
    latency.push(performance.now() - t0);
    const ids = page.cards.map((card: { id: string }) => card.id).filter((id: string) => byId.has(id));
    decks.set(student.id, ids);
    for (const id of ids) shown.set(id, (shown.get(id) ?? 0) + 1);
  }
  console.log('  ran every deck');

  // Mutual: everyone shown to A could be shown A.
  let pairs = 0;
  let oneWay = 0;
  const users = new Map((await prisma.user.findMany({ where: { id: { in: students.map((s) => s.id) } } })).map((user) => [user.id, user as User]));
  const seers = new Map<string, string[]>();
  for (const [viewer, ids] of decks) for (const id of ids) seers.set(id, [...(seers.get(id) ?? []), viewer]);
  // Paused and "Under 18"-reported people still browse but are hidden from
  // everyone - one-way on purpose - so they are left out of this check.
  const hiddenViewer = (id: string) => byId.get(id)!.paused || byId.get(id)!.underAgeReport;
  for (const [candidate, allViewers] of seers) {
    const viewers = allViewers.filter((viewer) => !hiddenViewer(viewer));
    if (!viewers.length) continue;
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT u.id FROM users u WHERE u.id = ANY(${viewers}::uuid[]) AND ${eligibleSql(users.get(candidate)!, new Date(), false)}`);
    const back = new Set(rows.map((row) => row.id));
    pairs += viewers.length;
    oneWay += viewers.filter((viewer) => !back.has(viewer)).length;
  }
  check('Mutual visibility', `${pairs - oneWay}/${pairs} pairs`, oneWay === 0, 'Everyone shown to you could also be shown you');

  // Gender and "show me", both ways - and age, both ways - on every card.
  const both = (viewer: LabStudent, other: LabStudent) =>
    viewer.showMe.includes(other.category) && other.showMe.includes(viewer.category);
  const inAge = (owner: LabStudent, age: number) => {
    const flex = owner.flexibleAge ? AGE_FLEX_YEARS : 0;
    return age >= Math.max(18, owner.minAge - flex) && age <= owner.maxAge + flex;
  };
  let genderWrong = 0;
  let ageWrong = 0;
  let cards = 0;
  for (const [viewerId, deck] of decks) {
    const viewer = byId.get(viewerId)!;
    for (const id of deck) {
      const other = byId.get(id)!;
      cards++;
      if (!both(viewer, other)) genderWrong++;
      if (!inAge(viewer, other.age) || !inAge(other, viewer.age)) ageWrong++;
    }
  }
  check('Gender and "show me", both ways', `${genderWrong} wrong of ${cards} cards`, genderWrong === 0, 'You only see people whose gender you chose, and who chose yours');
  check('Age range, both ways', `${ageWrong} wrong of ${cards} cards`, ageWrong === 0, "Inside both people's age ranges (with the flexible years when chosen)");

  // "People near me": every card inside the radius.
  let outside = 0;
  let nearCards = 0;
  const cellOf = (user: User) => ({ latitude: Number(user.latitude), longitude: Number(user.longitude) });
  const campusAnchor = new Map((await prisma.institutionCampus.findMany({ select: { id: true, latitude: true, longitude: true } }))
    .map((row) => [row.id, { latitude: Number(row.latitude), longitude: Number(row.longitude) }]));
  for (const viewer of students.filter((student) => student.nearMe)) {
    const me = users.get(viewer.id)!;
    for (const id of decks.get(viewer.id) ?? []) {
      const other = users.get(id)!;
      const where = other.discoveryMode === 'distance' ? cellOf(other) : campusAnchor.get(other.campusId!)!;
      nearCards++;
      if (haversineKm(cellOf(me), where) > effectiveRadiusKm(me) + 0.01) outside++;
    }
  }
  check('"People near me" inside the radius', `${outside} outside of ${nearCards} cards`, outside === 0, "Distance to their cell, or to a college-mode person's campus");

  // Hidden groups: paused accounts and open "Under 18" reports appear nowhere.
  const hiddenIds = new Set(students.filter((student) => student.paused || student.underAgeReport).map((student) => student.id));
  const hiddenShown = [...decks.values()].flat().filter((id) => hiddenIds.has(id)).length;
  check('Paused and "Under 18" reports hidden', `${hiddenShown} cards`, hiddenShown === 0,
    `${students.filter((s) => s.paused).length} paused, ${students.filter((s) => s.underAgeReport).length} with an open "Under 18" report`);

  // The real-person check: a little ahead of people like them who haven't done it.
  let realAhead = 0;
  let realMixed = 0;
  for (const [viewerId, deck] of decks) {
    const home = byId.get(viewerId)!.campus;
    const peers = (real: boolean) => deck.map((id, index) => {
      const other = byId.get(id)!;
      return other.verified && other.campus === home && other.realPerson === real && !other.photoIssue ? index : -1;
    }).filter((index) => index >= 0);
    const yes = peers(true);
    const no = peers(false);
    if (!yes.length || !no.length) continue;
    realMixed++;
    if (mean(yes) <= mean(no)) realAhead++;
  }
  check('Real-person check ranked a little ahead', `earlier in ${pct(realAhead, realMixed)} of mixed decks`, realMixed === 0 || realAhead / realMixed >= 0.55,
    'A trust signal on top of compatibility - never required, so a strong match without it still comes first');

  // Unverified (choosing a college): held to their campus. "People near me" goes by distance instead.
  const unverifiedViewers = students.filter((student) => !student.verified && !student.nearMe);
  const offCampus = unverifiedViewers.reduce((sum, viewer) => sum + (decks.get(viewer.id) ?? []).filter((id) => byId.get(id)!.campus !== viewer.campus).length, 0);
  check('Unverified see only their campus', `${offCampus} off-campus cards`, offCampus === 0, 'An unverified viewer never sees another campus');

  // Coverage: nobody invisible.
  // The hidden groups must not be shown, so they don't count against coverage.
  const invisible = students.filter((student) => (shown.get(student.id) ?? 0) === 0 && !student.paused && !student.underAgeReport);
  const invisibleVerified = invisible.filter((student) => student.verified);
  check('Coverage', `${pct(students.length - invisible.length, students.length)} shown at least once`,
    invisibleVerified.length <= Math.ceil(students.length * 0.05),
    `${invisible.length} never shown (${invisibleVerified.length} verified) - a few is normal on one page per person`);

  // Fairness of attention.
  const views = students.map((student) => shown.get(student.id) ?? 0);
  const top10 = [...views].sort((a, b) => b - a).slice(0, Math.ceil(views.length / 10));
  const top10Share = top10.reduce((a, b) => a + b, 0) / Math.max(1, views.reduce((a, b) => a + b, 0));
  const maxOverMean = Math.max(...views) / Math.max(0.01, mean(views));
  check('Fairness (Gini of views)', gini(views).toFixed(2), gini(views) < 0.55, '0 = everyone seen equally, 1 = one person gets all views');
  check('Most-shown 10% share', `${(top10Share * 100).toFixed(1)}% of views`, top10Share < 0.35, 'Popular people should not take most of the attention');
  check('Busiest person vs average', `${maxOverMean.toFixed(1)}x`, maxOverMean < 4, 'Nobody shown far more than the rest');

  // Campus first for "All IEM campuses" / "both colleges".
  // College-choosers only: "People near me" goes by distance, not campus.
  const wide = students.filter((student) => student.verified && student.scope !== 'campus' && !student.nearMe);
  let ownFirst = 0;
  let measured = 0;
  for (const viewer of wide) {
    const deck = decks.get(viewer.id) ?? [];
    const own = deck.map((id, index) => (byId.get(id)!.campus === viewer.campus ? index : -1)).filter((index) => index >= 0);
    const other = deck.map((id, index) => (byId.get(id)!.campus !== viewer.campus ? index : -1)).filter((index) => index >= 0);
    if (!own.length || !other.length) continue;
    measured++;
    if (mean(own) <= mean(other)) ownFirst++;
  }
  check('Own campus first', `${pct(ownFirst, measured)} of mixed decks`, measured === 0 || ownFirst / measured >= 0.8, 'Own-campus people sit earlier in the deck than others');

  // Unverified ranked a little lower, never hidden.
  // Within the viewer's own campus (unverified people only ever meet their own
  // campus, and own campus comes first): is the unverified half later?
  let laterDecks = 0;
  let mixedDecks = 0;
  const gaps: number[] = [];
  for (const [viewerId, deck] of decks) {
    const home = byId.get(viewerId)!.campus;
    const v = deck.map((id, index) => (byId.get(id)!.verified && byId.get(id)!.campus === home ? index : -1)).filter((index) => index >= 0);
    const u = deck.map((id, index) => (!byId.get(id)!.verified && byId.get(id)!.campus === home ? index : -1)).filter((index) => index >= 0);
    if (!v.length || !u.length) continue;
    mixedDecks++;
    gaps.push(mean(u) - mean(v));
    if (mean(u) >= mean(v)) laterDecks++;
  }
  const unverifiedShown = students.filter((student) => !student.verified && (shown.get(student.id) ?? 0) > 0).length;
  check('Unverified ranked after, not hidden', `later in ${pct(laterDecks, mixedDecks)} of same-campus mixes (avg ${mean(gaps).toFixed(1)} places)`,
    mixedDecks === 0 || (laterDecks / mixedDecks >= 0.6 && unverifiedShown > 0),
    `${unverifiedShown}/${unverifiedViewers.length} unverified people shown at least once`);

  check('Deck speed', `p50 ${percentile(latency, 50).toFixed(0)} ms, p95 ${percentile(latency, 95).toFixed(0)} ms`, percentile(latency, 95) < 600, 'First page of the deck');

  // 2. Standouts for everyone - chosen overnight, before anyone swipes.
  const sets = new Map<string, string[]>();
  for (const student of students) {
    const today = await StandoutsService.today(student.id);
    sets.set(student.id, (today.cards as { id: string }[]).map((card) => card.id));
  }
  const appearances = new Map<string, number>();
  for (const ids of sets.values()) for (const id of ids) appearances.set(id, (appearances.get(id) ?? 0) + 1);
  const unverifiedPicked = [...appearances.keys()].filter((id) => byId.get(id) && !byId.get(id)!.verified).length;
  check('Standouts never pick unverified', `${unverifiedPicked} unverified picked`, unverifiedPicked === 0, 'Standouts are verified only');
  const pickedIds = [...appearances.keys()].filter((id) => byId.has(id));
  const issuePicked = pickedIds.filter((id) => byId.get(id)!.photoIssue).length;
  const hiddenPicked = pickedIds.filter((id) => hiddenIds.has(id)).length;
  check('Standouts skip photo issues and hidden people', `${issuePicked} with a photo to fix, ${hiddenPicked} paused or reported`, issuePicked === 0 && hiddenPicked === 0,
    'A showcase: nobody whose photo fails the real-person check, nobody paused, no open "Under 18" report');
  let standoutGender = 0;
  for (const [viewerId, ids] of sets) for (const id of ids) if (byId.get(id) && !both(byId.get(viewerId)!, byId.get(id)!)) standoutGender++;
  check('Standouts: gender and "show me", both ways', `${standoutGender} wrong`, standoutGender === 0, 'Same rule as the deck');
  const verifiedStudents = students.filter((student) => student.verified && !student.photoIssue);
  // Counted per pick, not per person: the fair limits spread picks over nearly
  // everyone, so who gets picked at all can't show a lean - how often can.
  const allPicks = [...sets.values()].flat().filter((id) => byId.has(id));
  const realShare = allPicks.length ? allPicks.filter((id) => byId.get(id)!.realPerson).length / allPicks.length : 0;
  const realPool = verifiedStudents.length ? verifiedStudents.filter((student) => student.realPerson).length / verifiedStudents.length : 0;
  check('Standouts lean to real-person checked', `${(realShare * 100).toFixed(0)}% of picks vs ${(realPool * 100).toFixed(0)}% of verified students`, realShare >= realPool,
    'Real-person checked people are picked a little more often than their share');
  const unverifiedOffCampus = unverifiedViewers.reduce((sum, viewer) => sum + (sets.get(viewer.id) ?? []).filter((id) => byId.get(id) && byId.get(id)!.campus !== viewer.campus).length, 0);
  check('Unverified Standouts from their campus', `${unverifiedOffCampus} off-campus picks`, unverifiedOffCampus === 0, 'Same campus rule as the deck');
  const full = [...sets.values()].filter((ids) => ids.length >= 8).length;
  const fewUnverified = unverifiedViewers.filter((viewer) => (sets.get(viewer.id) ?? []).length < 8).length;
  check('Standouts filled', `${pct(full, students.length)} got a full 8`, true,
    `${fewUnverified}/${unverifiedViewers.length} unverified got fewer than 8 (they see "More Standouts after you verify")`);
  const maxAppear = Math.max(0, ...appearances.values());
  check('Standouts spread', `most-picked person in ${maxAppear} sets; ${appearances.size} different people picked`, maxAppear <= Math.max(6, Math.ceil(students.length * 8 / Math.max(1, appearances.size) * 3)),
    'Fair limits keep one person out of everyone\'s Standouts');

  // 3. Swipes: likes follow appeal, as people do.
  let likes = 0;
  let refused = 0;
  const refusals = new Map<string, number>();
  for (const student of students) {
    for (const id of (decks.get(student.id) ?? []).slice(0, SWIPES_PER_VIEWER)) {
      const like = random() < 0.15 + 0.6 * byId.get(id)!.appeal;
      try {
        await SwipeService.perform(student.id, id, like ? 'like' : 'pass');
        if (like) likes++;
      } catch (error) {
        refused++;
        const code = (error as { code?: string }).code ?? 'ERROR';
        refusals.set(code, (refusals.get(code) ?? 0) + 1);
      }
    }
  }
  const labIds = students.map((student) => student.id);
  const matches = await prisma.match.count({ where: { user1Id: { in: labIds }, user2Id: { in: labIds } } });
  const matchedPeople = new Set((await prisma.match.findMany({ where: { user1Id: { in: labIds } }, select: { user1Id: true, user2Id: true } }))
    .flatMap((match) => [match.user1Id, match.user2Id]));
  check('Matches', `${matches} matches from ${likes} likes`, matches > 0, `${pct(matchedPeople.size, students.length)} of students got at least one match; refused (decks fetched before anyone swiped, so some had already passed): ${[...refusals].map(([code, count]) => `${code} ${count}`).join(', ') || 'none'}`);

  // Report.
  console.log('');
  console.log('Result'.padEnd(36), 'Value'.padEnd(48), 'Check');
  console.log('-'.repeat(100));
  for (const item of checks) {
    console.log(item.name.padEnd(36), item.value.padEnd(48), item.pass ? 'OK' : 'LOOK');
    console.log(''.padEnd(36), `  ${item.note}`);
  }
  console.log('');
  const byCampus = ['Gurukul', 'Ashram', 'Management House', 'New Town'].map((campus) => {
    const people = students.filter((student) => student.campus === campus);
    return `${campus}: ${people.length} students, avg ${mean(people.map((student) => shown.get(student.id) ?? 0)).toFixed(1)} views`;
  });
  console.log(byCampus.join(' | '));
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s. ${checks.filter((item) => !item.pass).length} result(s) to look at.`);
}

// ---------------------------------------------------------------------------
// Cleanup: exactly what the lab made
// ---------------------------------------------------------------------------
async function cleanup() {
  const users = (await prisma.user.findMany({ where: { email: { endsWith: `@${LAB_DOMAIN}` } }, select: { id: true } })).map((user) => user.id);
  if (!users.length) return 0;
  const [swipes, matches] = await Promise.all([
    prisma.swipe.findMany({ where: { OR: [{ swiperId: { in: users } }, { targetId: { in: users } }] }, select: { id: true } }),
    prisma.match.findMany({ where: { OR: [{ user1Id: { in: users } }, { user2Id: { in: users } }] }, select: { id: true } }),
  ]);
  const aggregates = [...users, ...swipes.map((row) => row.id), ...matches.map((row) => row.id)];
  const outbox = (await prisma.outboxEvent.findMany({ where: { aggregateId: { in: aggregates } }, select: { id: true } })).map((row) => row.id);
  const ids = [...aggregates, ...outbox];
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND table_name <> '_prisma_migrations'`;
  for (let pass = 0; pass < 8; pass++) {
    let failures = 0;
    for (const { table_name, column_name } of columns) {
      if (table_name === 'users') continue;
      try { await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1::uuid[])`, ids); }
      catch { failures++; }
    }
    try { await prisma.user.deleteMany({ where: { id: { in: users } } }); } catch { failures++; }
    if (!failures) break;
  }
  return users.length;
}

(async () => {
  let exitCode = 0;
  try {
    const leftover = await cleanup();
    if (leftover) console.log(`Removed ${leftover} fake students left by an earlier run.`);
    if (flag('cleanup')) return;
    await run();
  } catch (error) {
    exitCode = 1;
    console.error('Lab failed:', error);
  } finally {
    if (!KEEP && !flag('cleanup')) {
      const removed = await cleanup().catch(() => 0);
      console.log(`Removed the ${removed} fake students.`);
    } else if (KEEP) {
      console.log('Kept the fake students (--keep). Run with --cleanup to remove them.');
    }
    await prisma.$disconnect();
    await redisClient.quit().catch(() => undefined);
    process.exit(exitCode);
  }
})();
