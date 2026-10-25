import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { ChatMedia, hasStoryTools } from '../../../../../modules/chat-media';
import { Ionicons } from '@expo/vector-icons';
import { EmojiKeyboard } from 'rn-emoji-keyboard';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../../../services/api';
import type { FrameLayer, InteractiveSticker, InteractiveStickerType, Layer, StickerLayer } from '../composition/types';
import { CENTER } from '../composition/types';
import { localId } from '../composition/story';
import { importPhoto } from '../import';
import { STICKER_STYLES, StickerView } from '../stickers/StickerView';
import { useStoryBack } from '../backStack';
import { FRAME_PHOTO_EDGE } from '../composition/frame';
import { SelfieCapture } from '../stickers/SelfieCapture';
import { LayerContent } from './LayerContent';
import { useStorySettings } from '../../settings/storySettings';

type Mode = 'grid' | InteractiveStickerType | 'selfie';

type Props = {
  demo?: boolean;
  /** A placed sticker opened for editing: its creator opens filled in, and Done replaces it. */
  editing?: StickerLayer | FrameLayer | null;
  onUpdate?: (layer: Layer) => void;
  onAdd: (layer: Layer) => void;
  onOpenMusic: () => void;
  onClose: () => void;
};

const TILES: Array<{ id: Mode | 'music' | 'time' | 'photo' | 'addYoursMusic' | 'cutout'; label: string; icon: string }> = [
  { id: 'addYours', label: 'ADD YOURS', icon: 'camera' },
  { id: 'addYoursMusic', label: 'ADD YOURS MUSIC', icon: 'musical-note' },
  { id: 'location', label: 'LOCATION', icon: 'location-sharp' },
  { id: 'mention', label: 'MENTION', icon: 'at' },
  { id: 'music', label: 'MUSIC', icon: 'musical-notes' },
  { id: 'photo', label: 'PHOTO', icon: 'image' },
  { id: 'selfie', label: 'SELFIE', icon: 'camera-reverse' },
  { id: 'frame', label: 'FRAMES', icon: 'albums' },
  { id: 'cutout', label: 'CUTOUT', icon: 'cut' },
  { id: 'gif', label: 'GIF', icon: 'search' },
  { id: 'question', label: 'QUESTIONS', icon: 'chatbox-ellipses' },
  { id: 'poll', label: 'POLL', icon: 'stats-chart' },
  { id: 'quiz', label: 'QUIZ', icon: 'help-circle' },
  { id: 'slider', label: 'EMOJI SLIDER', icon: 'happy' },
  { id: 'countdown', label: 'COUNTDOWN', icon: 'timer' },
  { id: 'link', label: 'LINK', icon: 'link' },
  { id: 'hashtag', label: '#HASHTAG', icon: 'pricetag' },
  { id: 'reveal', label: 'REVEAL', icon: 'eye-off' },
  { id: 'time', label: 'TIME', icon: 'time' },
];

const DEMO_PEOPLE = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Aanya', avatarUrl: null },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Rohan', avatarUrl: null },
];
const SLIDER_EMOJIS = ['😍', '🔥', '😂', '😮', '😢', '👏', '💯', '🎉'];
const COUNTDOWN_PRESETS = [
  { label: '1 hour', ms: 3_600_000 },
  { label: 'Tonight', ms: 0 },
  { label: 'Tomorrow', ms: 86_400_000 },
  { label: '3 days', ms: 3 * 86_400_000 },
  { label: '1 week', ms: 7 * 86_400_000 },
];

const stickerLayer = (sticker: InteractiveSticker): Layer => ({ id: sticker.id, kind: 'sticker', sticker });

/** GIPHY repeats GIFs across pages; each is listed once. */
function uniqueGifs<T extends { id: string }>(gifs: T[]): T[] {
  const seen = new Set<string>();
  return gifs.filter((gif) => {
    if (seen.has(gif.id)) return false;
    seen.add(gif.id);
    return true;
  });
}
const freshBase = (y = 900) => ({ id: localId('s'), transform: { ...CENTER, y }, style: 'default' });

/** Placed stickers that open their creator again when tapped in the editor. */
export const EDITABLE_STICKERS = new Set<InteractiveStickerType>([
  'poll', 'quiz', 'question', 'slider', 'countdown', 'addYours', 'reveal', 'hashtag', 'link', 'mention', 'location', 'gif',
]);

