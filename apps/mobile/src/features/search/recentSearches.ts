import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SearchPerson } from "./searchTypes";

/**
 * Recent searches, on this device only (SEARCH_SPEC.md 9): the server never
 * keeps a history of who looked for whom. Per account, so a shared phone
 * never shows one person's searches to another.
 */
export type RecentSearch =
  | { kind: "person"; person: SearchPerson }
  | { kind: "query"; text: string };

export const RECENT_LIMIT = 8;
const keyFor = (accountId: string) => `search:recent:v1:${accountId}`;

const sameEntry = (a: RecentSearch, b: RecentSearch) =>
  a.kind === "person" && b.kind === "person"
    ? a.person.id === b.person.id
    : a.kind === "query" && b.kind === "query" && a.text.toLowerCase() === b.text.toLowerCase();

export async function readRecent(accountId: string): Promise<RecentSearch[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(accountId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as RecentSearch[]).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Newest first, no duplicates, at most eight. */
export function withRecent(list: RecentSearch[], entry: RecentSearch): RecentSearch[] {
  return [entry, ...list.filter((item) => !sameEntry(item, entry))].slice(0, RECENT_LIMIT);
}

export function withoutRecent(list: RecentSearch[], entry: RecentSearch): RecentSearch[] {
  return list.filter((item) => !sameEntry(item, entry));
}

export async function writeRecent(accountId: string, list: RecentSearch[]) {
  try {
    if (list.length) await AsyncStorage.setItem(keyFor(accountId), JSON.stringify(list));
    else await AsyncStorage.removeItem(keyFor(accountId));
  } catch {
    // Only a convenience: losing it loses nothing else.
  }
}
