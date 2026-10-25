import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEventListener } from 'expo';
import { VideoView, createVideoPlayer } from 'expo-video';
import { useReleasingSharedObject } from 'expo-modules-core';
import { takeStoryVideo } from '../preparedStoryVideo';
import type { SharedValue } from 'react-native-reanimated';
import type { StorySource } from '../storySources';

type Props = {
  source: StorySource;
  playing: boolean;
  muted: boolean;
  /** Changing it replays the Story from the start. */
  restartKey: number;
  progress: SharedValue<number>;
  onReady: (durationMs: number | null) => void;
  onEnd: () => void;
  onError: () => void;
};

/**
 * A portrait photo fills the screen. A wider one is shown whole over a blurred
 * copy of itself, the way Instagram presents landscape photos.
 */
function StoryPhoto({ uri, onReady, onError }: { uri: string; onReady: Props['onReady']; onError: () => void }) {
  const [aspect, setAspect] = useState<number | null>(null);
  const wide = aspect !== null && aspect > 0.75;
  return (
    <View style={StyleSheet.absoluteFill}>
      {wide ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={30} /> : null}
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode={wide ? 'contain' : 'cover'}
        fadeDuration={0}
        onLoad={(event) => {
          const { width, height } = event.nativeEvent.source;
          setAspect(height > 0 ? width / height : 0.5625);
          onReady(null);
        }}
        onError={onError}
      />
    </View>
  );
}

/**
 * A video Story. Its length is the Story's length, and the progress bar follows
 * playback time, so the bar stops while the video buffers.
 */
function StoryVideo({ uri, playing, muted, restartKey, progress, onReady, onEnd, onError }: Omit<Props, 'source'> & { uri: string }) {
  const player = useReleasingSharedObject(() => {
    const instance = takeStoryVideo(uri) ?? createVideoPlayer({ uri, useCaching: true });
    instance.loop = false;
    instance.muted = muted;
    instance.timeUpdateEventInterval = 0.05;
    return instance;
  }, [uri]);
  const ready = useRef(false);
  const callbacks = useRef({ onReady, onEnd, onError });
  callbacks.current = { onReady, onEnd, onError };

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);
  useEffect(() => {
    if (!restartKey) return;
    player.currentTime = 0;
    progress.value = 0;
  }, [restartKey, player, progress]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const duration = player.duration;
    if (duration > 0) progress.value = Math.min(1, currentTime / duration);
  });
  useEventListener(player, 'playToEnd', () => callbacks.current.onEnd());
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') callbacks.current.onError();
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      // A texture view can be rotated and scaled with the cube and the close
      // gesture; a surface view would stay flat on screen.
      surfaceType="textureView"
      onFirstFrameRender={() => {
        if (ready.current) return;
        ready.current = true;
        callbacks.current.onReady(player.duration > 0 ? player.duration * 1000 : null);
      }}
    />
  );
}

/** A Reveal story before you message its owner: its colours, blurred, and the hint. */
function LockedStory({ locked, onReady }: { locked: NonNullable<StorySource['locked']>; onReady: Props['onReady'] }) {
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current(null);
  }, []);
  return (
    <View style={StyleSheet.absoluteFill}>
      {locked.preview
        ? <Image source={{ uri: locked.preview }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={4} fadeDuration={0} />
        : <LinearGradient colors={['#4A4458', '#1D1B20']} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, styles.lockedScrim]} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
        <View style={styles.lockedCard}>
          <Ionicons name="eye-off" size={30} color="#fff" />
          {locked.hint ? <Text style={styles.lockedHint}>{locked.hint}</Text> : null}
          <Text style={styles.lockedNote}>Send a message to see this story</Text>
        </View>
      </View>
    </View>
  );
}

export function StoryMedia({ source, ...props }: Props) {
  if (source.locked) return <LockedStory locked={source.locked} onReady={props.onReady} />;
  return source.contentType.startsWith('video/')
    ? <StoryVideo uri={source.url} {...props} />
    : <StoryPhoto uri={source.url} onReady={props.onReady} onError={props.onError} />;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  lockedScrim: { backgroundColor: 'rgba(0,0,0,0.3)' },
  lockedCard: { alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20, paddingHorizontal: 26, paddingVertical: 20, marginHorizontal: 40 },
  lockedHint: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  lockedNote: { color: 'rgba(255,255,255,0.85)', fontSize: 14, textAlign: 'center' },
});
