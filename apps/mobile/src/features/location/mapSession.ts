import { File } from "expo-file-system";
import { store } from "../../store";
import { onLocationSessionReset } from "./locationClient";
import type { LatLng } from "./TileMap";

/**
 * What the map screen remembers between visits, so coming back to it shows
 * the map at once instead of starting over: the last answer from the server,
 * where the camera was, the phone's own position, and a picture of the map as
 * it was left, shown while the native map warms up behind it.
 *
 * Memory only, for the life of the app. Kept per account - a different
 * account starts clean - and cleared with the location session on logout or
 * when the location is deleted (locationClient).
 */
export type MapCamera = { center: LatLng; zoom: number; heading: number };

export type MapSnapshot = {
  uri: string;
  /** The map's size when taken; a different size would not line up. */
  width: number;
  height: number;
  /** Where the camera was; a map opening anywhere else would not line up. */
  camera: MapCamera;
};

type Session = {
  account: string;
  data: unknown;
  camera: MapCamera | null;
  fix: { at: LatLng; time: number } | null;
  snapshot: MapSnapshot | null;
  /** Mappls refused the map this session; open on the tile map straight away. */
  mapplsFailed: boolean;
};

/** The phone's position is reused this long; after that the dot waits for a new fix. */
const FIX_REUSE_MS = 10 * 60_000;

let session: Session | null = null;

function currentAccount(): string {
  const auth = store.getState().auth;
  return auth.user?.id ?? "signed-out";
}

function deleteSnapshotFile(snapshot: MapSnapshot | null) {
  if (!snapshot) return;
  try {
    const file = new File(snapshot.uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone, or in a place we may not touch: nothing to clean.
  }
}

/** This account's session, started fresh when there is none or it was someone else's. */
export function mapSession(): Session {
  const account = currentAccount();
  if (!session || session.account !== account) {
    deleteSnapshotFile(session?.snapshot ?? null);
    session = { account, data: null, camera: null, fix: null, snapshot: null, mapplsFailed: false };
  }
  return session;
}

/** The remembered position, if still recent. */
export function recentFix(): LatLng | null {
  const fix = mapSession().fix;
  return fix && Date.now() - fix.time < FIX_REUSE_MS ? fix.at : null;
}

export function rememberFix(at: LatLng | null) {
  mapSession().fix = at ? { at, time: Date.now() } : null;
}

export function rememberSnapshot(snapshot: MapSnapshot) {
  const current = mapSession();
  if (current.snapshot?.uri !== snapshot.uri) deleteSnapshotFile(current.snapshot);
  current.snapshot = snapshot;
}

/** The snapshot, only when it shows exactly the camera the map is about to open at. */
export function snapshotFor(camera: MapCamera | null): MapSnapshot | null {
  const snapshot = mapSession().snapshot;
  if (!snapshot || !camera) return null;
  const same =
    Math.abs(snapshot.camera.zoom - camera.zoom) < 0.01 &&
    Math.abs(snapshot.camera.heading - camera.heading) < 0.5 &&
    Math.abs(snapshot.camera.center.latitude - camera.center.latitude) < 1e-6 &&
    Math.abs(snapshot.camera.center.longitude - camera.center.longitude) < 1e-6;
  return same ? snapshot : null;
}

onLocationSessionReset(() => {
  deleteSnapshotFile(session?.snapshot ?? null);
  session = null;
});