type TrayFields = {
  mode: Mode; style: string; question: string; options: string[]; correct: number; emoji: string;
  countdownTitle: string; endsIn: number; text: string; label: string;
  framePhoto: { uri: string; width: number; height: number } | null; addYoursMusic: boolean;
};

/** The creator's fields: empty for a new sticker, or filled in from the one being edited. */
function initialFields(editing: StickerLayer | FrameLayer | null | undefined): TrayFields {
  const fields: TrayFields = {
    mode: 'grid', style: 'default', question: '', options: ['Yes', 'No'], correct: 0, emoji: '😍',
    countdownTitle: '', endsIn: 86_400_000, text: '', label: '', framePhoto: null, addYoursMusic: false,
  };
  if (!editing) return fields;
  if (editing.kind === 'frame') {
    return { ...fields, mode: 'frame', text: editing.caption, framePhoto: { uri: editing.uri, width: editing.width, height: editing.height } };
  }
  const sticker = editing.sticker;
  const common = { ...fields, mode: sticker.type as Mode, style: sticker.style };
  switch (sticker.type) {
    case 'poll': return { ...common, question: sticker.question, options: [...sticker.options] };
    case 'quiz': return { ...common, question: sticker.question, options: [...sticker.options], correct: sticker.correctIndex };
    case 'question': return { ...common, question: sticker.prompt };
    case 'slider': return { ...common, question: sticker.question, emoji: sticker.emoji };
    case 'countdown': return { ...common, countdownTitle: sticker.title === 'Countdown' ? '' : sticker.title, endsIn: Math.max(3_600_000, Date.parse(sticker.endsAt) - Date.now()) };
    case 'addYours': return { ...common, question: sticker.prompt, addYoursMusic: !!sticker.music };
    case 'reveal': return { ...common, text: sticker.hint };
    case 'hashtag': return { ...common, text: sticker.tag };
    case 'link': return { ...common, text: sticker.url, label: sticker.label ?? '' };
    default: return common;
  }
}

function Header({ title, canDone, onBack, onDone }: { title: string; canDone: boolean; onBack: () => void; onDone: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.iconButton}>
        <Ionicons name="chevron-back" size={26} color="#fff" />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <Pressable accessibilityRole="button" disabled={!canDone} onPress={onDone} style={styles.iconButton}>
        <Text style={[styles.done, !canDone && { opacity: 0.35 }]}>Done</Text>
      </Pressable>
    </View>
  );
}

