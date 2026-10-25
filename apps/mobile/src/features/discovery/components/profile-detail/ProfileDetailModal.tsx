import React, { useEffect, useRef, useState } from "react";
import { openReport } from "../../../safety/ReportSheet";
import {
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
  runOnUI,
  withDelay,
  cancelAnimation,
  withRepeat,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { VideoView, useVideoPlayer, type VideoPlayer } from "expo-video";
import { api } from "../../../../services/api";
import { colors } from "../../../../core/theme/colors";
import { VerifiedBadge } from "../VerifiedBadge";
import { ActivityPill } from "../ActivityStatus";
import { ProfileContentCard, ProfileContentSections, ProfileInterestPills } from "../../../../components/ProfileContentSections";
import { buildProfilePreview } from "../../../../screens/main/profile/profilePreviewModel";
import { ProfileIntentionCard } from "../../../../components/ProfileIntentionCard";
import { RoseSentCelebration, type RoseConfirmation } from "./RoseSentCelebration";
import { PreparedPhotos } from "../../media/PreparedPhotos";
import { INTEREST_CATEGORIES } from "@iem-dating/shared/interest-catalog";
import { placeLine } from "../../../location/cardLabels";

const interestLabels = new Map(
  INTEREST_CATEGORIES.flatMap((group) =>
    group.interests.map((item) => [item.id, item.label] as const),
  ),
);
export function sharedInterestLabels(user: any): string[] {
  return [
    ...new Set<string>(
      (user.matchFactors ?? [])
        .filter((factor: any) => factor.id === "interests")
        .flatMap((factor: any) => factor.sharedValues ?? []),
    ),
  ].map((value) => interestLabels.get(value) ?? value);
}

function SkeletonBlock({ sweep, style }: { sweep: SharedValue<number>; style: object }) {
  const { width } = useWindowDimensions();
  const shineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -width * 0.7 + sweep.value * width * 1.7 }],
  }));
  return (
    <View style={[styles.skeletonBlock, style]}>
      <Animated.View style={[styles.skeletonShine, { width: width * 0.6 }, shineStyle]}>
        <LinearGradient
          colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.09)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/**
 * Placeholder sections shown while the real ones mount, shaped like them, with
 * a light sweep running across (the loading pattern Instagram and Hinge use).
 * Everything animates on the UI thread, so it keeps moving while JavaScript is
 * busy building the real sections.
 */
function ProfileDetailSkeleton() {
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
      -1,
      false,
    );
    return () => cancelAnimation(sweep);
  }, [sweep]);
  return (
    <View accessible accessibilityLabel="Loading profile details" style={{ gap: 12 }}>
      <View style={styles.panel}>
        <SkeletonBlock sweep={sweep} style={{ width: 110, height: 12 }} />
        <SkeletonBlock sweep={sweep} style={{ width: "70%", height: 18 }} />
      </View>
      <View style={styles.panel}>
        <SkeletonBlock sweep={sweep} style={{ width: 90, height: 16 }} />
        <SkeletonBlock sweep={sweep} style={{ width: "100%", height: 12 }} />
        <SkeletonBlock sweep={sweep} style={{ width: "92%", height: 12 }} />
        <SkeletonBlock sweep={sweep} style={{ width: "60%", height: 12 }} />
      </View>
      <View style={styles.panel}>
        <SkeletonBlock sweep={sweep} style={{ width: 150, height: 16 }} />
        <View style={styles.skeletonGrid}>
          {[0, 1, 2, 3].map((tile) => (
            <SkeletonBlock key={tile} sweep={sweep} style={styles.skeletonTile} />
          ))}
        </View>
      </View>
      <View style={styles.panel}>
        <SkeletonBlock sweep={sweep} style={{ width: 80, height: 16 }} />
        <View style={styles.chips}>
          {[64, 90, 72, 110, 58].map((chip, index) => (
            <SkeletonBlock key={index} sweep={sweep} style={{ width: chip, height: 30, borderRadius: 15 }} />
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * The real-person mark (PHOTO_VERIFICATION_PLAN.md D2): a person-check icon in the
 * corner of each photo in the expanded profile. Gone while a changed photo or
 * video needs fixing. Tapping it explains.
 */
function RealPersonMark({ name, belowProgress = false }: { name: string; belowProgress?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Real person - photos checked"
      accessibilityHint="Opens details about the selfie check."
      hitSlop={8}
      onPress={() => Alert.alert(
        "Photos checked",
        `${name.split(" ")[0]} took a live selfie check, and their photos and video match them.`,
      )}
      style={[styles.realPersonMark, belowProgress && styles.realPersonMarkBelowProgress]}
    >
      <MaterialCommunityIcons name="account-check" size={18} color="#DDC9FF" />
    </Pressable>
  );
}

/**
 * A profile's later photos, placed between its sections as Hinge and Bumble do.
 * Each downloads only once it is about to scroll into view.
 */
function LazyProfilePhoto({
  uri,
  offset,
  loadLine,
  realPersonName,
}: {
  uri: string;
  offset: number;
  loadLine: number;
  /** Set when the person passed the real-person check: shows the mark. */
  realPersonName?: string;
}) {
  const [top, setTop] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed && top !== null && offset + top < loadLine) setArmed(true);
  }, [armed, loadLine, offset, top]);
  return (
    <View
      style={[styles.detailPhoto, { overflow: "hidden", backgroundColor: "#1B1C1E" }]}
      onLayout={(event) => setTop(event.nativeEvent.layout.y)}
    >
      {armed ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {armed && !!realPersonName && <RealPersonMark name={realPersonName} />}
    </View>
  );
}

// Only for profiles opened outside the swipe card (Explore), which have no
// card player to share. The cache keeps it from downloading the video again.
function ProfileVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri, useCaching: true }, (instance) => {
    instance.muted = true;
  });
  return (
    <VideoView
      player={player}
      style={{ width: "100%", aspectRatio: 3 / 4 }}
      nativeControls
      contentFit="contain"
    />
  );
}

