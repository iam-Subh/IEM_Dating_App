import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { NativeNitroImage, type Image as NitroPicture } from 'react-native-nitro-image';
import { useLiveBlur } from './liveBlur';

/** A cell of the layout grid, in preview pixels. */
export type CellRect = { left: number; top: number; width: number; height: number };

export type CellCorners = Pick<ViewStyle, 'borderTopLeftRadius' | 'borderTopRightRadius' | 'borderBottomLeftRadius' | 'borderBottomRightRadius'>;

/**
 * A photo in the layout. Like the live camera in its cell, it fills whichever
 * cell holds it with the whole picture (cropped only to the cell's shape), so
 * it looks the same in every cell and in the finished layout.
 */
export type LayoutPhoto = {
  id: string;
  /** The photo's file, once it has been taken. */
  preview: string | null;
  /** A still of the live camera shown the moment the shutter is pressed, until the photo is ready. */
  placeholder: NitroPicture | null;
  /** The upright copy the finished layout is drawn from. */
  file: Promise<string>;
};

/** How small a photo gets while it is held. */
const LIFT_SCALE = 0.65;
/** Corner rounding of a held photo. */
const LIFT_RADIUS = 16;
/** How long a photo is held before it lifts. */
const HOLD_MS = 200;
// Every move uses one quick, decelerating curve with no overshoot: photos
// making room, a photo landing in its cell, and a photo being picked up.
const MOVE = { duration: 220, easing: Easing.bezier(0.2, 0, 0, 1) };
const PICK_UP = { duration: 150, easing: Easing.bezier(0.2, 0, 0, 1) };

/** What happened when the finger let go of the lifted photo. */
const HOLDING = 0;
const BACK_TO_CELL = 1;
const SWAPPING = 2;

type TileProps = {
  photo: LayoutPhoto;
  /** The cell the tile rests in now (another cell while it makes room for a dragged photo). */
  rect: CellRect;
  corners: CellCorners;
  raised: boolean;
  liftId: SharedValue<string>;
  lift: SharedValue<number>;
  released: SharedValue<number>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
};

/** One photo: it glides to a new cell, and shrinks under the finger while held. */
function PhotoTile({ photo, rect, corners, raised, liftId, lift, released, dragX, dragY }: TileProps) {
  // Only the id goes into the animation: the photo also holds a Promise, which
  // cannot be copied to the UI thread.
  const photoId = photo.id;
  const restX = rect.left + rect.width / 2;
  const restY = rect.top + rect.height / 2;
  const centerX = useSharedValue(restX);
  const centerY = useSharedValue(restY);

  // A new resting cell: glide there from wherever the tile is now. For a
  // dropped photo that is the finger, so it goes straight to its new cell.
  useEffect(() => {
    centerX.value = withTiming(restX, MOVE);
    centerY.value = withTiming(restY, MOVE);
  }, [centerX, centerY, restX, restY]);

  // On release, the lifted photo stays where the finger left it and moves on
  // from there: back to its own cell, or into the cell it was dropped on once
  // the swap arrives. It never drifts back toward the cell it came from first.
  useAnimatedReaction(
    () => (liftId.value === photoId ? released.value : -1),
    (state, previous) => {
      if (previous !== HOLDING || (state !== BACK_TO_CELL && state !== SWAPPING)) return;
      const held = lift.value;
      centerX.value = centerX.value + (dragX.value - centerX.value) * held;
      centerY.value = centerY.value + (dragY.value - centerY.value) * held;
      if (state === BACK_TO_CELL) {
        centerX.value = withTiming(restX, MOVE);
        centerY.value = withTiming(restY, MOVE);
      }
    },
    [photoId, restX, restY],
  );

  const topLeft = Number(corners.borderTopLeftRadius ?? 0);
  const topRight = Number(corners.borderTopRightRadius ?? 0);
  const bottomLeft = Number(corners.borderBottomLeftRadius ?? 0);
  const bottomRight = Number(corners.borderBottomRightRadius ?? 0);

  const style = useAnimatedStyle(() => {
    const lifted = liftId.value === photoId ? lift.value : 0;
    // While held the photo follows the finger; after release it moves on its own.
    const following = liftId.value === photoId && released.value === HOLDING ? lifted : 0;
    const x = centerX.value + (dragX.value - centerX.value) * following;
    const y = centerY.value + (dragY.value - centerY.value) * following;
    // Corners round as it lifts and square back up as it lands, together with the size.
    const round = LIFT_RADIUS * lifted;
    return {
      transform: [
        { translateX: x - rect.width / 2 },
        { translateY: y - rect.height / 2 },
        { scale: 1 - (1 - LIFT_SCALE) * lifted },
      ],
      borderTopLeftRadius: Math.max(topLeft, round),
      borderTopRightRadius: Math.max(topRight, round),
      borderBottomLeftRadius: Math.max(bottomLeft, round),
      borderBottomRightRadius: Math.max(bottomRight, round),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.tile, { width: rect.width, height: rect.height }, corners, raised && styles.raised, style]}
    >
      {/* The camera still sits underneath; the photo covers it once it has loaded. */}
      {photo.placeholder ? <NativeNitroImage image={photo.placeholder} resizeMode="cover" style={StyleSheet.absoluteFill} /> : null}
      {photo.preview ? (
        <Image
          source={{ uri: photo.preview }}
          resizeMode="cover"
          // Decoded at a smaller size than the full photo, so it shows sooner.
          resizeMethod="resize"
          fadeDuration={0}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </Animated.View>
  );
}

/** The fallback blur on devices that cannot run a second camera preview: a small copy of the camera picture, refreshed often. */
function SnapshotBlur() {
  const image = useLiveBlur();
  if (!image) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.blur]}>
      <NativeNitroImage image={image} resizeMode="cover" style={StyleSheet.absoluteFill} />
    </View>
  );
}

