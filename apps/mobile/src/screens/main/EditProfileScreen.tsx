import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
  Image,
  Dimensions,
  Modal,
  PanResponder,
  Animated,
  Vibration,
  Platform,
  ScrollView,
} from 'react-native';

// Reanimated & Gesture Handler for the 60fps CropModal
import Reanimated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useDispatch } from 'react-redux';
import { api } from '../../services/api';
import { updateUser } from '../../store/authSlice';
import { colors } from '../../core/theme/colors';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const width = SCREEN_WIDTH;

// GRID_GAP and layout constants
const GRID_GAP = 12;
const GRID_MARGIN = 16;
const SLOT_WIDTH = (SCREEN_WIDTH - GRID_MARGIN * 2 - GRID_GAP * 2) / 3;
const SLOT_HEIGHT = SLOT_WIDTH * 1.5;

const getSlotPosition = (index: number) => ({
  x: (index % 3) * (SLOT_WIDTH + GRID_GAP),
  y: Math.floor(index / 3) * (SLOT_HEIGHT + GRID_GAP),
});

// ─── List Row (Option D) ───────────────────────────────────────────
const ListRow = ({
  icon, label, value, onPress, locked = false, isLast = false, iconFamily = 'Ionicons',
}: {
  icon: string; label: string; value: string; onPress?: () => void; locked?: boolean; isLast?: boolean; iconFamily?: 'Ionicons' | 'MaterialCommunityIcons';
}) => (
  <TouchableOpacity
    style={[styles.listRow, !isLast && styles.listRowBorder]}
    onPress={onPress}
    activeOpacity={onPress ? 0.6 : 1}
    disabled={!onPress}
  >
    <View style={styles.listRowIconContainer}>
      {iconFamily === 'Ionicons' ? (
        <Ionicons name={icon as any} size={22} color="#F94E27" />
      ) : (
        <MaterialCommunityIcons name={icon as any} size={22} color="#F94E27" />
      )}
    </View>
    <View style={styles.listRowContent}>
      <Text style={styles.listRowLabel}>{label}</Text>
      <Text style={[styles.listRowValue, !value && styles.listRowValueEmpty]} numberOfLines={1}>
        {value || `Add ${label.toLowerCase()}`}
      </Text>
    </View>
    <View style={styles.listRowRight}>
      {locked ? (
        <Ionicons name="lock-closed" size={16} color="rgba(255,255,255,0.2)" />
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
      ) : null}
    </View>
  </TouchableOpacity>
);

const PremiumIconToggle = ({ value, onToggle, saving }: { value: boolean; onToggle: (val: boolean) => void; saving?: boolean }) => {
  const translateX = useRef(new Animated.Value(value ? 22 : 2)).current;

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: value ? 22 : 2,
      useNativeDriver: true,
      bounciness: 4,
      speed: 12,
    }).start();
  }, [value]);

  if (saving) return <ActivityIndicator size="small" color="#F94E27" />;

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => onToggle(!value)}
      style={[
        styles.toggleTrack,
        { backgroundColor: value ? 'rgba(249, 78, 39, 0.15)' : 'rgba(255, 255, 255, 0.05)' }
      ]}
    >
      <Animated.View
        style={[
          styles.toggleThumb,
          {
            transform: [{ translateX }],
            backgroundColor: value ? '#F94E27' : '#334155',
          }
        ]}
      >
        <Ionicons
          name={value ? 'eye' : 'eye-off'}
          size={11}
          color={value ? '#FFF' : 'rgba(255, 255, 255, 0.5)'}
        />
      </Animated.View>
    </TouchableOpacity>
  );
};

// ─── List Toggle Row ───────────────────────────────────────────────
const ListToggleRow = ({
  icon, label, value, onToggle, saving, isLast = false,
}: {
  icon: string; label: string; value: boolean; onToggle: (val: boolean) => void; saving?: boolean; isLast?: boolean;
}) => (
  <View style={[styles.listRow, !isLast && styles.listRowBorder]}>
    <View style={styles.listRowIconContainer}>
      <Ionicons name={icon as any} size={22} color="#F94E27" />
    </View>
    <View style={styles.listRowContent}>
      <Text style={[styles.listRowValue, { marginTop: 0 }]}>{label}</Text>
    </View>
    <PremiumIconToggle value={value} onToggle={onToggle} saving={saving} />
  </View>
);

// ─── List Section Container ────────────────────────────────────────
const ListSection = ({ children, title }: { children: React.ReactNode; title: string }) => (
  <View style={styles.listSectionContainer}>
    <Text style={styles.sectionLabel}>{title}</Text>
    <View style={styles.listBlock}>
      {children}
    </View>
  </View>
);

