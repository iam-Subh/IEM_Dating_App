import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../../core/theme/colors";
import type { CardOrigin, ExploreProfile } from "../discovery/components/ExploreProfileCard";
import { VerifiedBadge } from "../discovery/components/VerifiedBadge";
import { sharedInterestLabels } from "../discovery/components/profile-detail/ProfileDetailModal";

type CarouselItem = { kind: "profile"; profile: ExploreProfile } | { kind: "all" };
type LikeBurstState = { profileId: string; token: number };

const HEART_PARTICLES = [
  { x: -78, y: -60, size: 16, turn: -38, color: "#FF6684" },
  { x: -31, y: -91, size: 13, turn: -22, color: "#FFE0E8" },
  { x: 38, y: -86, size: 17, turn: 27, color: "#FF8DA4" },
  { x: 83, y: -43, size: 14, turn: 42, color: "#FFD0DD" },
  { x: 90, y: 27, size: 16, turn: 55, color: "#FF6684" },
  { x: 41, y: 77, size: 13, turn: 24, color: "#FFE0E8" },
  { x: -43, y: 79, size: 17, turn: -28, color: "#FF8DA4" },
  { x: -91, y: 19, size: 14, turn: -50, color: "#FFD0DD" },
] as const;

function HeartParticle({
  progress,
  particle,
}: {
  progress: SharedValue<number>;
  particle: (typeof HEART_PARTICLES)[number];
}) {
  const style = useAnimatedStyle(() => {
    const travel = interpolate(progress.value, [0.34, 0.48, 1], [0, 0.18, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(progress.value, [0.34, 0.43, 0.75, 1], [0, 1, 0.85, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: particle.x * travel },
        { translateY: particle.y * travel },
        { rotateZ: `${particle.turn * travel}deg` },
        { scale: interpolate(progress.value, [0.34, 0.5, 1], [0.4, 1, 0.7], Extrapolation.CLAMP) },
      ],
    };
  }, [particle]);

  return (
    <Animated.View style={[styles.heartParticle, { marginLeft: -particle.size / 2, marginTop: -particle.size / 2 }, style]}>
      <Ionicons name="heart" size={particle.size} color={particle.color} />
    </Animated.View>
  );
}

function LikeBurst({ token, onDone }: { token: number; onDone: (token: number) => void }) {
  const progress = useSharedValue(0);
  const heartStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.05, 0.44, 0.65], [0, 1, 1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.value, [0, 0.18, 0.3], [34, -7, 0], Extrapolation.CLAMP) },
      { scale: interpolate(progress.value, [0, 0.18, 0.3, 0.44, 0.65], [0.25, 1.26, 0.88, 1.18, 1.5], Extrapolation.CLAMP) },
    ],
  }));
  useEffect(() => {
    progress.value = withTiming(1, { duration: 620, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(onDone)(token);
    });
    return () => cancelAnimation(progress);
  }, [onDone, progress, token]);

  return (
    <View pointerEvents="none" style={styles.likeBurst}>
      {HEART_PARTICLES.map((particle, index) => <HeartParticle key={index} progress={progress} particle={particle} />)}
      <Animated.View style={[styles.burstHeart, heartStyle]}>
        <Ionicons name="heart" size={100} color="#FF5D7B" />
      </Animated.View>
    </View>
  );
}

