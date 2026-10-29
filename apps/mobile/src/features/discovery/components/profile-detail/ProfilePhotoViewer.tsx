import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Modal, Pressable, StatusBar, StyleSheet, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming} from 'react-native-reanimated';
import {Ionicons} from '@expo/vector-icons';
import {ZoomablePhoto, type PhotoZoomState} from '../../../auth/onboarding/ProfilePhotoPreview';
import {previewPhotoSize} from '../../../auth/onboarding/photoPreviewCache';
import {fitLightboxPhoto, lightboxTransform, type PhotoLightboxFrame} from './photoLightboxGeometry';

/** The selected photo expands from its card and returns there when closed. */
export function ProfilePhotoViewer({uri, origin, name, onClose}: {uri: string; origin: PhotoLightboxFrame; name: string; onClose: () => void}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [viewport, setViewport] = useState({width: window.width, height: window.height});
  const [laidOut, setLaidOut] = useState(false);
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  const closing = useRef(false);
  const zoomState = useRef<PhotoZoomState | null>(null);
  const reducedMotion = useReducedMotion();
  const cached = previewPhotoSize(uri);
  const target = fitLightboxPhoto(cached ?? origin, viewport.width, viewport.height, insets.top, insets.bottom);
  const canFly = !!cached && !reducedMotion;
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  const flying = useSharedValue(1);
  const destination = useSharedValue(target);
  const captureZoom = useCallback((state: PhotoZoomState) => {zoomState.current = state;}, []);

  useEffect(() => {
    destination.value = target;
  }, [target.x, target.y, target.width, target.height, destination]);
  useEffect(() => {
    if (!shown || !laidOut || started.current) return;
    started.current = true;
    progress.value = withTiming(1, {duration: reducedMotion ? 0 : canFly ? 320 : 180, easing: Easing.bezier(0.2, 0.8, 0.2, 1)}, finished => {
      if (finished) {flying.value = 0; runOnJS(setReady)(true);}
    });
  }, [shown, laidOut, reducedMotion, canFly, progress, flying]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (reducedMotion) {onClose(); return;}
    if (ready && canFly) {
      // Start the return at the current zoom and pan, without a jump to 1x.
      const zoom = zoomState.current;
      const scale = zoom?.scale.value ?? 1;
      destination.value = {
        x: target.x + (zoom?.x.value ?? 0) - target.width * (scale - 1) / 2,
        y: target.y + (zoom?.y.value ?? 0) - target.height * (scale - 1) / 2,
        width: target.width * scale,
        height: target.height * scale,
      };
    }
    flying.value = 1;
    setReady(false);
    progress.value = withTiming(0, {duration: canFly ? 260 : 180, easing: Easing.bezier(0.3, 0, 0.2, 1)}, finished => {
      if (finished) runOnJS(onClose)();
    });
  };
  const backdrop = useAnimatedStyle(() => ({opacity: progress.value}));
  const livePhoto = useAnimatedStyle(() => ({opacity: canFly ? 1 - flying.value : progress.value}));
  const frameStyle = useAnimatedStyle(() => {
    const frame = lightboxTransform(origin, destination.value, target, progress.value);
    return {opacity: flying.value, borderRadius: frame.radius, transform: [
      {translateX: frame.translateX}, {translateY: frame.translateY}, {scaleX: frame.scaleX}, {scaleY: frame.scaleY},
    ]};
  });
  const imageStyle = useAnimatedStyle(() => {
    const frame = lightboxTransform(origin, destination.value, target, progress.value);
    return {transform: [{scaleX: frame.imageScaleX}, {scaleY: frame.imageScaleY}]};
  });

  return <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent hardwareAccelerated onShow={() => setShown(true)} onRequestClose={close}>
    <GestureHandlerRootView style={styles.page} onLayout={event => {
      const {width, height} = event.nativeEvent.layout;
      setViewport(current => current.width === width && current.height === height ? current : {width, height});
      setLaidOut(true);
    }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent"/>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]}/>
      <Animated.View pointerEvents={ready ? 'auto' : 'none'} style={[styles.photo, {paddingTop: insets.top, paddingBottom: insets.bottom}, livePhoto]} accessibilityViewIsModal>
        <ZoomablePhoto key={uri} uri={uri} controls={false} label={`${name}'s profile photo`} onZoomState={captureZoom}/>
      </Animated.View>
      {canFly && <Animated.View pointerEvents="none" style={[styles.flyingFrame, {left: target.x, top: target.y, width: target.width, height: target.height}, frameStyle]}>
        <Animated.Image source={{uri}} fadeDuration={0} resizeMode="cover" style={[StyleSheet.absoluteFill, imageStyle]} accessible={false}/>
      </Animated.View>}
      <Animated.View style={[styles.closePosition, {top: insets.top + 8}, backdrop]}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close photo" hitSlop={4} style={({pressed}) => [styles.close, pressed && styles.pressed]}>
          <Ionicons name="close" size={25} color="#FFFFFF"/>
        </Pressable>
      </Animated.View>
    </GestureHandlerRootView>
  </Modal>;
}

const styles = StyleSheet.create({
  page: {flex: 1, overflow: 'hidden'},
  backdrop: {backgroundColor: '#0C0B0B'},
  photo: {flex: 1},
  flyingFrame: {position: 'absolute', overflow: 'hidden', zIndex: 2},
  closePosition: {position: 'absolute', right: 16, zIndex: 3},
  close: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)'},
  pressed: {opacity: 0.7},
});
