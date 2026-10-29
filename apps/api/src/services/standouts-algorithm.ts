import { createHash } from 'crypto';

/**
 * Standouts v3, the pure part (apps/mobile/src/features/discovery/STANDOUTS_PLAN.md):
 * taste learned from swipes, scoring, variety, slots and fair sharing. No
 * database here, so every rule can be tested on its own; the service around it
 * (standouts-v3.service.ts) gathers the data and saves the result.
 */

export type SlotType = 'best' | 'new' | 'wildcard';

/** What the taste profile and the variety rules look at, for one person. */
export type Traits = {
  department: string | null;
  year: number | null;
  campus: string | null;
  hosteller: boolean | null;
  interests: string[];
  seeking: string | null;
  lifestyle: Record<string, string>;
  personality: Record<string, string>;
};

const norm = (value: string) => value.trim().toLowerCase();

/** A person's traits as keys, such as "department:cse" or "interest:music". */
export function traitKeys(traits: Traits): string[] {
  const keys: string[] = [];
  if (traits.department?.trim()) keys.push(`department:${norm(traits.department)}`);
  if (Number.isInteger(traits.year)) keys.push(`year:${traits.year}`);
  if (traits.campus?.trim()) keys.push(`campus:${norm(traits.campus)}`);
  if (typeof traits.hosteller === 'boolean') keys.push(`hosteller:${traits.hosteller}`);
  if (traits.seeking?.trim()) keys.push(`seeking:${norm(traits.seeking)}`);
  for (const interest of new Set(traits.interests.map(norm).filter(Boolean))) keys.push(`interest:${interest}`);
  for (const [key, value] of Object.entries(traits.lifestyle)) if (value?.trim()) keys.push(`lifestyle:${norm(key)}:${norm(value)}`);
  for (const [key, value] of Object.entries(traits.personality)) if (value?.trim()) keys.push(`personality:${norm(key)}:${norm(value)}`);
  return keys;
}

// ---------------------------------------------------------------------------
// Taste, learned from swipes (5.3)
// ---------------------------------------------------------------------------

/** Weighted likes and passes per trait. Small enough to store with the day's set. */
export type TasteProfile = {
  /** Weighted swipes counted, and how many of them were likes. */
  swipes: number;
  likes: number;
  /** trait key -> [weighted likes, weighted passes] */
  traits: Record<string, [number, number]>;
};

export type TasteEvent = { traits: string[]; liked: boolean; weight: number };

/** Below this many swipes there is no taste yet: neutral (5.3). */
export const TASTE_MIN_SWIPES = 15;
/**
 * A new person's Standouts wait until they have swiped this many times
 * ("learning"), so their first set is picked from their taste, not blind.
 * Likes and passes both count: a pass teaches as much as a Like.
 */
export const STANDOUTS_LEARN_SWIPES = TASTE_MIN_SWIPES;
/** A Rose sent from Standouts counts as this many Likes; "Not for me" as this much of a Pass. */
export const ROSE_WEIGHT = 3;
export const NOT_FOR_ME_WEIGHT = 0.5;

export function buildTaste(events: TasteEvent[]): TasteProfile {
  const taste: TasteProfile = { swipes: 0, likes: 0, traits: {} };
  for (const event of events) {
    const weight = Math.max(0, event.weight);
    if (!weight) continue;
    taste.swipes += weight;
    if (event.liked) taste.likes += weight;
    for (const key of event.traits) {
      const entry = taste.traits[key] ?? [0, 0];
      if (event.liked) entry[0] += weight;
      else entry[1] += weight;
      taste.traits[key] = entry;
    }
  }
  // Rounded, and traits seen only faintly dropped, so the stored copy stays small.
  for (const [key, [likes, passes]] of Object.entries(taste.traits)) {
    if (likes + passes < 1) delete taste.traits[key];
    else taste.traits[key] = [Math.round(likes * 10) / 10, Math.round(passes * 10) / 10];
  }
  taste.swipes = Math.round(taste.swipes * 10) / 10;
  taste.likes = Math.round(taste.likes * 10) / 10;
  return taste;
}

/** How often this person Likes, smoothed: the line every trait is compared against. */
function baseRate(taste: TasteProfile) {
  return (taste.likes + 1) / (taste.swipes + 2);
}

/**
 * 0-100: how much this candidate resembles the people this viewer Liked. 50 is
 * "no different from anyone"; null when there is no taste yet. Each trait's
 * Like rate is smoothed and weighed by how much evidence there is, so one
 * Like of a rare department does not decide anything.
 */
export function tasteScore(taste: TasteProfile | null, candidate: string[]): number | null {
  if (!taste || taste.swipes < TASTE_MIN_SWIPES) return null;
  const base = baseRate(taste);
  let weighted = 0;
  let total = 0;
  for (const key of candidate) {
    const entry = taste.traits[key];
    if (!entry) continue;
    const [likes, passes] = entry;
    const seen = likes + passes;
    const rate = (likes + 1) / (seen + 2);
    const evidence = seen / (seen + 5);
    weighted += (rate - base) * evidence;
    total += evidence;
  }
  if (!total) return 50;
  return clamp(50 + 150 * (weighted / total), 0, 100);
}

