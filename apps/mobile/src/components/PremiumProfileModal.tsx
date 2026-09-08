import { compatibilityValue, compatibilityLabel, compatibilityColor } from '../features/discovery/compatibility';
import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  ScrollView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../core/theme/colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_HEIGHT = SCREEN_HEIGHT * 0.85;
const CARD_MARGIN = 24;
const CARD_WIDTH = SCREEN_WIDTH - CARD_MARGIN * 2;

interface MediaItem {
  type: 'image' | 'video';
  uri: string;
}

interface PremiumProfileModalProps {
  visible: boolean;
  onClose: () => void;
  user: {
    id: string;
    name: string;
    age?: number;
    graduationYear?: number | null;
    department?: string;
    college?: string;
    imageUri: string;
    photos?: string[];
    video?: string | null;
    bio?: string;
    seeking?: string;
    gender?: string;
    orientation?: string[];
    clubs?: string[];
    hangoutSpots?: string[];
    isVerified?: boolean;
    matchPercentage?: number | null;
    distance?: string;
  };
}

export const PremiumProfileModal: React.FC<PremiumProfileModalProps> = ({
  visible,
  onClose,
  user,
}) => {
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.9);
  const [currentMediaIndex, setCurrentMediaIndex] = React.useState(0);

  const mediaItems: MediaItem[] = React.useMemo(() => {
    const items: MediaItem[] = [];
    if (user.video) {
      items.push({ type: 'video', uri: user.video });
    }
    if (user.photos && user.photos.length > 0) {
      user.photos.forEach((photo) => items.push({ type: 'image', uri: photo }));
    }
    if (items.length === 0 && user.imageUri) {
      items.push({ type: 'image', uri: user.imageUri });
    }
    return items;
  }, [user.video, user.photos, user.imageUri]);

  const openModal = React.useCallback(() => {
    translateY.value = withSpring(0, {
      damping: 25,
      stiffness: 300,
      mass: 1,
    });
    opacity.value = withTiming(1, { duration: 300 });
    scale.value = withTiming(1, { duration: 300 });
  }, [translateY, opacity, scale]);

  const closeModal = React.useCallback(() => {
    translateY.value = withTiming(SCREEN_HEIGHT, { duration: 250 }, () => {
      runOnJS(onClose)();
    });
    opacity.value = withTiming(0, { duration: 200 });
    scale.value = withTiming(0.9, { duration: 200 });
  }, [translateY, opacity, scale, onClose]);

  React.useEffect(() => {
    if (visible) {
      openModal();
    } else {
      closeModal();
    }
  }, [visible]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
        opacity.value = interpolate(
          e.translationY,
          [0, SCREEN_HEIGHT],
          [1, 0],
          Extrapolation.CLAMP
        );
      }
    })
    .onEnd((e) => {
      if (e.translationY > SCREEN_HEIGHT * 0.3 || e.velocityY > 1500) {
        closeModal();
      } else {
        translateY.value = withSpring(0, { damping: 20, stiffness: 300 });
        opacity.value = withTiming(1, { duration: 200 });
      }
    })
    .enabled(true);

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    borderRadius: interpolate(scale.value, [0.9, 1], [20, 28]),
  }));

  const animatedBackdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const matchPercentage = compatibilityValue(user.matchPercentage);
  const getMatchColor = compatibilityColor;

  return (
    <View style={styles.container} pointerEvents={visible ? 'auto' : 'none'}>
      {/* Backdrop */}
      <Animated.View 
        style={[styles.backdrop, animatedBackdropStyle]} 
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <TouchableOpacity 
          style={StyleSheet.absoluteFill} 
          onPress={closeModal}
          activeOpacity={1}
        />
      </Animated.View>

      {/* Modal Content */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.modalContent, animatedCardStyle]}>
          {/* Handle Bar */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Media Section */}
          <View style={styles.mediaSection}>
            {mediaItems.length > 0 && (
              <>
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onScroll={(e) => {
                    const index = Math.round(
                      e.nativeEvent.contentOffset.x / CARD_WIDTH
                    );
                    setCurrentMediaIndex(index);
                  }}
                  scrollEventThrottle={16}
                >
                  {mediaItems.map((item, index) => (
                    <View key={index} style={styles.mediaItem}>
                      <Image
                        source={{ uri: item.uri }}
                        style={styles.mediaImage}
                        resizeMode="cover"
                      />
                      {item.type === 'video' && (
                        <View style={styles.videoBadge}>
                          <Ionicons name="videocam" size={16} color="#fff" />
                        </View>
                      )}
                    </View>
                  ))}
                </ScrollView>

                {/* Pagination Dots */}
                {mediaItems.length > 1 && (
                  <View style={styles.pagination}>
                    {mediaItems.map((_, index) => (
                      <View
                        key={index}
                        style={[
                          styles.paginationDot,
                          index === currentMediaIndex && styles.paginationDotActive,
                        ]}
                      />
                    ))}
                  </View>
                )}

                {/* Media Controls */}
                <View style={styles.mediaControls}>
                  <TouchableOpacity style={styles.controlButton}>
                    <Feather name="maximize" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Gradient Overlay */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.95)']}
              style={styles.gradientOverlay}
              pointerEvents="none"
            />

            {/* Top Badges */}
            <View style={styles.topBadges}>
              {matchPercentage !== null && (
                <View style={[styles.matchBadge, { borderColor: getMatchColor(matchPercentage) }]}>
                  <Text style={[styles.matchText, { color: getMatchColor(matchPercentage) }]}>
                    {compatibilityLabel(matchPercentage)}
                  </Text>
                </View>
              )}
              {user.isVerified && (
                <View style={styles.verifiedBadge}>
                  <MaterialIcons name="verified" size={16} color="#3b82f6" />
                  <Text style={styles.verifiedText}>Verified</Text>
                </View>
              )}
            </View>

            {/* User Info Overlay */}
            <View style={styles.infoOverlay}>
              <View style={styles.headerRow}>
                <Text style={styles.name}>
                  {user.name}{user.age ? `, ${user.age}` : ''}
                </Text>
                {user.distance && (
                  <View style={styles.distanceBadge}>
                    <Ionicons name="location" size={14} color="#fff" />
                    <Text style={styles.distanceText}>{user.distance}</Text>
                  </View>
                )}
              </View>

              {(user.graduationYear || user.department) && (
                <Text style={styles.academicInfo}>
                  {[user.graduationYear ? `Class of ${user.graduationYear}` : null, user.department].filter(Boolean).join(' • ')}
                </Text>
              )}
              {user.college && (
                <Text style={styles.collegeInfo}>{user.college}</Text>
              )}
            </View>
          </View>

          {/* Scrollable Details Section */}
          <ScrollView
            style={styles.detailsSection}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.detailsContent}
          >
            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity style={[styles.actionButton, styles.passButton]}>
                <Ionicons name="close-circle" size={32} color="#ef4444" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.superLikeButton]}>
                <Ionicons name="star" size={28} color="#fbbf24" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.likeButton]}>
                <Ionicons name="heart-circle" size={32} color="#22c55e" />
              </TouchableOpacity>
            </View>

            {/* About Section */}
            {user.seeking && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="heart-outline" size={18} color={colors.primary} />
                  <Text style={styles.sectionTitle}>Looking For</Text>
                </View>
                <Text style={styles.sectionContent}>{user.seeking}</Text>
              </View>
            )}

            {user.bio && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="person-outline" size={18} color={colors.primary} />
                  <Text style={styles.sectionTitle}>About</Text>
                </View>
                <Text style={styles.sectionContent}>{user.bio}</Text>
              </View>
            )}

            {(user.clubs && user.clubs.length > 0) || (user.hangoutSpots && user.hangoutSpots.length > 0) ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
                  <Text style={styles.sectionTitle}>Interests</Text>
                </View>
                <View style={styles.chipsContainer}>
                  {user.clubs?.map((club, i) => (
                    <View key={`club-${i}`} style={styles.chip}>
                      <Text style={styles.chipText}>{club}</Text>
                    </View>
                  ))}
                  {user.hangoutSpots?.map((spot, i) => (
                    <View key={`spot-${i}`} style={styles.chip}>
                      <Text style={styles.chipText}>{spot}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Common Connections Placeholder */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="people-outline" size={18} color={colors.primary} />
                <Text style={styles.sectionTitle}>Common</Text>
              </View>
              <Text style={styles.commonText}>No common connections yet</Text>
            </View>

            {/* Bottom Spacer */}
            <View style={{ height: 40 }} />
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  modalContent: {
    position: 'absolute',
    bottom: 0,
    left: CARD_MARGIN,
    right: CARD_MARGIN,
    height: CARD_HEIGHT,
    backgroundColor: '#0f0f0f',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 20,
  },
  handleContainer: {
    paddingTop: 16,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  mediaSection: {
    height: CARD_HEIGHT * 0.55,
    position: 'relative',
  },
  mediaItem: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT * 0.55,
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pagination: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  paginationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  paginationDotActive: {
    backgroundColor: '#fff',
    width: 20,
  },
  mediaControls: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  controlButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    ...({ backdropFilter: 'blur(10px)' } as Record<string, string>),
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '70%',
  },
  topBadges: {
    position: 'absolute',
    top: 40,
    left: 16,
    flexDirection: 'row',
    gap: 8,
  },
  matchBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    ...({ backdropFilter: 'blur(10px)' } as Record<string, string>),
  },
  matchText: {
    fontSize: 13,
    fontWeight: '700',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3b82f6',
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  name: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    ...({ backdropFilter: 'blur(10px)' } as Record<string, string>),
  },
  distanceText: {
    fontSize: 13,
    color: '#fff',
    marginLeft: 4,
    fontWeight: '500',
  },
  academicInfo: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 2,
  },
  collegeInfo: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  detailsSection: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  detailsContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    paddingVertical: 16,
    marginBottom: 8,
  },
  actionButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  passButton: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderColor: 'rgba(239,68,68,0.3)',
  },
  likeButton: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderColor: 'rgba(34,197,94,0.3)',
  },
  superLikeButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(251,191,36,0.1)',
    borderColor: 'rgba(251,191,36,0.3)',
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
  },
  sectionContent: {
    fontSize: 15,
    color: colors.text.secondary,
    lineHeight: 22,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  chipText: {
    fontSize: 13,
    color: colors.text.primary,
    fontWeight: '500',
  },
  commonText: {
    fontSize: 14,
    color: colors.text.tertiary,
    fontStyle: 'italic',
  },
});
