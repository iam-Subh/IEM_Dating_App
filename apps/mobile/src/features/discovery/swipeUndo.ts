export type SwipeUndo<T> = {
  card: T;
  until: number;
  requested: boolean;
  saved: Promise<boolean>;
  complete: (until: number | null, now?: number) => void;
};

/** An early Undo tap waits for the swipe receipt instead of racing its save. */
export function createSwipeUndo<T>(card: T, until: number): SwipeUndo<T> {
  let resolve!: (eligible: boolean) => void;
  let completed = false;
  const saved = new Promise<boolean>(done => { resolve = done; });
  const pending: SwipeUndo<T> = {
    card,
    until,
    requested: false,
    saved,
    complete(deadline, now = Date.now()) {
      if (completed) return;
      completed = true;
      if (deadline !== null) pending.until = deadline;
      resolve(deadline !== null && deadline > now);
    },
  };
  return pending;
}

export function undoSecondsRemaining(until: number, now = Date.now()) {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
