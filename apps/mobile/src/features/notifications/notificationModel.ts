import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

/**
 * The notification centre's data, and the three things done to it on the
 * phone: the words for each row, the time sections, and stacking - several
 * of the same thing in a row become one stack you can open.
 */

export const CATEGORIES = ["likes", "matches", "messages", "stories", "follows", "account"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  likes: "Likes",
  matches: "Matches",
  messages: "Messages",
  stories: "Stories",
  follows: "Follows",
  account: "Account",
};

type IconName = ComponentProps<typeof Ionicons>["name"];

export type Actor = { id: string; name: string; avatarUrl: string | null };
export type Target =
  /** `empty`: a new match with no message yet - the row offers "Say hi". */
  | { kind: "chat"; matchId: string; empty?: boolean }
  | { kind: "likes" }
  /** A follow request answerable in the row, and whether you follow them back. */
  | {
      kind: "follow_requests";
      followId?: string;
      state?: "pending" | "accepted" | "declined" | "gone";
      followBack?: "none" | "pending" | "accepted";
    }
  | { kind: "story"; storyId: string }
  | null;

export type NotificationItem = {
  id: string;
  type: string;
  category: Category;
  title: string;
  body: string;
  emoji: string | null;
  createdAt: string;
  isRead: boolean;
  actor: Actor | null;
  target: Target;
  /** Optional media preview for the activity feed. */
  preview?: { uri: string };
  /** A message row's message as one line - its text, or 📷 Photo, 🎤 Voice message... */
  messageText?: string | null;
};

export type Unread = { total: number; byCategory: Record<Category, number> };
export const NO_UNREAD: Unread = {
  total: 0,
  byCategory: { likes: 0, matches: 0, messages: 0, stories: 0, follows: 0, account: 0 },
};

export function countNotifications(items: NotificationItem[]): Unread {
  const byCategory = { ...NO_UNREAD.byCategory };
  for (const item of items) if (!item.isRead) byCategory[item.category] += 1;
  return { total: Object.values(byCategory).reduce((sum, count) => sum + count, 0), byCategory };
}

/** The icon and colour of each kind, shown where there is no face. */
export const LOOK: Record<string, { icon: IconName; color: string }> = {
  like: { icon: "heart", color: "#FF5A5F" },
  rose: { icon: "rose", color: "#C2185B" },
  match: { icon: "sparkles", color: "#FFB74D" },
  message: { icon: "chatbubble", color: "#4F8EF7" },
  reaction: { icon: "happy", color: "#4F8EF7" },
  story_mention: { icon: "at", color: "#B36BFF" },
  story_countdown: { icon: "timer", color: "#B36BFF" },
  story_post_failed: { icon: "alert-circle", color: "#FF8C42" },
  follow_request: { icon: "person-add", color: "#2EC4B6" },
  follow: { icon: "person-add", color: "#DB7296" },
  follow_accepted: { icon: "checkmark", color: "#DB7296" },
  story_like: { icon: "heart", color: "#F16683" },
  story_reply: { icon: "chatbubble", color: "#DB7296" },
  system: { icon: "information-circle", color: "#9AA0A6" },
};
export const lookOf = (type: string) => LOOK[type] ?? LOOK.system;

/** One row's words. The server stores lock-screen text; in the app a name can be said. */
export function textOf(item: NotificationItem): { lead: string; rest: string } {
  const name = item.actor?.name;
  switch (item.type) {
    case "message":
      // The message itself, as in the chat list; the old wording only for a feed without it.
      if (name && item.messageText) return { lead: `${name}:`, rest: item.messageText };
      return name ? { lead: name, rest: item.body === "Sent an attachment" ? "sent you an attachment" : "sent you a message" } : { lead: "", rest: item.messageText ?? "New message" };
    case "reaction":
      return name ? { lead: name, rest: `reacted ${item.emoji ?? ""} to your message`.replace("  ", " ") } : { lead: "", rest: item.body };
    case "match":
      return name ? { lead: "", rest: `You and ${name} matched. Say hello!` } : { lead: "", rest: "You have a new match" };
    case "follow_request":
      return name ? { lead: name, rest: "wants to follow you" } : { lead: "", rest: "New follow request" };
    case "follow":
      return { lead: name ?? "Someone", rest: "started following you" };
    case "follow_accepted":
      return { lead: name ?? "Someone", rest: "accepted your follow request" };
    case "story_like":
      return { lead: name ?? "Someone", rest: "liked your story" };
    case "story_reply":
      return { lead: name ?? "Someone", rest: "replied to your story" };
    case "story_mention":
      return name ? { lead: name, rest: "mentioned you in their story" } : { lead: "", rest: "Someone mentioned you in their story" };
    case "rose":
      return { lead: "", rest: "Someone sent you a Rose" };
    case "like":
      return { lead: "", rest: "You have new Likes" };
    default:
      return { lead: "", rest: item.body ? `${item.title} · ${item.body}` : item.title };
  }
}

