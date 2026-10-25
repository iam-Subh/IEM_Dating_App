import type { MyDatingState } from "./searchTypes";

export const DECISION_APPEARANCE = {
  matched: { label: "Matched", icon: "chatbubbles", color: "#BCE5D0", background: "#23352D", detail: "Start a conversation in your chat." },
  liked: { label: "Liked", icon: "heart", color: "#F3C1CA", background: "#35262D", detail: "If you both like each other, you will match." },
  rose: { label: "Rose sent", icon: "rose", color: "#F5C5A9", background: "#362B25", detail: "You can send one Rose to each person." },
  passed: { label: "Passed", icon: "close-circle-outline", color: "#C1BDC3", background: "#29272C", detail: "Rewind is only available immediately after a pass." },
} as const;

/** Compare calendar days so midnight and daylight saving do not change the label. */
export function decisionDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const calendarDay = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const days = Math.floor((calendarDay(now) - calendarDay(date)) / 86_400_000);
  if (days < 0) return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 30) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function decisionTitle(name: string, state: MyDatingState): string {
  const first = name.trim().split(/\s+/)[0] || "this person";
  switch (state.kind) {
    case "matched": return `You and ${first} are matched`;
    case "liked": return `You liked ${first}`;
    case "rose": return `You sent ${first} a Rose`;
    case "passed": return `You passed on ${first}`;
  }
}
