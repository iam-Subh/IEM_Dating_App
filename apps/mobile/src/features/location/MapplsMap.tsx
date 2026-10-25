import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { LatLng } from "./TileMap";
import { MIN_ZOOM, project, unproject } from "./TileMap";
import { MapLoadingArtwork } from "./MapLoadingArtwork";

/**
 * The Mappls (MapmyIndia) vector map, used when the installed build has it.
 *
 * The SDK is native: a build made before it was added has no Mappls module,
 * and loading the library there logs an error on import. So availability is
 * checked first and the library is required only when it can work; otherwise
 * the screen keeps the image-tile map (TileMap.tsx).
 *
 * Authorisation needs no code: the SDK's Gradle step bakes in the console's
 * `.a.olf`/`.a.conf` files (plugins/withMapplsConfig.js). If they are wrong,
 * the map reports an error and the screen falls back to TileMap.
 */
export const mapplsAvailable =
  TurboModuleRegistry.get("RCTMGLModule") != null || NativeModules.MGLModule != null;

/**
 * The parts of the SDK used here. Typed locally: the package ships its
 * TypeScript source, which does not compile against this React Native's
 * types, and importing its types would pull that source into our typecheck.
 */
type MapplsLib = {
  MapView: React.ComponentType<any>;
  Camera: React.ComponentType<any>;
  ShapeSource: React.ComponentType<any>;
  HeatmapLayer: React.ComponentType<any>;
  PointAnnotation: React.ComponentType<any>;
  Logger: { setLogCallback: (callback: (log: { message: string; level: string; tag?: string }) => boolean) => void };
  setDeveloperShowingSplash: (showing: boolean) => void;
};
let lib: MapplsLib | null = null;
function mappls(): MapplsLib {
  if (!lib) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require("mappls-map-react-native") as MapplsLib;
    // Two kinds of SDK "error" are not failures, and are dropped; everything
    // else goes through to the SDK's own logging.
    // - Loading a map, the SDK sets every optional feature (traffic layers,
    //   logo position) even when off, and each outside our plan logs
    //   "Method not Provisioned".
    // - A tile the server declines ("Failed to load tile ... HTTP status code
    //   417", seen for the sea background at some zooms) leaves that one tile
    //   out; the map draws the rest and retries as you move.
    lib.Logger.setLogCallback((log) => /Method not Provisioned|Failed to load tile/i.test(log.message));
    // The SDK covers a starting map with its own branded splash; the map
    // shows ours instead (MapLoading below).
    lib.setDeveloperShowingSplash(true);
  }
  return lib;
}

/**
 * The screen counts zoom in 256 px tiles, as TileMap does; Mappls, like every
 * GL map, counts in 512 px tiles, one level apart. Converting here keeps a
 * zoom meaning the same view on both maps, and the screen's grouping maths
 * (which projects at 256 px) correct.
 */
const GL_ZOOM_OFFSET = 1;

/**
 * How far in the Mappls map zooms, in the screen's units: street and building
 * level. The tile map stops at MAX_ZOOM because its image tiles do; vector
 * tiles keep their detail further in.
 */
export const MAPPLS_MAX_ZOOM = 20;


/** A shaded square, `size` degrees across, centred on its coordinate. */
/** An area around you: `size` degrees across, `weight` 0-1 from its band. */
export type MapArea = LatLng & { key: string; size: number; weight: number };

type Props = {
  center: LatLng;
  zoom: number;
  /** A selected pin keeps the map still until its panel closes. */
  locked?: boolean;
  onChange: (update: { center: LatLng; zoom: number }) => void;
  areas: MapArea[];
  /** Called when Mappls refuses the map, e.g. bad credentials. */
  onError: (message: string) => void;
  /** MapMarker elements. */
  children: React.ReactNode;
  /** Degrees from north to open at, e.g. where the map was left. */
  initialHeading?: number;
  onHeadingChange?: (heading: number) => void;
  /**
   * A picture of this same view (mapSession), shown instead of the loading
   * cover until the map has drawn. Used only if it is the map's own size.
   */
  placeholder?: { uri: string; width: number; height: number } | null;
  /** Receives a picture of the map each time it has settled with something new on it. */
  onSnapshot?: (shot: {
    uri: string;
    width: number;
    height: number;
    camera: { center: LatLng; zoom: number; heading: number };
  }) => void;
  /** Changes whenever what is drawn on the map changes (pins, areas), so a new picture is due. */
  contentKey?: string;
};

