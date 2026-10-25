import React, { useEffect } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
// Native gesture hit testing follows the sheet's animated transform on Android.
import { Gesture, GestureDetector, GestureHandlerRootView, Pressable } from "react-native-gesture-handler";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type LikesSort = "recent" | "type";

const OPTIONS = [
  { value: "recent", label: "Recent", detail: "Newest likes first", icon: "time-outline" },
  { value: "type", label: "Your type", detail: "Ordered by profile compatibility", icon: "sparkles-outline" },
] as const;
const OPEN = { duration: 230, easing: Easing.out(Easing.cubic) };
const CLOSE = { duration: 180, easing: Easing.in(Easing.cubic) };

export function LikesSortSheet({ visible, selected, onSelect, onClose }: {
  visible: boolean;
  selected: LikesSort;
  onSelect: (value: LikesSort) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const sheetHeight = useSharedValue(280);
  const dragStart = useSharedValue(1);
  const closing = useSharedValue(false);

  useEffect(() => {
    if (!visible) return;
    closing.value = false;
    progress.value = 0;
    progress.value = withTiming(1, OPEN);
  }, [visible, closing, progress]);

  const dismiss = () => {
    if (closing.value) return;
    closing.value = true;
    progress.value = withTiming(0, CLOSE, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  };
  const drag = Gesture.Pan().activeOffsetY([-8, 8])
    .onStart(() => { dragStart.value = progress.value; })
    .onUpdate((event) => {
      if (!closing.value) progress.value = Math.min(1, Math.max(0, dragStart.value - event.translationY / sheetHeight.value));
    })
    .onEnd((event) => {
      if (closing.value) return;
      if (progress.value < 0.7 || event.velocityY > 500) {
        closing.value = true;
        progress.value = withTiming(0, CLOSE, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else progress.value = withTiming(1, OPEN);
    })
    .onFinalize((_event, success) => {
      if (!success && !closing.value) progress.value = withTiming(1, OPEN);
    });
  const sheetMotion = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * sheetHeight.value }] }));
  const backdropMotion = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={dismiss}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropMotion]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close sort options" />
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 10) }, sheetMotion]}
          onLayout={(event) => { sheetHeight.value = event.nativeEvent.layout.height; }} accessibilityViewIsModal>
          <GestureDetector gesture={drag}>
            <View collapsable={false}>
              <View style={styles.handleArea}><View style={styles.handle} /></View>
              <View style={styles.header}>
                <Text style={styles.title} accessibilityRole="header">Sort Likes</Text>
                <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close sort options"
                  style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
                  <Ionicons name="close" size={18} color="#EDE5EA" />
                </Pressable>
              </View>
            </View>
          </GestureDetector>
          <View accessibilityRole="radiogroup" accessibilityLabel="Sort Likes" style={styles.options}>
            {OPTIONS.map((option) => (
              <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected === option.value }}
                onPress={() => {
                  if (closing.value) return;
                  onSelect(option.value);
                  dismiss();
                }}
                style={({ pressed }) => [styles.option, selected === option.value && styles.optionSelected, pressed && styles.pressed]}>
                <Ionicons name={option.icon} size={22} color={selected === option.value ? "#F3C1CA" : "#BDB3BB"} />
                <View style={styles.optionBody}>
                  <Text style={styles.optionTitle}>{option.label}</Text>
                  <Text style={styles.optionDetail}>{option.detail}</Text>
                </View>
                <View style={[styles.check, selected === option.value && styles.checkSelected]}>
                  {selected === option.value && <Ionicons name="checkmark" size={15} color="#331C23" />}
                </View>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  backdrop: { backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { width: "100%", maxWidth: 600, backgroundColor: "#211E22", borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  handleArea: { height: 22, alignItems: "center", justifyContent: "center" },
  handle: { width: 34, height: 4, borderRadius: 2, backgroundColor: "#625860" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 8 },
  title: { color: "#FFFFFF", fontFamily: "DMSans_700Bold", fontSize: 21 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#332D33", alignItems: "center", justifyContent: "center" },
  options: { paddingHorizontal: 12, gap: 4 },
  option: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 18 },
  optionSelected: { backgroundColor: "#34272F" },
  optionBody: { flex: 1 },
  optionTitle: { color: "#FFFFFF", fontFamily: "DMSans_700Bold", fontSize: 15 },
  optionDetail: { color: "#BDB3BB", fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 17, marginTop: 3 },
  check: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#433A42", alignItems: "center", justifyContent: "center" },
  checkSelected: { backgroundColor: "#F3C1CA" },
  pressed: { opacity: 0.75 },
});