interface Props {
  loading?: boolean;
  user: any;
  isVisible: boolean;
  onClose: () => void;
  onOpenComplete?: () => void;
  /** Required unless `readOnly` - there is then nowhere for them to be reached from. */
  onLike?: () => void | Promise<void>;
  onPass?: () => void | Promise<void>;
  /** No Like/Pass bar: viewing a match's or follower's profile, where swiping on them means nothing. */
  readOnly?: boolean;
  onSuperLike?: () => void;
  /** Sends a Rose instead of a Like. Absent means this surface has no Roses. */
  onRose?: () => void | Promise<void>;
  /** Roses left this week; 0 still shows the button, so it can explain itself. */
  roseBalance?: number | null;
  /** Optional confirmation after a successful send. Search keeps the profile open until it ends. */
  roseConfirmation?: RoseConfirmation | null;
  /**
   * Drawn on top, inside this profile's own window - the Rose sheet, so it
   * does not open a second Modal. `onOverlayBack` takes the back button while
   * it is open and returns true when it handled it.
   */
  overlay?: React.ReactNode;
  onOverlayBack?: () => boolean;
  onFollow?: () => void | Promise<void>;
  followLabel?: string;
  onBlocked?: () => void;
  onReport?: (reason: string) => void | Promise<void>;
  onBlock?: () => void | Promise<void>;
  initialPhotoUri?: string;
  initialVideoPlayer?: VideoPlayer;
  mediaProgress?: React.ReactNode;
  cardInfo?: React.ReactNode;
  selectedMediaUri?: string;
  selectedMediaType?: "image" | "video";
  /** The card's shown media index, so a tap here switches without a re-render. */
  selectedMediaIndex?: SharedValue<number>;
  photoIndexOf?: Record<string, number>;
  onNextMedia?: () => void;
  onPhotoLoad?: (uri: string) => void;
  onPreviousMedia?: () => void;
  onPlaybackChange?: (playing: boolean) => void;
  onCollapseStart?: () => void;
  origin?: { x: number; y: number; width: number; height: number };
  /**
   * How the profile grows out of what was tapped:
   * - card: the Discovery deck's own card turns into the profile;
   * - avatar: a small circle, the profile fades and rises in;
   * - photo: a photo card elsewhere (the Map's carousel). Only the photo flies,
   *   by transforms alone, and the profile, laid out once at its final size,
   *   fades in around it as it lands - see PHOTO_TRANSITION below.
   */
  /**
   * "sheet": opened from a bottom sheet that stays underneath (Search's
   * college profile). Opens with a fade-through; closes by sliding the whole profile
   * down off the screen, so the sheet it came from is simply revealed again -
   * there is no card to fold back into.
   */
  transition?: "card" | "avatar" | "photo" | "sheet";
}

/**
 * The photo transition. Only transform and opacity change per frame - the
 * two properties Reanimated applies to the native view directly - so nothing
 * is laid out while it runs. (Growing the frame's left/width/height re-laid
 * out the whole profile every frame, which is where the stutter came from.)
 */
const PHOTO_OPEN = { duration: 360, easing: Easing.bezier(0.2, 0.9, 0.25, 1) };
const PHOTO_CLOSE = { duration: 320, easing: Easing.bezier(0.3, 0.05, 0.2, 1) };
/** The carousel card's corner radius, which the flying photo starts from. */
const PHOTO_CARD_RADIUS = 22;
/** The profile photo's corner radius (styles.hero), where it lands. */
const PROFILE_PHOTO_RADIUS = 18;

export const ProfileDetailModal = (props: Props) =>
  props.isVisible ? <ProfileDetailContent {...props} /> : null;

