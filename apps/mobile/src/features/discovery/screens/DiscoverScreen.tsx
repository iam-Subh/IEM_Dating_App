import { initialWindowMetrics, SafeAreaInsetsContext } from "react-native-safe-area-context";
import { AccountGoodbyeScreen } from "../../auth/screens/AccountGoodbyeScreen";
import { HowItWorksContent } from "../../teaching/HowItWorks";
import { WelcomeTour } from "../../teaching/WelcomeTour";
import { GestureTip, type GestureTipSpec } from "../../teaching/GestureTip";
import { markTipSeen, resetDemoTips, tipUnseen } from "../../teaching/tipsSeen";
import { SwipeLesson } from "../../teaching/SwipeLesson";
import { ExploreLoadingDemo } from "../../../development/ExploreLoadingPreview";
import {StandoutsScreen} from '../../../screens/main/StandoutsScreen';
import { StandoutsInfoContent } from "../../../screens/main/StandoutsInfoScreen";
import { hasNewStandouts, introReady, markPointerShown, useStandoutsIntro } from "../standoutsIntro";

import { DeckPromptCard, DeckReminderCard, useDeckPrompt, useDeckReminderCard } from "../../verification/DeckVerifyBanner";
import { refreshVerificationStatus } from "../../verification/useVerificationStatus";
import { verifyReasonOf } from "../../verification/verifyGate";
import { useFocusEffect, useIsFocused, useNavigation } from "@react-navigation/native";
import { useUnreadNotifications } from "../../notifications/useUnreadNotifications";
import { ExploreActivityButton } from "../../notifications/ExploreActivityButton";
import { onPreferencesChanged } from "../preferencesEvents";
import type { DiscoveryPage, DiscoveryCard } from "@iem-dating/shared";
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useContext, useSyncExternalStore } from "react";
import {getDiscoveryArrival, setDiscoveryArrivalFrame, subscribeDiscoveryArrival, updateDiscoveryArrival} from '../discoveryArrival';
import {
  View,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Text,
  Alert,
  Dimensions,
  TouchableOpacity,
  Pressable,
  Image,
  AppState,
  Modal,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withSpring,
  withTiming,
  Easing,
  cancelAnimation,
  runOnJS,
  runOnUI,
  useReducedMotion,
} from "react-native-reanimated";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { SwipeDecisionFeedback } from "../components/SwipeDecisionFeedback";
import { UndoSwipeButton } from "../components/UndoSwipeButton";
import { StandoutsIcon } from '../components/StandoutsIcon';
import { LearningPill, LearningRing } from '../components/StandoutsLearning';
import { countSwipe, markLearnedShown, refreshLearning, uncountSwipe, useStandoutsLearning, type Learning } from '../standoutsLearning';
import {ProfileSearchLoading, ProfileSearchError} from '../components/ProfileSearchLoading';
import {createDiscoveryRequests} from '../discoveryRequests';
import {FIRST_MEDIA_WAIT_LIMIT, type ProfileSearchReason} from '../searchFeedback';
import { createSwipeUndo, undoSecondsRemaining, type SwipeUndo } from "../swipeUndo";
import { SwipeCard } from "../components/SwipeCard";
import { colors } from "../../../core/theme/colors";
import { api } from "../../../services/api";
import { demoProfiles } from "../demo/demoProfiles";
import { StoryTray } from "../../stories/components/StoryTray";
import { STORY_TRAY_QUERY_KEY, type StoryTray as StoryTrayData } from "../../stories/storyTypes";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";
import {
  createImagePreparation,
  photoPreparationWindow,
} from "../media/preparation";
import type { PlaybackState } from "../media/CardVideo";
import { RoseSheetHost, type RoseSheetHostHandle } from "../components/RoseSheet";
import { CommentSheetHost, type CommentSheetHostHandle } from "../comments/CommentSheet";
import type { CommentAbout } from "../comments/commentTypes";
import { LocationGate } from "../../location/LocationGate";
import { useLocationGate } from "../../location/useLocationGate";
import { placeLine } from "../../location/cardLabels";
import { useRoses } from "../useRoses";
import { considerRatingPrompts, showRatingDemo } from '../../feedback/RatingPrompt';

const SCREEN_WIDTH = Dimensions.get("window").width;
/**
 * The button hides this far before the server's deadline, so a tap in the last
 * moment still reaches the server inside its window. Without it the final
 * second of the countdown is a request that always fails.
 */
const REWIND_SAFETY_MS = 2_000;
/** Initial UI window; real swipes use the confirmed server deadline once saved. */
const REWIND_WINDOW_MS = 60_000;
const SWIPE_THRESHOLD = 0.2 * SCREEN_WIDTH;
const SWIPE_VELOCITY_THRESHOLD = 0.7;

