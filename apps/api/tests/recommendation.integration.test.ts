import { DiscoveryTelemetry } from "../src/services/discovery-telemetry.service";
import { ShadowService } from "../src/services/shadow.service";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { prisma } from "../src/utils/prisma";
import { redisClient } from "../src/utils/redis";
import { RecommendationService } from "../src/services/recommendation.service";
import { SwipeService } from "../src/services/swipe.service";
import { OutboxWorker } from "../src/services/outbox.worker";
import { ImpressionService } from "../src/services/impression.service";
import { RetrievalService } from "../src/services/retrieval.service";
import { AlgorithmConfigService } from "../src/services/algorithm-config.service";
import { decodeCursor } from "../src/services/deck.service";
import request from "supertest";
import app from "../src/app";
import { generateTokens } from "../src/utils/jwt";
import { SearchService } from "../src/services/search.service";
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.pathname !== "/reco_test" ||
  url.port !== "55439"
)
  throw new Error(
    "Integration tests require the isolated localhost:55439/reco_test database",
  );
if (process.env.REDIS_URL !== "redis://127.0.0.1:56420")
  throw new Error("Integration tests require the isolated Redis instance");
process.env.DISCOVERY_CURSOR_SECRET = "integration-only-signing-key";
const viewerId = randomUUID(),
  candidateIds = Array.from({ length: 220 }, () => randomUUID());
