import { closedRecently, findStoryRing, registerStoryRingFinder, type ScreenRect } from '../storyReturn';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
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
import { loadStorySource } from '../storySources';
import { prepareStoryOpening } from '../prepareStoryOpening';
import { discardStoryVideo } from '../preparedStoryVideo';
import { STORY_TRAY_QUERY_KEY, type StoryTray as StoryTrayData, type TrayGroup } from '../storyTypes';

/** How long a tap waits for prepared media before opening the viewer anyway. */
const OPEN_WITHOUT_WAITING_MS = 150;
import { CLOSE_FRIENDS_GREEN } from '../settings/storySettings';

/** Instagram's unseen-Story gradient. */
const UNSEEN = ['#FEDA75', '#FA7E1E', '#D62976', '#962FBF', '#4F5BD5'] as const;
const CLOSE_FRIENDS_LOADING = [CLOSE_FRIENDS_GREEN, '#78E997', '#148B42', CLOSE_FRIENDS_GREEN] as const;
const PAGE = '#100F0D';

/** Dashes in the loading ring, and how much of each slot a dash fills. */
const LOADING_DASHES = 12;
const DASH_FILL = 0.55;

/**
 * Opening a Story: the ring breaks into rounded dashes that spin, each a
 * little brighter than the one behind it - a trail, as on Instagram - until
 * the Story is ready and the ring is whole again.
 */
function LoadingRing({ colors }: { colors: readonly string[] }) {
  const { ring, avatar } = useContext(TraySize);
  const stroke = Math.max(2, (ring - avatar - 4) / 2 + 0.5);
  const radius = ring / 2 - stroke / 2;
  const circumference = 2 * Math.PI * radius;
  const slot = circumference / LOADING_DASHES;
  const id = React.useId().replace(/:/g, '');
  return (
    <Svg width={ring} height={ring} style={StyleSheet.absoluteFill}>
      <Defs>
        <SvgGradient id={id} x1="0" y1="1" x2="1" y2="0">
          {colors.map((color, index) => <Stop key={index} offset={index / Math.max(1, colors.length - 1)} stopColor={color} />)}
        </SvgGradient>
      </Defs>
      {Array.from({ length: LOADING_DASHES }, (_, index) => (
        <Circle
          key={index}
          cx={ring / 2} cy={ring / 2} r={radius}
          stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round" fill="none"
          strokeDasharray={`${slot * DASH_FILL} ${circumference - slot * DASH_FILL}`}
          strokeDashoffset={-index * slot}
          opacity={0.18 + 0.82 * (index / (LOADING_DASHES - 1))}
        />
      ))}
    </Svg>
  );
}

const SEEN_LOADING = ['#8A8A90', '#5A5A60'] as const;

