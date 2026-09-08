import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const rows = await db.shadowRanking.findMany({ where: { createdAt: { gte: new Date(Date.now()-7*86400000) } },
    orderBy: { createdAt: 'desc' }, take: 10000, select: { report: true } });
  const reports = rows.map(row => row.report as any).filter(row => row.metricsVersion === 2);
  const mean = (key: string) => {
    const values = reports.map(row => key.split('.').reduce((value,part)=>value?.[part],row)).filter(value => typeof value === 'number');
    return values.length ? values.reduce((a,b) => a+b,0)/values.length : null;
  };
  const result = { metricsVersion: 2, windowDays: 7, samples: reports.length, fetched: rows.length,
    capped: rows.length === 10000, top20Overlap: mean('top20Overlap'), meanAbsRankShift: mean('meanAbsRankShift'),
    evidenceCoverage: mean('evidenceCoverage'),
    configVersions: [...new Set(reports.map(row=>row.configVersion))],
    incomingPlacement: { controlTop20: mean('incomingPlacement.control.top20'),
      treatmentTop20: mean('incomingPlacement.treatment.top20'), controlMeanPosition: mean('incomingPlacement.control.meanPosition'),
      treatmentMeanPosition: mean('incomingPlacement.treatment.meanPosition') },
    top20Evidence: { control: mean('top20Evidence.control'), treatment: mean('top20Evidence.treatment') },
    scoreDistribution: { meanDeckMedian: mean('scoreDistribution.median'),
      meanDeckMin: mean('scoreDistribution.min'), meanDeckMax: mean('scoreDistribution.max') },
    experimentScope: 'rebuilt_scoring_policy_on_vs_off', legacyBaseline: false };
  await db.analyticsEvent.create({ data: { eventType: 'shadow_comparison_report', eventData: result } });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode=1; }).finally(() => db.$disconnect());
