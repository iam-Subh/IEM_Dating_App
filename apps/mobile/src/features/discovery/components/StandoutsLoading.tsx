import React, {useEffect, useRef, useState} from 'react';
import {Animated, StyleSheet} from 'react-native';
import {StandoutsAnimatedIcon} from './StandoutsAnimatedIcon';
import {useSearchMotion} from './ProfileSearchLoading';

/** Cards select and reveal their hearts while a request runs, then fade out. */
export function StandoutsLoading({loading, active = true}: {loading: boolean; active?: boolean}) {
  const [visible, setVisible] = useState(loading);
  const opacity = useRef(new Animated.Value(loading ? 1 : 0)).current;
  const preference = useSearchMotion();

  useEffect(() => {
    opacity.stopAnimation();
    if (loading) {
      setVisible(true);
      opacity.setValue(1);
      return;
    }
    const fade = Animated.timing(opacity, {toValue: 0, duration: preference.reduced ? 0 : 180, useNativeDriver: true});
    fade.start(({finished}) => {if (finished) setVisible(false);});
    return () => fade.stop();
  }, [loading, opacity, preference.reduced]);

  if (!loading && !visible) return null;
  return <Animated.View testID="standouts-loading" style={[styles.cover, {opacity}]}
    accessible accessibilityRole="progressbar" accessibilityLabel="Loading Standouts" accessibilityLiveRegion="polite">
    <StandoutsAnimatedIcon animate={loading && active && preference.active} reduced={preference.reduced} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  cover: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 10, backgroundColor: '#100F0D', alignItems: 'center', justifyContent: 'center'},
});
