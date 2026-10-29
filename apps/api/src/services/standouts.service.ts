import { Prisma, User } from '@prisma/client';
import { createHash } from 'crypto';
import { prisma } from '../utils/prisma';
import { asViewer, eligibleSql, setupComplete } from './eligibility.service';
import { AlgorithmConfigService } from './algorithm-config.service';
import { RetrievalService } from './retrieval.service';
import { ReciprocityService } from './reciprocity.service';
import { discoveryProfileSelect, publicProfile } from './public-profile.service';
import { buildCards, istDay, secondsLeftToday } from './discovery-cards.service';
import { StandoutsV3Service, dayFrom } from './standouts-v3.service';
import { STANDOUTS_LEARN_SWIPES, setSize, type SlotType } from './standouts-algorithm';

/**
 * Standouts (STANDOUTS_LIKES_SPEC.md section 5): a small daily set chosen
 * for one reader, reached with a Rose.
 *
 * Hinge's version is resented as "rose jail" - attention-ranked, and taking
 * people out of the free feed. This one is neither:
 *
 * 1. Personalised: the reader's own compatibility with each person, plus how
 *    likely that person is to Like them back. Never attention received.
 * 2. An extra, never a jail: nobody is withheld from the deck or Explore, and
 *    an ordinary Like from there is never refused because of Standouts.
 * 3. An exposure cap: one person is in at most STANDOUTS_EXPOSURE_CAP readers'
 *    sets a day, so the most-compatible-with-everyone person does not end up
 *    in every feed and rebuild the leaderboard.
 * 4. No counts, anywhere.
 *
 * The day is a database row (`standout_days`), not a cache entry, so the set
 * stays put through a Redis restart and exposure is counted from the rows -
 * once per reader, never twice.
 *
 * Standouts v3 (apps/mobile/src/features/discovery/STANDOUTS_PLAN.md) chooses
 * the day's sets when `standouts_v3` is on: in the night run, or on a first
 * open it did not cover (standouts-v3.service.ts). With it off, the v2 choice
 * below runs with the plan's phase 1 rules: the ready check, "Not for me" for
 * 30 days, 8 a day, and the Rose receive limit.
 */

/** The default set size; the live one is the `standouts_size` setting. */
export const STANDOUTS_SIZE = 8;
/** From this many eligible people the set is full; fewer gives a smaller one, under 3 none (4.1). */
export const STANDOUTS_FULL_POOL = 24;
export const STANDOUTS_MIN = 3;
/** How many readers' Standouts one person may appear in on the same day. */
export const STANDOUTS_EXPOSURE_CAP = 12;
/** Someone in your Standouts is not picked again for this many days, while others are available. */
export const STANDOUTS_REPEAT_DAYS = 7;
/** How deep into the eligible pool the day's choice looks. */
const STANDOUTS_BUDGET = 120;

export type StandoutsState = 'ok' | 'setup_required' | 'not_enough_people' | 'learning';

type DayRow = { picks: string[]; hidden: string[]; slots: string[] };

/** The IST day `offset` days from today, as `istDay()` writes it. */
function dayOffset(offset: number) {
  return new Date(Date.now() + 5.5 * 60 * 60_000 + offset * 24 * 60 * 60_000).toISOString().slice(0, 10);
}

export class StandoutsService {
  static async today(userId: string) {
    // Browsing as a viewer: while hidden at a place, from the phone's private position.
    const me = asViewer(await prisma.user.findUniqueOrThrow({ where: { id: userId } }));
    const refreshesInSeconds = secondsLeftToday();
    if (!setupComplete(me)) {
      return { cards: [], state: 'setup_required' as StandoutsState, refreshesInSeconds };
    }

    const day = istDay();
    // A new person: no set until their type is learned, unless today's was already made.
    const learning = await this.learning(me.id);
    if (learning.done < learning.needed
      && !(await prisma.standoutDay.findUnique({ where: { viewerId_day: { viewerId: me.id, day } }, select: { day: true } }))) {
      return { cards: [], state: 'learning' as StandoutsState, learning, refreshesInSeconds };
    }
    const row = await this.dayFor(me, day);
    const hidden = new Set(row.hidden);
    const picks = row.picks.filter((id) => !hidden.has(id));
    if (!row.picks.length) return { cards: [], state: 'not_enough_people' as StandoutsState, refreshesInSeconds };

    // Still reachable now (blocks, a pass from them, a match since), with own
    // swipes allowed so a Rose already sent keeps its card for the day.
    const reachable = picks.length
      ? new Set(
          (
            await prisma.$queryRaw<{ id: string }[]>`
              SELECT u.id FROM users u WHERE u.id = ANY(${picks}::uuid[]) AND ${eligibleSql(me, new Date(), false)}`
          ).map((entry) => entry.id),
        )
      : new Set<string>();
    const [swipes, roses] = await Promise.all([
      prisma.swipe.findMany({ where: { swiperId: me.id, targetId: { in: picks } }, select: { targetId: true } }),
      prisma.rose.findMany({ where: { senderId: me.id, recipientId: { in: picks } }, select: { recipientId: true } }),
    ]);
    const rosed = new Set(roses.map((rose) => rose.recipientId));
    const answered = new Set(swipes.map((swipe) => swipe.targetId));
    // A Rose sent stays, marked; a Like or Pass given elsewhere is a dead card.
    const live = picks.filter((id) => reachable.has(id) && (!answered.has(id) || rosed.has(id)));

    const signature = createHash('sha256').update(`standouts|${me.id}|${day}`).digest('hex').slice(0, 32);
    const cards = await buildCards(me, live, signature);
    const slotOf = new Map(row.picks.map((id, index) => [id, (row.slots[index] ?? 'best') as SlotType]));
    return {
      cards: cards.map((card) => {
        const slot = slotOf.get(card.id) ?? 'best';
        return {
          ...card,
          roseSent: rosed.has(card.id),
          slot,
          // The new face says so first: their profile has had little time to show what you share.
          reasons: slot === 'new' ? ['New on IEM Connect', ...this.reasons(me, card)].slice(0, 2) : this.reasons(me, card),
        };
      }),
      state: 'ok' as StandoutsState,
      // So the app can say when the next set arrives without inventing a clock.
      refreshesInSeconds,
    };
  }

