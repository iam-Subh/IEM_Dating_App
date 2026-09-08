import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

/**
 * Analytics Service — Tracks events to both Winston AND database.
 * 
 * Winston provides real-time log monitoring.
 * AnalyticsEvent table provides queryable metrics for the admin dashboard.
 */
export class AnalyticsService {
  /**
   * Core method: persist event to DB + log to Winston.
   */
  private static async trackEvent(
    eventType: string,
    data: Record<string, any>,
    userId?: string
  ): Promise<void> {
    // Log to Winston (real-time)
    logger.info(`[ANALYTICS] ${eventType}`);

    // Persist to DB (queryable)
    try {
      await prisma.analyticsEvent.create({
        data: {
          eventType,
          eventData: data,
          userId: userId || null,
        },
      });
    } catch (error) {
      // Non-critical — don't crash if analytics DB write fails
      logger.error(`[ANALYTICS] Failed to persist ${eventType} event:`, error);
    }
  }

  static trackSwipe(data: {
    swiperId: string;
    targetId: string;
    action: 'like' | 'pass';
    matchCreated: boolean;
    matchId?: string;
  }): void {
    this.trackEvent('swipe', data, data.swiperId);
  }

  static trackMatch(data: {
    matchId: string;
    user1Id: string;
    user2Id: string;
    user1Score?: number;
    user2Score?: number;
    compatibilityScore?: number;
  }): void {
    this.trackEvent('match_created', data);
  }

  static trackMessage(data: {
    matchId: string;
    senderId: string;
    conversationLength?: number;
  }): void {
    this.trackEvent('message_sent', data, data.senderId);
  }


  static trackReport(data: {
    reportId: string;
    reporterId: string;
    reportedUserId: string;
    reason: string;
  }): void {
    this.trackEvent('report_filed', data, data.reporterId);
  }

  // ─── Query Methods (for Admin Dashboard) ────────────────────────────

  /**
   * Get event counts grouped by type for a date range.
   */
  static async getMetrics(startDate: Date, endDate: Date) {
    const events = await prisma.analyticsEvent.groupBy({
      by: ['eventType'],
      _count: { id: true },
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    const metrics: Record<string, number> = {};
    events.forEach((e: { eventType: string; _count: { id: number } }) => {
      metrics[e.eventType] = e._count.id;
    });
    return metrics;
  }
}
