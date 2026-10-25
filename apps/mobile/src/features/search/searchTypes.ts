/** One row of `GET /search/people` (SEARCH_SPEC.md 8.2): the social layer only. */
export type SearchPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  department: string | null;
  year: number | null;
  isVerified: boolean;
  /** College verified and face check passed. */
  blueBadge?: boolean;
  followStatus: "pending" | "accepted" | null;
  /** They follow you. Optional: recent searches saved before this existed lack it. */
  followsYou?: boolean;
  /** Only for someone with Stories on (their social profile exists); null otherwise. */
  followersCount?: number | null;
  followingCount?: number | null;
  /** What a classmate recognises someone by. Optional for older recent searches. */
  degree?: string | null;
  yearOfStudy?: number | null;
  graduationYear?: number | null;
  campus?: string | null;
  clubs?: string[];
  /**
   * Their Story ring as this viewer may see it - gradient (unseen), green
   * (unseen Close Friends) or grey (watched) - until `until`. Null or absent
   * when there is nothing this viewer may watch.
   */
  story?: { unseen: boolean; closeFriends: boolean; until: string } | null;
  /**
   * Your own dating decision about them (never theirs): a Like or Rose you
   * sent, a Pass, or a match you both know about. Null: nothing decided yet.
   */
  dating?: MyDatingState | null;
};

export type MyDatingState =
  | { kind: "matched"; matchId: string; at: string }
  | { kind: "rose"; at: string }
  | { kind: "liked"; at: string }
  | { kind: "passed"; at: string };

export type SearchResult = { people: SearchPerson[]; truncated: boolean };

export const SEARCH_MIN_QUERY = 2;
export const SEARCH_DEBOUNCE_MS = 250;

/** The one message for every reason the dating layer stays shut (5.2). */
export const DATING_UNAVAILABLE = "You can't Like this profile right now.";

/** The same normalisation as the server: lower case, no accents, single spaces. */
export function searchTokens(query: string): string[] {
  return query
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
}

/** Every token a prefix of some word: "sub pat" finds "Subhankar Patra", "hank" does not. */
export function matchesName(name: string, tokens: string[]) {
  const words = searchTokens(name);
  return tokens.length > 0 && tokens.every((token) => words.some((word) => word.startsWith(token)));
}

export function exactName(name: string, tokens: string[]) {
  const words = searchTokens(name);
  return tokens.every((token) => words.includes(token));
}

/** 1 -> "1st year", 3 -> "3rd year". */
export function yearLabel(year: number) {
  const suffix = year % 100 >= 11 && year % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][year % 10] ?? "th";
  return `${year}${suffix} year`;
}

export function personMeta(person: Pick<SearchPerson, "department" | "year">) {
  const year = !person.year ? null : person.year > 1000 ? `Class of ${person.year}` : `Year ${person.year}`;
  return [person.department, year].filter(Boolean).join(" · ");
}
