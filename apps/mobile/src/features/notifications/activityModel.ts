import type { NotificationItem, Unread } from './notificationModel';

export const ACTIVITY_CATEGORIES = ['follows', 'stories'] as const;
export function isSocialActivity(item: NotificationItem) {
  return item.category === 'follows' || item.category === 'stories';
}
export function activityUnread(unread: Unread): Unread {
  return { total: unread.byCategory.follows + unread.byCategory.stories, byCategory: {
    likes: 0, matches: 0, messages: 0, account: 0,
    follows: unread.byCategory.follows, stories: unread.byCategory.stories,
  } };
}
export function countActivity(items: NotificationItem[]): Unread {
  const byCategory: Unread['byCategory'] = { likes: 0, matches: 0, messages: 0, account: 0, follows: 0, stories: 0 };
  for (const item of items) if (!item.isRead && isSocialActivity(item)) byCategory[item.category] += 1;
  return { total: byCategory.follows + byCategory.stories, byCategory };
}

export type ActivityDemoSnapshot = { enabled: boolean; items: NotificationItem[]; latestId: string | null };
type Update = NotificationItem[] | ((items: NotificationItem[]) => NotificationItem[]);

/** A local preview. Timed arrivals continue when the user returns to Explore. */
export function createActivityDemoStore(seed: () => NotificationItem[], arrivals: () => NotificationItem[],
  schedule: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout) {
  let snapshot: ActivityDemoSnapshot = { enabled: false, items: [], latestId: null };
  const listeners = new Set<() => void>();
  let timers: ReturnType<typeof setTimeout>[] = [];
  let examples: NotificationItem[] = [];
  let next = 0;
  let sequence = 0;
  const publish = (value: ActivityDemoSnapshot) => { snapshot = value; for (const listener of listeners) listener(); };
  const clearTimers = () => { timers.forEach(cancel); timers = []; };
  const arrive = () => {
    if (!snapshot.enabled || !examples.length) return;
    const example = examples[next % examples.length];
    next += 1; sequence += 1;
    const item = { ...example, id: `demo-activity-live-${sequence}`, isRead: false, createdAt: new Date().toISOString() };
    publish({ ...snapshot, items: [item, ...snapshot.items], latestId: item.id });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    enable: () => {
      clearTimers(); next = 0; sequence = 0;
      examples = arrivals();
      publish({ enabled: true, items: seed(), latestId: null });
      timers = examples.map((_, index) => schedule(arrive, 4000 * (index + 1)));
    },
    disable: () => { clearTimers(); publish({ enabled: false, items: [], latestId: null }); },
    arrive,
    update: (update: Update) => {
      if (!snapshot.enabled) return;
      publish({ ...snapshot, items: typeof update === 'function' ? update(snapshot.items) : update });
    },
  };
}
