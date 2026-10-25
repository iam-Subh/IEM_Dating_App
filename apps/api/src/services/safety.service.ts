import { PushService } from './push.service';
import { IdentityBanService } from './identity-ban.service';
import { Prisma } from '@prisma/client';
import { VerificationLimitsService } from './verification-limits.service';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { disconnectUserSockets } from '../socket';
import { HttpError } from '../utils/httpError';
import { StoryVisibilityService } from './story-visibility.service';
import { STAFF_ROLES } from '../middlewares/adminGuard.middleware';
import { reasonPriority } from './report-reasons';

type Priority = 'normal' | 'high' | 'urgent';
const PRIORITY_RANK: Record<Priority, number> = { normal: 1, high: 2, urgent: 3 };

/** "Under 18", however the app words it. */
export function isUnderAgeReason(reason: string) {
  return /under\s*-?\s*18|underage|minor/i.test(reason);
}

export class SafetyService {
  private static readonly AUTO_HIDE_THRESHOLD = 3;

  /**
   * File a report against a user.
   * After filing, checks if the reported user has >= 3 pending reports → auto-hides.
   */
  static async fileReport(
    reporterId: string,
    data: { reportedUserId: string; matchId?: string; reason: string; description?: string; sourceType?: 'profile' | 'message' | 'story' | 'rose'; sourceId?: string }
  ) {
    if (reporterId === data.reportedUserId) {
      throw new HttpError(400, 'You cannot report your own account', 'INVALID_REPORT');
    }
    if (data.matchId) {
      const match = await prisma.match.findFirst({
        where: {
          id: data.matchId,
          OR: [
            { user1Id: reporterId, user2Id: data.reportedUserId },
            { user1Id: data.reportedUserId, user2Id: reporterId },
          ],
        },
        select: { id: true },
      });
      if (!match) throw new HttpError(404, 'Report context is unavailable', 'REPORT_CONTEXT_UNAVAILABLE');
    } else {
      const target = await prisma.user.findUnique({ where: { id: data.reportedUserId }, select: { id: true } });
      if (!target) throw new HttpError(404, 'Report context is unavailable', 'REPORT_CONTEXT_UNAVAILABLE');
    }

    let evidenceSnapshot: Record<string, unknown> | undefined;
    if (data.sourceType === 'message') {
      if (!data.sourceId || !data.matchId) throw new HttpError(400, 'Message report context is incomplete', 'REPORT_CONTEXT_INVALID');
      const message = await prisma.message.findFirst({ where: { id: data.sourceId, matchId: data.matchId, senderId: data.reportedUserId }, select: { id: true, content: true, mediaKeys: true, sentAt: true, revision: true } });
      if (!message) throw new HttpError(404, 'Report context is unavailable', 'REPORT_CONTEXT_UNAVAILABLE');
      evidenceSnapshot = { content: message.content, mediaKeys: message.mediaKeys, sentAt: message.sentAt.toISOString(), revision: message.revision };
    }
    if (data.sourceType === 'story') {
      if (!data.sourceId) throw new HttpError(400, 'Story report context is incomplete', 'REPORT_CONTEXT_INVALID');
      const story = await prisma.story.findFirst({ where: { id: data.sourceId, ownerId: data.reportedUserId }, select: { id: true, ownerId: true, audience: true, caption: true, assetId: true, publishedAt: true, expiresAt: true, revision: true } });
      // Anyone who could see the Story may report it: followers, matches, close friends.
      const canView = story ? await StoryVisibilityService.check(reporterId, story) : false;
      if (!story || !canView) throw new HttpError(404, 'Report context is unavailable', 'REPORT_CONTEXT_UNAVAILABLE');
      evidenceSnapshot = { caption: story.caption, assetId: story.assetId, publishedAt: story.publishedAt.toISOString(), expiresAt: story.expiresAt.toISOString(), revision: story.revision };
    }

    if (data.sourceType === 'rose') {
      // Only the recipient of a Rose can report its note (STANDOUTS_LIKES_SPEC.md 4.5).
      if (!data.sourceId) throw new HttpError(400, 'Rose report context is incomplete', 'REPORT_CONTEXT_INVALID');
      const rose = await prisma.rose.findFirst({
        where: { id: data.sourceId, senderId: data.reportedUserId, recipientId: reporterId },
        select: { id: true, comment: true, createdAt: true },
      });
      if (!rose) throw new HttpError(404, 'Report context is unavailable', 'REPORT_CONTEXT_UNAVAILABLE');
      evidenceSnapshot = { comment: rose.comment, sentAt: rose.createdAt.toISOString() };
    }

    // Every report keeps the profile as it was (name, bio, photos), so changing
    // them afterwards doesn't erase what was reported.
    const profile = await prisma.user.findUnique({
      where: { id: data.reportedUserId },
      select: { name: true, preferences: true, photos: { orderBy: { order: 'asc' }, select: { photoUrl: true } } },
    });
    if (profile) {
      const bio = (profile.preferences as { bio?: string } | null)?.bio ?? null;
      evidenceSnapshot = { ...(evidenceSnapshot ?? {}), profile: { name: profile.name, bio, photos: profile.photos.map((photo) => photo.photoUrl) } };
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const lockKey = `${reporterId}:${data.reportedUserId}:${data.sourceType ?? 'profile'}:${data.sourceId ?? data.matchId ?? 'profile'}:${data.reason.trim().toLowerCase()}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const existing = await tx.safetyReport.findFirst({
        where: {
          reporterId,
          reportedUserId: data.reportedUserId,
          matchId: data.matchId ?? null,
          sourceType: data.sourceType ?? (data.matchId ? 'message' : 'profile'),
          sourceId: data.sourceId ?? null,
          reason: data.reason,
          status: 'pending',
        },
      });
      const moderationCase = await tx.moderationCase.findFirst({
        where: { subjectUserId: data.reportedUserId, status: { in: ['open', 'restricted'] } },
        orderBy: { createdAt: 'asc' },
      }) ?? await tx.moderationCase.create({
        data: { subjectUserId: data.reportedUserId },
      });
      const report = existing
        ? (existing.moderationCaseId ? existing : await tx.safetyReport.update({
            where: { id: existing.id }, data: { moderationCaseId: moderationCase.id },
          }))
        : await tx.safetyReport.create({
        data: {
          reporterId,
          reportedUserId: data.reportedUserId,
          matchId: data.matchId,
          reason: data.reason,
          description: data.description,
          sourceType: data.sourceType ?? (data.matchId ? 'message' : 'profile'),
          sourceId: data.sourceId,
          evidenceSnapshot: evidenceSnapshot as any,
          moderationCaseId: moderationCase.id,
        },
          });
      // Reviewed first (GOOGLE_SIGNUP_PLAN.md 6.2, 6.3): "Under 18" above
      // everything, then reports about an account that never verified a college.
      // Then the reason's own urgency (report-reasons.ts): harm, intimate images
      // and self-harm are urgent too; an unverified account lifts a normal one.
      const byReason = reasonPriority(data.reason);
      const wanted = isUnderAgeReason(data.reason) ? 'urgent'
        : byReason !== 'normal' ? byReason
        : (await VerificationLimitsService.isLimited(data.reportedUserId, tx)) ? 'high' : 'normal';
      if (PRIORITY_RANK[wanted] > PRIORITY_RANK[moderationCase.priority as Priority] ) {
        await tx.moderationCase.update({ where: { id: moderationCase.id }, data: { priority: wanted } });
      }
      const reporters = await tx.safetyReport.groupBy({
        by: ['reporterId'],
        where: { reportedUserId: data.reportedUserId, status: 'pending' },
      });
      // Hidden at once when someone may be under 18 (ADMIN_PANEL_PLAN.md): the
      // team looks first, and restores the account if the report was wrong.
      const shouldHide = reporters.length >= this.AUTO_HIDE_THRESHOLD || isUnderAgeReason(data.reason);
      if (shouldHide) {
        await tx.user.update({
          where: { id: data.reportedUserId },
          data: { accountStatus: 'restricted', sessionVersion: { increment: 1 } },
        });
        await tx.moderationCase.update({
          where: { id: moderationCase.id },
          // Never lowers an "Under 18" case.
          data: { status: 'restricted', priority: wanted === 'urgent' || moderationCase.priority === 'urgent' ? 'urgent' : 'high', restrictionAppliedAt: new Date() },
        });
        await tx.userSession.deleteMany({ where: { userId: data.reportedUserId } });
      }
      return { report, reportCount: reporters.length, shouldHide };
    });

    if (outcome.shouldHide) {
      disconnectUserSockets(data.reportedUserId);
      logger.warn(isUnderAgeReason(data.reason)
        ? '[SAFETY] Account hidden after an under-18 report'
        : `[SAFETY] Account auto-hidden after ${outcome.reportCount} distinct reporters`);
    }

    return outcome.report;
  }

  /**
   * Get reports, optionally filtered by status.
   */
  static async getReports(status?: string, page: number = 1, limit: number = 50) {
    const where = status ? { status } : {};

    const [reports, total] = await Promise.all([
      prisma.safetyReport.findMany({
        where,
        include: {
          reportedUser: { select: { id: true, name: true, email: true, accountStatus: true } },
          reporter: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.safetyReport.count({ where }),
    ]);

    return { reports, total, page, limit };
  }

  /**
   * Resolve a report with an action (reviewed, resolved, dismissed).
   * Optionally ban the reported user.
   */
  static async resolveReport(reportId: string, action: string, banUser: boolean = false) {
    const report = await prisma.safetyReport.update({
      where: { id: reportId },
      data: { status: action },
    });
    if (action === 'resolved' || action === 'dismissed') {
      void this.tellReporters([report.reporterId], action === 'resolved' || banUser);
    }

    if (banUser) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: report.reportedUserId },
          data: { accountStatus: 'banned', sessionVersion: { increment: 1 } },
        });
        await tx.userSession.deleteMany({ where: { userId: report.reportedUserId } });
        // Their Google account, emails, college email and phone can't sign up again (GOOGLE_SIGNUP_PLAN.md 6.1).
        await IdentityBanService.recordBan(report.reportedUserId, report.reason ?? undefined, tx);
      });
      disconnectUserSockets(report.reportedUserId);
      await PushService.forgetDevices(report.reportedUserId).catch(() => undefined);

      // Also resolve all other pending reports for this user
      await prisma.safetyReport.updateMany({
        where: {
          reportedUserId: report.reportedUserId,
          status: 'pending',
        },
        data: { status: 'resolved' },
      });

      logger.warn('[SAFETY] Account banned by admin action');
    }

    if (report.moderationCaseId) {
      const pending = await prisma.safetyReport.count({
        where: { moderationCaseId: report.moderationCaseId, status: 'pending' },
      });
      if (pending === 0 || banUser) {
        await prisma.moderationCase.update({
          where: { id: report.moderationCaseId },
          data: {
            status: 'resolved',
            resolution: banUser ? 'Account banned' : action,
            resolvedAt: new Date(),
          },
        });
      }
    }

    return report;
  }

  /**
   * Get report count for a specific user.
   */
  static async getReportCountByUser(userId: string) {
    const [pending, total] = await Promise.all([
      prisma.safetyReport.count({ where: { reportedUserId: userId, status: 'pending' } }),
      prisma.safetyReport.count({ where: { reportedUserId: userId } }),
    ]);
    return { pending, total };
  }

  static async getCases(status?: string, page = 1, limit = 50) {
    const where = status ? { status } : {};
    // Priority by rank, not by its letters: "normal" sorted above "high" before.
    const ordered = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM moderation_cases
      WHERE ${status ? Prisma.sql`status = ${status}` : Prisma.sql`TRUE`}
      ORDER BY CASE priority WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 ELSE 1 END DESC, created_at ASC
      OFFSET ${(page - 1) * limit} LIMIT ${limit}`;
    const [found, total] = await Promise.all([
      prisma.moderationCase.findMany({ where: { id: { in: ordered.map((row) => row.id) } } }),
      prisma.moderationCase.count({ where }),
    ]);
    const cases = ordered.map((row) => found.find((item) => item.id === row.id)!).filter(Boolean);
    const caseIds = cases.map((item) => item.id);
    const reports = caseIds.length ? await prisma.safetyReport.findMany({
      where: { moderationCaseId: { in: caseIds } },
      orderBy: { createdAt: 'asc' },
    }) : [];
    return {
      cases: cases.map((item) => ({ ...item, reports: reports.filter((report) => report.moderationCaseId === item.id) })),
      total,
      page,
      limit,
    };
  }

  static async updateCase(
    caseId: string,
    adminId: string,
    input: {
      status?: 'open' | 'reviewing' | 'resolved' | 'dismissed';
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      assignedAdminId?: string | null;
      accountAction?: 'none' | 'restrict' | 'ban' | 'restore';
      resolution?: string;
    },
  ) {
    let disconnectId: string | null = null;
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM moderation_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
      const current = await tx.moderationCase.findUnique({ where: { id: caseId } });
      if (!current) throw new HttpError(404, 'Moderation case is unavailable', 'MODERATION_CASE_UNAVAILABLE');
      const assignee = input.assignedAdminId === undefined ? undefined : input.assignedAdminId;
      if (assignee) {
        const admin = await tx.user.findFirst({ where: { id: assignee, role: { in: [...STAFF_ROLES] }, accountStatus: 'active' }, select: { id: true } });
        if (!admin) throw new HttpError(400, 'Assigned administrator is unavailable', 'ADMIN_UNAVAILABLE');
      }
      const accountAction = input.accountAction ?? 'none';
      if (accountAction !== 'none') {
        const subject = await tx.user.findUnique({ where: { id: current.subjectUserId }, select: { accountStatus: true } });
        if (!subject) throw new HttpError(404, 'Reported account is unavailable', 'ACCOUNT_UNAVAILABLE');
        const nextStatus = accountAction === 'ban' ? 'banned' : accountAction === 'restrict' ? 'restricted' : 'active';
        if (accountAction === 'restore' && subject.accountStatus === 'banned') {
          throw new HttpError(409, 'A banned account needs a separate appeal decision', 'BANNED_ACCOUNT_RESTORE_DENIED');
        }
        await tx.user.update({
          where: { id: current.subjectUserId },
          data: { accountStatus: nextStatus, sessionVersion: { increment: 1 }, eligibilityVersion: { increment: 1 } },
        });
        await tx.userSession.updateMany({
          where: { userId: current.subjectUserId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: `MODERATION_${accountAction.toUpperCase()}` },
        });
        // A ban from a case keeps them out like a ban from a report: their
        // Google account, emails, college email and phone can't sign up again.
        if (accountAction === 'ban') await IdentityBanService.recordBan(current.subjectUserId, input.resolution ?? 'moderation case', tx);
        disconnectId = current.subjectUserId;
      }
      const terminal = input.status === 'resolved' || input.status === 'dismissed';
      const updated = await tx.moderationCase.update({
        where: { id: caseId },
        data: {
          status: input.status,
          priority: input.priority,
          assignedAdminId: assignee,
          resolution: input.resolution,
          resolvedAt: terminal ? new Date() : input.status ? null : undefined,
          restrictionAppliedAt: accountAction === 'restrict' ? new Date() : undefined,
        },
      });
      if (terminal) {
        await tx.safetyReport.updateMany({
          where: { moderationCaseId: caseId, status: 'pending' },
          data: { status: input.status === 'dismissed' ? 'dismissed' : 'resolved' },
        });
      }
      return updated;
    });
    if (disconnectId) disconnectUserSockets(disconnectId);
    if (disconnectId && input.accountAction === 'ban') await PushService.forgetDevices(disconnectId).catch(() => undefined);
    if (input.status === 'resolved' || input.status === 'dismissed') {
      const reporters = await prisma.safetyReport.findMany({ where: { moderationCaseId: caseId }, select: { reporterId: true }, distinct: ['reporterId'] });
      void this.tellReporters(reporters.map((row) => row.reporterId), input.status === 'resolved');
    }
    logger.info(`[SAFETY] Moderation case updated by admin ${adminId}`);
    return result;
  }

  /**
   * People you can still report after the chat is gone (docs/SAFETY_AND_LEGAL.md 2.2):
   * matches that ended either way, people you blocked, and people who blocked
   * you - so a block never stops someone from reporting what happened.
   */
  static async reportable(userId: string) {
    const since = new Date(Date.now() - 365 * 24 * 60 * 60_000);
    const [ended, blocked, blockedBy] = await Promise.all([
      prisma.match.findMany({
        where: { status: { not: 'active' }, createdAt: { gte: since }, OR: [{ user1Id: userId }, { user2Id: userId }] },
        select: { id: true, user1Id: true, user2Id: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100,
      }),
      prisma.userBlock.findMany({ where: { blockerId: userId }, select: { blockedId: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.userBlock.findMany({ where: { blockedId: userId }, select: { blockerId: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    const why = new Map<string, { how: 'unmatched' | 'blocked' | 'blocked_you'; at: Date; matchId?: string }>();
    for (const row of blocked) why.set(row.blockedId, { how: 'blocked', at: row.createdAt });
    for (const row of blockedBy) if (!why.has(row.blockerId)) why.set(row.blockerId, { how: 'blocked_you', at: row.createdAt });
    for (const row of ended) {
      const other = row.user1Id === userId ? row.user2Id : row.user1Id;
      if (!why.has(other)) why.set(other, { how: 'unmatched', at: row.createdAt, matchId: row.id });
    }
    const people = await prisma.user.findMany({
      where: { id: { in: [...why.keys()] }, accountStatus: { not: 'deleted' } },
      select: { id: true, name: true, photos: { orderBy: { order: 'asc' }, take: 1, select: { photoUrl: true } } },
    });
    return people.map((person) => {
      const reason = why.get(person.id)!;
      // Someone who blocked you: name only - their photos stay private to you.
      return { id: person.id, name: person.name, photo: reason.how === 'blocked_you' ? null : person.photos[0]?.photoUrl ?? null, how: reason.how, at: reason.at, matchId: reason.matchId ?? null };
    }).sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  /**
   * N22 (NOTIFICATIONS_PLAN.md 3d): the people who reported hear that it was
   * looked at - never what happened to the other account.
   */
  private static async tellReporters(reporterIds: string[], acted: boolean) {
    const title = acted ? 'Thanks - we acted on your report' : 'We reviewed your report';
    const body = 'Thanks for helping keep IEM Connect safe.';
    for (const userId of [...new Set(reporterIds)]) {
      try {
        const notification = await prisma.notification.create({ data: { userId, type: 'system', title, body } });
        await PushService.send(userId, {
          title, body, category: 'account_security', kind: 'report_outcome', notificationId: notification.id,
          data: { url: 'iemdating://notifications' },
        });
      } catch (error) {
        logger.warn(`[SAFETY] report outcome not sent: ${(error as Error).message}`);
      }
    }
  }
}
