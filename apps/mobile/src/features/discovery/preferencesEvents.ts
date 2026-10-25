/**
 * "My preferences were saved": the deck and Browse reload with the new
 * filters straight away, rather than on their next focus.
 */
const listeners = new Set<() => void>();

export function onPreferencesChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyPreferencesChanged() {
  for (const listener of listeners) listener();
}
