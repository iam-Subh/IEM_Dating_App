import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { Skia, notifyChange, type SkPath, type SkPicture } from '@shopify/react-native-skia';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { BrushId, DrawingStroke } from '../composition/types';
import { CANVAS } from '../composition/types';
import { BRUSHES, recordStrokes, type LiveStroke } from './DrawingCanvas';
import { ColorPicker } from './ColorPicker';
import { useStoryBack } from '../backStack';
import { DrawToolIcon } from './DrawToolIcon';
import { DRAW_DOCK_HEIGHT, DRAW_HEADER_HEIGHT } from './drawToolLayout';
import { drawingPoint } from './editorStageLayout';

type Props = {
  /** Display points per canvas unit, used to read touches. */
  unit: number;
  /** Fixed render points per canvas unit, shared with every story element. */
  renderUnit: number;
  width: number;
  height: number;
  /** Where the stage sits on screen. */
  stageTop: number;
  stageLeft: number;
  canUndo: boolean;
  /** The live stroke's path, drawn by the stage's drawing canvas. */
  live: SharedValue<SkPath>;
  /** The saved strokes' picture, drawn by the stage's drawing canvas. */
  committed: SharedValue<SkPicture>;
  onLiveStyle: (style: LiveStroke | null) => void;
  onStroke: (stroke: DrawingStroke) => void;
  onUndo: () => void;
  onDone: () => void;
  /** Pick the brush colour from the story itself. */
  onEyedropper?: (apply: (colour: string) => void) => void;
};

/**
 * Pick a brush, colour and size below the story. Press and hold on the story to
 * fill it with the colour; the eraser then reveals the photo through the fill.
 *
 * Everything about a stroke happens on the UI thread: it starts at the first
 * touch, and when the finger lifts it is added to the drawing's picture and
 * the live stroke is cleared in the same frame. The story is told afterwards.
 */
