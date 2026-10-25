import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AssetField, MediaType, Query, requestPermissionsAsync, type Asset } from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MediaSource } from '../composition/types';
import { MAX_SELECTION } from '../composition/types';
import { daysLeft, listDrafts, type DraftSummary } from '../drafts/draftStore';
import { importAll, importPhoto, importVideo } from '../import';
import { useStoryBack } from '../backStack';

type LibraryItem = { id: string; uri: string; kind: 'photo' | 'video'; durationMs: number };

const PAGE = 60;

async function resolve(asset: Asset): Promise<LibraryItem> {
  const [uri, kind, durationMs] = await Promise.all([asset.getUri(), asset.getMediaType(), asset.getDuration()]);
  return { id: asset.id, uri, kind: kind === MediaType.VIDEO ? 'video' : 'photo', durationMs: durationMs ?? 0 };
}

function clock(ms: number) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function VideoCell({ uri }: { uri: string }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    VideoThumbnails.getThumbnailAsync(uri, { time: 0, quality: 0.4 }).then((result) => { if (active) setThumb(result.uri); }).catch(() => undefined);
    return () => { active = false; };
  }, [uri]);
  return thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} /> : null;
}

/**
 * The gallery behind the camera's thumbnail: recent photos and videos, your
 * drafts with the days left before they are deleted, and Select for choosing
 * up to 10 items, numbered in the order they will post.
 */
