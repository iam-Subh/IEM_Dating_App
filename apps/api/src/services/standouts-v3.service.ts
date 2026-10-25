import { Prisma, User } from '@prisma/client';
import { normalizeInterests } from '@iem-dating/shared/interest-catalog';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { asViewer, eligibleSql, setupComplete } from './eligibility.service';
import { AlgorithmConfigService, type AlgorithmConfig } from './algorithm-config.service';
import { RetrievalService } from './retrieval.service';
import { ReciprocityService } from './reciprocity.service';
import { compatibility } from './compatibility.service';
import {
  NOT_FOR_ME_WEIGHT, ROSE_WEIGHT, SetBuilder, buildTaste, combinedScore, fairLimit, fairLimits, freshnessScore,
  likedValues, reciprocityScore, roundRobin, setSize, slotPlan, tasteScore, traitKeys, underseenBoost,
  type Ranked, type SlotType, type TasteProfile, type Traits, type VarietyLimits,
} from './standouts-algorithm';

/**
 * Standouts v3, the part that talks to the database
 * (apps/mobile/src/features/discovery/STANDOUTS_PLAN.md, sections 5 and 6):
 * who is ready to be picked, gathering candidates from four sources, the
 * viewer's taste from their swipes, scoring, and the two ways a day's sets
 * are chosen - all at once in the night run, or one viewer at a time on a
 * first open the night run did not cover.
 */

type Flags = AlgorithmConfig['flags'];
export type DaySet = { picks: string[]; slots: SlotType[]; taste: TasteProfile | null; relaxed: boolean };

const DAY_MS = 86_400_000;
/** Candidates gathered per viewer, and kept after scoring for the night run. */
const GATHER_BUDGET = 600;
const NIGHT_LIST = 80;
/** Concurrency of the night run: viewers worked on at once. */
const NIGHT_WORKERS = 4;

