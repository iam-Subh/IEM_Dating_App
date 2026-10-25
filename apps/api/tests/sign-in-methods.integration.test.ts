/**
 * Sign-in methods on one account, and verifying a college email later
 * (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 1.2, 1.4).
 *
 * Google's token check needs a real Google token, so these tests start one
 * step after it. Non-destructive: creates its own users under random ids and
 * deletes exactly those rows.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { AuthService } from '../src/services/auth.service';
import { GoogleAuthService } from '../src/services/google-auth.service';
import { StudentMembershipService } from '../src/services/student-membership.service';
import { OTPService } from '../src/services/otp.service';
import { signAccountSwitch } from '../src/utils/jwt';

const googleOnly = randomUUID();
const withPassword = randomUUID();
const collegeOwner = randomUUID();
const newcomer = randomUUID();
const users = [googleOnly, withPassword, collegeOwner, newcomer];
const tag = randomUUID().slice(0, 8);
const collegeEmail = `signin.${tag}@iem.edu.in`;
const ownerEmail = `owner.${tag}@iem.edu.in`;

async function makeUser(id: string, data: Record<string, unknown>) {
  await prisma.user.create({
    data: { id, email: `${id}@gmail.example.test`, name: 'Sign-in test', passwordHash: '', accountStatus: 'active', ...data },
  });
}

before(async () => {
  await makeUser(googleOnly, { googleSub: `g-${googleOnly}`, googleEmail: `${googleOnly}@gmail.example.test`, googleLinkedAt: new Date() });
  await makeUser(withPassword, { passwordHash: await bcrypt.hash('right-password', 4) });
  await makeUser(collegeOwner, { email: ownerEmail, passwordHash: await bcrypt.hash('owner-password', 4) });
  const institution = await prisma.institution.findFirstOrThrow({ where: { code: 'IEM-KOLKATA' } });
  await prisma.studentMembership.create({
    data: { userId: collegeOwner, institutionId: institution.id, institutionalEmail: ownerEmail, status: 'verified', verifiedAt: new Date() },
  });
  await makeUser(newcomer, { googleSub: `g-${newcomer}`, googleEmail: `${newcomer}@gmail.example.test`, googleLinkedAt: new Date() });
});

after(async () => {
  await prisma.accountDataRequest.deleteMany({ where: { userId: { in: users } } });
  await prisma.userSession.deleteMany({ where: { userId: { in: users } } });
  await prisma.studentMembership.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('a Google-only account is told to use Google, at sign-in and at Forgot password', async () => {
  await assert.rejects(AuthService.login({ email: `${googleOnly}@gmail.example.test`, password: 'anything' }),
    (error: any) => error.code === 'USE_GOOGLE_SIGN_IN');
  await assert.rejects(AuthService.startRecovery(`${googleOnly}@gmail.example.test`), (error: any) => error.code === 'USE_GOOGLE_SIGN_IN');
});

test('Google cannot be disconnected without a password; after adding one it can', async () => {
  await assert.rejects(GoogleAuthService.disconnect(googleOnly), (error: any) => error.code === 'PASSWORD_REQUIRED');
  await AuthService.setPassword(googleOnly, 'new-password-1');
  await assert.rejects(AuthService.setPassword(googleOnly, 'again-password'), (error: any) => error.code === 'PASSWORD_ALREADY_SET');
  const signedIn = await AuthService.login({ email: `${googleOnly}@gmail.example.test`, password: 'new-password-1' });
  assert.equal(signedIn.user.id, googleOnly, 'the Gmail and the new password sign in');
  assert.deepEqual(await GoogleAuthService.disconnect(googleOnly), { disconnected: true });
});

test('a Google account linked to someone else is refused; connecting is otherwise kept', async () => {
  const attach = (GoogleAuthService as any).attach.bind(GoogleAuthService);
  await assert.rejects(attach(withPassword, { sub: `g-${newcomer}`, email: 'x@gmail.example.test' }),
    (error: any) => error.code === 'GOOGLE_LINKED_ELSEWHERE');
  await attach(withPassword, { sub: `g-${withPassword}`, email: 'mine@gmail.example.test' });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: withPassword } });
  assert.equal(user.googleSub, `g-${withPassword}`);
});

test('verifying asks for a password first when the account has none - without using the code', async () => {
  const challenge = await OTPService.issue(collegeEmail, 'student_membership');
  await assert.rejects(
    StudentMembershipService.verify(newcomer, 'IEM-KOLKATA', collegeEmail, challenge.challengeId, challenge.code),
    (error: any) => error.code === 'PASSWORD_REQUIRED',
  );
  await StudentMembershipService.verify(newcomer, 'IEM-KOLKATA', collegeEmail, challenge.challengeId, challenge.code, undefined, 'college-password');
  const signedIn = await AuthService.login({ email: collegeEmail, password: 'college-password' });
  assert.equal(signedIn.user.id, newcomer, 'the verified college email signs in to the same account');
  const viaGmail = await AuthService.login({ email: `${newcomer}@gmail.example.test`, password: 'college-password' });
  assert.equal(viaGmail.user.id, newcomer, 'one password for every email on the account');
});

test('a college email with its own account offers the switch, and switching moves Google there', async () => {
  // Fresh account for the switch (the newcomer is verified now).
  const fresh = randomUUID();
  users.push(fresh);
  await makeUser(fresh, { googleSub: `g-${fresh}`, googleEmail: `${fresh}@gmail.example.test`, googleLinkedAt: new Date(), passwordHash: 'x' });
  await redisClient.del(`otp:cooldown:student_membership:${ownerEmail}`).catch(() => undefined);
  const challenge = await OTPService.issue(ownerEmail, 'student_membership');
  let token = '';
  await assert.rejects(
    StudentMembershipService.verify(fresh, 'IEM-KOLKATA', ownerEmail, challenge.challengeId, challenge.code),
    (error: any) => {
      token = error.details?.switchToken;
      return error.code === 'COLLEGE_EMAIL_HAS_ACCOUNT' && error.details?.hasMatchesOrChats === false;
    },
  );
  await assert.rejects(StudentMembershipService.switchAccount(newcomer, token), (error: any) => error.code === 'SWITCH_EXPIRED',
    'the token is only for the account it was issued to');
  const target = await StudentMembershipService.switchAccount(fresh, token);
  assert.equal(target.id, collegeOwner);
  assert.equal(target.googleSub, `g-${fresh}`, 'Google now opens the old account');
  const left = await prisma.user.findUniqueOrThrow({ where: { id: fresh } });
  assert.equal(left.googleSub, null);
  assert.equal(left.accountStatus, 'deletion_pending');
  assert.equal(await prisma.accountDataRequest.count({ where: { userId: fresh, type: 'deletion' } }), 1);
  assert.equal(signAccountSwitch('a', 'b').length > 20, true);
});
