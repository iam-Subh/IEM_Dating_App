import React from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

export function SwipeDecisionStamps({
  cardId,
  owner,
  dragX,
  width,
}: {
  cardId: string;
  owner: SharedValue<string>;
  dragX: SharedValue<number>;
  width: number;
}) {
  const like = useAnimatedStyle(() => ({
    opacity:
      owner.value === cardId
        ? Math.max(0, Math.min(1, dragX.value / (width / 6)))
        : 0,
  }));
  const nope = useAnimatedStyle(() => ({
    opacity:
      owner.value === cardId
        ? Math.max(0, Math.min(1, -dragX.value / (width / 6)))
        : 0,
  }));
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.stamp,
          { left: 24, transform: [{ rotate: "-15deg" }] },
          like,
        ]}
      >
        <Text
          style={[styles.text, { color: "#00E676", borderColor: "#00E676" }]}
        >
          LIKE
        </Text>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.stamp,
          { right: 24, transform: [{ rotate: "15deg" }] },
          nope,
        ]}
      >
        <Text
          style={[styles.text, { color: "#FF1744", borderColor: "#FF1744" }]}
        >
          NOPE
        </Text>
      </Animated.View>
    </>
  );
}
const styles = StyleSheet.create({
  stamp: {
    opacity: 0,
    position: "absolute",
    top: 50,
    zIndex: 999,
    padding: 10,
  },
  text: {
    fontSize: 36,
    fontWeight: "900",
    borderWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    letterSpacing: 3,
    overflow: "hidden",
  },
});
