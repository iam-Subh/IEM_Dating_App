import React, { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors } from '../../../core/theme/colors';

type Decision = 'like' | 'pass';

function progressFor(x: number, width: number, decision: Decision) {
  'worklet';
  const distance = decision === 'like' ? x : -x;
  return Math.max(0, Math.min(1, (distance - 6) / Math.max(1, width * 0.2 - 6)));
}

/** The decision mark moves with its card and follows the drag. */
export function SwipeDecisionFeedback({ cardId, owner, dragX, width }: {
  cardId: string;
  owner: SharedValue<string>;
  dragX: SharedValue<number>;
  width: number;
}) {
  const reduceMotion = useReducedMotion();
  const heartGradient = `swipe-heart-${useId().replace(/:/g, '')}`;
  const like = useAnimatedStyle(() => {
    const progress = owner.value === cardId ? progressFor(dragX.value, width, 'like') : 0;
    return { opacity: progress, transform: [{ scale: reduceMotion ? 1 : 0.55 + progress * 0.45 }, { rotate: '-12deg' }] };
  });
  const pass = useAnimatedStyle(() => {
    const progress = owner.value === cardId ? progressFor(dragX.value, width, 'pass') : 0;
    return { opacity: progress, transform: [{ scale: reduceMotion ? 1 : 0.55 + progress * 0.45 }] };
  });
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Animated.View style={[styles.mark, styles.likeMark, like]}>
      <Svg width={76} height={76} viewBox="0 0 24 24" accessible={false}>
        <Defs>
          <LinearGradient id={heartGradient} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#FF9BA8" />
            <Stop offset="48%" stopColor={colors.primary} />
            <Stop offset="100%" stopColor="#EC327B" />
          </LinearGradient>
        </Defs>
        <Path d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54Z" fill={`url(#${heartGradient})`} />
      </Svg>
    </Animated.View>
    <Animated.View style={[styles.mark, styles.passMark, pass]}>
      <Ionicons name="close" size={76} color="#FFFFFF" />
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  overlay: { zIndex: 999 },
  mark: { position: 'absolute', top: 64, width: 72, height: 72, alignItems: 'center', justifyContent: 'center', zIndex: 120 },
  likeMark: { left: 16 },
  passMark: { right: 16 },
});