/** "now", "5m", "3h", "2d", "3w" - the running clock on each row. */
export function ago(iso: string, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

export type SectionKey = "today" | "yesterday" | "week" | "earlier";
export const SECTION_TITLES: Record<SectionKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  earlier: "Earlier",
};

export function sectionOf(iso: string, now = new Date()): SectionKey {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = new Date(iso).getTime();
  if (at >= startOfToday) return "today";
  if (at >= startOfToday - 24 * 60 * 60_000) return "yesterday";
  if (at >= startOfToday - 6 * 24 * 60 * 60_000) return "week";
  return "earlier";
}

/** What may stack together: the same chat, all Likes, all follow requests. */
function stackKey(item: NotificationItem): string | null {
  if ((item.type === "message" || item.type === "reaction") && item.target?.kind === "chat") return `chat:${item.target.matchId}`;
  if (item.type === "like" || item.type === "rose") return "likes";
  if (item.type === "follow_request") return "follows";
  if (item.type === "story_mention") return "mentions";
  if (item.type === "story_like" && item.target?.kind === "story") return `story-likes:${item.target.storyId}`;
  return null;
}

export type Row =
  | { kind: "single"; key: string; item: NotificationItem }
  | { kind: "stack"; key: string; items: NotificationItem[] };

export type Section = { key: SectionKey; title: string; rows: Row[] };

/**
 * Time sections, newest first, and inside each, stacks: every item of the
 * same kind (see `stackKey`) in that section gathers under its newest one.
 */
export function buildSections(items: NotificationItem[], now = new Date()): Section[] {
  const order: SectionKey[] = ["today", "yesterday", "week", "earlier"];
  return order.flatMap((key) => {
    const inSection = items.filter((item) => sectionOf(item.createdAt, now) === key);
    if (!inSection.length) return [];
    const rows: Row[] = [];
    const stacks = new Map<string, Extract<Row, { kind: "stack" }>>();
    for (const item of inSection) {
      const group = stackKey(item);
      const existing = group ? stacks.get(group) : undefined;
      if (existing) {
        existing.items.push(item);
        continue;
      }
      if (group) {
        const stack = { kind: "stack" as const, key: `${key}:${group}`, items: [item] };
        stacks.set(group, stack);
        rows.push(stack);
      } else {
        rows.push({ kind: "single", key: item.id, item });
      }
    }
    // A stack of one is just a row.
    return [{
      key,
      title: SECTION_TITLES[key],
      rows: rows.map((row) => (row.kind === "stack" && row.items.length === 1 ? { kind: "single" as const, key: row.items[0].id, item: row.items[0] } : row)),
    }];
  });
}

/** The words for a stack, from its newest item. */
export function stackText(items: NotificationItem[]): { lead: string; rest: string } {
  const first = items[0];
  const count = items.length;
  const unread = items.filter((item) => !item.isRead).length;
  switch (first.type) {
    case "message":
    case "reaction":
      return first.actor
        ? { lead: first.actor.name, rest: `sent you ${count} messages` }
        : { lead: "", rest: `${count} new messages` };
    case "like":
    case "rose": {
      const roses = items.filter((item) => item.type === "rose").length;
      return { lead: "", rest: roses ? `${count} new Likes, ${roses === 1 ? "one" : roses} with a Rose` : `${unread || count} new Likes` };
    }
    case "follow_request": {
      const names = [...new Set(items.map((item) => item.actor?.name).filter(Boolean))] as string[];
      return names.length
        ? { lead: names[0], rest: names.length > 1 ? `and ${count - 1} ${count - 1 === 1 ? "other" : "others"} want to follow you` : "wants to follow you" }
        : { lead: "", rest: `${count} follow requests` };
    }
    case "story_mention":
      return { lead: "", rest: `${count} mentions in stories` };
    case "story_like": {
      const names = [...new Set(items.map((item) => item.actor?.name).filter(Boolean))] as string[];
      return { lead: names[0] ?? "Someone", rest: names.length > 1 ? `and ${names.length - 1} ${names.length === 2 ? "other" : "others"} liked your story` : "liked your story" };
    }
    default:
      return { lead: "", rest: `${count} notifications` };
  }
}
