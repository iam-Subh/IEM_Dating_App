import { prisma } from '../utils/prisma';
import { announceOwnProfile } from './verification-live';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';
import { onlineCount } from './presence.service';
import { istMidnight } from './verification-limits.service';
import { IdentityBanService } from './identity-ban.service';
import { PushService } from './push.service';
import { FaceVerificationService } from './face-verification.service';
import { disconnectUserSockets } from '../socket';
import { EmailService } from './email.service';
import { STAFF_ROLES, ROLE_PERMISSIONS, isStaffRole, type Permission } from '../middlewares/adminGuard.middleware';

/**
 * The admin panel's own reads and actions (ADMIN_PANEL_PLAN.md). Reviews of
 * selfies, birthdays and college memberships keep their existing services;
 * this adds the dashboard, people, account actions and the audit log.
 *
 * Privacy: staff see a person's profile, status and reports - never their
 * private chats, except the messages that were reported.
 */

const DAY_MS = 24 * 60 * 60_000;

export type AccountAction =
  | 'warn' | 'logout_all' | 'restrict' | 'restore' | 'suspend' | 'unsuspend'
  | 'ban' | 'remove_photo' | 'reset_selfie' | 'set_role';

/** Which permission each action needs (adminGuard.middleware.ts). */
export const ACTION_PERMISSION: Record<AccountAction, Permission> = {
  warn: 'users.support',
  logout_all: 'users.support',
  restrict: 'users.act',
  restore: 'users.act',
  suspend: 'users.act',
  unsuspend: 'users.act',
  remove_photo: 'users.act',
  reset_selfie: 'users.act',
  ban: 'users.ban',
  set_role: 'roles',
};

type Series = { day: string; count: number }[];

