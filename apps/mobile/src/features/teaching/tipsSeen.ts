import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Each teaching tip shows once: Got it, a tap elsewhere, Back, or just letting
 * it play out all count. The demo keeps its own record, so trying a tip there
 * never uses up the real one, and "Reset tips" in the demo clears it.
 */
export type TipName = 'storyGuide' | 'cardTap';
const TIPS: TipName[] = ['storyGuide', 'cardTap'];
const key = (name: TipName, demo: boolean) => (demo ? `teaching.demo.${name}` : `teaching.${name}.v1`);

export async function tipUnseen(name: TipName, demo: boolean) {
  try { return (await AsyncStorage.getItem(key(name, demo))) !== '1'; } catch { return false; }
}

export function markTipSeen(name: TipName, demo: boolean) {
  void AsyncStorage.setItem(key(name, demo), '1').catch(() => undefined);
}

export function resetDemoTips() {
  return AsyncStorage.multiRemove(TIPS.map((name) => key(name, true))).catch(() => undefined);
}

/**
 * Set by "Start discovering" at the end of sign-up, with whose account it is,
 * so only people who have just joined get the welcome cards and the swipe
 * lesson - never everyone who already has an account.
 */
const NEWCOMER = 'teaching.newcomer.v1';
let newcomer: string | null | undefined;
let newcomerWrite: Promise<unknown> = Promise.resolve();
let teachingActive = false;
const teachingListeners = new Set<() => void>();
export const getNewcomerTeachingActive = () => teachingActive;
export const subscribeNewcomerTeaching = (listener: () => void) => {
  teachingListeners.add(listener);
  return () => {teachingListeners.delete(listener);};
};
export function setNewcomerTeachingActive(active: boolean) {
  if (teachingActive === active) return;
  teachingActive = active;
  teachingListeners.forEach(listener => listener());
}
export function peekNewcomer(userId: string) {
  return newcomer === undefined ? undefined : newcomer === userId;
}
export function markNewcomer(userId: string) {
  // Prepare the tour before Main mounts, without waiting for storage.
  newcomer = userId;
  newcomerWrite = AsyncStorage.setItem(NEWCOMER, userId).catch(() => undefined);
}
/** True once for that account: reading it clears it, so it never comes back after a restart. */
export async function takeNewcomer(userId: string) {
  try {
    if (newcomer === undefined) {
      const saved = await AsyncStorage.getItem(NEWCOMER);
      if (newcomer === undefined) newcomer = saved;
    }
    if (newcomer !== userId) return false;
    newcomer = null;
    await newcomerWrite;
    if (newcomer === null) await AsyncStorage.removeItem(NEWCOMER);
    return true;
  } catch { return false; }
}
