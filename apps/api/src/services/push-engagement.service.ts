import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { redisClient } from '../utils/redis';
import { PushService } from './push.service';
import { LikesService } from './likes.service';
import { inQuietHours, istHour, istMidnight, LINES, pickLine, type Line } from './push-policy.service';

/**
 * The timed pushes (apps/mobile/src/features/notifications/NOTIFICATIONS_PLAN.md 3e, 4, 5):
 * today's Standouts, new people on your campus, comebacks, profile tips, and a
 * match nobody has written to yet. Each goes at the hour this person usually
 * opens the app, only when what it says is true, and within the caps:
 *
 * - at most 2 "spicy" ones a day, never two within 4 hours;
 * - comebacks and tips: 4 a week at most;
 * - 5 ignored in a row: half as often; 10 ignored: none for 2 weeks;
 * - never during quiet hours, never to paused or inactive accounts.
 *
 * Runs every 15 minutes; also sends what quiet hours held back overnight.
 */

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const CHECK_MS = 15 * 60_000;
/** Used until someone has opened the app often enough for their own hour to show. */
const DEFAULT_HOUR = 19;
const MIN_OPENS_FOR_HOUR = 5;
const SPICY_PER_DAY = 2;
const SPICY_GAP_MS = 4 * HOUR_MS;
const NUDGES_PER_WEEK = 4;
const SLOW_DOWN_AFTER = 5;
const STOP_AFTER = 10;
const BATCH = 1000;
const NEW_PEOPLE_MIN = 3;

type Candidate = { id: string; campus_name: string | null; campus_id: string | null; last_active_at: Date | null };

export class PushEngagementService {
  /**
   * The app was used now (from the auth middleware, at most once an hour per
   * person): counts the hour, so pushes go when they're usually around, and
   * resets the comeback steps.
   */
  static async touch(userId: string, now = new Date()) {
    const hour = istHour(now);
    try {
      const key = `pushHour:${userId}`;
      const stamp = `${istMidnight(now).getTime()}:${hour}`;
      if (await redisClient.get(key) === stamp) return;
      await redisClient.setex(key, 3600, stamp);
    } catch {
      return; // No Redis: skip rather than count every request.
    }
    const slot = Prisma.raw(String(hour + 1));
    const first = Array.from({ length: 24 }, (_, index) => (index === hour ? 1 : 0));
    const [row] = await prisma.$queryRaw<{ active_hours: number[] }[]>`
      INSERT INTO push_engagement (user_id, active_hours, comeback_level, updated_at)
      VALUES (${userId}::uuid, ${first}::int[], 0, now())
      ON CONFLICT (user_id) DO UPDATE SET
        active_hours[${slot}] = COALESCE(push_engagement.active_hours[${slot}], 0) + 1,
        comeback_level = 0, updated_at = now()
      RETURNING active_hours`;
    if (!row) return;
    let hours = row.active_hours;
    const total = hours.reduce((sum, value) => sum + value, 0);
    // Recent habits count most: halve the old counts now and then.
    if (total > 120) hours = hours.map((value) => Math.floor(value / 2));
    const best = total >= MIN_OPENS_FOR_HOUR ? hours.indexOf(Math.max(...hours)) : null;
    await prisma.pushEngagement.update({ where: { userId }, data: { activeHours: hours, bestHour: best } });
  }

