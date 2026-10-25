export type DiscoveryCategory = "man" | "woman" | "nonbinary";
export interface DiscoverySettings {
  discoveryCategory: DiscoveryCategory;
  showMeCategories: DiscoveryCategory[];
  minAgePref: number;
  maxAgePref: number;
  discoveryMode: "college" | "distance";
  distancePreference: number;
}
export interface CompatibilityFactor {
  id: string;
  label: string;
  similarity: number;
  weight: number;
  sharedValues: string[];
  points: number;
  boost: string;
}
export interface DiscoveryCard {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  orientation: string[];
  showGender: boolean;
  showOrientation: boolean;
  college: string | null;
  department: string | null;
  graduationYear: number | null;
  campus: string | null;
  isHosteller: boolean | null;
  height: number | null;
  clubs: string[];
  degree: string | null;
  yearOfStudy: number | null;
  attendanceMood: string | null;
  hangoutSpots: string[];
  preferences: {
    bio: string | null;
    interests: string[];
    lifestyle: Record<string, string>;
    personality: Record<string, string>;
  };
  seeking: string | null;
  /** College verified: unlocks college-only features and "Verified students only". */
  isVerified: boolean;
  /** The blue badge: college verified and face check passed, both current. */
  blueBadge?: boolean;
  /** Passed the real-person check and every photo still matches; badge on the expanded profile only. */
  realPerson?: boolean;
  primaryPhoto: string | null;
  photos: string[];
  video: string | null;
  /** Still frame shown until the video's first frame renders. */
  videoPoster: string | null;
  /** A distance band, only for a viewer in distance mode, never finer than "Under 5 km". */
  distanceLabel: string | null;
  /** "UEM Kolkata": set only when the person is from another institution than the viewer. */
  institutionLabel: string | null;
  /** "Jaipur": set only when that institution is in another city. */
  cityLabel: string | null;
  /** "Visiting · UEM Jaipur": a distance-mode person far from their own campus. */
  visitingLabel: string | null;
  /** "now" (Active now) or "recent" (Recently active, within a day); null when either side keeps theirs private. */
  activity?: 'now' | 'recent' | null;
  matchPercentage: number | null;
  compatibilityScore: number | null;
  matchFactors: CompatibilityFactor[];
  evidenceCoverage: number;
  scoreVersion: number;
  impressionId: string;
  canRequestFollow: boolean;
}
export interface DiscoveryPage {
  cards: DiscoveryCard[];
  nextCursor: string | null;
  state: "setup_required" | "ready" | "exhausted" | "generation_complete" | "capacity_limited";
  deckId: string | null;
}
