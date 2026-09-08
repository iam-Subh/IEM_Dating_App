import "dotenv/config";
import { prisma } from "../src/utils/prisma";
import { evaluateHistory } from "../src/services/reciprocity-evaluation";
import { InterestSignals } from "../src/services/reciprocity.service";
async function main() {
  const rows = await prisma.$queryRaw<
    { actor: string; action: string; signals: InterestSignals | null }[]
  >`
    WITH actors AS (SELECT swiper_id FROM swipes WHERE target_signals IS NOT NULL
      AND created_at>=now()-interval '90 days' GROUP BY swiper_id HAVING count(*)>=50
      ORDER BY swiper_id LIMIT 1000)
    SELECT a.swiper_id AS actor,s.action,s.target_signals AS signals FROM actors a
    CROSS JOIN LATERAL (SELECT id,action,target_signals,created_at FROM swipes
      WHERE swiper_id=a.swiper_id
      AND action IN ('like','pass') AND created_at>=now()-interval '90 days' ORDER BY created_at DESC,id LIMIT 240) s
    ORDER BY a.swiper_id,s.created_at,s.id DESC`;
  const actors = new Map<
    string,
    { signals: InterestSignals | null; liked: boolean }[]
  >();
  for (const row of rows) {
    const history = actors.get(row.actor) ?? [];
    history.push({ signals: row.signals, liked: row.action === "like" });
    actors.set(row.actor, history);
  }
  const totals = {
    evaluated: 0,
    predicted: 0,
    brierSum: 0,
    baselineBrierSum: 0,
    logLossSum: 0,
  };
  for (const history of actors.values()) {
    const result = evaluateHistory(history);
    for (const key of Object.keys(totals) as (keyof typeof totals)[])
      totals[key] += result[key];
  }
  const report = {
        modelVersion: 1,
        actors: actors.size,
        evaluated: totals.evaluated,
        predicted: totals.predicted,
        coverage: totals.evaluated ? totals.predicted / totals.evaluated : 0,
        brier: totals.predicted ? totals.brierSum / totals.predicted : null,
        baselineBrier: totals.predicted
          ? totals.baselineBrierSum / totals.predicted
          : null,
        logLoss: totals.predicted ? totals.logLossSum / totals.predicted : null,
        limitation:
          "Chronological observational evaluation. Does not correct exposure selection bias or prove causal match lift.",
      };
  await prisma.analyticsEvent.create({ data: { eventType: "reciprocity_evaluation", eventData: report } });
  console.log(JSON.stringify(report, null, 2));
}
main().finally(() => prisma.$disconnect());