  /**
   * Whether one more "spicy" push may go to this person now (5). Also applies
   * the back-off: ten ignored in a row pause them for two weeks.
   */
  static async spicyAllowed(userId: string, category: 'picks' | 'nudges', now = new Date()) {
    if (inQuietHours(now)) return false;
    const engagement = await prisma.pushEngagement.findUnique({ where: { userId }, select: { spicyPausedUntil: true } });
    if (engagement?.spicyPausedUntil && engagement.spicyPausedUntil > now) return false;
    const recent = await prisma.pushLog.findMany({
      where: { userId, spicy: true, sentAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
      orderBy: { sentAt: 'desc' },
      take: STOP_AFTER,
      select: { sentAt: true, openedAt: true, category: true },
    });
    const midnight = istMidnight(now);
    if (recent.filter((row) => row.sentAt >= midnight).length >= SPICY_PER_DAY) return false;
    if (recent[0] && now.getTime() - recent[0].sentAt.getTime() < SPICY_GAP_MS) return false;
    if (category === 'nudges') {
      const week = await prisma.pushLog.count({ where: { userId, category: 'nudges', sentAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } });
      if (week >= NUDGES_PER_WEEK) return false;
    }
    // Back-off: count the ignored ones in a row, newest first.
    let ignored = 0;
    for (const row of recent) {
      if (row.openedAt) break;
      ignored++;
    }
    if (ignored >= STOP_AFTER) {
      await prisma.pushEngagement.upsert({
        where: { userId },
        create: { userId, spicyPausedUntil: new Date(now.getTime() + 14 * DAY_MS) },
        update: { spicyPausedUntil: new Date(now.getTime() + 14 * DAY_MS) },
      });
      return false;
    }
    if (ignored >= SLOW_DOWN_AFTER && recent[0] && now.getTime() - recent[0].sentAt.getTime() < 2 * DAY_MS) return false;
    return true;
  }

  /** One line to one person, logged with its version. */
  static async sendLine(userId: string, category: 'picks' | 'nudges' | 'matches', kind: string, line: Line, url: string, now = new Date()) {
    await PushService.send(userId, {
      title: line.title, body: line.body, category, kind, template: line.id,
      data: { url, kind },
    }, undefined, { now });
  }

  // --- The jobs ---------------------------------------------------------

  /** People whose push hour is now (their own hour, or 7 pm), who can get timed pushes. */
  private static async atTheirHour(now: Date, where: Prisma.Sql, only?: string[]) {
    const hour = istHour(now);
    return prisma.$queryRaw<Candidate[]>`
      SELECT u.id, u.campus_id, c.name AS campus_name, u.last_active_at
      FROM users u
      LEFT JOIN push_engagement e ON e.user_id = u.id
      LEFT JOIN institution_campuses c ON c.id = u.campus_id
      WHERE u.account_status = 'active' AND u.paused_at IS NULL AND u.preferences_confirmed_at IS NOT NULL
        AND (CASE WHEN e.best_hour BETWEEN 9 AND 22 THEN e.best_hour ELSE ${DEFAULT_HOUR} END) = ${hour}
        AND EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = u.id)
        ${only ? Prisma.sql`AND u.id = ANY(${only}::uuid[])` : Prisma.empty}
        AND ${where}
      LIMIT ${BATCH}`;
  }

  /** N23: today's Standouts, to people active in the last 3 days, once a day. */
  static async standouts(now: Date, only?: string[]) {
    const midnight = istMidnight(now);
    const people = await this.atTheirHour(now, Prisma.sql`
      u.last_active_at >= ${new Date(now.getTime() - 3 * DAY_MS)}
      AND (e.last_standouts_at IS NULL OR e.last_standouts_at < ${midnight})`, only);
    let sent = 0;
    for (const person of people) {
      if (!await this.spicyAllowed(person.id, 'picks', now)) continue;
      await this.mark(person.id, { lastStandoutsAt: now });
      const set = person.campus_name ? LINES.standouts : LINES.standouts.filter((line) => !line.body.includes('{campus}'));
      await this.sendLine(person.id, 'picks', 'standouts', pickLine(set, { campus: person.campus_name ?? '' }), 'iemdating://standouts', now);
      sent++;
    }
    return sent;
  }

  /** N24: at least 3 people joined their campus this week - once a week. */
  static async newPeople(now: Date, only?: string[]) {
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const people = await this.atTheirHour(now, Prisma.sql`
      u.campus_id IS NOT NULL AND c.name IS NOT NULL
      AND u.last_active_at >= ${new Date(now.getTime() - 14 * DAY_MS)}
      AND (e.last_new_people_at IS NULL OR e.last_new_people_at < ${weekAgo})`, only);
    let sent = 0;
    for (const person of people) {
      const count = await this.joinedSince(person, weekAgo);
      if (count < NEW_PEOPLE_MIN) continue;
      if (!await this.spicyAllowed(person.id, 'picks', now)) continue;
      await this.mark(person.id, { lastNewPeopleAt: now });
      await this.sendLine(person.id, 'picks', 'new_people', pickLine(LINES.new_people, { count, campus: person.campus_name! }), 'iemdating://main/Dashboard', now);
      sent++;
    }
    return sent;
  }

  /**
   * N25: day 3, 7 and 14 away - each only with something true to say, then
   * nothing until they come back. Someone away longer than 3 weeks when this
   * started gets nothing at all.
   */
  static async comebacks(now: Date, only?: string[]) {
    const people = await this.atTheirHour(now, Prisma.sql`
      u.last_active_at < ${new Date(now.getTime() - 3 * DAY_MS)}
      AND u.last_active_at >= ${new Date(now.getTime() - 21 * DAY_MS)}
      AND COALESCE(e.comeback_level, 0) < 3`, only);
    let sent = 0;
    for (const person of people) {
      const away = (now.getTime() - person.last_active_at!.getTime()) / DAY_MS;
      const step = away >= 14 ? 3 : away >= 7 ? 2 : 1;
      const level = (await prisma.pushEngagement.findUnique({ where: { userId: person.id }, select: { comebackLevel: true } }))?.comebackLevel ?? 0;
      if (step <= level) continue;
      if (!await this.spicyAllowed(person.id, 'nudges', now)) continue;
      const line = await this.comebackLine(person, step);
      // Nothing true to say at this step: skip it, quietly.
      await this.mark(person.id, { comebackLevel: step });
      if (!line) continue;
      await this.sendLine(person.id, 'nudges', `comeback_${step}`, line.line, line.url, now);
      sent++;
    }
    return sent;
  }

  private static async comebackLine(person: Candidate, step: number): Promise<{ line: Line; url: string } | null> {
    const { unseen } = await LikesService.summary(person.id);
    const byId = (id: string) => LINES.comeback_likes.concat(LINES.comeback_people).filter((line) => line.id === id);
    if (unseen > 0 && step !== 2) {
      return { line: pickLine(byId(step === 3 ? 'comeback_likes_2' : 'comeback_likes_1'), { count: unseen }), url: 'iemdating://main/matches?tab=likes' };
    }
    if (step === 2) {
      const matches = await prisma.match.count({ where: { status: 'active', OR: [{ user1Id: person.id }, { user2Id: person.id }] } });
      if (matches > 0) return { line: pickLine(byId('comeback_people_2')), url: 'iemdating://main/Chats' };
      if (unseen > 0) return { line: pickLine(byId('comeback_likes_1'), { count: unseen }), url: 'iemdating://main/matches?tab=likes' };
    }
    const joined = person.last_active_at ? await this.joinedSince(person, person.last_active_at) : 0;
    if (joined > 0) return { line: pickLine(byId('comeback_people_1'), { count: joined }), url: 'iemdating://main/Dashboard' };
    return null;
  }

  /** N26: one profile tip a week, to people active this week whose profile lacks it. */
  static async tips(now: Date, only?: string[]) {
    const people = await this.atTheirHour(now, Prisma.sql`
      u.last_active_at >= ${new Date(now.getTime() - 7 * DAY_MS)}
      AND (e.last_tip_at IS NULL OR e.last_tip_at < ${new Date(now.getTime() - 7 * DAY_MS)})`, only);
    let sent = 0;
    for (const person of people) {
      const profile = await prisma.user.findUnique({
        where: { id: person.id },
        select: { profileVideoUrl: true, preferences: true, _count: { select: { photos: true } } },
      });
      if (!profile) continue;
      const bio = (profile.preferences as { bio?: unknown } | null)?.bio;
      const set = !profile.profileVideoUrl ? LINES.tip_video
        : profile._count.photos < 3 ? LINES.tip_photos
          : !(typeof bio === 'string' && bio.trim()) ? LINES.tip_bio : null;
      if (!set) continue;
      if (!await this.spicyAllowed(person.id, 'nudges', now)) continue;
      await this.mark(person.id, { lastTipAt: now });
      await this.sendLine(person.id, 'nudges', 'tip', pickLine(set), 'iemdating://EditProfile', now);
      sent++;
    }
    return sent;
  }

  /**
   * N10: a match 3 days old with no messages at all - once per person per
   * match, kept in the Notifications page too. Not "spicy": it's about a real
   * person, under the Matches switch.
   */
  static async waitingMatches(now: Date, only?: string[]) {
    const matches = await prisma.$queryRaw<{ id: string; user1_id: string; user2_id: string; name1: string; name2: string }[]>`
      SELECT m.id, m.user1_id, m.user2_id, u1.name AS name1, u2.name AS name2
      FROM matches m JOIN users u1 ON u1.id = m.user1_id JOIN users u2 ON u2.id = m.user2_id
      WHERE m.status = 'active'
        AND m.created_at BETWEEN ${new Date(now.getTime() - 4 * DAY_MS)} AND ${new Date(now.getTime() - 3 * DAY_MS)}
        AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.match_id = m.id)
        ${only ? Prisma.sql`AND (m.user1_id = ANY(${only}::uuid[]) OR m.user2_id = ANY(${only}::uuid[]))` : Prisma.empty}
      LIMIT ${BATCH}`;
    let sent = 0;
    for (const match of matches) {
      for (const [userId, otherName] of [[match.user1_id, match.name2], [match.user2_id, match.name1]] as const) {
        if (only && !only.includes(userId)) continue;
        const first = otherName.split(' ')[0];
        const line = pickLine(LINES.waiting_match, { name: first });
        const deliveryKey = `waiting:${match.id}:${userId}`;
        const existing = await prisma.notification.findUnique({ where: { deliveryKey }, select: { id: true } });
        if (existing) continue;
        const notification = await prisma.notification.create({
          data: { userId, type: 'match', title: line.title, body: line.body, data: { matchId: match.id, kind: 'waiting_match' }, actionUrl: `/chat/${match.id}`, deliveryKey },
        });
        await PushService.send(userId, {
          title: line.title, body: line.body, category: 'matches', kind: 'waiting_match', template: line.id, notificationId: notification.id,
          data: { url: `iemdating://chat/${match.id}`, matchId: match.id, kind: 'waiting_match' },
        }, undefined, { now });
        await prisma.notification.update({ where: { id: notification.id }, data: { pushSentAt: new Date() } });
        sent++;
      }
    }
    return sent;
  }

  private static async joinedSince(person: Candidate, since: Date) {
    if (!person.campus_id) return 0;
    return prisma.user.count({
      where: {
        campusId: person.campus_id, id: { not: person.id }, accountStatus: 'active', pausedAt: null,
        preferencesConfirmedAt: { not: null }, createdAt: { gte: since },
      },
    });
  }

  private static async mark(userId: string, data: Prisma.PushEngagementUncheckedUpdateInput) {
    await prisma.pushEngagement.upsert({
      where: { userId },
      create: { ...(data as Prisma.PushEngagementUncheckedCreateInput), userId },
      update: data,
    });
  }

  /** One pass of everything; `only` limits it to these people (tests). */
  static async runOnce(now = new Date(), only?: string[]) {
    const held = await PushService.sendDue(now, 500, only);
    const result = { held, standouts: 0, newPeople: 0, comebacks: 0, tips: 0, waiting: 0 };
    result.waiting = await this.waitingMatches(now, only);
    if (inQuietHours(now)) return result;
    // Most useful first: each one sent uses up the day's allowance for the next.
    result.standouts = await this.standouts(now, only);
    result.newPeople = await this.newPeople(now, only);
    result.comebacks = await this.comebacks(now, only);
    result.tips = await this.tips(now, only);
    return result;
  }
}

export class PushEngagementWorker {
  private static timer: NodeJS.Timeout | null = null;
  private static running = false;

  static start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 90_000).unref();
  }

  static stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private static async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await PushEngagementService.runOnce();
      const total = Object.values(result).reduce((sum, value) => sum + value, 0);
      if (total) logger.info(`[PUSH] timed pushes ${JSON.stringify(result)}`);
    } catch (error) {
      logger.warn(`[PUSH] timed pushes failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