function Ring({ state, loading, children }: { state: 'closeFriends' | 'unseen' | 'seen' | 'none'; loading: boolean; children: React.ReactNode }) {
  const { styles } = useContext(TraySize);
  const spin = useSharedValue(0);
  useEffect(() => {
    if (loading) {
      spin.value = 0;
      spin.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1);
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
          <LoadingRing colors={state === 'closeFriends' ? CLOSE_FRIENDS_LOADING : state === 'seen' ? SEEN_LOADING : UNSEEN} />
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


/**
 * Your avatar while stories post: a ring that fills with progress, or turns red
 * with an exclamation mark when posting failed.
 */
function PostingRing({ posting, children }: { posting: Posting; children: React.ReactNode }) {
  const { styles, ring: size } = useContext(TraySize);
  const POSTING_RADIUS = (size - 4) / 2;
  const POSTING_CIRCUMFERENCE = 2 * Math.PI * POSTING_RADIUS;
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
  const { styles, avatar } = useContext(TraySize);
  return uri
    ? <Image source={{ uri }} style={styles.avatar} />
    : <View style={[styles.avatar, styles.avatarFallback]}><Ionicons name="person" size={Math.round(avatar * 0.45)} color="#8B8B90" /></View>;
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
export function StoryTray({ demo = false, onOpenChange, variant = 'tray', demoScenario = 'everyone', motion }: {
  demo?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 'header': only your own ring and "+", beside the Explore title, for when nobody else has a Story. */
  variant?: 'tray' | 'header';
  /** Demo only: whose Stories exist - everyone's, only yours, or none (to see each Explore layout). */
  demoScenario?: 'everyone' | 'mine' | 'none';
  /**
   * Explore's row opening or closing, 0 to 1 (DiscoverScreen). While it
   * moves, a copy of your avatar flies between the two places (DiscoverScreen
   * draws it - a scrolling row clips anything leaving it), so your own item
   * waits hidden; the others fade and grow in.
   */
  motion?: SharedValue<number>;
}) {
  const sizes = variant === 'header' ? HEADER_SIZES : TRAY_SIZES;
  const styles = sizes.styles;
  const settled = useSharedValue(1);
  const progress = motion ?? settled;
  const ownMotionStyle = useAnimatedStyle(() => ({ opacity: progress.value > 0.995 ? 1 : 0 }));
  const othersMotionStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, (progress.value - 0.3) / 0.7),
    transform: [{ scale: 0.9 + 0.1 * progress.value }],
  }));
  const socket = useSocket();
  const navigation = useNavigation<any>();
  const user = useSelector((state: RootState) => state.auth.user);
  const userAvatar: string | null = user?.avatarUrl ?? user?.photos?.[0]?.photoUrl ?? user?.photos?.[0] ?? null;
  const [opening, setOpening] = useState<string | null>(null);
  const openingAbort = useRef<AbortController | null>(null);
  // The story grows out of the tapped avatar (STORY_AUDIENCE_SPEC.md,
  // section 17.3): the viewer runs it, from the ring passed as openFrom.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const avatarRefs = useRef<Map<string, View>>(new Map());
  useFocusEffect(useCallback(() => () => {
    if (openingAbort.current) {
      openingAbort.current.abort();
      discardStoryVideo();
    }
  }, []));
  const { data, refetch } = useQuery({
    queryKey: STORY_TRAY_QUERY_KEY,
    queryFn: async () => (await api.get('/stories/tray')).data.data as StoryTrayData,
    staleTime: 30_000,
    enabled: !demo,
  });
  useFocusEffect(useCallback(() => {
    if (!demo) void refetch();
  }, [demo, refetch]));

  const [demoGroups, setDemoGroups] = useState<TrayGroup[]>(() => {
    if (!demo || demoScenario === 'none') return [];
    const all = buildDemoStoryGroups(userAvatar);
    return demoScenario === 'mine' ? all.filter((group) => group.isOwn) : all;
  });
  const [demoViewer, setDemoViewer] = useState<{ groups: TrayGroup[]; start: number; openFrom: ScreenRect | null } | null>(null);
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

  // The row keeps its order while you are on Explore - a watched person stays
  // where they were (a closing Story lands in their ring, and nothing shifts
  // under your thumb); new Stories join at the end. The server's order (watched
  // people last) applies when you come back to Explore from elsewhere.
  const latestGroups = demo ? demoGroups : data?.groups ?? [];
  const frozenOrder = useRef<string[] | null>(null);
  const groups = React.useMemo(() => {
    const ids = latestGroups.map((group) => group.owner.id);
    if (!frozenOrder.current) { frozenOrder.current = ids; return latestGroups; }
    const kept = frozenOrder.current.filter((id) => ids.includes(id));
    const order = [...kept, ...ids.filter((id) => !kept.includes(id))];
    frozenOrder.current = order;
    const byId = new Map(latestGroups.map((group) => [group.owner.id, group]));
    return order.map((id) => byId.get(id)!);
  }, [latestGroups]);
  useFocusEffect(useCallback(() => {
    if (!closedRecently()) frozenOrder.current = null;
  }, []));
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

  // A closing Story shrinks back into its owner's ring: tell it where that is.
  useEffect(() => registerStoryRingFinder((ownerId) => new Promise((resolve) => {
    const ref = avatarRefs.current.get(ownerId);
    if (!ref) { resolve(null); return; }
    ref.measureInWindow((x, y, width, height) => {
      // Scrolled out of the row, or not laid out: no ring to go back to.
      const onScreen = width > 0 && x > -width / 2 && x + width / 2 < winWidth && y > -height && y < winHeight;
      // Another person's item also holds their name under the ring: just the ring, at its top.
      const size = height > width ? width - 4 : Math.min(width, height);
      resolve(onScreen ? { x: x + (width - size) / 2, y: height > width ? y : y + (height - size) / 2, width: size, height: size } : null);
    });
  })), [winHeight, winWidth]);

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
      // Open at once, as Instagram does. Media that is ready in a moment opens
      // prepared; anything slower loads in the viewer, under its own spinner,
      // so a tap never waits on the network with nothing happening.
      const preparing = new AbortController();
      const stopPreparing = () => preparing.abort();
      request.signal.addEventListener('abort', stopPreparing, { once: true });
      const source = await Promise.race([
        prepareStoryOpening(first.id, preparing.signal).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), OPEN_WITHOUT_WAITING_MS)),
      ]);
      request.signal.removeEventListener('abort', stopPreparing);
      // Not ready yet: the viewer loads it. Stopping here releases any half-made video player.
      if (!source) preparing.abort();
      clearTimeout(loadingTimer);
      setOpening(null);
      if (request.signal.aborted) return;

      // The viewer grows out of this ring itself (StoryViewer openFrom): no
      // overlay window here, which Android showed too late to be seen.
      const openFrom = await findStoryRing(group.owner.id);
      if (request.signal.aborted) return;
      // The viewer now owns the prepared buffer. Blur cleanup must not release it.
      openingAbort.current = null;

      if (demo) {
        setDemoViewer({ groups, start: groupIndex, openFrom });
        onOpenChange?.(true);
        return;
      }
      navigation.navigate('StoryViewer', { groups, startGroupIndex: groupIndex, openFrom });
    } catch {
      discardStoryVideo();
      if (!request.signal.aborted) Alert.alert("Couldn't load story", 'Check your connection and try again.');
    } finally {
      clearTimeout(loadingTimer);
      if (openingAbort.current === request) {
        openingAbort.current = null;
        setOpening(null);
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

  // The own item is the same in both places: your story, posting progress, and "+".
  const ownItem = (
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
        <Ionicons name="add" size={variant === 'header' ? 12 : 16} color="#fff" />
      </Pressable>
      {variant === 'tray' && <Text style={styles.name} numberOfLines={1}>{posting?.status === 'failed' ? "Couldn't post" : posting && posting.status !== 'cancelled' && posting.status !== 'completed' ? 'Posting…' : 'Your story'}</Text>}
    </View>
  );

  return (
    <TraySize.Provider value={sizes}>
      {variant === 'header' ? ownItem : (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tray} contentContainerStyle={styles.row}>
        <Animated.View style={ownMotionStyle}>{ownItem}</Animated.View>
        {groups.map((group, index) => (group.isOwn ? null : (
          <Animated.View key={group.owner.id} style={othersMotionStyle}>
          <Pressable
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
          </Animated.View>
        )))}
      </ScrollView>
      )}

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
              openFrom={demoViewer.openFrom}
              demoViewers={DEMO_VIEWERS}
              backRef={viewerBack}
              onClose={closeDemoViewer}
              onSeen={(storyId) => setDemoGroups((current) => applySeen(current, storyId))}
              onLiked={(storyId, liked) => setDemoGroups((current) => applyLiked(current, storyId, liked))}
            />
          ) : null}
        </Modal>
      ) : null}
    </TraySize.Provider>
  );
}

