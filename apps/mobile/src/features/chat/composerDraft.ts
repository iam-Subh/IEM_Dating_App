export function createComposerDraft(initial = '') {
  let text = initial;
  let revision = 0;
  const listeners = new Set<() => void>();
  const getSnapshot = () => text;
  const set = (value: string | ((current: string) => string)) => {
    const next = typeof value === 'function' ? value(text) : value;
    if (next === text) return;
    text = next;
    revision += 1;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot,
    getRevision: () => revision,
    set,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type ComposerDraft = ReturnType<typeof createComposerDraft>;
