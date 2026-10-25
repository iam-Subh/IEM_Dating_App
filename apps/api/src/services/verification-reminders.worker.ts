import { prisma } from '../utils/prisma';
import { MediaModerationService } from './media-moderation.service';
import { FeedbackService } from './feedback.service';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import { PushService } from './push.service';
import { GRACE_DAYS, OWES_REAL_PERSON_SQL, realPersonEnforced } from './verification-limits.service';
import { FaceVerificationService } from './face-verification.service';

/**
 * The timed side of verifying a college (apps/mobile/src/features/auth/GOOGLE_SIGNUP_PLAN.md):
 *
 * - **Verify reminders** (4, reminder 13): a push on day 1 and day 5 after a
 *   Google sign-up - two in all, never after day 5.
 * - **Grace period** (2.6): warnings on days 10 and 13, then on day 14 the
 *   profile pauses - hidden from other people until verified.
 *
 * At most two reminders in any 7 days (REMINDER_DESIGN.md); the pause itself
 * is news, not a reminder, and always goes. Each push has a "Verify now"
 * button (push-policy.service.ts BUTTONS_OF_KIND).
 * - **Expiry** (5): reminders 30, 7 and 1 day before a verification ends.
 *
 * Runs every hour. Each step is a single UPDATE that moves a level forward
 * and returns the people it moved, so two servers running at once never send
 * the same reminder twice. Someone who missed several steps (the server was
 * down) gets only the latest - never a burst.
 *
 * Everything stops once the person verifies: verifying clears the pause and
 * the levels (student-membership.service.ts).
 */

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Never verified: no membership row has a verification date. */
const NEVER_VERIFIED = `NOT EXISTS (SELECT 1 FROM student_memberships m WHERE m.user_id = u.id AND m.verified_at IS NOT NULL)`;
/**
 * Still owes something by day 14: a college email, or - for an account made
 * with Google, once required - the real-person check (PHOTO_VERIFICATION_PLAN.md D1).
 */
const owesSql = () => (realPersonEnforced() ? `(${NEVER_VERIFIED} OR ${OWES_REAL_PERSON_SQL})` : NEVER_VERIFIED);

const VERIFY_PUSHES = [
  { level: 1, afterDays: 1, title: 'Start your blue badge', body: 'Verify your college email - step 1 of the blue badge. Unlock unlimited chat and get 5 Roses each week.' },
  { level: 2, afterDays: 5, title: 'One step closer to your blue badge', body: 'Verify your college email to unlock photos, unlimited chat and your Roses.' },
];

/** Levels keep their old numbers (1 and 3), so people already part-way never get one again. */
const GRACE_WARNINGS = [
  { level: 1, afterDays: 10 },
  { level: 3, afterDays: 13 },
];

const EXPIRY_REMINDERS = [
  { level: 1, withinDays: 30 },
  { level: 2, withinDays: 7 },
  { level: 3, withinDays: 1 },
];

export class VerificationRemindersWorker {
  private static timer: NodeJS.Timeout | null = null;

  static start() {
    if (this.timer) return;
    const run = () => this.runOnce().catch((error) => logger.warn(`[VERIFY] reminders failed: ${(error as Error).message}`));
    setTimeout(run, 60_000).unref();
    this.timer = setInterval(run, HOUR_MS);
    this.timer.unref();
  }

  static stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** `only`: limit a run to these people - for tests, which must never touch anyone else. */
  static async runOnce(now = new Date(), only?: string[]) {
    const pushed = await this.verifyReminders(now, only);
    const warned = await this.graceWarnings(now, only);
    const paused = await this.pauseExpiredGrace(now, only);
    const expiring = await this.expiryReminders(now, only);
    if (!only) await FaceVerificationService.purgeOldReviews(now).catch((error) => logger.warn(`[FACE] review purge failed: ${(error as Error).message}`));
    const reminded = await this.rulesReminders(now, only);
    if (!only) await this.purgeOldEvidence(now).catch((error) => logger.warn(`[SAFETY] evidence purge failed: ${(error as Error).message}`));
    // The nudity check: uploads that went through while it was down (media-moderation.service.ts).
    if (!only) await MediaModerationService.rescanUnchecked().catch((error) => logger.warn(`[NUDITY] rescan failed: ${(error as Error).message}`));
    // Bug report files: 90 days, and uploads never finished (feedback.service.ts).
    if (!only) await FeedbackService.purgeOldFiles(now).catch((error) => logger.warn(`[FEEDBACK] file purge failed: ${(error as Error).message}`));
    return { pushed, warned, paused, expiring, reminded };
  }

  /** Day 1 and 5 after a Google sign-up, while still unverified and not paused. */
  static async verifyReminders(now = new Date(), only?: string[]) {
    let sent = 0;
    // Latest step first: someone behind gets that one and skips the rest.
    for (const step of [...VERIFY_PUSHES].reverse()) {
      const moved = await prisma.$queryRawUnsafe<{ id: string }[]>(`
        UPDATE users u SET verify_push_level = $1
        WHERE u.verify_push_level < $1 AND u.account_status = 'active' AND u.google_sub IS NOT NULL
          AND u.paused_at IS NULL AND u.created_at <= $2 AND u.created_at > $3 AND ${NEVER_VERIFIED}
          AND ($4::uuid[] IS NULL OR u.id = ANY($4::uuid[]))
        RETURNING u.id`,
        step.level, new Date(now.getTime() - step.afterDays * DAY_MS), new Date(now.getTime() - (GRACE_DAYS + 1) * DAY_MS), only ?? null);
      for (const { id } of moved) {
        await this.push(id, step.title, step.body, 'iemdating://verify');
        sent++;
      }
    }
    return sent;
  }

