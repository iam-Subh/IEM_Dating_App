import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Modal, StatusBar, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {Gesture, GestureDetector, GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {cancelAnimation, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue} from 'react-native-reanimated';
import {TapChoice, connectionStyles as shared} from './ConnectionDesign';
import {clampPreviewPan, fitPreviewPhoto, previewZoomAtPoint} from './photoPreviewGeometry';
import {previewPhotoSize, rememberPreviewPhoto} from './photoPreviewCache';

function PhotoZoomControls({scale, loaded, onZoom, onReset}: {
  scale: SharedValue<number>; loaded: boolean; onZoom: (change: number) => void; onReset: () => void;
}) {
  const [limit, setLimit] = useState(1);
  // Update only the controls when a zoom limit changes. Keep the photo's active
  // gestures unchanged while the user pinches.
  useAnimatedReaction(
    () => scale.value <= 1.001 ? 1 : scale.value >= 4.999 ? 2 : 0,
    (current, previous) => {if (current !== previous) runOnJS(setLimit)(current);},
  );
  const atMinimum = !loaded || limit === 1;
  const atMaximum = !loaded || limit === 2;
  return <View style={s.zoomBar}>
    <Text style={[s.hint, {flex: 1}]}>Pinch or double-tap to zoom</Text>
    <TapChoice accessibilityRole="button" accessibilityLabel="Zoom photo out" accessibilityState={{disabled: atMinimum}} disabled={atMinimum} onPress={() => onZoom(-0.5)} style={({pressed}) => [s.zoomButton, atMinimum && s.disabled, pressed && shared.pressed]}><Ionicons name="remove" size={22} color="#FFF"/></TapChoice>
    <TapChoice accessibilityRole="button" accessibilityLabel="Zoom photo in" accessibilityState={{disabled: atMaximum}} disabled={atMaximum} onPress={() => onZoom(0.5)} style={({pressed}) => [s.zoomButton, atMaximum && s.disabled, pressed && shared.pressed]}><Ionicons name="add" size={22} color="#FFF"/></TapChoice>
    <TapChoice accessibilityRole="button" accessibilityLabel="Reset photo zoom" disabled={!loaded} onPress={onReset} style={({pressed}) => [s.reset, !loaded && s.disabled, pressed && shared.pressed]}><Text style={s.resetText}>Reset</Text></TapChoice>
  </View>;
}

function ZoomablePhoto({uri}: {uri: string}) {
  const [viewport, setViewport] = useState({width: 0, height: 0});
  const [source, setSource] = useState(() => previewPhotoSize(uri) ?? {width: 0, height: 0});
  const [loaded, setLoaded] = useState(() => !!previewPhotoSize(uri));
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showLoading, setShowLoading] = useState(false);
  const image = fitPreviewPhoto(source, viewport);
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const start = useSharedValue({scale: 1, x: 0, y: 0, focalX: 0, focalY: 0});
  const pinching = useSharedValue(false);

  useEffect(() => {
    if (loaded || failed) {setShowLoading(false); return;}
    const timer = setTimeout(() => setShowLoading(true), 350);
    return () => clearTimeout(timer);
  }, [loaded, failed]);

  useEffect(() => {
    cancelAnimation(scale); cancelAnimation(x); cancelAnimation(y);
    scale.value = 1; x.value = 0; y.value = 0;
  }, [viewport.width, viewport.height, scale, x, y]);

  const pinch = Gesture.Pinch().enabled(loaded)
    .onStart(event => {
      cancelAnimation(scale); cancelAnimation(x); cancelAnimation(y);
      pinching.value = true;
      start.value = {scale: scale.value, x: x.value, y: y.value,
        focalX: event.focalX - viewport.width / 2, focalY: event.focalY - viewport.height / 2};
    })
    .onUpdate(event => {
      const from = start.value;
      const next = Math.max(1, Math.min(from.scale * event.scale, 5));
      const ratio = next / from.scale;
      const pan = clampPreviewPan(
        event.focalX - viewport.width / 2 - (from.focalX - from.x) * ratio,
        event.focalY - viewport.height / 2 - (from.focalY - from.y) * ratio,
        next, image, viewport);
      scale.value = next; x.value = pan.x; y.value = pan.y;
    })
    .onFinalize(() => {pinching.value = false;});
  // Keep this handler active through a pinch. Incremental movement prevents a
  // jump when one finger remains, or when the photo reaches a viewport edge.
  const pan = Gesture.Pan().enabled(loaded).averageTouches(true).minDistance(3)
    .onBegin(() => {cancelAnimation(scale); cancelAnimation(x); cancelAnimation(y);})
    .onChange(event => {
      if (pinching.value || event.numberOfPointers !== 1) return;
      const next = clampPreviewPan(x.value + event.changeX, y.value + event.changeY, scale.value, image, viewport);
      x.value = next.x; y.value = next.y;
    });
  const doubleTap = Gesture.Tap().enabled(loaded).numberOfTaps(2).maxDuration(250).maxDelay(250).maxDistance(8)
    .onTouchesDown((event, manager) => {if (event.numberOfTouches > 1) manager.fail();})
    .onEnd((event, success) => {
      if (!success) return;
      const next = previewZoomAtPoint(scale.value, scale.value > 1.1 ? 1 : 2.5, x.value, y.value,
        event.x - viewport.width / 2, event.y - viewport.height / 2, image, viewport);
      scale.value = withTiming(next.scale, {duration: 180});
      x.value = withTiming(next.x, {duration: 180}); y.value = withTiming(next.y, {duration: 180});
    });
  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);
  const photoStyle = useAnimatedStyle(() => ({transform: [{translateX: x.value}, {translateY: y.value}, {scale: scale.value}]}));
  const zoom = (change: number) => {
    if (!loaded || (change > 0 && scale.value >= 4.999) || (change < 0 && scale.value <= 1.001)) return;
    const next = previewZoomAtPoint(scale.value, scale.value + change, x.value, y.value, 0, 0, image, viewport);
    scale.value = withTiming(next.scale, {duration: 180});
    x.value = withTiming(next.x, {duration: 180}); y.value = withTiming(next.y, {duration: 180});
  };
  const reset = () => {
    scale.value = withTiming(1, {duration: 180}); x.value = withTiming(0, {duration: 180}); y.value = withTiming(0, {duration: 180});
  };

  return <View style={s.photoArea}>
    <View style={s.viewport} onLayout={event => {
      const {width, height} = event.nativeEvent.layout;
      setViewport(current => current.width === width && current.height === height ? current : {width, height});
    }}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={s.gestureArea} collapsable={false}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {!failed && <Animated.Image key={retry} source={{uri}} resizeMode="contain" fadeDuration={0}
            style={[StyleSheet.absoluteFill, photoStyle]}
            onLoad={event => {
              const {width, height} = event.nativeEvent.source;
              rememberPreviewPhoto(uri, {width, height});
              setSource({width, height}); setLoaded(true);
            }} onError={() => {setFailed(true); setLoaded(false);}}/>}
          </View>
        </Animated.View>
      </GestureDetector>
      {showLoading && !loaded && !failed && <View style={s.loading} pointerEvents="none"><ActivityIndicator color="#EEDDE3"/></View>}
      {failed && <View style={s.loading}><Text style={s.hint}>Could not open this photo.</Text>
        <TapChoice accessibilityRole="button" onPress={() => {setFailed(false); setRetry(value => value + 1);}} style={s.reset}><Text style={s.resetText}>Try again</Text></TapChoice>
      </View>}
    </View>
    <PhotoZoomControls scale={scale} loaded={loaded} onZoom={zoom} onReset={reset}/>
  </View>;
}

