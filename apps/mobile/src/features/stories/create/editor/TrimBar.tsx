import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatMedia } from '../../../../../modules/chat-media';
import { VIDEO_PART_MS } from '../composition/types';

const HANDLE = 18;
const MIN_MS = 1000;

function clock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The trim timeline: frames of the video, a handle at each
 * end, the unselected part dimmed. A selection over 60 seconds posts as
 * consecutive 60 second stories, which the label says.
 *
 * The handles move on the UI thread and the trim is saved once, on release.
 * Saving on every movement re-rendered the editor and seeked the video each
 * frame, which made the handles lag behind the finger.
 */
export function TrimBar({ top, rightInset = 0, uri, durationMs, startMs, endMs, muted, onChange, onToggleMute, onDone }: {
  top?: number;
  rightInset?: number;
  uri: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  muted: boolean;
  onChange: (range: { startMs: number; endMs: number }) => void;
  onToggleMute: () => void;
  onDone: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const track = width - rightInset - 32 - HANDLE * 2;
  const duration = Math.max(1, durationMs);
  const [frames, setFrames] = useState<string[]>([]);
  const [lengthMs, setLengthMs] = useState(endMs - startMs);
  const startX = useSharedValue((startMs / duration) * track);
  const endX = useSharedValue((endMs / duration) * track);
  const origin = useSharedValue(0);
  const dragging = useSharedValue(false);
  const shownSeconds = useSharedValue(Math.round((endMs - startMs) / 1000));

  useEffect(() => {
    let active = true;
    ChatMedia?.generateFrames(uri, 10, 90).then((list) => { if (active) setFrames(list); }).catch(() => undefined);
    return () => { active = false; };
  }, [uri]);

  // Follow the saved trim when it changes from outside, never mid-drag.
  useEffect(() => {
    if (dragging.value) return;
    startX.value = (startMs / duration) * track;
    endX.value = (endMs / duration) * track;
    setLengthMs(endMs - startMs);
  }, [dragging, duration, endMs, endX, startMs, startX, track]);

  const gestures = useMemo(() => {
    const minGap = (MIN_MS / duration) * track;
    const toMs = (x: number) => {
      'worklet';
      return Math.max(0, Math.min(duration, Math.round(((x / track) * duration) / 100) * 100));
    };
    const report = () => {
      'worklet';
      // Only when the whole seconds change, so the label costs almost nothing.
      const seconds = Math.round((toMs(endX.value) - toMs(startX.value)) / 1000);
      if (seconds !== shownSeconds.value) {
        shownSeconds.value = seconds;
        runOnJS(setLengthMs)(seconds * 1000);
      }
    };
    const commit = () => {
      'worklet';
      dragging.value = false;
      runOnJS(onChange)({ startMs: toMs(startX.value), endMs: toMs(endX.value) });
    };
    const left = Gesture.Pan()
      .onStart(() => {
        dragging.value = true;
        origin.value = startX.value;
      })
      .onUpdate((event) => {
        startX.value = Math.max(0, Math.min(endX.value - minGap, origin.value + event.translationX));
        report();
      })
      .onEnd(commit)
      .onFinalize(() => { dragging.value = false; });
    const right = Gesture.Pan()
      .onStart(() => {
        dragging.value = true;
        origin.value = endX.value;
      })
      .onUpdate((event) => {
        endX.value = Math.min(track, Math.max(startX.value + minGap, origin.value + event.translationX));
        report();
      })
      .onEnd(commit)
      .onFinalize(() => { dragging.value = false; });
    return { left, right };
  }, [dragging, duration, endX, onChange, origin, shownSeconds, startX, track]);

  const leftDim = useAnimatedStyle(() => ({ width: startX.value }));
  const rightDim = useAnimatedStyle(() => ({ left: endX.value }));
  const selection = useAnimatedStyle(() => ({ left: startX.value, width: endX.value - startX.value }));
  const leftHandle = useAnimatedStyle(() => ({ transform: [{ translateX: startX.value - HANDLE }] }));
  const rightHandle = useAnimatedStyle(() => ({ transform: [{ translateX: endX.value }] }));

  const parts = Math.ceil((lengthMs - 500) / VIDEO_PART_MS);

  return (
    <View style={[styles.wrap, top == null ? { paddingBottom: insets.bottom + 12 }
      : { top, right: rightInset, bottom: undefined, paddingBottom: 12, borderRadius: 16, backgroundColor: '#1B1B1B' }]}>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Turn sound on' : 'Mute'} onPress={onToggleMute} style={styles.icon}>
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color="#fff" />
        </Pressable>
        <Text style={styles.label}>
          {clock(lengthMs)}{parts > 1 ? `  ·  Posts as ${parts} stories` : ''}
        </Text>
        <Pressable accessibilityRole="button" onPress={onDone} style={styles.icon}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
      <View style={[styles.strip, { marginHorizontal: 16 + HANDLE }]}>
        <View style={styles.frames}>
          {frames.map((frame) => <Image key={frame} source={{ uri: frame }} style={styles.frame} />)}
        </View>
        <Animated.View style={[styles.dim, { left: 0 }, leftDim]} />
        <Animated.View style={[styles.dim, { right: 0 }, rightDim]} />
        <Animated.View style={[styles.selection, selection]} />
        <GestureDetector gesture={gestures.left}>
          <Animated.View hitSlop={{ left: 16, right: 16, top: 10, bottom: 10 }} style={[styles.handle, { borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }, leftHandle]}>
            <View style={styles.grip} />
          </Animated.View>
        </GestureDetector>
        <GestureDetector gesture={gestures.right}>
          <Animated.View hitSlop={{ left: 16, right: 16, top: 10, bottom: 10 }} style={[styles.handle, { borderTopRightRadius: 8, borderBottomRightRadius: 8 }, rightHandle]}>
            <View style={styles.grip} />
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', paddingTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginBottom: 10 },
  icon: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, color: '#fff', textAlign: 'center', fontWeight: '600' },
  done: { color: '#fff', fontWeight: '700', fontSize: 16, paddingHorizontal: 8 },
  strip: { height: 56 },
  frames: { flexDirection: 'row', height: 56, borderRadius: 6, overflow: 'hidden', backgroundColor: '#222' },
  frame: { flex: 1, height: 56 },
  dim: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  selection: { position: 'absolute', top: 0, bottom: 0, borderTopWidth: 3, borderBottomWidth: 3, borderColor: '#fff' },
  handle: { position: 'absolute', left: 0, top: 0, bottom: 0, width: HANDLE, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  grip: { width: 3, height: 18, borderRadius: 2, backgroundColor: '#000' },
});
