import { UnverifiedNudge } from '../verification/VerifyNudge';
import { openReport } from "../safety/ReportSheet";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { cancelAnimation, Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { Ionicons } from "@expo/vector-icons";
import { INTEREST_CATEGORIES } from "@iem-dating/shared/interest-catalog";
import { api } from "../../services/api";
import { useSocket } from "../../services/useSocketEvent";
import { colors } from "../../core/theme/colors";
import type { RootState } from "../../store";
import { ExploreScreen } from "../../screens/main/ExploreScreen";
import { ProfileDetailModal } from "../discovery/components/profile-detail/ProfileDetailModal";
import type { RoseConfirmation } from "../discovery/components/profile-detail/RoseSentCelebration";
import type { ExploreProfile } from "../discovery/components/ExploreProfileCard";
import { RoseSheetHost, type RoseSheetHostHandle } from "../discovery/components/RoseSheet";
import { useRoses } from "../discovery/useRoses";
import {
  DATING_UNAVAILABLE,
  type MyDatingState,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_QUERY,
  matchesName,
  personMeta,
  searchTokens,
  yearLabel,
  type SearchPerson,
  type SearchResult,
} from "./searchTypes";
import { readRecent, withRecent, withoutRecent, writeRecent, type RecentSearch } from "./recentSearches";
import { DEMO_LIVE, demoDatingProfile, searchDemo } from "./searchDemo";
import { PersonAvatar } from "./PersonAvatar";
import { SearchProfileSheet } from "./SearchProfileSheet";
import { VerifiedBadge } from "../discovery/components/VerifiedBadge";
import { DECISION_APPEARANCE, decisionDate, decisionTitle } from "./searchDecisionPresentation";

const interestChoices = INTEREST_CATEGORIES.flatMap((group) => group.interests);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
/** The zero state's prompt to browse: a couple from every category. */

type FollowStatus = SearchPerson["followStatus"];
type SearchBarFrame = { x: number; y: number; width: number; height: number };

/**
 * The Search tab (SEARCH_SPEC.md 9): Explore stays the browsing surface, with
 * a search bar on top that opens name search over it, as Instagram's does.
 */
export function SearchScreen() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [transitionQuery, setTransitionQuery] = useState("");
  const [startFrame, setStartFrame] = useState<SearchBarFrame | null>(null);
  const [endFrame, setEndFrame] = useState<SearchBarFrame | null>(null);
  const root = useRef<View>(null);
  const entry = useRef<View>(null);
  const rootPosition = useRef({ x: 0, y: 0 });
  const rootMeasured = useRef(false);
  const fieldWindowFrame = useRef<SearchBarFrame | null>(null);
  const phase = useRef<"closed" | "open" | "closing">("closed");
  const progress = useSharedValue(0);
  const barVisible = useSharedValue(false);
  const navigation = useNavigation<any>();
  // Tapping the Search tab again while on it: open search, or - already open -
  // put the cursor back in the field and the results back at the top.
  const [retap, setRetap] = useState(0);

  useEffect(() => () => cancelAnimation(progress), [progress]);
  useEffect(() => {
    if (ready || !open) barVisible.value = false;
  }, [ready, open, barVisible]);

  const finishOpen = () => {
    if (phase.current !== "open") return;
    setReady(true);
  };
  const finishClose = () => {
    if (phase.current !== "closing") return;
    phase.current = "closed";
    setTransitionQuery("");
    setOpen(false);
  };

  const cacheEntryLayout = () => {
    root.current?.measureInWindow((rootX, rootY) => {
      if (phase.current !== "closed") return;
      rootPosition.current = { x: rootX, y: rootY };
      rootMeasured.current = true;
      entry.current?.measureInWindow((x, y, width, height) => {
        if (phase.current !== "closed" || width <= 0 || height <= 0) return;
        setStartFrame({ x: x - rootX, y: y - rootY, width, height });
      });
      const target = fieldWindowFrame.current;
      if (target) setEndFrame({ ...target, x: target.x - rootX, y: target.y - rootY });
    });
  };

  const openSearch = () => {
    if (phase.current !== "closed") return;
    phase.current = "open";
    cancelAnimation(progress);
    setTransitionQuery("");
    setOpen(true);
    if (!startFrame || !endFrame) {
      progress.value = 1;
      setReady(true);
      return;
    }
    setReady(false);
    barVisible.value = true;
    progress.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    }, (finished) => {
      if (finished) runOnJS(finishOpen)();
    });
  };

  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;
  useEffect(() => navigation.addListener("tabPress", () => {
    // From another tab this is just arriving here.
    if (!navigation.isFocused()) return;
    if (phase.current === "open") setRetap((value) => value + 1);
    else if (phase.current === "closed") openSearchRef.current();
  }), [navigation]);

  const fieldMeasured = (frame: SearchBarFrame) => {
    if (frame.width <= 0 || frame.height <= 0) return;
    fieldWindowFrame.current = frame;
    if (phase.current !== "closed" || !rootMeasured.current) return;
    const { x, y } = rootPosition.current;
    setEndFrame({ ...frame, x: frame.x - x, y: frame.y - y });
  };

  const closeSearch = (query: string) => {
    if (phase.current === "closed" || phase.current === "closing") return;
    Keyboard.dismiss();
    cancelAnimation(progress);
    setTransitionQuery(query);
    setReady(false);
    if (!startFrame || !endFrame) {
      phase.current = "closed";
      progress.value = 0;
      setOpen(false);
      barVisible.value = false;
      return;
    }
    phase.current = "closing";
    barVisible.value = true;
    requestAnimationFrame(() => {
      progress.value = withTiming(0, {
        duration: 220,
        easing: Easing.inOut(Easing.cubic),
      }, (finished) => {
        if (finished) runOnJS(finishClose)();
      });
    });
  };

  const browseMotion = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.35, 1], [1, 0, 0], "clamp"),
  }));
  const entryMotion = useAnimatedStyle(() => ({
    opacity: barVisible.value || progress.value > 0 ? 0 : 1,
  }));

  return (
    <View ref={root} onLayout={cacheEntryLayout} style={styles.fill}>
      <Animated.View style={[styles.fill, browseMotion]} pointerEvents={open ? "none" : "auto"}>
      <ExploreScreen
        searchBar={
          <AnimatedPressable
            ref={entry}
            onLayout={cacheEntryLayout}
            onPress={openSearch}
            accessibilityRole="search"
            accessibilityLabel="Search people at your college"
            style={[styles.entry, entryMotion]}
          >
            <Ionicons name="search" size={18} color={colors.text.secondary} />
            <SearchPlaceholder />
          </AnimatedPressable>
        }
      />
      </Animated.View>
      <SearchPanel active={open} onClose={closeSearch} onFieldLayout={fieldMeasured} ready={ready} progress={progress} retap={retap} />
      {startFrame && (
        <MovingSearchBar startFrame={startFrame} endFrame={endFrame} progress={progress} value={transitionQuery} visible={barVisible} />
      )}
    </View>
  );
}

