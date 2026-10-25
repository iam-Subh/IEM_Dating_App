import { createHash } from "crypto";

export type RankingCandidate = {
  id: string;
  score: number | null;
  /** No valid college verification: shown after verified people with a similar score (GOOGLE_SIGNUP_PLAN.md 3). */
  unverified?: boolean;
  /** Passed the real-person check, and every photo and the video still match (PHOTO_VERIFICATION_PLAN.md). */
  realPerson?: boolean;
  /** Passed it once, but a photo or the video now doesn't match: until it's fixed. */
  photoIssue?: boolean;
  visibleCount: number;
  active: boolean;
  hasPhoto: boolean;
  incomingLike: boolean;
  reciprocityPoints?: number;
};

// Bounded at 25 points, with a logarithmic tail beyond 147 daily views.
export function exposurePenalty(count: number) {
  return Math.min(25, 2 * Math.log1p(Math.max(0, count)));
}

export function rankCandidates(
  candidates: RankingCandidate[],
  viewerId: string,
  seed: string,
  policy: boolean,
  coldSlots = 2,
  incomingSlots = 1,
) {
  if (
    !Number.isInteger(coldSlots) ||
    coldSlots < 0 ||
    coldSlots > 4 ||
    !Number.isInteger(incomingSlots) ||
    incomingSlots < 0 ||
    incomingSlots > 2
  )
    throw new Error("Invalid ranking reservations");
  const unique = [...new Map(candidates.map((p) => [p.id, p])).values()];
  const hashes = new Map(
    unique.map((p) => [
      p.id,
      createHash("sha256")
        .update(JSON.stringify([viewerId, seed, p.id]))
        .digest("hex"),
    ]),
  );
  const tie = (a: RankingCandidate, b: RankingCandidate) =>
    hashes.get(a.id)!.localeCompare(hashes.get(b.id)!);
  // Unverified: a few points down, so a verified person with a similar score
  // comes first - shown, never hidden.
  const UNVERIFIED_PENALTY = 6;
  // The real-person check: a little ahead, as a trust signal - never required.
  // A photo that isn't them: a little behind, until it's fixed.
  const REAL_PERSON_BONUS = 3;
  const PHOTO_ISSUE_PENALTY = 4;
  const adjustment = (p: RankingCandidate) =>
    (p.unverified ? -UNVERIFIED_PENALTY : 0) +
    (p.realPerson ? REAL_PERSON_BONUS : 0) -
    (p.photoIssue ? PHOTO_ISSUE_PENALTY : 0) +
    (policy
      ? (p.active ? 5 : 0) +
        (p.hasPhoto ? 2 : 0) -
        exposurePenalty(p.visibleCount) +
        Math.max(-5, Math.min(5, p.reciprocityPoints ?? 0))
      : 0);
  const scores = new Map(
    unique.filter((p): p is RankingCandidate & { score: number } => p.score !== null)
      .map((p) => [p.id, p.score + adjustment(p)]),
  );
  const known = unique
    .filter((p) => p.score !== null)
    .sort((a, b) => scores.get(b.id)! - scores.get(a.id)! || tie(a, b));
  // Missing evidence uses a separate pool. Reservations transfer unused capacity.
  const cold = unique
    .filter((p) => p.score === null)
    .sort((a, b) =>
      Number(!!a.unverified) - Number(!!b.unverified) ||
      (policy
        ? a.visibleCount - b.visibleCount ||
          Number(b.active) - Number(a.active) ||
          Number(b.hasPhoto) - Number(a.hasPhoto) ||
          tie(a, b)
        : tie(a, b)),
    );
  const explore = [...unique].sort(tie);
  const incoming = [...known, ...cold].filter((p) => p.incomingLike);
  const pools = { known, cold, explore, incoming };
  const offsets = { known: 0, cold: 0, explore: 0, incoming: 0 };
  const used = new Set<string>();
  const take = (name: keyof typeof pools) => {
    const pool = pools[name];
    while (offsets[name] < pool.length) {
      const next = pool[offsets[name]++];
      if (!used.has(next.id)) return next;
    }
    return undefined;
  };
  const result: string[] = [];
  // Each iteration emits a unique candidate or stops. Pool offsets only increase.
  // This remains finite when input contains duplicates or any pool is exhausted.
  for (let position = 0; position < unique.length; position++) {
    const preferred = [4, 9, 2, 7].slice(0, coldSlots).includes(position % 10)
      ? "cold"
      : policy && [1, 6].slice(0, incomingSlots).includes(position % 10)
        ? "incoming"
        : policy && position % 10 === 8
          ? "explore"
          : "known";
    const next =
      take(preferred) ?? take("known") ?? take("cold") ?? take("explore");
    if (!next) break;
    used.add(next.id);
    result.push(next.id);
  }
  return result;
}
