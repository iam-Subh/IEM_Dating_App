import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, PixelRatio, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import Svg, {Path} from 'react-native-svg';
import { settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { colors } from '../../../core/theme/colors';
import { connectionColors as c } from '../../../features/auth/onboarding/ConnectionDesign';
import { PhotoDiscardDialog } from './PhotoDiscardDialog';
import { alignPhotoCrop, initialPhotoCrop, movePhotoCrop, photoCropPixels, resizePhotoCrop,
  type CropBounds, type PhotoCrop, type PhotoCropHandle } from './photoCropGeometry';

const HANDLES: PhotoCropHandle[] = ['top', 'right', 'bottom', 'left', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const CORNERS: PhotoCropHandle[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const AnimatedPath = Animated.createAnimatedComponent(Path);

function ResizeHandle({ handle, crop, bounds, disabled }: {
  handle: PhotoCropHandle; crop: SharedValue<PhotoCrop>; bounds: CropBounds; disabled: boolean;
}) {
  const start = useSharedValue<PhotoCrop>({ x: 0, y: 0, width: 0, height: 0 });
  const position = useAnimatedStyle(() => {
    const frame = crop.value;
    if (handle === 'top' || handle === 'bottom') return {
      left: frame.x + 22, top: frame.y + (handle === 'bottom' ? frame.height : 0) - 22,
      width: Math.max(0, frame.width - 44), height: 44,
    };
    if (handle === 'left' || handle === 'right') return {
      left: frame.x + (handle === 'right' ? frame.width : 0) - 22, top: frame.y + 22,
      width: 44, height: Math.max(0, frame.height - 44),
    };
    return {
      left: frame.x + (handle.endsWith('Right') ? frame.width : 0) - 22,
      top: frame.y + (handle.startsWith('bottom') ? frame.height : 0) - 22, width: 44, height: 44,
    };
  });
  const gesture = Gesture.Pan().enabled(!disabled).minDistance(0)
    .onBegin(() => { start.value = { ...crop.value }; })
    .onUpdate((event) => {
      crop.value = resizePhotoCrop(start.value, handle, event.translationX, event.translationY, bounds, 72);
    });
  return <GestureDetector gesture={gesture}>
    <Animated.View collapsable={false} style={[styles.handleTouch, position]} accessible
      accessibilityLabel={`Resize ${handle.replace(/([A-Z])/g, ' $1').toLowerCase()}`} />
  </GestureDetector>;
}

export function PhotoCropModal({ imageUri, onCancel, onSave, appearance = 'dark', initialAspectRatio }: {
  imageUri: string; onCancel: () => void; onSave: (image: ImageManipulator.ImageResult) => void; appearance?: 'dark' | 'onboarding'; initialAspectRatio?: number;
}) {
  const light = appearance === 'onboarding';
  const density = PixelRatio.get();
  const insets = useSafeAreaInsets();
  const [image, setImage] = useState<ImageManipulator.ImageResult | null>(null);
  const [heldImage, setHeldImage] = useState<ImageManipulator.ImageResult | null>(null);
  const original = useRef<ImageManipulator.ImageResult | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [decodedUri, setDecodedUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const active = useRef(true);
  const [discardVisible, setDiscardVisible] = useState(false);
  const orientation = useRef({turns: 0, flipped: false});
  const transformed = useSharedValue(false);
  const [edited, setEdited] = useState(false);
  const crop = useSharedValue<PhotoCrop>({ x: 0, y: 0, width: 0, height: 0 });
  const visualCrop = useDerivedValue(() => alignPhotoCrop(crop.value, density));
  const dragStart = useSharedValue<PhotoCrop>({ x: 0, y: 0, width: 0, height: 0 });
  const initial = useSharedValue<PhotoCrop>({x: 0, y: 0, width: 0, height: 0});
  const lastBounds = useRef<CropBounds & { uri: string; initialAspectRatio?: number }>({ width: 0, height: 0, uri: '' });
  const entrance = useSharedValue(light ? 1 : 0);
  const opened = useRef(false);

  useEffect(() => {
    active.current = true;
    let currentRequest = true;
    setFailed(false);
    ImageManipulator.manipulateAsync(imageUri, [], { compress: 1, format: ImageManipulator.SaveFormat.JPEG })
      .then((result) => { if (currentRequest) { original.current = result; setImage(result); } })
      .catch(() => { if (currentRequest) setFailed(true); });
    return () => { currentRequest = false; active.current = false; };
  }, [imageUri, retry]);

  const ratio = image ? image.width / image.height : 1;
  const renderedW = Math.max(0, Math.min(stage.width - 48, (stage.height - 48) * ratio, 600));
  const renderedH = renderedW / ratio;
  const ready = !!image && renderedW > 0 && renderedH > 0;
  const decoded = ready && decodedUri === image?.uri;
  const presented = light || opened.current || decoded || failed;
  useEffect(() => {
    if (decoded || failed) {
      opened.current = true;
      entrance.value = withTiming(1, { duration: 160 });
    }
  }, [decoded, failed, entrance]);
  const entranceStyle = useAnimatedStyle(() => ({ opacity: entrance.value }));

  useLayoutEffect(() => {
    if (!ready || !image) return;
    const previous = lastBounds.current;
    // The initial shape does not constrain later edge or corner drags.
    const fresh = initialPhotoCrop({ width: renderedW, height: renderedH }, initialAspectRatio);
    if (previous.uri === image.uri && previous.initialAspectRatio === initialAspectRatio && previous.width > 0 && previous.height > 0) {
      const selected = crop.value;
      crop.value = { x: selected.x * renderedW / previous.width, y: selected.y * renderedH / previous.height,
        width: selected.width * renderedW / previous.width, height: selected.height * renderedH / previous.height };
    } else crop.value = fresh;
    initial.value = fresh;
    lastBounds.current = { width: renderedW, height: renderedH, uri: image.uri, initialAspectRatio };
  }, [ready, renderedW, renderedH, image?.uri, crop, initial, initialAspectRatio]);

  useAnimatedReaction(() => {
    const current = crop.value;
    const baseline = initial.value;
    return transformed.value || (baseline.width > 0 && (
      Math.abs(current.x - baseline.x) > 0.5 || Math.abs(current.y - baseline.y) > 0.5 ||
      Math.abs(current.width - baseline.width) > 0.5 || Math.abs(current.height - baseline.height) > 0.5));
  }, (changed, previous) => {if (changed !== previous) runOnJS(setEdited)(changed);});

  const requestClose = () => {
    if (busyRef.current) return;
    if (discardVisible) { setDiscardVisible(false); return; }
    const selected = crop.value;
    const baseline = initial.value;
    const changed = transformed.value || (ready && (Math.abs(selected.x - baseline.x) > 0.5 ||
      Math.abs(selected.y - baseline.y) > 0.5 || Math.abs(selected.width - baseline.width) > 0.5 ||
      Math.abs(selected.height - baseline.height) > 0.5));
    if (changed) setDiscardVisible(true);
    else onCancel();
  };
  const drag = Gesture.Pan().enabled(decoded && !busy).minDistance(1)
    .onBegin(() => { dragStart.value = { ...crop.value }; })
    .onUpdate((event) => {
      crop.value = movePhotoCrop(dragStart.value, event.translationX, event.translationY, { width: renderedW, height: renderedH });
    });
  const frameStyle = useAnimatedStyle(() => ({ left: visualCrop.value.x, top: visualCrop.value.y,
    width: visualCrop.value.width, height: visualCrop.value.height }));
  // Draw the shade and border together. Separate moving panels can leave seams.
  // Extend the outer path beyond the viewport so its edge cannot become visible.
  const shadeProps = useAnimatedProps(() => {
    const {x, y, width, height} = visualCrop.value;
    return {d: `M-2 -2H${renderedW + 2}V${renderedH + 2}H-2Z M${x} ${y}H${x + width}V${y + height}H${x}Z`};
  });

  const transform = async (action: ImageManipulator.Action) => {
    if (!image || !decoded || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = await ImageManipulator.manipulateAsync(image.uri, [action], { compress: 1, format: ImageManipulator.SaveFormat.JPEG });
      if (active.current) {
        const next = orientation.current;
        if ('rotate' in action) next.turns = (next.turns + Math.round(action.rotate / 90)) % 4;
        if ('flip' in action) {next.turns = (4 - next.turns) % 4; next.flipped = !next.flipped;}
        transformed.value = next.turns !== 0 || next.flipped;
        setHeldImage(image); setImage(result);
      }
    } catch { if (active.current) Alert.alert('Could not change photo', 'Try again.'); }
    finally { if (active.current) { busyRef.current = false; setBusy(false); } }
  };
  const reset = () => {
    if (!original.current || busyRef.current) return;
    orientation.current = {turns: 0, flipped: false};
    transformed.value = false;
    crop.value = initialPhotoCrop({ width: renderedW, height: renderedH }, initialAspectRatio);
    setHeldImage(image);
    setImage(original.current);
  };
  const save = async () => {
    if (!image || !decoded || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = await ImageManipulator.manipulateAsync(image.uri,
        [{ crop: photoCropPixels(visualCrop.value, { width: renderedW, height: renderedH }, image) }],
        { compress: light ? 1 : 0.8, format: ImageManipulator.SaveFormat.JPEG });
      if (active.current) onSave(result);
    } catch { if (active.current) Alert.alert('Could not crop photo', 'Try again.'); }
    finally { if (active.current) { busyRef.current = false; setBusy(false); } }
  };

  return <Modal visible transparent hardwareAccelerated animationType={light ? 'slide' : 'none'} statusBarTranslucent navigationBarTranslucent onRequestClose={requestClose}>
    <GestureHandlerRootView style={[styles.root, light && {backgroundColor: c.canvas}]}>
      <Animated.View style={[styles.page, light && {backgroundColor: c.canvas}, entranceStyle]} pointerEvents={presented ? 'auto' : 'none'}
        accessibilityElementsHidden={!presented} importantForAccessibility={presented ? 'auto' : 'no-hide-descendants'}>
        <StatusBar barStyle={light ? 'dark-content' : 'light-content'} backgroundColor={light ? c.canvas : colors.background} />
        <View style={[styles.header, { paddingTop: insets.top, height: insets.top + 60 }]}>
          <Pressable onPress={requestClose} disabled={busy} style={({ pressed }) => [styles.iconButton, light && {backgroundColor: '#FFF'}, pressed && styles.pressed]}
            accessibilityRole="button" accessibilityLabel="Cancel crop">
            <Ionicons name="close" size={22} color={light ? c.text : '#FFFFFF'} />
          </Pressable>
          <Text style={[styles.title, light && styles.lightTitle]}>{light ? 'Frame your photo.' : 'Crop photo'}</Text>
          {!light && <Pressable onPress={() => void save()} disabled={!decoded || busy} accessibilityRole="button" accessibilityLabel="Use cropped photo"
            accessibilityState={{ disabled: !decoded || busy, busy }}
            style={({ pressed }) => [styles.saveButton, (!decoded || busy) && styles.disabled, pressed && styles.pressed]}>
            <Text style={styles.saveText}>Use photo</Text>
          </Pressable>}
        </View>
        <Text style={[styles.instruction, light && styles.lightInstruction]}>Drag the frame. Resize from any edge or corner.</Text>
        <View style={[styles.stage, light && styles.lightStage]} onLayout={(event) => setStage({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
          {ready && image && !failed ? <View style={{ width: renderedW, height: renderedH }}>
            {!decoded && heldImage && <Animated.Image source={{ uri: heldImage.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" fadeDuration={0} />}
            <Animated.Image source={{ uri: image.uri }} style={{ width: renderedW, height: renderedH, opacity: decoded ? 1 : 0 }} resizeMode="contain" fadeDuration={0}
              onLoad={() => setDecodedUri(image.uri)} onError={() => setFailed(true)} />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, {overflow: 'hidden'}]}>
              {/* Numeric SVG sizes are truncated to whole layout units. Percent
                  sizes cover the same fractional bounds as the photo. */}
              <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
                <AnimatedPath animatedProps={shadeProps} fill="rgba(0,0,0,0.6)" fillRule="evenodd" stroke="#FFF" strokeWidth={1}/>
              </Svg>
            </View>
            <GestureDetector gesture={drag}>
              <Animated.View style={[styles.frame, frameStyle]}>
                <View pointerEvents="none" style={[styles.horizontalGuide, { top: '33.333%' }]} />
                <View pointerEvents="none" style={[styles.horizontalGuide, { top: '66.667%' }]} />
                <View pointerEvents="none" style={[styles.verticalGuide, { left: '33.333%' }]} />
                <View pointerEvents="none" style={[styles.verticalGuide, { left: '66.667%' }]} />
                {CORNERS.map((corner) => <View pointerEvents="none" key={corner} style={[styles.corner,
                  corner.endsWith('Left') ? styles.cornerLeft : styles.cornerRight,
                  corner.startsWith('top') ? styles.cornerTop : styles.cornerBottom]} />)}
                <View pointerEvents="none" style={[styles.edgeHorizontal, { top: -2 }]} />
                <View pointerEvents="none" style={[styles.edgeHorizontal, { bottom: -2 }]} />
                <View pointerEvents="none" style={[styles.edgeVertical, { left: -2 }]} />
                <View pointerEvents="none" style={[styles.edgeVertical, { right: -2 }]} />
              </Animated.View>
            </GestureDetector>
            {HANDLES.map((handle) => <ResizeHandle key={handle} handle={handle} crop={crop}
              bounds={{ width: renderedW, height: renderedH }} disabled={!decoded || busy} />)}
            {(busy || !decoded) && <View style={styles.processing} pointerEvents="none"><ActivityIndicator color={palette.accent} /></View>}
          </View> : failed ? <View style={styles.error}>
            <Text style={styles.errorText}>Could not open photo</Text>
            <Pressable onPress={() => setRetry((value) => value + 1)} style={styles.saveButton}><Text style={styles.saveText}>Try again</Text></Pressable>
          </View> : <ActivityIndicator color={palette.accent} />}
        </View>
        <View style={[styles.footer, light && styles.lightFooter, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <View style={styles.tools}>
            <ToolButton light={light} label="Rotate" icon="refresh-outline" disabled={!decoded || busy} onPress={() => void transform({ rotate: 90 })} />
            <ToolButton light={light} label="Flip" icon="swap-horizontal-outline" disabled={!decoded || busy} onPress={() => void transform({ flip: ImageManipulator.FlipType.Horizontal })} />
            <ToolButton light={light} label="Reset" icon="arrow-undo-outline" disabled={!decoded || busy || !edited} onPress={reset} />
          </View>
          {light && <Pressable onPress={() => void save()} disabled={!decoded || busy} accessibilityRole="button" accessibilityLabel="Use cropped photo"
            accessibilityState={{disabled: !decoded || busy, busy}} style={({pressed}) => [styles.lightSave, (!decoded || busy) && styles.disabled, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color="#FFF"/> : <><Text style={styles.lightSaveText}>Use photo</Text><Ionicons name="checkmark" size={20} color="#FFF"/></>}
          </Pressable>}
        </View>
        <PhotoDiscardDialog visible={discardVisible} crop embedded light={light} onKeepEditing={() => setDiscardVisible(false)} onDiscard={onCancel} />
      </Animated.View>
      {!presented && <View style={styles.preparing}>
        <View style={styles.preparingCard} accessibilityRole="progressbar" accessibilityLabel="Preparing photo" accessibilityState={{ busy: true }}>
          <ActivityIndicator size="small" color={palette.accent} />
          <Text style={styles.preparingText}>Preparing photo…</Text>
          <Pressable onPress={requestClose} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Cancel opening crop">
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>}
    </GestureHandlerRootView>
  </Modal>;
}

function ToolButton({ label, icon, disabled, onPress, light }: {
  label: string; icon: React.ComponentProps<typeof Ionicons>['name']; disabled: boolean; onPress: () => void; light: boolean;
}) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label} photo`}
    accessibilityState={{ disabled }} style={({ pressed }) => [styles.tool, light && styles.lightTool, disabled && styles.disabled, pressed && styles.pressed]}>
    <Ionicons name={icon} size={20} color={light ? c.primary : '#FFB8C7'} /><Text style={[styles.toolText, light && {color: c.text}]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  lightTitle: {color: c.text, fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 29, lineHeight: 38, paddingBottom: 3},
  lightInstruction: {color: c.muted, paddingTop: 7, paddingBottom: 14, fontSize: 12, lineHeight: 18},
  lightStage: {marginHorizontal: 18, borderRadius: 26, overflow: 'hidden', backgroundColor: '#352D35'},
  lightFooter: {paddingTop: 16, paddingHorizontal: 24},
  lightTool: {backgroundColor: '#FFF', borderWidth: 0, borderRadius: 18, minHeight: 52},
  lightSave: {minHeight: 50, marginTop: 16, paddingHorizontal: 30, borderRadius: 25, alignSelf: 'center', backgroundColor: c.primary, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center'},
  lightSaveText: {fontFamily: 'DMSans_500Medium', fontSize: 16, color: '#FFF'},
  root: { flex: 1 },
  page: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.card, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#FFB8C7', fontSize: 19, fontFamily: 'DMSans_700Bold' },
  saveButton: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: palette.accentText, fontSize: 13, fontFamily: 'DMSans_700Bold' },
  instruction: { paddingHorizontal: 16, paddingTop: 8, color: '#DDD0D5', textAlign: 'center', fontSize: 12, fontFamily: 'DMSans_400Regular' },
  stage: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { position: 'absolute' },
  horizontalGuide: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#FFFFFF40' },
  verticalGuide: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#FFFFFF40' },
  corner: { position: 'absolute', width: 16, height: 16, borderColor: '#FFFFFF' },
  cornerLeft: { left: -1, borderLeftWidth: 3 }, cornerRight: { right: -1, borderRightWidth: 3 },
  cornerTop: { top: -1, borderTopWidth: 3 }, cornerBottom: { bottom: -1, borderBottomWidth: 3 },
  edgeHorizontal: { position: 'absolute', left: '50%', marginLeft: -12, width: 24, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  edgeVertical: { position: 'absolute', top: '50%', marginTop: -12, width: 3, height: 24, borderRadius: 2, backgroundColor: '#FFFFFF' },
  handleTouch: { position: 'absolute', zIndex: 10 },
  processing: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000030' },
  footer: { paddingHorizontal: 16, paddingTop: 4 },
  tools: { flexDirection: 'row', gap: 8, maxWidth: 600, width: '100%', alignSelf: 'center' },
  tool: { flex: 1, minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: palette.card, borderWidth: 1, borderColor: '#FFFFFF15' },
  toolText: { color: '#FFFFFF', fontFamily: 'DMSans_500Medium', fontSize: 12 },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.7 },
  error: { alignItems: 'center', gap: 14 }, errorText: { color: '#FFFFFF', fontFamily: 'DMSans_500Medium', fontSize: 14 },
  preparing: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  preparingCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 18, paddingRight: 6, paddingVertical: 6, borderRadius: 28, backgroundColor: palette.card },
  preparingText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'DMSans_500Medium' },
});
