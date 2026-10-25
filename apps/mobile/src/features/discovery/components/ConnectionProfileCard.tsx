import React, { useRef } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { CardOrigin, ExploreProfile } from "./ExploreProfileCard";
import { VerifiedBadge } from "./VerifiedBadge";
import { ActivityLine, ActivityPill } from "./ActivityStatus";
import { sharedInterestLabels } from "./profile-detail/ProfileDetailModal";
import { profileInterestEmoji } from "../../../components/ProfileContentSections";

/** Photo surface for Standouts and incoming Likes. No distance; activity only as a band. */
export function ConnectionProfileCard({ profile, large = false, activityInsetTop = 12, activityPlacement = 'top', onOpen }: {
  profile: ExploreProfile;
  large?: boolean;
  /** Reserve the first corner row for incoming Like labels. */
  activityInsetTop?: number;
  activityPlacement?: 'top' | 'identity';
  onOpen: (profile: ExploreProfile, origin?: CardOrigin) => void;
}) {
  const photo = useRef<View>(null);
  const interest = sharedInterestLabels(profile)[0];
  return (
    <Pressable
      ref={photo}
      accessibilityRole="button"
      accessibilityLabel={`View ${profile.name}'s profile`}
      onPress={() => {
        if (!photo.current) return onOpen(profile);
        photo.current.measureInWindow((x, y, width, height) => onOpen(profile, { x, y, width, height }));
      }}
      style={[styles.photo, large && styles.largePhoto]}
    >
      {profile.primaryPhoto ? (
        <Image source={{ uri: profile.primaryPhoto }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} />
      ) : (
        <View style={styles.fallback}><Ionicons name="person-outline" size={44} color="#B7B2AD" /></View>
      )}
      <LinearGradient pointerEvents="none" colors={["transparent", "rgba(0,0,0,0.84)"]} style={styles.shade} />
      {activityPlacement === 'top' && <View pointerEvents="none" style={[styles.activity, { top: activityInsetTop }]}>
        <ActivityPill activity={profile.activity} compact={!large} />
      </View>}
      <View pointerEvents="none" style={[styles.identity, large && styles.largeIdentity]}>
        {activityPlacement === 'identity' && !!profile.activity && <View style={styles.identityActivity}>
          <ActivityLine activity={profile.activity} compact={!large}/>
        </View>}
        <View style={styles.nameRow}>
          <Text numberOfLines={2} style={[styles.name, large && styles.largeName]}>{profile.name}{profile.age ? `, ${profile.age}` : ""}</Text>
          {profile.blueBadge && <VerifiedBadge />}
        </View>
        <Text numberOfLines={large ? 2 : 1} style={[styles.detail, large && styles.largeDetail]}>
          {interest ? `You both like ${profileInterestEmoji(interest)} ${interest}` : profile.department || profile.seeking || "View profile"}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  photo: { width: "100%", aspectRatio: 0.76, borderRadius: 20, overflow: "hidden", backgroundColor: "#302D2A" },
  largePhoto: { aspectRatio: 1.05, borderRadius: 24 },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  shade: { position: "absolute", bottom: 0, left: 0, right: 0, height: "55%" },
  activity: { position: "absolute", left: 12, right: 12, alignItems: "flex-start" },
  identity: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 12 },
  largeIdentity: { padding: 20 },
  identityActivity: {marginBottom: 5},
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { flexShrink: 1, color: "#FFFFFF", fontFamily: "DMSans_700Bold", fontSize: 17 },
  largeName: { fontSize: 27 },
  detail: { color: "#E7E1DC", fontFamily: "DMSans_400Regular", fontSize: 11, lineHeight: 16, marginTop: 3 },
  largeDetail: { fontSize: 13, lineHeight: 18, marginTop: 5 },
});