// ─── Success Modal component ──────────────────────────────────────────
const SuccessModal = ({ visible, onDone }: { visible: boolean; onDone: () => void }) => {
  const scaleValue = useRef(new Animated.Value(0)).current;
  const opacityValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleValue, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(opacityValue, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scaleValue.setValue(0);
      opacityValue.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.successModalOverlay}>
        <Animated.View style={[
          styles.successCard,
          { opacity: opacityValue, transform: [{ scale: scaleValue }] }
        ]}>
          <View style={styles.iconBloomContainer}>
            <View style={[styles.iconHaloOuter, { backgroundColor: 'rgba(249, 78, 39, 0.08)' }]} />
            <View style={[styles.iconHaloInner, { backgroundColor: 'rgba(249, 78, 39, 0.15)' }]} />
            <LinearGradient colors={['#FF8C00', '#F94E27']} style={[styles.successIconCircle, { shadowColor: '#F94E27' }]}>
              <Ionicons name="checkmark" size={32} color="#fff" />
            </LinearGradient>
          </View>
          <Text style={styles.successTitle}>Profile Updated!</Text>
          <Text style={styles.successSubtitle}>Your changes are now live and visible to everyone.</Text>
          <TouchableOpacity style={styles.doneButton} onPress={onDone} activeOpacity={0.8}>
            <LinearGradient colors={['#FF8C00', '#F94E27']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.doneButtonGradient}>
              <Text style={styles.doneButtonText}>Awesome</Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

// ─── Crop Modal component (60FPS Native Thread) ───────────────────────
interface CropModalProps {
  visible: boolean;
  imageUri: string;
  onCancel: () => void;
  onCropSave: (croppedUri: string) => void;
}

const CropModal = ({ visible, imageUri, onCancel, onCropSave }: CropModalProps) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const cropX = useSharedValue<number>(0);
  const cropY = useSharedValue<number>(0);
  const cropSize = useSharedValue<number>(0);
  
  const cropRef = useRef({ x: 0, y: 0, size: 0 });
  const syncCropRef = (x: number, y: number, size: number) => {
    cropRef.current = { x, y, size };
  };
  
  const MIN_CROP_SIZE = 80;
  const IMG_PADDING = 16;
  const maxImgW = SCREEN_WIDTH - IMG_PADDING * 2;
  const imgRatio = imageSize.height ? imageSize.width / imageSize.height : 1;
  const renderedW = maxImgW;
  const renderedH = imageSize.height ? maxImgW / imgRatio : maxImgW;

  useEffect(() => {
    let isMounted = true;
    if (visible && imageUri) {
      Image.getSize(
        imageUri,
        (w: number, h: number) => { if (isMounted) setImageSize({ width: w, height: h }); },
        () => {
          ImageManipulator.manipulateAsync(imageUri, [])
            .then(res => { if (isMounted) setImageSize({ width: res.width, height: res.height }); })
            .catch(() => { if (isMounted) setImageSize({ width: 1000, height: 1000 }); });
        }
      );
    }
    return () => { isMounted = false; };
  }, [visible, imageUri]);

  useEffect(() => {
    if (visible && renderedW > 0 && renderedH > 0) {
      const initSize = Math.min(renderedW, renderedH) * 0.8;
      cropSize.value = initSize;
      cropX.value = (renderedW - initSize) / 2;
      cropY.value = (renderedH - initSize) / 2;
      cropRef.current = { x: (renderedW - initSize) / 2, y: (renderedH - initSize) / 2, size: initSize };
    }
  }, [visible, imageSize, renderedW, renderedH]);

  const dragGesture = Gesture.Pan()
    .onChange((event) => {
      'worklet';
      let newX = cropX.value + event.changeX;
      let newY = cropY.value + event.changeY;
      cropX.value = Math.max(0, Math.min(newX, renderedW - cropSize.value));
      cropY.value = Math.max(0, Math.min(newY, renderedH - cropSize.value));
      runOnJS(syncCropRef)(cropX.value, cropY.value, cropSize.value);
    });

  const resizeGesture = Gesture.Pan()
    .onChange((event) => {
      'worklet';
      const delta = Math.max(event.changeX, event.changeY);
      let newSize = cropSize.value + delta;
      newSize = Math.max(MIN_CROP_SIZE, newSize);
      newSize = Math.min(newSize, renderedW - cropX.value);
      newSize = Math.min(newSize, renderedH - cropY.value);
      cropSize.value = newSize;
      runOnJS(syncCropRef)(cropX.value, cropY.value, cropSize.value);
    });

  const cropBoxStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cropX.value }, { translateY: cropY.value }],
    width: cropSize.value,
    height: cropSize.value,
  }));

  const resizeHandleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: cropX.value + cropSize.value - 15 },
      { translateY: cropY.value + cropSize.value - 15 },
    ],
  }));

  const previewStyle = useAnimatedStyle(() => {
    if (cropSize.value === 0) return { width: 0, height: 0 }; 
    const previewSize = 120;
    const previewScale = previewSize / cropSize.value;
    return {
      width: renderedW * previewScale,
      height: renderedH * previewScale,
      transform: [
        { translateX: -cropX.value * previewScale },
        { translateY: -cropY.value * previewScale },
      ],
    };
  });

  const topOverlay = useAnimatedStyle(() => ({ height: cropY.value }));
  const bottomOverlay = useAnimatedStyle(() => ({ top: cropY.value + cropSize.value }));
  const leftOverlay = useAnimatedStyle(() => ({ top: cropY.value, width: cropX.value, height: cropSize.value }));
  const rightOverlay = useAnimatedStyle(() => ({ top: cropY.value, left: cropX.value + cropSize.value, height: cropSize.value }));

  const handleSave = async () => {
    setLoading(true);
    try {
      const normalizedImage = await ImageManipulator.manipulateAsync(
        imageUri,
        [], 
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );

      const trueWidth = normalizedImage.width;
      const trueHeight = normalizedImage.height;

      const scaleX = trueWidth / renderedW;
      const scaleY = trueHeight / renderedH;

      const { x: cx, y: cy, size: cs } = cropRef.current;
      
      let originX = Math.round(cx * scaleX);
      let originY = Math.round(cy * scaleY);
      let cropWidth = Math.round(cs * scaleX);
      let cropHeight = Math.round(cs * scaleY);

      originX = Math.max(0, originX);
      originY = Math.max(0, originY);
      if (originX + cropWidth > trueWidth) cropWidth = trueWidth - originX;
      if (originY + cropHeight > trueHeight) cropHeight = trueHeight - originY;

      if (cropWidth <= 0 || cropHeight <= 0) {
        onCancel();
        return;
      }

      const manipResult = await ImageManipulator.manipulateAsync(
        normalizedImage.uri,
        [{ crop: { originX, originY, width: cropWidth, height: cropHeight } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );

      onCropSave(manipResult.uri);
    } catch (e) {
      console.error("Crop error:", e);
      Alert.alert("Error", "Could not crop image. Please try another.");
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="slide">
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#111' }}>
        <View style={{ flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 20 }}>
            <TouchableOpacity onPress={onCancel} style={{ padding: 10, marginLeft: -10 }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} disabled={loading} style={{ padding: 10, marginRight: -10 }}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Save</Text>}
            </TouchableOpacity>
          </View>

          <View style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ width: renderedW, height: renderedH, position: 'relative' }}>
              <Image source={{ uri: imageUri }} style={{ width: renderedW, height: renderedH }} resizeMode="contain" />

              <Reanimated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)' }, topOverlay]} pointerEvents="none" />
              <Reanimated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }, bottomOverlay]} pointerEvents="none" />
              <Reanimated.View style={[{ position: 'absolute', left: 0, backgroundColor: 'rgba(0,0,0,0.55)' }, leftOverlay]} pointerEvents="none" />
              <Reanimated.View style={[{ position: 'absolute', right: 0, backgroundColor: 'rgba(0,0,0,0.55)' }, rightOverlay]} pointerEvents="none" />

              <GestureDetector gesture={dragGesture}>
                <Reanimated.View style={[{ position: 'absolute', borderWidth: 2, borderColor: '#fff' }, cropBoxStyle]}>
                  <View style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }} />
                  <View style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }} />
                  <View style={{ position: 'absolute', top: 0, bottom: 0, left: '33.33%', borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }} />
                  <View style={{ position: 'absolute', top: 0, bottom: 0, left: '66.66%', borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }} />
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' }} pointerEvents="none" />
                  
                  <View style={{ position: 'absolute', top: -3, left: -3, width: 20, height: 3, backgroundColor: '#fff' }} pointerEvents="none" />
                  <View style={{ position: 'absolute', top: -3, left: -3, width: 3, height: 20, backgroundColor: '#fff' }} pointerEvents="none" />
                  <View style={{ position: 'absolute', top: -3, right: -3, width: 20, height: 3, backgroundColor: '#fff' }} pointerEvents="none" />
                  <View style={{ position: 'absolute', top: -3, right: -3, width: 3, height: 20, backgroundColor: '#fff' }} pointerEvents="none" />
                  <View style={{ position: 'absolute', bottom: -3, left: -3, width: 20, height: 3, backgroundColor: '#fff' }} pointerEvents="none" />
                  <View style={{ position: 'absolute', bottom: -3, left: -3, width: 3, height: 20, backgroundColor: '#fff' }} pointerEvents="none" />
                </Reanimated.View>
              </GestureDetector>

              <GestureDetector gesture={resizeGesture}>
                <Reanimated.View style={[{ position: 'absolute', width: 30, height: 30, zIndex: 10, top: 0, left: 0 }, resizeHandleStyle]}>
                   <View style={{ position: 'absolute', bottom: 9, right: 9, width: 20, height: 3, backgroundColor: '#fff' }} pointerEvents="none" />
                   <View style={{ position: 'absolute', bottom: 9, right: 9, width: 3, height: 20, backgroundColor: '#fff' }} pointerEvents="none" />
                </Reanimated.View>
              </GestureDetector>
            </View>

            <View pointerEvents="none" style={{ marginTop: 30, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 13, marginBottom: 12, fontWeight: '700' }}>profile avatar preview</Text>
              <View style={{ width: 120, height: 120, borderRadius: 60, borderWidth: 1, borderColor: '#444', overflow: 'hidden', backgroundColor: '#222' }}>
                <Reanimated.Image source={{ uri: imageUri }} style={previewStyle} />
              </View>
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

