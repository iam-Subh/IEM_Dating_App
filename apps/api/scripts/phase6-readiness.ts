import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { AlgorithmConfigService } from '../src/services/algorithm-config.service';
import { AlgorithmMetricsService } from '../src/services/algorithm-metrics.service';
import { DiscoveryTelemetry } from '../src/services/discovery-telemetry.service';
import { prisma } from '../src/utils/prisma';
import { redisClient } from '../src/utils/redis';

function numberSetting(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be from ${minimum} through ${maximum}`);
  return value;
}

function ageHours(value: unknown) {
  if (!value) return null;
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? (Date.now() - timestamp) / 3_600_000 : null;
}

async function main() {
  const targetLabel = process.env.PHASE6_TARGET_LABEL;
  if (!['local', 'staging'].includes(targetLabel ?? '')) throw new Error('PHASE6_TARGET_LABEL must be local or staging');
  await DiscoveryTelemetry.flush();
  const [measurement, config] = await Promise.all([AlgorithmMetricsService.read(), AlgorithmConfigService.get()]);
  const reciprocity = (measurement.reciprocity as Array<Record<string, number>>)[0] ?? {};
  const candidates = Number(reciprocity.candidates ?? 0);
  const withEstimate = Number(reciprocity.withEstimate ?? 0);
  const failed = Number(reciprocity.failed ?? 0);
  const coverage = candidates > 0 ? withEstimate / candidates : null;
  const failedRate = candidates > 0 ? failed / candidates : null;
  const totalTimings = (measurement.timings as Array<Record<string, unknown>>).filter((row) => row.stage === 'totalMs');
  const worstTotalP95Ms = totalTimings.length > 0 ? Math.max(...totalTimings.map((row) => Number(row.p95Ms))) : null;
  const limits = {
    minimumCandidates: numberSetting('PHASE6_MINIMUM_RECIPROCITY_CANDIDATES', 1000, 1, 100_000_000),
    minimumCoverage: numberSetting('PHASE6_MINIMUM_RECIPROCITY_COVERAGE_PERCENT', 10, 0, 100) / 100,
    maximumFailureRate: numberSetting('PHASE6_MAXIMUM_RECIPROCITY_FAILURE_PERCENT', 1, 0, 100) / 100,
    maximumDiscoveryP95Ms: numberSetting('PHASE6_MAXIMUM_DISCOVERY_P95_MS', 500, 1, 120000),
    maximumEvidenceAgeHours: numberSetting('PHASE6_MAXIMUM_EVIDENCE_AGE_HOURS', 168, 1, 8760),
  };
  const evaluationAgeHours = ageHours((measurement.lastReciprocityEvaluation as any)?.createdAt);
  const shadowAgeHours = ageHours((measurement.lastShadowComparison as any)?.createdAt);
  const checks = {
    enoughCandidates: candidates >= limits.minimumCandidates,
    enoughCoverage: coverage !== null && coverage >= limits.minimumCoverage,
    queryFailureRate: failedRate !== null && failedRate <= limits.maximumFailureRate,
    discoveryLatency: worstTotalP95Ms !== null && worstTotalP95Ms <= limits.maximumDiscoveryP95Ms,
    currentReciprocityEvaluation: evaluationAgeHours !== null && evaluationAgeHours <= limits.maximumEvidenceAgeHours,
    currentShadowComparison: shadowAgeHours !== null && shadowAgeHours <= limits.maximumEvidenceAgeHours,
  };
  const report = {
    schemaVersion: 1,
    targetLabel,
    generatedAt: new Date().toISOString(),
    passed: Object.values(checks).every(Boolean),
    checks,
    limits,
    reciprocity: {
      candidates,
      withEstimate,
      coverage,
      failed,
      failedRate,
      belowHistory: Number(reciprocity.belowHistory ?? 0),
      belowSimilarity: Number(reciprocity.belowSimilarity ?? 0),
      malformed: Number(reciprocity.malformed ?? 0),
      missingViewerSignals: Number(reciprocity.missingViewerSignals ?? 0),
    },
    latency: { worstTotalP95Ms, totalTimings },
    evidenceAgeHours: { reciprocityEvaluation: evaluationAgeHours, shadowComparison: shadowAgeHours },
    algorithm: { flags: config.flags, weights: config.weights },
    telemetryWorker: DiscoveryTelemetry.status(),
    scope: 'Seven-day server telemetry. A passing report is required before a staged ranking rollout. It does not prove recommendation quality.',
  };
  const output = path.resolve(process.env.PHASE6_OUTPUT ?? `docs/verification/phase6-readiness-${targetLabel}-${Date.now()}.json`);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, passed: report.passed, checks, reciprocity: report.reciprocity, latency: report.latency, evidenceAgeHours: report.evidenceAgeHours }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await prisma.$disconnect();
  redisClient.disconnect();
});

