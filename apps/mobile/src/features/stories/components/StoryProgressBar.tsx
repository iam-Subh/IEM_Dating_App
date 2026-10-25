import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

function Segment({ state, progress }: { state: 'done' | 'active' | 'next'; progress: SharedValue<number> }) {
  const fill = useAnimatedStyle(() => {
    const value = state === 'done' ? 1 : state === 'active' ? Math.max(0, Math.min(1, progress.value)) : 0;
    return { width: `${value * 100}%` };
  });
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, fill]} />
    </View>
  );
}

/**
 * One segment per Story of the person being watched. Only the active segment
 * moves, from a shared value animated on the UI thread, so it runs smoothly
 * however busy JavaScript is.
 */
export function StoryProgressBar({ count, index, progress }: { count: number; index: number; progress: SharedValue<number> }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Story ${index + 1} of ${count}`}
      style={styles.row}
    >
      {Array.from({ length: count }, (_, segment) => (
        <Segment
          key={segment}
          state={segment < index ? 'done' : segment === index ? 'active' : 'next'}
          progress={progress}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, height: 2 },
  track: { flex: 1, height: 2, borderRadius: 1, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.35)' },
  fill: { height: 2, backgroundColor: '#fff' },
});
