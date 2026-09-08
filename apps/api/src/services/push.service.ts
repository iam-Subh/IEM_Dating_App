import { prisma } from '../utils/prisma';

type PushMessage = {
  title: string;
  body: string;
  data: Record<string, string>;
};

type ExpoTicket = { id?: string; status?: string; message?: string; details?: { error?: string } };

export class PushService {
  static async send(userId: string, message: PushMessage, outboxEventId?: string): Promise<void> {
    let devices = await prisma.deviceToken.findMany({ where: { userId }, select: { id: true, token: true } });
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

    const endpoint = process.env.EXPO_PUSH_ENDPOINT || 'https://exp.host/--/api/v2/push/send';
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST', headers,
        body: JSON.stringify(devices.map((device) => ({ to: device.token, sound: 'default', channelId: 'default', title: message.title, body: message.body, data: message.data }))),
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
    const invalidIds = devices
      .filter((_, index) => tickets[index]?.details?.error === 'DeviceNotRegistered')
      .map((device) => device.id);
    if (invalidIds.length) await prisma.deviceToken.deleteMany({ where: { id: { in: invalidIds } } });
    const retryableFailure = tickets.find((ticket) => ticket?.status !== 'ok' && ticket?.details?.error !== 'DeviceNotRegistered');
    if (retryableFailure) throw new Error(String(retryableFailure.details?.error ?? retryableFailure.message ?? 'Push provider rejected delivery'));
  }

  static async register(userId: string, token: string, platform: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.deviceToken.deleteMany({ where: { token, userId: { not: userId } } });
      await tx.deviceToken.upsert({
        where: { userId_token: { userId, token } },
        create: { userId, token, platform },
        update: { platform },
      });
    });
  }

  static async unregister(userId: string, token: string): Promise<void> {
    await prisma.deviceToken.deleteMany({ where: { userId, token } });
  }
}
