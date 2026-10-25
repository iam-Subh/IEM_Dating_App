/**
 * Prints who exists and which matches they have, so a second test account can
 * be wired up for chatting against the app on a real phone.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, phone: true, accountStatus: true, birthday: true,
      studentMembership: { select: { status: true, verifiedAt: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 25,
  });

  console.log('USERS: ' + users.length);
  for (const u of users) {
    console.log([
      (u.name ?? '(no name)').padEnd(18),
      (u.email ?? '(no email)').padEnd(30),
      (u.phone ?? '(no phone)').padEnd(15),
      u.accountStatus.padEnd(9),
      u.birthday ? 'dob:yes' : 'dob:NO ',
      'member:' + (u.studentMembership?.status ?? 'none'),
      u.id,
    ].join(' | '));
  }

  const matches = await prisma.match.findMany({
    select: { id: true, user1Id: true, user2Id: true, status: true },
    take: 20,
  });
  console.log('\nMATCHES: ' + matches.length);
  for (const m of matches) console.log('  ' + m.id + '  ' + m.user1Id + '  ' + m.user2Id + '  ' + m.status);
}

main()
  .catch((e) => console.error('ERROR:', e.message))
  .finally(async () => prisma.$disconnect());
