import { UnverifiedNudge } from '../../features/verification/VerifyNudge';
import { useHiddenWords } from "../../features/safety/hiddenWords";
import { containsHidden } from "../../features/safety/hurtfulLanguage";
import { openReport } from "../../features/safety/ReportSheet";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useIsFocused, useNavigation } from "@react-navigation/native";
import { useSocketEvent } from "../../services/useSocketEvent";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../services/api";
import { colors } from "../../core/theme/colors";
import {
  ExploreProfile,
  CardOrigin,
} from "../../features/discovery/components/ExploreProfileCard";
import { ConnectionProfileCard } from "../../features/discovery/components/ConnectionProfileCard";
import { LikesSortSheet, type LikesSort } from "../../features/discovery/components/LikesSortSheet";
import { ProfileDetailModal } from "../../features/discovery/components/profile-detail/ProfileDetailModal";
import { demoArrival, demoByType, demoLikes } from "../../features/discovery/demo/likesDemo";

type Like = ExploreProfile & {
  likedAt: string;
  isRose: boolean;
  roseId: string | null;
  roseComment: string | null;
  /** Arrived since you last opened Likes You. */
  isNew?: boolean;
};
/** Your own totals, shown only to you: never on anyone's profile. */
type Counts = { total: number; roses: number; likes: number; unseen: number; rosesReceived?: number };
type Sort = LikesSort;
/** An answer on its way, or one that failed and can be retried from the card. */
type Pending = { action: "like" | "pass"; failed: boolean };

/**
 * Likes You (STANDOUTS_LIKES_SPEC.md section 4): everyone waiting on your
 * answer, Roses first. Every card here can be answered - the server lists by
 * the same rule it accepts a Like back under - so Like back always matches.
 *
 * Every other app charges for this screen; it is free here, which is also
 * what makes a Rose worth sending.
 */
/**
 * `embedded`: shown as the "Likes you" tab of Matches, which owns the title
 * and the top of the screen - so no back button and no title here.
 * `onChanged`: lets that tab's count follow what happens on this list.
 */
