import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const TRACK = 220;
const WIDTH = 44;
const TOP_HALF_WIDTH = 7;
const BOTTOM_HALF_WIDTH = 1.5;

type Props = {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Minimum size change sent to React during a drag. The final value is always sent. */
  onChangeStep?: number;
  /** Receives the drag value on the UI thread for a live text cursor. */
  liveValue?: SharedValue<number>;
  /** True while a finger is on the slider, for the size preview. */
  onActiveChange?: (active: boolean) => void;
};

/**
 * The narrow vertical slider on the left of Instagram's text and draw tools:
 * wide at the top for large sizes, a point at the bottom for small ones.
 *
 * The thumb follows the finger on the UI thread. The `value` prop only moves
 * it when nobody is dragging: each change reaches JavaScript a moment late, and
 * applying those late values pulled the thumb back and forth while sliding and
 * snapped it to an old position on release.
 */
export function VerticalSizeSlider({ value, min, max, onChange, onActiveChange, onChangeStep = 0, liveValue }: Props) {
  const fraction = useSharedValue((value - min) / (max - min));
  const lastSent = useSharedValue(value);
  const interacting = useRef(false);
  const settledAt = useRef<number | null>(null);

  useEffect(() => {
    if (interacting.current) return;
    if (settledAt.current !== null) {
      // Values sent while dragging can still arrive after release; wait for the final one.
      if (Math.abs(value - settledAt.current) > 1e-6) return;
      settledAt.current = null;
    }
    fraction.value = (value - min) / (max - min);
    if (liveValue) liveValue.value = value;
  }, [fraction, liveValue, max, min, value]);

  const begin = useCallback(() => {
    interacting.current = true;
    settledAt.current = null;
    onActiveChange?.(true);
  }, [onActiveChange]);
  const finish = useCallback((final: number) => {
    interacting.current = false;
    settledAt.current = final;
    onChange(final);
    onActiveChange?.(false);
  }, [onActiveChange, onChange]);

  const gesture = useMemo(() => {
    const valueAt = (y: number) => {
      'worklet';
      fraction.value = Math.max(0, Math.min(1, 1 - y / TRACK));
      const next = min + fraction.value * (max - min);
      if (liveValue) liveValue.value = next;
      return next;
    };
    return Gesture.Pan()
      .minDistance(0)
      .onBegin((event) => {
        runOnJS(begin)();
        const next = valueAt(event.y);
        lastSent.value = next;
        runOnJS(onChange)(next);
      })
      .onUpdate((event) => {
        const next = valueAt(event.y);
        if (Math.abs(next - lastSent.value) >= onChangeStep) {
          lastSent.value = next;
          runOnJS(onChange)(next);
        }
      })
      .onFinalize(() => {
        runOnJS(finish)(min + fraction.value * (max - min));
      });
  }, [begin, finish, fraction, lastSent, liveValue, max, min, onChange, onChangeStep]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - fraction.value) * TRACK - 11 }] }));
  const middle = WIDTH / 2;

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.hit} collapsable={false}>
        {/* An SVG shape is anti-aliased; the border trick used before drew jagged edges on Android. */}
        <Svg width={WIDTH} height={TRACK} style={StyleSheet.absoluteFill}>
          <Path
            d={`M ${middle - TOP_HALF_WIDTH} 2 Q ${middle} -1 ${middle + TOP_HALF_WIDTH} 2 L ${middle + BOTTOM_HALF_WIDTH} ${TRACK - 1} Q ${middle} ${TRACK + 1} ${middle - BOTTOM_HALF_WIDTH} ${TRACK - 1} Z`}
            fill="rgba(255,255,255,0.55)"
            stroke="rgba(255,255,255,0.8)"
            strokeWidth={0.75}
          />
        </Svg>
        <Animated.View style={[styles.thumb, thumb]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hit: { width: WIDTH, height: TRACK, alignItems: 'center' },
  thumb: {
    position: 'absolute', top: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.2)', elevation: 3,
  },
});
