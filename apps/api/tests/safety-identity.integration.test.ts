/**
 * Keeping banned people out, and the birthday rule
 * (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 6.1, 6.2).
 *
 * Non-destructive: its own users and banned-identity rows, deleted afterwards.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { IdentityBanService, identityHash } from '../src/services/identity-ban.service';
import { ProfileService } from '../src/services/profile.service';

const banned = randomUUID();
const deviceA = randomUUID();
const deviceB = randomUUID();
const birthdayUser = randomUUID();
const users = [banned, deviceA, deviceB, birthdayUser];
const androidId = randomUUID().replace(/-/g, '').slice(0, 16);
const bannedAndroid = randomUUID().replace(/-/g, '').slice(0, 16);
const tag = randomUUID().slice(0, 8);

before(async () => {
  await prisma.user.create({
    data: { id: banned, email: `banned.${tag}@gmail.example.test`, name: 'Banned', passwordHash: '', googleSub: `g-banned-${tag}`, signupAndroidId: bannedAndroid, accountStatus: 'banned' },
  });
  for (const id of [deviceA, deviceB]) {
    await prisma.user.create({ data: { id, email: `${id}@gmail.example.test`, name: 'Device', passwordHash: '', googleSub: `g-${id}`, signupAndroidId: androidId, accountStatus: 'active' } });
  }
  await prisma.user.create({
    data: {
      id: birthdayUser, email: `${birthdayUser}@bday.example.test`, name: 'Birthday', passwordHash: 'x', accountStatus: 'active',
      birthday: new Date('2003-05-05'), age: 23, preferencesConfirmedAt: new Date(),
      discoveryMode: 'college', discoveryCategory: 'nonbinary', showMeCategories: ['nonbinary'], minAgePref: 18, maxAgePref: 30,
    },
  });
});

after(async () => {
  await prisma.bannedIdentifier.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('a ban records hashes, never values, and blocks every identity', async () => {
  const recorded = await IdentityBanService.recordBan(banned, 'test');
  assert.ok(recorded >= 3);
  const rows = await prisma.bannedIdentifier.findMany({ where: { userId: banned } });
  assert.ok(rows.every((row) => !row.valueHash.includes('@') && row.valueHash.length === 64));
  await assert.rejects(IdentityBanService.assertNotBanned({ googleSub: `g-banned-${tag}` }), (error: any) => error.code === 'IDENTITY_BANNED');
  await assert.rejects(IdentityBanService.assertNotBanned({ emails: [`BANNED.${tag}@gmail.example.test`] }), (error: any) => error.code === 'IDENTITY_BANNED',
    'emails are compared case-insensitively');
  await assert.rejects(IdentityBanService.assertNotBanned({ androidId: bannedAndroid }), (error: any) => error.code === 'IDENTITY_BANNED');
  await IdentityBanService.assertNotBanned({ emails: ['someone.else@gmail.example.test'] });
  assert.equal(identityHash('email', 'A@B.c'), identityHash('email', 'a@b.c'));
});

test('two Google sign-ups per phone', async () => {
  await assert.rejects(IdentityBanService.assertDeviceAllowsGoogleSignup(androidId), (error: any) => error.code === 'DEVICE_SIGNUP_LIMIT');
  await IdentityBanService.assertDeviceAllowsGoogleSignup(randomUUID().replace(/-/g, '').slice(0, 16));
  await IdentityBanService.assertDeviceAllowsGoogleSignup(null);
});

test('the birthday changes once after onboarding, then only through support', async () => {
  await ProfileService.updateProfile(birthdayUser, { birthday: '2003-06-06T00:00:00.000Z' });
  const changed = await prisma.user.findUniqueOrThrow({ where: { id: birthdayUser } });
  assert.ok(changed.birthdayChangedAt, 'the one change is used');
  await assert.rejects(ProfileService.updateProfile(birthdayUser, { birthday: '2001-01-01T00:00:00.000Z' }), (error: any) => error.code === 'BIRTHDAY_LOCKED');
  await assert.rejects(ProfileService.updateProfile(birthdayUser, { birthday: '2015-01-01T00:00:00.000Z' }), 'never under 18');
});
