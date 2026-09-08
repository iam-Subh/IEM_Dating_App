import { prisma } from '../src/utils/prisma';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function status() {
  const [counts, oldestPending] = await Promise.all([
    prisma.outboxEvent.groupBy({ by: ['status'], _count: true }),
    prisma.outboxEvent.findFirst({
      where: { status: { in: ['pending', 'processing'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, topic: true, status: true, attempts: true, createdAt: true, availableAt: true },
    }),
  ]);
  console.log(JSON.stringify({ counts, oldestPending }, null, 2));
}

async function retry(eventId: string | undefined) {
  if (!eventId || !UUID.test(eventId)) throw new Error('Provide one valid outbox event UUID');
  const changed = await prisma.outboxEvent.updateMany({
    where: { id: eventId, status: 'dead' },
    data: {
      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      completedAt: null,
    },
  });
  if (changed.count !== 1) throw new Error('The outbox event does not exist or is not dead');
  console.log(JSON.stringify({ eventId, status: 'pending' }));
}

async function main() {
  const command = process.argv[2];
  if (command === 'status') return status();
  if (command === 'retry') return retry(process.argv[3]);
  throw new Error('Use status or retry <event UUID>');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
