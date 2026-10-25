import React, { useLayoutEffect } from 'react';
import { StyleSheet } from 'react-native';
import {
  BlendMode, BlurMask, BlurStyle, Canvas, Group, Paint, PaintStyle, Path, Path1DEffectStyle, Path1DPathEffect, Picture, Skia,
  StrokeCap, StrokeJoin, type SkCanvas, type SkPath, type SkPicture,
} from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';
import type { BrushId, DrawingStroke } from '../composition/types';

/** Brushes in Instagram's order, with the width each starts at (canvas units). */
export const BRUSHES: Array<{ id: Exclude<BrushId, 'fill'>; name: string; width: number }> = [
  { id: 'pen', name: 'Pen', width: 14 },
  { id: 'arrow', name: 'Arrow', width: 14 },
  { id: 'marker', name: 'Marker', width: 34 },
  { id: 'neon', name: 'Neon', width: 16 },
  { id: 'highlighter', name: 'Highlighter', width: 40 },
  { id: 'eraser', name: 'Eraser', width: 50 },
];

export type LiveStroke = { brush: BrushId; color: string; width: number };

// One look per brush, shared by the live stroke and the saved drawing.
const MARKER_OPACITY = 0.92;
const HIGHLIGHTER_OPACITY = 0.45;
const NEON_GLOW_WIDTH = 1.6;
const NEON_BLUR = 0.9;
const NEON_CORE_WIDTH = 0.45;

/**
 * A stroke's path through its points, smoothed through the midpoints between
 * them. The draw tool builds the live path with exactly the same steps, so a
 * stroke does not change shape when the finger lifts.
 */
export function strokePath(points: number[], unit: number): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  if (points.length < 2) return path;
  const count = points.length / 2;
  path.moveTo(points[0] * unit, points[1] * unit);
  path.lineTo(points[0] * unit + 0.1, points[1] * unit + 0.1);
  for (let index = 1; index < count; index += 1) {
    const px = points[(index - 1) * 2] * unit;
    const py = points[(index - 1) * 2 + 1] * unit;
    const x = points[index * 2] * unit;
    const y = points[index * 2 + 1] * unit;
    path.quadTo(px, py, (px + x) / 2, (py + y) / 2);
  }
  return path;
}

function arrowHead(points: number[], width: number, unit: number): SkPath | null {
  'worklet';
  if (points.length < 4) return null;
  const endX = points[points.length - 2];
  const endY = points[points.length - 1];
  // Direction from a point a little way back, so a wobble at the end does not skew the head.
  let back = points.length - 4;
  while (back > 0 && Math.hypot(endX - points[back], endY - points[back + 1]) < width * 2) back -= 2;
  const angle = Math.atan2(endY - points[back + 1], endX - points[back]);
  const length = Math.max(40, width * 3.2);
  const head = Skia.Path.Make();
  head.moveTo((endX - length * Math.cos(angle - 0.5)) * unit, (endY - length * Math.sin(angle - 0.5)) * unit);
  head.lineTo(endX * unit, endY * unit);
  head.lineTo((endX - length * Math.cos(angle + 0.5)) * unit, (endY - length * Math.sin(angle + 0.5)) * unit);
  return head;
}

/**
 * The marker's chisel nib: a thin slanted bar stamped along the stroke at a
 * fixed angle, so the line is broad one way and narrow the other, like a felt marker.
 */
function markerNib(widthPx: number) {
  'worklet';
  const length = Math.max(4, widthPx);
  const thickness = Math.max(1.5, widthPx * 0.2);
  const nib = Skia.Path.Make();
  nib.addRect(Skia.XYWHRect(-length / 2, -thickness / 2, length, thickness));
  nib.transform(Skia.Matrix().rotate(-Math.PI / 4));
  return { nib, advance: Math.max(1, thickness * 0.5) };
}

function strokePaint(color: string, width: number, cap: StrokeCap) {
  'worklet';
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(width);
  paint.setStrokeCap(cap);
  paint.setStrokeJoin(StrokeJoin.Round);
  paint.setColor(Skia.Color(color));
  return paint;
}

function layerPaint(opacity: number) {
  'worklet';
  const paint = Skia.Paint();
  paint.setAlphaf(opacity);
  return paint;
}

