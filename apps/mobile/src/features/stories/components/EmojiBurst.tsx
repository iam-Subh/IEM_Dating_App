import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

const PARTICLES = 12;
const DURATION = 1400;

function Particle({ emoji, left, delay, drift, size, height }: { emoji: string; left: number; delay: number; drift: number; size: number; height: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: DURATION, easing: Easing.out(Easing.quad) }));
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value < 0.75 ? 1 : 1 - (progress.value - 0.75) / 0.25,
    transform: [
      { translateY: -progress.value * height * 0.75 },
      { translateX: drift * progress.value },
      { scale: 0.6 + progress.value * 0.6 },
    ],
  }));
  return <Animated.Text style={[styles.particle, { left, fontSize: size }, style]}>{emoji}</Animated.Text>;
}

/** The emojis that float up the screen after a quick reaction is sent. */
export function EmojiBurst({ emoji, onDone }: { emoji: string; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const particles = useMemo(() => Array.from({ length: PARTICLES }, (_, index) => ({
    key: index,
    left: width * (0.15 + Math.random() * 0.7),
    delay: Math.random() * 350,
    drift: (Math.random() - 0.5) * 80,
    size: 30 + Math.random() * 22,
  })), [width]);
  useEffect(() => {
    const timer = setTimeout(onDone, DURATION + 400);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {particles.map(({ key, ...particle }) => (
        <Particle key={key} emoji={emoji} height={height} {...particle} />
      ))}
      <Text style={styles.hidden}>{emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  particle: { position: 'absolute', bottom: 90 },
  hidden: { opacity: 0, position: 'absolute' },
});
