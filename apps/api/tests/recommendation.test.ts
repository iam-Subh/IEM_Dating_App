import { test } from "node:test";
import assert from "node:assert/strict";
import { User } from "@prisma/client";
import {
  compatibility,
  DEFAULT_COMPATIBILITY_WEIGHTS,
} from "../src/services/compatibility.service";
import {
  ageAt,
  mutuallyEligible,
  discoverySettingsSchema,
} from "../src/services/eligibility.service";
import { boundingBox, haversineKm } from "../src/utils/geo";
import {
  encodeCursor,
  decodeCursor,
  assignment,
} from "../src/services/deck.service";
import { validateConfig } from "../src/services/algorithm-config.service";
import {
  compatibilityValue,
  compatibilityLabel,
} from "../../mobile/src/features/discovery/compatibility";
process.env.DISCOVERY_CURSOR_SECRET = "unit-test-signing-key";
const now = new Date("2026-09-06T00:00:00Z");
const fixture = (id: string, category: string, show: string[]) =>
  ({
    id,
    birthday: new Date("2003-01-01"),
    accountStatus: 'active',
    discoveryCategory: category,
    showMeCategories: show,
    minAgePref: 18,
    maxAgePref: 30,
    discoveryMode: "college",
    college: "IEM",
    preferencesConfirmedAt: now,
  }) as User;
