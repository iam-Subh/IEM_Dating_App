/**
 * Unit tests for Standouts v3's pure rules (STANDOUTS_PLAN.md, section 5).
 * No database: safe to run at any time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOT_FOR_ME_WEIGHT, ROSE_WEIGHT, buildTaste, combinedScore, fairLimit, fairLimits, freshnessScore,
  likedValues, reciprocityScore, roundRobin, SetBuilder, setSize, slotPlan, tasteScore, traitKeys, underseenBoost,
  type Ranked,
} from '../src/services/standouts-algorithm';

const WEIGHTS = { compat: 0.5, taste: 0.25, reciprocity: 0.2, fresh: 0.05 };

function candidate(id: string, score: number, extra: Partial<Ranked> = {}): Ranked {
  return { id, score, department: 'cse', year: 3, seeking: 'relationship', isNew: false, wildcard: false, segment: 'iem:woman', ...extra };
}

test('traits become keys, normalised', () => {
  const keys = traitKeys({
    department: ' CSE ', year: 3, campus: 'Salt Lake', hosteller: true, interests: ['Music', 'music', 'Chess'],
    seeking: 'Relationship', lifestyle: { drinking: 'Never' }, personality: { personality: 'Introvert' },
  });
  assert.deepEqual(keys, [
    'department:cse', 'year:3', 'campus:salt lake', 'hosteller:true', 'seeking:relationship',
    'interest:music', 'interest:chess', 'lifestyle:drinking:never', 'personality:personality:introvert',
  ]);
});

test('no taste below 20 swipes: neutral, and compatibility takes its weight', () => {
  const taste = buildTaste(Array.from({ length: 10 }, () => ({ traits: ['department:cse'], liked: true, weight: 1 })));
  assert.equal(tasteScore(taste, ['department:cse']), null);
  const withoutTaste = combinedScore({ compat: 80, taste: null, reciprocity: 50, fresh: 100 }, WEIGHTS);
  assert.equal(withoutTaste, 0.75 * 80 + 0.2 * 50 + 0.05 * 100);
});

test('taste prefers what was Liked and avoids what was passed', () => {
  const events = [
    ...Array.from({ length: 15 }, () => ({ traits: ['department:cse', 'interest:music'], liked: true, weight: 1 })),
    ...Array.from({ length: 15 }, () => ({ traits: ['department:mech'], liked: false, weight: 1 })),
  ];
  const taste = buildTaste(events);
  const liked = tasteScore(taste, ['department:cse', 'interest:music'])!;
  const passed = tasteScore(taste, ['department:mech'])!;
  const unknown = tasteScore(taste, ['department:civil'])!;
  assert.ok(liked > 60, `liked traits score high, got ${liked}`);
  assert.ok(passed < 40, `passed traits score low, got ${passed}`);
  assert.equal(unknown, 50, 'a trait never seen is neutral, not a penalty');
  assert.deepEqual(likedValues(taste, 'department'), ['cse']);
});

test('a Rose counts more than a Like, and "Not for me" less than a Pass', () => {
  const taste = buildTaste([
    { traits: ['department:cse'], liked: true, weight: ROSE_WEIGHT },
    { traits: ['department:it'], liked: false, weight: NOT_FOR_ME_WEIGHT },
  ]);
  assert.deepEqual(taste.traits['department:cse'], [3, 0]);
  assert.equal(taste.traits['department:it'], undefined, 'a single faint signal is dropped');
});

test('scores: freshness, reciprocity, no evidence, under-seen boost', () => {
  const now = Date.now();
  assert.equal(freshnessScore(now - 3_600_000, now), 100);
  assert.equal(freshnessScore(now - 2 * 86_400_000, now), 60);
  assert.equal(freshnessScore(now - 10 * 86_400_000, now), 30);
  assert.equal(reciprocityScore(undefined), 50);
  assert.equal(reciprocityScore(5), 100);
  assert.equal(reciprocityScore(-9), 0);
  const noEvidence = combinedScore({ compat: null, taste: 50, reciprocity: 50, fresh: 0 }, WEIGHTS);
  assert.equal(noEvidence, 0.5 * 40 + 0.25 * 50 + 0.2 * 50);
  assert.equal(underseenBoost(0, 5), 5);
  assert.ok(underseenBoost(7, 5) < 1);
});

test('slots: best fits, then a new face and a wildcard once there is room', () => {
  assert.deepEqual(slotPlan(8), ['best', 'best', 'best', 'best', 'best', 'best', 'new', 'wildcard']);
  assert.deepEqual(slotPlan(4), ['best', 'best', 'best', 'new']);
  assert.deepEqual(slotPlan(3), ['best', 'best', 'best']);
  assert.equal(setSize(2, 8), 0);
  assert.equal(setSize(10, 8), 5);
  assert.equal(setSize(24, 8), 8);
});

test('variety: at most 2 from a department and 3 from a year, unless nothing else is left', () => {
  const list = [
    candidate('a', 99), candidate('b', 98), candidate('c', 97),
    candidate('d', 60, { department: 'it', year: 2 }),
  ];
  const builder = new SetBuilder(list, { maxPerDepartment: 2, maxPerYear: 3 });
  const always = () => true;
  for (let i = 0; i < 4; i++) {
    const next = builder.next('best', always)!;
    builder.add(next.candidate, next.slot);
  }
  assert.deepEqual(builder.picks, ['a', 'b', 'd', 'c'], 'the third CSE waits until nothing else is left');
});

test('a new-face slot takes a new person, and falls back to a best fit when there is none', () => {
  const list = [candidate('old', 90), candidate('fresh', 50, { isNew: true, department: 'it' })];
  const builder = new SetBuilder(list, { maxPerDepartment: 2, maxPerYear: 3 });
  assert.equal(builder.next('new', () => true)!.candidate.id, 'fresh');
  const empty = new SetBuilder([candidate('old', 90)], { maxPerDepartment: 2, maxPerYear: 3 });
  assert.deepEqual(empty.next('wildcard', () => true), { candidate: empty.list[0], slot: 'best' });
});

test('fair limit: 1,000 men × 8 over 1,200 women at 2.5 is 17, never below 3', () => {
  assert.equal(fairLimit(8000, 1200, 2.5), 17);
  assert.equal(fairLimit(5, 1000, 2.5), 3);
  const lists = [[candidate('x', 1), candidate('y', 1)], [candidate('x', 1), candidate('y', 1)]];
  // 2 viewers × 8 places over 2 people = 8 each on average, × 2.5 = 20.
  assert.deepEqual(fairLimits(lists, 8, 2.5), { 'iem:woman': 20 });
});

test('round-robin shares the most compatible person instead of handing them to everyone', () => {
  // Everyone's favourite is "star"; the limit lets them into only 3 sets.
  const viewers = Array.from({ length: 10 }, (_, index) => ({
    id: `v${index}`,
    size: 3,
    list: [
      candidate('star', 100, { department: 'a' }),
      ...Array.from({ length: 12 }, (_, other) => candidate(`p${other}`, 80 - other, { department: `d${other}`, year: other })),
    ],
  }));
  const sets = roundRobin(viewers, { 'iem:woman': 3 }, { maxPerDepartment: 2, maxPerYear: 3 }, '2026-10-02');
  const withStar = [...sets.values()].filter((set) => set.picks.includes('star')).length;
  assert.equal(withStar, 3, 'the favourite appears exactly up to the limit');
  for (const set of sets.values()) assert.equal(set.picks.length, 3, 'everyone still gets a full set');
  const appearances = new Map<string, number>();
  for (const set of sets.values()) for (const id of set.picks) appearances.set(id, (appearances.get(id) ?? 0) + 1);
  for (const count of appearances.values()) assert.ok(count <= 3, 'nobody passes the limit');
});

test('round-robin is repeatable for a day and fair to whoever goes first', () => {
  const viewers = Array.from({ length: 4 }, (_, index) => ({ id: `v${index}`, size: 2, list: [candidate('star', 100), candidate('second', 90, { department: 'it' })] }));
  const one = roundRobin(viewers, { 'iem:woman': 2 }, { maxPerDepartment: 2, maxPerYear: 3 }, 'day-1');
  const two = roundRobin(viewers, { 'iem:woman': 2 }, { maxPerDepartment: 2, maxPerYear: 3 }, 'day-1');
  assert.deepEqual([...one.entries()].map(([id, set]) => [id, set.picks]), [...two.entries()].map(([id, set]) => [id, set.picks]));
});