const PreviewCard = React.memo(function PreviewCard({
  profile,
  width,
  height,
  imageReady,
  settling,
  burstToken,
  onBurstDone,
  onOpen,
}: {
  profile: ExploreProfile;
  width: number;
  height: number;
  imageReady: boolean;
  settling: SharedValue<boolean>;
  burstToken: number;
  onBurstDone: (token: number) => void;
  onOpen: (profile: ExploreProfile, origin?: CardOrigin) => void;
}) {
  const ref = useRef<View>(null);
  const sharedInterest = sharedInterestLabels(profile)[0];
  const detail = profile.department ?? profile.college ?? profile.seeking ?? "View profile";

  const open = () => {
    // A tap while the cards are still gliding stops them; it is not a choice
    // of this card. Opening a profile then re-rendered the whole map behind
    // it, and the next swipe stuttered.
    if (settling.value) return;
    if (!ref.current) return onOpen(profile);
    ref.current.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      onOpen(profile, { x, y, width: measuredWidth, height: measuredHeight });
    });
  };

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={`View ${profile.name}'s profile`}
      onPress={open}
      style={[styles.card, { width, height }]}
    >
      {profile.primaryPhoto && imageReady ? (
        // Decoded at the card's size, not the camera's: a full-size photo
        // decoding mid-swipe took frames from the animation.
        <Image source={{ uri: profile.primaryPhoto }} style={styles.photo} resizeMode="cover" resizeMethod="resize" fadeDuration={0} />
      ) : (
        <View style={[styles.photo, styles.photoFallback]}>
          <Ionicons name="person-outline" size={54} color="#A19BA7" />
        </View>
      )}
      <LinearGradient pointerEvents="none" colors={["transparent", "rgba(13,10,22,0.2)", "rgba(13,10,22,0.92)"]} style={styles.gradient} />
      <View pointerEvents="none" style={styles.cardText}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{profile.name}{profile.age ? `, ${profile.age}` : ""}</Text>
          {profile.blueBadge && <VerifiedBadge />}
        </View>
        <Text style={styles.detail} numberOfLines={1}>{detail}</Text>
        {sharedInterest && <Text style={styles.shared} numberOfLines={1}>You both like {sharedInterest}</Text>}
      </View>
      {burstToken > 0 && <LikeBurst token={burstToken} onDone={onBurstDone} />}
    </Pressable>
  );
});

/** The style of a card not on show: one object, so Reanimated sees no change frame to frame. */
const HIDDEN_CARD = {
  opacity: 0,
  transform: [{ translateX: 0 }, { translateY: 0 }, { rotateZ: "0deg" }, { scale: 1 }],
};

/**
 * The standby copy's opacity. Too faint to see, but not 0: Android skips
 * drawing fully transparent views, and a copy never drawn has no photo on the
 * GPU yet - swapped in at the midpoint, it showed empty for a moment.
 */
const STANDBY_OPACITY = 0.01;

/** How far below the stage's top the cards sit (styles.fanCard), for openCard's frame. */
const CARD_TOP = 10;

const FanCard = React.memo(function FanCard({
  item,
  itemIndex,
  layer,
  active,
  position,
  settling,
  screenWidth,
  cardWidth,
  cardHeight,
  spacing,
  imageReady,
  burstToken,
  locationKind,
  onBurstDone,
  onOpen,
  onSeeAll,
}: {
  item: CarouselItem;
  itemIndex: number;
  /** Which stack this copy of the card is in (see the carousel's render). */
  layer: "front" | "back";
  active: boolean;
  position: SharedValue<number>;
  settling: SharedValue<boolean>;
  screenWidth: number;
  cardWidth: number;
  cardHeight: number;
  spacing: number;
  imageReady: boolean;
  burstToken: number;
  locationKind: "campus" | "place";
  onBurstDone: (token: number) => void;
  onOpen: (profile: ExploreProfile, origin?: CardOrigin) => void;
  onSeeAll: () => void;
}) {
  // Each card is drawn twice, once per stack, and shown in one: the front
  // stack while it is the card nearest the centre or left of it, the back
  // stack while it is right of that. Both copies move together; only their
  // opacity swaps at the midpoint, every frame on the UI thread, so the card
  // nearest the centre is on top exactly when it gets there.
  //
  // Checked on the phone, nothing else restacks cards mid-swipe here:
  // zIndex through React is late (a JS commit), and neither elevation nor
  // zIndex set directly on the view changed the drawing order.
  const animatedStyle = useAnimatedStyle(() => {
    const distance = itemIndex - position.value;
    const magnitude = Math.abs(distance);
    // Cards past the edge return one fixed style object. Reanimated sends
    // only what changed, so they cost nothing per frame.
    if (magnitude >= 1.6) return HIDDEN_CARD;
    const inFront = itemIndex <= Math.round(position.value);
    const shown = layer === "front" ? inFront : !inFront;
    return {
      opacity: shown ? interpolate(magnitude, [0, 1, 1.6], [1, 0.92, 0], Extrapolation.CLAMP) : STANDBY_OPACITY,
      transform: [
        { translateX: distance * spacing },
        { translateY: Math.min(magnitude, 1) * 11 },
        { rotateZ: `${Math.max(-15, Math.min(15, distance * 12))}deg` },
        { scale: 1 - Math.min(magnitude, 1) * 0.1 },
      ],
    };
  }, [itemIndex, layer, spacing]);

  return (
    <Animated.View
      // At rest the centre card is in the front stack; only that copy takes touches.
      pointerEvents={active && layer === "front" ? "auto" : "none"}
      style={[
        styles.fanCard,
        { left: (screenWidth - cardWidth) / 2, width: cardWidth, height: cardHeight },
        animatedStyle,
      ]}
    >
      {item.kind === "profile" ? (
        <PreviewCard
          profile={item.profile}
          width={cardWidth}
          height={cardHeight}
          imageReady={imageReady}
          settling={settling}
          burstToken={burstToken}
          onBurstDone={onBurstDone}
          onOpen={onOpen}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="See all matching profiles"
          // As with profile cards: a tap while the cards glide only stops them.
          onPress={() => { if (!settling.value) onSeeAll(); }}
          style={styles.allCard}
        >
          <View style={styles.allIcon}><Ionicons name="people-outline" size={30} color={colors.primary} /></View>
          <Text style={styles.allTitle}>See all profiles</Text>
          <Text style={styles.allText}>
            {locationKind === "campus" ? "Continue browsing people from this campus." : "Continue browsing people who like this place."}
          </Text>
        </Pressable>
      )}
    </Animated.View>
  );
});

