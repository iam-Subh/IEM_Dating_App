import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Phones that hold back notifications (NOTIFICATIONS_PLAN.md 11): many
 * phones sold in India stop apps in the background to save battery. When an
 * urgent push arrived well after it was sent, on one of those phones, the
 * app offers a short fix-it page - once a month at most, never on day one.
 */

const KEY = 'push.lateDelivery';
const LATE_MS = 3 * 60_000;
const MONTH_MS = 30 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type Maker = 'xiaomi' | 'vivo' | 'oppo' | 'realme' | 'oneplus' | 'samsung' | 'other';

/** The reported brand can differ from the manufacturer (for example, Realme and Oppo). */
export function phoneBrand(): string | null {
  if (Platform.OS !== 'android') return null;
  const constants = Platform.constants as { Manufacturer?: string; Brand?: string };
  const valid = (value?: string) => value?.trim() && value.trim().toLowerCase() !== 'unknown' ? value.trim() : null;
  const brand = valid(constants.Brand) || valid(constants.Manufacturer);
  if (!brand) return null;
  const labels: Record<string, string> = {
    xiaomi: 'Xiaomi', redmi: 'Redmi', poco: 'Poco', vivo: 'Vivo', iqoo: 'iQOO', oppo: 'Oppo',
    realme: 'Realme', oneplus: 'OnePlus', samsung: 'Samsung', google: 'Google', motorola: 'Motorola',
    honor: 'Honor', huawei: 'Huawei', nothing: 'Nothing', asus: 'Asus', nokia: 'Nokia', sony: 'Sony',
  };
  return labels[brand.toLowerCase()] || brand;
}

function makerFrom(name: string): Maker {
  if (/xiaomi|redmi|poco/.test(name)) return 'xiaomi';
  if (/vivo|iqoo/.test(name)) return 'vivo';
  if (/oppo/.test(name)) return 'oppo';
  if (/realme/.test(name)) return 'realme';
  if (/oneplus/.test(name)) return 'oneplus';
  if (/samsung/.test(name)) return 'samsung';
  return 'other';
}

export function phoneMaker(): Maker {
  if (Platform.OS !== 'android') return 'other';
  const brandMaker = makerFrom((phoneBrand() || '').toLowerCase());
  if (brandMaker !== 'other') return brandMaker;
  const constants = Platform.constants as { Manufacturer?: string };
  return makerFrom((constants.Manufacturer || '').toLowerCase());
}

type State = { firstSeenAt: number; lateAt?: number; offeredAt?: number };

async function read(): Promise<State> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Start fresh.
  }
  const state = { firstSeenAt: Date.now() };
  await write(state);
  return state;
}

async function write(state: State) {
  await AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => undefined);
}

/**
 * A notification was shown (or tapped): compare when Android showed it with
 * when the server sent it. Only urgent ones count - the others may wait for
 * Doze on purpose.
 */
export function noteDelivery(notification: Notifications.Notification) {
  if (phoneMaker() === 'other') return;
  const data = notification.request.content.data ?? {};
  if (data.priority !== 'high' || typeof data.sentAt !== 'string') return;
  const sent = Date.parse(data.sentAt);
  const shown = notification.date || Date.now();
  if (!Number.isFinite(sent) || shown - sent < LATE_MS) return;
  void read().then((state) => write({ ...state, lateAt: Date.now() }));
}

/** Whether to offer the fix-it page now. */
export async function shouldOfferFix() {
  if (phoneMaker() === 'other') return false;
  const state = await read();
  const now = Date.now();
  if (!state.lateAt || now - state.firstSeenAt < DAY_MS) return false;
  return !state.offeredAt || now - state.offeredAt > MONTH_MS;
}

export async function markFixOffered() {
  const state = await read();
  await write({ ...state, offeredAt: Date.now(), lateAt: undefined });
}

/** Whether a late delivery has been seen at all (shown in App settings, without the monthly limit). */
export async function hasLateDeliveries() {
  if (phoneMaker() === 'other') return false;
  return !!(await read()).lateAt;
}
