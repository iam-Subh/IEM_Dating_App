import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function UndoSwipeButton({ seconds, name, onPress }: {
  seconds: number;
  name?: string;
  onPress: () => void;
}) {
  const available = seconds > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={available ? `Undo your swipe${name ? ` on ${name}` : ""}, ${seconds} seconds left` : "Undo last swipe"}
      accessibilityState={{ disabled: !available }}
      accessibilityHint={available ? "Bring the previous profile back." : "Swipe a profile to enable Undo."}
      disabled={!available}
      unstable_pressDelay={0}
      onPress={onPress}
      style={({ pressed }) => [styles.button, available && styles.available, pressed && styles.pressed]}
    >
      <Ionicons name="arrow-undo" size={24} color={available ? "#F2C98C" : "#807B74"} />
      {available ? (
        <Text style={styles.seconds} accessible={false}>{seconds}s</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#24211E",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  available: { backgroundColor: "#382D21" },
  pressed: { backgroundColor: "#493825", transform: [{ scale: 0.96 }] },
  seconds: { color: "#E8C99D", fontSize: 11, lineHeight: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
