import { createHmac } from 'crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { logger } from '../utils/logger';

/**
 * Keeping banned people from coming back (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md 6.1).
 *
 * - A ban records the person's identities - their Google account, every
 *   email on the account, their college email, the device they signed up on
 *   - as keyed hashes (never the values), and every sign-up checks them. The
 *   college email is the strongest: each student has one, so a banned
 *   student never gets the badge again.
 * - At most two Google sign-ups per device (by its Android ID): Gmail
 *   accounts are free, devices are not. College-email sign-ups are not
 *   counted - they are verified anyway.
 *
 * Play Integrity "device recall" (kept through a factory reset) and iOS
 * DeviceCheck add to this once the app is on the Play Store / App Store.
 */

export type IdentityKind = 'google_sub' | 'email' | 'college_email' | 'android_id';

/** Google sign-ups allowed per device. */
export const GOOGLE_SIGNUPS_PER_DEVICE = 2;

function secret() {
  const value = process.env.IDENTITY_HASH_SECRET || process.env.JWT_REFRESH_SECRET;
  if (!value) throw new Error('IDENTITY_HASH_SECRET (or JWT_REFRESH_SECRET) is required');
  return value;
}

export function identityHash(kind: IdentityKind, value: string) {
  return createHmac('sha256', secret()).update(`${kind}:${value.trim().toLowerCase()}`).digest('hex');
}

/** The Android ID the app sends in `X-Device-Info` (not stored on sessions). */
export function androidIdFrom(req: Request): string | null {
  const raw = req.headers['x-device-info'];
  if (typeof raw !== 'string' || raw.length > 1000) return null;
  try {
    const value = (JSON.parse(raw) as Record<string, unknown>).androidId;
    return typeof value === 'string' && /^[0-9a-f]{8,32}$/i.test(value) ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

export class IdentityBanService {
  /** Records every identity of a banned account. Safe to call twice. */
  static async recordBan(userId: string, reason?: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        email: true, googleSub: true, googleEmail: true, signupAndroidId: true,
        studentMembership: { select: { institutionalEmail: true } },
      },
    });
    if (!user) return 0;
    const entries: Array<[IdentityKind, string | null | undefined]> = [
      ['google_sub', user.googleSub],
      ['email', user.email],
      ['email', user.googleEmail],
      ['college_email', user.studentMembership?.institutionalEmail],
      ['android_id', user.signupAndroidId],
    ];
    const rows = entries
      .filter((entry): entry is [IdentityKind, string] => !!entry[1])
      .map(([kind, value]) => ({ kind, valueHash: identityHash(kind, value), userId, reason: reason?.slice(0, 200) ?? null }));
    if (!rows.length) return 0;
    const result = await db.bannedIdentifier.createMany({ data: rows, skipDuplicates: true });
    logger.warn(`[SAFETY] ${result.count} identities recorded for a banned account`);
    return result.count;
  }

  /** Refuses a sign-up or verification that uses a banned identity. */
  static async assertNotBanned(identities: { googleSub?: string | null; emails?: Array<string | null | undefined>; collegeEmail?: string | null; androidId?: string | null }) {
    const checks: Array<{ kind: IdentityKind; valueHash: string }> = [];
    if (identities.googleSub) checks.push({ kind: 'google_sub', valueHash: identityHash('google_sub', identities.googleSub) });
    for (const email of identities.emails ?? []) {
      if (!email) continue;
      // An email may have been banned as a sign-in email or as a college email.
      checks.push({ kind: 'email', valueHash: identityHash('email', email) });
      checks.push({ kind: 'college_email', valueHash: identityHash('college_email', email) });
    }
    if (identities.collegeEmail) {
      checks.push({ kind: 'college_email', valueHash: identityHash('college_email', identities.collegeEmail) });
      checks.push({ kind: 'email', valueHash: identityHash('email', identities.collegeEmail) });
    }
    if (identities.androidId) checks.push({ kind: 'android_id', valueHash: identityHash('android_id', identities.androidId) });
    if (!checks.length) return;
    const hit = await prisma.bannedIdentifier.findFirst({ where: { OR: checks }, select: { id: true } });
    if (hit) {
      throw new HttpError(403, "This account can't be created. If you think this is a mistake, write to support.", 'IDENTITY_BANNED');
    }
  }

  /** At most two Google sign-ups per device (6.1). */
  static async assertDeviceAllowsGoogleSignup(androidId: string | null) {
    if (!androidId) return;
    const existing = await prisma.user.count({
      where: { signupAndroidId: androidId, googleSub: { not: null }, accountStatus: { not: 'deleted' } },
    });
    if (existing >= GOOGLE_SIGNUPS_PER_DEVICE) {
      throw new HttpError(403, 'This phone already has two accounts made with Google. Sign in to one of them instead.', 'DEVICE_SIGNUP_LIMIT');
    }
  }
}
