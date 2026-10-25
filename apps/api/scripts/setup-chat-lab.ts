/** Called by the localhost chat client. Its JSON output goes only to that process. */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const email = 'chatlab.local@iem.edu.in';
const name = 'Chat Partner';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Chat Lab is available only in development.');
  const phoneEmail = process.argv[2]?.trim();
  if (!phoneEmail || phoneEmail.toLowerCase() === email) throw new Error('Provide the phone account email.');
  const phone = await prisma.user.findFirst({
    where: { email: { equals: phoneEmail, mode: 'insensitive' } },
    select: { id: true, email: true, name: true, accountStatus: true, claimedInstitutionId: true, college: true,
      studentMembership: { select: { institutionId: true } } },
  });
  if (!phone || phone.accountStatus !== 'active') throw new Error('The phone account does not exist or is not active.');
  const institutionId = phone.studentMembership?.institutionId ?? phone.claimedInstitutionId;
  if (!institutionId) throw new Error('Select a college in the phone account first.');
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
  if (existing && existing.name !== name) throw new Error('The Chat Lab email belongs to another account.');
  const password = randomBytes(32).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 10);
  const birthday = new Date();
  birthday.setUTCFullYear(birthday.getUTCFullYear() - 21);
  const profile = {
    name, passwordHash, birthday, age: 21, accountStatus: 'active', isVerified: true,
    college: phone.college, claimedInstitutionId: institutionId,
    discoveryMode: 'college', discoveryCategory: 'nonbinary', showMeCategories: ['nonbinary'],
    minAgePref: 18, maxAgePref: 35, collegeScope: 'college', preferencesConfirmedAt: new Date(),
    // The helper exists for this conversation. Keep it out of discovery.
    pausedAt: new Date(),
  };
  const partner = await prisma.user.upsert({ where: { email }, create: { email, ...profile }, update: profile, select: { id: true } });
  await prisma.studentMembership.upsert({
    where: { userId: partner.id },
    create: { userId: partner.id, institutionId, institutionalEmail: email, status: 'verified', verifiedAt: new Date(), expiresAt: new Date(Date.now() + 365 * 86400000) },
    update: { institutionId, status: 'verified', verifiedAt: new Date(), expiresAt: new Date(Date.now() + 365 * 86400000) },
  });
  let match = await prisma.match.findFirst({ where: { OR: [{ user1Id: phone.id, user2Id: partner.id }, { user1Id: partner.id, user2Id: phone.id }] }, select: { id: true, status: true } });
  if (!match) match = await prisma.match.create({ data: { user1Id: phone.id, user2Id: partner.id, status: 'active' }, select: { id: true, status: true } });
  if (match.status !== 'active') throw new Error('This test conversation is inactive. Restore it before connecting.');
  process.stdout.write(JSON.stringify({ email, password, partnerId: partner.id, matchId: match.id, phone: { id: phone.id, email: phone.email, name: phone.name } }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
