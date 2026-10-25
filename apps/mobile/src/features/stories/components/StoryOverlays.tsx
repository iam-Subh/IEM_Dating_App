import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { api } from '../../../services/api';
import type { InteractiveSticker, LyricLine, StoryMusic, Transform } from '../create/composition/types';
import { CANVAS } from '../create/composition/types';
import { StickerView, type StickerState } from '../create/stickers/StickerView';
import { MusicStickerView } from '../create/stickers/MusicStickerView';
import { AddYoursSheet } from './AddYoursSheet';
import { useFonts } from 'expo-font';
import { STORY_FONT_SOURCES } from '../create/fonts';
import type { TrayStory } from '../storyTypes';

type Props = {
  story: TrayStory;
  width: number;
  height: number;
  isOwn: boolean;
  demo?: boolean;
  paused: boolean;
  progress: SharedValue<number>;
  onInteractingChange: (interacting: boolean) => void;
  showToast: (message: string) => void;
  /** Who posted the story, for resharing a mention. */
  ownerName?: string;
};

/** Where a canvas point lands on a full-screen story shown with "cover". */
function useCanvasMapping(width: number, height: number) {
  return useMemo(() => {
    const scale = Math.max(width / CANVAS.width, height / CANVAS.height);
    return { scale, offsetX: (width - CANVAS.width * scale) / 2, offsetY: (height - CANVAS.height * scale) / 2 };
  }, [height, width]);
}

function Placed({ transform, mapping, children }: { transform: Transform; mapping: ReturnType<typeof useCanvasMapping>; children: React.ReactNode }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  return (
    <View
      pointerEvents="box-none"
      onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
      style={{
        position: 'absolute',
        left: mapping.offsetX + transform.x * mapping.scale - size.width / 2,
        top: mapping.offsetY + transform.y * mapping.scale - size.height / 2,
        opacity: size.width ? 1 : 0,
        transform: [{ rotate: `${transform.rotation}deg` }, { scale: transform.scale }],
      }}
    >
      {children}
    </View>
  );
}

/**
 * What a story's composition draws live over its media: interactive stickers
 * that viewers answer, and the music sticker with its lyrics. On a photo story
 * the song plays here; on a video it was mixed into the video when posted.
 */
