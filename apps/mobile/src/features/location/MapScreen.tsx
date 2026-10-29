import { UnverifiedNudge } from '../verification/VerifyNudge';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, BackHandler, Easing, Pressable, StatusBar, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSelector } from "react-redux";
import type { RootState } from "../../store";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../core/theme/colors";
import { api } from "../../services/api";
import { ExploreProfile, CardOrigin } from "../discovery/components/ExploreProfileCard";
import { ProfileDetailModal } from "../discovery/components/profile-detail/ProfileDetailModal";
import { demoProfiles } from "../discovery/demo/demoProfiles";
import { LatLng, MAX_ZOOM, project, TileMap, unproject } from "./TileMap";
import { MapArea, MapMarker, MapplsMap, mapplsAvailable, MAPPLS_MAX_ZOOM } from "./MapplsMap";
import { MapLoadingArtwork } from "./MapLoadingArtwork";
import { MapIntroduction, MapIntroductionChecking } from "./MapIntroduction";
import { mapIntroductionTracker } from "./mapIntroductionState";
import { LocationProfileCarousel } from "./LocationProfileCarousel";
import { mapSession, recentFix, rememberFix, rememberSnapshot, snapshotFor } from "./mapSession";
import {
  ensureLocationServices,
  locationErrorMessage,
  openSystemSettings,
  readFreshFix,
  readLastKnownPosition,
  readOwnPosition,
  sendFix,
  readPermission,
  requestPermission,
} from "./locationClient";

/** How close "locate me" brings the map: a few streets around you. */
const LOCATE_ZOOM = 16;
/** A position found this soon after opening also centres the map. */
const RECENTRE_WINDOW_MS = 4000;

type Band = "none" | "few" | "10+" | "25+" | "50+" | "100+";
type Counted = { id: string; name: string; latitude: number; longitude: number; band: Band; canList: boolean };
type Campus = Counted & { institution: string };
type Spot = Counted & { subtitle: string | null; category: string | null };
type MapData = {
  state: "ok" | "setup_required";
  /** With setup_required: hidden at a place on purpose, not unfinished setup. */
  hiddenHere?: boolean;
  mode: "college" | "distance" | null;
  me: (LatLng & { kind: "cell" | "campus" }) | null;
  campuses: Campus[];
  spots: Spot[];
  areas: (LatLng & { size: number; band: Band })[];
};
type Selection = { kind: "campus"; item: Campus } | { kind: "place"; item: Spot };

/** Kolkata, for a first view when there is nothing of the viewer's own to centre on. */
const FALLBACK = { latitude: 22.57, longitude: 88.4 };
/** Spots closer than this on screen merge into one group bubble. */
const GROUP_PX = 38;
/** Campuses sharing an anchor are stacked this far apart on screen. */
const CAMPUS_STEP_PX = 34;
const PIN_ANCHOR_WIDTH = 234;
const PIN_ANCHOR_HEIGHT = 58;
const MAP_PURPLE = "#7052C7";
const MAP_PURPLE_DARK = "#4B348D";
const MAP_INK = "#302842";
/**
 * Pin colours, chosen against everything else on the map: the areas glow
 * (lavender, violet, pink), grey land, pale-yellow roads, light-blue water,
 * pale-green parks and the blue "you" dot. Teal and orange sit across the
 * colour wheel from violet and pink, so pins stay clear on the glow.
 */
const CAMPUS_TEAL = "#0F766E";
const PLACE_ORANGE = "#EA580C";

const BAND_TEXT: Record<Band, string> = {
  none: "No one yet",
  few: "A few",
  "10+": "10+",
  "25+": "25+",
  "50+": "50+",
  "100+": "100+",
};
const AREA_OPACITY: Record<Band, number> = { none: 0, few: 0, "10+": 0.16, "25+": 0.24, "50+": 0.32, "100+": 0.42 };
/** How strongly each band glows on the Mappls map. */
const AREA_WEIGHT: Record<Band, number> = { none: 0, few: 0, "10+": 0.35, "25+": 0.55, "50+": 0.8, "100+": 1 };

/** "UEM-KOLKATA" -> "UEM Kolkata". */
function institutionName(code: string) {
  const [head, ...rest] = code.split(/[-_\s]+/);
  return [head, ...rest.map((part) => part.charAt(0) + part.slice(1).toLowerCase())].join(" ");
}

/** Spots that would overlap on screen at this zoom, merged; a group zooms in when tapped. */
function groupSpots(spots: Spot[], toScreen: (point: LatLng) => { x: number; y: number }) {
  const groups: { members: { spot: Spot; p: { x: number; y: number } }[]; x: number; y: number }[] = [];
  for (const spot of spots) {
    const p = toScreen(spot);
    const group = groups.find((g) => Math.hypot(g.x - p.x, g.y - p.y) < GROUP_PX);
    if (group) group.members.push({ spot, p });
    else groups.push({ members: [{ spot, p }], x: p.x, y: p.y });
  }
  return groups.map((group) => ({
    ...group,
    latitude: group.members.reduce((sum, m) => sum + m.spot.latitude, 0) / group.members.length,
    longitude: group.members.reduce((sum, m) => sum + m.spot.longitude, 0) / group.members.length,
  }));
}

/** Keep stacked campus pins at the same map coordinate after other pins hide. */
function selectionCoordinate(selection: Selection, campuses: Campus[], zoom: number): LatLng {
  if (selection.kind === "place") return selection.item;
  const index = campuses.findIndex((campus) => campus.id === selection.item.id);
  const before = campuses.slice(0, Math.max(0, index)).filter((campus) =>
    campus.latitude === selection.item.latitude && campus.longitude === selection.item.longitude,
  ).length;
  const point = project(selection.item, zoom);
  return unproject(point.x, point.y + before * CAMPUS_STEP_PX, zoom);
}

