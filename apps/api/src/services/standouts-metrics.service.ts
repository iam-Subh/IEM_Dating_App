import { prisma } from '../utils/prisma';
import { AlgorithmConfigService } from './algorithm-config.service';
import { istDay } from './discovery-cards.service';
import { dayFrom } from './standouts-v3.service';

/**
 * How Standouts is doing (apps/mobile/src/features/discovery/STANDOUTS_PLAN.md,
 * section 8), for the admin dashboard. Counts and rates only - never who.
 */

/**
 * Inequality of a set of counts, 0 (everyone equal) to 1 (one person has all).
 * Hinge's likes are 0.63-0.73; Standouts aims well below.
 */
export function gini(values: number[]) {
  const sorted = values.filter((value) => value >= 0).sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (!n || !total) return 0;
  const weighted = sorted.reduce((sum, value, index) => sum + (index + 1) * value, 0);
  return Math.round(((2 * weighted) / (n * total) - (n + 1) / n) * 1000) / 1000;
}

export class StandoutsMetricsService {
  static async summary(days = 7) {
    const span = Math.min(60, Math.max(1, Math.floor(days)));
    const today = istDay();
    const since = dayFrom(today, -(span - 1));
    const sinceInstant = new Date(`${since}T00:00:00+05:30`);
    const { flags } = await AlgorithmConfigService.get();

    const [roseRows, readyRows, appearanceRows, roseReceived, setRows, runs, shadowRows] = await Promise.all([
      // A Rose "from Standouts": its recipient was in the sender's set that IST day.
      prisma.$queryRaw<{ total: number; matched: number }[]>`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM matches m WHERE
            (m.user1_id = r.sender_id AND m.user2_id = r.recipient_id) OR (m.user2_id = r.sender_id AND m.user1_id = r.recipient_id)))::int AS matched
        FROM roses r JOIN standout_days d ON d.viewer_id = r.sender_id
          AND d.day = to_char(r.created_at + interval '5 hours 30 minutes', 'YYYY-MM-DD')
          AND r.recipient_id = ANY(d.picks)
        WHERE r.created_at >= ${sinceInstant}`,
      // Ready people (5.1, without any one viewer's filters): who could be picked at all.
      prisma.$queryRaw<{ id: string }[]>`
        SELECT u.id FROM users u
        WHERE u.account_status = 'active' AND u.profile_video_url IS NOT NULL
          AND coalesce(u.last_active_at, u.created_at) >= ${new Date(Date.now() - flags.standouts_active_days * 86_400_000)}
          AND EXISTS (SELECT 1 FROM student_memberships m WHERE m.user_id = u.id AND m.status = 'verified')
          AND (SELECT count(*) FROM profile_photos p WHERE p.user_id = u.id) >= 2`,
      prisma.$queryRaw<{ id: string; seen: number }[]>`
        SELECT pick AS id, count(*)::int AS seen FROM standout_days, unnest(picks) AS pick
        WHERE day >= ${since} GROUP BY pick`,
      prisma.$queryRaw<{ id: string; received: number }[]>`
        SELECT recipient_id AS id, count(*)::int AS received FROM roses
        WHERE created_at >= ${sinceInstant} GROUP BY recipient_id`,
      prisma.$queryRaw<{ sets: number; short: number; v3: number }[]>`
        SELECT count(*)::int AS sets,
          count(*) FILTER (WHERE cardinality(picks) < ${flags.standouts_size})::int AS short,
          count(*) FILTER (WHERE version = 'v3')::int AS v3
        FROM standout_days WHERE day >= ${since}`,
      prisma.standoutRun.findMany({ where: { day: { gte: since } }, orderBy: { day: 'desc' } }),
      prisma.$queryRaw<{ overlap: number }[]>`
        SELECT avg(cardinality(ARRAY(SELECT unnest(s.picks) INTERSECT SELECT unnest(d.picks)))::float
          / GREATEST(1, cardinality(s.picks)))::float AS overlap
        FROM standout_shadow s JOIN standout_days d ON d.viewer_id = s.viewer_id AND d.day = s.day
        WHERE s.day >= ${since}`,
    ]);

    const ready = new Set(readyRows.map((row) => row.id));
    const seen = new Map(appearanceRows.map((row) => [row.id, row.seen]));
    const received = new Map(roseReceived.map((row) => [row.id, row.received]));
    // Everyone ready counts, including those never shown: that is what fairness is about.
    const everyone = new Set([...ready, ...seen.keys()]);
    const covered = [...ready].filter((id) => (seen.get(id) ?? 0) > 0).length;
    const roses = roseRows[0] ?? { total: 0, matched: 0 };
    const sets = setRows[0] ?? { sets: 0, short: 0, v3: 0 };

    return {
      days: span,
      since,
      roseAnswerRate: {
        rosesFromStandouts: roses.total,
        becameMatches: roses.matched,
        rate: roses.total ? Math.round((roses.matched / roses.total) * 1000) / 1000 : null,
      },
      coverage: {
        readyProfiles: ready.size,
        shownAtLeastOnce: covered,
        rate: ready.size ? Math.round((covered / ready.size) * 1000) / 1000 : null,
        target: 0.7,
      },
      fairness: {
        appearancesGini: gini([...everyone].map((id) => seen.get(id) ?? 0)),
        rosesReceivedGini: gini([...everyone].map((id) => received.get(id) ?? 0)),
        hingeLikesGini: { men: 0.73, women: 0.63 },
      },
      sets: {
        total: sets.sets,
        short: sets.short,
        byV3: sets.v3,
        size: flags.standouts_size,
      },
      shadowOverlap: shadowRows[0]?.overlap ?? null,
      runs: runs.map((run) => ({
        day: run.day, mode: run.mode, viewers: run.viewers, sets: run.sets, shortSets: run.shortSets,
        relaxed: run.relaxed, durationMs: run.durationMs, finished: !!run.finishedAt,
      })),
      settings: {
        v3: flags.standouts_v3 === 1,
        shadow: flags.standouts_shadow === 1,
      },
    };
  }
}
