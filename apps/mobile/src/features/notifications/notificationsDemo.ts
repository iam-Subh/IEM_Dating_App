import { demoProfiles } from "../discovery/demo/demoProfiles";
import type { Actor, NotificationItem } from "./notificationModel";

/**
 * Notification centre demo (development builds only): every kind, across
 * every time section, with stacks - and two that arrive live while the page
 * is open. Nothing is sent anywhere.
 */

const person = (id: string, name: string): Actor => ({
  id: `demo-${id}`,
  name,
  avatarUrl: demoProfiles.find((profile) => profile.id === id)?.primaryPhoto ?? null,
});
const RUPSA = person("rupsa", "Rupsa Das");
const MAYA = person("maya", "Maya Iyer");
const ROHAN = person("rohan", "Rohan Mehta");
const AANYA = person("aanya", "Aanya Sen");
const SUBH = person("subh", "Subhankar Patra");

let serial = 0;
function item(minutesAgo: number, fields: Partial<NotificationItem> & Pick<NotificationItem, "type" | "category">): NotificationItem {
  serial += 1;
  return {
    id: `demo-note-${serial}`,
    title: "",
    body: "",
    emoji: null,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    isRead: minutesAgo > 24 * 60,
    actor: null,
    target: null,
    ...fields,
  };
}
const chat = (who: Actor) => ({ kind: "chat" as const, matchId: `demo-match-${who.id}` });
const request = (id: string) => ({ kind: "follow_requests" as const, followId: `demo-follow-${id}`, state: "pending" as const, followBack: "none" as const });

export function demoNotifications(): NotificationItem[] {
  serial = 0;
  return [
    // Today
    item(2, { type: "message", category: "messages", body: "Sent you a message", messageText: "Are we still on for chai after class?", actor: RUPSA, target: chat(RUPSA) }),
    item(6, { type: "message", category: "messages", body: "Sent you a message", messageText: "📷 Photo", actor: RUPSA, target: chat(RUPSA) }),
    item(9, { type: "reaction", category: "messages", body: "Reacted ❤️ to your message", emoji: "❤️", actor: RUPSA, target: chat(RUPSA) }),
    item(14, { type: "rose", category: "likes", title: "Someone sent you a Rose", target: { kind: "likes" } }),
    item(35, { type: "like", category: "likes", title: "You have new Likes", target: { kind: "likes" } }),
    item(80, { type: "like", category: "likes", title: "You have new Likes", target: { kind: "likes" } }),
    item(120, { type: "match", category: "matches", actor: MAYA, target: { ...chat(MAYA), empty: true } }),
    item(190, { type: "story_mention", category: "stories", actor: AANYA, target: { kind: "story", storyId: "demo-story" } }),
    // Yesterday
    item(26 * 60, { type: "follow_request", category: "follows", actor: ROHAN, target: request("rohan") }),
    item(28 * 60, { type: "follow_request", category: "follows", actor: SUBH, target: request("subh") }),
    item(30 * 60, { type: "story_countdown", category: "stories", title: "Countdown ended", body: "Farewell party has started." }),
    // This week
    item(3 * 24 * 60, { type: "message", category: "messages", body: "Sent an attachment", actor: MAYA, target: chat(MAYA) }),
    item(4 * 24 * 60, { type: "story_post_failed", category: "stories", title: "Couldn't post your story", body: "Open the app to try again." }),
    ...demoSystemNotifications(),
  ];
}

/** Historical examples only. These do not change verification or account state. */
export function demoSystemNotifications(): NotificationItem[] {
  return [
    item(12 * 24 * 60, { type: 'system', category: 'account', title: 'Welcome to IEM Connect', body: 'Your college email is verified.' }),
    item(22, { type: 'system', category: 'account', title: 'New sign-in on a Samsung Galaxy S24', body: 'Not you? Tap to secure your account.' }),
    item(5 * 60, { type: 'system', category: 'account', title: 'Selfie check complete', body: 'Your profile photos match your selfie.' }),
    item(26 * 60, { type: 'system', category: 'account', title: 'Your profile pauses in 3 days', body: 'Open the app to finish verifying and stay visible. It takes a minute.' }),
    item(27 * 60, { type: 'system', category: 'account', title: 'One of your photos needs a look', body: "It doesn't seem to show you. Replace or remove it to keep your real-person check." }),
    item(3 * 24 * 60, { type: 'system', category: 'account', title: 'Your college verification ends in 7 days', body: 'Re-verify with your college email to keep your blue badge.' }),
    item(4 * 24 * 60, { type: 'system', category: 'account', title: 'Thanks - we acted on your report', body: 'Thanks for helping keep IEM Connect safe.' }),
    item(5 * 24 * 60, { type: 'system', category: 'account', title: 'Your birthday was updated', body: 'Thanks - your profile shows the new date.' }),
    item(6 * 24 * 60, { type: 'team', category: 'account', title: 'Choose your story audience', body: 'Choose Your story or Close Friends before sharing. You can change the audience for each new story.' }),
  ];
}

/** Arrivals while the page is open: another message from Rupsa, then a follow request. */
export function demoArrivals(): Array<{ afterMs: number; item: NotificationItem }> {
  return [
    { afterMs: 4000, item: { ...item(0, { type: "message", category: "messages", body: "Sent you a message", messageText: "Just reached the library 👋", actor: RUPSA, target: chat(RUPSA) }), id: "demo-live-1", isRead: false } },
    { afterMs: 9000, item: { ...item(0, { type: "follow_request", category: "follows", actor: AANYA, target: request("aanya") }), id: "demo-live-2", isRead: false } },
  ];
}

const storyPreview = { uri: AANYA.avatarUrl ?? 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=80' };
const story = { kind: 'story' as const, storyId: 'demo-activity-story' };

export function demoActivityNotifications(): NotificationItem[] {
  return [
    { ...item(1, { type: 'follow_request', category: 'follows', actor: AANYA, target: request('aanya') }), isRead: false },
    { ...item(12, { type: 'follow', category: 'follows', actor: MAYA, target: { ...request('maya'), state: 'accepted' } }), isRead: true },
    { ...item(25, { type: 'story_like', category: 'stories', actor: ROHAN, target: story, preview: storyPreview }), isRead: true },
    { ...item(45, { type: 'story_reply', category: 'stories', actor: RUPSA, body: 'This looks like such a good day!', target: story, preview: storyPreview }), isRead: true },
    item(26 * 60, { type: 'follow_accepted', category: 'follows', actor: SUBH, target: { ...request('subh'), state: 'accepted', followBack: 'accepted' } }),
    item(28 * 60, { type: 'story_mention', category: 'stories', actor: MAYA, target: story, preview: storyPreview }),
  ];
}

export function demoActivityArrivals(): NotificationItem[] {
  return [
    item(0, { type: 'follow', category: 'follows', actor: ROHAN, target: { ...request('rohan'), state: 'accepted' } }),
    item(0, { type: 'story_like', category: 'stories', actor: MAYA, target: story, preview: storyPreview }),
    item(0, { type: 'story_reply', category: 'stories', actor: AANYA, body: 'Where was this taken?', target: story, preview: storyPreview }),
    item(0, { type: 'story_mention', category: 'stories', actor: RUPSA, target: story, preview: storyPreview }),
  ];
}