let institutionId = '';
async function verifyUsers(ids: string[]) {
  await prisma.studentMembership.createMany({
    data: ids.map((userId) => ({
      userId,
      institutionId,
      institutionalEmail: `${userId}@iem.edu.in`,
      status: 'verified',
      verifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    })),
    skipDuplicates: true,
  });
}
function profile(id: string, category = "woman") {
  return {
    id,
    name: "Test profile",
    passwordHash: "PRIVATE_PASSWORD",
    email: `${id}@example.test`,
    phone: null,
    birthday: new Date("2003-01-01"),
    age: 23,
    college: "IEM",
    discoveryCategory: category,
    showMeCategories: ["man", "woman"],
    minAgePref: 18,
    maxAgePref: 30,
    discoveryMode: "college",
    preferencesConfirmedAt: new Date(),
    preferences: {
      interests: ["music", "books"],
      internalToken: "PRIVATE_PREFERENCE",
    },
    seeking: "Long-term partner",
    clubs: ["art"],
    showGender: false,
    gender: "PRIVATE_GENDER",
    showOrientation: false,
    orientation: ["PRIVATE_ORIENTATION"],
  };
}
before(async () => {
  await prisma.$executeRawUnsafe(
    "TRUNCATE outbox_events,student_memberships,algorithm_config,discovery_receipts,shadow_rankings,profile_impressions,notifications,analytics_events,matches,swipes,user_scores,user_blocks,users CASCADE",
  );
  await redisClient.flushdb();
  await prisma.user.createMany({
    data: [profile(viewerId, "man"), ...candidateIds.map((id) => profile(id))],
  });
  institutionId = (await prisma.institution.findUniqueOrThrow({ where: { code: 'IEM-KOLKATA' } })).id;
  await verifyUsers([viewerId, ...candidateIds]);
});
after(async () => {
  await ShadowService.stop();
  await DiscoveryTelemetry.flush();
  await prisma.$disconnect();
  redisClient.disconnect();
});
test("public cards exclude private fields and retries preserve the same deck interval", async () => {
  const result = await RecommendationService.getRecommendations(
    viewerId,
    undefined,
    20,
  );
  assert.equal(result.cards.length, 20);
  assert.ok(result.nextCursor);
  const card = result.cards[0];
  for (const key of [
    "passwordHash",
    "email",
    "phone",
    "birthday",
    "latitude",
    "longitude",
    "userScore",
    "showMeCategories",
    "preferencesConfirmedAt",
  ])
    assert.ok(!(key in card), key);
  assert.equal(card.gender, null);
  assert.deepEqual(card.orientation, []);
  assert.ok(!JSON.stringify(card).includes("PRIVATE_"));
  const second = await RecommendationService.getRecommendations(
    viewerId,
    result.nextCursor!,
    20,
  );
  const retry = await RecommendationService.getRecommendations(
    viewerId,
    result.nextCursor!,
    20,
  );
  assert.deepEqual(second.cards, retry.cards);
});
test("visibility is idempotent and retains best absolute position", async () => {
  const result = await RecommendationService.getRecommendations(
    viewerId,
    undefined,
    20,
  );
  const card = result.cards[0];
  await Promise.all(
    Array.from({ length: 5 }, () =>
      ImpressionService.recordVisible(viewerId, card.impressionId),
    ),
  );
  const rows = await prisma.profileImpression.findMany({
    where: { viewerId, shownId: card.id },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 1);
  assert.equal(rows[0].bestPosition, 0);
  const later = await prisma.discoveryReceipt.create({
    data: {
      id: randomUUID(),
      viewerId,
      candidateId: card.id,
      deckId: randomUUID(),
      sequence: 17,
      algorithm: 0,
    },
  });
  await ImpressionService.recordVisible(viewerId, later.id);
  const aggregate = await prisma.profileImpression.findFirstOrThrow({
    where: { viewerId, shownId: card.id },
  });
  assert.equal(aggregate.count, 2);
  assert.equal(aggregate.bestPosition, 0);
  await assert.rejects(() =>
    ImpressionService.recordVisible(candidateIds[1], card.impressionId),
  );
});
test("blocking or changing a candidate removes it from an existing deck", async () => {
  const result = await RecommendationService.getRecommendations(
    viewerId,
    undefined,
    1,
  );
  const decoded = decodeCursor(result.nextCursor!, viewerId);
  const raw = await redisClient.get(`deck:v2:{${viewerId}}:${decoded.deck}`);
  const deck = JSON.parse(raw!);
  const blocked = deck.ids[1],
    changed = deck.ids[2];
  await prisma.userBlock.create({
    data: { blockerId: blocked, blockedId: viewerId },
  });
  await prisma.user.update({
    where: { id: changed },
    data: { maxAgePref: 18 },
  });
  const page = await RecommendationService.getRecommendations(
    viewerId,
    result.nextCursor!,
    20,
  );
  assert.ok(page.cards.every((c) => c.id !== blocked && c.id !== changed));
  await prisma.userBlock.deleteMany({ where: { blockerId: blocked } });
  await prisma.user.update({
    where: { id: changed },
    data: { maxAgePref: 30 },
  });
});
test("Explore rejects small cohorts and excessive filter combinations without returning a count", async () => {
  const rareIds = candidateIds.slice(0, 10);
  await prisma.user.updateMany({
    where: { id: { in: rareIds.slice(0, 9) } },
    data: { preferences: { interests: ["rare_interest"] } },
  });
  await assert.rejects(
    () => SearchService.explore(viewerId, { interests: ["rare_interest"] }),
    (error: any) => error.code === "EXPLORE_COHORT_TOO_SMALL" && !String(error.message).includes('9'),
  );
  await assert.rejects(
    () => SearchService.explore(viewerId, { category: 'same_department', interests: ['music', 'books'] }),
    (error: any) => error.code === "EXPLORE_FILTER_COMBINATION_LIMIT",
  );
  await prisma.user.update({
    where: { id: rareIds[9] },
    data: { preferences: { interests: ["rare_interest"] } },
  });
  const accepted = await SearchService.explore(viewerId, { interests: ["rare_interest"] });
  assert.equal(accepted.category, 'for_you');
  assert.equal('cohortSize' in accepted, false);
  assert.ok(accepted.cards.every((card) => (card.preferences as any)?.interests?.includes('rare_interest')));
  await prisma.user.updateMany({
    where: { id: { in: rareIds } },
    data: { preferences: { interests: ["music", "books"], internalToken: "PRIVATE_PREFERENCE" } },
  });
});
test("swiping every page does not skip profiles and continues beyond 150", async () => {
  let cursor: string | undefined,
    count = 0;
  const seen = new Set<string>();
  do {
    const result = await RecommendationService.getRecommendations(
      viewerId,
      cursor,
      20,
    );
    for (const card of result.cards) {
      assert.ok(!seen.has(card.id));
      seen.add(card.id);
      count++;
      await SwipeService.perform(viewerId, card.id, "pass");
    }
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(count, 220);
  assert.equal(
    (await prisma.userScore.findUniqueOrThrow({ where: { userId: viewerId } }))
      .totalSwipesOut,
    220,
  );
});
test("simultaneous reciprocal likes create one match and retries do not count twice", async () => {
  const a = randomUUID(),
    b = randomUUID();
  await prisma.user.createMany({ data: [profile(a, "man"), profile(b)] });
  await verifyUsers([a, b]);
  const results = await Promise.all([
    SwipeService.perform(a, b, "like"),
    SwipeService.perform(b, a, "like"),
  ]);
  assert.equal(results.filter((r) => r.matchCreated).length, 1);
  await Promise.all(
    Array.from({ length: 5 }, () => SwipeService.perform(a, b, "like")),
  );
  assert.equal(
    await prisma.match.count({
      where: { OR: [{ user1Id: a }, { user2Id: a }] },
    }),
    1,
  );
  assert.equal(await OutboxWorker.runOnce(), true);
  assert.equal(
    await prisma.notification.count({ where: { userId: a, type: "match" } }),
    1,
  );
  assert.equal(
    (await prisma.userScore.findUniqueOrThrow({ where: { userId: a } }))
      .totalSwipesOut,
    1,
  );
  await assert.rejects(() => SwipeService.perform(a, b, "pass"));
});
test("viewer preference changes expire the cursor", async () => {
  const a = randomUUID();
  await prisma.user.create({ data: profile(a, "man") });
  await verifyUsers([a]);
  const page = await RecommendationService.getRecommendations(a, undefined, 1);
  await RecommendationService.invalidateCache(a);
  await assert.rejects(
    () => RecommendationService.getRecommendations(a, page.nextCursor!, 1),
    { code: "DECK_EXPIRED" },
  );
});
test("parallel page reads return one receipt per sequence", async () => {
  const a = randomUUID();
  await prisma.user.create({ data: profile(a, "man") });
  await verifyUsers([a]);
  const first = await RecommendationService.getRecommendations(a, undefined, 1);
  const pages = await Promise.all(
    Array.from({ length: 4 }, () =>
      RecommendationService.getRecommendations(a, first.nextCursor!, 20),
    ),
  );
  for (const page of pages) assert.deepEqual(page.cards, pages[0].cards);
});
test("receipt acknowledgement rolls back when aggregation fails", async () => {
  const a = randomUUID();
  await prisma.user.create({ data: profile(a, "man") });
  await verifyUsers([a]);
  const page = await RecommendationService.getRecommendations(a, undefined, 1);
  const id = page.cards[0].impressionId;
  await prisma.$executeRawUnsafe(
    "CREATE FUNCTION fail_reco_impression() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$ LANGUAGE plpgsql",
  );
  await prisma.$executeRawUnsafe(
    "CREATE TRIGGER test_reco_failure BEFORE INSERT ON profile_impressions FOR EACH ROW EXECUTE FUNCTION fail_reco_impression()",
  );
  try {
    await assert.rejects(() => ImpressionService.recordVisible(a, id));
    assert.equal(
      (await prisma.discoveryReceipt.findUniqueOrThrow({ where: { id } }))
        .visibleAt,
      null,
    );
  } finally {
    await prisma.$executeRawUnsafe(
      "DROP TRIGGER test_reco_failure ON profile_impressions",
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION fail_reco_impression()");
  }
  await ImpressionService.recordVisible(a, id);
  assert.ok(
    (await prisma.discoveryReceipt.findUniqueOrThrow({ where: { id } }))
      .visibleAt,
  );
});
test("distance SQL and Node eligibility agree near the antimeridian", async () => {
  const a = randomUUID(),
    b = randomUUID(),
    c = randomUUID();
  await prisma.user.createMany({
    data: [
      {
        ...profile(a, "man"),
        discoveryMode: "distance",
        latitude: 0,
        longitude: 179.99,
        locationConsentAt: new Date(),
        distancePreference: 5,
      },
      {
        ...profile(b),
        discoveryMode: "distance",
        latitude: 0,
        longitude: -179.99,
        locationConsentAt: new Date(),
        distancePreference: 5,
      },
      {
        ...profile(c),
        discoveryMode: "distance",
        latitude: 0,
        longitude: -179,
        locationConsentAt: new Date(),
        distancePreference: 5,
      },
    ],
  });
  await verifyUsers([a, b, c]);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: a } });
  assert.deepEqual(await RetrievalService.ids(me, "test", 40), [b]);
});
test("configuration applies immediately and cannot disable eligibility", async () => {
  await AlgorithmConfigService.update(
    viewerId,
    { reco_rollout_pct: 100 },
    "flags",
    "Integration test",
  );
  assert.equal(
    (await AlgorithmConfigService.get()).flags.reco_rollout_pct,
    100,
  );
  await assert.rejects(() =>
    AlgorithmConfigService.update(
      viewerId,
      { reco_hard_filters_enabled: 0 },
      "flags",
      "Invalid",
    ),
  );
  await AlgorithmConfigService.update(
    viewerId,
    { reco_rollout_pct: 0 },
    "flags",
    "Restore test baseline",
  );
});
test("HTTP routes validate limits, require setup, and share swipe behavior", async () => {
  const a = randomUUID(),
    b = randomUUID();
  await prisma.user.createMany({ data: [profile(a, "man"), profile(b)] });
  await verifyUsers([a, b]);
  const jti = randomUUID();
  await prisma.userSession.create({
    data: { userId: a, tokenJti: jti, expiresAt: new Date(Date.now() + 60_000) },
  });
  const token = generateTokens(a, "a@example.test", jti).accessToken;
  const auth = { Authorization: `Bearer ${token}` };
  assert.equal(
    (
      await request(app)
        .get("/api/v1/discover/recommendations?limit=1000")
        .set(auth)
    ).status,
    400,
  );
  const first = await request(app)
    .post("/api/v1/discover/swipe")
    .set(auth)
    .send({ targetId: b, action: "like" });
  assert.equal(first.status, 200);
  const retry = await request(app)
    .post("/api/v1/match/swipe")
    .set(auth)
    .send({ targetUserId: b, action: "like" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.repeated, true);
  assert.equal(
    (await prisma.userScore.findUniqueOrThrow({ where: { userId: a } }))
      .totalSwipesOut,
    1,
  );
  await prisma.user.update({
    where: { id: a },
    data: { preferencesConfirmedAt: null },
  });
  const page = await request(app)
    .get("/api/v1/discover/recommendations")
    .set(auth);
  assert.equal(page.status, 200);
  assert.equal(page.body.data.state, "setup_required");
  assert.equal(
    (
      await request(app)
        .put("/api/v1/profile/discovery")
        .set(auth)
        .send({
          discoveryCategory: "man",
          showMeCategories: ["woman"],
          minAgePref: 18,
          maxAgePref: 30,
          discoveryMode: "college",
          distancePreference: 50,
        })
    ).status,
    200,
  );
});

test("shadow ranking runs through its isolated connection after response scheduling", async () => {
  const a = randomUUID();
  await prisma.user.create({ data: profile(a, "man") });
  await verifyUsers([a]);
  await AlgorithmConfigService.update(
    viewerId,
    { shadow_enabled: 1, shadow_sample_rate: 1 },
    "flags",
    "Exercise shadow worker",
  );
  const before = ShadowService.status().completed;
  const deferred: (() => void)[] = [];
  const delivered = await RecommendationService.getRecommendations(
    a,
    undefined,
    1,
    (work) => deferred.push(work),
  );
  const changed = await prisma.user.findUniqueOrThrow({
    where: { id: delivered.cards[0].id },
  });
  await prisma.user.update({
    where: { id: changed.id },
    data: { preferences: { interests: ["changed-after-delivery"] } },
  });
  for (const work of deferred) work();
  const deadline = Date.now() + 5000;
  while (ShadowService.status().completed === before && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(ShadowService.status().completed, before + 1);
  const row = await prisma.shadowRanking.findFirstOrThrow({
    where: { viewerId: a },
  });
  assert.equal((row.report as any).kind, "ranking_diagnostic");
  assert.equal((row.report as any).identicalInputs, true);
  assert.equal((row.report as any).metricsVersion, 2);
  assert.ok((row.report as any).top20Overlap >= 0 && (row.report as any).top20Overlap <= 1);
  assert.ok((row.report as any).meanAbsRankShift >= 0);
  assert.equal((row.report as any).controlIds[0], delivered.cards[0].id);
  await prisma.user.update({
    where: { id: changed.id },
    data: { preferences: changed.preferences as any },
  });
  await AlgorithmConfigService.update(
    viewerId,
    { shadow_enabled: 0 },
    "flags",
    "Disable shadow after test",
  );
});

test("ranking loads campus factors and incoming likes without exposing a popularity proxy", async () => {
  const { DiscoveryRankingService } =
    await import("../src/services/discovery-ranking.service");
  const { DEFAULT_COMPATIBILITY_WEIGHTS } =
    await import("../src/services/compatibility.service");
  const me = await prisma.user.create({
    data: {
      ...profile(randomUUID(), "man"),
      department: "CSE",
      yearOfStudy: 2,
    },
  });
  const a = await prisma.user.create({
    data: { ...profile(randomUUID()), department: "CSE", yearOfStudy: 2 },
  });
  const b = await prisma.user.create({
    data: { ...profile(randomUUID()), department: "MBA", yearOfStudy: 5 },
  });
  const c = await prisma.user.create({
    data: { ...profile(randomUUID()), department: "CSE", yearOfStudy: 2 },
  });
  await verifyUsers([me.id, a.id, b.id, c.id]);
  await prisma.swipe.create({
    data: { swiperId: c.id, targetId: me.id, action: "like" },
  });
  const order = await DiscoveryRankingService.rank(
    me,
    [b.id, a.id, c.id, a.id, randomUUID()],
    1,
    DEFAULT_COMPATIBILITY_WEIGHTS,
    prisma,
    "integration-deck",
  );
  assert.equal(order.length, 3);
  assert.ok(order.indexOf(c.id) <= 1);
  assert.equal(order[2], b.id);
  const control = await DiscoveryRankingService.rank(
    me,
    [b.id, a.id, c.id],
    0,
    DEFAULT_COMPATIBILITY_WEIGHTS,
    prisma,
    "integration-deck",
  );
  assert.equal(control[2], b.id);
});

test("older weight configuration cannot partially override the new factor set", async () => {
  const { DEFAULT_COMPATIBILITY_WEIGHTS } =
    await import("../src/services/compatibility.service");
  await prisma.algorithmConfig.deleteMany({
    where: { key: "compatibility_v3" },
  });
  await prisma.algorithmConfig.upsert({
    where: { key: "compatibility_v2" },
    create: { key: "compatibility_v2", value: 1 },
    update: { value: 1 },
  });
  await prisma.algorithmConfig.upsert({
    where: { key: "weight_interests" },
    create: { key: "weight_interests", value: 0.99 },
    update: { value: 0.99 },
  });
  const config = await AlgorithmConfigService.get();
  assert.deepEqual(config.weights, DEFAULT_COMPATIBILITY_WEIGHTS);
  assert.ok(config.version.startsWith("ranking-v7:"));
});

test("incoming-like retrieval preserves eligibility and candidate budget", async () => {
  const me = await prisma.user.create({ data: profile(randomUUID(), "man") });
  const candidates = await Promise.all(
    Array.from({ length: 50 }, () =>
      prisma.user.create({ data: profile(randomUUID()) }),
    ),
  );
  await verifyUsers([me.id, ...candidates.map((candidate) => candidate.id)]);
  const target = candidates[49],
    blocked = candidates[48];
  await prisma.swipe.createMany({
    data: [target, blocked].map((p) => ({
      swiperId: p.id,
      targetId: me.id,
      action: "like",
    })),
  });
  await prisma.userBlock.create({
    data: { blockerId: me.id, blockedId: blocked.id },
  });
  const ids = await RetrievalService.ids(me, "incoming-source", 40);
  assert.equal(ids.length, 40);
  assert.ok(ids.includes(target.id));
  assert.ok(!ids.includes(blocked.id));
  const next = await RetrievalService.ids(me, "incoming-source", 40, [
    target.id,
  ]);
  assert.ok(!next.includes(target.id));
});

test("deck creation and refill deduplicate IDs and reject a deleted deck", async () => {
  const { DeckService } = await import("../src/services/deck.service");
  const me = await prisma.user.create({ data: profile(randomUUID(), "man") });
  await verifyUsers([me.id]);
  const first = randomUUID(),
    second = randomUUID();
  const deck = await DeckService.create(me, "test", 0, async () => [
    first,
    first,
  ]);
  assert.deepEqual(deck.ids, [first]);
  const refill = await DeckService.refill(deck, async () => [
    first,
    second,
    second,
  ]);
  assert.deepEqual(refill.ids, [first, second]);
  await redisClient.del(DeckService.key(me.id, deck.id));
  await assert.rejects(
    DeckService.refill(refill, async () => []),
    (e: any) => e.code === "DECK_EXPIRED",
  );
  await assert.rejects(
    DeckService.refill({ ...refill, expiry: 1 }, async () => []),
    (e: any) => e.code === "DECK_EXPIRED",
  );
});

test("incomplete saved weight sets fall back even when a marker exists", async () => {
  const { DEFAULT_COMPATIBILITY_WEIGHTS } =
    await import("../src/services/compatibility.service");
  await prisma.algorithmConfig.upsert({
    where: { key: "compatibility_v3" },
    create: { key: "compatibility_v3", value: 1 },
    update: { value: 1 },
  });
  await prisma.algorithmConfig.deleteMany({
    where: { key: "weight_hangouts" },
  });
  const config = await AlgorithmConfigService.get();
  assert.deepEqual(config.weights, DEFAULT_COMPATIBILITY_WEIGHTS);
});

test("existing users must explicitly confirm preferences before discovery", async () => {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      ...profile(id, "man"),
      preferencesConfirmedAt: null,
      discoveryCategory: null,
      showMeCategories: [],
    },
  });
  await verifyUsers([id]);
  const jti = randomUUID();
  await prisma.userSession.create({
    data: { userId: id, tokenJti: jti, expiresAt: new Date(Date.now() + 60_000) },
  });
  const auth = {
    Authorization:
      "Bearer " +
      generateTokens(id, "legacy@example.test", jti).accessToken,
  };
  const before = await request(app)
    .get("/api/v1/discover/recommendations")
    .set(auth);
  assert.equal(before.body.data.state, "setup_required");
  const settings = await request(app)
    .get("/api/v1/profile/discovery")
    .set(auth);
  assert.equal(settings.body.data.preferencesConfirmedAt, null);
  assert.equal(settings.body.data.discoveryCategory, null);
  assert.deepEqual(settings.body.data.showMeCategories, []);
  const invalid = await request(app)
    .put("/api/v1/profile/discovery")
    .set(auth)
    .send({
      discoveryCategory: "man",
      showMeCategories: [],
      minAgePref: 18,
      maxAgePref: 30,
      discoveryMode: "college",
      distancePreference: 50,
    });
  assert.equal(invalid.status, 400);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id } }))
      .preferencesConfirmedAt,
    null,
  );
  const valid = await request(app)
    .put("/api/v1/profile/discovery")
    .set(auth)
    .send({
      discoveryCategory: "man",
      showMeCategories: ["woman"],
      minAgePref: 18,
      maxAgePref: 30,
      discoveryMode: "college",
      distancePreference: 50,
    });
  assert.equal(valid.status, 200);
  assert.ok(
    (await prisma.user.findUniqueOrThrow({ where: { id } }))
      .preferencesConfirmedAt,
  );
  const after = await request(app)
    .get("/api/v1/discover/recommendations")
    .set(auth);
  assert.equal(after.status, 200);
  assert.notEqual(after.body.data.state, "setup_required");
  assert.ok(after.body.data.cards.length > 0);
});

