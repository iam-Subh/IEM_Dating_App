import { demoProfiles } from "./demoProfiles";
import type { ExploreProfile } from "../components/ExploreProfileCard";

/**
 * Local data for the Likes You and Standouts demos (development builds only,
 * STANDOUTS_LIKES_SPEC.md 7.4). Nothing here is sent anywhere.
 */

export type DemoLike = ExploreProfile & {
  likedAt: string;
  isRose: boolean;
  roseId: string | null;
  roseComment: string | null;
  isNew: boolean;
};

export type DemoStandout = ExploreProfile & { reasons: string[]; roseSent: boolean };

const byId = (id: string) => demoProfiles.find((profile) => profile.id === id);
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const demoCompatibility: Record<string, number> = {
  rohan: 68,
  rupsa: 89,
  subh: 76,
  alexandria: 54,
};

function like(id: string, minutes: number, rose?: { comment: string | null }): DemoLike | null {
  const profile = byId(id);
  if (!profile) return null;
  return {
    ...profile,
    id: `demo-like-${id}`,
    compatibilityScore: demoCompatibility[id] ?? profile.compatibilityScore,
    likedAt: minutesAgo(minutes),
    isRose: !!rose,
    roseId: rose ? `demo-rose-${id}` : null,
    roseComment: rose?.comment ?? null,
    // Arrived in the last hour: shown as new, as a real unseen Like is.
    isNew: minutes <= 60,
  };
}

/** Two Roses (one with a note) and four Likes, in the server's shape. */
export function demoLikes() {
  const roses = [
    like("aanya", 50, { comment: "Your photo from the fest made me smile — what were you laughing at?" }),
    like("maya", 400, { comment: null }),
  ].filter((entry): entry is DemoLike => !!entry);
  const likes = [
    like("rohan", 10),
    like("subh", 700),
    like("alexandria", 2400),
  ].filter((entry): entry is DemoLike => !!entry);
  return { roses, likes };
}

/** The demo's live arrival: Rupsa's Like, landing while the screen is open. */
export function demoArrival(): DemoLike | null {
  return like("rupsa", 0);
}

/** "Your type": the demo's compatibility order. */
export function demoByType<T extends Pick<DemoLike, "compatibilityScore" | "likedAt">>(likes: T[]): T[] {
  return [...likes].sort((a, b) =>
    (b.compatibilityScore ?? -1) - (a.compatibilityScore ?? -1)
    || new Date(b.likedAt).getTime() - new Date(a.likedAt).getTime(),
  );
}

const REASONS: Record<string, string[]> = {
  aanya: ["3 shared interests", "Same department"],
  rohan: ["2 shared interests"],
  maya: ["Same relationship goal", "1 shared club"],
  rupsa: ["4 shared interests", "Same hangout spots"],
  subh: ["Same department"],
  alexandria: ["New on IEM Connect", "2 shared interests"],
};

/** Six Standouts with reasons; one already has a Rose. */
export function demoStandouts(): DemoStandout[] {
  return demoProfiles.map((profile, index) => ({
    ...profile,
    id: `demo-standout-${profile.id}`,
    reasons: REASONS[profile.id] ?? [],
    roseSent: index === 2,
    // The new-face slot (STANDOUTS_PLAN.md 4.1).
    slot: profile.id === "alexandria" ? ("new" as const) : ("best" as const),
  }));
}