function GroupBubble({ count, onPress, style }: { count: number; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} places here. Zoom in`}
      onPress={onPress}
      style={[styles.group, style]}
    >
      <Text style={styles.groupText}>{count}</Text>
    </Pressable>
  );
}

function SpotPin({ spot, active, showName, onPress, style }: {
  spot: Spot; active: boolean; showName: boolean; onPress: () => void; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={styles.pinAnchor}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${spot.name}, ${BAND_TEXT[spot.band]} like it`}
        onPress={onPress}
        style={[styles.pin, styles.spotPin, active && styles.pinActive, style]}
      >
        <Ionicons name="cafe" size={active ? 16 : 12} color="#fff" />
        {(showName || active) && <Text style={[styles.pinText, active && styles.pinTextActive]} numberOfLines={1}>{spot.name}</Text>}
        <Text style={[styles.pinBand, active && styles.pinBandActive]}>{BAND_TEXT[spot.band]}</Text>
      </Pressable>
      <View pointerEvents="none" style={[styles.pinTail, styles.spotTail]} />
    </View>
  );
}

function CampusPin({ campus, active, onPress, style }: {
  campus: Campus; active: boolean; onPress: () => void; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={styles.pinAnchor}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${campus.name}, ${BAND_TEXT[campus.band]}`}
        onPress={onPress}
        style={[styles.pin, styles.campusPin, active && styles.pinActive, style]}
      >
        <Ionicons name="school" size={active ? 16 : 12} color="#fff" />
        <Text style={[styles.pinText, active && styles.pinTextActive]} numberOfLines={1}>{campus.name}</Text>
        <Text style={[styles.pinBand, active && styles.pinBandActive]}>{BAND_TEXT[campus.band]}</Text>
      </Pressable>
      <View pointerEvents="none" style={[styles.pinTail, styles.campusTail]} />
    </View>
  );
}

function MyLocationMarker({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View pointerEvents="none" style={[styles.me, style]}>
      <View style={styles.meBadge}>
        <Ionicons name="location-sharp" size={18} color="#FFFFFF" />
      </View>
    </View>
  );
}

/**
 * The map (LOCATION_SPEC.md 9), after happn's, with its unsafe half left out.
 *
 * Campuses and places show how many people and, past a floor of ten, who -
 * because a home campus and a favourite place are things people put on their
 * own profile. A place says someone *likes* it, never that they are there.
 * Areas around you (distance mode only) show how many and never who.
 *
 * Tapping a campus or place opens a panel over the map - the map stays
 * mounted - with previews that open the usual profile, Like and Pass.
 */
export function MapScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  // A hidden development URL can replay the animation without consuming the
  // account's first visit. The Map button never supplies this parameter.
  const previewIntroduction = __DEV__ && route.params?.previewIntroduction === 'true';
  const account = useSelector((state: RootState) => state.auth.user?.id ?? 'signed-out');
  const [introduction, setIntroduction] = useState<'checking' | 'intro' | 'done'>(() => previewIntroduction ? 'intro' : mapIntroductionTracker.hasSeen(account) === true ? 'done' : 'checking');
  useEffect(() => {
    let cancelled = false;
    if (previewIntroduction) {
      setIntroduction('intro');
    } else if (mapIntroductionTracker.hasSeen(account) === true) {
      setIntroduction('done');
    } else {
      setIntroduction('checking');
      void mapIntroductionTracker.needsIntroduction(account).then(needed => {
        if (!cancelled) setIntroduction(needed ? 'intro' : 'done');
      });
    }
    return () => {cancelled = true;};
  }, [account, previewIntroduction]);
  const finishIntroduction = useCallback(() => {
    if (!previewIntroduction) void mapIntroductionTracker.complete(account);
    setIntroduction('done');
  }, [account, previewIntroduction]);
  // What the last visit left (mapSession): with it, coming back shows the map
  // at once and refreshes quietly, instead of starting from a spinner.
  const saved = useRef(mapSession()).current;
  const returning = useRef(saved.camera !== null).current;
  const [liveData, setData] = useState<MapData | null>((saved.data as MapData | null) ?? null);
  const [error, setError] = useState("");
  const [view, setView] = useState<{ center: LatLng; zoom: number } | null>(
    saved.camera ? { center: saved.camera.center, zoom: saved.camera.zoom } : null,
  );
  const initialHeading = useRef(saved.camera?.heading ?? 0).current;
  const heading = useRef(initialHeading);
  // The picture of the map as it was left, if the map opens exactly there.
  const placeholder = useRef(snapshotFor(saved.camera)).current;
  useEffect(() => {
    if (__DEV__) {
      console.log("[map] open", JSON.stringify({ returning, snapshot: saved.snapshot ? (placeholder ? "used" : "camera differs") : "none" }));
    }
    // Once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (view) saved.camera = { center: view.center, zoom: view.zoom, heading: heading.current };
  }, [saved, view]);
  const onHeadingChange = useCallback(
    (next: number) => {
      heading.current = next;
      if (saved.camera) saved.camera = { ...saved.camera, heading: next };
    },
    [saved],
  );
  const [selected, setSelected] = useState<Selection | null>(null);
  const [pinClosing, setPinClosing] = useState(false);
  const [showOtherPins, setShowOtherPins] = useState(false);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [legendHeight, setLegendHeight] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const focusedSelection = useRef("");
  const closingPanel = useRef(false);
  const panelMotion = useRef(new Animated.Value(0)).current;
  const panelDismiss = useRef(new Animated.Value(0)).current;
  const panelReveal = useRef(new Animated.Value(0)).current;
  const otherPinOpacity = useMemo(() => panelMotion.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), [panelMotion]);
  const selectedPinScale = useMemo(() => panelMotion.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }), [panelMotion]);
  const [previews, setPreviews] = useState<ExploreProfile[] | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [profile, setProfile] = useState<ExploreProfile | null>(null);
  const [origin, setOrigin] = useState<CardOrigin>();
  // Mappls when this build has it and it accepts our credentials; the tile
  // map otherwise - straight away if Mappls already refused this session.
  const [native, setNative] = useState(mapplsAvailable && !saved.mapplsFailed);
  const request = useRef(0);

  // Demo (development builds only): sample campuses, places, areas and people
  // around where the map is, to see every state of the map without real
  // users. Nothing in it is sent to the server.
  const [demoAnchor, setDemoAnchor] = useState<LatLng | null>(null);
  const demoData = useMemo(() => (demoAnchor ? buildDemoMap(demoAnchor) : null), [demoAnchor]);
  const data = demoData ?? liveData;

  useEffect(() => {
    if (!selected) return;
    panelMotion.setValue(0);
    panelReveal.setValue(0);
    const opening = Animated.parallel([
      Animated.timing(panelMotion, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(panelReveal, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    opening.start(({ finished }) => {
      if (finished) setShowOtherPins(false);
    });
    return () => opening.stop();
  }, [selected?.kind, selected?.item.id, panelMotion, panelReveal]);

  useEffect(() => {
    if (closingPanel.current || !selected || !view || !data || !mapSize.width || !mapSize.height || !panelHeight || !legendHeight) return;
    const focusKey = `${selected.kind}:${selected.item.id}:${Math.round(panelHeight / 8)}:${Math.round(mapSize.height)}`;
    if (focusedSelection.current === focusKey) return;
    focusedSelection.current = focusKey;

    const overlap = Math.max(0, panelHeight - legendHeight);
    const visibleBottom = mapSize.height - overlap;
    const marker = project(selectionCoordinate(selected, data.campuses, view.zoom), view.zoom);
    const center = project(view.center, view.zoom);
    const angle = heading.current * Math.PI / 180;
    const dx = marker.x - center.x;
    const dy = marker.y - center.y;
    const screenX = mapSize.width / 2 + Math.cos(angle) * dx + Math.sin(angle) * dy;
    const screenY = mapSize.height / 2 - Math.sin(angle) * dx + Math.cos(angle) * dy;
    if (screenX >= 64 && screenX <= mapSize.width - 64 && screenY >= 56 && screenY <= visibleBottom - 64) return;

    const targetY = Math.max(56, Math.min(mapSize.height / 2, visibleBottom - 72));
    const targetDy = targetY - mapSize.height / 2;
    const nextCenter = unproject(
      marker.x + Math.sin(angle) * targetDy,
      marker.y - Math.cos(angle) * targetDy,
      view.zoom,
    );
    setView((current) => current ? { ...current, center: nextCenter } : current);
  }, [selected, view, data, mapSize, legendHeight, panelHeight]);

  const load = useCallback(async () => {
    try {
      const response = await api.get("/discover/map");
      const next = response.data.data as MapData;
      saved.data = next;
      setData(next);
      setError("");
      setView((current) =>
        current ?? {
          center: next.me ?? next.campuses[0] ?? FALLBACK,
          zoom: next.mode === "distance" ? 12 : 14,
        },
      );
    } catch (cause: any) {
      // With a remembered map on screen, a failed refresh just leaves it there.
      setError(cause?.response?.data?.message ?? "Could not load the map. Check your connection.");
    }
  }, [saved]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const maxZoom = native ? MAPPLS_MAX_ZOOM : MAX_ZOOM;

  /**
   * Where the phone is. Kept on the phone; the server only ever gets the
   * snapped cell. `data.me` is that cell's centre (or the campus), which can
   * sit a kilometre or more from the person - drawing the dot there looked
   * like the map had the wrong location.
   */
  const [myFix, setMyFixState] = useState<LatLng | null>(() => recentFix());
  const setMyFix = useCallback((at: LatLng | null) => {
    rememberFix(at);
    setMyFixState(at);
  }, []);
  const [locating, setLocating] = useState(false);

  // On open, with our permission already granted: Android's "Turn on device
  // location" dialog if the phone's location is off, then the dot at the
  // phone's real position. The permission dialog itself is kept for a tap
  // (locationClient). A fix arriving in the first moments also centres the
  // map; a later one leaves alone a map the person may be exploring.
  useEffect(() => {
    // Native location dialogs open after the paper animation, not over it.
    if (introduction !== 'done') return;
    let cancelled = false;
    const openedAt = Date.now();
    void (async () => {
      const permission = await readPermission();
      if (permission.status !== "granted") {
        // Taken away since the last visit: no remembered dot either.
        if (!cancelled) setMyFix(null);
        return;
      }
      if (!(await ensureLocationServices())) return;
      const at = await readOwnPosition();
      if (cancelled || !at) return;
      setMyFix(at);
      // Coming back, the map opens where it was left and stays there.
      if (!returning && Date.now() - openedAt < RECENTRE_WINDOW_MS) {
        setView((current) => ({ center: at, zoom: current?.zoom ?? LOCATE_ZOOM }));
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [returning, setMyFix, introduction]);

  const locate = async () => {
    if (locating) return;
    setLocating(true);
    try {
      let permission = await readPermission();
      if (permission.status !== "granted") {
        if (!permission.canAskAgain) {
          Alert.alert(
            "Location permission is off",
            "Allow location for IEM Connect in Settings to find yourself on the map.",
            [
              { text: "Not now", style: "cancel" },
              { text: "Open settings", onPress: () => void openSystemSettings() },
            ],
          );
          return;
        }
        permission = await requestPermission();
        if (permission.status !== "granted") return;
      }
      // Off in quick settings: Android's dialog. "No thanks" leaves the map as it is.
      if (!(await ensureLocationServices())) return;

      const centre = (at: LatLng) => {
        setMyFix(at);
        setView((current) => ({ center: at, zoom: Math.max(current?.zoom ?? LOCATE_ZOOM, LOCATE_ZOOM) }));
      };
      // At once: where the phone last was. It used to wait for a fresh fix
      // and the server's reply, and a slow fix spun the button for minutes.
      const quick = myFix ?? (await readLastKnownPosition());
      if (quick) {
        centre(quick);
        setLocating(false);
      }
      // Then a fresh fix, waited for no more than a few seconds.
      const fresh = await readFreshFix();
      if (!fresh) {
        if (!quick) Alert.alert("Couldn't find you", "Your location isn't available right now. Try again in a moment, ideally near a window.");
        return;
      }
      centre({ latitude: fresh.coords.latitude, longitude: fresh.coords.longitude });
      // Saving the area for discovery happens in the background; the map
      // doesn't wait for it.
      void sendFix(fresh, permission.accuracy)
        .then(() => load())
        .catch((error) => {
          const code = error?.response?.data?.code;
          if (code === "LOCATION_IMPLAUSIBLE" || code === "LOCATION_CHANGE_LIMIT") {
            Alert.alert("Your location wasn't updated", locationErrorMessage(error));
          }
        });
    } catch (error) {
      Alert.alert("Couldn't find you", locationErrorMessage(error));
    } finally {
      setLocating(false);
    }
  };

  /** The dot: the phone's own fix once located, otherwise the approximate area or campus. */
  const meAt = myFix ?? data?.me ?? null;

  /** What is drawn on the map; a change makes the next still moment worth a new picture. */
  const snapshotContent = useMemo(
    () =>
      JSON.stringify([
        data?.spots.map((spot) => [spot.id, spot.band]),
        data?.campuses.map((campus) => [campus.id, campus.band]),
        data?.areas.map((area) => [area.latitude, area.longitude, area.band]),
        meAt && [meAt.latitude.toFixed(5), meAt.longitude.toFixed(5)],
        selected?.item.id ?? null,
      ]),
    [data, meAt, selected],
  );

  /** Selects a marker and loads its previews; a newer tap makes older answers obsolete. */
  const select = async (next: Selection) => {
    const ticket = ++request.current;
    panelDismiss.setValue(0);
    if (selected?.kind !== next.kind || selected.item.id !== next.item.id) {
      setShowOtherPins(true);
    }
    setPinClosing(false);
    setSelected(next);
    setPreviews(null);
    setPreviewError("");
    if (!next.item.canList) return;
    if (demoData) {
      setPreviews(demoPeopleFor(next.item.id));
      return;
    }
    try {
      const response = await api.get("/search/explore", {
        params: { limit: 10, attributes: `${next.kind}:${next.item.id}` },
      });
      if (ticket !== request.current) return;
      setPreviews((response.data.data?.cards ?? []) as ExploreProfile[]);
    } catch {
      if (ticket === request.current) setPreviewError("Couldn't load people here. Try again.");
    }
  };

  const finishClose = useCallback(() => {
    request.current += 1;
    focusedSelection.current = "";
    closingPanel.current = false;
    panelMotion.stopAnimation();
    panelDismiss.stopAnimation();
    panelReveal.stopAnimation();
    panelMotion.setValue(0);
    // Keep the sheet below the screen until React removes it.
    panelDismiss.setValue((panelHeight || mapSize.height || 700) + 48);
    panelReveal.setValue(0);
    setSelected(null);
    setPinClosing(false);
    setShowOtherPins(false);
    setPanelHeight(0);
    setPreviews(null);
  }, [panelMotion, panelDismiss, panelReveal, panelHeight, mapSize.height]);

  const close = useCallback(() => {
    if (closingPanel.current) return;
    closingPanel.current = true;
    setPinClosing(true);
    request.current += 1;
    setShowOtherPins(true);
    panelReveal.stopAnimation();
    panelReveal.setValue(1);
    Animated.parallel([
      Animated.timing(panelMotion, {
        toValue: 0,
        duration: 230,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(panelDismiss, {
        toValue: (panelHeight || mapSize.height || 700) + 8,
        duration: 230,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) finishClose();
      else {
        closingPanel.current = false;
        setPinClosing(false);
        Animated.parallel([
          Animated.timing(panelMotion, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.timing(panelDismiss, { toValue: 0, duration: 180, useNativeDriver: true }),
        ]).start(() => setShowOtherPins(false));
      }
    });
  }, [panelMotion, panelDismiss, panelReveal, panelHeight, mapSize.height, finishClose]);

  const choose = (next: Selection) => {
    if (selected?.kind === next.kind && selected.item.id === next.item.id) {
      close();
      return;
    }
    void select(next);
  };

  useFocusEffect(useCallback(() => {
    if (!selected || profile) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => back.remove();
  }, [selected, profile, close]));

  const toggleDemo = () => {
    finishClose();
    if (demoAnchor) {
      setDemoAnchor(null);
      return;
    }
    const anchor = myFix ?? view?.center ?? liveData?.me ?? FALLBACK;
    setDemoAnchor(anchor);
    setView({ center: anchor, zoom: DEMO_ZOOM });
  };

  const seeAll = () => {
    if (!selected) return;
    if (demoData) {
      Alert.alert("Demo", "Demo profiles do not appear in Explore. Open a real map location to browse all profiles.");
      return;
    }
    navigation.navigate("Main", {
      screen: "Search",
      params: { mapFilter: { key: selected.kind, value: selected.item.id, label: selected.item.name } },
    });
  };

  const decide = async (card: ExploreProfile, action: "like" | "pass", removeFromPreviews = true): Promise<boolean> => {
    if (removeFromPreviews) {
      setProfile(null);
      setPreviews((current) => current?.filter((item) => item.id !== card.id) ?? current);
    }
    if (demoData) {
      return true;
    }
    try {
      if (card.impressionId) await api.post("/discover/visible", { impressionId: card.impressionId }).catch(() => undefined);
      const response = await api.post("/discover/swipe", { targetId: card.id, action });
      if (response.data.data?.matchCreated) {
        navigation.navigate('MatchCelebration', {name: card.name, userId: card.id, photo: card.primaryPhoto ?? card.photos[0], matchId: response.data.data.matchId});
      }
      return true;
    } catch (cause: any) {
      Alert.alert("Couldn't save that", cause?.response?.data?.message ?? "Check your connection and try again.");
      return false;
    }
  };

  const explain = () =>
    Alert.alert(
      "About the map",
      "Campuses count people whose profile lists them as their campus; places count people who added the place to their profile - it means they like it, never that they are there. " +
        "In distance mode, shaded areas show roughly how many people are around you, updated hourly, and never who. " +
        "Nothing on this map shows a person's location. You can leave it in Location settings.",
    );

  const panelTitle = selected?.kind === "campus" ? "People from this campus" : "People who like this place";
  const legendTitle = demoData ? "Demo map" : "Exact location hidden";
  const legendSummary = demoData ? "Sample profiles" : data?.mode === "distance" ? "Approximate area" : "Campus shown";

  return (
    <GestureHandlerRootView style={styles.page}>
      <View style={styles.page} pointerEvents={introduction === 'done' ? 'auto' : 'none'} accessibilityElementsHidden={introduction !== 'done'} importantForAccessibility={introduction === 'done' ? 'auto' : 'no-hide-descendants'}>
      <StatusBar hidden={false} barStyle="light-content" backgroundColor={colors.background} translucent />
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={selected ? "Close selected location" : "Go back"} onPress={() => selected ? close() : navigation.goBack()} style={styles.icon}>
          <Ionicons name="chevron-back" size={24} color={colors.text.primary} />
        </Pressable>
        <Text style={styles.title}>Map</Text>
        {__DEV__ && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={demoData ? "Hide demo" : "Show demo"}
            onPress={toggleDemo}
            style={[styles.demoToggle, demoData && styles.demoToggleOn]}
          >
            <Ionicons name="flask-outline" size={15} color={demoData ? "#FFFFFF" : colors.primaryLight} />
            <Text style={[styles.demoToggleText, demoData && styles.demoToggleTextOn]}>Demo</Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="About the map" onPress={explain} style={styles.icon}>
          <Ionicons name="information-circle-outline" size={24} color={colors.text.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Location settings"
          onPress={() => navigation.navigate("LocationSettings")}
          style={styles.icon}
        >
          <Ionicons name="settings-outline" size={22} color={colors.text.primary} />
        </Pressable>
      </View>
      {/* Reminder 26 (GOOGLE_SIGNUP_PLAN.md 4): the glow counts verified students only. */}
      {introduction === 'done' && <UnverifiedNudge art="map" icon="map-outline" text="You're not on the map yet. Verify your college to appear." dismissKey="map" />}

      {!data || !view ? (
        error ? (
          <View style={styles.center}><Text style={styles.message}>{error}</Text></View>
        ) : <MapLoadingArtwork />
      ) : data.state === "setup_required" ? (
        <View style={styles.center}>
          {data.hiddenHere ? (
            <>
              <Ionicons name="eye-off-outline" size={30} color={MAP_PURPLE} />
              <Text style={styles.message}>
                You're hidden at a place you chose, so nobody sees you there - and the map, which is measured
                from where you are, pauses too. It comes back when you leave, or when you turn off "Hide me
                while I'm here" in Location settings.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate("LocationSettings")}
                style={styles.recenter}
              >
                <Ionicons name="settings-outline" size={18} color="#fff" />
              </Pressable>
            </>
          ) : (
            <Text style={styles.message}>
              Finish setting up discovery to see the map. In distance mode, it needs a location from the last two weeks.
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.body}>
          <View
            style={styles.mapFrame}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setMapSize((current) => current.width === width && current.height === height ? current : { width, height });
            }}
          >
          {native ? (() => {
            // Pixel positions only decide grouping; the markers themselves are
            // pinned to coordinates and move with the map natively.
            const groups = groupSpots(selected ? selected.kind === "place" ? [selected.item] : [] : data.spots, (point) => project(point, view.zoom));
            const campusStacks = new Map<string, Campus[]>();
            for (const campus of data.campuses) {
              const key = `${campus.latitude}:${campus.longitude}`;
              campusStacks.set(key, [...(campusStacks.get(key) ?? []), campus]);
            }
            return (
              <MapplsMap
                center={view.center}
                zoom={view.zoom}
                locked={!!selected}
                initialHeading={initialHeading}
                onHeadingChange={onHeadingChange}
                placeholder={placeholder}
                // Demo pins must never become the picture the next visit opens with.
                onSnapshot={demoData || selected ? undefined : rememberSnapshot}
                contentKey={snapshotContent}
                onChange={(next) => setView(next)}
                areas={data.areas
                  .filter((area) => AREA_WEIGHT[area.band] > 0)
                  .map<MapArea>((area) => ({
                    key: `${area.latitude}:${area.longitude}`,
                    latitude: area.latitude,
                    longitude: area.longitude,
                    size: area.size,
                    weight: AREA_WEIGHT[area.band],
                  }))}
                onError={(message) => {
                  console.warn("[Map] Mappls map unavailable, using tiles:", message);
                  saved.mapplsFailed = true;
                  setNative(false);
                }}
              >
                {/* Markers are pictures drawn into the map, so a marker's id
                    carries everything that changes its look: a new id draws it again. */}
                {groups.map((group) => {
                  if (group.members.length > 1) {
                    const id = `group:${group.members.map((m) => m.spot.id).join("|")}`;
                    return (
                      <MapMarker
                        key={id}
                        id={id}
                        coordinate={group}
                        onPress={selected ? undefined : () => setView({ center: group, zoom: Math.min(maxZoom, view.zoom + 2) })}
                      >
                        <GroupBubble count={group.members.length} onPress={() => undefined} />
                      </MapMarker>
                    );
                  }
                  const spot = group.members[0].spot;
                  const active = !pinClosing && selected?.kind === "place" && selected.item.id === spot.id;
                  const showName = view.zoom >= 13;
                  const id = `place:${spot.id}:${active ? 1 : 0}${showName ? 1 : 0}`;
                  return (
                    <MapMarker
                      key={id}
                      id={id}
                      coordinate={spot}
                      anchor={{ x: 0.5, y: 1 }}
                      onPress={() => choose({ kind: "place", item: spot })}
                    >
                      <SpotPin spot={spot} active={active} showName={showName} onPress={() => undefined} />
                    </MapMarker>
                  );
                })}
                {/* Campuses of one institution often share an anchor: each is
                    its own marker (so a tap knows which), stepped down the screen. */}
                {[...campusStacks.values()].flatMap((stack) =>
                  stack.map((campus, index) => {
                    if (selected && (selected.kind !== "campus" || selected.item.id !== campus.id)) return null;
                    const active = !pinClosing && selected?.kind === "campus" && selected.item.id === campus.id;
                    const p = project(campus, view.zoom);
                    const at = index === 0 ? campus : unproject(p.x, p.y + index * CAMPUS_STEP_PX, view.zoom);
                    const id = `campus:${campus.id}:${active ? 1 : 0}`;
                    return (
                      <MapMarker
                        key={id}
                        id={id}
                        coordinate={at}
                        anchor={{ x: 0.5, y: 1 }}
                        onPress={() => choose({ kind: "campus", item: campus })}
                      >
                        <CampusPin campus={campus} active={active} onPress={() => undefined} />
                      </MapMarker>
                    );
                  }),
                )}
                {!selected && meAt ? (
                  <MapMarker key="me-location-icon" id="me-location-icon" coordinate={meAt}>
                    <MyLocationMarker />
                  </MapMarker>
                ) : null}
              </MapplsMap>
            );
          })() : (
          <TileMap
            center={view.center}
            zoom={view.zoom}
            locked={!!selected}
            onChange={(update) => setView((current) => (current ? { ...current, ...update } : current))}
          >
            {(toScreen, zoom) => {
              const otherSpots = selected ? showOtherPins ? data.spots.filter((spot) => spot.id !== selected.item.id) : [] : data.spots;
              const groups = groupSpots(otherSpots, toScreen);
              if (selected?.kind === "place") groups.push(...groupSpots([selected.item], toScreen));
              return (
                <>
                  {data.areas.map((area) => {
                    const a = toScreen({ latitude: area.latitude + area.size / 2, longitude: area.longitude - area.size / 2 });
                    const b = toScreen({ latitude: area.latitude - area.size / 2, longitude: area.longitude + area.size / 2 });
                    return (
                      <View
                        key={`${area.latitude}:${area.longitude}`}
                        pointerEvents="none"
                        style={[
                          styles.area,
                          {
                            left: a.x,
                            top: a.y,
                            width: b.x - a.x,
                            height: b.y - a.y,
                            backgroundColor: `rgba(112,82,199,${AREA_OPACITY[area.band]})`,
                          },
                        ]}
                      >
                        {b.x - a.x > 44 && <Text style={styles.areaText}>{BAND_TEXT[area.band]}</Text>}
                      </View>
                    );
                  })}

                  {groups.map((group) => {
                    if (group.members.length > 1) {
                      return (
                        <Animated.View
                          key={group.members.map((m) => m.spot.id).join("|")}
                          style={[styles.placed, { left: group.x - 17, top: group.y - 17, opacity: selected ? otherPinOpacity : 1 }]}
                        >
                          <GroupBubble count={group.members.length} onPress={selected ? () => undefined : () => setView({ center: group, zoom: Math.min(maxZoom, zoom + 2) })} />
                        </Animated.View>
                      );
                    }
                    const { spot, p } = group.members[0];
                    const active = selected?.kind === "place" && selected.item.id === spot.id;
                    return (
                      <Animated.View
                        key={spot.id}
                        style={[styles.placed, styles.placedPin, {
                          left: p.x - PIN_ANCHOR_WIDTH / 2, top: p.y - PIN_ANCHOR_HEIGHT,
                          opacity: selected && !active ? otherPinOpacity : 1,
                          transform: [{ scale: active ? selectedPinScale : 1 }],
                        }]}
                      >
                        <SpotPin spot={spot} active={active} showName={zoom >= 13} onPress={active || !selected ? () => choose({ kind: "place", item: spot }) : () => undefined} />
                      </Animated.View>
                    );
                  })}

                  {/* Campuses of one institution often share an anchor; stack them. */}
                  {data.campuses.map((campus, index) => {
                    if (selected && !showOtherPins && (selected.kind !== "campus" || selected.item.id !== campus.id)) return null;
                    const p = toScreen(campus);
                    const before = data.campuses
                      .slice(0, index)
                      .filter((other) => other.latitude === campus.latitude && other.longitude === campus.longitude).length;
                    const active = selected?.kind === "campus" && selected.item.id === campus.id;
                    return (
                      <Animated.View
                        key={campus.id}
                        style={[styles.placed, styles.placedPin, {
                          left: p.x - PIN_ANCHOR_WIDTH / 2, top: p.y + before * CAMPUS_STEP_PX - PIN_ANCHOR_HEIGHT,
                          opacity: selected && !active ? otherPinOpacity : 1,
                          transform: [{ scale: active ? selectedPinScale : 1 }],
                        }]}
                      >
                        <CampusPin campus={campus} active={active} onPress={active || !selected ? () => choose({ kind: "campus", item: campus }) : () => undefined} />
                      </Animated.View>
                    );
                  })}

                  {(!selected || showOtherPins) && meAt && (() => {
                    const p = toScreen(meAt);
                    return (
                      <Animated.View style={[styles.placed, { left: p.x - 21, top: p.y - 21, opacity: selected ? otherPinOpacity : 1 }]}>
                        <MyLocationMarker />
                      </Animated.View>
                    );
                  })()}
                </>
              );
            }}
          </TileMap>
          )}
          </View>

          <View
            pointerEvents={selected ? "none" : "auto"}
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              setLegendHeight((current) => Math.abs(current - height) < 1 ? current : height);
            }}
            style={[styles.legend, { paddingBottom: insets.bottom + 10 }, selected && styles.legendHidden]}
          >
            <Ionicons name={demoData ? "flask-outline" : "shield-checkmark-outline"} size={17} color={colors.primaryLight} />
            <Text style={styles.legendTitle} numberOfLines={1}>{legendTitle}</Text>
            <View style={styles.legendDot} />
            <Text style={styles.legendSummary} numberOfLines={1}>{legendSummary}</Text>
          </View>
          {!selected && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show my location"
              onPress={() => void locate()}
              hitSlop={4}
              style={[styles.recenter, { bottom: legendHeight + 12 }]}
            >
              {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="locate" size={20} color={colors.primary} />}
            </Pressable>
          )}
          {selected && (
            <Animated.View
              onLayout={(event) => {
                const height = event.nativeEvent.layout.height;
                setPanelHeight((current) => Math.abs(current - height) < 1 ? current : height);
              }}
              style={[
                styles.panel,
                { paddingBottom: insets.bottom + 12 },
                { opacity: panelReveal, transform: [{ translateY: Animated.add(panelMotion.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }), panelDismiss) }] },
              ]}
            >
              <View style={styles.panelHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.panelName} numberOfLines={1}>{selected.item.name}</Text>
                  <Text style={styles.panelMeta} numberOfLines={1}>
                    {selected.kind === "campus"
                      ? `Campus · ${institutionName(selected.item.institution)}`
                      : [selected.item.category, selected.item.subtitle].filter(Boolean).join(" · ") || "Place"}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={close}
                  style={({ pressed }) => [styles.icon, styles.panelClose, pressed && styles.panelClosePressed]}
                >
                  <Ionicons name="close" size={22} color={colors.text.primary} />
                </Pressable>
              </View>
              <View style={styles.panelRow}>
                <Text style={styles.panelTitle}>{panelTitle}</Text>
                <Text style={styles.panelBand}>{BAND_TEXT[selected.item.band]}</Text>
              </View>
              {!selected.item.canList ? (
                <Text style={styles.panelNote}>
                  {selected.item.band === "none"
                    ? "No one here matches your preferences yet."
                    : "Fewer than 10 people here match your preferences, so they aren't shown. That keeps a small group from being picked out."}
                </Text>
              ) : previewError ? (
                <Pressable onPress={() => void select(selected)}>
                  <Text style={styles.panelNote}>{previewError} Tap to retry.</Text>
                </Pressable>
              ) : !previews ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: 18 }} />
              ) : previews.length === 0 ? (
                <Text style={styles.panelNote}>You've seen everyone here.</Text>
              ) : (
                <LocationProfileCarousel
                  key={`${selected.kind}:${selected.item.id}`}
                  profiles={previews}
                  locationKind={selected.kind}
                  onOpen={(opened, cardOrigin) => {
                    setOrigin(cardOrigin);
                    setProfile(opened);
                  }}
                  onLike={(card) => decide(card, "like", false)}
                  onSeeAll={seeAll}
                />
              )}
            </Animated.View>
          )}
        </View>
      )}

      {profile && (
        <ProfileDetailModal
          user={profile}
          initialPhotoUri={profile.primaryPhoto ?? undefined}
          origin={origin}
          // The carousel card's photo flies into the profile and back by
          // transforms alone (ProfileDetailModal, PHOTO_TRANSITION).
          transition="photo"
          isVisible
          onClose={() => setProfile(null)}
          onLike={() => { void decide(profile, "like"); }}
          onPass={() => { void decide(profile, "pass"); }}
          onBlocked={() => setPreviews((current) => current?.filter((item) => item.id !== profile.id) ?? current)}
        />
      )}
      </View>
      {introduction === 'checking' && <MapIntroductionChecking/>}
      {introduction === 'intro' && <MapIntroduction onComplete={finishIntroduction} onClose={() => navigation.goBack()}/>}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  mapFrame: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 4,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text.primary, fontSize: 22, fontWeight: "700", flex: 1, marginLeft: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 },
  message: { color: colors.text.secondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  area: {
    position: "absolute",
    borderWidth: 1,
    borderColor: "rgba(112,82,199,0.42)",
    alignItems: "center",
    justifyContent: "center",
  },
  areaText: { color: MAP_PURPLE_DARK, fontSize: 12, fontWeight: "800" },
  /** On the tile map, overlays are laid out by hand at `toScreen` positions. */
  placed: { position: "absolute" },
  placedPin: { width: PIN_ANCHOR_WIDTH },
  // The bottom of this frame is the map coordinate in both map renderers.
  pinAnchor: {
    height: PIN_ANCHOR_HEIGHT,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  pinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 9,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
  campusTail: { borderTopColor: CAMPUS_TEAL },
  spotTail: { borderTopColor: PLACE_ORANGE },
  pin: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    maxWidth: 230,
  },
  // A white outline, not a shadow, keeps pins apart from the glow: pins are
  // drawn into the map as pictures, where shadows don't show.
  campusPin: {
    backgroundColor: CAMPUS_TEAL,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    shadowColor: CAMPUS_TEAL,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  spotPin: {
    backgroundColor: PLACE_ORANGE,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    shadowColor: PLACE_ORANGE,
    shadowOpacity: 0.24,
    shadowRadius: 6,
    elevation: 4,
  },
  // Keep the same pill radius when selected; increase its size without a transform.
  pinActive: { borderWidth: 3, borderColor: "#FFFFFF", paddingHorizontal: 15, paddingVertical: 9, minHeight: 44, elevation: 9 },
  pinText: { color: "#fff", fontSize: 12, fontWeight: "600", flexShrink: 1 },
  pinTextActive: { fontSize: 15, fontWeight: "800" },
  pinBand: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  pinBandActive: { fontSize: 13 },
  group: {
    width: 34,
    height: 34,
    borderRadius: 17,
    // A group is places, so it wears the places' orange.
    backgroundColor: PLACE_ORANGE,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: PLACE_ORANGE,
    shadowOpacity: 0.28,
    shadowRadius: 7,
    elevation: 5,
  },
  groupText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  me: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(76,139,245,0.20)",
    alignItems: "center",
    justifyContent: "center",
  },
  meBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#3979E9",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legendHidden: { opacity: 0 },
  legendTitle: { color: colors.text.primary, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  legendDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary },
  legendSummary: { color: "#B8B2B9", fontSize: 12, flexShrink: 1 },
  recenter: { position: "absolute", right: 13, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.96)", borderWidth: 1, borderColor: "rgba(101,69,184,0.18)", alignItems: "center", justifyContent: "center" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 16,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: colors.background,
    gap: 4,
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 10,
  },
  panelHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18 },
  panelClose: { borderRadius: 20, backgroundColor: "#2A2729" },
  panelClosePressed: { backgroundColor: "#3A3538" },
  panelName: { color: colors.text.primary, fontSize: 20, fontWeight: "800" },
  panelMeta: { color: "#B2ADB4", fontSize: 12, marginTop: 3 },
  panelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingHorizontal: 18 },
  panelTitle: { color: colors.text.primary, fontSize: 14, fontWeight: "700" },
  panelBand: { color: "#FFADB4", fontSize: 13, fontWeight: "800", backgroundColor: "#38262B", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  panelNote: { color: "#B8B2B9", fontSize: 13, lineHeight: 19, marginVertical: 10, marginHorizontal: 18 },
  demoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(255,126,130,0.45)",
    marginRight: 2,
  },
  demoToggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  demoToggleText: { color: colors.primaryLight, fontSize: 12, fontWeight: "700" },
  demoToggleTextOn: { color: "#FFFFFF" },
});

/** The demo opens a little wider than usual, so its pins fit on one screen. */
const DEMO_ZOOM = 13.5;

/**
 * Sample map data around a point, showing every state the map can be in:
 * campuses busy, quiet and under the floor, two campuses sharing an anchor,
 * places at each band (including one no one chose), three cafés close enough
 * to merge into a group, and shaded areas at each band (zoom out to see the
 * grid of ~6 km squares).
 */
function buildDemoMap(at: LatLng): MapData {
  const near = (dLat: number, dLng: number) => ({ latitude: at.latitude + dLat, longitude: at.longitude + dLng });
  const counted = (id: string, name: string, dLat: number, dLng: number, band: Band) => ({
    id: `demo-${id}`,
    name,
    ...near(dLat, dLng),
    band,
    canList: band !== "none" && band !== "few",
  });
  const campuses: Campus[] = [
    { ...counted("gurukul", "Gurukul", 0.004, -0.006, "50+"), institution: "IEM-KOLKATA" },
    { ...counted("management", "Management House", 0.0028, -0.0022, "few"), institution: "IEM-KOLKATA" },
    { ...counted("ashram", "Ashram", -0.0001, -0.01, "25+"), institution: "IEM-KOLKATA" },
    { ...counted("iem-newtown", "IEM New Town", -0.0104, 0.0503, "25+"), institution: "IEM-KOLKATA" },
    { ...counted("uem", "UEM New Town", -0.0104, 0.0503, "100+"), institution: "UEM-KOLKATA" },
  ];
  const spot = (id: string, name: string, dLat: number, dLng: number, band: Band, category: string, subtitle: string | null) => ({
    ...counted(id, name, dLat, dLng, band),
    category,
    subtitle,
  });
  const spots: Spot[] = [
    spot("canteen", "Gurukul Canteen", 0.0062, -0.0035, "10+", "Canteen", "Gurukul"),
    spot("library", "Central Library", 0.0015, -0.0095, "25+", "Library", "Gurukul"),
    spot("chai", "Chai Point", -0.01, -0.002, "few", "Cafe", "Sector V"),
    // Three cafés a street apart: one group bubble until you zoom in.
    spot("starbucks", "Starbucks", -0.003, 0.013, "25+", "Cafe", "Sector V"),
    spot("ccd", "Cafe Coffee Day", -0.0042, 0.0138, "10+", "Cafe", "Sector V"),
    spot("barista", "Barista", -0.0024, 0.0146, "few", "Cafe", "Sector V"),
    spot("mall", "City Centre Mall", 0.012, 0.011, "100+", "Mall", "Salt Lake"),
    spot("park", "Central Park", -0.011, -0.012, "none", "Park", "Salt Lake"),
  ];
  const tile = 0.06;
  const areaBands: [number, number, Band][] = [
    [0, 0, "50+"], [1, 0, "25+"], [0, 1, "10+"], [1, 1, "100+"], [-1, 0, "10+"],
    [0, -1, "25+"], [1, -1, "10+"], [-1, 1, "25+"],
  ];
  const areas = areaBands.map(([i, j, band]) => ({ ...near(i * tile, j * tile), size: tile, band }));
  return { state: "ok", mode: "distance", me: { ...at, kind: "cell" }, campuses, spots, areas };
}

/** A few of the app's demo profiles for a pin, a different few for each. */
function demoPeopleFor(id: string): ExploreProfile[] {
  const start = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % demoProfiles.length;
  return Array.from({ length: Math.min(5, demoProfiles.length) }, (_, index) => ({
    ...demoProfiles[(start + index) % demoProfiles.length],
  }));
}
