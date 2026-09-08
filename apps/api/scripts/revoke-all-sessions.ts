import 'dotenv/config';
import { prisma } from '../src/utils/prisma';

async function main() {
  if (process.env.CONFIRM_REVOKE_ALL_SESSIONS !== 'REVOKE') {
    throw new Error('Set CONFIRM_REVOKE_ALL_SESSIONS=REVOKE to continue');
  }

  const result = await prisma.$transaction(async (tx) => {
    const sessions = await tx.userSession.deleteMany({});
    const users = await tx.user.updateMany({ data: { sessionVersion: { increment: 1 } } });
    return { revokedSessions: sessions.count, updatedUsers: users.count };
  });

  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Session revocation failed');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
