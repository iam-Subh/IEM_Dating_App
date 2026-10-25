import { useSyncExternalStore } from 'react';
import { createActivityDemoStore } from './activityModel';
import { demoActivityArrivals, demoActivityNotifications, demoArrivals, demoNotifications } from './notificationsDemo';

export const activityDemo = createActivityDemoStore(
  () => [...demoNotifications(), ...demoActivityNotifications()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  () => [...demoArrivals().map(({ item }) => item), ...demoActivityArrivals()],
);
export function useActivityDemo() {
  return useSyncExternalStore(activityDemo.subscribe, activityDemo.getSnapshot, activityDemo.getSnapshot);
}