type Props = {
  rects: CellRect[];
  corners: CellCorners[];
  /** Photos by cell, filled from the first cell. */
  photos: LayoutPhoto[];
  /** The cell the live camera shows in: the next one to fill, or a photo being retaken. */
  liveIndex: number | null;
  selectedIndex: number | null;
  /**
   * A blurred live camera preview is drawn under the grid, so the waiting
   * cells only need to let it show through. Otherwise they draw the snapshot blur.
   */
  livePreviewBehind: boolean;
  onSelect: (index: number) => void;
  /** Moves the photo at `from` to `to`; the photos between shift one place along. */
  onMove: (from: number, to: number) => void;
};

/**
 * Instagram's Layout grid on the camera. Hold a photo: it shrinks under the
 * finger. Drag it over another cell and the photos in between slide along to
 * make room; let go and it settles into that cell. Tap a photo to retake it.
 * Cells still waiting for a photo show the camera blurred.
 */
export function LayoutBoard({ rects, corners, photos, liveIndex, selectedIndex, livePreviewBehind, onSelect, onMove }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [hoverOver, setHoverOver] = useState<number | null>(null);
  // The tile kept on top from the moment it is picked up until it has landed.
  const [raisedId, setRaisedId] = useState<string | null>(null);
  const from = useSharedValue(-1);
  const hover = useSharedValue(-1);
  const liftId = useSharedValue('');
  const lift = useSharedValue(0);
  const released = useSharedValue(HOLDING);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const count = photos.length;
  const ids = useMemo(() => photos.map((photo) => photo.id), [photos]);

  const startDrag = useCallback((index: number, id: string) => {
    setDragFrom(index);
    setRaisedId(id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, []);
  const drop = useCallback((source: number, target: number) => {
    setHoverOver(null);
    setDragFrom(null);
    if (target >= 0 && target < count && target !== source) onMove(source, target);
  }, [count, onMove]);
  const landed = useCallback(() => setRaisedId(null), []);

  const gesture = useMemo(() => {
    const cellAt = (x: number, y: number) => {
      'worklet';
      for (let index = 0; index < rects.length; index += 1) {
        const cell = rects[index];
        if (x >= cell.left && x < cell.left + cell.width && y >= cell.top && y < cell.top + cell.height) return index;
      }
      return -1;
    };
    // The photo lifts as soon as it has been held, before the finger moves.
    const pan = Gesture.Pan().activateAfterLongPress(HOLD_MS).maxPointers(1)
      .onStart((event) => {
        const index = cellAt(event.x, event.y);
        if (index < 0 || index >= count || index === selectedIndex) {
          from.value = -1;
          return;
        }
        from.value = index;
        hover.value = -1;
        released.value = HOLDING;
        dragX.value = event.x;
        dragY.value = event.y;
        liftId.value = ids[index];
        lift.value = withTiming(1, PICK_UP);
        runOnJS(startDrag)(index, ids[index]);
      })
      .onUpdate((event) => {
        if (from.value < 0) return;
        dragX.value = event.x;
        dragY.value = event.y;
        const under = cellAt(event.x, event.y);
        const next = under === from.value ? -1 : under;
        if (next !== hover.value) {
          hover.value = next;
          runOnJS(setHoverOver)(next < 0 ? null : next);
        }
      })
      .onFinalize(() => {
        if (from.value >= 0) {
          const target = hover.value;
          released.value = target >= 0 && target < count ? SWAPPING : BACK_TO_CELL;
          // Grows back to full size as it glides into its cell.
          lift.value = withTiming(0, MOVE, (finished) => {
            if (finished) runOnJS(landed)();
          });
          runOnJS(drop)(from.value, target);
        }
        from.value = -1;
        hover.value = -1;
      });
    const tap = Gesture.Tap().maxDuration(HOLD_MS).onEnd((event) => {
      const index = cellAt(event.x, event.y);
      if (index >= 0 && index < count) runOnJS(onSelect)(index);
    });
    return Gesture.Race(pan, tap);
  }, [count, dragX, dragY, drop, from, hover, ids, landed, lift, liftId, onSelect, rects, released, selectedIndex, startDrag]);

  // Instagram-style reordering: while a photo is dragged over another cell,
  // the photos between the two slide one place along, in order, to make room.
  // Dragged forward, the ones after it move back; dragged back, the ones
  // before it move forward. The dragged photo itself follows the finger.
  const restingCell = (index: number) => {
    if (dragFrom === null || hoverOver === null || hoverOver >= count || index === dragFrom) return index;
    if (dragFrom < hoverOver && index > dragFrom && index <= hoverOver) return index - 1;
    if (dragFrom > hoverOver && index >= hoverOver && index < dragFrom) return index + 1;
    return index;
  };

  return (
    <GestureDetector gesture={gesture}>
      <View pointerEvents={count ? 'auto' : 'none'} collapsable={false} style={StyleSheet.absoluteFill}>
        {rects.map((rect, index) => (
          index === liveIndex ? null : (
            <View
              key={`shell-${index}`}
              pointerEvents="none"
              // A waiting cell over the live preview is a window onto it.
              style={[styles.shell, index >= count && livePreviewBehind && styles.window, rect, corners[index]]}
            >
              {index >= count ? (
                <>
                  {livePreviewBehind ? null : <SnapshotBlur />}
                  <View style={[StyleSheet.absoluteFill, styles.dim]} />
                </>
              ) : null}
            </View>
          )
        ))}
        {photos.map((photo, index) => (
          index === selectedIndex ? null : (
            <PhotoTile
              key={photo.id}
              photo={photo}
              rect={rects[restingCell(index)]}
              corners={corners[restingCell(index)]}
              raised={photo.id === raisedId}
              liftId={liftId}
              lift={lift}
              released={released}
              dragX={dragX}
              dragY={dragY}
            />
          )
        ))}
        {rects.map((rect, index) => (
          <View
            key={`border-${index}`}
            pointerEvents="none"
            style={[styles.border, rect, corners[index], index === liveIndex && styles.live, index === hoverOver && styles.target]}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  shell: { position: 'absolute', backgroundColor: '#121212', overflow: 'hidden' },
  window: { backgroundColor: 'transparent' },
  blur: { filter: [{ blur: 12 }] },
  dim: { backgroundColor: 'rgba(0,0,0,0.25)' },
  tile: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', backgroundColor: '#222' },
  raised: { zIndex: 10 },
  border: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  live: { borderWidth: 3, borderColor: '#fff' },
  target: { borderWidth: 3, borderColor: '#3897F0' },
});
