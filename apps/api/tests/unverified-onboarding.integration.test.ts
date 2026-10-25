/**
 * Onboarding for unverified Google accounts (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 1.3).
 *
 * Non-destructive: creates its own users under random ids and deletes exactly those rows.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { OnboardingService } from '../src/services/onboarding.service';
import { StudentMembershipService } from '../src/services/student-membership.service';
import { ProfileService } from '../src/services/profile.service';
import { CampusService } from '../src/services/campus.service';

const google = randomUUID();
const emailOnly = randomUUID();
const expired = randomUUID();
const users = [google, emailOnly, expired];
let institutionId = '';
let otherInstitutionId = '';

async function makeUser(id: string, googleSub: string | null) {
  await prisma.user.create({
    data: {
      id,
      email: `${id}@unverified-onboarding.example.test`,
      name: `Onboarding ${id.slice(0, 4)}`,
      passwordHash: googleSub ? '' : 'TEST_ONLY',
      googleSub,
      accountStatus: 'active',
    },
  });
}

before(async () => {
  const institutions = await prisma.institution.findMany({ where: { isActive: true }, take: 2, select: { id: true } });
  assert.ok(institutions.length >= 2, 'needs two active institutions in the database');
  [institutionId, otherInstitutionId] = institutions.map((institution) => institution.id);
  await makeUser(google, `google-${google}`);
  await makeUser(emailOnly, null);
  await makeUser(expired, null);
  await prisma.studentMembership.create({
    data: {
      userId: expired,
      institutionId,
      institutionalEmail: `${expired}@expired.example.test`,
      status: 'verified',
      verifiedAt: new Date(Date.now() - 400 * 86_400_000),
      expiresAt: new Date(Date.now() - 35 * 86_400_000),
    },
  });
  await prisma.user.update({ where: { id: expired }, data: { department: 'CSE', graduationYear: 2026, college: 'Old College' } });
});

after(async () => {
  await prisma.studentMembership.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test('a new Google account starts its profile without college verification', async () => {
  assert.equal((await OnboardingService.getStatus(google)).nextRequiredStep, 'profile');
});

test('only a Google account may choose Later', async () => {
  await assert.rejects(StudentMembershipService.verifyLater(emailOnly), (error: any) => error.code === 'VERIFY_REQUIRED');
  assert.equal((await OnboardingService.getStatus(emailOnly)).nextRequiredStep, 'studentVerification');
});

test('after Later, the profile comes next - and it needs a college', async () => {
  await StudentMembershipService.verifyLater(google);
  assert.equal((await OnboardingService.getStatus(google)).nextRequiredStep, 'profile');
  await prisma.user.update({ where: { id: google }, data: { department: 'CSE', graduationYear: 2027 } });
  assert.equal((await OnboardingService.getStatus(google)).nextRequiredStep, 'profile', 'no college chosen yet');
});

test('the chosen college fills the profile and the campus list, without verifying', async () => {
  await ProfileService.updateProfile(google, { institutionId });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: google } });
  const institution = await prisma.institution.findUniqueOrThrow({ where: { id: institutionId } });
  assert.equal(user.claimedInstitutionId, institutionId);
  assert.equal(user.college, institution.name);
  assert.equal(await CampusService.institutionOf(google), institutionId);
  const status = await OnboardingService.getStatus(google);
  assert.equal(status.nextRequiredStep, 'discoveryPreferences');
  assert.equal(status.membershipVerified, false);
});

test('an unknown college is refused', async () => {
  await assert.rejects(ProfileService.updateProfile(google, { institutionId: randomUUID() }), (error: any) => error.code === 'COLLEGE_UNKNOWN');
});

test('an expired verification keeps the account going, without the badge', async () => {
  const status = await OnboardingService.getStatus(expired);
  assert.notEqual(status.nextRequiredStep, 'studentVerification');
  assert.equal(status.membershipVerified, false);
});

test('a verified account cannot choose another college', async () => {
  await prisma.studentMembership.create({
    data: {
      userId: emailOnly,
      institutionId,
      institutionalEmail: `${emailOnly}@verified.example.test`,
      status: 'verified',
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 300 * 86_400_000),
    },
  });
  await assert.rejects(ProfileService.updateProfile(emailOnly, { institutionId: otherInstitutionId }), (error: any) => error.code === 'COLLEGE_VERIFIED');
});
