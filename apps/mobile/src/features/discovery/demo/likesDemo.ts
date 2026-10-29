import { demoProfiles } from "./demoProfiles";
import type { ExploreProfile } from "../components/ExploreProfileCard";
import type { CommentShown } from "../comments/commentTypes";

/**
 * Local data for the Likes You and Standouts demos (development builds only,
 * STANDOUTS_LIKES_SPEC.md 7.4). Nothing here is sent anywhere.
 */

export type DemoLike = ExploreProfile & {
  likedAt: string;
  isRose: boolean;
  roseId: string | null;
  roseComment: string | null;
  comment: CommentShown | null;
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

function like(id: string, minutes: number, rose?: { comment: string | null }, comment?: CommentShown): DemoLike | null {
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
    comment: comment ?? null,
    // Arrived in the last hour: shown as new, as a real unseen Like is.
    isNew: minutes <= 60,
  };
}

/**
 * Two Roses (one with a note on your photo) and four Likes (one with a
 * comment on your bio), in the server's shape. `ownPhoto` is yours, so the
 * comment shows the photo it answered.
 */
export function demoLikes(ownPhoto?: string | null) {
  const festNote = "Your photo from the fest made me smile — what were you laughing at?";
  const roses = [
    like("aanya", 50, { comment: festNote },
      { id: "demo-comment-aanya", text: festNote, about: { kind: "photo", photoUrl: ownPhoto ?? null } }),
    like("maya", 400, { comment: null }),
  ].filter((entry): entry is DemoLike => !!entry);
  const likes = [
    like("rohan", 10, undefined,
      { id: "demo-comment-rohan", text: "Okay but which canteen has the best chai? I need to know", about: { kind: "bio", text: "Chai first, then everything else." } }),
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