function ProfileDetailContent({
  loading = false,
  user,
  onClose,
  onOpenComplete,
  onLike,
  onPass,
  onRose,
  roseBalance,
  roseConfirmation,
  readOnly,
  onFollow,
  followLabel,
  onBlocked,
  onReport,
  onBlock,
  initialPhotoUri,
  initialVideoPlayer,
  mediaProgress,
  cardInfo,
  selectedMediaUri,
  selectedMediaType,
  selectedMediaIndex,
  photoIndexOf,
  onNextMedia,
  onPhotoLoad,
  onPreviousMedia,
  onPlaybackChange,
  onCollapseStart,
  origin,
  transition = "card",
  overlay,
  onOverlayBack,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const hasActions = !readOnly && !!(onPass || onLike || onRose);
  const actionBarHeight = 80 + insets.bottom;
  const scrollOffset = useRef(0);
  // The sheet transition starts at the profile's final layout and moves it
  // whole, so nothing inside grows (no photo zoom) - see `beginOpen`.
  const progress = useSharedValue(transition === "sheet" ? 1 : 0);
  const detailsVisible = useSharedValue(1);
  // Set when the fold back into the card starts. Once the details have faded
  // they leave layout entirely, so each frame of the fold lays out only the
  // photo area rather than every section of the profile.
  const collapsing = useSharedValue(0);
  // The skeleton shows from the moment the profile starts opening. Once the
  // real sections have mounted and laid out, the two crossfade, so there is
  // never an empty area below the photos while they build.
  // Except in the sheet transition: there the profile only slides, nothing
  // re-lays out, so the real sections are there from the first frame and a
  // skeleton would just show the page twice (placeholder, then the real one).
  const detailsOpacity = useSharedValue(transition === "sheet" ? 1 : 0);
  const [skeletonVisible, setSkeletonVisible] = useState(transition !== "sheet");
  const detailsShown = useRef(false);
  const revealDetails = () => {
    if (detailsShown.current) return;
    detailsShown.current = true;
    detailsOpacity.value = withTiming(
      1,
      { duration: 240, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setSkeletonVisible)(false);
      },
    );
  };
  const detailsStyle = useAnimatedStyle(() => ({ opacity: detailsOpacity.value }));
  const skeletonStyle = useAnimatedStyle(() => ({ opacity: 1 - detailsOpacity.value }));
  const scrollView = useRef<ScrollView>(null);
  const closing = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [loadExtraMedia, setLoadExtraMedia] = useState(false);
  const [showVideo, setShowVideo] = useState(!!initialVideoPlayer);
  // The expanded profile mounts its own video view fresh every time it opens
  // (this whole component remounts with it), so it always needs at least one
  // frame before it has anything to show - the shared player being warm from
  // the card does not help this particular view. That view stays mounted for
  // the rest of this opening once shown (see below), so `false` only needs to
  // be the state on a fresh mount - it is never reset after that within one
  // opening, and onFirstFrameRender only ever has to fire once per opening.
  const [heroVideoReady, setHeroVideoReady] = useState(false);
  // Media plays only while the photo area is on screen, as in Hinge.
  const [heroVisible, setHeroVisible] = useState(true);
  const heroVisibleRef = useRef(true);
  const [loadLine, setLoadLine] = useState(height * 2);
  const loadLineRef = useRef(height * 2);
  const photos = [
    ...new Set<string>(
      [...(user.photos ?? []), user.primaryPhoto ?? user.imageUri].filter(Boolean),
    ),
  ];
  const firstPhoto = photos[Math.max(0, photos.indexOf(initialPhotoUri ?? ""))];
  const [photo, setPhoto] = useState(Math.max(0, photos.indexOf(initialPhotoUri ?? "")));
  const sheetOpenState = useRef({ shown: false, laidOut: false, mediaReady: !firstPhoto, started: false });
  const sheetLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sheetPhotoPending, setSheetPhotoPending] = useState(!!firstPhoto);
  const [sheetPhotoFailed, setSheetPhotoFailed] = useState(false);
  useEffect(() => () => {
    if (sheetLoadTimer.current) clearTimeout(sheetLoadTimer.current);
  }, []);
  const pendingDecision = useRef<(() => void | Promise<void>) | null>(null);
  const startFrame = origin ?? {
    x: 10,
    y: insets.top + 60,
    width: width - 20,
    height: height * 0.7,
  };
  const targetTop = insets.top + 8;
  const targetHeroHeight = Math.min(height * 0.48, 440);
  // A Discovery card's origin is already this wide, so this is a no-op there.
  // An avatar's origin is a small circle, and needs to grow into this width
  // too, not just the height - it did not before, which pinned the whole
  // expanded profile to the avatar's width forever (a visibly broken sliver).
  const targetLeft = 10;
  const targetWidth = width - 20;
  const avatarTransition = transition === "avatar";
  const photoTransition = transition === "photo" && !!origin;
  const sheetTransition = transition === "sheet";
  // 1 hides the initial sheet presentation; 0 is fully open.
  // After opening, the same value drives the existing downward close.
  const dismissing = useSharedValue(sheetTransition ? 1 : 0);
  const sheetEntering = useSharedValue(sheetTransition ? 1 : 0);
  const dismissStyle = useAnimatedStyle(() => ({
    // The source is fully covered before the profile photo appears.
    opacity: sheetEntering.value === 1 ? Math.max(0, (0.6 - dismissing.value) / 0.6) : 1,
    transform: [{ translateY: dismissing.value * (sheetEntering.value === 1 ? 18 : height) }],
  }));

  // --- The photo transition (see PHOTO_TRANSITION) --------------------------
  // The profile is laid out once, at its final size, and fades in (`content`)
  // as the flying photo lands. The flying photo is a window onto the photo:
  // the window is laid out at the photo's final place and size, and each
  // frame a transform maps it onto the rectangle between the card and that
  // place. The photo inside is counter-scaled, so it never stretches - it
  // stays cropped like the card's and the profile's, and the window clips it.
  const content = useSharedValue(photoTransition ? 0 : 1);
  const flying = useSharedValue(photoTransition ? 1 : 0);
  /** Set once the photo heads back to its card. */
  const returning = useSharedValue(0);
  const heroFinal = { x: targetLeft, y: targetTop + 64, width: targetWidth, height: targetHeroHeight };
  const flyFrom = origin ?? heroFinal;
  const flyWindowStyle = useAnimatedStyle(() => {
    const t = progress.value;
    const w = flyFrom.width + (heroFinal.width - flyFrom.width) * t;
    const h = flyFrom.height + (heroFinal.height - flyFrom.height) * t;
    const x = flyFrom.x + (heroFinal.x - flyFrom.x) * t;
    const y = flyFrom.y + (heroFinal.y - flyFrom.y) * t;
    const sx = w / heroFinal.width;
    const sy = h / heroFinal.height;
    return {
      // Right over the card, the card (with its name and gradient) shows
      // through: the bare photo fades in as it lifts off, rather than the
      // name vanishing on the tap. On the way back it fades out over the
      // last 40% of the path, so it has melted into the card before it
      // arrives - fading only at the very end left a copy sitting on the
      // card's photo for a moment.
      opacity: flying.value * Math.min(1, t / (returning.value === 1 ? 0.4 : 0.12)),
      // The radius is in the window's own (scaled) units; this keeps it
      // looking like the card's corners turning into the profile photo's.
      borderRadius: (PHOTO_CARD_RADIUS + (PROFILE_PHOTO_RADIUS - PHOTO_CARD_RADIUS) * t) / Math.max(0.01, (sx + sy) / 2),
      transform: [
        { translateX: x + w / 2 - (heroFinal.x + heroFinal.width / 2) },
        { translateY: y + h / 2 - (heroFinal.y + heroFinal.height / 2) },
        { scaleX: sx },
        { scaleY: sy },
      ],
    };
  });
  const flyPhotoStyle = useAnimatedStyle(() => {
    const t = progress.value;
    const w = flyFrom.width + (heroFinal.width - flyFrom.width) * t;
    const h = flyFrom.height + (heroFinal.height - flyFrom.height) * t;
    const sx = w / heroFinal.width;
    const sy = h / heroFinal.height;
    // Undo the window's stretch, then grow evenly until the photo covers it.
    const cover = Math.max(sx, sy);
    return { transform: [{ scaleX: cover / sx }, { scaleY: cover / sy }] };
  });
  const contentStyle = useAnimatedStyle(() => ({ opacity: content.value }));
  const frameStyle = useAnimatedStyle(() => photoTransition || sheetTransition ? ({
    position: "absolute",
    top: targetTop,
    left: targetLeft,
    width: targetWidth,
    height: height - targetTop,
    borderRadius: 14,
    overflow: "hidden",
  }) : avatarTransition ? ({
    position: "absolute",
    top: targetTop,
    left: targetLeft,
    width: targetWidth,
    height: height - targetTop,
    opacity: progress.value,
    transform: [
      { translateY: -20 * (1 - progress.value) },
      { scale: 0.94 + 0.06 * progress.value },
    ],
    borderRadius: 14,
    overflow: "hidden",
  }) : ({
    position: "absolute",
    top: targetTop,
    left: startFrame.x + (targetLeft - startFrame.x) * progress.value,
    width: startFrame.width + (targetWidth - startFrame.width) * progress.value,
    height:
      startFrame.height +
      ((collapsing.value === 1 ? targetHeroHeight : height - targetTop) - startFrame.height) * progress.value,
    transform: [
      {
        // The header is removed during collapse. Preserve the photo's current
        // screen position, then reduce that offset with the same animation.
        translateY: (startFrame.y - targetTop) * (1 - progress.value)
          + (collapsing.value === 1 ? 64 * progress.value : 0),
      },
    ],
    borderRadius: 14,
    overflow: "hidden",
  }));
  // In the photo transition nothing below moves with `progress`: the profile
  // is already at its final layout, and appears through `content`.
  const heroStyle = useAnimatedStyle(() => ({
    height:
      avatarTransition || photoTransition ? targetHeroHeight : startFrame.height +
      (targetHeroHeight - startFrame.height) * progress.value,
    // While the flying photo is up, the profile's own photo area is hidden;
    // they swap in one frame, at the identical place, when it lands (open)
    // and when it lifts off (close), so there are never two photos on screen.
    opacity: photoTransition ? 1 - flying.value : 1,
  }));
  const cardShadowStyle = useAnimatedStyle(() => ({
    opacity: photoTransition ? 0 : 1 - progress.value,
  }));
  const cardInfoStyle = useAnimatedStyle(() => ({
    opacity: photoTransition ? 0 : Math.max(0, 1 - progress.value / 0.7),
    transform: [{ translateY: 16 * Math.min(1, progress.value / 0.7) }],
  }));
  const headerStyle = useAnimatedStyle(() => ({
    height: avatarTransition || photoTransition ? 64 : collapsing.value === 1 ? 0 : 64 * progress.value,
    // Reveal the header after most of its height is available, rather than
    // showing clipped portions of the name as the header grows.
    opacity: avatarTransition || photoTransition ? 1 : Math.max(0, (progress.value - 0.65) / 0.35) * detailsVisible.value,
    overflow: "hidden",
  }));
  const revealStyle = useAnimatedStyle(() => ({
    opacity: avatarTransition || photoTransition ? 1 : Math.max(0, (progress.value - 0.2) / 0.8) * detailsVisible.value,
    // The shrinking frame clips these sections. Keep their layout stable
    // instead of removing them halfway through the return animation.
  }));
  const actionsDismissed = useSharedValue(0);
  const actionsStyle = useAnimatedStyle(() => ({
    display: actionsDismissed.value === 1 ? ("none" as const) : ("flex" as const),
    opacity: (photoTransition ? content.value : progress.value) * detailsVisible.value,
    transform: [
      { translateY: 24 * (1 - (photoTransition ? content.value : progress.value) * detailsVisible.value) },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    // The photo transition's backdrop follows the photo both ways.
    opacity: (avatarTransition || photoTransition ? progress.value : progress.value * detailsVisible.value)
      * (sheetTransition && sheetEntering.value === 1
        ? Math.min(1, (1 - dismissing.value) / 0.35)
        : 1 - dismissing.value),
  }));
  const deckCoverStyle = useAnimatedStyle(() => ({
    // Keep the original name and photo covered for the entire modal lifetime.
    // The cover leaves in the same commit as the collapsed modal.
    opacity: 1,
  }));
  const barPosition = useAnimatedStyle(() => {
    // Layout properties: fixed in the photo transition, so they never re-lay out.
    const at = photoTransition ? 1 : progress.value;
    return { position: "absolute", left: 12 + 4 * at, right: 12 + 4 * at, top: 12 + 4 * at };
  });
  // The card puts its video first. Hide it on the tap that leaves it.
  const videoLayerStyle = useAnimatedStyle(() => ({
    opacity: !selectedMediaIndex || selectedMediaIndex.value === 0 ? 1 : 0,
  }));
  const finishOpen = () => {
    setExpanded(true);
    onOpenComplete?.();
  };
  const openSheetWhenReady = () => {
    const ready = sheetOpenState.current;
    if (!sheetTransition || closing.current || ready.started || !ready.shown || !ready.laidOut || !ready.mediaReady) return;
    ready.started = true;
    if (sheetLoadTimer.current) clearTimeout(sheetLoadTimer.current);
    dismissing.value = withTiming(0, { duration: 260, easing: Easing.inOut(Easing.cubic) }, finished => {
      if (!finished) return;
      sheetEntering.value = 0;
      runOnJS(finishOpen)();
    });
  };
  const beginOpen = () => {
    if (sheetTransition) {
      sheetOpenState.current.shown = true;
      // A stalled image request must not leave an invisible modal blocking Search.
      // The same photo view stays mounted; a loading indicator covers a slow load.
      if (!sheetOpenState.current.mediaReady) {
        sheetLoadTimer.current = setTimeout(() => {
          sheetOpenState.current.mediaReady = true;
          openSheetWhenReady();
        }, 1200);
      }
      openSheetWhenReady();
      return;
    }
    if (photoTransition) {
      // The photo flies; the profile fades in around it for the second half,
      // so its header and details are there as the photo lands. Landing
      // hands over to the profile's own photo (heroStyle) in the same frame.
      progress.value = withTiming(1, PHOTO_OPEN, (finished) => {
        if (!finished) return;
        flying.value = 0;
        runOnJS(finishOpen)();
      });
      content.value = withDelay(
        PHOTO_OPEN.duration * 0.45,
        withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
      );
      return;
    }
    progress.value = withTiming(
      1,
      { duration: avatarTransition ? 160 : 180, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(finishOpen)();
      },
    );
  };
  useEffect(() => {
    onPlaybackChange?.(expanded && heroVisible);
  }, [expanded, heroVisible, onPlaybackChange]);
  useEffect(() => {
    if (selectedMediaType) setShowVideo(selectedMediaType === "video");
  }, [selectedMediaType, selectedMediaUri]);
  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => setLoadExtraMedia(true));
    return () => cancelAnimationFrame(frame);
  }, [expanded]);
  useEffect(() => {
    // Controlled cards own playback in SwipeCard/CardVideo. A second effect
    // here can pause a new selection using the previous showVideo state.
    if (selectedMediaType) return;
    if (!initialVideoPlayer) return;
    if (expanded && heroVisible && showVideo) initialVideoPlayer.play();
    else initialVideoPlayer.pause();
  }, [expanded, heroVisible, showVideo, initialVideoPlayer, selectedMediaType]);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const shared = sharedInterestLabels(user);
  const contentData = React.useMemo(() => buildProfilePreview({
    ...user,
    // Expanded cards retain their existing gallery and public visibility rules.
    photos: [],
    showGender: !!user.showGender,
    showOrientation: !!user.showOrientation,
    orientation: user.orientation ?? [],
    clubs: user.clubs ?? [],
    hangoutSpots: user.hangoutSpots ?? [],
  }), [user]);
  const finishCollapse = () => {
    // Every state change of the close lands here, in one commit, after the
    // fold has finished and the frame on screen already matches the card.
    onPlaybackChange?.(false);
    onClose();
    const decision = pendingDecision.current;
    pendingDecision.current = null;
    if (decision)
      Promise.resolve()
        .then(decision)
        .catch(() =>
          Alert.alert(
            "Could not complete action",
            "Check your connection and try again.",
          ),
        );
  };
  const collapseToCard = () => {
    onCollapseStart?.();
    // The sheet close: the profile leaves as it is - no scroll reset, no
    // media reset, no fade - and slides down, revealing the sheet beneath.
    if (sheetTransition) {
      runOnUI(() => {
        'worklet';
        cancelAnimation(progress);
        dismissing.value = withTiming(
          1,
          { duration: 320, easing: Easing.bezier(0.32, 0, 0.67, 0) },
          (finished) => {
            if (finished) runOnJS(finishCollapse)();
          },
        );
      })();
      return;
    }
    // A native call, not a React update.
    if (!avatarTransition && scrollOffset.current > 1) {
      scrollView.current?.scrollTo({ y: 0, animated: false });
    }
    // Return to the same media that remains selected in the card. Only
    // profiles opened outside a card (Explore) keep their own selection.
    // (Not in the photo transition: its own photo is hidden while the flying
    // one returns, and a React update mid-fold would re-lay out the profile.)
    if (!avatarTransition && !mediaProgress && !photoTransition) {
      setPhoto(Math.max(0, photos.indexOf(initialPhotoUri ?? "")));
      setShowVideo(!!initialVideoPlayer);
    }
    // No other React state changes until the fold has finished. A commit in
    // the middle of it re-lays out the profile and re-renders the card and
    // the deck on the way, which is the jerk the close used to have.
    if (photoTransition) {
      runOnUI(() => {
        'worklet';
        cancelAnimation(progress);
        cancelAnimation(content);
        // Lift off: the flying photo replaces the profile's photo in place,
        // the profile fades, and the photo shrinks back into its card.
        flying.value = 1;
        returning.value = 1;
        content.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) });
        progress.value = withTiming(0, PHOTO_CLOSE, (finished) => {
          if (finished) runOnJS(finishCollapse)();
        });
      })();
      return;
    }
    runOnUI(() => {
      'worklet';
      cancelAnimation(progress);
      collapsing.value = 1;
      progress.value = withTiming(
        0,
        { duration: avatarTransition ? 180 : 300, easing: Easing.bezier(0.22, 0.61, 0.36, 1) },
        (finished) => {
          if (finished) runOnJS(finishCollapse)();
        },
      );
    })();
  };
  const close = () => {
    if (busyRef.current || closing.current) return;
    closing.current = true;
    // The sheet close keeps everything in place and slides it away whole.
    if (sheetTransition) {
      collapseToCard();
      return;
    }
    // Remove controls and their native shadows for every close path, including
    // the collapse arrow, back button, and downward gesture.
    actionsDismissed.value = 1;
    // Do not wait for a separate fade before starting the fold. Scrolled
    // details hide immediately before the scroll position resets.
    detailsVisible.value = scrollOffset.current > 1
      ? 0
      : withTiming(0, { duration: 120 });
    collapseToCard();
  };
  // As in Tinder and Bumble, Like and Pass first fold the profile back into its
  // card, and the card then leaves with the decision.
  const decide = (callback: () => void | Promise<void>) => {
    if (busyRef.current || closing.current) return;
    pendingDecision.current = callback;
    close();
  };
  const galleryPhotos = photos.slice(1);
  const bodyTop = targetHeroHeight + 12;
  const renderGalleryPhoto = (slot: number) => {
    const uri = galleryPhotos[slot];
    if (!uri || !loadExtraMedia) return null;
    return (
      <LazyProfilePhoto key={uri} uri={uri} offset={bodyTop} loadLine={loadLine}
        realPersonName={user.realPerson ? user.name : undefined} />
    );
  };
  const closeGesture = PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      expanded &&
      scrollOffset.current <= 0 &&
      gesture.dy > 18 &&
      gesture.dy > Math.abs(gesture.dx) * 1.5,
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 65 || gesture.vy > 0.8) close();
    },
  });
  const act = async (callback: () => void | Promise<void>, dismiss = true) => {
    if (busyRef.current || closing.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await callback();
      if (dismiss) onClose();
    } catch {
      Alert.alert(
        "Could not complete action",
        "Check your connection and try again.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  // One report sheet everywhere (features/safety/ReportSheet.tsx); blocking there closes the profile.
  const report = () =>
    void openReport({
      userId: user.id, name: user.name, sourceType: "profile", sourceId: user.id,
      ...(onReport ? { send: (reason: string) => onReport(reason) } : {}),
      ...(onBlock ? { block: () => onBlock() } : {}),
    }).then((result) => {
      if (!result.blocked) return;
      onBlocked?.();
      onClose();
    });
  const block = () =>
    Alert.alert(
      `Block ${user.name}?`,
      "You will no longer be able to contact each other.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () =>
            void act(async () => {
              if (onBlock) await onBlock();
              else await api.post("/block", { blockedId: user.id });
              onBlocked?.();
            }),
        },
      ],
    );
  const menu = () =>
    Alert.alert(user.name, undefined, [
      ...(onFollow
        ? [
            {
              text: followLabel ?? "Request to follow",
              onPress: () => void act(onFollow, false),
            },
          ]
        : []),
      { text: "Report profile", onPress: report },
      { text: "Block profile", style: "destructive", onPress: block },
      { text: "Cancel", style: "cancel" },
    ]);
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => { if (!onOverlayBack?.()) close(); }}
      onShow={beginOpen}
    >
      {origin && !avatarTransition && !photoTransition ? (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", left: startFrame.x, top: startFrame.y,
              width: startFrame.width, height: startFrame.height,
              backgroundColor: colors.background },
            deckCoverStyle,
          ]}
        />
      ) : null}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "#111113" },
          backdropStyle,
        ]}
      />
      <Animated.View
        {...closeGesture.panHandlers}
        onLayout={sheetTransition ? () => {
          sheetOpenState.current.laidOut = true;
          openSheetWhenReady();
        } : undefined}
        style={[styles.screen, frameStyle, photoTransition && contentStyle, sheetTransition && dismissStyle]}
      >
        <Animated.View style={headerStyle}>
          <View style={styles.profileHeader}>
            <View style={{ flex: 1 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.headerName, { flexShrink: 1 }]}
                >
                  {user.name}
                  {user.age ? `, ${user.age}` : ""}
                </Text>
                {user.blueBadge && (
                  <View
                    accessible
                    accessibilityLabel="Verified profile"
                    style={{
                      width: 20,
                      height: 20,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <VerifiedBadge />
                  </View>
                )}
                {/* No badge, no label: tapping the empty spot explains (GOOGLE_SIGNUP_PLAN.md 3). */}
                {!user.blueBadge && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="About verification"
                    hitSlop={10}
                    onPress={() => Alert.alert(
                      user.isVerified ? "No blue badge yet" : "Not verified",
                      user.isVerified
                        ? `The blue badge means a verified college email and a selfie check. ${user.name.split(" ")[0]} hasn't completed both yet.`
                        : `${user.name.split(" ")[0]} hasn't verified their college yet.`,
                    )}
                    style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}
                  >
                    <Ionicons name="information-circle-outline" size={16} color="rgba(255,255,255,0.35)" />
                  </Pressable>
                )}
              </View>
              {!!placeLine(user) && (
                <Text style={styles.secondary}>{placeLine(user)}</Text>
              )}
            </View>
            <Pressable
              onPress={menu}
              accessibilityLabel="Profile options"
              style={styles.headerButton}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
            </Pressable>
            <Pressable
              onPress={close}
              accessibilityLabel="Collapse profile"
              style={styles.headerButton}
            >
              <Ionicons name="chevron-down" size={26} color="#fff" />
            </Pressable>
          </View>
        </Animated.View>
        <ScrollView
          ref={scrollView}
          scrollEnabled={expanded}
          removeClippedSubviews={false}
          onScroll={(event) => {
            // Closing can reset the scroll position. Do not mount more
            // sections or change playback state while the card is moving.
            if (closing.current) return;
            const y = event.nativeEvent.contentOffset.y;
            scrollOffset.current = y;
            const heroOnScreen = y < targetHeroHeight * 0.6;
            if (heroOnScreen !== heroVisibleRef.current) {
              heroVisibleRef.current = heroOnScreen;
              setHeroVisible(heroOnScreen);
            }
            const line = y + height * 2;
            if (line > loadLineRef.current + 150) {
              loadLineRef.current = line;
              setLoadLine(line);
            }
          }}
          scrollEventThrottle={32}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: hasActions ? actionBarHeight + 16 : 16 + insets.bottom }}
        >
          <Animated.View style={[styles.hero, heroStyle]}>
            <PreparedPhotos
              uris={photos}
              selectedUri={
                selectedMediaType === "image"
                  ? selectedMediaUri
                  : !selectedMediaType && !showVideo
                    ? photos[photo]
                    : undefined
              }
              selectedIndex={selectedMediaIndex}
              indexOf={photoIndexOf}
              neighbours={!sheetTransition || expanded}
              onLoad={(uri) => {
                onPhotoLoad?.(uri);
                if (sheetTransition && uri === firstPhoto) {
                  sheetOpenState.current.mediaReady = true;
                  setSheetPhotoPending(false);
                  openSheetWhenReady();
                }
              }}
              onError={(uri) => {
                if (sheetTransition && uri === firstPhoto) {
                  sheetOpenState.current.mediaReady = true;
                  setSheetPhotoPending(false);
                  setSheetPhotoFailed(true);
                  openSheetWhenReady();
                }
              }}
            />
            {sheetTransition && photo === photos.indexOf(firstPhoto) && (sheetPhotoPending || sheetPhotoFailed) && (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", backgroundColor: "#19191B" }]}>
                {sheetPhotoPending ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="image-outline" size={40} color="#777" />}
              </View>
            )}
            {/* Mounted for as long as the profile has a video at all, not only while
                it is the one selected: switching to a photo and tapping back to the
                video inside the expanded view used to tear this down and rebuild it
                every time, paying the "fresh native surface" cost the card itself no
                longer pays. Opacity (already the right check: mediaItems puts the
                video at index 0) hides it behind the current photo instead, so the
                first-frame wait only ever happens once, the first time it opens. */}
            {initialVideoPlayer ? (
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, videoLayerStyle]}
              >
                <VideoView
                  player={initialVideoPlayer}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  surfaceType="textureView"
                  nativeControls={false}
                  onFirstFrameRender={() => setHeroVideoReady(true)}
                />
                {/* This view is a fresh native surface the first time the profile
                    opens, even though the player itself was already playing on the
                    card - it still needs its own first frame. A blurred hold of the
                    poster covers that instant, reading as "this video, still
                    focusing" rather than a flash of black, and disappears the moment
                    the sharp video is ready - which, now that the view is not rebuilt
                    on every tap, only has to happen this once per opening. */}
                {!heroVideoReady && !!user.videoPoster && (
                  <Image
                    source={{ uri: user.videoPoster }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="cover"
                    blurRadius={22}
                    fadeDuration={0}
                  />
                )}
              </Animated.View>
            ) : photos.length === 0 ? (
              <Ionicons name="person-outline" size={70} color="#777" />
            ) : null}
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: "60%",
                },
                cardShadowStyle,
              ]}
            >
              <LinearGradient
                colors={[
                  "rgba(0,0,0,0)",
                  "rgba(0,0,0,0.12)",
                  "rgba(0,0,0,0.38)",
                  "rgba(0,0,0,0.72)",
                ]}
                locations={[0, 0.3, 0.65, 1]}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, cardInfoStyle]}
            >
              {cardInfo}
            </Animated.View>
            <View style={styles.photoNavigation}>
              <Pressable
                accessibilityLabel="Previous photo"
                onPress={() => {
                  if (onPreviousMedia) return onPreviousMedia();
                  if (photo === 0 && initialVideoPlayer) setShowVideo(true);
                  else setPhoto((value) => Math.max(0, value - 1));
                }}
                style={{ flex: 1 }}
              />
              <Pressable
                accessibilityLabel="Next photo"
                onPress={() =>
                  onNextMedia
                    ? onNextMedia()
                    : showVideo
                      ? (setShowVideo(false), setPhoto(0))
                      : setPhoto((value) =>
                          Math.max(0, Math.min(photos.length - 1, value + 1)),
                        )
                }
                style={{ flex: 1 }}
              />
            </View>
            {expanded && user.realPerson && <RealPersonMark name={user.name} belowProgress />}
            {mediaProgress && (
              <Animated.View pointerEvents="none" style={barPosition}>
                {mediaProgress}
              </Animated.View>
            )}
            {!mediaProgress && (
              <Animated.View pointerEvents="none" style={barPosition}>
                <View
                  style={{
                    flexDirection: "row",
                    gap: 4,
                    width: "100%",
                    height: 4,
                  }}
                >
                  {photos.map((uri, index) => (
                    <View
                      key={uri}
                      style={[
                        styles.segment,
                        index === photo && { backgroundColor: "#fff" },
                      ]}
                    />
                  ))}
                </View>
              </Animated.View>
            )}
            <Animated.View pointerEvents="none" style={[styles.activityBadge, revealStyle]}>
              <ActivityPill activity={user.activity} />
            </Animated.View>
          </Animated.View>
          <Animated.View style={[styles.body, { paddingTop: 12 }, revealStyle]}>
            {skeletonVisible ? (
              <Animated.View pointerEvents="none" style={[styles.skeletonLayer, skeletonStyle]}>
                <ProfileDetailSkeleton />
              </Animated.View>
            ) : null}
            {/* The sections mount once the profile has finished opening, then
                crossfade in over the skeleton. Mounting every section before
                the open animation was most of the delay after tapping expand,
                and animating the frame's height re-laid them out on every frame. */}
            {(expanded || sheetTransition) && !loading ? (
            <Animated.View style={[styles.bodyContent, detailsStyle]} onLayout={revealDetails}>
            <ProfileIntentionCard value={user.seeking || user.intent} />
            {shared.length > 0 && (
              <ProfileContentCard title="You both like" icon="handshake-outline">
                <ProfileInterestPills values={shared} showIcons />
              </ProfileContentCard>
            )}
            <ProfileContentSections data={contentData} afterSection={section =>
              renderGalleryPhoto({ bio: 0, campus: 1, interests: 2, lifestyle: 3 }[section])
            } />
            {galleryPhotos.slice(4).map((_, index) => renderGalleryPhoto(index + 4))}
            {loadExtraMedia &&
              !!user.video &&
              !initialVideoPlayer &&
              !selectedMediaIndex && <ProfileVideo uri={user.video} />}
            <View style={styles.profileOptions}>
              <View style={styles.sectionHeading}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#C9BDC2" />
                <Text style={styles.optionsTitle}>Profile options</Text>
              </View>
              <View style={styles.optionsRow}>
                <Pressable onPress={report} accessibilityRole="button" accessibilityLabel="Report profile"
                  style={({ pressed }) => [styles.safety, pressed && styles.safetyPressed]}>
                  <Ionicons name="flag-outline" size={16} color="#DDD2D8" />
                  <Text style={styles.safetyText}>Report</Text>
                </Pressable>
                <Pressable onPress={block} accessibilityRole="button" accessibilityLabel="Block profile"
                  style={({ pressed }) => [styles.safety, styles.blockSafety, pressed && styles.safetyPressed]}>
                  <Ionicons name="ban-outline" size={16} color="#FF8A9D" />
                  <Text style={[styles.safetyText, styles.blockSafetyText]}>Block</Text>
                </Pressable>
              </View>
            </View>
            </Animated.View>
            ) : null}
          </Animated.View>
        </ScrollView>
        {hasActions ? (
          <Animated.View
            pointerEvents={expanded ? "box-none" : "none"}
            style={[styles.actions, actionsStyle, { height: actionBarHeight, paddingBottom: insets.bottom + 12 }]}
          >
            {/* Each button follows its handler, so a Rose-only surface like
                Standouts shows the Rose alone rather than a disabled Like. */}
            {onPass ? (
              <Pressable
                disabled={busy || !!roseConfirmation}
                accessibilityRole="button"
                accessibilityLabel={`Pass ${user.name}`}
                onPress={() => decide(onPass)}
                style={({ pressed }) => [
                  styles.pass,
                  styles.buttonShadow,
                  pressed && { opacity: 0.8, transform: [{ scale: 0.94 }] },
                ]}
              >
                <Ionicons name="close" size={28} color="#FF5365" />
              </Pressable>
            ) : null}
            {onRose ? (
              <Pressable
                disabled={busy || !!roseConfirmation}
                accessibilityRole="button"
                accessibilityLabel={
                  roseBalance === 0
                    ? "No Roses left this week"
                    : `Send ${user.name} a Rose${typeof roseBalance === "number" ? `, ${roseBalance} left` : ""}`
                }
                onPress={onRose}
                style={({ pressed }) => [
                  styles.rose,
                  styles.buttonShadow,
                  roseBalance === 0 && styles.roseEmpty,
                  pressed && { opacity: 0.8, transform: [{ scale: 0.94 }] },
                ]}
              >
                <Ionicons name="rose" size={26} color="#fff" />
                {typeof roseBalance === "number" && (
                  <View style={styles.roseCount}>
                    <Text style={styles.roseCountText}>{roseBalance}</Text>
                  </View>
                )}
              </Pressable>
            ) : null}
            {onLike ? (
              <Pressable
                disabled={busy || !!roseConfirmation}
                accessibilityRole="button"
                accessibilityLabel={`Like ${user.name}`}
                onPress={() => decide(onLike)}
                style={({ pressed }) => [
                  styles.like,
                  styles.buttonShadow,
                  pressed && { opacity: 0.8, transform: [{ scale: 0.94 }] },
                ]}
              >
                <Ionicons name="heart" size={30} color="#fff" />
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
        {roseConfirmation && (
          <RoseSentCelebration confirmation={roseConfirmation} photoUri={photos[photo] ?? firstPhoto}
            bottomInset={insets.bottom} sourceOffsetX={onPass && onLike ? 0 : onLike ? -40 : onPass ? 40 : 0}
            onComplete={close} />
        )}
      </Animated.View>
      {photoTransition ? (
        // The flying photo (see PHOTO_TRANSITION): laid out once where the
        // profile's photo is, moved and clipped by transforms alone.
        <Animated.View
          pointerEvents="none"
          style={[
            styles.flyWindow,
            { left: heroFinal.x, top: heroFinal.y, width: heroFinal.width, height: heroFinal.height },
            flyWindowStyle,
          ]}
        >
          <Animated.View style={[StyleSheet.absoluteFill, flyPhotoStyle]}>
            {initialPhotoUri ?? photos[0] ? (
              <Image
                source={{ uri: initialPhotoUri ?? photos[0] }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                fadeDuration={0}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
                <Ionicons name="person-outline" size={70} color="#777" />
              </View>
            )}
          </Animated.View>
        </Animated.View>
      ) : null}
      {overlay}
    </Modal>
  );
}

const styles = StyleSheet.create({
  realPersonMark: {
    position: "absolute",
    top: 18,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#302638",
  },
  realPersonMarkBelowProgress: { top: 32 },
  screen: { flex: 1, backgroundColor: "#111113" },
  // Same background as styles.hero, so a photo still loading reads as the same place.
  flyWindow: { position: "absolute", overflow: "hidden", backgroundColor: "#242427" },
  profileHeader: {
    height: 64,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerName: { color: "#fff", fontSize: 22, fontWeight: "700" },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#FFFFFF30",
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#242427",
    alignItems: "center",
    justifyContent: "center",
  },
  photoNavigation: { ...StyleSheet.absoluteFill, flexDirection: "row" },
  activityBadge: { position: "absolute", top: 32, left: 16, right: 16, alignItems: "flex-start" },
  gradient: { position: "absolute", bottom: 0, width: "100%", height: "42%" },
  heroInfo: { position: "absolute", bottom: 24, left: 22, right: 22 },
  name: { color: "#fff", fontSize: 32, fontWeight: "700", marginBottom: 5 },
  secondary: { color: "#B8B8C0", fontSize: 16 },
  top: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#202024CC",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FFFFFF30",
  },
  progress: { flex: 1, flexDirection: "row", gap: 4 },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#FFFFFF55",
  },
  body: { paddingHorizontal: 8, gap: 12 },
  bodyContent: { gap: 12 },
  skeletonLayer: { position: "absolute", top: 12, left: 8, right: 8 },
  skeletonBlock: { backgroundColor: "#2A2B2F", borderRadius: 6, overflow: "hidden" },
  skeletonShine: { position: "absolute", top: 0, bottom: 0, left: 0 },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  skeletonTile: { width: "48%", height: 48, borderRadius: 10 },
  panel: {
    backgroundColor: "#1B1C1E",
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  detailPhoto: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: 14,
    backgroundColor: "#242427",
  },
  profileOptions: { paddingTop: 10, paddingHorizontal: 4, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#FFFFFF18" },
  optionsTitle: { color: "#C9BDC2", fontFamily: "DMSans_500Medium", fontSize: 14 },
  optionsRow: { flexDirection: "row", gap: 8 },
  safety: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: "#242226", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  safetyText: { color: "#DDD2D8", fontFamily: "DMSans_500Medium", fontSize: 15 },
  safetyPressed: { opacity: 0.7 },
  blockSafety: { backgroundColor: "#302126" },
  blockSafetyText: { color: "#FF8A9D" },
  actions: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
    paddingTop: 12,
  },
  pass: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#29292E",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  like: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  rose: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#C2185B",
    alignItems: "center",
    justifyContent: "center",
  },
  // Spent, not hidden: an absent button would read as "Roses are gone", and
  // the balance is the thing the reader needs to see.
  roseEmpty: { backgroundColor: "#4A2A38" },
  roseCount: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
  },
  roseCountText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  buttonShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 4,
  },
});
