import React, { useEffect, useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import type { PhotoEdit } from './attachmentTypes';
import { containPhoto, normalRotation } from '../photoEditing';

export function PhotoEditPreview({ uri, edit, width, height, naturalSize, viewportHeight }: { uri: string; edit?: PhotoEdit; width: number; height: number; naturalSize?: { width: number; height: number }; viewportHeight?: SharedValue<number> }) {
  const [size, setSize] = useState({ width: 1, height: 1 });
  const rotation = useSharedValue(edit?.rotation ?? 0);
  const flip = useSharedValue(edit?.flipped ? -1 : 1);
  useEffect(() => {
    if (naturalSize) return;
    let active = true;
    Image.getSize(uri, (w, h) => { if (active) setSize({ width: w, height: h }); }, () => undefined);
    return () => { active = false; };
  }, [uri, naturalSize]);
  useEffect(() => {
    const target = edit?.rotation ?? 0;
    const delta = normalRotation(target - rotation.value + 180) - 180;
    rotation.value = withTiming(rotation.value + delta, { duration: 170 });
    flip.value = withTiming(edit?.flipped ? -1 : 1, { duration: 150 });
  }, [edit?.rotation, edit?.flipped, flip, rotation]);
  const sourceSize = naturalSize ?? size;
  const fit = containPhoto(sourceSize.width, sourceSize.height, width, height, edit);
  const frame = useAnimatedStyle(() => ({ height: viewportHeight?.value ?? height }));
  const transform = useAnimatedStyle(() => {
    const availableHeight = viewportHeight?.value ?? height;
    const scale = viewportHeight ? Math.min(width / Math.max(1, fit.displayWidth), availableHeight / Math.max(1, fit.displayHeight)) : 1;
    return { top: (availableHeight - fit.height) / 2, transform: [{ scale }, { scaleX: flip.value }, { rotateZ: `${rotation.value}deg` }] };
  });
  return <Animated.View pointerEvents="none" style={[{ width, overflow: 'hidden' }, frame]}>
    <Animated.Image source={{ uri }} resizeMode="contain" fadeDuration={0} style={[styles.image, { width: fit.width, height: fit.height, left: (width - fit.width) / 2 }, transform]} />
  </Animated.View>;
}
const styles = StyleSheet.create({ image: { position: 'absolute' } });
