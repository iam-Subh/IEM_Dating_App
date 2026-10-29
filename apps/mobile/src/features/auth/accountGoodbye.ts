import { useSyncExternalStore } from 'react';

/**
 * Just asked to delete the account on this phone: the goodbye page shows
 * before Welcome, with the day it will be erased. Only in memory - a restart
 * goes straight to Welcome, which is fine.
 */
type Goodbye = { scheduledFor: string | null };
let goodbye: Goodbye | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function showAccountGoodbye(scheduledFor: string | null) {
  goodbye = { scheduledFor };
  emit();
}

export function closeAccountGoodbye() {
  goodbye = null;
  emit();
}

export function useAccountGoodbye() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => goodbye,
  );
}
