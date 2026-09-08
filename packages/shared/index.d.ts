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
  isVerified: boolean;
  primaryPhoto: string | null;
  photos: string[];
  video: string | null;
  videoPreview: string | null;
  distanceLabel: string | null;
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
