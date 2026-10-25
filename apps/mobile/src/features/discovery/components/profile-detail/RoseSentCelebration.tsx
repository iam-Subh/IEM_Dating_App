import React, { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { cancelAnimation, Easing, interpolate, ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

export type RoseConfirmation = { name: string; matched: boolean };

/** Runs inside the profile modal so the native Rose composer cannot cover it. */
export function RoseSentCelebration({ confirmation, photoUri, bottomInset, sourceOffsetX, onComplete }: {
  confirmation: RoseConfirmation;
  photoUri?: string;
  bottomInset: number;
  sourceOffsetX: number;
  onComplete: () => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  const finish = () => complete.current();
  useEffect(() => {
    if (!size.width || !size.height) return;
    progress.value = 0;
    // Keep the confirmation readable with reduced motion; only the transforms are removed.
    progress.value = withTiming(1, { duration: reducedMotion ? 1300 : 2200, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, done => {
      if (done) runOnJS(finish)();
    });
    return () => cancelAnimation(progress);
  }, [size.width, size.height, reducedMotion, progress]);

  const targetX = size.width / 2;
  const targetY = Math.max(100, size.height * 0.32);
  const sourceY = size.height - bottomInset - 40;
  const veil = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.1, 0.91, 1], [0, 1, 1, 0], "clamp"),
  }));
  const portrait = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.12, 0.91, 1], [0, 1, 1, 0], "clamp"),
    transform: [{ scale: reducedMotion ? 1 : interpolate(progress.value, [0, 0.15, 0.42, 0.56, 1], [0.92, 1, 1, 1.04, 1], "clamp") }],
  }));
  const flower = useAnimatedStyle(() => {
    const travel = Math.min(1, progress.value / 0.34);
    return {
      opacity: interpolate(progress.value, [0, 0.05, 0.88, 1], [0, 1, 1, 0], "clamp"),
      transform: [
        { translateX: reducedMotion ? 0 : sourceOffsetX * (1 - travel) + Math.sin(travel * Math.PI) * 60 },
        { translateY: reducedMotion ? 0 : (sourceY - targetY - 54) * (1 - travel) },
        { rotate: `${reducedMotion ? 0 : -22 * Math.sin(travel * Math.PI)}deg` },
        { scale: reducedMotion ? 1 : interpolate(progress.value, [0, 0.34, 0.45, 0.57, 1], [0.7, 1, 1.16, 1, 1], "clamp") },
      ],
    };
  });
  const halo = useAnimatedStyle(() => ({
    opacity: reducedMotion ? 0 : interpolate(progress.value, [0.3, 0.4, 0.64, 1], [0, 0.65, 0, 0], "clamp"),
    transform: [{ scale: interpolate(progress.value, [0.3, 0.64], [0.85, 1.6], "clamp") }],
  }));
  const message = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, reducedMotion ? [0, 0.1, 0.91, 1] : [0.34, 0.44, 0.91, 1], [0, 1, 1, 0], "clamp"),
    transform: [{ translateY: reducedMotion ? 0 : interpolate(progress.value, [0.34, 0.44], [10, 0], "clamp") }],
  }));

  return <View style={StyleSheet.absoluteFill} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    setSize(current => current.width === width && current.height === height ? current : { width, height });
  }} accessibilityViewIsModal>
    <Animated.View style={[StyleSheet.absoluteFill, styles.veil, veil]} />
    <Animated.View pointerEvents="none" style={[styles.halo, { left: targetX - 80, top: targetY - 80 }, halo]} />
    <Animated.View pointerEvents="none" style={[styles.portrait, { left: targetX - 60, top: targetY - 60 }, portrait]}>
      {photoUri ? <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" fadeDuration={0} />
        : <View style={[styles.photo, styles.initials]}><Text style={styles.initialsText}>{confirmation.name.trim().charAt(0)}</Text></View>}
    </Animated.View>
    {!reducedMotion && PETALS.map((petal, index) => <Petal key={index} progress={progress} x={targetX} y={targetY} petal={petal} />)}
    <Animated.View pointerEvents="none" style={[styles.flower, { left: targetX - 26, top: targetY + 28 }, flower]}>
      <Ionicons name="rose" size={42} color="#F3C1CA" />
    </Animated.View>
    <Animated.View style={[styles.message, { top: targetY + 112 }, message]} accessibilityLiveRegion="polite" accessible
      accessibilityLabel={`Rose sent to ${confirmation.name}${confirmation.matched ? '. You are matched.' : ''}`}>
      <Text style={styles.title}>Rose sent to {confirmation.name}</Text>
      <Text style={styles.detail}>{confirmation.matched ? "You’re matched. Start a conversation." : "A little something, just for them."}</Text>
    </Animated.View>
  </View>;
}

const PETALS = [
  { x: -82, y: -44, angle: -42 }, { x: 76, y: -54, angle: 35 },
  { x: -95, y: 34, angle: -105 }, { x: 90, y: 44, angle: 112 },
  { x: 28, y: -96, angle: 14 },
];
function Petal({ progress, x, y, petal }: {
  progress: SharedValue<number>;
  x: number; y: number; petal: typeof PETALS[number];
}) {
  const motion = useAnimatedStyle(() => {
    const bloom = interpolate(progress.value, [0.32, 0.6], [0, 1], "clamp");
    return {
      opacity: interpolate(progress.value, [0.32, 0.4, 0.63, 0.73], [0, 0.9, 0.5, 0], "clamp"),
      transform: [{ translateX: petal.x * bloom }, { translateY: petal.y * bloom },
        { rotate: `${petal.angle * bloom}deg` }, { scale: interpolate(bloom, [0, 1], [0.4, 1]) }],
    };
  });
  return <Animated.View pointerEvents="none" style={[styles.petal, { left: x - 5, top: y - 8 }, motion]} />;
}

const styles = StyleSheet.create({
  veil: { backgroundColor: "rgba(16,11,15,0.88)" },
  halo: { position: "absolute", width: 160, height: 160, borderRadius: 80, backgroundColor: "#F3C1CA" },
  portrait: { position: "absolute", width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: "#F3C1CA", padding: 4, backgroundColor: "#2D2029" },
  photo: { width: "100%", height: "100%", borderRadius: 60 },
  initials: { alignItems: "center", justifyContent: "center", backgroundColor: "#48313C" },
  initialsText: { fontSize: 38, fontWeight: "700", color: "#FFF4F6" },
  flower: { position: "absolute", width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  petal: { position: "absolute", width: 10, height: 16, borderTopLeftRadius: 10, borderBottomRightRadius: 10, borderTopRightRadius: 3, borderBottomLeftRadius: 3, backgroundColor: "#F3C1CA" },
  message: { position: "absolute", left: 24, right: 24, alignItems: "center", gap: 8 },
  title: { fontSize: 23, lineHeight: 30, fontWeight: "700", color: "#FFF4F6", textAlign: "center" },
  detail: { fontSize: 14, lineHeight: 20, color: "#D5BEC9", textAlign: "center" },
});