function MovingSearchBar({ startFrame, endFrame, progress, value, visible }: {
  startFrame: SearchBarFrame;
  endFrame: SearchBarFrame | null;
  progress: SharedValue<number>;
  value: string;
  visible: SharedValue<boolean>;
}) {
  // Mount with a measured frame. A reused animated style can initially contain
  // an empty frame or the previous transition's frame before its worklet updates.
  const motion = useAnimatedStyle(() => {
    const target = endFrame ?? startFrame;
    return {
      opacity: visible.value ? 1 : 0,
      width: interpolate(progress.value, [0, 1], [startFrame.width, target.width]),
      height: interpolate(progress.value, [0, 1], [startFrame.height, target.height]),
      transform: [
        { translateX: (target.x - startFrame.x) * progress.value },
        { translateY: (target.y - startFrame.y) * progress.value },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[
      styles.movingField,
      { left: startFrame.x, top: startFrame.y, width: startFrame.width, height: startFrame.height },
      motion,
    ]}>
      <Ionicons name="search" size={18} color={colors.text.secondary} />
      <SearchPlaceholder value={value} />
    </Animated.View>
  );
}

function SearchPlaceholder({ value = "" }: { value?: string }) {
  return (
    <TextInput
      editable={false}
      value={value}
      pointerEvents="none"
      importantForAccessibility="no"
      placeholder="Search by name"
      placeholderTextColor={colors.text.secondary}
      style={styles.input}
    />
  );
}

type Status = "idle" | "loading" | "ok" | "error";

function SearchPanel({
  active,
  onClose,
  onFieldLayout,
  ready,
  progress,
  retap,
}: {
  active: boolean;
  onClose: (query: string) => void;
  onFieldLayout: (frame: SearchBarFrame) => void;
  ready: boolean;
  progress: SharedValue<number>;
  /** Goes up each time the Search tab is tapped again while search is open. */
  retap: number;
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const accountId = useSelector((state: RootState) => (state.auth.user as any)?.id as string | undefined) ?? "anon";
  const [demo, setDemo] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [errorText, setErrorText] = useState("");
  const [retry, setRetry] = useState(0);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const generation = useRef(0);
  const input = useRef<TextInput>(null);
  const field = useRef<View>(null);
  const backgroundMotion = useAnimatedStyle(() => ({ opacity: progress.value }));
  const contentMotion = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.35, 1], [0, 0, 1], "clamp"),
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));
  const controlsMotion = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4, 1], [0, 0, 1], "clamp"),
  }));
  const closePanel = useCallback(() => onClose(query), [onClose, query]);

  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  const list = useRef<FlatList<SearchPerson>>(null);
  useEffect(() => {
    if (!retap || !ready) return;
    list.current?.scrollToOffset({ offset: 0, animated: true });
    input.current?.focus();
  }, [retap, ready]);

  // Demo state lives only here and is gone when the panel closes.
  const [demoFollows, setDemoFollows] = useState<Record<string, FollowStatus>>({});
  /** The demo's own decisions, so a search after a Like shows it as the server would. */
  const demoLiked = useRef(new Map<string, MyDatingState>());
  /** The demo's own Rose count: starts at 3 and goes down as Roses are sent. */
  const [demoRoses, setDemoRoses] = useState(3);

  const recentKey = demo ? `${accountId}:demo` : accountId;
  useEffect(() => {
    let active = true;
    readRecent(recentKey).then((list) => active && setRecent(list));
    return () => {
      active = false;
    };
  }, [recentKey]);
  const saveRecent = useCallback(
    (update: (list: RecentSearch[]) => RecentSearch[]) =>
      setRecent((list) => {
        const next = update(list);
        void writeRecent(recentKey, next);
        return next;
      }),
    [recentKey],
  );

  // Android back closes the panel (the sheets inside handle their own back).
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closePanel();
      return true;
    });
    return () => sub.remove();
  }, [active, closePanel]);

  // Debounced 250 ms; a stale answer never replaces a newer one.
  const trimmed = query.trim();
  useEffect(() => {
    const id = ++generation.current;
    if (!active || trimmed.length < SEARCH_MIN_QUERY) {
      setStatus("idle");
      setResult(null);
      return;
    }
    setStatus("loading");
    const timer = setTimeout(async () => {
      if (demo) {
        setResult(searchDemo(trimmed, demoFollows, demoLiked.current));
        setStatus("ok");
        return;
      }
      try {
        const response = await api.get("/search/people", { params: { q: trimmed } });
        if (id !== generation.current) return;
        setResult(response.data.data as SearchResult);
        setStatus("ok");
      } catch (cause: any) {
        if (id !== generation.current) return;
        setErrorText(
          cause?.response?.status === 429
            ? "You're searching quickly. Try again in a minute."
            : "Search couldn't load. Check your connection and try again.",
        );
        setStatus("error");
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // demoFollows is applied in place by setFollow, not by searching again.
  }, [active, trimmed, demo, retry]);

  const matchedInterests = useMemo(() => {
    const tokens = searchTokens(trimmed);
    if (trimmed.length < SEARCH_MIN_QUERY) return [];
    return interestChoices.filter((item) => matchesName(item.label, tokens)).slice(0, 6);
  }, [trimmed]);

  // --- Social layer -------------------------------------------------------
  const [social, setSocial] = useState<SearchPerson | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [dating, setDating] = useState<ExploreProfile | null>(null);
  const datingId = useRef<string | null>(null);
  datingId.current = dating?.id ?? null;
  // The sheet keeps who it is for itself, inside the open profile's window:
  // opening it must not re-render this screen and the profile (RoseSheetHost).
  const roseHost = useRef<RoseSheetHostHandle<ExploreProfile>>(null);
  const [roseConfirmation, setRoseConfirmation] = useState<RoseConfirmation | null>(null);
  const matchedRose = useRef<{card: ExploreProfile; matchId?: string} | null>(null);
  const roseSending = useRef(false);
  const rosePreview = useRef<string | null>(null);
  const { balance: roseBalance, send: sendRose } = useRoses();

  const openPerson = (person: SearchPerson) => {
    Keyboard.dismiss();
    setNotice(null);
    setSocial(person);
    saveRecent((list) => withRecent(list, { kind: "person", person: { ...person, mutualFollows: undefined } }));
  };

  /** One follow state, everywhere this person is on screen. */
  const setFollow = (id: string, followStatus: FollowStatus) => {
    const apply = <T extends { id: string; followStatus: FollowStatus }>(item: T): T =>
      item.id === id ? { ...item, followStatus } : item;
    setResult((current) => (current ? { ...current, people: current.people.map(apply) } : current));
    setSocial((current) => (current ? apply(current) : current));
    setDating((current) => (current ? apply(current) : current));
    saveRecent((list) =>
      list.map((entry) => (entry.kind === "person" ? { ...entry, person: apply(entry.person) } : entry)),
    );
    if (demo) setDemoFollows((current) => ({ ...current, [id]: followStatus }));
  };

  const confirm = (title: string, message: string, action: string, destructive = false) =>
    new Promise<boolean>((resolve) =>
      Alert.alert(
        title,
        message,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: action, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      ),
    );

  const follow = async (person: { id: string; name: string; followStatus: FollowStatus }) => {
    if (person.followStatus) {
      const pending = person.followStatus === "pending";
      const ok = await confirm(
        pending ? "Cancel follow request?" : `Unfollow ${person.name}?`,
        pending ? `${person.name} won't see your request any more.` : "You can follow them again later.",
        pending ? "Cancel request" : "Unfollow",
        true,
      );
      if (!ok) return;
      try {
        if (!demo) await api.delete(`/stories/follows/${person.id}`);
        setFollow(person.id, null);
      } catch {
        Alert.alert("Couldn't update", "Check your connection and try again.");
      }
      return;
    }
    const ok = await confirm(
      "Send follow request?",
      `${person.name} will immediately see your profile and that you requested to follow them. Dating Likes stay private unless you both Like each other.`,
      "Send request",
    );
    if (!ok) return;
    try {
      let next: FollowStatus = "pending";
      if (!demo) {
        const response = await api.post("/stories/follows", { userId: person.id, disclosureAccepted: true });
        next = response.data?.data?.status === "accepted" ? "accepted" : "pending";
      }
      setFollow(person.id, next);
    } catch (cause: any) {
      // Never why: "can't follow" must not become a way to read someone's settings.
      Alert.alert(
        "Follow request not sent",
        cause?.response?.data?.code === "FOLLOW_COOLDOWN"
          ? "Wait before you send another follow request to this person."
          : "You can't follow this person right now.",
      );
    }
  };

  /** The dating layer: the card when a deck Like would be allowed, else one message (5.2). */
  const openDating = async (person: SearchPerson) => {
    if (opening) return;
    setNotice(null);
    if (demo) {
      if (person.dating) return;
      const card = demoDatingProfile(person.id, demoLiked.current);
      if (card) {
        setOpening(true);
        setDating({ ...card, followStatus: person.followStatus });
      }
      else setNotice(DATING_UNAVAILABLE);
      return;
    }
    setOpening(true);
    let profileLoaded = false;
    try {
      const response = await api.get(`/search/people/${person.id}/dating`);
      const data = response.data.data as { state: MyDatingState | { kind: "available" }; card: ExploreProfile | null };
      if (data.card) {
        profileLoaded = true;
        setDating(data.card);
        if (person.dating) patchPerson(person.id, { dating: null });
      } else if (data.state.kind !== "available") {
        // Decided since this result loaded (in the deck, or on another phone): say so.
        patchPerson(person.id, { dating: data.state });
      }
    } catch (cause: any) {
      const status = cause?.response?.status;
      setNotice(
        status === 403
          ? DATING_UNAVAILABLE
          : status === 429
            ? "Too many profiles opened. Try again in a minute."
            : "The profile couldn't load. Check your connection and try again.",
      );
    } finally {
      if (!profileLoaded) setOpening(false);
    }
  };

  const afterLike = (card: ExploreProfile, matched: boolean, kind: "liked" | "rose" = "liked", matchId?: string) => {
    const at = new Date().toISOString();
    const state: MyDatingState = matched && matchId ? { kind: "matched", matchId, at } : { kind, at };
    demoLiked.current.set(card.id, state);
    roseHost.current?.close();
    Keyboard.dismiss();
    if (kind === "rose") {
      // A late success still updates the result, but cannot animate over a different profile.
      if (datingId.current === card.id) {
        matchedRose.current = matched ? {card, matchId} : null;
        setRoseConfirmation({ name: card.name, matched });
      }
    } else setDating(null);
    // Shown at once on the sheet and in every list; the server's own answer follows.
    patchPerson(card.id, { dating: state });
    if (!demo) void refreshPerson(card.id);
    if (matched && kind !== "rose") navigation.navigate('MatchCelebration', {name: card.name, userId: card.id, photo: card.primaryPhoto ?? card.photos[0], matchId, demo});
    else setNotice(null);
  };

  const like = async (card: ExploreProfile) => {
    if (demo) return afterLike(card, false);
    try {
      await api.post("/discover/visible", { impressionId: card.impressionId }).catch(() => undefined);
      const response = await api.post("/discover/swipe", { targetId: card.id, action: "like" });
      afterLike(card, !!response.data.data?.matchCreated, "liked", response.data.data?.matchId);
    } catch {
      setDating(null);
      setNotice(DATING_UNAVAILABLE);
      void refreshPerson(card.id);
    }
  };

  const rose = async (card: ExploreProfile, comment: string | null) => {
    if (roseSending.current || roseConfirmation) return;
    roseSending.current = true;
    try {
      if (demo) {
        setDemoRoses((count) => Math.max(0, count - 1));
        return afterLike(card, false, "rose");
      }
      await api.post("/discover/visible", { impressionId: card.impressionId }).catch(() => undefined);
      const sent = await sendRose(card.id, comment);
      if (sent) afterLike(card, !!sent.matchCreated, "rose", sent.matchId);
      else void refreshPerson(card.id);
    } finally {
      roseSending.current = false;
    }
  };

  const previewRoseAnimation = () => {
    if (!demo) return;
    const person = searchDemo("aanya", demoFollows, demoLiked.current).people.find(item => item.id === "demo-aanya");
    const card = demoDatingProfile("demo-aanya", new Map());
    if (!person || !card) return;
    setQuery("aanya");
    openPerson(person);
    setRoseConfirmation(null);
    rosePreview.current = card.id;
    setOpening(true);
    setDating(card);
  };

  /** Blocked from the social or dating layer: gone from every list here. */
  const removePerson = (id: string) => {
    setResult((current) => (current ? { ...current, people: current.people.filter((item) => item.id !== id) } : current));
    saveRecent((list) => list.filter((entry) => entry.kind !== "person" || entry.person.id !== id));
    setDating(null);
    setSocial(null);
  };

  // --- Live profile (SEARCH_SPEC.md 5.1) --------------------------------
  // While someone's social layer is open, it follows them: a new photo, a
  // Story posted or removed, a ring that runs out. The server only nudges;
  // the app re-reads the person through the same rules that found them.
  const [viewingStory, setViewingStory] = useState(false);
  const socialId = social?.id ?? null;

  /** New facts about one person, everywhere they are on screen. */
  const patchPerson = useCallback(
    (id: string, patch: Partial<SearchPerson>) => {
      const apply = (item: SearchPerson) => (item.id === id ? { ...item, ...patch } : item);
      setResult((current) => (current ? { ...current, people: current.people.map(apply) } : current));
      setSocial((current) => (current?.id === id ? { ...current, ...patch } : current));
      saveRecent((list) =>
        list.map((entry) => (entry.kind === "person" && entry.person.id === id ? { ...entry, person: apply(entry.person) } : entry)),
      );
    },
    [saveRecent],
  );

  const refreshPerson = async (id: string) => {
    if (id.startsWith("demo-")) return;
    try {
      const response = await api.get(`/search/people/${id}`);
      patchPerson(id, response.data.data as SearchPerson);
    } catch (cause: any) {
      // No longer findable (blocked, discoverability off, account closed):
      // gone, with no word on which.
      if (cause?.response?.status === 404) removePerson(id);
    }
  };
  const socket = useSocket();
  const refreshRef = useRef(refreshPerson);
  refreshRef.current = refreshPerson;

  useEffect(() => {
    if (!socialId || demo) return;
    // Watching again after a reconnect, and re-reading what changed meanwhile.
    let connectedOnce = !!socket?.connected;
    const watch = () => {
      socket?.emit("watch_profile", socialId);
      if (connectedOnce) void refreshRef.current(socialId);
      connectedOnce = true;
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const nudge = (data: { userId?: string; ownerId?: string }) => {
      if (data?.userId !== socialId && data?.ownerId !== socialId) return;
      if (timer) clearTimeout(timer);
      // A multi-photo Story or a burst of edits is one re-read.
      timer = setTimeout(() => void refreshRef.current(socialId), 400);
    };
    socket?.emit("watch_profile", socialId);
    socket?.on("connect", watch);
    socket?.on("profile_changed", nudge);
    socket?.on("story_published", nudge);
    socket?.on("story_removed", nudge);
    // Added to or taken off their Close Friends, hidden from or shown their
    // Stories, a follow accepted or removed: the ring and button re-read.
    socket?.on("relationship_changed", nudge);
    // A row can be minutes old (a recent search): open with the current profile.
    void refreshRef.current(socialId);
    return () => {
      if (timer) clearTimeout(timer);
      socket?.off("connect", watch);
      socket?.off("profile_changed", nudge);
      socket?.off("story_published", nudge);
      socket?.off("story_removed", nudge);
      socket?.off("relationship_changed", nudge);
      socket?.emit("watch_profile", null);
    };
  }, [socialId, demo, socket]);

  // A ring lasts as long as their newest Story; it goes when that ends.
  const ringUntil = social?.story?.until ?? null;
  useEffect(() => {
    if (!socialId || !ringUntil) return;
    const wait = Math.max(0, Date.parse(ringUntil) - Date.now()) + 500;
    const timer = setTimeout(() => {
      if (demo) patchPerson(socialId, { story: null });
      else void refreshRef.current(socialId);
    }, Math.min(wait, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [socialId, ringUntil, demo, patchPerson]);

  // Demo: Subhankar posts a Story a few seconds after the profile opens, then
  // changes their photo - what a real profile does live, without a second phone.
  useEffect(() => {
    if (!demo || socialId !== DEMO_LIVE.id) return;
    const posted = setTimeout(() => {
      patchPerson(DEMO_LIVE.id, { story: DEMO_LIVE.ring() });
      setNotice("Subhankar just posted a story. Tap the ring to watch it.");
    }, 4000);
    const photo = setTimeout(() => {
      if (!DEMO_LIVE.newPhoto) return;
      patchPerson(DEMO_LIVE.id, { avatarUrl: DEMO_LIVE.newPhoto });
      setNotice("Subhankar just changed their profile photo.");
    }, 9000);
    return () => {
      clearTimeout(posted);
      clearTimeout(photo);
    };
  }, [demo, socialId, patchPerson]);

  // Demo: Maya posts a Close Friends Story while her profile is open, and
  // you are on the list - the ring turns green where it stands.
  useEffect(() => {
    if (!demo || socialId !== DEMO_LIVE.closeFriendsId) return;
    const posted = setTimeout(() => {
      patchPerson(DEMO_LIVE.closeFriendsId, { story: DEMO_LIVE.closeFriendsRing() });
      setNotice("Maya just posted a Close Friends story. Tap the green ring to watch it.");
    }, 4000);
    return () => clearTimeout(posted);
  }, [demo, socialId, patchPerson]);

  /** Their Story over everything; the sheet waits underneath and re-reads after. */
  const openStory = async (person: SearchPerson) => {
    if (!person.story) return;
    if (demo) {
      Alert.alert("Demo", `In the app, this plays ${person.name.split(" ")[0]}'s story.`);
      patchPerson(person.id, { story: { ...person.story, unseen: false, closeFriends: false } });
      return;
    }
    try {
      const response = await api.get(`/stories/owners/${person.id}`);
      setViewingStory(true);
      navigation.navigate("StoryViewer", { groups: [response.data.data.group], startGroupIndex: 0 });
    } catch {
      // Ended or taken down a moment ago: the ring goes.
      void refreshRef.current(person.id);
    }
  };
  useEffect(() => {
    if (!viewingStory) return;
    return navigation.addListener("focus", () => {
      setViewingStory(false);
      // Watched now: the ring turns grey.
      if (socialId) void refreshRef.current(socialId);
    });
  }, [viewingStory, navigation, socialId]);

  const moreFor = (person: SearchPerson) =>
    Alert.alert(person.name, undefined, [
      {
        text: "Report profile",
        onPress: () =>
          void openReport({
            userId: person.id, name: person.name, sourceType: "profile", sourceId: person.id,
            ...(demo ? { send: () => undefined, block: () => undefined } : {}),
          }).then((result) => { if (result.blocked) removePerson(person.id); }),
      },
      {
        text: "Block profile",
        style: "destructive",
        onPress: async () => {
          const ok = await confirm(`Block ${person.name}?`, "You will no longer be able to contact each other.", "Block", true);
          if (!ok) return;
          try {
            if (!demo) await api.post("/block", { blockedId: person.id });
            removePerson(person.id);
          } catch {
            Alert.alert("Couldn't block", "Check your connection and try again.");
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);

  const openInterest = (id: string) => {
    // Explore filtered to that interest, under its own cohort floor.
    navigation.setParams({ interest: id });
    closePanel();
  };

  const submit = () => {
    if (trimmed.length >= SEARCH_MIN_QUERY) saveRecent((list) => withRecent(list, { kind: "query", text: trimmed }));
  };

  // Keep the measured page ready, but clear the previous search session on close.
  useEffect(() => {
    if (active) return;
    setQuery("");
    setDemo(false);
    setDemoFollows({});
    setDemoRoses(3);
    demoLiked.current.clear();
    setShowAllRecent(false);
    setSocial(null);
    setNotice(null);
    setOpening(false);
    setDating(null);
    roseHost.current?.close();
    setRoseConfirmation(null);
    rosePreview.current = null;
    setViewingStory(false);
  }, [active]);

  // --- Rendering ----------------------------------------------------------
  const showZero = trimmed.length < SEARCH_MIN_QUERY;
  const people = result?.people ?? [];

  const personRow = (person: SearchPerson, onRemove?: () => void) => (
    <Pressable
      key={person.id}
      onPress={() => openPerson(person)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${person.name}${person.blueBadge ? ", verified" : ""}${person.dating ? `, ${DECISION_APPEARANCE[person.dating.kind].label}` : ""}${person.followsYou ? ", follows you" : ""}${!onRemove && person.mutualFollows ? `, you both follow ${person.mutualFollows} ${person.mutualFollows === 1 ? "person" : "people"}` : ""}`}
    >
      <PersonAvatar person={person} size={48} background="#100F0D" />
      <View style={styles.rowBody}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {person.name}
          </Text>
          {person.blueBadge ? <VerifiedBadge /> : !person.isVerified ? <Text style={styles.notVerified}>Not verified</Text> : null}
        </View>
        {!!personMeta(person) && (
          <Text style={styles.meta} numberOfLines={1}>
            {personMeta(person)}
          </Text>
        )}
        {(person.dating || person.followsYou) && (
          <View style={styles.resultTags}>
            {person.dating && <DecisionMark state={person.dating} />}
            {person.followsYou && <Text style={styles.resultFollows}>Follows you</Text>}
          </View>
        )}
        {/* Fresh from this search only - a saved recent would show a stale number. */}
        {!onRemove && !!person.mutualFollows && (
          <Text style={styles.resultMutual} numberOfLines={1}>
            You both follow {person.mutualFollows} {person.mutualFollows === 1 ? "person" : "people"}
          </Text>
        )}
      </View>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={10} accessibilityLabel={`Remove ${person.name} from recent searches`}>
          <Ionicons name="close" size={18} color={colors.text.secondary} />
        </Pressable>
      ) : (
        <FollowButton
          status={person.followStatus}
          followsYou={!!person.followsYou}
          onPress={() => void follow(person)}
          compact
        />
      )}
    </Pressable>
  );

  const zeroState = (
    <View>
      {recent.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent</Text>
            <Pressable onPress={() => saveRecent(() => [])} hitSlop={8} accessibilityLabel="Clear recent searches">
              <Text style={styles.clearAll}>Clear all</Text>
            </Pressable>
          </View>
          {(showAllRecent ? recent : recent.slice(0, 4)).map((entry) =>
            entry.kind === "person" ? (
              personRow(entry.person, () => saveRecent((list) => withoutRecent(list, entry)))
            ) : (
              <Pressable
                key={`q:${entry.text}`}
                onPress={() => setQuery(entry.text)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.queryIcon}>
                  <Ionicons name="time-outline" size={20} color={colors.text.secondary} />
                </View>
                <Text style={[styles.name, styles.rowBody]} numberOfLines={1}>
                  {entry.text}
                </Text>
                <Pressable
                  onPress={() => saveRecent((list) => withoutRecent(list, entry))}
                  hitSlop={10}
                  accessibilityLabel={`Remove ${entry.text} from recent searches`}
                >
                  <Ionicons name="close" size={18} color={colors.text.secondary} />
                </Pressable>
              </Pressable>
            ),
          )}
        </>
      )}
      {recent.length > 4 && <Pressable onPress={() => setShowAllRecent(value => !value)} style={styles.showRecent} accessibilityRole="button">
        <Text style={styles.clearAll}>{showAllRecent ? "Show fewer" : "See all recent searches"}</Text>
        <Ionicons name={showAllRecent ? "chevron-up" : "chevron-down"} size={16} color="#B5B5BD" />
      </Pressable>}
      {/* Search is for one person, by name. Browsing by interest is Browse's
          job, so there are no interest chips here - only a prompt, until
          there is something recent to show instead. */}
      {recent.length === 0 && (
        <View style={styles.prompt}>
          <View style={styles.promptIcon}>
            <Ionicons name="search" size={26} color={colors.primaryLight} />
          </View>
          <Text style={styles.promptTitle}>Find someone at your college</Text>
          <Text style={styles.promptText}>Type a name. Try a first name or a surname.</Text>
        </View>
      )}
      <Text style={[styles.privacyNote, recent.length === 0 && styles.privacyNoteCentered]}>
        Search finds people at your college by name. Your searches stay on this phone.
      </Text>
    </View>
  );

  // A matching interest comes first, as chips, so it is seen without scrolling.
  const interestChips = matchedInterests.length > 0 ? (
    <View style={styles.interestBlock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.interestChips}>
        {matchedInterests.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => openInterest(item.id)}
            style={({ pressed }) => [styles.interestChip, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Explore people into ${item.label}`}
          >
            <Ionicons name="sparkles-outline" size={15} color={colors.primaryLight} />
            <Text style={styles.interestChipText}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.interestHint}>Tap an interest to explore people into it.</Text>
    </View>
  ) : null;

  // While the first results load: rows in their place, not a blank page.
  const placeholderRows = (
    <View accessible accessibilityLabel="Searching">
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={styles.row}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.rowBody}>
            <View style={[styles.skeletonLine, { width: 140 - index * 12 }]} />
            <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
          </View>
        </View>
      ))}
    </View>
  );

  const resultsFooter = (
    <View>
      {status === "ok" && result?.truncated && (
        <Text style={styles.footerText}>Showing the first 30. Keep typing to narrow it down.</Text>
      )}
    </View>
  );

  return (
    <View
      pointerEvents={active ? "auto" : "none"}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      style={[styles.panel, { paddingTop: insets.top + 6 }]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.panelBackground, backgroundMotion]} />
      <View style={styles.header}>
        <Animated.View style={controlsMotion}>
          <Pressable onPress={closePanel} disabled={!ready} hitSlop={10} accessibilityLabel="Close search" style={styles.back}>
            <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
          </Pressable>
        </Animated.View>
        <View
          ref={field}
          pointerEvents={ready ? "auto" : "none"}
          onLayout={() => requestAnimationFrame(() => field.current?.measureInWindow((x, y, width, height) => onFieldLayout({ x, y, width, height })))}
          style={[styles.field, !ready && styles.hidden]}
        >
          <Ionicons name="search" size={18} color={colors.text.secondary} />
          <TextInput
            ref={input}
            editable={ready}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submit}
            placeholder="Search by name"
            placeholderTextColor={colors.text.secondary}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="words"
            maxLength={60}
            selectionColor="#FFFFFF"
            style={styles.input}
            accessibilityLabel="Search by name"
          />
          {status === "loading" && <ActivityIndicator size="small" color={colors.text.secondary} />}
          {query.length > 0 && (
            <Pressable
              onPress={() => {
                setQuery("");
                input.current?.focus();
              }}
              hitSlop={10}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={colors.text.secondary} />
            </Pressable>
          )}
        </View>
        {__DEV__ && (
          <Animated.View style={controlsMotion}>
          <Pressable
            disabled={!ready}
            onPress={() => {
              // Do not show live results under demo controls, or demo results under live controls.
              generation.current += 1;
              setResult(null);
              setStatus("idle");
              setRecent([]);
              setSocial(null);
              setNotice(null);
              setDating(null);
              roseHost.current?.close();
              setRoseConfirmation(null);
              rosePreview.current = null;
              setOpening(false);
              setDemo((value) => !value);
              setDemoFollows({});
              setDemoRoses(3);
              demoLiked.current.clear();
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: demo }}
            accessibilityLabel={demo ? "Hide demo" : "Show demo"}
            style={[styles.demoToggle, demo && styles.demoToggleOn]}
          >
            <Ionicons name="flask-outline" size={14} color={demo ? "#FFFFFF" : colors.primaryLight} />
            <Text style={[styles.demoText, demo && styles.demoTextOn]}>Demo</Text>
          </Pressable>
          </Animated.View>
        )}
      </View>
      <Animated.View style={[styles.results, contentMotion]} pointerEvents={ready ? "auto" : "none"}>
        {demo && (
          <View>
            <Text style={styles.demoBanner}>Demo mode · Sample profiles. No actions are sent.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.demoStates}>
              <Pressable onPress={previewRoseAnimation} accessibilityRole="button" accessibilityLabel="Preview Rose animation. No Rose is used."
                style={({ pressed }) => [styles.demoRosePreview, pressed && styles.buttonPressed]}>
                <Ionicons name="rose" size={14} color="#F3C1CA" />
                <Text style={styles.demoRosePreviewText}>Rose animation</Text>
              </Pressable>
              {[
                { query: "alex", label: "Matched" }, { query: "ishita", label: "Liked" },
                { query: "neha", label: "Rose sent" }, { query: "kabir", label: "Passed" },
                { query: "aanya", label: "New profile" }, { query: "arjun", label: "Unavailable" },
              ].map(item => (
                <Pressable key={item.query} onPress={() => setQuery(item.query)} accessibilityRole="button"
                  accessibilityLabel={`Preview ${item.label}`} accessibilityState={{ selected: trimmed === item.query }}
                  style={({ pressed }) => [styles.demoState, trimmed === item.query && styles.demoStateSelected, pressed && styles.rowPressed]}>
                  <Text style={[styles.demoStateText, trimmed === item.query && styles.demoStateTextSelected]}>{item.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
        {/* Reminder 9 (GOOGLE_SIGNUP_PLAN.md 4): before verifying, Search reaches your campus only. */}
        <UnverifiedNudge art="search" icon="search-outline" text="Verify your college to search every campus." dismissKey="search-campus" />
        <FlatList
          ref={list}
          data={showZero || status === "error" ? [] : people}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => personRow(item)}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
          ListHeaderComponent={
            showZero ? (
              zeroState
            ) : status === "error" ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{errorText}</Text>
                <Pressable onPress={() => setRetry((value) => value + 1)} style={styles.retry}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : people.length > 0 ? (
              <View>
                {interestChips}
                <Text style={[styles.sectionTitle, styles.sectionPad]}>People</Text>
              </View>
            ) : status === "ok" ? (
              // Never "hidden" or "not found": absence is ambiguous by design (10).
              <View>
                {interestChips}
                <View style={styles.empty}>
                  <View style={styles.emptyIcon}><Ionicons name="search" size={26} color={colors.text.secondary} /></View>
                  <Text style={styles.emptyTitle}>No one at your college matches that</Text>
                  <Text style={styles.emptyText}>Check the spelling, or try just their first name.</Text>
                </View>
              </View>
            ) : status === "loading" ? (
              <View>
                {interestChips}
                {placeholderRows}
              </View>
            ) : null
          }
          ListFooterComponent={showZero || status === "error" ? null : resultsFooter}
        />
      </Animated.View>

      <SocialSheet
        // Stays put under the dating profile, which slides away to reveal it
        // again; hidden only while their Story plays over everything.
        person={viewingStory ? null : social}
        notice={notice}
        opening={opening}
        onClose={() => {
          setSocial(null);
          setNotice(null);
        }}
        onFollow={(person) => void follow(person)}
        onDating={(person) => void openDating(person)}
        onMessage={(person, matchId) => {
          if (demo) return Alert.alert("Demo", `This opens your chat with ${person.name}.`);
          setSocial(null);
          navigation.navigate("ChatScreen", { matchId, userId: person.id, userName: person.name, userAvatar: person.avatarUrl });
        }}
        onMore={moreFor}
        onStory={(person) => void openStory(person)}
      />

      {dating && (
        <ProfileDetailModal
          user={dating}
          initialPhotoUri={dating.primaryPhoto ?? undefined}
          transition="sheet"
          isVisible
          onOpenComplete={() => {
            setOpening(false);
            if (rosePreview.current === dating.id) {
              rosePreview.current = null;
              setRoseConfirmation({ name: dating.name, matched: false });
            }
          }}
          onClose={() => {
            setDating(null);
            setOpening(false);
            setRoseConfirmation(null);
            rosePreview.current = null;
            const result = matchedRose.current;
            matchedRose.current = null;
            if (result) navigation.navigate('MatchCelebration', {name: result.card.name, userId: result.card.id, photo: result.card.primaryPhoto ?? result.card.photos[0], matchId: result.matchId, demo});
          }}
          onLike={() => like(dating)}
          onRose={() => roseHost.current?.open(dating)}
          roseBalance={demo ? demoRoses : (roseBalance?.roses ?? null)}
          roseConfirmation={roseConfirmation}
          // Inside this profile's window, not a second Modal over it.
          overlay={<RoseSheetHost<ExploreProfile> ref={roseHost} inline balance={demo ? demoRoses : (roseBalance?.roses ?? null)}
            onSend={(card, comment) => rose(card, comment)} />}
          onOverlayBack={() => roseHost.current?.back() ?? false}
          onFollow={!dating.followStatus && dating.canRequestFollow ? () => follow(dating) : undefined}
          onReport={demo ? async () => undefined : undefined}
          onBlock={demo ? async () => undefined : undefined}
          onBlocked={() => removePerson(dating.id)}
        />
      )}
    </View>
  );
}

/** Keep the main course readable without repeating the same icon on each line. */
function collegeSummary(person: SearchPerson) {
  const course = person.department || person.degree || null;
  const graduation = person.graduationYear ?? (person.year && person.year > 1000 ? person.year : null);
  const study = person.yearOfStudy ?? (person.year && person.year <= 10 ? person.year : null);
  const year = study ? yearLabel(study) : graduation ? `Class of ${graduation}` : null;
  const academic = [person.department ? person.degree : null, year].filter(Boolean).join(" · ");
  const campus = person.campus
    ? /\bcampus$/i.test(person.campus) ? person.campus : `${person.campus} campus`
    : null;
  const clubs = person.clubs?.length
    ? `${person.clubs.length === 1 ? "Club" : "Clubs"}: ${person.clubs.join(", ")}`
    : null;
  const community = [campus, clubs].filter(Boolean).join(" · ");
  return { course, academic, community };
}

/** 1234 -> "1.2K", as social apps show counts. */
function compactCount(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function FollowButton({
  status,
  followsYou,
  onPress,
  compact,
  secondary,
}: {
  status: FollowStatus;
  followsYou?: boolean;
  onPress: () => void;
  compact?: boolean;
  secondary?: boolean;
}) {
  const label =
    status === "accepted" ? "Following" : status === "pending" ? "Requested" : followsYou ? "Follow back" : "Follow";
  const filled = !status && !secondary;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={secondary ? 0 : 6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.follow, compact && styles.followCompact, filled ? styles.followFilled : styles.followOutline,
        secondary && styles.sheetFollow, pressed && styles.buttonPressed]}
    >
      <Text style={[styles.followText, !filled && styles.followTextOutline]}>{label}</Text>
    </Pressable>
  );
}

/** A separate result tag leaves room for the name and verification badge. */
function DecisionMark({ state }: { state: MyDatingState }) {
  const appearance = DECISION_APPEARANCE[state.kind];
  return (
    <View style={[styles.decisionMark, { backgroundColor: appearance.background }]} accessibilityLabel={appearance.label}>
      <Ionicons name={appearance.icon} size={12} color={appearance.color} />
      <Text style={[styles.decisionMarkText, { color: appearance.color }]}>{appearance.label}</Text>
    </View>
  );
}

/**
 * In place of "View dating profile" once you've decided: your own decision,
 * and nothing of theirs. A Like waits the same whether they saw it, passed or
 * haven't opened the app, so this can't tell you how they answered.
 */
function DatingDecision({ person, state }: {
  person: SearchPerson;
  state: MyDatingState;
}) {
  const appearance = DECISION_APPEARANCE[state.kind];
  const when = decisionDate(state.at);
  return (
    <View style={styles.decision} accessibilityLiveRegion="polite">
      <View style={styles.decisionHeader}>
        <View style={[styles.decisionIcon, { backgroundColor: appearance.background }]}>
          <Ionicons name={appearance.icon} size={19} color={appearance.color} />
        </View>
        <View style={styles.decisionCopy}>
          <Text style={[styles.decisionTitle, { color: appearance.color }]}>
            {state.kind === "matched" ? "You’re matched" : decisionTitle(person.name, state)}
          </Text>
          {!!when && <Text style={styles.decisionDate}>{when}</Text>}
        </View>
      </View>
      <Text style={styles.decisionDetail}>{appearance.detail}</Text>
    </View>
  );
}

/**
 * The social layer (5.1): who someone is, and Follow. Never match
 * percentage, seeking, distance, presence or *their* swipes - those are behind
 * View dating profile, on a profile the deck would already have shown. Your
 * own decision (Liked, Rose sent, Matched, Passed) replaces that button.
 */
function SocialSheet({
  person,
  notice,
  opening,
  onClose,
  onFollow,
  onDating,
  onMessage,
  onMore,
  onStory,
}: {
  person: SearchPerson | null;
  notice: string | null;
  opening: boolean;
  onClose: () => void;
  onFollow: (person: SearchPerson) => void;
  onDating: (person: SearchPerson) => void;
  onMessage: (person: SearchPerson, matchId: string) => void;
  onMore: (person: SearchPerson) => void;
  onStory: (person: SearchPerson) => void;
}) {
  const insets = useSafeAreaInsets();
  // Keeps the last person while the sheet slides away.
  const { height } = useWindowDimensions();
  const last = useRef<SearchPerson | null>(null);
  if (person) last.current = person;
  const shown = person ?? last.current;
  // The photo, full size: at 92 px a classmate is not always recognisable.
  const [photoOpen, setPhotoOpen] = useState(false);
  useEffect(() => {
    if (!person) setPhotoOpen(false);
  }, [person]);
  const summary = shown ? collegeSummary(shown) : null;
  const match = shown?.dating?.kind === "matched" ? shown.dating : null;
  return (
    <SearchProfileSheet visible={!!person} onClose={onClose} interceptBack={() => {
      if (!photoOpen) return false;
      setPhotoOpen(false);
      return true;
    }}>
      {(close, onContentLayout) => <View style={styles.sheetBackdrop}>
        {shown && (
          <ScrollView style={{ maxHeight: height - insets.top - 52 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View onLayout={onContentLayout} style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetToolbar}>
              <Text style={styles.sheetEyebrow}>COLLEGE PROFILE</Text>
              <Pressable onPress={() => onMore(shown)} style={({ pressed }) => [styles.sheetIcon, pressed && styles.sheetIconPressed]} accessibilityRole="button" accessibilityLabel="More options">
                <Ionicons name="ellipsis-horizontal" size={22} color="#FFFFFF" />
              </Pressable>
              <Pressable onPress={close} style={({ pressed }) => [styles.sheetIcon, pressed && styles.sheetIconPressed]} accessibilityRole="button" accessibilityLabel="Close profile">
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
            <View style={styles.sheetTop}>
              <Pressable
                // A ring opens their Story, as on Instagram; the photo is a long press away.
                onPress={() => (shown.story ? onStory(shown) : shown.avatarUrl && setPhotoOpen(true))}
                onLongPress={() => shown.avatarUrl && setPhotoOpen(true)}
                disabled={!shown.avatarUrl && !shown.story}
                accessibilityRole="imagebutton"
                accessibilityLabel={shown.story ? `Watch ${shown.name}'s story` : `View ${shown.name}'s photo`}
                accessibilityHint={shown.story ? "Long press to see the photo" : undefined}
              >
                <PersonAvatar person={shown} size={60} background="#100F0D" />
              </Pressable>
              <View style={styles.sheetProfileCopy}>
                <View style={styles.nameLine}>
                  <Text style={styles.sheetName} numberOfLines={3}>
                    {shown.name}
                  </Text>
                  {shown.blueBadge && <VerifiedBadge />}
                </View>
                {summary && (summary.course || summary.academic || summary.community) && (
                  <View style={styles.identity}>
                    {!!summary.course && <Text style={styles.identityPrimary} numberOfLines={2}>{summary.course}</Text>}
                    {!!summary.academic && <Text style={styles.identitySecondary} numberOfLines={2}>{summary.academic}</Text>}
                    {!!summary.community && <Text style={styles.identitySecondary} numberOfLines={3}>{summary.community}</Text>}
                  </View>
                )}
                {shown.followsYou && (
                  <Text style={styles.followsYouText}>Follows you</Text>
                )}
              </View>
            </View>
            {typeof shown.followersCount === "number" && typeof shown.followingCount === "number" && (
              <View style={styles.stats} accessibilityLabel={`${shown.followersCount} followers, ${shown.followingCount} following`}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{compactCount(shown.followersCount)}</Text>
                  <Text style={styles.statLabel}>{shown.followersCount === 1 ? "follower" : "followers"}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{compactCount(shown.followingCount)}</Text>
                  <Text style={styles.statLabel}>following</Text>
                </View>
              </View>
            )}
            {!!notice && (
              <View style={styles.notice} accessibilityLiveRegion="polite">
                <Ionicons name="information-circle-outline" size={20} color={colors.primaryLight} />
                <View style={styles.decisionCopy}>
                  {notice === DATING_UNAVAILABLE && <Text style={styles.noticeTitle}>Dating profile unavailable</Text>}
                  <Text style={styles.noticeText}>{notice}</Text>
                </View>
              </View>
            )}
            {shown.dating && <DatingDecision person={shown} state={shown.dating} />}
            <View style={styles.sheetActions}>
              <FollowButton status={shown.followStatus} followsYou={!!shown.followsYou} onPress={() => onFollow(shown)} secondary />
              {match ? (
                <Pressable onPress={() => onMessage(shown, match.matchId)}
                  accessibilityRole="button" accessibilityLabel={`Message ${shown.name}`}
                  style={({ pressed }) => [styles.sheetPrimaryAction, pressed && styles.buttonPressed]}>
                  <Ionicons name="chatbubble-outline" size={18} color="#331C23" />
                  <Text style={styles.sheetPrimaryText}>Message</Text>
                </Pressable>
              ) : !shown.dating && notice !== DATING_UNAVAILABLE ? (
              <Pressable
                onPress={() => onDating(shown)}
                disabled={opening}
                style={({ pressed }) => [styles.sheetPrimaryAction, pressed && styles.buttonPressed]}
                accessibilityRole="button"
                accessibilityLabel={opening ? "Opening dating profile" : "View dating profile"}
                accessibilityState={{ disabled: opening, busy: opening }}
              >
                {opening ? (
                  <ActivityIndicator size="small" color="#331C23" />
                ) : (
                  <Ionicons name="heart-outline" size={18} color="#331C23" />
                )}
                <Text style={styles.sheetPrimaryText}>{opening ? "Opening…" : "Dating profile"}</Text>
              </Pressable>
            ) : null}
            </View>
          </View>
          </ScrollView>
        )}
        {photoOpen && shown?.avatarUrl && (
          <Pressable
            style={styles.photoViewer}
            onPress={() => setPhotoOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
          >
            <Image source={{ uri: shown.avatarUrl }} style={styles.photoFull} resizeMode="contain" />
            <Text style={styles.photoName}>{shown.name}</Text>
          </Pressable>
        )}
      </View>}
    </SearchProfileSheet>
  );
}

const styles = StyleSheet.create({
  notVerified: { color: '#8E8D93', fontSize: 11, marginLeft: 4 },
  decision: { marginTop: 16, padding: 12, borderRadius: 16, backgroundColor: "#211E21" },
  decisionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  decisionIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  decisionCopy: { flex: 1, minWidth: 0 },
  decisionDate: { color: "#BDB6BD", fontSize: 12, lineHeight: 17, marginTop: 1 },
  decisionTitle: { color: "#FFF4F6", fontSize: 15, lineHeight: 20, fontWeight: "700" },
  decisionDetail: { color: "#C6BDC4", fontSize: 13, lineHeight: 19, marginTop: 8 },
  sheetActions: { flexDirection: "row", alignItems: "stretch", gap: 8, marginTop: 16 },
  sheetFollow: { flex: 1, height: undefined, minHeight: 44, marginTop: 0, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 22,
    backgroundColor: "#211E21", borderWidth: 1, borderColor: "#4B3A43" },
  sheetPrimaryAction: { flex: 1.6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 22, backgroundColor: "#F3C1CA" },
  sheetPrimaryText: { flexShrink: 1, color: "#331C23", fontSize: 14, lineHeight: 20, fontWeight: "700", textAlign: "center" },
  buttonPressed: { opacity: 0.75 },
  decisionMark: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  decisionMarkText: { fontSize: 11, fontWeight: "700" },
  resultTags: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 },
  resultFollows: { color: "#C7C3CB", fontSize: 11, lineHeight: 18 },
  demoStates: { paddingHorizontal: 20, paddingBottom: 8, gap: 8 },
  demoRosePreview: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: "#35262D" },
  demoRosePreviewText: { color: "#F3C1CA", fontSize: 12, fontWeight: "700" },
  demoState: { minHeight: 36, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: "#242126" },
  demoStateSelected: { backgroundColor: "#F3C1CA" },
  demoStateText: { color: "#D4CAD2", fontSize: 12, fontWeight: "600" },
  demoStateTextSelected: { color: "#331C23" },
  interestHeading: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10, gap: 4 },
  interestSubtitle: { color: "#AAAAB3", fontSize: 14 },
  showRecent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 },
  sheetToolbar: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  sheetEyebrow: { flex: 1, color: "#F3C1CA", fontSize: 11, fontWeight: "700", letterSpacing: 1.3 },
  sheetIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#292729", alignItems: "center", justifyContent: "center" },
  sheetIconPressed: { backgroundColor: "#3B383B" },
  fill: { flex: 1, backgroundColor: "#100F0D" },
  hidden: { opacity: 0 },
  movingField: {
    position: "absolute",
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#232323",
  },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#232323",
  },
  panel: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  panelBackground: { backgroundColor: "#100F0D" },
  results: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, marginBottom: 4, flexShrink: 0 },
  back: { width: 34, height: 44, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  field: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#232323",
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 24,
    color: "#FFFFFF",
    fontSize: 16,
    includeFontPadding: false,
    textAlignVertical: "center",
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  demoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 32,
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  demoToggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  demoText: { color: colors.primaryLight, fontSize: 12, fontWeight: "700" },
  demoTextOn: { color: "#FFFFFF" },
  demoBanner: { color: "#A6A6AF", fontSize: 12, paddingHorizontal: 20, marginTop: 4, marginBottom: 6 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  sectionTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  sectionPad: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6 },
  clearAll: { color: colors.primaryLight, fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 9, minHeight: 68 },
  rowPressed: { backgroundColor: "rgba(255,255,255,0.05)" },
  rowBody: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  name: { color: "#FFFFFF", fontSize: 15, fontWeight: "600", flexShrink: 1 },
  meta: { color: "#AAAAB3", fontSize: 13, marginTop: 2 },
  avatar: { backgroundColor: "#27272D" },
  initials: { alignItems: "center", justifyContent: "center", backgroundColor: "#3A2A2C" },
  initialsText: { color: "#FFFFFF", fontWeight: "700" },
  queryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E1C1A",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, paddingTop: 4 },
  chip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24, backgroundColor: "#242426" },
  chipText: { color: "#F2F2F5", fontSize: 14, fontWeight: "500" },
  privacyNote: { color: "#89858B", fontSize: 12, lineHeight: 17, textAlign: "center", paddingHorizontal: 32, paddingTop: 24 },
  interestBlock: { paddingTop: 12 },
  resultMutual: { color: "#A9A5A2", fontSize: 12, marginTop: 3 },
  interestChips: { paddingHorizontal: 20, gap: 8 },
  interestChip: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: "#232323" },
  interestChipText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  interestHint: { color: "#89858B", fontSize: 12, paddingHorizontal: 20, paddingTop: 8 },
  skeletonAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#1E1D1C" },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: "#1E1D1C" },
  skeletonLineShort: { width: 90, height: 10, marginTop: 8 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#1E1D1C", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700", textAlign: "center" },
  privacyNoteCentered: { textAlign: "center", paddingHorizontal: 40 },
  prompt: { alignItems: "center", paddingTop: 72, paddingHorizontal: 40, gap: 8 },
  promptIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
    backgroundColor: "rgba(255,126,130,0.12)",
  },
  promptTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "800", textAlign: "center" },
  promptText: { color: colors.text.secondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  empty: { alignItems: "center", paddingHorizontal: 32, paddingTop: 48, gap: 14 },
  emptyText: { color: colors.text.secondary, fontSize: 15, textAlign: "center" },
  retry: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 18, backgroundColor: "#2A2624" },
  retryText: { color: "#FFFFFF", fontWeight: "600" },
  footerText: { color: colors.text.secondary, fontSize: 13, textAlign: "center", paddingHorizontal: 20, paddingVertical: 14 },
  follow: { height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginTop: 12 },
  followCompact: { height: 44, minWidth: 90, paddingHorizontal: 12, marginTop: 0, borderRadius: 22 },
  followFilled: { backgroundColor: colors.primaryLight },
  followOutline: { backgroundColor: "#303034" },
  followText: { color: "#331C23", fontSize: 14, fontWeight: "700" },
  followTextOutline: { color: "#FFFFFF" },
  sheetBackdrop: { flex: 1 },
  sheet: {
    backgroundColor: "#100F0D",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 0,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" },
  more: { position: "absolute", right: 18, top: 16, zIndex: 1 },
  sheetTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetProfileCopy: { flex: 1, minWidth: 0, gap: 4 },
  identity: {
    gap: 2,
  },
  identityPrimary: { color: "#D6CAD1", fontSize: 13, fontWeight: "500", lineHeight: 18 },
  identitySecondary: { color: "#A6A6AF", fontSize: 13, lineHeight: 18 },
  photoViewer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.94)",
  },
  photoFull: { width: "100%", height: "70%" },
  photoName: { color: "#FFFFFF", fontSize: 17, fontWeight: "700", marginTop: 16 },
  followsYouText: { color: "#F3C1CA", fontSize: 12, fontWeight: "600", lineHeight: 17 },
  stats: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 16 },
  stat: { flexDirection: "row", alignItems: "center", gap: 5 },
  statValue: { color: "#FFF4F6", fontSize: 14, fontWeight: "700" },
  statLabel: { color: colors.text.secondary, fontSize: 12 },
  statDivider: { width: 1, height: 16, backgroundColor: "rgba(255,255,255,0.12)" },
  sheetName: { color: "#FFF4F6", fontSize: 17, lineHeight: 23, fontWeight: "700", flexShrink: 1 },
  sheetMeta: { color: colors.text.secondary, fontSize: 14 },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "#211E21",
  },
  noticeTitle: { color: "#FFF4F6", fontSize: 14, lineHeight: 20, fontWeight: "700", marginBottom: 4 },
  noticeText: { color: "#C6BDC4", fontSize: 13, lineHeight: 19 },
});
