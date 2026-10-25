import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import { registerCurrentDeviceForPush } from '../../../services/notifications';

/**
 * Asking for notifications (NOTIFICATIONS_PLAN.md 12). Android shows its own
 * question only twice, ever, so the app explains first on its own screen
 * (PermissionPrimer) and only "Turn on" asks Android:
 *
 * - at the end of onboarding, once the profile is ready;
 * - again at a good moment - after sending a message ("Want to know when
 *   Riya replies?");
 * - 3 times in all, never twice in a week.
 */

export type PrimerMoment = { kind: 'onboarding' } | { kind: 'reply'; name: string };

const KEY = 'push.permissionAsks';
const MAX_ASKS = 3;
const WEEK_MS = 7 * 24 * 60 * 60_000;

type AskState = { count: number; lastAt: number };

async function readAsks(): Promise<AskState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Treated as never asked.
  }
  return { count: 0, lastAt: 0 };
}

async function noteAsked() {
  const state = await readAsks();
  await AsyncStorage.setItem(KEY, JSON.stringify({ count: state.count + 1, lastAt: Date.now() })).catch(() => undefined);
}

const listeners = new Set<(moment: PrimerMoment | null) => void>();
let showing: PrimerMoment | null = null;

function publish(moment: PrimerMoment | null) {
  showing = moment;
  for (const listener of listeners) listener(moment);
}

export function onPrimer(listener: (moment: PrimerMoment | null) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Shows the primer if this is a good moment and allowed; registers the phone if already allowed. */
export async function askAtMoment(moment: PrimerMoment) {
  if (Platform.OS === 'web' || showing) return;
  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (!permission) return;
  if (permission.status === 'granted') {
    void registerCurrentDeviceForPush().catch(() => undefined);
    return;
  }
  // Android answered "Don't allow" for good: only App settings' banner can help now.
  if (!permission.canAskAgain) return;
  const asks = await readAsks();
  if (asks.count >= MAX_ASKS) return;
  if (moment.kind === 'onboarding' && asks.count > 0) return;
  if (Date.now() - asks.lastAt < WEEK_MS) return;
  publish(moment);
}

/** "Turn on": now Android asks. */
export async function acceptPrimer() {
  publish(null);
  await noteAsked();
  const current = await Notifications.getPermissionsAsync();
  const result = current.canAskAgain ? await Notifications.requestPermissionsAsync() : current;
  if (result.status === 'granted') await registerCurrentDeviceForPush().catch(() => undefined);
  else if (!result.canAskAgain) void Linking.openSettings();
}

/** "Not now". */
export async function declinePrimer() {
  publish(null);
  await noteAsked();
}