test("eligibility is mutual for every category and nonempty preference subset", () => {
  const categories = ["man", "woman", "nonbinary"];
  const subsets = Array.from({ length: 7 }, (_, mask) =>
    categories.filter((_, i) => (mask + 1) & (1 << i)),
  );
  for (const x of categories)
    for (const y of categories)
      for (const sx of subsets)
        for (const sy of subsets) {
          const a = fixture("a", x, sx),
            b = fixture("b", y, sy);
          assert.equal(
            mutuallyEligible(a, b, now),
            sx.includes(y) && sy.includes(x),
          );
          assert.equal(
            mutuallyEligible(a, b, now),
            mutuallyEligible(b, a, now),
          );
        }
});
test("missing confirmation, inactive account, minor, self and incompatible mode are excluded", () => {
  const a = fixture("a", "man", ["woman"]),
    b = fixture("b", "woman", ["man"]);
  for (const patch of [
    { preferencesConfirmedAt: null },
    { accountStatus: 'restricted' },
    { birthday: new Date("2010-01-01") },
    { discoveryMode: "distance" },
    { id: "a" },
    { minAgePref: 25 },
  ]) {
    assert.equal(mutuallyEligible(a, { ...b, ...patch }, now), false);
  }
});
test("age uses UTC calendar boundaries", () => {
  assert.equal(ageAt(new Date("2008-09-07"), now), 17);
  assert.equal(ageAt(new Date("2008-09-06"), now), 18);
  assert.equal(ageAt(null, now), null);
});
test("preferences reject invalid bounds and unknown categories", () => {
  const settings = {
    discoveryCategory: "man",
    showMeCategories: ["woman"],
    minAgePref: 30,
    maxAgePref: 18,
    discoveryMode: "college",
    distancePreference: 50,
  };
  assert.equal(discoverySettingsSchema.safeParse(settings).success, false);
  assert.equal(
    discoverySettingsSchema.safeParse({
      ...settings,
      minAgePref: 18,
      maxAgePref: 30,
    }).success,
    true,
  );
});
test("compatibility is symmetric and reports insufficient data", () => {
  const a = {
    preferences: {
      interests: [" Music ", "books"],
      lifestyle: { drink: "no" },
    },
    seeking: "Long-term partner",
    clubs: [],
  };
  const b = {
    preferences: { interests: ["music"], lifestyle: { drink: "yes" } },
    seeking: "Long-term, but short-term OK",
    clubs: [],
  };
  assert.deepEqual(compatibility(a, b), compatibility(b, a));
  assert.equal(
    compatibility({ preferences: {}, seeking: null, clubs: [] }, b).score,
    null,
  );
  assert.equal(compatibility(a, a).score, 100);
  const result = compatibility(a, b, {
    ...DEFAULT_COMPATIBILITY_WEIGHTS,
    weight_clubs: 0,
    weight_interests: 0.5,
  });
  assert.ok(result.score !== null);
  assert.ok(
    Math.abs(
      result.factors.reduce((s, f) => s + f.points, 0) - result.score!,
    ) <= 0.6,
  );
});
test("zero score remains zero and zero weight contributes nothing", () => {
  const a = {
    preferences: { interests: ["a"] },
    seeking: "Long-term partner",
    clubs: ["a"],
  };
  const b = {
    preferences: { interests: ["b"] },
    seeking: "Short-term fun",
    clubs: ["b"],
  };
  assert.equal(compatibility(a, b).score, 0);
  assert.ok(
    !compatibility(a, b, {
      ...DEFAULT_COMPATIBILITY_WEIGHTS,
      weight_interests: 0.6,
      weight_seeking: 0.4,
      weight_clubs: 0,
      weight_lifestyle: 0,
    }).factors.some((f) => f.id === "clubs"),
  );
});
test("geometry handles coincident, antipodal, polar and wrapped points", () => {
  assert.equal(
    haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }),
    0,
  );
  assert.ok(
    Math.abs(
      haversineKm(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 180 },
      ) -
        Math.PI * 6371,
    ) < 1e-6,
  );
  assert.ok(
    haversineKm(
      { latitude: 0, longitude: 179.99 },
      { latitude: 0, longitude: -179.99 },
    ) < 3,
  );
  assert.ok(
    Number.isFinite(
      haversineKm(
        { latitude: 90, longitude: 0 },
        { latitude: -90, longitude: 180 },
      ),
    ),
  );
  const box = boundingBox({ latitude: 0, longitude: 179.99 }, 10);
  assert.equal(box.minLng, -180);
  assert.equal(box.maxLng, 180);
});
test("cursor rejects tampering, wrong viewer and expiry", () => {
  const value = {
    deck: "12345678-1234-1234-1234-123456789012",
    after: 19,
    viewer: "a",
    expiry: Date.now() + 10000,
    version: 1,
  };
  const cursor = encodeCursor(value);
  assert.deepEqual(decodeCursor(cursor, "a"), value);
  assert.throws(() => decodeCursor(cursor, "b"));
  assert.throws(() => decodeCursor(cursor + "x", "a"));
  assert.throws(() => decodeCursor(encodeCursor({ ...value, expiry: 1 }), "a"));
});
test("assignment is stable and nonnegative; flags reject unknown or invalid values", () => {
  for (let i = 0; i < 100; i++) {
    const x = assignment(String(i));
    assert.ok(x >= 0 && x < 100);
    assert.equal(x, assignment(String(i)));
  }
  assert.throws(() =>
    validateConfig({ reco_hard_filters_enabled: 0 }, "flags"),
  );
  assert.throws(() => validateConfig({ candidate_budget: 0 }, "flags"));
  assert.throws(() => validateConfig({ shadow_enabled: 0.5 }, "flags"));
  assert.throws(() => validateConfig({ weight_interests: NaN }, "weights"));
  assert.doesNotThrow(() => validateConfig({ weight_interests: 0 }, "weights"));
  assert.throws(() => validateConfig({ constructor: 1 }, "weights"));
});
test("mobile preserves a zero score and does not fabricate missing compatibility", () => {
  assert.equal(compatibilityValue(0), 0);
  for (const value of [null, undefined, "98", NaN, Infinity, -1, 101])
    assert.equal(compatibilityValue(value), null);
  assert.equal(compatibilityLabel(0), "Compatibility 0/100");
  assert.equal(compatibilityLabel(undefined), "Compatibility unavailable");
});
test("relationship intent recognizes accepted alternatives and ignores unknown intent", () => {
  const a = {
    preferences: { interests: ["music"] },
    seeking: "Long-term partner",
    clubs: [],
  };
  const b = { ...a, seeking: "Short-term, but long-term OK" };
  assert.equal(
    compatibility(a, b).factors.find((f) => f.id === "seeking")?.similarity,
    0.5,
  );
  assert.deepEqual(compatibility(a, b), compatibility(b, a));
  assert.equal(
    compatibility({ ...a, seeking: "Still figuring it out" }, a).score,
    null,
  );
});

