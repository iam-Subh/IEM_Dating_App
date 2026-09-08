import { compatibilityValue, compatibilityColor, compatibilityLabel } from '../compatibility';
import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  cancelAnimation,
  runOnJS,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { colors } from "../../../core/theme/colors";
import { VideoView, useVideoPlayer } from "expo-video";
import { ProfileDetailModal } from "./profile-detail/ProfileDetailModal";

interface SwipeCardProps {
  user: {
    id: string;
    name: string;
    graduationYear: number | null;
    department: string;
    imageUri: string;
    intent: string;
    matchPercentage?: number | null;
    distance?: string;
    tags?: string[];
    photos?: string[];
    video?: string | null;
    videoPreview?: string | null;
  };
  onLike: () => void;
  onPass: () => void;
  onStar?: () => void;
  isActiveCard?: boolean;
}

interface CardVideoProps {
  uri: string;
  active: boolean;
  muted: boolean;
  loop: boolean;
  style: any;
  onReady: () => void;
  onError: () => void;
  onProgress?: (currentTime: number, duration: number) => void;
  onFinish?: () => void;
}

const CardVideo: React.FC<CardVideoProps> = ({
  uri,
  active,
  muted,
  loop,
  style,
  onReady,
  onError,
  onProgress,
  onFinish,
}) => {
  const player = useVideoPlayer({ uri }, (videoPlayer) => {
    videoPlayer.loop = loop;
    videoPlayer.muted = muted;
    videoPlayer.timeUpdateEventInterval = 0.1;
  });

  useEffect(() => {
    player.loop = loop;
    player.muted = muted;

    if (active) {
      player.play();
      return;
    }

    player.pause();
    player.currentTime = 0;
  }, [active, loop, muted, player]);

  useEffect(() => {
    const statusSubscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onError();
    });
    const timeSubscription = player.addListener('timeUpdate', ({ currentTime }) => {
      if (active && onProgress) onProgress(currentTime, player.duration);
    });
    const endSubscription = player.addListener('playToEnd', () => {
      player.currentTime = 0;
      onFinish?.();
    });

    return () => {
      statusSubscription.remove();
      timeSubscription.remove();
      endSubscription.remove();
    };
  }, [active, onError, onFinish, onProgress, player]);

  return (
    <VideoView
      player={player}
      style={style}
      contentFit="cover"
      nativeControls={false}
      onFirstFrameRender={onReady}
    />
  );
};

