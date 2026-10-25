import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle } from 'react-native-svg';
import { StoryCreator } from '../create/StoryCreator';
import { dispatchStoryBack } from '../create/backStack';
import {
  cancelPosting, discardPosting, onStoryPublished, restorePostings, retryPosting, usePostings, type Posting,
} from '../create/publish/postingStore';
import { useSelector } from 'react-redux';
import { api } from '../../../services/api';
import { useSocket } from '../../../services/useSocketEvent';
import { colors } from '../../../core/theme/colors';
import { RootState } from '../../../store';
import { StoryViewer } from '../StoryViewerScreen';
import { DEMO_VIEWERS, buildDemoStoryGroups } from '../demoStories';
import { applyLiked, applySeen, openingPosition, orderTray } from '../storyNavigation';
import { loadStorySource, storyStill } from '../storySources';
import { prepareStoryOpening } from '../prepareStoryOpening';
import { discardStoryVideo } from '../preparedStoryVideo';
import { STORY_TRAY_QUERY_KEY, type StoryTray as StoryTrayData, type TrayGroup } from '../storyTypes';
import { CLOSE_FRIENDS_GREEN } from '../settings/storySettings';

/** Instagram's unseen-Story gradient. */
const UNSEEN = ['#FEDA75', '#FA7E1E', '#D62976', '#962FBF', '#4F5BD5'] as const;
const CLOSE_FRIENDS_LOADING = [CLOSE_FRIENDS_GREEN, '#78E997', '#148B42', CLOSE_FRIENDS_GREEN] as const;
const AVATAR = 62;
const PAGE = '#100F0D';

function Ring({ state, loading, children }: { state: 'closeFriends' | 'unseen' | 'seen' | 'none'; loading: boolean; children: React.ReactNode }) {
  const spin = useSharedValue(0);
  useEffect(() => {
    if (loading) {
      spin.value = 0;
      spin.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1);
    } else {
      cancelAnimation(spin);
      spin.value = 0;
    }
    return () => cancelAnimation(spin);
  }, [loading, spin]);
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));

  if (state === 'none') return <View style={styles.plain}>{children}</View>;
  return (
    <View style={styles.ringOuter}>
      {loading ? (
        <Animated.View style={[StyleSheet.absoluteFill, ringStyle]}>
          <LinearGradient colors={state === 'closeFriends' ? CLOSE_FRIENDS_LOADING : UNSEEN}
            start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : state === 'closeFriends' ? (
        // Close Friends: a solid green ring instead of the gradient.
        <View style={[StyleSheet.absoluteFill, { backgroundColor: CLOSE_FRIENDS_GREEN }]} />
      ) : state === 'unseen' ? (
        <LinearGradient colors={UNSEEN} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.seenRing]} />
      )}
      <View style={styles.ringInner}>{children}</View>
    </View>
  );
}

const POSTING_RADIUS = (AVATAR + 10 - 4) / 2;
const POSTING_CIRCUMFERENCE = 2 * Math.PI * POSTING_RADIUS;

/**
 * Your avatar while stories post: a ring that fills with progress, or turns red
 * with an exclamation mark when posting failed.
 */
function PostingRing({ posting, children }: { posting: Posting; children: React.ReactNode }) {
  const size = AVATAR + 10;
  const failed = posting.status === 'failed';
  const progress = posting.status === 'completed' ? 1 : Math.max(0.04, posting.progress);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={POSTING_RADIUS} stroke="#3A3A3F" strokeWidth={3} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={POSTING_RADIUS}
          stroke={failed ? '#ED4956' : posting.audience === 'close_friends' ? CLOSE_FRIENDS_GREEN : '#D62976'} strokeWidth={3} fill="none" strokeLinecap="round"
          strokeDasharray={`${POSTING_CIRCUMFERENCE} ${POSTING_CIRCUMFERENCE}`}
          strokeDashoffset={failed ? 0 : POSTING_CIRCUMFERENCE * (1 - progress)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
      {failed ? (
        <View style={styles.failedBadge}><Text style={styles.failedBadgeText}>!</Text></View>
      ) : null}
    </View>
  );
}

