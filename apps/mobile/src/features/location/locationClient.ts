import * as Location from "expo-location";
import { Linking, Platform } from "react-native";
import { LOCATION_REFRESH_HOURS, snapToGrid } from "@iem-dating/shared/location";
import { api } from "../../services/api";
import { store } from "../../store";

/**
 * Everything the app does with the phone's location (LOCATION_SPEC.md 6).
 *
 * - Only ever foreground, only ever while the app is open.
 * - A precise fix is snapped to the grid *on the phone* before it is sent,
 *   so a precise location never reaches the server (6.2). An approximate one
 *   is sent as it is; the server snaps it too.
 * - The system permission dialog is only shown when the person taps a
 *   button on our own screen: since Android 11, two denials stop the dialog
 *   appearing at all, so it must never be spent on someone tapping past it.
 */

export type PermissionState = {
  /** granted: we can read a location. */
  status: "granted" | "undetermined" | "denied";
  /** false once Android has stopped showing the dialog (denied twice). */
  canAskAgain: boolean;
  /** What the person chose in the dialog, when granted. */
  accuracy: "precise" | "approximate" | null;
};

export type LocationWriteResult = {
  cell: { latitude: number; longitude: number } | null;
  changed: boolean;
  source: "live" | "place";
  matchedPlace: { id: string; label: string } | null;
  hiddenHere: boolean;
};

function toState(response: Location.LocationPermissionResponse): PermissionState {
  const granted = response.status === Location.PermissionStatus.GRANTED;
  const reduced =
    response.android?.accuracy === "coarse" || (response.ios as any)?.accuracy === "reduced";
  return {
    status: granted ? "granted" : response.status === Location.PermissionStatus.UNDETERMINED ? "undetermined" : "denied",
    canAskAgain: response.canAskAgain,
    accuracy: granted ? (reduced ? "approximate" : "precise") : null,
  };
}

/** Reads the permission without asking. Safe to call on every open. */
export async function readPermission(): Promise<PermissionState> {
  return toState(await Location.getForegroundPermissionsAsync());
}

/**
 * Shows the system dialog. Call only from a tap on our own explainer or
 * "Location is off" screen, never on its own.
 */
export async function requestPermission(): Promise<PermissionState> {
  return toState(await Location.requestForegroundPermissionsAsync());
}

export function openSystemSettings() {
  return Linking.openSettings();
}

/**
 * Whether the phone's location (the quick-settings toggle, not our
 * permission) is on. When it is off, Android shows its own "Turn on device
 * location" dialog, which switches it on in place. Returns whether it is on
 * afterwards; false when the person chose "No thanks".
 */
export async function ensureLocationServices(): Promise<boolean> {
  if (await Location.hasServicesEnabledAsync().catch(() => false)) return true;
  if (Platform.OS !== "android") return false;
  try {
    await Location.enableNetworkProviderAsync();
  } catch {
    return false;
  }
  return Location.hasServicesEnabledAsync().catch(() => false);
}

/** A fresh fix waits no longer than this; indoors one can take minutes. */
const FRESH_FIX_TIMEOUT_MS = 8000;

function toLatLng(position: Location.LocationObject) {
  return { latitude: position.coords.latitude, longitude: position.coords.longitude };
}

/** The phone's last known position, if it is this recent. Answers at once. */
export async function readLastKnownPosition(maxAgeMs = 10 * 60_000) {
  const position = await Location.getLastKnownPositionAsync({ maxAge: maxAgeMs }).catch(() => null);
  return position ? toLatLng(position) : null;
}

