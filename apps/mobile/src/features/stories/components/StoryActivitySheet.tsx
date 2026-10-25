import { VerifiedBadge } from '../../discovery/components/VerifiedBadge';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Keyboard, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StickerResults } from './StickerResults';
import { InsightsTab } from '../insights/InsightsTab';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { relativeTime } from '../storyNavigation';

/**
 * Material 3 dark baseline tokens, as Android's own bottom sheet uses them:
 * `colorSurfaceContainerLow` for the sheet, a 28dp top corner, a 32 x 4dp drag
 * handle inside a 48dp touch area, and a 500 px/s fling threshold. The search
 * field is M3's search bar (surfaceContainerHigh, full pill), the counts are
 * assist chips, and each viewer is a two-line list item.
 */
const SURFACE_CONTAINER_LOW = '#1D1B20';
const SURFACE_CONTAINER_HIGH = '#2B2930';
const ON_SURFACE = '#E6E0E9';
const ON_SURFACE_VARIANT = '#CAC4D0';
const OUTLINE_VARIANT = '#49454F';
const PRIMARY = '#D0BCFF';
const LIKE = '#FF3040';
const CORNER = 28;
const FLING_VELOCITY = 500;
const SPRING = { damping: 30, stiffness: 320, mass: 0.9, overshootClamping: true };
const TAB_LABEL = { viewers: 'Viewers', responses: 'Responses', insights: 'Insights' } as const;
const SEARCH_DELAY_MS = 250;
/** Called from the drag gesture: a worklet can't carry the Keyboard object itself, only a plain function. */
function hideKeyboard() { Keyboard.dismiss(); }

type Props = {
  /** Distance of the sheet's top edge from the top of the screen. */
  offset: SharedValue<number>;
  topInset: number;
  bottomInset: number;
  viewCount: number;
  likeCount: number;
  viewers: any[];
  onEndReached: () => void;
  /** Viewers whose name matches, from every viewer - not only the page loaded. */
  onSearch?: (query: string) => Promise<any[]>;
  /** Called once the sheet has left the screen. */
  onDismissed: () => void;
  /** The story, for its sticker responses. Absent in the demo. */
  storyId?: string;
  /** True when the story has stickers people answer. */
  hasResponses?: boolean;
  onShareReply?: (prompt: string, text: string) => void;
  /** The ⋯ on a viewer's row: hide your story, Close Friends, remove follower, message. */
  onViewerMenu?: (row: any) => void;
  /**
   * True once the 48-hour freeze has removed the viewer list (section 6). The
   * Viewers tab then disappears - Responses stays, since Phase C keeps sticker
   * interactions readable rather than reducing them to anonymous totals.
   */
  viewersClosed?: boolean;
};

/** "Liked your story" / "Replied" / "Viewed 2h ago": the list item's second line. */
function supportingText(item: any) {
  if (item.liked && item.replied) return 'Liked and replied';
  if (item.liked) return 'Liked your story';
  if (item.replied) return 'Replied to your story';
  if (item.reaction) return 'Reacted';
  return item.firstVisibleAt ? `Viewed ${relativeTime(item.firstVisibleAt) === 'now' ? 'just now' : `${relativeTime(item.firstVisibleAt)} ago`}` : 'Viewed';
}

/**
 * The Activity sheet on your own Story: a Material 3 standard bottom sheet.
 * Standard sheets have no scrim, so nothing darkens the Story above it. It opens
 * half expanded, drags up to fully expanded, and drags or flings down to close.
 * Searching expands it fully, so the field and its results stay above the keyboard.
 */
