import React, { useCallback, useEffect, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../../services/api";
import { colors } from "../../../core/theme/colors";
import { PersonAvatar } from "../../search/PersonAvatar";

/**
 * What an empty chat opens with (Tinder's and Hinge's new-match screen): who
 * you matched with and when, what brought you together, and a few easy ways
 * to start. Also the Story ring on their photo - matches may watch each
 * other's Stories - and the choice a tap on that photo offers.
 */

export type StoryRing = { unseen: boolean; closeFriends: boolean; until: string } | null;
export type MatchIntroData = {
  matchId: string;
  matchedAt: string;
  other: { id: string; name: string; avatar: string | null; department: string | null };
  self?: { avatar: string | null };
  story: StoryRing;
  rose: { from: "me" | "them" } | null;
  sharedInterests: string[];
  openers: string[];
};

/** The intro, re-read on focus (a Story watched turns the ring grey); opening the chat marks the match seen. */
export function useMatchIntro(matchId: string) {
  const [intro, setIntro] = useState<MatchIntroData | null>(null);
  const refresh = useCallback(() => {
    api
      .get(`/match/${matchId}/intro`)
      .then((response) => setIntro(response.data.data as MatchIntroData))
      .catch(() => undefined);
  }, [matchId]);
  useFocusEffect(refresh);
  useEffect(() => {
    // The "new" dot in New matches goes on every device.
    api.post(`/match/${matchId}/seen`).catch(() => undefined);
  }, [matchId]);
  return { intro, refresh };
}

function matchedLabel(iso: string) {
  const at = new Date(iso);
  const days = Math.floor((Date.now() - at.getTime()) / (24 * 60 * 60_000));
  if (days <= 0) return "You matched today";
  if (days === 1) return "You matched yesterday";
  return `You matched on ${at.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
}

export function MatchIntroCard({
  intro,
  onPhoto,
  onSayHi,
  onOpener,
}: {
  intro: MatchIntroData;
  onPhoto: () => void;
  onSayHi: () => void;
  onOpener: (text: string) => void;
}) {
  const firstName = intro.other.name.split(/\s+/)[0];
  return (
    <Animated.View entering={FadeIn.duration(140)} style={styles.card} pointerEvents="box-none">
      <View style={styles.profileCard}>
        <View style={styles.profileRow}>
          <Pressable
            onPress={onPhoto}
            accessibilityRole="imagebutton"
            accessibilityLabel={intro.story ? `${intro.other.name}: watch their story or see their photo` : `See ${intro.other.name}'s photo`}
          >
            <PersonAvatar
              person={{ name: intro.other.name, avatarUrl: intro.other.avatar, story: intro.story }}
              size={72}
              background="#242124"
            />
          </Pressable>
          <View style={styles.profileCopy}>
            <View style={styles.matchLabel}>
              <Ionicons name="heart" size={11} color="#FFB8C7" />
              <Text style={styles.matchLabelText}>It's a match</Text>
            </View>
            <Text style={styles.name} numberOfLines={2}>{intro.other.name}</Text>
            <Text style={styles.when}>{matchedLabel(intro.matchedAt)}</Text>
          </View>
        </View>
        {(intro.rose || intro.sharedInterests.length > 0) && (
          <View style={styles.reasons}>
            {intro.rose && (
              <View style={[styles.reason, styles.reasonRose]}>
                <Ionicons name="rose" size={13} color="#FFB8C7" />
                <Text style={styles.reasonText}>{intro.rose.from === "me" ? "You sent a Rose" : `${firstName} sent you a Rose`}</Text>
              </View>
            )}
            {intro.sharedInterests.map((interest) => (
              <View key={interest} style={styles.reason}>
                <Text style={styles.reasonText}>{interest}</Text>
              </View>
            ))}
          </View>
        )}
        <Pressable onPress={onSayHi} style={({ pressed }) => [styles.sayHi, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Say hi to ${firstName}`}>
          <Text style={styles.sayHiText}>👋  Say hi</Text>
        </Pressable>
      </View>

      {intro.openers.length > 0 && <View style={styles.starters}>
        <View style={styles.startersHeading}>
          <Text style={styles.startersTitle}>Start a conversation</Text>
          <Text style={styles.startersHint}>Tap a starter to edit it.</Text>
        </View>
        <View style={styles.startersCard}>
          {intro.openers.map((opener, index) => (
            <Pressable
              key={opener}
              onPress={() => onOpener(opener)}
              style={({ pressed }) => [styles.opener, index > 0 && styles.openerDivider, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Use this opener: ${opener}`}
            >
              <Text style={styles.openerText}>{opener}</Text>
              <View style={styles.openerIcon}><Ionicons name="create-outline" size={16} color="#FFB8C7" /></View>
            </Pressable>
          ))}
        </View>
      </View>}
    </Animated.View>
  );
}