test("reservation updates invalidate earlier decks", async () => {
  const me = await prisma.user.create({ data: profile(randomUUID(), "man") });
  await verifyUsers([me.id]);
  const page = await RecommendationService.getRecommendations(
    me.id,
    undefined,
    1,
  );
  assert.ok(page.nextCursor);
  await AlgorithmConfigService.update(
    me.id,
    { cold_slots_per_10: 3, incoming_slots_per_10: 2 },
    "flags",
    "Test reservations",
  );
  await assert.rejects(
    RecommendationService.getRecommendations(me.id, page.nextCursor!, 1),
    (e: any) => e.code === "DECK_EXPIRED",
  );
});

test("exposure claims are atomic, idempotent, and expire without a cleanup worker", async () => {
  const { ExposureReservationService: R } =
    await import("../src/services/exposure-reservation.service");
  const candidate = randomUUID();
  const claims = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      R.claim(candidate, "member" + i, 20, 120),
    ),
  );
  assert.equal(claims.filter(Boolean).length, 20);
  const successful = claims.findIndex(Boolean);
  assert.ok(await R.claim(candidate, "member" + successful, 20, 120));
  assert.equal(await redisClient.zcard(R.key(candidate)), 20);
  await R.release(candidate, "member" + successful);
  assert.ok(await R.claim(candidate, "replacement", 20, 120));
  await redisClient.zadd(R.key(candidate), 0, "replacement");
  assert.ok(await R.claim(candidate, "after-expiry", 20, 120));
});
test("capacity-limited pages preserve their cursor and visible acknowledgement releases the claim", async () => {
  const { ExposureReservationService: R } =
    await import("../src/services/exposure-reservation.service");
  const college = "Reservation-" + randomUUID();
  const isolatedInstitution = await prisma.institution.create({
    data: { code: `TEST-${randomUUID().slice(0, 30)}`, name: college, allowedDomains: ['test.edu'] },
  });
  const me = await prisma.user.create({
    data: { ...profile(randomUUID(), "man"), college },
  });
  const candidate = await prisma.user.create({
    data: { ...profile(randomUUID()), college },
  });
  await verifyUsers([me.id, candidate.id]);
  await prisma.studentMembership.updateMany({
    where: { userId: { in: [me.id, candidate.id] } },
    data: { institutionId: isolatedInstitution.id },
  });
  await AlgorithmConfigService.update(
    me.id,
    { max_pending_per_profile: 1 },
    "flags",
    "Capacity test",
  );
  await R.claim(candidate.id, "other-viewer", 1, 120);
  const first = await RecommendationService.getRecommendations(
    me.id,
    undefined,
    1,
  );
  assert.equal(first.state, "capacity_limited");
  assert.equal(first.cards.length, 0);
  assert.ok(first.nextCursor);
  await R.release(candidate.id, "other-viewer");
  const second = await RecommendationService.getRecommendations(
    me.id,
    first.nextCursor!,
    1,
  );
  assert.equal(second.cards[0].id, candidate.id);
  await ImpressionService.recordVisible(me.id, second.cards[0].impressionId);
  assert.equal(await redisClient.zcard(R.key(candidate.id)), 0);
  await AlgorithmConfigService.update(
    me.id,
    { max_pending_per_profile: 20 },
    "flags",
    "Restore capacity",
  );
});
test("reciprocity learns from bounded decision-time snapshots and ignores legacy missing snapshots", async () => {
  const { ReciprocityService } =
    await import("../src/services/reciprocity.service");
  const me = await prisma.user.create({ data: profile(randomUUID(), "man") });
  const a = await prisma.user.create({ data: profile(randomUUID()) });
  const b = await prisma.user.create({ data: profile(randomUUID()) });
  await verifyUsers([me.id, a.id, b.id]);
  for (const [actor, positive] of [
    [a.id, true],
    [b.id, false],
  ] as const) {
    await prisma.$executeRawUnsafe(
      "INSERT INTO swipes(id,swiper_id,target_id,action,target_signals) SELECT gen_random_uuid(),$1::uuid,gen_random_uuid(),CASE WHEN (i<=50 AND i%10<>0) OR (i>50 AND i%10=0) THEN $2 ELSE $3 END,jsonb_build_object('interests',jsonb_build_array(CASE WHEN i<=50 THEN 'music' ELSE 'sports' END),'seeking','long-term partner') FROM generate_series(1,100) i",
      actor,
      positive ? "like" : "pass",
      positive ? "pass" : "like",
    );
  }
  const predictions = await ReciprocityService.batch(me, [a.id, b.id, a.id]);
  assert.ok(predictions.get(a.id)! > 0);
  assert.ok(predictions.get(b.id)! < 0);
  const legacy = await prisma.user.create({ data: profile(randomUUID()) });
  await verifyUsers([legacy.id]);
  await prisma.$executeRawUnsafe(
    "INSERT INTO swipes(id,swiper_id,target_id,action) SELECT gen_random_uuid(),$1::uuid,gen_random_uuid(),'like' FROM generate_series(1,100) i",
    legacy.id,
  );
  assert.equal((await ReciprocityService.batch(me, [legacy.id])).size, 0);
});