/** The IST day `offset` days from `day`. */
export function dayFrom(day: string, offset: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** The instant an IST day starts. */
const dayStart = (day: string) => new Date(`${day}T00:00:00+05:30`);

const norm = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

/** What the taste profile reads from a person (5.3). */
function traitsOf(user: {
  department: string | null; yearOfStudy: number | null; campus: string | null; isHosteller: boolean | null;
  seeking: string | null; preferences: Prisma.JsonValue;
}): Traits {
  const preferences = (user.preferences && typeof user.preferences === 'object' && !Array.isArray(user.preferences)
    ? user.preferences : {}) as Record<string, unknown>;
  const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, string>;
  return {
    department: user.department,
    year: user.yearOfStudy,
    campus: user.campus,
    hosteller: user.isHosteller,
    interests: normalizeInterests(preferences.interests),
    seeking: user.seeking,
    lifestyle: record(preferences.lifestyle),
    personality: record(preferences.personality),
  };
}

const TRAIT_SELECT = {
  id: true, department: true, yearOfStudy: true, campus: true, isHosteller: true, seeking: true, preferences: true,
} as const;

/** The ready check, strictest first, relaxed step by step for small pools (5.1). Video is never relaxed. */
function gates(flags: Flags) {
  const active = flags.standouts_active_days;
  return [
    { photos: 3, activeDays: active },
    { photos: 2, activeDays: active },
    { photos: 2, activeDays: Math.max(active, 30) },
  ];
}

export class StandoutsV3Service {
  /**
   * Who may be picked for `me` (5.1): eligible both ways (the caller's
   * `eligibleSql`), verified, ready (video playable, photos, a bio or
   * interests), active, not hidden by `me` lately, not already at today's
   * Rose receive limit, and not someone who already Liked `me`.
   */
  static readySql(me: User, day: string, flags: Flags, gate: { photos: number; activeDays: number }, receiveLimit: number) {
    const hideFrom = dayFrom(day, -flags.standouts_hide_days);
    return Prisma.sql`
      AND EXISTS (SELECT 1 FROM student_memberships vm JOIN institutions vi ON vi.id = vm.institution_id
        WHERE vm.user_id = u.id AND vm.status = 'verified' AND vm.verified_at IS NOT NULL
          AND (vm.expires_at IS NULL OR vm.expires_at > now()) AND vi.is_active)
      AND u.profile_video_url IS NOT NULL
      -- A showcase: nobody whose photo or video is waiting to be fixed (PHOTO_VERIFICATION_PLAN.md 5).
      AND NOT (u.real_person_passed_at IS NOT NULL AND u.real_person_verified_at IS NULL)
      AND (u.video_playback_url IS NOT NULL OR NOT EXISTS (SELECT 1 FROM profile_media_assets a
        WHERE a.owner_id = u.id AND a.purpose = 'video' AND a.processing_status IN ('pending', 'processing', 'failed')))
      AND (SELECT count(*) FROM profile_photos p WHERE p.user_id = u.id) >= ${gate.photos}
      AND (length(trim(coalesce(u.preferences->>'bio', ''))) > 0
        OR (jsonb_typeof(u.preferences->'interests') = 'array' AND jsonb_array_length(u.preferences->'interests') >= 3))
      AND coalesce(u.last_active_at, u.created_at) >= ${new Date(Date.now() - gate.activeDays * DAY_MS)}
      AND NOT EXISTS (SELECT 1 FROM standout_days h WHERE h.viewer_id = ${me.id}::uuid AND h.day >= ${hideFrom} AND u.id = ANY(h.hidden))
      AND (SELECT count(*) FROM roses r WHERE r.recipient_id = u.id AND r.created_at >= ${dayStart(day)}) < ${receiveLimit}
      AND NOT EXISTS (SELECT 1 FROM swipes liked WHERE liked.swiper_id = u.id AND liked.target_id = ${me.id}::uuid AND liked.action = 'like')`;
  }

  /** One candidate query, inside the same limits the deck's retrieval uses. */
  private static async query(me: User, ready: Prisma.Sql, extra: Prisma.Sql, order: Prisma.Sql, limit: number) {
    if (limit <= 0) return [] as string[];
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('jit','off',true), set_config('statement_timeout','4000ms',true)`;
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT u.id FROM users u
        WHERE ${eligibleSql(me)} ${RetrievalService.distanceBox(me)} ${ready} ${extra}
        ORDER BY ${order} LIMIT ${limit}`);
      return rows.map((row) => row.id);
    }, { timeout: 8000 });
  }

  /**
   * About 600 candidates from four sources (5.2): shared interests, the
   * viewer's taste, the under-seen, and the new. Topped up from everyone
   * ready when the sources come up short.
   */
  static async gather(me: User, day: string, flags: Flags, taste: TasteProfile | null, gate: { photos: number; activeDays: number }, receiveLimit: number) {
    const ready = this.readySql(me, day, flags, gate, receiveLimit);
    const seedOf = (salt: string) => [...`${me.id}|${day}|${salt}`].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 1048576, 7);
    const ring = (salt: string) => Prisma.sql`((u.discovery_sample - ${seedOf(salt)} + 1048576) % 1048576), u.id`;
    const mine = normalizeInterests(((me.preferences ?? {}) as Record<string, unknown>).interests).map(norm).filter(Boolean);
    const departments = likedValues(taste, 'department');
    const years = likedValues(taste, 'year').map(Number).filter(Number.isInteger);

    const interestsShare = Math.round(GATHER_BUDGET * 0.4);
    const tasteShare = departments.length || years.length ? Math.round(GATHER_BUDGET * 0.3) : 0;
    const newShare = Math.round(GATHER_BUDGET * 0.1);
    const underseenShare = GATHER_BUDGET - interestsShare - tasteShare - newShare;

    const interestsArray = Prisma.sql`(CASE WHEN jsonb_typeof(u.preferences->'interests') = 'array' THEN u.preferences->'interests' ELSE '[]'::jsonb END)`;
    const [byInterests, byTaste, underseenPool, byNew] = await Promise.all([
      mine.length
        ? this.query(me, ready, Prisma.sql`AND ${interestsArray} ?| ${mine}::text[]`,
          Prisma.sql`(SELECT count(*) FROM jsonb_array_elements_text(${interestsArray}) t WHERE lower(t) = ANY(${mine}::text[])) DESC, ${ring('interests')}`,
          interestsShare)
        : Promise.resolve([] as string[]),
      tasteShare
        ? this.query(me, ready, Prisma.sql`AND (lower(trim(coalesce(u.department, ''))) = ANY(${departments}::text[]) OR u.year_of_study = ANY(${years}::int[]))`,
          ring('taste'), tasteShare)
        : Promise.resolve([] as string[]),
      this.query(me, ready, Prisma.empty, ring('underseen'), underseenShare * 3),
      this.query(me, ready, Prisma.sql`AND u.created_at >= ${new Date(Date.now() - 14 * DAY_MS)}`, Prisma.sql`u.created_at DESC, u.id`, newShare),
    ]);
    // The under-seen: of a wide random slice, those shown least this past week.
    const seen = await this.appearancesSince(dayFrom(day, -7), underseenPool);
    const underseen = [...underseenPool].sort((a, b) => (seen.get(a) ?? 0) - (seen.get(b) ?? 0)).slice(0, underseenShare);

    const ids = [...new Set([...byInterests, ...byTaste, ...underseen, ...byNew])];
    if (ids.length < GATHER_BUDGET / 3) {
      const fill = await this.query(me, ready, Prisma.sql`AND NOT (u.id = ANY(${ids}::uuid[]))`, ring('fill'), GATHER_BUDGET - ids.length);
      ids.push(...fill);
    }
    return ids;
  }

  /** How many sets each of `ids` was in, from `since` (an IST day) to today. */
  static async appearancesSince(since: string, ids?: string[]) {
    if (ids && !ids.length) return new Map<string, number>();
    const rows = await prisma.$queryRaw<{ id: string; seen: number }[]>`
      SELECT pick AS id, count(*)::int AS seen FROM standout_days, unnest(picks) AS pick
      WHERE day >= ${since} ${ids ? Prisma.sql`AND picks && ${ids}::uuid[] AND pick = ANY(${ids}::uuid[])` : Prisma.empty}
      GROUP BY pick`;
    return new Map(rows.map((row) => [row.id, row.seen]));
  }

  /**
   * The viewer's taste (5.3): their last 200 swipes, a Rose sent counting as
   * three Likes, and anyone they marked "Not for me" lately as half a Pass.
   */
  static async taste(me: User, day: string, flags: Flags): Promise<TasteProfile> {
    const swipes = await prisma.swipe.findMany({
      where: { swiperId: me.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, targetId: true, action: true },
    });
    const [roses, hiddenRows] = await Promise.all([
      swipes.length
        ? prisma.rose.findMany({ where: { senderId: me.id, swipeId: { in: swipes.map((swipe) => swipe.id) } }, select: { swipeId: true } })
        : Promise.resolve([] as { swipeId: string | null }[]),
      prisma.standoutDay.findMany({
        where: { viewerId: me.id, day: { gte: dayFrom(day, -flags.standouts_hide_days) } },
        select: { hidden: true },
      }),
    ]);
    const rosed = new Set(roses.map((rose) => rose.swipeId));
    const swiped = new Set(swipes.map((swipe) => swipe.targetId));
    const hidden = [...new Set(hiddenRows.flatMap((row) => row.hidden))].filter((id) => !swiped.has(id));
    const people = await prisma.user.findMany({ where: { id: { in: [...swiped, ...hidden] } }, select: TRAIT_SELECT });
    const traitsById = new Map(people.map((person) => [person.id, traitKeys(traitsOf(person))]));
    return buildTaste([
      ...swipes.flatMap((swipe) => {
        const traits = traitsById.get(swipe.targetId);
        if (!traits) return [];
        const liked = swipe.action === 'like';
        return [{ traits, liked, weight: liked && rosed.has(swipe.id) ? ROSE_WEIGHT : 1 }];
      }),
      ...hidden.flatMap((id) => {
        const traits = traitsById.get(id);
        return traits ? [{ traits, liked: false, weight: NOT_FOR_ME_WEIGHT }] : [];
      }),
    ]);
  }

  /**
   * Scores each candidate for `me` (5.3), and marks who can fill the new-face
   * and wildcard slots. Anyone shown to `me` in the past week sinks to the
   * bottom, used only when there is no one else (5.5).
   */
  static async rank(me: User, ids: string[], day: string, config: AlgorithmConfig, taste: TasteProfile | null): Promise<Ranked[]> {
    if (!ids.length) return [];
    const { flags } = config;
    const [profiles, points, seen, recentRows] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids } },
        select: {
          ...TRAIT_SELECT, clubs: true, discoveryMode: true, college: true, hangoutSpots: true,
          lastActiveAt: true, createdAt: true, discoveryCategory: true, realPersonVerifiedAt: true,
          studentMembership: { select: { institutionId: true, status: true } },
        },
      }),
      ReciprocityService.batch(me, ids).catch(() => new Map<string, number>()),
      this.appearancesSince(dayFrom(day, -7), ids),
      prisma.standoutDay.findMany({ where: { viewerId: me.id, day: { gte: dayFrom(day, -7), lt: day } }, select: { picks: true } }),
    ]);
    const recent = new Set(recentRows.flatMap((row) => row.picks));
    const now = Date.now();
    const weights = {
      compat: flags.standouts_weight_compat, taste: flags.standouts_weight_taste,
      reciprocity: flags.standouts_weight_reciprocity, fresh: flags.standouts_weight_fresh,
    };
    const likedDepartments = likedValues(taste, 'department');
    const myDepartment = norm(me.department);
    return profiles
      .map((profile): Ranked => {
        const compat = compatibility(me, profile, config.weights).score;
        const score = combinedScore({
          compat,
          taste: tasteScore(taste, traitKeys(traitsOf(profile))),
          reciprocity: reciprocityScore(points.get(profile.id)),
          fresh: freshnessScore((profile.lastActiveAt ?? profile.createdAt).getTime(), now),
        }, weights) + underseenBoost(seen.get(profile.id) ?? 0, flags.standouts_underseen_boost)
          // Passed the real-person check: a little ahead (PHOTO_VERIFICATION_PLAN.md).
          + (profile.realPersonVerifiedAt ? flags.standouts_real_person_boost : 0);
        const department = norm(profile.department) || null;
        const verified = profile.studentMembership?.status === 'verified';
        return {
          id: profile.id,
          // Shown in the past week: only when nobody else is left.
          score: recent.has(profile.id) ? score - 1000 : score,
          department,
          year: profile.yearOfStudy,
          seeking: norm(profile.seeking) || null,
          isNew: now - profile.createdAt.getTime() <= 14 * DAY_MS,
          wildcard: (compat ?? 0) >= 60 && (likedDepartments.length ? !likedDepartments.includes(department ?? '') : department !== myDepartment),
          segment: `${verified ? profile.studentMembership!.institutionId : 'group'}:${profile.discoveryCategory ?? 'unknown'}`,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /** Gathers, relaxing the ready check step by step until the pool is big enough (5.1). */
  private static async pool(me: User, day: string, flags: Flags, taste: TasteProfile | null, receiveLimit: number) {
    const steps = gates(flags);
    let ids: string[] = [];
    let relaxed = false;
    for (const [index, gate] of steps.entries()) {
      ids = await this.gather(me, day, flags, taste, gate, receiveLimit);
      relaxed = index > 0;
      if (ids.length >= 24) break;
    }
    return { ids, relaxed };
  }

  private static variety(flags: Flags): VarietyLimits {
    return { maxPerDepartment: flags.standouts_max_per_department, maxPerYear: flags.standouts_max_per_year };
  }

  /**
   * One viewer's set, on a first open the night run did not cover (6): the
   * same steps, inside the limits left. The limits come from the night run's
   * record when there is one, otherwise from today's numbers so far.
   */
  static async chooseForViewer(viewer: User, day: string): Promise<DaySet> {
    const me = asViewer(viewer);
    const config = await AlgorithmConfigService.get();
    const { flags } = config;
    const receiveLimit = Math.max(1, Math.floor(flags.roses_receive_limit));
    const taste = await this.taste(me, day, flags);
    const { ids, relaxed } = await this.pool(me, day, flags, taste, receiveLimit);
    const size = setSize(ids.length, flags.standouts_size);
    if (!size) return { picks: [], slots: [], taste, relaxed };
    const ranked = await this.rank(me, ids, day, config, taste);
    const run = await prisma.standoutRun.findUnique({ where: { day }, select: { limits: true, mode: true } });
    const known = run?.mode === 'live' ? (run.limits as Record<string, number>) : {};
    const sets = await prisma.standoutDay.count({ where: { day } });
    const supply = new Map<string, number>();
    for (const candidate of ranked) supply.set(candidate.segment, (supply.get(candidate.segment) ?? 0) + 1);
    const limitOf = (segment: string) => known[segment]
      ?? fairLimit((sets + 1) * size * ((supply.get(segment) ?? 0) / ranked.length), supply.get(segment) ?? 0, flags.standouts_fair_multiplier);
    const appearances = await this.appearancesSince(day, ranked.map((candidate) => candidate.id));
    const builder = new SetBuilder(ranked, this.variety(flags));
    for (const slot of slotPlan(size)) {
      const chosen = builder.next(slot, (candidate) => (appearances.get(candidate.id) ?? 0) < limitOf(candidate.segment));
      if (!chosen) break;
      builder.add(chosen.candidate, chosen.slot);
    }
    return { picks: builder.picks, slots: builder.slots, taste, relaxed };
  }

  /**
   * The night run (6): everyone active this week, all at once, so the fair
   * limits and the round-robin see the whole campus. "live" writes the day's
   * sets; "shadow" (v3 switched off) only records what v3 would have chosen.
   */
  static async nightly(day: string, mode: 'live' | 'shadow') {
    const started = Date.now();
    const config = await AlgorithmConfigService.get();
    const { flags } = config;
    const receiveLimit = Math.max(1, Math.floor(flags.roses_receive_limit));
    await prisma.standoutRun.upsert({
      where: { day },
      create: { day, mode },
      update: { mode, startedAt: new Date(), finishedAt: null },
    });

    const candidates = await prisma.user.findMany({
      where: {
        accountStatus: 'active',
        // Paused accounts can't open Standouts, so no set is made for them.
        pausedAt: null,
        preferencesConfirmedAt: { not: null },
        lastActiveAt: { gte: new Date(Date.now() - 7 * DAY_MS) },
      },
    });
    const covered = mode === 'live'
      ? new Set((await prisma.standoutDay.findMany({ where: { day }, select: { viewerId: true } })).map((row) => row.viewerId))
      : new Set<string>();
    const viewers = candidates.map(asViewer).filter((user) => setupComplete(user) && !covered.has(user.id));

    const entries: { id: string; list: Ranked[]; size: number; taste: TasteProfile; relaxed: boolean }[] = [];
    let next = 0;
    const work = async () => {
      while (next < viewers.length) {
        const me = viewers[next++];
        try {
          const taste = await this.taste(me, day, flags);
          const { ids, relaxed } = await this.pool(me, day, flags, taste, receiveLimit);
          const size = setSize(ids.length, flags.standouts_size);
          const list = size ? (await this.rank(me, ids, day, config, taste)).slice(0, NIGHT_LIST) : [];
          entries.push({ id: me.id, list, size, taste, relaxed });
        } catch (error) {
          logger.warn(`Standouts night run skipped a viewer: ${(error as Error).message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: NIGHT_WORKERS }, work));

    const limits = fairLimits(entries.map((entry) => entry.list), flags.standouts_size, flags.standouts_fair_multiplier);
    const appearances = await this.appearancesSince(day);
    const sets = roundRobin(entries, limits, this.variety(flags), day, appearances);

    let written = 0;
    let short = 0;
    for (const entry of entries) {
      const set = sets.get(entry.id)!;
      if (set.picks.length < entry.size) short += 1;
      if (mode === 'live') {
        const inserted = await prisma.$executeRaw`
          INSERT INTO standout_days (viewer_id, day, picks, hidden, slots, taste, version)
          VALUES (${entry.id}::uuid, ${day}, ${set.picks}::uuid[], ARRAY[]::uuid[], ${set.slots}::text[], ${JSON.stringify(entry.taste)}::jsonb, 'v3')
          ON CONFLICT (viewer_id, day) DO NOTHING`;
        written += inserted;
      } else {
        await prisma.standoutShadow.upsert({
          where: { viewerId_day: { viewerId: entry.id, day } },
          create: { viewerId: entry.id, day, picks: set.picks, slots: set.slots },
          update: { picks: set.picks, slots: set.slots },
        });
        written += 1;
      }
    }

    const summary = {
      viewers: entries.length,
      sets: written,
      shortSets: short,
      relaxed: entries.filter((entry) => entry.relaxed).length,
      durationMs: Date.now() - started,
      limits,
    };
    await prisma.standoutRun.update({ where: { day }, data: { ...summary, finishedAt: new Date() } });
    logger.info(`Standouts night run (${mode}) for ${day}: ${summary.sets} sets for ${summary.viewers} viewers in ${summary.durationMs} ms`);
    return summary;
  }
}
