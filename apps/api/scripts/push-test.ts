/**
 * Sends test notifications to one person's phones
 * (apps/mobile/src/features/notifications/NOTIFICATIONS_PLAN.md 15).
 *
 *   npm run push:test -- --email=you@example.com --kind=message
 *   npm run push:test -- --email=you@example.com --kind=all
 *
 * Kinds: message, match, like, rose, follow, signin, standouts, tip, clear, all.
 * Real pushes through the real path (switches, channels, buttons), except
 * quiet hours: tests always go now. Buttons act for real - "Reply" sends a
 * real message in your first active chat, so use a test match.
 */
import { prisma } from '../src/utils/prisma';
import { PushService, type PushMessage } from '../src/services/push.service';
import { LINES, pickLine } from '../src/services/push-policy.service';
import { ChatNotificationService } from '../src/services/chat-notification.service';

const arg = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const email = arg('email');
const kind = arg('kind') ?? 'message';
// Midday IST, so quiet hours never hold a test back.
const NOON_IST = (() => { const now = new Date(); now.setUTCHours(6, 30, 0, 0); return now; })();

async function main() {
  if (!email) throw new Error('Pass --email=<the account on the phone>');
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, name: true } });
  if (!user) throw new Error(`No account with ${email}`);
  const devices = await prisma.deviceToken.count({ where: { userId: user.id } });
  if (!devices) throw new Error('This account has no phone registered: open the app and allow notifications first.');
  const match = await prisma.match.findFirst({
    where: { status: 'active', OR: [{ user1Id: user.id }, { user2Id: user.id }] },
    select: { id: true, user1Id: true, user1: { select: { name: true } }, user2: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const other = match ? (match.user1Id === user.id ? match.user2.name : match.user1.name).split(' ')[0] : 'Riya';
  // The newest message they sent you, as a real chat push (voice, photo... whatever it was).
  const lastFromThem = match ? await prisma.message.findFirst({
    where: { matchId: match.id, senderId: { not: user.id }, isDeleted: false },
    orderBy: { sentAt: 'desc' }, select: { id: true },
  }) : null;
  const latest = lastFromThem ? await ChatNotificationService.payload(user.id, lastFromThem.id) : null;
  const follow = await prisma.follow.findFirst({ where: { followeeId: user.id, status: 'pending' }, select: { id: true } });

  const line = (set: keyof typeof LINES, values: Record<string, string | number> = {}) => pickLine(LINES[set], values);
  const tests: Record<string, () => PushMessage | null> = {
    message: () => match ? {
      title: other, body: 'Test message - try Reply or Mark as read 👋', category: 'messages', kind: 'message',
      data: { url: `iemdating://chat/${match.id}`, matchId: match.id },
      // New app builds draw it themselves (MESSAGE_NOTIFICATIONS_PLAN.md): the latest real message from them.
      ...(latest ? { native: latest } : {}),
    } : null,
    match: () => {
      const text = line('match', { name: other });
      return { title: text.title, body: text.body, template: text.id, category: 'matches', kind: 'match', data: { url: match ? `iemdating://chat/${match.id}` : 'iemdating://main/Chats', ...(match ? { matchId: match.id } : {}) } };
    },
    like: () => {
      const text = line('like_many', { count: 3 });
      return { title: text.title, body: text.body, template: text.id, category: 'likes', kind: 'like', data: { url: 'iemdating://main/matches?tab=likes' } };
    },
    rose: () => {
      const text = line('rose');
      return { title: text.title, body: text.body, template: text.id, category: 'roses', kind: 'rose', data: { url: 'iemdating://main/matches?tab=likes' } };
    },
    follow: () => ({
      title: 'New follow request', body: follow ? 'Try Accept or Decline.' : 'Test only - no real request, so Accept says it is gone.',
      category: 'follow_requests', kind: 'follow_request', data: { url: 'iemdating://stories/follow-requests', followId: follow?.id ?? '00000000-0000-4000-8000-000000000000' },
    }),
    signin: () => ({
      title: 'New sign-in on a test phone', body: 'Not you? Tap to secure your account.', category: 'account_security', kind: 'signin',
      data: { url: 'iemdating://settings/sessions' },
    }),
    standouts: () => {
      const text = line('standouts', { campus: 'your campus' });
      return { title: text.title, body: text.body, template: text.id, category: 'picks', kind: 'standouts', data: { url: 'iemdating://standouts' } };
    },
    tip: () => {
      const text = line('tip_video');
      return { title: text.title, body: text.body, template: text.id, category: 'nudges', kind: 'tip', data: { url: 'iemdating://EditProfile' } };
    },
  };

  const kinds = kind === 'all' ? Object.keys(tests) : [kind];
  for (const name of kinds) {
    if (name === 'clear') continue;
    const build = tests[name];
    if (!build) throw new Error(`Unknown kind "${name}". Kinds: ${[...Object.keys(tests), 'clear', 'all'].join(', ')}`);
    const message = build();
    if (!message) { console.log(`- ${name}: skipped (needs an active match)`); continue; }
    await PushService.send(user.id, message, undefined, { now: NOON_IST });
    console.log(`✓ ${name}: "${message.title}"`);
    if (kinds.length > 1) await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (kind === 'clear') {
    if (!match) throw new Error('clear needs an active match');
    await PushService.clear(user.id, { matchId: match.id });
    console.log(`✓ clear: the chat with ${other} should leave the status bar`);
  }
  console.log('\nNothing arrived? Check the switch for that type in App settings, and "Pause all".');
}

main()
  .catch((error) => { console.error(`✗ ${(error as Error).message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
