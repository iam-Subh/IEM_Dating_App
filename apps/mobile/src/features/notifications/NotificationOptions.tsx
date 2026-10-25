import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { Easing, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

export type NotificationMenuAction = {
  text: string;
  onPress: () => void;
  style?: "destructive";
};

export function NotificationReveal({ expanded, expandedValue, children, contentStyle }: {
  expanded: boolean;
  expandedValue?: SharedValue<boolean>;
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const contentHeight = useSharedValue(0);
  // Keep the parent stack's height in step with an expanding child card.
  const progress = useDerivedValue(() => withTiming((expandedValue?.value ?? expanded) ? 1 : 0, {
    duration: 180, easing: Easing.out(Easing.cubic),
  }));
  const bodyMotion = useAnimatedStyle(() => ({ height: contentHeight.value * progress.value }));
  const contentMotion = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  return (
    <Animated.View style={[styles.reveal, bodyMotion]} pointerEvents={expanded ? "auto" : "none"}
      accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}>
      <Animated.View style={[styles.children, contentStyle, contentMotion]}
        onLayout={(event) => { contentHeight.value = event.nativeEvent.layout.height; }}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

export function NotificationOptions({ expanded, actions, onClose }: {
  expanded: boolean;
  actions: NotificationMenuAction[];
  onClose: () => void;
}) {
  return (
    <NotificationReveal expanded={expanded} contentStyle={styles.optionsContent}>
      <View style={styles.options}>
        {actions.map((action) => (
          <Pressable key={action.text}
            onPress={() => { onClose(); action.onPress(); }}
            accessibilityRole="button" accessibilityLabel={action.text}
            style={({ pressed }) => [styles.option, action.style === "destructive" && styles.optionRemove, pressed && styles.pressed]}>
            <Ionicons name={action.style === "destructive" ? "trash-outline" : action.text === "Mark as read" ? "mail-open-outline" : "mail-outline"}
              size={15} color={action.style === "destructive" ? "#FFADB6" : "#EDE8F0"} />
            <Text style={[styles.optionText, action.style === "destructive" && styles.optionRemoveText]}>{action.text}</Text>
          </Pressable>
        ))}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close notification options"
          style={({ pressed }) => [styles.optionClose, pressed && styles.pressed]}>
          <Ionicons name="close" size={17} color="#C3BDC8" />
        </Pressable>
      </View>
    </NotificationReveal>
  );
}

const styles = StyleSheet.create({
  reveal: { overflow: "hidden" },
  children: { position: "absolute", top: 0, left: 0, right: 0, paddingLeft: 16, paddingRight: 10, paddingBottom: 8 },
  optionsContent: { paddingLeft: 10, paddingRight: 10, paddingBottom: 10 },
  options: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 32, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: "#353036" },
  optionText: { color: "#EDE8F0", fontSize: 12, fontWeight: "600" },
  optionRemove: { backgroundColor: "#43252C" },
  optionRemoveText: { color: "#FFADB6" },
  optionClose: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#302A30", marginLeft: "auto" },
  pressed: { opacity: 0.75 },
});