test("page telemetry distinguishes generation and cached delivery and reaches admin summaries", async () => {
  const me = await prisma.user.create({data:profile(randomUUID(),"man")});
  const peers = Array.from({length:100},()=>profile(randomUUID()));
  await prisma.user.createMany({data:peers});
  await verifyUsers([me.id,...peers.map(p=>p.id)]);
  const previous = process.env.DISCOVERY_TELEMETRY_SAMPLE_RATE;
  process.env.DISCOVERY_TELEMETRY_SAMPLE_RATE="1";
  try {
    const metrics: any[] = [];
    const first = await RecommendationService.getRecommendations(me.id,undefined,20,undefined,m=>metrics.push(m));
    assert.ok(first.nextCursor);
    await RecommendationService.getRecommendations(me.id,first.nextCursor!,20,undefined,m=>metrics.push(m));
    assert.equal(metrics[0].kind,"generate");
    assert.ok(metrics[0].retrievalMs>0);
    assert.equal(metrics[1].kind,"cached");
    assert.equal(metrics[1].retrievalMs,0);
    await DiscoveryTelemetry.flush();
    const { AlgorithmMetricsService } = await import("../src/services/algorithm-metrics.service");
    const summary = await AlgorithmMetricsService.read();
    assert.ok((summary.timings as any[]).some(row=>row.kind==="generate"&&row.stage==="totalMs"));
    const { AdminController } = await import("../src/controllers/admin.controller");
    let body: any;
    await AdminController.getAlgorithmMetrics({} as any,{json:(value:any)=>{body=value;}} as any,(error:any)=>{throw error;});
    assert.ok(body.data.measurement);
    assert.equal(body.data.experimentKey,"reco-v2");
  } finally {
    if(previous===undefined) delete process.env.DISCOVERY_TELEMETRY_SAMPLE_RATE;
    else process.env.DISCOVERY_TELEMETRY_SAMPLE_RATE=previous;
  }
});

