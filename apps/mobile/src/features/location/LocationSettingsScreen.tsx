import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { MAX_MAP_PLACES, MAX_SAVED_PLACES } from "@iem-dating/shared/location";
import { api } from "../../services/api";
import { colors } from "../../core/theme/colors";
import {
  ensureLocationServices,
  followPhoneAgain,
  locationErrorMessage,
  notifyLocationSettingsChanged,
  readPermission,
  requestPermission,
  resetLocationSession,
  sendCurrentLocation,
  openSystemSettings,
} from "./locationClient";
import type { LocationStatus } from "./useLocationGate";
import { shareLocationNow } from "./shareLocationNow";
import { useDispatch } from "react-redux";
import { updateUser } from "../../store/authSlice";
import { notifyPreferencesChanged } from "../discovery/preferencesEvents";

type MapPlace = { id: string; name: string; subtitle: string | null };
type SearchResult = { externalId: string; name: string; subtitle: string };

const LABELS = ["Home", "Hostel", "PG"];
const SETTINGS_LAYOUT = LinearTransition.duration(240).easing(Easing.out(Easing.cubic));

/** An error whose message is already written for the person reading it. */
class UserFacingError extends Error {}

function ago(iso: string | null) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function clock(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Location settings (LOCATION_SPEC.md sections 6, 7 and 9.4): where you
 * appear from, the places you saved, and who can see what.
 */
export function LocationSettingsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [status, setStatus] = useState<LocationStatus | null>(null);
  const [mapPlaces, setMapPlaces] = useState<MapPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const dispatch = useDispatch();
  const [switching, setSwitching] = useState(false);
  const [message, setMessage] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [addingSavedPlace, setAddingSavedPlace] = useState(false);
  const [removeHovered, setRemoveHovered] = useState(false);
  const removeScale = useSharedValue(1);
  const removeAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: removeScale.value }] }));
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [pinningPlaceId, setPinningPlaceId] = useState<string | null>(null);
  const pinningPlace = useRef(false);
  const [hours, setHours] = useState<{ start: number; end: number } | null>(null);
  /** Times changed with the steppers but not saved yet; a reload must not undo them. */
  const hoursDirty = useRef(false);
  const [hoursChanged, setHoursChanged] = useState(false);
  /**
   * Switches show the value just chosen while it saves. Bound only to the
   * server's value, a switch flipped, jumped back while the request and the
   * reload ran, then flipped again when they finished.
   */
  const [pendingSwitch, setPendingSwitch] = useState<Record<string, boolean>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchRequest = useRef(0);
  const settingsScroll = useRef<ScrollView>(null);
  const savedPlaceInput = useRef<TextInput>(null);
  const scrollOffset = useRef(0);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layoutAnimating, setLayoutAnimating] = useState(false);
  const keyboardTop = useRef<number | null>(null);
  const savedPlaceFocused = useRef(false);

  const beginHeightTransition = () => {
    setLayoutAnimating(true);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => {
      setLayoutAnimating(false);
      transitionTimer.current = null;
    }, 280);
  };

  useEffect(() => () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
  }, []);

  const revealSavedPlaceInput = useCallback((top: number) => {
    requestAnimationFrame(() => {
      savedPlaceInput.current?.measureInWindow((_x, y, _width, height) => {
        const overlap = y + height + 20 - top;
        if (overlap > 0) {
          settingsScroll.current?.scrollTo({ y: scrollOffset.current + overlap, animated: true });
        }
      });
    });
  }, []);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      if (savedPlaceFocused.current) revealSavedPlaceInput(event.endCoordinates.screenY);
    });
    const hidden = Keyboard.addListener("keyboardDidHide", () => { keyboardTop.current = null; });
    return () => { shown.remove(); hidden.remove(); };
  }, [revealSavedPlaceInput]);

  const closeSearch = useCallback(() => {
    searchRequest.current += 1;
    clearTimeout(searchTimer.current);
    Keyboard.dismiss();
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    setSearching(false);
    setSearchMessage("");
  }, []);

  const load = useCallback(async () => {
    try {
      const [location, spots] = await Promise.all([
        api.get("/profile/location"),
        api.get("/discover/map/places/mine").catch(() => null),
      ]);
      const next = location.data.data as LocationStatus;
      setStatus(next);
      if (!hoursDirty.current) {
        setHours(
          next.settings.invisibleStart !== null && next.settings.invisibleEnd !== null
            ? { start: next.settings.invisibleStart, end: next.settings.invisibleEnd }
            : null,
        );
      }
      if (spots) setMapPlaces(spots.data.data.places ?? []);
    } catch {
      setMessage("Could not load your location settings. Pull back and try again.");
    }
  }, []);

  /**
   * "Use People nearby" / "Use college mode": share the location first when
   * nearby needs one, then save only the area - the rest of My preferences
   * stays as it is.
   */
  const switchArea = async (area: "nearby" | "college") => {
    if (switching) return;
    setSwitching(true);
    setMessage("");
    try {
      if (area === "nearby" && !status?.fresh && !(await shareLocationNow())) return;
      const send = () => api.put("/profile/preferences/area", { area });
      let response;
      try {
        response = await send();
      } catch (error: any) {
        // The server has no usable location yet: share one and try once more.
        if (area !== "nearby" || error?.response?.data?.code !== "LOCATION_REQUIRED" || !(await shareLocationNow())) throw error;
        response = await send();
      }
      const saved = response.data.data;
      dispatch(updateUser({ discoveryMode: saved.area === "nearby" ? "distance" : "college", ...(saved.area === "nearby" ? {} : { collegeScope: saved.area }) }));
      notifyPreferencesChanged();
      notifyLocationSettingsChanged();
      setMessage(area === "nearby" ? "You're meeting people nearby now." : "You're back in college mode.");
      await load();
    } catch (error: any) {
      Alert.alert("Couldn't switch", error?.response?.data?.message ?? locationErrorMessage(error));
    } finally {
      setSwitching(false);
    }
  };

  const errorText = (error: any) =>
    error?.response
      ? locationErrorMessage(error)
      : error instanceof UserFacingError
        ? error.message
        : locationErrorMessage(error);

  /**
   * Saves one switch. It shows the new value at once, keeps it while saving,
   * and lets go only after the reload has brought the saved value - so it
   * never jumps back. A failed save reloads, which shows the real value.
   */
  const toggle = async (key: string, value: boolean, request: () => Promise<unknown>, done?: string) => {
    setPendingSwitch((current) => ({ ...current, [key]: value }));
    setMessage("");
    try {
      await request();
      await load();
      if (done) setMessage(done);
    } catch (error: any) {
      setMessage(errorText(error));
      await load();
    } finally {
      setPendingSwitch((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };
  const switchValue = (key: string, saved: boolean) => pendingSwitch[key] ?? saved;
  const switchBusy = (key: string) => key in pendingSwitch;

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  useEffect(() => {
    if (!searchOpen) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      closeSearch();
      return true;
    });
    return () => listener.remove();
  }, [closeSearch, searchOpen]);

  /** Runs an action; `work` returns false when it stopped on purpose (nothing to report). */
  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMessage("");
    try {
      const outcome = await work();
      await load();
      if (done && outcome !== false) setMessage(done);
    } catch (error: any) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  /**
   * After unhiding at the place the phone is in: one fix, sent. Quietly - if
   * no position can be had, the person is still unhidden and the next update
   * (on open, or Update now) publishes them.
   */
  const refreshAfterUnhide = async () => {
    const permission = await readPermission();
    if (permission.status !== "granted") return;
    if (!(await ensureLocationServices())) return;
    await sendCurrentLocation(permission.accuracy).catch(() => undefined);
  };

  /** Set while "Update now" is getting a position, so its button can say so. */
  const [updating, setUpdating] = useState(false);

  /** A fresh live fix, asking for permission only on this tap. */
  const updateNow = () =>
    run(async () => {
      setUpdating(true);
      try {
        return await updateNowWork();
      } finally {
        setUpdating(false);
      }
    }, "Location updated.");

  const updateNowWork = async () => {
    let permission = await readPermission();
    if (permission.status !== "granted") {
      if (!permission.canAskAgain) {
        Alert.alert("Location is blocked", "Allow location for this app in your phone's settings.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open settings", onPress: () => void openSystemSettings() },
        ]);
        return false;
      }
      permission = await requestPermission();
      if (permission.status !== "granted") throw new UserFacingError("Location was not allowed.");
    }
    // Location off in quick settings: Android's own dialog to turn it on.
    if (!(await ensureLocationServices())) throw new UserFacingError("Turn on your phone's location to update it.");
    await sendCurrentLocation(permission.accuracy);
    notifyLocationSettingsChanged();
    return true;
  };

  const savePlace = (label: string) =>
    run(async () => {
      const clean = label.trim();
      if (!clean) throw new UserFacingError("Give the place a name, like Home or Hostel.");
      // Saving uses the phone's current position, so take a fresh one first.
      if (!status?.canSavePlace) {
        const permission = await requestPermission();
        if (permission.status !== "granted") throw new UserFacingError("Saving a place needs your location once.");
        await sendCurrentLocation(permission.accuracy);
      }
      await api.post("/profile/location/places", { label: clean });
      setLabelDraft("");
      beginHeightTransition();
      setAddingSavedPlace(false);
    }, `Saved "${label.trim()}".`);

  /** Saves the times chosen with the steppers. */
  const saveHours = (next: { start: number; end: number }) =>
    run(async () => {
      await api.put("/profile/location/settings", { invisibleHours: next });
      hoursDirty.current = false;
      setHoursChanged(false);
    }, "Invisible hours saved.");

  const changeHours = (edge: "start" | "end", minutes: number) => {
    hoursDirty.current = true;
    setHoursChanged(true);
    setHours((current) => current && { ...current, [edge]: (current[edge] + minutes + 1440) % 1440 });
  };

  /** Invisible hours on (11 pm - 7 am to start with) or off, saved at once. */
  const switchHours = (on: boolean) => {
    beginHeightTransition();
    const next = on ? { start: 23 * 60, end: 7 * 60 } : null;
    hoursDirty.current = false;
    setHoursChanged(false);
    setHours(next);
    void toggle(
      "invisible",
      on,
      () => api.put("/profile/location/settings", { invisibleHours: next }),
      on ? "Invisible from 11:00 pm to 7:00 am. Change the times below." : "Invisible hours off.",
    );
  };

  /** Renames a saved place: on Done or on tapping away; an empty or unchanged name is dropped. */
  const finishRename = (place: { id: string; label: string }) => {
    if (!renaming || renaming.id !== place.id) return;
    const label = renaming.label.trim();
    setRenaming(null);
    if (!label || label === place.label) return;
    void run(() => api.patch(`/profile/location/places/${place.id}`, { label }), `Renamed to "${label}".`);
  };

  const search = (text: string) => {
    setQuery(text);
    setSearchMessage("");
    clearTimeout(searchTimer.current);
    const request = ++searchRequest.current;
    if (text.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const near = status?.cell ? { lat: status.cell.latitude, lon: status.cell.longitude } : {};
        const response = await api.get("/discover/map/places/search", { params: { q: text.trim(), ...near } });
        if (request !== searchRequest.current) return;
        setResults(response.data.data.places ?? []);
      } catch {
        if (request !== searchRequest.current) return;
        setResults([]);
        setSearchMessage("Search failed. Check your connection and try again.");
      } finally {
        if (request === searchRequest.current) setSearching(false);
      }
    }, 350);
  };

  const pinPlace = async (result: SearchResult) => {
    if (pinningPlace.current) return;
    pinningPlace.current = true;
    setPinningPlaceId(result.externalId);
    setBusy(true);
    setSearchMessage("");
    try {
      const response = await api.post("/discover/map/places/mine", { externalId: result.externalId });
      setMapPlaces(response.data.data.places ?? []);
      closeSearch();
      setMessage(`Pinned ${result.name}.`);
      void load();
    } catch (error: any) {
      setSearchMessage(errorText(error));
    } finally {
      pinningPlace.current = false;
      setPinningPlaceId(null);
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <View style={[styles.page, styles.center, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        {!!message ? (
          <View style={styles.loadError}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.primaryLight} />
            <Text style={styles.loadErrorText}>{message}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}>
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );
  }

  const distanceMode = status.mode === "distance";
  const active = status.places.find((place) => place.id === status.activePlaceId) ?? null;

  if (searchOpen) {
    return (
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <View style={[styles.searchPage, { paddingTop: insets.top + 4, paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.searchHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close place search" onPress={closeSearch} style={styles.back}>
              <Ionicons name="arrow-back" size={22} color={colors.text.primary} />
            </Pressable>
            <View style={styles.searchHeaderCopy}>
              <Text style={styles.searchTitle}>Add a map spot</Text>
              <Text style={styles.searchSubtitle}>Choose a place you like</Text>
            </View>
          </View>
          <View style={styles.searchField}>
            <Ionicons name="search" size={20} color={colors.primaryLight} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={search}
              placeholder="Search cafés, parks, libraries..."
              placeholderTextColor="#AAB1BC"
              returnKeyType="search"
              style={styles.searchInput}
              accessibilityLabel="Search for a place"
            />
            {!!query && (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => search("")} hitSlop={8} style={styles.searchClear}>
                <Ionicons name="close" size={18} color="#D8D2D5" />
              </Pressable>
            )}
          </View>
          <ScrollView style={styles.searchList} keyboardShouldPersistTaps="always" keyboardDismissMode="none" showsVerticalScrollIndicator={false}>
            {!!searchMessage && <Text accessibilityLiveRegion="polite" style={styles.searchError}>{searchMessage}</Text>}
            {searching ? (
              <View style={styles.searchState}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.searchStateText}>Searching places…</Text>
              </View>
            ) : query.trim().length < 2 ? (
              <View style={styles.searchState}>
                <View style={styles.searchStateIcon}><Ionicons name="location-outline" size={26} color={colors.primaryLight} /></View>
                <Text style={styles.searchStateTitle}>Find a place to pin</Text>
                <Text style={styles.searchStateText}>Search cafés, parks, libraries, and other public places.</Text>
                <Text style={styles.searchPrivacy}>A pin shows what you like, not where you are.</Text>
              </View>
            ) : results.length === 0 ? (
              searchMessage ? null : <View style={styles.searchState}>
                <View style={styles.searchStateIcon}><Ionicons name="search-outline" size={26} color={colors.primaryLight} /></View>
                <Text style={styles.searchStateTitle}>No places found</Text>
                <Text style={styles.searchStateText}>Try a different name or a nearby area.</Text>
              </View>
            ) : (
              <>
              <View style={styles.searchResultsHeading}>
                <Text style={styles.searchResultsTitle}>Search results</Text>
                <Text style={styles.searchResultsCount}>{results.length}</Text>
              </View>
              <View style={styles.searchResultsCard}>
              {results.map((result, index) => (
                <Pressable
                  key={result.externalId}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void pinPlace(result)}
                  style={({ pressed }) => [styles.searchResult, index === results.length - 1 && styles.searchResultLast, pressed && styles.searchResultPressed]}
                >
                  <View style={styles.searchResultIcon}>
                    <Ionicons name="location-outline" size={19} color={colors.primaryLight} />
                  </View>
                  <View style={styles.searchResultCopy}>
                    <Text style={styles.searchResultName}>{result.name}</Text>
                    {!!result.subtitle && <Text style={styles.searchResultSubtitle} numberOfLines={2}>{result.subtitle}</Text>}
                  </View>
                  <View style={styles.searchAddIcon}>
                    {pinningPlaceId === result.externalId ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="add" size={20} color={colors.primaryLight} />}
                  </View>
                </Pressable>
              ))}
              </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={styles.back}>
        <Ionicons name="arrow-back" size={22} color={colors.text.primary} />
      </Pressable>
      <Text style={styles.title}>Location settings</Text>
    </View>
    <ScrollView
      ref={settingsScroll}
      style={styles.page}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 12 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      scrollEnabled={!layoutAnimating}
      onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
      scrollEventThrottle={16}
    >
      {/* Where you appear from */}
      <View style={styles.settingsGroup}>
      <Text style={[styles.section, styles.sourceSection]}>Where you appear</Text>
      <View style={[styles.card, styles.sourceCard]}>
        {!distanceMode ? (
          <>
          <View style={styles.sourceHeading}>
            <View style={styles.sourceIcon}><Ionicons name="school-outline" size={22} color={colors.primaryLight} /></View>
            <View style={styles.sourceCopy}>
              <Text style={styles.sourceTitle}>College mode</Text>
              <Text style={[styles.meta, styles.sourceMeta]}>You meet people by college, and your location isn't used. Switch to People nearby to meet people around you.</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" disabled={busy || switching} onPress={() => void switchArea("nearby")}
            style={[styles.button, styles.modeButton, (busy || switching) && styles.dim]}>
            {switching ? <ActivityIndicator size="small" color="#fff" /> : <View style={styles.actionContent}>
              <Ionicons name="navigate-outline" size={17} color="#fff" />
              <Text style={styles.buttonText}>Use People nearby</Text>
            </View>}
          </Pressable>
          </>
        ) : (
          <>
            <View style={styles.sourceHeading}>
              <View style={styles.sourceIcon}>
                <Ionicons name={status.hiddenHere ? "eye-off-outline" : status.source === "place" ? "bookmark-outline" : "navigate-outline"} size={24} color="#E5E7EB" />
              </View>
              <View style={styles.sourceCopy}>
                <Text style={styles.sourceTitle}>
                  {status.hiddenHere ? "Hidden at this place" : status.source === "place" && active ? active.label : status.cell ? "Following your phone" : "No location yet"}
                </Text>
                <Text style={[styles.meta, styles.sourceMeta]}>
                  Updated {ago(status.updatedAt)}
                  {status.accuracy ? " · Approximate area shared" : ""}
                </Text>
              </View>
            </View>
            {status.accuracy === "approximate" && (status.accuracyM ?? 0) > 5000 && (
              <Text style={styles.note}>Your location is approximate, so distances to you are rough.</Text>
            )}
            {status.hiddenHere && (
              <Text style={styles.note}>
                You can still browse. Turn off “Hide me while I'm here” below to appear in distance discovery again.
              </Text>
            )}
            {!status.fresh && status.cell && (
              <Text style={styles.warn}>It's over two weeks old, so you're out of other people's decks until it updates.</Text>
            )}
            <View style={[styles.row, styles.sourceActions]}>
              {/* Faded while hidden at a place: an update there keeps you hidden, so
                  it can't do anything. Leaving is noticed on the next app open. */}
              {!status.hiddenHere && <Pressable
                disabled={busy || status.hiddenHere}
                onPress={updateNow}
                style={[styles.button, ((busy && !updating) || status.hiddenHere) && styles.dim]}
              >
                {updating ? (
                  <View style={styles.row}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.buttonText}>Updating…</Text>
                  </View>
                ) : (
                  <View style={styles.actionContent}>
                    <Ionicons name="locate-outline" size={17} color="#fff" />
                    <Text style={styles.buttonText}>Update now</Text>
                  </View>
                )}
              </Pressable>}
              {status.source === "place" && (
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    run(async () => {
                      // Source and position change together (LOCATION_SPEC.md 7).
                      await followPhoneAgain(await readPermission());
                      notifyLocationSettingsChanged();
                    }, "Following your phone again.")
                  }
                  style={[styles.buttonGhost, busy && styles.dim]}
                >
                  <Text style={styles.buttonText}>Follow phone</Text>
                </Pressable>
              )}
              <Pressable accessibilityRole="button" accessibilityLabel="Use college mode instead" disabled={busy || switching} onPress={() => Alert.alert(
                  "Switch to college mode?", "You'll meet people by college again, and your location stops being used for matching.",
                  [{ text: "Cancel", style: "cancel" }, { text: "Switch", onPress: () => void switchArea("college") }])}
                style={[styles.collegeLink, (busy || switching) && styles.dim]}>
                <Ionicons name="school-outline" size={15} color={colors.primaryLight} />
                <Text style={styles.collegeLinkText}>College mode</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
      </View>

      {/* Saved places */}
      <Animated.View layout={SETTINGS_LAYOUT} style={styles.settingsGroup}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionLabel}>Saved places</Text>
        <Text style={styles.sectionCount}>{status.places.length} / {MAX_SAVED_PLACES}</Text>
      </View>
      <Text style={styles.explain}>
        Choose where you appear. Saved names are private.
      </Text>
      {status.places.map((place) => (
        <View key={place.id} style={[styles.card, styles.listItem]}>
          <View style={styles.placeHead}>
            <View style={styles.placeIcon}>
              <Ionicons name={place.hideHere ? "eye-off-outline" : "bookmark-outline"} size={19} color={colors.primaryLight} />
            </View>
            {renaming?.id === place.id ? (
              <TextInput
                value={renaming.label}
                onChangeText={(label) => setRenaming({ id: place.id, label: label.slice(0, 24) })}
                autoFocus
                returnKeyType="done"
                style={[styles.input, { flex: 1 }]}
                onSubmitEditing={() => finishRename(place)}
                onBlur={() => finishRename(place)}
              />
            ) : (
              <Text style={styles.placeName}>{place.label}</Text>
            )}
            {place.isCurrent && <Text style={styles.badge}>You're here</Text>}
            {status.activePlaceId === place.id && <Text style={styles.badge}>In use</Text>}
          </View>
          <View style={[styles.switchRow, styles.dividedRow]}>
            <View style={styles.switchCopy}>
              <Text style={styles.body}>Hide me while I'm here</Text>
              <Text style={styles.meta}>Hide from distance discovery at this place.</Text>
            </View>
            <Switch
              trackColor={{ false: "#42464F", true: colors.primary }}
              thumbColor="#FFFFFF"
              value={switchValue(`hideHere:${place.id}`, place.hideHere)}
              disabled={switchBusy(`hideHere:${place.id}`)}
              onValueChange={(hideHere) =>
                void toggle(
                  `hideHere:${place.id}`,
                  hideHere,
                  async () => {
                    await api.patch(`/profile/location/places/${place.id}`, { hideHere });
                    // Unhiding where the phone is: send a position now. The
                    // server keeps the person hidden until a fresh one comes,
                    // so without it the deck and map stayed paused.
                    if (!hideHere && (place.isCurrent || status.hiddenHere)) await refreshAfterUnhide();
                    notifyLocationSettingsChanged();
                  },
                  hideHere
                    ? `You're hidden while you're at "${place.label}".`
                    : place.isCurrent || status.hiddenHere
                      ? `You're visible at "${place.label}" again.`
                      : `You can be seen at "${place.label}" again.`,
                )
              }
            />
          </View>
          <View style={[styles.row, styles.placeActions]}>
            {distanceMode && !place.hideHere && status.activePlaceId !== place.id && (
              <Pressable
                disabled={busy}
                onPress={() => run(async () => {
                  await api.put("/profile/location/source", { placeId: place.id });
                  notifyLocationSettingsChanged();
                }, `Appearing from "${place.label}".`)}
                style={styles.buttonGhost}
              >
                <Text style={styles.buttonText}>Appear from here</Text>
              </Pressable>
            )}
            <Pressable disabled={busy} onPress={() => setRenaming({ id: place.id, label: place.label })} style={styles.buttonGhost}>
              <Text style={styles.buttonText}>Rename</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() =>
                Alert.alert("Remove this place?", `"${place.label}" will be forgotten.`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => void run(async () => {
                    await api.delete(`/profile/location/places/${place.id}`);
                    notifyLocationSettingsChanged();
                  }) },
                ])
              }
              style={styles.buttonDanger}
            >
              <Text style={styles.danger}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {status.places.length < MAX_SAVED_PLACES && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: addingSavedPlace }}
          onPress={() => {
            beginHeightTransition();
            setAddingSavedPlace((value) => !value);
          }}
          style={styles.addSpot}
        >
          <Ionicons name={addingSavedPlace ? "remove" : "add"} size={22} color={colors.primaryLight} />
          <Text style={styles.addSpotText}>{addingSavedPlace ? "Cancel new place" : "Save current place"}</Text>
          <Ionicons name={addingSavedPlace ? "chevron-up" : "chevron-forward"} size={17} color="#BCC1C9" />
        </Pressable>
      )}
      {status.places.length < MAX_SAVED_PLACES && addingSavedPlace && (
        <Animated.View layout={SETTINGS_LAYOUT} entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={styles.card}>
          <Text style={styles.meta}>You must be here to save it. Choose a name.</Text>
          <View style={styles.chips}>
            {LABELS.map((label) => (
              <Pressable key={label} disabled={busy} onPress={() => savePlace(label)} style={styles.chip}>
                <Text style={styles.buttonText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <TextInput
              ref={savedPlaceInput}
              value={labelDraft}
              onChangeText={(text) => setLabelDraft(text.slice(0, 24))}
              onFocus={() => {
                savedPlaceFocused.current = true;
                if (keyboardTop.current !== null) revealSavedPlaceInput(keyboardTop.current);
              }}
              onBlur={() => { savedPlaceFocused.current = false; }}
              placeholder="Or your own name"
              placeholderTextColor="#AAB1BC"
              style={[styles.input, { flex: 1 }]}
            />
            <Pressable disabled={busy || !labelDraft.trim()} onPress={() => savePlace(labelDraft)} style={[styles.button, (!labelDraft.trim() || busy) && styles.dim]}>
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}
      </Animated.View>

      {/* Privacy */}
      <Animated.View layout={SETTINGS_LAYOUT} style={styles.settingsGroup}>
      <Text style={styles.section}>Privacy</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.body}>Hide my distance</Text>
            <Text style={styles.meta}>Hide the distance on your profile. Keep matching.</Text>
          </View>
          <Switch
            trackColor={{ false: "#42464F", true: colors.primary }}
            thumbColor="#FFFFFF"
            value={switchValue("hideDistance", status.settings.hideDistance)}
            disabled={switchBusy("hideDistance")}
            onValueChange={(hideDistance) =>
              void toggle(
                "hideDistance",
                hideDistance,
                () => api.put("/profile/location/settings", { hideDistance }),
                hideDistance ? "Your distance is hidden." : "Your distance shows again.",
              )
            }
          />
        </View>
        <View style={[styles.switchRow, styles.dividedRow]}>
          <View style={styles.switchCopy}>
            <Text style={styles.body}>Hide me from maps</Text>
            <Text style={styles.meta}>Exclude you from map lists and counts.</Text>
          </View>
          <Switch
            trackColor={{ false: "#42464F", true: colors.primary }}
            thumbColor="#FFFFFF"
            value={switchValue("hideFromMaps", status.settings.hideFromMaps)}
            disabled={switchBusy("hideFromMaps")}
            onValueChange={(hideFromMaps) =>
              void toggle(
                "hideFromMaps",
                hideFromMaps,
                () => api.put("/profile/location/settings", { hideFromMaps }),
                // Leaving the map is immediate (the server refreshes every
                // map at once); coming back waits for the hourly map refresh.
                hideFromMaps
                  ? "You're off the map now."
                  : "You'll be back on maps within the hour.",
              )
            }
          />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.body}>Invisible hours</Text>
            <Text style={styles.meta}>Pause your visibility in distance discovery.</Text>
          </View>
          <Switch
            trackColor={{ false: "#42464F", true: colors.primary }}
            thumbColor="#FFFFFF"
            value={switchValue("invisible", !!hours)}
            disabled={switchBusy("invisible")}
            onValueChange={switchHours}
          />
        </View>
        {hours && (
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={styles.hoursContent}>
            <View style={styles.timeRange}>
            {(["start", "end"] as const).map((edge) => (
              <View key={edge} style={styles.timeColumn}>
                <Text style={styles.meta}>{edge === "start" ? "From" : "Until"}</Text>
                <View style={styles.stepper}>
                  <Pressable
                    accessibilityLabel={`${edge} 30 minutes earlier`}
                    onPress={() => changeHours(edge, -30)}
                    style={styles.step}
                  >
                    <Ionicons name="remove" size={18} color="#fff" />
                  </Pressable>
                  <Text style={styles.time}>{clock(hours[edge])}</Text>
                  <Pressable
                    accessibilityLabel={`${edge} 30 minutes later`}
                    onPress={() => changeHours(edge, 30)}
                    style={styles.step}
                  >
                    <Ionicons name="add" size={18} color="#fff" />
                  </Pressable>
                </View>
              </View>
            ))}
            </View>
            {hours.start === hours.end && (
              <Text style={styles.warn}>Start and end need to be different times.</Text>
            )}
            {hoursChanged ? <Pressable
              disabled={busy || hours.start === hours.end}
              onPress={() => saveHours(hours)}
              style={[styles.button, styles.saveHoursButton, (busy || hours.start === hours.end) && styles.dim]}
            >
              <Text style={styles.buttonText}>Save hours</Text>
            </Pressable> : <View style={styles.savedHours}>
              <Ionicons name="checkmark" size={16} color="#C6CCD4" />
              <Text style={styles.meta}>Schedule saved</Text>
            </View>}
          </Animated.View>
        )}
      </View>
      </Animated.View>

      {/* Map spots */}
      <View style={styles.settingsGroup}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionLabel}>Map spots</Text>
        <Text style={styles.sectionCount}>{mapPlaces.length} / {MAX_MAP_PLACES}</Text>
      </View>
      <Text style={styles.explain}>
        Places you like, never your live location. Profiles appear only when enough people pin the place.
      </Text>
      {mapPlaces.map((place) => (
        <View key={place.id} style={[styles.card, styles.spotRow, styles.listItem]}>
          <View style={styles.placeIcon}><Ionicons name="location-outline" size={20} color={colors.primaryLight} /></View>
          <View style={styles.switchCopy}>
            <Text style={styles.cardTitle}>{place.name}</Text>
            {!!place.subtitle && <Text style={styles.meta}>{place.subtitle}</Text>}
          </View>
          <Pressable
            accessibilityLabel={`Unpin ${place.name}`}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => run(async () => {
              const response = await api.delete(`/discover/map/places/mine/${place.id}`);
              setMapPlaces(response.data.data.places ?? []);
            })}
            style={styles.removeSpot}
          >
            <Ionicons name="close" size={19} color={colors.text.secondary} />
          </Pressable>
        </View>
      ))}
      {mapPlaces.length < MAX_MAP_PLACES && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setSearchOpen(true)}
          style={({ pressed }) => [styles.addSpot, pressed && styles.pressed]}
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.primaryLight} />
          <Text style={styles.addSpotText}>Add a map spot</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.text.secondary} />
        </Pressable>
      )}
      </View>

      {/* Withdraw */}
      <Animated.View style={[styles.removeAll, removeAnimatedStyle]}>
      <Pressable
        disabled={busy}
        accessibilityRole="button"
        onHoverIn={() => {
          setRemoveHovered(true);
          removeScale.value = withTiming(1.01, { duration: 140 });
        }}
        onHoverOut={() => {
          setRemoveHovered(false);
          removeScale.value = withTiming(1, { duration: 140 });
        }}
        onPressIn={() => { removeScale.value = withTiming(0.98, { duration: 120 }); }}
        onPressOut={() => { removeScale.value = withTiming(removeHovered ? 1.01 : 1, { duration: 140 }); }}
        onPress={() =>
          Alert.alert(
            "Remove your location?",
            "This erases your stored location and saved places, and turns off distance discovery until you share it again.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Remove",
                style: "destructive",
                onPress: () =>
                  void run(async () => {
                    await api.delete("/profile/location");
                    notifyLocationSettingsChanged();
                    resetLocationSession();
                  }, "Location removed."),
              },
            ],
          )
        }
        style={({ pressed }) => [styles.removeButton, removeHovered && styles.removeHover, pressed && styles.removeHeld]}
      >
          <Ionicons name="trash-outline" size={18} color="#B8161B" />
          <Text style={styles.removeText}>Remove my location and saved places</Text>
      </Pressable>
      </Animated.View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingBottom: 7, backgroundColor: colors.background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#303238" },
  back: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  section: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
    paddingTop: 8,
    paddingBottom: 14,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  settingsGroup: { marginHorizontal: 8, marginBottom: 9, paddingHorizontal: 15, paddingTop: 8, paddingBottom: 10, borderRadius: 18, backgroundColor: "#232323" },
  sectionHeading: { minHeight: 42, paddingBottom: 10, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionLabel: { color: "#FFFFFF", fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
  sectionCount: { color: "#AEB5C0", fontSize: 13, fontVariant: ["tabular-nums"] },
  explain: { color: "#BDC2CB", fontSize: 14, lineHeight: 21, marginBottom: 6 },
  card: {
    paddingVertical: 8,
    gap: 8,
  },
  hoursContent: { gap: 8 },
  listItem: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#303238" },
  sourceSection: { fontSize: 16, paddingTop: 4, paddingBottom: 10, marginBottom: 0 },
  sourceCard: { paddingTop: 8 },
  sourceHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  sourceIcon: { width: 26, height: 32, alignItems: "center", justifyContent: "center" },
  sourceCopy: { flex: 1, minWidth: 0, gap: 2 },
  sourceTitle: { color: colors.text.primary, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  sourceMeta: { fontSize: 12, lineHeight: 17, marginTop: 0 },
  sourceActions: { paddingTop: 0, gap: 8 },
  body: { color: "#ECEEF2", fontSize: 15, fontWeight: "500", lineHeight: 21 },
  cardTitle: { color: colors.text.primary, fontSize: 16, fontWeight: "700", lineHeight: 22 },
  meta: { color: "#BDC2CB", fontSize: 13, lineHeight: 19, marginTop: 2 },
  note: { color: "#CDD1D8", fontSize: 13, lineHeight: 19, marginTop: 4 },
  warn: { color: "#FFCC9D", fontSize: 13, lineHeight: 20 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 9, alignItems: "center" },
  actionContent: { flexDirection: "row", alignItems: "center", gap: 7 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 48 },
  switchCopy: { flex: 1, paddingRight: 4 },
  dividedRow: { marginTop: 4, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#303238" },
  button: { minHeight: 44, paddingHorizontal: 17, paddingVertical: 10, borderRadius: 15, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  buttonGhost: { minHeight: 42, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: "#3B3438", alignItems: "center", justifyContent: "center" },
  buttonDanger: { minHeight: 42, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: "#492E32", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  modeButton: { marginTop: 0, alignSelf: "flex-start" },
  collegeLink: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 8 },
  collegeLinkText: { color: colors.primaryLight, fontSize: 13, fontWeight: "600" },
  danger: { color: "#FF8D91", fontSize: 14, fontWeight: "600" },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 42, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, backgroundColor: "#44333A" },
  input: {
    color: colors.text.primary,
    borderBottomWidth: 1,
    borderBottomColor: "#686E78",
    paddingHorizontal: 2,
    paddingVertical: 11,
    fontSize: 15,
    minWidth: 120,
  },
  placeHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 9 },
  placeIcon: { width: 26, height: 34, alignItems: "center", justifyContent: "center" },
  placeName: { color: colors.text.primary, fontSize: 16, fontWeight: "700", flex: 1, minWidth: 90 },
  badge: { color: "#CCD2DA", fontSize: 12, fontWeight: "500" },
  placeActions: { paddingTop: 4, gap: 8 },
  timeRange: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 4 },
  timeColumn: { flex: 1, minWidth: 130, gap: 4 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  step: { width: 32, height: 40, borderRadius: 10, backgroundColor: "#383838", alignItems: "center", justifyContent: "center" },
  time: { color: "#FFFFFF", fontSize: 16, fontWeight: "600", textAlign: "center", fontVariant: ["tabular-nums"] },
  savedHours: { flexDirection: "row", alignItems: "center", gap: 6 },
  saveHoursButton: { alignSelf: "flex-start" },
  spotRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  removeSpot: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#383838", alignItems: "center", justifyContent: "center" },
  addSpot: { marginTop: 8, paddingHorizontal: 12, borderRadius: 15, backgroundColor: "#473039", minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10 },
  addSpotText: { flex: 1, color: "#F0F2F5", fontSize: 15, fontWeight: "600" },
  removeAll: { alignSelf: "stretch", marginHorizontal: 8, marginTop: 14, borderRadius: 15, elevation: 0, shadowOpacity: 0, shadowColor: "transparent" },
  removeButton: { minHeight: 46, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 15, backgroundColor: "#FFDAD6", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  removeHover: { backgroundColor: "#FFE8E4" },
  removeHeld: { backgroundColor: "#F8C5C2" },
  removeText: { color: "#B8161B", fontSize: 13, fontWeight: "700", textAlign: "center" },
  searchPage: { flex: 1 },
  searchHeader: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingBottom: 8, marginBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#303238" },
  searchHeaderCopy: { flex: 1 },
  searchTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  searchSubtitle: { color: "#C4C8D0", fontSize: 12, marginTop: 2 },
  searchField: { marginHorizontal: 12, height: 54, borderRadius: 27, backgroundColor: "#232323", paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 11 },
  searchInput: { flex: 1, height: "100%", paddingVertical: 0, color: "#FFFFFF", fontSize: 15 },
  searchClear: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#3A383A", alignItems: "center", justifyContent: "center" },
  searchList: { flex: 1, marginTop: 18, paddingHorizontal: 12 },
  searchResultsHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 4, marginBottom: 10 },
  searchResultsTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  searchResultsCount: { color: "#BDC2CB", fontSize: 13 },
  searchResultsCard: { backgroundColor: "#232323", borderRadius: 18, paddingHorizontal: 14, overflow: "hidden" },
  searchResult: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#3D3B3D" },
  searchResultLast: { borderBottomWidth: 0 },
  searchResultPressed: { opacity: 0.65 },
  searchResultIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#373034", alignItems: "center", justifyContent: "center" },
  searchResultCopy: { flex: 1, paddingVertical: 10 },
  searchResultName: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  searchResultSubtitle: { color: "#C4C8D0", fontSize: 13, lineHeight: 18, marginTop: 3 },
  searchAddIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#493137", alignItems: "center", justifyContent: "center" },
  searchState: { alignItems: "center", marginTop: 10, paddingHorizontal: 24, paddingVertical: 28, borderRadius: 18, backgroundColor: "#232323", gap: 7 },
  searchStateIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: "#3E2D34", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  searchStateTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  searchStateText: { color: "#C4C8D0", fontSize: 14, lineHeight: 20, textAlign: "center" },
  searchPrivacy: { color: "#AEB4BD", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 12 },
  searchError: { color: "#FFBEC3", backgroundColor: "#38282B", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  loadError: { marginHorizontal: 30, alignItems: "center", gap: 14 },
  loadErrorText: { color: colors.text.primary, fontSize: 14, lineHeight: 21, textAlign: "center" },
});
