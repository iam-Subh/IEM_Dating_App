import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { CLOSE_FRIENDS_GREEN } from "../stories/settings/storySettings";
import type { SearchPerson } from "./searchTypes";

/** The tray's own unseen gradient, so a ring here reads exactly like one there. */
const UNSEEN = ["#FEDA75", "#FA7E1E", "#D62976", "#962FBF", "#4F5BD5"] as const;

type Props = {
  person: Pick<SearchPerson, "name" | "avatarUrl" | "story">;
  size: number;
  /** The surface behind the avatar, for the gap between photo and ring. */
  background: string;
};

/**
 * A person's photo with their Story ring, when the server says this viewer
 * may watch one (SEARCH_SPEC.md 5.1) - gradient for unseen, green for an
 * unseen Close Friends Story, grey once watched, none at all otherwise. The
 * app never works out visibility itself; it only draws what it was given.
 *
 * Space for the ring is always reserved, so a ring arriving live (a Story
 * posted while the profile is open) grows in without moving anything.
 */
export function PersonAvatar({ person, size, background }: Props) {
  const [failed, setFailed] = useState(false);
  // A new photo gets a fresh try, rather than inheriting the last one's failure.
  useEffect(() => setFailed(false), [person.avatarUrl]);

  const thickness = size >= 80 ? 3.5 : 2.5;
  const gap = size >= 80 ? 3.5 : 2.5;
  const outer = size + 2 * (thickness + gap);
  const story = person.story ?? null;
  const kind = !story ? null : story.closeFriends ? "close" : story.unseen ? "unseen" : "seen";

  const photo =
    person.avatarUrl && !failed ? (
      <Image
        key={person.avatarUrl}
        source={{ uri: person.avatarUrl }}
        style={[styles.photo, { width: size, height: size, borderRadius: size / 2 }]}
        onError={() => setFailed(true)}
      />
    ) : (
      <View style={[styles.photo, styles.initials, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.initialsText, { fontSize: size * 0.36 }]}>
          {person.name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((word) => word[0]?.toUpperCase())
            .join("")}
        </Text>
      </View>
    );

  return (
    <View style={{ width: outer, height: outer, alignItems: "center", justifyContent: "center" }}>
      {kind && (
        <Animated.View
          key={kind}
          entering={ZoomIn.duration(260)}
          style={[StyleSheet.absoluteFill, { borderRadius: outer / 2, overflow: "hidden" }]}
        >
          {kind === "close" ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: CLOSE_FRIENDS_GREEN }]} />
          ) : kind === "unseen" ? (
            <LinearGradient colors={UNSEEN} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { borderRadius: outer / 2, borderWidth: 1.5, borderColor: "#5A5A62" }]} />
          )}
        </Animated.View>
      )}
      <View style={{ padding: gap, borderRadius: (size + 2 * gap) / 2, backgroundColor: kind ? background : "transparent" }}>
        {photo}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { backgroundColor: "#27272D" },
  initials: { alignItems: "center", justifyContent: "center", backgroundColor: "#3A2A2C" },
  initialsText: { color: "#FFFFFF", fontWeight: "700" },
});
