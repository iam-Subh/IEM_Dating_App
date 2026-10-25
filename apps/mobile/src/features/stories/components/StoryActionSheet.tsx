import React, { useCallback, useContext, useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';

export type StoryAction = { label: string; destructive?: boolean; onPress: () => void };

/**
 * A Material 3 modal bottom sheet of actions (the ⋯ on a Story, or on a viewer
 * in Activity): a 32% scrim that fades in, the sheet sliding up on M3's
 * emphasized curve, a drag handle, 56dp rows. Tapping outside, back, or
 * dragging it down closes it. The choice runs once the sheet has gone, so a
 * menu that opens an alert or another sheet never stacks on a closing one.
 */
const SURFACE_CONTAINER_LOW = '#1D1B20';
const ON_SURFACE = '#E6E0E9';
const ON_SURFACE_VARIANT = '#CAC4D0';
const ERROR = '#F2B8B5';
const OPEN = { duration: 400, easing: Easing.bezier(0.05, 0.7, 0.1, 1) };
const CLOSE = { duration: 200, easing: Easing.bezier(0.3, 0, 0.8, 0.15) };

export function StoryActionSheet({ title, actions, onClose }: { title?: string; actions: StoryAction[]; onClose: () => void }) {
  // The Story viewer can itself be a Modal (the demo), outside the provider.
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const { height } = useWindowDimensions();
  const shift = useSharedValue(height);
  const scrim = useSharedValue(0);
  const closing = useRef(false);

  useEffect(() => {
    shift.value = withTiming(0, OPEN);
    scrim.value = withTiming(1, { duration: 200 });
  }, [scrim, shift]);

  const finish = useCallback((after?: () => void) => {
    onClose();
    after?.();
  }, [onClose]);
  const dismiss = useCallback((after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    scrim.value = withTiming(0, CLOSE);
    shift.value = withTiming(height, CLOSE, (done) => { if (done) runOnJS(finish)(after); });
  }, [finish, height, scrim, shift]);

  const drag = Gesture.Pan()
    .onUpdate((event) => { shift.value = Math.max(0, event.translationY); })
    .onEnd((event) => {
      if (event.translationY > 80 || event.velocityY > 500) runOnJS(dismiss)(undefined);
      else shift.value = withTiming(0, OPEN);
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: shift.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  return (
    <Modal transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => dismiss()}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          <Pressable accessibilityLabel="Close menu" style={StyleSheet.absoluteFill} onPress={() => dismiss()} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }, sheetStyle]}>
          <GestureDetector gesture={drag}>
            <View collapsable={false} style={styles.handleArea} accessible accessibilityRole="adjustable" accessibilityLabel="Drag down to close">
              <View style={styles.handle} />
            </View>
          </GestureDetector>
          {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              onPress={() => dismiss(action.onPress)}
              android_ripple={{ color: 'rgba(230,224,233,0.12)' }}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Text style={[styles.label, action.destructive && styles.destructive]}>{action.label}</Text>
            </Pressable>
          ))}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: { alignSelf: 'center', width: '100%', maxWidth: 640, backgroundColor: SURFACE_CONTAINER_LOW, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  handleArea: { height: 36, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 32, height: 4, borderRadius: 2, backgroundColor: ON_SURFACE_VARIANT, opacity: 0.4 },
  title: { color: ON_SURFACE_VARIANT, fontSize: 14, fontWeight: '500', paddingHorizontal: 24, paddingTop: 4, paddingBottom: 12 },
  action: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 24 },
  pressed: { backgroundColor: 'rgba(230,224,233,0.08)' },
  label: { color: ON_SURFACE, fontSize: 16 },
  destructive: { color: ERROR },
});