function Avatar({ uri }: { uri?: string | null }) {
  return uri
    ? <Image source={{ uri }} style={styles.avatar} />
    : <View style={[styles.avatar, styles.avatarFallback]}><Ionicons name="person" size={28} color="#8B8B90" /></View>;
}

/**
 * The Stories tray: your story first, then people with Stories you have not
 * seen (gradient ring), then those you have watched (grey ring). Opening a
 * person prepares their first unseen Story while the ring spins, so the viewer
 * opens on a picture instead of a spinner.
 *
 * `demo` shows the demo profiles' Stories with nothing sent to the server. The
 * viewer then opens in a modal over the demo, which is itself a modal and would
 * hide a navigation screen underneath it.
 */
export function StoryTray({ demo = false, onOpenChange }: { demo?: boolean; onOpenChange?: (open: boolean) => void }) {
  const socket = useSocket();
  const navigation = useNavigation<any>();
  const user = useSelector((state: RootState) => state.auth.user);
  const userAvatar: string | null = user?.avatarUrl ?? user?.photos?.[0]?.photoUrl ?? user?.photos?.[0] ?? null;
  const [opening, setOpening] = useState<string | null>(null);
  const openingAbort = useRef<AbortController | null>(null);
  // The story growing out of the tapped avatar (STORY_AUDIENCE_SPEC.md,
  // section 17.3): a short-lived overlay, entirely separate from the viewer
  // itself, so this stays additive rather than touching its transition logic.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const avatarRefs = useRef<Map<string, View>>(new Map());
  const growProgress = useSharedValue(0);
  useFocusEffect(useCallback(() => () => {
    if (openingAbort.current) {
      openingAbort.current.abort();
      discardStoryVideo();
    }
    cancelAnimation(growProgress);
  }, [growProgress]));
  const [growth, setGrowth] = useState<{ x: number; y: number; size: number; uri: string } | null>(null);
  const { data, refetch } = useQuery({
    queryKey: STORY_TRAY_QUERY_KEY,
    queryFn: async () => (await api.get('/stories/tray')).data.data as StoryTrayData,
    staleTime: 30_000,
    enabled: !demo,
  });
  useFocusEffect(useCallback(() => {
    if (!demo) void refetch();
  }, [demo, refetch]));

  const [demoGroups, setDemoGroups] = useState<TrayGroup[]>(() => (demo ? buildDemoStoryGroups(userAvatar) : []));
  const [demoViewer, setDemoViewer] = useState<{ groups: TrayGroup[]; start: number } | null>(null);
  // A Modal's back press goes to onRequestClose, not BackHandler, so the viewer
  // registers here to close its Activity sheet before the viewer itself closes.
  const viewerBack = useRef<(() => boolean) | null>(null);

  const queryClient = useQueryClient();
  const allPostings = usePostings();
  const postings = allPostings.filter((posting) => Boolean(posting.demo) === demo);
  const posting = postings[postings.length - 1];
  const [creating, setCreating] = useState(false);

  // Unfinished posts survive the app closing; catch up with the worker.
  useEffect(() => {
    if (!demo) void restorePostings();
  }, [demo]);

  // A story that has posted shows in the tray straight away.
  useEffect(() => {
    const off = onStoryPublished((story) => {
      const isDemoStory = story.ownerId === 'demo-me';
      if (isDemoStory !== demo) return;
      const addTo = (list: TrayGroup[]): TrayGroup[] => {
        const index = list.findIndex((group) => group.isOwn);
        if (index >= 0) {
          return list.map((group, position) => (position !== index || group.stories.some((entry) => entry.id === story.id)
            ? group
            : { ...group, stories: [...group.stories, story], latestPublishedAt: story.publishedAt }));
        }
        return [{
          owner: { id: story.ownerId, name: user?.name ?? 'You', avatarUrl: userAvatar },
          isOwn: true, hasUnseen: false, closeFriendsUnseen: false, firstUnseenIndex: 0, latestPublishedAt: story.publishedAt, stories: [story],
        }, ...list];
      };
      if (demo) setDemoGroups((current) => addTo(current));
      else queryClient.setQueryData<StoryTrayData>(STORY_TRAY_QUERY_KEY, (old) => ({ groups: addTo(old?.groups ?? []) }));
    });
    return () => { off(); };
  }, [demo, queryClient, user?.name, userAvatar]);

  // Live tray updates (STORY_AUDIENCE_SPEC.md, section 17.3): someone you
  // follow or matched with posts while your tray is open, and their ring
  // appears without you reopening the app. The server already applied every
  // visibility rule before deciding to nudge you at all; this just refetches
  // rather than reimplementing that logic on the client. A short debounce
  // coalesces a multi-photo post into one refetch instead of several.
  useEffect(() => {
    if (demo) return;
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Back online: anything posted meanwhile shows too.
    let connectedOnce = socket.connected;
    const reconnected = () => { if (connectedOnce) void refetch(); connectedOnce = true; };
    socket.on('connect', reconnected);
    const handler = (data: { ownerId?: string }) => {
      // Your own posting is already reflected locally, above - avoid a redundant refetch.
      if (!data?.ownerId || data.ownerId === user?.id) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void refetch(); }, 600);
    };
    // Also when someone's Stories go, or your place in their audience
    // changes (Close Friends, hidden, a follow): a ring appears, turns green,
    // or leaves, without reopening the app. Same refetch, same rules.
    const changed = (data: { userId?: string; ownerId?: string }) => handler({ ownerId: data?.ownerId ?? data?.userId });
    socket.on('story_published', handler);
    socket.on('story_removed', changed);
    socket.on('relationship_changed', changed);
    return () => {
      socket.off('connect', reconnected);
      socket.off('story_published', handler);
      socket.off('story_removed', changed);
      socket.off('relationship_changed', changed);
      if (timer) clearTimeout(timer);
    };
  }, [demo, refetch, user?.id, socket]);

  const groups = demo ? demoGroups : data?.groups ?? [];
  const warmKey = groups.filter(group => !group.isOwn).slice(0, 3)
    .map(group => group.stories[group.firstUnseenIndex]?.id ?? group.stories[0]?.id).filter(Boolean).join('|');
  useFocusEffect(useCallback(() => {
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        for (const id of warmKey.split('|').filter(Boolean)) {
          if (!active) return;
          await loadStorySource(id).catch(() => undefined);
        }
      })();
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [warmKey]));
  const ownIndex = groups.findIndex((group) => group.isOwn);
  const ownAvatar = groups[ownIndex]?.owner.avatarUrl ?? userAvatar;

  const failedPosting = () => {
    if (!posting) return;
    Alert.alert("Couldn't post", posting.error ?? 'Your story could not be posted. Your edits are saved as a draft.', [
      { text: 'Try again', onPress: () => void retryPosting(posting.batchId) },
      { text: 'Discard', style: 'destructive', onPress: () => void discardPosting(posting.batchId) },
      { text: 'Keep as draft', style: 'cancel', onPress: () => void cancelPosting(posting.batchId) },
    ]);
  };

  // Holding someone's avatar mutes their stories, as Instagram's tray does. They are not told.
  const muteFromTray = (group: TrayGroup) => {
    Alert.alert(group.owner.name, undefined, [
      {
        text: `Mute ${group.owner.name}'s story`,
        onPress: async () => {
          if (demo) {
            setDemoGroups((current) => current.filter((entry) => entry.owner.id !== group.owner.id));
            return;
          }
          try {
            await api.put(`/stories/authors/${group.owner.id}/mute`, { muted: true });
            queryClient.setQueryData<StoryTrayData>(STORY_TRAY_QUERY_KEY, (old) => (old
              ? { groups: old.groups.filter((entry) => entry.owner.id !== group.owner.id) }
              : old));
          } catch {
            Alert.alert('Could not mute', 'Try again.');
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /** Animates the grow overlay from the tapped avatar's rect to full screen, then resolves. */
  const playGrow = (rect: { x: number; y: number; width: number; height: number }, uri: string) => new Promise<void>((resolve) => {
    setGrowth({ x: rect.x, y: rect.y, size: rect.width, uri });
    growProgress.value = 0;
    growProgress.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) }, () => {
      runOnJS(resolve)();
    });
  });

  const growOverlayStyle = useAnimatedStyle(() => {
    if (!growth) return { opacity: 0 };
    const progress = growProgress.value;
    return {
      position: 'absolute',
      left: growth.x + (0 - growth.x) * progress,
      top: growth.y + (0 - growth.y) * progress,
      width: growth.size + (winWidth - growth.size) * progress,
      height: growth.size + (winHeight - growth.size) * progress,
      borderRadius: (growth.size / 2) * (1 - progress),
      overflow: 'hidden',
      backgroundColor: '#000',
    };
  });

  const open = async (groupIndex: number) => {
    const group = groups[groupIndex];
    if (!group || openingAbort.current) return;
    const request = new AbortController();
    openingAbort.current = request;
    // Fast cache hits open without a loading animation. The opening transition
    // itself must not trigger loading feedback once the media is ready.
    const loadingTimer = setTimeout(() => {
      if (!request.signal.aborted) setOpening(group.owner.id);
    }, 220);
    const first = group.stories[openingPosition(groups, groupIndex).story];
    try {
      if (!first) return;
      const source = await prepareStoryOpening(first.id, request.signal);
      clearTimeout(loadingTimer);
      setOpening(null);
      if (request.signal.aborted) return;

      // Start the opening transition only after preparing the selected media.
      const ref = avatarRefs.current.get(group.owner.id);
      const growUri = storyStill(source) ?? group.owner.avatarUrl ?? null;
      if (ref && growUri) {
        const rect = await new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
          ref.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
        });
        if (request.signal.aborted) return;
        if (rect && rect.width > 0) await playGrow(rect, growUri);
      }
      if (request.signal.aborted) return;
      setGrowth(null);
      // The viewer now owns the prepared buffer. Blur cleanup must not release it.
      openingAbort.current = null;

      if (demo) {
        setDemoViewer({ groups, start: groupIndex });
        onOpenChange?.(true);
        return;
      }
      navigation.navigate('StoryViewer', { groups, startGroupIndex: groupIndex });
    } catch {
      discardStoryVideo();
      if (!request.signal.aborted) Alert.alert("Couldn't load story", 'Check your connection and try again.');
    } finally {
      clearTimeout(loadingTimer);
      if (openingAbort.current === request) {
        openingAbort.current = null;
        setOpening(null);
        setGrowth(null);
      }
    }
  };

  const closeDemoViewer = useCallback(() => {
    setDemoViewer(null);
    onOpenChange?.(false);
    // Watched people move behind the ones still unseen, as the real tray does on reload.
    setDemoGroups((current) => orderTray(current));
  }, [onOpenChange]);

  const addStory = () => {
    if (demo) {
      // The demo is itself a modal, so the creator opens in one too. Nothing is posted.
      setCreating(true);
      onOpenChange?.(true);
      return;
    }
    navigation.navigate('CreateStory');
  };

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tray} contentContainerStyle={styles.row}>
        <View style={styles.item}>
          <Pressable
            ref={(node) => { if (node && user?.id) avatarRefs.current.set(user.id, node as unknown as View); }}
            accessibilityRole="button"
            accessibilityLabel={posting?.status === 'failed' ? "Your story couldn't post" : posting && posting.status !== 'cancelled' ? 'Posting your story' : ownIndex >= 0 ? 'Open your story' : 'Add to your story'}
            onPress={() => {
              if (posting?.status === 'failed') failedPosting();
              else if (ownIndex >= 0) void open(ownIndex);
              else if (!posting) addStory();
            }}
          >
            {posting && posting.status !== 'cancelled' ? (
              <PostingRing posting={posting}><Avatar uri={ownAvatar} /></PostingRing>
            ) : (
              <Ring state={ownIndex >= 0 ? 'seen' : 'none'} loading={opening !== null && opening === groups[ownIndex]?.owner.id}>
                <Avatar uri={ownAvatar} />
              </Ring>
            )}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Add to your story" onPress={addStory} hitSlop={8} style={styles.plus}>
            <Ionicons name="add" size={16} color="#fff" />
          </Pressable>
          <Text style={styles.name} numberOfLines={1}>{posting?.status === 'failed' ? "Couldn't post" : posting && posting.status !== 'cancelled' && posting.status !== 'completed' ? 'Posting…' : 'Your story'}</Text>
        </View>

        {groups.map((group, index) => (group.isOwn ? null : (
          <Pressable
            key={group.owner.id}
            ref={(node) => { if (node) avatarRefs.current.set(group.owner.id, node as unknown as View); }}
            accessibilityRole="button"
            accessibilityLabel={`${group.owner.name}'s story${group.closeFriendsUnseen ? ', Close Friends' : ''}${group.hasUnseen ? ', new' : ''}`}
            accessibilityHint="Long press to mute"
            accessibilityState={{ busy: opening === group.owner.id }}
            onPress={() => void open(index)}
            onLongPress={() => muteFromTray(group)}
            style={styles.item}
          >
            <Ring state={group.closeFriendsUnseen ? 'closeFriends' : group.hasUnseen ? 'unseen' : 'seen'} loading={opening === group.owner.id}>
              <Avatar uri={group.owner.avatarUrl} />
            </Ring>
            <Text style={[styles.name, !group.hasUnseen && styles.nameSeen]} numberOfLines={1}>{group.owner.name}</Text>
          </Pressable>
        )))}
      </ScrollView>

      {growth ? (
        <Modal visible transparent animationType="none" statusBarTranslucent>
          <Animated.View pointerEvents="none" style={growOverlayStyle}>
            <Image source={{ uri: growth.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          </Animated.View>
        </Modal>
      ) : null}

      {demo ? (
        <Modal
          visible={creating}
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => {
            // A Modal's back press never reaches BackHandler; hand it to the creator.
            if (!dispatchStoryBack()) {
              setCreating(false);
              onOpenChange?.(false);
            }
          }}
        >
          {creating ? (
            <StoryCreator
              demo
              onClose={() => {
                setCreating(false);
                onOpenChange?.(false);
              }}
            />
          ) : null}
        </Modal>
      ) : null}

      {demo ? (
        <Modal visible={demoViewer !== null} transparent animationType="none" statusBarTranslucent onRequestClose={() => { if (!viewerBack.current?.()) closeDemoViewer(); }}>
          {demoViewer ? (
            <StoryViewer
              demo
              initialGroups={demoViewer.groups}
              startGroupIndex={demoViewer.start}
              demoViewers={DEMO_VIEWERS}
              backRef={viewerBack}
              onClose={closeDemoViewer}
              onSeen={(storyId) => setDemoGroups((current) => applySeen(current, storyId))}
              onLiked={(storyId, liked) => setDemoGroups((current) => applyLiked(current, storyId, liked))}
            />
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}

const RING = AVATAR + 10;

const styles = StyleSheet.create({
  // A ScrollView grows to fill its column by default, which pushed the cards
  // halfway down the screen. The tray is only as tall as its avatars.
  tray: { flexGrow: 0, flexShrink: 0 },
  row: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 12 },
  item: { width: RING + 4, alignItems: 'center' },
  ringOuter: { width: RING, height: RING, borderRadius: RING / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  seenRing: { borderRadius: RING / 2, borderWidth: 1.5, borderColor: '#4A4A50' },
  ringInner: { width: AVATAR + 4, height: AVATAR + 4, borderRadius: (AVATAR + 4) / 2, backgroundColor: PAGE, alignItems: 'center', justifyContent: 'center' },
  plain: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: '#2A2A2D' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  plus: {
    position: 'absolute', top: RING - 22, right: 2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary, borderWidth: 2, borderColor: PAGE, alignItems: 'center', justifyContent: 'center',
  },
  name: { color: '#F0ECEA', fontSize: 12, marginTop: 5, maxWidth: RING + 4 },
  failedBadge: {
    position: 'absolute', right: 2, bottom: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: '#ED4956',
    borderWidth: 2, borderColor: PAGE, alignItems: 'center', justifyContent: 'center',
  },
  failedBadgeText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  nameSeen: { color: '#A9A6A3' },
});
