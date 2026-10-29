import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

/**
 * A photo still loading: its own shape in a dark tone, with a soft band of
 * light sweeping across, so it reads as "on its way" rather than broken or
 * blank. `delay` keeps it away from photos that arrive from the cache at once.
 */
const BASE = '#1B1C1E';
const SWEEP_MS = 1300;

export function Shimmer({ style, delay = 150 }: { style?: StyleProp<ViewStyle>; delay?: number }) {
  const [width, setWidth] = useState(0);
  const [shown, setShown] = useState(delay === 0);
  const sweep = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (shown) return;
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [delay, shown]);
  useEffect(() => {
    if (!shown || !width || reduceMotion) return;
    sweep.value = 0;
    sweep.value = withRepeat(withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.quad) }), -1);
    return () => cancelAnimation(sweep);
  }, [reduceMotion, shown, sweep, width]);

  const band = Math.max(120, width * 0.6);
  const bandStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -band + (width + band) * sweep.value }] }));

  if (!shown) return <View pointerEvents="none" style={[styles.base, style]} />;
  return (
    <View pointerEvents="none" style={[styles.base, style]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible accessibilityLabel="Loading photo">
      {width && !reduceMotion ? (
        <Animated.View style={[styles.band, { width: band }, bandStyle]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: BASE, overflow: 'hidden' },
  band: { position: 'absolute', top: 0, bottom: 0, left: 0 },
});
