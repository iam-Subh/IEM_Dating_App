import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { api } from '../../../services/api';
import { ProfileVideoPlayer } from './ProfileVideoPlayer';

const frames = new Map<string, string>();

export function useProfileVideoPreview(source?: string) {
  const [poster, setPoster] = useState<string | null>(() => source ? frames.get(source) ?? null : null);
  const [playback, setPlayback] = useState(source);
  const [loading, setLoading] = useState(Boolean(source && !poster));
  const [extractFrame, setExtractFrame] = useState(false);

  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        if (!extractFrame) {
          try {
            const response = await api.get('/profile/video', { signal: controller.signal });
            if (!active) return;
            const video = response.data?.data;
            if (video?.status === 'ready' && video.url) setPlayback(video.url);
            if (video?.posterUrl) {
              setPoster(video.posterUrl);
              return;
            }
          } catch {
            if (!active) return;
          }
          const cached = frames.get(source);
          if (cached) { setPoster(cached); return; }
        }
        const frame = await VideoThumbnails.getThumbnailAsync(source, { time: 0, quality: 0.7 });
        if (!active) return;
        if (frames.size >= 20) frames.delete(frames.keys().next().value!);
        frames.set(source, frame.uri);
        setPoster(frame.uri);
      } catch {
        if (active) setPoster(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, [source, extractFrame]);

  const onPosterError = () => {
    setPoster(null);
    if (!extractFrame) setExtractFrame(true);
  };
  return { poster, playback, loading, onPosterError };
}

export function ProfileVideoPreview({ source, onEdit }: { source?: string; onEdit: () => void }) {
  const { poster, playback, loading, onPosterError } = useProfileVideoPreview(source);
  const [playing, setPlaying] = useState(false);

  return <>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={source ? 'Play profile video' : 'Add profile video'} activeOpacity={0.85} onPress={() => source ? setPlaying(true) : onEdit()} style={s.row}>
      <View style={s.thumbnail}>
        {poster && <Image source={{ uri: poster }} resizeMode="cover" style={StyleSheet.absoluteFill} onError={onPosterError} />}
        <View style={s.play}>
          {loading && !poster ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name={source ? 'play' : 'add'} size={20} color="#fff" />}
        </View>
      </View>
      <View style={s.copy}>
        <Text style={s.title}>{source ? 'Watch your video' : 'Add your video'}</Text>
        <Text style={s.subtitle}>{source ? (loading && !poster ? 'Loading preview…' : poster ? 'Tap to watch' : 'Play video · Preview unavailable') : 'Add a video, up to 60 seconds'}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#C7C3BE" />
    </TouchableOpacity>
    {playing && playback && <ProfileVideoPlayer url={playback} posterUrl={poster} onClose={() => setPlaying(false)} />}
  </>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbnail: { width: 94, height: 76, borderRadius: 12, overflow: 'hidden', backgroundColor: '#333331', alignItems: 'center', justifyContent: 'center' },
  play: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#F7F5F1' },
  subtitle: { marginTop: 4, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, color: '#C7C3BE' },
});