async function daily(table: 'users' | 'device_tokens' | 'matches', days: number): Promise<Series> {
  // Days in India, the app's day everywhere else too.
  const rows = await prisma.$queryRawUnsafe<{ day: Date; count: bigint }[]>(`
    SELECT date_trunc('day', created_at + interval '330 minutes') AS day, COUNT(*)::bigint AS count
    FROM ${table}
    WHERE created_at >= now() - ($1 || ' days')::interval
    GROUP BY 1 ORDER BY 1`, String(days));
  const byDay = new Map(rows.map((row) => [row.day.toISOString().slice(0, 10), Number(row.count)]));
  const out: Series = [];
  const today = new Date(Date.now() + 330 * 60_000);
  for (let index = days - 1; index >= 0; index--) {
    const day = new Date(today.getTime() - index * DAY_MS).toISOString().slice(0, 10);
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

export class AdminPanelService {
  static me(user: { sub: string; role: string; email?: string }) {
    return prisma.user.findUnique({ where: { id: user.sub }, select: { id: true, name: true, email: true, role: true } })
      .then((me) => ({ ...me, role: user.role, permissions: isStaffRole(user.role) ? ROLE_PERMISSIONS[user.role] : [] }));
  }

  /** Everything the first screen shows. The live numbers are read fresh every call. */
  static async dashboard() {
    const now = new Date();
    const today = istMidnight(now);
    const day = new Date(now.getTime() - DAY_MS);
    const week = new Date(now.getTime() - 7 * DAY_MS);
    const [
      online, phones, phonesToday, users, signupsToday, activeToday, active7d,
      matchesToday, messagesToday, collegeVerified, selfieVerified, paused, restricted, banned,
      faceReviews, oldestFace, cases, urgentCases, oldestCase, birthdays, memberships,
      signups30, phones30, matches30, appeals, flaggedMedia, bugReports,
    ] = await Promise.all([
      onlineCount(),
      prisma.deviceToken.groupBy({ by: ['platform'], _count: { _all: true } }),
      prisma.deviceToken.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { accountStatus: { notIn: ['deleted'] } } }),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { lastActiveAt: { gte: day } } }),
      prisma.user.count({ where: { lastActiveAt: { gte: week } } }),
      prisma.match.count({ where: { createdAt: { gte: today } } }),
      prisma.message.count({ where: { sentAt: { gte: today } } }),
      prisma.studentMembership.count({ where: { status: 'verified', verifiedAt: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      prisma.user.count({ where: { realPersonVerifiedAt: { not: null } } }),
      prisma.user.count({ where: { pausedAt: { not: null }, accountStatus: 'active' } }),
      prisma.user.count({ where: { accountStatus: { in: ['restricted', 'suspended'] } } }),
      prisma.user.count({ where: { accountStatus: 'banned' } }),
      prisma.faceReviewCase.count({ where: { status: 'pending' } }),
      prisma.faceReviewCase.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      prisma.moderationCase.count({ where: { status: { in: ['open', 'restricted', 'reviewing'] } } }),
      prisma.moderationCase.count({ where: { status: { in: ['open', 'restricted', 'reviewing'] }, priority: 'urgent' } }),
      prisma.moderationCase.findFirst({ where: { status: { in: ['open', 'restricted', 'reviewing'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      prisma.birthdayChangeRequest.count({ where: { status: 'pending' } }),
      prisma.studentMembership.count({ where: { campusConfirmed: false, status: 'verified' } }),
      daily('users', 30),
      daily('device_tokens', 30),
      daily('matches', 30),
      prisma.appeal.count({ where: { status: 'pending' } }),
      prisma.mediaModeration.count({ where: { status: 'pending' } }),
      prisma.bugReport.count({ where: { status: 'received' } }),
    ]);
    const byPlatform = Object.fromEntries(phones.map((row) => [row.platform, row._count._all]));
    return {
      at: now.toISOString(),
      live: {
        online,
        phones: phones.reduce((sum, row) => sum + row._count._all, 0),
        android: byPlatform.android ?? 0,
        ios: byPlatform.ios ?? 0,
        phonesToday,
        signupsToday,
      },
      people: { users, activeToday, active7d, matchesToday, messagesToday },
      verification: { collegeVerified, selfieVerified, paused, restricted, banned },
      queues: {
        faceReviews, faceOldest: oldestFace?.createdAt ?? null,
        cases, urgentCases, caseOldest: oldestCase?.createdAt ?? null,
        birthdays, memberships, appeals, flaggedMedia, bugReports,
      },
      series: { signups: signups30, phones: phones30, matches: matches30 },
    };
  }

  /** By name, email, Google email, college email or id. */
  static async searchUsers(query: string) {
    const q = query.trim();
    if (!q) {
      return prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 30, select: userListSelect });
    }
    const uuid = /^[0-9a-f-]{36}$/i.test(q);
    return prisma.user.findMany({
      where: uuid ? { id: q } : {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { googleEmail: { contains: q, mode: 'insensitive' } },
          { studentMembership: { institutionalEmail: { contains: q, mode: 'insensitive' } } },
        ],
      },
      orderBy: { lastActiveAt: { sort: 'desc', nulls: 'last' } },
      take: 30,
      select: userListSelect,
    });
  }

  /** One person: who they are, where they stand, and what was said about them. */
  static async user(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...userListSelect,
        googleEmail: true, gender: true, birthday: true, age: true, department: true, graduationYear: true,
        pausedAt: true, suspendedUntil: true, realPersonPassedAt: true, signupAndroidId: true, preferences: true,
        videoPlaybackUrl: true, profileVideoUrl: true, verifyLaterAt: true,
        photos: { orderBy: { order: 'asc' }, select: { id: true, photoUrl: true } },
        studentMembership: { select: { institutionalEmail: true, status: true, verifiedAt: true, expiresAt: true, campusConfirmed: true, institution: { select: { name: true, code: true } } } },
      },
    });
    if (!user) throw new HttpError(404, 'No such account', 'USER_NOT_FOUND');
    const [face, devices, sessions, matches, against, by, cases, audit] = await Promise.all([
      FaceVerificationService.status(userId).catch(() => null),
      prisma.deviceToken.findMany({ where: { userId }, select: { platform: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
      prisma.userSession.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { createdAt: true, lastUsedAt: true, deviceInfo: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.match.count({ where: { OR: [{ user1Id: userId }, { user2Id: userId }] } }),
      prisma.safetyReport.findMany({ where: { reportedUserId: userId }, orderBy: { createdAt: 'desc' }, take: 30, select: reportSelect }),
      prisma.safetyReport.count({ where: { reporterId: userId } }),
      prisma.moderationCase.findMany({ where: { subjectUserId: userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.adminAuditLog.findMany({ where: { targetId: userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const bio = (user.preferences as { bio?: string } | null)?.bio ?? null;
    const { preferences: _preferences, ...rest } = user;
    return {
      ...rest, bio,
      face: face && { status: face.status, reason: face.reason, verifiedAt: face.verifiedAt, items: face.items },
      devices, sessions, counts: { matches, reportsAgainst: against.length, reportsBy: by },
      reports: await withNames(against), cases, audit: await withAdminNames(audit),
    };
  }

  /** Acts on an account. Every action is in the audit log (admin-audit.ts). */
  static async act(adminId: string, userId: string, input: { action: AccountAction; reason?: string; days?: number; photoId?: string; role?: string }) {
    if (userId === adminId && ['ban', 'restrict', 'suspend', 'set_role'].includes(input.action)) {
      throw new HttpError(400, 'You cannot do that to your own account', 'SELF_ACTION');
    }
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, accountStatus: true } });
    if (!target) throw new HttpError(404, 'No such account', 'USER_NOT_FOUND');
    if (target.role === 'owner' && input.action !== 'warn') throw new HttpError(403, 'The owner account cannot be changed here', 'OWNER_PROTECTED');
    const reason = input.reason?.trim().slice(0, 300) || null;
    const signOut = async (status: string, extra: Record<string, unknown> = {}) => {
      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { accountStatus: status, sessionVersion: { increment: 1 }, eligibilityVersion: { increment: 1 }, ...extra } }),
        prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: `ADMIN_${input.action.toUpperCase()}` } }),
      ]);
      disconnectUserSockets(userId);
    };

    switch (input.action) {
      case 'warn': {
        if (!reason) throw new HttpError(400, 'Write the warning they will read', 'REASON_REQUIRED');
        const title = 'A message from the IEM Connect team';
        const notification = await prisma.notification.create({ data: { userId, type: 'system', title, body: reason } });
        await PushService.send(userId, { title, body: reason, category: 'account_security', kind: 'staff_warning', notificationId: notification.id, data: { url: 'iemdating://notifications' } }).catch(() => undefined);
        break;
      }
      case 'logout_all':
        await prisma.$transaction([
          prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }),
          prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'ADMIN_LOGOUT' } }),
        ]);
        disconnectUserSockets(userId);
        break;
      case 'restrict':
        await signOut('restricted');
        break;
      case 'suspend': {
        const days = Math.round(Number(input.days));
        if (!Number.isFinite(days) || days < 1 || days > 365) throw new HttpError(400, 'Suspend for 1 to 365 days', 'DAYS_INVALID');
        await signOut('suspended', { suspendedUntil: new Date(Date.now() + days * DAY_MS) });
        break;
      }
      case 'restore':
      case 'unsuspend':
        if (target.accountStatus === 'banned') throw new HttpError(409, 'A banned account is not restored here', 'BANNED_ACCOUNT_RESTORE_DENIED');
        await prisma.user.update({ where: { id: userId }, data: { accountStatus: 'active', suspendedUntil: null, eligibilityVersion: { increment: 1 } } });
        break;
      case 'ban':
        if (!reason) throw new HttpError(400, 'Write why, for the record', 'REASON_REQUIRED');
        await signOut('banned');
        // Their Google account, emails, college email and phone can't sign up again.
        await IdentityBanService.recordBan(userId, reason);
        await PushService.forgetDevices(userId).catch(() => undefined);
        await prisma.safetyReport.updateMany({ where: { reportedUserId: userId, status: 'pending' }, data: { status: 'resolved' } });
        await prisma.moderationCase.updateMany({ where: { subjectUserId: userId, status: { in: ['open', 'restricted', 'reviewing'] } }, data: { status: 'resolved', resolution: 'Account banned', resolvedAt: new Date() } });
        break;
      case 'remove_photo': {
        const photo = input.photoId ? await prisma.profilePhoto.findFirst({ where: { id: input.photoId, userId } }) : null;
        if (!photo) throw new HttpError(404, 'No such photo', 'PHOTO_NOT_FOUND');
        await prisma.profilePhoto.delete({ where: { id: photo.id } });
        announceOwnProfile(userId);
        void FaceVerificationService.afterMediaChange(userId).catch(() => undefined);
        if (reason) {
          await prisma.notification.create({ data: { userId, type: 'system', title: 'A photo was removed from your profile', body: reason } }).catch(() => undefined);
        }
        break;
      }
      case 'reset_selfie':
        await FaceVerificationService.remove(userId);
        break;
      case 'set_role': {
        const role = input.role ?? 'user';
        if (role !== 'user' && !(STAFF_ROLES as readonly string[]).includes(role)) throw new HttpError(400, 'Unknown role', 'ROLE_INVALID');
        if (role === 'owner') throw new HttpError(400, 'There is one owner', 'ROLE_INVALID');
        // Every request reads the role, so it applies at once, without signing them out of the app.
        await prisma.user.update({ where: { id: userId }, data: { role } });
        break;
      }
      default:
        throw new HttpError(400, 'Unknown action', 'ACTION_INVALID');
    }
    logger.info(`[ADMIN] ${input.action} on an account`);
    return prisma.user.findUnique({ where: { id: userId }, select: { accountStatus: true, suspendedUntil: true, role: true } });
  }

  /** Report cases, most urgent first, with who they are about and every report in them. */
  static async cases(status: 'open' | 'closed') {
    const open = ['open', 'restricted', 'reviewing'];
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      SELECT id FROM moderation_cases WHERE status ${status === 'open' ? '= ANY($1)' : '<> ALL($1)'}
      ORDER BY CASE priority WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 ELSE 1 END DESC, created_at ${status === 'open' ? 'ASC' : 'DESC'}
      LIMIT 100`, open);
    const cases = await prisma.moderationCase.findMany({ where: { id: { in: rows.map((row) => row.id) } } });
    const ordered = rows.map((row) => cases.find((item) => item.id === row.id)!).filter(Boolean);
    const [subjects, reports] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ordered.map((item) => item.subjectUserId) } }, select: { ...userListSelect, photos: { orderBy: { order: 'asc' }, take: 1, select: { photoUrl: true } } } }),
      prisma.safetyReport.findMany({ where: { moderationCaseId: { in: ordered.map((item) => item.id) } }, orderBy: { createdAt: 'asc' }, select: { ...reportSelect, moderationCaseId: true } }),
    ]);
    const named = await withNames(reports);
    // Repeat offenders and serial reporters (docs/SAFETY_AND_LEGAL.md 2.4): the
    // person's earlier cases, and how each reporter's reports have gone.
    const subjectIds = [...new Set(ordered.map((item) => item.subjectUserId))];
    const reporterIds = [...new Set(reports.map((report) => report.reporterId))];
    const [history, reporterTotals, reporterDismissed] = await Promise.all([
      prisma.moderationCase.groupBy({ by: ['subjectUserId', 'status'], where: { subjectUserId: { in: subjectIds } }, _count: { _all: true } }),
      prisma.safetyReport.groupBy({ by: ['reporterId'], where: { reporterId: { in: reporterIds } }, _count: { _all: true } }),
      prisma.safetyReport.groupBy({ by: ['reporterId'], where: { reporterId: { in: reporterIds }, status: 'dismissed' }, _count: { _all: true } }),
    ]);
    const reporterStats = (id: string) => ({
      made: reporterTotals.find((row) => row.reporterId === id)?._count._all ?? 0,
      dismissed: reporterDismissed.find((row) => row.reporterId === id)?._count._all ?? 0,
    });
    return ordered.map((item) => {
      const past = history.filter((row) => row.subjectUserId === item.subjectUserId);
      return {
        ...item,
        subject: subjects.find((user) => user.id === item.subjectUserId) ?? null,
        // Earlier cases, not counting this one.
        history: {
          actioned: past.filter((row) => row.status === 'resolved').reduce((sum, row) => sum + row._count._all, 0) - (item.status === 'resolved' ? 1 : 0),
          dismissed: past.filter((row) => row.status === 'dismissed').reduce((sum, row) => sum + row._count._all, 0) - (item.status === 'dismissed' ? 1 : 0),
        },
        reports: named.filter((report) => report.moderationCaseId === item.id).map((report) => ({ ...report, reporterStats: reporterStats(report.reporterId) })),
      };
    });
  }

  /** Appeals from people who can't sign in, oldest first, with where their account stands. */
  static async appeals(status: 'pending' | 'closed') {
    const rows = await prisma.appeal.findMany({
      where: status === 'pending' ? { status: 'pending' } : { status: { not: 'pending' } },
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' }, take: 100,
    });
    const people = await prisma.user.findMany({
      where: { id: { in: rows.map((row) => row.userId).filter((id): id is string => !!id) } },
      select: { ...userListSelect, suspendedUntil: true, photos: { orderBy: { order: 'asc' }, take: 1, select: { photoUrl: true } } },
    });
    const cases = await prisma.moderationCase.findMany({
      where: { subjectUserId: { in: people.map((person) => person.id) } }, orderBy: { createdAt: 'desc' },
      select: { subjectUserId: true, status: true, resolution: true, resolvedAt: true },
    });
    return rows.map((row) => ({
      ...row,
      user: people.find((person) => person.id === row.userId) ?? null,
      lastCase: cases.find((item) => item.subjectUserId === row.userId) ?? null,
    }));
  }

  /** Restore the account or uphold the decision; the person hears by email. Lifting a ban is owner or admin only. */
  static async decideAppeal(adminId: string, role: string, appealId: string, input: { decision: 'restore' | 'uphold'; note: string }) {
    const appeal = await prisma.appeal.findUnique({ where: { id: appealId } });
    if (!appeal || appeal.status !== 'pending') throw new HttpError(404, 'This appeal is closed', 'APPEAL_UNAVAILABLE');
    const user = appeal.userId ? await prisma.user.findUnique({ where: { id: appeal.userId }, select: { id: true, accountStatus: true } }) : null;
    if (input.decision === 'restore') {
      if (!user) throw new HttpError(400, 'No account uses this email', 'APPEAL_NO_ACCOUNT');
      if (user.accountStatus === 'banned') {
        if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Only the owner or an admin can lift a ban', 'STAFF_FORBIDDEN');
        // The ban's recorded identities go too, or they could never sign up or verify again.
        await prisma.$transaction([
          prisma.bannedIdentifier.deleteMany({ where: { userId: user.id } }),
          prisma.user.update({ where: { id: user.id }, data: { accountStatus: 'active', suspendedUntil: null, eligibilityVersion: { increment: 1 } } }),
        ]);
      } else if (user.accountStatus !== 'active') {
        await prisma.user.update({ where: { id: user.id }, data: { accountStatus: 'active', suspendedUntil: null, eligibilityVersion: { increment: 1 } } });
      }
    }
    await prisma.appeal.update({
      where: { id: appealId },
      data: { status: input.decision === 'restore' ? 'restored' : 'upheld', decidedBy: adminId, decidedAt: new Date(), note: input.note.slice(0, 500) },
    });
    const subject = input.decision === 'restore' ? 'Your IEM Connect account is back' : 'Your IEM Connect appeal';
    const text = input.decision === 'restore'
      ? `We looked at your appeal and restored your account. You can sign in again.

${input.note}`
      : `We looked at your appeal carefully and the decision stays.

${input.note}

If you disagree, you can appeal to the Grievance Appellate Committee within 30 days.`;
    await EmailService.sendTeamMessage(appeal.email, subject, text).catch((error) => logger.warn(`[APPEAL] reply not sent: ${(error as Error).message}`));
    return { status: input.decision === 'restore' ? 'restored' : 'upheld' };
  }

  static async audit(limit = 100, before?: string) {
    const rows = await prisma.adminAuditLog.findMany({
      where: before ? { createdAt: { lt: new Date(before) } } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return withAdminNames(rows);
  }
}

const userListSelect = {
  id: true, name: true, email: true, accountStatus: true, role: true, createdAt: true, lastActiveAt: true,
  isVerified: true, realPersonVerifiedAt: true, college: true,
} as const;

const reportSelect = {
  id: true, reporterId: true, reason: true, description: true, sourceType: true, status: true, evidenceSnapshot: true, createdAt: true,
} as const;

async function withNames<T extends { reporterId: string }>(reports: T[]) {
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(reports.map((report) => report.reporterId))] } }, select: { id: true, name: true } });
  return reports.map((report) => ({ ...report, reporterName: people.find((person) => person.id === report.reporterId)?.name ?? 'Deleted account' }));
}

async function withAdminNames<T extends { adminId: string }>(rows: T[]) {
  const admins = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.adminId))] } }, select: { id: true, name: true } });
  return rows.map((row) => ({ ...row, adminName: admins.find((admin) => admin.id === row.adminId)?.name ?? 'Unknown' }));
}
