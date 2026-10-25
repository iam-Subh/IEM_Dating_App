import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../core/theme/colors";
import type { GateKind, LocationStatus } from "./useLocationGate";

type Props = {
  kind: Exclude<GateKind, "none">;
  status: LocationStatus | null;
  busy: boolean;
  error: string;
  canDismiss: boolean;
  onTurnOn: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onUsePlace: (placeId: string) => void;
  onSwitchToCollege: () => void;
  onDismiss: () => void;
};

const COPY: Record<Props["kind"], { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }> = {
  explain: {
    icon: "navigate-circle-outline",
    title: "Find people near you",
    body:
      "Distance discovery uses your location while the app is open - never in the background.\n\n" +
      "Approximate location is all it needs. If you allow precise location, your phone rounds it to about 2 km before sending, so an exact position never leaves it.\n\n" +
      "Others only ever see a distance band like \"5-10 km away\", never where you are.",
  },
  off: {
    icon: "location-outline",
    title: "Location is off",
    body: "Turn it on to see and be seen by people near you. Your chats and matches work either way.",
  },
  settings: {
    icon: "settings-outline",
    title: "Location is off",
    body:
      "Your phone won't show the permission prompt again for this app. Open settings, tap Location, and choose \"Allow only while using the app\". Approximate is enough.",
  },
  refresh: {
    icon: "refresh-circle-outline",
    title: "Couldn't update your location",
    body: "Distance discovery needs a location from the last two weeks. Check that your phone's location is on, then try again.",
  },
};

/**
 * Shown in place of the deck in distance mode when there is no usable
 * location (LOCATION_SPEC.md 6.1). It is the only thing that ever shows the
 * system permission dialog, and only on a tap.
 */
export function LocationGate(props: Props) {
  const copy = COPY[props.kind];
  const usablePlaces = (props.status?.places ?? []).filter((place) => !place.hideHere);
  const body = copy.body;
  const primary =
    props.kind === "settings"
      ? { label: "Open settings", onPress: props.onOpenSettings }
      : props.kind === "refresh"
        ? { label: "Try again", onPress: props.onRetry }
        : { label: props.kind === "explain" ? "Continue" : "Turn on location", onPress: props.onTurnOn };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.iconCircle}>
        <Ionicons name={copy.icon} size={34} color={colors.primary} />
      </View>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{body}</Text>
      {!!props.error && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {props.error}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={props.busy}
        onPress={primary.onPress}
        style={({ pressed }) => [styles.primary, (pressed || props.busy) && styles.pressed]}
      >
        {props.busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{primary.label}</Text>}
      </Pressable>

      {usablePlaces.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Or appear from a saved place</Text>
          {usablePlaces.map((place) => (
            <Pressable
              key={place.id}
              accessibilityRole="button"
              accessibilityLabel={`Use ${place.label}`}
              disabled={props.busy}
              onPress={() => props.onUsePlace(place.id)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Ionicons name="bookmark-outline" size={18} color="#fff" />
              <Text style={styles.optionText}>{place.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={props.busy}
        onPress={props.onSwitchToCollege}
        style={({ pressed }) => [styles.option, styles.spaced, pressed && styles.pressed]}
      >
        <Ionicons name="school-outline" size={18} color="#fff" />
        <Text style={styles.optionText}>Use college mode instead (no location needed)</Text>
      </Pressable>

      {props.canDismiss && props.kind !== "refresh" && (
        <Pressable accessibilityRole="button" onPress={props.onDismiss} style={styles.link}>
          <Text style={styles.linkText}>Not now - keep my last location</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Compact: the gate sits in the deck's area, not the whole screen, and a
  // roomier layout ran past it - the last option showed cut in half.
  container: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 12 },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,90,95,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "700", textAlign: "center" },
  body: { color: "#B8B8C0", fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8 },
  error: { color: "#FF8A8A", fontSize: 13, textAlign: "center", marginTop: 12 },
  primary: {
    marginTop: 18,
    alignSelf: "stretch",
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  section: { alignSelf: "stretch", marginTop: 16, gap: 8 },
  sectionTitle: { color: "#8E8E96", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 },
  option: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#1F1F24",
  },
  spaced: { marginTop: 10 },
  optionText: { color: "#fff", fontSize: 14, flex: 1 },
  link: { marginTop: 18, padding: 8 },
  linkText: { color: "#8E8E96", fontSize: 13 },
  pressed: { opacity: 0.8 },
});
