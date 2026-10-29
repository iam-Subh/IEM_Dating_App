import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Linking, Share } from 'react-native';

/**
 * When to ask for a rating (docs/FEEDBACK.md). Two different asks:
 *
 * - Google Play's own card, after something good just happened. Google's rules:
 *   no question before it ("Do you like the app?"), no reward, never from a
 *   button, and it may silently not show - so nothing waits on it.
 * - Our own "How's IEM Connect so far?" card, for our numbers. Kept at least
 *   14 days away from the Play card, so it never decides who is sent to the
 *   store (review gating).
 *
 * Neither comes within 14 days of a bad moment: a bug report, a block, a
 * report, an unmatch.
 */
const KEY = 'feedback.engagement.v1';
const DAY = 24 * 60 * 60_000;
const SESSION_GAP = 30 * 60_000;

const RULES = {
  minDays: 5, minSessions: 5,
  /** A good moment counts for a few days: the ask comes on the next calm screen. */
  goodMomentDays: 3,
  playEveryDays: 120,
  inAppFirstDays: 7, inAppEveryDays: 60,
  apartDays: 14, setbackDays: 14,
};

type State = {
  firstOpenAt: number; sessions: number; lastActiveAt: number;
  goodMomentAt?: number; setbackAt?: number;
  playAskedAt?: number; inAppAskedAt?: number;
};

let cache: State | null = null;
async function read(): Promise<State> {
  if (cache) return cache;
  try { cache = JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null'); } catch { cache = null; }
  if (!cache) cache = { firstOpenAt: Date.now(), sessions: 1, lastActiveAt: Date.now() };
  return cache;
}
async function save(change: Partial<State>) {
  cache = { ...(await read()), ...change };
  await AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => undefined);
}

/** A session: the app opened, or came back after half an hour away. */
async function touch() {
  const state = await read();
  const now = Date.now();
  await save({ lastActiveAt: now, sessions: now - state.lastActiveAt > SESSION_GAP ? state.sessions + 1 : state.sessions });
}
let tracking = false;
export function startEngagementTracking() {
  if (tracking) return;
  tracking = true;
  void touch();
  AppState.addEventListener('change', (next) => { if (next === 'active') void touch(); });
}

/** Something went well: a new match. */
export const recordGoodMoment = () => save({ goodMomentAt: Date.now() });
/** Something went badly: no asking for a while. */
export const recordSetback = () => save({ setbackAt: Date.now() });

const since = (at: number | undefined, days: number) => at === undefined || Date.now() - at >= days * DAY;
const within = (at: number | undefined, days: number) => at !== undefined && Date.now() - at < days * DAY;

function settled(state: State) {
  return Date.now() - state.firstOpenAt >= RULES.minDays * DAY && state.sessions >= RULES.minSessions && since(state.setbackAt, RULES.setbackDays);
}

function storeReview(): any | null {
  try { return require('expo-store-review'); } catch { return null; }
}

/**
 * Called when Explore or Matches comes into view: the calm moment after a
 * good one. Google decides whether its card actually appears.
 */
export async function maybeAskForPlayReview() {
  const state = await read();
  if (!settled(state) || !within(state.goodMomentAt, RULES.goodMomentDays)) return false;
  if (!since(state.playAskedAt, RULES.playEveryDays) || !since(state.inAppAskedAt, RULES.apartDays)) return false;
  const review = storeReview();
  if (!review || !(await review.isAvailableAsync().catch(() => false))) return false;
  await save({ playAskedAt: Date.now(), goodMomentAt: undefined });
  await new Promise((resolve) => setTimeout(resolve, 800));
  await review.requestReview().catch(() => undefined);
  return true;
}

/** Our own card: from day 7, then every 60 days, never near the Play card. */
export async function shouldShowInAppRating() {
  const state = await read();
  if (!settled(state) || Date.now() - state.firstOpenAt < RULES.inAppFirstDays * DAY) return false;
  return since(state.inAppAskedAt, RULES.inAppEveryDays) && since(state.playAskedAt, RULES.apartDays) && !within(state.goodMomentAt, RULES.goodMomentDays);
}
export const markInAppRatingShown = () => save({ inAppAskedAt: Date.now() });

/** Settings > Rate us on Google Play: always the store page, never the card. */
export const PLAY_PACKAGE = 'com.iemconnect.app';
export async function openPlayStoreListing() {
  const market = `market://details?id=${PLAY_PACKAGE}&showAllReviews=true`;
  try { await Linking.openURL(market); }
  catch { await Linking.openURL(`https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}&showAllReviews=true`); }
}

/** Settings > Share IEM Connect: the phone's share sheet, with the Play Store link. */
export async function shareApp() {
  const url = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
  try { await Share.share({ message: `Meet people from your college on IEM Connect: ${url}` }); } catch { /* closed or no app to share to */ }
}