import {
  rankCandidates,
  exposurePenalty,
  RankingCandidate,
} from "../src/services/ranking-policy";
import { evaluateLoad, summarizeLoad } from "../src/services/load-test-metrics";
const rankFixture = (
  id: string,
  score: number | null = 50,
): RankingCandidate => ({
  id,
  score,
  visibleCount: 0,
  active: false,
  hasPhoto: false,
  incomingLike: false,
});

test("load metrics use nearest-rank percentiles and enforce every gate", () => {
  const samples = Array.from({ length: 100 }, (_, index) => ({
    scenario: "discovery",
    status: index < 98 ? 200 : index === 98 ? 500 : null,
    durationMs: index + 1,
  }));
  const summary = summarizeLoad(samples, 2000);
  assert.equal(summary.requests, 100);
  assert.equal(summary.succeeded, 98);
  assert.equal(summary.failed, 2);
  assert.equal(summary.errorRate, 0.02);
  assert.equal(summary.throughputRps, 50);
  assert.equal(summary.p50Ms, 50);
  assert.equal(summary.p95Ms, 95);
  assert.equal(summary.p99Ms, 99);
  assert.deepEqual(summary.statusCounts, { "200": 98, "500": 1, network_error: 1 });
  assert.equal(evaluateLoad(summary, { maximumP95Ms: 95, maximumErrorRate: 0.02, minimumRequests: 100 }).passed, true);
  assert.equal(evaluateLoad(summary, { maximumP95Ms: 94, maximumErrorRate: 0.02, minimumRequests: 100 }).passed, false);
  assert.equal(evaluateLoad(summary, { maximumP95Ms: 95, maximumErrorRate: 0.01, minimumRequests: 100 }).passed, false);
  assert.equal(evaluateLoad(summary, { maximumP95Ms: 95, maximumErrorRate: 0.02, minimumRequests: 101 }).passed, false);
});

test("an empty load sample cannot pass", () => {
  const summary = summarizeLoad([], 1000);
  assert.equal(summary.errorRate, 1);
  assert.equal(summary.p95Ms, null);
  assert.equal(evaluateLoad(summary, { maximumP95Ms: 500, maximumErrorRate: 0.01, minimumRequests: 1 }).passed, false);
});

test("tie order is stable within a deck, input independent, and rotates across decks", () => {
  const candidates = Array.from({ length: 50 }, (_, i) =>
    rankFixture(String(i).padStart(3, "0")),
  );
  const first = rankCandidates(candidates, "viewer", "deck-a", false);
  assert.deepEqual(
    first,
    rankCandidates([...candidates].reverse(), "viewer", "deck-a", false),
  );
  assert.notDeepEqual(
    first,
    candidates.map((p) => p.id),
  );
  assert.notDeepEqual(
    first,
    rankCandidates(candidates, "viewer", "deck-b", false),
  );
  assert.notDeepEqual(
    first,
    rankCandidates(candidates, "other", "deck-a", false),
  );
});

test("ranking terminates and preserves every unique candidate for all pool sizes", () => {
  for (const policy of [false, true]) {
    for (let known = 0; known < 30; known++) {
      for (let cold = 0; cold < 30; cold++) {
        const candidates = [
          ...Array.from({ length: known }, (_, i) => rankFixture("k" + i, i)),
          ...Array.from({ length: cold }, (_, i) => rankFixture("c" + i, null)),
        ];
        const result = rankCandidates(
          [...candidates, ...candidates],
          "v",
          "s",
          policy,
        );
        assert.equal(result.length, candidates.length);
        assert.deepEqual(
          [...result].sort(),
          candidates.map((p) => p.id).sort(),
        );
      }
    }
  }
});

