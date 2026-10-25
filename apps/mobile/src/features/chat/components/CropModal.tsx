import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  Modal,
} from 'react-native';

import Reanimated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { ImageManipulator } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PhotoEdit } from './attachmentTypes';
import { PhotoEditPreview } from './PhotoEditPreview';
import { containPhoto, cropPixels, photoDimensions } from '../photoEditing';
import { exportPhoto } from '../exportPhoto';

interface CropModalProps {
  visible: boolean;
  imageUri: string;
  imageEdit?: PhotoEdit;
  onCancel: () => void;
  onCropSave: (croppedUri: string) => void;
}

export const CropModal = ({ visible, imageUri, imageEdit, onCancel, onCropSave }: CropModalProps) => {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState<boolean>(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  const [loadError, setLoadError] = useState(false);
  const saving = useRef(false);

  const cropX = useSharedValue<number>(0);
  const cropY = useSharedValue<number>(0);
  const cropWidth = useSharedValue<number>(0);
  const cropHeight = useSharedValue<number>(0);
  
  const MIN_CROP_SIZE = 20;
  const fit = containPhoto(imageSize.width || 1, imageSize.height || 1, Math.max(1, canvas.width - 40), Math.max(1, canvas.height - 40), imageEdit);
  const renderedW = fit.displayWidth;
  const renderedH = fit.displayHeight;
  const ready = imageSize.width > 0 && canvas.width > 0 && canvas.height > 0;

  useEffect(() => {
    let isMounted = true;
    if (visible && imageUri) {
      setLoadError(false);
      Image.getSize(
        imageUri,
        (w: number, h: number) => { if (isMounted) setImageSize({ width: w, height: h }); },
        () => {
          const context = ImageManipulator.manipulate(imageUri);
          void context.renderAsync().then(image => {
            if (isMounted) setImageSize({ width: image.width, height: image.height });
            image.release();
          }).catch(() => { if (isMounted) setLoadError(true); }).finally(() => context.release());
        }
      );
    }
    return () => { isMounted = false; };
  }, [visible, imageUri]);

  const resetCrop = () => {
    cropWidth.value = renderedW; cropHeight.value = renderedH; cropX.value = 0; cropY.value = 0;
  };
  useEffect(() => {
    if (visible && ready) resetCrop();
  }, [visible, ready, renderedW, renderedH]);

  const dragGesture = Gesture.Pan()
    .onChange((event) => {
      'worklet';
      let newX = cropX.value + event.changeX;
      let newY = cropY.value + event.changeY;
      cropX.value = Math.max(0, Math.min(newX, renderedW - cropWidth.value));
      cropY.value = Math.max(0, Math.min(newY, renderedH - cropHeight.value));
    });

  const resizeBR = Gesture.Pan().onChange((event) => {
    'worklet';
    let changeW = event.changeX;
    let changeH = event.changeY;
    let maxExpandW = renderedW - (cropX.value + cropWidth.value);
    let maxExpandH = renderedH - (cropY.value + cropHeight.value);
    if (changeW > 0) changeW = Math.min(changeW, maxExpandW);
    if (changeH > 0) changeH = Math.min(changeH, maxExpandH);
    if (cropWidth.value + changeW < MIN_CROP_SIZE) changeW = MIN_CROP_SIZE - cropWidth.value;
    if (cropHeight.value + changeH < MIN_CROP_SIZE) changeH = MIN_CROP_SIZE - cropHeight.value;
    cropWidth.value += changeW;
    cropHeight.value += changeH;
  });

  const resizeTL = Gesture.Pan().onChange((event) => {
    'worklet';
    let changeW = -event.changeX;
    let changeH = -event.changeY;
    let maxExpandW = cropX.value;
    let maxExpandH = cropY.value;
    if (changeW > 0) changeW = Math.min(changeW, maxExpandW);
    if (changeH > 0) changeH = Math.min(changeH, maxExpandH);
    if (cropWidth.value + changeW < MIN_CROP_SIZE) changeW = MIN_CROP_SIZE - cropWidth.value;
    if (cropHeight.value + changeH < MIN_CROP_SIZE) changeH = MIN_CROP_SIZE - cropHeight.value;
    cropX.value -= changeW;
    cropY.value -= changeH;
    cropWidth.value += changeW;
    cropHeight.value += changeH;
  });

  const resizeTR = Gesture.Pan().onChange((event) => {
    'worklet';
    let changeW = event.changeX;
    let changeH = -event.changeY;
    let maxExpandW = renderedW - (cropX.value + cropWidth.value);
    let maxExpandH = cropY.value;
    if (changeW > 0) changeW = Math.min(changeW, maxExpandW);
    if (changeH > 0) changeH = Math.min(changeH, maxExpandH);
    if (cropWidth.value + changeW < MIN_CROP_SIZE) changeW = MIN_CROP_SIZE - cropWidth.value;
    if (cropHeight.value + changeH < MIN_CROP_SIZE) changeH = MIN_CROP_SIZE - cropHeight.value;
    cropY.value -= changeH;
    cropWidth.value += changeW;
    cropHeight.value += changeH;
  });

  const resizeBL = Gesture.Pan().onChange((event) => {
    'worklet';
    let changeW = -event.changeX;
    let changeH = event.changeY;
    let maxExpandW = cropX.value;
    let maxExpandH = renderedH - (cropY.value + cropHeight.value);
    if (changeW > 0) changeW = Math.min(changeW, maxExpandW);
    if (changeH > 0) changeH = Math.min(changeH, maxExpandH);
    if (cropWidth.value + changeW < MIN_CROP_SIZE) changeW = MIN_CROP_SIZE - cropWidth.value;
    if (cropHeight.value + changeH < MIN_CROP_SIZE) changeH = MIN_CROP_SIZE - cropHeight.value;
    cropX.value -= changeW;
    cropWidth.value += changeW;
    cropHeight.value += changeH;
  });

  const resizeTop = Gesture.Pan().onChange((event) => {
    'worklet';
    let change = -event.changeY;
    let maxExpand = cropY.value;
    if (change > 0) change = Math.min(change, maxExpand);
    if (cropHeight.value + change < MIN_CROP_SIZE) change = MIN_CROP_SIZE - cropHeight.value;
    cropY.value -= change;
    cropHeight.value += change;
  });

  const resizeBottom = Gesture.Pan().onChange((event) => {
    'worklet';
    let change = event.changeY;
    let maxExpand = renderedH - (cropY.value + cropHeight.value);
    if (change > 0) change = Math.min(change, maxExpand);
    if (cropHeight.value + change < MIN_CROP_SIZE) change = MIN_CROP_SIZE - cropHeight.value;
    cropHeight.value += change;
  });

  const resizeLeft = Gesture.Pan().onChange((event) => {
    'worklet';
    let change = -event.changeX;
    let maxExpand = cropX.value;
    if (change > 0) change = Math.min(change, maxExpand);
    if (cropWidth.value + change < MIN_CROP_SIZE) change = MIN_CROP_SIZE - cropWidth.value;
    cropX.value -= change;
    cropWidth.value += change;
  });

  const resizeRight = Gesture.Pan().onChange((event) => {
    'worklet';
    let change = event.changeX;
    let maxExpand = renderedW - (cropX.value + cropWidth.value);
    if (change > 0) change = Math.min(change, maxExpand);
    if (cropWidth.value + change < MIN_CROP_SIZE) change = MIN_CROP_SIZE - cropWidth.value;
    cropWidth.value += change;
  });

  const cropBoxStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cropX.value }, { translateY: cropY.value }],
    width: cropWidth.value,
    height: cropHeight.value,
  }));

  const resizeStyleTL = useAnimatedStyle(() => ({
    transform: [{ translateX: cropX.value - 15 }, { translateY: cropY.value - 15 }],
  }));

  const resizeStyleTR = useAnimatedStyle(() => ({
    transform: [{ translateX: cropX.value + cropWidth.value - 15 }, { translateY: cropY.value - 15 }],
  }));

  const resizeStyleBL = useAnimatedStyle(() => ({
    transform: [{ translateX: cropX.value - 15 }, { translateY: cropY.value + cropHeight.value - 15 }],
  }));

  const resizeStyleBR = useAnimatedStyle(() => ({
    transform: [{ translateX: cropX.value + cropWidth.value - 15 }, { translateY: cropY.value + cropHeight.value - 15 }],
  }));

  const resizeStyleTop = useAnimatedStyle(() => ({
    transform: [{ translateX: cropX.value + 15 }, { translateY: cropY.value - 15 }],
    width: Math.max(0, cropWidth.value - 30),
  }));

  const resizeStyleBottom = useAnimatedStyle(() => ({
    transform: [{ translateX: cropX.value + 15 }, { translateY: cropY.value + cropHeight.value - 15 }],
    width: Math.max(0, cropWidth.value - 30),
  }));

  const resizeStyleLeft = useAnimatedStyle(() => ({
    transform: [{ translateX: cropX.value - 15 }, { translateY: cropY.value + 15 }],
    height: Math.max(0, cropHeight.value - 30),
  }));

  const resizeStyleRight = useAnimatedStyle(() => ({
    transform: [{ translateX: cropX.value + cropWidth.value - 15 }, { translateY: cropY.value + 15 }],
    height: Math.max(0, cropHeight.value - 30),
  }));

  const gridLineStyleH = useAnimatedStyle(() => ({
    opacity: cropHeight.value > 45 ? 1 : 0,
  }));

  const gridLineStyleV = useAnimatedStyle(() => ({
    opacity: cropWidth.value > 45 ? 1 : 0,
  }));

  const handleBarHStyle = useAnimatedStyle(() => ({
    opacity: cropWidth.value > 40 ? 1 : 0,
  }));

  const handleBarVStyle = useAnimatedStyle(() => ({
    opacity: cropHeight.value > 40 ? 1 : 0,
  }));

  const topOverlay = useAnimatedStyle(() => ({ height: cropY.value }));
  const bottomOverlay = useAnimatedStyle(() => ({ top: cropY.value + cropHeight.value }));
  const leftOverlay = useAnimatedStyle(() => ({ top: cropY.value, width: cropX.value, height: cropHeight.value }));
  const rightOverlay = useAnimatedStyle(() => ({ top: cropY.value, left: cropX.value + cropWidth.value, height: cropHeight.value }));

  const handleSave = async () => {
    if (saving.current || !ready) return;
    saving.current = true;
    setLoading(true);
    const rect = { x: cropX.value, y: cropY.value, width: cropWidth.value, height: cropHeight.value };
    try {
      const dimensions = photoDimensions(imageSize.width, imageSize.height, imageEdit);
      const pixels = cropPixels(rect, renderedW, renderedH, dimensions.width, dimensions.height);
      const manipResult = await exportPhoto(imageUri, imageEdit, pixels);
      onCropSave(manipResult.uri);
    } catch (e) {
      console.error("Crop error:", e);
      Alert.alert('Could not crop photo', 'Your selection is still here. Try again.');
    } finally {
      saving.current = false;
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => { if (!saving.current) onCancel(); }}>
      <GestureHandlerRootView style={styles.screen}>
        <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.header}>
            <TouchableOpacity disabled={loading} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel crop" style={styles.close}>
              <Ionicons name="close" size={24} color="#F7F0F4" />
            </TouchableOpacity>
            <Text style={styles.title}>Crop photo</Text>
            <TouchableOpacity onPress={() => void handleSave()} disabled={loading || !ready} accessibilityRole="button" accessibilityLabel="Apply crop" accessibilityState={{ busy: loading, disabled: loading || !ready }} style={[styles.apply, (!ready || loading) && styles.disabled]}>
              <Text style={styles.applyText}>{loading ? 'Applying…' : 'Apply'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.canvas} onLayout={event => setCanvas({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })} pointerEvents={loading ? 'none' : 'auto'}>
            {ready ? <View style={{ width: renderedW, height: renderedH, position: 'relative' }}>
              <PhotoEditPreview uri={imageUri} edit={imageEdit} width={renderedW} height={renderedH} naturalSize={imageSize} />

              <Reanimated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)' }, topOverlay]} pointerEvents="none" />
              <Reanimated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }, bottomOverlay]} pointerEvents="none" />
              <Reanimated.View style={[{ position: 'absolute', left: 0, backgroundColor: 'rgba(0,0,0,0.55)' }, leftOverlay]} pointerEvents="none" />
              <Reanimated.View style={[{ position: 'absolute', right: 0, backgroundColor: 'rgba(0,0,0,0.55)' }, rightOverlay]} pointerEvents="none" />

              <GestureDetector gesture={dragGesture}>
                <Reanimated.View style={[{ position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)' }, cropBoxStyle]}>
                  <Reanimated.View style={[{ position: 'absolute', top: '33.33%', left: 0, right: 0, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }, gridLineStyleH]} pointerEvents="none" />
                  <Reanimated.View style={[{ position: 'absolute', top: '66.66%', left: 0, right: 0, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }, gridLineStyleH]} pointerEvents="none" />
                  <Reanimated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: '33.33%', borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }, gridLineStyleV]} pointerEvents="none" />
                  <Reanimated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: '66.66%', borderLeftWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }, gridLineStyleV]} pointerEvents="none" />
                  

                </Reanimated.View>
              </GestureDetector>

              <GestureDetector gesture={resizeTL}>
                <Reanimated.View style={[{ position: 'absolute', width: 30, height: 30, zIndex: 10, top: 0, left: 0 }, resizeStyleTL]}>
                   <View style={[styles.corner, styles.cornerTL]} />
                </Reanimated.View>
              </GestureDetector>

              <GestureDetector gesture={resizeTR}>
                <Reanimated.View style={[{ position: 'absolute', width: 30, height: 30, zIndex: 10, top: 0, left: 0 }, resizeStyleTR]}>
                   <View style={[styles.corner, styles.cornerTR]} />
                </Reanimated.View>
              </GestureDetector>

              <GestureDetector gesture={resizeBL}>
                <Reanimated.View style={[{ position: 'absolute', width: 30, height: 30, zIndex: 10, top: 0, left: 0 }, resizeStyleBL]}>
                   <View style={[styles.corner, styles.cornerBL]} />
                </Reanimated.View>
              </GestureDetector>

              <GestureDetector gesture={resizeBR}>
                <Reanimated.View style={[{ position: 'absolute', width: 30, height: 30, zIndex: 10, top: 0, left: 0 }, resizeStyleBR]}>
                   <View style={[styles.corner, styles.cornerBR]} />
                </Reanimated.View>
              </GestureDetector>

              <GestureDetector gesture={resizeTop}>
                <Reanimated.View style={[{ position: 'absolute', height: 30, zIndex: 9, top: 0, left: 0, justifyContent: 'center', alignItems: 'center' }, resizeStyleTop]}>
                   <Reanimated.View style={[styles.handleBarHoriz, handleBarHStyle]} />
                </Reanimated.View>
              </GestureDetector>

              <GestureDetector gesture={resizeBottom}>
                <Reanimated.View style={[{ position: 'absolute', height: 30, zIndex: 9, top: 0, left: 0, justifyContent: 'center', alignItems: 'center' }, resizeStyleBottom]}>
                   <Reanimated.View style={[styles.handleBarHoriz, handleBarHStyle]} />
                </Reanimated.View>
              </GestureDetector>

              <GestureDetector gesture={resizeLeft}>
                <Reanimated.View style={[{ position: 'absolute', width: 30, zIndex: 9, top: 0, left: 0, justifyContent: 'center', alignItems: 'center' }, resizeStyleLeft]}>
                   <Reanimated.View style={[styles.handleBarVert, handleBarVStyle]} />
                </Reanimated.View>
              </GestureDetector>

              <GestureDetector gesture={resizeRight}>
                <Reanimated.View style={[{ position: 'absolute', width: 30, zIndex: 9, top: 0, left: 0, justifyContent: 'center', alignItems: 'center' }, resizeStyleRight]}>
                   <Reanimated.View style={[styles.handleBarVert, handleBarVStyle]} />
                </Reanimated.View>
              </GestureDetector>
            </View> : <Text style={styles.loadingText}>{loadError ? 'Could not open this photo. Close and try again.' : 'Opening photo…'}</Text>}
          </View>
          <View style={styles.footer}>
            <Text style={styles.hint}>Drag the frame or its corners to crop.</Text>
            <TouchableOpacity disabled={!ready || loading} accessibilityRole="button" accessibilityLabel="Reset crop to full photo" onPress={resetCrop} style={styles.reset}>
              <Ionicons name="refresh-outline" size={19} color="#F3C1CA" /><Text style={styles.resetText}>Reset crop</Text>
            </TouchableOpacity>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#100F0D' },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12 },
  close: { height: 42, width: 42, borderRadius: 21, backgroundColor: '#252124', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#F7F0F4', fontSize: 17, fontWeight: '600' },
  apply: { minWidth: 74, minHeight: 40, borderRadius: 20, paddingHorizontal: 16, backgroundColor: '#F3C1CA', alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#352329', fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  canvas: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#211F20', marginTop: 8 },
  footer: { alignItems: 'center', paddingTop: 15, paddingBottom: 4, gap: 7 },
  hint: { color: '#A99BA4', fontSize: 12, textAlign: 'center' },
  reset: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 18 },
  resetText: { color: '#F3C1CA', fontSize: 13, fontWeight: '600' },
  loadingText: { color: '#BBAEB6', fontSize: 14, lineHeight: 21, textAlign: 'center', marginHorizontal: 30 },
  corner: { position: 'absolute', width: 19, height: 19, borderColor: '#FFF' },
  cornerTL: { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3 },
  handleBarHoriz: {
    width: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#fff',
    borderWidth: 0.5,
    borderColor: '#444',
  },
  handleBarVert: {
    width: 4,
    height: 24,
    borderRadius: 2,
    backgroundColor: '#fff',
    borderWidth: 0.5,
    borderColor: '#444',
  },
});
