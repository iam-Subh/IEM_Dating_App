import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { pushDecision, type PushCategory } from './app-settings.service';
import { BUTTONS_OF_KIND, CHANNEL_OF_KIND, PUSH_POLICY, quietHoursEnd } from './push-policy.service';
import { encryptForPhone, openPhoneKey, parsePhoneKey, sealPhoneKey } from './push-crypto.service';

/** Android's silent channel for chat messages in quiet hours (app: channels.ts QUIET_CHANNEL). */
const QUIET_CHANNEL = 'quiet_hours';

export type PushMessage = {
  title: string;
  body: string;
  data: Record<string, string>;
  /** Which App settings switch controls this push. */
  category: PushCategory;
  /** What it is ('message', 'match', 'standouts'...): picks the buttons and is logged. Defaults to data.kind, then the category. */
  kind?: string;
  /** Which version of a line was used (push-policy.service.ts LINES), for the open rates. */
  template?: string;
  /** The row in the Notifications page, if there is one. */
  notificationId?: string;
  /** A big picture (Android) / attachment (iOS). */
  image?: string;
  /**
   * For phones that draw chat notifications themselves (capability "chat_v2",
   * MESSAGE_NOTIFICATIONS_PLAN.md 3): sent to them as data only, while other
   * phones get title and body as usual.
   */
  native?: Record<string, unknown>;
};

type ExpoTicket = { id?: string; status?: string; message?: string; details?: { error?: string } };

/** Accounts that get nothing but account and security notices. */
const SILENCED = new Set(['banned', 'deleted']);

/**
 * Data for a phone that draws chats itself and gave us its key: encrypted,
 * so Google's servers see only `{ type: "enc", iv, ct }` (MESSAGE_NOTIFICATIONS_PLAN.md 11).
 */
function sealFor(device: { capabilities: string[]; pushKey: string | null }, data: Record<string, unknown>): Record<string, unknown> {
  if (!device.capabilities.includes('chat_v2')) return data;
  const key = openPhoneKey(device.pushKey);
  return key ? encryptForPhone(key, fitForPush(data)) : data;
}

/**
 * A push carries at most 4 KB, and encryption adds a third: long text is cut
 * further, then the picture link dropped - the message itself is in the app.
 */
const PLAIN_BUDGET = 2700;
function fitForPush(data: Record<string, unknown>): Record<string, unknown> {
  const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (size(data) <= PLAIN_BUDGET) return data;
  let fitted: Record<string, unknown> = typeof data.text === 'string' ? { ...data, text: `${data.text.slice(0, 160)}…` } : data;
  if (size(fitted) > PLAIN_BUDGET && fitted.media && typeof fitted.media === 'object') {
    const { thumb: _thumb, ...media } = fitted.media as Record<string, unknown>;
    fitted = { ...fitted, media };
  }
  if (size(fitted) > PLAIN_BUDGET && fitted.sender && typeof fitted.sender === 'object') {
    const { avatar: _avatar, ...sender } = fitted.sender as Record<string, unknown>;
    fitted = { ...fitted, sender };
  }
  return fitted;
}

const endpoint = () => process.env.EXPO_PUSH_ENDPOINT || 'https://exp.host/--/api/v2/push/send';
function headers() {
  const value: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (process.env.EXPO_ACCESS_TOKEN) value.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  return value;
}

/**
 * Pushes to a person's phones (apps/mobile/src/features/notifications/NOTIFICATIONS_PLAN.md 2).
 * Every push passes the same checks: the account, the person's switches,
 * quiet hours (held in push_queue until the morning), then goes out on its
 * own Android channel with its buttons, priority and expiry, and is logged
 * so opens can be counted.
 */