test("missing evidence has reserved positions and zero remains a known score", () => {
  const candidates = [
    ...Array.from({ length: 20 }, (_, i) =>
      rankFixture("k" + i, i === 0 ? 0 : 50),
    ),
    ...Array.from({ length: 10 }, (_, i) => rankFixture("c" + i, null)),
  ];
  const result = rankCandidates(candidates, "v", "s", false);
  assert.ok(result[4].startsWith("c"));
  assert.ok(result[9].startsWith("c"));
  assert.ok(result[0].startsWith("k"));
  assert.ok(result.includes("k0"));
});

test("exposure retains a tail and incoming interest is bounded and treatment-only", () => {
  assert.ok(exposurePenalty(5000) > exposurePenalty(147));
  assert.ok(exposurePenalty(147) > exposurePenalty(11));
  assert.ok(exposurePenalty(1e12) <= 25);
  const a = rankFixture("a", 51),
    b = { ...rankFixture("b", 50), incomingLike: true };
  assert.deepEqual(rankCandidates([a, b], "v", "s", false), ["a", "b"]);
  assert.deepEqual(rankCandidates([a, b], "v", "s", true), ["a", "b"]);
  assert.equal(
    rankCandidates([{ ...a, score: 90 }, b], "v", "s", true)[0],
    "a",
  );
  assert.equal(
    rankCandidates(
      [
        { ...a, visibleCount: 5000 },
        { ...b, incomingLike: false },
      ],
      "v",
      "s",
      true,
    )[0],
    "b",
  );
});

test("campus and stated personality signals are symmetric and use valid evidence", () => {
  const base = {
    preferences: {
      interests: ["music"],
      personality: { communication: " Phone " },
    },
    seeking: "Long-term partner",
    clubs: [],
    college: "IEM",
    discoveryMode: "college",
    department: "CSE",
    campus: "Main",
    yearOfStudy: 2,
    isHosteller: false,
    hangoutSpots: [" Library "],
  };
  const other = {
    ...base,
    department: "MBA",
    yearOfStudy: 5,
    preferences: {
      interests: ["music"],
      personality: { communication: "text" },
    },
  };
  const same = compatibility(base, base),
    different = compatibility(base, other);
  assert.ok(same.score! > different.score!);
  assert.deepEqual(different, compatibility(other, base));
  assert.ok(same.factors.some((f) => f.id === "hangouts"));
  assert.ok(same.factors.some((f) => f.id === "personality"));
  assert.ok(
    !compatibility({ ...base, discoveryMode: "distance" }, base).factors.some(
      (f) => f.id === "campus",
    ),
  );
  assert.ok(
    !compatibility({ ...base, college: "Other" }, base).factors.some(
      (f) => f.id === "campus",
    ),
  );
  const empty = {
    ...base,
    preferences: { interests: ["music"], personality: { communication: " " } },
  };
  assert.ok(
    !compatibility(empty, base).factors.some((f) => f.id === "personality"),
  );
});

test("partially answered groups cannot claim the full evidence weight", () => {
  const partial = {
    preferences: { interests: ["music"], lifestyle: { drink: "no" } },
    seeking: null,
    clubs: [],
    hangoutSpots: ["library"],
    discoveryMode: "college",
    college: "IEM",
    department: "CSE",
  };
  const result = compatibility(partial, partial);
  assert.ok(
    Math.abs(result.coverage - (0.3 + 0.15 / 4 + 0.05 + 0.1 / 4)) < 1e-9,
  );
  assert.equal(result.score, null);
  const complete = {
    ...partial,
    preferences: {
      interests: ["music"],
      lifestyle: { drink: "no", smoke: "no", exercise: "daily", pets: "dogs" },
    },
    campus: "Main",
    yearOfStudy: 2,
    isHosteller: false,
  };
  assert.equal(compatibility(complete, complete).score, 100);
  assert.ok(compatibility(complete, complete).coverage > result.coverage);
});

