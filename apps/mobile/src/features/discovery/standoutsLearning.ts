import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../services/api';

/**
 * "Learning your type": a new person's Standouts wait until they have swiped
 * STANDOUTS_LEARN_SWIPES times (the server's count, likes and passes alike).
 * Explore's pill, the ring on the Standouts icon and the Standouts screen read
 * this one store. Once finished on this phone it is never asked for again.
 */
const KEY = 'standouts.learned.v1';
export type Learning = { needed: number; done: number };
type State = { progress: Learning | null; learned: boolean; justLearned: boolean };

let state: State = { progress: null, learned: true, justLearned: false };
let ready = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const set = (change: Partial<State>) => { state = { ...state, ...change }; emit(); };

void AsyncStorage.getItem(KEY).then((saved) => {
  ready = true;
  set({ learned: saved === '1' });
  if (saved !== '1') void refreshLearning();
}).catch(() => { ready = true; });

function finish(progress: Learning, now: boolean) {
  // `justLearned`: it finished while they were swiping, so Explore says "Standouts are here" once.
  set({ progress, learned: true, justLearned: now });
  void AsyncStorage.setItem(KEY, '1').catch(() => undefined);
}

/** The server's count. Quiet on failure: the pill just doesn't show. */
export async function refreshLearning() {
  if (!ready || state.learned) return;
  try {
    const progress = (await api.get('/discover/standouts/learning')).data.data as Learning;
    if (progress.done >= progress.needed) finish(progress, false);
    else set({ progress });
  } catch { /* offline: try again next time */ }
}

/** One more Like or pass in Explore: counted here at once, the server agrees on the next refresh. */
export function countSwipe() {
  const progress = state.progress;
  if (state.learned || !progress) return;
  const next = { ...progress, done: Math.min(progress.needed, progress.done + 1) };
  if (next.done >= next.needed) finish(next, true);
  else set({ progress: next });
}

/** A swipe taken back with Rewind no longer counts. */
export function uncountSwipe() {
  const progress = state.progress;
  if (state.learned || !progress) return;
  set({ progress: { ...progress, done: Math.max(0, progress.done - 1) } });
}

/** Explore has said "Standouts are here". */
export const markLearnedShown = () => set({ justLearned: false });

/** Null until known; `learning` is true only while a set is still being learned. */
export function useStandoutsLearning() {
  const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
  const progress = current.progress;
  return { progress, learning: !current.learned && !!progress && progress.done < progress.needed, justLearned: current.justLearned };
}
