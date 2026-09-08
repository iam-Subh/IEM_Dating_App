import { prisma } from "../utils/prisma";
import { HttpError } from "../utils/httpError";
import {
  DEFAULT_COMPATIBILITY_WEIGHTS,
  CompatibilityWeights,
} from "./compatibility.service";
export const DEFAULT_FLAGS = {
  reco_rollout_pct: 0,
  shadow_enabled: 0,
  shadow_sample_rate: 0.01,
  shadow_max_queue: 20,
  candidate_budget: 400,
  cold_slots_per_10: 2,
  incoming_slots_per_10: 1,
  reciprocity_enabled: 1,
  max_pending_per_profile: 20,
  exposure_reservation_seconds: 120,
};
export type AlgorithmConfig = {
  flags: typeof DEFAULT_FLAGS;
  weights: CompatibilityWeights;
  version: string;
};
export function validateConfig(
  values: Record<string, unknown>,
  kind: "flags" | "weights",
) {
  const defaults =
    kind === "flags" ? DEFAULT_FLAGS : DEFAULT_COMPATIBILITY_WEIGHTS;
  if (
    !values ||
    Array.isArray(values) ||
    typeof values !== "object" ||
    !Object.keys(values).length
  )
    throw new HttpError(400, "Supply configuration values");
  for (const [key, value] of Object.entries(values)) {
    if (
      !Object.prototype.hasOwnProperty.call(defaults, key) ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    )
      throw new HttpError(400, `Invalid configuration: ${key}`);
    const max =
      key === "max_pending_per_profile"
        ? 100
        : key === "exposure_reservation_seconds"
          ? 300
          : key === "cold_slots_per_10"
            ? 4
            : key === "incoming_slots_per_10"
              ? 2
              : key === "candidate_budget"
                ? 800
                : key === "shadow_max_queue"
                  ? 100
                  : key === "reco_rollout_pct"
                    ? 100
                    : 1;
    if (
      value > max ||
      ([
        "candidate_budget",
        "shadow_max_queue",
        "shadow_enabled",
        "cold_slots_per_10",
        "incoming_slots_per_10",
        "reciprocity_enabled",
        "max_pending_per_profile",
        "exposure_reservation_seconds",
      ].includes(key) &&
        !Number.isInteger(value)) ||
      (key === "candidate_budget" && value < 40) ||
      (key === "max_pending_per_profile" && value < 1) ||
      (key === "exposure_reservation_seconds" && value < 30)
    )
      throw new HttpError(400, `Invalid range: ${key}`);
  }
}
export class AlgorithmConfigService {
  // Read on generation. No per-instance cache can delay a kill switch.
  static async get(): Promise<AlgorithmConfig> {
    const fallback = {
      flags: { ...DEFAULT_FLAGS },
      weights: { ...DEFAULT_COMPATIBILITY_WEIGHTS },
      version: "ranking-v7:default",
    };
    try {
      const rows = await prisma.algorithmConfig.findMany();
      for (const row of rows) {
        const kind = Object.prototype.hasOwnProperty.call(
          DEFAULT_FLAGS,
          row.key,
        )
          ? "flags"
          : Object.prototype.hasOwnProperty.call(
                DEFAULT_COMPATIBILITY_WEIGHTS,
                row.key,
              )
            ? "weights"
            : null;
        if (!kind) continue;
        validateConfig({ [row.key]: row.value }, kind);
        (fallback[kind] as Record<string, number>)[row.key] = row.value;
      }
      // Legacy weights are not compatibility weights. Only use a complete v3 set.
      const marker = rows.find((r) => r.key === "compatibility_v3");
      if (
        marker?.value !== 1 ||
        !Object.keys(DEFAULT_COMPATIBILITY_WEIGHTS).every((key) =>
          rows.some((row) => row.key === key),
        )
      )
        fallback.weights = { ...DEFAULT_COMPATIBILITY_WEIGHTS };
      const sum = Object.values(fallback.weights).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 0.00001)
        fallback.weights = { ...DEFAULT_COMPATIBILITY_WEIGHTS };
      fallback.version =
        "ranking-v7:" +
        rows.reduce((s, r) => Math.max(s, r.updatedAt.getTime()), 0).toString();
      return fallback;
    } catch {
      return {
        flags: { ...DEFAULT_FLAGS },
        weights: { ...DEFAULT_COMPATIBILITY_WEIGHTS },
        version: "ranking-v7:fallback",
      };
    }
  }
  static async update(
    actor: string,
    values: Record<string, unknown>,
    kind: "flags" | "weights",
    reason: string,
  ) {
    validateConfig(values, kind);
    if (typeof reason !== "string" || !reason.trim() || reason.length > 1000)
      throw new HttpError(
        400,
        "A change reason of 1–1000 characters is required",
      );
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(48151623)`;
      const rows = await tx.algorithmConfig.findMany();
      const previous = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      const defaults =
        kind === "weights" ? DEFAULT_COMPATIBILITY_WEIGHTS : DEFAULT_FLAGS;
      const next: Record<string, number> = { ...defaults };
      if (kind === "flags" || previous.compatibility_v3 === 1)
        for (const k of Object.keys(defaults))
          if (previous[k] !== undefined) next[k] = previous[k];
      Object.assign(next, values);
      validateConfig(next, kind);
      if (
        kind === "weights" &&
        Math.abs(Object.values(next).reduce((a, b) => a + b, 0) - 1) > 0.00001
      )
        throw new HttpError(400, "Merged weights must sum to 1");
      for (const [key, value] of Object.entries(next))
        await tx.algorithmConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        });
      if (kind === "weights")
        await tx.algorithmConfig.upsert({
          where: { key: "compatibility_v3" },
          create: { key: "compatibility_v3", value: 1 },
          update: { value: 1 },
        });
      await tx.analyticsEvent.create({
        data: {
          userId: actor,
          eventType: "algorithm_config_changed",
          eventData: { kind, previous, next, reason },
        },
      });
      return next;
    });
  }
}
