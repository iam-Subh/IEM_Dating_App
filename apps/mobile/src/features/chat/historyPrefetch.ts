/** Keeps one older page ready without fetching the entire conversation. */
export function createHistoryPrefetch<T>(load: (cursor: string) => Promise<T>) {
  let pending: { cursor: string; promise: Promise<T> } | undefined;
  function prime(cursor: string): Promise<T> {
    if (pending?.cursor === cursor) return pending.promise;
    const entry = { cursor, promise: Promise.resolve().then(() => load(cursor)) };
    pending = entry;
    void entry.promise.catch(() => { if (pending === entry) pending = undefined; });
    return entry.promise;
  }
  return {
    prime,
    async take(cursor: string): Promise<T> {
      const promise = prime(cursor);
      try { return await promise; }
      finally { if (pending?.promise === promise) pending = undefined; }
    },
  };
}
