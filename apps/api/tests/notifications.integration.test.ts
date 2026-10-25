/**
 * Notifications v2 (apps/mobile/src/features/notifications/NOTIFICATIONS_PLAN.md):
 * switches, channels, buttons, quiet hours, the account checks, the spicy
 * caps and back-off, the timed pushes, opens and the sign-in notice.
 *
 * Non-destructive: its own users under random ids, pushes go to a fake push
 * service on localhost, and every worker run is limited to these users (`only`).
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/prisma';
import { PushService } from '../src/services/push.service';
import { PushEngagementService } from '../src/services/push-engagement.service';
import { pushDecision } from '../src/services/app-settings.service';
import { SignInNoticeService } from '../src/services/sign-in-notice.service';
import { istHour } from '../src/services/push-policy.service';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
// Fixed instants (IST = UTC+5:30).
const QUIET = new Date('2026-10-04T19:00:00Z');   // 00:30 IST
const MORNING = new Date('2026-10-05T03:45:00Z'); // 09:15 IST
const AFTERNOON = new Date('2026-10-05T08:30:00Z'); // 14:00 IST

const alice = randomUUID();   // the main person
const bob = randomUUID();     // her match
const banned = randomUUID();
const minor = randomUUID();   // reported "Under 18"
const away = randomUUID();    // last active 8 days ago
const users = [alice, bob, banned, minor, away];

const ID_COLUMNS = ['id', 'user_id', 'user1_id', 'user2_id', 'subject_user_id', 'reporter_id', 'reported_user_id', 'sender_id', 'match_id'];

type Sent = { to: string; title?: string; body?: string; channelId?: string; priority?: string; categoryId?: string; ttl?: number; _contentAvailable?: boolean; data: Record<string, string> };
let sent: Sent[] = [];
let server: http.Server;

async function makeUser(id: string, extra: Record<string, unknown> = {}) {
  await prisma.user.create({
    data: {
      id, email: `${id}@push.example.test`, name: `Push ${id.slice(0, 4)}`, passwordHash: 'TEST_ONLY', accountStatus: 'active',
      birthday: new Date('2004-01-01'), age: 22, discoveryMode: 'college', discoveryCategory: 'nonbinary', showMeCategories: ['nonbinary'],
      minAgePref: 18, maxAgePref: 40, collegeScope: 'group', preferencesConfirmedAt: new Date(), lastActiveAt: AFTERNOON, ...extra,
    },
  });
  await prisma.deviceToken.create({ data: { userId: id, token: `ExponentPushToken[${id.replace(/-/g, '').slice(0, 22)}]`, platform: 'android' } });
}

const forUser = (id: string) => sent.filter((item) => item.data?.userId === id);

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const items = JSON.parse(body) as Sent[];
      sent.push(...items);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: items.map(() => ({ status: 'ok', id: randomUUID() })) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.EXPO_PUSH_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push`;
  for (const id of users) await makeUser(id);
  await prisma.user.update({ where: { id: banned }, data: { accountStatus: 'banned' } });
  await prisma.user.update({ where: { id: away }, data: { lastActiveAt: new Date(AFTERNOON.getTime() - 8 * DAY) } });
  await prisma.moderationCase.create({ data: { subjectUserId: minor, status: 'open', priority: 'urgent' } });
});

beforeEach(async () => {
  sent = [];
  await prisma.pushLog.deleteMany({ where: { userId: { in: users } } });
  await prisma.pushQueue.deleteMany({ where: { userId: { in: users } } });
  await prisma.pushEngagement.deleteMany({ where: { userId: { in: users } } });
});

after(async () => {
  server.close();
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND column_name = ANY(${ID_COLUMNS})`;
  const matchIds = (await prisma.match.findMany({ where: { OR: [{ user1Id: { in: users } }, { user2Id: { in: users } }] }, select: { id: true } })).map((m) => m.id);
  const ids = [...users, ...matchIds];
  for (let pass = 0; pass < 6; pass++) {
    for (const { table_name, column_name } of columns) {
      if (table_name === 'users') continue;
      await prisma.$executeRawUnsafe(`DELETE FROM "${table_name}" WHERE "${column_name}" = ANY($1::uuid[])`, ids).catch(() => undefined);
    }
  }
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test('switches, channels and quiet hours decide each push', () => {
  const defaults = { notificationPrefs: {}, notifyLikes: true };
  // The new switches are on by default; each type has its own channel.
  assert.equal(pushDecision(defaults, 'picks', AFTERNOON)?.channelId, 'picks');
  assert.equal(pushDecision(defaults, 'messages', AFTERNOON)?.channelId, 'messages');
  assert.equal(pushDecision(defaults, 'roses', AFTERNOON)?.channelId, 'likes');
  // At night: likes wait, messages and account notices don't...
  assert.equal(pushDecision(defaults, 'likes', QUIET)?.waitForMorning, true);
  assert.equal(pushDecision(defaults, 'messages', QUIET)?.waitForMorning, false);
  assert.equal(pushDecision(defaults, 'account_security', QUIET)?.waitForMorning, false);
  // ...unless asked: then messages wait too, and account notices still never do.
  const strict = { notificationPrefs: { quiet_messages: true }, notifyLikes: true };
  assert.equal(pushDecision(strict, 'messages', QUIET)?.waitForMorning, true);
  assert.equal(pushDecision(strict, 'account_security', QUIET)?.waitForMorning, false);
  // Quiet hours off: nothing waits. A switch off: nothing is sent.
  assert.equal(pushDecision({ notificationPrefs: { quiet_hours: false }, notifyLikes: true }, 'likes', QUIET)?.waitForMorning, false);
  assert.equal(pushDecision({ notificationPrefs: { nudges: false }, notifyLikes: true }, 'nudges', AFTERNOON), null);
  // Pause all stops everything but account and security.
  const paused = { notificationPrefs: { pause_all: true }, notifyLikes: true };
  assert.equal(pushDecision(paused, 'matches', AFTERNOON), null);
  assert.ok(pushDecision(paused, 'account_security', AFTERNOON));
});

test('a message push carries its channel, buttons, priority and who it is for', async () => {
  await PushService.send(alice, {
    title: 'New message', body: 'Sent you a message', category: 'messages', kind: 'message',
    data: { url: 'iemdating://chat/x', matchId: randomUUID() },
  }, undefined, { now: AFTERNOON });
  const [push] = forUser(alice);
  assert.ok(push, 'sent');
  assert.equal(push.channelId, 'messages');
  assert.equal(push.priority, 'high');
  assert.equal(push.categoryId, 'message');
  assert.equal(push.data.userId, alice);
  const log = await prisma.pushLog.findUniqueOrThrow({ where: { id: push.data.pushId } });
  assert.equal(log.kind, 'message');
  assert.equal(log.spicy, false);
  // Opened: counted once.
  assert.deepEqual(await PushService.opened(alice, log.id, 'reply'), { recorded: true });
  assert.deepEqual(await PushService.opened(alice, log.id), { recorded: false });
  assert.equal((await prisma.pushLog.findUniqueOrThrow({ where: { id: log.id } })).openedAction, 'reply');
});

test('quiet hours hold a push until the morning, then send it', async () => {
  await PushService.send(alice, { title: 'Likes', body: 'b', category: 'likes', kind: 'like', data: {} }, undefined, { now: QUIET });
  assert.equal(forUser(alice).length, 0, 'nothing at night');
  const held = await prisma.pushQueue.findFirstOrThrow({ where: { userId: alice } });
  assert.ok(held.sendAfter.getTime() >= new Date('2026-10-05T03:00:00Z').getTime(), 'after 8:30 IST');
  assert.equal(await PushService.sendDue(QUIET, 500, users), 0, 'not yet');
  assert.equal(await PushService.sendDue(MORNING, 500, users), 1);
  assert.equal(forUser(alice).length, 1);
  assert.equal(forUser(alice)[0].categoryId, 'like');
});

test('banned accounts and open "Under 18" reports get account notices only', async () => {
  for (const id of [banned, minor]) {
    await PushService.send(id, { title: 'Match', body: 'b', category: 'matches', data: {} }, undefined, { now: AFTERNOON });
    assert.equal(forUser(id).length, 0);
    await PushService.send(id, { title: 'Account', body: 'b', category: 'account_security', data: {} }, undefined, { now: AFTERNOON });
    assert.equal(forUser(id).length, 1);
  }
});

test('spicy pushes: 2 a day, 4 hours apart, and none after 10 ignored', async () => {
  assert.equal(await PushEngagementService.spicyAllowed(alice, 'picks', AFTERNOON), true);
  await prisma.pushLog.create({ data: { userId: alice, category: 'picks', kind: 'standouts', spicy: true, sentAt: new Date(AFTERNOON.getTime() - HOUR) } });
  assert.equal(await PushEngagementService.spicyAllowed(alice, 'picks', AFTERNOON), false, 'within 4 hours');
  assert.equal(await PushEngagementService.spicyAllowed(alice, 'picks', new Date(AFTERNOON.getTime() + 4 * HOUR)), true);
  await prisma.pushLog.create({ data: { userId: alice, category: 'picks', kind: 'standouts', spicy: true, sentAt: new Date(AFTERNOON.getTime() - 2 * HOUR) } });
  assert.equal(await PushEngagementService.spicyAllowed(alice, 'picks', new Date(AFTERNOON.getTime() + 5 * HOUR)), false, 'two today');
  assert.equal(await PushEngagementService.spicyAllowed(alice, 'picks', QUIET), false, 'never at night');

  await prisma.pushLog.deleteMany({ where: { userId: alice } });
  for (let i = 1; i <= 10; i++) {
    await prisma.pushLog.create({ data: { userId: alice, category: 'picks', kind: 'standouts', spicy: true, sentAt: new Date(AFTERNOON.getTime() - i * DAY) } });
  }
  assert.equal(await PushEngagementService.spicyAllowed(alice, 'picks', AFTERNOON), false);
  const paused = await prisma.pushEngagement.findUniqueOrThrow({ where: { userId: alice } });
  assert.ok(paused.spicyPausedUntil && paused.spicyPausedUntil.getTime() > AFTERNOON.getTime() + 13 * DAY, 'paused two weeks');
});

test("today's Standouts go once, at the person's hour", async () => {
  await prisma.pushEngagement.create({ data: { userId: alice, bestHour: istHour(AFTERNOON) } });
  await PushEngagementService.standouts(AFTERNOON, [alice]);
  assert.equal(forUser(alice).length, 1);
  assert.equal(forUser(alice)[0].data.kind, 'standouts');
  assert.equal(forUser(alice)[0].channelId, 'picks');
  await PushEngagementService.standouts(new Date(AFTERNOON.getTime() + 15 * 60_000), [alice]);
  assert.equal(forUser(alice).length, 1, 'not twice in a day');
  // Someone else's hour: nothing.
  await prisma.pushEngagement.create({ data: { userId: bob, bestHour: (istHour(AFTERNOON) + 3) % 24 } });
  await PushEngagementService.standouts(AFTERNOON, [bob]);
  assert.equal(forUser(bob).length, 0);
});

test('comebacks only say true things, and stop', async () => {
  await prisma.pushEngagement.create({ data: { userId: away, bestHour: istHour(AFTERNOON) } });
  // Day 8 away, no likes, no matches, nobody new: nothing true to say - the step passes quietly.
  await PushEngagementService.comebacks(AFTERNOON, [away]);
  assert.equal(forUser(away).length, 0);
  assert.equal((await prisma.pushEngagement.findUniqueOrThrow({ where: { userId: away } })).comebackLevel, 2);
  // Day 14 speaks only of unseen likes or new people - a match alone isn't enough.
  const match = await prisma.match.create({ data: { user1Id: away, user2Id: bob } });
  const later = new Date(AFTERNOON.getTime() + 7 * DAY);
  await PushEngagementService.comebacks(later, [away]);
  assert.equal(forUser(away).length, 0);
  assert.equal((await prisma.pushEngagement.findUniqueOrThrow({ where: { userId: away } })).comebackLevel, 3);
  // Level 3: nothing more, ever, until they come back.
  await PushEngagementService.comebacks(new Date(later.getTime() + DAY), [away]);
  assert.equal(forUser(away).length, 0);
  await prisma.match.delete({ where: { id: match.id } });

  // Day 7 with an active match: "Your matches miss you".
  await prisma.pushEngagement.update({ where: { userId: away }, data: { comebackLevel: 1 } });
  const second = await prisma.match.create({ data: { user1Id: away, user2Id: alice } });
  await PushEngagementService.comebacks(AFTERNOON, [away]);
  assert.equal(forUser(away).length, 1);
  assert.equal(forUser(away)[0].data.kind, 'comeback_2');
  await prisma.match.delete({ where: { id: second.id } });
});

test('a match nobody has written to gets one nudge each, kept in the Notifications page', async () => {
  const match = await prisma.match.create({ data: { user1Id: alice, user2Id: bob, createdAt: new Date(AFTERNOON.getTime() - 3.5 * DAY) } });
  await PushEngagementService.waitingMatches(AFTERNOON, [alice, bob]);
  assert.equal(forUser(alice).length, 1);
  assert.equal(forUser(bob).length, 1);
  assert.equal(forUser(alice)[0].categoryId, 'match');
  await PushEngagementService.waitingMatches(new Date(AFTERNOON.getTime() + HOUR), [alice, bob]);
  assert.equal(forUser(alice).length, 1, 'once');
  assert.equal(await prisma.notification.count({ where: { userId: alice, deliveryKey: `waiting:${match.id}:${alice}` } }), 1);
  await prisma.notification.deleteMany({ where: { deliveryKey: { startsWith: `waiting:${match.id}` } } });
  await prisma.match.delete({ where: { id: match.id } });
});

test('a sign-in tells the other signed-in phones, with its buttons', async () => {
  const first = randomUUID();
  await prisma.userSession.create({ data: { userId: alice, tokenJti: randomUUID(), familyId: first, expiresAt: new Date(Date.now() + DAY) } });
  // The first phone: nobody else to tell.
  await SignInNoticeService.afterSignIn(alice, first, {});
  assert.equal(forUser(alice).length, 0);
  const second = randomUUID();
  await prisma.userSession.create({ data: { userId: alice, tokenJti: randomUUID(), familyId: second, expiresAt: new Date(Date.now() + DAY) } });
  await SignInNoticeService.afterSignIn(alice, second, { brand: 'vivo', model: 'V29' });
  const [push] = forUser(alice);
  assert.equal(push.title, 'New sign-in on a vivo V29');
  assert.equal(push.categoryId, 'signin');
  assert.equal(push.channelId, 'account');
});

test('a silent clear carries no alert', async () => {
  const matchId = randomUUID();
  await PushService.clear(alice, { matchId });
  const [push] = forUser(alice);
  assert.equal(push._contentAvailable, true);
  assert.equal(push.title, undefined);
  assert.equal(push.data.type, 'clear');
  assert.equal(push.data.matchId, matchId);
});
