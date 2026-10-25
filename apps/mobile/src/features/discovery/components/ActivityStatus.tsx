import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * "Active now" / "Recently active" on a card. The server sends only the band
 * (never a time) and leaves it out when either person keeps theirs private.
 */
export type Activity = "now" | "recent" | null | undefined;

export function activityLabel(activity: Activity) {
  return activity === "now" ? "Active now" : activity === "recent" ? "Recently active" : null;
}

/** A pill for photo cards: readable on any photo. */
export function ActivityPill({ activity, compact = false }: { activity: Activity; compact?: boolean }) {
  const label = activityLabel(activity);
  if (!label) return null;
  return (
    <View style={[styles.pill, compact && styles.pillCompact]} accessible accessibilityLabel={label}>
      <View style={[styles.pillDot, activity === "recent" && styles.dotRecent]} />
      <Text style={[styles.pillText, compact && styles.pillTextCompact]}>{label}</Text>
    </View>
  );
}

/** A dot and words, for a line of text such as under a name. */
export function ActivityLine({ activity, compact = false }: { activity: Activity; compact?: boolean }) {
  const label = activityLabel(activity);
  if (!label) return null;
  return (
    <View style={[styles.line, compact && styles.lineCompact]} accessible accessibilityLabel={label}>
      <View style={[styles.dot, compact && styles.dotCompact, activity === "recent" && styles.dotRecent]} />
      <Text style={[styles.lineText, compact && styles.lineTextCompact, activity === "recent" && styles.lineTextRecent]}>{label}</Text>
    </View>
  );
}

const GREEN = "#3DDC84";
const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    backgroundColor: "rgba(24,27,25,0.92)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)",
  },
  pillCompact: { paddingHorizontal: 8, paddingVertical: 4, gap: 5 },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#6BE5A0" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN },
  dotRecent: { backgroundColor: "#8FD9AE" },
  pillText: { color: "#F6FFF9", fontFamily: "DMSans_500Medium", fontSize: 12, lineHeight: 16 },
  pillTextCompact: { fontSize: 10, lineHeight: 14 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  lineText: { color: GREEN, fontFamily: "DMSans_500Medium", fontSize: 12 },
  lineTextRecent: { color: "#8FD9AE" },
  lineCompact: {gap: 5},
  dotCompact: {width: 6, height: 6, borderRadius: 3},
  lineTextCompact: {fontSize: 10, lineHeight: 14},
});
