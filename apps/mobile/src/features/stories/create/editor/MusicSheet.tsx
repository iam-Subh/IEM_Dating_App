import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../../services/api';
import type { LyricLine, MusicDisplay, MusicTrack, StoryMusic } from '../composition/types';
import { CENTER } from '../composition/types';
import { STORY_COLORS } from '../fonts';
import { MusicStickerView, lyricAt } from '../stickers/MusicStickerView';
import { useStoryBack } from '../backStack';

type Props = {
  /** A photo's clip is 5–15 s; a video's clip is the video's length. */
  kind: 'photo' | 'video';
  videoLengthMs?: number;
  initial?: (StoryMusic & { track: MusicTrack }) | null;
  onDone: (music: (StoryMusic & { track: MusicTrack }) | null) => void;
  onClose: () => void;
};

const PHOTO_CLIPS = [5000, 10_000, 15_000];

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function messageFor(error: any) {
  const code = error?.response?.data?.code;
  if (code === 'MUSIC_UNAVAILABLE') return 'Music is unavailable right now.';
  if (!error?.response) return 'No connection.';
  return 'Could not load music.';
}

/**
 * Instagram's music sheet: Trending before you type, search as you type, a
 * preview on each row. Choosing a song opens the clip picker: drag the window
 * along the song while the lyric at that point shows, pick how long the clip
 * is and how it appears on the story.
 */
export function MusicSheet({ kind, videoLengthMs, initial, onDone, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MusicTrack | null>(initial?.track ?? null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const player = useRef<AudioPlayer | null>(null);

  useStoryBack(() => {
    Keyboard.dismiss();
    onClose();
    return true;
  }, !selected);

  const stopPreview = useCallback(() => {
    player.current?.pause();
    player.current?.remove();
    player.current = null;
    setPreviewing(null);
  }, []);
  useEffect(() => stopPreview, [stopPreview]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const trimmed = query.trim();
        const response = trimmed
          ? await api.get('/stories/music/search', { params: { q: trimmed, page: 1 } })
          : await api.get('/stories/music/trending');
        if (active) setTracks(response.data.data.tracks ?? []);
      } catch (cause) {
        if (active) setError(messageFor(cause));
      } finally {
        if (active) setLoading(false);
      }
    }, query ? 300 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const preview = (track: MusicTrack) => {
    if (previewing === track.id) {
      stopPreview();
      return;
    }
    stopPreview();
    if (!track.streams.preview) return;
    const next = createAudioPlayer({ uri: track.streams.preview });
    player.current = next;
    // Previews start a third of the way in, where most songs have their hook.
    next.seekTo(Math.floor(track.durationMs / 3000)).catch(() => undefined);
    next.play();
    setPreviewing(track.id);
  };

  if (selected) {
    return (
      <ClipPicker
        track={selected}
        kind={kind}
        videoLengthMs={videoLengthMs}
        initial={initial?.track.id === selected.id ? initial : null}
        onBack={() => setSelected(null)}
        onDone={onDone}
      />
    );
  }

  return (
    <KeyboardAvoidingView behavior="height" automaticOffset style={[styles.sheet, { paddingTop: insets.top + 8, paddingBottom: insets.bottom }]}>
      <View style={styles.searchRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close music" onPress={() => { Keyboard.dismiss(); onClose(); }} style={styles.iconButton}>
          <Ionicons name="chevron-down" size={26} color="#fff" />
        </Pressable>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color="#A8A8A8" />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search music" placeholderTextColor="#A8A8A8" style={styles.searchInput} autoCorrect={false} />
        </View>
        {initial ? (
          <Pressable accessibilityRole="button" onPress={() => onDone(null)} style={styles.iconButton}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.section}>{query.trim() ? 'Songs' : 'Trending'}</Text>
      {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 40 }} /> : null}
      {error && !loading ? <Text style={styles.empty}>{error}</Text> : null}
      {!loading && !error && !tracks.length ? <Text style={styles.empty}>No songs found.</Text> : null}
      <FlatList
        data={loading ? [] : tracks}
        keyExtractor={(track) => track.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: track }) => (
          <Pressable style={styles.row} onPress={() => { Keyboard.dismiss(); stopPreview(); setSelected(track); }} accessibilityRole="button" accessibilityLabel={`${track.title} by ${track.artists}`}>
            {track.artwork.small ? <Image source={{ uri: track.artwork.small }} style={styles.art} /> : <View style={[styles.art, styles.artEmpty]}><Ionicons name="musical-notes" size={22} color="#777" /></View>}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.title}>{track.title}</Text>
              <Text numberOfLines={1} style={styles.artist}>
                {track.explicit ? <Text style={styles.explicit}> E </Text> : null}{track.explicit ? '  ' : ''}{track.artists} · {clock(track.durationMs)}
              </Text>
            </View>
            <Pressable hitSlop={10} onPress={() => preview(track)} accessibilityRole="button" accessibilityLabel={previewing === track.id ? 'Stop preview' : 'Play preview'} style={styles.iconButton}>
              <Ionicons name={previewing === track.id ? 'pause-circle' : 'play-circle'} size={30} color="#fff" />
            </Pressable>
          </Pressable>
        )}
      />
    </KeyboardAvoidingView>
  );
}

