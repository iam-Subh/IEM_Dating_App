import { prisma } from '../utils/prisma';

export class AlgorithmMetricsService {
  static async read() {
    const [timings, reciprocity, states, evaluations, comparisons, rankingTimings] = await Promise.all([
      prisma.$queryRaw`SELECT event_data->>'kind' AS kind, stage.key AS stage, count(*)::int AS samples,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY stage.value::text::float8) AS "p50Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY stage.value::text::float8) AS "p95Ms"
        FROM analytics_events CROSS JOIN LATERAL jsonb_each(event_data) stage
        WHERE event_type='discovery_page_timings' AND created_at>=now()-interval '7 days'
        AND stage.key IN ('totalMs','deckMs','retrievalMs','rankingMs','claimMs','receiptMs')
        AND jsonb_typeof(stage.value)='number' GROUP BY event_data->>'kind',stage.key`,
      prisma.$queryRaw`SELECT count(*)::int AS batches,
        COALESCE(sum((r->'reciprocity'->>'candidates')::int),0)::float8 AS candidates,
        COALESCE(sum((r->'reciprocity'->>'withEstimate')::int),0)::float8 AS "withEstimate",
        COALESCE(sum((r->'reciprocity'->>'belowHistory')::int),0)::float8 AS "belowHistory",
        COALESCE(sum((r->'reciprocity'->>'belowSimilarity')::int),0)::float8 AS "belowSimilarity",
        COALESCE(sum((r->'reciprocity'->>'malformed')::int),0)::float8 AS malformed,
        COALESCE(sum((r->'reciprocity'->>'missingViewerSignals')::int),0)::float8 AS "missingViewerSignals",
        COALESCE(sum((r->'reciprocity'->>'failed')::int),0)::float8 AS failed
        FROM analytics_events CROSS JOIN LATERAL jsonb_array_elements(event_data->'ranking') r
        WHERE event_type='discovery_page_timings' AND created_at>=now()-interval '7 days'
        AND jsonb_typeof(r->'reciprocity')='object'`,
      prisma.$queryRaw`SELECT event_data->>'state' AS state,count(*)::int AS count FROM analytics_events
        WHERE event_type='discovery_deck_state' AND created_at>=now()-interval '7 days' GROUP BY event_data->>'state'`,
      prisma.analyticsEvent.findFirst({ where: { eventType: 'reciprocity_evaluation' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, eventData: true } }),
      prisma.analyticsEvent.findFirst({ where: { eventType: 'shadow_comparison_report' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, eventData: true } }),
      prisma.$queryRaw`SELECT event_data->>'algorithm' AS algorithm, count(*)::int AS batches,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY (r->>'compatibilityMs')::float8) AS "compatibilityP50Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (r->>'compatibilityMs')::float8) AS "compatibilityP95Ms",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY (r->'reciprocity'->>'elapsedMs')::float8) AS "reciprocityP50Ms",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (r->'reciprocity'->>'elapsedMs')::float8) AS "reciprocityP95Ms"
        FROM analytics_events CROSS JOIN LATERAL jsonb_array_elements(event_data->'ranking') r
        WHERE event_type='discovery_page_timings' AND created_at>=now()-interval '7 days'
        GROUP BY event_data->>'algorithm'`,
    ]);
    const coverage = (reciprocity as {candidates: number; withEstimate: number}[])[0];
    return { windowDays: 7, timings, rankingTimings, reciprocity,
      reciprocityCoverage: coverage?.candidates ? coverage.withEstimate / coverage.candidates : null,
      states, lastReciprocityEvaluation: evaluations,
      lastShadowComparison: comparisons, timingScope: 'Sampled pages. Deck includes retrieval and ranking; stage times must not be summed.' };
  }
}
