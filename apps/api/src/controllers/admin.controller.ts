import { AlgorithmMetricsService } from "../services/algorithm-metrics.service";
import { DiscoveryTelemetry } from "../services/discovery-telemetry.service";
import { DISCOVERY_EXPERIMENT_KEY } from "../services/deck.service";
import { ShadowService } from '../services/shadow.service';
import { AlgorithmConfigService } from '../services/algorithm-config.service';
import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { prisma } from '../utils/prisma';

/**
 * Admin Controller — Provides endpoints for monitoring algorithm performance,
 * managing users, and tuning algorithm weights.
 */
export class AdminController {

  /**
   * GET /admin/metrics/overview
   * Returns high-level platform metrics: total users, matches, swipes, DAU estimate.
   */
  static async getOverview(_req: Request, res: Response, next: NextFunction) {
    try {
      const [totalUsers, activeUsers, totalMatches, totalSwipes, totalMessages] = await Promise.all([
        prisma.user.count({ where: { accountStatus: 'active' } }),
        prisma.user.count({
          where: {
            accountStatus: 'active',
            lastActiveAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.match.count({ where: { status: 'active' } }),
        prisma.swipe.count(),
        prisma.message.count(),
      ]);

      const totalLikes = await prisma.swipe.count({ where: { action: 'like' } });
      const matchRate = totalLikes > 0 ? ((totalMatches / totalLikes) * 100).toFixed(1) : '0';

      res.status(200).json(ApiResponse.success({
        totalUsers,
        activeUsersToday: activeUsers,
        totalMatches,
        totalSwipes,
        totalMessages,
        totalLikes,
        matchRate: `${matchRate}%`,
      }));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /admin/metrics/algorithm
   * Returns algorithm performance: weight configuration and score distribution.
   */
  static async getAlgorithmMetrics(_req: Request, res: Response, next: NextFunction) {
    try {
      const since = new Date(Date.now() - 7 * 86400000);
      const [config, delivery, visibility, confirmedUsers, lastReport, measurement] = await Promise.all([
        AlgorithmConfigService.get(),
        prisma.discoveryReceipt.groupBy({ by:['algorithm'], where:{deliveredAt:{gte:since}}, _count:true }),
        prisma.discoveryReceipt.groupBy({ by:['algorithm'], where:{visibleAt:{gte:since}}, _count:true }),
        prisma.user.count({where:{preferencesConfirmedAt:{not:null}}}),
        prisma.analyticsEvent.findFirst({where:{eventType:'shadow_report'},orderBy:{createdAt:'desc'},select:{createdAt:true,eventData:true}}),
        AlgorithmMetricsService.read(),
      ]);
      res.json(ApiResponse.success({ config, delivery, visibility, confirmedUsers, lastReport, measurement, telemetryWorker: DiscoveryTelemetry.status(), experimentKey: DISCOVERY_EXPERIMENT_KEY, shadowWorker:ShadowService.status(), experimentScope: 'rebuilt_scoring_policy_on_vs_off', algorithmLabels: { '0': 'policy_off', '1': 'policy_on' }, legacyBaseline: false }));

    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /admin/algorithm/weights
   * Update algorithm weights without redeployment.
   * Supply supported weights that sum to one after merging, and a change reason.
   */
  static async updateWeights(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await AlgorithmConfigService.update((req as any).user.sub, req.body.weights, 'weights', req.body.reason);
      res.json(ApiResponse.success(result));
    } catch (error) { next(error); }
  }
  static async updateFlags(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await AlgorithmConfigService.update((req as any).user.sub, req.body.flags, 'flags', req.body.reason);
      res.json(ApiResponse.success(result));
    } catch (error) { next(error); }
  }
  static async getConfig(_req: Request, res: Response, next: NextFunction) {
    try { res.json(ApiResponse.success(await AlgorithmConfigService.get())); }
    catch (error) { next(error); }
  }

  /**
   * GET /admin/users/reported
   * Returns users with pending safety reports.
   */
  static async getReportedUsers(_req: Request, res: Response, next: NextFunction) {
    try {
      const reports = await prisma.safetyReport.findMany({
        where: { status: 'pending' },
        include: {
          reportedUser: { select: { id: true, name: true, email: true, accountStatus: true } },
          reporter: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      // Count reports per user
      const reportCounts: Record<string, number> = {};
      reports.forEach((r) => {
        reportCounts[r.reportedUserId] = (reportCounts[r.reportedUserId] || 0) + 1;
      });

      res.status(200).json(ApiResponse.success({
        pendingReports: reports.length,
        reports: reports.map((r) => ({
          reportId: r.id,
          reportedUser: r.reportedUser,
          reporter: r.reporter,
          reason: r.reason,
          description: r.description,
          totalReportsOnUser: reportCounts[r.reportedUserId],
          createdAt: r.createdAt,
        })),
      }));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /admin/users/bots
   * Returns users flagged as potential bots based on swipe behavior.
   */
  static async getBotUsers(_req: Request, res: Response, next: NextFunction) {
    try {
      const users = await prisma.$queryRaw<{swiper_id:string;count:bigint}[]>`
        SELECT swiper_id,count(*) AS count FROM swipes WHERE created_at >= now()-interval '1 minute'
        GROUP BY swiper_id HAVING count(*) > 60 ORDER BY count(*) DESC LIMIT 50`;
      res.json(ApiResponse.success({ totalSuspects: users.length,
        suspects: users.map(u => ({ userId:u.swiper_id,swipesLastMinute:Number(u.count) })),
        note:'High swipe activity is a review signal. It does not establish a bot or hide a profile.' }));

    } catch (error) {
      next(error);
    }
  }
}