export const DiscoverScreen = ({
  demo = false,
  onClose,
  teachingActive = false,
  demoWindowReady = false,
}: {
  demo?: boolean;
  onClose?: () => void;
  teachingActive?: boolean;
  demoWindowReady?: boolean;
}) => {
  const navigation = useNavigation<any>();
  const { unread: unreadNotifications } = useUnreadNotifications();
  const hasPreparedNotifications = useRef(false);
  // The same tray the Stories row reads (one request, shared): does anyone
  // besides you have a Story? Only then does the row take space above the deck.
  const { data: storyTray } = useQuery({
    queryKey: STORY_TRAY_QUERY_KEY,
    queryFn: async () => (await api.get("/stories/tray")).data.data as StoryTrayData,
    staleTime: 30_000,
    enabled: !demo,
  });
  const othersHaveStories = !!storyTray?.groups?.some((group) => !group.isOwn);
  // A calm moment for a rating ask, if one is due (features/feedback).
  useFocusEffect(useCallback(() => { if (!demo) void considerRatingPrompts('Dashboard'); }, [demo]));
  useFocusEffect(useCallback(() => {
    if (demo) return;
    const stack = navigation.getParent();
    let idle: ReturnType<typeof requestIdleCallback> | undefined;
    const prepare = () => {
      if (idle !== undefined) cancelIdleCallback(idle);
      idle = requestIdleCallback(() => {
        idle = undefined;
        if (!navigation.isFocused()) return;
        hasPreparedNotifications.current = true;
        stack?.preload('Notifications', { scope: 'all' });
      });
    };
    // Rebuild the preloaded screen after the native Back transition ends.
    const unsubscribe = stack?.addListener('transitionEnd', prepare);
    if (!hasPreparedNotifications.current) prepare();
    return () => {
      if (idle !== undefined) cancelIdleCallback(idle);
      unsubscribe?.();
    };
  }, [navigation, demo]));
  const [users, setUsers] = useState<DiscoveryCard[]>(() =>
    demo ? [...demoProfiles] : [],
  );
  const [loading, setLoading] = useState(!demo);
  const nextCursor = useRef<string | null>(null);
  const requests = useRef(createDiscoveryRequests()).current;
  useEffect(() => () => requests.cancel(), [requests]);
  const [searchReason, setSearchReason] = useState<ProfileSearchReason>('open');
  const [searchRequestId, setSearchRequestId] = useState(0);
  const [holdFirst, setHoldFirst] = useState(!demo);
  const [discoveryState, setDiscoveryState] = useState("loading");
  const [fetchError, setFetchError] = useState("");
  // Whenever the location changes underneath the deck, the deck is stale.
  const locationGate = useLocationGate(!demo, status =>
    void fetchRecommendations(true, status?.mode === 'college' ? 'preferences' : 'nearby'));
  const arrival = useSyncExternalStore(subscribeDiscoveryArrival, getDiscoveryArrival);
  const screenFocused = useIsFocused();
  const focused = screenFocused && !arrival.active;
  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );
  const [hasMore, setHasMore] = useState(!demo);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoWindowShown, setDemoWindowShown] = useState(false);
  useLayoutEffect(() => {if (!demoOpen) setDemoWindowShown(false);}, [demoOpen]);
  const [storyOpen, setStoryOpen] = useState(false);
  // Demo only: preview Explore with everyone's Stories, only yours, or none.
  const [demoStories, setDemoStories] = useState<"everyone" | "mine" | "none">("everyone");
  const actionsVisible = useSharedValue(1);
  const deckReveal = useSharedValue(demo ? 1 : 0);
  // Like and Pass hide while a profile is expanded. This is driven from the UI
  // thread with no state: the expanded profile's modal covers the buttons and
  // takes every touch, so the deck has no reason to re-render when a profile
  // opens or closes, and re-rendering it mid-animation is what stuttered.
  const setActionsForExpansion = (expanded: boolean) => {
    actionsVisible.value = withTiming(expanded ? 0 : 1, {
      duration: expanded ? 120 : 280,
      easing: Easing.out(Easing.cubic),
    });
  };
  const actionsRevealStyle = useAnimatedStyle(() => ({
    opacity: actionsVisible.value * deckReveal.value,
    transform: [{ translateY: 40 * (1 - actionsVisible.value) }],
  }));
  // Bring the buttons back as the profile starts folding into its card.
  const revealActions = () => setActionsForExpansion(false);

  const frontId = users[0]?.id;
  const dragX = useSharedValue(0);
  const buttonDragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  const releaseX = useSharedValue(0);
  const releaseY = useSharedValue(0);
  const swipeLocked = useSharedValue(false);
  const mediaPaused = useSharedValue(false);
  const swipeDispatched = useSharedValue(false);
  const stampOwner = useSharedValue("");
  const usersRef = useRef(users);
  const arrivalCardRef = useRef<View>(null);
  const dismissed = useRef(new Set<string>());
  // Roses on the deck, spent server-side inside the swipe transaction.
  const { balance: roseBalance, send: sendRose, refresh: refreshRoses } = useRoses();
  // The Rose opens from the expanded profile. The sheet is drawn inside that
  // profile's window and keeps who it is for itself, so opening it does not
  // re-render the deck (RoseSheetHost).
  const roseHost = useRef<RoseSheetHostHandle<DiscoveryCard>>(null);
  // The comment sheet, the like it will fold the profile into, and the
  // comment that like carries to the server (handleSwipe).
  const commentHost = useRef<CommentSheetHostHandle<DiscoveryCard>>(null);
  const commentLike = useRef<(() => void) | null>(null);
  const pendingComment = useRef<{ targetId: string; comment: string; about: CommentAbout } | null>(null);
  // Rewind (EXPLORE_SPEC.md, section 12): the last swipe, for 60 seconds, once
  // per person. Free here, and narrow on purpose - it fixes a misplaced thumb,
  // it is not a way to re-open profiles you already dismissed.
  const [undoable, setUndoable] = useState<SwipeUndo<DiscoveryCard> | null>(null);
  const visibleUndo = useRef<SwipeUndo<DiscoveryCard> | null>(null);
  const swipeUndo = useRef<SwipeUndo<DiscoveryCard> | null>(null);
  // Swipes this sitting: reminder 3 shows after about 20 (GOOGLE_SIGNUP_PLAN.md 4).
  const [swipeCount, setSwipeCount] = useState(0);

  // Out of likes, or paused: the deck shows its own card in the cards' place.
  const deckCard = useDeckReminderCard(demo);
  // The verify reminders, as a card in the deck (not over it). None in the
  // demo, during the first arrival, or while the deck's own card is up.
  // ── Teaching Standouts (standoutsIntro.ts) ──
  // A gold dot until today's set is opened; once ever, after a few swipes, a
  // pointer under the icon saying what it is; a long press names any icon.
  const standoutsIntro = useStandoutsIntro();
  // Demo only: see the gold dot and the welcome without waiting for a new day.
  const [demoNewStandouts, setDemoNewStandouts] = useState(true);
  const [demoWelcome, setDemoWelcome] = useState(false);
  const [demoGoodbye, setDemoGoodbye] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoTeach, setDemoTeach] = useState<"tour" | "guide" | null>(null);
  // Wait for the native window's onShow event, not a fixed timer.
  const [demoSwipeLesson, setDemoSwipeLesson] = useState(false);
  useEffect(() => {
    if (demo && demoWindowReady) setDemoSwipeLesson(true);
  }, [demo, demoWindowReady]);
  // Main owns the first-visit overlay above both the deck and the tab bar.
  const welcome = !demo && teachingActive;
  const [demoHand, setDemoHand] = useState<GestureTipSpec | null>(null);
  // Once ever (teaching/tipsSeen): the hand taps the first card's arrow, "to see their whole profile".
  const [cardTip, setCardTip] = useState<GestureTipSpec | null>(null);
  const expandArrowRef = useRef<View>(null);
  const standoutsRef = useRef<View>(null);
  // The demo's Hand chips aim at the real thing on screen, measured when tapped.
  const showDemoHand = (target: React.RefObject<View | null>, aim: (x: number, y: number, width: number, height: number) => GestureTipSpec) => {
    setCardTip(null);
    setPointerVisible(false);
    target.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      const spec = aim(x, y, width, height);
      setDemoHand({...spec, anchor: target, anchorPoint: {x: (spec.x - x) / width, y: (spec.y - y) / height}});
    });
  };
  // A new person's Standouts wait until their type is learned (standoutsLearning): no gold dot till then.
  const standoutsLearning = useStandoutsLearning();
  // Demo: the chip starts a count of its own, fed by the demo's swipes; nothing is saved.
  const [demoLearning, setDemoLearning] = useState<Learning | null>(null);
  const [demoLearningPage, setDemoLearningPage] = useState(false);
  const [demoStandoutsIntroSeen, setDemoStandoutsIntroSeen] = useState(false);
  const [demoMenu, setDemoMenu] = useState(false);
  const learningProgress = demo ? demoLearning : standoutsLearning.progress;
  const learningType = demo ? !!demoLearning && demoLearning.done < demoLearning.needed : standoutsLearning.learning && !!standoutsLearning.progress;
  useEffect(() => { if (!demo && focused) void refreshLearning(); }, [demo, focused]);
  const newStandouts = demo ? demoNewStandouts : hasNewStandouts(standoutsIntro) && !standoutsLearning.learning;
  const [pointerVisible, setPointerVisible] = useState(false);
  // The pointer's other job: "Your Standouts are here", once, when learning finishes.
  const [pointerLearned, setPointerLearned] = useState(false);
  const [tipsReset, setTipsReset] = useState(0);
  const topCardId = users[0]?.id;
  const cardTipFree = !demoLearningPage && !demoMenu && focused && !holdFirst && !locationGate.locating && !!topCardId && !storyOpen && !pointerVisible && !welcome && !demoHand && !demoTeach && !demoWelcome && !demoGoodbye && !demoLoading && (demo ? !demoSwipeLesson : !demoOpen);
  useEffect(() => {
    if (!cardTipFree) { setCardTip(null); return; }
    let live = true;
    // After the card has settled in, and only if nothing else is showing.
    const timer = setTimeout(() => {
      void tipUnseen("cardTap", demo).then((unseen) => {
        if (!live || !unseen) return;
        // The arrow itself, measured: where it sits depends on the card's name and tags.
        expandArrowRef.current?.measureInWindow((x, y, width, height) => {
          if (!live || width <= 0) return;
          markTipSeen("cardTap", demo);
          setCardTip({ pose: "point", text: "Tap the arrow to see their profile.", x: x + width / 2, y: y + height / 2, anchor: expandArrowRef });
        });
      });
    }, 900);
    return () => { live = false; clearTimeout(timer); };
  }, [cardTipFree, demo, topCardId, tipsReset]);
  const [headerBox, setHeaderBox] = useState({ y: 0, standoutsX: 0 });
  const [iconTip, setIconTip] = useState<{ label: string; x: number } | null>(null);
  const { width: screenWidth } = useWindowDimensions();
  const safeInsets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const iconTipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showIconTip = (label: string, x: number) => {
    if (iconTipTimer.current) clearTimeout(iconTipTimer.current);
    setIconTip({ label, x });
    iconTipTimer.current = setTimeout(() => setIconTip(null), 1600);
  };
  useEffect(() => () => { if (iconTipTimer.current) clearTimeout(iconTipTimer.current); }, []);
  const deckPrompt = useDeckPrompt({
    swipes: swipeCount,
    cardShown: demo || arrival.active || holdFirst || locationGate.locating || !!deckCard.kind,
    topCardUnverified: !!users[0] && !(users[0] as { isVerified?: boolean }).isVerified,
  });
  const [undoSeconds, setUndoSeconds] = useState(0);
  const rewinding = useRef(false);
  const rewindingUI = useSharedValue(false);
  const showUndo = (pending: SwipeUndo<DiscoveryCard> | null) => {
    visibleUndo.current = pending;
    // Publish availability and the first countdown value in the same render.
    setUndoable(pending);
    setUndoSeconds(pending ? undoSecondsRemaining(pending.until) : 0);
  };
  const offerUndo = (cardId: string | undefined) => {
    const card = usersRef.current[0];
    if (!card || card.id !== cardId) return null;
    const pending = createSwipeUndo(card, Date.now() + REWIND_WINDOW_MS - REWIND_SAFETY_MS);
    swipeUndo.current = pending;
    showUndo(pending);
    return pending;
  };
  const confirmUndo = (pending: SwipeUndo<DiscoveryCard>, until: number | null) => {
    pending.complete(until);
    // A late response for an older swipe must not replace the newest Undo.
    if (visibleUndo.current !== pending || pending.requested) return;
    showUndo(until !== null && until > Date.now() ? pending : null);
  };
  const cancelUndo = (cardId: string | undefined) => {
    const pending = swipeUndo.current;
    if (!pending || pending.card.id !== cardId) return;
    confirmUndo(pending, null);
  };
  useEffect(() => () => { swipeUndo.current?.complete(null); }, []);
  const [, refreshPreparation] = useState(0);
  const [selectedPhoto, setSelectedPhoto] = useState<{
    id: string;
    uri?: string;
  } | null>(null);
  const imagePreparation = useRef(
    createImagePreparation(
      async (uri) => {
        if (!(await Image.prefetch(uri)))
          throw new Error("Image prefetch failed");
      },
      () => refreshPreparation((value) => value + 1),
    ),
  ).current;
  const photoWindow = photoPreparationWindow(
    users,
    selectedPhoto !== null && selectedPhoto.id === frontId
      ? selectedPhoto.uri
      : undefined,
  );
  const photoWindowKey = JSON.stringify(photoWindow);
  const photosPrepared = imagePreparation.isPrepared(photoWindow);
  const [frontHealth, setFrontHealth] = useState<{
    id: string;
    state: PlaybackState;
  } | null>(null);
  // Mount the first real card under the loader so its media can prepare.
  // A failed or slow image returns control to the card's own media fallback.
  useEffect(() => {
    if (demo || !holdFirst || loading || !frontId) return;
    const timer = setTimeout(() => setHoldFirst(false), FIRST_MEDIA_WAIT_LIMIT);
    return () => clearTimeout(timer);
  }, [demo, holdFirst, loading, frontId, searchRequestId]);
  useEffect(() => {
    if (demo || !holdFirst || loading || !frontId) return;
    if (frontHealth?.id === frontId && (frontHealth.state === 'ready' || frontHealth.state === 'error')) {
      setHoldFirst(false);
    }
  }, [demo, holdFirst, loading, frontId, frontHealth]);
  const [warmVideoAllowed, setWarmVideoAllowed] = useState(false);
  const mediaHealthy =
    frontHealth !== null &&
    frontHealth.id === frontId &&
    frontHealth.state === "ready";
  useEffect(() => {
    setWarmVideoAllowed(false);
    if (
      !photosPrepared ||
      !mediaHealthy ||
      !focused ||
      !appActive ||
      demoOpen
    )
      return;
    const timer = setTimeout(() => setWarmVideoAllowed(true), 1000);
    return () => clearTimeout(timer);
  }, [
    frontId,
    photosPrepared,
    mediaHealthy,
    focused,
    appActive,
    demoOpen,
  ]);

  useLayoutEffect(() => {
    usersRef.current = users;
    runOnUI(() => {
      cancelAnimation(dragX);
      cancelAnimation(dragY);
      dragX.value = 0;
      dragY.value = 0;
      cancelAnimation(buttonDragX);
      buttonDragX.value = 0;
      swipeLocked.value = false;
      mediaPaused.value = false;
      swipeDispatched.value = false;
      stampOwner.value = "";
    })();
  }, [frontId, dragX, dragY, swipeLocked, buttonDragX]);

  useEffect(() => {
    usersRef.current = users;

    if ((!focused && !arrival.active) || !appActive || demoOpen) {
      imagePreparation.stop();
      return;
    }
    imagePreparation.update(photoWindow);
    return () => imagePreparation.stop();
  }, [
    users,
    photoWindowKey,
    focused,
    arrival.active,
    appActive,
    demoOpen,
    imagePreparation,
  ]);

  // Fetch before the visible stack runs out, independently of swipe receipts.
  useEffect(() => {
    if (!demo && !loading && users.length <= 6 && nextCursor.current)
      void fetchRecommendations();
  }, [users, demo]);

  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) =>
      setAppActive(state === "active"),
    );
    return () => listener.remove();
  }, []);

  // A fresh deck on the first visit, and after a long time away (the phone
  // asleep, the app left). Not on every return to Explore: back from
  // Notifications, Standouts or a chat is the same deck you left. Saved
  // preferences reload it themselves (onPreferencesChanged, below).
  const deckLoadedAt = useRef(0);
  useEffect(() => {
    if (demo || !screenFocused || !appActive) return;
    if (deckLoadedAt.current && Date.now() - deckLoadedAt.current < DECK_STALE_MS) return;
    void fetchRecommendations(true);
  }, [screenFocused, appActive]);

  useEffect(() => {
    const receipt = users[0]?.impressionId;
    if (demo || demoOpen || holdFirst || locationGate.locating || !receipt || !focused || !appActive)
      return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const acknowledge = async (attempt = 0) => {
      try {
        await api.post("/discover/visible", { impressionId: receipt });
      } catch {
        if (!cancelled && attempt < 2)
          retry = setTimeout(
            () => void acknowledge(attempt + 1),
            2000 * (attempt + 1),
          );
      }
    };
    const timer = setTimeout(() => void acknowledge(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retry) clearTimeout(retry);
    };
  }, [
    users[0]?.impressionId,
    holdFirst,
    locationGate.locating,
    focused,
    appActive,
    demo,
    demoOpen,
  ]);

  // My preferences saved: a fresh deck under the new filters, now.
  const reloadDeck = useRef<(reason?: ProfileSearchReason) => void>(() => undefined);
  useEffect(() => onPreferencesChanged(() => reloadDeck.current('preferences')), []);

  const fetchRecommendations = async (restart = false, reason: ProfileSearchReason = 'open') => {
    if (demo) {
      dismissed.current.clear();
      setUsers([...demoProfiles]);
      usersRef.current = [...demoProfiles];
      setHasMore(false);
      return;
    }
    if (!restart && !nextCursor.current) return;
    const request = requests.begin(restart);
    if (!request) return;
    const replacing = restart || usersRef.current.length === 0;
    if (replacing) {
      setLoading(true);
      setSearchReason(reason);
      setSearchRequestId(request.id);
      setHoldFirst(true);
      setFrontHealth(null);
      deckReveal.value = 0;
    }
    if (restart) {
      nextCursor.current = null;
      setUsers([]);
      setDiscoveryState('loading');
    }
    setFetchError('');
    try {
      const query = nextCursor.current ? '&cursor=' + encodeURIComponent(nextCursor.current) : '';
      const res = await api.get<{success: boolean; data: DiscoveryPage}>(
        '/discover/recommendations?limit=20' + query, {signal: request.signal},
      );
      if (!request.isLatest()) return;
      const data = res.data.data;
      deckLoadedAt.current = Date.now();
      nextCursor.current = data.nextCursor;
      setHasMore(!!data.nextCursor);
      setDiscoveryState(data.state);
      const cards = data.cards.filter(card => !dismissed.current.has(card.id));
      if (replacing && cards.length === 0) setHoldFirst(false);
      setUsers(prev => {
        if (!request.isLatest()) return prev;
        const existing = restart ? [] : prev;
        const known = new Set(existing.map(u => u.id));
        return [...existing, ...cards.filter(card => !known.has(card.id) && !dismissed.current.has(card.id))];
      });
    } catch (error: any) {
      if (!request.isLatest()) return;
      setHoldFirst(false);
      if (error.response?.data?.code === 'DECK_EXPIRED') {
        nextCursor.current = null;
        setFetchError('Your discovery list changed. Try loading it again.');
      } else setFetchError('Check your connection and try again.');
    } finally {
      if (request.isLatest()) setLoading(false);
      request.finish();
    }
  };
  reloadDeck.current = (reason = 'open') => {
    if (!demo) void fetchRecommendations(true, reason);
  };
  useEffect(() => {
    if (demo || !arrival.active) return;
    const status = locationGate.locating ? 'loading' : locationGate.kind !== 'none' ? 'ready' : loading ? 'loading' : fetchError ? 'error' : 'ready';
    updateDiscoveryArrival(status, () => reloadDeck.current(), locationGate.kind === 'none' ? users : []);
  }, [demo, arrival.active, loading, fetchError, locationGate.kind, locationGate.locating, users]);
  useEffect(() => {
    if (!arrival.active || arrival.replay || !users.length) return;
    const frame = requestAnimationFrame(() => arrivalCardRef.current?.measureInWindow((x, y, width, height) => {
      setDiscoveryArrivalFrame({x, y, width, height});
    }));
    return () => cancelAnimationFrame(frame);
  }, [arrival.active, arrival.replay, users]);

  /**
   * A Rose counts as this card's Like, so the card leaves the deck the same
   * way - but only after the server confirms, because a refused Rose must not
   * silently consume the card.
   */
  const handleRose = async (target: DiscoveryCard, comment: string | null, about?: CommentAbout) => {
    let trial = false;
    const result = await sendRose(target.id, comment, {onTrialRoseSpent: () => {trial = true;}, about: about ? aboutForServer(about) : undefined});
    if (!result) return;
    roseHost.current?.close();
    commentHost.current?.close();
    dismissed.current.add(target.id);
    usersRef.current = usersRef.current.filter((u) => u.id !== target.id);
    setUsers(usersRef.current);
    if (result.matchCreated) {
      navigation.navigate('MatchCelebration', {name: target.name, userId: target.id, photo: target.primaryPhoto ?? target.photos[0], matchId: result.matchId, roseTrial: trial});
    } else if (trial) navigation.navigate('VerifyRules', {reason: 'roseSent'});
  };

  /**
   * Sending from the comment sheet. The words are checked first, so a refusal
   * shows in the sheet and the card stays; then a Like folds the profile back
   * and leaves with the comment (handleSwipe), and a Rose goes as handleRose.
   */
  const handleComment = async (target: DiscoveryCard, kind: "like" | "rose", comment: string | null, about: CommentAbout) => {
    if (comment) {
      const problem = demo ? demoCommentProblem(comment) : await api.post("/discover/comment-check", { comment })
        .then(() => null)
        .catch((error: any) => (error?.response?.data?.message as string | undefined)
          ?? "That comment couldn't be checked. Check your connection and try again.");
      if (problem) return problem;
    }
    if (kind === "rose") {
      await handleRose(target, comment, about);
      return null;
    }
    pendingComment.current = comment ? { targetId: target.id, comment, about } : null;
    commentHost.current?.close();
    commentLike.current?.();
    return null;
  };

  const handleSwipe = async (action: "like" | "pass") => {
    setSwipeCount((count) => count + 1);
    if (!demo) countSwipe();
    else setDemoLearning((progress) => (progress && progress.done < progress.needed ? { ...progress, done: progress.done + 1 } : progress));
    const targetUser = usersRef.current[0];
    if (!targetUser) {
      swipeUndo.current?.complete(null);
      swipeLocked.value = false;
      return;
    }
    const pending = swipeUndo.current?.card.id === targetUser.id
      ? swipeUndo.current
      : offerUndo(targetUser.id);
    dismissed.current.add(targetUser.id);
    usersRef.current = usersRef.current.filter((u) => u.id !== targetUser.id);
    setUsers(usersRef.current);
    // Demo cards: nothing is saved, but Rewind works the same, for testing.
    if (demo) {
      if (pending) confirmUndo(pending, pending.until);
      return;
    }
    // A comment from the sheet rides on this Like, and on nothing else.
    const note = pendingComment.current?.targetId === targetUser.id && action === "like" ? pendingComment.current : null;
    pendingComment.current = null;
    try {
      const res = await api.post("/discover/swipe", {
        targetId: targetUser.id,
        action,
        ...(note ? { comment: note.comment, about: aboutForServer(note.about) } : {}),
      });
      // The likes counter and grace reminders follow each Like (GOOGLE_SIGNUP_PLAN.md 2.2).
      if (action === "like") void refreshVerificationStatus();
      if (res.data.data?.matchCreated) {
        // A match cannot be rewound: the other person can already see it.
        if (pending) confirmUndo(pending, null);
        // Open the match screen immediately; its conversation suggestion loads separately.
        navigation.navigate("MatchCelebration", {
          name: targetUser.name, userId: targetUser.id, matchId: res.data.data.matchId,
          photo: targetUser.primaryPhoto ?? targetUser.photos?.[0] ?? null,
        });
      } else {
        // The deadline comes from the server, which stamped the row. Counting
        // from here instead would start a round-trip late and make the last
        // seconds of the countdown a race the reader loses.
        const until = Date.parse(res.data.data?.rewindableUntil ?? "");
        if (pending) confirmUndo(pending, Number.isNaN(until) ? null : until - REWIND_SAFETY_MS);
      }
    } catch (error: any) {
      if (pending) confirmUndo(pending, null);
      if (error.response?.data?.code !== "PROFILE_UNAVAILABLE") {
        dismissed.current.delete(targetUser.id);
        if (!usersRef.current.some(u => u.id === targetUser.id)) {
          usersRef.current = [...usersRef.current, targetUser];
          setUsers(usersRef.current);
        }
        // A refusal that waits for verifying already opened the rules screen.
        const code = error.response?.data?.code;
        if (note && ["LIKE_COMMENT_REJECTED", "COMMENT_TARGET_GONE", "COMMENTS_UNAVAILABLE", "COMMENT_NOT_FIRST"].includes(code)) Alert.alert(
          "Comment not sent",
          `${error.response?.data?.message ?? "Your comment couldn't be sent."} ${targetUser.name} is back at the end of your list.`,
        );
        else if (!verifyReasonOf(error)) Alert.alert(
          "Swipe not saved",
          "The card was returned to the end of your list. Please retry when it appears.",
        );
      }
    }
  };

  // Counts the Rewind window down, and only while one is open.
  useEffect(() => {
    if (!undoable) {
      return;
    }
    const tick = () => {
      if (visibleUndo.current !== undoable) return;
      const left = undoSecondsRemaining(undoable.until);
      setUndoSeconds(left);
      if (left <= 0) showUndo(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [undoable]);

  const rewind = async () => {
    const pending = visibleUndo.current;
    // A ref, not the state: two taps in one frame both read the old state and
    // the second request would find the swipe already undone and 404.
    if (!pending || rewinding.current) return;
    rewinding.current = true;
    rewindingUI.value = true;
    pending.requested = true;
    showUndo(null);
    try {
      if (!await pending.saved) return;
      // Naming the target makes the server refuse rather than quietly undo
      // someone else if a swipe from another surface landed in between.
      // Demo swipes were never saved: the card simply comes back.
      if (!demo) {
        await api.post("/discover/rewind", { targetId: pending.card.id });
        // Rewinding a Rose gives it back: every screen's count goes up with it.
        void refreshRoses();
        uncountSwipe();
      } else {
        setDemoLearning((progress) => (progress && progress.done < progress.needed ? { ...progress, done: Math.max(0, progress.done - 1) } : progress));
      }
      dismissed.current.delete(pending.card.id);
      usersRef.current = [pending.card, ...usersRef.current.filter((u) => u.id !== pending.card.id)];
      setUsers(usersRef.current);
    } catch (error: any) {
      const code = error?.response?.data?.code;
      // Nothing left to undo, or the window closed: the button was offering
      // something that is no longer there. Dropping it is the whole fix - an
      // alert here would be telling the reader off for the app's timing.
      if (code !== "NOTHING_TO_REWIND" && code !== "REWIND_WINDOW_PASSED") {
        Alert.alert(
          "Couldn't undo that",
          error?.response?.data?.message ??
            "That swipe can no longer be taken back.",
        );
      }
    } finally {
      rewinding.current = false;
      rewindingUI.value = false;
    }
  };

  // Promote the next card once the outgoing card clears the screen.
  // Do not wait for the off-screen spring to finish settling.
  useAnimatedReaction(
    () =>
      swipeLocked.value &&
      !swipeDispatched.value &&
      Math.abs(dragX.value) >= SCREEN_WIDTH * 1.1,
    (ready) => {
      if (!ready) return;
      swipeDispatched.value = true;
      stampOwner.value = "";
      runOnJS(handleSwipe)(dragX.value > 0 ? "like" : "pass");
    },
  );

  // Follow the finger, but let button feedback settle while the card exits.
  useAnimatedReaction(
    () => ({ x: dragX.value, locked: swipeLocked.value }),
    (state) => {
      if (!state.locked) {
        cancelAnimation(buttonDragX);
        buttonDragX.value = state.x;
      }
    },
  );
  const animateSwipe = (
    direction: "left" | "right",
    velocityX = 0,
    velocityY = 0,
  ) => {
    "worklet";
    if (swipeLocked.value || rewindingUI.value) return;
    swipeLocked.value = true;
    runOnJS(offerUndo)(frontId);
    buttonDragX.value = withTiming(0, {
      duration: 140,
      easing: Easing.out(Easing.cubic),
    });
    mediaPaused.value = true;
    stampOwner.value = frontId ?? "";
    cancelAnimation(dragX);
    cancelAnimation(dragY);
    const target =
      direction === "right" ? SCREEN_WIDTH * 1.3 : -SCREEN_WIDTH * 1.3;
    const exitSpring = {
      damping: 30,
      stiffness: 240,
      mass: 0.8,
      overshootClamping: true,
    };
    // Continue the release trajectory instead of pulling the card upward to zero.
    const targetY =
      dragY.value +
      Math.max(
        -SCREEN_WIDTH * 0.4,
        Math.min(SCREEN_WIDTH * 0.4, velocityY * 0.16),
      );
    dragY.value = withSpring(targetY, { ...exitSpring, velocity: velocityY });
    dragX.value = withSpring(
      target,
      { ...exitSpring, velocity: velocityX },
      (finished) => {
        if (!finished && !swipeDispatched.value) {
          swipeLocked.value = false;
          runOnJS(cancelUndo)(frontId);
        }
      },
    );
  };
  // ── The Stories row arriving or leaving (someone posts; the last one expires) ──
  // It never jumps under a finger: the change waits until no card is being
  // dragged and 2 s have passed since the last touch, then one 350 ms motion
  // opens the row, eases the card shorter, flies your avatar from beside the
  // buttons into the row (and back), and fades the other faces in.
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (holdFirst || !users.length) return;
    deckReveal.value = withTiming(1, {duration: reduceMotion ? 0 : 180});
  }, [holdFirst, users.length, reduceMotion, deckReveal]);
  const wantTray = demo ? demoStories === "everyone" : othersHaveStories;
  const [trayOpen, setTrayOpen] = useState(wantTray);
  const [trayMoving, setTrayMoving] = useState(false);
  const trayProgress = useSharedValue(wantTray ? 1 : 0);
  const trayHeight = useSharedValue(0);
  const lastTouch = useRef(0);
  const markInteraction = useCallback(() => { lastTouch.current = Date.now(); }, []);
  const trayKnown = useRef(demo);
  const finishTray = useCallback((open: boolean) => { setTrayOpen(open); setTrayMoving(false); }, []);
  useEffect(() => {
    if (trayMoving || wantTray === trayOpen) return;
    // The first answer about Stories is no change at all: just take it.
    if (!trayKnown.current) {
      if (storyTray === undefined) return;
      trayKnown.current = true;
      trayProgress.value = wantTray ? 1 : 0;
      setTrayOpen(wantTray);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const busy = swipeLocked.value || Math.abs(dragX.value) > 0.5 || (!demo && Date.now() - lastTouch.current < 2000);
      if (busy) { timer = setTimeout(attempt, 400); return; }
      setTrayMoving(true);
      trayProgress.value = withTiming(wantTray ? 1 : 0, { duration: reduceMotion ? 0 : 350, easing: Easing.out(Easing.cubic) }, (done) => {
        if (done) runOnJS(finishTray)(wantTray);
      });
    };
    timer = setTimeout(attempt, demo ? 0 : 300);
    return () => clearTimeout(timer);
  }, [demo, dragX, finishTray, frontId, reduceMotion, storyTray, swipeLocked, trayMoving, trayOpen, trayProgress, wantTray]);
  const showHeaderRing = !trayOpen || trayMoving;
  const showTrayRow = trayOpen || trayMoving;
  // The row's height follows the motion, so the card shortens with it.
  const trayRowStyle = useAnimatedStyle(() => ({ height: trayHeight.value * trayProgress.value }));
  // The ring's slot opens and closes with the motion, so nothing beside it jumps.
  const headerRingStyle = useAnimatedStyle(() => ({
    opacity: trayProgress.value < 0.005 ? 1 : 0,
    width: HEADER_RING_SLOT * (1 - trayProgress.value),
    marginRight: -8 * trayProgress.value,
  }));
  // The demo's name in the header: in as your ring flies down, out as it returns.
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, (trayProgress.value - 0.4) / 0.6),
    transform: [{ translateX: -12 * (1 - trayProgress.value) }],
  }));
  // Where the header and the row really sit on screen (measured, since the
  // safe area and the demo's chips move them): the flight runs between them.
  const headerY = useSharedValue(0);
  const trayY = useSharedValue(0);
  // Your avatar in flight: from the 40 px face by the buttons to the 52 px face in the row.
  const ownAvatar = useSelector((state: RootState) => {
    const me: any = state.auth.user;
    return (me?.avatarUrl ?? me?.photos?.[0]?.photoUrl ?? me?.photos?.[0] ?? null) as string | null;
  });
  // The small ring keeps showing the last situation while the row takes over.
  const [headerScenario, setHeaderScenario] = useState<"mine" | "none">("none");
  useEffect(() => { if (demoStories !== "everyone") setHeaderScenario(demoStories); }, [demoStories]);
  // Your own Story's grey ring travels with the avatar, as it looks at both ends.
  const ownHasStory = demo ? headerScenario === "mine" || wantTray : !!storyTray?.groups?.some((group) => group.isOwn && group.stories.length > 0);
  const flyerStyle = useAnimatedStyle(() => {
    const p = trayProgress.value;
    const away = 1 - p;
    const toY = trayY.value + FLYER_TO.y;
    const fromY = headerY.value + FLYER_FROM.y;
    return {
      opacity: p > 0.005 && p < 0.995 ? 1 : 0,
      top: toY - FLYER_SIZE / 2,
      transform: [
        { translateX: (FLYER_FROM.x - FLYER_TO.x) * away },
        { translateY: (fromY - toY) * away },
        { scale: 1 - (1 - FLYER_FROM.scale) * away },
      ],
    };
  });
  const [demoPostPending, setDemoPostPending] = useState(false);
  const demoSomeonePosts = () => {
    setDemoPostPending(true);
    setTimeout(() => { setDemoPostPending(false); setDemoStories("everyone"); }, 1000);
  };
  // Demo tools (the info button in the demo's header). `on`: a switch, shown ticked.
  type DemoItem = { label: string; hint?: string; on?: boolean; run: () => void };
  const demoSections: { title: string; items: DemoItem[] }[] = !demo ? [] : [
    { title: "Stories", items: [
      ...([["everyone", "Everyone's", "The Story row above the cards"], ["mine", "Only mine", "Your ring by the title"], ["none", "None", "No Stories at all"]] as const)
        .map(([value, label, hint]): DemoItem => ({ label, hint, on: demoStories === value, run: () => setDemoStories(value) })),
      ...(demoStories !== "everyone" ? [{ label: demoPostPending ? "Posting…" : "Someone posts now", hint: "A new Story arrives in a second", run: demoSomeonePosts }] : []),
    ] },
    { title: "Standouts", items: [
      { label: "Learning your type", hint: "Count 15 demo swipes, then “Your Standouts are here”", on: !!demoLearning,
        run: () => setDemoLearning((value) => (value ? null : { needed: 15, done: 0 })) },
      { label: "On the way page", hint: "What Standouts shows while learning", run: () => {
        setDemoLearning(value => value ?? {needed: 15, done: 4}); setDemoStandoutsIntroSeen(true); setDemoLearningPage(true);
      } },
      { label: "Standouts animation", hint: "Animated cards, heart reveal, fade, then demo profiles", run: () => {
        setDemoLearning({needed: 15, done: 15}); setDemoStandoutsIntroSeen(true); setDemoLearningPage(true);
      } },
      { label: "New dot", hint: "The gold dot on the Standouts icon", on: demoNewStandouts, run: () => setDemoNewStandouts((value) => !value) },
      { label: "Pointer", hint: "The one-time bubble under the icon", run: () => { setPointerLearned(false); setPointerVisible(true); } },
      { label: "Welcome to Standouts", run: () => setDemoWelcome(true) },
    ] },
    { title: "Learn", items: [
      ...(__DEV__ ? [{ label: "Loading", hint: "The search screen while cards load", run: () => { setDemoHand(null); setCardTip(null); setDemoLoading(true); } }] : []),
      { label: "Welcome cards", hint: "After sign-up", run: () => setDemoTeach("tour") },
      { label: "How IEM Connect works", run: () => setDemoTeach("guide") },
      { label: "Swipe lesson", run: () => setDemoSwipeLesson(true) },
      { label: "Reset tips", hint: "Show the card tip and Story guide again", run: () => { void resetDemoTips().then(() => setTipsReset((value) => value + 1)); } },
    ] },
    { title: "Hand tips", items: [
      { label: "Tap", hint: "On the card's arrow", run: () => showDemoHand(expandArrowRef, (x, y, w, h) => ({ pose: "point", text: "Tap the arrow to see their profile.", x: x + w / 2, y: y + h / 2 })) },
      { label: "Swipe", hint: "Opens the swipe lesson", run: () => { setDemoHand(null); setCardTip(null); setDemoSwipeLesson(true); } },
      { label: "Long press", hint: "On the Standouts icon", run: () => showDemoHand(standoutsRef, (x, y, w, h) => ({ pose: "longPress", text: "Hold an icon to see its name.", x: x + w / 2, y: y + h / 2 })) },
    ] },
    { title: "Account", items: [
      { label: "Goodbye", hint: "After Delete my account", run: () => setDemoGoodbye(true) },
      // TEMPORARY: the real rating card, to check its layout (RatingPrompt showRatingDemo).
      { label: "Rating", run: showRatingDemo },
      { label: "Match", run: () => navigation.navigate("MatchCelebration", { name: "Aanya", photo: demoProfiles[0].primaryPhoto, demo: true }) },
    ] },
  ];

  useEffect(() => {
    if (!demo || !demoLearning || demoLearning.done < demoLearning.needed || pointerVisible) return;
    setDemoLearning(null);
    setPointerLearned(true);
    setPointerVisible(true);
  }, [demo, demoLearning, pointerVisible]);
  useEffect(() => {
    if (demo || pointerVisible || !introReady() || standoutsLearning.learning) return;
    // Learning just finished: "Your Standouts are here". Otherwise the usual
    // one-time pointer after a few swipes, for anyone who never had to wait.
    const learned = standoutsLearning.justLearned;
    if (!learned && (standoutsIntro.pointerShown || swipeCount < STANDOUTS_POINTER_AFTER)) return;
    if (!focused || demoOpen || welcome || deckCard.kind || deckPrompt.prompt) return;
    if (learned) markLearnedShown();
    markPointerShown();
    setPointerLearned(learned);
    setPointerVisible(true);
  }, [deckCard.kind, deckPrompt.prompt, demo, demoOpen, focused, pointerVisible, standoutsIntro.pointerShown, standoutsLearning.justLearned, standoutsLearning.learning, swipeCount, welcome]);
  useEffect(() => {
    if (!pointerVisible) return;
    const timer = setTimeout(() => setPointerVisible(false), 9000);
    return () => clearTimeout(timer);
  }, [pointerVisible]);

  const forceSwipe = (direction: "left" | "right") => {
    if (!usersRef.current.length || holdFirst || locationGate.locating || demoOpen || rewinding.current) return;
    runOnUI(animateSwipe)(direction);
  };
  const panGesture = Gesture.Pan()
    .enabled(users.length > 0 && !holdFirst && !locationGate.locating && !demoOpen && focused && !deckCard.kind && !deckPrompt.prompt)
    .activeOffsetX([-6, 6])
    .failOffsetY([-32, 32])
    .maxPointers(1)
    .onBegin(() => {
      runOnJS(markInteraction)();
    })
    .onStart(() => {
      if (swipeLocked.value || rewindingUI.value) return;
      mediaPaused.value = true;
      cancelAnimation(dragX);
      cancelAnimation(dragY);
      stampOwner.value = frontId ?? "";
      grabX.value = dragX.value;
      grabY.value = dragY.value;
      releaseX.value = 0;
      releaseY.value = 0;
    })
    .onUpdate((event) => {
      if (swipeLocked.value || rewindingUI.value) return;
      dragX.value = grabX.value + event.translationX;
      dragY.value = grabY.value + event.translationY;
    })
    .onEnd((event) => {
      if (swipeLocked.value || rewindingUI.value) return;
      releaseX.value = event.velocityX;
      releaseY.value = event.velocityY;
      const projectedX = dragX.value + event.velocityX * 0.12;
      if (
        (dragX.value > SWIPE_THRESHOLD && projectedX > SWIPE_THRESHOLD) ||
        (event.velocityX > SWIPE_VELOCITY_THRESHOLD * 1000 &&
          dragX.value > 32 &&
          projectedX > SWIPE_THRESHOLD)
      ) {
        animateSwipe("right", event.velocityX, event.velocityY);
      } else if (
        (dragX.value < -SWIPE_THRESHOLD && projectedX < -SWIPE_THRESHOLD) ||
        (event.velocityX < -SWIPE_VELOCITY_THRESHOLD * 1000 &&
          dragX.value < -32 &&
          projectedX < -SWIPE_THRESHOLD)
      ) {
        animateSwipe("left", event.velocityX, event.velocityY);
      }
    })
    .onFinalize(() => {
      if (swipeLocked.value || rewindingUI.value) return;
      dragX.value = withSpring(
        0,
        {
          damping: 24,
          stiffness: 280,
          mass: 0.8,
          velocity: releaseX.value,
        },
        (finished) => {
          if (finished && !swipeLocked.value) mediaPaused.value = false;
        },
      );
      dragY.value = withSpring(0, {
        damping: 24,
        stiffness: 280,
        mass: 0.8,
        velocity: releaseY.value,
      });
    });
  const topCardStyle = useAnimatedStyle(() => ({
    opacity: deckReveal.value,
    transform: [
      { translateX: dragX.value },
      { translateY: dragY.value },
      {
        rotate: `${Math.max(-12, Math.min(12, (dragX.value / SCREEN_WIDTH) * 12))}deg`,
      },
    ],
  }));
  const nextCardStyle = useAnimatedStyle(() => ({
    opacity: deckReveal.value,
    transform: [
      {
        scale:
          0.97 + Math.min(Math.abs(dragX.value) / (SCREEN_WIDTH / 2), 1) * 0.03,
      },
    ],
  }));
  const passButtonStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale:
          1 +
          Math.max(0, Math.min(-buttonDragX.value / (SCREEN_WIDTH / 2), 1)) * 0.15,
      },
    ],
  }));
  const likeButtonStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale:
          1 + Math.max(0, Math.min(buttonDragX.value / (SCREEN_WIDTH / 2), 1)) * 0.15,
      },
    ],
  }));

  const searchFeedback = (locating = false) => <ProfileSearchLoading
    avatarUri={typeof ownAvatar === 'string' ? ownAvatar : null}
    reason={locating ? 'location' : searchReason}
    active={focused && appActive && !demoOpen}
    requestId={searchRequestId}/>;
  const renderCards = () => {
    if (!demo && locationGate.locating) return null;
    // Distance mode without a usable location: ask, the way Bumble and
    // Tinder do on every open, instead of showing an empty deck (LOCATION_SPEC.md 6.1).
    if (!demo && locationGate.kind !== "none") {
      return (
        <LocationGate
          kind={locationGate.kind}
          status={locationGate.status}
          busy={locationGate.busy}
          error={locationGate.error}
          canDismiss={locationGate.canDismiss}
          onTurnOn={() => void locationGate.actions.turnOn()}
          onRetry={() => void locationGate.actions.retry()}
          onOpenSettings={() => void locationGate.actions.openSettings()}
          onUsePlace={(placeId) => void locationGate.actions.usePlace(placeId)}
          onSwitchToCollege={() => void locationGate.actions.switchToCollege()}
          onDismiss={locationGate.actions.dismiss}
        />
      );
    }
    if (loading && users.length === 0) return null;
    if (!demo && fetchError && users.length === 0) return <ProfileSearchError
      message={fetchError} onRetry={() => void fetchRecommendations(true, searchReason)}/>;

    if (users.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          {!fetchError && discoveryState !== "setup_required" && discoveryState !== "capacity_limited" ? (
            <Image source={require("../../../../assets/illustrations/discover-kitten.png")}
              style={styles.discoverKitten} resizeMode="contain" fadeDuration={0} accessible={false} />
          ) : <View style={styles.emptyIconCircle}>
            <Text style={styles.emptyEmoji}>✨</Text>
          </View>}
          <Text style={styles.emptyTitle}>
            {discoveryState === "setup_required"
              ? "Set discovery preferences"
              : discoveryState === "capacity_limited"
                ? "Discovery is busy"
                : fetchError ? "Couldn't load profiles" : "You've seen everyone"}
          </Text>
          <Text style={styles.emptySub}>
            {fetchError ||
              (discoveryState === "capacity_limited"
                ? "Some profiles are temporarily reserved. Select Load more to retry shortly."
                : discoveryState === "setup_required"
                  ? "Confirm whom you want to see before discovery starts."
                  : hasMore
                    ? "More profiles may be available. Select Load more."
                    : "New people join every day. Widen who you see, or look at today's Standouts.")}
          </Text>
          {/* The end of the deck leads somewhere: real buttons, not text links. */}
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.emptyPrimary}
            activeOpacity={0.85}
            onPress={() =>
              demo ? void fetchRecommendations(true) : navigation.navigate("Preferences")
            }
          >
            <Text style={styles.emptyPrimaryText}>
              {demo ? "Reset demo cards" : discoveryState === "setup_required" ? "Set my preferences" : "Widen my preferences"}
            </Text>
          </TouchableOpacity>
          {!demo && !fetchError && discoveryState !== "setup_required" ? (
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.emptySecondary}
              activeOpacity={0.85}
              onPress={() => navigation.navigate("Standouts")}
            >
              <StandoutsIcon size={24} color="#E8C698" heartColor="#F2BDC9" />
              <Text style={styles.emptySecondaryText}>See today's Standouts</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.emptyRetry}
            onPress={() => fetchRecommendations(!nextCursor.current)}
          >
            <Text style={styles.emptyRetryText}>
              {hasMore ? "Load more" : "Check again"}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    return users
      .slice(0, 2)
      .reverse()
      .map((user, index, array) => {
        const isTopCard = index === array.length - 1;

        return (
          <Animated.View
            key={`card-${user.id}`}
            ref={isTopCard ? arrivalCardRef : undefined}
            onLayout={isTopCard && arrival.active ? () => arrivalCardRef.current?.measureInWindow((x, y, width, height) => setDiscoveryArrivalFrame({x, y, width, height})) : undefined}
            style={[
              styles.cardStyle,
              { zIndex: isTopCard ? 99 : 1 },
              isTopCard ? topCardStyle : nextCardStyle,
            ]}
            pointerEvents={isTopCard ? "auto" : "none"}
          >
            <SwipeDecisionFeedback
              cardId={user.id}
              owner={stampOwner}
              dragX={dragX}
              width={SCREEN_WIDTH}
            />

            <SwipeCard
              expandRef={isTopCard ? expandArrowRef : undefined}
              onExpansionChange={isTopCard ? setActionsForExpansion : undefined}
              onCollapseStart={isTopCard ? revealActions : undefined}
              gesturePaused={mediaPaused}
              onPhotoSelected={(uri) => {
                if (!isTopCard) return;
                setSelectedPhoto((current) =>
                  current?.id === user.id && current.uri === uri
                    ? current
                    : { id: user.id, uri },
                );
              }}
              prepareVideo={
                isTopCard ||
                (warmVideoAllowed &&
                  mediaHealthy &&
                  photosPrepared &&
                  focused &&
                  appActive &&
                  !demoOpen)
              }
              onMediaState={(state) => {
                if (!isTopCard) return;
                setFrontHealth((current) =>
                  current?.id === user.id && current.state === state
                    ? current
                    : { id: user.id, state },
                );
              }}
              user={{
                ...user,
                imageUri: user.primaryPhoto ?? "",
                department: user.department ?? "",
                intent: user.seeking ?? "",
                // Campus, city, "visiting" and the distance band, as one line.
                distance: placeLine(user) ?? undefined,
                tags: typeof user.seeking === "string" ? [user.seeking] : [],
              }}
              onLike={() => isTopCard && forceSwipe("right")}
              onPass={() => isTopCard && forceSwipe("left")}
              onStar={() => isTopCard && forceSwipe("right")}
              onRose={demo ? undefined : () => roseHost.current?.open(user)}
              roseBalance={roseBalance?.roses ?? null}
              roseOverlay={isTopCard ? (
                <>
                  <RoseSheetHost<DiscoveryCard> ref={roseHost} inline balance={roseBalance?.roses ?? null}
                    onSend={(card, comment) => handleRose(card, comment)} />
                  <CommentSheetHost<DiscoveryCard> ref={commentHost}
                    onSend={handleComment} />
                </>
              ) : undefined}
              onRoseOverlayBack={() => commentHost.current?.back() || roseHost.current?.back() || false}
              onComment={isTopCard ? (about, sendLike) => { commentLike.current = sendLike; commentHost.current?.open(user, about); } : undefined}
              actionsInset={ACTIONS_INSET}
              isActiveCard={
                isTopCard &&
                !holdFirst &&
                !locationGate.locating &&
                !demoOpen &&
                !demoSwipeLesson &&
                !demoLoading &&
                !demoLearningPage &&
                !welcome &&
                !storyOpen &&
                focused &&
                appActive
              }
              onReport={
                demo
                  ? () => {
                      Alert.alert("Demo report saved", "No report was sent.");
                    }
                  : undefined
              }
              onBlock={
                demo
                  ? () => {
                      usersRef.current = usersRef.current.filter(
                        (u) => u.id !== user.id,
                      );
                      setUsers(usersRef.current);
                    }
                  : undefined
              }
            />
          </Animated.View>
        );
      });
  };

  const canUndo = Boolean(undoable && undoSeconds > 0);
  const passAction = (
    <Animated.View key="pass" style={[styles.actionBtnContainer, passButtonStyle]}>
      <TouchableOpacity
        style={[styles.actionBtn, styles.passBtn, users.length === 0 && styles.actionDisabled]}
        accessibilityLabel="Pass profile"
        disabled={users.length === 0}
        onPress={() => forceSwipe("left")}
        activeOpacity={0.8}
      >
        <Ionicons name="close" size={32} color="#FFF" />
      </TouchableOpacity>
    </Animated.View>
  );
  const likeAction = (
    <Animated.View key="like" style={[styles.mainActionContainer, likeButtonStyle]}>
      <TouchableOpacity
        style={[styles.mainActionBtn, users.length === 0 && styles.actionDisabled]}
        accessibilityLabel="Like profile"
        disabled={users.length === 0}
        onPress={() => forceSwipe("right")}
        activeOpacity={0.8}
      >
        <Ionicons name="heart" size={32} color="#FFF" />
      </TouchableOpacity>
    </Animated.View>
  );

  return (
    <GestureHandlerRootView
      style={[styles.container, { backgroundColor: "#100F0D" }]}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        {/* One header row: the title, then the three things used now and then.
            Every-card actions stay at the bottom, under the thumb. */}
        <View style={styles.header} onLayout={(event) => {
          headerY.value = event.nativeEvent.layout.y;
          const y = event.nativeEvent.layout.y;
          setHeaderBox((box) => (box.y === y ? box : { ...box, y }));
        }}>
          {showHeaderRing ? (
            <Animated.View style={headerRingStyle}>
              {demo ? <StoryTray key={headerScenario} demo variant="header" demoScenario={headerScenario} onOpenChange={setStoryOpen} />
                : <StoryTray variant="header" />}
            </Animated.View>
          ) : null}
          {/* No page title: the tab bar already says Explore, and the people are the page.
              Screen readers still hear its name from this empty, flexible space. */}
          {/* The demo looks exactly like Explore; its chips below say it is a demo. */}
          <View style={styles.titleSpace} accessible accessibilityRole="header" accessibilityLabel={demo ? "Explore demo" : "Explore"}>
            {/* Trying in the demo: with the Stories down in the row, the app's
                name takes the space your ring left, and gives it back. */}
            {demo ? <Animated.Text numberOfLines={1} style={[styles.wordmark, wordmarkStyle]}>IEM Connect</Animated.Text> : null}
          </View>
          {demo ? (
            <>
              <Pressable ref={standoutsRef} accessibilityRole="button" accessibilityLabel={newStandouts ? "Standouts demo, new" : "Standouts demo"}
                onPress={() => {setPointerVisible(false); setDemoLearning(value => value ?? {needed: 15, done: 0}); setDemoNewStandouts(false); setDemoLearningPage(true);}}
                onLongPress={() => showIconTip("Standouts", headerBox.standoutsX)}
                onLayout={(event) => {
                  const x = event.nativeEvent.layout.x + event.nativeEvent.layout.width / 2;
                  setHeaderBox((box) => (box.standoutsX === x ? box : { ...box, standoutsX: x }));
                }}
                style={({ pressed }) => [styles.exploreTool, styles.standoutsTool, pressed && styles.exploreToolPressed]}>
                <StandoutsIcon size={26} color="#E8C698" heartColor="#F2BDC9" />
                {learningType ? <View pointerEvents="none" style={styles.standoutsRing}><LearningRing progress={learningProgress!} size={40} /></View> : null}
                {newStandouts && !learningType ? <View style={styles.standoutsDot} /> : null}
              </Pressable>
              {/* Every demo switch and preview, in one list (demoSections). */}
              <Pressable accessibilityRole="button" accessibilityLabel="Demo tools" onPress={() => setDemoMenu(true)}
                style={({ pressed }) => [styles.exploreTool, pressed && styles.exploreToolPressed]}>
                <Ionicons name="information-circle-outline" size={22} color="#F5F5F5" />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Reset demo cards" onPress={() => void fetchRecommendations(true)}
                style={({ pressed }) => [styles.exploreTool, pressed && styles.exploreToolPressed]}>
                <Ionicons name="refresh" size={20} color="#F5F5F5" />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Close demo" onPress={onClose}
                style={({ pressed }) => [styles.exploreTool, pressed && styles.exploreToolPressed]}>
                <Ionicons name="close" size={22} color="#F5F5F5" />
              </Pressable>
            </>
          ) : (
            <>
              {__DEV__ && (
                <Pressable accessibilityRole="button" accessibilityLabel="Developer previews"
                  onPress={() => Alert.alert("Developer previews", undefined, [
                    { text: "Demo cards", onPress: () => setDemoOpen(true) },
                    { text: "Reminders", onPress: () => navigation.navigate("ReminderPreview") },
                    { text: "Artwork", onPress: () => navigation.navigate("TeachingArtworkPreview") },
                  ], {cancelable: true})}
                  style={({ pressed }) => [styles.exploreTool, styles.devTool, pressed && styles.exploreToolPressed]}>
                  <Ionicons name="flask-outline" size={19} color={colors.primary} />
                </Pressable>
              )}
              {/* Standouts lives by the deck: both are people picked for you. */}
              <Pressable ref={standoutsRef} accessibilityRole="button" accessibilityLabel={newStandouts ? "Today's Standouts, new" : "Today's Standouts"}
                onPress={() => { setPointerVisible(false); navigation.navigate("Standouts"); }}
                onLongPress={() => showIconTip("Standouts", headerBox.standoutsX)}
                onLayout={(event) => {
                  const x = event.nativeEvent.layout.x + event.nativeEvent.layout.width / 2;
                  setHeaderBox((box) => (box.standoutsX === x ? box : { ...box, standoutsX: x }));
                }}
                style={({ pressed }) => [styles.exploreTool, styles.standoutsTool, pressed && styles.exploreToolPressed]}>
                <StandoutsIcon size={26} color="#E8C698" heartColor="#F2BDC9" />
                {learningType ? <View pointerEvents="none" style={styles.standoutsRing}><LearningRing progress={learningProgress!} size={40} /></View> : null}
                {/* Today's set is waiting: cleared once Standouts is opened today. */}
                {newStandouts ? <View style={styles.standoutsDot} /> : null}
              </Pressable>
              <ExploreActivityButton unread={unreadNotifications}
                onPress={() => navigation.navigate("Notifications", { scope: "all" })} />
              <Pressable accessibilityRole="button" accessibilityLabel="Discovery preferences" onPress={() => navigation.navigate("Preferences")}
                onLongPress={(event) => showIconTip("Discovery preferences", event.nativeEvent.pageX)}
                style={({ pressed }) => [styles.exploreTool, pressed && styles.exploreToolPressed]}>
                <Ionicons name="options-outline" size={20} color="#F5F5F5" />
              </Pressable>
            </>
          )}
        </View>
        {/* Stories only take a row when someone has one; otherwise your ring sits by the title. */}
        {/* Height follows the motion; the row inside keeps its own size. */}
        <Animated.View style={[styles.trayRow, trayRowStyle]} onLayout={(event) => { trayY.value = event.nativeEvent.layout.y; }}>
          <View style={styles.trayRowInner} onLayout={(event) => { trayHeight.value = event.nativeEvent.layout.height; }}>
            {showTrayRow ? (demo ? <StoryTray key="everyone" demo onOpenChange={setStoryOpen} motion={trayProgress} />
              : <StoryTray motion={trayProgress} />) : <View style={styles.trayRowProbe} />}
          </View>
        </Animated.View>
        {!demo && locationGate.kind === "none" && locationGate.status?.hiddenHere ? (() => {
          // Hidden at a place: invisible, still browsing. Say so, and offer the way back.
          const place = locationGate.status.places.find((entry) => entry.isCurrent && entry.hideHere);
          return (
            <View style={styles.hiddenBanner}>
              <Ionicons name="eye-off-outline" size={18} color="#CDBBFF" />
              <Text style={styles.hiddenBannerText} numberOfLines={2}>
                {place ? `Hidden at "${place.label}"` : "Hidden here"} · you can browse, nobody sees you
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={locationGate.busy}
                onPress={() => void locationGate.actions.showHere(place?.id ?? null)}
                style={styles.hiddenBannerButton}
              >
                <Text style={styles.hiddenBannerButtonText}>{locationGate.busy ? "…" : "Show me"}</Text>
              </TouchableOpacity>
            </View>
          );
        })() : null}
        {learningType && !welcome ? <LearningPill progress={learningProgress!}
          onPress={() => (demo ? setDemoLearningPage(true) : navigation.navigate("Standouts"))} /> : null}
        <GestureDetector gesture={panGesture}>
          <Animated.View
            collapsable={false}
            style={[styles.cardsWrapper, { marginBottom: demo ? DECK_BOTTOM_DEMO : DECK_BOTTOM }]}
          >
            {deckCard.kind ? <DeckReminderCard kind={deckCard.kind} onKeepBrowsing={deckCard.keepBrowsing} />
              : deckPrompt.prompt ? <DeckPromptCard prompt={deckPrompt.prompt} onKeepBrowsing={deckPrompt.keepBrowsing} />
              : renderCards()}
            {!demo && !deckCard.kind && !deckPrompt.prompt && (locationGate.locating || (locationGate.kind === 'none' && ((loading && users.length === 0) || (holdFirst && users.length > 0)))) ? (
              <View style={[StyleSheet.absoluteFill, {backgroundColor: '#100F0D', zIndex: 5}]}>{searchFeedback(locationGate.locating)}</View>
            ) : null}
          </Animated.View>
        </GestureDetector>

        {!holdFirst && !locationGate.locating && locationGate.kind === "none" && !deckCard.kind && !deckPrompt.prompt && users.length > 0 ? (
          <Animated.View
            style={[
              styles.actionContainer,
              { bottom: (demo ? DECK_BOTTOM_DEMO : DECK_BOTTOM) + 16 },
              actionsRevealStyle,
            ]}
          >
            {passAction}

            {!demo && users.length > 0 ? (
              <TouchableOpacity
                key="rose"
                style={[styles.roseBtn, roseBalance?.roses === 0 && styles.roseEmpty]}
                accessibilityLabel={`Send ${users[0]?.name ?? "them"} a Rose${typeof roseBalance?.roses === "number" ? `, ${roseBalance.roses} left` : ""}`}
                onPress={() => users[0] && roseHost.current?.open(users[0])}
                activeOpacity={0.8}
              >
                <Ionicons name="rose" size={24} color="#fff" />
                {typeof roseBalance?.roses === "number" ? (
                  <View style={styles.roseCount}><Text style={styles.roseCountText}>{roseBalance.roses}</Text></View>
                ) : null}
              </TouchableOpacity>
            ) : null}

            {likeAction}
            {canUndo && undoable ? (
              <UndoSwipeButton
                key="undo"
                seconds={undoSeconds}
                name={undoable.card.name}
                onPress={() => { void rewind(); }}
              />
            ) : null}
          </Animated.View>
        ) : null}
        {(demo && demoHand) || cardTip ? <GestureTip tip={(demo && demoHand) || cardTip!} onDone={() => { setDemoHand(null); setCardTip(null); }} /> : null}
        {pointerVisible ? (
          <>
            {/* Any tap elsewhere puts it away; the bubble itself opens Standouts. */}
            <Pressable style={[StyleSheet.absoluteFill, styles.overDeck]} onPress={() => setPointerVisible(false)} accessibilityLabel="Close tip" />
            <View style={[styles.pointer, { top: headerBox.y + 50 }]} pointerEvents="box-none">
              <View style={[styles.pointerArrow, { left: headerBox.standoutsX - 8 - POINTER_SIDE }]} />
              <Pressable accessibilityRole="button" onPress={() => {
                setPointerVisible(false);
                if (demo) {setDemoNewStandouts(false); setDemoLearning(value => value ?? {needed: 15, done: 0}); setDemoLearningPage(true);} else navigation.navigate("Standouts");
              }}
                style={({ pressed }) => [styles.pointerBubble, pressed && { opacity: 0.85 }]}>
                <StandoutsIcon size={22} color="#E8C698" heartColor="#F2BDC9" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pointerTitle}>{pointerLearned ? "Your Standouts are here" : "Standouts"}</Text>
                  <Text style={styles.pointerText}>{pointerLearned
                    ? "Picked from what you liked and passed. Tap to see them."
                    : "Today's top picks for you, fresh every day. Tap to see them."}</Text>
                </View>
              </Pressable>
            </View>
          </>
        ) : null}
        {iconTip ? (
          <View pointerEvents="none" style={[styles.iconTip, { top: headerBox.y + 52, left: Math.min(Math.max(8, iconTip.x - ICON_TIP_WIDTH / 2), screenWidth - ICON_TIP_WIDTH - 8), width: ICON_TIP_WIDTH }]}>
            <Text style={styles.iconTipText}>{iconTip.label}</Text>
          </View>
        ) : null}
        {trayMoving ? (
          <Animated.View pointerEvents="none" style={[styles.flyer, { left: FLYER_TO.x - FLYER_SIZE / 2 }, flyerStyle]}>
            <View style={[styles.flyerRing, ownHasStory && styles.flyerRingSeen]}>
              <View style={styles.flyerFace}>
                {ownAvatar ? <Image source={{ uri: ownAvatar }} style={styles.flyerImage} /> : <Ionicons name="person" size={24} color="#8B8B90" />}
              </View>
            </View>
            {/* The "+" travels too, so nothing appears when it lands. */}
            <View style={styles.flyerPlus}><Ionicons name="add" size={16} color="#fff" /></View>
          </Animated.View>
        ) : null}
        {demo ? (
          <Modal visible={demoMenu} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setDemoMenu(false)}>
            <Pressable style={styles.demoMenuScrim} onPress={() => setDemoMenu(false)} accessibilityLabel="Close demo tools" />
            <View style={[styles.demoMenu, { paddingBottom: safeInsets.bottom + 12 }]}>
              <View style={styles.demoMenuHead}>
                <Text style={styles.demoMenuTitle} accessibilityRole="header">Demo tools</Text>
                <Pressable onPress={() => setDemoMenu(false)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
                  <Ionicons name="close" size={22} color="#F5F5F5" />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {demoSections.map((section) => (
                  <View key={section.title} style={styles.demoMenuSection}>
                    <Text style={styles.demoMenuLabel}>{section.title}</Text>
                    {section.items.map((item) => (
                      <Pressable key={item.label} accessibilityRole={item.on === undefined ? "button" : "switch"}
                        accessibilityState={item.on === undefined ? undefined : { checked: item.on }}
                        onPress={() => {
                          // Switches stay open to show the change. A page opens only once
                          // this list is gone: two windows at once lose every touch.
                          if (item.on !== undefined) { item.run(); return; }
                          setDemoMenu(false);
                          setTimeout(item.run, 350);
                        }}
                        style={({ pressed }) => [styles.demoMenuRow, pressed && { backgroundColor: "#2A2725" }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.demoMenuRowText}>{item.label}</Text>
                          {item.hint ? <Text style={styles.demoMenuHint}>{item.hint}</Text> : null}
                        </View>
                        {item.on === undefined ? <Ionicons name="chevron-forward" size={18} color="#8D8781" />
                          : <Ionicons name={item.on ? "checkmark-circle" : "ellipse-outline"} size={22} color={item.on ? colors.primary : "#8D8781"} />}
                      </Pressable>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </View>
          </Modal>
        ) : null}
        {demo && demoLearningPage ? (
          <Modal visible animationType="slide" statusBarTranslucent onRequestClose={() => {
            if (!demoStandoutsIntroSeen) setDemoStandoutsIntroSeen(true); else setDemoLearningPage(false);
          }}>
            <StandoutsScreen demoOnly demoProgress={demoLearning ?? {needed: 15, done: 4}}
              demoIntroSeen={demoStandoutsIntroSeen} onDemoIntroSeen={setDemoStandoutsIntroSeen}
              onClose={() => setDemoLearningPage(false)} onExplore={() => setDemoLearningPage(false)} />
          </Modal>
        ) : null}
        {demo ? (
          <Modal visible={demoWelcome} animationType="slide" statusBarTranslucent onRequestClose={() => setDemoWelcome(false)}>
            <StandoutsInfoContent onClose={() => setDemoWelcome(false)} weeklyGrant={5} topInset={safeInsets.top} bottomInset={safeInsets.bottom} />
          </Modal>
        ) : null}
        {demo ? (
          <Modal visible={demoTeach !== null} animationType="slide" statusBarTranslucent onRequestClose={() => setDemoTeach(null)}>
            {demoTeach === "tour"
              ? <WelcomeTour onDone={() => setDemoTeach(null)} topInset={safeInsets.top} bottomInset={safeInsets.bottom} />
              : <HowItWorksContent onClose={() => setDemoTeach(null)} topInset={safeInsets.top} bottomInset={safeInsets.bottom} />}
          </Modal>
        ) : null}
        {demo && demoSwipeLesson ? (
          <Modal visible animationType="none" statusBarTranslucent onRequestClose={() => setDemoSwipeLesson(false)}>
            <SwipeLesson onDone={() => setDemoSwipeLesson(false)} topInset={safeInsets.top} bottomInset={safeInsets.bottom}/>
          </Modal>
        ) : null}
        {__DEV__ && demo && demoLoading ? (
          <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => setDemoLoading(false)}>
            <ExploreLoadingDemo avatarUri={typeof ownAvatar === 'string' ? ownAvatar : null}
              topInset={safeInsets.top} bottomInset={safeInsets.bottom} onClose={() => setDemoLoading(false)}/>
          </Modal>
        ) : null}
        {demo ? (
          // After Delete my account, without deleting anything: erased in 30 days.
          <Modal visible={demoGoodbye} animationType="fade" statusBarTranslucent onRequestClose={() => setDemoGoodbye(false)}>
            <AccountGoodbyeScreen preview={{ scheduledFor: new Date(Date.now() + 30 * 86_400_000).toISOString(), onDone: () => setDemoGoodbye(false) }} />
          </Modal>
        ) : null}

        {__DEV__ && !demo ? (
          <Modal
            visible={demoOpen}
            animationType="fade"
            onShow={() => setDemoWindowShown(true)}
            onRequestClose={() => setDemoOpen(false)}
          >
            <DiscoverScreen demo demoWindowReady={demoWindowShown} onClose={() => setDemoOpen(false)} />
          </Modal>
        ) : null}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
};

/**
 * The deck runs down to just above the tab bar, and the action buttons float on
 * its bottom edge (thumb reach), so the card keeps the screen. The card keeps
 * ACTIONS_INSET free under its name and details for them.
 */
const DECK_BOTTOM = 100;

/** What the server is told a comment is about: the photo as shown, or just "the bio" (it reads the bio itself). */
function aboutForServer(about: CommentAbout) {
  return about.kind === "photo" ? { kind: "photo" as const, photoUrl: about.photoUrl } : { kind: "bio" as const };
}

/** The demo sends nothing, so it mirrors the server's contact rule (note-safety.ts) to show the error. */
function demoCommentProblem(comment: string) {
  return /\d[\d\s-]{8,}\d|@\w|https?:|www\.|\.(com|in|me)/i.test(comment)
    ? "Comments can't include phone numbers, emails, links or handles."
    : null;
}
/** After this long away from Explore, coming back loads a fresh deck. */
const DECK_STALE_MS = 15 * 60_000;
/** Swipes in before the one-time Standouts pointer appears (not on arrival). */
const STANDOUTS_POINTER_AFTER = 3;
/** The pointer's side margin. */
const POINTER_SIDE = 16;
/** A long-press label's box: kept inside the screen at either edge. */
const ICON_TIP_WIDTH = 180;
/** The demo's chip row. */
const DEMO_CHIPS_HEIGHT = 38;
/** The small ring's width beside the buttons (StoryTray's header item). */
const HEADER_RING_SLOT = 48;
/**
 * Your avatar's two places: the ring beside the buttons (the header's centre,
 * a 40 px face) and the first face in the row (52 px). Matches StoryTray's sizes.
 */
const FLYER_SIZE = 60;
const FLYER_FACE = 52;
const FLYER_FROM = { x: 16 + 24, y: 28, scale: 44 / 60 };
const FLYER_TO = { x: 12 + 32, y: 2 + 30 };
const DECK_BOTTOM_DEMO = 24;
const ACTIONS_INSET = 84;

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 16,
    paddingRight: 12,
    height: 56,
  },
  titleSpace: { flex: 1, alignSelf: "stretch", justifyContent: "center" },
  wordmark: { color: "#FFFFFF", fontSize: 22, fontWeight: "800", letterSpacing: -0.4, paddingLeft: 4 },
  demoMenuScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  demoMenu: { maxHeight: "75%", backgroundColor: "#1B1917", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 16 },
  demoMenuHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  demoMenuTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  demoMenuSection: { marginTop: 10 },
  demoMenuLabel: { color: "#A9A5A2", fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 },
  demoMenuRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12 },
  demoMenuRowText: { color: "#F5F5F5", fontSize: 15 },
  demoMenuHint: { color: "#8D8781", fontSize: 12, marginTop: 2 },
  demoStories: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 8, height: DEMO_CHIPS_HEIGHT },
  demoPostChip: { borderColor: colors.primary },
  demoRowLabel: { color: "#A9A5A2", fontSize: 12, fontWeight: "700", alignSelf: "center", marginRight: 2 },
  trayRow: { overflow: "hidden" },
  trayRowInner: { position: "absolute", top: 0, left: 0, right: 0 },
  // Holds the row's height while it is closed, so opening knows how far to go.
  trayRowProbe: { height: 87 },
  // A copy of StoryTray's own item: the 60 px ring, a 4 px gap, the 52 px face.
  flyer: { position: "absolute", width: FLYER_SIZE, height: FLYER_SIZE, zIndex: 50 },
  flyerRing: { width: FLYER_SIZE, height: FLYER_SIZE, borderRadius: FLYER_SIZE / 2, alignItems: "center", justifyContent: "center" },
  flyerRingSeen: { borderWidth: 1.5, borderColor: "#4A4A50" },
  flyerFace: { width: FLYER_FACE, height: FLYER_FACE, borderRadius: FLYER_FACE / 2, overflow: "hidden", backgroundColor: "#2A2A2D", alignItems: "center", justifyContent: "center" },
  flyerImage: { width: FLYER_FACE, height: FLYER_FACE },
  // StoryTray's "+" on your ring, at the row's size.
  flyerPlus: {
    position: "absolute", top: FLYER_SIZE - 22, right: 2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary, borderWidth: 2, borderColor: "#100F0D", alignItems: "center", justifyContent: "center",
  },
  demoStoriesChip: { height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: "#3A3836", justifyContent: "center" },
  demoStoriesChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  demoStoriesText: { color: "#CFCBC8", fontSize: 12, fontWeight: "600" },
  demoStoriesTextOn: { color: "#FFFFFF" },
  exploreTool: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#242323",
    alignItems: "center",
    justifyContent: "center",
  },
  exploreToolPressed: { backgroundColor: "#363433", transform: [{ scale: 0.94 }] },
  // Standouts is the one to notice: same circle as the others, a larger icon and a gold edge.
  standoutsTool: { backgroundColor: "#2A2620", borderWidth: 1, borderColor: "rgba(255,210,122,0.35)" },
  standoutsRing: { position: "absolute", top: -1, left: -1 },
  standoutsDot: { position: "absolute", top: 3, right: 3, width: 10, height: 10, borderRadius: 5, backgroundColor: "#E8C698", borderWidth: 2, borderColor: "#100F0D" },
  // On Android a raised card (elevation) is drawn - and touched - above later
  // views unless they are raised too: these sit over the deck.
  overDeck: { zIndex: 59, elevation: 30 },
  pointer: { position: "absolute", left: POINTER_SIDE, right: POINTER_SIDE, zIndex: 60, elevation: 31, alignItems: "stretch" },
  pointerArrow: { width: 16, height: 16, backgroundColor: "#2A2620", borderLeftWidth: 1, borderTopWidth: 1, borderColor: "rgba(255,210,122,0.45)", transform: [{ rotate: "45deg" }], marginBottom: -9, zIndex: 2 },
  pointerBubble: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: "#2A2620", borderWidth: 1, borderColor: "rgba(255,210,122,0.45)", elevation: 8, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  pointerTitle: { color: "#FFE3AE", fontSize: 15, fontWeight: "700" },
  pointerText: { color: "#E9DCC6", fontSize: 13, lineHeight: 18, marginTop: 2 },
  iconTip: { position: "absolute", zIndex: 70, elevation: 32, alignItems: "center" },
  iconTipText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: "#3A3836", overflow: "hidden" },
  devTool: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.primary },
  cardsWrapper: { flex: 1, position: "relative", marginTop: 8 },
  hiddenBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#211C2E",
    borderWidth: 1,
    borderColor: "rgba(205,187,255,0.18)",
  },
  hiddenBannerText: { flex: 1, color: "#E6DDFF", fontSize: 13 },
  hiddenBannerButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: "rgba(205,187,255,0.14)" },
  hiddenBannerButtonText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  cardStyle: { position: "absolute", top: 0, left: 12, right: 12, bottom: 0 },
  // The same Rose as the profile view's (profile-detail/ProfileDetailModal.tsx).
  roseBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#C2185B",
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  roseEmpty: { backgroundColor: "#4A2A38" },
  roseCount: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: "#100F0D",
    borderWidth: 1.5,
    borderColor: "#C2185B",
    alignItems: "center",
    justifyContent: "center",
  },
  roseCountText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.05)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  discoverKitten: { width: 124, height: 186, marginBottom: 16 },
  emptyPrimary: {
    alignSelf: "stretch",
    height: 52,
    borderRadius: 26,
    marginTop: 24,
    backgroundColor: "#F3C1CA",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyPrimaryText: { color: "#331C23", fontSize: 16, fontWeight: "700" },
  emptySecondary: {
    alignSelf: "stretch",
    height: 52,
    borderRadius: 26,
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,210,122,0.45)",
    backgroundColor: "#2A2620",
    alignItems: "center",
    justifyContent: "center",
  },
  emptySecondaryText: { color: "#FFE3AE", fontSize: 16, fontWeight: "700" },
  emptyRetry: { marginTop: 6, minHeight: 44, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  emptyRetryText: { color: "rgba(255,255,255,0.7)", fontSize: 15, fontWeight: "600" },
  emptyEmoji: { fontSize: 32 },
  emptyTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFF",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySub: {
    fontSize: 16,
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    lineHeight: 24,
  },
  actionContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 18,
    position: "absolute",
    bottom: 110,
    left: 0,
    right: 0,
    zIndex: 100,
  }, // Pushed up above custom tab bar
  actionDisabled: { opacity: 0.35 },
  actionBtnContainer: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  // Pass is neutral and Like carries the brand: red-against-green read as a
  // wrong/right judgement, and many colour-blind people cannot tell them apart.
  passBtn: { backgroundColor: "#24211F", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" },
  mainActionContainer: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  mainActionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
});
