import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsEmptyState, SettingsPage, settingsLayout, settingsPalette as palette } from '../../../core/settings/SettingsLayout';
import { storyArchiveApi, type ArchiveItem } from '../settings/storySettings';

const GAP = 6;
const NUM_COLUMNS = 3;

// Display grouping only, matching the server's IST bucketing (STORY_ARCHIVE_SPEC.md, section 10.2).
const IST_OFFSET_MS = 5.5 * 60 * 60_000;
function istDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function dayBadge(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * The owner's private Archive (STORY_ARCHIVE_SPEC.md): stories that have
 * ended and were posted with "Save story to archive" on. Nobody but the
 * owner ever sees this screen's contents. No Highlights - removed by
 * decision; see the spec's note at the top.
 */
export function ArchiveScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(Math.min(width, 600) - 32);
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [memories, setMemories] = useState<ArchiveItem[]>([]);
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const currentFilter: string | null = route.params?.archiveDate ?? dayFilter;
  const displayedDate = useRef<string | null | undefined>(undefined);
  const request = useRef(0);

  useEffect(() => {
    if (!route.params?.archiveDate) return;
    setDayFilter(route.params.archiveDate);
    navigation.setParams({ archiveDate: undefined });
  }, [route.params?.archiveDate, navigation]);

  const load = useCallback(async (next: string | null, date: string | null) => {
    const version = ++request.current;
    setLoading(true);
    if (!next) {
      if (displayedDate.current !== date) setItems([]);
      displayedDate.current = date;
      setFailed(false);
    }
    try {
      const page = await storyArchiveApi.list(next, date);
      if (version !== request.current) return;
      setItems((current) => (next ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setFailed(false);
    } catch {
      if (version === request.current) setFailed(true);
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    void load(null, currentFilter);
    if (!currentFilter) storyArchiveApi.memories().then((result) => { if (active) setMemories(result.items); }).catch(() => undefined);
    return () => { active = false; request.current += 1; };
  }, [currentFilter, load]));

  const firstOfDay = useMemo(() => {
    const seen = new Set<string>();
    const result = new Set<string>();
    for (const item of items) {
      const key = istDateKey(item.publishedAt);
      if (!seen.has(key)) { seen.add(key); result.add(item.id); }
    }
    return result;
  }, [items]);

  const open = (id: string) => navigation.navigate('StoryViewer', { storyId: id });

  return (
    <SettingsPage title="Archive" action={
      <Pressable accessibilityRole="button" accessibilityLabel="Choose a date"
        onPress={() => navigation.navigate('StoryArchiveCalendar', { selectedDate: currentFilter })}
        style={({ pressed }) => [styles.calendarButton, pressed && settingsLayout.pressed]}>
        <Ionicons name="calendar-outline" size={21} color={palette.accent} />
      </Pressable>
    }>
      <FlatList
        key="archive-grid"
        data={items}
        numColumns={NUM_COLUMNS}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        style={styles.list}
        onLayout={(event) => setGridWidth(Math.max(0, event.nativeEvent.layout.width - 32))}
        onEndReachedThreshold={0.5}
        onEndReached={() => { if (cursor && !loading && !currentFilter) void load(cursor, null); }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
        columnWrapperStyle={{ gap: GAP }}
        ListHeaderComponent={<View style={styles.intro}>
          <View style={styles.privacy}><Ionicons name="lock-closed-outline" size={14} color={palette.secondary} />
            <Text style={[settingsLayout.intro, { flex: 1 }]}>Only you can see your archived stories.</Text>
          </View>
          {!currentFilter && memories.length > 0 && (
          <Pressable
            accessibilityRole="button"
            style={styles.memoriesBanner}
            onPress={() => setDayFilter(istDateKey(memories[0].publishedAt))}
          >
            {memories[0].stillUrl ? <Image source={{ uri: memories[0].stillUrl }} style={styles.memoriesThumb} /> : <View style={styles.memoriesThumb} />}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.memoriesTitle}>On this day</Text>
              <Text style={styles.memoriesSubtitle}>{memories.length === 1 ? '1 story from a previous year' : `${memories.length} stories from previous years`}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={palette.secondary} />
          </Pressable>
          )}
          <View style={styles.gridHeading}>
            <Text style={settingsLayout.listHeading}>{currentFilter ? dayBadge(`${currentFilter}T12:00:00.000Z`) : 'Your stories'}</Text>
            {currentFilter && <Pressable onPress={() => setDayFilter(null)} accessibilityRole="button" style={styles.clearDate}>
              <Text style={styles.clearDateText}>All dates</Text><Ionicons name="close" size={15} color={palette.accent} />
            </Pressable>}
          </View>
        </View>}
        ListEmptyComponent={!loading ? (
          <SettingsEmptyState icon={failed ? 'cloud-offline-outline' : 'archive-outline'}
            title={failed ? 'Could not load your archive' : currentFilter ? 'No stories on this day' : 'Your archive starts here'}
            message={failed ? 'Check your connection and try again.' : 'Stories with archive saving enabled appear here after they end.'}
            onRetry={failed ? () => void load(null, currentFilter) : undefined} />
        ) : null}
        ListFooterComponent={loading ? <ActivityIndicator color={palette.accent} style={{ marginTop: 20 }} />
          : failed && items.length > 0 ? <Pressable onPress={() => void load(cursor, currentFilter)} style={styles.retry} accessibilityRole="button">
            <Text style={styles.clearDateText}>Could not load more. Tap to retry.</Text></Pressable> : null}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`Open story from ${dayBadge(item.publishedAt)}`}
            onPress={() => open(item.id)} style={({ pressed }) => [styles.tile, { width: (gridWidth - GAP * 2) / NUM_COLUMNS }, pressed && settingsLayout.pressed]}>
            {item.stillUrl ? <Image source={{ uri: item.stillUrl }} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, styles.tileFallback]} />}
            {item.contentType?.startsWith('video/') ? (
              <View style={styles.videoBadge}><Ionicons name="play" size={12} color="#fff" /></View>
            ) : null}
            {item.audience === 'close_friends' ? (
              <View style={styles.closeFriendsBadge}><Ionicons name="star" size={11} color="#fff" /></View>
            ) : null}
            {!currentFilter && firstOfDay.has(item.id) ? (
              <View style={styles.dateBadge}><Text style={styles.dateBadgeText}>{dayBadge(item.publishedAt)}</Text></View>
            ) : null}
          </Pressable>
        )}
      />

    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  calendarButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card },
  list: { width: '100%', maxWidth: 600, alignSelf: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 10 },
  intro: { gap: 14, paddingBottom: 12 },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  gridHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  clearDate: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: palette.card },
  clearDateText: { color: palette.accent, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  retry: { alignItems: 'center', paddingVertical: 16 },
  tile: { aspectRatio: 9 / 16, marginBottom: GAP, borderRadius: 12, backgroundColor: palette.card, overflow: 'hidden' },
  tileFallback: { backgroundColor: palette.card },
  videoBadge: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  closeFriendsBadge: { position: 'absolute', bottom: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: '#1DBF3A', alignItems: 'center', justifyContent: 'center' },
  dateBadge: { position: 'absolute', top: 6, left: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)' },
  dateBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  memoriesBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: palette.card },
  memoriesThumb: { width: 44, height: 56, borderRadius: 9, backgroundColor: '#393339' },
  memoriesTitle: { color: palette.text, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  memoriesSubtitle: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, marginTop: 3 },
});