test("telemetry queue is bounded and flushes without changing page behavior", async () => {
  await DiscoveryTelemetry.flush();
  const before = DiscoveryTelemetry.status();
  for(let i=0;i<250;i++) DiscoveryTelemetry.enqueue("discovery_test_event",{i});
  assert.equal(DiscoveryTelemetry.status().queued,200);
  assert.equal(DiscoveryTelemetry.status().dropped-before.dropped,50);
  await DiscoveryTelemetry.flush();
  assert.equal(DiscoveryTelemetry.status().completed-before.completed,200);
});

test("reciprocity ignores malformed snapshots and reports the rejected candidate", async () => {
  const { ReciprocityService } = await import("../src/services/reciprocity.service");
  const me=await prisma.user.create({data:profile(randomUUID(),"man")});
  const actor=await prisma.user.create({data:profile(randomUUID())});
  await prisma.$executeRawUnsafe("INSERT INTO swipes(swiper_id,target_id,action,target_signals) SELECT $1::uuid,gen_random_uuid(),'like','{\"interests\":[123],\"seeking\":false}'::jsonb FROM generate_series(1,100)",actor.id);
  const result=await ReciprocityService.batchDetailed(me,[actor.id]);
  assert.equal(result.stats.malformed,1);
  assert.equal(result.points.size,0);
});