/** The values of one trait (e.g. "department") this viewer Likes more than usual, best first. */
export function likedValues(taste: TasteProfile | null, trait: string, limit = 3): string[] {
  if (!taste || taste.swipes < TASTE_MIN_SWIPES) return [];
  const base = baseRate(taste);
  const prefix = `${trait}:`;
  return Object.entries(taste.traits)
    .filter(([key, [likes, passes]]) => key.startsWith(prefix) && likes >= 2 && (likes + 1) / (likes + passes + 2) > base)
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, limit)
    .map(([key]) => key.slice(prefix.length));
}

// ---------------------------------------------------------------------------
// Scoring (5.3)
// ---------------------------------------------------------------------------

export type Weights = { compat: number; taste: number; reciprocity: number; fresh: number };

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Active today scores most; inside the activity window, less; older, nothing. */
export function freshnessScore(lastActiveAt: number, now: number) {
  const days = (now - lastActiveAt) / 86_400_000;
  if (days <= 1) return 100;
  if (days <= 3) return 60;
  if (days <= 14) return 30;
  return 0;
}

/** The reciprocity model's points (-5..5) as 0-100; 50 when there is no estimate. */
export function reciprocityScore(points: number | undefined) {
  return points === undefined ? 50 : clamp(50 + points * 10, 0, 100);
}

/**
 * The weighted score, 0-100. Without a taste yet, its weight goes to
 * compatibility (5.3). A candidate with no compatibility evidence scores 40:
 * below an average match, never zero.
 */
export function combinedScore(parts: { compat: number | null; taste: number | null; reciprocity: number; fresh: number }, weights: Weights) {
  const compat = parts.compat ?? 40;
  if (parts.taste === null) {
    return (weights.compat + weights.taste) * compat + weights.reciprocity * parts.reciprocity + weights.fresh * parts.fresh;
  }
  return weights.compat * compat + weights.taste * parts.taste + weights.reciprocity * parts.reciprocity + weights.fresh * parts.fresh;
}

/** Up to `max` points for someone rarely shown this past week; nothing once shown daily (5.5). */
export function underseenBoost(seenThisWeek: number, max: number) {
  return max / (1 + Math.max(0, seenThisWeek));
}

// ---------------------------------------------------------------------------
// Picking (5.4, 5.5)
// ---------------------------------------------------------------------------

/** One candidate in one viewer's ranked list. */
export type Ranked = {
  id: string;
  score: number;
  department: string | null;
  year: number | null;
  seeking: string | null;
  /** Joined in the last 14 days: can fill the new-face slot. */
  isNew: boolean;
  /** Strong match, outside the viewer's usual taste: can fill the wildcard slot. */
  wildcard: boolean;
  /** Fairness group: "<institution>:<category>", or "group:<category>" with no verified college (GOOGLE_SIGNUP_PLAN.md 7.5). */
  segment: string;
};

export type VarietyLimits = { maxPerDepartment: number; maxPerYear: number };

/** The slots of a set of `size`: best fits, then a new face and a wildcard once there is room (4.1). */
export function slotPlan(size: number): SlotType[] {
  if (size >= 6) return [...Array<SlotType>(size - 2).fill('best'), 'new', 'wildcard'];
  if (size >= 4) return [...Array<SlotType>(size - 1).fill('best'), 'new'];
  return Array<SlotType>(size).fill('best');
}

/** A viewer's set being built: what is in it, and the counts the variety rules need. */
export class SetBuilder {
  readonly picks: string[] = [];
  readonly slots: SlotType[] = [];
  private readonly taken = new Set<string>();
  private readonly departments = new Map<string, number>();
  private readonly years = new Map<number, number>();
  private readonly seeking = new Map<string, number>();

  constructor(readonly list: Ranked[], readonly limits: VarietyLimits) {}

  has(id: string) {
    return this.taken.has(id);
  }

  /**
   * The best candidate for this slot right now: free capacity, inside the
   * variety limits, and fitting the slot. A small penalty for repeating "what
   * they're looking for" keeps a mix. Falls back to any best fit when the
   * slot has no one, and to ignoring variety only when nothing else is left.
   */
  next(slot: SlotType, hasCapacity: (candidate: Ranked) => boolean): { candidate: Ranked; slot: SlotType } | null {
    const pick = (fits: (candidate: Ranked) => boolean, variety: boolean) => {
      let best: Ranked | null = null;
      let bestScore = -Infinity;
      for (const candidate of this.list) {
        if (this.taken.has(candidate.id) || !fits(candidate) || !hasCapacity(candidate)) continue;
        if (variety && !this.withinVariety(candidate)) continue;
        const adjusted = candidate.score - 4 * (candidate.seeking ? this.seeking.get(candidate.seeking) ?? 0 : 0);
        if (adjusted > bestScore) {
          best = candidate;
          bestScore = adjusted;
        }
      }
      return best;
    };
    const fitsSlot = slot === 'new' ? (c: Ranked) => c.isNew : slot === 'wildcard' ? (c: Ranked) => c.wildcard : () => true;
    if (slot !== 'best') {
      const special = pick(fitsSlot, true);
      if (special) return { candidate: special, slot };
    }
    const best = pick(() => true, true) ?? pick(() => true, false);
    return best ? { candidate: best, slot: 'best' } : null;
  }

