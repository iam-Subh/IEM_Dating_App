import { compatibilityLabel } from '../../compatibility';
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, Dimensions, ActivityIndicator, Text, TouchableOpacity, ScrollView, Image, Animated, Pressable } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { colors } from '../../../../core/theme/colors';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;

interface ProfileMediaGalleryProps {
  user: any;
  isVisible: boolean; // Indicates if the modal is currently open
}

const GalleryVideo: React.FC<{
  uri: string;
  active: boolean;
  muted: boolean;
  style: any;
  onReady: () => void;
  onError: () => void;
}> = ({ uri, active, muted, style, onReady, onError }) => {
  const player = useVideoPlayer({ uri }, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = muted;
  });

  useEffect(() => {
    player.muted = muted;
    if (active) {
      player.play();
    } else {
      player.pause();
      player.currentTime = 0;
    }
  }, [active, muted, player]);

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onError();
    });
    return () => subscription.remove();
  }, [onError, player]);

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

export const ProfileMediaGallery: React.FC<ProfileMediaGalleryProps> = ({ user, isVisible }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [mediaReady, setMediaReady] = useState<Record<number, boolean>>({});
  const [mediaError, setMediaError] = useState<Record<number, boolean>>({});
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);

  const mediaItems = useMemo(() => {
    const items: { type: 'video' | 'image', uri: string, previewUri?: string }[] = [];
    if (user.video) {
      items.push({ type: 'video', uri: user.video, previewUri: user.videoPreview || undefined });
    }
    if (user.photos && user.photos.length > 0) {
      user.photos.forEach((photo: string) => items.push({ type: 'image', uri: photo }));
    }
    if (items.length === 0 && user.imageUri) {
      items.push({ type: 'image', uri: user.imageUri });
    }
    return items;
  }, [user]);

  const goToIndex = useCallback((index: number) => {
    if (index < 0 || index >= mediaItems.length) return;
    scrollViewRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    setCurrentIndex(index);
    scrollX.setValue(index * SCREEN_WIDTH);
  }, [mediaItems.length, scrollX]);

  const handleTapLeft = useCallback(() => {
    if (currentIndex > 0) {
      goToIndex(currentIndex - 1);
    }
  }, [currentIndex, goToIndex]);

  const handleTapRight = useCallback(() => {
    if (currentIndex < mediaItems.length - 1) {
      goToIndex(currentIndex + 1);
    }
  }, [currentIndex, mediaItems.length, goToIndex]);

  const handleScroll = (event: any) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const index = event.nativeEvent.contentOffset.x / slideSize;
    const roundIndex = Math.round(index);
    if (roundIndex !== currentIndex) {
      setCurrentIndex(roundIndex);
    }
    // Track scroll position for smooth indicator animation
    scrollX.setValue(event.nativeEvent.contentOffset.x);
  };

  const showFallback = mediaItems.length === 0;

  if (showFallback) {
    return (
      <View style={[styles.container, { height: SCREEN_HEIGHT * 0.65 }]}>
        <LinearGradient
          colors={['#2c3e50', '#3498db']}
          style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}
        >
          <Ionicons name="person" size={120} color="rgba(255,255,255,0.2)" />
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height: SCREEN_HEIGHT * 0.50 }]}>
      {/* Main Media Display */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 0 }}
      >
        {mediaItems.map((item, idx) => {
          const isActive = idx === currentIndex;
          const isError = mediaError[idx];
          
          return (
            <View key={idx} style={{ width: SCREEN_WIDTH, height: '100%' }}>
              {!mediaReady[idx] && !isError && (
                 <View style={[StyleSheet.absoluteFill, styles.loaderContainer]}>
                   <ActivityIndicator size="large" color={colors.primary} />
                 </View>
              )}
              
              {isError ? (
                <View style={[StyleSheet.absoluteFill, styles.loaderContainer]}>
                  <Ionicons name="image-outline" size={60} color="rgba(255,255,255,0.4)" />
                </View>
              ) : item.type === 'video' ? (
                <GalleryVideo
                  uri={item.uri}
                  style={[StyleSheet.absoluteFill, { opacity: mediaReady[idx] ? 1 : 0 }]}
                  active={isVisible && isActive}
                  muted={isMuted}
                  onReady={() => setMediaReady(prev => ({...prev, [idx]: true}))}
                  onError={() => setMediaError(prev => ({...prev, [idx]: true}))}
                />
              ) : (
                <Image
                  source={{ uri: item.uri }}
                  style={[StyleSheet.absoluteFill, { opacity: mediaReady[idx] ? 1 : 0 }]}
                  onLoad={() => setMediaReady(prev => ({...prev, [idx]: true}))}
                  onError={() => setMediaError(prev => ({...prev, [idx]: true}))}
                />
              )}

              {/* Mute/Unmute Toggle for Video */}
              {item.type === 'video' && isActive && (
                <TouchableOpacity
                  style={styles.muteButton}
                  onPress={() => setIsMuted(prev => !prev)}
                  activeOpacity={0.7}
                >
                  <Ionicons 
                    name={isMuted ? "volume-mute" : "volume-high"} 
                    size={20} 
                    color="#FFF" 
                  />
                </TouchableOpacity>
              )}

              {/* Tap Zones inside each item allows ScrollView to still handle swipes */}
              {mediaItems.length > 1 && (
                <View style={styles.tapZoneContainer} pointerEvents="box-none">
                  <Pressable
                    style={styles.tapZoneLeft}
                    onPress={handleTapLeft}
                  />
                  <Pressable
                    style={styles.tapZoneRight}
                    onPress={handleTapRight}
                  />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Top Bar: Indicators with Progress Animation */}
      {mediaItems.length > 1 && (
        <View style={styles.topBar}>
          <View style={styles.indicatorContainer}>
            {mediaItems.map((_, idx) => {
              const isCompleted = idx < currentIndex;
              const isActive = idx === currentIndex;
              
              return (
                <View 
                  key={idx} 
                  style={styles.indicatorDotBackground}
                >
                  {/* Background track */}
                  <View style={styles.indicatorTrack} />
                  
                  {/* Progress fill - animates from left to right */}
                  <Animated.View 
                    style={[
                      styles.indicatorFill,
                      {
                        width: isCompleted ? 
                          '100%' :
                          isActive ?
                            scrollX.interpolate({
                              inputRange: [
                                (currentIndex - 1) * SCREEN_WIDTH,
                                currentIndex * SCREEN_WIDTH,
                                (currentIndex + 1) * SCREEN_WIDTH
                              ],
                              outputRange: ['0%', '100%', '0%'],
                              extrapolate: 'clamp'
                            }) :
                            '0%'
                    }
                    ]} 
                  />
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Bottom Info Overlay: Name, Age, Match %, Status */}
      <View style={styles.infoOverlay}>
        <View style={styles.infoRow}>
          {/* Name, Age, Verified Badge */}
          <View style={styles.nameContainer}>
            <Text style={styles.nameText}>
              {user.name?.split(' ')[0]}{user.age ? `, ${user.age}` : ''}
            </Text>
            {(user as any).isVerified ? (
              <View style={styles.verifiedBadgeContainer}>
                <View style={styles.verifiedBadgeBackground} />
                <MaterialIcons name="verified" size={24} color="#3b82f6" />
              </View>
            ) : null}
          </View>

          {/* Match Percentage Badge */}
          <View style={styles.matchBadge}>
            <Text style={styles.matchText}>{compatibilityLabel(user.matchPercentage)}</Text>
          </View>
        </View>

        {/* Active Status */}
        <View style={styles.statusContainer}>
          <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.7)" />
          <Text style={styles.statusText}>Active recently</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
    backgroundColor: '#111',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    overflow: 'hidden',
    marginHorizontal: 0,
  },
  loaderContainer: {
    backgroundColor: '#111', 
    justifyContent: 'center', 
    alignItems: 'center',
    zIndex: 1,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 24,
    zIndex: 10,
  },
  indicatorContainer: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  indicatorDotBackground: {
    width: 8,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  indicatorTrack: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 4,
  },
  indicatorFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 2,
  },
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    zIndex: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  nameText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  verifiedBadgeContainer: {
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginTop: 4, // Slight downward shift
  },
  verifiedBadgeBackground: {
    position: 'absolute',
    width: 14,
    height: 14,
    backgroundColor: '#FFF',
    borderRadius: 7,
    zIndex: -1,
  },
  matchBadge: {
    backgroundColor: 'rgba(255, 92, 92, 0.9)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  matchText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    zIndex: 2,
  },
  tapZoneContainer: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    zIndex: 5,
  },
  tapZoneLeft: {
    width: '30%',
    height: '100%',
  },
  tapZoneRight: {
    flex: 1,
    height: '100%',
  },
  muteButton: {
    position: 'absolute',
    bottom: 82,
    right: 22,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100, // Ensure it's above tap zones
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
});