/** One set of sizes per place the tray appears. */
function makeSizes(AVATAR: number, gap: number) {
  const RING = AVATAR + gap;
  const badge = AVATAR > 40 ? 22 : 16;
  const styles = StyleSheet.create({
  // A ScrollView grows to fill its column by default, which pushed the cards
  // halfway down the screen. The tray is only as tall as its avatars.
  tray: { flexGrow: 0, flexShrink: 0 },
  row: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 6, gap: 10 },
  item: { width: RING + 4, alignItems: 'center' },
  ringOuter: { width: RING, height: RING, borderRadius: RING / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  seenRing: { borderRadius: RING / 2, borderWidth: 1.5, borderColor: '#4A4A50' },
  ringInner: { width: AVATAR + 4, height: AVATAR + 4, borderRadius: (AVATAR + 4) / 2, backgroundColor: PAGE, alignItems: 'center', justifyContent: 'center' },
  plain: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: '#2A2A2D' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  plus: {
    position: 'absolute', top: RING - badge, right: AVATAR > 40 ? 2 : -3, width: badge, height: badge, borderRadius: badge / 2,
    backgroundColor: colors.primary, borderWidth: 2, borderColor: PAGE, alignItems: 'center', justifyContent: 'center',
  },
  name: { color: '#F0ECEA', fontSize: 11, marginTop: 4, maxWidth: RING + 4 },
  failedBadge: {
    position: 'absolute', right: 2, bottom: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: '#ED4956',
    borderWidth: 2, borderColor: PAGE, alignItems: 'center', justifyContent: 'center',
  },
  failedBadgeText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  nameSeen: { color: '#A9A6A3' },
  });
  return { avatar: AVATAR, ring: RING, styles };
}
/** Explore's tray: compact faces, so the profile card keeps the screen. */
const TRAY_SIZES = makeSizes(52, 8);
/** Beside the Explore title, when nobody else has a Story: your ring and its "+". The face is as big as the header's 40 px buttons. */
const HEADER_SIZES = makeSizes(40, 4);
const TraySize = React.createContext(TRAY_SIZES);