export function StoryGalleryPicker({ onClose, onPick, onOpenDraft, limit = MAX_SELECTION, adding = false }: {
  onClose: () => void;
  onPick: (media: MediaSource[]) => void;
  onOpenDraft?: (draftId: string) => void;
  /** How many may be picked: what is left of the ten when adding to a set. */
  limit?: number;
  /** Adding to stories already in the editor: several at once, no drafts. */
  adding?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cell = (width - 4) / 3;
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [multi, setMulti] = useState(adding);
  const [selection, setSelection] = useState<LibraryItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);

  useStoryBack(() => {
    onClose();
    return true;
  });

  const loadPage = useCallback(async (offset: number) => {
    const assets = await new Query()
      .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])
      .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
      .offset(offset)
      .limit(PAGE)
      .exe();
    const resolved = await Promise.all(assets.map(resolve));
    setItems((current) => (offset === 0 ? resolved : [...current, ...resolved.filter((item) => !current.some((existing) => existing.id === item.id))]));
    if (resolved.length < PAGE) setDone(true);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setDrafts(await listDrafts().catch(() => []));
      const permission = await requestPermissionsAsync(false, ['photo', 'video']);
      if (!active) return;
      if (!permission.granted && permission.accessPrivileges !== 'limited') {
        setDenied(true);
        setLoading(false);
        return;
      }
      await loadPage(0).catch(() => undefined);
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [loadPage]);

  const numbers = useMemo(() => new Map(selection.map((item, index) => [item.id, index + 1])), [selection]);

  const finish = async (chosen: LibraryItem[]) => {
    if (!chosen.length || importing) return;
    setImporting(true);
    try {
      // Three at a time, in the chosen order.
      const media = await importAll(chosen, item => item.kind === 'photo' ? importPhoto(item.uri) : importVideo(item.uri, item.durationMs));
      onPick(media);
    } finally {
      setImporting(false);
    }
  };

  const toggle = (item: LibraryItem) => {
    if (!multi) {
      void finish([item]);
      return;
    }
    setSelection((current) => (current.some((entry) => entry.id === item.id)
      ? current.filter((entry) => entry.id !== item.id)
      : current.length >= limit ? current : [...current, item]));
  };

  return (
    <View style={[styles.sheet, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close gallery" onPress={onClose} style={styles.icon}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        <Text style={styles.title}>Add to story</Text>
        <Pressable accessibilityRole="button" onPress={() => { setMulti((value) => !value); setSelection([]); }} style={[styles.select, multi && styles.selectActive]}>
          <Ionicons name="copy-outline" size={16} color={multi ? '#000' : '#fff'} />
          <Text style={[styles.selectText, multi && { color: '#000' }]}>Select</Text>
        </Pressable>
      </View>

      {!adding && drafts.length ? (
        <View>
          <Text style={styles.section}>Drafts</Text>
          <FlatList
            horizontal
            data={drafts}
            keyExtractor={(draft) => draft.id}
            contentContainerStyle={{ paddingHorizontal: 8, gap: 6 }}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item: draft }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Draft, ${daysLeft(draft)} days left`} onPress={() => onOpenDraft?.(draft.id)} style={styles.draft}>
                {draft.coverKind === 'photo' && draft.coverUri ? <Image source={{ uri: draft.coverUri }} style={StyleSheet.absoluteFill} /> : draft.coverUri ? <VideoCell uri={draft.coverUri} /> : null}
                <View style={styles.draftBadge}><Text style={styles.draftBadgeText}>{daysLeft(draft)}d</Text></View>
                {draft.count > 1 ? <View style={styles.draftCount}><Text style={styles.draftBadgeText}>{draft.count}</Text></View> : null}
              </Pressable>
            )}
          />
        </View>
      ) : null}

      <Text style={styles.section}>Recents</Text>
      {loading ? <ActivityIndicator color="#fff" style={{ marginTop: 40 }} /> : null}
      {denied ? <Text style={styles.empty}>Photo access is off. Allow it in your phone's settings to add from your gallery.</Text> : null}
      <FlatList
        data={items}
        numColumns={3}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        onEndReachedThreshold={0.6}
        onEndReached={() => { if (!done && !loading) void loadPage(items.length).catch(() => undefined); }}
        renderItem={({ item }) => {
          const number = numbers.get(item.id);
          return (
            <Pressable onPress={() => toggle(item)} style={{ width: cell, height: cell * 1.3, margin: 0.66 }} accessibilityRole="button" accessibilityLabel={item.kind === 'video' ? 'Video' : 'Photo'}>
              {item.kind === 'photo' ? <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} /> : <><View style={[StyleSheet.absoluteFill, { backgroundColor: '#222' }]} /><VideoCell uri={item.uri} /></>}
              {item.kind === 'video' ? <Text style={styles.duration}>{clock(item.durationMs)}</Text> : null}
              {multi ? (
                <View style={[styles.check, number ? styles.checkOn : null]}>
                  {number ? <Text style={styles.checkText}>{number}</Text> : null}
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />

      {multi && selection.length ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.footerText}>{selection.length} of {MAX_SELECTION}</Text>
          <Pressable accessibilityRole="button" onPress={() => void finish(selection)} style={styles.next}>
            <Text style={styles.nextText}>Next</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {importing ? (
        <View style={[StyleSheet.absoluteFill, styles.busy]}><ActivityIndicator color="#fff" size="large" /></View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000' },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  select: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)' },
  selectActive: { backgroundColor: '#fff' },
  selectText: { color: '#fff', fontWeight: '600' },
  section: { color: '#fff', fontWeight: '700', fontSize: 15, marginHorizontal: 12, marginVertical: 8 },
  draft: { width: 88, height: 130, borderRadius: 8, overflow: 'hidden', backgroundColor: '#222' },
  draftBadge: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  draftCount: { position: 'absolute', right: 6, top: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  draftBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { color: '#A8A8A8', textAlign: 'center', marginHorizontal: 24, marginTop: 30 },
  duration: { position: 'absolute', right: 6, bottom: 6, color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 3 },
  check: { position: 'absolute', right: 6, top: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#3897F0', borderColor: '#3897F0' },
  checkText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.85)' },
  footerText: { flex: 1, color: '#fff', fontWeight: '600' },
  next: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#3897F0', paddingHorizontal: 18, height: 40, borderRadius: 20 },
  nextText: { color: '#fff', fontWeight: '700' },
  busy: { backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
});
