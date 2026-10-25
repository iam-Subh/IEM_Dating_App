import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api } from "../../services/api";
import {
  PermissionState,
  locationErrorMessage,
  readPermission,
  refreshIfDue,
  requestPermission,
  sendCurrentLocation,
  openSystemSettings,
  onLocationSessionReset,
  onLocationSettingsChanged,
} from "./locationClient";

export type LocationStatus = {
  mode: "college" | "distance" | null;
  cell: { latitude: number; longitude: number } | null;
  updatedAt: string | null;
  fresh: boolean;
  consented: boolean;
  accuracy: "precise" | "approximate" | null;
  accuracyM: number | null;
  source: "live" | "place";
  activePlaceId: string | null;
  /** True while the phone is in a place marked "hide me here". */
  hiddenHere: boolean;
  canSavePlace: boolean;
  places: { id: string; label: string; hideHere: boolean; lastVisitedAt: string; isCurrent: boolean }[];
  settings: {
    distancePreference: number | null;
    expandRadius: boolean;
    hideDistance: boolean;
    hideFromMaps: boolean;
    invisibleStart: number | null;
    invisibleEnd: number | null;
    collegeScope: "campus" | "college" | "city" | "group";
  };
};

/**
 * What the deck shows instead of cards, if anything (LOCATION_SPEC.md 6.1):
 * - explain:  never asked - our explainer, then the system dialog on Continue;
 * - off:      denied or lapsed ("Only this time") - Turn on fires the dialog;
 * - settings: denied twice, so Android no longer shows the dialog;
 * - refresh:  permission is fine but no usable location came back.
 *
 * Hidden at a place ("hide me while I'm here") is none: that is invisibility
 * by choice, and the deck shows with a banner (DiscoverScreen). It used to
 * read as "refresh", where Try again could never help.
 */
export type GateKind = "none" | "explain" | "off" | "settings" | "refresh";

/** "Not now" lasts until the app next comes to the foreground: asked on every open. */
let dismissedUntilNextOpen = false;
// ...and never outlives the account that chose it.
onLocationSessionReset(() => {
  dismissedUntilNextOpen = false;
});

export function useLocationGate(enabled: boolean, onLocationChanged: () => void) {
  const [status, setStatus] = useState<LocationStatus | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(dismissedUntilNextOpen);
  const changed = useRef(onLocationChanged);
  changed.current = onLocationChanged;

  const loadStatus = useCallback(async () => {
    const response = await api.get("/profile/location");
    const next = response.data.data as LocationStatus;
    setStatus(next);
    return next;
  }, []);

  /** Checks quietly, refreshes when due, never shows a system dialog. */
  const check = useCallback(async () => {
    if (!enabled) return;
    try {
      const [current, perm] = await Promise.all([loadStatus(), readPermission()]);
      setPermission(perm);
      if (current.mode !== "distance" || current.source === "place") return;
      const result = await refreshIfDue({ updatedAt: current.updatedAt, permission: perm });
      if (result !== "skipped") {
        const after = await loadStatus();
        if (result.changed || after.fresh !== current.fresh) changed.current();
      }
      setError("");
    } catch (cause) {
      setError(locationErrorMessage(cause));
    }
  }, [enabled, loadStatus]);

  useEffect(() => {
    void check();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // A new open: ask again, as the other apps do.
        dismissedUntilNextOpen = false;
        setDismissed(false);
        void check();
      }
    });
    // Location settings changed (e.g. hiding at a place turned off): check
    // again now, and reload the deck, which the new location may change.
    const offSettings = onLocationSettingsChanged(() => {
      if (!enabled) return;
      void check().then(() => changed.current());
    });
    return () => {
      listener.remove();
      offSettings();
    };
  }, [check, enabled]);

  const kind: GateKind = (() => {
    if (!enabled || !status || !permission) return "none";
    if (status.mode !== "distance") return "none";
    // A saved place in use needs no phone location at all.
    if (status.source === "place" && status.fresh && status.cell) return "none";
    // Hidden at a place on purpose: invisible, not paused - the deck shows
    // (the server browses from the phone's private position) with a banner.
    if (status.hiddenHere) return "none";
    if (permission.status === "granted") {
      return status.fresh && status.cell ? "none" : "refresh";
    }
    if (dismissed && status.fresh && status.cell) return "none";
    if (permission.status === "undetermined") return "explain";
    return permission.canAskAgain ? "off" : "settings";
  })();

  /** Turn on / Continue: the only place the system dialog is shown. */
  const turnOn = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const perm = await requestPermission();
      setPermission(perm);
      if (perm.status !== "granted") return;
      await sendCurrentLocation(perm.accuracy);
      await loadStatus();
      changed.current();
    } catch (cause) {
      setError(locationErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [loadStatus]);

  const retry = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const perm = await readPermission();
      setPermission(perm);
      if (perm.status !== "granted") return;
      await sendCurrentLocation(perm.accuracy);
      await loadStatus();
      changed.current();
    } catch (cause) {
      setError(locationErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [loadStatus]);

  /**
   * "Show me here": turns off hiding at the place the phone is in, then sends
   * a fix - the server keeps the person hidden until an accepted fix arrives,
   * so the switch alone would leave the deck paused.
   */
  const showHere = useCallback(async (placeId: string | null) => {
    setBusy(true);
    setError("");
    try {
      if (placeId) await api.patch(`/profile/location/places/${placeId}`, { hideHere: false });
      const perm = await readPermission();
      setPermission(perm);
      if (perm.status === "granted") await sendCurrentLocation(perm.accuracy);
      await loadStatus();
      changed.current();
    } catch (cause) {
      setError(locationErrorMessage(cause));
      await loadStatus().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }, [loadStatus]);

  const usePlace = useCallback(async (placeId: string) => {
    setBusy(true);
    setError("");
    try {
      await api.put("/profile/location/source", { placeId });
      await loadStatus();
      changed.current();
    } catch (cause: any) {
      setError(cause?.response?.data?.message ?? "Could not use that place. Try again.");
    } finally {
      setBusy(false);
    }
  }, [loadStatus]);

  /** Moves to college mode, which needs no location, keeping every other preference. */
  const switchToCollege = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const current = (await api.get("/profile/discovery")).data.data;
      await api.put("/profile/discovery", {
        discoveryCategory: current.discoveryCategory,
        showMeCategories: current.showMeCategories,
        minAgePref: current.minAgePref,
        maxAgePref: current.maxAgePref,
        discoveryMode: "college",
        distancePreference: current.distancePreference ?? 25,
      });
      await loadStatus();
      changed.current();
    } catch (cause: any) {
      setError(cause?.response?.data?.message ?? "Could not switch to college mode. Try again.");
    } finally {
      setBusy(false);
    }
  }, [loadStatus]);

  const dismiss = useCallback(() => {
    dismissedUntilNextOpen = true;
    setDismissed(true);
  }, []);

  return {
    kind,
    status,
    permission,
    busy,
    error,
    /** "Not now" is only offered when the stored location still works. */
    canDismiss: !!status?.fresh && !!status?.cell,
    actions: { turnOn, retry, openSettings: openSystemSettings, usePlace, showHere, switchToCollege, dismiss, check },
  };
}
