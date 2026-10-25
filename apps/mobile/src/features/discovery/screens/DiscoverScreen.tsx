import { MatchSheet, type MatchMoment } from "../components/MatchSheet";
import { DeckReminderCard, DeckVerifyBanner, useDeckReminderCard } from "../../verification/DeckVerifyBanner";
import { refreshVerificationStatus } from "../../verification/useVerificationStatus";
import { verifyReasonOf } from "../../verification/verifyGate";
import { useFocusEffect, useIsFocused, useNavigation } from "@react-navigation/native";
import { useUnreadNotifications } from "../../notifications/useUnreadNotifications";
import { ExploreActivityButton } from "../../notifications/ExploreActivityButton";
import { onPreferencesChanged } from "../preferencesEvents";
import type { DiscoveryPage, DiscoveryCard } from "@iem-dating/shared";
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useSyncExternalStore } from "react";
import {getDiscoveryArrival, setDiscoveryArrivalFrame, subscribeDiscoveryArrival, updateDiscoveryArrival} from '../discoveryArrival';
import {
  View,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  ActivityIndicator,
  Text,
  Alert,
  Dimensions,
  TouchableOpacity,
  Pressable,
  Image,
  AppState,
  Modal,
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
} from "react-native-reanimated";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { SwipeDecisionStamps } from "../components/SwipeDecisionStamps";
import { UndoSwipeButton } from "../components/UndoSwipeButton";
import { StandoutsIcon } from '../components/StandoutsIcon';
import { createSwipeUndo, undoSecondsRemaining, type SwipeUndo } from "../swipeUndo";
import { SwipeCard } from "../components/SwipeCard";
import { colors } from "../../../core/theme/colors";
import { api } from "../../../services/api";
import { demoProfiles } from "../demo/demoProfiles";
import { StoryTray } from "../../stories/components/StoryTray";
import {
  createImagePreparation,
  photoPreparationWindow,
} from "../media/preparation";
import type { PlaybackState } from "../media/CardVideo";
import { RoseSheetHost, type RoseSheetHostHandle } from "../components/RoseSheet";
import { LocationGate } from "../../location/LocationGate";
import { useLocationGate } from "../../location/useLocationGate";
import { placeLine } from "../../location/cardLabels";
import { useRoses } from "../useRoses";
import { considerRatingPrompts } from '../../feedback/RatingPrompt';

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
}: {
  demo?: boolean;
  onClose?: () => void;
}) => {
  const navigation = useNavigation<any>();
  const { unread: unreadNotifications } = useUnreadNotifications();
  const hasPreparedNotifications = useRef(false);
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
  const fetching = useRef(false);
  const [discoveryState, setDiscoveryState] = useState("loading");
  const [fetchError, setFetchError] = useState("");
  // Whenever the location changes underneath the deck, the deck is stale.
  const locationGate = useLocationGate(!demo, () => void fetchRecommendations(true));
  const arrival = useSyncExternalStore(subscribeDiscoveryArrival, getDiscoveryArrival);
  const screenFocused = useIsFocused();
  const focused = screenFocused && !arrival.active;
  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );
  const [hasMore, setHasMore] = useState(!demo);
  const [demoOpen, setDemoOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const actionsVisible = useSharedValue(1);
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
    opacity: actionsVisible.value,
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
  // Rewind (EXPLORE_SPEC.md, section 12): the last swipe, for 60 seconds, once
  // per person. Free here, and narrow on purpose - it fixes a misplaced thumb,
  // it is not a way to re-open profiles you already dismissed.
  const [undoable, setUndoable] = useState<SwipeUndo<DiscoveryCard> | null>(null);
  const visibleUndo = useRef<SwipeUndo<DiscoveryCard> | null>(null);
  const swipeUndo = useRef<SwipeUndo<DiscoveryCard> | null>(null);
  // Swipes this sitting: reminder 3 shows after about 20 (GOOGLE_SIGNUP_PLAN.md 4).
  const [swipeCount, setSwipeCount] = useState(0);
  const [matchMoment, setMatchMoment] = useState<(MatchMoment & { chat: Record<string, unknown> }) | null>(null);
  // Out of likes, or paused: the deck shows its own card in the cards' place.
  const deckCard = useDeckReminderCard(demo);
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
      swipeLocked.value = false;
      mediaPaused.value = false;
      swipeDispatched.value = false;
      stampOwner.value = "";
    })();
  }, [frontId, dragX, dragY, swipeLocked]);

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

  useEffect(() => {
    if (!demo && screenFocused && appActive)
      void fetchRecommendations(true);
  }, [screenFocused, appActive]);

  useEffect(() => {
    const receipt = users[0]?.impressionId;
    if (demo || demoOpen || !receipt || !focused || !appActive)
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
    focused,
    appActive,
    demo,
    demoOpen,
  ]);

  // My preferences saved: a fresh deck under the new filters, now.
  const reloadDeck = useRef<() => void>(() => undefined);
  useEffect(() => onPreferencesChanged(() => reloadDeck.current()), []);

  const fetchRecommendations = async (restart = false) => {
    if (demo) {
      dismissed.current.clear();
      setUsers([...demoProfiles]);
      usersRef.current = [...demoProfiles];
      setHasMore(false);
      return;
    }
    if (fetching.current || (!restart && !nextCursor.current)) return;
    fetching.current = true;
    if (restart) {
      setLoading(true);
      nextCursor.current = null;
      setUsers([]);
    }
    setFetchError("");
    try {
      const query = nextCursor.current
        ? `&cursor=${encodeURIComponent(nextCursor.current)}`
        : "";
      const res = await api.get<{ success: boolean; data: DiscoveryPage }>(
        `/discover/recommendations?limit=20${query}`,
      );
      const data = res.data.data;
      nextCursor.current = data.nextCursor;
      setHasMore(!!data.nextCursor);
      setDiscoveryState(data.state);
      setUsers((prev) => {
        const existing = restart ? [] : prev;
        const known = new Set(existing.map((u) => u.id));
        return [
          ...existing,
          ...data.cards.filter(
            (u: any) => !known.has(u.id) && !dismissed.current.has(u.id),
          ),
        ];
      });
    } catch (error: any) {
      if (error.response?.data?.code === "DECK_EXPIRED") {
        nextCursor.current = null;
        setFetchError("Your discovery list changed. Select Retry to load it.");
      } else setFetchError("Could not load profiles. Select Retry.");
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  };
  reloadDeck.current = () => {
    if (!demo) void fetchRecommendations(true);
  };
  useEffect(() => {
    if (demo || !arrival.active) return;
    const status = locationGate.kind !== 'none' ? 'ready' : loading ? 'loading' : fetchError ? 'error' : 'ready';
    updateDiscoveryArrival(status, () => reloadDeck.current(), locationGate.kind === 'none' ? users : []);
  }, [demo, arrival.active, loading, fetchError, locationGate.kind, users]);
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
  const handleRose = async (target: DiscoveryCard, comment: string | null) => {
    const result = await sendRose(target.id, comment);
    if (!result) return;
    roseHost.current?.close();
    dismissed.current.add(target.id);
    usersRef.current = usersRef.current.filter((u) => u.id !== target.id);
    setUsers(usersRef.current);
    if (result.matchCreated) {
      Alert.alert("It's a match!", `You and ${target.name} liked each other.`);
    }
  };

  const handleSwipe = async (action: "like" | "pass") => {
    setSwipeCount((count) => count + 1);
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
    try {
      const res = await api.post("/discover/swipe", {
        targetId: targetUser.id,
        action,
      });
      // The likes counter and grace reminders follow each Like (GOOGLE_SIGNUP_PLAN.md 2.2).
      if (action === "like") void refreshVerificationStatus();
      if (res.data.data?.matchCreated) {
        // A match cannot be rewound: the other person can already see it.
        if (pending) confirmUndo(pending, null);
        // Reminder 4 (GOOGLE_SIGNUP_PLAN.md 4): only when the match is verified and you are not.
        const status = await refreshVerificationStatus();
        setMatchMoment({
          name: targetUser.name,
          verifyNudge: !!status?.limited && !!(targetUser as { isVerified?: boolean }).isVerified,
          chat: {
            matchId: res.data.data.matchId,
            userId: targetUser.id,
            userName: targetUser.name,
            userAvatar: targetUser.primaryPhoto ?? targetUser.photos?.[0] ?? null,
          },
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
        if (!verifyReasonOf(error)) Alert.alert(
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
  const forceSwipe = (direction: "left" | "right") => {
    if (!usersRef.current.length || demoOpen || rewinding.current) return;
    runOnUI(animateSwipe)(direction);
  };
  const panGesture = Gesture.Pan()
    .enabled(users.length > 0 && !demoOpen && focused && !deckCard.kind)
    .activeOffsetX([-6, 6])
    .failOffsetY([-32, 32])
    .maxPointers(1)
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
    transform: [
      { translateX: dragX.value },
      { translateY: dragY.value },
      {
        rotate: `${Math.max(-12, Math.min(12, (dragX.value / SCREEN_WIDTH) * 12))}deg`,
      },
    ],
  }));
  const nextCardStyle = useAnimatedStyle(() => ({
    opacity: 1,
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

  const renderCards = () => {
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
    if (loading && users.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

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
                : "No more profiles"}
          </Text>
          <Text style={styles.emptySub}>
            {fetchError ||
              (discoveryState === "capacity_limited"
                ? "Some profiles are temporarily reserved. Select Load more to retry shortly."
                : discoveryState === "setup_required"
                  ? "Confirm whom you want to see before discovery starts."
                  : hasMore
                    ? "More profiles may be available. Select Load more."
                    : "This list has ended. Retry or change your preferences.")}
          </Text>
          <TouchableOpacity
            onPress={() =>
              demo ? void fetchRecommendations(true) : navigation.navigate("Preferences")
            }
          >
            <Text style={[styles.emptySub, { marginTop: 18, color: "#fff" }]}>
              {demo ? "Reset demo cards" : "Edit preferences"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => fetchRecommendations(!nextCursor.current)}
          >
            <Text style={[styles.emptySub, { marginTop: 18, color: "#fff" }]}>
              {hasMore ? "Load more" : "Retry"}
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
            <SwipeDecisionStamps
              cardId={user.id}
              owner={stampOwner}
              dragX={dragX}
              width={SCREEN_WIDTH}
            />

            <SwipeCard
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
              roseOverlay={isTopCard ? <RoseSheetHost<DiscoveryCard> ref={roseHost} inline balance={roseBalance?.roses ?? null}
                onSend={(card, comment) => handleRose(card, comment)} /> : undefined}
              onRoseOverlayBack={() => roseHost.current?.back() ?? false}
              isActiveCard={
                isTopCard &&
                !demoOpen &&
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

  return (
    <GestureHandlerRootView
      style={[styles.container, { backgroundColor: "#100F0D" }]}
    >
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.pageActions}>
          <Text
            style={{ color: colors.primary, fontSize: 26, fontWeight: "800" }}
          >
            {demo ? "Explore demo" : "Explore"}
          </Text>
          {demo ? (
            <TouchableOpacity accessibilityLabel="Close demo" onPress={onClose}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          ) : (
            // Standouts lives by the deck: both are people picked for you.
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Today's Standouts"
              onPress={() => navigation.navigate("Standouts")}
              style={styles.standoutsButton}
            >
              <StandoutsIcon size={18} color="#E8C698" heartColor="#F2BDC9" />
              <Text style={styles.standoutsText}>Standouts</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.pageActions}>
          <TouchableOpacity
            onPress={() =>
              demo ? void fetchRecommendations(true) : navigation.navigate("Preferences")
            }
            style={[styles.pageAction, styles.preferencesAction]}
          >
            <Text style={styles.pageActionText}>
              {demo ? "Reset demo cards" : "Discovery preferences"}
            </Text>
          </TouchableOpacity>
          {!demo ? (
            <View style={styles.exploreTools}>
              {__DEV__ && (
                <TouchableOpacity
                  accessibilityLabel="Open demo cards"
                  onPress={() => setDemoOpen(true)}
                  style={[styles.pageAction, styles.demoAction]}
                >
                  <Ionicons name="flask-outline" size={16} color={colors.primary} />
                  <Text style={styles.demoActionText}>Demo cards</Text>
                </TouchableOpacity>
              )}
              {__DEV__ && (
                <TouchableOpacity
                  accessibilityLabel="Open reminders demo"
                  onPress={() => navigation.navigate("ReminderPreview")}
                  style={[styles.pageAction, styles.demoAction]}
                >
                  <Ionicons name="notifications-outline" size={16} color={colors.primary} />
                  <Text style={styles.demoActionText}>Reminders</Text>
                </TouchableOpacity>
              )}
              <ExploreActivityButton unread={unreadNotifications}
                onPress={() => navigation.navigate("Notifications", { scope: "all" })} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Preferences"
                onPress={() => navigation.navigate("Preferences")}
                style={({ pressed }) => [styles.exploreTool, pressed && styles.exploreToolPressed]}
              >
                <Ionicons name="options-outline" size={20} color="#F5F5F5" />
              </Pressable>
            </View>
          ) : null}
        </View>
        <StoryTray demo={demo} onOpenChange={demo ? setStoryOpen : undefined} />
        {!demo && !arrival.active && <DeckVerifyBanner swipes={swipeCount} cardShown={!!deckCard.kind} topCardUnverified={!!users[0] && !(users[0] as { isVerified?: boolean }).isVerified} />}
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
        <GestureDetector gesture={panGesture}>
          <Animated.View
            collapsable={false}
            style={[styles.cardsWrapper, { marginBottom: demo ? 120 : 208 }]}
          >
            {deckCard.kind ? <DeckReminderCard kind={deckCard.kind} onKeepBrowsing={deckCard.keepBrowsing} /> : renderCards()}
          </Animated.View>
        </GestureDetector>

        {!deckCard.kind && (users.length > 0 || canUndo) ? (
          <Animated.View
            style={[
              styles.actionContainer,
              { bottom: demo ? 36 : 124 },
              actionsRevealStyle,
            ]}
          >
            {canUndo && undoable ? (
              <UndoSwipeButton
                key="undo"
                seconds={undoSeconds}
                name={undoable.card.name}
                onPress={() => { void rewind(); }}
              />
            ) : null}
            {!canUndo ? passAction : null}

            <Animated.View
              key="like"
              style={[styles.mainActionContainer, likeButtonStyle]}
            >
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
            {canUndo ? passAction : null}
          </Animated.View>
        ) : null}
        <MatchSheet match={matchMoment} onClose={() => setMatchMoment(null)}
          onSayHi={() => { const chat = matchMoment?.chat; setMatchMoment(null); if (chat?.matchId) navigation.navigate("ChatScreen", chat); }}
          onVerify={() => { setMatchMoment(null); navigation.navigate("VerifyCollege"); }} />
        {__DEV__ && !demo ? (
          <Modal
            visible={demoOpen}
            animationType="fade"
            onRequestClose={() => setDemoOpen(false)}
          >
            <DiscoverScreen demo onClose={() => setDemoOpen(false)} />
          </Modal>
        ) : null}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  pageActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 6,
  },
  pageAction: { minHeight: 36, justifyContent: "center" },
  preferencesAction: { flex: 1, minWidth: 0, marginRight: 10 },
  exploreTools: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  exploreTool: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#242323",
    alignItems: "center",
    justifyContent: "center",
  },
  exploreToolPressed: { backgroundColor: "#363433", transform: [{ scale: 0.94 }] },
  standoutsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
    backgroundColor: "#2A2620",
    borderWidth: 1,
    borderColor: "rgba(255,210,122,0.35)",
  },
  standoutsText: { color: "#FFE3AE", fontSize: 13, fontWeight: "700" },
  pageActionText: { color: "#fff" },
  demoAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 18,
    paddingHorizontal: 12,
  },
  demoActionText: { color: colors.primary, fontWeight: "700" },
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
  cardStyle: { position: "absolute", top: 0, left: 10, right: 10, bottom: 0 },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
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
    gap: 32,
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
  passBtn: { backgroundColor: "#E44124" }, // Solid Red/Orange from the image
  mainActionContainer: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  mainActionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#6AB04C",
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  stampContainer: { position: "absolute", top: 50, zIndex: 999, padding: 10 },
  likeStamp: { left: 24, transform: [{ rotate: "-15deg" }] },
  nopeStamp: { right: 24, transform: [{ rotate: "15deg" }] },
  stampText: {
    fontSize: 36,
    fontWeight: "900",
    borderWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    letterSpacing: 3,
    overflow: "hidden",
  },
});
