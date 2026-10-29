import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import Svg, {Path} from 'react-native-svg';
import {STANDOUTS_HEART_PATH} from './StandoutsIcon';
import {STANDOUTS_CARD_PATHS, STANDOUTS_CARD_SIZE, STANDOUTS_FRONT_LAYERS,
  STANDOUTS_ICON_FRAME, STANDOUTS_LAYER_STEPS, STANDOUTS_MOTION_STEPS,
  STANDOUTS_SELECTION_MS} from '../standoutsIconMotion';

/** The frame stays fixed. Only the cards and their heart reveals change. */
export function StandoutsAnimatedIcon({animate, reduced}: {animate: boolean; reduced: boolean}) {
  const phase = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {phase.setValue(0); return;}
    if (!animate) return;
    phase.setValue(0);
    const loop = Animated.loop(Animated.timing(phase, {
      toValue: 2, duration: STANDOUTS_SELECTION_MS * 2, easing: Easing.linear,
      useNativeDriver: true, isInteraction: false,
    }));
    loop.start();
    return () => {loop.stop(); phase.stopAnimation();};
  }, [animate, reduced, phase]);

  // Two fixed layers avoid animating zIndex or sending per-frame updates to JS.
  const card = (index: number, front: boolean) => {
    const path = STANDOUTS_CARD_PATHS[index];
    const frontLevels = STANDOUTS_FRONT_LAYERS[index];
    return <Animated.View key={`${index}-${front}`} testID={`standouts-card-${index}-${front ? 'front' : 'back'}`}
      style={[styles.card, {
        zIndex: front ? 2 : 1,
        backgroundColor: index === 0 ? '#30242B' : '#38342B',
        opacity: phase.interpolate({inputRange: STANDOUTS_LAYER_STEPS,
          outputRange: front ? frontLevels : frontLevels.map(value => (1 - value) * 0.68)}),
        transform: [
          {translateX: phase.interpolate({inputRange: STANDOUTS_MOTION_STEPS, outputRange: path.x})},
          {translateY: phase.interpolate({inputRange: STANDOUTS_MOTION_STEPS, outputRange: path.y})},
          {rotate: phase.interpolate({inputRange: STANDOUTS_MOTION_STEPS, outputRange: path.rotation})},
        ],
      }]}>
      <Animated.View testID={`standouts-heart-${index}-${front ? 'front' : 'back'}`}
        style={{opacity: phase.interpolate({inputRange: STANDOUTS_MOTION_STEPS, outputRange: path.heart})}}>
        <Svg width={44} height={44} viewBox="10 10 12.5 12.5" accessible={false}>
          <Path d={STANDOUTS_HEART_PATH} fill="#F2BDC9" />
        </Svg>
      </Animated.View>
    </Animated.View>;
  };
  return <View style={styles.frame} testID="standouts-loading-icon" pointerEvents="none"
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {[card(0, false), card(1, false), card(0, true), card(1, true)]}
  </View>;
}

const styles = StyleSheet.create({
  frame: {...STANDOUTS_ICON_FRAME},
  card: {position: 'absolute', left: 0, top: 0, ...STANDOUTS_CARD_SIZE,
    borderWidth: 3.5, borderRadius: 12.5, borderColor: '#E8C698', alignItems: 'center', justifyContent: 'center'},
});
