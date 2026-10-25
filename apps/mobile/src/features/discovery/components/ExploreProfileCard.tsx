import React, { useRef } from "react";
import { Image, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { DiscoveryCard } from "@iem-dating/shared";
import { colors } from "../../../core/theme/colors";
import { sharedInterestLabels } from "./profile-detail/ProfileDetailModal";
import { placeLine } from "../../location/cardLabels";
import { ActivityPill } from "./ActivityStatus";
import { profileInterestEmoji } from "../../../components/ProfileContentSections";

export type ExploreProfile = DiscoveryCard & {
  followStatus: "pending" | "accepted" | null;
};
export type CardOrigin = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function ExploreProfileCard({
  profile,
  onOpen,
  style,
}: {
  profile: ExploreProfile;
  onOpen: (profile: ExploreProfile, origin?: CardOrigin) => void;
  /** Overrides the grid sizing, e.g. for a fixed-width preview strip. */
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<View>(null);
  const sharedInterest = sharedInterestLabels(profile)[0];
  const open = () => {
    if (!ref.current) return onOpen(profile);
    ref.current.measureInWindow((x, y, width, height) =>
      onOpen(profile, { x, y, width, height }),
    );
  };
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={`View ${profile.name}'s profile`}
      onPress={open}
      style={[styles.card, style]}
    >
      {profile.primaryPhoto ? (
        <Image
          accessible
          accessibilityLabel={`${profile.name}'s profile photo`}
          source={{ uri: profile.primaryPhoto }}
          style={styles.photo}
          resizeMode="cover"
          fadeDuration={0}
        />
      ) : (
        <View style={[styles.photo, styles.missingPhoto]}>
          <Ionicons name="person-outline" size={46} color="#777780" />
        </View>
      )}
      <LinearGradient
        pointerEvents="none"
        colors={["transparent", "rgba(0,0,0,0.92)"]}
        style={styles.gradient}
      />
      <View pointerEvents="none" style={styles.activity}>
        <ActivityPill activity={profile.activity} compact />
      </View>
      <View pointerEvents="none" style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>
          {profile.name}
          {profile.age ? `, ${profile.age}` : ""}{" "}
          {profile.blueBadge ? (
            <Ionicons
              name="checkmark-circle"
              size={15}
              color={colors.primary}
            />
          ) : null}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {sharedInterest
            ? `You both like ${profileInterestEmoji(sharedInterest)} ${sharedInterest}`
            : (profile.seeking ?? profile.department ?? "View profile")}
        </Text>
        {!!placeLine(profile) && (
          <Text style={styles.meta} numberOfLines={1}>
            {placeLine(profile)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    maxWidth: "50%",
    aspectRatio: 0.7,
    backgroundColor: "#27272D",
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photo: { width: "100%", height: "100%", backgroundColor: "#27272D" },
  missingPhoto: { alignItems: "center", justifyContent: "center" },
  gradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "52%",
  },
  info: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 12 },
  activity: { position: "absolute", top: 10, left: 10, right: 10, alignItems: "flex-start" },
  name: { color: colors.text.primary, fontSize: 17, fontWeight: "700" },
  meta: { color: "#DEDEE4", fontSize: 12, marginTop: 5 },
});
