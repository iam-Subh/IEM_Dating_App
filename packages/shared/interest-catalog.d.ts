export type InterestOption = { id: string; label: string };
export type InterestCategory = { id: string; title: string; icon: string; emoji: string; interests: InterestOption[] };
export const INTEREST_CATEGORIES: InterestCategory[];
export function normalizeInterest(value: string): string;
export function normalizeInterests(values: unknown): string[];
export function interestLookupValues(values: unknown): string[];