export function StoryActivitySheet({ offset, topInset, bottomInset, viewCount, likeCount, viewers, onEndReached, onSearch, onDismissed, storyId, hasResponses, onShareReply, onViewerMenu, viewersClosed }: Props) {
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<'viewers' | 'responses' | 'insights'>('viewers');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [keyboard, setKeyboard] = useState(0);
  const searchRef = useRef<TextInput>(null);
  // Insights (section 7.8) is offered for every real Story; Responses only when it has stickers people answer.
  const tabs = storyId
    ? ([...(viewersClosed ? [] : ['viewers' as const]), ...(hasResponses && onShareReply ? ['responses' as const] : []), 'insights'] as const)
    : null;
  // The tab bar can only lose "Viewers" once loadViewers resolves; move off it then.
  useEffect(() => {
    if (viewersClosed && tab === 'viewers') setTab('insights');
  }, [tab, viewersClosed]);
  const half = height * 0.5;
  const expanded = topInset + 24;
  const dragStart = useSharedValue(0);
  const onViewers = !tabs || tab === 'viewers';

  useEffect(() => {
    offset.value = withSpring(half, SPRING);
  }, [half, offset]);

  // The Story viewer leaves the window alone when the keyboard opens, so the
  // list makes its own room under the keyboard.
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => setKeyboard(event.endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => { shown.remove(); hidden.remove(); };
  }, []);

  // Names typed: the loaded rows at once, then everyone who viewed from the server.
  const trimmed = query.trim();
  const local = useMemo(() => {
    const needle = trimmed.toLowerCase();
    return needle ? viewers.filter((item) => (item.viewer?.name ?? '').toLowerCase().includes(needle)) : viewers;
  }, [trimmed, viewers]);
  useEffect(() => {
    if (!trimmed || !onSearch) { setFound(null); setSearching(false); return; }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      onSearch(trimmed)
        .then((rows) => { if (active) setFound(rows); })
        .catch(() => { if (active) setFound(null); })
        .finally(() => { if (active) setSearching(false); });
    }, SEARCH_DELAY_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [onSearch, trimmed]);
  const rows = trimmed ? (found ?? local) : viewers;

  const expand = () => { offset.value = withSpring(expanded, SPRING); };

  const drag = Gesture.Pan()
    .onStart(() => {
      dragStart.value = offset.value;
      runOnJS(hideKeyboard)();
    })
    .onUpdate((event) => {
      offset.value = Math.min(height, Math.max(expanded, dragStart.value + event.translationY));
    })
    .onEnd((event) => {
      const here = offset.value;
      let target: number;
      if (event.velocityY > FLING_VELOCITY) target = here < half - 1 ? half : height;
      else if (event.velocityY < -FLING_VELOCITY) target = expanded;
      else {
        target = [expanded, half, height].reduce((best, point) => (Math.abs(point - here) < Math.abs(best - here) ? point : best), half);
      }
      if (target === height) {
        // Material 3's emphasized-accelerate curve, the same as closing with a tap or back.
        offset.value = withTiming(height, { duration: 250, easing: Easing.bezier(0.3, 0, 0.8, 0.15) }, (finished) => {
          if (finished) runOnJS(onDismissed)();
        });
      } else {
        offset.value = withSpring(target, { ...SPRING, velocity: event.velocityY });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const showSearch = onViewers && (viewers.length > 0 || !!trimmed);

  return (
    <Animated.View style={[styles.sheet, { height: height - expanded }, sheetStyle]}>
      <GestureDetector gesture={drag}>
        <View collapsable={false}>
          <View style={styles.handleArea} accessible accessibilityRole="adjustable" accessibilityLabel="Activity sheet drag handle">
            <View style={styles.handle} />
          </View>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Activity</Text>
            <View style={styles.chips}>
              <View style={styles.chip} accessible accessibilityLabel={`${viewCount} ${viewCount === 1 ? 'view' : 'views'}`}>
                <Ionicons name="eye-outline" size={16} color={ON_SURFACE_VARIANT} />
                <Text style={styles.chipText}>{viewCount}</Text>
              </View>
              <View style={styles.chip} accessible accessibilityLabel={`${likeCount} ${likeCount === 1 ? 'like' : 'likes'}`}>
                <Ionicons name="heart" size={15} color={LIKE} />
                <Text style={styles.chipText}>{likeCount}</Text>
              </View>
            </View>
          </View>
          {tabs ? (
            <View style={styles.tabs}>
              {tabs.map((entry) => (
                <Pressable key={entry} onPress={() => setTab(entry)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: tab === entry }}>
                  <Text style={[styles.tabText, tab === entry && styles.tabTextActive]}>{TAB_LABEL[entry]}</Text>
                  {tab === entry ? <View style={styles.tabIndicator} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          {tabs ? <View style={styles.divider} /> : null}
        </View>
      </GestureDetector>
      {showSearch ? (
        <View style={styles.searchWrap}>
          <Pressable style={styles.search} onPress={() => searchRef.current?.focus()} accessible={false}>
            <Ionicons name="search" size={20} color={ON_SURFACE_VARIANT} />
            <TextInput
              ref={searchRef}
              value={query}
              onChangeText={setQuery}
              onFocus={expand}
              placeholder="Search viewers"
              placeholderTextColor={ON_SURFACE_VARIANT}
              style={styles.searchInput}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="words"
              accessibilityLabel="Search viewers by name"
            />
            {searching ? <ActivityIndicator size="small" color={ON_SURFACE_VARIANT} />
              : query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Ionicons name="close" size={20} color={ON_SURFACE_VARIANT} />
                </Pressable>
              ) : null}
          </Pressable>
        </View>
      ) : null}
      {tabs && tab === 'responses' ? (
        <StickerResults storyId={storyId!} onShareReply={onShareReply!} />
      ) : tabs && tab === 'insights' ? (
        <InsightsTab storyId={storyId!} />
      ) : (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        onEndReached={trimmed ? undefined : onEndReached}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: Math.max(bottomInset + 24 + (height - half), keyboard + 24) }}
        ListEmptyComponent={trimmed ? (
          searching && !found ? null : <View style={styles.empty}>
            <Ionicons name="eye-off-outline" size={28} color={ON_SURFACE_VARIANT} />
            <Text style={styles.emptyTitle}>No viewer named “{trimmed}”</Text>
            <Text style={styles.emptyText}>They haven't viewed this story yet.</Text>
          </View>
        ) : (
          <View style={styles.empty}>
            <Ionicons name="eye-outline" size={28} color={ON_SURFACE_VARIANT} />
            <Text style={styles.emptyTitle}>No views yet</Text>
            <Text style={styles.emptyText}>People who view your story appear here.</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            {item.viewer?.avatarUrl
              ? <Image source={{ uri: item.viewer.avatarUrl }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarFallback]}><Ionicons name="person" size={18} color={ON_SURFACE_VARIANT} /></View>}
            <View style={styles.rowText}>
              <View style={styles.nameLine}>
                <Text style={styles.name} numberOfLines={1}>{item.viewer?.name ?? 'Viewer'}</Text>
                {item.viewer?.blueBadge ? <VerifiedBadge size={15} /> : null}
                {item.relation?.closeFriend ? <Ionicons name="star" size={13} color="#1DBF3A" accessibilityLabel="Close Friends" /> : null}
                {item.relation?.hidden ? <Ionicons name="eye-off-outline" size={15} color={ON_SURFACE_VARIANT} accessibilityLabel="Your story is hidden from them" /> : null}
              </View>
              <Text style={styles.supporting} numberOfLines={1}>{supportingText(item)}</Text>
            </View>
            {/* Section 8.1: the emoji of their most recent reaction, and a reply icon if they sent a text reply. */}
            {item.reaction ? <Text style={styles.reactionEmoji}>{item.reaction}</Text> : null}
            {item.replied ? <Ionicons name="chatbubble-outline" size={18} color={ON_SURFACE_VARIANT} accessibilityLabel="Replied" /> : null}
            {item.liked ? <Ionicons name="heart" size={20} color={LIKE} accessibilityLabel="Liked" /> : null}
            {onViewerMenu && item.viewer && item.relation ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${item.viewer.name}`} onPress={() => { Keyboard.dismiss(); onViewerMenu(item); }} hitSlop={8}
                style={({ pressed }) => [styles.more, pressed && styles.morePressed]}>
                <Ionicons name="ellipsis-vertical" size={18} color={ON_SURFACE_VARIANT} />
              </Pressable>
            ) : null}
          </View>
        )}
      />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
    backgroundColor: SURFACE_CONTAINER_LOW,
    borderTopLeftRadius: CORNER,
    borderTopRightRadius: CORNER,
    overflow: 'hidden',
    elevation: 1,
  },
  handleArea: { height: 36, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 32, height: 4, borderRadius: 2, backgroundColor: ON_SURFACE_VARIANT, opacity: 0.4 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 12, minHeight: 44 },
  title: { flex: 1, color: ON_SURFACE, fontSize: 22, lineHeight: 28, fontWeight: '400' },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: OUTLINE_VARIANT },
  chipText: { color: ON_SURFACE, fontSize: 14, fontWeight: '500', fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: OUTLINE_VARIANT },
  tabs: { flexDirection: 'row', paddingHorizontal: 12 },
  tab: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center' },
  tabText: { color: ON_SURFACE_VARIANT, fontSize: 14, fontWeight: '500' },
  tabTextActive: { color: PRIMARY },
  tabIndicator: { position: 'absolute', bottom: 0, width: 48, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: PRIMARY },
  searchWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  search: { height: 48, borderRadius: 24, backgroundColor: SURFACE_CONTAINER_HIGH, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  searchInput: { flex: 1, color: ON_SURFACE, fontSize: 16, paddingVertical: 0 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 16, paddingLeft: 16, paddingRight: 12, paddingVertical: 8 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#36343B' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, color: ON_SURFACE, fontSize: 16, lineHeight: 24 },
  supporting: { color: ON_SURFACE_VARIANT, fontSize: 14, lineHeight: 20 },
  reactionEmoji: { fontSize: 18 },
  more: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  morePressed: { backgroundColor: 'rgba(230,224,233,0.1)' },
  empty: { alignItems: 'center', marginTop: 32, paddingHorizontal: 32, gap: 6 },
  emptyTitle: { color: ON_SURFACE, fontSize: 16, fontWeight: '500', textAlign: 'center', marginTop: 4 },
  emptyText: { color: ON_SURFACE_VARIANT, fontSize: 14, textAlign: 'center' },
});