export function DrawTool({ unit, renderUnit, width, height, stageTop, stageLeft, canUndo, live, committed, onLiveStyle, onStroke, onUndo, onDone, onEyedropper }: Props) {
  const insets = useSafeAreaInsets();
  const [brush, setBrush] = useState<BrushId>('pen');
  const [color, setColor] = useState('#FFFFFF');
  const [sizes, setSizes] = useState<Record<string, number>>(() => Object.fromEntries(BRUSHES.map((entry) => [entry.id, entry.width])));
  const [sizing, setSizing] = useState(false);
  const size = sizes[brush] ?? 14;
  const broadBrush = brush === 'eraser' || brush === 'highlighter' || brush === 'marker';
  const minSize = broadBrush ? 20 : 6;
  const maxSize = broadBrush ? 120 : 70;
  const brushValue = useSharedValue<BrushId>(brush);
  const colorValue = useSharedValue(color);
  const sizeValue = useSharedValue(size);
  const points = useSharedValue<number[]>([]);
  const lastX = useSharedValue(0);
  const lastY = useSharedValue(0);
  const filled = useSharedValue(false);

  const latest = useRef(onStroke);
  latest.current = onStroke;
  const saveStroke = useCallback((stroke: DrawingStroke) => latest.current(stroke), []);
  const buzz = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  }, []);

  useStoryBack(() => {
    onDone();
    return true;
  });

  useEffect(() => {
    brushValue.value = brush;
    colorValue.value = color;
    sizeValue.value = size;
    onLiveStyle({ brush, color, width: size });
  }, [brush, brushValue, color, colorValue, onLiveStyle, size, sizeValue]);
  useEffect(() => () => onLiveStyle(null), [onLiveStyle]);

  const gesture = useMemo(() => {
    const draw = Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .onBegin((event) => {
        filled.value = false;
        const point = drawingPoint(event.x, event.y, unit, renderUnit);
        const path = Skia.Path.Make();
        path.moveTo(point.renderX, point.renderY);
        path.lineTo(point.renderX + 0.1, point.renderY + 0.1);
        live.value = path;
        lastX.value = point.renderX;
        lastY.value = point.renderY;
        points.value = [point.canvasX, point.canvasY];
      })
      .onUpdate((event) => {
        if (filled.value) return;
        const point = drawingPoint(event.x, event.y, unit, renderUnit);
        // Same smoothing as the saved stroke: a curve to the midpoint of each step.
        live.value.quadTo(lastX.value, lastY.value, (lastX.value + point.renderX) / 2, (lastY.value + point.renderY) / 2);
        notifyChange(live);
        lastX.value = point.renderX;
        lastY.value = point.renderY;
        points.modify((list) => {
          'worklet';
          list.push(point.canvasX, point.canvasY);
          return list;
        });
      })
      .onFinalize(() => {
        if (filled.value || points.value.length < 2) return;
        const stroke: DrawingStroke = {
          brush: brushValue.value,
          color: colorValue.value,
          width: sizeValue.value,
          points: points.value.map((value) => Math.round(value * 10) / 10),
        };
        // Added to the picture and the live stroke cleared in one UI frame.
        committed.value = recordStrokes([stroke], renderUnit, CANVAS.width * renderUnit, CANVAS.height * renderUnit, committed.value);
        live.value = Skia.Path.Make();
        points.value = [];
        runOnJS(saveStroke)(stroke);
      });
    const hold = Gesture.LongPress().minDuration(650).maxDistance(8).onStart(() => {
      filled.value = true;
      const stroke: DrawingStroke = { brush: 'fill', color: colorValue.value, width: 0, points: [] };
      committed.value = recordStrokes([stroke], renderUnit, CANVAS.width * renderUnit, CANVAS.height * renderUnit, committed.value);
      live.value = Skia.Path.Make();
      points.value = [];
      runOnJS(buzz)();
      runOnJS(saveStroke)(stroke);
    });
    return Gesture.Simultaneous(draw, hold);
  }, [brushValue, buzz, colorValue, committed, filled, lastX, lastY, live, points, saveStroke, sizeValue, unit, renderUnit]);

  const previewSize = Math.max(4, size * unit * (brush === 'neon' ? 1.6 : 1));

  return (
    <View style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={gesture}>
        <View style={{ position: 'absolute', top: stageTop, left: stageLeft, width, height }} collapsable={false} />
      </GestureDetector>

      {sizing ? (
        <View pointerEvents="none" style={[styles.previewWrap, { top: stageTop, left: stageLeft, width, height }]}>
          <View
            style={[
              styles.preview,
              { width: previewSize, height: previewSize, borderRadius: brush === 'highlighter' ? 3 : previewSize / 2 },
              brush === 'eraser'
                ? { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#fff' }
                : { backgroundColor: color, opacity: brush === 'highlighter' ? 0.45 : 1 },
            ]}
          />
        </View>
      ) : null}

      <View style={[styles.top, { top: insets.top, height: DRAW_HEADER_HEIGHT }]}>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Undo last stroke" disabled={!canUndo} onPress={onUndo} style={({ pressed }) => [styles.topButton, pressed && styles.pressed]}>
            <DrawToolIcon name="undo" color={canUndo ? '#fff' : 'rgba(255,255,255,0.35)'} />
          </Pressable>
          <Text accessibilityLiveRegion="polite" style={styles.toolLabel}>{BRUSHES.find(entry => entry.id === brush)?.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Finish drawing" onPress={onDone} style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.bottom, { bottom: insets.bottom, height: DRAW_DOCK_HEIGHT }]}>
        <View style={styles.brushes}>
          {BRUSHES.map((entry) => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={entry.name}
              accessibilityState={{ selected: brush === entry.id }}
              onPress={() => setBrush(entry.id)}
              style={({ pressed }) => [styles.brush, brush === entry.id && styles.brushActive, pressed && styles.pressed]}
            >
              <DrawToolIcon name={entry.id} color={brush === entry.id ? '#332027' : '#fff'} />
            </Pressable>
          ))}
        </View>
        <View style={styles.sizeRow}>
          <Text style={styles.sizeLabel}>Size</Text>
          <Slider key={brush} accessibilityLabel="Brush size" accessibilityValue={{ min: minSize, max: maxSize, now: size }}
            style={styles.sizeSlider} value={size} minimumValue={minSize} maximumValue={maxSize} step={1}
            minimumTrackTintColor="#F3C1CA" maximumTrackTintColor="#4A4447" thumbTintColor="#F3C1CA"
            onSlidingStart={() => setSizing(true)}
            onValueChange={value => setSizes(current => current[brush] === value ? current : { ...current, [brush]: value })}
            onSlidingComplete={value => { setSizes(current => ({ ...current, [brush]: value })); setSizing(false); }} />
          <Text style={styles.sizeValue}>{Math.round(size)}</Text>
        </View>
        {brush !== 'eraser'
          ? <ColorPicker value={color} onChange={setColor} onEyedropper={onEyedropper ? () => onEyedropper(setColor) : undefined} />
          : <Text style={styles.eraserHint}>Draw over a stroke to erase it.</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#161616', zIndex: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  topButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  toolLabel: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '600', color: '#FFF4F6' },
  brushes: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', gap: 2, paddingHorizontal: 12 },
  brush: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  brushActive: { backgroundColor: '#F3C1CA' },
  done: { minHeight: 44, minWidth: 64, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  doneText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.65 },
  sizeRow: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 8 },
  sizeLabel: { fontSize: 12, fontWeight: '600', color: '#D8D0D3' },
  sizeSlider: { flex: 1, height: 44 },
  sizeValue: { width: 30, textAlign: 'right', fontSize: 12, fontVariant: ['tabular-nums'], color: '#F3C1CA' },
  previewWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center', zIndex: 15 },
  preview: { borderWidth: 1, borderColor: 'rgba(0,0,0,0.25)' },
  bottom: { position: 'absolute', left: 0, right: 0, paddingTop: 8, paddingBottom: 6, gap: 6, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: '#1B1B1B', zIndex: 10 },
  eraserHint: { height: 48, textAlign: 'center', textAlignVertical: 'center', fontSize: 12, color: '#D8D0D3', paddingTop: 14 },
});