  add(candidate: Ranked, slot: SlotType) {
    this.taken.add(candidate.id);
    this.picks.push(candidate.id);
    this.slots.push(slot);
    if (candidate.department) this.departments.set(candidate.department, (this.departments.get(candidate.department) ?? 0) + 1);
    if (candidate.year !== null) this.years.set(candidate.year, (this.years.get(candidate.year) ?? 0) + 1);
    if (candidate.seeking) this.seeking.set(candidate.seeking, (this.seeking.get(candidate.seeking) ?? 0) + 1);
  }

  private withinVariety(candidate: Ranked) {
    if (candidate.department && (this.departments.get(candidate.department) ?? 0) >= this.limits.maxPerDepartment) return false;
    if (candidate.year !== null && (this.years.get(candidate.year) ?? 0) >= this.limits.maxPerYear) return false;
    return true;
  }
}

/**
 * The most sets one person may be in today, for their group (5.5):
 * `multiplier × (sets in the group's demand ÷ people in it)`, never below 3.
 */
export function fairLimit(demand: number, supply: number, multiplier: number) {
  return Math.max(3, Math.ceil((multiplier * demand) / Math.max(1, supply)));
}

/**
 * Each group's limit from the lists themselves: a viewer's 8 places are
 * spread over groups in proportion to their ranked list, and each group's
 * supply is the distinct people in it.
 */
export function fairLimits(lists: Ranked[][], size: number, multiplier: number): Record<string, number> {
  const demand = new Map<string, number>();
  const supply = new Map<string, Set<string>>();
  for (const list of lists) {
    if (!list.length) continue;
    const share = size / list.length;
    for (const candidate of list) {
      demand.set(candidate.segment, (demand.get(candidate.segment) ?? 0) + share);
      const people = supply.get(candidate.segment) ?? new Set<string>();
      people.add(candidate.id);
      supply.set(candidate.segment, people);
    }
  }
  const limits: Record<string, number> = {};
  for (const [segment, wanted] of demand) limits[segment] = fairLimit(wanted, supply.get(segment)?.size ?? 0, multiplier);
  return limits;
}

/** A stable shuffle for one day, so the order is fair but repeatable. */
export function seededOrder<T extends { id: string }>(items: T[], seed: string): T[] {
  const key = (id: string) => createHash('sha256').update(`${seed}|${id}`).digest('hex');
  return [...items].sort((a, b) => key(a.id).localeCompare(key(b.id)));
}

/**
 * Round-robin across everyone at once (5.5): each round, every viewer takes
 * their best candidate still under the limit. The order snakes (forward,
 * then back), like a sports draft, so nobody always goes first.
 *
 * `appearances` starts with any sets already written today and is updated.
 */
export function roundRobin(
  viewers: { id: string; list: Ranked[]; size: number }[],
  limits: Record<string, number>,
  variety: VarietyLimits,
  seed: string,
  appearances: Map<string, number> = new Map(),
): Map<string, SetBuilder> {
  const order = seededOrder(viewers, seed);
  const builders = new Map(order.map((viewer) => [viewer.id, new SetBuilder(viewer.list, variety)]));
  const plans = new Map(order.map((viewer) => [viewer.id, slotPlan(viewer.size)]));
  const rounds = Math.max(0, ...order.map((viewer) => viewer.size));
  const hasCapacity = (candidate: Ranked) => (appearances.get(candidate.id) ?? 0) < (limits[candidate.segment] ?? 3);
  for (let round = 0; round < rounds; round++) {
    const sequence = round % 2 === 0 ? order : [...order].reverse();
    for (const viewer of sequence) {
      const slot = plans.get(viewer.id)![round];
      if (!slot) continue;
      const builder = builders.get(viewer.id)!;
      const chosen = builder.next(slot, hasCapacity);
      if (!chosen) continue;
      builder.add(chosen.candidate, chosen.slot);
      appearances.set(chosen.candidate.id, (appearances.get(chosen.candidate.id) ?? 0) + 1);
    }
  }
  return builders;
}

/** A set's size from its pool (4.1): the full size from 24 eligible people; smaller below; none under 3. */
export function setSize(pool: number, full: number) {
  if (pool < 3) return 0;
  if (pool >= 24) return full;
  return Math.min(full, Math.max(3, Math.floor(pool / 2)));
}
