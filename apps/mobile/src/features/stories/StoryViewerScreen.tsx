import { findStoryRing, markStoryClosed, type ScreenRect } from './storyReturn';
import { VerifiedBadge } from '../discovery/components/VerifiedBadge';
import { openVerifyRules } from '../verification/verifyGate';
import { openReport } from '../safety/ReportSheet';
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, BackHandler, Image, Keyboard, Pressable, StyleSheet, Text,
  TextInput, View, useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing, cancelAnimation, makeMutable, runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withSpring, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { AndroidSoftInputModes, KeyboardController } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system/legacy';
import { requestPermissionsAsync, saveToLibraryAsync } from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StoryGestureGuide, markStoryGuideSeen, shouldShowStoryGuide } from '../teaching/StoryGestureGuide';
import { api } from '../../services/api';
import { ChatMedia } from '../../../modules/chat-media';
import { colors } from '../../core/theme/colors';
import { StoryProgressBar } from './components/StoryProgressBar';
import { StoryMedia } from './components/StoryMedia';
import { dragCubePosition } from './cubeMotion';
import { OwnStoryFooter, StoryFooter, StoryFooterPreview } from './components/StoryFooter';
import { EmojiBurst } from './components/EmojiBurst';
import { StoryActivitySheet } from './components/StoryActivitySheet';
import { StoryOverlays } from './components/StoryOverlays';
import { STICKERS_WITH_RESULTS } from './components/StickerResults';
import { ProfileDetailModal } from '../discovery/components/profile-detail/ProfileDetailModal';
import { usePostings } from './create/publish/postingStore';
import {
  applyLiked, applySeen, nextPosition, openingPosition, previousPosition, relativeTime, type StoryPosition,
} from './storyNavigation';
import { cachedStorySource, forgetStorySource, loadStorySource, storyStill, type StorySource } from './storySources';
import { StoryInsightTracker } from './storyInsights';
import { STORY_TRAY_QUERY_KEY, type StoryTray, type TrayGroup, type TrayStory } from './storyTypes';
import { CLOSE_FRIENDS_GREEN, STORY_SETTINGS_QUERY_KEY, storyAudienceApi, useStorySettings } from './settings/storySettings';
import { StoryActionSheet, type StoryAction } from './components/StoryActionSheet';

/**
 * Screenshots are blocked through our own native module, which sets
 * FLAG_SECURE on every app window, Modals included, and registers no
 * screenshot listener (so Android shows no "detected a screenshot" notice).
 * A build without the function simply does not block.
 */
function setCaptureBlocked(blocked: boolean) {
  ChatMedia?.setScreenCaptureBlocked?.(blocked)?.catch(() => undefined);
}

/** Shown in place of the message bar. Nothing when replies are off, so a Close Friends limit stays private. */
const replyHintFor = (group: TrayGroup) => (group.replyBlockedReason === 'not_matched' ? 'Match to reply' : null);

/** The Archive header's date, in place of "2h" once a Story has ended (section 4.4). */
const postedDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Instagram's default for a photo Story. A video lasts as long as the video. */
const PHOTO_MS = 5000;
/** Taps in the left part go back; the rest go forward, which is far more common. */
const BACK_ZONE = 0.3;
// Critically damped release: keep the finger's velocity without a bounce.
const CUBE_RELEASE = { stiffness: 400, damping: 40, mass: 1, overshootClamping: true, restDisplacementThreshold: 0.0005, restSpeedThreshold: 0.005 };
/** Shown once: the note that a saved Story does not include interactive stickers. */
const SAVE_TIP_KEY = 'story_save_tip_shown';
const noop = () => undefined;
// Rendering history is only a startup hint. It does not prove that video bytes
// remain in the native cache.
const renderedStoryUrls = new Set<string>();

/**
 * One person's page of the cube. Pages sit around a vertical edge: the page
 * leaving turns about its right edge and the page arriving about its left, so
 * dragging between people reads as a cube being turned, as in Instagram.
 */
function CubePage({ index, active, position, width, children }: {
  index: number;
  active: boolean;
  position: SharedValue<number>;
  width: number;
  children: React.ReactNode;
}) {
  const pageStyle = useAnimatedStyle(() => {
    const offset = index - position.value;
    if (offset <= -1 || offset >= 1) {
      return { opacity: 0, transform: [{ translateX: offset > 0 ? width * 2 : -width * 2 }] };
    }
    // Translate the container in screen coordinates. Perspective belongs only
    // to the inner face, so it cannot move the shared edge.
    const outgoing = offset <= 0 ? -offset : 1 - offset;
    // Follow the finger at constant speed. A cosine makes the edge lag at
    // the start and accelerate near the end of the same drag.
    const seam = width * (1 - outgoing);
    return {
      opacity: 1,
      transform: [{ translateX: seam - width }],
    };
  });
  const faceStyle = useAnimatedStyle(() => {
    const offset = index - position.value;
    return {
      transform: [{ perspective: width * 8 }, { rotateY: `${offset * 90}deg` }],
    };
  });
  const contentStyle = useAnimatedStyle(() => {
    const offset = index - position.value;
    return { transform: [{ translateX: offset <= 0 ? 0 : width }] };
  });
  const shadeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(0.18, Math.abs(index - position.value) * 0.18),
  }));
  return (
    <Animated.View pointerEvents={active ? 'box-none' : 'none'} style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: width * 2 }, pageStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, faceStyle]}>
        <Animated.View style={[styles.page, { position: 'absolute', left: 0, top: 0, bottom: 0, width }, contentStyle]}>
          {children}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shade, shadeStyle]} />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