export function ProfilePhotoPreview({photos, index, onIndex, onClose}: {
  photos: (string | null)[]; index: number; onIndex: (index: number) => void; onClose: () => void;
}) {
  const slots = photos.map((uri, slot) => ({uri, slot})).filter(item => !!item.uri);
  const position = slots.findIndex(item => item.slot === index);
  const uri = photos[index];
  if (!uri || position < 0) return null;
  return <Modal visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} hardwareAccelerated>
    <GestureHandlerRootView style={s.page}>
      <SafeAreaView style={s.page} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor="#211C23"/>
        <View style={s.header}>
          <View style={s.heading}><Text accessibilityRole="header" style={s.title}>{index === 0 ? 'Your main photo' : 'Your photo'}</Text><Text style={s.hint}>Photo {position + 1} of {slots.length}</Text></View>
          <TapChoice accessibilityRole="button" accessibilityLabel="Close photo preview" onPress={onClose} style={({pressed}) => [s.zoomButton, pressed && shared.pressed]}><Ionicons name="close" size={23} color="#FFF"/></TapChoice>
        </View>
        <ZoomablePhoto key={uri + index} uri={uri}/>
        {slots.length > 1 && <View style={s.photoNavigation}>
          <TapChoice accessibilityRole="button" accessibilityLabel="Previous photo" disabled={position === 0} onPress={() => onIndex(slots[position - 1].slot)} style={({pressed}) => [s.zoomButton, position === 0 && s.disabled, pressed && shared.pressed]}><Ionicons name="chevron-back" size={22} color="#FFF"/></TapChoice>
          <View style={s.dots}>{slots.map(item => <View key={item.slot} style={[s.dot, item.slot === index && s.activeDot]}/>)}</View>
          <TapChoice accessibilityRole="button" accessibilityLabel="Next photo" disabled={position === slots.length - 1} onPress={() => onIndex(slots[position + 1].slot)} style={({pressed}) => [s.zoomButton, position === slots.length - 1 && s.disabled, pressed && shared.pressed]}><Ionicons name="chevron-forward" size={22} color="#FFF"/></TapChoice>
        </View>}
      </SafeAreaView>
    </GestureHandlerRootView>
  </Modal>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#211C23'},
  header: {paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12},
  heading: {flex: 1, gap: 3},
  title: {fontFamily: 'DMSans_500Medium', fontSize: 19, lineHeight: 27, color: '#FFF'},
  hint: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: '#D8C8D2'},
  photoArea: {flex: 1, minHeight: 0},
  viewport: {flex: 1, minHeight: 0, overflow: 'hidden'},
  gestureArea: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  loading: {...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', gap: 12},
  zoomBar: {flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12},
  zoomButton: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#42313E', alignItems: 'center', justifyContent: 'center'},
  reset: {minHeight: 44, paddingHorizontal: 12, borderRadius: 22, backgroundColor: '#42313E', justifyContent: 'center'},
  resetText: {fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#FFF'},
  photoNavigation: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, gap: 16},
  dots: {flexDirection: 'row', gap: 6, alignItems: 'center'},
  dot: {width: 6, height: 6, borderRadius: 3, backgroundColor: '#6D5969'},
  activeDot: {width: 18, backgroundColor: '#E8A8C1'},
  disabled: {opacity: 0.3},
});
