import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/** The map's first-open cover. The circles are visual only; they do not show a search radius. */
export function MapLoadingArtwork({ overMap = false }: { overMap?: boolean }) {
  const { width } = useWindowDimensions();
  const rippleSize = width * 1.76;
  const firstRipple = useRef(new Animated.Value(0)).current;
  const secondRipple = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const ripple = (value: Animated.Value) => Animated.loop(
      Animated.timing(value, { toValue: 1, duration: 3000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    const first = ripple(firstRipple);
    const second = Animated.sequence([Animated.delay(1500), ripple(secondRipple)]);
    first.start();
    second.start();
    return () => {
      first.stop();
      second.stop();
    };
  }, [firstRipple, secondRipple]);

  const ringStyle = (progress: Animated.Value) => ({
    width: rippleSize,
    height: rippleSize,
    borderRadius: rippleSize / 2,
    opacity: progress.interpolate({ inputRange: [0, 0.1, 0.6, 1], outputRange: [0, 0.8, 0.35, 0] }),
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [68 / rippleSize, 1] }) }],
  });

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading the map" style={[styles.canvas, overMap && styles.overMap]}>
      <Animated.View style={[styles.ring, ringStyle(firstRipple)]} />
      <Animated.View style={[styles.ring, ringStyle(secondRipple)]} />
      <View style={styles.badge}>
        <Ionicons name="compass-outline" size={32} color="#FFFFFF" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    width: "100%",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F4EF",
  },
  overMap: { backgroundColor: "rgba(247,244,239,0.91)" },
  ring: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "rgba(145,125,167,0.13)",
    backgroundColor: "rgba(176,150,202,0.10)",
  },
  badge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#19171B",
  },
});
