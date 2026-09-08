import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { disconnectUserSockets } from '../socket';
import { HttpError } from '../utils/httpError';

export class SafetyService {
  private static readonly AUTO_HIDE_THRESHOLD = 3;

  /**
   * File a report against a user.
   * After filing, checks if the reported user has >= 3 pending reports → auto-hides.
   */
  static async fileReport(
    reporterId: string,
    data: { reportedUserId: string; matchId?: string; reason: string; description?: string; sourceType?: 'profile' | 'message' | 'story'; sourceId?: string }
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
      const story = await prisma.story.findFirst({ where: { id: data.sourceId, ownerId: data.reportedUserId }, select: { id: true, caption: true, assetId: true, publishedAt: true, expiresAt: true, revision: true } });
      const canView = await prisma.follow.count({ where: { followerId: reporterId, followeeId: data.reportedUserId, status: 'accepted' } });
      if (!story || !canView) throw new HttpError(404, 'Report context is unavailable', 'REPORT_CONTEXT_UNAVAILABLE');
      evidenceSnapshot = { caption: story.caption, assetId: story.assetId, publishedAt: story.publishedAt.toISOString(), expiresAt: story.expiresAt.toISOString(), revision: story.revision };
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
      const reporters = await tx.safetyReport.groupBy({
        by: ['reporterId'],
        where: { reportedUserId: data.reportedUserId, status: 'pending' },
      });
      const shouldHide = reporters.length >= this.AUTO_HIDE_THRESHOLD;
      if (shouldHide) {
        await tx.user.update({
          where: { id: data.reportedUserId },
          data: { accountStatus: 'restricted', sessionVersion: { increment: 1 } },
        });
        await tx.moderationCase.update({
          where: { id: moderationCase.id },
          data: { status: 'restricted', priority: 'high', restrictionAppliedAt: new Date() },
        });
        await tx.userSession.deleteMany({ where: { userId: data.reportedUserId } });
      }
      return { report, reportCount: reporters.length, shouldHide };
    });

    if (outcome.shouldHide) {
      disconnectUserSockets(data.reportedUserId);
      logger.warn(
        `[SAFETY] Account auto-hidden after ${outcome.reportCount} distinct reporters`
      );
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

    if (banUser) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: report.reportedUserId },
          data: { accountStatus: 'banned', sessionVersion: { increment: 1 } },
        });
        await tx.userSession.deleteMany({ where: { userId: report.reportedUserId } });
      });
      disconnectUserSockets(report.reportedUserId);

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
    const [cases, total] = await Promise.all([
      prisma.moderationCase.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.moderationCase.count({ where }),
    ]);
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
        const admin = await tx.user.findFirst({ where: { id: assignee, role: 'admin', accountStatus: 'active' }, select: { id: true } });
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
    logger.info(`[SAFETY] Moderation case updated by admin ${adminId}`);
    return result;
  }
}