export const LikesYouScreen = ({ embedded = false, onChanged }: { embedded?: boolean; onChanged?: () => void } = {}) => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [demo, setDemo] = useState(false);
  const [sort, setSort] = useState<Sort>("recent");
  const [sortOpen, setSortOpen] = useState(false);
  const [roses, setRoses] = useState<Like[]>([]);
  const [likes, setLikes] = useState<Like[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Like | null>(null);
  const [origin, setOrigin] = useState<CardOrigin>();
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [serverCounts, setServerCounts] = useState<Counts | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const answering = useRef(new Set<string>());
  // Live (see the socket effect below): who was on screen before a live
  // re-read, so what arrived can be announced; and how far down you are, so
  // a re-read never moves the list under your thumb.
  const beforeLive = useRef<Set<string> | null>(null);
  const scrollY = useRef(0);
  const list = useRef<FlatList<Like[]>>(null);
  const [newWaiting, setNewWaiting] = useState(false);
  const [arrived, setArrived] = useState<string | null>(null);
  const isFocused = useIsFocused();

  const load = useCallback(
    async (reset: boolean, nextSort: Sort = sort, useDemo: boolean = demo, silent = false) => {
      if (busy.current && !reset) return;
      const id = reset ? ++generation.current : generation.current;
      busy.current = true;
      // A live re-read happens quietly: no spinner for something you did not ask for.
      if (!silent) setLoading(true);
      setError(false);
      try {
        if (useDemo) {
          const data = demoLikes();
          setRoses(data.roses);
          setLikes(nextSort === "type" ? demoByType(data.likes) : data.likes);
          setCursor(null);
          return;
        }
        const response = await api.get("/discover/likes-you", {
          params: { limit: 20, sort: nextSort, cursor: reset ? undefined : (cursor ?? undefined) },
        });
        if (id !== generation.current) return;
        const data = response.data.data ?? { roses: [], likes: [], nextCursor: null };
        if (reset) setRoses(data.roses ?? []);
        if (data.counts) setServerCounts(data.counts);
        setLikes((current) => {
          if (reset) return data.likes ?? [];
          const known = new Set(current.map((item) => item.id));
          return [...current, ...(data.likes ?? []).filter((item: Like) => !known.has(item.id))];
        });
        setCursor(data.nextCursor ?? null);
        // Opening the screen is seeing what is on it (4.4).
        if (reset) {
          api.post("/discover/likes-you/seen").then(() => onChanged?.()).catch(() => undefined);
        }
      } catch {
        if (id === generation.current && reset) setError(true);
      } finally {
        if (id === generation.current) {
          busy.current = false;
          setLoading(false);
          setLoaded(true);
        }
      }
    },
    [cursor, sort, demo],
  );

  // Re-read on focus (an answer given elsewhere should not leave a stale
  // card), and whenever the sort or the demo changes - the one place a first
  // page is loaded, so nothing loads twice.
  useFocusEffect(
    useCallback(() => {
      void load(true);
      // `load` changes with the cursor, which would re-fire this on every page.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [demo, sort]),
  );

  // --- Live (STANDOUTS_LIKES_SPEC.md 4.4) ---------------------------------
  // The server says "your Likes changed" when a Like lands (once its sender
  // can no longer Rewind it), when you answer one on another device, or when
  // a block takes one away. The list is re-read through the same rules.
  const liveReload = useCallback(() => {
    beforeLive.current = new Set([...roses, ...likes].map((item) => item.id));
    void load(true, sort, demo, true);
  }, [roses, likes, load, sort, demo]);
  const liveRef = useRef(liveReload);
  liveRef.current = liveReload;
  const nearTop = () => scrollY.current < 120;

  const likesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSocketEvent("likes_changed", () => {
    if (likesTimer.current) clearTimeout(likesTimer.current);
    likesTimer.current = setTimeout(() => {
      // Away from this screen: it re-reads on focus anyway.
      if (!isFocused) return;
      if (nearTop()) liveRef.current();
      else setNewWaiting(true);
    }, 300);
  }, { enabled: !demo, onReconnect: true });
  useEffect(() => () => { if (likesTimer.current) clearTimeout(likesTimer.current); }, []);

  // What a live re-read brought: "1 new Like", or a Rose, for a moment.
  useEffect(() => {
    const before = beforeLive.current;
    if (!before) return;
    beforeLive.current = null;
    const fresh = [...roses, ...likes].filter((item) => !before.has(item.id));
    if (!fresh.length) return;
    setArrived(
      fresh.some((item) => item.isRose)
        ? fresh.length === 1 ? "New Rose" : `${fresh.length} new, with a Rose`
        : fresh.length === 1 ? "1 new Like" : `${fresh.length} new Likes`,
    );
    const timer = setTimeout(() => setArrived(null), 3200);
    return () => clearTimeout(timer);
  }, [roses, likes]);

  // Demo: a Like arrives by itself a few seconds in, as a real one would.
  useEffect(() => {
    if (!demo || !loaded) return;
    const timer = setTimeout(() => {
      const incoming = demoArrival();
      if (!incoming) return;
      beforeLive.current = new Set([...roses, ...likes].map((item) => item.id));
      if (!nearTop()) setNewWaiting(true);
      setLikes((current) =>
        current.some((item) => item.id === incoming.id)
          ? current
          : sort === "type" ? demoByType([incoming, ...current]) : [incoming, ...current],
      );
    }, 5000);
    return () => clearTimeout(timer);
    // Once per demo session, not on every change of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, loaded]);

  const showNew = () => {
    setNewWaiting(false);
    list.current?.scrollToOffset({ offset: 0, animated: true });
    if (!demo) liveRef.current();
  };

  const changeSort = (next: Sort) => {
    if (next === sort) return;
    setSort(next);
    setLikes([]);
    setCursor(null);
  };

  const toggleDemo = () => {
    const next = !demo;
    setDemo(next);
    setPending({});
    setRoses([]);
    setLikes([]);
    setCursor(null);
  };

  // The numbers on the sections. The demo counts what it holds; a real list
  // uses the server's totals (the list itself may be one page of many), less
  // anything answered here since.
  const answered = Object.keys(pending).length;
  const counts: Counts = demo || !serverCounts
    ? {
        total: roses.length + likes.length,
        roses: roses.length,
        likes: likes.length,
        unseen: [...roses, ...likes].filter((item) => item.isNew).length,
        // The demo pretends a few Roses were answered before, so the total
        // is more than the ones still waiting.
        rosesReceived: demo ? roses.length + 5 : roses.length,
      }
    : { ...serverCounts, total: Math.max(0, serverCounts.total - answered) };
  // Likes (not Roses) still waiting: the server's total, less those answered here.
  const likesCount = demo || !serverCounts
    ? likes.length
    : Math.max(0, serverCounts.likes - Object.keys(pending).filter((id) => likes.some((item) => item.id === id)).length);

  const remove = (id: string) => {
    setRoses((items) => items.filter((item) => item.id !== id));
    setLikes((items) => items.filter((item) => item.id !== id));
    setPending(({ [id]: _gone, ...rest }) => rest);
  };

  /** The card stays until the answer is saved; a failure leaves it with Retry, never a duplicate. */
  const answer = async (like: Like, action: "like" | "pass") => {
    if (answering.current.has(like.id)) return;
    answering.current.add(like.id);
    setSelected(null);
    setPending((current) => ({ ...current, [like.id]: { action, failed: false } }));
    try {
      let matched = false;
      if (!demo) {
        const response = await api.post("/discover/swipe", { targetId: like.id, action });
        matched = !!response.data.data?.matchCreated;
      } else {
        matched = action === "like";
      }
      remove(like.id);
      onChanged?.();
      if (matched) {
        Alert.alert("It's a match!", `You and ${like.name} liked each other.`, [
          { text: "Later", style: "cancel" },
          ...(demo
            ? []
            : [{ text: "Say hello", onPress: () => navigation.navigate("Main", { screen: "Matches" }) }]),
        ]);
      }
    } catch (cause: any) {
      // Refused (rare: an account closed or a block in the meantime) - the
      // card cannot be answered any more, so it goes.
      if (cause?.response?.status === 409 || cause?.response?.status === 404) {
        remove(like.id);
        return;
      }
      setPending((current) => ({ ...current, [like.id]: { action, failed: true } }));
    } finally {
      answering.current.delete(like.id);
    }
  };

  // Hidden Words fold a note away until tapped (features/safety).
  const hiddenWords = useHiddenWords();
  const [shownNotes, setShownNotes] = useState<Set<string>>(new Set());
  const reportNote = (like: Like) =>
    void openReport({
      userId: like.id, name: like.name, sourceType: "rose", sourceId: like.roseId ?? undefined,
      ...(demo ? { send: () => undefined, block: () => undefined } : {}),
    });

  const card = (item: Like) => {
    const state = pending[item.id];
    return (
      <View style={styles.cell} key={item.id}>
        <ConnectionProfileCard
          profile={item}
          activityPlacement="identity"
          onOpen={(profile, cardOrigin) => {
            if (state && !state.failed) return;
            setOrigin(cardOrigin);
            setSelected(profile as Like);
          }}
        />
        {item.isRose && (
          <View pointerEvents="none" style={styles.roseBadge}>
            <Ionicons name="rose" size={11} color="#F7D5DF" />
            <Text style={styles.roseBadgeText}>Rose</Text>
          </View>
        )}
        {item.isNew && (
          <View pointerEvents="none" style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        )}
        {state && (
          <View style={styles.pendingCover}>
            {state.failed ? (
              <Pressable
                onPress={() => void answer(item, state.action)}
                style={styles.retry}
                accessibilityRole="button"
                accessibilityLabel={`Couldn't save. Retry ${state.action === "like" ? "Like" : "Pass"}`}
              >
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.retryText}>Couldn't save · Retry</Text>
              </Pressable>
            ) : (
              <ActivityIndicator color="#fff" />
            )}
          </View>
        )}
        {!!item.roseComment && (
          <View style={styles.note}>
            {containsHidden(item.roseComment, hiddenWords) && !shownNotes.has(item.id)
              ? <Text style={[styles.noteText, { fontStyle: "italic", color: "#A8A2AA" }]} accessibilityRole="button"
                  onPress={() => setShownNotes((current) => new Set(current).add(item.id))}>Hidden by your Hidden Words · Tap to show</Text>
              : <Text numberOfLines={3} style={styles.noteText}>
                  “{item.roseComment}”
                </Text>}
            <Pressable
              onPress={() => reportNote(item)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Report this note"
            >
              <Ionicons name="ellipsis-horizontal" size={16} color="#AAAAB4" />
            </Pressable>
          </View>
        )}
        <View style={styles.actions}>
          <Pressable
            onPress={() => void answer(item, "pass")}
            disabled={!!state}
            accessibilityRole="button"
            accessibilityLabel={`Pass on ${item.name}`}
            style={({ pressed }) => [styles.passButton, pressed && styles.pressed, !!state && styles.disabled]}
          >
            <Ionicons name="close" size={21} color="#E5DEDA" />
          </Pressable>
          <Pressable
            onPress={() => void answer(item, "like")}
            disabled={!!state}
            accessibilityRole="button"
            accessibilityLabel={`Like ${item.name} back`}
            style={({ pressed }) => [styles.likeButton, pressed && styles.pressed, !!state && styles.disabled]}
          >
            <Ionicons name="heart" size={17} color="#28191C" />
            <Text style={styles.likeText}>Like back</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const pairs = (items: Like[]) =>
    Array.from({ length: Math.ceil(items.length / 2) }, (_, index) => items.slice(index * 2, index * 2 + 2));

  const rosesSection =
    roses.length > 0 ? (
      <View>
        <View style={styles.sectionHead}>
          <Ionicons name="rose" size={16} color="#E0457B" />
          <Text style={styles.sectionTitle}>They sent a Rose</Text>
          <View style={[styles.countPill, styles.countPillRose]}>
            <Text style={styles.countText}>{roses.length}</Text>
          </View>
        </View>
        {pairs(roses).map((pair) => (
          <View key={pair.map((item) => item.id).join(":")} style={styles.row}>
            {pair.map(card)}
            {pair.length === 1 && <View style={styles.cell} />}
          </View>
        ))}
      </View>
    ) : null;

  return (
    <View style={[styles.container, { paddingTop: embedded ? 0 : insets.top + 4 }]}>
      {!embedded && (
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.title}>Likes you</Text>
        </View>
      )}

      <View style={styles.controls}>
        <View style={styles.peopleHeading}>
          <Text style={styles.peopleTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>People who like you</Text>
          {counts.total > 0 && (
            <View style={[styles.countPill, styles.headingCount]} accessibilityLabel={`${counts.total} people like you`}>
              <Text style={styles.countText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {counts.total > 99 ? "99+" : counts.total}
              </Text>
            </View>
          )}
        </View>
        <Pressable onPress={() => setSortOpen(true)} accessibilityRole="button"
          accessibilityLabel={`Sort Likes: ${sort === "recent" ? "Recent" : "Your type"}`}
          accessibilityHint="Opens sort options" accessibilityState={{ expanded: sortOpen }}
          style={({ pressed }) => [styles.sortButton, pressed && styles.pressed]}>
          <Text style={styles.sortButtonText}>{sort === "recent" ? "Recent" : "Your type"}</Text>
          <Ionicons name="chevron-down" size={13} color="#F3C1CA" />
        </Pressable>
      </View>

      <View style={styles.summaryRow}>
        {newWaiting ? (
          <Pressable onPress={showNew} style={styles.summaryAction} accessibilityRole="button" accessibilityLabel="Show new Likes">
            <Ionicons name="arrow-up" size={14} color="#F3C1CA" />
            <Text style={styles.summaryNotice}>Show new Likes</Text>
          </Pressable>
        ) : (
          <Text style={styles.introSummary} accessibilityLiveRegion="polite">
            {arrived ? <Text style={styles.summaryNotice}>{arrived}</Text> : counts.unseen > 0
              ? <Text style={styles.summaryNotice}>{counts.unseen} new {counts.unseen === 1 ? "Like" : "Likes"}</Text>
              : counts.total > 0 ? "Like back to match." : "Likes appear here as they arrive."}
          </Text>
        )}
        {__DEV__ && (
          <Pressable onPress={toggleDemo} accessibilityRole="switch" accessibilityState={{ checked: demo }}
            accessibilityLabel={demo ? "Hide demo" : "Show demo"}
            style={[styles.demoToggle, demo && styles.demoToggleOn]}>
            <Ionicons name="flask-outline" size={12} color={demo ? "#FFFFFF" : "#F3C1CA"} />
            <Text style={[styles.demoText, demo && styles.demoTextOn]}>Demo</Text>
          </Pressable>
        )}
      </View>
      <FlatList
        ref={list}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
          if (scrollY.current < 40 && newWaiting && !demo) showNew();
        }}
        scrollEventThrottle={64}
        accessibilityLabel="People who liked you"
        data={pairs(likes)}
        keyExtractor={(pair) => pair.map((item) => item.id).join(":")}
        // Inside Matches the floating tab bar sits over the bottom of the list.
        contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + (embedded ? 120 : 28) }]}
        showsVerticalScrollIndicator={false}
        onEndReached={() => cursor && !demo && load(false)}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={loading && loaded && (likes.length > 0 || roses.length > 0)}
            onRefresh={() => load(true)}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View>
            {/* Reminder 8 (GOOGLE_SIGNUP_PLAN.md 4). */}
            <UnverifiedNudge compact art="badge" text="Verify your college to show the blue badge in Likes." dismissKey="likes-you" />
              {(counts.rosesReceived ?? 0) > 0 && (
                <View style={styles.roseTotal} accessibilityLabel={`${counts.rosesReceived} Roses received in total. Only you can see this.`}>
                  <View style={styles.roseTotalIcon}>
                    <Ionicons name="rose" size={17} color="#F3C1CA" />
                  </View>
                  <View style={styles.roseTotalBody}>
                    <Text style={styles.roseTotalNumber}>
                      {counts.rosesReceived} {counts.rosesReceived === 1 ? "Rose" : "Roses"} received
                    </Text>
                    <Text style={styles.roseTotalHint}>All time · only you can see this</Text>
                  </View>
                </View>
              )}
            {rosesSection}
            {likes.length > 0 && (
              <View style={styles.likesHead}>
                <Text style={[styles.likesTitle, styles.likesTitleInline]}>
                  {sort === "recent" ? "Recently liked you" : "Sorted for you"}
                </Text>
                <View style={styles.countPill}>
                  <Text style={styles.countText}>{likesCount}</Text>
                </View>
              </View>
            )}
          </View>
        }
        ListFooterComponent={loading ? <ActivityIndicator color={colors.primary} style={styles.footer} /> : null}
        ListEmptyComponent={
          loaded && !loading && !roses.length ? (
            <View style={styles.emptyBlock}>
              {error ? (
                <View style={styles.emptyIcon}><Ionicons name="cloud-offline-outline" size={30} color="#FFADB6" /></View>
              ) : (
                <Image
                  source={require('../../../assets/illustrations/likes-you-kitten-excited.png')}
                  style={styles.emptyKitten}
                  resizeMode="contain"
                  fadeDuration={0}
                  accessible={false}
                />
              )}
              <Text style={styles.emptyTitle}>{error ? "Unable to load your Likes" : "Your next connection starts here"}</Text>
              <Text style={styles.empty}>
                {error
                  ? "Likes couldn't load. Check your connection and try again."
                  : "No new Likes yet. Likes show up here as soon as they arrive."}
              </Text>
              {error && (
                <Pressable onPress={() => load(true)} style={styles.retryBlock}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        renderItem={({ item: pair }) => (
          <View style={styles.row}>
            {pair.map(card)}
            {pair.length === 1 && <View style={styles.cell} />}
          </View>
        )}
      />

      <LikesSortSheet visible={sortOpen} selected={sort} onSelect={changeSort} onClose={() => setSortOpen(false)} />

      {selected && (
        <ProfileDetailModal
          user={selected}
          initialPhotoUri={selected.primaryPhoto ?? undefined}
          origin={origin}
          transition="photo"
          isVisible
          onClose={() => setSelected(null)}
          // No Rose: they already liked you, so a Rose would buy a certain match (4.3).
          onLike={() => answer(selected, "like")}
          onPass={() => answer(selected, "pass")}
          onReport={demo ? async () => undefined : undefined}
          onBlock={demo ? async () => undefined : undefined}
          onBlocked={() => remove(selected.id)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  roseTotal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#242124",
  },
  roseTotalIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3B2832",
  },
  roseTotalBody: { flex: 1 },
  roseTotalNumber: { color: "#FFFFFF", fontSize: 13, fontFamily: "DMSans_700Bold" },
  roseTotalHint: { color: "#BDB3BB", fontSize: 11, marginTop: 2, fontFamily: "DMSans_400Regular" },
  newBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
    minHeight: 20,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: "#F3C1CA",
  },
  newBadgeText: { color: "#4B2633", fontSize: 9, lineHeight: 12, fontFamily: 'DMSans_700Bold', letterSpacing: 0.5 },
  countPill: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  countPillRose: { backgroundColor: "rgba(194,24,91,0.35)" },
  countText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  likesHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24, marginBottom: 10 },
  likesTitleInline: { flexShrink: 1 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 34, paddingHorizontal: 16, paddingBottom: 6, width: "100%", maxWidth: 600, alignSelf: "center" },
  summaryAction: { flex: 1, minHeight: 28, flexDirection: "row", alignItems: "center", gap: 5 },
  summaryNotice: { color: "#F3C1CA", fontSize: 12, fontFamily: "DMSans_700Bold" },
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 48 },
  back: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFFFFF", fontSize: 22, fontFamily: "DMSans_700Bold" },
  introSummary: { flex: 1, color: "#BDB3BB", fontSize: 12, lineHeight: 18, fontFamily: "DMSans_500Medium" },
  demoToggle: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28, paddingHorizontal: 9, borderRadius: 14, backgroundColor: "#232323" },
  demoToggleOn: { backgroundColor: "#4A2930" },
  demoText: { color: "#F3C1CA", fontSize: 11, fontFamily: "DMSans_700Bold" },
  demoTextOn: { color: "#FFFFFF" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 16, paddingVertical: 2, width: "100%", maxWidth: 600, alignSelf: "center" },
  peopleHeading: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  peopleTitle: { flexShrink: 1, minWidth: 0, color: "#FFFFFF", fontSize: 18, fontFamily: "DMSans_700Bold", letterSpacing: -0.3 },
  headingCount: { minWidth: 22, width: 22, height: 22, flexShrink: 0, paddingHorizontal: 0, backgroundColor: "#653746" },
  sortButton: { flexDirection: "row", gap: 6, minHeight: 36, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: "#242124" },
  sortButtonText: { color: "#F3C1CA", fontSize: 12, fontFamily: "DMSans_700Bold" },
  grid: { paddingHorizontal: 16, width: "100%", maxWidth: 600, alignSelf: "center" },
  row: { flexDirection: "row", gap: 12, marginBottom: 16, alignItems: "flex-start" },
  cell: { flex: 1, minWidth: 0, maxWidth: "50%", backgroundColor: "#232323", borderRadius: 20 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  sectionTitle: { color: "#F2CDD6", fontSize: 16, fontFamily: "DMSans_700Bold" },
  likesTitle: { color: "#FFFFFF", fontSize: 16, fontFamily: "DMSans_700Bold" },
  roseBadge: { position: "absolute", top: 10, left: 10, minHeight: 20, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: "#653344" },
  roseBadgeText: { color: "#F7D5DF", fontSize: 10, lineHeight: 14, fontFamily: "DMSans_700Bold" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 2 },
  noteText: { flex: 1, color: "#E6CFD5", fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", alignItems: "center", gap: 6, padding: 8 },
  passButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#333130" },
  likeButton: { flex: 1, minHeight: 44, paddingHorizontal: 5, paddingVertical: 8, borderRadius: 22, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: "#F3C1CA" },
  likeText: { flexShrink: 1, color: "#28191C", fontSize: 11, fontFamily: "DMSans_700Bold" },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  pendingCover: { position: "absolute", top: 0, left: 0, right: 0, aspectRatio: 0.76, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.65)", zIndex: 2 },
  retry: { alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 16, backgroundColor: "#383232", maxWidth: "90%" },
  retryText: { color: "#FFFFFF", fontSize: 12, fontFamily: "DMSans_700Bold", textAlign: "center" },
  retryBlock: { minHeight: 44, paddingHorizontal: 22, justifyContent: "center", borderRadius: 22, backgroundColor: "#4A2930", marginTop: 8 },
  footer: { marginVertical: 16 },
  emptyBlock: { alignItems: "center", gap: 12, paddingVertical: 40, paddingHorizontal: 20 },
  emptyKitten: { width: 186, height: 186, marginBottom: 4 },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#302329", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { color: "#FFFFFF", fontFamily: "DMSans_700Bold", fontSize: 20, textAlign: "center" },
  empty: { color: "#B8B0AA", fontFamily: "DMSans_400Regular", fontSize: 14, textAlign: "center", lineHeight: 21 },
});