function StylePicker({ value, onChange }: { value: string; onChange: (style: string) => void }) {
  return (
    <View style={styles.stylesRow}>
      {STICKER_STYLES.map((style) => (
        <Pressable key={style} onPress={() => onChange(style)} accessibilityLabel={`Style ${style}`} style={[styles.styleDot, value === style && styles.styleDotActive]}>
          <View style={[styles.styleFill, { backgroundColor: style === 'dark' ? '#262626' : style === 'blue' ? '#3897F0' : style === 'orange' ? '#F77737' : style === 'green' ? '#56AB2F' : '#C13584' }]} />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Instagram's sticker tray: a grid of stickers, an emoji keyboard below it,
 * and a creator for each interactive sticker with a live preview.
 */
export function StickerTray({ demo, editing, onUpdate, onAdd, onOpenMusic, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [initial] = useState(() => initialFields(editing));
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [style, setStyle] = useState(initial.style);
  const [question, setQuestion] = useState(initial.question);
  const [options, setOptions] = useState(initial.options);
  const [correct, setCorrect] = useState(initial.correct);
  const [emoji, setEmoji] = useState(initial.emoji);
  const [countdownTitle, setCountdownTitle] = useState(initial.countdownTitle);
  const [endsIn, setEndsIn] = useState(initial.endsIn);
  const [text, setText] = useState(initial.text);
  const [label, setLabel] = useState(initial.label);
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [gifOffset, setGifOffset] = useState<number | null>(0);
  // One next page at a time, and never one for an older search.
  const loadingMore = useRef(false);
  const latestText = useRef(text);
  latestText.current = text;
  // Frames: the chosen photo, at its size inside the frame.
  const [framePhoto, setFramePhoto] = useState(initial.framePhoto);
  const [addYoursMusic, setAddYoursMusic] = useState(initial.addYoursMusic);
  const [cutting, setCutting] = useState(false);
  // Reveal unlocks when a viewer replies, so it needs replies turned on.
  const { data: storySettings } = useStorySettings(!demo && mode === 'reveal');
  const repliesOff = !demo && storySettings?.replies === 'off';

  // Back leaves a sticker's creator for the grid, then closes the tray.
  // A sticker opened for editing goes straight back to the story.
  const closeTray = () => {
    Keyboard.dismiss();
    onClose();
  };
  const back = () => {
    Keyboard.dismiss();
    if (mode !== 'grid' && !editing) setMode('grid');
    else onClose();
  };
  useStoryBack(() => {
    back();
    return true;
  });

  const reset = (next: Mode) => {
    setMode(next);
    setStyle('default');
    setText('');
    setLabel('');
    setResults([]);
    setSearchError(null);
    if (next === 'poll') { setQuestion(''); setOptions(['Yes', 'No']); }
    if (next === 'quiz') { setQuestion(''); setOptions(['', '']); setCorrect(0); }
    if (next === 'question') setQuestion('Ask me a question');
    if (next === 'addYours') { setQuestion(''); setAddYoursMusic(false); }
    if (next === 'slider') { setQuestion(''); setEmoji('😍'); }
    if (next === 'countdown') { setCountdownTitle(''); setEndsIn(86_400_000); }
  };

  const add = (layer: Layer) => {
    Keyboard.dismiss();
    if (editing && onUpdate) onUpdate(layer);
    else onAdd(layer);
    onClose();
  };

  // An edited sticker keeps its id, place and colour.
  const base = (y = 900) => (editing
    ? { id: editing.id, transform: editing.kind === 'sticker' ? editing.sticker.transform : editing.transform, style: initial.style }
    : freshBase(y));

  // Search for mention, location and GIF.
  useEffect(() => {
    if (mode !== 'mention' && mode !== 'location' && mode !== 'gif') return;
    let active = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        if (mode === 'mention') {
          if (demo) {
            setResults(DEMO_PEOPLE.filter((person) => person.name.toLowerCase().includes(text.toLowerCase())));
          } else {
            const response = await api.get('/stories/mentions/search', { params: { q: text } });
            if (active) setResults(response.data.data.people);
          }
        } else if (mode === 'location') {
          if (text.trim().length < 2) {
            setResults([]);
          } else {
            let near: { lat: number; lon: number } | undefined;
            const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
            if (permission?.granted) {
              const position = await Location.getLastKnownPositionAsync().catch(() => null);
              if (position) near = { lat: position.coords.latitude, lon: position.coords.longitude };
            }
            const response = await api.get('/stories/locations/search', { params: { q: text, ...near } });
            if (active) setResults(response.data.data.places);
          }
        } else {
          const response = await api.get('/stories/gifs/search', { params: { q: text, offset: 0 } });
          if (active) {
            setResults(uniqueGifs(response.data.data.gifs));
            setGifOffset(response.data.data.nextOffset);
          }
        }
      } catch (error: any) {
        const code = error?.response?.data?.code;
        if (active) setSearchError(code === 'GIFS_UNAVAILABLE' ? "GIFs aren't available right now." : code === 'PLACES_UNAVAILABLE' ? 'Location search is unavailable right now.' : 'Could not search. Check your connection.');
      } finally {
        if (active) setSearching(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [demo, mode, text]);

  const choosePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return null;
    return importPhoto(result.assets[0].uri);
  };

  const pickPhoto = async () => {
    const photo = await choosePhoto();
    if (!photo) return;
    const longest = Math.max(photo.width, photo.height);
    add({ id: localId('p'), kind: 'photo', uri: photo.uri, width: (photo.width / longest) * 600, height: (photo.height / longest) * 600, shape: 'rounded', transform: { ...CENTER } });
  };

  const pickCutout = async () => {
    if (!ChatMedia || !hasStoryTools) {
      Alert.alert('Cutout', 'Update the app to use cutouts.');
      return;
    }
    const photo = await choosePhoto();
    if (!photo) return;
    setCutting(true);
    try {
      const cut = await ChatMedia.cutoutSubject(photo.uri);
      const longest = Math.max(cut.width, cut.height);
      add({ id: localId('p'), kind: 'photo', uri: cut.uri, width: (cut.width / longest) * 700, height: (cut.height / longest) * 700, shape: 'cutout', transform: { ...CENTER } });
    } catch (error: any) {
      const message = String(error?.message ?? '');
      Alert.alert(
        'Cutout',
        /download|module/i.test(message) ? 'Cutouts are still being set up on this phone. Try again in a minute.'
          : /subject/i.test(message) ? 'No person or object was found in this photo.'
            : 'This photo could not be cut out.',
      );
    } finally {
      setCutting(false);
    }
  };

  const pickFramePhoto = async () => {
    const photo = await choosePhoto();
    if (!photo) return;
    const longest = Math.max(photo.width, photo.height);
    reset('frame');
    setFramePhoto({ uri: photo.uri, width: Math.round((photo.width / longest) * FRAME_PHOTO_EDGE), height: Math.round((photo.height / longest) * FRAME_PHOTO_EDGE) });
  };

  const tile = (id: (typeof TILES)[number]['id']) => {
    if (id === 'music') { closeTray(); onOpenMusic(); return; }
    if (id === 'time') { add({ id: localId('m'), kind: 'time', style: 0, date: new Date().toISOString(), transform: { ...CENTER } }); return; }
    if (id === 'photo') { void pickPhoto(); return; }
    if (id === 'frame') { void pickFramePhoto(); return; }
    if (id === 'cutout') { void pickCutout(); return; }
    if (id === 'addYoursMusic') { reset('addYours'); setAddYoursMusic(true); return; }
    reset(id as Mode);
  };

  const container = [styles.sheet, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }];

  if (mode === 'grid') {
    return (
      <KeyboardAvoidingView behavior="height" automaticOffset style={container}>
        <View style={styles.header}>
          <View style={styles.grabber} />
          <Pressable accessibilityRole="button" accessibilityLabel="Close stickers" onPress={closeTray} style={[styles.iconButton, { position: 'absolute', right: 8 }]}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.grid}>
          {TILES.map((entry) => (
            <Pressable key={entry.id} onPress={() => tile(entry.id)} style={styles.tile} accessibilityRole="button" accessibilityLabel={entry.label}>
              <Ionicons name={entry.icon as any} size={18} color="#C13584" />
              <Text style={styles.tileText}>{entry.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.emoji}>
          <EmojiKeyboard
            onEmojiSelected={(picked: { emoji: string }) => add({ id: localId('e'), kind: 'emoji', emoji: picked.emoji, transform: { ...CENTER } })}
            enableSearchBar
            categoryPosition="top"
            theme={{ container: '#1C1C1E', header: '#fff', knob: '#555', category: { icon: '#aaa', iconActive: '#fff', container: '#1C1C1E', containerActive: '#333' }, search: { text: '#fff', placeholder: '#999', icon: '#999', background: '#2C2C2E' } }}
          />
        </View>
        {cutting ? (
          <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.hint}>Cutting out…</Text>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    );
  }

  if (mode === 'selfie') {
    return (
      <View style={container}>
        <SelfieCapture
          onCancel={() => setMode('grid')}
          onCaptured={(photo) => add({ id: localId('p'), kind: 'photo', uri: photo.uri, width: 520, height: 520, shape: 'circle', transform: { ...CENTER } })}
        />
      </View>
    );
  }

  if (mode === 'frame' && framePhoto) {
    const frame: Layer = editing?.kind === 'frame'
      ? { ...editing, caption: text.trim() }
      : { id: localId('f'), kind: 'frame', ...framePhoto, caption: text.trim(), transform: { ...CENTER } };
    return (
      <View style={container}>
        <Header title="Frames" canDone onBack={back} onDone={() => add(frame)} />
        <KeyboardAwareScrollView style={styles.form} bottomOffset={20} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.previewArea}>
            <LayerContent layer={frame} unit={0.5} />
          </View>
          <TextInput autoFocus value={text} onChangeText={setText} placeholder="Add a caption" placeholderTextColor="#999" style={styles.input} maxLength={30} />
          <Text style={styles.hint}>Viewers shake their phone or tap to develop the photo.</Text>
        </KeyboardAwareScrollView>
      </View>
    );
  }

  // Interactive sticker creators, each with a live preview.
  let preview: InteractiveSticker | null = null;
  let canDone = false;
  if (mode === 'poll') {
    preview = { ...base(), style, type: 'poll', question: question.trim(), options: options.map((option) => option.trim() || ' ') };
    canDone = options.filter((option) => option.trim()).length >= 2;
  } else if (mode === 'quiz') {
    preview = { ...base(), style, type: 'quiz', question: question.trim() || 'Ask a question', options: options.map((option, index) => option.trim() || String.fromCharCode(65 + index)), correctIndex: correct };
    canDone = !!question.trim() && options.every((option) => option.trim());
  } else if (mode === 'question') {
    preview = { ...base(), style, type: 'question', prompt: question.trim() || 'Ask me a question' };
    canDone = true;
  } else if (mode === 'slider') {
    preview = { ...base(), style, type: 'slider', question: question.trim(), emoji };
    canDone = true;
  } else if (mode === 'countdown') {
    const endsAt = new Date(endsIn === 0 ? new Date().setHours(21, 0, 0, 0) : Date.now() + endsIn).toISOString();
    preview = { ...base(), style, type: 'countdown', title: countdownTitle.trim() || 'Countdown', endsAt };
    canDone = Date.parse(endsAt) > Date.now();
  } else if (mode === 'addYours') {
    preview = { ...base(), style, type: 'addYours', prompt: question.trim() || 'Add a prompt', ...(addYoursMusic ? { music: true } : {}) };
    canDone = !!question.trim();
  } else if (mode === 'reveal') {
    preview = { ...base(), style, type: 'reveal', hint: text.trim() };
    canDone = !repliesOff;
  } else if (mode === 'hashtag') {
    const tag = text.replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 60);
    preview = tag ? { ...base(), style, type: 'hashtag', tag } : null;
    canDone = !!tag;
  } else if (mode === 'link') {
    const url = text.trim();
    const valid = /^(https?:\/\/)?[^\s/$.?#]+\.[^\s]{2,}$/i.test(url);
    preview = valid ? { ...base(), style, type: 'link', url: /^https?:\/\//i.test(url) ? url : `https://${url}`, ...(label.trim() ? { label: label.trim() } : {}) } : null;
    canDone = valid;
  }

  const titles: Record<string, string> = {
    poll: 'Poll', quiz: 'Quiz', question: 'Questions', slider: 'Emoji slider', countdown: 'Countdown',
    hashtag: 'Hashtag', link: 'Link', mention: 'Mention', location: 'Location', gif: 'GIF', reveal: 'Reveal',
    addYours: addYoursMusic ? 'Add Yours Music' : 'Add Yours',
  };

  if (mode === 'mention' || mode === 'location' || mode === 'gif') {
    return (
      <KeyboardAvoidingView behavior="height" automaticOffset style={container}>
        <Header title={titles[mode]} canDone={false} onBack={back} onDone={() => undefined} />
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color="#999" />
          <TextInput autoFocus value={text} onChangeText={setText} placeholder={mode === 'mention' ? 'Search people' : mode === 'location' ? 'Search a place' : 'Search GIPHY'} placeholderTextColor="#999" style={styles.searchInput} />
        </View>
        {mode === 'location' ? <Text style={styles.hint}>Only public places are shown, never home addresses.</Text> : null}
        {searching ? <ActivityIndicator color="#fff" style={{ marginTop: 24 }} /> : null}
        {searchError ? <Text style={styles.hint}>{searchError}</Text> : null}
        {mode === 'gif' ? (
          <FlatList
            data={results}
            numColumns={3}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 8 }}
            renderItem={({ item }) => (
              <Pressable style={styles.gifCell} onPress={() => add(stickerLayer({ ...base(), type: 'gif', url: item.url, width: 480, height: Math.round((480 * item.height) / Math.max(1, item.width)) }))}>
                <Image source={{ uri: item.previewUrl }} style={StyleSheet.absoluteFill} resizeMode="contain" />
              </Pressable>
            )}
            onEndReached={async () => {
              if (gifOffset === null || searching || loadingMore.current) return;
              loadingMore.current = true;
              const query = text;
              const response = await api.get('/stories/gifs/search', { params: { q: query, offset: gifOffset } }).catch(() => null);
              loadingMore.current = false;
              if (!response || latestText.current !== query) return;
              setResults((current) => uniqueGifs([...current, ...response.data.data.gifs]));
              setGifOffset(response.data.data.nextOffset);
            }}
          />
        ) : (
          <FlatList
            data={results}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id ?? item.placeId}
            renderItem={({ item }) => (
              <Pressable
                style={styles.resultRow}
                onPress={() => add(stickerLayer(mode === 'mention'
                  ? { ...base(1100), type: 'mention', userId: item.id, name: item.name }
                  : { ...base(1100), type: 'location', placeId: item.placeId, name: item.name }))}
              >
                {mode === 'mention'
                  ? (item.avatarUrl ? <Image source={{ uri: item.avatarUrl }} style={styles.avatar} /> : <View style={[styles.avatar, styles.center]}><Ionicons name="person" size={18} color="#999" /></View>)
                  : <View style={[styles.avatar, styles.center]}><Ionicons name="location-sharp" size={18} color="#fff" /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle}>{item.name}</Text>
                  {item.subtitle ? <Text style={styles.resultSubtitle}>{item.subtitle}</Text> : null}
                </View>
              </Pressable>
            )}
          />
        )}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={container}>
      <Header
        title={titles[mode]}
        canDone={canDone}
        onBack={back}
        onDone={() => {
          if (!preview) return;
          add(stickerLayer(preview));
          // Add Yours Music starts with your own song.
          if (preview.type === 'addYours' && preview.music) onOpenMusic();
        }}
      />
      <KeyboardAwareScrollView key={mode} style={styles.form} bottomOffset={20} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.previewArea}>
          {preview ? <StickerView sticker={preview} unit={0.42} mode="edit" tryOut /> : <Text style={styles.hint}>Type to preview</Text>}
          {mode === 'slider' ? <Text style={styles.hint}>Slide the emoji to try it</Text> : null}
        </View>
        <StylePicker value={style} onChange={setStyle} />

        {mode === 'poll' || mode === 'quiz' || mode === 'slider' || mode === 'question' ? (
          <TextInput value={question} onChangeText={setQuestion} placeholder={mode === 'question' ? 'Ask me a question' : mode === 'slider' ? 'Ask a question…' : 'Ask a question…'} placeholderTextColor="#999" style={styles.input} maxLength={120} />
        ) : null}

        {mode === 'poll' || mode === 'quiz' ? (
          <View style={{ gap: 8, marginHorizontal: 16 }}>
            {options.map((option, index) => (
              <View key={index} style={styles.optionRow}>
                {mode === 'quiz' ? (
                  <Pressable accessibilityLabel={`Mark option ${index + 1} correct`} onPress={() => setCorrect(index)} style={[styles.correct, correct === index && styles.correctActive]}>
                    {correct === index ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                  </Pressable>
                ) : null}
                <TextInput
                  value={option}
                  onChangeText={(value) => setOptions((current) => current.map((entry, position) => (position === index ? value : entry)))}
                  placeholder={`Option ${index + 1}`}
                  placeholderTextColor="#999"
                  style={[styles.input, { flex: 1, marginHorizontal: 0 }]}
                  maxLength={40}
                />
                {options.length > 2 ? (
                  <Pressable accessibilityLabel="Remove option" onPress={() => { setOptions((current) => current.filter((_, position) => position !== index)); setCorrect((value) => Math.min(value, options.length - 2)); }} style={styles.iconButton}>
                    <Ionicons name="close-circle" size={22} color="#999" />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {options.length < 4 ? (
              <Pressable onPress={() => setOptions((current) => [...current, ''])} style={styles.addOption}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addOptionText}>Add option</Text>
              </Pressable>
            ) : null}
            {mode === 'quiz' ? <Text style={styles.hint}>Tap the circle next to the correct answer.</Text> : null}
          </View>
        ) : null}

        {mode === 'slider' ? (
          <View style={styles.emojiRow}>
            {SLIDER_EMOJIS.map((entry) => (
              <Pressable key={entry} onPress={() => setEmoji(entry)} style={[styles.emojiChoice, emoji === entry && styles.emojiChoiceActive]}>
                <Text style={{ fontSize: 28 }}>{entry}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {mode === 'countdown' ? (
          <>
            <TextInput value={countdownTitle} onChangeText={setCountdownTitle} placeholder="Name your countdown" placeholderTextColor="#999" style={styles.input} maxLength={40} />
            <View style={styles.emojiRow}>
              {COUNTDOWN_PRESETS.map((preset) => (
                <Pressable key={preset.label} onPress={() => setEndsIn(preset.ms)} style={[styles.chip, endsIn === preset.ms && styles.chipActive]}>
                  <Text style={[styles.chipText, endsIn === preset.ms && styles.chipTextActive]}>{preset.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.stepperRow}>
              <Text style={styles.hint}>Ends in</Text>
              {[{ label: '−1 h', delta: -3_600_000 }, { label: '+1 h', delta: 3_600_000 }, { label: '−1 d', delta: -86_400_000 }, { label: '+1 d', delta: 86_400_000 }].map((step) => (
                <Pressable key={step.label} onPress={() => setEndsIn((value) => Math.max(3_600_000, Math.min(365 * 86_400_000, (value || 3_600_000) + step.delta)))} style={styles.chip}>
                  <Text style={styles.chipText}>{step.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {mode === 'addYours' ? (
          <>
            <TextInput autoFocus value={question} onChangeText={setQuestion} placeholder="Add a prompt" placeholderTextColor="#999" style={styles.input} maxLength={80} />
            <Text style={styles.hint}>{addYoursMusic ? 'People who join add a song that fits your prompt.' : 'People tap your sticker to add their own story to your prompt.'}</Text>
          </>
        ) : null}

        {mode === 'reveal' ? (
          <>
            <TextInput autoFocus value={text} onChangeText={setText} placeholder="Add a hint (optional)" placeholderTextColor="#999" style={styles.input} maxLength={60} />
            <Text style={styles.hint}>Your story is blurred for viewers until they send you a message. Only people you have matched with can message you.</Text>
            {repliesOff ? (
              <Text style={[styles.hint, { color: '#ED4956' }]}>Turn on replies to use Reveal: Settings, Story, Replies and reactions.</Text>
            ) : null}
          </>
        ) : null}

        {mode === 'hashtag' ? (
          <TextInput autoFocus value={text} onChangeText={setText} placeholder="#hashtag" placeholderTextColor="#999" style={styles.input} autoCapitalize="none" maxLength={61} />
        ) : null}

        {mode === 'link' ? (
          <>
            <TextInput autoFocus value={text} onChangeText={setText} placeholder="URL" placeholderTextColor="#999" style={styles.input} autoCapitalize="none" keyboardType="url" autoCorrect={false} />
            <TextInput value={label} onChangeText={setLabel} placeholder="Customise sticker text (optional)" placeholderTextColor="#999" style={styles.input} maxLength={40} />
            <Text style={styles.hint}>Links are checked for safety before your story posts.</Text>
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1 },
  sheet: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(20,20,20,0.96)' },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#666' },
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  iconButton: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  done: { color: '#fff', fontSize: 17, fontWeight: '700', paddingHorizontal: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, padding: 16 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, height: 40 },
  tileText: { color: '#C13584', fontWeight: '800', fontSize: 13 },
  emoji: { flex: 1, minHeight: 280 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 12, height: 42, borderRadius: 12, backgroundColor: '#2C2C2E' },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 0 },
  hint: { color: '#A8A8A8', textAlign: 'center', marginTop: 10, marginHorizontal: 20, fontSize: 13 },
  gifCell: { flex: 1 / 3, aspectRatio: 1, margin: 4, backgroundColor: '#2C2C2E', borderRadius: 8, overflow: 'hidden' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#3A3A3C' },
  center: { alignItems: 'center', justifyContent: 'center' },
  resultTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  resultSubtitle: { color: '#A8A8A8', fontSize: 13, marginTop: 2 },
  previewArea: { minHeight: 280, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  stylesRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 16 },
  styleDot: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  styleDotActive: { borderColor: '#fff' },
  styleFill: { width: 24, height: 24, borderRadius: 12 },
  input: { marginHorizontal: 16, marginBottom: 10, backgroundColor: '#2C2C2E', color: '#fff', borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 16 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  correct: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#999', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  correctActive: { backgroundColor: '#70C050', borderColor: '#70C050' },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  addOptionText: { color: '#fff', fontWeight: '600' },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginHorizontal: 16, marginBottom: 10 },
  emojiChoice: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  emojiChoiceActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', justifyContent: 'center' },
  chipActive: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: '#fff', fontWeight: '600' },
  chipTextActive: { color: '#000' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginHorizontal: 16 },
});