function ActionLabel({ targetIndex, lastIndex, liked }: { targetIndex: SharedValue<number>; lastIndex: number; liked: boolean }) {
  const likeStyle = useAnimatedStyle(() => ({
    opacity: withTiming(targetIndex.value === lastIndex ? 0 : 1, { duration: 90 }),
  }), [lastIndex]);
  const allStyle = useAnimatedStyle(() => ({
    opacity: withTiming(targetIndex.value === lastIndex ? 1 : 0, { duration: 90 }),
  }), [lastIndex]);

  return (
    <View style={styles.actionContents}>
      <Animated.View style={[styles.actionLabel, likeStyle]}>
        <Ionicons name="heart" size={21} color="#FFFFFF" />
        <Text style={styles.likeText}>{liked ? "Liked" : "Like"}</Text>
      </Animated.View>
      <Animated.View style={[styles.actionLabel, allStyle]}>
        <Text style={styles.likeText}>See all</Text>
      </Animated.View>
    </View>
  );
}

export function LocationProfileCarousel({
  profiles,
  locationKind,
  onOpen,
  onLike,
  onSeeAll,
}: {
  profiles: ExploreProfile[];
  locationKind: "campus" | "place";
  onOpen: (profile: ExploreProfile, origin?: CardOrigin) => void;
  onLike: (profile: ExploreProfile) => Promise<boolean>;
  onSeeAll: () => void;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const cardWidth = Math.min(282, Math.round(screenWidth * 0.62));
  const cardHeight = Math.min(300, Math.max(215, Math.round(screenHeight * 0.32)));
  const spacing = cardWidth * 0.68;
  const items = useMemo<CarouselItem[]>(
    () => [...profiles.map((profile): CarouselItem => ({ kind: "profile", profile })), { kind: "all" }],
    [profiles],
  );
  const lastIndex = items.length - 1;
  const position = useSharedValue(0);
  const targetIndex = useSharedValue(0);
  const gestureStartIndex = useSharedValue(0);
  const gestureStartPosition = useSharedValue(0);
  const activeIndex = useRef(0);
  const pendingLikes = useRef(new Set<string>());
  const prefetchedPhotos = useRef(new Set<string>());
  const burstCounter = useRef(0);
  const pendingAdvance = useRef<{ token: number; index: number } | null>(null);
  const moveToRef = useRef<(next: number) => void>(() => {});
  const [index, setIndex] = useState(0);
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set());
  const [burst, setBurst] = useState<LikeBurstState | null>(null);

  const finishBurst = useCallback((token: number) => {
    const queued = pendingAdvance.current;
    if (queued?.token === token) {
      pendingAdvance.current = null;
      if (activeIndex.current === queued.index) moveToRef.current(queued.index + 1);
    }
    setBurst((current) => current?.token === token ? null : current);
  }, []);

  /** True while the cards glide to rest; a tap then only stops them. */
  const settling = useSharedValue(false);
  const settleTo = (target: number, duration: number) => {
    "worklet";
    settling.value = true;
    position.value = withTiming(target, { duration, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) settling.value = false;
    });
  };


  // The screen's callbacks change on each of its renders; through refs, the
  // cards keep the same ones and are not re-rendered with it.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onSeeAllRef = useRef(onSeeAll);
  onSeeAllRef.current = onSeeAll;
  /**
   * Where the opened card is, for the profile to grow out of and shrink back
   * into. Not measured on the card: its movement is applied to the native
   * view directly (Reanimated's synchronous props), and React Native measures
   * from its own copy of the layout, which catches up later - the measured
   * card was off to the left or right by the last swipe, and the photo landed
   * beside the card. The stage never moves, and the centre card at rest sits
   * at a known place in it (FanCard: centred, CARD_TOP down).
   */
  const stageRef = useRef<View>(null);
  const cardFrame = useRef({ screenWidth, cardWidth, cardHeight });
  cardFrame.current = { screenWidth, cardWidth, cardHeight };
  const openCard = useCallback((profile: ExploreProfile, measured?: CardOrigin) => {
    const stage = stageRef.current;
    if (!stage) return onOpenRef.current(profile, measured);
    stage.measureInWindow((stageX, stageY) => {
      const frame = cardFrame.current;
      onOpenRef.current(profile, {
        x: stageX + (frame.screenWidth - frame.cardWidth) / 2,
        y: stageY + CARD_TOP,
        width: frame.cardWidth,
        height: frame.cardHeight,
      });
    });
  }, []);
  const seeAll = useCallback(() => onSeeAllRef.current(), []);

  useEffect(() => {
    for (const next of profiles.slice(index + 1, index + 5)) {
      const uri = next.primaryPhoto;
      if (!uri || prefetchedPhotos.current.has(uri)) continue;
      prefetchedPhotos.current.add(uri);
      void Image.prefetch(uri).catch(() => { prefetchedPhotos.current.delete(uri); });
    }
  }, [profiles, index]);

  useEffect(() => {
    if (activeIndex.current <= lastIndex) return;
    activeIndex.current = lastIndex;
    setIndex(lastIndex);
    targetIndex.value = lastIndex;
    position.value = lastIndex;
  }, [lastIndex, position, targetIndex]);

  const commitIndex = useCallback((next: number) => {
    activeIndex.current = next;
    setIndex(next);
  }, []);

  const moveTo = (next: number) => {
    const bounded = Math.max(0, Math.min(lastIndex, next));
    activeIndex.current = bounded;
    setIndex(bounded);
    targetIndex.value = bounded;
    cancelAnimation(position);
    settleTo(bounded, 230);
  };
  moveToRef.current = moveTo;

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-20, 20])
    .onBegin(() => {
      // Keep the card under the finger, even when the previous swipe is still settling.
      cancelAnimation(position);
      gestureStartIndex.value = targetIndex.value;
      gestureStartPosition.value = position.value;
    })
    .onUpdate((event) => {
      const start = gestureStartIndex.value;
      const minimum = Math.max(0, start - 1);
      const maximum = Math.min(lastIndex, start + 1);
      position.value = Math.max(minimum, Math.min(maximum, gestureStartPosition.value - event.translationX / spacing));
    })
    .onEnd((event) => {
      const origin = gestureStartIndex.value;
      const forward = event.translationX < -spacing * 0.18 || event.velocityX < -450;
      const backward = event.translationX > spacing * 0.18 || event.velocityX > 450;
      const target = Math.max(0, Math.min(lastIndex, origin + (forward ? 1 : backward ? -1 : 0)));
      targetIndex.value = target;
      settleTo(target, 210);
      runOnJS(commitIndex)(target);
    })
    .onFinalize((_, success) => {
      // A touch that never became a swipe (a tap mid-glide) resumes the glide.
      if (!success) settleTo(targetIndex.value, 180);
    }), [commitIndex, gestureStartIndex, gestureStartPosition, lastIndex, position, spacing, targetIndex]);

  const like = () => {
    const likedIndex = activeIndex.current;
    const current = items[likedIndex];
    if (current.kind !== "profile" || likedIds.has(current.profile.id) || pendingLikes.current.has(current.profile.id)) return;
    const card = current.profile;
    pendingLikes.current.add(card.id);
    setLikedIds((previous) => new Set(previous).add(card.id));
    const token = ++burstCounter.current;
    pendingAdvance.current = { token, index: likedIndex };
    setBurst({ profileId: card.id, token });
    void onLike(card).then((saved) => {
      if (!saved) setLikedIds((previous) => {
        const next = new Set(previous);
        next.delete(card.id);
        return next;
      });
    }).catch(() => {
      setLikedIds((previous) => {
        const next = new Set(previous);
        next.delete(card.id);
        return next;
      });
    }).finally(() => pendingLikes.current.delete(card.id));
  };

  const active = items[index];
  return (
    <View style={styles.carousel}>
      <GestureDetector gesture={pan}>
        <View ref={stageRef} collapsable={false} style={[styles.stage, { height: cardHeight + 28 }]}>
          {/*
            Two stacks, fixed order - reordering children or zIndex mid-swipe
            goes through a JS commit and lands late:
            - back stack: cards right of the centre, highest index first, so
              the one nearest the centre draws on top of the rest;
            - front stack, drawn after: the centre card and those left of it,
              lowest index first, so the centre card draws on top of all.
            Each card is in both; FanCard shows the right copy.
          */}
          {[
            ...[...items.keys()].reverse().map((itemIndex) => ({ itemIndex, layer: "back" as const })),
            ...[...items.keys()].map((itemIndex) => ({ itemIndex, layer: "front" as const })),
          ].map(({ itemIndex, layer }) => {
            const item = items[itemIndex];
            return (
            <FanCard
              key={`${layer}:${item.kind === "all" ? "see-all" : item.profile.id}`}
              layer={layer}
              item={item}
              itemIndex={itemIndex}
              active={itemIndex === index}
              position={position}
              settling={settling}
              screenWidth={screenWidth}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              spacing={spacing}
              // Every photo from the start (a panel holds ten at most, decoded
              // at card size): none is left to load in the middle of a swipe.
              imageReady
              burstToken={layer === "front" && item.kind === "profile" && burst?.profileId === item.profile.id ? burst.token : 0}
              locationKind={locationKind}
              onBurstDone={finishBurst}
              onOpen={openCard}
              onSeeAll={seeAll}
            />
            );
          })}
        </View>
      </GestureDetector>
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous profile"
          accessibilityState={{ disabled: index === 0 }}
          onPress={() => moveTo(activeIndex.current - 1)}
          style={[styles.arrow, index === 0 && styles.disabledArrow]}
        ><Ionicons name="chevron-back" size={22} color={colors.text.primary} /></Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={active.kind === "all" ? "See all matching profiles" : likedIds.has(active.profile.id) ? `Liked ${active.profile.name}` : `Like ${active.profile.name}`}
          accessibilityState={{ disabled: active.kind === "profile" && likedIds.has(active.profile.id) }}
          onPress={() => activeIndex.current === lastIndex ? onSeeAll() : like()}
          style={[styles.like, active.kind === "profile" && likedIds.has(active.profile.id) && styles.liked]}
        >
          <ActionLabel targetIndex={targetIndex} lastIndex={lastIndex} liked={active.kind === "profile" && likedIds.has(active.profile.id)} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next profile"
          accessibilityState={{ disabled: index === lastIndex }}
          onPress={() => moveTo(activeIndex.current + 1)}
          style={[styles.arrow, index === lastIndex && styles.disabledArrow]}
        ><Ionicons name="chevron-forward" size={22} color={colors.text.primary} /></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  carousel: { marginTop: 8 },
  stage: { width: "100%", overflow: "hidden" },
  fanCard: { position: "absolute", top: CARD_TOP },
  card: { borderRadius: 22, overflow: "hidden", backgroundColor: "#242029" },
  photo: { width: "100%", height: "100%", backgroundColor: "#242029" },
  photoFallback: { alignItems: "center", justifyContent: "center" },
  gradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: "66%" },
  cardText: { position: "absolute", left: 16, right: 16, bottom: 16 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { color: "#FFFFFF", fontSize: 21, fontWeight: "800", flexShrink: 1 },
  detail: { color: "#EEEAF0", fontSize: 13, marginTop: 4 },
  shared: { color: "#FFE2E6", fontSize: 12, marginTop: 8 },
  likeBurst: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  burstHeart: { position: "absolute", alignItems: "center", justifyContent: "center" },
  heartParticle: { position: "absolute", left: "50%", top: "50%" },
  allCard: { flex: 1, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 20, alignItems: "center", justifyContent: "center" },
  allIcon: { width: 62, height: 62, borderRadius: 31, backgroundColor: "#38252B", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  allTitle: { color: colors.text.primary, fontSize: 18, fontWeight: "800", textAlign: "center" },
  allText: { color: "#B8B2B9", fontSize: 13, lineHeight: 18, textAlign: "center", marginTop: 7 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 22, marginTop: 5 },
  arrow: { width: 43, height: 43, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#2A2729" },
  disabledArrow: { opacity: 0.35 },
  like: { minWidth: 110, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, paddingHorizontal: 17 },
  liked: { backgroundColor: "#51464A" },
  actionContents: { width: 88, height: 24, justifyContent: "center" },
  actionLabel: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  likeText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
