import {
  compatibilityValue,
  compatibilityColor,
  compatibilityLabel,
} from "../compatibility";
import React, {
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  useAnimatedReaction,
  withTiming,
  Easing,
  cancelAnimation,
  runOnJS,
  runOnUI,
  type SharedValue,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { colors } from "../../../core/theme/colors";
import { VerifiedBadge } from "./VerifiedBadge";
import { ActivityPill, type Activity } from "./ActivityStatus";
import { PreparedPhotos } from "../media/PreparedPhotos";
import { CardVideo, type PlaybackState } from "../media/CardVideo";
import { profileInterestEmoji } from "../../../components/ProfileContentSections";
import {
  ProfileDetailModal,
  sharedInterestLabels,
} from "./profile-detail/ProfileDetailModal";
import type { VideoPlayer } from "expo-video";

interface SwipeCardProps {
  user: {
    id: string;
    name: string;
    graduationYear: number | null;
    department: string;
    imageUri: string;
    intent: string;
    activity?: Activity;
    matchPercentage?: number | null;
    distance?: string;
    tags?: string[];
    photos?: string[];
    video?: string | null;
    videoPoster?: string | null;
  };
  onLike: () => void;
  onPass: () => void;
  onStar?: () => void;
  /** Opens the Rose composer for this card; absent means no Roses here. */
  onRose?: () => void;
  roseBalance?: number | null;
  /** The Rose sheet, drawn inside the expanded profile's window (RoseSheet `inline`). */
  roseOverlay?: React.ReactNode;
  /** Back button while the Rose sheet is open: true when it closed the sheet. */
  onRoseOverlayBack?: () => boolean;
  isActiveCard?: boolean;
  gesturePaused?: SharedValue<boolean>;
  prepareVideo?: boolean;
  onMediaState?: (state: PlaybackState) => void;
  onPhotoSelected?: (uri?: string) => void;
  onReport?: (reason: string) => void | Promise<void>;
  onBlock?: () => void | Promise<void>;
  onExpansionChange?: (expanded: boolean) => void;
  /** The expanded profile has started folding back into this card. */
  onCollapseStart?: () => void;
}

/** One bar segment: full before the shown media, filling on it, empty after. */
function MediaProgressSegment({
  index,
  isVideo,
  displayIndex,
  progress,
  autoAdvance,
}: {
  index: number;
  isVideo: boolean;
  displayIndex: SharedValue<number>;
  progress: SharedValue<number>;
  autoAdvance: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const shown = displayIndex.value;
    // Without autoplay a photo has no timer, so its segment marks position.
    const current =
      isVideo || autoAdvance.value === 1
        ? Math.max(0, Math.min(1, progress.value))
        : 1;
    const ratio = index < shown ? 1 : index === shown ? current : 0;
    return { width: `${ratio * 100}%` };
  });
  return (
    <View style={styles.progressItemContainer}>
      <Animated.View
        style={[{ height: "100%", backgroundColor: "#FFF" }, animatedStyle]}
      />
    </View>
  );
}

