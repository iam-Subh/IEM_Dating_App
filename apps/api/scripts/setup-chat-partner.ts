/**
 * Creates a second account you can chat *with*, so the chat system can be
 * exercised end to end with only one phone.
 *
 *   npx tsx scripts/setup-chat-partner.ts you@example.com
 *
 * The argument is the email of the account signed in on the phone. The
 * partner gets an email + password (the phone accounts have none, and
 * `/auth/login` is the only non-OTP way in), a verified student membership at
 * the same institution, and an active match with you so a conversation exists.
 *
 * Safe to re-run: everything is upserted, and an existing match is reused.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PARTNER_EMAIL = 'chatpartner@iem.edu.in';
const PARTNER_PASSWORD = 'password123';
const PARTNER_NAME = 'Chat Partner';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx tsx scripts/setup-chat-partner.ts <the email of the account on your phone>');
    process.exit(1);
  }

  const me = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true, studentMembership: { select: { institutionId: true } } },
  });
  if (!me) {
    console.error(`No user with email ${email}. Run scripts/list-chat-users.ts to see the options.`);
    process.exit(1);
  }

  // Chat requires a verified membership at an active institution, so the
  // partner has to belong to the same one you do.
  const institutionId = me.studentMembership?.institutionId
    ?? (await prisma.institution.findFirstOrThrow({ where: { isActive: true }, select: { id: true } })).id;

  const passwordHash = await bcrypt.hash(PARTNER_PASSWORD, 10);
  const birthday = new Date();
  birthday.setFullYear(birthday.getFullYear() - 21);

  // A finished profile: the database requires discovery settings on every account.
  const profile = {
    discoveryMode: 'college', discoveryCategory: 'nonbinary', showMeCategories: ['nonbinary'],
    minAgePref: 18, maxAgePref: 40, collegeScope: 'group', preferencesConfirmedAt: new Date(),
  };
  const partner = await prisma.user.upsert({
    where: { email: PARTNER_EMAIL },
    update: { passwordHash, accountStatus: 'active', birthday, isVerified: true, pausedAt: null, ...profile },
    create: {
      email: PARTNER_EMAIL,
      name: PARTNER_NAME,
      passwordHash,
      birthday,
      age: 21,
      accountStatus: 'active',
      isVerified: true,
      ...profile,
    },
    select: { id: true },
  });

  const existingMembership = await prisma.studentMembership.findFirst({
    where: { userId: partner.id },
    select: { id: true },
  });
  const membershipData = {
    institutionId,
    institutionalEmail: PARTNER_EMAIL,
    status: 'verified',
    verifiedAt: new Date(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  };
  if (existingMembership) {
    await prisma.studentMembership.update({ where: { id: existingMembership.id }, data: membershipData });
  } else {
    await prisma.studentMembership.create({ data: { userId: partner.id, ...membershipData } });
  }

  // matches are unique on the ordered pair, so look for it both ways round.
  let match = await prisma.match.findFirst({
    where: {
      OR: [
        { user1Id: me.id, user2Id: partner.id },
        { user1Id: partner.id, user2Id: me.id },
      ],
    },
    select: { id: true, status: true },
  });
  if (!match) {
    match = await prisma.match.create({
      data: { user1Id: me.id, user2Id: partner.id, status: 'active' },
      select: { id: true, status: true },
    });
  } else if (match.status !== 'active') {
    match = await prisma.match.update({
      where: { id: match.id },
      data: { status: 'active' },
      select: { id: true, status: true },
    });
  }

  console.log('');
  console.log('  Ready.');
  console.log('  You        : ' + me.name + '  (' + email + ')');
  console.log('  Partner    : ' + PARTNER_NAME);
  console.log('  Email      : ' + PARTNER_EMAIL);
  console.log('  Password   : ' + PARTNER_PASSWORD);
  console.log('  Match id   : ' + match.id);
  console.log('');
  console.log('  Now run:  npx tsx scripts/chat-cli.ts');
  console.log('');
}

main()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