// ─── Media Grid Component ─────────────────────────────────────────────
interface MediaGridProps {
  photos: any[];
  onPhotosChange: (photos: any[]) => void;
  onAddPress: () => void;
  onScrollLock: (locked: boolean) => void;
  onCropProfile: (photoUrl: string) => void;
}

const MediaGrid = ({ photos, onPhotosChange, onAddPress, onScrollLock, onCropProfile }: MediaGridProps) => {
  const [displayOrder, setDisplayOrder] = useState<number[]>([0, 1, 2, 3, 4, 5]);
  const [dragPhotoIdx, setDragPhotoIdx] = useState<number | null>(null);

  const pan = useRef(new Animated.ValueXY()).current;
  const dragScale = useRef(new Animated.Value(1)).current;

  const cardOffsets = useRef(
    Array.from({ length: 6 }, () => new Animated.ValueXY({ x: 0, y: 0 }))
  ).current;

  const stateRef = useRef({
    isDragging: false,
    dragPhotoIdx: -1,
    dragStartSlot: -1,
    currentHover: -1,
    displayOrder: [0, 1, 2, 3, 4, 5],
    dragStartOrder: [0, 1, 2, 3, 4, 5],
    photos: photos,
    longPressTimer: null as any,
    settling: false,
  });

  useEffect(() => { stateRef.current.photos = photos; }, [photos]);

  const prevPhotosRef = useRef(photos);
  useEffect(() => {
    if (prevPhotosRef.current !== photos) {
      prevPhotosRef.current = photos;
      const order = [0, 1, 2, 3, 4, 5];
      stateRef.current.displayOrder = order;
      stateRef.current.dragStartOrder = order;
      stateRef.current.settling = false;
      setDisplayOrder(order);
      cardOffsets.forEach(o => {
        o.stopAnimation();
        o.setValue({ x: 0, y: 0 });
      });
    }
  }, [photos, cardOffsets]);

  const removePhoto = useCallback((photoIndex: number) => {
    const s = stateRef.current;
    Alert.alert("Remove Photo", "Are you sure you want to remove this photo?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          const reordered = s.displayOrder.map(idx => photos[idx]).filter(Boolean);
          const visualIdx = s.displayOrder.indexOf(photoIndex);
          reordered.splice(visualIdx, 1);
          onPhotosChange(reordered);
        }
      }
    ]);
  }, [photos, onPhotosChange]);

  const getSlotFromTouch = useCallback((x: number, y: number): number => {
    const col = Math.max(0, Math.min(2, Math.floor(x / (SLOT_WIDTH + GRID_GAP))));
    const row = Math.max(0, Math.min(1, Math.floor(y / (SLOT_HEIGHT + GRID_GAP))));
    return row * 3 + col;
  }, []);

  const gridRef = useRef<View>(null);
  const gridLayout = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const onGridLayout = useCallback(() => {
    gridRef.current?.measureInWindow((x, y, width, height) => {
      gridLayout.current = { x, y, width, height };
    });
  }, []);

  const animateCardsToOrder = useCallback((newOrder: number[], draggedPhotoIdx: number) => {
    newOrder.forEach((photoIdx, slotIdx) => {
      if (photoIdx === draggedPhotoIdx) return;
      if (photoIdx >= stateRef.current.photos.length) return;

      const naturalPos = getSlotPosition(photoIdx);
      const targetPos = getSlotPosition(slotIdx);

      Animated.spring(cardOffsets[photoIdx], {
        toValue: { x: targetPos.x - naturalPos.x, y: targetPos.y - naturalPos.y },
        useNativeDriver: true,
        friction: 8,
        tension: 120,
      }).start();
    });
  }, [cardOffsets]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        stateRef.current.isDragging && (Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2),
      onPanResponderTerminationRequest: () => !stateRef.current.isDragging,
      onShouldBlockNativeResponder: () => true,

      onPanResponderGrant: (evt) => {
        const s = stateRef.current;
        if (s.settling) return; 

        const touchX = evt.nativeEvent.pageX - gridLayout.current.x;
        const touchY = evt.nativeEvent.pageY - gridLayout.current.y;
        const touchedSlot = getSlotFromTouch(touchX, touchY);

        const photoAtSlot = s.displayOrder[touchedSlot];
        if (photoAtSlot === undefined || photoAtSlot >= s.photos.length) return;

        s.isDragging = false;
        s.dragPhotoIdx = photoAtSlot;
        s.dragStartSlot = touchedSlot;
        s.currentHover = touchedSlot;
        s.dragStartOrder = [...s.displayOrder];

        s.longPressTimer = setTimeout(() => {
          s.isDragging = true;
          setDragPhotoIdx(photoAtSlot);
          Vibration.vibrate(30);
          onScrollLock(true);
          Animated.spring(dragScale, {
            toValue: 1.08,
            useNativeDriver: true,
          }).start();
        }, 200);
      },

      onPanResponderMove: (_, gs) => {
        const s = stateRef.current;
        if (!s.isDragging) return;

        pan.setValue({ x: gs.dx, y: gs.dy });

        const startSlot = s.dragStartSlot;
        const startPos = getSlotPosition(startSlot);
        const hoverX = startPos.x + gs.dx + SLOT_WIDTH / 2;
        const hoverY = startPos.y + gs.dy + SLOT_HEIGHT / 2;
        const hoverSlot = getSlotFromTouch(hoverX, hoverY);

        if (hoverSlot !== s.currentHover && hoverSlot < s.photos.length) {
          s.currentHover = hoverSlot;
          Vibration.vibrate(15);

          const newOrder = [...s.dragStartOrder];
          const draggedPhotoIdx = s.dragPhotoIdx;
          const currentIdx = newOrder.indexOf(draggedPhotoIdx);
          newOrder.splice(currentIdx, 1);
          newOrder.splice(hoverSlot, 0, draggedPhotoIdx);

          s.displayOrder = newOrder;
          setDisplayOrder([...newOrder]);
          animateCardsToOrder(newOrder, draggedPhotoIdx);
        }
      },

      onPanResponderRelease: (_, gs) => {
        const s = stateRef.current;
        clearTimeout(s.longPressTimer);

        if (s.isDragging) {
          const draggedPhotoIdx = s.dragPhotoIdx;
          const finalSlotIdx = s.displayOrder.indexOf(draggedPhotoIdx);
          const naturalPos = getSlotPosition(draggedPhotoIdx);
          const targetPos = getSlotPosition(finalSlotIdx);

          cardOffsets[draggedPhotoIdx].setValue({ x: gs.dx, y: gs.dy });
          pan.setValue({ x: 0, y: 0 });

          s.isDragging = false;
          s.dragPhotoIdx = -1;
          s.currentHover = -1;
          s.settling = true;
          setDragPhotoIdx(null);
          onScrollLock(false);
          Animated.spring(dragScale, { toValue: 1, useNativeDriver: true }).start();

          Animated.spring(cardOffsets[draggedPhotoIdx], {
            toValue: { x: targetPos.x - naturalPos.x, y: targetPos.y - naturalPos.y },
            useNativeDriver: true,
            friction: 8,
            tension: 100,
          }).start(() => {
            s.settling = false;
            const reorderedPhotos = s.displayOrder
              .map(idx => s.photos[idx])
              .filter(Boolean);
            onPhotosChange(reorderedPhotos);
          });
        } else {
          s.isDragging = false;
          s.dragPhotoIdx = -1;
          s.currentHover = -1;
          setDragPhotoIdx(null);
          pan.setValue({ x: 0, y: 0 });
          onScrollLock(false);
        }
      },

      onPanResponderTerminate: () => {
        const s = stateRef.current;
        clearTimeout(s.longPressTimer);
        s.isDragging = false;
        s.dragPhotoIdx = -1;
        s.currentHover = -1;
        s.settling = false;
        s.displayOrder = [...s.dragStartOrder];
        setDisplayOrder([...s.dragStartOrder]);
        setDragPhotoIdx(null);
        cardOffsets.forEach(o => {
          o.stopAnimation();
          o.setValue({ x: 0, y: 0 });
        });
        pan.setValue({ x: 0, y: 0 });
        onScrollLock(false);
        Animated.spring(dragScale, { toValue: 1, useNativeDriver: true }).start();
      },
    })
  ).current;

  return (
    <View ref={gridRef} style={styles.mediaGrid} onLayout={onGridLayout} {...panResponder.panHandlers}>
      {Array.from({ length: 6 }).map((_, photoIdx) => {
        const photo = photos[photoIdx];
        const imageUrl = photo ? (photo.photoUrl || photo.uri) : null;
        const slotIdx = displayOrder.indexOf(photoIdx);
        const isDraggedCard = dragPhotoIdx === photoIdx;
        const basePos = getSlotPosition(photoIdx);

        if (!imageUrl) {
          const emptyPos = getSlotPosition(slotIdx);
          return (
            <View key={`photo-${photoIdx}`} style={[styles.mediaSlot, { left: emptyPos.x, top: emptyPos.y }]}>
              <TouchableOpacity style={styles.addMediaButton} onPress={onAddPress}>
                <Ionicons name="add" size={32} color={colors.text.tertiary} />
              </TouchableOpacity>
            </View>
          );
        }

        if (isDraggedCard) {
          return (
            <Animated.View
              key={`photo-${photoIdx}`}
              style={[
                styles.mediaSlot,
                {
                  left: basePos.x,
                  top: basePos.y,
                  transform: [
                    { translateX: Animated.add(cardOffsets[photoIdx].x, pan.x) },
                    { translateY: Animated.add(cardOffsets[photoIdx].y, pan.y) },
                    { scale: dragScale },
                  ],
                  zIndex: 100,
                  elevation: 100,
                },
              ]}
            >
              <Image source={{ uri: imageUrl }} style={styles.mediaImage} />
              {slotIdx === 0 && (
                <View style={styles.profileBadge}>
                  <Ionicons name="star" size={10} color="#fff" />
                  <Text style={styles.profileBadgeText}>Profile</Text>
                </View>
              )}
              <View style={styles.slotNumber}>
                <Text style={styles.slotNumberText}>{slotIdx + 1}</Text>
              </View>
            </Animated.View>
          );
        }

        return (
          <Animated.View
            key={`photo-${photoIdx}`}
            style={[
              styles.mediaSlot,
              {
                left: basePos.x,
                top: basePos.y,
                transform: [
                  { translateX: cardOffsets[photoIdx].x },
                  { translateY: cardOffsets[photoIdx].y },
                ],
              },
              dragPhotoIdx !== null && { opacity: 0.85 },
            ]}
          >
            <Image source={{ uri: imageUrl }} style={styles.mediaImage} />
            {slotIdx === 0 && (
              <View style={styles.profileBadge}>
                <Ionicons name="star" size={10} color="#fff" />
                <Text style={styles.profileBadgeText}>Profile</Text>
              </View>
            )}
            {slotIdx === 0 && dragPhotoIdx === null && (
              <TouchableOpacity style={styles.cropMediaButton} onPress={() => onCropProfile(imageUrl)}>
                <Ionicons name="crop" size={16} color="#fff" />
              </TouchableOpacity>
            )}
            <View style={styles.slotNumber}>
              <Text style={styles.slotNumberText}>{slotIdx + 1}</Text>
            </View>
            {dragPhotoIdx === null && (
              <TouchableOpacity style={styles.removeMediaButton} onPress={() => removePhoto(photoIdx)}>
                <Ionicons name="close" size={16} color="#fff" />
              </TouchableOpacity>
            )}
          </Animated.View>
        );
      })}
    </View>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────
export const EditProfileScreen = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { profile: initialProfile } = route.params as { profile: any };

  const [profile, setProfile] = useState<any>(initialProfile);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const [toggleSaving, setToggleSaving] = useState<string | null>(null);

  const [mediaActionVisible, setMediaActionVisible] = useState(false);
  const [currentPhotos, setCurrentPhotos] = useState<any[]>(initialProfile.photos || []);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [photoToCrop, setPhotoToCrop] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialProfile.avatarUrl || null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  // Refetch profile when screen gains focus (after editing a sub-screen)
  useFocusEffect(
    useCallback(() => {
      const fetchProfile = async () => {
        try {
          const response = await api.get('/profile');
          if (response.data?.success && response.data.data) {
            const freshProfile = response.data.data;
            setProfile(freshProfile);
            setCurrentPhotos(freshProfile.photos || []);
            setAvatarUrl(freshProfile.avatarUrl || null);
          }
        } catch (err) {
          console.error('[EditProfile] Error refetching profile:', err);
        }
      };
      fetchProfile();
    }, [])
  );

  const handleToggle = async (field: string, value: boolean) => {
    setToggleSaving(field);
    try {
      const response = await api.put('/profile', { [field]: value });
      if (response.data?.success) {
        dispatch(updateUser(response.data.data));
        setProfile((prev: any) => ({ ...prev, [field]: value }));
      }
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally {
      setToggleSaving(null);
    }
  };

  const handleAddMediaPress = () => {
    if (currentPhotos.length >= 6) {
      Alert.alert('Limit Reached', 'You can only upload up to 6 photos.');
      return;
    }
    setMediaActionVisible(true);
  };

  const handleTakePhoto = async () => {
    setMediaActionVisible(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera permission is required to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setCurrentPhotos(prev => [...prev, result.assets[0]]);
    }
  };

  const handlePickImage = async () => {
    setMediaActionVisible(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Gallery permission is required to choose photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setCurrentPhotos(prev => [...prev, result.assets[0]]);
    }
  };

  const handleSavePhotos = async () => {
    setSaving(true);
    try {
      const photoUrls: string[] = [];
      const newPhotoPayloads: { id: string, type: 'photo', ext: string, uri: string }[] = [];

      currentPhotos.forEach((photo, i) => {
        if (photo.photoUrl) {
          photoUrls[i] = photo.photoUrl;
        } else if (photo.uri) {
          const ext = photo.uri.split('.').pop()?.toLowerCase() || 'jpeg';
          const id = `new_${i}`;
          newPhotoPayloads.push({ id, type: 'photo', ext, uri: photo.uri });
          photoUrls[i] = `UPLOAD_PENDING_${id}`;
        }
      });

      if (newPhotoPayloads.length > 0) {
        const presignRes = await api.post('/upload/presigned-urls', {
          files: newPhotoPayloads.map(f => ({ type: f.type, ext: f.ext }))
        });
        const uploadTickets = presignRes.data.data;

        await Promise.all(newPhotoPayloads.map(async (file, index) => {
          const ticket = uploadTickets[index];
          const response = await fetch(Platform.OS === 'ios' ? file.uri.replace('file://', '') : file.uri);
          const blob = await response.blob();

          const uploadResponse = await fetch(ticket.uploadUrl, {
            method: 'PUT',
            body: blob,
            headers: { 'Content-Type': ticket.contentType }
          });
          if (!uploadResponse.ok) throw new Error('Photo upload failed');
          await api.post(`/upload/${ticket.assetId}/complete`);

          const placeholder = `UPLOAD_PENDING_${file.id}`;
          const finalIdx = photoUrls.indexOf(placeholder);
          if (finalIdx !== -1) photoUrls[finalIdx] = ticket.fileUrl;
        }));
      }

      const data: any = {
        name: profile.name,
        photos: photoUrls.filter(url => url && !url.startsWith('UPLOAD_PENDING_')),
      };

      const response = await api.put('/profile', data);
      
      if (response.data?.success) {
        dispatch(updateUser(response.data.data));
        setSuccessVisible(true);
      }
    } catch (err: any) {
      console.error('[EditProfile] Error Saving:', err);
      Alert.alert('Error', err.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleInstantProfileCropSave = async (croppedUri: string) => {
    setCropModalVisible(false);
    setSaving(true);
    try {
      const ext = croppedUri.split('.').pop()?.toLowerCase() || 'jpeg';
      const filePayloads = [{ id: 'profile_crop', type: 'photo', ext, uri: croppedUri }];
      
      const presignRes = await api.post('/upload/presigned-urls', {
        files: filePayloads.map(f => ({ type: f.type, ext: f.ext }))
      });
      const uploadTicket = presignRes.data.data[0];

      const response = await fetch(Platform.OS === 'ios' ? croppedUri.replace('file://', '') : croppedUri);
      const blob = await response.blob();

      const uploadResponse = await fetch(uploadTicket.uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': uploadTicket.contentType }
      });
      if (!uploadResponse.ok) throw new Error('Photo upload failed');
      await api.post(`/upload/${uploadTicket.assetId}/complete`);

      const data: any = {
        name: profile.name,
        avatarUrl: uploadTicket.fileUrl,
      };

      const profileResponse = await api.put('/profile', data);
      
      if (profileResponse.data?.success) {
        dispatch(updateUser(profileResponse.data.data));
        setAvatarUrl(profileResponse.data.data.avatarUrl);
        Alert.alert("Success", "Profile Avatar updated successfully!");
      }
    } catch (err: any) {
      console.error('[EditProfile] Error Saving Crop:', err);
      Alert.alert('Error', err.response?.data?.message || 'Failed to update cropped photo');
    } finally {
      setSaving(false);
    }
  };

  // Check if photos have local (unsaved) additions
  const hasUnsavedPhotos = currentPhotos.some(p => p.uri && !p.photoUrl);

  return (
    <View style={styles.container}>
      <SuccessModal 
        visible={successVisible} 
        onDone={() => {
          setSuccessVisible(false);
          navigation.goBack();
        }} 
      />

      {photoToCrop && (
        <CropModal 
          visible={cropModalVisible}
          imageUri={photoToCrop}
          onCancel={() => {
            setCropModalVisible(false);
            setPhotoToCrop(null);
          }}
          onCropSave={handleInstantProfileCropSave}
        />
      )}

      {/* Full Screen Image Viewer */}
      <Modal 
        visible={!!selectedImageUrl} 
        transparent 
        animationType="fade"
        onRequestClose={() => setSelectedImageUrl(null)}
      >
        <TouchableOpacity 
          style={styles.imageViewerOverlay} 
          activeOpacity={1} 
          onPress={() => setSelectedImageUrl(null)}
        >
          <TouchableOpacity 
            style={styles.closeViewerButton} 
            onPress={() => setSelectedImageUrl(null)}
          >
            <Ionicons name="close-circle" size={44} color="#fff" />
          </TouchableOpacity>
          <Image 
            source={{ uri: selectedImageUrl || '' }} 
            style={styles.fullScreenImage} 
            resizeMode="contain" 
          />
        </TouchableOpacity>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
      >
        {/* Avatar */}
        <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 16 }}>
          <TouchableOpacity 
            activeOpacity={0.9}
            style={{ 
              width: 120, height: 120, borderRadius: 60, overflow: 'hidden', 
              borderWidth: 3, borderColor: '#F94E27', backgroundColor: colors.surface 
            }}
            onPress={() => {
              const url = avatarUrl || currentPhotos[0]?.photoUrl || currentPhotos[0]?.uri;
              if (url) setSelectedImageUrl(url);
            }}
          >
            <Image 
              source={{ uri: avatarUrl || currentPhotos[0]?.photoUrl || currentPhotos[0]?.uri || 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&auto=format&fit=crop' }} 
              style={{ width: '100%', height: '100%' }} 
            />
          </TouchableOpacity>
          <Text style={{ marginTop: 12, fontSize: 13, color: colors.text.secondary, textAlign: 'center', paddingHorizontal: 40 }}>
            This is your main circular avatar. It appears in chats and small previews.
          </Text>
        </View>

        {/* Grid Photos */}
        <Text style={styles.sectionLabel}>Grid Photos</Text>
        <Text style={styles.mediaHint}>Hold & drag to reorder. Tap crop on the first photo to change your Avatar.</Text>
        <MediaGrid
          photos={currentPhotos}
          onPhotosChange={setCurrentPhotos}
          onAddPress={handleAddMediaPress}
          onScrollLock={(locked) => setScrollEnabled(!locked)}
          onCropProfile={(url) => {
            setPhotoToCrop(url);
            setCropModalVisible(true);
          }}
        />

        {/* Save Photos button (only when there are unsaved local photos) */}
        {hasUnsavedPhotos && (
          <TouchableOpacity style={styles.savePhotosButton} onPress={handleSavePhotos} disabled={saving}>
            <LinearGradient colors={['#FF8C00', '#F94E27']} style={styles.savePhotosGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                  <Text style={styles.savePhotosText}>Upload New Photos</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* ── My Basics ── */}
        {/* ── My Basics ── */}
        <ListSection title="My Basics">
          <ListRow icon="person" label="Name" value={profile.name || ''} locked />
          <ListRow
            icon="calendar-outline"
            label="Birthday"
            value={profile.birthday ? new Date(profile.birthday).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
            onPress={() => navigation.navigate('EditBirthday', { currentBirthday: profile.birthday })}
          />
          <ListRow
            icon="male-female-outline"
            label="Gender"
            value={profile.gender || ''}
            onPress={() => navigation.navigate('EditGender', { currentGender: profile.gender, currentShowGender: profile.showGender })}
          />
          <ListRow
            icon="heart-half-outline"
            label="Orientation"
            value={Array.isArray(profile.orientation) ? profile.orientation.join(', ') : (profile.orientation || '')}
            onPress={() => navigation.navigate('EditOrientation', { currentOrientation: profile.orientation, currentShowOrientation: profile.showOrientation })}
          />
          <ListRow
            icon="search-outline"
            label="Looking for"
            value={profile.seeking || ''}
            onPress={() => navigation.navigate('EditSeeking', { currentSeeking: profile.seeking })}
          />
          <ListRow
            icon="ruler"
            iconFamily="MaterialCommunityIcons"
            label="Height"
            value={profile.height ? `${profile.height} cm` : ''}
            onPress={() => navigation.navigate('EditHeight', { currentHeight: profile.height })}
            isLast
          />
        </ListSection>

        {/* ── Bio ── */}
        <ListSection title="Bio">
          <TouchableOpacity
            style={styles.bioListRow}
            onPress={() => navigation.navigate('EditBio', { currentBio: profile.preferences?.bio })}
            activeOpacity={0.6}
          >
            <View style={styles.bioListHeader}>
              <View style={styles.listRowIconContainer}>
                <Ionicons name="document-text-outline" size={22} color="#F94E27" />
              </View>
              <Text style={styles.bioListTitle}>About me</Text>
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
            </View>
            <Text style={[styles.bioListText, !profile.preferences?.bio && styles.bioListTextEmpty]} numberOfLines={4}>
              {profile.preferences?.bio || 'Write something about yourself to stand out...'}
            </Text>
          </TouchableOpacity>
        </ListSection>

        {/* ── Visibility ── */}
        <ListSection title="Visibility">
          <ListToggleRow
            icon="eye-outline"
            label="Show Gender"
            value={profile.showGender ?? true}
            onToggle={(val) => handleToggle('showGender', val)}
            saving={toggleSaving === 'showGender'}
          />
          <ListToggleRow
            icon="eye-outline"
            label="Show Orientation"
            value={profile.showOrientation ?? true}
            onToggle={(val) => handleToggle('showOrientation', val)}
            saving={toggleSaving === 'showOrientation'}
            isLast
          />
        </ListSection>

        {/* ── Campus Life ── */}
        <ListSection title="Campus Life">
          <ListRow icon="business-outline" label="College" value={profile.college || ''} onPress={() => navigation.navigate('EditCollege', { currentCollege: profile.college })} />
          <ListRow icon="book-outline" label="Department" value={profile.department || ''} onPress={() => navigation.navigate('EditDepartment', { currentDepartment: profile.department, currentYearOfStudy: profile.yearOfStudy })} />
          <ListRow icon="business-outline" label="Graduation year" value={profile.graduationYear ? `${profile.graduationYear}` : ''} onPress={() => navigation.navigate('EditBatch', { currentBatch: profile.graduationYear })} />
          <ListRow 
            icon="school-outline" 
            label="Year of Study" 
            value={profile.yearOfStudy ? `${profile.yearOfStudy}${profile.yearOfStudy === 1 ? 'st' : profile.yearOfStudy === 2 ? 'nd' : profile.yearOfStudy === 3 ? 'rd' : 'th'} YR` : ''} 
            onPress={() => navigation.navigate('EditYear', { currentYearOfStudy: profile.yearOfStudy })} 
          />
          <ListRow icon="location-outline" label="Campus" value={profile.campus || ''} onPress={() => navigation.navigate('EditCampus', { currentCampus: profile.campus })} />
          <ListRow 
            icon="home-outline" 
            label="Residency" 
            value={profile.isHosteller === true ? 'Hosteller' : profile.isHosteller === false ? 'Day Scholar' : ''} 
            onPress={() => navigation.navigate('EditResidency', { currentResidency: profile.isHosteller })} 
          />
          <ListRow icon="happy-outline" label="Attendance Mood" value={profile.attendanceMood || ''} onPress={() => navigation.navigate('EditAttendanceMood', { currentMood: profile.attendanceMood })} />
          <ListRow icon="navigate-outline" label="Distance (km)" value={profile.distancePreference ? `${profile.distancePreference} km` : ''} onPress={() => navigation.navigate('EditDistance', { currentDistance: profile.distancePreference })} isLast />
        </ListSection>

        {/* ── More About Me ── */}
        <ListSection title="More About Me">
          <ListRow icon="people-outline" label="Clubs" value={Array.isArray(profile.clubs) && profile.clubs.length > 0 ? profile.clubs.join(', ') : ''} onPress={() => navigation.navigate('EditSocial', { currentClubs: profile.clubs, currentAttendanceMood: profile.attendanceMood, currentHangoutSpot: Array.isArray(profile.hangoutSpots) ? profile.hangoutSpots[0] : '' })} />
          <ListRow icon="fitness-outline" label="Lifestyle" value={profile.preferences?.lifestyle ? Object.values(profile.preferences.lifestyle).filter(Boolean).length + ' set' : ''} onPress={() => navigation.navigate('EditLifestyle', { currentLifestyle: profile.preferences?.lifestyle })} />
          <ListRow icon="sparkles-outline" label="Personality" value={profile.preferences?.personality ? Object.values(profile.preferences.personality).filter(Boolean).length + ' set' : ''} onPress={() => navigation.navigate('EditPersonality', { currentPersonality: profile.preferences?.personality })} />
          <ListRow icon="pricetags-outline" label="Interests" value={Array.isArray(profile.preferences?.interests) && profile.preferences.interests.length > 0 ? `${profile.preferences.interests.length} selected` : ''} onPress={() => navigation.navigate('EditInterests', { currentInterests: profile.preferences?.interests })} isLast />
        </ListSection>


        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={mediaActionVisible} transparent animationType="slide" onRequestClose={() => setMediaActionVisible(false)}>
        <TouchableOpacity style={styles.actionSheetOverlay} activeOpacity={1} onPress={() => setMediaActionVisible(false)}>
          <View style={styles.actionSheetContainer}>
            <View style={styles.actionSheetHeader}>
              <Text style={styles.actionSheetTitle}>Upload Photo</Text>
              <Text style={styles.actionSheetSubtitle}>Choose a photo or take a new one</Text>
            </View>
            <TouchableOpacity style={styles.actionSheetButton} onPress={handleTakePhoto}>
              <Ionicons name="camera-outline" size={24} color={colors.text.primary} />
              <Text style={styles.actionSheetButtonText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionSheetButton} onPress={handlePickImage}>
              <Ionicons name="images-outline" size={24} color={colors.text.primary} />
              <Text style={styles.actionSheetButtonText}>Choose from Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionSheetButton, styles.cancelButton]} onPress={() => setMediaActionVisible(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1F2125' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 50, paddingHorizontal: 16, paddingBottom: 16, backgroundColor: '#1F2125' },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 40, flexGrow: 1 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 1, marginTop: 28, marginBottom: 8, marginHorizontal: 20 },

  // ── List Option D Styles ──
  listSectionContainer: { marginHorizontal: 16, marginTop: 16 },
  listBlock: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  listRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  listRowIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(249, 78, 39, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  listRowContent: {
    flex: 1,
    justifyContent: 'center',
  },
  listRowLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.text.secondary,
    marginBottom: 2,
  },
  listRowValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  listRowValueEmpty: {
    color: 'rgba(255,255,255,0.3)',
    fontStyle: 'italic',
    fontWeight: '500',
  },
  listRowRight: {
    paddingLeft: 12,
  },

  // ── Bio List Row ──
  bioListRow: {
    padding: 16,
  },
  bioListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  bioListTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  bioListText: {
    fontSize: 15,
    color: colors.text.primary,
    lineHeight: 22,
  },
  bioListTextEmpty: {
    color: 'rgba(255,255,255,0.3)',
    fontStyle: 'italic',
  },

  // ── Save Photos ──
  savePhotosButton: { marginHorizontal: 16, marginTop: 16, borderRadius: 14, overflow: 'hidden' },
  savePhotosGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, gap: 8 },
  savePhotosText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // ── Media Grid ──
  mediaHint: { fontSize: 12, color: colors.text.tertiary, marginHorizontal: 20, marginBottom: 12, fontStyle: 'italic' },
  mediaGrid: { marginHorizontal: GRID_MARGIN, height: SLOT_HEIGHT * 2 + GRID_GAP, position: 'relative' },
  mediaSlot: { width: SLOT_WIDTH, height: SLOT_HEIGHT, borderRadius: 12, overflow: 'hidden', position: 'absolute', backgroundColor: colors.surface },
  mediaImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  addMediaButton: { flex: 1, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)', borderStyle: 'dashed', borderRadius: 12 },
  cropMediaButton: { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, width: 28, height: 28, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  removeMediaButton: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, width: 24, height: 24, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  profileBadge: { position: 'absolute', bottom: 6, left: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F94E27', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, gap: 3 },
  profileBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  slotNumber: { position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  slotNumberText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  // ── Action Sheet ──
  actionSheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  actionSheetContainer: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  actionSheetHeader: { alignItems: 'center', marginBottom: 20 },
  actionSheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text.primary, marginBottom: 4 },
  actionSheetSubtitle: { fontSize: 14, color: colors.text.secondary },
  actionSheetButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  actionSheetButtonText: { fontSize: 16, color: colors.text.primary, fontWeight: '500' },
  cancelButton: { marginTop: 8, borderBottomWidth: 0, justifyContent: 'center' },
  cancelButtonText: { fontSize: 16, color: colors.error, fontWeight: '600' },

  // ── Success Modal ──
  successModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  successCard: { width: '100%', maxWidth: 320, backgroundColor: 'rgba(28, 28, 30, 0.98)', borderRadius: 24, padding: 32, alignItems: 'center', borderWidth: 0.8, borderColor: 'rgba(255,255,255,0.12)', shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.4, shadowRadius: 30, elevation: 20 },
  iconBloomContainer: { width: 120, height: 120, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  iconHaloOuter: { position: 'absolute', width: 110, height: 110, borderRadius: 55 },
  iconHaloInner: { position: 'absolute', width: 85, height: 85, borderRadius: 42.5 },
  successIconCircle: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', shadowColor: '#F94E27', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 12 },
  successTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 12, textAlign: 'center', letterSpacing: 0.5 },
  successSubtitle: { fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 22, textAlign: 'center', marginBottom: 32, paddingHorizontal: 8 },
  doneButton: { width: '100%', height: 56 },
  doneButtonGradient: { flex: 1, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  doneButtonText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  // ── Image Viewer ──
  imageViewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  fullScreenImage: { width: width, height: width * 1.5, maxHeight: '80%' },
  closeViewerButton: { position: 'absolute', top: 60, right: 20, zIndex: 10, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10, elevation: 5 },

  // ── Premium Toggle Styles ──
  toggleTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});
