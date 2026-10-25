import type { TrayGroup } from './storyTypes';

export type StoryPosition = { group: number; story: number };

/** Where opening a person starts: their first unseen Story, else their first. */
export function openingPosition(groups: TrayGroup[], group: number): StoryPosition {
  const target = groups[group];
  if (!target) return { group, story: 0 };
  const story = target.hasUnseen ? Math.min(target.firstUnseenIndex, target.stories.length - 1) : 0;
  return { group, story: Math.max(0, story) };
}

/**
 * The Story after this one: the next of the same person, or the next person.
 * Null after the last Story of the last person, which closes the viewer.
 */
export function nextPosition(groups: TrayGroup[], position: StoryPosition): StoryPosition | null {
  const current = groups[position.group];
  if (!current) return null;
  if (position.story + 1 < current.stories.length) return { group: position.group, story: position.story + 1 };
  if (position.group + 1 < groups.length) return openingPosition(groups, position.group + 1);
  return null;
}

/**
 * The Story before this one: the previous of the same person, or the last
 * Story of the previous person. On the very first Story it stays, which
 * replays that Story, as Instagram does.
 */
export function previousPosition(groups: TrayGroup[], position: StoryPosition): StoryPosition {
  if (position.story > 0) return { group: position.group, story: position.story - 1 };
  if (position.group > 0) {
    const previous = groups[position.group - 1];
    return { group: position.group - 1, story: Math.max(0, previous.stories.length - 1) };
  }
  return position;
}

/** "now", "12m", "5h", "1d" - how Instagram labels when a Story was posted. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function withGroupState(group: TrayGroup): TrayGroup {
  const firstUnseen = group.stories.findIndex((story) => !story.seen);
  return {
    ...group,
    hasUnseen: firstUnseen >= 0,
    closeFriendsUnseen: group.stories.some((story) => !story.seen && story.audience === 'close_friends'),
    firstUnseenIndex: Math.max(0, firstUnseen),
  };
}

/** Marks a Story seen, keeping the tray order until the tray is next loaded. */
export function applySeen(groups: TrayGroup[], storyId: string): TrayGroup[] {
  return groups.map((group) => (group.stories.some((story) => story.id === storyId && !story.seen)
    ? withGroupState({ ...group, stories: group.stories.map((story) => (story.id === storyId ? { ...story, seen: true } : story)) })
    : group));
}

export function applyLiked(groups: TrayGroup[], storyId: string, liked: boolean): TrayGroup[] {
  return groups.map((group) => (group.stories.some((story) => story.id === storyId)
    ? { ...group, stories: group.stories.map((story) => (story.id === storyId ? { ...story, liked } : story)) }
    : group));
}

/**
 * Tray order: your own Stories, then people with an unseen Close Friends
 * Story, then others with unseen Stories, then the rest, newest first.
 */
export function orderTray(groups: TrayGroup[]): TrayGroup[] {
  return [...groups].sort((first, second) => {
    if (first.isOwn !== second.isOwn) return first.isOwn ? -1 : 1;
    if (Boolean(first.closeFriendsUnseen) !== Boolean(second.closeFriendsUnseen)) return first.closeFriendsUnseen ? -1 : 1;
    if (first.hasUnseen !== second.hasUnseen) return first.hasUnseen ? -1 : 1;
    return second.latestPublishedAt.localeCompare(first.latestPublishedAt);
  });
}