/** The map must sit still this long, fully drawn, before a picture is taken. */
const SNAPSHOT_IDLE_MS = 700;
/** Zoomed in this far (screen units), the areas glow has faded out, and its legend goes too. */
const AREA_GLOW_HIDDEN_ZOOM = 16.5;
/** The legend's colours: the glow's ramp, solid. */
const GLOW_RAMP = ["#C4B5FD", "#A78BFA", "#8B5CF6", "#D946A0", "#F65F7C"];

/** Back at north, the north button stays this long, pointing north, before fading. */
const COMPASS_LINGER_MS = 700;

export function MapplsMap({
  center,
  zoom,
  locked = false,
  onChange,
  areas,
  onError,
  children,
  initialHeading = 0,
  onHeadingChange,
  placeholder,
  onSnapshot,
  contentKey = "",
}: Props) {
  const { MapView, Camera, ShapeSource, HeatmapLayer } = mappls();

  /**
   * Areas around you, as a soft glow rather than boxes: one point at the
   * centre of each ~6 km area, weighted by its band, blurred by the map into
   * clouds that blend into each other and the streets. It says nothing finer
   * than the boxes did - the same areas, the same bands, only drawn softly.
   */
  const shape = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: areas.map((area) => ({
        type: "Feature" as const,
        id: area.key,
        properties: { weight: area.weight },
        geometry: { type: "Point" as const, coordinates: [area.longitude, area.latitude] },
      })),
    }),
    [areas],
  );
  // Each glow covers about its area at every zoom: its radius in pixels
  // doubles with each zoom level, like the ground it stands for.
  const areaDegrees = areas[0]?.size ?? 0.06;
  const areaRadiusAtZoom10 = (areaDegrees * 111_320 * 0.65) / (78_271.5 / 2 ** 10);

  /**
   * The camera is driven, never controlled. A controlled camera (props bound
   * to `center`/`zoom`) was told, after every gesture, to ease to where the
   * gesture had just reported - while the fling was still slowing down - so
   * the map kept moving after the fingers lifted.
   *
   * Now a gesture only reports, and `shown` remembers where the map is; the
   * camera is moved only when `center`/`zoom` ask for somewhere else (zoom
   * buttons, a group, "locate me").
   */
  const cameraRef = useRef<any>(null);
  const shown = useRef({ center, zoom });

  /**
   * Moves the camera on purpose. The SDK hands the target over as a stored
   * "stop" that the native camera keeps, and may apply again later - after a
   * pinch, that pulled the map back to the last button or locate target. So
   * once the move has settled, the stored stop is replaced with an empty one,
   * which means "stay where you are".
   */
  const clearStopWhenSettled = useRef(false);
  const moveCamera = useCallback((stop: Record<string, unknown>) => {
    clearStopWhenSettled.current = true;
    cameraRef.current?.setCamera(stop);
  }, []);

  /**
   * The closest the map really zooms. The Mappls style can stop below
   * MAPPLS_MAX_ZOOM, and says so only by stopping: a zoom-in that settles
   * short of its target has found the ceiling. A later zoom past it (a pinch
   * after an interrupted move) lifts it again.
   */
  const [ceiling, setCeiling] = useState(MAPPLS_MAX_ZOOM);
  const zoomRequest = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    const at = shown.current;
    const same =
      Math.abs(at.zoom - zoom) < 0.01 &&
      Math.abs(at.center.latitude - center.latitude) < 1e-6 &&
      Math.abs(at.center.longitude - center.longitude) < 1e-6;
    if (same) return;
    zoomRequest.current = { from: at.zoom, to: zoom };
    shown.current = { center, zoom };
    moveCamera({
      centerCoordinate: [center.longitude, center.latitude],
      zoomLevel: zoom - GL_ZOOM_OFFSET,
      animationDuration: 350,
      animationMode: "easeTo",
    });
  }, [center, zoom, moveCamera]);

  const regionChanged = useCallback(
    (feature: { geometry: { coordinates: number[] }; properties: { zoomLevel: number } }) => {
      const [longitude, latitude] = feature.geometry.coordinates;
      const next = { center: { latitude, longitude }, zoom: feature.properties.zoomLevel + GL_ZOOM_OFFSET };
      shown.current = next;
      const request = zoomRequest.current;
      zoomRequest.current = null;
      if (request && request.to > request.from + 0.05 && next.zoom < request.to - 0.05 && next.zoom > request.from - 0.05) {
        setCeiling(next.zoom);
      } else {
        setCeiling((current) => (next.zoom > current + 0.05 ? MAPPLS_MAX_ZOOM : current));
      }
      if (clearStopWhenSettled.current) {
        // The map has just come to rest: a stop with nothing in it applies
        // as "here", instantly.
        clearStopWhenSettled.current = false;
        cameraRef.current?.setCamera({ animationDuration: 0, animationMode: "moveTo" });
      }
      onChange(next);
    },
    [onChange],
  );

  const ceilingRef = useRef(ceiling);
  ceilingRef.current = ceiling;
  const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(ceilingRef.current, value));
  const atCeiling = zoom >= ceiling - 0.05;
  const atFloor = zoom <= MIN_ZOOM + 0.05;

  /** Which way a double tap zooms: in, until the closest zoom, then out, until the farthest. */
  const doubleTapDirection = useRef<1 | -1>(1);

  const zoomBy = (step: 1 | -1) => {
    // Using the buttons starts double tap over, zooming in.
    doubleTapDirection.current = 1;
    onChange({ center: shown.current.center, zoom: clampZoom(Math.round(shown.current.zoom) + step) });
  };

  /**
   * Double tap, handled here rather than by the map: the map's own double tap
   * only zooms in, and does nothing at the closest zoom. The native one is
   * switched off (`doubleTapEnabled`, patches/mappls-map-react-native); if
   * Mappls refuses that switch, both run, and the camera below still ends on
   * this target.
   */
  const mapRef = useRef<any>(null);
  const doubleTap = useCallback(
    async (x: number, y: number) => {
      const at = shown.current;
      if (doubleTapDirection.current === 1 && at.zoom >= ceilingRef.current - 0.05) {
        doubleTapDirection.current = -1;
      } else if (doubleTapDirection.current === -1 && at.zoom <= MIN_ZOOM + 0.05) {
        doubleTapDirection.current = 1;
      }
      const nextZoom = clampZoom(at.zoom + doubleTapDirection.current);
      if (__DEV__) console.log("[map] double tap", JSON.stringify({ from: at.zoom, to: nextZoom, ceiling: ceilingRef.current }));
      // Keep the tapped point under the finger: its distance from the centre
      // scales with the zoom change. Done on the flat world, so a rotated map
      // needs nothing extra.
      let anchor = at.center;
      try {
        const [longitude, latitude] = await mapRef.current.getCoordinateFromView([x, y]);
        anchor = { latitude, longitude };
      } catch {
        // Zoom about the centre instead.
      }
      const scale = 2 ** (at.zoom - nextZoom);
      const c = project(at.center, 0);
      const t = project(anchor, 0);
      const next = { center: unproject(t.x + (c.x - t.x) * scale, t.y + (c.y - t.y) * scale, 0), zoom: nextZoom };
      onChange(next);
    },
    [onChange],
  );
  /**
   * Our loading screen until the map has drawn, instead of the SDK's splash
   * and the black of an empty map surface.
   */
  const [drawn, setDrawn] = useState(false);
  /** The map has drawn a whole frame; before that, a snapshot would be of nothing. */
  const fullyDrawn = useRef(false);
  const cover = useRef(new Animated.Value(1)).current;
  const markDrawn = useCallback(() => {
    fullyDrawn.current = true;
    setDrawn(true);
  }, []);
  // Once faded, the cover goes altogether: its artwork loops forever, and
  // left mounted under opacity 0 it redrew the screen every frame, idle or
  // not (measured), taking time from every swipe on the map screen.
  const [coverGone, setCoverGone] = useState(false);
  useEffect(() => {
    if (!drawn) return;
    Animated.timing(cover, { toValue: 0, duration: 220, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setCoverGone(true);
    });
  }, [cover, drawn]);
  useEffect(() => {
    // A map that never reports (offline, say) still shows what it has.
    const safety = setTimeout(() => setDrawn(true), 8000);
    return () => clearTimeout(safety);
  }, []);

  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [placeholderFailed, setPlaceholderFailed] = useState(false);
  // The picture only lines up at the size it was taken; a split screen or a
  // different layout falls back to the loading cover.
  const usePlaceholder =
    !!placeholder &&
    !placeholderFailed &&
    (!size || (Math.abs(size.width - placeholder.width) < 2 && Math.abs(size.height - placeholder.height) < 2));

  /**
   * The north button. It follows the map's rotation live, every frame while
   * the map turns - it used to hear only once a gesture ended, so it appeared
   * late. The needle turns through an Animated value, so none of this
   * re-renders the map. Turned back to north (a tap, or by hand), it shows
   * north for a moment, then fades away.
   */
  const headingRef = useRef(initialHeading);
  const needle = useRef(new Animated.Value(initialHeading)).current;
  const needleRotation = needle.interpolate({ inputRange: [-360, 360], outputRange: ["360deg", "-360deg"] });
  const isTurned = (value: number) => {
    const fromNorth = ((value % 360) + 360) % 360;
    return Math.min(fromNorth, 360 - fromNorth) > 1;
  };
  const [compassShown, setCompassShown] = useState(isTurned(initialHeading));
  const compassShownRef = useRef(compassShown);
  const compassOpacity = useRef(new Animated.Value(compassShown ? 1 : 0)).current;
  const compassHide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const followHeading = useCallback(
    (value: number) => {
      headingRef.current = value;
      needle.setValue(value);
      if (isTurned(value)) {
        clearTimeout(compassHide.current);
        compassHide.current = undefined;
        if (!compassShownRef.current) {
          compassShownRef.current = true;
          setCompassShown(true);
        }
        compassOpacity.stopAnimation();
        compassOpacity.setValue(1);
      } else if (compassShownRef.current && compassHide.current === undefined) {
        // Back at north: point north for a moment, then fade away.
        compassHide.current = setTimeout(() => {
          Animated.timing(compassOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(({ finished }) => {
            compassHide.current = undefined;
            if (finished && !isTurned(headingRef.current)) {
              compassShownRef.current = false;
              setCompassShown(false);
            }
          });
        }, COMPASS_LINGER_MS);
      }
    },
    [compassOpacity, needle],
  );
  useEffect(() => () => clearTimeout(compassHide.current), []);

  const regionChangedWithHeading = useCallback(
    (feature: { geometry: { coordinates: number[] }; properties: { zoomLevel: number; heading?: number } }) => {
      const next = feature.properties.heading ?? 0;
      followHeading(next);
      onHeadingChange?.(next);
      regionChanged(feature);
    },
    [followHeading, onHeadingChange, regionChanged],
  );
  const regionChanging = useCallback(
    (feature: { properties: { heading?: number } }) => followHeading(feature.properties.heading ?? 0),
    [followHeading],
  );

  /**
   * Pictures for the next visit (mapSession), taken while the map is on
   * screen: each time it has fully drawn and then sat still, if the view or
   * what is on it changed since the last one. Taking one on the way out did
   * not work - the SDK answers through the map view, and by the time the
   * picture was written the screen had gone, and the answer with it.
   */
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const contentKeyRef = useRef(contentKey);
  contentKeyRef.current = contentKey;
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  const lastSnapshotKey = useRef("");
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelSnapshot = useCallback(() => clearTimeout(snapshotTimer.current), []);
  const snapshotWhenIdle = useCallback(() => {
    clearTimeout(snapshotTimer.current);
    snapshotTimer.current = setTimeout(async () => {
      const at = sizeRef.current;
      if (!onSnapshotRef.current || !fullyDrawn.current || !at) return;
      const camera = { center: shown.current.center, zoom: shown.current.zoom, heading: headingRef.current };
      const key = [
        camera.center.latitude.toFixed(6),
        camera.center.longitude.toFixed(6),
        camera.zoom.toFixed(3),
        camera.heading.toFixed(1),
        at.width,
        at.height,
        contentKeyRef.current,
      ].join("|");
      if (key === lastSnapshotKey.current) return;
      try {
        const uri: string | undefined = await mapRef.current?.takeSnap(true);
        if (!uri) return;
        lastSnapshotKey.current = key;
        if (__DEV__) console.log("[map] snapshot saved", JSON.stringify({ zoom: camera.zoom }));
        onSnapshotRef.current?.({ uri, width: at.width, height: at.height, camera });
      } catch {
        // No picture this time; the next idle moment tries again.
      }
    }, SNAPSHOT_IDLE_MS);
  }, []);
  useEffect(() => cancelSnapshot, [cancelSnapshot]);
  const faceNorth = () => moveCamera({ heading: 0, animationDuration: 400 });

  return (
    <View
      style={styles.container}
      onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        scrollEnabled={!locked}
        zoomEnabled={!locked}
        rotateEnabled={!locked}
        pitchEnabled={false}
        compassEnabled={false}
        doubleTapEnabled={false}
        // Report where the map stopped at once, not 500 ms later: a late
        // report could arrive after the next gesture had begun.
        regionDidChangeDebounceTime={0}
        // Double taps come from the map view itself (patches/mappls-map-react-native):
        // touch events above the map are cancelled once it takes the touch.
        onDoubleTap={locked ? undefined : (point: { screenPointX: number; screenPointY: number }) => void doubleTap(point.screenPointX, point.screenPointY)}
        onRegionWillChange={cancelSnapshot}
        onRegionIsChanging={regionChanging}
        onRegionDidChange={regionChangedWithHeading}
        onDidFinishRenderingFrameFully={drawn ? undefined : markDrawn}
        onDidFinishRenderingMapFully={snapshotWhenIdle}
        onMapError={(error: { code: number; message?: string }) => onError(error?.message ?? `Mappls error ${error?.code}`)}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: [center.longitude, center.latitude],
            zoomLevel: zoom - GL_ZOOM_OFFSET,
            heading: initialHeading,
          }}
          minZoomLevel={MIN_ZOOM - GL_ZOOM_OFFSET}
          maxZoomLevel={MAPPLS_MAX_ZOOM - GL_ZOOM_OFFSET}
        />
        {areas.length > 0 && (
          <ShapeSource id="map-areas" shape={shape}>
            <HeatmapLayer
              id="map-areas-glow"
              style={{
                heatmapWeight: ["get", "weight"],
                heatmapIntensity: 0.9,
                heatmapRadius: [
                  "interpolate", ["exponential", 2], ["zoom"],
                  6, areaRadiusAtZoom10 / 16,
                  10, areaRadiusAtZoom10,
                  // Faded out past here (heatmapOpacity), so it stops growing.
                  15.5, areaRadiusAtZoom10 * 45,
                ],
                // Lavender where few are, through violet, to the app's coral
                // where most are; clear at the edges, so it melts into the map.
                heatmapColor: [
                  "interpolate", ["linear"], ["heatmap-density"],
                  0, "rgba(167,139,250,0)",
                  0.15, "rgba(167,139,250,0.2)",
                  0.4, "rgba(139,92,246,0.32)",
                  0.7, "rgba(217,70,160,0.4)",
                  1, "rgba(246,95,124,0.5)",
                ],
                // Close in, the streets and pins matter more: the glow fades out.
                heatmapOpacity: ["interpolate", ["linear"], ["zoom"], 12, 1, 14, 0.6, 15.5, 0],
              }}
            />
          </ShapeSource>
        )}
        {children}
      </MapView>
      {!locked && areas.length > 0 && zoom < AREA_GLOW_HIDDEN_ZOOM && (
        // One legend for the glow, instead of a number stamped on every area.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="What the coloured glow means"
          onPress={() =>
            Alert.alert(
              "People nearby",
              "The glow shows roughly how many people who fit your preferences are around - stronger colour, more people. It is an hourly estimate over areas about 6 km wide, never who or exactly where. Quiet areas stay clear.",
            )
          }
          style={styles.glowLegend}
        >
          <Text style={styles.glowLegendText}>People nearby</Text>
          <Text style={styles.glowLegendEnd}>fewer</Text>
          <View style={styles.glowRamp}>
            {GLOW_RAMP.map((color) => (
              <View key={color} style={[styles.glowRampStep, { backgroundColor: color }]} />
            ))}
          </View>
          <Text style={styles.glowLegendEnd}>more</Text>
        </Pressable>
      )}
      {!locked && <View style={styles.zoom}>
        {compassShown && (
          <Animated.View style={{ opacity: compassOpacity }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Face north" onPress={faceNorth} style={styles.zoomButton}>
              {/* The needle points to north on the turned map. */}
              <Animated.View style={{ transform: [{ rotate: needleRotation }] }}>
                <Ionicons name="navigate" size={20} color="#F65F7C" style={{ transform: [{ rotate: "-45deg" }] }} />
              </Animated.View>
            </Pressable>
          </Animated.View>
        )}
        {/* Greyed out at the closest and farthest zoom, where they would do nothing. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
          accessibilityState={{ disabled: atCeiling }}
          disabled={atCeiling}
          onPress={() => zoomBy(1)}
          style={[styles.zoomButton, atCeiling && styles.zoomButtonDisabled]}
        >
          <Ionicons name="add" size={22} color={atCeiling ? "#B9B2C6" : "#6545B8"} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
          accessibilityState={{ disabled: atFloor }}
          disabled={atFloor}
          onPress={() => zoomBy(-1)}
          style={[styles.zoomButton, atFloor && styles.zoomButtonDisabled]}
        >
          <Ionicons name="remove" size={22} color={atFloor ? "#B9B2C6" : "#6545B8"} />
        </Pressable>
      </View>}
      {!coverGone && (
      <Animated.View pointerEvents={drawn ? "none" : "auto"} style={[styles.loading, { opacity: cover }]}>
        {usePlaceholder && placeholder ? (
          // The map as it was left, so coming back shows it at once.
          <Image
            source={{ uri: placeholder.uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            fadeDuration={0}
            onError={() => setPlaceholderFailed(true)}
          />
        ) : (
          <MapLoadingArtwork overMap />
        )}
      </Animated.View>
      )}
    </View>
  );
}

/**
 * A React view drawn into the map at a coordinate.
 *
 * Pins use PointAnnotation bitmaps. They move with the streets. A MarkerView
 * is positioned separately by the native map and can jump when the selected
 * pin changes size. Keep the same map-anchored marker during selection.
 *
 * Being a picture, it cannot take touches itself: `onPress` comes from the
 * map. The picture is taken once, so a marker whose look changes needs a new
 * `id` (and key) to be drawn again.
 */
export function MapMarker({
  id,
  coordinate,
  anchor,
  onPress,
  children,
}: {
  id: string;
  coordinate: LatLng;
  anchor?: { x: number; y: number };
  onPress?: () => void;
  children: React.ReactElement;
}) {
  const { PointAnnotation } = mappls();
  return (
    <PointAnnotation
      id={id}
      coordinate={[coordinate.longitude, coordinate.latitude]}
      anchor={anchor}
      onSelected={onPress ? () => onPress() : undefined}
    >
      <View collapsable={false}>{children}</View>
    </PointAnnotation>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", backgroundColor: "#E9E4F2" },
  // Bottom right, one button height and gap above the current-location button.
  zoom: { position: "absolute", right: 13, bottom: 60, gap: 8 },
  loading: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "transparent",
  },
  zoomButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: "rgba(101,69,184,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomButtonDisabled: { backgroundColor: "rgba(244,242,248,0.9)", borderColor: "rgba(101,69,184,0.08)" },
  glowLegend: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: "rgba(101,69,184,0.14)",
  },
  glowLegendText: { color: "#302842", fontSize: 12, fontWeight: "700", marginRight: 2 },
  glowLegendEnd: { color: "#756B86", fontSize: 11 },
  glowRamp: { flexDirection: "row", width: 56, height: 6, borderRadius: 3, overflow: "hidden" },
  glowRampStep: { flex: 1 },
});