/** One fresh fix, or null if none comes within FRESH_FIX_TIMEOUT_MS. */
export async function readFreshFix(): Promise<Location.LocationObject | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FRESH_FIX_TIMEOUT_MS);
  });
  try {
    return await Promise.race([readPosition().catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the phone is, for drawing the person's own dot on the map. Read only,
 * never sent: the server keeps the snapped cell (6.2). A recent last-known
 * fix answers at once; otherwise one fresh fix. Null when there is none.
 */
export async function readOwnPosition(): Promise<{ latitude: number; longitude: number } | null> {
  const recent = await readLastKnownPosition(2 * 60_000);
  if (recent) return recent;
  const fresh = await readFreshFix();
  return fresh ? toLatLng(fresh) : null;
}

/** Sends a fix the usual way: snapped on the phone when precise (6.2). */
export function sendFix(position: Location.LocationObject, accuracy: PermissionState["accuracy"]) {
  return sendPosition(position, accuracy);
}

async function readPosition() {
  return Location.getCurrentPositionAsync({
    // Balanced is network-first and ~100 m; the grid is ~2 km, so nothing
    // finer is ever useful, and nothing finer is kept.
    accuracy: Location.Accuracy.Balanced,
  });
}

/** How old a last-known position may be when a fresh fix does not come. */
const LAST_KNOWN_FALLBACK_MS = 5 * 60_000;

/**
 * A position for a location write, never waiting more than a few seconds: a
 * fresh fix (readFreshFix), else a recent last-known one. A bare
 * getCurrentPositionAsync has no time limit - indoors it could wait for
 * minutes or forever, and the button that asked stayed disabled all that time.
 */
async function readPositionForWrite(): Promise<Location.LocationObject> {
  const fresh = await readFreshFix();
  if (fresh) return fresh;
  const recent = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_FALLBACK_MS }).catch(() => null);
  if (recent) return recent;
  throw Object.assign(new Error("No location available."), { code: "E_LOCATION_TIMEOUT" });
}

async function sendPosition(
  position: Location.LocationObject,
  accuracy: PermissionState["accuracy"],
): Promise<LocationWriteResult> {
  const raw = { latitude: position.coords.latitude, longitude: position.coords.longitude };
  const precise = accuracy === "precise";
  // A precise fix is rounded here, so it never leaves the phone (6.2).
  const sent = precise ? snapToGrid(raw) : raw;
  const response = await api.put("/profile/location", {
    ...sent,
    accuracy: precise ? "precise" : "approximate",
    ...(typeof position.coords.accuracy === "number" ? { accuracyM: Math.round(position.coords.accuracy) } : {}),
  });
  const result = response.data.data as LocationWriteResult;
  rememberCell(result.cell);
  return result;
}

/**
 * One fix, then sent. Throws the API error unchanged so callers can explain
 * LOCATION_IMPLAUSIBLE and LOCATION_CHANGE_LIMIT.
 */
export async function sendCurrentLocation(accuracy: PermissionState["accuracy"]): Promise<LocationWriteResult> {
  return sendPosition(await readPositionForWrite(), accuracy);
}

/**
 * Stop appearing from a saved place and follow the phone again. The phone's
 * fix travels with the switch, so the saved place and the new position
 * change together; without permission the switch still happens and the
 * server simply shows no position until one arrives - never the old place.
 */
export async function followPhoneAgain(permission: PermissionState) {
  let fix: Record<string, unknown> | undefined;
  if (permission.status === "granted") {
    const position = await readPositionForWrite();
    const raw = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    const precise = permission.accuracy === "precise";
    fix = {
      ...(precise ? snapToGrid(raw) : raw),
      accuracy: precise ? "precise" : "approximate",
      ...(typeof position.coords.accuracy === "number" ? { accuracyM: Math.round(position.coords.accuracy) } : {}),
    };
  }
  const response = await api.put("/profile/location/source", { placeId: null, ...(fix ? { fix } : {}) });
  const result = response.data.data?.fix as LocationWriteResult | null;
  rememberCell(result?.cell ?? null);
  return response.data.data;
}

/**
 * The last cell the server confirmed, and for which account, so an open in
 * the same place sends nothing. Keyed by account: after switching accounts
 * the new one must never inherit the old one's "already refreshed".
 */
let lastConfirmed: { account: string; cell: { latitude: number; longitude: number }; at: number } | null = null;

function currentAccount(): string | null {
  const auth = store.getState().auth;
  return auth.user?.id ?? auth.token ?? null;
}

function rememberCell(cell: { latitude: number; longitude: number } | null) {
  const account = currentAccount();
  lastConfirmed = cell && account ? { account, cell, at: Date.now() } : null;
}

/** Forget everything this module remembers. Called on logout and when the location is deleted. */
export function resetLocationSession() {
  lastConfirmed = null;
  for (const listener of resetListeners) listener();
}

/**
 * "Where I appear from changed" - from Location settings (hiding at a place,
 * unhiding, appearing from a saved place, following the phone). The deck's
 * location gate listens, so Explore reflects it at once instead of on the
 * next app open.
 */
const changeListeners = new Set<() => void>();
export function onLocationSettingsChanged(listener: () => void) {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}
export function notifyLocationSettingsChanged() {
  for (const listener of changeListeners) listener();
}

const resetListeners = new Set<() => void>();
/** For state kept elsewhere (the gate's "Not now") that must reset with the session. */
export function onLocationSessionReset(listener: () => void) {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

/**
 * The refresh on open (6.7): only with permission already granted, only when
 * the stored location is older than LOCATION_REFRESH_HOURS, and not twice in
 * one session. The server keeps a same-cell fix free and merely fresh, so the
 * write itself is cheap; skipping it just saves the radio.
 */
export async function refreshIfDue(options: {
  updatedAt: string | null;
  permission: PermissionState;
  onLocate?: () => void;
}): Promise<LocationWriteResult | "skipped"> {
  if (options.permission.status !== "granted") return "skipped";
  const age = options.updatedAt ? Date.now() - Date.parse(options.updatedAt) : Infinity;
  if (age < LOCATION_REFRESH_HOURS * 3_600_000) return "skipped";
  if (
    lastConfirmed &&
    lastConfirmed.account === currentAccount() &&
    Date.now() - lastConfirmed.at < LOCATION_REFRESH_HOURS * 3_600_000
  ) {
    return "skipped";
  }
  options.onLocate?.();
  return sendPosition(await readPositionForWrite(), options.permission.accuracy);
}

/** The server's words for the refusals a location write can meet. */
export function locationErrorMessage(error: any): string {
  const code = error?.response?.data?.code;
  if (code === "LOCATION_IMPLAUSIBLE") {
    return "That location is too far from your last one. If you have just travelled, try again a little later.";
  }
  if (error?.code === "E_LOCATION_TIMEOUT") {
    return "Couldn't get your location right now. Try again in a moment, ideally near a window.";
  }
  if (code === "LOCATION_CHANGE_LIMIT") {
    return "Your location has changed a lot today, so it stays where it is until tomorrow.";
  }
  if (code === "E_LOCATION_SERVICES_DISABLED" || String(error?.message ?? "").includes("Location services")) {
    return "Your phone's location is turned off. Turn it on in the quick settings, then try again.";
  }
  return error?.response?.data?.message ?? "Could not read your location. Try again.";
}
