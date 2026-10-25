import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

type PhotoProps = {
  uri: string;
  visible: boolean;
  mediaIndex: number;
  mountedIndexes: number[];
  selectedIndex?: SharedValue<number>;
  onLoad?: (uri: string) => void;
  onError?: (uri: string) => void;
};

function PreparedPhoto({ uri, visible, mediaIndex, mountedIndexes, selectedIndex, onLoad, onError }: PhotoProps) {
  const opacity = useAnimatedStyle(() => {
    if (!selectedIndex) return { opacity: visible ? 1 : 0 };
    const current = selectedIndex.value;
    // The selected photo is mounted: show it now, before React re-renders.
    if (mountedIndexes.includes(current)) return { opacity: current === mediaIndex ? 1 : 0 };
    // A video, or a photo past the mounted window, was selected and has not
    // rendered yet. Keep the photo it replaces rather than a blank frame.
    return { opacity: visible ? 1 : 0 };
  });
  return (
    <Animated.Image
      source={{ uri }}
      style={[StyleSheet.absoluteFill, opacity]}
      resizeMode="cover"
      fadeDuration={0}
      accessible={false}
      onLoad={() => onLoad?.(uri)}
      onError={() => onError?.(uri)}
    />
  );
}

// Keep adjacent native image views alive, including the last-to-first loop.
//
// A mounted image view downloads and decodes its photo whether or not it is
// visible, outside the preparation queue's request budget. So only the card in
// front keeps neighbours mounted; a card waiting behind it mounts just the photo
// it shows, and the queue prepares the rest on disk.
//
// With `selectedIndex` (a media index shared with the card) the visible photo
// switches on the UI thread the moment a tap writes the index, instead of
// after the card, the expanded profile and the deck re-render.
export function PreparedPhotos({
  uris,
  selectedUri,
  onLoad,
  onError,
  selectedIndex,
  indexOf,
  neighbours = true,
}: {
  uris: string[];
  selectedUri?: string;
  onLoad?: (uri: string) => void;
  onError?: (uri: string) => void;
  selectedIndex?: SharedValue<number>;
  /** Media index of each photo uri, when `selectedIndex` is used. */
  indexOf?: Record<string, number>;
  /** Mount the photos either side of the selected one. */
  neighbours?: boolean;
}) {
  const selected = Math.max(0, uris.indexOf(selectedUri ?? ""));
  const mounted = uris.filter((_, index) => {
    const forward = (index - selected + uris.length) % uris.length;
    const backward = (selected - index + uris.length) % uris.length;
    return neighbours ? forward <= 2 || backward <= 1 : forward === 0;
  });
  const mountedIndexes = indexOf ? mounted.map((uri) => indexOf[uri] ?? -1) : [];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {mounted.map((uri) => (
        <PreparedPhoto
          key={uri}
          uri={uri}
          visible={uri === selectedUri}
          mediaIndex={indexOf?.[uri] ?? -1}
          mountedIndexes={mountedIndexes}
          selectedIndex={indexOf ? selectedIndex : undefined}
          onLoad={onLoad}
          onError={onError}
        />
      ))}
    </View>
  );
}