export const SwipeCard: React.FC<SwipeCardProps> = ({
  user,
  onLike,
  onPass,
  onStar,
  onRose,
  roseBalance,
  roseOverlay,
  onRoseOverlayBack,
  isActiveCard = true,
  gesturePaused,
  prepareVideo = true,
  onMediaState,
  onPhotoSelected,
  onReport,
  onBlock,
  onExpansionChange,
  onCollapseStart,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [detailPlayback, setDetailPlayback] = useState(false);
  const [pausedByGesture, setPausedByGesture] = useState(false);
  const timerGeneration = useRef(0);
  const [isMuted, setIsMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [videoState, setVideoState] = useState<PlaybackState>("loading");
  const [retryToken, setRetryToken] = useState(0);
  const [slowMedia, setSlowMedia] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(
    () => new Set(),
  );
  const [mediaError, setMediaError] = useState(false);
  const loadedImagesRef = useRef(loadedImages);
  loadedImagesRef.current = loadedImages;
  const [isModalVisible, setIsModalVisible] = useState(false);
  const cardView = useRef<View>(null);
  // A Like or Pass chosen in the expanded profile runs only once its modal is
  // off screen. Started any earlier, the top card flew away hidden under the
  // modal, and the only motion left to see was the card behind it growing.
  const modalVisibleRef = useRef(isModalVisible);
  const pendingDecision = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    modalVisibleRef.current = isModalVisible;
  }, [isModalVisible]);
  useEffect(() => {
    if (isModalVisible || !pendingDecision.current) return;
    const decision = pendingDecision.current;
    pendingDecision.current = null;
    // The modal window is removed in this commit; move the card on the next frame.
    requestAnimationFrame(() => decision());
  }, [isModalVisible]);
  const decideAfterClose = (decision: () => void) => {
    if (modalVisibleRef.current) pendingDecision.current = decision;
    else requestAnimationFrame(() => decision());
  };
  const [videoPlayer, setVideoPlayer] = useState<VideoPlayer | null>(null);
  const [profileOrigin, setProfileOrigin] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>();
  const openProfile = () => {
    cardView.current?.measureInWindow((x, y, width, height) => {
      setProfileOrigin({ x, y, width, height });
      setIsModalVisible(true);
      onExpansionChange?.(true);
    });
  };

  const mediaItems = useMemo(() => {
    const items: {
      type: "video" | "image";
      uri: string;
      previewUri?: string;
    }[] = [];
    if (user.video) {
      items.push({
        type: "video",
        uri: user.video,
        previewUri: user.videoPoster || undefined,
      });
    }
    if (user.photos && user.photos.length > 0) {
      user.photos.forEach((photo) => items.push({ type: "image", uri: photo }));
    }
    if (items.length === 0 && user.imageUri) {
      items.push({ type: "image", uri: user.imageUri });
    }
    return items;
  }, [user.video, user.videoPoster, user.photos, user.imageUri]);

  const currentMedia = mediaItems[currentIndex] || mediaItems[0];
  // There is at most one video per profile, always somewhere in mediaItems.
  // Found once here so the video element can stay mounted no matter which
  // media is currently selected, instead of being torn down and rebuilt with
  // a full reload every time the viewer taps away from it and back, even to
  // a photo on the same card.
  const videoIndex = useMemo(
    () => mediaItems.findIndex((item) => item.type === "video"),
    [mediaItems],
  );
  const videoItem = videoIndex >= 0 ? mediaItems[videoIndex] : null;
  const photoUris = useMemo(
    () =>
      mediaItems
        .filter((item) => item.type === "image")
        .map((item) => item.uri),
    [mediaItems],
  );
  const photoIndexOf = useMemo(() => {
    const indexes: Record<string, number> = {};
    mediaItems.forEach((item, index) => {
      if (item.type === "image" && indexes[item.uri] === undefined)
        indexes[item.uri] = index;
    });
    return indexes;
  }, [mediaItems]);
  const markPhotoLoaded = useCallback((uri: string) => {
    setLoadedImages((current) =>
      current.has(uri) ? current : new Set([...current, uri]),
    );
  }, []);
  useEffect(() => {
    onPhotoSelected?.(
      currentMedia?.type === "image" ? currentMedia.uri : undefined,
    );
  }, [currentMedia?.uri, currentMedia?.type, onPhotoSelected]);
  const playbackActive =
    isActiveCard && (!isModalVisible || detailPlayback) && !pausedByGesture;
  // Photos advance on their own only on the card. In the expanded profile, as
  // in Tinder, they change when tapped, so a photo does not move away while the
  // profile below it is being read.
  const autoAdvanceMedia = !isModalVisible;
  const currentPlayback = useRef({
    currentIndex,
    playbackActive,
    cycle,
    autoAdvance: autoAdvanceMedia,
  });
  useLayoutEffect(() => {
    currentPlayback.current = {
      currentIndex,
      playbackActive,
      cycle,
      autoAdvance: autoAdvanceMedia,
    };
  }, [currentIndex, playbackActive, cycle, autoAdvanceMedia]);

  const handleNext = () => {
    if (mediaItems.length > 0) {
      timerGeneration.current += 1;
      const next =
        (currentPlayback.current.currentIndex + 1) % mediaItems.length;
      showMedia(next);
      currentPlayback.current = {
        ...currentPlayback.current,
        currentIndex: next,
        cycle: currentPlayback.current.cycle + 1,
      };
      setCurrentIndex(next);
      setCycle((value) => value + 1);
    }
  };

  const handlePrev = () => {
    if (currentPlayback.current.currentIndex > 0) {
      timerGeneration.current += 1;
      const previous = currentPlayback.current.currentIndex - 1;
      showMedia(previous);
      currentPlayback.current = {
        ...currentPlayback.current,
        currentIndex: previous,
        cycle: currentPlayback.current.cycle + 1,
      };
      setCurrentIndex(previous);
      setCycle((value) => value + 1);
    }
  };

  // The photo on screen and its bar are shared values, written by the tap
  // itself. Each change cancels the running timer and restarts the bar at zero
  // in the same step, so an old timer cannot move the new bar, and nothing
  // waits for React to re-render the card, the expanded profile and the deck.
  const progress = useSharedValue(0);
  const displayIndex = useSharedValue(0);
  const autoAdvance = useSharedValue(1);
  const showMedia = (next: number) => {
    cancelAnimation(progress);
    progress.value = 0;
    displayIndex.value = next;
    // The video's play state is also driven by React effects, in two separate
    // components (the card's and, while the profile is expanded, the modal's
    // own) - both eventually agree, but only once state has propagated down
    // through however many renders that takes. In between, on a tap that
    // leaves the video, it can keep playing where nothing is watching it -
    // caught on a real device advancing several seconds into the clip while
    // only browsing photos in the expanded view - and a tap back to it then
    // shows wherever it silently got to, frozen there until the next of
    // those effects finally lands. Commanding the player directly, here,
    // gives it an immediate, unambiguous instruction that does not wait on
    // any of that: those effects still run and land on the same answer, this
    // just means the answer is never late.
    if (videoPlayer) {
      try {
        if (next === videoIndex) {
          videoPlayer.play();
        } else if (currentPlayback.current.currentIndex === videoIndex) {
          // Leaving the video: reset it while paused and unwatched, not the
          // next time it is tapped back to - a seek backward on a video
          // already well into playback has to rebuffer from the new
          // position, which is real, visible work best done out of sight.
          videoPlayer.pause();
          videoPlayer.currentTime = 0;
        }
      } catch {
        // The player can be mid-teardown right as a card leaves the deck.
      }
    }
    const target = mediaItems[next];
    // Start filling now when the photo is already decoded. The timer effect
    // takes over after the render and continues from wherever this got to.
    if (
      target?.type === "image" &&
      loadedImagesRef.current.has(target.uri) &&
      currentPlayback.current.playbackActive &&
      currentPlayback.current.autoAdvance &&
      !gesturePaused?.value
    ) {
      progress.value = withTiming(1, { duration: 5000, easing: Easing.linear });
    }
  };
  useLayoutEffect(() => {
    displayIndex.value = currentIndex;
  }, [currentIndex, displayIndex]);
  useLayoutEffect(() => {
    autoAdvance.value = autoAdvanceMedia ? 1 : 0;
  }, [autoAdvanceMedia, autoAdvance]);
  useEffect(() => () => cancelAnimation(progress), [progress]);
  const activeVideoLayer = useAnimatedStyle(() => ({
    opacity: displayIndex.value === currentIndex ? 1 : 0,
  }));
  useAnimatedReaction(
    () => gesturePaused?.value ?? false,
    (paused) => {
      if (paused) cancelAnimation(progress);
      runOnJS(setPausedByGesture)(paused);
    },
  );

  const incrementIndex = (expectedIndex: number, generation?: number) => {
    if (
      gesturePaused?.value ||
      (generation !== undefined && generation !== timerGeneration.current) ||
      !currentPlayback.current.playbackActive ||
      !currentPlayback.current.autoAdvance ||
      currentPlayback.current.cycle !== cycle ||
      currentPlayback.current.currentIndex !== expectedIndex
    )
      return;
    timerGeneration.current += 1;
    showMedia((expectedIndex + 1) % mediaItems.length);
    currentPlayback.current = {
      ...currentPlayback.current,
      currentIndex: (expectedIndex + 1) % mediaItems.length,
      cycle: cycle + 1,
    };
    setCurrentIndex((index) =>
      index === expectedIndex ? (index + 1) % mediaItems.length : index,
    );
    setCycle((value) => value + 1);
  };

  const handleMediaError = () => {
    timerGeneration.current += 1;
    cancelAnimation(progress);
    setMediaError(true);
  };
  const mediaState: PlaybackState = mediaError
    ? "error"
    : currentMedia?.type === "video"
      ? videoState
      : currentMedia && loadedImages.has(currentMedia.uri)
        ? "ready"
        : "loading";
  useEffect(() => {
    // Report the media's real state while a profile is expanded too. Reporting
    // "loading" then made the deck re-render and release the next card's warm
    // video player as the profile opened, and rebuild it as it closed, both in
    // the middle of the animation.
    onMediaState?.(mediaState);
  }, [mediaState, onMediaState]);
  useEffect(() => {
    setSlowMedia(false);
    if (!isActiveCard || mediaState === "ready" || mediaState === "error")
      return;
    const timer = setTimeout(() => setSlowMedia(true), 8000);
    return () => clearTimeout(timer);
  }, [currentIndex, isActiveCard, mediaState]);

  useLayoutEffect(() => {
    setVideoReady(false);
    setMediaError(false);
    // The card's own VideoView unmounts while the profile is expanded (so it
    // is not fighting the modal's video view for the one native surface the
    // shared player can draw to), and remounts fresh the moment the profile
    // folds back in. That fresh view starts blank, same as any first load, so
    // it needs to go through the same "not ready yet" state - otherwise the
    // poster below never arms and the remount's blank frame shows through as
    // a flash of black right as the small card reappears.
  }, [currentIndex, cycle, isModalVisible]);

  useEffect(() => {
    const generation = ++timerGeneration.current;
    cancelAnimation(progress);
    if (
      playbackActive &&
      autoAdvanceMedia &&
      currentMedia?.type === "image" &&
      loadedImages.has(currentMedia.uri)
    ) {
      runOnUI(() => {
        if (gesturePaused?.value) return;
        const remaining = Math.max(0, 1 - progress.value) * 5000;
        progress.value = withTiming(
          1,
          { duration: remaining, easing: Easing.linear },
          (finished) => {
            if (finished && !gesturePaused?.value)
              runOnJS(incrementIndex)(currentIndex, generation);
          },
        );
      })();
    }
    return () => {
      timerGeneration.current += 1;
      cancelAnimation(progress);
    };
  }, [
    currentIndex,
    cycle,
    currentMedia?.uri,
    playbackActive,
    autoAdvanceMedia,
    loadedImages,
  ]);

  const sharedInterests = sharedInterestLabels(user);
  const cardInfo = (
    <View style={styles.infoOverlay}>
      <View style={styles.infoContentContainer}>
        <View style={styles.textContentContainer}>
          {/* ROW 1: Name, Year, Verification */}
          <View style={styles.nameRow}>
            <Text style={[styles.name, styles.shadowText]}>
              {user.name.split(" ")[0]}
              {(user as any).age ? `, ${(user as any).age}` : ""}
            </Text>
            {(user as any).blueBadge ? (
              <View style={styles.verifiedBadgeContainer}>
                <VerifiedBadge />
              </View>
            ) : null}
          </View>

          {/* ROW 2: Department and distance */}
          <Text style={[styles.locationText, styles.shadowText]}>
            {[user.department, user.distance].filter(Boolean).join(" · ")}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.expandCircle}
          activeOpacity={0.8}
          onPress={openProfile}
          accessibilityRole="button"
          accessibilityLabel={`Expand ${user.name}'s profile`}
        >
          <Ionicons name="chevron-up" size={25} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* ROW 3: Tags / Interests */}
      {user.tags && user.tags.length > 0 && (
        <View style={styles.tagsRow}>
          {user.tags.slice(0, 3).map((tag, idx) => (
            <View style={styles.intentBadge} key={idx}>
              <Ionicons name="heart-outline" size={14} color="#FFB6BF" />
              <Text style={styles.intentLabel} numberOfLines={2}>
                {tag}
              </Text>
            </View>
          ))}
        </View>
      )}
      {sharedInterests.length > 0 && (
        <Text
          style={[styles.sharedPreview, { marginTop: 6 }]}
          numberOfLines={1}
        >
          You both like {sharedInterests.slice(0, 2).map(interest => `${profileInterestEmoji(interest)} ${interest}`).join(" & ")}
        </Text>
      )}
      <Text
        style={[styles.profilePreviewLabel, { marginTop: 8 }]}
        numberOfLines={1}
      >
        More about {user.name.split(" ")[0]} · Tap the arrow
      </Text>
    </View>
  );
  const matchPercentage = compatibilityValue(user.matchPercentage);
  const getBadgeColor = compatibilityColor;

  const mediaProgress = (
    <View style={{ width: "100%", flexDirection: "row", height: 4, gap: 4 }}>
      {mediaItems.map((item, idx) => (
        <MediaProgressSegment
          key={idx}
          index={idx}
          isVideo={item.type === "video"}
          displayIndex={displayIndex}
          progress={progress}
          autoAdvance={autoAdvance}
        />
      ))}
    </View>
  );

  const showFallback = mediaError || mediaItems.length === 0 || !currentMedia;

  return (
    <View style={styles.container}>
      <View ref={cardView} collapsable={false} style={styles.card}>
        {/* UPPER SECTION: Media */}
        <View style={styles.mediaContainer}>
          {/* Background Media */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <PreparedPhotos
              key={retryToken}
              uris={photoUris}
              selectedIndex={displayIndex}
              indexOf={photoIndexOf}
              neighbours={isActiveCard}
              selectedUri={
                !showFallback && currentMedia?.type === "image"
                  ? currentMedia.uri
                  : undefined
              }
              onLoad={isModalVisible ? undefined : markPhotoLoaded}
              onError={(uri) => {
                if (uri === currentMedia?.uri) handleMediaError();
              }}
            />
            {showFallback ? (
              <LinearGradient
                colors={["#2c3e50", "#3498db"]}
                style={[
                  StyleSheet.absoluteFill,
                  { justifyContent: "center", alignItems: "center" },
                ]}
              >
                <Ionicons
                  name="person"
                  size={120}
                  color="rgba(255,255,255,0.2)"
                />
              </LinearGradient>
            ) : (
              videoItem && prepareVideo ? (
                <Animated.View
                  key="video"
                  style={[StyleSheet.absoluteFill, activeVideoLayer]}
                >
                  {/* Mounted for as long as this card has a video, whichever media is
                      currently selected - not only while the video happens to be the
                      one on screen. Its own `attached` prop (already used to keep it
                      out of the expanded profile's way) now also covers "a photo is
                      selected on this same card" the same way: the native view
                      detaches without destroying the player underneath, so coming
                      back to the video is instant instead of a fresh reload. */}
                  <CardVideo
                    attached={!isModalVisible && currentIndex === videoIndex}
                    onPlayer={setVideoPlayer}
                    key={videoItem.uri}
                    uri={videoItem.uri}
                    active={playbackActive && currentIndex === videoIndex}
                    foreground={isActiveCard}
                    retryToken={retryToken}
                    onState={setVideoState}
                    muted={isMuted}
                    loop={false}
                    style={StyleSheet.absoluteFill}
                    onReady={() => setVideoReady(true)}
                    onProgress={(time, duration) => {
                      if (gesturePaused?.value) return;
                      if (currentPlayback.current.cycle !== cycle) return;
                      if (currentPlayback.current.currentIndex !== videoIndex)
                        return;
                      if (duration > 0) {
                        const ratio = Math.max(0, Math.min(1, time / duration));
                        progress.value =
                          ratio < progress.value
                            ? ratio
                            : withTiming(ratio, {
                                duration: 100,
                                easing: Easing.linear,
                              });
                      }
                    }}
                    onFinish={() => incrementIndex(videoIndex)}
                  />
                  {/* Only the video's own "not ready yet" state shows this - a mere
                      tap away to a photo already reveals the photo layer underneath
                      once the (now detached) video view is gone. */}
                  {currentIndex === videoIndex && !videoReady && (
                    <View
                      style={[
                        StyleSheet.absoluteFill,
                        {
                          justifyContent: "center",
                          alignItems: "center",
                          backgroundColor: "#111",
                        },
                      ]}
                    >
                      {/* A blurred hold of the video's own poster while it attaches or
                          reattaches, so what is covering it still reads as "this video,
                          a moment from focusing" rather than a flat placeholder - and it
                          disappears the instant the sharp video is ready underneath. */}
                      {!!(videoItem.previewUri || user.imageUri) && (
                        <Image
                          source={{ uri: videoItem.previewUri || user.imageUri }}
                          style={StyleSheet.absoluteFill}
                          blurRadius={22}
                          fadeDuration={0}
                        />
                      )}
                      {/* The player itself already reports "ready" the whole time the
                          profile is expanded and collapsed, and while a photo is
                          selected on the same card - only the native view was
                          swapped out and back in, nothing was re-downloaded or
                          re-decoded. A spinner there would read as "loading from the
                          server", which it is not; the poster above already covers the
                          brief moment before the reattached view renders its first
                          frame. The spinner is for an actual load or rebuffer only. */}
                      {mediaState !== "ready" && (
                        <ActivityIndicator color={colors.primary} />
                      )}
                    </View>
                  )}
                </Animated.View>
              ) : null
            )}
          </View>

          {/* Match the gradient used during profile collapse. */}
          <LinearGradient
            colors={[
              "rgba(0,0,0,0)",
              "rgba(0,0,0,0.12)",
              "rgba(0,0,0,0.38)",
              "rgba(0,0,0,0.72)",
            ]}
            locations={[0, 0.3, 0.65, 1]}
            style={styles.bottomGradient}
            pointerEvents="none"
          />

          {/* Tap Zones */}
          <View style={styles.tapZonesContainer}>
            <TouchableOpacity
              accessibilityLabel="Previous photo or video"
              style={styles.tapZoneLeft}
              onPress={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              activeOpacity={1}
              delayPressIn={0}
            />
            <TouchableOpacity
              accessibilityLabel="Next photo or video"
              style={styles.tapZoneRight}
              onPress={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              activeOpacity={1}
              delayPressIn={0}
            />
          </View>

          {(mediaState === "error" ||
            slowMedia ||
            (videoReady && mediaState === "buffering")) && (
            <View
              style={{
                position: "absolute",
                top: "38%",
                left: 30,
                right: 30,
                alignItems: "center",
                zIndex: 20,
              }}
              pointerEvents="box-none"
            >
              {mediaState === "buffering" && !slowMedia ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <TouchableOpacity
                  accessibilityLabel="Retry media"
                  onPress={() => {
                    setMediaError(false);
                    setRetryToken((value) => value + 1);
                    setSlowMedia(false);
                  }}
                  style={{
                    backgroundColor: "#202024EE",
                    borderRadius: 20,
                    padding: 16,
                    alignItems: "center",
                  }}
                >
                  <Ionicons name="refresh" size={24} color="#fff" />
                  <Text style={{ color: "#fff", marginTop: 6 }}>
                    {mediaState === "error"
                      ? "Could not load media. Retry"
                      : "Taking longer than usual. Retry"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Top Progress Bar */}
          {!isModalVisible && (
            <View style={styles.progressContainer}>{mediaProgress}</View>
          )}

          {/* Top Badges (Match % + Mute Combined) */}
          {currentMedia?.type === "video" && !isModalVisible && (
            <TouchableOpacity
              style={styles.topSound}
              onPress={() => setIsMuted((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={isMuted ? "Turn sound on" : "Mute video"}
            >
              <Ionicons
                name={isMuted ? "volume-mute" : "volume-high"}
                size={22}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          )}
          <View style={styles.topBadgesOverlay} pointerEvents="box-none">
            <View
              style={[
                styles.matchPillContainer,
                matchPercentage == null && { display: "none" },
              ]}
            >
              <Text
                style={[
                  styles.matchPillText,
                  { color: getBadgeColor(matchPercentage) },
                ]}
              >
                {compatibilityLabel(matchPercentage)}
              </Text>
            </View>
            {!!user.activity && (
              <View pointerEvents="none">
                <ActivityPill activity={user.activity} />
              </View>
            )}
          </View>

          {cardInfo}
        </View>
      </View>

      <ProfileDetailModal
        onPhotoLoad={markPhotoLoaded}
        cardInfo={cardInfo}
        // Expansion state changes once, when the fold ends (onClose below).
        onCollapseStart={onCollapseStart}
        mediaProgress={mediaProgress}
        onPlaybackChange={setDetailPlayback}
        onNextMedia={handleNext}
        onPreviousMedia={handlePrev}
        selectedMediaUri={currentMedia?.uri}
        selectedMediaIndex={displayIndex}
        photoIndexOf={photoIndexOf}
        selectedMediaType={currentMedia?.type}
        origin={profileOrigin}
        // Keep the modal's native video surface attached while browsing
        // photos. Its shared index controls visibility without remounting.
        initialVideoPlayer={videoPlayer ?? undefined}
        user={user}
        initialPhotoUri={
          currentMedia?.type === "image" ? currentMedia.uri : undefined
        }
        isVisible={isModalVisible}
        onClose={() => {
          setIsModalVisible(false);
          onExpansionChange?.(false);
        }}
        onLike={() => decideAfterClose(onLike)}
        onPass={() => decideAfterClose(onPass)}
        // The Rose composer opens over the modal rather than closing it: the
        // reader may still cancel, and the card has to be there if they do.
        onRose={onRose}
        roseBalance={roseBalance}
        overlay={roseOverlay}
        onOverlayBack={onRoseOverlayBack}
        onReport={onReport}
        onBlock={onBlock}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 0,
    paddingBottom: 0,
    position: "relative",
  },
  card: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#000",
    width: "100%",
  },
  mediaContainer: {
    flex: 1,
    position: "relative",
    backgroundColor: "#000",
  },
  bottomGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "60%",
    zIndex: 2,
  },
  tapZonesContainer: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    zIndex: 5,
    elevation: 5,
  },
  tapZoneLeft: {
    flex: 1,
    height: "100%",
  },
  tapZoneRight: {
    flex: 1,
    height: "100%",
  },
  progressContainer: {
    flexDirection: "row",
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    height: 4,
    gap: 4,
    zIndex: 10,
  },
  progressItemContainer: {
    flex: 1,
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressItem: {
    height: "100%",
  },
  topBadgesOverlay: {
    position: "absolute",
    top: 24,
    left: 16,
    zIndex: 10,
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
  },
  matchPillContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  matchPillText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  muteDivider: {
    width: 1,
    height: 14,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginHorizontal: 8,
  },
  inlineMuteButton: {
    justifyContent: "center",
    alignItems: "center",
  },
  infoOverlay: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    zIndex: 10,
  },
  infoContentContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  textContentContainer: {
    flex: 1,
    paddingRight: 16,
  },
  upArrowContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(30, 32, 36, 0.95)", // Solid dark charcoal/grey from image
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  name: {
    flexShrink: 1,
    fontSize: 26,
    fontWeight: "700",
    color: "#FFF",
    letterSpacing: -0.5,
  },
  verifiedBadgeContainer: {
    marginLeft: 6,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
    marginTop: 2, // Slight downward shift for vertical alignment
  },
  verifiedBadgeBackground: {
    position: "absolute",
    width: 12,
    height: 12,
    backgroundColor: "#FFF",
    borderRadius: 6,
    zIndex: -1,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#00FF00",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.5)",
    marginLeft: 4,
  },
  locationText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    fontWeight: "500",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  intentBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#36252C",
  },
  intentLabel: {
    flexShrink: 1,
    color: "#FFE6EB",
    fontSize: 11,
    fontWeight: "500",
  },
  expandCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#242426",
    alignItems: "center",
    justifyContent: "center",
  },
  topSound: {
    position: "absolute",
    top: 30,
    right: 12,
    zIndex: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#242426",
    alignItems: "center",
    justifyContent: "center",
  },
  profilePreview: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#873D50",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  previewActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  soundButton: {
    width: 52,
    height: 56,
    borderRadius: 14,
    backgroundColor: "#44345E",
    alignItems: "center",
    justifyContent: "center",
  },
  soundButtonActive: { backgroundColor: "#7954B3" },
  sharedPreview: { color: "#D2CED8", fontSize: 11, lineHeight: 15 },
  profilePreviewLabel: {
    color: "#FFFFFF",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "400",
  },
  tagPillContainer: {
    borderRadius: 12,
    overflow: "hidden",
  },
  tagPill: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 12,
  },
  tagText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "500",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  shadowText: {
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
});