test("reservation flags are bounded and incoming slots do not change scores", () => {
  assert.throws(() => validateConfig({ cold_slots_per_10: 5 }, "flags"));
  assert.throws(() => validateConfig({ incoming_slots_per_10: 0.5 }, "flags"));
  assert.doesNotThrow(() =>
    validateConfig({ cold_slots_per_10: 0, incoming_slots_per_10: 2 }, "flags"),
  );
  const candidates = Array.from({ length: 30 }, (_, i) => ({
    ...rankFixture("k" + i, 100 - i),
    incomingLike: i === 29,
  }));
  const control = rankCandidates(candidates, "v", "s", false, 0, 2);
  assert.equal(control[29], "k29");
  const treatment = rankCandidates(candidates, "v", "s", true, 0, 1);
  assert.equal(treatment[0], "k0");
  assert.equal(treatment[1], "k29");
  const cold = Array.from({ length: 10 }, (_, i) => rankFixture("c" + i, null));
  const four = rankCandidates([...candidates, ...cold], "v", "s", false, 4, 0);
  for (const position of [2, 4, 7, 9])
    assert.ok(four[position].startsWith("c"));
  for (let c = 0; c <= 4; c++)
    for (let incoming = 0; incoming <= 2; incoming++) {
      const ranked = rankCandidates(
        [...candidates, ...cold],
        "v",
        "s",
        true,
        c,
        incoming,
      );
      assert.equal(new Set(ranked).size, 40);
      assert.equal(ranked.length, 40);
    }
});

import {
  estimateReciprocity,
  similarSignals,
  interestSignals,
} from "../src/services/reciprocity.service";
import { evaluateHistory } from "../src/services/reciprocity-evaluation";
test("reciprocity is conditional on outgoing behavior and requires sufficient evidence", () => {
  assert.equal(estimateReciprocity(49, 25, 25, 20), null);
  assert.equal(estimateReciprocity(100, 50, 19, 15), null);
  assert.equal(estimateReciprocity(100, 20, 50, 40), null);
  const positive = estimateReciprocity(100, 50, 50, 45)!;
  const negative = estimateReciprocity(100, 50, 50, 5)!;
  assert.equal(positive.baseline, negative.baseline);
  assert.ok(positive.probability > 0.8);
  assert.ok(negative.probability < 0.2);
  assert.ok(positive.points <= 5 && negative.points >= -5);
  const normalized = interestSignals({
    preferences: { interests: [" Music ", "music", 12] },
    seeking: " Long-term ",
  });
  assert.deepEqual(normalized.interests, ["music_general"]);
  assert.ok(
    similarSignals(normalized, { interests: ["music_general"], seeking: "long-term" }),
  );
  assert.ok(
    !similarSignals(normalized, { interests: ["music"], seeking: null }),
  );
});
test("chronological evaluation predicts a synthetic conditional pattern better than actor baseline", () => {
  const history = Array.from({ length: 400 }, (_, i) => ({
    signals: {
      interests: [i % 2 === 0 ? "music" : "sports"],
      seeking: "long-term",
    },
    liked: i % 2 === 0 ? i % 10 !== 0 : i % 10 === 1,
  }));
  const report = evaluateHistory(history);
  assert.ok(report.predicted > 200);
  assert.ok(report.brierSum < report.baselineBrierSum);
  assert.ok(Number.isFinite(report.logLossSum));
});
test("reciprocity points are bounded and do not affect the control arm", () => {
  const candidates = [
    { ...rankFixture("a", 50), reciprocityPoints: 500 },
    rankFixture("b", 60),
  ];
  assert.equal(rankCandidates(candidates, "v", "s", true, 0, 0)[0], "b");
  assert.equal(rankCandidates(candidates, "v", "s", false, 0, 0)[0], "b");
});

test("catalog aliases are idempotent and preserve unknown interest data", async () => {
  const { INTEREST_CATEGORIES, normalizeInterest } = await import("@iem-dating/shared/interest-catalog");
  for (const option of INTEREST_CATEGORIES.flatMap(c => c.interests)) {
    assert.equal(normalizeInterest(option.id), option.id);
    assert.equal(normalizeInterest(option.label), option.id);
    assert.equal(normalizeInterest(option.label.toLowerCase().replace(/[^a-z0-9]/g, "_")), option.id);
  }
  for (const [alias,id] of [["r_b","r_and_b"],["a_ai","acai"],["music","music_general"]])
    assert.equal(normalizeInterest(alias),id);
  assert.equal(normalizeInterest("  Unlisted / Hobby  "), "  Unlisted / Hobby  ");
});