  /** "Your profile pauses in 4 / 1 days." In the app (the deck banner) and by push. */
  static async graceWarnings(now = new Date(), only?: string[]) {
    let sent = 0;
    for (const step of [...GRACE_WARNINGS].reverse()) {
      const moved = await prisma.$queryRawUnsafe<{ id: string; created_at: Date }[]>(`
        UPDATE users u SET grace_warning_level = $1
        WHERE u.grace_warning_level < $1 AND u.account_status = 'active' AND u.paused_at IS NULL
          AND u.created_at <= $2 AND ${owesSql()}
          AND ($3::uuid[] IS NULL OR u.id = ANY($3::uuid[]))
        RETURNING u.id, u.created_at`,
        step.level, new Date(now.getTime() - step.afterDays * DAY_MS), only ?? null);
      for (const { id, created_at: createdAt } of moved) {
        const left = Math.max(1, Math.ceil((createdAt.getTime() + GRACE_DAYS * DAY_MS - now.getTime()) / DAY_MS));
        await this.notify(id, `Your profile pauses in ${left} ${left === 1 ? 'day' : 'days'}`,
          'Open the app to finish verifying and stay visible. It takes a minute.');
        sent++;
      }
    }
    return sent;
  }

  /** Day 14, unverified: hidden from other people's decks, Explore and Likes You until verified. */
  static async pauseExpiredGrace(now = new Date(), only?: string[]) {
    const moved = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      UPDATE users u SET paused_at = $1, eligibility_version = u.eligibility_version + 1
      WHERE u.paused_at IS NULL AND u.account_status = 'active' AND u.created_at <= $2 AND ${owesSql()}
        AND ($3::uuid[] IS NULL OR u.id = ANY($3::uuid[]))
      RETURNING u.id`,
      now, new Date(now.getTime() - GRACE_DAYS * DAY_MS), only ?? null);
    for (const { id } of moved) {
      await this.notify(id, 'Your profile is paused',
        "Others can't see you right now. Open the app to finish verifying and it unpauses at once - your matches and chats are still here.");
    }
    return moved.length;
  }

  /** 30, 7 and 1 day before a verification ends: "Re-verify to keep your badge." */
  static async expiryReminders(now = new Date(), only?: string[]) {
    let sent = 0;
    for (const step of [...EXPIRY_REMINDERS].reverse()) {
      const moved = await prisma.$queryRawUnsafe<{ id: string; expires_at: Date }[]>(`
        UPDATE users u SET expiry_reminder_level = $1
        FROM student_memberships m
        WHERE m.user_id = u.id AND m.status = 'verified' AND m.verified_at IS NOT NULL
          AND m.expires_at > $2 AND m.expires_at <= $3
          AND u.expiry_reminder_level < $1 AND u.account_status = 'active'
          AND ($4::uuid[] IS NULL OR u.id = ANY($4::uuid[]))
        RETURNING u.id, m.expires_at`,
        step.level, now, new Date(now.getTime() + step.withinDays * DAY_MS), only ?? null);
      for (const { id, expires_at: expiresAt } of moved) {
        const days = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS));
        await this.notify(id, `Your college verification ends in ${days} ${days === 1 ? 'day' : 'days'}`,
          'Re-verify with your college email to keep your blue badge.');
        sent++;
      }
    }
    return sent;
  }

  /**
   * Once a year, a reminder of the rules (IT Rules 2021: users are told of the
   * rules at least once a year). In the app only - no push - a few hundred an hour.
   */
  static async rulesReminders(now = new Date(), only?: string[]) {
    const yearAgo = new Date(now.getTime() - 365 * DAY_MS);
    const moved = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      UPDATE users u SET rules_reminded_at = $1
      WHERE u.id IN (
        SELECT id FROM users
        WHERE account_status = 'active' AND COALESCE(rules_reminded_at, created_at) <= $2
          AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
        LIMIT 300)
      RETURNING u.id`, now, yearAgo, only ?? null);
    for (const { id } of moved) {
      await prisma.notification.create({ data: {
        userId: id, type: 'system', title: 'A yearly reminder of our rules',
        body: 'Our Community Guidelines, Terms and Privacy Policy explain what is allowed and how we keep you safe. Settings > Legal.',
      } }).catch(() => undefined);
    }
    return moved.length;
  }

  /** Closed reports keep their evidence (messages, photos as reported) for one year, then lose it. */
  static async purgeOldEvidence(now = new Date()) {
    const result = await prisma.safetyReport.updateMany({
      where: { createdAt: { lt: new Date(now.getTime() - 365 * DAY_MS) }, status: { in: ['resolved', 'dismissed'] }, NOT: { evidenceSnapshot: { equals: Prisma.DbNull } } },
      data: { evidenceSnapshot: Prisma.DbNull },
    });
    return result.count;
  }

  /** An in-app notification and a push (which follows App settings). */
  private static async notify(userId: string, title: string, body: string) {
    try {
      await prisma.notification.create({ data: { userId, type: 'system', title, body } });
    } catch (error) {
      logger.warn(`[VERIFY] notification not saved: ${(error as Error).message}`);
    }
    await this.push(userId, title, body, 'iemdating://verify');
  }

  private static async push(userId: string, title: string, body: string, url: string) {
    await PushService.send(userId, { title, body, data: { url }, category: 'verify_reminders', kind: 'verify_reminder' })
      .catch((error) => logger.warn(`[VERIFY] push failed: ${(error as Error).message}`));
  }
}
