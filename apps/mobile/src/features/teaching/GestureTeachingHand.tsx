import React, {useCallback, useEffect, useRef} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Animated, {cancelAnimation, Easing, interpolate, runOnJS, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming} from 'react-native-reanimated';
import Svg, {Circle, G} from 'react-native-svg';
import {TeachingHandArt} from './TeachingHandArt';

export type TeachingGesturePose = 'point' | 'hold' | 'swipe' | 'longPress';
type Props = {
  pose: TeachingGesturePose;
  text: string;
  direction?: 'left' | 'right' | 'down';
  /** Where the line sits: beside the hand (left for spots near the right edge), or under it. */
  textSide?: 'left' | 'right' | 'below' | 'none';
  /** At the press peak, put the fingertip exactly on its measured target. */
  anchorAtContact?: boolean;
  /** The widest the line may be, so it stays on screen. */
  textMaxWidth?: number;
  /** Keep playing until removed, for a guide that waits for Got it. */
  loop?: boolean;
  size?: number;
  replayKey?: number;
  onComplete?: () => void;
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING_LENGTH = 2 * Math.PI * 17;

/** A code-drawn hand: two 1.5-second cycles, then a short fade. */
export function GestureTeachingHand({pose, text, direction = 'right', textSide = 'right', anchorAtContact = false, textMaxWidth, loop = false, size = 72, replayKey = 0, onComplete}: Props) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const complete = useCallback(() => callback.current?.(), []);
  useEffect(() => {
    cancelAnimation(progress);
    cancelAnimation(opacity);
    progress.value = 0;
    opacity.value = 1;
    if (!reduced) {
      progress.value = withRepeat(withTiming(1, {duration: 1500, easing: Easing.linear}), loop ? -1 : 2, false, finished => {
        if (finished && !loop) opacity.value = withTiming(0, {duration: 220}, faded => {if (faded) runOnJS(complete)();});
      });
    }
    return () => {cancelAnimation(progress); cancelAnimation(opacity);};
  }, [pose, direction, replayKey, reduced, loop, progress, opacity, complete]);

  const handMotion = useAnimatedStyle(() => {
    if (reduced) return {opacity: 1, transform: [{translateX: 0}, {translateY: 0}]};
    const p = progress.value;
    if (pose === 'swipe') {
      const distance = interpolate(p, [0, 0.18, 0.78, 1], [-24, -24, 24, 24]);
      return {
        opacity: interpolate(p, [0, 0.12, 0.7, 0.94, 1], [0, 1, 1, 0, 0]),
        transform: [{translateX: direction === 'down' ? 0 : distance * (direction === 'left' ? -1 : 1)}, {translateY: direction === 'down' ? distance : 0}],
      };
    }
    const press = pose === 'point'
      ? interpolate(p, [0, 0.18, 0.36, 1], [0, 6, 0, 0])
      : interpolate(p, [0, 0.15, 0.76, 0.92, 1], [0, 6, 6, 0, 0]);
    return {opacity: 1, transform: [{translateX: 0}, {translateY: anchorAtContact ? press - 6 : press}]};
  });
  const groupMotion = useAnimatedStyle(() => ({opacity: opacity.value}));
  const labelMotion = useAnimatedStyle(() => ({
    opacity: reduced || loop || pose !== 'longPress' ? 1 : interpolate(progress.value, [0, 0.55, 0.59, 0.86, 1], [0, 0, 1, 1, 0]),
  }));
  const trailMotion = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : interpolate(progress.value, [0, 0.18, 0.5, 0.8, 1], [0, 0, 0.5, 0.25, 0]),
  }));
  const ripple = useAnimatedProps(() => ({
    r: reduced ? 13 : interpolate(progress.value, [0, 0.16, 0.55, 1], [6, 6, 23, 23]),
    strokeOpacity: reduced ? 0 : interpolate(progress.value, [0, 0.16, 0.3, 0.55, 1], [0, 0.65, 0.45, 0, 0]),
  }));
  const holdRing = useAnimatedProps(() => ({
    strokeDashoffset: reduced ? 0 : RING_LENGTH * (1 - Math.min(1, Math.max(0, (progress.value - 0.15) / 0.6))),
    strokeOpacity: reduced ? 0.6 : interpolate(progress.value, [0, 0.15, 0.75, 0.95, 1], [0, 1, 1, 0, 0]),
  }));
  const unit = size / 128;
  return <Animated.View style={[styles.row, textSide === 'left' && styles.rowFlipped, textSide === 'below' && styles.column, groupMotion]} pointerEvents="none" accessible accessibilityLabel={text}>
    <View style={{width: size, height: size * 194 / 128}} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {pose === 'swipe' && <Animated.View style={[styles.trail, direction === 'down'
        ? {left: 53 * unit, top: 26 * unit - 24, width: 2, height: 48}
        : {left: 53 * unit - 24, top: 26 * unit, width: 48, height: 2}, trailMotion]}/>}
      <Animated.View style={handMotion}>
        <Svg width={size} height={size * 194 / 128} viewBox="0 -18 128 194" accessible={false}>
          <G strokeLinecap="round" strokeLinejoin="round">
            <TeachingHandArt/>
            {pose === 'point' && <AnimatedCircle cx={53} cy={8} fill="none" stroke="#E39A9A" strokeWidth={2} animatedProps={ripple}/>}
            {pose === 'hold' && <AnimatedCircle cx={53} cy={8} r={17} fill="none" stroke="#E39A9A" strokeWidth={2.5} strokeDasharray={[RING_LENGTH, RING_LENGTH]} rotation={-90} origin="53, 8" animatedProps={holdRing}/>}
          </G>
        </Svg>
      </Animated.View>
    </View>
    {textSide !== 'none' && <Animated.View style={[styles.copy, textMaxWidth !== undefined && {maxWidth: textMaxWidth}, labelMotion]}><Text style={[styles.text, textSide === 'below' && styles.textCentered]}>{text}</Text></Animated.View>}
  </Animated.View>;
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 12},
  rowFlipped: {flexDirection: 'row-reverse'},
  column: {flexDirection: 'column', gap: 8},
  textCentered: {textAlign: 'center'},
  copy: {flexShrink: 1, maxWidth: 220},
  text: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#F6E7D6'},
  trail: {position: 'absolute', borderRadius: 2, backgroundColor: '#E39A9A'},
});