function ClipPicker({ track, kind, videoLengthMs, initial, onBack, onDone }: {
  track: MusicTrack;
  kind: 'photo' | 'video';
  videoLengthMs?: number;
  initial: (StoryMusic & { track: MusicTrack }) | null;
  onBack: () => void;
  onDone: Props['onDone'];
}) {
  const insets = useSafeAreaInsets();
  const duration = Math.max(1000, track.durationMs);
  const [lengthMs, setLengthMs] = useState(() => (kind === 'video'
    ? Math.min(duration, Math.max(1000, videoLengthMs ?? 15_000))
    : Math.min(duration, initial?.lengthMs ?? 15_000)));
  const [startMs, setStartMs] = useState(() => Math.min(initial?.startMs ?? Math.floor(duration / 3), Math.max(0, duration - lengthMs)));
  const [display, setDisplay] = useState<MusicDisplay>(initial?.display ?? 'lyrics');
  const [color, setColor] = useState(initial?.color ?? '#FFFFFF');
  const [lines, setLines] = useState<LyricLine[] | null>(null);
  const [lyricsState, setLyricsState] = useState<'loading' | 'found' | 'none'>('loading');
  const [playhead, setPlayhead] = useState(0);
  const [barWidth, setBarWidth] = useState(1);

  useStoryBack(() => {
    onBack();
    return true;
  });
  const player = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    let active = true;
    api.get(`/stories/music/${track.id}/lyrics`)
      .then((response) => {
        if (!active) return;
        const found: LyricLine[] = response.data.data.lines ?? [];
        setLines(found);
        setLyricsState(found.length ? 'found' : 'none');
        if (!found.length && display === 'lyrics') setDisplay('title');
      })
      .catch(() => {
        if (!active) return;
        setLyricsState('none');
        setDisplay((value) => (value === 'lyrics' ? 'title' : value));
      });
    return () => { active = false; };
    // Once per song.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  // Loop the chosen clip while picking.
  useEffect(() => {
    if (!track.streams.preview) return;
    const next = createAudioPlayer({ uri: track.streams.preview });
    player.current = next;
    next.play();
    return () => {
      next.pause();
      next.remove();
      player.current = null;
    };
  }, [track.streams.preview]);

  useEffect(() => {
    player.current?.seekTo(startMs / 1000).catch(() => undefined);
    setPlayhead(0);
  }, [startMs]);

  useEffect(() => {
    const timer = setInterval(() => {
      const current = player.current;
      if (!current) return;
      const offset = current.currentTime * 1000 - startMs;
      if (offset >= lengthMs || offset < -500) {
        current.seekTo(startMs / 1000).catch(() => undefined);
        setPlayhead(0);
      } else {
        setPlayhead(Math.max(0, offset));
      }
    }, 120);
    return () => clearInterval(timer);
  }, [lengthMs, startMs]);

  const windowFraction = lengthMs / duration;
  const windowWidth = Math.max(24, windowFraction * barWidth);

  // The clip window moves on the UI thread from where it already is. Its
  // position used to live in a plain variable, which the gesture's UI-thread
  // code copies, so every drag started again from the song's beginning.
  const windowX = useSharedValue((startMs / duration) * barWidth);
  const dragOrigin = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastScrub = useSharedValue(-1);
  const [scrubMs, setScrubMs] = useState<number | null>(null);

  useEffect(() => {
    if (dragging.value) return;
    windowX.value = (startMs / duration) * barWidth;
  }, [barWidth, dragging, duration, startMs, windowX]);

  const commitStart = useCallback((ms: number) => {
    setScrubMs(null);
    setStartMs(ms);
  }, []);

  const drag = useMemo(() => {
    const maxStartMs = Math.max(0, duration - lengthMs);
    const maxX = (maxStartMs / duration) * barWidth;
    const toMs = (x: number) => {
      'worklet';
      return Math.max(0, Math.min(maxStartMs, Math.round(((x / Math.max(1, barWidth)) * duration) / 100) * 100));
    };
    return Gesture.Pan()
      .minDistance(0)
      .onStart(() => {
        dragging.value = true;
        dragOrigin.value = windowX.value;
      })
      .onUpdate((event) => {
        windowX.value = Math.max(0, Math.min(maxX, dragOrigin.value + event.translationX));
        // The lyric and times follow the window, a few times a second.
        const step = Math.round(toMs(windowX.value) / 250) * 250;
        if (step !== lastScrub.value) {
          lastScrub.value = step;
          runOnJS(setScrubMs)(step);
        }
      })
      .onEnd(() => {
        runOnJS(commitStart)(toMs(windowX.value));
      })
      .onFinalize(() => {
        dragging.value = false;
        lastScrub.value = -1;
      });
  }, [barWidth, commitStart, dragOrigin, dragging, duration, lastScrub, lengthMs, windowX]);

  const windowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: windowX.value }] }));

  const music: StoryMusic = {
    provider: 'jiosaavn',
    trackId: track.id,
    title: track.title,
    artists: track.artists,
    artworkUrl: track.artwork.large ?? track.artwork.medium,
    startMs,
    lengthMs,
    display,
    color,
    videoVolume: initial?.videoVolume ?? 1,
    musicVolume: initial?.musicVolume ?? 1,
    transform: initial?.transform ?? { ...CENTER, y: display === 'lyrics' ? 1300 : 1450 },
  };
  const shownStartMs = scrubMs ?? startMs;
  const scrubLyric = lyricAt(lines, shownStartMs + (scrubMs === null ? playhead : 0));

  return (
    <View style={[styles.sheet, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.searchRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.iconButton}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" onPress={() => onDone({ ...music, track })} style={styles.iconButton}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <View style={styles.preview}>
        <MusicStickerView music={music} unit={0.34} lines={lines} timeMs={playhead} />
      </View>

      <View style={styles.styles}>
        {(['lyrics', 'album', 'title', 'hidden'] as MusicDisplay[]).map((option) => {
          const disabled = option === 'lyrics' && lyricsState !== 'found';
          return (
            <Pressable key={option} disabled={disabled} onPress={() => setDisplay(option)} style={[styles.styleChip, display === option && styles.styleChipActive, disabled && { opacity: 0.35 }]}>
              <Text style={[styles.styleText, display === option && styles.styleTextActive]}>{option === 'hidden' ? 'Hide' : option[0].toUpperCase() + option.slice(1)}</Text>
            </Pressable>
          );
        })}
      </View>
      {lyricsState === 'none' ? <Text style={styles.note}>Lyrics aren't available for this song</Text> : null}
      {display === 'lyrics' ? (
        <View style={styles.colours}>
          {STORY_COLORS.slice(0, 9).map((swatch) => (
            <Pressable key={swatch} onPress={() => setColor(swatch)} style={[styles.swatch, { backgroundColor: swatch }, color === swatch && styles.swatchActive]} />
          ))}
        </View>
      ) : null}

      <Text numberOfLines={1} style={styles.scrubLyric}>{scrubLyric?.text ?? ' '}</Text>
      <View style={styles.trackInfo}>
        <Text numberOfLines={1} style={styles.title}>{track.title}</Text>
        <Text numberOfLines={1} style={styles.artist}>{track.artists}</Text>
      </View>
      <GestureDetector gesture={drag}>
        <View style={styles.bar} onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}>
          {Array.from({ length: 48 }, (_, index) => (
            <View key={index} style={[styles.wave, { height: 10 + ((index * 37) % 26) }]} />
          ))}
          <Animated.View style={[styles.window, { left: 0, width: windowWidth }, windowStyle]}>
            {scrubMs === null ? <View style={[styles.playhead, { left: (playhead / lengthMs) * windowWidth }]} /> : null}
          </Animated.View>
        </View>
      </GestureDetector>
      <Text style={styles.note}>{clock(shownStartMs)} – {clock(shownStartMs + lengthMs)}</Text>
      {kind === 'photo' ? (
        <View style={styles.styles}>
          {PHOTO_CLIPS.filter((clip) => clip <= duration).map((clip) => (
            <Pressable key={clip} onPress={() => { setLengthMs(clip); setStartMs((value) => Math.min(value, Math.max(0, duration - clip))); }} style={[styles.styleChip, lengthMs === clip && styles.styleChipActive]}>
              <Text style={[styles.styleText, lengthMs === clip && styles.styleTextActive]}>{clip / 1000}s</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(18,18,18,0.97)' },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 6 },
  iconButton: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#262626', borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 0 },
  remove: { color: '#ED4956', fontWeight: '700' },
  section: { color: '#fff', fontWeight: '700', fontSize: 16, marginHorizontal: 16, marginTop: 14, marginBottom: 6 },
  empty: { color: '#A8A8A8', textAlign: 'center', marginTop: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  art: { width: 48, height: 48, borderRadius: 6, backgroundColor: '#333' },
  artEmpty: { alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 15, fontWeight: '600' },
  artist: { color: '#A8A8A8', fontSize: 13, marginTop: 2 },
  explicit: { backgroundColor: '#A8A8A8', color: '#121212', fontSize: 10, fontWeight: '800' },
  done: { color: '#fff', fontSize: 17, fontWeight: '700', paddingHorizontal: 8 },
  preview: { height: 260, alignItems: 'center', justifyContent: 'center' },
  styles: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 },
  styleChip: { paddingHorizontal: 16, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', justifyContent: 'center' },
  styleChipActive: { backgroundColor: '#fff', borderColor: '#fff' },
  styleText: { color: '#fff', fontWeight: '600' },
  styleTextActive: { color: '#000' },
  note: { color: '#A8A8A8', textAlign: 'center', marginTop: 8, fontSize: 13 },
  colours: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 12 },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff' },
  swatchActive: { transform: [{ scale: 1.25 }] },
  scrubLyric: { color: '#fff', textAlign: 'center', fontSize: 18, fontWeight: '700', marginTop: 24, marginHorizontal: 20 },
  trackInfo: { alignItems: 'center', marginTop: 10, marginHorizontal: 24 },
  bar: { height: 64, marginHorizontal: 20, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wave: { width: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  window: { position: 'absolute', top: 0, bottom: 0, borderRadius: 10, borderWidth: 3, borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.15)' },
  playhead: { position: 'absolute', top: 6, bottom: 6, width: 2, backgroundColor: '#fff' },
});