function Header({ group, publishedAt, ended, closeFriends, showMute, muted, onToggleMute, onMenu, onClose, onOpenProfile }: {
  group: TrayGroup;
  publishedAt: string;
  /** True once the Story has ended (Archive, section 4.4): shows the date posted rather than "2h". */
  ended?: boolean;
  /** A Close Friends story: the green star pill beside the time. */
  closeFriends?: boolean;
  showMute: boolean;
  muted: boolean;
  onToggleMute?: () => void;
  onMenu?: () => void;
  onClose?: () => void;
  /**
   * Tapping the name or avatar (section 17.3). Only ever offered when there
   * is a profile to send you to. Measures its own screen position so the
   * profile can grow out of it the same way the tray's avatars do.
   */
  onOpenProfile?: () => void;
}) {
  const identityRef = useRef<View>(null);
  const identity = (
    <>
      {group.owner.avatarUrl
        ? <Image source={{ uri: group.owner.avatarUrl }} style={styles.avatar} />
        : <View style={[styles.avatar, styles.avatarFallback]}><Ionicons name="person" size={16} color="#bbb" /></View>}
      <Text style={styles.name} numberOfLines={1}>{group.isOwn ? 'Your story' : group.owner.name}</Text>
      {/* The blue badge: college and selfie both verified (features/verification). */}
      {group.owner.blueBadge ? <View style={styles.badge}><VerifiedBadge size={15} /></View> : null}
    </>
  );
  return (
    <View style={styles.header} onStartShouldSetResponder={() => true}>
      {onOpenProfile ? (
        <Pressable
          ref={identityRef}
          accessibilityRole="button"
          accessibilityLabel={`Open ${group.owner.name}'s profile`}
          onPress={onOpenProfile}
          style={styles.headerIdentity}
          hitSlop={6}
        >
          {identity}
        </Pressable>
      ) : identity}
      <Text style={styles.time}>{ended ? postedDate(publishedAt) : relativeTime(publishedAt)}</Text>
      {closeFriends ? (
        <View style={styles.closeFriendsPill} accessible accessibilityLabel="Close Friends story">
          <Ionicons name="star" size={10} color="#fff" />
          <Text style={styles.closeFriendsText}>Close Friends</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      {showMute ? (
        <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Turn sound on' : 'Mute'} onPress={onToggleMute} hitSlop={10} style={styles.headerButton}>
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color="#fff" />
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Story options" onPress={onMenu} hitSlop={10} style={styles.headerButton}>
        <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Close Stories" onPress={onClose} hitSlop={10} style={styles.headerButton}>
        <Ionicons name="close" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

/** A neighbouring person's page, shown only while the cube turns. */
const PreviewPage = memo(function PreviewPage({ group, topInset, bottomInset, storyIndex, showFooter, still }: { group: TrayGroup; topInset: number; bottomInset: number; storyIndex: number; showFooter: boolean; still: string | null }) {
  const story = group.stories[storyIndex];
  return (
    <View style={StyleSheet.absoluteFill}>
      {still ? <Image source={{ uri: still }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} /> : null}
      {showFooter ? <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.5)']} style={[styles.bottomScrim, { height: bottomInset + 150 }]} /> : null}
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.45)', 'transparent']} style={[styles.topScrim, { height: topInset + 110 }]} />
      <View style={[styles.chrome, { paddingTop: topInset + 8 }]}>
        <View style={styles.previewBars}>
          {group.stories.map((item) => <View key={item.id} style={styles.previewTrack} />)}
        </View>
        {story ? <Header group={group} publishedAt={story.publishedAt} ended={new Date(story.expiresAt) <= new Date()} closeFriends={story.audience === 'close_friends'} showMute={false} muted={false} /> : null}
      </View>
      {showFooter && story ? (
        group.isOwn ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <OwnStoryFooter viewCount={story.viewCount ?? 0} likeCount={story.likeCount ?? 0} bottomInset={bottomInset} onOpenActivity={noop} />
          </View>
        ) : <StoryFooterPreview liked={story.liked} bottomInset={bottomInset} canReply={group.canReply !== false} replyHint={replyHintFor(group)} />
      ) : null}
    </View>
  );
});

export type StoryViewerProps = {
  initialGroups: TrayGroup[];
  startGroupIndex?: number;
  /** Opened from a link that carries only a Story id. */
  storyId?: string;
  onClose: () => void;
  /** Demo mode: nothing reaches the server; seen and liked state stays local. */
  demo?: boolean;
  demoViewers?: any[];
  onSeen?: (storyId: string) => void;
  onLiked?: (storyId: string, liked: boolean) => void;
  /**
   * Set to a handler for the back button when the viewer is shown in a React
   * Native Modal, whose back press never reaches BackHandler. It returns true
   * when it handled the press (closing the Activity sheet).
   */
  backRef?: React.MutableRefObject<(() => boolean) | null>;
  /** The tapped ring, on screen: the viewer grows out of it, the way it shrinks back on close. */
  openFrom?: ScreenRect | null;
};

/** The navigation screen for real Stories. */
export function StoryViewerScreen({ route, navigation }: any) {
  return (
    <StoryViewer
      initialGroups={route.params?.groups ?? []}
      startGroupIndex={route.params?.startGroupIndex}
      storyId={route.params?.storyId}
      openFrom={route.params?.openFrom}
      onClose={() => navigation.goBack()}
    />
  );
}

export function StoryViewer({
  initialGroups, startGroupIndex = 0, storyId: linkedStoryId, onClose, demo = false, demoViewers, onSeen, onLiked, backRef, openFrom,
}: StoryViewerProps) {
  const { width: windowWidth, height } = useWindowDimensions();
  const navigation = useNavigation<any>();
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const width = viewportWidth ?? windowWidth;
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [groups, setGroups] = useState<TrayGroup[]>(initialGroups);
  const [position, setPosition] = useState<StoryPosition>(() => (initialGroups.length
    ? openingPosition(initialGroups, startGroupIndex)
    : { group: 0, story: 0 }));
  const [missing, setMissing] = useState<string | null>(null);

  const [held, setHeld] = useState(false);
  // How Stories move, over the first Story anyone opens, once (teaching/tipsSeen).
  // It waits for that Story to be on screen, and counts as seen once it shows.
  const [guidePending, setGuidePending] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideOpenRef = useRef(false);
  guideOpenRef.current = guideOpen;
  useEffect(() => {
    let live = true;
    void shouldShowStoryGuide(demo).then((show) => { if (live && show) setGuidePending(true); });
    return () => { live = false; };
  }, [demo]);
  const closeGuide = useCallback(() => setGuideOpen(false), []);
  const [dragging, setDragging] = useState(false);
  const [typing, setTyping] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The matched owner's full profile, opened from tapping their name or
  // avatar (section 17.3) - "readOnly", so no Like/Pass, growing out of the
  // tapped identity the same way ProfileDetailModal already does for Discovery.
  const [matchProfile, setMatchProfile] = useState<{ user: any; loading?: boolean; request?: number; origin?: { x: number; y: number; width: number; height: number } } | null>(null);
  const profileRequest = useRef(0);
  const [backgrounded, setBackgrounded] = useState(AppState.currentState !== 'active');
  const [transitioning, setTransitioning] = useState(false);
  const [muted, setMuted] = useState(false);
  // Keyed by Story id, so a value left over from the previous Story is never
  // mistaken for this one's.
  const [readyId, setReadyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedSource, setLoadedSource] = useState<{ id: string; source: StorySource } | null>(null);
  // The last Story that actually drew. It stays mounted, frozen, under the next
  // one until that one has drawn too.
  const [shown, setShown] = useState<{ id: string; ownerId: string; source: StorySource } | null>(null);
  const [showSpinner, setShowSpinner] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  const [burst, setBurst] = useState<{ emoji: string; key: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [viewers, setViewers] = useState<any[]>([]);
  // Menus with more options than Android's three-button alert allows.
  const [actionSheet, setActionSheet] = useState<{ title?: string; actions: StoryAction[] } | null>(null);
  const [viewerCursor, setViewerCursor] = useState<string | null>(null);
  // Part 3, section 6: true once the 48-hour freeze has removed the viewer
  // list. Set from the same response that would otherwise just look like an
  // empty list.
  const [viewersClosed, setViewersClosed] = useState(false);
  // A sticker being answered (a question reply, a link prompt) holds the story.
  const [stickerBusy, setStickerBusy] = useState(false);
  // Pinching a story zooms it and holds it, as on Instagram.
  const [zooming, setZooming] = useState(false);
  const postings = usePostings();
  const ownPosting = postings.some((posting) => Boolean(posting.demo) === demo && (posting.status === 'creating' || posting.status === 'posting'));

  const group = groups[position.group];
  const story = group?.stories[position.story];
  const selectedStories = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    if (group && story) selectedStories.current.set(group.owner.id, story.id);
  }, [group, story]);
  const previewIndex = useCallback((target: TrayGroup) => {
    const savedId = selectedStories.current.get(target.owner.id);
    const savedIndex = target.stories.findIndex((item) => item.id === savedId);
    return savedIndex >= 0 ? savedIndex : openingPosition([target], 0).story;
  }, []);
  const source = story
    ? (loadedSource?.id === story.id ? loadedSource.source : cachedStorySource(story.id))
    : null;
  const ready = !!story && readyId === story.id;
  // A locked Reveal video does not play, so it is timed like a photo.
  const isVideo = !!source?.contentType.startsWith('video/') && !source.locked;
  const paused = held || guideOpen || dragging || typing || sheetOpen || activityOpen || backgrounded || transitioning || stickerBusy || zooming || !!matchProfile;
  const [everReady, setEverReady] = useState(false);
  useEffect(() => { if (ready) setEverReady(true); }, [ready]);
  useEffect(() => {
    if (!guidePending || !ready) return;
    setGuidePending(false);
    setGuideOpen(true);
    markStoryGuideSeen(demo);
  }, [demo, guidePending, ready]);

  // Create the zero value in the same render that selects the next Story.
  // An effect reset is too late: the new bar can draw the old progress first.
  const progress = useMemo(() => makeMutable(0), [story?.id, restartKey]);
  const groupPosition = useSharedValue(position.group);
  // The only coordinate used to draw the cube. Logical page commits must
  // never reset this value during an interrupted turn.
  const cubePosition = useSharedValue(position.group);
  const [cubeWindowCenter, setCubeWindowCenter] = useState(position.group);
  const cubeSettling = useSharedValue(false);
  const cubeTarget = useSharedValue(position.group);
  const cubeOwnsPosition = useRef(false);
  const panActive = useSharedValue(false);
  const dragOriginPosition = useSharedValue(position.group);
  const groupCount = useSharedValue(groups.length);
  useLayoutEffect(() => { groupCount.value = groups.length; }, [groupCount, groups.length]);
  const headerBottom = useSharedValue(insets.top + 64);
  const dragY = useSharedValue(0);
  const axis = useSharedValue(0);
  const chrome = useSharedValue(1);
  // Progress for a held (previous) Story, so it never moves the real bar.
  const heldProgress = useSharedValue(0);
  // Top edge of the Activity sheet; the screen height means hidden.
  const sheetOffset = useSharedValue(height);
  const zoomScale = useSharedValue(1);
  const zoomX = useSharedValue(0);
  const zoomY = useSharedValue(0);
  const focalStartX = useSharedValue(0);
  const focalStartY = useSharedValue(0);
  const pinchStarted = useSharedValue(false);
  // True from a pinch's start until the story has fully eased back.
  const zoomActive = useSharedValue(false);
  const smoothFocalX = useSharedValue(0);
  const smoothFocalY = useSharedValue(0);
  const baseScale = useSharedValue(1);
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  // Set once a pinch begins and cleared when every finger is up, so the
  // finger left on screen after a pinch does not swipe to another person.
  const pinchUsed = useSharedValue(false);

  // Every read and write of the progress bar happens on the UI thread, in the
  // order it was asked for. The timer used to read `progress.value` from
  // JavaScript, which returns the UI thread's value before a reset queued a
  // moment earlier has landed. A photo that followed a finished one therefore
  // saw a full bar, got a zero-length timer and was skipped, and so was the
  // next, until a video broke the chain.
  const resetProgress = () => {
    'worklet';
    cancelAnimation(progress);
    progress.value = 0;
  };
  const pauseProgress = () => {
    'worklet';
    cancelAnimation(progress);
  };
  const closing = useRef(false);
  // Closing into the owner's ring: 0 is the Story as it is, 1 is inside the ring.
  // Opening runs the close in reverse: from the ring (1) out to full screen (0),
  // set before the first frame so the Story never flashes full size first.
  const exitProgress = useSharedValue(openFrom ? 1 : 0);
  const exitTarget = useSharedValue(openFrom
    ? { cx: openFrom.x + openFrom.width / 2, cy: openFrom.y + openFrom.height / 2, size: openFrom.width }
    : { cx: 0, cy: 0, size: 0 });
  const exitFrom = useSharedValue({ scale: 1, y: 0 });
  // While opening, like a lightbox: the whole Story scales up out of the ring,
  // transforms only, fully opaque - no clip resizing or fade, which stuttered.
  const entering = useSharedValue(openFrom ? 1 : 0);
  useEffect(() => {
    if (!openFrom) return;
    // A frame late, so mounting the viewer does not eat the animation's first frames.
    const frame = requestAnimationFrame(() => {
      exitProgress.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) entering.value = 0;
      });
    });
    return () => cancelAnimationFrame(frame);
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const viewed = useRef(new Set<string>());
  const inputRef = useRef<TextInput>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the Story still while the keyboard opens; only the reply bar moves.
  useEffect(() => {
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    return () => KeyboardController.setDefaultMode();
  }, []);

  // Section 7.4: accumulated locally, sent as batches - flushed below on close,
  // backgrounding and every 30 s, never per tap.
  const insightTracker = useRef<StoryInsightTracker>(new StoryInsightTracker(demo)).current;
  useEffect(() => {
    const timer = setInterval(() => { void insightTracker.flush(); }, 30_000);
    return () => { clearInterval(timer); void insightTracker.flush(); };
  }, [insightTracker]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setBackgrounded(state !== 'active'));
    return () => subscription.remove();
  }, []);

  // Backgrounding the app while watching someone else's Story leaves it the
  // same way closing does (section 7.3), and is the one case that would
  // otherwise be lost entirely if the app never comes back to flush.
  const wasBackgrounded = useRef(backgrounded);
  useEffect(() => {
    if (backgrounded && !wasBackgrounded.current && story && group && !group.isOwn) {
      insightTracker.exited(story.id);
      void insightTracker.flush();
    }
    wasBackgrounded.current = backgrounded;
  }, [backgrounded, group, insightTracker, story]);

  // Section 7.2: a view is counted every time a Story becomes the one on
  // screen, repeats included - unlike the once-ever "seen" request above.
  useEffect(() => {
    if (story && group && !group.isOwn) insightTracker.view(story.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  useLayoutEffect(() => {
    if (cubeOwnsPosition.current) return;
    // Synchronize initial link loading only. After navigation starts, the UI
    // thread owns these coordinates; a delayed React render must not reset a drag.
    runOnUI((index: number) => {
      'worklet';
      groupPosition.value = index;
      cubePosition.value = index;
      cubeSettling.value = false;
    })(position.group);
  }, [position.group, groupPosition, cubePosition, cubeSettling]);

  // Opened from a link with only a Story id: find that Story in the tray.
  useEffect(() => {
    if (initialGroups.length) return;
    const storyId = linkedStoryId;
    if (!storyId) {
      setMissing('No active Stories.');
      return;
    }
    let active = true;
    api.get('/stories/tray')
      .then((response) => {
        if (!active) return;
        const tray = response.data?.data as StoryTray;
        const index = tray.groups.findIndex((item) => item.stories.some((entry) => entry.id === storyId));
        if (index < 0) {
          // Not in your tray (a muted author, say): open that one Story on its own.
          api.get(`/stories/${storyId}`)
            .then((single) => {
              if (!active) return;
              const data = single.data?.data;
              if (!data?.contentType || !data.owner) {
                setMissing('This Story is unavailable.');
                return;
              }
              const item: TrayStory = {
                id: data.id, ownerId: data.ownerId, contentType: data.contentType, caption: data.caption ?? null,
                publishedAt: data.publishedAt, expiresAt: data.expiresAt, durationMs: data.durationMs ?? null,
                composition: data.composition ?? null, audience: data.audience, seen: !!data.seen, liked: !!data.liked,
              };
              setGroups([{
                owner: data.owner,
                isOwn: data.replyBlockedReason === 'own',
                hasUnseen: !item.seen,
                closeFriendsUnseen: !item.seen && item.audience === 'close_friends',
                firstUnseenIndex: 0,
                latestPublishedAt: item.publishedAt,
                canReply: data.canReply,
                replyBlockedReason: data.replyBlockedReason,
                stories: [item],
              }]);
              setPosition({ group: 0, story: 0 });
            })
            .catch(() => { if (active) setMissing('This Story is unavailable.'); });
          return;
        }
        setGroups(tray.groups);
        setPosition({ group: index, story: tray.groups[index].stories.findIndex((entry) => entry.id === storyId) });
      })
      .catch(() => { if (active) setMissing('This Story is unavailable.'); });
    return () => { active = false; };
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  // Tapping the owner's name or avatar (STORY_AUDIENCE_SPEC.md, section
  // 17.3): only ever offered when matched (see the header's onOpenProfile
  // wiring below), since matching is the one place a profile can be reached
  // from - Chat's own profile screen is a settings menu, never this.
  const fetchMatchProfile = useCallback((matchId: string) => queryClient.fetchQuery({
    queryKey: ['stories', 'match-profile', matchId],
    queryFn: async () => (await api.get(`/profile/matches/${matchId}`)).data.data,
    staleTime: 30_000,
  }), [queryClient]);
  useEffect(() => {
    if (!demo && group?.matchId) void fetchMatchProfile(group.matchId).catch(() => undefined);
  }, [demo, group?.matchId, fetchMatchProfile]);
  const openMatchProfile = useCallback(async (target: TrayGroup) => {
    if (!target.matchId) return;
    const request = ++profileRequest.current;
    const cached = queryClient.getQueryData(['stories', 'match-profile', target.matchId]);
    setMatchProfile({ request, loading: !cached, user: cached ?? {
      id: target.owner.id, name: target.owner.name, primaryPhoto: target.owner.avatarUrl, photos: [],
    } });
    try {
      const user = await fetchMatchProfile(target.matchId);
      setMatchProfile((current) => current?.request === request ? { user, request, loading: false } : current);
    } catch {
      setMatchProfile((current) => current?.request === request ? null : current);
      showToast('Could not load profile');
    }
  }, [showToast, queryClient, fetchMatchProfile]);

  // Saving your own Story to the phone (STORY_ARCHIVE_SPEC.md, section 5.1).
  // Interactive stickers are drawn live on top of the file, so a saved copy
  // never includes them - only the underlying photo or video.
  const saveOwnStory = useCallback(async (target: { id: string; source: StorySource }) => {
    const isVideo = target.source.contentType.startsWith('video/');
    const permission = await requestPermissionsAsync(true, [isVideo ? 'video' : 'photo']).catch(() => null);
    if (!permission?.granted) { showToast('Allow gallery access to save'); return; }
    showToast('Saving…');
    try {
      const ext = isVideo ? 'mp4' : (target.source.contentType.includes('png') ? 'png' : 'jpg');
      const path = `${FileSystem.cacheDirectory}story-save-${target.id}.${ext}`;
      const { uri } = await FileSystem.downloadAsync(target.source.url, path);
      await saveToLibraryAsync(uri);
      const seenTip = await AsyncStorage.getItem(SAVE_TIP_KEY);
      if (!seenTip) {
        await AsyncStorage.setItem(SAVE_TIP_KEY, '1');
        showToast('Saved. Interactive stickers are not included.');
      } else {
        showToast('Saved');
      }
    } catch {
      showToast('Could not save');
    }
  }, [showToast]);

  // `exit` marks a deliberate close (swipe down, the X, back) for section 7.3's
  // "exited" event; left false when `close` runs to move past the very last
  // Story (tap or auto-advance already tracked their own event, or none at
  // all), or when a menu action closes the viewer to navigate elsewhere.
  // `toRing`: shrink back into the owner's ring first (Back, X, swipe down,
  // the last Story ending). Never when a menu closes the viewer to open
  // another screen - that navigation must not race the animation.
  const close = useCallback((exit = false, toRing = exit) => {
    if (closing.current) return;
    closing.current = true;
    // The guide goes at once, not with the Story as it shrinks away.
    setGuidePending(false);
    setGuideOpen(false);
    if (exit && story && group && !group.isOwn) insightTracker.exited(story.id);
    void insightTracker.flush();
    // The tray keeps its order on the way back (StoryTray), so this refresh
    // only brings seen rings and counts up to date.
    markStoryClosed();
    if (!demo) void queryClient.invalidateQueries({ queryKey: STORY_TRAY_QUERY_KEY });
    if (!toRing || !group) { onClose(); return; }
    void findStoryRing(group.owner.id).then((ring) => {
      if (!ring) {
        // A swipe down with nowhere to go back to: finish the slide away.
        if (dragY.value > 0) {
          runOnUI(() => {
            'worklet';
            dragY.value = withTiming(height, { duration: 220, easing: Easing.in(Easing.quad) }, (finished) => {
              if (finished) runOnJS(onClose)();
            });
          })();
        } else onClose();
        return;
      }
      runOnUI((target: { cx: number; cy: number; size: number }) => {
        'worklet';
        // Start from wherever the Story is now (a swipe down has already moved it).
        exitFrom.value = { scale: 1 - Math.min(1, dragY.value / height) * 0.3, y: dragY.value * 0.85 };
        exitTarget.value = target;
        exitProgress.value = withTiming(1, { duration: 300, easing: Easing.bezier(0.2, 0, 0, 1) }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      })({ cx: ring.x + ring.width / 2, cy: ring.y + ring.height / 2, size: ring.width });
    });
  }, [demo, dragY, exitFrom, exitProgress, exitTarget, group, height, insightTracker, onClose, queryClient, story]);

  // Load this Story's media, and warm the next two and the neighbouring people.
  useEffect(() => {
    if (!story) return;
    let active = true;
    runOnUI(resetProgress)();
    setFailed(false);
    const cached = cachedStorySource(story.id);
    setShowSpinner(false);
    let spinner: ReturnType<typeof setTimeout> | undefined;
    const scheduleSpinner = (delay: number) => {
      if (!active) return;
      spinner = setTimeout(() => { if (active) setShowSpinner(true); }, delay);
    };
    if (cached?.contentType.startsWith('image/')) {
      // A cached URL is not a cached image. Ask the native image cache before
      // showing network-loading UI during image decoding.
      (Image.queryCache ? Image.queryCache([cached.url]) : Promise.resolve({} as Record<string, string>))
        .then((entries) => { if (!entries[cached.url]) scheduleSpinner(350); })
        .catch(() => scheduleSpinner(350));
    } else {
      // Reopening a video creates a player even when its data is cached. Give
      // that player time to draw; retain feedback for an actual loading stall.
      scheduleSpinner(cached && renderedStoryUrls.has(cached.url) ? 2000 : 350);
    }
    if (!cached) {
      loadStorySource(story.id)
        .then((loaded) => { if (active) setLoadedSource({ id: story.id, source: loaded }); })
        .catch(() => { if (active) setFailed(true); });
    }
    let ahead: StoryPosition | null = position;
    for (let step = 0; step < 2; step += 1) {
      ahead = ahead ? nextPosition(groups, ahead) : null;
      const upcoming = ahead ? groups[ahead.group]?.stories[ahead.story] : undefined;
      if (upcoming) loadStorySource(upcoming.id).catch(() => undefined);
    }
    [position.group - 1, position.group + 1].forEach((neighbour) => {
      if (!groups[neighbour]) return;
      const opening = groups[neighbour].stories[previewIndex(groups[neighbour])];
      if (opening) loadStorySource(opening.id).catch(() => undefined);
    });
    return () => {
      active = false;
      clearTimeout(spinner);
      setShowSpinner(false);
    };
    // Keyed on the Story itself; `groups` changes as Stories are seen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  const handleReady = useCallback(() => {
    if (source) {
      renderedStoryUrls.add(source.url);
      if (renderedStoryUrls.size > 128) {
        renderedStoryUrls.delete(renderedStoryUrls.values().next().value!);
      }
    }
    if (story) setReadyId(story.id);
    if (story && source) setShown({ id: story.id, ownerId: story.ownerId, source });
    setShowSpinner(false);
    if (!story || !group || viewed.current.has(story.id)) return;
    viewed.current.add(story.id);
    if (group.isOwn || story.seen) return;
    setGroups((current) => applySeen(current, story.id));
    onSeen?.(story.id);
    if (demo) return;
    // Seen once the media is actually on screen, not when the viewer opened.
    api.post(`/stories/${story.id}/views`).catch(() => undefined);
    queryClient.setQueryData<StoryTray>(STORY_TRAY_QUERY_KEY, (old) => (old ? { groups: applySeen(old.groups, story.id) } : old));
  }, [demo, group, onSeen, queryClient, source, story]);

  const commitGroup = useCallback((groupIndex: number, storyIndex: number) => {
    cubeOwnsPosition.current = true;
    if (groupIndex !== groupPosition.value || panActive.value || cubeSettling.value) {
      setCubeWindowCenter(groupPosition.value);
      return;
    }
    setCubeWindowCenter(groupIndex);
    setPosition({ group: groupIndex, story: storyIndex });
    setTransitioning(false);
    if (!panActive.value) setDragging(false);
  }, [cubeSettling, groupPosition, panActive]);

  const moveTo = useCallback((target: StoryPosition | null) => {
    if (transitioning || cubeSettling.value || panActive.value || position.group !== groupPosition.value) return;
    if (!target) {
      // The last Story has ended: back into its ring.
      close(false, true);
      return;
    }
    if (target.group === position.group) {
      setPosition(target);
      return;
    }
    // Another person: turn the cube, then show their Story.
    setTransitioning(true);
    cubeSettling.value = true;
    cubeTarget.value = target.group;
    cubePosition.value = withSpring(target.group, { ...CUBE_RELEASE, velocity: 0 }, (finished) => {
      if (!finished) return;
      groupPosition.value = target.group;
      cubeSettling.value = false;
      runOnJS(commitGroup)(target.group, target.story);
    });
  }, [close, commitGroup, cubePosition, cubeSettling, cubeTarget, groupPosition, panActive, position.group, transitioning]);

  const goNext = useCallback(() => moveTo(nextPosition(groups, position)), [groups, moveTo, position]);
  const goPrevious = useCallback(() => {
    const target = previousPosition(groups, position);
    if (target.group === position.group && target.story === position.story) {
      runOnUI(resetProgress)();
      setRestartKey((value) => value + 1);
      return;
    }
    moveTo(target);
  }, [groups, moveTo, position, progress]);
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;
  const storyIdRef = useRef(story?.id);
  storyIdRef.current = story?.id;
  // A finished timer only moves on if its Story is still the one showing.
  const finishStoryFor = useCallback((storyId?: string) => {
    if (!storyId || storyId === storyIdRef.current) goNextRef.current();
  }, []);
  const finishStory = useCallback(() => goNextRef.current(), []);

  // A photo's bar runs for five seconds on the UI thread and resumes where it
  // stopped. A video's bar is driven by playback time in StoryMedia.
  useEffect(() => {
    if (!story || !ready || paused || isVideo) {
      runOnUI(pauseProgress)();
      return;
    }
    const storyId = story.id;
    // The photo's chosen length (1–15 s, or its music clip); older stories use Instagram's 5 s.
    const photoMs = story.durationMs && story.durationMs > 0 ? story.durationMs : PHOTO_MS;
    runOnUI(() => {
      'worklet';
      const remaining = Math.max(0, 1 - progress.value) * photoMs;
      progress.value = withTiming(1, { duration: remaining, easing: Easing.linear }, (finished) => {
        if (finished) runOnJS(finishStoryFor)(storyId);
      });
    })();
    return () => runOnUI(pauseProgress)();
    // The worklets only close over shared values and stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishStoryFor, isVideo, paused, ready, restartKey, story?.id, progress]);

  const replyCommands = useRef(new Map<string, { id: string; sending: boolean }>());
  const sendReply = useCallback(async (content: string, kind: 'text' | 'reaction' = 'text'): Promise<boolean> => {
    if (!story) return false;
    if (demo) {
      showToast('Sent');
      return true;
    }
    const requestKey = JSON.stringify([story.id, kind, content]);
    const command = replyCommands.current.get(requestKey) ?? { id: `story-reply-${Date.now()}-${Math.random().toString(36).slice(2)}`, sending: false };
    if (command.sending) return false;
    command.sending = true;
    replyCommands.current.set(requestKey, command);
    try {
      const response = await api.post(`/stories/${story.id}/reply`, {
        content,
        kind,
        clientMessageId: command.id,
      });
      if (!response.data?.success || !response.data?.data) throw new Error('Reply not sent');
      replyCommands.current.delete(requestKey);
      showToast('Sent');
      // Messaging the owner unlocks a Reveal story: fetch its real media.
      if (source?.locked) {
        const storyId = story.id;
        forgetStorySource(storyId);
        loadStorySource(storyId).then((loaded) => setLoadedSource({ id: storyId, source: loaded })).catch(() => undefined);
      }
      return true;
    } catch (error: any) {
      // Story replies count towards the 30 messages before verifying (GOOGLE_SIGNUP_PLAN.md 2.7).
      if (openVerifyRules(navigation, error)) return false;
      const data = error?.response?.data;
      const code = data?.code ?? data?.error?.code;
      if (code === 'STORY_REPLY_REQUIRES_MATCH' || code === 'STORY_REPLIES_OFF' || code === 'STORY_UNAVAILABLE') {
        showToast(code === 'STORY_REPLY_REQUIRES_MATCH' ? 'You can reply once you match' : code === 'STORY_REPLIES_OFF' ? 'Replies are turned off' : 'This Story is no longer available');
      } else if (kind === 'reaction') {
        Alert.alert('Reaction not sent', 'Check your connection and retry.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retry', onPress: () => { void sendReply(content, kind); } },
        ]);
      }
      return false;
    } finally {
      command.sending = false;
    }
  }, [demo, navigation, showToast, source?.locked, story]);

  const toggleLike = useCallback(() => {
    if (!story) return;
    const liked = !story.liked;
    const update = (value: boolean) => {
      setGroups((current) => applyLiked(current, story.id, value));
      onLiked?.(story.id, value);
      if (!demo) queryClient.setQueryData<StoryTray>(STORY_TRAY_QUERY_KEY, (old) => (old ? { groups: applyLiked(old.groups, story.id, value) } : old));
    };
    update(liked);
    if (!demo) api.put(`/stories/${story.id}/like`, { liked }).catch(() => update(!liked));
  }, [demo, onLiked, queryClient, story]);

  const loadViewers = useCallback(async (restart: boolean) => {
    if (!story) return;
    if (demo) {
      setViewers(demoViewers ?? []);
      setViewerCursor(null);
      return;
    }
    const response = await api.get(`/stories/${story.id}/viewers`, { params: { cursor: restart ? undefined : viewerCursor, limit: 50 } });
    const data = response.data.data;
    setViewers((current) => (restart ? data.items : [...current, ...data.items]));
    setViewerCursor(data.nextCursor);
    setViewersClosed(!!data.closed);
  }, [demo, demoViewers, story, viewerCursor]);

  // The Activity sheet's search: everyone who viewed whose name matches.
  const searchViewers = useCallback(async (query: string) => {
    if (!story) return [];
    if (demo) {
      const needle = query.toLowerCase();
      return (demoViewers ?? []).filter((item) => (item.viewer?.name ?? '').toLowerCase().includes(needle));
    }
    const response = await api.get(`/stories/${story.id}/viewers`, { params: { q: query, limit: 50 } });
    return response.data.data.items ?? [];
  }, [demo, demoViewers, story]);

  const openActivity = useCallback(() => {
    setActivityOpen(true);
    loadViewers(true).catch(() => undefined);
  }, [loadViewers]);
  const closeActivity = useCallback(() => {
    // Material 3's emphasized-accelerate curve, the same as closing by dragging.
    sheetOffset.value = withTiming(height, { duration: 250, easing: Easing.bezier(0.3, 0, 0.8, 0.15) }, (finished) => {
      if (finished) runOnJS(setActivityOpen)(false);
    });
  }, [height, sheetOffset]);

  // On your own Story the footer shows the first viewers' avatars, as Instagram's
  // "Activity" does, so the list is loaded as the Story comes up.
  useEffect(() => {
    if (group?.isOwn && story) loadViewers(true).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // Back closes the Activity sheet before it closes the viewer.
  const activityOpenRef = useRef(activityOpen);
  activityOpenRef.current = activityOpen;
  useEffect(() => {
    const handleBack = () => {
      if (guideOpenRef.current) {
        setGuideOpen(false);
        return true;
      }
      if (activityOpenRef.current) {
        closeActivity();
        return true;
      }
      // Routed through close() itself (section 7.3's "exited"), rather than
      // falling through to a bare navigation.goBack() that would skip both
      // the tray cache invalidation and the Insight event.
      close(true);
      return true;
    };
    if (backRef) backRef.current = handleBack;
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => {
      subscription.remove();
      if (backRef) backRef.current = null;
    };
  }, [backRef, close, closeActivity]);

  const openMenu = useCallback(() => {
    if (!story || !group) return;
    setSheetOpen(true);
    const done = () => setSheetOpen(false);
    if (group.isOwn) {
      setActionSheet({
        actions: [
          { label: 'Activity', onPress: () => { done(); openActivity(); } },
          ...(source && !source.locked ? [{
            label: source.contentType.startsWith('video/') ? 'Save video' : 'Save photo',
            onPress: () => { done(); void saveOwnStory({ id: story.id, source }); },
          }] : []),
          // Share again (section 9.2): only for a Story that has already
          // ended - Instagram offers this from the Archive, never a live Story.
          ...(!demo && new Date(story.expiresAt) <= new Date() ? [{
            label: 'Share again',
            onPress: () => {
              done();
              close();
              setTimeout(() => navigation.navigate('CreateStory', { shareAgain: { storyId: story.id, publishedAt: story.publishedAt } }), 250);
            },
          }] : []),
          ...(demo ? [] : [{
            label: 'Story settings',
            onPress: () => {
              done();
              close();
              setTimeout(() => navigation.navigate('StorySettings'), 250);
            },
          }]),
          {
            label: 'Delete Story',
            destructive: true,
            onPress: () => {
              done();
              Alert.alert('Delete this story?', "This can't be undone.", [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      if (!demo) await api.delete(`/stories/${story.id}`);
                    } catch {
                      showToast('Could not delete. Try again');
                      return;
                    }
                    const remaining = group.stories.filter((item) => item.id !== story.id);
                    if (!remaining.length) {
                      close();
                      return;
                    }
                    setGroups((current) => current.map((item, index) => (index === position.group ? { ...item, stories: remaining } : item)));
                    setPosition({ group: position.group, story: Math.min(position.story, remaining.length - 1) });
                  },
                },
              ]);
            },
          },
        ],
      });
    } else {
      setActionSheet({
        actions: [
          {
            label: `Mute ${group.owner.name}'s Stories`,
            onPress: async () => {
              done();
              if (!demo) await api.put(`/stories/authors/${group.owner.id}/mute`, { muted: true }).catch(() => undefined);
              close();
            },
          },
          {
            label: 'Report Story',
            destructive: true,
            onPress: async () => {
              done();
              const result = await openReport({
                userId: group.owner.id, name: group.owner.name, sourceType: 'story', sourceId: story.id,
                ...(demo ? { send: () => undefined, block: () => undefined } : {}),
              });
              if (result.blocked) close();
            },
          },
        ],
      });
    }
  }, [close, demo, group, navigation, openActivity, position, saveOwnStory, showToast, source, story]);

  // The ⋯ on a viewer in your Activity sheet. Each choice shows at once and rolls back if refused.
  const setRelation = useCallback((viewerId: string, change: Record<string, unknown>) => {
    setViewers((current) => current.map((row) => (row.viewerId === viewerId ? { ...row, relation: { ...row.relation, ...change } } : row)));
  }, []);
  const openViewerMenu = useCallback((row: any) => {
    const person = row?.viewer as { id: string; name: string; avatarUrl: string | null } | undefined;
    const relation = row?.relation as { closeFriend: boolean; hidden: boolean; followsYou: boolean; matchId: string | null } | undefined;
    if (!person || !relation || demo) return;
    const apply = (change: Partial<typeof relation>, request: () => Promise<unknown>, failure: string) => {
      const before = Object.fromEntries(Object.keys(change).map((key) => [key, relation[key as keyof typeof relation]]));
      setRelation(person.id, change);
      request()
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: STORY_SETTINGS_QUERY_KEY });
          void queryClient.invalidateQueries({ queryKey: STORY_TRAY_QUERY_KEY });
        })
        .catch(() => {
          setRelation(person.id, before);
          showToast(failure);
        });
    };
    const actions: StoryAction[] = [
      relation.hidden
        ? { label: `Show your story to ${person.name}`, onPress: () => apply({ hidden: false }, () => storyAudienceApi.remove('hidden', person.id), 'Could not update') }
        : { label: `Hide your story from ${person.name}`, onPress: () => apply({ hidden: true, closeFriend: false }, () => storyAudienceApi.add('hidden', person.id), 'Could not update') },
    ];
    if (relation.closeFriend) {
      actions.push({ label: 'Remove from Close Friends', onPress: () => apply({ closeFriend: false }, () => storyAudienceApi.remove('close_friends', person.id), 'Could not update') });
    } else if (!relation.hidden && (relation.followsYou || relation.matchId)) {
      actions.push({ label: 'Add to Close Friends', onPress: () => apply({ closeFriend: true }, () => storyAudienceApi.add('close_friends', person.id), 'Could not add') });
    }
    if (relation.followsYou) {
      actions.push({
        label: 'Remove follower',
        destructive: true,
        onPress: () => Alert.alert('Remove follower?', `${person.name} won't be told they were removed.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => apply({ followsYou: false }, () => api.delete(`/stories/follows/${person.id}`, { params: { direction: 'follower' } }), 'Could not remove'),
          },
        ]),
      });
    }
    if (relation.matchId) {
      const matchId = relation.matchId;
      actions.push({
        label: 'Message',
        onPress: () => {
          closeActivity();
          close();
          setTimeout(() => navigation.navigate('ChatScreen', { matchId, userName: person.name, userAvatar: person.avatarUrl, userId: person.id }), 250);
        },
      });
    }
    setActionSheet({ title: person.name, actions });
  }, [close, closeActivity, demo, navigation, queryClient, setRelation, showToast]);

  // Screenshots and screen recording are blocked while stories are open when
  // your own setting is on (the default, including before it has loaded).
  // The demo blocks too: it has no setting to read, so it uses the default.
  const { data: storySettings } = useStorySettings(!demo);
  const blockCapture = storySettings?.screenshotBlock !== false;
  useEffect(() => {
    if (!blockCapture) return;
    setCaptureBlocked(true);
    // The demo viewer is a Modal whose window may appear just after this runs: apply once more.
    const again = setTimeout(() => setCaptureBlocked(true), 400);
    return () => {
      clearTimeout(again);
      setCaptureBlocked(false);
    };
  }, [blockCapture]);

  const onSwipeUp = useCallback(() => {
    if (!group) return;
    if (group.isOwn) openActivity();
    else if (group.canReply !== false) inputRef.current?.focus();
  }, [group, openActivity]);

  // The gestures are built once, and rebuilt only when the viewer starts or
  // stops accepting them, which never happens mid-gesture. Built inline, every
  // render created new gesture objects and the detector swapped them in by
  // cancelling the gesture in progress. A hold, or the start of a swipe, sets
  // state and re-renders the viewer, so holding and swiping between people
  // never worked. What a gesture needs at run time comes from shared values and
  // refs instead.
  const latest = useRef({ goNext, goPrevious, close, onSwipeUp, groups, position, story, group });
  latest.current = { goNext, goPrevious, close, onSwipeUp, groups, position, story, group };
  // Explicit taps only (section 7.3) - the shared goNext/goPrevious below are
  // also reached by the auto-advance timer, which must never count as a tap.
  const tapNext = useCallback(() => {
    const { story: shown, group: shownGroup } = latest.current;
    if (shown && shownGroup && !shownGroup.isOwn) insightTracker.forward(shown.id);
    latest.current.goNext();
  }, [insightTracker]);
  const tapPrevious = useCallback(() => {
    const { story: shown, group: shownGroup } = latest.current;
    if (shown && shownGroup && !shownGroup.isOwn) insightTracker.back(shown.id);
    latest.current.goPrevious();
  }, [insightTracker]);
  const closeFromGesture = useCallback((exit?: boolean) => latest.current.close(exit), []);
  const swipeUp = useCallback(() => latest.current.onSwipeUp(), []);
  // The cube swipe between people (section 7.3): forward goes to the next
  // person's Stories ("next story"); backward leaves the current person's
  // Stories the same way closing does ("exited").
  const settleOnNeighbour = useCallback((target: number, direction: number) => {
    // A callback can reach JS after another gesture has already started.
    // Do not let that older completion mount media in the middle of a drag.
    if (target !== groupPosition.value) return;
    if (panActive.value || cubeSettling.value) {
      setCubeWindowCenter(target);
      return;
    }
    const { groups: current, position: at, story: shown, group: shownGroup } = latest.current;
    if (target === at.group) {
      setDragging(false);
      return;
    }
    if (shown && shownGroup && !shownGroup.isOwn) {
      if (direction > 0) insightTracker.nextStory(shown.id);
      else if (direction < 0) insightTracker.exited(shown.id);
    }
    if (!current[target]) return;
    commitGroup(target, previewIndex(current[target]));
  }, [commitGroup, cubeSettling, groupPosition, insightTracker, panActive, previewIndex]);

  const interactive = !typing && !activityOpen && !sheetOpen && !matchProfile;
  const gesture = useMemo(() => {
    const settleCube = (velocity: number, direction: number) => {
      'worklet';
      cubeSettling.value = true;
      const target = groupPosition.value + direction;
      cubeTarget.value = target;
      cubePosition.value = withSpring(target, { ...CUBE_RELEASE, velocity: -velocity / width }, (finished) => {
        if (!finished) return;
        groupPosition.value = target;
        cubeSettling.value = false;
        runOnJS(settleOnNeighbour)(target, direction);
      });
    };
    const pan = Gesture.Pan()
      .minDistance(6)
      .enabled(interactive)
      .onTouchesDown((event, manager) => {
        const y = event.allTouches[0]?.y ?? 0;
        if (y < headerBottom.value || y > height - insets.bottom - 90) manager.fail();
      })
      .onStart(() => {
        // A fresh drag takes over from the current visual position.
        panActive.value = true;
        cancelAnimation(cubePosition);
        const direction = cubeTarget.value - groupPosition.value;
        if (cubeSettling.value && direction !== 0 && Math.abs(cubePosition.value - groupPosition.value) > 0.5) {
          // The incoming page is already in front. Rebase without changing
          // the visible angle, so the next swipe can reach another person.
          groupPosition.value = cubeTarget.value;
          // Move only the preview window during a rapid swipe. Mounting a new
          // video player and story overlays here interrupts the next drag.
          // Activate the selected story once the cube has stopped.
          runOnJS(setCubeWindowCenter)(cubeTarget.value);
        }
        cubeSettling.value = false;
        dragOriginPosition.value = cubePosition.value;
        runOnJS(setTransitioning)(false);
        // The direction is decided on the first real movement, not here. On
        // Android the start event arrives with zero translation, so every swipe
        // was read as vertical and a left or right swipe did nothing.
        axis.value = 0;
        runOnJS(setDragging)(true);
      })
      .onUpdate((event) => {
        if (cubeSettling.value) return;
        // A second finger means a pinch: stop swiping and put the story back.
        if (event.numberOfPointers > 1 && !pinchUsed.value) {
          pinchUsed.value = true;
          cancelAnimation(cubePosition);
          cancelAnimation(dragY);
          cubePosition.value = groupPosition.value;
          dragY.value = 0;
        }
        if (pinchUsed.value) return;
        if (axis.value === 0) {
          if (Math.abs(event.translationX) < 6 && Math.abs(event.translationY) < 6) return;
          axis.value = Math.abs(event.translationX) > Math.abs(event.translationY) ? 1 : 2;
        }
        if (axis.value === 1) {
          cubePosition.value = dragCubePosition(groupPosition.value, dragOriginPosition.value, event.translationX, width);
        } else {
          dragY.value = Math.max(0, event.translationY);
        }
      })
      .onEnd((event, success) => {
        if (cubeSettling.value) return;
        if (!success) {
          settleCube(0, 0);
          dragY.value = withTiming(0, { duration: 160 });
          return;
        }
        if (pinchUsed.value) {
          cubePosition.value = groupPosition.value;
          dragY.value = 0;
          return;
        }
        if (axis.value === 1) {
          const fraction = cubePosition.value - groupPosition.value;
          const forward = event.velocityX < -700 || (Math.abs(event.velocityX) <= 700 && fraction > 0.35);
          const backward = event.velocityX > 700 || (Math.abs(event.velocityX) <= 700 && fraction < -0.35);
          if (forward && groupPosition.value < groupCount.value - 1) {
            settleCube(event.velocityX, 1);
          } else if (forward) {
            runOnJS(closeFromGesture)(true);
          } else if (backward && groupPosition.value > 0) {
            settleCube(event.velocityX, -1);
          } else {
            settleCube(event.velocityX, 0);
          }
        } else if (dragY.value > height * 0.15 || event.velocityY > 900) {
          // From where the finger let go, straight into the owner's ring
          // (close() slides it away instead when there is no ring to go to).
          runOnJS(closeFromGesture)(true);
        } else {
          dragY.value = withSpring(0, { damping: 22, stiffness: 240 });
          if (event.translationY < -70) runOnJS(swipeUp)();
        }
      })
      .onFinalize(() => {
        panActive.value = false;
        axis.value = 0;
        pinchUsed.value = false;
        if (!cubeSettling.value) runOnJS(setDragging)(false);
      });

    // Eases the zoom back without overshooting. Runs once, when fewer than two
    // fingers remain: with one finger left the pinch's focal point jumps to that
    // finger, and following it scattered the story across the screen.
    const releaseZoom = () => {
      'worklet';
      if (!pinchStarted.value) return;
      pinchStarted.value = false;
      const settle = { duration: 220, easing: Easing.out(Easing.cubic) };
      zoomX.value = withTiming(0, settle);
      zoomY.value = withTiming(0, settle);
      zoomScale.value = withTiming(1, settle, (finished) => {
        if (finished) zoomActive.value = false;
      });
      chrome.value = withTiming(1, { duration: 160 });
      runOnJS(setZooming)(false);
    };

    const pinch = Gesture.Pinch()
      .enabled(interactive)
      .onTouchesDown((_event, manager) => {
        if (cubeSettling.value) manager.fail();
      })
      .onStart((event) => {
        cancelAnimation(zoomScale);
        cancelAnimation(zoomX);
        cancelAnimation(zoomY);
        pinchStarted.value = true;
        pinchUsed.value = true;
        zoomActive.value = true;
        // Any swipe the two fingers began before the pinch was recognised is undone.
        cancelAnimation(cubePosition);
        cancelAnimation(dragY);
        cubePosition.value = groupPosition.value;
        dragY.value = 0;
        smoothFocalX.value = event.focalX;
        smoothFocalY.value = event.focalY;
        // Continue from the zoom as it is now, even if it was still easing back.
        baseScale.value = zoomScale.value;
        baseX.value = zoomX.value;
        baseY.value = zoomY.value;
        focalStartX.value = event.focalX;
        focalStartY.value = event.focalY;
        chrome.value = withTiming(0, { duration: 160 });
        runOnJS(setZooming)(true);
      })
      .onUpdate((event) => {
        if (!pinchStarted.value) return;
        if (event.numberOfPointers < 2) {
          releaseZoom();
          return;
        }
        const scale = Math.max(1, Math.min(4, baseScale.value * event.scale));
        const k = scale / baseScale.value;
        zoomScale.value = scale;
        // Finger contact points wobble by a pixel or two each frame; following
        // them exactly shook the story. A light low-pass filter steadies it.
        smoothFocalX.value += (event.focalX - smoothFocalX.value) * 0.35;
        smoothFocalY.value += (event.focalY - smoothFocalY.value) * 0.35;
        // The point that was between the fingers stays under them as they move.
        zoomX.value = smoothFocalX.value - width / 2 - k * (focalStartX.value - width / 2 - baseX.value);
        zoomY.value = smoothFocalY.value - height / 2 - k * (focalStartY.value - height / 2 - baseY.value);
      })
      .onFinalize(() => {
        releaseZoom();
      });

    const hold = Gesture.LongPress()
      .enabled(interactive)
      .onTouchesDown((event, manager) => {
        const y = event.allTouches[0]?.y ?? 0;
        if (cubeSettling.value || y < headerBottom.value || y > height - insets.bottom - 90) manager.fail();
      })
      .minDuration(180)
      .maxDistance(30)
      .onStart(() => {
        chrome.value = withTiming(0, { duration: 160 });
        runOnJS(setHeld)(true);
      })
      .onFinalize(() => {
        chrome.value = withTiming(1, { duration: 160 });
        runOnJS(setHeld)(false);
      });

    const tap = Gesture.Tap()
      .enabled(interactive)
      .maxDuration(250)
      .onEnd((event, success) => {
        if (!success || cubeSettling.value || event.y < headerBottom.value || event.y > height - insets.bottom - 90) return;
        if (event.x < width * BACK_ZONE) runOnJS(tapPrevious)();
        else runOnJS(tapNext)();
      });

    // Swiping works during a hold, as in Instagram: a finger that rests for a
    // moment and then moves still changes person or closes. A tap counts only
    // when neither a swipe nor a hold happened.
    return Gesture.Exclusive(Gesture.Simultaneous(pan, hold, pinch), tap);
    // Shared values and stable callbacks only; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, width, height, insets.bottom]);

  const dismissStyle = useAnimatedStyle(() => {
    const pulled = Math.min(1, dragY.value / height);
    // With the Activity sheet up, the Story shrinks into the space above it.
    // Blended by how far the sheet has risen (0 hidden, 1 at half height), so
    // the Story grows back continuously as the sheet closes. Switching the
    // shrink on and off at the screen edge made it jump at the end of closing.
    const offset = Math.min(height, sheetOffset.value);
    const risen = Math.max(0, Math.min(1, (height - offset) / (height * 0.5)));
    const fitScale = Math.max(0.2, Math.min(1, (offset - insets.top - 16) / height));
    const sheetScale = 1 + (fitScale - 1) * risen;
    const sheetShift = (insets.top + 8 - (height / 2) * (1 - fitScale)) * risen;
    const scale = (1 - pulled * 0.3) * sheetScale;
    const radius = Math.max(18 * risen, pulled > 0 ? 18 : 0);
    const e = exitProgress.value;
    if (e > 0 && entering.value) {
      const target = exitTarget.value;
      const grown = 1 + (target.size / width - 1) * e;
      return {
        borderRadius: (width / 2) * e,
        transform: [
          { translateX: (target.cx - width / 2) * e },
          { translateY: (target.cy - height / 2) * e },
          { scale: grown },
        ],
      };
    }
    if (e > 0) {
      // Shrinking into the ring: from where it was to the ring's centre and
      // size, the corners rounding into a circle, fading into the avatar at the end.
      const target = exitTarget.value;
      const from = exitFrom.value;
      const endScale = target.size / width;
      const exitScale = from.scale + (endScale - from.scale) * e;
      // The tall Story is trimmed top and bottom as it shrinks, to a square -
      // so it lands as a circle, not a pill. Only this clip changes size; the
      // Story inside stays laid out at full screen (exitContentStyle).
      const trim = Math.max(0, height - width) * e;
      return {
        top: trim / 2,
        bottom: trim / 2,
        borderRadius: 18 + (width / 2 - 18) * e,
        opacity: e < 0.65 ? 1 : 1 - (e - 0.65) / 0.35,
        transform: [
          { translateX: (target.cx - width / 2) * e },
          { translateY: from.y * (1 - e) + (target.cy - height / 2) * e },
          { scale: exitScale },
        ],
      };
    }
    return {
      borderRadius: radius / Math.max(scale, 0.2),
      transform: [{ translateY: dragY.value * 0.85 + sheetShift }, { scale }],
    };
  });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: (1 - Math.min(1, dragY.value / (height * 0.5))) * (1 - exitProgress.value) }));
  // Holds the Story still while its clip narrows (see dismissStyle).
  const exitContentStyle = useAnimatedStyle(() => ({ transform: [{ translateY: entering.value ? 0 : -(Math.max(0, height - width) * exitProgress.value) / 2 }] }));
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: zoomX.value }, { translateY: zoomY.value }, { scale: zoomScale.value }],
  }));
  // The still copy under the current story (there for the cube turn) is hidden
  // while the story is zoomed, or the moved story uncovers a duplicate of itself.
  const stillUnderZoomStyle = useAnimatedStyle(() => ({ opacity: zoomActive.value ? 0 : 1 }));
  const chromeStyle = useAnimatedStyle(() => {
    // The bars, header and footer fade away as the Activity sheet rises.
    const sheetVisible = Math.max(0, Math.min(1, (sheetOffset.value - height * 0.5) / (height * 0.5)));
    return { opacity: chrome.value * sheetVisible };
  });

  if (!group || !story) {
    return (
      <View style={styles.emptyScreen}>
        {missing ? <Text style={styles.stateText}>{missing}</Text> : <ActivityIndicator color="#fff" />}
        <Pressable accessibilityRole="button" accessibilityLabel="Close Stories" onPress={onClose}>
          <Text style={styles.stateAction}>Close</Text>
        </Pressable>
      </View>
    );
  }

  const pages = Array.from(new Set([
    position.group,
    cubeWindowCenter - 2, cubeWindowCenter - 1, cubeWindowCenter, cubeWindowCenter + 1, cubeWindowCenter + 2,
  ])).filter((index) => index >= 0 && index < groups.length).sort((a, b) => a - b);

  return (
    <GestureHandlerRootView
      style={styles.root}
      onLayout={({ nativeEvent }) => {
        const measuredWidth = nativeEvent.layout.width;
        if (measuredWidth > 0) setViewportWidth(measuredWidth);
      }}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={gesture}>
      <Animated.View collapsable={false} style={[StyleSheet.absoluteFill, styles.dismiss, dismissStyle]}>
        {/* Fixed at full size: only the clip around it narrows to a square when closing. */}
        <Animated.View style={[styles.exitContent, { height }, exitContentStyle]}>
        {pages.map((index) => (
          <CubePage key={groups[index].owner.id} index={index} active={index === position.group} position={cubePosition} width={width}>
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, index === position.group ? stillUnderZoomStyle : null]}>
              <PreviewPage
                group={groups[index]}
                topInset={insets.top}
                bottomInset={insets.bottom}
                showFooter={index !== position.group}
                storyIndex={index === position.group ? position.story : previewIndex(groups[index])}
                still={(() => {
                  const previewStory = groups[index].stories[index === position.group ? position.story : previewIndex(groups[index])];
                  const previewSource = previewStory ? cachedStorySource(previewStory.id) : null;
                  return previewSource ? storyStill(previewSource) : null;
                })()}
              />
            </Animated.View>
            {index === position.group ? (
              <View style={StyleSheet.absoluteFill}>
                  <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]} collapsable={false}>
                    {/* The Story before this one (of the same person) stays on screen,
                        frozen, while this one loads; this one is revealed once it has
                        drawn. Removing the old media first and waiting for the new
                        is what flashed black before every photo and video. Both are
                        keyed by Story id, so the old layer keeps its native view and
                        its last frame instead of being mounted again. */}
                    {[
                      ...(shown && shown.id !== story.id && shown.ownerId === story.ownerId ? [{ id: shown.id, source: shown.source, current: false }] : []),
                      ...(source && !failed ? [{ id: story.id, source, current: true }] : []),
                    ].map((layer) => (
                      <View
                        key={layer.id}
                        pointerEvents="none"
                        style={[StyleSheet.absoluteFill, layer.current && !ready && shown && shown.id !== story.id && shown.ownerId === story.ownerId ? styles.pendingLayer : null]}
                      >
                        <StoryMedia
                          source={layer.source}
                          playing={layer.current && !paused}
                          muted={layer.current ? muted : true}
                          restartKey={layer.current ? restartKey : 0}
                          progress={layer.current ? progress : heldProgress}
                          onReady={layer.current ? handleReady : noop}
                          onEnd={layer.current ? finishStory : noop}
                          onError={layer.current ? () => setFailed(true) : noop}
                        />
                      </View>
                    ))}
                  </Animated.View>

                <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.45)', 'transparent']} style={[styles.topScrim, { height: insets.top + 110 }]} />
                <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.5)']} style={[styles.bottomScrim, { height: insets.bottom + 150 }]} />

                {ready && !failed ? (
                  // Stickers and music are part of the story: they zoom with it and stay
                  // visible when the Activity sheet rises, unlike the header and footer.
                  <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, zoomStyle]}>
                    <StoryOverlays
                      key={story.id}
                      story={story}
                      width={width}
                      height={height}
                      isOwn={group.isOwn}
                      ownerName={group.owner.name}
                      demo={demo}
                      paused={paused}
                      progress={progress}
                      onInteractingChange={setStickerBusy}
                      showToast={showToast}
                    />
                  </Animated.View>
                ) : null}

                {group.isOwn && ownPosting ? (
                  <View pointerEvents="none" style={[styles.postingPill, { bottom: insets.bottom + 92 }]}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.postingText}>Posting…</Text>
                  </View>
                ) : null}

                {/* Until the first Story arrives, its owner's photo fills the screen, softened, as a lightbox shows the thumbnail. */}
                {!everReady && !ready && !failed && group.owner.avatarUrl ? (
                  <Image source={{ uri: group.owner.avatarUrl }} blurRadius={10}
                    style={[StyleSheet.absoluteFill, styles.openingStill]} resizeMode="cover" />
                ) : null}
                {showSpinner && !ready && !failed ? (
                  <View pointerEvents="none" style={styles.centerState}><ActivityIndicator color="#fff" size="large" /></View>
                ) : null}
                {failed ? (
                  <View pointerEvents="box-none" style={styles.centerState}>
                    <Text style={styles.stateText}>This Story is no longer available.</Text>
                    <Pressable accessibilityRole="button" onPress={goNext}><Text style={styles.stateAction}>Next</Text></Pressable>
                  </View>
                ) : null}

                <Animated.View pointerEvents="box-none" style={[styles.chrome, { paddingTop: insets.top + 8 }, chromeStyle]}>
                  <StoryProgressBar key={`${story.id}:${restartKey}`} count={group.stories.length} index={position.story} progress={progress} />
                  <View onLayout={({ nativeEvent: { layout } }) => {
                    headerBottom.value = layout.y + layout.height + 10;
                  }}>
                    <Header
                      group={group}
                      publishedAt={story.publishedAt}
                      ended={new Date(story.expiresAt) <= new Date()}
                      closeFriends={story.audience === 'close_friends'}
                      showMute={isVideo}
                      muted={muted}
                      onToggleMute={() => setMuted((value) => !value)}
                      onMenu={openMenu}
                      onClose={() => close(true)}
                      onOpenProfile={!demo && group.matchId ? () => void openMatchProfile(group) : undefined}
                    />
                  </View>
                </Animated.View>

                {typing ? (
                  <Pressable accessibilityLabel="Close keyboard" onPress={() => Keyboard.dismiss()} style={[StyleSheet.absoluteFill, styles.typingDim]} />
                ) : null}

                <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chromeStyle]}>
                  {/* The caption sits just above the footer, as a quiet card over the Story. */}
                  {!!story.caption && !typing ? (
                    <View pointerEvents="none" style={[styles.captionWrap, { bottom: insets.bottom + (group.isOwn ? 72 : 84) }]}>
                      <Text style={styles.caption} numberOfLines={4}>{story.caption}</Text>
                    </View>
                  ) : null}
                  {group.isOwn ? (
                    <OwnStoryFooter
                      avatars={viewers.slice(0, 3).map((item) => item.viewer?.avatarUrl).filter(Boolean)}
                      viewCount={story.viewCount ?? 0}
                      likeCount={story.likeCount ?? 0}
                      bottomInset={insets.bottom}
                      onOpenActivity={openActivity}
                    />
                  ) : (
                    <StoryFooter
                      liked={story.liked}
                      bottomInset={insets.bottom}
                      canReply={group.canReply !== false}
                      replyHint={replyHintFor(group)}
                      inputRef={inputRef}
                      onToggleLike={toggleLike}
                      onSend={sendReply}
                      onReact={(emoji) => {
                        setBurst({ emoji, key: Date.now() });
                        void sendReply(emoji, 'reaction');
                      }}
                      onFocusChange={setTyping}
                    />
                  )}
                </Animated.View>
              </View>
            ) : null}
          </CubePage>
        ))}
      </Animated.View>
        </Animated.View>
      </GestureDetector>

      {burst ? <EmojiBurst key={burst.key} emoji={burst.emoji} onDone={() => setBurst(null)} /> : null}
      {toast ? (
        <View pointerEvents="none" style={[styles.toast, { top: insets.top + 64 }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {activityOpen ? (
        <>
          {/* No scrim, as a standard sheet has none. A tap anywhere above the
              sheet closes it, like tapping the Story in Instagram's list. */}
          <Pressable accessibilityLabel="Close activity" onPress={closeActivity} style={StyleSheet.absoluteFill} />
          <StoryActivitySheet
            storyId={demo ? undefined : story.id}
            hasResponses={(story.composition?.interactive ?? []).some((sticker) => STICKERS_WITH_RESULTS.includes(sticker.type))}
            onShareReply={(prompt, text) => {
              closeActivity();
              close();
              // After the viewer has closed, open the creator with the reply as a card.
              setTimeout(() => navigation.navigate('CreateStory', { replyCard: { prompt, text } }), 250);
            }}
            offset={sheetOffset}
            topInset={insets.top}
            bottomInset={insets.bottom}
            viewCount={story.viewCount ?? viewers.length}
            likeCount={story.likeCount ?? viewers.filter((item) => item.liked).length}
            viewers={viewers}
            viewersClosed={viewersClosed}
            onViewerMenu={demo ? undefined : openViewerMenu}
            onEndReached={() => { if (viewerCursor) loadViewers(false).catch(() => undefined); }}
            onSearch={searchViewers}
            onDismissed={() => setActivityOpen(false)}
          />
        </>
      ) : null}

      {guideOpen && !closing.current ? <StoryGestureGuide onDone={closeGuide} topInset={insets.top} bottomInset={insets.bottom} /> : null}

      {actionSheet ? (
        <StoryActionSheet
          title={actionSheet.title}
          actions={actionSheet.actions}
          onClose={() => {
            setActionSheet(null);
            setSheetOpen(false);
          }}
        />
      ) : null}

      {matchProfile ? (
        <ProfileDetailModal
          isVisible
          readOnly
          user={matchProfile.user}
          loading={matchProfile.loading}
          transition="avatar"
          origin={matchProfile.origin}
          onClose={() => setMatchProfile(null)}
        />
      ) : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  closeFriendsPill: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 18, paddingHorizontal: 6, borderRadius: 9, backgroundColor: CLOSE_FRIENDS_GREEN, marginLeft: 8 },
  closeFriendsText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  pendingLayer: { opacity: 0 },
  openingStill: { opacity: 0.55 },
  backdrop: { backgroundColor: '#000' },
  dismiss: { overflow: 'hidden' },
  exitContent: { position: 'absolute', top: 0, left: 0, right: 0 },
  page: { backgroundColor: '#000', backfaceVisibility: 'hidden', overflow: 'hidden' },
  shade: { backgroundColor: '#000' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  chrome: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 8, gap: 10 },
  previewBars: { flexDirection: 'row', gap: 4, height: 2 },
  previewTrack: { flex: 1, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  headerIdentity: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Close to the name it belongs to, not the header's usual 8 px gap.
  badge: { marginLeft: -4 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#333' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A2A2D' },
  name: { color: '#fff', fontSize: 14, fontWeight: '700', maxWidth: '45%' },
  time: { color: 'rgba(255,255,255,0.75)', fontSize: 13 },
  headerButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  captionWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 24 },
  caption: { maxWidth: 520, color: '#fff', fontSize: 15, lineHeight: 21, fontWeight: '500', textAlign: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.42)', overflow: 'hidden' },
  centerState: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 14 },
  stateText: { color: '#fff', fontSize: 16, textAlign: 'center', paddingHorizontal: 28 },
  stateAction: { color: colors.primary, fontWeight: '700', fontSize: 16, marginTop: 8 },
  emptyScreen: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 16 },
  typingDim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  toast: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18, backgroundColor: 'rgba(38,38,38,0.95)' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  postingPill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)' },
  postingText: { color: '#fff', fontWeight: '600' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '60%', backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8 },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.5)', marginBottom: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sheetTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700' },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  viewerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface },
  viewerName: { flex: 1, color: colors.text.primary, fontWeight: '600' },
  viewerEmpty: { color: colors.text.tertiary, textAlign: 'center', marginTop: 40 },
});
