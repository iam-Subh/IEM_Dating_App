import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Teaching what Standouts is, on this phone: the one-time pointer under its
 * icon in Explore, the one-time "Welcome to Standouts" on first opening it,
 * and the gold dot until today's set has been opened.
 */
const KEY = 'standouts.intro.v1';
type State = { pointerShown: boolean; welcomeShown: boolean; openedDay: string | null };

/** Standouts refresh by the Indian day, like the rest of the app's daily limits. */
export const istDay = () => new Date(Date.now() + 5.5 * 60 * 60_000).toISOString().slice(0, 10);

let state: State = { pointerShown: true, welcomeShown: true, openedDay: istDay() };
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

void AsyncStorage.getItem(KEY).then((raw) => {
  const saved = raw ? JSON.parse(raw) as Partial<State> : {};
  state = { pointerShown: !!saved.pointerShown, welcomeShown: !!saved.welcomeShown, openedDay: saved.openedDay ?? null };
  loaded = true;
  emit();
}).catch(() => {
  // Storage failure must not leave the first-visit screen waiting forever.
  state = {pointerShown: false, welcomeShown: false, openedDay: null};
  loaded = true;
  emit();
});

function save(change: Partial<State>) {
  state = { ...state, ...change };
  emit();
  void AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => undefined);
}

export function useStandoutsIntro() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
}

/** Until it has read what is saved, nothing is shown (no pointer or dot flashing up). */
export const introReady = () => loaded;
export const markPointerShown = () => save({ pointerShown: true });
export const markWelcomeShown = () => save({ welcomeShown: true });
export const markStandoutsOpened = () => { if (state.openedDay !== istDay()) save({ openedDay: istDay() }); };
export const hasNewStandouts = (current: State) => loaded && current.openedDay !== istDay();
