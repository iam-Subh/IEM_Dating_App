import React from 'react';
import { Image, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LyricLine, StoryMusic } from '../composition/types';

/** The lyric on screen at a time: the line playing, or the next one during a short gap. */
export function lyricAt(lines: LyricLine[] | null | undefined, timeMs: number): LyricLine | null {
  if (!lines?.length) return null;
  const index = lines.findIndex((line) => timeMs >= line.startMs && timeMs < line.endMs);
  if (index >= 0) return lines[index].text ? lines[index] : null;
  return null;
}

/**
 * Words appear across the line's duration, each taking time in proportion to
 * its length. LRCLIB times lines, not words, so this is how Instagram's
 * word-by-word reveal is approximated.
 */
function revealedWords(line: LyricLine, timeMs: number) {
  const words = line.text.split(/\s+/).filter(Boolean);
  const total = words.reduce((sum, word) => sum + word.length + 1, 0);
  const elapsed = Math.max(0, Math.min(1, (timeMs - line.startMs) / Math.max(1, Math.min(line.endMs - line.startMs, 4000))));
  let shown = 0;
  let budget = elapsed * total;
  for (const word of words) {
    if (budget <= 0) break;
    budget -= word.length + 1;
    shown += 1;
  }
  return { words, shown: Math.max(1, shown) };
}

/**
 * The music sticker in its four styles: timed lyrics, an album card, a title
 * chip, or nothing (the song still plays).
 */
export function MusicStickerView({ music, unit, lines, timeMs }: { music: StoryMusic; unit: number; lines?: LyricLine[] | null; timeMs: number }) {
  const colour = music.color ?? '#FFFFFF';
  if (music.display === 'hidden') return null;
  if (music.display === 'lyrics') {
    const line = lyricAt(lines, music.startMs + timeMs);
    if (!line) {
      return <Text style={{ fontSize: 60 * unit, color: colour, opacity: 0.6, fontWeight: '800' }}>♪</Text>;
    }
    const { words, shown } = revealedWords(line, music.startMs + timeMs);
    return (
      <Text style={{ maxWidth: 900 * unit, textAlign: 'center', fontSize: 70 * unit, lineHeight: 86 * unit, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 }}>
        {words.map((word, index) => (
          <Text key={`${index}-${word}`} style={{ color: colour, opacity: index < shown ? 1 : 0.35 }}>{`${word} `}</Text>
        ))}
      </Text>
    );
  }
  if (music.display === 'album') {
    return (
      <View style={{ width: 460 * unit, backgroundColor: '#fff', borderRadius: 30 * unit, padding: 24 * unit, gap: 16 * unit }}>
        {music.artworkUrl
          ? <Image source={{ uri: music.artworkUrl }} style={{ width: 412 * unit, height: 412 * unit, borderRadius: 18 * unit }} />
          : <View style={{ width: 412 * unit, height: 412 * unit, borderRadius: 18 * unit, backgroundColor: '#EFEFEF', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="musical-notes" size={120 * unit} color="#999" /></View>}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 * unit }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 36 * unit, fontWeight: '700', color: '#262626' }}>{music.title}</Text>
            <Text numberOfLines={1} style={{ fontSize: 30 * unit, color: '#8E8E8E' }}>{music.artists}</Text>
          </View>
          <Ionicons name="musical-notes" size={40 * unit} color="#262626" />
        </View>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 * unit, backgroundColor: '#fff', borderRadius: 24 * unit, paddingVertical: 16 * unit, paddingHorizontal: 22 * unit, maxWidth: 860 * unit }}>
      {music.artworkUrl ? <Image source={{ uri: music.artworkUrl }} style={{ width: 84 * unit, height: 84 * unit, borderRadius: 10 * unit }} /> : null}
      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 38 * unit, fontWeight: '800', color: '#262626' }}>{music.title}</Text>
        <Text numberOfLines={1} style={{ fontSize: 30 * unit, color: '#8E8E8E' }}>{music.artists}</Text>
      </View>
      <Ionicons name="stats-chart" size={40 * unit} color="#262626" />
    </View>
  );
}