export const SwipeCard: React.FC<SwipeCardProps> = ({
  user,
  onLike,
  onPass,
  onStar,
  isActiveCard = true,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [fullVideoReady, setFullVideoReady] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);

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
        previewUri: user.videoPreview || undefined,
      });
    }
    if (user.photos && user.photos.length > 0) {
      user.photos.forEach((photo) => items.push({ type: "image", uri: photo }));
    }
    if (items.length === 0 && user.imageUri) {
      items.push({ type: "image", uri: user.imageUri });
    }
    return items;
  }, [user.video, user.videoPreview, user.photos, user.imageUri]);

  const currentMedia = mediaItems[currentIndex] || mediaItems[0];

  useEffect(() => {
    mediaItems.forEach((item) => {
      if (item.type === "image" && item.uri) {
        Image.prefetch(item.uri).catch((err) =>
          console.log("Prefetch error:", err),
        );
      }
    });
  }, [mediaItems]);

  const handleNext = () => {
    if (currentIndex < mediaItems.length - 1) {
      cancelAnimation(progress);
      progress.value = 0;
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      cancelAnimation(progress);
      progress.value = 0;
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const progress = useSharedValue(0);

  const animatedProgressStyle = useAnimatedStyle(() => {
    return {
      width: `${progress.value * 100}%`,
    };
  });

  const incrementIndex = () => {
    setCurrentIndex((prev) => prev + 1);
  };

  const handleMediaError = () => {
    if (currentIndex < mediaItems.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setMediaError(true);
    }
  };

  useEffect(() => {
    progress.value = 0;

    if (currentMedia && currentMedia.type === "image") {
      progress.value = withTiming(
        1,
        { duration: 5000, easing: Easing.linear },
        (finished) => {
          if (finished && currentIndex < mediaItems.length - 1) {
            runOnJS(incrementIndex)();
          }
        },
      );
    }

    return () => {
      cancelAnimation(progress);
    };
  }, [currentIndex, currentMedia]);

  const matchPercentage = compatibilityValue(user.matchPercentage);
  const getBadgeColor = compatibilityColor;

  const showFallback = mediaError || mediaItems.length === 0 || !currentMedia;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {/* UPPER SECTION: Media */}
        <View style={styles.mediaContainer}>
          {/* Background Media */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
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
              mediaItems.map((item, idx) => {
                const isActive = idx === currentIndex;
                return (
                  <View
                    key={idx}
                    style={[
                      StyleSheet.absoluteFill,
                      { opacity: isActive ? 1 : 0 },
                    ]}
                  >
                    {item.type === "video" ? (
                      <>
                        {item.previewUri ? (
                          <>
                            {!videoReady && !fullVideoReady && (
                              <View
                                style={[
                                  StyleSheet.absoluteFill,
                                  {
                                    backgroundColor: "#111",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    zIndex: 1,
                                  },
                                ]}
                              >
                                <ActivityIndicator
                                  size="large"
                                  color={colors.primary}
                                />
                              </View>
                            )}
                            <CardVideo
                              uri={item.previewUri}
                              style={[
                                StyleSheet.absoluteFill,
                                { opacity: fullVideoReady ? 0 : 1 },
                              ]}
                              active={
                                isActiveCard && isActive && !fullVideoReady
                              }
                              loop
                              muted={isMuted}
                              onReady={() => setVideoReady(true)}
                              onError={handleMediaError}
                            />
                            <CardVideo
                              uri={item.uri}
                              style={[
                                StyleSheet.absoluteFill,
                                { opacity: fullVideoReady ? 1 : 0 },
                              ]}
                              active={
                                isActiveCard && isActive && fullVideoReady
                              }
                              loop={false}
                              muted={isMuted}
                              onReady={() => setFullVideoReady(true)}
                              onError={handleMediaError}
                              onProgress={(currentTime, duration) => {
                                if (isActive && fullVideoReady && duration > 0) {
                                  progress.value = currentTime / duration;
                                }
                              }}
                              onFinish={() => {
                                if (currentIndex < mediaItems.length - 1) {
                                  setCurrentIndex((prev) => prev + 1);
                                }
                              }}
                            />
                          </>
                        ) : (
                          <>
                            {!videoReady && (
                              <View
                                style={[
                                  StyleSheet.absoluteFill,
                                  {
                                    backgroundColor: "#111",
                                    justifyContent: "center",
                                    alignItems: "center",
                                  },
                                ]}
                              >
                                <ActivityIndicator
                                  size="large"
                                  color={colors.primary}
                                />
                              </View>
                            )}
                            <CardVideo
                              uri={item.uri}
                              style={[
                                StyleSheet.absoluteFill,
                                { opacity: videoReady ? 1 : 0 },
                              ]}
                              active={isActiveCard && isActive}
                              loop={false}
                              muted={isMuted}
                              onReady={() => setVideoReady(true)}
                              onError={handleMediaError}
                              onProgress={(currentTime, duration) => {
                                if (isActive && duration > 0) {
                                  progress.value = currentTime / duration;
                                }
                              }}
                              onFinish={() => {
                                if (currentIndex < mediaItems.length - 1) {
                                  setCurrentIndex((prev) => prev + 1);
                                }
                              }}
                            />
                          </>
                        )}
                      </>
                    ) : (
                      <ImageBackground
                        source={{ uri: item.uri }}
                        style={StyleSheet.absoluteFill}
                        onError={handleMediaError}
                      />
                    )}
                  </View>
                );
              })
            )}
          </View>

          {/* Bottom Gradient for Text Readability - strictly 60% overlay */}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.9)"]}
            style={styles.bottomGradient}
            pointerEvents="none"
          />

          {/* Tap Zones */}
          <View style={styles.tapZonesContainer}>
            <TouchableOpacity
              style={styles.tapZoneLeft}
              onPress={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              activeOpacity={1}
              delayPressIn={0}
            />
            <TouchableOpacity
              style={styles.tapZoneRight}
              onPress={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              activeOpacity={1}
              delayPressIn={0}
            />
          </View>

          {/* Top Progress Bar */}
          <View style={styles.progressContainer}>
            {mediaItems.map((_, idx) => {
              const isCompleted = idx < currentIndex;
              const isActive = idx === currentIndex;

              return (
                <View key={idx} style={styles.progressItemContainer}>
                  {isCompleted ? (
                    <View
                      style={[
                        styles.progressItem,
                        { width: "100%", backgroundColor: "#FFF" },
                      ]}
                    />
                  ) : isActive ? (
                    <Animated.View
                      style={[
                        styles.progressItem,
                        animatedProgressStyle,
                        { backgroundColor: "#FFF" },
                      ]}
                    />
                  ) : (
                    <View style={[styles.progressItem, { width: "0%" }]} />
                  )}
                </View>
              );
            })}
          </View>

          {/* Top Badges (Match % + Mute Combined) */}
          <View style={styles.topBadgesOverlay} pointerEvents="box-none">
            <View style={styles.matchPillContainer}>
              <Text
                style={[
                  styles.matchPillText,
                  { color: getBadgeColor(matchPercentage) },
                ]}
              >
                {compatibilityLabel(matchPercentage)}
              </Text>
              {currentMedia &&
                currentMedia.type === "video" &&
                !showFallback && (
                  <>
                    <View style={styles.muteDivider} />
                    <TouchableOpacity
                      style={styles.inlineMuteButton}
                      onPress={() => setIsMuted((prev) => !prev)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={isMuted ? "volume-mute" : "volume-medium"}
                        size={16}
                        color="#FFF"
                      />
                    </TouchableOpacity>
                  </>
                )}
            </View>
          </View>

          {/* Info Overlay (3 Rows: Name/Year/Badges -> Department/Distance -> Interests) */}
          <View style={styles.infoOverlay} pointerEvents="box-none">
            <View style={styles.infoContentContainer}>
              <View style={styles.textContentContainer}>
                {/* ROW 1: Name, Year, Verification, Online Status */}
                <View style={styles.nameRow}>
                  <Text style={[styles.name, styles.shadowText]}>
                    {user.name.split(" ")[0]}{user.graduationYear ? `, Class of ${user.graduationYear}` : ''}
                  </Text>
                  {(user as any).isVerified ? (
                    <View style={styles.verifiedBadgeContainer}>
                      <View style={styles.verifiedBadgeBackground} />
                      <MaterialIcons name="verified" size={20} color="#3b82f6" />
                    </View>
                  ) : null}
                  <View style={styles.onlineDot} />
                </View>

                {/* ROW 2: Department and distance */}
                <Text style={[styles.locationText, styles.shadowText]}>
                  {user.department} • {user.distance || "2.4km"}
                </Text>
              </View>

              {/* Up Arrow Icon Button (Right side) */}
              <TouchableOpacity
                style={styles.upArrowContainer}
                activeOpacity={0.8}
                onPress={() => setIsModalVisible(true)}
              >
                <MaterialIcons
                  name="keyboard-arrow-up"
                  size={30}
                  color="#FFF"
                />
              </TouchableOpacity>
            </View>

            {/* ROW 3: Tags / Interests */}
            {user.tags && user.tags.length > 0 && (
              <View style={styles.tagsRow}>
                {user.tags.slice(0, 3).map((tag, idx) => (
                  <BlurView
                    intensity={20}
                    style={styles.tagPillContainer}
                    key={idx}
                    tint="light"
                  >
                    <View style={styles.tagPill}>
                      <Text style={styles.tagText}>{tag}</Text>
                    </View>
                  </BlurView>
                ))}
              </View>
            )}
          </View>
        </View>
      </View>

      <ProfileDetailModal
        user={user}
        isVisible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
        onLike={onLike}
        onPass={onPass}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 8,
    paddingBottom: 24,
    position: "relative",
  },
  card: {
    flex: 1,
    borderRadius: 20,
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
    flexDirection: "row",
    alignItems: "center",
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
    bottom: 24,
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
    fontSize: 24,
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
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    fontWeight: "500",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
    fontSize: 12,
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
