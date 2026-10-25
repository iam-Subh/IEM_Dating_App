/**
 * What waits for a college verification (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 2.2-2.7).
 *
 * Non-destructive: creates its own users and match under random ids and
 * deletes exactly those rows.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';
import { ChatService } from '../src/services/chat.service';
import { ChatMediaService } from '../src/services/chat-media.service';
import { VerificationLimitsService, CHAT_MESSAGE_LIMIT } from '../src/services/verification-limits.service';

const unverified = randomUUID();
const verified = randomUUID();
const expired = randomUUID();
const users = [unverified, verified, expired];
let matchId = '';
let expiredMatchId = '';

const ID_COLUMNS = ['id', 'user_id', 'match_id', 'message_id', 'sender_id', 'recipient_id', 'actor_id',
  'audience_user_id', 'aggregate_id', 'owner_id', 'user1_id', 'user2_id', 'scope_id', 'entity_id', 'outbox_event_id'];

before(async () => {
  await prisma.user.createMany({
    data: users.map((id) => ({ id, email: `${id}@limits.example.test`, name: `Limits ${id.slice(0, 4)}`, passwordHash: 'TEST_ONLY', accountStatus: 'active' })),
  });
  const institution = await prisma.institution.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  await prisma.studentMembership.create({
    data: { userId: verified, institutionId: institution.id, institutionalEmail: `${verified}@limits.example.test`, status: 'verified', verifiedAt: new Date() },
  });
  await prisma.studentMembership.create({
    data: {
      userId: expired, institutionId: institution.id, institutionalEmail: `${expired}@limits.example.test`, status: 'verified',
      verifiedAt: new Date(Date.now() - 400 * 86_400_000), expiresAt: new Date(Date.now() - 86_400_000),
    },
  });
  matchId = (await prisma.match.create({ data: { user1Id: unverified, user2Id: verified, status: 'active' } })).id;
  expiredMatchId = (await prisma.match.create({ data: { user1Id: expired, user2Id: verified, status: 'active' } })).id;
});

after(async () => {
  const matchIds = [matchId, expiredMatchId].filter(Boolean);
  const messageIds = (await prisma.message.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } })).map((item) => item.id);
  const eventIds = (await prisma.chatEvent.findMany({ where: { matchId: { in: matchIds } }, select: { id: true } })).map((item) => item.id);
  const seed = [...users, ...matchIds, ...messageIds, ...eventIds];
  const outboxIds = (await prisma.outboxEvent.findMany({ where: { aggregateId: { in: seed } }, select: { id: true } })).map((item) => item.id);
  const ids = [...new Set([...seed, ...outboxIds])];
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(${ID_COLUMNS})`;
  for (let pass = 0; pass < 6; pass++) {
    let failures = 0;
    for (const { table_name, column_name } of columns) {
      try { await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1::uuid[])`, ids); }
      catch { failures += 1; }
    }
    if (!failures) break;
  }
  await prisma.$disconnect();
  await redisClient.quit().catch(() => undefined);
});

test('photos and videos wait for verification; voice notes do not', async () => {
  await assert.rejects(ChatMediaService.generateUploadUrl(unverified, matchId, 'jpeg'), (error: any) => error.code === 'VERIFY_TO_SEND_MEDIA');
  await assert.rejects(ChatMediaService.createMultipartUpload(unverified, matchId, 'mp4', 1000), (error: any) => error.code === 'VERIFY_TO_SEND_MEDIA');
  await VerificationLimitsService.requireCanUpload(unverified, 'm4a');
  await assert.rejects(ChatService.sendMessage(unverified, matchId, '', undefined, ['chat-media/x/y.jpeg']),
    (error: any) => error.code === 'VERIFY_TO_SEND_MEDIA');
});

test('30 messages in total, then the 31st is refused - and a retried message is not counted twice', async () => {
  for (let index = 0; index < CHAT_MESSAGE_LIMIT; index++) {
    await ChatService.sendMessage(unverified, matchId, `hello ${index}`, undefined, [], `limit-${unverified}-${index}`);
  }
  const allowance = await VerificationLimitsService.chatAllowance(unverified);
  assert.equal(allowance.limited && allowance.left, 0);
  // The last one, sent again by a flaky network, is the same message - not a refusal.
  const repeated = await ChatService.sendMessage(unverified, matchId, `hello ${CHAT_MESSAGE_LIMIT - 1}`, undefined, [],
    `limit-${unverified}-${CHAT_MESSAGE_LIMIT - 1}`);
  assert.equal((repeated as any).repeated, true);
  await assert.rejects(ChatService.sendMessage(unverified, matchId, 'one more'), (error: any) =>
    error.code === 'VERIFY_TO_CHAT' && error.details?.used === CHAT_MESSAGE_LIMIT);
});

test('the other side is never limited, and sees that this chat waits for a verification', async () => {
  await ChatService.sendMessage(verified, matchId, 'still here');
  assert.equal(await VerificationLimitsService.waitingToVerify(unverified), true);
  assert.equal(await VerificationLimitsService.waitingToVerify(verified), false);
});

test('an expired verification is not limited', async () => {
  assert.equal(await VerificationLimitsService.isLimited(expired), false);
  await VerificationLimitsService.requireCanSend(expired, 'media', true);
});
