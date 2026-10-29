import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

/**
 * Filled comment-text glyph from Material Design Icons.
 */
export function CommentMark({ size = 20, color = "#fff" }: { size?: number; color?: string }) {
  return <MaterialCommunityIcons name="comment-text" size={size} color={color}/>;
}

/**
 * A comment and pencil identify the action for writing a comment.
 */
export function CommentButton({ onPress, label, variant = "photo" }: { onPress: () => void; label: string; variant?: "photo" | "section" }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={variant === "section" ? 8 : 4}
      style={({ pressed }) => [variant === "photo" ? styles.photo : styles.section, pressed && styles.pressed]}>
      <MaterialCommunityIcons name="comment-edit" size={variant === "photo" ? 23 : 20} color="#F6D7C7"/>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(35,29,31,0.92)",
  },
  section: {
    width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#373035",
  },
  pressed: { opacity: 0.8, transform: [{ scale: 0.94 }] },
});
