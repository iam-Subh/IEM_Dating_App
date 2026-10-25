import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Keeps verify reminders from being spammy (features/auth/GOOGLE_SIGNUP_PLAN.md 4):
 *
 * - **Nudges** - reminders we choose to show - share one pop-up a day.
 * - **Dismissed** in-context reminders stay away for a while (per key).
 * - **Lock moments** (the person tried something limited) never ask here:
 *   they always show.
 *
 * On the phone only: losing it just means one extra reminder.
 */

const POPUP_KEY = 'verifyNudge:lastPopupDay';
const DISMISS_PREFIX = 'verifyNudge:dismissed:';

function istDay(now = Date.now()) {
  return new Date(now + 5.5 * 60 * 60_000).toISOString().slice(0, 10);
}

/** True when today's one pop-up reminder has not been used yet. */
export async function popupAvailableToday() {
  try { return (await AsyncStorage.getItem(POPUP_KEY)) !== istDay(); } catch { return false; }
}

/** Uses today's pop-up. */
export async function spendPopupToday() {
  try { await AsyncStorage.setItem(POPUP_KEY, istDay()); } catch { /* best effort */ }
}

/** A reminder the person closed stays closed for `days` (Infinity: for good). */
export async function dismissNudge(key: string, days = Infinity) {
  const until = days === Infinity ? 'forever' : String(Date.now() + days * 24 * 60 * 60_000);
  try { await AsyncStorage.setItem(DISMISS_PREFIX + key, until); } catch { /* best effort */ }
}

export async function isNudgeDismissed(key: string) {
  try {
    const value = await AsyncStorage.getItem(DISMISS_PREFIX + key);
    if (!value) return false;
    return value === 'forever' || Number(value) > Date.now();
  } catch {
    return false;
  }
}