test("interest aliases match symmetrically without changing club or hangout semantics", () => {
  const a = { preferences:{interests:["r_b","music"]}, seeking:"long-term partner", clubs:[" Art "], hangoutSpots:["North Cafe"] };
  const b = { preferences:{interests:["r_and_b","music_general"]}, seeking:"long-term partner", clubs:["art"], hangoutSpots:["South Cafe"] };
  const ab = compatibility(a,b), ba = compatibility(b,a);
  assert.equal(ab.score,ba.score);
  assert.equal(ab.factors.find(f=>f.id==="interests")?.similarity,1);
  assert.equal(ab.factors.find(f=>f.id==="clubs")?.similarity,1);
  assert.equal(ab.factors.find(f=>f.id==="hangouts")?.similarity,0);
});

test("backfill preserves unrelated data, malformed entries, and decision-time seeking", async () => {
  const { canonicalizeInterestDocument } = await import("../src/services/interest-normalization");
  const before = {interests:["r_b","r_and_b","Unknown",17],seeking:"historic intent",privateValue:12};
  const after = canonicalizeInterestDocument(before);
  assert.deepEqual(after,{interests:["r_and_b","Unknown",17],seeking:"historic intent",privateValue:12});
  assert.deepEqual(canonicalizeInterestDocument(after),after);
  assert.deepEqual(before.interests,["r_b","r_and_b","Unknown",17]);
});

test("shadow metrics detect a reordered deck even when full membership is identical", async () => {
  const { shadowMetrics } = await import("../src/services/shadow-metrics");
  const ids = Array.from({length:40},(_,i)=>String(i));
  const candidates = ids.map(id=>({id,score:Number(id)<20?60:null,visibleCount:0,active:false,hasPhoto:false,incomingLike:id==="0"}));
  const report = shadowMetrics(ids,[...ids].reverse(),candidates);
  assert.equal(report.top20Overlap,0);
  assert.equal(report.meanAbsRankShift,20);
  assert.equal(report.evidenceCoverage,.5);
  assert.equal(report.incomingPlacement.control.meanPosition,1);
  assert.equal(report.incomingPlacement.treatment.meanPosition,40);
});

test("reciprocity coverage classifies rejection and database failure", async () => {
  const { ReciprocityService } = await import("../src/services/reciprocity.service");
  const me = {preferences:{interests:["r_b"]},seeking:"long-term partner"} as unknown as User;
  const db = {$queryRaw: async()=>[
    {id:"a",n:100,likes:50,similar:50,similarLikes:40,malformed:0},
    {id:"b",n:10,likes:5,similar:5,similarLikes:2,malformed:0},
    {id:"c",n:100,likes:50,similar:10,similarLikes:5,malformed:0},
    {id:"d",n:100,likes:999,similar:50,similarLikes:40,malformed:0},
  ]} as any;
  const result = await ReciprocityService.batchDetailed(me,["a","b","c","d"],db);
  assert.equal(result.stats.withEstimate,1);
  assert.equal(result.stats.belowHistory,1);
  assert.equal(result.stats.belowSimilarity,1);
  assert.equal(result.stats.malformed,1);
  const failed = await ReciprocityService.batchDetailed(me,["a"],{$queryRaw:async()=>{throw Error("unavailable");}} as any);
  assert.equal(failed.stats.failed,1);
  assert.equal(failed.points.size,0);
});

test("experiment assignment retains the established key across ranking versions", async () => {
  const { DISCOVERY_EXPERIMENT_KEY } = await import("../src/services/deck.service");
  const { createHash } = await import("node:crypto");
  assert.equal(DISCOVERY_EXPERIMENT_KEY,"reco-v2");
  assert.equal(assignment("viewer"), createHash("sha256").update("reco-v2:viewer").digest().readUInt32BE(0)/0x100000000*100);
});
