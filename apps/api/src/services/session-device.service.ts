import type { Request } from 'express';
import { prisma } from '../utils/prisma';
import { redisClient } from '../utils/redis';
export { maskIp } from './session-network';

/**
 * What Active sessions shows about each signed-in device. The app sends its
 * details in an `X-Device-Info` header (model, OS, app version); the request
 * itself gives the network address. Written at most once every five minutes
 * per session, so it costs nothing on ordinary requests.
 */

const FIELDS = ['platform', 'osVersion', 'brand', 'model', 'deviceName', 'appVersion'] as const;
type DeviceInfo = Partial<Record<(typeof FIELDS)[number], string>> & { ip?: string };

/** Only known fields, short strings - never trust a header's shape. */
export function deviceInfoFrom(req: Request): DeviceInfo {
  const out: DeviceInfo = {};
  const raw = req.headers['x-device-info'];
  if (typeof raw === 'string' && raw.length <= 1000) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const field of FIELDS) {
        const value = parsed[field];
        if (typeof value === 'string' && value.trim()) out[field] = value.trim().slice(0, 80);
      }
    } catch {
      // A malformed header is just no details.
    }
  }
  const ip = (req.ip ?? '').replace(/^::ffff:/, '');
  if (ip) out.ip = ip.slice(0, 64);
  return out;
}

const TOUCH_SECONDS = 300;

/** Fire and forget from `protect`: last active, and the device details if they changed. */
export function touchSession(jti: string, req: Request) {
  void (async () => {
    try {
      const key = `session-touch:${jti}`;
      const fresh = await redisClient.set(key, '1', 'EX', TOUCH_SECONDS, 'NX');
      if (fresh !== 'OK') return;
      const info = deviceInfoFrom(req);
      const current = await prisma.userSession.findUnique({ where: { tokenJti: jti }, select: { deviceInfo: true } });
      const previous = (current?.deviceInfo ?? {}) as DeviceInfo;
      await prisma.userSession.updateMany({
        where: { tokenJti: jti, revokedAt: null },
        data: { lastUsedAt: new Date(), deviceInfo: { ...previous, ...info } },
      });
    } catch {
      // Never holds up a request.
    }
  })();
}

