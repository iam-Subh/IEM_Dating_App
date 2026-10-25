import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, useWindowDimensions, Vibration, View } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector, Pressable, type ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { movePhotoOrder, PHOTO_FOOTER_HEIGHT, photoActionTouch, photoDropSlot, photoOrderMatches, photoSlotPosition, type PhotoGridSize } from './photoReorder';
import { LastPhotoWarningModal } from '../../../components/LastPhotoWarningModal';
import { createPhotoOptionsRequest, takePhotoOption } from './profilePhotoOptionsRequests';

const GAP = 8;
const MARGIN = 16;
const DROP_DURATION = 180;
const MOVE = { duration: DROP_DURATION, easing: Easing.out(Easing.cubic) };

type Photo = { id?: string; photoUrl?: string; uri?: string; [key: string]: unknown };
type PhotoItem = { id: string; photo: Photo; uri: string };
type DragState = {
  order: SharedValue<string[]>;
  originalOrder: SharedValue<string[]>;
  activeId: SharedValue<string | null>;
  settling: SharedValue<boolean>;
  completion: SharedValue<number>;
};

/** 'checking': the nudity check is still looking at a photo just picked. */
type FaceIssue = 'mismatch' | 'no_face' | 'unsure' | 'checking';
const ISSUE_LABEL: Record<FaceIssue, string> = { mismatch: "Doesn't match", no_face: 'No face', unsure: 'In review', checking: 'Checking' };

