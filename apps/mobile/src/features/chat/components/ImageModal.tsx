import React, { useCallback, useState, useRef, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  View,
  Dimensions,
  TouchableOpacity,
  StatusBar,
  Platform,
  Text,
  FlatList,
  ScrollView,
  Alert,
  Share,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import {
  GestureHandlerRootView,
  GestureDetector,
  Gesture,
} from 'react-native-gesture-handler';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as MediaLibrary from 'expo-media-library';
import { Directory, File as FileSystemFile, Paths } from 'expo-file-system';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ZoomableImageProps {
  uri: string;
  onZoomChange: (zoomed: boolean) => void;
}

const ZoomableImage = ({ uri, onZoomChange }: ZoomableImageProps) => {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const resetValues = useCallback(() => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    runOnJS(onZoomChange)(false);
  }, [onZoomChange]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = savedScale.value * e.scale;
      if (scale.value > 1) {
        runOnJS(onZoomChange)(true);
      }
    })
    .onEnd(() => {
      if (scale.value < 1) {
        resetValues();
      } else {
        savedScale.value = scale.value;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      if (scale.value > 1) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      } else {
        resetValues();
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onStart(() => {
      if (scale.value > 1) {
        resetValues();
      } else {
        scale.value = withSpring(2.5);
        savedScale.value = 2.5;
        runOnJS(onZoomChange)(true);
      }
    });

  const composedGestures = Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    };
  });

  return (
    <GestureDetector gesture={composedGestures}>
      <Animated.Image
        source={{ uri }}
        style={[styles.image, animatedStyle]}
        resizeMode="contain"
      />
    </GestureDetector>
  );
};

const ViewerVideo = ({ uri }: { uri: string }) => {
  const player = useVideoPlayer({ uri }, (video) => {
    video.loop = false;
    video.play();
  });
  return <VideoView player={player} style={styles.image} contentFit="contain" nativeControls />;
};

interface ImageModalProps {
  isVisible: boolean;
  imageUrls: string[];
  initialIndex: number;
  caption?: string | null;
  mediaTypes?: Array<'image' | 'video'>;
  /** Stills for the strip, where a video's own URL cannot be drawn. */
  thumbnailUrls?: Array<string | null>;
  onClose: () => void;
}

export const ImageModal = ({ isVisible, imageUrls, initialIndex, caption, mediaTypes = [], thumbnailUrls, onClose }: ImageModalProps) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (isVisible) {
      setCurrentIndex(initialIndex);
      // Wait for layout to mount properly before scrolling
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: initialIndex, animated: false });
      }, 50);
    }
  }, [isVisible, initialIndex]);

  const handleZoomChange = useCallback((zoomed: boolean) => {
    setScrollEnabled(!zoomed);
  }, []);

  const saveCurrent = useCallback(async () => {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo and video access to save this item.');
        return;
      }
      let uri = imageUrls[currentIndex];
      if (/^https?:\/\//i.test(uri)) {
        const directory = new Directory(Paths.cache, 'chat-viewer');
        directory.create({ idempotent: true, intermediates: true });
        uri = (await FileSystemFile.downloadFileAsync(uri, directory, { idempotent: true })).uri;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved', 'The item is in your media library.');
    } catch {
      Alert.alert('Save failed', 'The item could not be saved.');
    }
  }, [currentIndex, imageUrls]);

  const shareCurrent = useCallback(async () => {
    const uri = imageUrls[currentIndex];
    if (uri) await Share.share({ message: uri, url: uri });
  }, [currentIndex, imageUrls]);

  if (!imageUrls || imageUrls.length === 0) return null;

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="black" />
        
        {/* Deep Frosted Overlay */}
        {Platform.OS === 'ios' ? (
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.92)' }]} />
        )}

        <TouchableOpacity 
          style={styles.closeButton} 
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Ionicons name="close-circle" size={36} color="white" />
        </TouchableOpacity>

        <FlatList
          ref={flatListRef}
          data={imageUrls}
          horizontal
          pagingEnabled
          scrollEnabled={scrollEnabled}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
            setCurrentIndex(idx);
          }}
          keyExtractor={(item, index) => `${item}-${index}`}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          renderItem={({ item, index }) => (
            <GestureHandlerRootView style={styles.gestureContainer}>
              {mediaTypes[index] === 'video' ? (
                <ViewerVideo uri={item} />
              ) : (
                <ZoomableImage uri={item} onZoomChange={handleZoomChange} />
              )}
            </GestureHandlerRootView>
          )}
        />

        {/* Connected Footer Container */}
        <View style={styles.footerContainer}>
          {currentIndex === 0 && !!caption && (
            <View style={styles.captionFooterInner}>
              <Text style={styles.captionText}>{caption}</Text>
            </View>
          )}

          {imageUrls.length > 1 && (
            <View style={styles.thumbnailsWrapper}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailsContent}>
                {imageUrls.map((url, index) => (
                  <TouchableOpacity 
                    key={index} 
                    onPress={() => {
                      setCurrentIndex(index);
                      flatListRef.current?.scrollToIndex({ index, animated: true });
                    }}
                    style={[
                      styles.thumbnailCard,
                      currentIndex === index && styles.thumbnailCardActive
                    ]}
                  >
                    <Animated.Image source={{ uri: thumbnailUrls?.[index] ?? url }} style={styles.thumbnail} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={styles.viewerActions}>
            <TouchableOpacity style={styles.viewerAction} onPress={() => void saveCurrent()} accessibilityRole="button" accessibilityLabel="Save media">
              <Ionicons name="download-outline" size={22} color="#fff" />
              <Text style={styles.viewerActionText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.viewerAction} onPress={() => void shareCurrent()} accessibilityRole="button" accessibilityLabel="Share media">
              <Ionicons name="share-outline" size={22} color="#fff" />
              <Text style={styles.viewerActionText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  gestureContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  closeButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 20,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  footerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    paddingTop: 12,
  },
  captionFooterInner: {
    paddingHorizontal: 20,
    paddingTop: 4,
    marginBottom: 8,
  },
  captionText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  thumbnailsWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 52,
    marginBottom: 8,
  },
  thumbnailsContent: {
    alignItems: 'center',
    paddingRight: 16,
  },
  thumbnailCard: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginRight: 8,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  thumbnailCardActive: {
    borderWidth: 2,
    borderColor: '#F94E27', 
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  viewerActions: { flexDirection: 'row', justifyContent: 'center', gap: 34, paddingTop: 8 },
  viewerAction: { minWidth: 58, alignItems: 'center', gap: 2 },
  viewerActionText: { color: '#fff', fontSize: 12 },
});
