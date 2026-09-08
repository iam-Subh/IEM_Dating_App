import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { api } from '../../services/api';
import { colors } from '../../core/theme/colors';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';

const ITEM_MS = 6000;

const StoryVideo = ({ uri, paused, label }: { uri: string; paused: boolean; label: string }) => {
  const player = useVideoPlayer(uri, (value) => { value.loop = true; if (!paused) value.play(); });
  useEffect(() => { if (paused) player.pause(); else player.play(); }, [paused, player]);
  return <VideoView accessible accessibilityLabel={label} player={player} style={styles.media} contentFit="contain" nativeControls={false} />;
};

function groupOldestFirst(items: any[]) {
  const owners: string[] = [];
  const groups = new Map<string, any[]>();
  for (const item of items) {
    if (!groups.has(item.ownerId)) { owners.push(item.ownerId); groups.set(item.ownerId, []); }
    groups.get(item.ownerId)!.push(item);
  }
  return owners.flatMap((ownerId) => groups.get(ownerId)!.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime()));
}

export const StoryViewerScreen = ({ route, navigation }: any) => {
  const initial = route.params.stories ?? (route.params.story ? [route.params.story] : []);
  const orderedInitial = groupOldestFirst(initial);
  const initialId = route.params.initialStoryId ?? route.params.story?.id ?? route.params.storyId;
  const [items, setItems] = useState<any[]>(orderedInitial);
  const [index, setIndex] = useState(() => Math.max(0, orderedInitial.findIndex((item) => item.id === initialId)));
  const [sources, setSources] = useState<Record<string, { url: string; contentType: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [held, setHeld] = useState(false);
  const [backgrounded, setBackgrounded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewers, setViewers] = useState<any[]>([]);
  const [viewerCursor, setViewerCursor] = useState<string | null>(null);
  const currentUserId = useSelector((state: RootState) => state.auth.user?.id);
  const startedAt = useRef(Date.now());
  const story = items[index];
  const source = story ? sources[story.id] : null;
  const paused = held || backgrounded || dialogOpen || viewerOpen || loading || !!error;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setBackgrounded(state !== 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (items.length || !initialId) return;
    api.get(`/stories/${initialId}`).then((response) => setItems([response.data.data])).catch(() => setError('This Story is unavailable.'));
  }, [initialId, items.length]);

  useEffect(() => {
    if (!story) return;
    let active = true;
    setLoading(!sources[story.id]);
    setError(null);
    setProgress(0);
    startedAt.current = Date.now();
    const load = async (item: any, foreground: boolean) => {
      if (sources[item.id]) { if (foreground) setLoading(false); return; }
      const response = await api.get(`/stories/${item.id}/media`);
      const nextSource = response.data.data;
      if (!active) return;
      setSources((current) => ({ ...current, [item.id]: nextSource }));
      if (nextSource.contentType.startsWith('image/')) Image.prefetch(nextSource.url).catch(() => undefined);
      if (foreground) setLoading(false);
    };
    load(story, true).catch(() => { if (active) { setLoading(false); setError('This Story expired or you no longer have access.'); } });
    items.slice(index + 1, index + 3).forEach((item) => load(item, false).catch(() => undefined));
    const viewTimer = setTimeout(() => api.post(`/stories/${story.id}/views`).catch(() => undefined), 700);
    return () => { active = false; clearTimeout(viewTimer); };
  }, [index, story?.id]);

  const move = useCallback((step: number) => {
    const next = index + step;
    if (next < 0) return;
    if (next >= items.length) { navigation.goBack(); return; }
    setIndex(next);
  }, [index, items.length, navigation]);

  useEffect(() => {
    if (paused || !story) return;
    startedAt.current = Date.now() - progress * ITEM_MS;
    const timer = setInterval(() => {
      const next = Math.min(1, (Date.now() - startedAt.current) / ITEM_MS);
      setProgress(next);
      if (next >= 1) move(1);
    }, 80);
    return () => clearInterval(timer);
  }, [paused, story?.id, move]);

  const loadViewers = async (restart = false) => {
    if (!story) return;
    const response = await api.get(`/stories/${story.id}/viewers`, { params: { cursor: restart ? undefined : viewerCursor, limit: 50 } });
    const data = response.data.data;
    setViewers((current) => restart ? data.items : [...current, ...data.items]);
    setViewerCursor(data.nextCursor);
  };

  const openMenu = () => {
    if (!story) return;
    setDialogOpen(true);
    const closeDialog = () => setDialogOpen(false);
    if (story.ownerId === currentUserId) {
      Alert.alert('Story options', undefined, [
        { text: 'View viewers', onPress: () => { closeDialog(); setViewerOpen(true); void loadViewers(true); } },
        { text: 'Delete Story', style: 'destructive', onPress: async () => { await api.delete(`/stories/${story.id}`); closeDialog(); const remaining = items.filter((item) => item.id !== story.id); if (!remaining.length) navigation.goBack(); else { setItems(remaining); setIndex(Math.min(index, remaining.length - 1)); } } },
        { text: 'Cancel', style: 'cancel', onPress: closeDialog },
      ], { cancelable: true, onDismiss: closeDialog });
    } else {
      Alert.alert('Story options', undefined, [
        { text: 'Mute Stories', onPress: async () => { await api.put(`/stories/authors/${story.ownerId}/mute`, { muted: true }); closeDialog(); navigation.goBack(); } },
        { text: 'Report Story', style: 'destructive', onPress: async () => { await api.post('/safety/report', { reportedUserId: story.ownerId, reason: 'inappropriate_story', sourceType: 'story', sourceId: story.id }); closeDialog(); Alert.alert('Report sent', 'The safety team will review this Story.'); } },
        { text: 'Cancel', style: 'cancel', onPress: closeDialog },
      ], { cancelable: true, onDismiss: closeDialog });
    }
  };

  const segments = useMemo(() => items.map((item, itemIndex) => ({ id: item.id, value: itemIndex < index ? 1 : itemIndex === index ? progress : 0 })), [items, index, progress]);
  if (!story) return <View style={styles.container}><Text accessibilityRole="alert" style={styles.stateText}>{error ?? 'No active Stories.'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close Stories" onPress={() => navigation.goBack()}><Text style={styles.stateAction}>Close</Text></Pressable></View>;

  return <View
    style={styles.container}
    onTouchStart={() => setHeld(true)}
    onTouchEnd={() => setHeld(false)}
    onTouchCancel={() => setHeld(false)}
  >
    {source && !error ? (source.contentType.startsWith('video/') ? <StoryVideo uri={source.url} paused={paused} label={`Video Story from ${story.owner?.name ?? 'this student'}`} /> : <Image accessible accessibilityLabel={`Photo Story from ${story.owner?.name ?? 'this student'}`} source={{ uri: source.url }} style={styles.media} resizeMode="contain" />) : null}
    {loading && <View accessibilityLiveRegion="polite" style={styles.stateOverlay}><ActivityIndicator accessibilityLabel="Loading Story" color="#fff" /><Text style={styles.stateText}>Loading Story…</Text></View>}
    {!!error && <View accessibilityRole="alert" style={styles.stateOverlay}><Text style={styles.stateText}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Go to next Story" onPress={() => move(1)}><Text style={styles.stateAction}>Next Story</Text></Pressable></View>}
    <View accessible accessibilityRole="progressbar" accessibilityLabel={`Story ${index + 1} of ${items.length}`} accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={styles.progressRow}>{segments.map((segment) => <View accessible={false} key={segment.id} style={styles.progressTrack}><View style={[styles.progressFill, { width: `${segment.value * 100}%` }]} /></View>)}</View>
    <View style={styles.header}><Image accessible={false} source={{ uri: story.owner?.avatarUrl ?? undefined }} style={styles.avatar} /><Text style={styles.name}>{story.owner?.name ?? 'Story'}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Close Stories" onPress={() => navigation.goBack()} style={styles.close}><Ionicons name="close" color="#fff" size={30} /></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Story options" onPress={openMenu} style={styles.menu}><Ionicons name="ellipsis-horizontal" color="#fff" size={28} /></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Previous Story" accessibilityState={{ disabled: index === 0 }} disabled={index === 0} onPress={() => move(-1)} style={styles.previous} />
    <Pressable accessibilityRole="button" accessibilityLabel={index === items.length - 1 ? 'Close after this Story' : 'Next Story'} onPress={() => move(1)} style={styles.next} />
    {!!story.caption && <Text style={styles.caption}>{story.caption}</Text>}
    {story.ownerId !== currentUserId && <View style={styles.replyBar}><TextInput accessibilityLabel="Story reply" value={reply} onChangeText={setReply} placeholder="Reply to Story" placeholderTextColor="#aaa" style={styles.replyInput} /><Pressable accessibilityRole="button" accessibilityLabel="Send Story reply" accessibilityState={{ disabled: !reply.trim() }} disabled={!reply.trim()} onPress={async () => { const content = reply.trim(); if (!content) return; await api.post(`/stories/${story.id}/reply`, { content, clientMessageId: `story-reply-${Date.now()}-${Math.random().toString(36).slice(2)}` }); setReply(''); }}><Ionicons name="send" size={24} color={colors.primary} /></Pressable></View>}
    <Modal visible={viewerOpen} animationType="slide" onRequestClose={() => setViewerOpen(false)}>
      <View style={styles.viewerPage}><View style={styles.viewerHeader}><Text style={styles.viewerTitle}>Story viewers</Text><Pressable accessibilityRole="button" accessibilityLabel="Close viewer list" onPress={() => setViewerOpen(false)}><Ionicons name="close" size={28} color={colors.text.primary} /></Pressable></View>
        <FlatList accessibilityLabel="Story viewers" data={viewers} keyExtractor={(item) => item.id} onEndReached={() => { if (viewerCursor) void loadViewers(); }} renderItem={({ item }) => <View accessible accessibilityLabel={`${item.viewer?.name ?? 'Viewer'}, viewed ${new Date(item.firstVisibleAt).toLocaleString()}`} style={styles.viewerRow}><Image accessible={false} source={{ uri: item.viewer?.avatarUrl ?? undefined }} style={styles.viewerAvatar} /><View><Text style={styles.viewerName}>{item.viewer?.name ?? 'Viewer'}</Text><Text style={styles.viewerTime}>{new Date(item.firstVisibleAt).toLocaleString()}</Text></View></View>} ListEmptyComponent={<Text style={styles.viewerEmpty}>No views yet.</Text>} />
      </View>
    </Modal>
  </View>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }, media: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  progressRow: { position: 'absolute', top: 44, left: 10, right: 10, height: 3, flexDirection: 'row', gap: 4 }, progressTrack: { flex: 1, backgroundColor: 'rgba(255,255,255,.35)', overflow: 'hidden', borderRadius: 2 }, progressFill: { height: 3, backgroundColor: '#fff' },
  header: { position: 'absolute', top: 58, left: 18, flexDirection: 'row', alignItems: 'center', gap: 10 }, avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface }, name: { color: '#fff', fontWeight: '700', fontSize: 16 },
  close: { position: 'absolute', right: 18, top: 60, zIndex: 5 }, menu: { position: 'absolute', right: 58, top: 61, zIndex: 5 }, previous: { position: 'absolute', left: 0, top: 110, bottom: 110, width: '32%' }, next: { position: 'absolute', right: 0, top: 110, bottom: 110, width: '32%' },
  caption: { position: 'absolute', left: 24, right: 24, bottom: 118, color: '#fff', fontSize: 16, textAlign: 'center', backgroundColor: 'rgba(0,0,0,.35)', padding: 10, borderRadius: 10 },
  replyBar: { position: 'absolute', left: 18, right: 18, bottom: 42, height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,.5)', backgroundColor: 'rgba(0,0,0,.45)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }, replyInput: { flex: 1, color: '#fff' },
  stateOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,.7)', alignItems: 'center', justifyContent: 'center', gap: 14 }, stateText: { color: '#fff', fontSize: 16, textAlign: 'center', paddingHorizontal: 28 }, stateAction: { color: colors.primary, fontWeight: '700', fontSize: 16, marginTop: 12 },
  viewerPage: { flex: 1, backgroundColor: colors.background, paddingTop: 55 }, viewerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border }, viewerTitle: { color: colors.text.primary, fontSize: 22, fontWeight: '700' }, viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 }, viewerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface }, viewerName: { color: colors.text.primary, fontWeight: '600' }, viewerTime: { color: colors.text.tertiary, fontSize: 12, marginTop: 3 }, viewerEmpty: { color: colors.text.tertiary, textAlign: 'center', marginTop: 60 },
});
