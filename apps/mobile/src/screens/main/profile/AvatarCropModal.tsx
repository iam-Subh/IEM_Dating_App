import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../../../core/theme/colors';
import { settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { resizeAvatarCrop, type CropCorner, type CropSquare } from './avatarCropGeometry';
import { PhotoDiscardDialog } from './PhotoDiscardDialog';

const CORNERS: CropCorner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const PREVIEW_SIZE = 64;
const AnimatedPath = Animated.createAnimatedComponent(Path);

function CropHandle({ corner, crop, bounds, minimum, disabled }: {
  corner: CropCorner; crop: SharedValue<CropSquare>; bounds: { width: number; height: number }; minimum: number; disabled: boolean;
}) {
  const start = useSharedValue<CropSquare>({ x: 0, y: 0, size: 0 });
  const left = corner === 'topLeft' || corner === 'bottomLeft';
  const top = corner === 'topLeft' || corner === 'topRight';
  const position = useAnimatedStyle(() => ({ opacity: crop.value.size > 0 ? 1 : 0, transform: [
    { translateX: crop.value.x + (left ? 0 : crop.value.size) - 22 },
    { translateY: crop.value.y + (top ? 0 : crop.value.size) - 22 },
  ] }));
  const gesture = Gesture.Pan().enabled(!disabled).minDistance(0)
    .onBegin(() => { start.value = { ...crop.value }; })
    .onUpdate((event) => {
      crop.value = resizeAvatarCrop(start.value, corner, event.translationX, event.translationY, bounds, minimum);
    });
  return <GestureDetector gesture={gesture}>
    <Animated.View collapsable={false} style={[styles.handleTouch, position]} accessible accessibilityLabel={`Resize from ${corner.replace(/([A-Z])/g, ' $1').toLowerCase()}`} />
  </GestureDetector>;
}

export function AvatarCropModal({ visible, imageUri, onCancel, onCropSave }: {
  visible: boolean; imageUri: string; onCancel: () => void; onCropSave: (uri: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [image, setImage] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [decodedUri, setDecodedUri] = useState<string | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);
  const initialCrop = useRef<CropSquare>({ x: 0, y: 0, size: 0 });
  const crop = useSharedValue<CropSquare>({ x: 0, y: 0, size: 0 });
  const dragStart = useSharedValue<CropSquare>({ x: 0, y: 0, size: 0 });
  const entrance = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setImage(null); setDecodedUri(null); setFailed(false);
    // Normalize orientation once so the preview and exported crop use the same image dimensions.
    ImageManipulator.manipulateAsync(imageUri, [], { compress: 1, format: ImageManipulator.SaveFormat.JPEG })
      .then((result) => { if (active) setImage(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [visible, imageUri, retry]);

  const ratio = image ? image.width / image.height : 1;
  const renderedW = Math.max(0, Math.min(stage.width - 48, (stage.height - 48) * ratio, 580));
  const renderedH = renderedW / ratio;
  const ready = !!image && renderedW > 0 && renderedH > 0;
  const presented = failed || (ready && decodedUri === image?.uri);
  useEffect(() => {
    entrance.value = withTiming(presented ? 1 : 0, { duration: presented ? 160 : 0 });
  }, [presented, entrance]);
  const entranceStyle = useAnimatedStyle(() => ({ opacity: entrance.value }));
  const minimum = Math.min(80, renderedW, renderedH);
  const reset = () => {
    const size = Math.min(renderedW, renderedH) * 0.8;
    crop.value = { x: (renderedW - size) / 2, y: (renderedH - size) / 2, size };
  };
  useLayoutEffect(() => {
    if (!ready) return;
    const size = Math.min(renderedW, renderedH) * 0.8;
    initialCrop.current = { x: (renderedW - size) / 2, y: (renderedH - size) / 2, size };
    crop.value = { ...initialCrop.current };
  }, [ready, renderedW, renderedH, image?.uri, crop]);

  const requestClose = () => {
    if (saving) return;
    if (discardVisible) { setDiscardVisible(false); return; }
    const selected = crop.value;
    const initial = initialCrop.current;
    const changed = ready && (Math.abs(selected.x - initial.x) > 0.5 || Math.abs(selected.y - initial.y) > 0.5 || Math.abs(selected.size - initial.size) > 0.5);
    if (changed) setDiscardVisible(true);
    else onCancel();
  };

  const drag = Gesture.Pan().enabled(ready && !saving).minDistance(1)
    .onBegin(() => { dragStart.value = { ...crop.value }; })
    .onUpdate((event) => {
      const start = dragStart.value;
      crop.value = { size: start.size,
        x: Math.max(0, Math.min(start.x + event.translationX, renderedW - start.size)),
        y: Math.max(0, Math.min(start.y + event.translationY, renderedH - start.size)) };
    });
  const cropStyle = useAnimatedStyle(() => ({ opacity: crop.value.size > 0 ? 1 : 0, left: crop.value.x, top: crop.value.y, width: crop.value.size, height: crop.value.size }));
  const shadeProps = useAnimatedProps(() => {
    const { x, y, size } = crop.value;
    // A single path with a square hole has no joins between shade panels.
    // Separate native rectangles can leave visible gaps at fractional coordinates.
    return { d: `M0 0H${renderedW}V${renderedH}H0Z M${x} ${y}H${x + size}V${y + size}H${x}Z` };
  });
  const preview = useAnimatedStyle(() => {
    const scale = crop.value.size > 0 ? PREVIEW_SIZE / crop.value.size : 0;
    return { width: renderedW * scale, height: renderedH * scale, left: -crop.value.x * scale, top: -crop.value.y * scale };
  });

  const save = async () => {
    if (!ready || !presented || failed || saving || !image) return;
    const selected = { ...crop.value };
    setSaving(true);
    try {
      const scale = image.width / renderedW;
      const x = Math.max(0, Math.round(selected.x * scale));
      const y = Math.max(0, Math.round(selected.y * scale));
      const size = Math.max(1, Math.min(Math.round(selected.size * scale), image.width - x, image.height - y));
      const result = await ImageManipulator.manipulateAsync(image.uri,
        [{ crop: { originX: x, originY: y, width: size, height: size } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
      onCropSave(result.uri);
    } catch { Alert.alert('Could not save crop', 'Try again or choose another photo.'); }
    finally { setSaving(false); }
  };

  // Keep the profile visible until the photo is decoded. An opaque native window
  // would show a blank page before the image and initial crop reach the UI thread.
  return <Modal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={requestClose}>
    <GestureHandlerRootView style={styles.modalRoot}>
      <Animated.View style={[styles.page, entranceStyle]} pointerEvents={presented ? 'auto' : 'none'}
        accessibilityElementsHidden={!presented} importantForAccessibility={presented ? 'auto' : 'no-hide-descendants'}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <View style={[styles.header, { paddingTop: insets.top, height: insets.top + 54 }]}>
        <Pressable onPress={requestClose} disabled={saving} style={styles.close} accessibilityRole="button" accessibilityLabel="Cancel crop">
          <Ionicons name="close" size={23} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title}>Crop avatar</Text>
        <Pressable onPress={() => void save()} disabled={!ready || !presented || failed || saving} accessibilityRole="button" accessibilityState={{ disabled: !ready || !presented || failed || saving, busy: saving }}
          style={({ pressed }) => [styles.save, (!ready || !presented || failed || saving) && styles.disabled, pressed && styles.pressed]}>
          {saving ? <ActivityIndicator size="small" color={palette.accentText} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>
      <Text style={styles.instruction}>Drag the frame. Resize from any corner.</Text>
      <View style={styles.stage} onLayout={(event) => setStage({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
        {!failed && ready && image ? <View style={{ width: renderedW, height: renderedH }}>
          <Animated.Image source={{ uri: image.uri }} style={{ width: renderedW, height: renderedH }} resizeMode="contain" fadeDuration={0}
            onLoad={() => setDecodedUri(image.uri)} onError={() => setFailed(true)} />
          <Svg pointerEvents="none" width={renderedW} height={renderedH} style={StyleSheet.absoluteFill}>
            <AnimatedPath animatedProps={shadeProps} fill="rgba(0,0,0,0.58)" fillRule="evenodd" stroke="none" />
          </Svg>
          <GestureDetector gesture={drag}>
            <Animated.View style={[styles.crop, cropStyle]}>
              <View pointerEvents="none" style={styles.circle} />
              <View pointerEvents="none" style={[styles.horizontalGuide, { top: '33.333%' }]} />
              <View pointerEvents="none" style={[styles.horizontalGuide, { top: '66.667%' }]} />
              <View pointerEvents="none" style={[styles.verticalGuide, { left: '33.333%' }]} />
              <View pointerEvents="none" style={[styles.verticalGuide, { left: '66.667%' }]} />
              {/* Draw corner marks in the frame so resizing cannot leave a second outline behind. */}
              {CORNERS.map((corner) => <View key={corner} pointerEvents="none" style={[styles.handleMark,
                corner === 'topLeft' || corner === 'bottomLeft' ? styles.handleLeft : styles.handleRight,
                corner === 'topLeft' || corner === 'topRight' ? styles.handleTop : styles.handleBottom]} />)}
            </Animated.View>
          </GestureDetector>
          {CORNERS.map((corner) => <CropHandle key={corner} corner={corner} crop={crop} bounds={{ width: renderedW, height: renderedH }} minimum={minimum} disabled={saving} />)}
        </View> : failed ? <View style={styles.error}>
          <Text style={styles.previewTitle}>Could not open photo</Text>
          <Pressable onPress={() => setRetry((value) => value + 1)} style={styles.save}><Text style={styles.saveText}>Try again</Text></Pressable>
        </View> : <ActivityIndicator color={palette.accent} />}
      </View>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <View style={styles.previewCard}>
          <View style={styles.previewCircle}>{image && ready && <Animated.Image source={{ uri: image.uri }} style={[styles.previewImage, preview]} fadeDuration={0} />}</View>
          <View style={styles.previewCopy}><Text style={styles.previewTitle}>Avatar preview</Text><Text style={styles.previewHint}>This is how your photo looks in chats.</Text></View>
          <Pressable onPress={reset} disabled={!ready || saving} accessibilityRole="button" accessibilityLabel="Reset crop" style={styles.reset}>
            <Ionicons name="refresh-outline" size={20} color={palette.accent} />
          </Pressable>
        </View>
      </View>
      <PhotoDiscardDialog visible={discardVisible} crop embedded onKeepEditing={() => setDiscardVisible(false)} onDiscard={onCancel} />
      </Animated.View>
      {!presented && <View style={styles.loadingOverlay}>
        <View style={styles.loadingCard} accessibilityRole="progressbar" accessibilityLabel="Preparing photo" accessibilityState={{ busy: true }}>
          <ActivityIndicator size="small" color="#FFB8C7" />
          <Text style={styles.loadingText}>Preparing photo…</Text>
          <Pressable onPress={requestClose} style={styles.loadingCancel} accessibilityRole="button" accessibilityLabel="Cancel opening crop">
            <Ionicons name="close" size={19} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>}
    </GestureHandlerRootView>
  </Modal>;
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  page: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card },
  title: { flex: 1, color: '#FFB8C7', fontFamily: 'DMSans_700Bold', fontSize: 20 },
  save: { minWidth: 70, minHeight: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 13 },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.7 },
  instruction: { color: '#DDD0D5', fontFamily: 'DMSans_400Regular', fontSize: 12, textAlign: 'center', paddingHorizontal: 16, paddingTop: 8 },
  stage: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  crop: { position: 'absolute', borderWidth: 1, borderColor: '#FFFFFF' },
  circle: { ...StyleSheet.absoluteFill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', borderRadius: 9999 },
  horizontalGuide: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.22)' },
  verticalGuide: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.22)' },
  handleTouch: { position: 'absolute', left: 0, top: 0, width: 44, height: 44, zIndex: 10 },
  handleMark: { position: 'absolute', width: 16, height: 16, borderColor: '#FFFFFF' },
  handleLeft: { left: -1, borderLeftWidth: 3 }, handleRight: { right: -1, borderRightWidth: 3 },
  handleTop: { top: -1, borderTopWidth: 3 }, handleBottom: { bottom: -1, borderBottomWidth: 3 },
  footer: { paddingHorizontal: 16, paddingTop: 4 },
  previewCard: { width: '100%', maxWidth: 600, alignSelf: 'center', borderRadius: 18, backgroundColor: palette.card, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewCircle: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: PREVIEW_SIZE / 2, overflow: 'hidden', backgroundColor: '#393339' },
  previewImage: { position: 'absolute' },
  previewCopy: { flex: 1, minWidth: 0 },
  previewTitle: { color: '#FFB8C7', fontFamily: 'DMSans_700Bold', fontSize: 14 },
  previewHint: { color: '#DDD0D5', fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, marginTop: 4 },
  reset: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  error: { alignItems: 'center', gap: 14 },
  loadingOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  loadingCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 18, paddingRight: 6, paddingVertical: 6, borderRadius: 24, backgroundColor: palette.card },
  loadingText: { color: '#FFFFFF', fontFamily: 'DMSans_500Medium', fontSize: 13 },
  loadingCancel: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
