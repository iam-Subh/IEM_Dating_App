export interface LoadSample {
  scenario: string;
  status: number | null;
  durationMs: number;
  error?: string;
}

export interface LoadSummary {
  requests: number;
  succeeded: number;
  failed: number;
  errorRate: number;
  throughputRps: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  statusCounts: Record<string, number>;
}

export interface LoadGate {
  maximumP95Ms: number;
  maximumErrorRate: number;
  minimumRequests: number;
}

function percentile(ordered: number[], fraction: number) {
  if (ordered.length === 0) return null;
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

export function summarizeLoad(samples: LoadSample[], elapsedMs: number): LoadSummary {
  const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const succeeded = samples.filter((sample) => sample.status !== null && sample.status >= 200 && sample.status < 300).length;
  const statusCounts: Record<string, number> = {};
  for (const sample of samples) {
    const key = sample.status === null ? 'network_error' : String(sample.status);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }
  return {
    requests: samples.length,
    succeeded,
    failed: samples.length - succeeded,
    errorRate: samples.length === 0 ? 1 : (samples.length - succeeded) / samples.length,
    throughputRps: elapsedMs <= 0 ? 0 : samples.length / (elapsedMs / 1000),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    statusCounts,
  };
}

export function evaluateLoad(summary: LoadSummary, gate: LoadGate) {
  const checks = {
    minimumRequests: summary.requests >= gate.minimumRequests,
    p95: summary.p95Ms !== null && summary.p95Ms <= gate.maximumP95Ms,
    errorRate: summary.errorRate <= gate.maximumErrorRate,
  };
  return { passed: Object.values(checks).every(Boolean), checks, gate };
}