test("interest backfill rolls back a batch when a profile changed after reading", async () => {
  const { applyInterestBatch } = await import("../src/services/interest-normalization");
  const a=await prisma.user.create({data:{...profile(randomUUID()),preferences:{interests:["r_b"]}}});
  const b=await prisma.user.create({data:{...profile(randomUUID()),preferences:{interests:["music"]}}});
  const rows=[{id:a.id,value:a.preferences},{id:b.id,value:b.preferences}];
  await prisma.user.update({where:{id:b.id},data:{preferences:{interests:["hiking"]}}});
  await assert.rejects(()=>applyInterestBatch(prisma,"users",rows),/Concurrent edit/);
  assert.deepEqual((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).preferences,a.preferences);
  assert.deepEqual((await prisma.user.findUniqueOrThrow({where:{id:b.id}})).preferences,{interests:["hiking"]});
  assert.equal(await applyInterestBatch(prisma,"users",[{id:a.id,value:a.preferences}]),1);
  assert.deepEqual((await prisma.user.findUniqueOrThrow({where:{id:a.id}})).preferences,{interests:["r_and_b"]});
});

test("telemetry write failures are counted without rejecting discovery", async () => {
  await DiscoveryTelemetry.flush();
  const before=DiscoveryTelemetry.status().failed;
  await prisma.$executeRawUnsafe("ALTER TABLE analytics_events ADD CONSTRAINT telemetry_test_reject CHECK (event_type <> 'telemetry_test_failure')");
  try {
    DiscoveryTelemetry.enqueue("telemetry_test_failure",{test:true});
    await DiscoveryTelemetry.flush();
    assert.equal(DiscoveryTelemetry.status().failed,before+1);
    const me=await prisma.user.create({data:profile(randomUUID(),"man")});
    await verifyUsers([me.id]);
    const page=await RecommendationService.getRecommendations(me.id,undefined,1);
    assert.equal(page.cards.length,1);
  } finally {
    await DiscoveryTelemetry.flush();
    await prisma.$executeRawUnsafe("ALTER TABLE analytics_events DROP CONSTRAINT telemetry_test_reject");
  }
});

test("algorithm report commands persist evaluations and nonempty shadow comparisons", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { resolve } = await import("node:path");
  const run = promisify(execFile);
  for(const script of ["evaluate-reciprocity.ts","shadow-report.ts","discovery-report.ts"]) {
    await run(process.execPath,[require.resolve("tsx/cli"),resolve(__dirname,"../scripts",script)],
      {cwd:resolve(__dirname,".."),env:process.env,timeout:30000});
  }
  const comparison=await prisma.analyticsEvent.findFirstOrThrow({where:{eventType:"shadow_comparison_report"},orderBy:{createdAt:"desc"}});
  assert.ok((comparison.eventData as any).samples>0);
  assert.ok(Number.isFinite((comparison.eventData as any).top20Overlap));
  assert.ok((comparison.eventData as any).incomingPlacement);
  await prisma.analyticsEvent.findFirstOrThrow({where:{eventType:"reciprocity_evaluation"}});
  await prisma.analyticsEvent.findFirstOrThrow({where:{eventType:"shadow_report"}});
});
