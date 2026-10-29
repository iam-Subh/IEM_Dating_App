import React, { useLayoutEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useActivityDemo } from './useActivityDemo';
import { countNotifications, type Unread } from './notificationModel';

export function ExploreActivityButton({ unread, onPress }: { unread: Unread; onPress: () => void }) {
  const demo = useActivityDemo();
  const activity = demo.enabled ? countNotifications(demo.items) : unread;
  return <Pressable onPress={onPress} hitSlop={4} accessibilityRole="button"
      accessibilityLabel={`Notifications${activity.total ? `, ${activity.total} unread` : ''}${demo.enabled ? ', demo' : ''}`}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
    <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
    <UnreadCounter total={activity.total} arrivalId={demo.enabled ? demo.latestId : null} />
  </Pressable>;
}

function UnreadCounter({ total, arrivalId }: { total: number; arrivalId: string | null }) {
  const previous = useRef({ total: 0, arrivalId: null as string | null });
  const lastTotal = useRef(total);
  if (total > 0) lastTotal.current = total;
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.75);
  useLayoutEffect(() => {
    const timing = { duration: 150, easing: Easing.out(Easing.cubic) };
    opacity.value = withTiming(total > 0 ? 1 : 0, timing);
    if (total === 0) scale.value = withTiming(0.75, timing);
    else if (previous.current.total === 0) scale.value = withTiming(1, timing);
    else if (total > previous.current.total || (arrivalId && arrivalId !== previous.current.arrivalId)) {
      scale.value = withSequence(withTiming(1.12, { ...timing, duration: 80 }), withTiming(1, timing));
    } else scale.value = withTiming(1, timing);
    previous.current = { total, arrivalId };
  }, [total, arrivalId, opacity, scale]);
  const motion = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
    style={[styles.counter, motion]}>
    <Text numberOfLines={1} style={styles.count}>{lastTotal.current > 99 ? '99+' : lastTotal.current}</Text>
  </Animated.View>;
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#242323' },
  pressed: { backgroundColor: '#363433' },
  counter: { position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10,
    paddingHorizontal: 4, borderWidth: 2, borderColor: '#100F0D', backgroundColor: '#FF4F69',
    alignItems: 'center', justifyContent: 'center' },
  count: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 11, lineHeight: 14, textAlign: 'center', includeFontPadding: false },
});
