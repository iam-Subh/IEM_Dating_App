import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, PixelRatio, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import type { VideoPlayer } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { ChatMedia } from '../../../../modules/chat-media';
import { SelectedChatMedia, VideoEdit } from './attachmentTypes';

const HANDLE_WIDTH = 16;
const STRIP_HEIGHT = 50;
const FRAME_COUNT = 10;
const SIDE_MARGIN = 16;
/** Telegram refuses a trim shorter than about a second, and so do we. */
const MIN_TRIM_MS = 1000;
const COVER_WINDOW = 38;

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function megabytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface Props {
  item: SelectedChatMedia;
  player: VideoPlayer;
  onChange: (edit: VideoEdit) => void;
  /** True while a finger is on the timeline, so the page list can stop paging. */
  onInteractingChange?: (interacting: boolean) => void;
}

/**
 * Trim, mute and cover controls under a video, after Telegram's
 * VideoTimelinePlayView: a strip of frames with a handle at each end, the
 * unselected part dimmed, a playhead, and the selected length and size above.
 */
export function VideoEditor({ item, player, onChange, onInteractingChange }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const trackWidth = screenWidth - 2 * (SIDE_MARGIN + HANDLE_WIDTH);

  const [durationMs, setDurationMs] = useState(item.durationMs ?? 0);
  const [sizeBytes, setSizeBytes] = useState(item.size ?? 0);
  const [hasAudio, setHasAudio] = useState(true);
  const [frames, setFrames] = useState<string[]>([]);
  const [mode, setMode] = useState<'trim' | 'cover'>('trim');
  const [playing, setPlaying] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);

  const edit: VideoEdit = item.edit ?? { startMs: 0, endMs: durationMs, muted: false, coverMs: null };
  const endMs = edit.endMs > 0 ? Math.min(edit.endMs, durationMs || edit.endMs) : durationMs;
  const editRef = useRef({ ...edit, endMs });
  editRef.current = { ...edit, endMs };
  const uri = item.currentUri;

  // Positions are fractions of the full video, so they survive a rotation.
  const left = useSharedValue(0);
  const right = useSharedValue(1);
  const playhead = useSharedValue(0);
  const cover = useSharedValue(0);
  const dragOrigin = useSharedValue(0);
  const scrubbing = useRef(false);
  const lastSeek = useRef(0);

  useEffect(() => {
    let active = true;
    ChatMedia?.getVideoInfo(uri)
      .then((info) => {
        if (!active) return;
        if (info.durationMs > 0) setDurationMs(info.durationMs);
        if (info.size > 0) setSizeBytes(info.size);
        setHasAudio(info.hasAudio);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [uri]);

  useEventListener(player, 'sourceLoad', ({ duration }) => {
    if (duration > 0 && !durationMs) setDurationMs(duration * 1000);
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying));

  // Keep the handles where the edit says, except while they are being dragged.
  useEffect(() => {
    if (!durationMs || scrubbing.current) return;
    left.value = edit.startMs / durationMs;
    right.value = Math.min(1, endMs / durationMs);
    cover.value = (edit.coverMs ?? edit.startMs) / durationMs;
  }, [cover, durationMs, edit.coverMs, edit.startMs, endMs, left, right]);

  useEffect(() => {
    player.muted = edit.muted;
  }, [edit.muted, player]);

  useEffect(() => {
    player.timeUpdateEventInterval = 0.05;
    return () => {
      // The slide may release its player in the same commit that unmounts this.
      try { player.timeUpdateEventInterval = 0; } catch { /* already released */ }
    };
  }, [player]);

  // Play only the selected range, looping back to its start.
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!durationMs) return;
    const ms = currentTime * 1000;
    playhead.value = ms / durationMs;
    const { startMs, endMs: selectedEnd } = editRef.current;
    if (!scrubbing.current && player.playing && (ms >= selectedEnd - 40 || ms < startMs - 250)) {
      player.currentTime = startMs / 1000;
    }
  });

  useEffect(() => {
    let active = true;
    setFrames([]);
    const height = Math.round(STRIP_HEIGHT * PixelRatio.get());
    const load = async () => {
      if (ChatMedia) return ChatMedia.generateFrames(uri, FRAME_COUNT, height);
      if (!durationMs) return [];
      const results: string[] = [];
      for (let index = 0; index < FRAME_COUNT && active; index += 1) {
        const time = Math.round(((index + 0.5) * durationMs) / FRAME_COUNT);
        results.push((await VideoThumbnails.getThumbnailAsync(uri, { time, quality: 0.4 })).uri);
      }
      return results;
    };
    load().then((uris) => { if (active) setFrames(uris); }).catch(() => undefined);
    return () => { active = false; };
  }, [durationMs, uri]);

  const seekTo = useCallback((fraction: number, force = false) => {
    if (!durationMs) return;
    const now = Date.now();
    if (!force && now - lastSeek.current < 60) return;
    lastSeek.current = now;
    player.currentTime = (fraction * durationMs) / 1000;
  }, [durationMs, player]);

  const beginInteraction = useCallback(() => {
    scrubbing.current = true;
    player.pause();
    onInteractingChange?.(true);
  }, [onInteractingChange, player]);

  const commitTrim = useCallback((startFraction: number, endFraction: number) => {
    scrubbing.current = false;
    onInteractingChange?.(false);
    if (!durationMs) return;
    const current = editRef.current;
    const startMs = Math.round(startFraction * durationMs);
    const nextEnd = Math.round(endFraction * durationMs);
    if (Math.abs(startMs - current.startMs) < 1 && Math.abs(nextEnd - current.endMs) < 1) return;
    // A cover outside the new range would show a frame that is no longer sent.
    const coverOutside = current.coverMs != null && (current.coverMs < startMs || current.coverMs > nextEnd);
    onChange({
      ...current,
      startMs,
      endMs: nextEnd,
      coverMs: coverOutside ? null : current.coverMs,
      coverUri: coverOutside ? null : current.coverUri,
      applied: false,
    });
    player.currentTime = startMs / 1000;
  }, [durationMs, onChange, onInteractingChange, player]);

  const commitCover = useCallback(async (fraction: number) => {
    scrubbing.current = false;
    onInteractingChange?.(false);
    if (!durationMs) return;
    const coverMs = Math.round(fraction * durationMs);
    player.currentTime = coverMs / 1000;
    setCoverBusy(true);
    try {
      const coverUri = ChatMedia
        ? await ChatMedia.frameAt(uri, coverMs, 720)
        : (await VideoThumbnails.getThumbnailAsync(uri, { time: coverMs, quality: 0.85 })).uri;
      onChange({ ...editRef.current, coverMs, coverUri });
    } catch {
      onChange({ ...editRef.current, coverMs, coverUri: null });
    } finally {
      setCoverBusy(false);
    }
  }, [durationMs, onChange, onInteractingChange, player, uri]);

  const endInteraction = useCallback(() => {
    scrubbing.current = false;
    onInteractingChange?.(false);
  }, [onInteractingChange]);

  const minGap = durationMs ? Math.min(1, MIN_TRIM_MS / durationMs) : 1;
  const coverSpan = trackWidth > COVER_WINDOW ? COVER_WINDOW / trackWidth : 0;

  const leftPan = Gesture.Pan()
    .activeOffsetX([-3, 3])
    .hitSlop({ left: 14, right: 4, top: 12, bottom: 12 })
    .onBegin(() => {
      dragOrigin.value = left.value;
      runOnJS(beginInteraction)();
    })
    .onUpdate((event) => {
      left.value = Math.min(Math.max(0, dragOrigin.value + event.translationX / trackWidth), right.value - minGap);
      runOnJS(seekTo)(left.value);
    })
    .onFinalize(() => {
      runOnJS(commitTrim)(left.value, right.value);
    });

  const rightPan = Gesture.Pan()
    .activeOffsetX([-3, 3])
    .hitSlop({ left: 4, right: 14, top: 12, bottom: 12 })
    .onBegin(() => {
      dragOrigin.value = right.value;
      runOnJS(beginInteraction)();
    })
    .onUpdate((event) => {
      right.value = Math.max(Math.min(1, dragOrigin.value + event.translationX / trackWidth), left.value + minGap);
      runOnJS(seekTo)(right.value);
    })
    .onFinalize(() => {
      runOnJS(commitTrim)(left.value, right.value);
    });

  // In trim mode the strip scrubs the playhead; in cover mode it moves the cover.
  const stripPan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      runOnJS(beginInteraction)();
      const fraction = Math.min(Math.max(event.x / trackWidth, left.value), right.value);
      if (mode === 'cover') cover.value = fraction;
      else playhead.value = fraction;
      runOnJS(seekTo)(fraction, true);
    })
    .onUpdate((event) => {
      const fraction = Math.min(Math.max(event.x / trackWidth, left.value), right.value);
      if (mode === 'cover') cover.value = fraction;
      else playhead.value = fraction;
      runOnJS(seekTo)(fraction);
    })
    .onFinalize(() => {
      if (mode === 'cover') runOnJS(commitCover)(cover.value);
      else runOnJS(endInteraction)();
    });

  const leftDimStyle = useAnimatedStyle(() => ({ width: left.value * trackWidth }));
  const rightDimStyle = useAnimatedStyle(() => ({
    left: HANDLE_WIDTH + right.value * trackWidth,
    width: (1 - right.value) * trackWidth,
  }));
  const selectionStyle = useAnimatedStyle(() => ({
    left: HANDLE_WIDTH + left.value * trackWidth,
    width: (right.value - left.value) * trackWidth,
  }));
  const leftHandleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: left.value * trackWidth }] }));
  const rightHandleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: HANDLE_WIDTH + right.value * trackWidth }] }));
  const playheadStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: HANDLE_WIDTH + Math.min(Math.max(playhead.value, left.value), right.value) * trackWidth - 1.5 }],
  }));
  const coverStyle = useAnimatedStyle(() => ({
    transform: [{
      translateX: HANDLE_WIDTH + Math.min(Math.max(cover.value * trackWidth - COVER_WINDOW / 2, 0), trackWidth - COVER_WINDOW),
    }],
  }));

  const selectedMs = Math.max(0, endMs - edit.startMs);
  const estimatedBytes = sizeBytes && durationMs ? sizeBytes * (selectedMs / durationMs) : 0;
  const togglePlay = () => {
    if (player.playing) player.pause();
    else {
      const ms = player.currentTime * 1000;
      if (ms < edit.startMs || ms >= endMs - 40) player.currentTime = edit.startMs / 1000;
      player.play();
    }
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.infoRow}>
        {mode === 'trim' ? (
          <>
            <Pressable accessibilityLabel={playing ? 'Pause' : 'Play'} onPress={togglePlay} style={styles.iconButton} hitSlop={8}>
              <Ionicons name={playing ? 'pause' : 'play'} size={20} color="#fff" />
            </Pressable>
            <View style={styles.infoPill}>
              <Text style={styles.infoText}>
                {clock(selectedMs)}{estimatedBytes ? `  ·  ${megabytes(estimatedBytes * (edit.muted ? 0.92 : 1))}` : ''}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Choose cover"
              onPress={() => { player.pause(); setMode('cover'); if (edit.coverMs != null) player.currentTime = edit.coverMs / 1000; }}
              style={styles.coverButton}
              hitSlop={6}
            >
              {edit.coverUri ? <Image source={{ uri: edit.coverUri }} style={styles.coverThumb} /> : <Ionicons name="image-outline" size={16} color="#fff" />}
              <Text style={styles.coverButtonText}>Cover</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={edit.muted ? 'Turn sound on' : 'Mute video'}
              accessibilityState={{ selected: edit.muted, disabled: !hasAudio }}
              disabled={!hasAudio}
              onPress={() => onChange({ ...editRef.current, muted: !edit.muted, applied: false })}
              style={[styles.iconButton, edit.muted ? styles.iconButtonActive : null]}
              hitSlop={8}
            >
              <Ionicons name={!hasAudio || edit.muted ? 'volume-mute' : 'volume-high'} size={20} color={hasAudio ? '#fff' : '#777'} />
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.coverHint}>Drag to pick the frame people see before they play</Text>
            {coverBusy ? <ActivityIndicator color="#fff" size="small" /> : null}
            <Pressable accessibilityLabel="Done choosing cover" onPress={() => setMode('trim')} style={styles.doneButton} hitSlop={8}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={[styles.track, { width: trackWidth + 2 * HANDLE_WIDTH }]}>
        <GestureDetector gesture={stripPan}>
          <View style={[styles.strip, { width: trackWidth }]}>
            {frames.length
              ? frames.map((frame, index) => (
                <Image key={frame} source={{ uri: frame }} style={{ width: trackWidth / frames.length, height: STRIP_HEIGHT }} resizeMode="cover" fadeDuration={0} />
              ))
              : <View style={styles.stripLoading}><ActivityIndicator color="#fff" size="small" /></View>}
          </View>
        </GestureDetector>

        <Animated.View pointerEvents="none" style={[styles.dim, { left: HANDLE_WIDTH }, leftDimStyle]} />
        <Animated.View pointerEvents="none" style={[styles.dim, rightDimStyle]} />

        {mode === 'trim' ? (
          <>
            <Animated.View pointerEvents="none" style={[styles.selection, selectionStyle]} />
            <Animated.View pointerEvents="none" style={[styles.playhead, playheadStyle]} />
            <GestureDetector gesture={leftPan}>
              <Animated.View style={[styles.handle, styles.handleLeft, leftHandleStyle]} accessibilityLabel="Trim start">
                <View style={styles.grip} />
              </Animated.View>
            </GestureDetector>
            <GestureDetector gesture={rightPan}>
              <Animated.View style={[styles.handle, styles.handleRight, rightHandleStyle]} accessibilityLabel="Trim end">
                <View style={styles.grip} />
              </Animated.View>
            </GestureDetector>
          </>
        ) : (
          <Animated.View pointerEvents="none" style={[styles.coverWindow, coverStyle]} />
        )}
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', alignItems: 'center', gap: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SIDE_MARGIN, minHeight: 36 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(35,35,38,0.86)' },
  iconButtonActive: { backgroundColor: 'rgba(255,90,95,0.9)' },
  infoPill: { flex: 1, height: 32, borderRadius: 16, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(35,35,38,0.86)' },
  infoText: { color: '#fff', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  coverButton: { height: 32, borderRadius: 16, paddingLeft: 4, paddingRight: 11, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(35,35,38,0.86)' },
  coverThumb: { width: 24, height: 24, borderRadius: 12 },
  coverButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  coverHint: { flex: 1, color: '#fff', fontSize: 13 },
  doneButton: { height: 32, borderRadius: 16, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: '#fff' },
  doneText: { color: '#000', fontSize: 13, fontWeight: '800' },
  track: { height: STRIP_HEIGHT, marginHorizontal: SIDE_MARGIN },
  strip: { position: 'absolute', left: HANDLE_WIDTH, top: 0, height: STRIP_HEIGHT, flexDirection: 'row', borderRadius: 6, overflow: 'hidden', backgroundColor: '#1d1d20' },
  stripLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { position: 'absolute', top: 0, height: STRIP_HEIGHT, backgroundColor: 'rgba(0,0,0,0.62)' },
  selection: { position: 'absolute', top: 0, height: STRIP_HEIGHT, borderTopWidth: 2, borderBottomWidth: 2, borderColor: '#fff' },
  playhead: { position: 'absolute', top: -4, left: 0, width: 3, height: STRIP_HEIGHT + 8, borderRadius: 1.5, backgroundColor: '#fff' },
  handle: { position: 'absolute', top: 0, left: 0, width: HANDLE_WIDTH, height: STRIP_HEIGHT, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  handleLeft: { borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  handleRight: { borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  grip: { width: 3, height: 16, borderRadius: 1.5, backgroundColor: '#111' },
  coverWindow: { position: 'absolute', top: -3, left: 0, width: COVER_WINDOW, height: STRIP_HEIGHT + 6, borderRadius: 7, borderWidth: 3, borderColor: '#fff' },
});