function PhotoTile({ item, index, size, drag, scrollRef, controlsLocked, onStart, onFinish, onOptions, issue, onReplace }: {
  item: PhotoItem; index: number; size: PhotoGridSize; drag: DragState;
  /** What the selfie check found on this photo: marked on the tile, which opens Replace. */
  issue?: FaceIssue; onReplace: (photo: Photo) => void;
  scrollRef: React.RefObject<ScrollView | null>; controlsLocked: boolean;
  onStart: () => void; onFinish: (order: string[], commit: boolean) => void;
  onOptions: (id: string) => void;
}) {
  const id = item.id;
  const initial = photoSlotPosition(index, size);
  const x = useSharedValue(initial.x);
  const y = useSharedValue(initial.y);
  const scale = useSharedValue(1);
  const start = useSharedValue(initial);
  const started = useSharedValue(false);

  useAnimatedReaction(
    () => ({ slot: drag.order.value.indexOf(id), active: drag.activeId.value === id,
      width: size.width, height: size.height }),
    (current, previous) => {
      if (current.slot < 0 || current.active) return;
      if (previous && current.slot === previous.slot && current.active === previous.active &&
        current.width === previous.width && current.height === previous.height) return;
      const target = photoSlotPosition(current.slot, size);
      x.value = withTiming(target.x, MOVE);
      y.value = withTiming(target.y, MOVE);
    },
  );
  const tileStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
    zIndex: drag.activeId.value === id ? 10 : 0,
    elevation: drag.activeId.value === id ? 10 : 0,
  }));

  const settle = (commit: boolean) => {
    'worklet';
    if (!started.value || drag.settling.value || drag.activeId.value !== id) return;
    started.value = false;
    drag.settling.value = true;
    if (!commit) drag.order.value = [...drag.originalOrder.value];
    const settledOrder = [...drag.order.value];
    const target = photoSlotPosition(settledOrder.indexOf(id), size);
    x.value = withTiming(target.x, MOVE);
    y.value = withTiming(target.y, MOVE);
    scale.value = withTiming(1, { duration: 120 });
    // Complete once both coordinates have settled, including horizontal-only drops.
    drag.completion.value = 0;
    drag.completion.value = withTiming(1, MOVE, (finished) => {
      if (!finished) return;
      drag.activeId.value = null;
      runOnJS(onFinish)(settledOrder, commit);
    });
  };
  const pan = Gesture.Pan()
    .activateAfterLongPress(300)
    .maxPointers(1)
    .blocksExternalGesture(scrollRef)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (drag.settling.value || drag.activeId.value !== null ||
        (touch && photoActionTouch(touch.x, touch.y, size, !!issue))) manager.fail();
    })
    .onStart(() => {
      cancelAnimation(x); cancelAnimation(y);
      start.value = { x: x.value, y: y.value };
      drag.originalOrder.value = [...drag.order.value];
      drag.activeId.value = id;
      started.value = true;
      scale.value = withTiming(1.04, { duration: 120 });
      runOnJS(onStart)();
    })
    .onUpdate((event) => {
      if (!started.value || drag.activeId.value !== id) return;
      x.value = start.value.x + event.translationX;
      y.value = start.value.y + event.translationY;
      const slot = photoDropSlot(x.value, y.value, drag.order.value.length, size);
      drag.order.value = movePhotoOrder(drag.order.value, id, slot);
    })
    .onEnd((_event, success) => { settle(success); })
    .onFinalize((_event, success) => { if (!success) settle(false); });

  return <GestureDetector gesture={pan}>
    <Animated.View collapsable={false} style={[styles.tile, { width: size.width, height: size.height }, tileStyle]}>
      <Image source={{ uri: item.uri }} style={[styles.image, { height: size.height - PHOTO_FOOTER_HEIGHT - (issue ? 26 : 0) }]}
        resizeMode="cover" fadeDuration={0} />
      {issue ? <>
        {issue === 'checking' ? (
          <View accessible accessibilityRole="text" accessibilityLabel={`Photo ${index + 1}: checking`}
            style={[styles.issue, styles.checkingStatus]}>
            <ActivityIndicator size={11} color={palette.text} />
            <Text style={[styles.issueText, styles.checkingText]} numberOfLines={1}>Checking…</Text>
          </View>
        ) : issue === 'unsure' ? (
          <View accessible accessibilityRole="text" accessibilityLabel={`Photo ${index + 1}: In review`}
            style={[styles.issue, styles.reviewStatus]}>
            <Ionicons name="time-outline" size={12} color="#49351F" />
            <Text style={[styles.issueText, styles.reviewText]} numberOfLines={1}>In review</Text>
          </View>
        ) : (
          <Pressable disabled={controlsLocked} onPress={() => onReplace(item.photo)} accessibilityRole="button"
            accessibilityLabel={`Replace photo ${index + 1}: ${ISSUE_LABEL[issue]}`}
            style={({ pressed }) => [styles.issue, styles.replaceAction, pressed && styles.pressed]}>
            <Ionicons name="refresh-outline" size={12} color="#2A1517" />
            <Text style={styles.issueText} numberOfLines={1}>Replace</Text>
          </Pressable>
        )}
      </> : null}
      <View style={styles.footer}>
        <View pointerEvents="none" style={styles.photoLabel}>
          {index === 0 ? <Ionicons name="star" size={10} color={palette.accent} /> : null}
          <Text style={[styles.numberText, index === 0 && styles.mainText]}>{index === 0 ? 'Main' : index + 1}</Text>
        </View>
        <Pressable disabled={controlsLocked} onPress={() => onOptions(id)} accessibilityRole="button"
          accessibilityLabel={`Photo ${index + 1} options${index === 0 ? ', main photo' : ''}`} hitSlop={4}
          style={({ pressed }) => [styles.options, pressed && styles.pressed]}>
          <Ionicons name="ellipsis-horizontal" size={18} color="#E0DAD5" />
        </Pressable>
      </View>
      {issue ? <View pointerEvents="none" style={[styles.issueRing, { borderColor: issue === 'checking' ? 'rgba(255,255,255,0.18)' : issue === 'unsure' ? ISSUE_AMBER : ISSUE_RED }]} /> : null}
    </Animated.View>
  </GestureDetector>;
}

