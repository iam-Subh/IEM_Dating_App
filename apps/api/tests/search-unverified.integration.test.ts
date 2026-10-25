/**
 * Search with unverified accounts (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md, Search).
 *
 * Non-destructive: its own users under random ids, a unique name token, and
 * their own Redis keys; everything is deleted afterwards.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { SearchPeopleService, UNVERIFIED_SEARCH_DAILY_PEOPLE } from '../src/services/search-people.service';

const token = `zq${randomUUID().replace(/[^a-z]/g, '').slice(0, 6)}`;
const ids = {
  verified: randomUUID(),          // IEM Gurukul, verified, default setting
  verifiedOpen: randomUUID(),      // IEM Gurukul, verified, findable by unverified
  ashramOpen: randomUUID(),        // IEM Ashram, verified, findable by unverified
  googleGurukul: randomUUID(),     // unverified, chose IEM Gurukul
  googleAshram: randomUUID(),      // unverified, chose IEM Ashram
  googlePaused: randomUUID(),      // unverified, Gurukul, paused after 14 days
  uem: randomUUID(),               // UEM Newtown, verified
};
const users = Object.values(ids);
let iem = '';
let uem = '';
let gurukul = '';
let ashram = '';

async function makeUser(id: string, name: string, data: Record<string, unknown>) {
  await prisma.user.create({ data: { id, email: `${id}@search-unverified.example.test`, name: `${name} ${token}`, passwordHash: 'x', accountStatus: 'active', ...data } });
}
async function verify(id: string, institutionId: string) {
  await prisma.studentMembership.create({ data: { userId: id, institutionId, institutionalEmail: `${id}@m.example.test`, status: 'verified', verifiedAt: new Date() } });
}
const names = (people: { name: string }[]) => people.map((person) => person.name.split(' ')[0]);

before(async () => {
  iem = (await prisma.institution.findFirstOrThrow({ where: { code: 'IEM-KOLKATA' } })).id;
  uem = (await prisma.institution.findFirstOrThrow({ where: { code: 'UEM-KOLKATA' } })).id;
  gurukul = (await prisma.institutionCampus.findFirstOrThrow({ where: { institutionId: iem, code: 'GURUKUL' } })).id;
  ashram = (await prisma.institutionCampus.findFirstOrThrow({ where: { institutionId: iem, code: 'ASHRAM' } })).id;
  await makeUser(ids.verified, 'Verified', { campusId: gurukul });
  await verify(ids.verified, iem);
  await makeUser(ids.verifiedOpen, 'Open', { campusId: gurukul, searchByUnverified: true });
  await verify(ids.verifiedOpen, iem);
  await makeUser(ids.ashramOpen, 'AshramOpen', { campusId: ashram, searchByUnverified: true });
  await verify(ids.ashramOpen, iem);
  await makeUser(ids.googleGurukul, 'GoogleGurukul', { googleSub: `g-${ids.googleGurukul}`, claimedInstitutionId: iem, campusId: gurukul });
  await makeUser(ids.googleAshram, 'GoogleAshram', { googleSub: `g-${ids.googleAshram}`, claimedInstitutionId: iem, campusId: ashram });
  await makeUser(ids.googlePaused, 'GooglePaused', { googleSub: `g-${ids.googlePaused}`, claimedInstitutionId: iem, campusId: gurukul, pausedAt: new Date() });
  await makeUser(ids.uem, 'Uem', {});
  await verify(ids.uem, uem);
});

after(async () => {
  await prisma.studentMembership.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  for (const id of users) {
    const keys = await redisClient.keys(`search:*:${id}:*`);
    if (keys.length) await redisClient.unlink(...keys);
  }
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('a verified student finds everyone at their college - verified first, unverified without the tick', async () => {
  const { people } = await SearchPeopleService.people(ids.verified, token);
  const found = names(people);
  assert.deepEqual(new Set(found), new Set(['Open', 'AshramOpen', 'GoogleGurukul', 'GoogleAshram']));
  const firstUnverified = people.findIndex((person) => !person.isVerified);
  assert.ok(people.slice(firstUnverified).every((person) => !person.isVerified), 'verified students come first');
  assert.equal(people.find((person) => person.name.startsWith('GoogleGurukul'))!.isVerified, false);
  assert.ok(!found.includes('GooglePaused'), 'paused accounts are never found');
  assert.ok(!found.includes('Uem'), 'another college is not searched');
});

test('before verifying: own campus only, and verified students only when they allow it', async () => {
  const found = names((await SearchPeopleService.people(ids.googleGurukul, token)).people);
  assert.deepEqual(found, ['Open'], 'Gurukul, and only the verified student who allows it');
  const fromAshram = names((await SearchPeopleService.people(ids.googleAshram, token)).people);
  assert.deepEqual(fromAshram, ['AshramOpen']);
  assert.equal(await SearchPeopleService.person(ids.googleGurukul, ids.verified), null, 'the default keeps you out of their reach');
});

test(`before verifying: ${UNVERIFIED_SEARCH_DAILY_PEOPLE} different people a day`, async () => {
  const many = Array.from({ length: UNVERIFIED_SEARCH_DAILY_PEOPLE + 1 }, () => randomUUID());
  await assert.rejects((SearchPeopleService as any).requireUnverifiedAllowance(ids.googleGurukul, many),
    (error: any) => error.code === 'SEARCH_LIMIT_UNVERIFIED');
});