  /**
   * How far a new person is with "Learning your type": swipes saved (a Like or
   * a pass; one taken back with Rewind is gone), out of STANDOUTS_LEARN_SWIPES.
   */
  static async learning(userId: string) {
    const done = await prisma.swipe.count({ where: { swiperId: userId } });
    return { needed: STANDOUTS_LEARN_SWIPES, done: Math.min(done, STANDOUTS_LEARN_SWIPES) };
  }

  /** "Not for me": hidden for the rest of the day. Records no swipe - nothing the other person could ever notice. */
  static async hide(userId: string, targetId: string) {
    const day = istDay();
    const updated = await prisma.$executeRaw`
      UPDATE standout_days SET hidden = array_append(hidden, ${targetId}::uuid)
      WHERE viewer_id = ${userId}::uuid AND day = ${day}
        AND ${targetId}::uuid = ANY(picks) AND NOT (${targetId}::uuid = ANY(hidden))`;
    return { hidden: updated > 0 || (await this.isHidden(userId, day, targetId)) };
  }

  private static async isHidden(userId: string, day: string, targetId: string) {
    const row = await prisma.standoutDay.findUnique({ where: { viewerId_day: { viewerId: userId, day } }, select: { hidden: true } });
    return !!row?.hidden.includes(targetId);
  }

  /** Today's row, chosen and written once; a racing second request reads the first one's row. */
  private static async dayFor(me: User, day: string): Promise<DayRow> {
    const existing = await prisma.standoutDay.findUnique({
      where: { viewerId_day: { viewerId: me.id, day } },
      select: { picks: true, hidden: true, slots: true },
    });
    if (existing) return existing;
    const { flags } = await AlgorithmConfigService.get();
    if (flags.standouts_v3 === 1) {
      // v3: the night run did not cover this viewer; same steps, inside today's limits left.
      const set = await StandoutsV3Service.chooseForViewer(me, day);
      await prisma.$executeRaw`
        INSERT INTO standout_days (viewer_id, day, picks, hidden, slots, taste, version)
        VALUES (${me.id}::uuid, ${day}, ${set.picks}::uuid[], ARRAY[]::uuid[], ${set.slots}::text[], ${JSON.stringify(set.taste)}::jsonb, 'v3')
        ON CONFLICT (viewer_id, day) DO NOTHING`;
    } else {
      const picks = await this.choose(me, day);
      await prisma.$executeRaw`
        INSERT INTO standout_days (viewer_id, day, picks, hidden)
        VALUES (${me.id}::uuid, ${day}, ${picks}::uuid[], ARRAY[]::uuid[])
        ON CONFLICT (viewer_id, day) DO NOTHING`;
    }
    // "Not for me" lasts 30 days, so a month of history is kept.
    await prisma.standoutDay
      .deleteMany({ where: { viewerId: me.id, day: { lt: dayFrom(day, -(Math.max(flags.standouts_hide_days, STANDOUTS_REPEAT_DAYS) + 1)) } } })
      .catch(() => undefined);
    return prisma.standoutDay.findUniqueOrThrow({
      where: { viewerId_day: { viewerId: me.id, day } },
      select: { picks: true, hidden: true, slots: true },
    });
  }

