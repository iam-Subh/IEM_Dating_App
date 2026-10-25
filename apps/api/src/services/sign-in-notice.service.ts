import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { PushService } from './push.service';

/**
 * N20 (apps/mobile/src/features/notifications/NOTIFICATIONS_PLAN.md 3d): a sign-in on a new
 * phone tells the person's other signed-in phones - "It was me" / "Not me".
 * Account and security: it can't be switched off. The first sign-in of an
 * account has no other phone to tell, so it says nothing.
 */
export class SignInNoticeService {
  static async afterSignIn(userId: string, familyId: string, deviceInfo: unknown) {
    try {
      const others = await prisma.userSession.count({
        where: { userId, familyId: { not: familyId }, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!others) return;
      const title = `New sign-in on ${this.deviceName(deviceInfo)}`;
      const body = 'Not you? Tap to secure your account.';
      const notification = await prisma.notification.create({
        data: { userId, type: 'system', title, body, data: { kind: 'signin', familyId }, actionUrl: '/settings/sessions' },
      });
      await PushService.send(userId, {
        title, body, category: 'account_security', kind: 'signin', notificationId: notification.id,
        data: { url: 'iemdating://settings/sessions', familyId },
      });
    } catch (error) {
      logger.warn(`[SIGN-IN] notice failed: ${(error as Error).message}`);
    }
  }

  /** "a Vivo phone", "a Samsung Galaxy S23" - from the app's X-Device-Info, never the IP. */
  static deviceName(deviceInfo: unknown) {
    const info = (deviceInfo && typeof deviceInfo === 'object' ? deviceInfo : {}) as Record<string, unknown>;
    const brand = typeof info.brand === 'string' ? info.brand.trim() : '';
    const model = typeof info.model === 'string' ? info.model.trim() : '';
    const name = [brand, model && !model.toLowerCase().startsWith(brand.toLowerCase()) ? model : ''].filter(Boolean).join(' ')
      || (typeof info.platform === 'string' ? `${info.platform} phone` : '');
    return name ? `a ${name.slice(0, 60)}` : 'another phone';
  }
}
