import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { AlphaType, ColorType, makeImageFromView, type SkImage } from '@shopify/react-native-skia';
import { useStoryBack } from '../backStack';

type Props = {
  stageRef: React.RefObject<View | null>;
  left: number;
  top: number;
  width: number;
  height: number;
  onPick: (colour: string) => void;
  onCancel: () => void;
};

const LOUPE = 60;

/**
 * Instagram's eyedropper: drag over the story and a bubble above the finger
 * shows the colour under it; lifting the finger picks it. Colours come from a
 * snapshot of the stage taken when the eyedropper opens.
 */
export function Eyedropper({ stageRef, left, top, width, height, onPick, onCancel }: Props) {
  const snapshot = useRef<SkImage | null>(null);
  const picked = useRef<string | null>(null);
  const [colour, setColour] = useState<string | null>(null);
  const [point, setPoint] = useState({ x: width / 2, y: height / 2 });

  useStoryBack(() => {
    onCancel();
    return true;
  });

  const sample = useCallback((x: number, y: number) => {
    const image = snapshot.current;
    if (!image) return;
    const px = Math.max(0, Math.min(image.width() - 1, Math.round((x / width) * image.width())));
    const py = Math.max(0, Math.min(image.height() - 1, Math.round((y / height) * image.height())));
    const pixels = image.readPixels(px, py, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    if (!pixels || pixels.length < 3) return;
    const hex = `#${[pixels[0], pixels[1], pixels[2]].map((value) => Math.round(Number(value)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    picked.current = hex;
    setColour(hex);
  }, [height, width]);

  useEffect(() => {
    let active = true;
    makeImageFromView(stageRef as React.RefObject<any>)
      .then((image) => {
        if (!active) return;
        if (!image) {
          onCancel();
          return;
        }
        snapshot.current = image;
        sample(width / 2, height / 2);
      })
      .catch(() => onCancel());
    return () => { active = false; };
    // Once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = useCallback((x: number, y: number) => {
    const cx = Math.max(0, Math.min(width, x));
    const cy = Math.max(0, Math.min(height, y));
    setPoint({ x: cx, y: cy });
    sample(cx, cy);
  }, [height, sample, width]);

  const finish = useCallback(() => {
    if (picked.current) onPick(picked.current);
    else onCancel();
  }, [onCancel, onPick]);

  const gesture = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => { runOnJS(move)(event.x, event.y); })
    .onUpdate((event) => { runOnJS(move)(event.x, event.y); })
    .onEnd(() => { runOnJS(finish)(); }), [finish, move]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={gesture}>
        <View collapsable={false} style={{ position: 'absolute', left, top, width, height }}>
          <View pointerEvents="none" style={[styles.loupe, { left: point.x - LOUPE / 2, top: point.y - LOUPE - 34, backgroundColor: colour ?? 'transparent' }]} />
          <View pointerEvents="none" style={[styles.dot, { left: point.x - 6, top: point.y - 6 }]} />
        </View>
      </GestureDetector>
      <View pointerEvents="none" style={[styles.hint, { top: top + 16 }]}>
        <Text style={styles.hintText}>Drag to pick a colour</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loupe: { position: 'absolute', width: LOUPE, height: LOUPE, borderRadius: LOUPE / 2, borderWidth: 4, borderColor: '#fff', elevation: 6 },
  dot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.3)' },
  hint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hintText: { color: '#fff', fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, overflow: 'hidden' },
});