/**
 * A tap on their photo: watch their Story (when there is one you may see) or
 * see the photo full size - the same choice Instagram offers on a ringed avatar.
 */
export function PhotoChoiceSheet({
  visible,
  name,
  avatar,
  hasStory,
  onWatchStory,
  onProfile,
  onClose,
}: {
  visible: boolean;
  name: string;
  avatar: string | null;
  hasStory: boolean;
  onWatchStory: () => void;
  onProfile?: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [viewing, setViewing] = useState(false);
  useEffect(() => {
    if (!visible) setViewing(false);
  }, [visible]);
  const firstName = name.split(/\s+/)[0];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => (viewing ? setViewing(false) : onClose())} statusBarTranslucent>
      {viewing && avatar ? (
        <Pressable style={styles.viewer} onPress={() => setViewing(false)} accessibilityRole="button" accessibilityLabel="Close photo">
          <Image source={{ uri: avatar }} style={styles.viewerPhoto} resizeMode="contain" />
          <Text style={styles.viewerName}>{name}</Text>
        </Pressable>
      ) : (
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>{name}</Text>
            {hasStory && (
              <SheetRow
                icon="play-circle"
                label={`Watch ${firstName}'s story`}
                accent
                onPress={() => {
                  onClose();
                  onWatchStory();
                }}
              />
            )}
            {!!avatar && <SheetRow icon="image-outline" label="See profile photo" onPress={() => setViewing(true)} />}
            {onProfile && (
              <SheetRow
                icon="person-circle-outline"
                label="Chat info"
                onPress={() => {
                  onClose();
                  onProfile();
                }}
              />
            )}
            <SheetRow icon="close" label="Cancel" onPress={onClose} />
          </View>
        </View>
      )}
    </Modal>
  );
}

function SheetRow({ icon, label, onPress, accent }: {
  icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; accent?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={accent ? colors.primary : "#fff"} />
      <Text style={[styles.sheetRowText, accent && styles.sheetRowAccent]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", maxWidth: 440, alignSelf: "center", paddingHorizontal: 16, gap: 16 },
  profileCard: { padding: 16, borderRadius: 22, backgroundColor: "#242124" },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  profileCopy: { flex: 1, minWidth: 0 },
  matchLabel: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  matchLabelText: { color: "#FFB8C7", fontFamily: "DMSans_700Bold", fontSize: 11 },
  name: { color: "#FFFFFF", fontFamily: "DMSans_700Bold", fontSize: 20, lineHeight: 25 },
  when: { color: "#D0C5CB", fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 17, marginTop: 3 },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  reason: { maxWidth: "100%", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: "#383137", flexDirection: "row", alignItems: "center", gap: 5 },
  reasonRose: { backgroundColor: "#50303C" },
  reasonText: { color: "#F3E9ED", fontFamily: "DMSans_500Medium", fontSize: 12, flexShrink: 1 },
  sayHi: {
    marginTop: 14,
    minHeight: 44,
    paddingHorizontal: 26,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFB8C7",
  },
  sayHiText: { color: "#331C23", fontFamily: "DMSans_700Bold", fontSize: 14 },
  starters: { gap: 9 },
  startersHeading: { paddingHorizontal: 2, gap: 3 },
  startersTitle: { color: "#FFFFFF", fontFamily: "DMSans_700Bold", fontSize: 14 },
  startersHint: { color: "#D0C5CB", fontFamily: "DMSans_400Regular", fontSize: 12 },
  startersCard: { borderRadius: 18, backgroundColor: "#242124", paddingHorizontal: 14, overflow: "hidden" },
  opener: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  openerDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#41383E" },
  openerText: { flex: 1, color: "#F3E9ED", fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 19 },
  openerIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#3C3037", alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { backgroundColor: "#1A1715", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 10 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)", marginBottom: 10 },
  sheetTitle: { color: "#fff", fontSize: 16, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 6 },
  sheetRowText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  sheetRowAccent: { color: colors.primaryLight },
  viewer: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.95)" },
  viewerPhoto: { width: "100%", height: "72%" },
  viewerName: { color: "#fff", fontSize: 17, fontWeight: "700", marginTop: 16 },
});
