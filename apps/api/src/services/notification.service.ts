import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { PushService } from './push.service';

/**
 * Notification Service — Persists notifications to database and
 * provides methods for reading/managing them.
 *
 * Expo push delivery uses the device tokens registered by the mobile app.
 */
export class NotificationService {

  /**
   * Send "It's a Match!" notification to a user.
   */
  static async sendMatchNotification(
    userId: string,
    matchId: string,
    otherUserName: string
  ): Promise<void> {
    try {
      await prisma.notification.create({
        data: {
          userId,
          type: 'match',
          title: "It's a Match! 🎉",
          body: `You and ${otherUserName} liked each other!`,
          data: { matchId },
          actionUrl: `/match/${matchId}`,
        },
      });
      await PushService.send(userId, {
        title: "It's a match!",
        body: `You and ${otherUserName} liked each other!`,
        data: { url: `iemdating://match/${matchId}`, matchId },
      });
      logger.info('[NOTIFICATION] Match notification queued');
    } catch (error) {
      logger.error('[NOTIFICATION] Error sending match notification:', error);
    }
  }

  /**
   * Send new message notification to a user.
   */
  static async sendMessageNotification(
    userId: string,
    matchId: string,
    senderName: string,
    messagePreview: string
  ): Promise<void> {
    try {
      const preview = messagePreview.length > 50
        ? messagePreview.slice(0, 50) + '...'
        : messagePreview;

      await prisma.notification.create({
        data: {
          userId,
          type: 'message',
          title: senderName,
          body: preview,
          data: { matchId, senderName },
          actionUrl: `/chat/${matchId}`,
        },
      });

      await PushService.send(userId, {
        title: senderName,
        body: preview,
        data: { url: `iemdating://chat/${matchId}`, matchId },
      });

    } catch (error) {
      logger.error('[NOTIFICATION] Error sending message notification:', error);
    }
  }

  /**
   * Send "Someone liked you" notification (optional — for premium users).
   */
  static async sendLikeNotification(
    userId: string,
    fromUserName: string
  ): Promise<void> {
    try {
      await prisma.notification.create({
        data: {
          userId,
          type: 'like',
          title: 'Someone likes you! 💕',
          body: `${fromUserName} liked your profile`,
          data: { fromUserName },
        },
      });
      await PushService.send(userId, {
        title: 'Someone likes you!',
        body: `${fromUserName} liked your profile`,
        data: { url: 'iemdating://main' },
      });
    } catch (error) {
      logger.error('[NOTIFICATION] Error sending like notification:', error);
    }
  }

  /**
   * Send a system notification (report resolved, account warning, etc.).
   */
  static async sendSystemNotification(
    userId: string,
    title: string,
    body: string
  ): Promise<void> {
    try {
      await prisma.notification.create({
        data: {
          userId,
          type: 'system',
          title,
          body,
        },
      });
      await PushService.send(userId, { title, body, data: { url: 'iemdating://main' } });
    } catch (error) {
      logger.error('[NOTIFICATION] Error sending system notification:', error);
    }
  }

  // ─── Read Methods ────────────────────────────────────────────────────

  /**
   * Get paginated notifications for a user.
   */
  static async getNotifications(userId: string, page: number = 1, limit: number = 20) {
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where: { userId } }),
    ]);

    return { notifications, total, page, limit };
  }

  /**
   * Mark a notification as read.
   */
  static async markAsRead(notificationId: string, userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
  }

  /**
   * Mark all notifications as read for a user.
   */
  static async markAllAsRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  /**
   * Get unread notification count (for badge).
   */
  static async getUnreadCount(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * Delete notifications older than 30 days (cleanup job).
   */
  static async deleteOldNotifications(): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await prisma.notification.deleteMany({
      where: { createdAt: { lt: thirtyDaysAgo } },
    });
    logger.info(`[NOTIFICATION] Cleaned up ${result.count} old notifications`);
    return result.count;
  }
}