export function StoryOverlays({ story, width, height, isOwn, demo, paused, progress, onInteractingChange, showToast, ownerName }: Props) {
  const mapping = useCanvasMapping(width, height);
  // Animated text is drawn here, in the story's own fonts.
  useFonts(STORY_FONT_SOURCES);
  const composition = story.composition;
  const stickers = composition?.interactive ?? [];
  const music = composition?.music ?? null;
  const [states, setStates] = useState<Record<string, StickerState>>({});
  const [question, setQuestion] = useState<{ sticker: InteractiveSticker; state?: StickerState } | null>(null);
  // The card for a tapped mention, location or hashtag. `person` is undefined
  // until loaded (or in the demo), and null when the person is unavailable.
  const [info, setInfo] = useState<{
    sticker: InteractiveSticker;
    loading?: boolean;
    person?: { id: string; name: string; avatarUrl: string | null; isYou: boolean; matchId: string | null; canReshare?: boolean } | null;
  } | null>(null);
  const navigation = useNavigation<any>();
  const closeInfo = () => {
    setInfo(null);
    onInteractingChange(false);
  };
  const [addYours, setAddYours] = useState<Extract<InteractiveSticker, { type: 'addYours' }> | null>(null);
  const closeAddYours = () => {
    setAddYours(null);
    onInteractingChange(false);
  };
  const [reply, setReply] = useState('');
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [timeMs, setTimeMs] = useState(0);

  // Answers and results from the server.
  useEffect(() => {
    let active = true;
    setStates({});
    if (demo || !stickers.length) return;
    api.get(`/stories/${story.id}/stickers`)
      .then((response) => {
        if (!active) return;
        const next: Record<string, StickerState> = {};
        for (const sticker of response.data.data.stickers ?? []) next[sticker.key] = sticker;
        setStates(next);
      })
      .catch(() => undefined);
    return () => { active = false; };
    // Once per story.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  // Lyrics for the music sticker.
  useEffect(() => {
    let active = true;
    setLyrics(null);
    if (!music || music.display !== 'lyrics') return;
    api.get(`/stories/music/${music.trackId}/lyrics`).then((response) => { if (active) setLyrics(response.data.data.lines ?? []); }).catch(() => undefined);
    return () => { active = false; };
  }, [music?.trackId, music?.display]);

  // The lyric follows the story's own clock.
  const durationMs = story.durationMs ?? 5000;
  const updateTime = useCallback((value: number) => setTimeMs(value), []);
  useAnimatedReaction(() => Math.floor((progress.value * durationMs) / 120), (step, previous) => {
    if (step !== previous) runOnJS(updateTime)(step * 120);
  }, [durationMs]);

  // A photo story's song.
  const player = useRef<AudioPlayer | null>(null);
  const isPhoto = story.contentType.startsWith('image/');
  useEffect(() => {
    if (!music || !isPhoto) return;
    let cancelled = false;
    (async () => {
      const response = await api.get(`/stories/music/${music.trackId}`).catch(() => null);
      const url = response?.data?.data?.track?.streams?.preview;
      if (!url || cancelled) return;
      const next = createAudioPlayer({ uri: url });
      next.volume = music.musicVolume ?? 1;
      await next.seekTo(music.startMs / 1000).catch(() => undefined);
      if (cancelled) {
        next.remove();
        return;
      }
      player.current = next;
      if (!paused) next.play();
    })();
    return () => {
      cancelled = true;
      player.current?.pause();
      player.current?.remove();
      player.current = null;
    };
    // Once per story.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);
  useEffect(() => {
    if (!player.current) return;
    if (paused) player.current.pause();
    else player.current.play();
  }, [paused]);

  const respond = useCallback(async (sticker: InteractiveSticker, body: { option?: number; value?: number; subscribe?: boolean; text?: string }) => {
    const key = sticker.id;
    const current = states[key];
    if (demo || !current) {
      // Demo mode, or results not loaded: answer locally.
      setStates((all) => {
        const previous = all[key] ?? { id: key, myResponse: null, results: null };
        if (sticker.type === 'poll' || sticker.type === 'quiz') {
          const counts = sticker.options.map((_, index) => (index === body.option ? 1 : 0));
          return { ...all, [key]: { ...previous, myResponse: { option: body.option }, results: { counts, total: 1, ...(sticker.type === 'quiz' ? { correctIndex: sticker.correctIndex } : {}) } } };
        }
        if (sticker.type === 'slider') return { ...all, [key]: { ...previous, myResponse: { value: body.value }, results: { average: body.value, total: 1 } } };
        if (sticker.type === 'countdown') return { ...all, [key]: { ...previous, subscribed: body.subscribe } };
        return all;
      });
      if (body.subscribe) showToast("You'll get a reminder");
      if (body.text) showToast('Sent');
      return;
    }
    try {
      const response = await api.post(`/stories/${story.id}/stickers/${current.id}/responses`, body);
      const updated = response.data.data;
      if (updated) setStates((all) => ({ ...all, [key]: updated }));
      if (body.subscribe) showToast("You'll get a reminder");
      if (body.text) showToast('Sent');
    } catch (error: any) {
      showToast(error?.response?.data?.message ?? 'Could not send. Try again');
    }
  }, [demo, showToast, states, story.id]);

  const openSticker = useCallback((sticker: InteractiveSticker) => {
    const state = states[sticker.id];
    switch (sticker.type) {
      case 'question':
        if (isOwn) {
          showToast(`${state?.results?.replies ?? 0} replies`);
          return;
        }
        setReply('');
        setQuestion({ sticker, state });
        onInteractingChange(true);
        return;
      case 'link': {
        const host = sticker.url.replace(/^https?:\/\//i, '').split('/')[0];
        onInteractingChange(true);
        Alert.alert('Open link?', `This link will take you to ${host}.`, [
          { text: 'Cancel', style: 'cancel', onPress: () => onInteractingChange(false) },
          {
            text: 'Open',
            onPress: async () => {
              onInteractingChange(false);
              let url = sticker.url;
              if (!demo && state) {
                const response = await api.post(`/stories/${story.id}/stickers/${state.id}/link-tap`).catch(() => null);
                url = response?.data?.data?.url ?? url;
              }
              Linking.openURL(url).catch(() => showToast('Could not open the link'));
            },
          },
        ], { cancelable: true, onDismiss: () => onInteractingChange(false) });
        return;
      }
      case 'mention':
        onInteractingChange(true);
        setInfo({ sticker, loading: !demo });
        if (!demo) {
          api.get(`/stories/people/${sticker.userId}`, { params: { storyId: story.id } })
            .then((response) => setInfo((current) => (current?.sticker.id === sticker.id ? { ...current, loading: false, person: response.data.data } : current)))
            .catch(() => setInfo((current) => (current?.sticker.id === sticker.id ? { ...current, loading: false, person: null } : current)));
        }
        return;
      case 'location':
      case 'hashtag':
        onInteractingChange(true);
        setInfo({ sticker });
        return;
      case 'addYours':
        if (demo) {
          showToast('Add Yours works on posted stories');
          return;
        }
        onInteractingChange(true);
        setAddYours(sticker);
        return;
      default:
    }
  }, [demo, isOwn, onInteractingChange, showToast, states, story.id]);

  if (!stickers.length && !music) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {stickers.map((sticker) => (
        <Placed key={sticker.id} transform={sticker.transform} mapping={mapping}>
          <StickerView
            sticker={sticker}
            unit={mapping.scale}
            mode="view"
            isOwner={isOwn}
            state={states[sticker.id] ?? null}
            onRespond={(body) => void respond(sticker, body)}
            onOpen={() => openSticker(sticker)}
            timeMs={sticker.type === 'captions' ? timeMs : undefined}
          />
        </Placed>
      ))}
      {music && music.display !== 'hidden' ? (
        <Placed transform={music.transform ?? { x: 540, y: 1400, scale: 1, rotation: 0 }} mapping={mapping}>
          <Pressable onPress={() => showToast(`${music.title} · ${music.artists}`)}>
            <MusicStickerView music={music as StoryMusic} unit={mapping.scale} lines={lyrics} timeMs={timeMs} />
          </Pressable>
        </Placed>
      ) : null}

      <Modal visible={info !== null} transparent animationType="slide" onRequestClose={closeInfo}>
        <Pressable style={styles.infoBackdrop} onPress={closeInfo}>
          <Pressable style={styles.infoCard} onPress={() => undefined}>
            {info?.sticker.type === 'mention' ? (
              <>
                {info.person?.avatarUrl
                  ? <Image source={{ uri: info.person.avatarUrl }} style={styles.infoAvatar} />
                  : <View style={[styles.infoAvatar, styles.infoIcon]}><Ionicons name="person" size={30} color="#999" /></View>}
                <Text style={styles.infoTitle}>{info.person?.name ?? info.sticker.name}</Text>
                {info.loading ? <ActivityIndicator color="#262626" /> : null}
                {!info.loading && info.person?.isYou ? <Text style={styles.infoNote}>{isOwn ? 'This is you' : 'You were mentioned in this story'}</Text> : null}
                {/* Only when its owner allows resharing, and never for a Close Friends story. */}
                {!info.loading && info.person?.isYou && !isOwn && !demo && info.person.canReshare ? (
                  <Pressable
                    style={styles.infoButton}
                    onPress={() => {
                      closeInfo();
                      navigation.navigate('CreateStory', { reshare: { storyId: story.id, ownerName: ownerName ?? 'someone' } });
                    }}
                  >
                    <Text style={styles.infoButtonText}>Add to your story</Text>
                  </Pressable>
                ) : null}
                {!info.loading && info.person && !info.person.isYou && info.person.matchId ? (
                  <Pressable
                    style={styles.infoButton}
                    onPress={() => {
                      const person = info.person!;
                      closeInfo();
                      navigation.navigate('ChatProfile', { matchId: person.matchId, userId: person.id, userName: person.name, userAvatar: person.avatarUrl });
                    }}
                  >
                    <Text style={styles.infoButtonText}>View profile</Text>
                  </Pressable>
                ) : null}
                {!info.loading && info.person && !info.person.isYou && !info.person.matchId ? <Text style={styles.infoNote}>You can see their profile once you match</Text> : null}
                {!info.loading && info.person === null ? <Text style={styles.infoNote}>This person is unavailable</Text> : null}
              </>
            ) : null}
            {info?.sticker.type === 'location' ? (
              <>
                <View style={[styles.infoAvatar, styles.infoIcon]}><Ionicons name="location-sharp" size={30} color="#C13584" /></View>
                <Text style={styles.infoTitle}>{info.sticker.name}</Text>
                <Pressable
                  style={styles.infoButton}
                  onPress={() => {
                    const query = encodeURIComponent(info.sticker.type === 'location' ? info.sticker.name : '');
                    closeInfo();
                    Linking.openURL(`geo:0,0?q=${query}`).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(() => showToast('Could not open Maps')));
                  }}
                >
                  <Text style={styles.infoButtonText}>Open in Maps</Text>
                </Pressable>
              </>
            ) : null}
            {info?.sticker.type === 'hashtag' ? (
              <>
                <View style={[styles.infoAvatar, styles.infoIcon]}><Text style={styles.hash}>#</Text></View>
                <Text style={styles.infoTitle}>#{info.sticker.tag}</Text>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <AddYoursSheet
        sticker={addYours}
        onClose={closeAddYours}
        onJoin={(sticker) => {
          closeAddYours();
          navigation.navigate('CreateStory', { addYours: { threadId: sticker.threadId, prompt: sticker.prompt, music: !!sticker.music } });
        }}
        onWatch={(groups, index) => {
          closeAddYours();
          navigation.push('StoryViewer', { groups, startGroupIndex: index });
        }}
      />

      <Modal visible={question !== null} transparent animationType="fade" onRequestClose={() => { setQuestion(null); onInteractingChange(false); }}>
        <Pressable style={styles.backdrop} onPress={() => { setQuestion(null); onInteractingChange(false); }}>
          <Pressable style={styles.replyCard} onPress={() => undefined}>
            <Text style={styles.replyPrompt}>{question?.sticker.type === 'question' ? question.sticker.prompt : ''}</Text>
            <TextInput autoFocus value={reply} onChangeText={setReply} placeholder="Type something…" placeholderTextColor="#999" style={styles.replyInput} maxLength={300} multiline />
            <Pressable
              disabled={!reply.trim()}
              onPress={() => {
                const current = question;
                setQuestion(null);
                onInteractingChange(false);
                if (current) void respond(current.sticker, { text: reply.trim() });
              }}
              style={[styles.send, !reply.trim() && { opacity: 0.4 }]}
            >
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  replyCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 14 },
  replyPrompt: { fontSize: 18, fontWeight: '700', color: '#262626', textAlign: 'center' },
  replyInput: { minHeight: 70, borderRadius: 12, backgroundColor: '#F2F2F2', paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#262626' },
  send: { alignSelf: 'flex-end', backgroundColor: '#3897F0', borderRadius: 18, paddingHorizontal: 20, paddingVertical: 9 },
  sendText: { color: '#fff', fontWeight: '700' },
  infoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  infoCard: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 22, paddingBottom: 34, paddingHorizontal: 24, alignItems: 'center', gap: 12 },
  infoAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#EFEFEF' },
  infoIcon: { alignItems: 'center', justifyContent: 'center' },
  infoTitle: { fontSize: 18, fontWeight: '700', color: '#262626', textAlign: 'center' },
  infoNote: { fontSize: 14, color: '#8E8E8E', textAlign: 'center' },
  infoButton: { alignSelf: 'stretch', backgroundColor: '#3897F0', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  infoButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  hash: { fontSize: 34, fontWeight: '800', color: '#262626' },
});
