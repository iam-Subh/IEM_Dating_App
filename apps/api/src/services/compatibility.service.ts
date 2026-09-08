import { normalizeInterests } from "@iem-dating/shared/interest-catalog";
export const DEFAULT_COMPATIBILITY_WEIGHTS = {
  weight_interests: 0.3,
  weight_seeking: 0.25,
  weight_lifestyle: 0.15,
  weight_clubs: 0.05,
  weight_campus: 0.1,
  weight_personality: 0.1,
  weight_hangouts: 0.05,
};
export type CompatibilityWeights = typeof DEFAULT_COMPATIBILITY_WEIGHTS;
type Profile = {
  preferences: unknown;
  seeking: string | null;
  clubs: string[];
  discoveryMode?: string | null;
  college?: string | null;
  department?: string | null;
  campus?: string | null;
  yearOfStudy?: number | null;
  isHosteller?: boolean | null;
  hangoutSpots?: string[];
};
const norm = (s: string) => s.trim().toLowerCase();
const strings = (x: unknown): string[] =>
  Array.isArray(x)
    ? [
        ...new Set(
          x.filter((v): v is string => typeof v === "string").map(norm),
        ),
      ].filter(Boolean)
    : [];
const object = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : {};
export function compatibility(
  a: Profile,
  b: Profile,
  weights: CompatibilityWeights = DEFAULT_COMPATIBILITY_WEIGHTS,
) {
  const factors: {
    id: string;
    label: string;
    similarity: number;
    weight: number;
    sharedValues: string[];
    points: number;
    boost: string;
  }[] = [];
  const addSet = (
    id: "interests" | "clubs" | "hangouts",
    left: unknown,
    right: unknown,
  ) => {
    const x = strings(id === "interests" ? normalizeInterests(left) : left),
      y = strings(id === "interests" ? normalizeInterests(right) : right);
    if (!x.length || !y.length) return;
    const shared = x.filter((v) => y.includes(v)).sort();
    factors.push({
      id,
      label: `${shared.length} shared ${id}`,
      similarity: shared.length / new Set([...x, ...y]).size,
      weight: weights[`weight_${id}`],
      sharedValues: shared,
      points: 0,
      boost: "",
    });
  };
  const ap = object(a.preferences),
    bp = object(b.preferences);
  addSet("interests", ap.interests, bp.interests);
  addSet("clubs", a.clubs, b.clubs);
  addSet("hangouts", a.hangoutSpots, b.hangoutSpots);
  const addGroup = (
    id: "campus" | "personality",
    label: string,
    values: number[],
  ) => {
    if (!values.length) return;
    factors.push({
      id,
      label,
      similarity: values.reduce((s, v) => s + v, 0) / values.length,
      weight:
        (weights[`weight_${id}`] * values.length) / (id === "campus" ? 4 : 3),
      sharedValues: [],
      points: 0,
      boost: "",
    });
  };
  // Campus context is comparable only within the same college and discovery mode.
  if (
    a.discoveryMode === "college" &&
    b.discoveryMode === "college" &&
    a.college?.trim() &&
    b.college?.trim() &&
    norm(a.college) === norm(b.college)
  ) {
    const values: number[] = [];
    for (const key of ["department", "campus"] as const)
      if (a[key]?.trim() && b[key]?.trim())
        values.push(norm(a[key]!) === norm(b[key]!) ? 1 : 0);
    if (
      Number.isInteger(a.yearOfStudy) &&
      Number.isInteger(b.yearOfStudy) &&
      a.yearOfStudy! >= 1 &&
      a.yearOfStudy! <= 10 &&
      b.yearOfStudy! >= 1 &&
      b.yearOfStudy! <= 10
    )
      values.push(
        Math.max(0, 1 - Math.abs(a.yearOfStudy! - b.yearOfStudy!) / 3),
      );
    if (
      typeof a.isHosteller === "boolean" &&
      typeof b.isHosteller === "boolean"
    )
      values.push(a.isHosteller === b.isHosteller ? 1 : 0);
    addGroup("campus", "Campus context", values);
  }
  const personalityA = object(ap.personality),
    personalityB = object(bp.personality);
  // These measure stated similarity, not psychological compatibility. Exclude astrology.
  addGroup(
    "personality",
    "Stated personality preferences",
    ["personality", "love_reception", "communication"].flatMap((key) => {
      const left = personalityA[key],
        right = personalityB[key];
      return typeof left === "string" &&
        typeof right === "string" &&
        left.trim() &&
        right.trim()
        ? [norm(left) === norm(right) ? 1 : 0]
        : [];
    }),
  );
  if (a.seeking?.trim() && b.seeking?.trim()) {
    const x = norm(a.seeking),
      y = norm(b.seeking);
    const intents: Record<string, string[]> = {
      "long-term partner": ["long"],
      "long-term, but short-term ok": ["long", "short"],
      "short-term, but long-term ok": ["long", "short"],
      "short-term fun": ["short"],
      "new friends": ["friendship"],
      "long-term": ["long"],
      relationship: ["long"],
      casual: ["short"],
      friendship: ["friendship"],
    };
    // Ambiguous or unknown intent is missing evidence, not agreement or rejection.
    const left = Object.prototype.hasOwnProperty.call(intents, x)
      ? intents[x]
      : undefined;
    const right = Object.prototype.hasOwnProperty.call(intents, y)
      ? intents[y]
      : undefined;
    const similarity =
      x === y ? 1 : left?.some((value) => right?.includes(value)) ? 0.5 : 0;
    if (left && right)
      factors.push({
        id: "seeking",
        label: "Relationship intent",
        similarity,
        weight: weights.weight_seeking,
        sharedValues: x === y ? [x] : [],
        points: 0,
        boost: "",
      });
  }
  const al = object(ap.lifestyle),
    bl = object(bp.lifestyle);
  const keys = ["drink", "smoke", "exercise", "pets"].filter(
    (k) =>
      typeof al[k] === "string" &&
      typeof bl[k] === "string" &&
      (al[k] as string).trim() &&
      (bl[k] as string).trim(),
  );
  if (keys.length)
    factors.push({
      id: "lifestyle",
      label: "Lifestyle preferences",
      similarity:
        keys.filter((k) => norm(al[k] as string) === norm(bl[k] as string))
          .length / keys.length,
      weight: (weights.weight_lifestyle * keys.length) / 4,
      sharedValues: [],
      points: 0,
      boost: "",
    });
  const comparable = factors.filter((f) => f.weight > 0);
  const coverage = comparable.reduce((n, f) => n + f.weight, 0);
  const enough = comparable.length >= 2 && coverage >= 0.5;
  for (const f of comparable) {
    f.points = Math.round((1000 * f.weight * f.similarity) / coverage) / 10;
    f.boost = `${f.points} points`;
  }
  return {
    score: enough
      ? Math.round(
          comparable.reduce(
            (n, f) => n + (100 * f.weight * f.similarity) / coverage,
            0,
          ),
        )
      : null,
    coverage,
    factors: enough ? comparable : [],
    version: 4,
  };
}