  /**
   * The day's picks: the reader's ranking, walked in order, skipping anyone at
   * their exposure cap, and anyone shown in the last week while others remain.
   */
  private static async choose(me: User, day: string): Promise<string[]> {
    const { flags } = await AlgorithmConfigService.get();
    const receiveLimit = Math.max(1, Math.floor(flags.roses_receive_limit));
    // The plan's ready check (STANDOUTS_PLAN.md 5.1), relaxed step by step for
    // a small pool. It also excludes anyone who already liked you - they are in
    // Likes You, where answering is free and certain - and anyone hidden lately.
    let pool: string[] = [];
    for (const gate of [
      { photos: 3, activeDays: flags.standouts_active_days },
      { photos: 2, activeDays: flags.standouts_active_days },
      { photos: 2, activeDays: Math.max(flags.standouts_active_days, 30) },
    ]) {
      pool = await RetrievalService.exploreIds(me, StandoutsV3Service.readySql(me, day, flags, gate, receiveLimit), STANDOUTS_BUDGET);
      if (pool.length >= STANDOUTS_FULL_POOL) break;
    }
    const size = setSize(pool.length, flags.standouts_size);
    if (!size) return [];

    const [viewer, profiles, activity, config, reciprocity, recentRows, exposureRows] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: discoveryProfileSelect }),
      prisma.user.findMany({ where: { id: { in: pool } }, select: discoveryProfileSelect }),
      // `discoveryProfileSelect` deliberately omits timestamps, so activity is
      // read on its own rather than widening what a profile exposes.
      prisma.user.findMany({ where: { id: { in: pool } }, select: { id: true, lastActiveAt: true, createdAt: true, realPersonVerifiedAt: true } }),
      AlgorithmConfigService.get(),
      ReciprocityService.batch(me, pool).catch(() => new Map<string, number>()),
      prisma.standoutDay.findMany({
        where: { viewerId: me.id, day: { gte: dayOffset(-STANDOUTS_REPEAT_DAYS), lt: day } },
        select: { picks: true },
      }),
      prisma.$queryRaw<{ id: string; seen: number }[]>`
        SELECT pick AS id, COUNT(*)::int AS seen FROM standout_days, unnest(picks) AS pick
        WHERE day = ${day} AND picks && ${pool}::uuid[] AND pick = ANY(${pool}::uuid[])
        GROUP BY pick`,
    ]);
    const week = Date.now() - 7 * 24 * 60 * 60_000;
    const activeSince = new Map(activity.map((row) => [row.id, (row.lastActiveAt ?? row.createdAt).getTime()]));
    const realPeople = new Set(activity.filter((row) => row.realPersonVerifiedAt).map((row) => row.id));
    const ranked = profiles
      .map((profile) => {
        const score = publicProfile(viewer, profile, config.weights).compatibilityScore ?? 0;
        // Recent activity is a tie-break, not a ranking of its own.
        const active = (activeSince.get(profile.id) ?? 0) >= week ? 3 : 0;
        // How likely they are to Like you back: Hinge's own criterion, and
        // what keeps a Rose from being spent where it will not be answered.
        const likely = reciprocity.get(profile.id) ?? 0;
        // Passed the real-person check: a little ahead (PHOTO_VERIFICATION_PLAN.md).
        const real = realPeople.has(profile.id) ? config.flags.standouts_real_person_boost : 0;
        return { id: profile.id, score: score + active + likely + real };
      })
      .sort((first, second) => second.score - first.score);

    // Your own radius and your own college first, as everywhere else.
    const ordered = await RetrievalService.nearFirst(me, ranked.map((entry) => entry.id));
    const exposure = new Map(exposureRows.map((row) => [row.id, row.seen]));
    const recent = new Set(recentRows.flatMap((row) => row.picks));
    const open = ordered.filter((id) => (exposure.get(id) ?? 0) < STANDOUTS_EXPOSURE_CAP);
    const fresh = open.filter((id) => !recent.has(id));
    // Repeats only to fill, so a small college still gets a set.
    return [...fresh, ...open.filter((id) => recent.has(id))].slice(0, size);
  }

  /**
   * Why this person, in at most two short reasons - only ever things about
   * the two of you, never about how anyone else behaves towards them (5.4).
   */
  private static reasons(
    me: User,
    card: { department?: string | null; matchFactors?: { id: string; sharedValues: string[] }[] },
  ): string[] {
    const reasons: string[] = [];
    const factors = card.matchFactors ?? [];
    const shared = (id: string) => factors.find((factor) => factor.id === id)?.sharedValues.length ?? 0;
    const plural = (count: number, word: string) => `${count} shared ${word}${count === 1 ? '' : 's'}`;
    const interests = shared('interests');
    if (interests) reasons.push(plural(interests, 'interest'));
    if (me.department?.trim() && card.department?.trim()
      && me.department.trim().toLowerCase() === card.department.trim().toLowerCase()) {
      reasons.push('Same department');
    }
    const intent = factors.find((factor) => factor.id === 'seeking' && factor.sharedValues.length);
    if (intent) reasons.push('Same relationship goal');
    const clubs = shared('clubs');
    if (clubs) reasons.push(plural(clubs, 'club'));
    if (shared('hangouts')) reasons.push('Same hangout spots');
    return reasons.slice(0, 2);
  }
}
