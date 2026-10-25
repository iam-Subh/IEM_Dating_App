import React, {memo, useEffect, useRef, useState} from 'react';
import {Animated, Image, Platform, StyleSheet, View} from 'react-native';
import {ImageManipulator, SaveFormat} from 'expo-image-manipulator';
import type {VideoPlayer} from 'expo-video';

/** Keep generated frames in the player owner, outside the modal lifecycle. */
export function useVideoGlowFrames(player: VideoPlayer, duration: number, ready: boolean) {
  const [frames, setFrames] = useState<string[]>([]);

  useEffect(() => {
    if (!ready || duration <= 0 || Platform.OS === 'web') return;
    let cancelled = false;
    const load = async () => {
      // Extract once per source. Limit both dimensions before decoding the blur.
      const times = Array.from({length: 6}, (_, index) => Math.max(0, Math.min(duration - 0.05, index * duration / 6)));
      const thumbnails = await player.generateThumbnailsAsync(times, {maxWidth: 160, maxHeight: 160});
      try {
        const paths: string[] = [];
        for (const thumbnail of thumbnails) {
          if (cancelled) return;
          const context = ImageManipulator.manipulate(thumbnail);
          try {
            const image = await context.renderAsync();
            try {
              const result = await image.saveAsync({format: SaveFormat.JPEG, compress: 0.8});
              paths.push(result.uri);
            } finally {image.release();}
          } finally {context.release();}
        }
        if (!cancelled) setFrames(paths);
      } finally {thumbnails.forEach(thumbnail => thumbnail.release());}
    };
    // A missing thumbnail must not interrupt video playback.
    void load().catch(() => {});
    return () => {cancelled = true;};
  }, [player, duration, ready]);
  return frames;
}

/** Reuse small frames for the colour wash. Do not run a second video player. */
export const VideoPreviewGlow = memo(function VideoPreviewGlow({frames, duration, time}: {
  frames: string[]; duration: number; time: number;
}) {
  const [backdrop, setBackdrop] = useState<{current: string; previous?: string} | null>(null);
  const latest = useRef<string | undefined>(undefined);
  const fade = useRef(new Animated.Value(0)).current;

  const index = Math.min(frames.length - 1, Math.max(0, Math.floor(time / Math.max(duration, 1) * frames.length)));
  const selected = frames[index];
  useEffect(() => {
    if (!selected || selected === latest.current) return;
    fade.stopAnimation();
    fade.setValue(0);
    setBackdrop({current: selected, previous: latest.current});
    latest.current = selected;
  }, [selected, fade]);
  useEffect(() => () => fade.stopAnimation(), [fade]);

  return <View pointerEvents="none" accessible={false} style={s.background}>
    {!!backdrop?.previous && <Image source={{uri: backdrop.previous}} resizeMode="cover" blurRadius={32} fadeDuration={0} style={s.image}/>}
    {!!backdrop && <Animated.Image key={backdrop.current} source={{uri: backdrop.current}} resizeMode="cover" blurRadius={32} fadeDuration={0}
      onLoad={() => {if (backdrop.current === latest.current) Animated.timing(fade, {toValue: 1, duration: 450, useNativeDriver: true}).start();}}
      style={[s.image, {opacity: fade}]}/>}
    <View style={s.tint}/>
  </View>;
});

const s = StyleSheet.create({
  background: {...StyleSheet.absoluteFill, overflow: 'hidden'},
  image: {...StyleSheet.absoluteFill, transform: [{scale: 1.18}], opacity: 0.9},
  tint: {...StyleSheet.absoluteFill, backgroundColor: '#21192324'},
});
