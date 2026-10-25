import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Layer } from '../composition/types';
import { AnimatedStoryText, StoryText } from './StoryText';
import { fontById } from '../fonts';
import { StickerView } from '../stickers/StickerView';
import { FRAME_CAPTION, frameLayout } from '../composition/frame';

export { StoryText } from './StoryText';

const TIME_FORMATS: Array<(date: Date) => string> = [
  (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  (date) => date.toLocaleDateString([], { weekday: 'long' }).toUpperCase(),
  (date) => date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }),
];

/** A layer's content at its natural size, before its transform. */
export function LayerContent({ layer, unit }: { layer: Layer; unit: number }) {
  switch (layer.kind) {
    case 'text':
      return layer.animation ? <AnimatedStoryText layer={layer} unit={unit} /> : <StoryText layer={layer} unit={unit} />;
    case 'emoji':
      return <Text style={{ fontSize: 200 * unit, lineHeight: 240 * unit }}>{layer.emoji}</Text>;
    case 'gif':
      return <Image source={{ uri: layer.url }} style={{ width: layer.width * unit, height: layer.height * unit }} resizeMode="contain" />;
    case 'time': {
      const label = TIME_FORMATS[layer.style](new Date(layer.date));
      return layer.style === 0 ? (
        <View style={[styles.timeCard, { borderRadius: 30 * unit, paddingHorizontal: 40 * unit, paddingVertical: 16 * unit }]}>
          <Text style={{ fontSize: 110 * unit, fontWeight: '300', color: '#262626', fontVariant: ['tabular-nums'] }}>{label}</Text>
        </View>
      ) : (
        <Text style={{ fontSize: (layer.style === 1 ? 96 : 64) * unit, fontWeight: '800', color: '#fff', letterSpacing: 2 * unit, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 }}>{label}</Text>
      );
    }
    case 'photo':
      if (layer.shape === 'cutout') {
        return <Image source={{ uri: layer.uri }} style={{ width: layer.width * unit, height: layer.height * unit }} resizeMode="contain" />;
      }
      return (
        <Image
          source={{ uri: layer.uri }}
          style={{
            width: layer.width * unit,
            height: layer.height * unit,
            borderRadius: layer.shape === 'circle' ? (Math.min(layer.width, layer.height) * unit) / 2 : layer.shape === 'rounded' ? 40 * unit : 0,
            borderWidth: 10 * unit,
            borderColor: '#fff',
          }}
        />
      );
    case 'sticker':
      return <StickerView sticker={layer.sticker} unit={unit} mode="edit" />;
    case 'frame': {
      const box = frameLayout(layer.width, layer.height);
      return (
        <View style={{ width: box.width * unit, height: box.height * unit, backgroundColor: '#FBFAF6', borderRadius: 8 * unit, borderWidth: 2 * unit, borderColor: '#E4E1D8' }}>
          <Image source={{ uri: layer.uri }} style={{ position: 'absolute', left: box.photo.left * unit, top: box.photo.top * unit, width: layer.width * unit, height: layer.height * unit }} />
          <Text
            numberOfLines={1}
            style={{ position: 'absolute', left: box.photo.left * unit, right: box.photo.left * unit, top: (box.photo.top + layer.height) * unit, height: FRAME_CAPTION * unit, textAlign: 'center', textAlignVertical: 'center', fontFamily: fontById('signature').family, fontSize: 64 * unit, color: '#2B2B2B', includeFontPadding: false }}
          >
            {layer.caption}
          </Text>
        </View>
      );
    }
    case 'replyCard':
      return (
        <View style={{ width: 780 * unit, borderRadius: 40 * unit, overflow: 'hidden', backgroundColor: '#fff' }}>
          <LinearGradient colors={['#8A3AB9', '#E1306C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 34 * unit, paddingHorizontal: 40 * unit }}>
            <Text style={{ color: '#fff', fontSize: 44 * unit, fontWeight: '700', textAlign: 'center' }}>{layer.prompt}</Text>
          </LinearGradient>
          <Text style={{ color: '#262626', fontSize: 54 * unit, fontWeight: '600', textAlign: 'center', paddingVertical: 44 * unit, paddingHorizontal: 40 * unit }}>{layer.text}</Text>
        </View>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  timeCard: { backgroundColor: '#fff' },
});
