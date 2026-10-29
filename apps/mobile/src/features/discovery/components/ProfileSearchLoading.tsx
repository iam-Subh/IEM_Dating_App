import React, {useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, AppState, Easing, Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {profileSearchMessage, SEARCH_RING_DELAY, SEARCH_SLOW_DELAY, type ProfileSearchReason} from '../searchFeedback';
const INK = '#100F0D';

export function useSearchMotion(override?: boolean) {
  const [reduced, setReduced] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active' || AppState.currentState == null);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {if (live) setReduced(value);}).catch(() => undefined);
    const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const app = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => {live = false; preference.remove(); app.remove();};
  }, []);
  return {reduced: override ?? reduced, active};
}

export function SearchAvatar({uri, size}: {uri?: string | null; size: number}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return <View style={{width: size, height: size, borderRadius: size / 2, backgroundColor: '#302B2C', overflow: 'hidden', alignItems: 'center', justifyContent: 'center'}}>
    {uri && !failed ? <Image source={{uri}} style={{width: size, height: size}} onError={() => setFailed(true)} accessible={false}/>
      : <Ionicons name="person" size={size * 0.46} color="#D2BDC3"/>}
  </View>;
}

/** Two finite-width rings. Their native animations stop when loading stops. */
export function SearchPulse({avatarUri, animate, reduced}: {avatarUri?: string | null; animate: boolean; reduced: boolean}) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    a.setValue(0); b.setValue(0);
    if (!animate || reduced) return;
    const cycle = (value: Animated.Value) => Animated.loop(Animated.timing(value, {
      toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    }));
    const first = cycle(a);
    const second = Animated.sequence([Animated.delay(800), cycle(b)]);
    first.start(); second.start();
    return () => {first.stop(); second.stop(); a.stopAnimation(); b.stopAnimation();};
  }, [a, b, animate, reduced]);
  const ring = (value: Animated.Value, index: number) => <Animated.View key={index} testID={`search-ring-${index}`}
    style={[styles.ring, {opacity: value.interpolate({inputRange: [0, 0.15, 1], outputRange: [0.4, 0.34, 0], extrapolate: 'clamp'}),
      transform: [{scale: value.interpolate({inputRange: [0, 1], outputRange: [0.65, 2.35]})}]}]}/>;
  return <View style={styles.pulse} testID="profile-search-animation" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {animate && !reduced ? [ring(a, 1), ring(b, 2)] : animate && reduced ? <View style={styles.stillRing}/> : null}
    <View style={styles.avatarOutline}><SearchAvatar uri={avatarUri} size={64}/></View>
  </View>;
}

export function ProfileSearchLoading({avatarUri, reason = 'open', active = true, requestId = 0}: {avatarUri?: string | null; reason?: ProfileSearchReason; active?: boolean; requestId?: number}) {
  const [shown, setShown] = useState(false);
  const [slow, setSlow] = useState(false);
  const motion = useSearchMotion();
  useEffect(() => {
    // Keep already-visible rings moving when location hands over to profile search.
    setSlow(false);
    const ring = setTimeout(() => setShown(true), SEARCH_RING_DELAY);
    const warning = setTimeout(() => setSlow(true), SEARCH_SLOW_DELAY);
    return () => {clearTimeout(ring); clearTimeout(warning);};
  }, [requestId]);
  const message = profileSearchMessage(reason, slow);
  return <View style={styles.container} testID="real-profile-search" accessibilityLiveRegion="polite">
    <SearchPulse avatarUri={avatarUri} animate={shown && active && motion.active} reduced={motion.reduced}/>
    <Text style={styles.title}>{message.title}</Text><Text style={styles.detail}>{message.detail}</Text>
  </View>;
}

export function ProfileSearchError({message, onRetry}: {message: string; onRetry: () => void}) {
  return <View style={styles.container} accessibilityLiveRegion="polite">
    <View style={styles.errorIcon}><Ionicons name="cloud-offline-outline" size={36} color="#CFC2BF"/></View>
    <Text style={styles.title}>Couldn’t load profiles</Text><Text style={styles.detail}>{message}</Text>
    <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: {flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20},
  pulse: {width: 240, height: 240, alignItems: 'center', justifyContent: 'center'},
  ring: {position: 'absolute', width: 96, height: 96, left: 72, top: 72, borderWidth: 1.4, borderRadius: 48, borderColor: '#D9A4AE'},
  stillRing: {position: 'absolute', width: 104, height: 104, borderRadius: 52, borderWidth: 1, borderColor: '#5E434B'},
  avatarOutline: {borderRadius: 36, padding: 3, backgroundColor: INK, borderWidth: 1, borderColor: '#6B4F58'},
  title: {fontFamily: 'DMSans_700Bold', fontSize: 19, lineHeight: 26, color: '#F4EEEA', textAlign: 'center', marginTop: 4},
  detail: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 19, color: '#ACA3A1', textAlign: 'center', marginTop: 8},
  errorIcon: {width: 88, height: 88, borderRadius: 44, backgroundColor: '#242020', alignItems: 'center', justifyContent: 'center', marginBottom: 22},
  retry: {minHeight: 46, paddingHorizontal: 25, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAC4C8', marginTop: 24},
  retryText: {fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#35272C'},
});