export class PushService {
  static async send(userId: string, message: PushMessage, outboxEventId?: string, options: { fromQueue?: boolean; now?: Date } = {}): Promise<void> {
    const now = options.now ?? new Date();
    const owner = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPrefs: true, notifyLikes: true, accountStatus: true },
    });
    if (!owner) return;
    const accountOnly = SILENCED.has(owner.accountStatus) || await this.underAgeReview(userId);
    if (accountOnly && message.category !== 'account_security') return;
    // Switched off (or everything paused) in App settings: the phone stays quiet.
    const decision = pushDecision(owner, message.category, now);
    if (!decision) return;
    // A chat message is never held till morning: it arrives silently instead,
    // so it's there when they wake up (MESSAGE_NOTIFICATIONS_PLAN.md 10).
    const silent = !!message.native && decision.waitForMorning;
    if (decision.waitForMorning && !options.fromQueue && !message.native) {
      await this.holdForMorning(userId, message, now, outboxEventId);
      return;
    }
    let devices = await prisma.deviceToken.findMany({ where: { userId }, select: { id: true, token: true, capabilities: true, pushKey: true } });
    if (!devices.length) return;

    if (outboxEventId) {
      const completed = await prisma.deliveryAttempt.findMany({
        where: { outboxEventId, channel: 'push', deviceId: { in: devices.map((device) => device.id) }, status: 'sent' },
        select: { deviceId: true },
      });
      const completedIds = new Set(completed.map((item) => item.deviceId));
      devices = devices.filter((device) => !completedIds.has(device.id));
      if (!devices.length) return;
      await Promise.all(devices.map((device) => prisma.deliveryAttempt.upsert({
        where: { outboxEventId_channel_deviceId: { outboxEventId, channel: 'push', deviceId: device.id } },
        create: { outboxEventId, channel: 'push', deviceId: device.id, attempts: 1, status: 'sending' },
        update: { attempts: { increment: 1 }, status: 'sending', lastError: null },
      })));
    }

    const kind = message.kind ?? message.data.kind ?? message.category;
    const policy = PUSH_POLICY[message.category];
    const log = await this.log(userId, message, kind, now, outboxEventId);
    const buttons = BUTTONS_OF_KIND[kind];
    let response: Response;
    try {
      response = await fetch(endpoint(), {
        method: 'POST', headers: headers(),
        body: JSON.stringify(devices.map((device) => (message.native && device.capabilities.includes('chat_v2') ? {
          // Data only: the phone draws the notification itself.
          to: device.token,
          priority: policy.priority,
          ttl: policy.ttl,
          data: sealFor(device, {
            // The payload's own kind (voice, photo...) must win over the push's
            // kind ("message"), or the phone draws a voice note as its raw text.
            category: message.category,
            ...message.native,
            userId, pushId: log.id,
            ...(message.notificationId ? { notificationId: message.notificationId } : {}),
            ...(silent ? { silent: true } : {}),
          }),
        } : {
          to: device.token,
          // iOS: the Sound switch. Android: the channel's own settings.
          sound: decision.sound && !silent ? 'default' : null,
          // Quiet hours for a chat message: the app's silent channel (channels.ts).
          channelId: silent ? QUIET_CHANNEL : (message.kind && CHANNEL_OF_KIND[message.kind]) || decision.channelId,
          priority: policy.priority,
          ttl: policy.ttl,
          ...(buttons ? { categoryId: buttons } : {}),
          ...(message.image ? { richContent: { image: message.image } } : {}),
          title: message.title,
          body: message.body,
          data: {
            ...message.data,
            kind,
            category: message.category,
            // The app ignores a push meant for another account on this phone (10).
            userId,
            pushId: log.id,
            ...(message.notificationId ? { notificationId: message.notificationId } : {}),
            // Lets the app notice late deliveries (11).
            sentAt: new Date().toISOString(),
            priority: policy.priority,
          },
        }))),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (outboxEventId) await prisma.deliveryAttempt.updateMany({
        where: { outboxEventId, channel: 'push', deviceId: { in: devices.map((device) => device.id) } },
        data: { status: 'failed', lastError: String((error as Error).message).slice(0, 500) },
      });
      throw error;
    }
    if (!response.ok) {
      if (outboxEventId) await prisma.deliveryAttempt.updateMany({
        where: { outboxEventId, channel: 'push', deviceId: { in: devices.map((device) => device.id) } },
        data: { status: 'failed', lastError: `Push provider returned HTTP ${response.status}` },
      });
      throw new Error(`Push provider returned HTTP ${response.status}`);
    }

    const payload = await response.json() as { data?: ExpoTicket[] };
    const tickets = Array.isArray(payload.data) ? payload.data : [];
    if (outboxEventId) {
      await Promise.all(devices.map((device, index) => {
        const ticket = tickets[index];
        const sent = ticket?.status === 'ok';
        return prisma.deliveryAttempt.update({
          where: { outboxEventId_channel_deviceId: { outboxEventId, channel: 'push', deviceId: device.id } },
          data: { status: sent ? 'sent' : 'failed', providerTicket: ticket?.id, lastError: sent ? null : String(ticket?.details?.error ?? ticket?.message ?? 'Provider rejected push').slice(0, 500), completedAt: sent ? new Date() : null },
        });
      }));
    }
    await this.dropDeadTokens(devices, tickets);
    const retryableFailure = tickets.find((ticket) => ticket?.status !== 'ok' && ticket?.details?.error !== 'DeviceNotRegistered');
    if (retryableFailure) throw new Error(String(retryableFailure.details?.error ?? retryableFailure.message ?? 'Push provider rejected delivery'));
  }

  /**
   * A silent push: no alert, only data for the app's background task - today
   * "clear": take a chat's notifications off the status bar, because it was
   * read on another phone, or the match ended (NOTIFICATIONS_PLAN.md 7, 10).
   */
  static async clear(userId: string, data: { matchId: string; end?: boolean }): Promise<void> {
    const devices = await prisma.deviceToken.findMany({ where: { userId }, select: { id: true, token: true, capabilities: true, pushKey: true } });
    if (!devices.length) return;
    try {
      const response = await fetch(endpoint(), {
        method: 'POST', headers: headers(),
        body: JSON.stringify(devices.map((device) => ({
          to: device.token,
          _contentAvailable: true,
          // Normal, never high: Firebase downgrades a phone whose high-priority
          // pushes show nothing (MESSAGE_NOTIFICATIONS_PLAN.md, decisions).
          priority: 'normal',
          ttl: 24 * 3600,
          // end: the chat is over (unmatch, block) - its shortcut goes too.
          data: sealFor(device, { type: 'clear', matchId: data.matchId, userId, ...(data.end ? { end: true } : {}) }),
        }))),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const payload = await response.json() as { data?: ExpoTicket[] };
      await this.dropDeadTokens(devices, Array.isArray(payload.data) ? payload.data : []);
    } catch (error) {
      logger.warn(`[PUSH] clear failed: ${(error as Error).message}`);
    }
  }

  /**
   * Data only, to the phones that draw chat notifications themselves: edits,
   * deletes, reactions, mutes (MESSAGE_NOTIFICATIONS_PLAN.md 9). Normal
   * priority - it changes what is shown, never shows something new.
   */
  static async sendNative(userId: string, data: Record<string, unknown>, priority: 'normal' | 'high' = 'normal'): Promise<void> {
    const devices = await prisma.deviceToken.findMany({ where: { userId, capabilities: { has: 'chat_v2' } }, select: { id: true, token: true, capabilities: true, pushKey: true } });
    if (!devices.length) return;
    const response = await fetch(endpoint(), {
      method: 'POST', headers: headers(),
      body: JSON.stringify(devices.map((device) => ({ to: device.token, _contentAvailable: true, priority, ttl: 24 * 3600, data: sealFor(device, { ...data, userId }) }))),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Push provider returned HTTP ${response.status}`);
    const payload = await response.json() as { data?: ExpoTicket[] };
    await this.dropDeadTokens(devices, Array.isArray(payload.data) ? payload.data : []);
  }

  /** "Opened" from the app (NOTIFICATIONS_PLAN.md 13): a tap, or a button. */
  static async opened(userId: string, pushId: string, action?: string) {
    const { count } = await prisma.pushLog.updateMany({
      where: { id: pushId, userId, openedAt: null },
      data: { openedAt: new Date(), openedAction: action?.slice(0, 40) ?? 'open' },
    });
    return { recorded: count > 0 };
  }

  /** Sends what quiet hours held back, once morning comes (run by the engagement worker). */
  static async sendDue(now = new Date(), limit = 500, only?: string[]): Promise<number> {
    // Claimed by deleting, so two servers never send one twice.
    const due = await prisma.$queryRaw<{ user_id: string; payload: Prisma.JsonValue; expires_at: Date }[]>`
      DELETE FROM push_queue WHERE id IN (
        SELECT id FROM push_queue WHERE send_after <= ${now}
          ${only ? Prisma.sql`AND user_id = ANY(${only}::uuid[])` : Prisma.empty}
        ORDER BY send_after LIMIT ${limit} FOR UPDATE SKIP LOCKED
      ) RETURNING user_id, payload, expires_at`;
    let sent = 0;
    for (const row of due) {
      if (row.expires_at <= now) continue;
      const { message, outboxEventId } = row.payload as unknown as { message: PushMessage; outboxEventId?: string };
      try {
        await this.send(row.user_id, message, outboxEventId, { fromQueue: true, now });
        sent++;
      } catch (error) {
        logger.warn(`[PUSH] held push failed: ${(error as Error).message}`);
      }
    }
    return sent;
  }

  static async register(userId: string, token: string, platform: string, capabilities: string[] = [], phoneKey?: string): Promise<void> {
    // The phone's own push key (MESSAGE_NOTIFICATIONS_PLAN.md 11), sealed before it is stored.
    const key = capabilities.includes('chat_v2') ? parsePhoneKey(phoneKey) : null;
    const pushKey = key ? sealPhoneKey(key) : null;
    await prisma.$transaction(async (tx) => {
      await tx.deviceToken.deleteMany({ where: { token, userId: { not: userId } } });
      await tx.deviceToken.upsert({
        where: { userId_token: { userId, token } },
        create: { userId, token, platform, capabilities, pushKey },
        update: { platform, capabilities, pushKey },
      });
    });
  }

  static async unregister(userId: string, token: string): Promise<void> {
    await prisma.deviceToken.deleteMany({ where: { userId, token } });
  }

  /** Every phone of this person stops getting pushes (a ban, a deleted account). */
  static async forgetDevices(userId: string): Promise<void> {
    await prisma.deviceToken.deleteMany({ where: { userId } });
    await prisma.pushQueue.deleteMany({ where: { userId } });
  }

  /** An open "Under 18" report: only account notices until it is reviewed (NOTIFICATIONS_PLAN.md 5). */
  private static async underAgeReview(userId: string) {
    const open = await prisma.moderationCase.count({ where: { subjectUserId: userId, status: { in: ['open', 'reviewing'] }, priority: 'urgent' } });
    return open > 0;
  }

  private static async holdForMorning(userId: string, message: PushMessage, now: Date, outboxEventId?: string) {
    await prisma.pushQueue.create({
      data: {
        userId,
        payload: { message, ...(outboxEventId ? { outboxEventId } : {}) } as unknown as Prisma.InputJsonValue,
        sendAfter: quietHoursEnd(now),
        expiresAt: new Date(now.getTime() + PUSH_POLICY[message.category].ttl * 1000),
      },
    });
  }

  private static async log(userId: string, message: PushMessage, kind: string, now: Date, outboxEventId?: string) {
    const data = {
      userId,
      sentAt: now,
      category: message.category,
      kind: kind.slice(0, 60),
      template: message.template?.slice(0, 80) ?? null,
      spicy: !!PUSH_POLICY[message.category].spicy,
      notificationId: message.notificationId ?? null,
    };
    if (!outboxEventId) return prisma.pushLog.create({ data, select: { id: true } });
    // A retried outbox delivery reuses its row.
    return prisma.pushLog.upsert({
      where: { dedupeKey: `${outboxEventId}:${userId}` },
      create: { ...data, dedupeKey: `${outboxEventId}:${userId}` },
      update: {},
      select: { id: true },
    });
  }

  private static async dropDeadTokens(devices: { id: string }[], tickets: ExpoTicket[]) {
    const invalidIds = devices
      .filter((_, index) => tickets[index]?.details?.error === 'DeviceNotRegistered')
      .map((device) => device.id);
    if (invalidIds.length) await prisma.deviceToken.deleteMany({ where: { id: { in: invalidIds } } });
  }
}
