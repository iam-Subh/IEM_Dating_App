import React, { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { Image, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

/**
 * A small slippy map made of ordinary image tiles, so the map needs no native
 * module and no new build (LOCATION_SPEC.md 9). Web Mercator, 256 px tiles.
 *
 * Tile source: EXPO_PUBLIC_MAP_TILE_URL (with EXPO_PUBLIC_MAP_ATTRIBUTION).
 * The development default is OpenStreetMap. A production release must set its
 * own tile service URL and attribution; see LOCATION_SPEC.md 13.5.
 */

const TILE = 256;
const CONFIGURED_TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL;
const TILE_URL =
  CONFIGURED_TILE_URL || "https://tile.openstreetmap.de/{z}/{x}/{y}.png";
const ATTRIBUTION = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION || "© OpenStreetMap contributors";
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 17;
/** Rings of tiles loaded beyond the view, so a drag rarely reaches an unloaded edge. */
const MARGIN_TILES = 2;
export type LatLng = { latitude: number; longitude: number };

/** World pixels at a whole zoom level. */
export function project(point: LatLng, zoom: number) {
  const size = TILE * 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.latitude));
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((point.longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function unproject(x: number, y: number, zoom: number): LatLng {
  const size = TILE * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return {
    latitude: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    longitude: (x / size) * 360 - 180,
  };
}

type Props = {
  center: LatLng;
  /** A selected pin keeps the map still until its panel closes. */
  locked?: boolean;
  /** May be fractional: tiles come from the whole level below and are scaled. */
  zoom: number;
  /**
   * Only what changed. A pan and a pinch that end together each report their
   * own part, and the caller merges them, so neither overwrites the other.
   */
  onChange: (update: { center?: LatLng; zoom?: number }) => void;
  /** Draws overlays; `toScreen` turns a coordinate into a position inside the map. */
  children: (toScreen: (point: LatLng) => { x: number; y: number }, zoom: number) => React.ReactNode;
};

export function TileMap({ center, zoom, locked = false, onChange, children }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Keep the last whole tile level under the active level. Android can finish
  // Image.prefetch before it has decoded the image for drawing. Without this
  // backing layer, that decode window shows the map background as a flicker.
  const [fallbackTileZoom, setFallbackTileZoom] = useState<number | null>(null);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const scale = useSharedValue(1);
  const pinchOriginX = useSharedValue(0);
  const pinchOriginY = useSharedValue(0);
  const pinchShiftX = useSharedValue(0);
  const pinchShiftY = useSharedValue(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  // Tiles come from the whole level at or below the zoom, drawn larger by the
  // fraction, so a pinch can stop anywhere instead of snapping to a level.
  const tileZoom = Math.floor(zoom);
  const factor = 2 ** (zoom - tileZoom);
  const centerPx = useMemo(() => project(center, tileZoom), [center, tileZoom]);

  // The drag and pinch offsets are cleared only once the new centre and zoom
  // have rendered. Clearing them in the gesture callback, before React commits
  // the new centre, drew one frame at the old centre: the map jumped back and
  // then forward.
  useLayoutEffect(() => {
    offsetX.value = 0;
    offsetY.value = 0;
    scale.value = 1;
    pinchShiftX.value = 0;
    pinchShiftY.value = 0;
  }, [center, zoom, offsetX, offsetY, scale, pinchShiftX, pinchShiftY]);

  const commitPan = useCallback(
    (dx: number, dy: number) => {
      if (!dx && !dy) return;
      onChange({ center: unproject(centerPx.x - dx / factor, centerPx.y - dy / factor, tileZoom) });
    },
    [centerPx, factor, tileZoom, onChange],
  );

  const commitZoom = useCallback(
    (next: number, startX = size.width / 2, startY = size.height / 2, endX = startX, endY = startY) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
      if (Math.abs(clamped - zoom) < 0.01) {
        scale.value = 1;
        pinchShiftX.value = 0;
        pinchShiftY.value = 0;
        return;
      }

      // Keep the location that was under the fingers under the fingers after
      // the zoom. Keeping `center` unchanged makes the map jump away from the
      // area the person pinched whenever the gesture is off-centre.
      const oldCenter = project(center, zoom);
      const anchor = unproject(
        oldCenter.x + startX - size.width / 2,
        oldCenter.y + startY - size.height / 2,
        zoom,
      );
      const anchorAtNextZoom = project(anchor, clamped);
      const nextCenter = unproject(
        anchorAtNextZoom.x - (endX - size.width / 2),
        anchorAtNextZoom.y - (endY - size.height / 2),
        clamped,
      );

      const nextTileZoom = Math.floor(clamped);
      if (nextTileZoom !== tileZoom) setFallbackTileZoom(tileZoom);
      onChange({ center: nextCenter, zoom: clamped });
    },
    [center, zoom, size, tileZoom, onChange, scale, pinchShiftX, pinchShiftY],
  );

  const pan = Gesture.Pan()
    .enabled(!locked)
    .maxPointers(1)
    .minDistance(8)
    .onUpdate((event) => {
      offsetX.value = event.translationX;
      offsetY.value = event.translationY;
    })
    .onEnd((event) => {
      runOnJS(commitPan)(event.translationX, event.translationY);
    });

  const pinch = Gesture.Pinch()
    .enabled(!locked)
    .onBegin((event) => {
      pinchOriginX.value = event.focalX;
      pinchOriginY.value = event.focalY;
      pinchShiftX.value = 0;
      pinchShiftY.value = 0;
    })
    .onUpdate((event) => {
      scale.value = event.scale;
      pinchShiftX.value = event.focalX - pinchOriginX.value;
      pinchShiftY.value = event.focalY - pinchOriginY.value;
    })
    .onEnd((event) => {
      runOnJS(commitZoom)(
        zoom + Math.log2(Math.max(0.05, event.scale)),
        pinchOriginX.value,
        pinchOriginY.value,
        event.focalX,
        event.focalY,
      );
    });

  const doubleTap = Gesture.Tap()
    .enabled(!locked)
    .numberOfTaps(2)
    .maxDelay(260)
    .onEnd((event, success) => {
      if (!success) return;
      runOnJS(commitZoom)(Math.floor(zoom) + 1, event.x, event.y, event.x, event.y);
    });

  const layerStyle = useAnimatedStyle(() => ({
    transformOrigin: [pinchOriginX.value, pinchOriginY.value, 0],
    transform: [
      { translateX: offsetX.value + pinchShiftX.value },
      { translateY: offsetY.value + pinchShiftY.value },
      { scale: scale.value },
    ],
  }));

  // Build any tile level at the current geographic centre and visual zoom.
  // This keeps the previous level aligned below the active level.
  const buildTiles = (sourceZoom: number, layer: "active" | "fallback") => {
    const sourceFactor = 2 ** (zoom - sourceZoom);
    const sourceCenter = project(center, sourceZoom);
    const halfW = size.width / 2 / sourceFactor;
    const halfH = size.height / 2 / sourceFactor;
    const result: { key: string; uri: string; left: number; top: number; size: number }[] = [];
    if (!size.width || !size.height) return result;

    const count = 2 ** sourceZoom;
    const x0 = Math.floor((sourceCenter.x - halfW) / TILE) - MARGIN_TILES;
    const x1 = Math.floor((sourceCenter.x + halfW) / TILE) + MARGIN_TILES;
    const y0 = Math.max(0, Math.floor((sourceCenter.y - halfH) / TILE) - MARGIN_TILES);
    const y1 = Math.min(count - 1, Math.floor((sourceCenter.y + halfH) / TILE) + MARGIN_TILES);
    for (let tx = x0; tx <= x1; tx += 1) {
      for (let ty = y0; ty <= y1; ty += 1) {
        const wrapped = ((tx % count) + count) % count;
        result.push({
          key: `${layer}/${sourceZoom}/${tx}/${ty}`,
          uri: TILE_URL.replace("{z}", String(sourceZoom)).replace("{x}", String(wrapped)).replace("{y}", String(ty)),
          left: (tx * TILE - sourceCenter.x) * sourceFactor + size.width / 2,
          top: (ty * TILE - sourceCenter.y) * sourceFactor + size.height / 2,
          size: TILE * sourceFactor,
        });
      }
    }
    return result;
  };

  const tiles = buildTiles(tileZoom, "active");
  const fallbackTiles =
    fallbackTileZoom !== null && fallbackTileZoom !== tileZoom
      ? buildTiles(fallbackTileZoom, "fallback")
      : [];

  const toScreen = (point: LatLng) => {
    const p = project(point, tileZoom);
    return {
      x: (p.x - centerPx.x) * factor + size.width / 2,
      y: (p.y - centerPx.y) * factor + size.height / 2,
    };
  };

  return (
    <View style={styles.container} onLayout={onLayout}>
      <GestureDetector gesture={Gesture.Simultaneous(pan, pinch, doubleTap)}>
        <Animated.View style={[StyleSheet.absoluteFill, layerStyle]}>
          {[...fallbackTiles, ...tiles].map((tile) => (
            <Image
              key={tile.key}
              source={{ uri: tile.uri }}
              // A hair of overlap hides the seams scaling can open between tiles.
              style={[styles.tile, { left: tile.left, top: tile.top, width: tile.size + 0.5, height: tile.size + 0.5 }]}
              fadeDuration={0}
            />
          ))}
          {size.width > 0 && children(toScreen, zoom)}
        </Animated.View>
      </GestureDetector>
      {!locked && <View style={styles.zoom}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
          accessibilityState={{ disabled: zoom >= MAX_ZOOM - 0.01 }}
          disabled={zoom >= MAX_ZOOM - 0.01}
          onPress={() => commitZoom(Math.floor(zoom) + 1)}
          style={[styles.zoomButton, zoom >= MAX_ZOOM - 0.01 && styles.zoomButtonDisabled]}
        >
          <Ionicons name="add" size={22} color={zoom >= MAX_ZOOM - 0.01 ? "#B9B2C6" : "#6545B8"} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
          accessibilityState={{ disabled: zoom <= MIN_ZOOM + 0.01 }}
          disabled={zoom <= MIN_ZOOM + 0.01}
          onPress={() => commitZoom(Math.ceil(zoom) - 1)}
          style={[styles.zoomButton, zoom <= MIN_ZOOM + 0.01 && styles.zoomButtonDisabled]}
        >
          <Ionicons name="remove" size={22} color={zoom <= MIN_ZOOM + 0.01 ? "#B9B2C6" : "#6545B8"} />
        </Pressable>
      </View>}
      <Text style={styles.attribution}>{ATTRIBUTION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", backgroundColor: "#E9E4F2" },
  tile: { position: "absolute" },
  // Bottom right, one button height and gap above the current-location button.
  zoom: { position: "absolute", right: 13, bottom: 60, gap: 8 },
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
  attribution: {
    position: "absolute",
    right: 6,
    bottom: 4,
    color: "rgba(47,39,65,0.72)",
    fontSize: 9,
  },
});
