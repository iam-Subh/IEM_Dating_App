import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal, 
  TouchableOpacity, 
  Image, 
  Dimensions, 
  TextInput, 
  FlatList, 
  Platform, 
  ScrollView,
  StatusBar,
  Keyboard,
  Animated
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface SelectedMedia {
  originalUri: string;
  currentUri: string;
  caption?: string;
}

interface MediaWorkspaceProps {
  visible: boolean;
  images: SelectedMedia[];
  setImages: React.Dispatch<React.SetStateAction<SelectedMedia[]>>;
  onClose: () => void;
  onSend: () => void;
  onCropPress: (uri: string, index: number) => void;
  onAddMore: () => void;
}

export const MediaWorkspace: React.FC<MediaWorkspaceProps> = ({
  visible,
  images,
  setImages,
  onClose,
  onSend,
  onCropPress,
  onAddMore
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setIsKeyboardVisible(true);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        timeoutRef.current = setTimeout(() => {
          setIsInputFocused(false);
          setIsKeyboardVisible(false);
        }, 250);
      }
    );
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (!visible || images.length === 0) return null;

  const handleCaptionChange = (text: string) => {
    setImages(prev => prev.map((img, i) => 
      i === currentIndex ? { ...img, caption: text } : img
    ));
  };

  const handleRemoveImage = (index: number) => {
    if (images.length === 1) {
      onClose();
      setImages([]);
    } else {
      setImages(prev => prev.filter((_, i) => i !== index));
      if (currentIndex >= images.length - 1) {
        setCurrentIndex(images.length - 2);
      }
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <KeyboardAvoidingView behavior="padding" style={styles.container}>
        {/* Large Image Paging - Absolute Fill */}
        <View style={StyleSheet.absoluteFill}>
          <FlatList
            ref={flatListRef}
            data={images}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={styles.imageSlide}>
                <Image 
                  source={{ uri: item.currentUri }} 
                  style={styles.largeImage} 
                  resizeMode="contain" 
                />
              </View>
            )}
            keyExtractor={(_, index) => index.toString()}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              setCurrentIndex(idx);
            }}
          />
        </View>

        {/* Top Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} style={styles.iconButton}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          
          <View style={styles.topRight}>
            <TouchableOpacity 
              onPress={() => onCropPress(images[currentIndex].originalUri, currentIndex)} 
              style={styles.iconButton}
            >
              <Ionicons name="crop" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ flex: 1 }} />

        {/* Bottom Panel Wrapper */}
        <View style={styles.bottomPanelWrapper}>
          {/* Caption Input Row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: (isInputFocused || isKeyboardVisible) ? 0 : 16 }}>
              <View style={[styles.captionContainer, { flex: 1, marginHorizontal: 0, marginBottom: 0, marginRight: 8 }]}>
                <TouchableOpacity onPress={onAddMore} style={{ marginRight: 10 }}>
                  <Ionicons name="images-outline" size={22} color="#fff" />
                </TouchableOpacity>
                <TextInput
                  style={styles.captionInput}
                  placeholder="Add a caption..."
                  placeholderTextColor="#888"
                  value={images[currentIndex]?.caption || ''}
                  onChangeText={handleCaptionChange}
                  multiline
                  onFocus={() => {
                    if (timeoutRef.current) clearTimeout(timeoutRef.current);
                    setIsInputFocused(true);
                  }}
                />
              </View>
              {/* Send Button Inline */}
              <TouchableOpacity onPress={onSend} style={styles.sendButton}>
                <Ionicons name="send" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

          {/* Thumbnails Row */}
          {!(isInputFocused || isKeyboardVisible) && (
            <View style={styles.thumbnailsWrapper}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailsContent}>
              {images.map((img, idx) => (
                <TouchableOpacity 
                  key={idx} 
                  onPress={() => {
                    setCurrentIndex(idx);
                    flatListRef.current?.scrollToIndex({ index: idx, animated: true });
                  }}
                  style={[
                    styles.thumbnailCard,
                    idx === currentIndex && styles.thumbnailCardActive
                  ]}
                >
                  <Image source={{ uri: img.currentUri }} style={styles.thumbnail} />
                  <TouchableOpacity 
                    onPress={() => handleRemoveImage(idx)} 
                    style={styles.removeThumbnailBtn}
                  >
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 44 : (StatusBar.currentHeight ? StatusBar.currentHeight + 8 : 28),
    paddingHorizontal: 16,
    height: Platform.OS === 'ios' ? 88 : (StatusBar.currentHeight ? StatusBar.currentHeight + 50 : 70),
    backgroundColor: 'rgba(0,0,0,0.6)',
    zIndex: 10,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: 8,
  },
  pagerContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  imageSlide: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT, 
    justifyContent: 'center',
    alignItems: 'center',
  },
  largeImage: {
    width: '100%',
    height: '100%',
  },
  bottomPanelWrapper: {
    zIndex: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  captionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
  },
  captionInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    maxHeight: 100,
  },
  thumbnailsWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 52,
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
    borderWidth: 1,
    borderColor: '#444',
  },
  thumbnailCardActive: {
    borderWidth: 2,
    borderColor: '#F94E27', 
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  removeThumbnailBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 1,
  },
  sendButton: {
    backgroundColor: '#F94E27',
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
});