export const PhotoReorderGrid = React.memo(function PhotoReorderGrid({ photos, onPhotosChange, onAddPress, onReplacePress, onScrollLock, onCropProfile, scrollRef, embedded = false, issues }: {
  photos: Photo[]; onPhotosChange: (photos: Photo[]) => void; onAddPress: () => void;
  /** Selfie-check findings by photo address. */
  issues?: Record<string, FaceIssue>;
  onReplacePress: (photo: Photo) => void;
  onScrollLock: (locked: boolean) => void; onCropProfile: (uri: string) => void;
  scrollRef: React.RefObject<ScrollView | null>;
  embedded?: boolean;
}) {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const slotWidth = (Math.min(width, 600) - MARGIN * 2 - (embedded ? 24 : 0) - GAP * 2) / 3;
  const size = { width: slotWidth, height: slotWidth * 4 / 3 + PHOTO_FOOTER_HEIGHT, gap: GAP };
  const items = useMemo(() => {
    const seen = new Map<string, number>();
    return photos.map((photo) => {
      const uri = photo.photoUrl || photo.uri || '';
      const base = photo.id ? `id:${photo.id}` : `uri:${uri}`;
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      return { id: `${base}:${occurrence}`, photo, uri };
    });
  }, [photos]);
  const itemRef = useRef(items);
  itemRef.current = items;
  const keys = items.map((item) => item.id);
  const keySignature = JSON.stringify(keys);
  const order = useSharedValue(keys);
  const originalOrder = useSharedValue(keys);
  const activeId = useSharedValue<string | null>(null);
  const settling = useSharedValue(false);
  const completion = useSharedValue(0);
  const [controlsLocked, setControlsLocked] = useState(false);
  const [protectedPhotoId, setProtectedPhotoId] = useState<string | null>(null);
  const mounted = useRef(true);

  useLayoutEffect(() => {
    if (photoOrderMatches(order.value, keys)) return;
    // New photos, removals, and external refreshes replace the order without stale offsets.
    cancelAnimation(completion);
    order.value = keys;
    originalOrder.value = keys;
    activeId.value = null;
    settling.value = false;
    setControlsLocked(false);
    onScrollLock(false);
  }, [keySignature, order, originalOrder, activeId, settling, completion, onScrollLock]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelAnimation(completion); onScrollLock(false); };
  }, [completion, onScrollLock]);

  const startDrag = useCallback(() => {
    if (!mounted.current) return;
    setControlsLocked(true);
    onScrollLock(true);
    Vibration.vibrate(25);
  }, [onScrollLock]);
  const finishDrag = useCallback((next: string[], commit: boolean) => {
    if (!mounted.current) return;
    const current = itemRef.current;
    if (commit && next.length === current.length && !photoOrderMatches(next, current.map((item) => item.id))) {
      const byId = new Map(current.map((item) => [item.id, item.photo]));
      const reordered = next.map((id) => byId.get(id));
      if (reordered.every((photo): photo is Photo => !!photo)) onPhotosChange(reordered);
    }
    settling.value = false;
    setControlsLocked(false);
    onScrollLock(false);
  }, [onPhotosChange, onScrollLock, settling]);
  const remove = useCallback((id: string) => {
    const keepLastPhoto = () => setProtectedPhotoId(id);
    if (itemRef.current.length <= 1) { keepLastPhoto(); return; }
    Alert.alert('Remove Photo', 'Are you sure you want to remove this photo?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        const remaining = itemRef.current.filter(item => item.id !== id);
        if (!remaining.length) { keepLastPhoto(); return; }
        onPhotosChange(remaining.map(item => item.photo));
      } },
    ]);
  }, [onPhotosChange, onReplacePress]);
  const drag = { order, originalOrder, activeId, settling, completion };
  const optionsRequest = useRef<string | null>(null);
  const dismissalFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeOptions = useRef(() => {});
  completeOptions.current = () => {
    if (dismissalFallback.current) clearTimeout(dismissalFallback.current);
    dismissalFallback.current = null;
    const requestId = optionsRequest.current;
    if (!requestId) return;
    optionsRequest.current = null;
    const result = takePhotoOption(requestId);
    if (!result) return;
    const item = itemRef.current.find(photo => photo.id === result.photoId);
    if (!item) return;
    if (result.action === 'replace') onReplacePress(item.photo);
    else if (result.action === 'remove') remove(item.id);
    else if (itemRef.current[0]?.id === item.id) onCropProfile(item.uri);
  };
  const finishOptions = useCallback(() => completeOptions.current(), []);
  useEffect(() => {
    const unsubscribe = navigation.addListener('transitionEnd', (event: any) => {
      if (!event.data.closing && navigation.isFocused()) finishOptions();
    });
    return () => {
      unsubscribe();
      if (dismissalFallback.current) clearTimeout(dismissalFallback.current);
      if (optionsRequest.current) takePhotoOption(optionsRequest.current);
    };
  }, [navigation, finishOptions]);
  useFocusEffect(useCallback(() => {
    if (optionsRequest.current) dismissalFallback.current = setTimeout(finishOptions, 350);
    return () => {
      if (dismissalFallback.current) clearTimeout(dismissalFallback.current);
      dismissalFallback.current = null;
    };
  }, [finishOptions]));
  const openOptions = (id: string) => {
    if (optionsRequest.current || controlsLocked) return;
    const index = itemRef.current.findIndex(item => item.id === id);
    if (index < 0) return;
    const requestId = createPhotoOptionsRequest(id);
    optionsRequest.current = requestId;
    navigation.navigate('ProfilePhotoOptions', { requestId, index, issue: issues?.[itemRef.current[index].uri] });
  };

  const protectedPhoto = items.find(item => item.id === protectedPhotoId);
  return <View style={[styles.grid, { marginHorizontal: embedded ? 0 : MARGIN, height: size.height * 2 + GAP }]}>
    <LastPhotoWarningModal visible={Boolean(protectedPhoto)} imageUri={protectedPhoto?.uri} onClose={() => setProtectedPhotoId(null)} onReplace={() => {
      const item = itemRef.current.find(item => item.id === protectedPhotoId);
      if (item) onReplacePress(item.photo);
    }} />
    {items.map((item, index) => <PhotoTile key={item.id} item={item} index={index} size={size} drag={drag}
      scrollRef={scrollRef} controlsLocked={controlsLocked} onStart={startDrag} onFinish={finishDrag} onOptions={openOptions}
      issue={issues?.[item.uri]} onReplace={onReplacePress} />)}
    {Array.from({ length: Math.max(0, 6 - items.length) }, (_, offset) => {
      const index = items.length + offset;
      const position = photoSlotPosition(index, size);
      return <View key={`empty-${index}`} style={[styles.tile, styles.emptyTile, { width: size.width, height: size.height, left: position.x, top: position.y }]}>
        <Pressable style={styles.add} disabled={controlsLocked} onPress={onAddPress} accessibilityRole="button" accessibilityLabel={`Add photo ${index + 1}`}>
          <Ionicons name="add" size={25} color={palette.accent} /><Text style={styles.addText}>Add photo</Text>
        </Pressable>
      </View>;
    })}
  </View>;
});