/** Draws one saved stroke. Runs on the UI thread when a stroke ends, and on JavaScript to rebuild. */
export function drawStroke(canvas: SkCanvas, stroke: DrawingStroke, unit: number, width: number, height: number) {
  'worklet';
  if (stroke.brush === 'fill') {
    const paint = Skia.Paint();
    paint.setColor(Skia.Color(stroke.color));
    canvas.drawRect(Skia.XYWHRect(0, 0, width, height), paint);
    return;
  }
  const path = strokePath(stroke.points, unit);
  const size = stroke.width * unit;
  if (stroke.brush === 'eraser') {
    const paint = strokePaint('#000000', size, StrokeCap.Round);
    paint.setBlendMode(BlendMode.Clear);
    canvas.drawPath(path, paint);
  } else if (stroke.brush === 'marker') {
    const { nib, advance } = markerNib(size);
    canvas.saveLayer(layerPaint(MARKER_OPACITY));
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setStyle(PaintStyle.Fill);
    paint.setColor(Skia.Color(stroke.color));
    const effect = Skia.PathEffect.MakePath1D(nib, advance, 0, Path1DEffectStyle.Translate);
    if (effect) paint.setPathEffect(effect);
    canvas.drawPath(path, paint);
    canvas.restore();
  } else if (stroke.brush === 'highlighter') {
    canvas.saveLayer(layerPaint(HIGHLIGHTER_OPACITY));
    canvas.drawPath(path, strokePaint(stroke.color, size, StrokeCap.Square));
    canvas.restore();
  } else if (stroke.brush === 'neon') {
    const glow = strokePaint(stroke.color, size * NEON_GLOW_WIDTH, StrokeCap.Round);
    glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Solid, size * NEON_BLUR, true));
    canvas.drawPath(path, glow);
    canvas.drawPath(path, strokePaint('#FFFFFF', size * NEON_CORE_WIDTH, StrokeCap.Round));
  } else {
    const paint = strokePaint(stroke.color, size, StrokeCap.Round);
    canvas.drawPath(path, paint);
    if (stroke.brush === 'arrow') {
      const head = arrowHead(stroke.points, stroke.width, unit);
      if (head) canvas.drawPath(head, paint);
    }
  }
}

/** A picture of strokes, optionally on top of an earlier picture. */
export function recordStrokes(strokes: DrawingStroke[], unit: number, width: number, height: number, previous?: SkPicture | null): SkPicture {
  'worklet';
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, height));
  if (previous) canvas.drawPicture(previous);
  for (const stroke of strokes) drawStroke(canvas, stroke, unit, width, height);
  return recorder.finishRecordingAsPicture();
}

export const emptyPicture = () => recordStrokes([], 1, 1, 1);

/** The live stroke, drawn declaratively with the same look as `drawStroke`. */
function LiveBrush({ path, brush, color, width }: { path: SharedValue<SkPath>; brush: BrushId; color: string; width: number }) {
  switch (brush) {
    case 'eraser':
      return <Path path={path} style="stroke" strokeWidth={width} strokeCap="round" strokeJoin="round" color="#000" blendMode="clear" />;
    case 'marker': {
      const { nib, advance } = markerNib(width);
      return (
        <Group layer={<Paint opacity={MARKER_OPACITY} />}>
          <Path path={path} style="fill" color={color}>
            <Path1DPathEffect path={nib} advance={advance} phase={0} style="translate" />
          </Path>
        </Group>
      );
    }
    case 'highlighter':
      return (
        <Group layer={<Paint opacity={HIGHLIGHTER_OPACITY} />}>
          <Path path={path} style="stroke" strokeWidth={width} strokeCap="square" strokeJoin="round" color={color} />
        </Group>
      );
    case 'neon':
      return (
        <Group>
          <Path path={path} style="stroke" strokeWidth={width * NEON_GLOW_WIDTH} strokeCap="round" strokeJoin="round" color={color}>
            <BlurMask blur={width * NEON_BLUR} style="solid" />
          </Path>
          <Path path={path} style="stroke" strokeWidth={width * NEON_CORE_WIDTH} strokeCap="round" strokeJoin="round" color="#FFFFFF" />
        </Group>
      );
    default:
      return <Path path={path} style="stroke" strokeWidth={width} strokeCap="round" strokeJoin="round" color={color} />;
  }
}

/**
 * The story's drawing: a picture of the saved strokes, and the stroke being
 * drawn, in one layer. The eraser therefore clears while the finger moves, and
 * when a stroke ends the draw tool adds it to the picture and clears the live
 * stroke in the same UI frame, so nothing blinks or briefly reappears.
 */
export function DrawingCanvas({ strokes, unit, width, height, committed, live, liveStroke }: {
  strokes: DrawingStroke[];
  unit: number;
  width: number;
  height: number;
  /** The saved strokes as one picture. */
  committed: SharedValue<SkPicture>;
  /** The stroke being drawn, rebuilt on the UI thread as the finger moves. */
  live?: SharedValue<SkPath>;
  liveStroke?: LiveStroke | null;
}) {
  // The story's strokes are the source of truth: undo, switching stories and
  // opening a draft rebuild the picture. After a stroke it already matches.
  useLayoutEffect(() => {
    committed.value = recordStrokes(strokes, unit, width, height);
  }, [committed, height, strokes, unit, width]);

  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Group layer>
        <Picture picture={committed} />
        {live && liveStroke ? (
          <LiveBrush path={live} brush={liveStroke.brush === 'arrow' ? 'pen' : liveStroke.brush} color={liveStroke.color} width={liveStroke.width * unit} />
        ) : null}
      </Group>
    </Canvas>
  );
}
