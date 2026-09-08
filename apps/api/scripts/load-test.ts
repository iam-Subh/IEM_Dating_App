import 'dotenv/config';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { evaluateLoad, LoadSample, summarizeLoad } from '../src/services/load-test-metrics';

type Target = { token: string; matchId?: string };
type Scenario = 'discovery' | 'conversation_list' | 'message_read' | 'message_send';

function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function targetsFromEnvironment(): Target[] {
  const discoveryTokens = (process.env.LOAD_TEST_DISCOVERY_TOKENS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  let chatTargets: Target[] = [];
  if (process.env.LOAD_TEST_CHAT_TARGETS) {
    const parsed = JSON.parse(process.env.LOAD_TEST_CHAT_TARGETS);
    if (!Array.isArray(parsed)) throw new Error('LOAD_TEST_CHAT_TARGETS must be a JSON array');
    chatTargets = parsed.map((item) => ({ token: String(item?.token ?? ''), matchId: String(item?.matchId ?? '') }));
    if (chatTargets.some((item) => !item.token || !/^[0-9a-f-]{36}$/i.test(item.matchId ?? ''))) {
      throw new Error('Each chat target requires a token and UUID matchId');
    }
  }
  return [...discoveryTokens.map((token) => ({ token })), ...chatTargets];
}

function scenariosFromEnvironment(targets: Target[]): Scenario[] {
  const requested = (process.env.LOAD_TEST_SCENARIOS ?? 'discovery,conversation_list')
    .split(',').map((value) => value.trim()).filter(Boolean) as Scenario[];
  const supported: Scenario[] = ['discovery', 'conversation_list', 'message_read', 'message_send'];
  if (requested.length === 0 || requested.some((value) => !supported.includes(value))) throw new Error('LOAD_TEST_SCENARIOS contains an unsupported scenario');
  if (requested.includes('message_send') && process.env.LOAD_TEST_ENABLE_WRITES !== 'true') {
    throw new Error('Set LOAD_TEST_ENABLE_WRITES=true to run message_send');
  }
  if (requested.some((value) => value === 'message_read' || value === 'message_send') && !targets.some((target) => target.matchId)) {
    throw new Error('Message scenarios require LOAD_TEST_CHAT_TARGETS');
  }
  return requested;
}

function selectTarget(targets: Target[], scenario: Scenario, index: number) {
  const eligible = scenario === 'message_read' || scenario === 'message_send' ? targets.filter((target) => target.matchId) : targets;
  return eligible[index % eligible.length];
}

async function request(baseUrl: string, scenario: Scenario, target: Target, timeoutMs: number): Promise<LoadSample> {
  let route = '/api/v1/discover/recommendations?limit=20';
  let method = 'GET';
  let body: string | undefined;
  if (scenario === 'conversation_list') route = '/api/v1/chat/conversations?limit=30';
  if (scenario === 'message_read') route = `/api/v1/chat/${target.matchId}/messages?limit=30`;
  if (scenario === 'message_send') {
    route = `/api/v1/chat/${target.matchId}/messages`;
    method = 'POST';
    body = JSON.stringify({ content: '[load-test]', clientMessageId: randomUUID() });
  }
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      body,
      signal: controller.signal,
      headers: { authorization: `Bearer ${target.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    });
    await response.arrayBuffer();
    return { scenario, status: response.status, durationMs: performance.now() - startedAt };
  } catch (error) {
    return { scenario, status: null, durationMs: performance.now() - startedAt, error: error instanceof Error ? error.name : 'request_error' };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const targetLabel = process.env.LOAD_TEST_TARGET_LABEL;
  if (!['local', 'staging'].includes(targetLabel ?? '')) throw new Error('LOAD_TEST_TARGET_LABEL must be local or staging');
  const baseUrl = (process.env.LOAD_TEST_BASE_URL ?? '').replace(/\/$/, '');
  const parsedBase = new URL(baseUrl);
  if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') throw new Error('LOAD_TEST_BASE_URL must use HTTP or HTTPS');
  if (targetLabel === 'local' && !['127.0.0.1', 'localhost'].includes(parsedBase.hostname)) throw new Error('A local load test must use localhost');
  const targets = targetsFromEnvironment();
  if (targets.length === 0) throw new Error('Provide at least one load-test access token');
  const scenarios = scenariosFromEnvironment(targets);
  const concurrency = integer('LOAD_TEST_CONCURRENCY', 10, 1, 200);
  const durationSeconds = integer('LOAD_TEST_DURATION_SECONDS', 60, 1, 1800);
  const timeoutMs = integer('LOAD_TEST_TIMEOUT_MS', 5000, 100, 120000);
  const maximumP95Ms = integer('LOAD_TEST_MAXIMUM_P95_MS', 500, 1, 120000);
  const maximumErrorPercent = integer('LOAD_TEST_MAXIMUM_ERROR_PERCENT', 1, 0, 100);
  const minimumRequests = integer('LOAD_TEST_MINIMUM_REQUESTS', concurrency * 10, 1, 10_000_000);
  const startedAt = new Date();
  const deadline = performance.now() + durationSeconds * 1000;
  const samples: LoadSample[] = [];
  let sequence = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < deadline) {
      const index = sequence++;
      const scenario = scenarios[index % scenarios.length];
      samples.push(await request(baseUrl, scenario, selectTarget(targets, scenario, index), timeoutMs));
    }
  }));
  const completedAt = new Date();
  const elapsedMs = completedAt.getTime() - startedAt.getTime();
  const byScenario = Object.fromEntries(scenarios.map((scenario) => {
    const subset = samples.filter((sample) => sample.scenario === scenario);
    return [scenario, summarizeLoad(subset, elapsedMs)];
  }));
  const summary = summarizeLoad(samples, elapsedMs);
  const evaluation = evaluateLoad(summary, { maximumP95Ms, maximumErrorRate: maximumErrorPercent / 100, minimumRequests });
  const report = {
    schemaVersion: 1,
    targetLabel,
    targetOrigin: parsedBase.origin,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds,
    concurrency,
    timeoutMs,
    scenarios,
    targetAccounts: targets.length,
    host: { platform: process.platform, node: process.version, cpuCount: os.cpus().length, memoryBytes: os.totalmem() },
    summary,
    byScenario,
    evaluation,
    limitations: ['Client-side HTTP measurement.', 'Result quality depends on fixture size, target infrastructure, and network location.', 'No access token or message content is stored in this report.'],
  };
  const output = path.resolve(process.env.LOAD_TEST_OUTPUT ?? `docs/verification/load-test-${targetLabel}-${Date.now()}.json`);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, summary, byScenario, evaluation }, null, 2));
  if (!evaluation.passed) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
