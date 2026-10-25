import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Images, NativeNitroImage, type Image as NitroPicture } from 'react-native-nitro-image';
import { displayImageFor, fitForScreen, registerDisplayImage, sharpenForPreview } from '../displayImages';
import { LinearGradient } from 'expo-linear-gradient';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import type { StoryDraftItem } from '../composition/types';
import { CANVAS } from '../composition/types';
import { baseMediaSize, videoRange } from '../composition/story';
import { filterById, viewFilters } from '../filters';

export type MediaTransformValues = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  scale: SharedValue<number>;
  rotation: SharedValue<number>;
};

type Props = {
  item: StoryDraftItem;
  /** Stage size in screen points; the canvas is 1080 × 1920 scaled to it. */
  width: number;
  height: number;
  playing: boolean;
  /** Where the media sits, in canvas units; moved on the UI thread by the stage's gestures. */
  transform: MediaTransformValues;
};

/** The trimmed stretch of a video, looping, with its sound unless muted. */
function StageVideo({ item, playing }: { item: StoryDraftItem; playing: boolean }) {
  const range = videoRange(item);
  const player = useVideoPlayer(item.media.uri, (instance) => {
    instance.loop = false;
    instance.muted = item.muted;
    instance.timeUpdateEventInterval = 0.1;
  });

  useEffect(() => {
    player.muted = item.muted;
  }, [item.muted, player]);
  useEffect(() => {
    player.currentTime = range.startMs / 1000;
  }, [player, range.startMs]);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  // The player belongs to this view: nothing keeps sounding after it closes.
  useEffect(() => () => {
    try {
      player.pause();
    } catch {
      // Already released.
    }
  }, [player]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const ms = currentTime * 1000;
    if (ms >= range.endMs || ms < range.startMs - 250) player.currentTime = range.startMs / 1000;
  });
  useEventListener(player, 'playToEnd', () => {
    player.currentTime = range.startMs / 1000;
    if (playing) player.play();
  });

  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="fill" nativeControls={false} surfaceType="textureView" />;
}

/**
 * A photo drawn at the screen's full sharpness. React Native's <Image> caps
 * a decoded bitmap at 2048 px and halved a camera photo until it fitted, which
 * looked hazy once stretched over the screen; a Nitro image sized to the
 * screen has no cap. The plain <Image> stays underneath until it is ready.
 */
function SharpPhoto({ uri }: { uri: string }) {
  const [picture, setPicture] = useState<NitroPicture | null>(() => displayImageFor(uri)?.picture ?? null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let entry = displayImageFor(uri);
      if (!entry) {
        const loaded = await fitForScreen(await Images.loadFromFileAsync(uri.replace(/^file:\/\//, '')));
        registerDisplayImage(uri, loaded);
        entry = { picture: loaded, sharpened: false };
      }
      if (alive) setPicture(entry.picture);
      // Show it at once, then swap in the sharpened copy.
      if (!entry.sharpened) {
        const sharp = await sharpenForPreview(entry.picture);
        registerDisplayImage(uri, sharp, true);
        if (alive) setPicture(sharp);
      }
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [uri]);

  return (
    <>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} />
      {picture ? <NativeNitroImage image={picture} resizeMode="cover" style={StyleSheet.absoluteFill} /> : null}
    </>
  );
}

/**
 * The story's base: the background, then the photo or video placed by its
 * transform, with the filter previewed. Native views keep the photo sharp and
 * video playback smooth; the posted story is rendered from the original file.
 */
export function MediaCanvas({ item, width, height, playing, transform }: Props) {
  const unit = width / CANVAS.width;
  const size = baseMediaSize(item.media, item.fitMode);
  const drawWidth = size.width * unit;
  const drawHeight = size.height * unit;
  const colours = item.background.length > 1 ? item.background : [item.background[0] ?? '#000', item.background[0] ?? '#000'];
  const filters = viewFilters(filterById(item.filterId).params);

  const placement = useAnimatedStyle(() => ({
    transform: [
      { translateX: transform.x.value * unit - drawWidth / 2 },
      { translateY: transform.y.value * unit - drawHeight / 2 },
      { rotate: `${transform.rotation.value}deg` },
      { scale: transform.scale.value },
    ],
  }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height, overflow: 'hidden' }]}>
      <LinearGradient colors={colours as [string, string, ...string[]]} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.media, { width: drawWidth, height: drawHeight }, placement, filters.length ? { filter: filters } : null]}>
        {item.media.kind === 'photo'
          ? <SharpPhoto uri={item.media.uri} />
          : <StageVideo item={item} playing={playing} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  media: { position: 'absolute', left: 0, top: 0 },
});
