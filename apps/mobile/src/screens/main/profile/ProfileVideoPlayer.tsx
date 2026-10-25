import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { clampPlaybackTime, createLiveVideoSeekQueue, matchesPendingVideoSeek, playbackClock, type PendingVideoSeek } from './profileVideoPlayback';

type Props = { url: string; posterUrl?: string | null; onClose: () => void };

export function ProfileVideoPlayer({ url, posterUrl, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer({ uri: url, useCaching: true }, (instance) => {
    instance.loop = true;
    instance.timeUpdateEventInterval = 0.1;
    instance.bufferOptions = {
      preferredForwardBufferDuration: 60,
      minBufferForPlayback: 0.3,
      maxBufferBytes: 32 * 1024 * 1024,
    };
    instance.play();
  });
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(player.playing);
  const [duration, setDuration] = useState(Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0);
  const [position, setPosition] = useState(0);
  // Native slider controls its own thumb during a drag. Do not send drag values back to it.
  const [sliderPosition, setSliderPosition] = useState(0);
  const [status, setStatus] = useState(player.status);
  const [frameReady, setFrameReady] = useState(false);
  const closing = useRef(false);
  const seeking = useRef(false);
  const resumeAfterSeek = useRef(false);
  const pendingSeek = useRef<PendingVideoSeek | null>(null);
  const durationRef = useRef(duration);
  const progress = useSharedValue(0);
  const liveSeeks = useMemo(() => createLiveVideoSeekQueue((seconds) => {
    player.currentTime = seconds;
  }), [player]);
  useEffect(() => () => liveSeeks.cancel(), [liveSeeks]);

  const setLoadedDuration = (seconds: number) => {
    if (Number.isFinite(seconds) && seconds > 0) {
      durationRef.current = seconds;
      setDuration(seconds);
    }
  };
  useEventListener(player, 'sourceLoad', ({ duration: seconds }) => setLoadedDuration(seconds));
  useEventListener(player, 'statusChange', ({ status: nextStatus }) => {
    if (closing.current) return;
    setStatus(nextStatus);
    if (nextStatus === 'readyToPlay') setLoadedDuration(player.duration);
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!closing.current) setPlaying(isPlaying);
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (closing.current || seeking.current) return;
    // Ignore an event queued before the final seek, so the thumb does not jump back.
    const pending = pendingSeek.current;
    if (pending && !matchesPendingVideoSeek(currentTime, pending, Date.now())) return;
    pendingSeek.current = null;
    const next = clampPlaybackTime(currentTime, durationRef.current);
    setPosition(next);
    setSliderPosition(next);
  });
  useEventListener(player, 'playToEnd', () => {
    if (closing.current || seeking.current) return;
    // A seek to the end can loop before the next timeUpdate arrives.
    if (pendingSeek.current?.resumes && pendingSeek.current.target >= durationRef.current - 0.15) {
      pendingSeek.current = null;
      setPosition(0);
      setSliderPosition(0);
    }
  });

  const enter = () => {
    if (closing.current) return;
    setLoadedDuration(player.duration);
    progress.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
  };
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    resumeAfterSeek.current = false;
    liveSeeks.cancel();
    player.scrubbingModeOptions = { scrubbingModeEnabled: false };
    player.pause();
    // Keep the paused video mounted until the exit animation ends.
    progress.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [liveSeeks, onClose, player, progress]);
  const transitionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));

  const beginSeek = (seconds: number) => {
    if (closing.current || durationRef.current <= 0) return;
    resumeAfterSeek.current = player.playing;
    seeking.current = true;
    pendingSeek.current = null;
    liveSeeks.cancel();
    player.pause();
    player.loop = false;
    player.scrubbingModeOptions = { scrubbingModeEnabled: true };
    player.seekTolerance = { toleranceBefore: 0.25, toleranceAfter: 0.25 };
    const next = clampPlaybackTime(seconds, durationRef.current);
    setPosition(next);
    liveSeeks.move(next);
  };
  const moveSeek = (seconds: number) => {
    if (closing.current || !seeking.current) return;
    const next = clampPlaybackTime(seconds, durationRef.current);
    setPosition(next);
    liveSeeks.move(next);
  };
  const endSeek = (seconds: number) => {
    if (closing.current || !seeking.current) return;
    const next = clampPlaybackTime(seconds, durationRef.current);
    pendingSeek.current = { target: next, startedAt: Date.now(), resumes: resumeAfterSeek.current };
    player.scrubbingModeOptions = { scrubbingModeEnabled: false };
    player.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
    liveSeeks.finish(next);
    player.loop = true;
    setPosition(next);
    setSliderPosition(next);
    seeking.current = false;
    if (resumeAfterSeek.current) player.play();
    resumeAfterSeek.current = false;
  };
  const togglePlayback = () => {
    if (closing.current || seeking.current) return;
    const wasPlaying = player.playing;
    if (pendingSeek.current) {
      pendingSeek.current = {
        target: clampPlaybackTime(player.currentTime, durationRef.current),
        startedAt: Date.now(),
        resumes: !wasPlaying,
      };
    }
    if (wasPlaying) player.pause();
    else player.play();
  };
  const toggleSound = () => {
    if (closing.current) return;
    const next = !muted;
    player.muted = next;
    setMuted(next);
  };
  const canSeek = duration > 0 && status !== 'error';

  return (
    <Modal visible transparent animationType="none" onShow={enter} onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[styles.screen, transitionStyle]}>
        <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
          <Pressable onPress={close} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Close video">
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.title}>Profile video</Text>
        </View>

        <View style={styles.playerCard}>
          <View style={styles.stage}>
            {!frameReady && posterUrl ? <Image source={{ uri: posterUrl }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
            <VideoView
              player={player}
              style={[StyleSheet.absoluteFill, { opacity: frameReady ? 1 : 0 }]}
              surfaceType="textureView"
              contentFit="contain"
              nativeControls={false}
              onFirstFrameRender={() => setFrameReady(true)}
            />
            {status === 'error' ? (
              <View style={styles.stageMessage}><Ionicons name="alert-circle-outline" size={28} color="#FFB8C7" /><Text style={styles.errorText}>Cannot play this video. Close it and try again.</Text></View>
            ) : !frameReady ? (
              <View pointerEvents="none" style={styles.stageMessage}><ActivityIndicator color="#FFB8C7" /></View>
            ) : null}
          </View>
        </View>

        <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <View style={styles.timeRow}>
            <Text style={styles.time}>{playbackClock(position)}</Text>
            <Text style={styles.time}>{playbackClock(duration)}</Text>
          </View>
          <Slider
            style={styles.timeline}
            minimumValue={0}
            maximumValue={duration || 1}
            value={sliderPosition}
            disabled={!canSeek}
            minimumTrackTintColor="#FFB8C7"
            maximumTrackTintColor="#443B40"
            thumbTintColor="#FFB8C7"
            onSlidingStart={beginSeek}
            onValueChange={moveSeek}
            onSlidingComplete={endSeek}
            accessibilityLabel="Video position"
            accessibilityValue={{ min: 0, max: duration || 1, now: position, text: `${playbackClock(position)} of ${playbackClock(duration)}` }}
          />
          <View style={styles.buttonRow}>
            <Pressable onPress={togglePlayback} disabled={status === 'error'} style={({ pressed }) => [styles.playControl, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={playing ? 'Pause video' : 'Play video'}>
              <Ionicons name={playing ? 'pause' : 'play'} size={22} color="#331C23" />
            </Pressable>
            <Pressable onPress={toggleSound} style={({ pressed }) => [styles.soundControl, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={muted ? 'Turn sound on' : 'Mute video'}>
              <Ionicons name={muted ? 'volume-mute-outline' : 'volume-high-outline'} size={20} color="#FFFFFF" />
              <Text style={styles.soundLabel}>{muted ? 'Sound off' : 'Sound on'}</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#100E10' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#292428', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 17, color: '#FFB8C7' },
  playerCard: { flex: 1, marginTop: 8, marginHorizontal: 16, padding: 6, borderRadius: 16, backgroundColor: '#292428', overflow: 'hidden' },
  stage: { flex: 1, borderRadius: 10, backgroundColor: '#000000', overflow: 'hidden' },
  stageMessage: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  errorText: { color: '#FFFFFF', fontSize: 14, textAlign: 'center' },
  controls: { paddingTop: 12, paddingHorizontal: 20 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: '#E9DAE0', fontFamily: 'DMSans_500Medium', fontSize: 12, fontVariant: ['tabular-nums'] },
  timeline: { height: 40, marginHorizontal: -4 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  playControl: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFB8C7', alignItems: 'center', justifyContent: 'center' },
  soundControl: { minHeight: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, backgroundColor: '#292428' },
  soundLabel: { color: '#FFFFFF', fontFamily: 'DMSans_500Medium', fontSize: 12 },
  pressed: { opacity: 0.7 },
});
