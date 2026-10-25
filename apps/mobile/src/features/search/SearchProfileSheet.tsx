import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const spring = { damping: 30, stiffness: 300, overshootClamping: true };

const HANDLE_HEIGHT = 32;

/** The sheet fits its content. Dragging down closes it; dragging up cannot expand it. */
export function SearchProfileSheet({ visible, onClose, interceptBack, children }: {
  visible: boolean;
  onClose: () => void;
  interceptBack?: () => boolean;
  children: (close: () => void, onContentLayout: (event: LayoutChangeEvent) => void) => React.ReactNode;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [contentHeight, setContentHeight] = useState(420);
  const restingTop = Math.max(insets.top + 20, height - contentHeight - HANDLE_HEIGHT);
  const top = useSharedValue(height);
  const start = useSharedValue(height);
  const closing = useSharedValue(false);
  useEffect(() => {
    cancelAnimation(top);
    closing.value = false;
    top.value = height;
    if (visible) top.value = withSpring(restingTop, spring);
  }, [visible, height, top, closing]);
  useEffect(() => {
    if (visible && !closing.value) top.value = withSpring(restingTop, spring);
  }, [visible, restingTop, top, closing]);
  const onContentLayout = useCallback((event: LayoutChangeEvent) => {
    const measuredHeight = Math.ceil(event.nativeEvent.layout.height);
    setContentHeight(current => Math.abs(current - measuredHeight) > 1 ? measuredHeight : current);
  }, []);
  const close = useCallback(() => {
    if (closing.value) return;
    closing.value = true;
    top.value = withTiming(height, { duration: 220 }, finished => {
      if (finished) runOnJS(onClose)();
    });
  }, [height, onClose, top, closing]);
  const drag = Gesture.Pan().onStart(() => {
    if (closing.value) return;
    cancelAnimation(top);
    start.value = top.value;
  }).onUpdate(event => {
    if (!closing.value) top.value = Math.max(restingTop, Math.min(height, start.value + event.translationY));
  }).onEnd(event => {
    if (closing.value) return;
    const projected = top.value + event.velocityY * 0.16;
    if (projected > restingTop + 110) {
      closing.value = true;
      top.value = withTiming(height, { duration: 220 }, finished => {
        if (finished) runOnJS(onClose)();
      });
    } else {
      top.value = withSpring(restingTop, spring);
    }
  }).onFinalize((_event, success) => {
    if (!success && !closing.value) top.value = withSpring(restingTop, spring);
  });
  const position = useAnimatedStyle(() => ({ top: top.value }));
  const scrim = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(0.6, (height - top.value) / (height - restingTop) * 0.6)) }));
  return <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={() => {
    if (!interceptBack?.()) close();
  }}>
    <GestureHandlerRootView style={styles.root}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.scrim, scrim]} />
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close profile" />
      <Animated.View style={[styles.sheet, position]}>
        <GestureDetector gesture={drag}>
          <View collapsable={false} style={styles.handleArea} accessible accessibilityRole="button"
            accessibilityLabel="Close profile" accessibilityHint="Swipe down to close."
            onAccessibilityTap={close}
            accessibilityActions={[{ name: "activate", label: "Close" }, { name: "escape", label: "Close" }]}
            onAccessibilityAction={event => {
              const action = event.nativeEvent.actionName;
              if (action === "escape" || action === "activate") close();
            }}>
            <View style={styles.handle} />
          </View>
        </GestureDetector>
        {children(close, onContentLayout)}
      </Animated.View>
    </GestureHandlerRootView>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { backgroundColor: "#000000" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#100F0D", borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  handleArea: { height: HANDLE_HEIGHT, alignItems: "center", justifyContent: "center" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#656569" },
});