const ISSUE_RED = '#FF9AA2';
const ISSUE_AMBER = '#F0C17A';

const styles = StyleSheet.create({
  grid: { position: 'relative' },
  tile: { position: 'absolute', left: 0, top: 0, borderRadius: 14, overflow: 'hidden', backgroundColor: palette.card },
  emptyTile: { backgroundColor: '#303030' },
  image: { width: '100%' },
  footer: { height: PHOTO_FOOTER_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 8, backgroundColor: '#2D2A28' },
  photoLabel: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 3 },
  numberText: { fontSize: 11, fontFamily: 'DMSans_500Medium', color: '#C7C0BA' },
  mainText: { fontSize: 10, fontFamily: 'DMSans_700Bold', color: palette.accent },
  options: { width: 34, height: PHOTO_FOOTER_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  add: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 6 },
  addText: { color: '#FFE2E8', fontFamily: 'DMSans_500Medium', fontSize: 10 },
  issueRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, borderWidth: 1.5 },
  issue: { height: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
  reviewStatus: { backgroundColor: '#F3DDB4' },
  reviewText: { color: '#49351F' },
  checkingStatus: { backgroundColor: 'rgba(255,255,255,0.1)' },
  checkingText: { color: palette.text },
  replaceAction: { backgroundColor: '#F7C4C8' },
  issueText: { flexShrink: 1, fontSize: 10, fontFamily: 'DMSans_700Bold', color: '#2A1517' },
  pressed: { opacity: 0.8 },
});
