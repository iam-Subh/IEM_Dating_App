import { introReady, markStandoutsOpened, markWelcomeShown, useStandoutsIntro } from '../../features/discovery/standoutsIntro';
import type { RootState } from "../../store";
import { useSelector } from "react-redux";
import { useVerificationStatus } from '../../features/verification/useVerificationStatus';
import { UnverifiedNudge } from '../../features/verification/VerifyNudge';
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useIsFocused, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../services/api";
import { colors } from "../../core/theme/colors";
import {ProfileFieldIcon} from '../../components/ProfileFieldIcon';
import {ABOUT_ME_ICONS} from '../../core/profile/aboutMeIcons';
import {CAMPUS_ICONS} from '../../core/profile/campusIcons';
import {
  ExploreProfile,
  CardOrigin,
} from "../../features/discovery/components/ExploreProfileCard";
import { ConnectionProfileCard } from "../../features/discovery/components/ConnectionProfileCard";
import { StandoutsIcon } from '../../features/discovery/components/StandoutsIcon';
import { LearningPage } from '../../features/discovery/components/StandoutsLearning';
import {StandoutsLoading} from '../../features/discovery/components/StandoutsLoading';
import {StandoutsInfoContent} from './StandoutsInfoScreen';
import type { Learning } from '../../features/discovery/standoutsLearning';
import { ProfileDetailModal } from "../../features/discovery/components/profile-detail/ProfileDetailModal";
import { RoseSheetHost, type RoseSheetHostHandle } from "../../features/discovery/components/RoseSheet";
import type {RoseConfirmation} from '../../features/discovery/components/profile-detail/RoseSentCelebration';
import { useRoses } from "../../features/discovery/useRoses";
import { demoStandouts } from "../../features/discovery/demo/likesDemo";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** `slot`: why this card is in the set - a best fit, a new face or a wildcard (STANDOUTS_PLAN.md 4.1). */
type Standout = ExploreProfile & { reasons?: string[]; roseSent?: boolean; slot?: "best" | "new" | "wildcard" };

/** Shown once: Roses went from 20 a week to 5 (STANDOUTS_PLAN.md 4.2). */
const ROSES_NOTICE_KEY = "standouts:roses-rarer-notice";
/**
 * The last set shown, so opening Standouts again (each visit is a new screen)
 * shows it at once, with its Roses sent and people hidden, instead of loading.
 * Kept per account; not for the demo.
 */
let lastSet: { userId: string; at: number; cards: Standout[]; state: State; refreshAt: number | null } | null = null;
/** After this long away, coming back to Standouts loads them again. */
const STANDOUTS_STALE_MS = 15 * 60_000;
// "learning": a new person's type is still being learned (features/discovery/standoutsLearning).
type State = "ok" | "setup_required" | "not_enough_people" | "learning";

function standoutReasonIcon(reason: string): string {
  if (/interest/i.test(reason)) return ABOUT_ME_ICONS.interests;
  if (/department/i.test(reason)) return CAMPUS_ICONS.department;
  if (/relationship|goal/i.test(reason)) return 'heart-outline';
  if (/club/i.test(reason)) return CAMPUS_ICONS.clubs;
  if (/hangout|spot/i.test(reason)) return CAMPUS_ICONS.hangoutSpots;
  if (/new on/i.test(reason)) return 'person-add-outline';
  return 'checkmark-circle-outline';
}

/** "5 h", "40 min": when the next set arrives. */
function untilLabel(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes >= 60 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
}

/** "tomorrow", "in 3 days": when the Rose balance next tops up. */
function roseRefreshLabel(iso: string | undefined) {
  if (!iso) return "soon";
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60_000));
  return days <= 1 ? "tomorrow" : `in ${days} days`;
}

/**
 * Standouts (STANDOUTS_LIKES_SPEC.md section 5): a small daily set chosen for
 * you, reached with a Rose. An extra, never a jail - nobody here is kept out
 * of the deck, where an ordinary Like still works.
 *
 * Nothing on this screen says how much attention anyone is getting. In one
 * college, that number would be a leaderboard of classmates.
 */
export const StandoutsScreen = ({demoOnly = false, demoProgress, demoIntroSeen = false, onDemoIntroSeen, onClose, onExplore}: {
  demoOnly?: boolean;
  demoProgress?: Learning;
  demoIntroSeen?: boolean;
  onDemoIntroSeen?: (seen: boolean) => void;
  onClose?: () => void;
  onExplore?: () => void;
} = {}) => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const focused = useIsFocused();
  const [demo, setDemo] = useState(demoOnly);
  const demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const pendingRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current++;
      pendingRequest.current?.abort();
      if (demoTimer.current) clearTimeout(demoTimer.current);
    };
  }, []);
  // Demo-only previews of the two states a real account rarely shows.
  const [demoNoRoses, setDemoNoRoses] = useState(false);
  const [demoFew, setDemoFew] = useState(false);
  /** The demo's own Rose count: starts at 3 and goes down as Roses are sent. */
  const [demoRoses, setDemoRoses] = useState(5);
  const [rosesNotice, setRosesNotice] = useState(false);
  useEffect(() => {
    // Storage can be unavailable; then the notice simply shows again next time.
    AsyncStorage.getItem(ROSES_NOTICE_KEY).then((seen) => setRosesNotice(!seen)).catch(() => setRosesNotice(true));
  }, []);
  const dismissRosesNotice = () => {
    setRosesNotice(false);
    AsyncStorage.setItem(ROSES_NOTICE_KEY, "1").catch(() => undefined);
  };
  const userId = useSelector((root: RootState) => root.auth.user?.id ?? "");
  const last = lastSet;
  const kept = !demo && last && last.userId === userId && Date.now() - last.at < STANDOUTS_STALE_MS
    && (!last.refreshAt || Date.now() < last.refreshAt) ? last : null;
  const [cards, setCards] = useState<Standout[]>(kept?.cards ?? []);
  const [state, setState] = useState<State>(kept?.state ?? "ok");
  const [learning, setLearning] = useState<Learning | null>(null);
  const verification = useVerificationStatus();
  // "People near me" before verifying: the card says near you, not a campus.
  const nearMe = useSelector((root: RootState) => root.auth.user?.discoveryMode === "distance");
  const [loading, setLoading] = useState(!kept);
  const [loaded, setLoaded] = useState(!!kept);
  const [error, setError] = useState(false);
  const [refreshAt, setRefreshAt] = useState<number | null>(kept?.refreshAt ?? null);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<Standout | null>(null);
  const [origin, setOrigin] = useState<CardOrigin>();
  // The Rose sheet keeps who it is for itself: opening it must not re-render
  // this screen and the open profile (RoseSheetHost). One draws inside the
  // open profile's window, one stands alone for the list's Rose button.
  const profileRose = useRef<RoseSheetHostHandle<Standout>>(null);
  const listRose = useRef<RoseSheetHostHandle<Standout>>(null);
  const [roseConfirmation, setRoseConfirmation] = useState<RoseConfirmation | null>(null);
  const roseSending = useRef(false);
  const roseFollowup = useRef<{name: string; userId: string; photo: string | null; matchId?: string; matched: boolean; trial: boolean} | null>(null);
  const { balance: roseBalance, send: sendRose, refresh: refreshRoses } = useRoses();

  const roses = demo ? (demoNoRoses ? 0 : demoRoses) : (roseBalance?.roses ?? null);
  const outOfRoses = roses === 0;
  // First visit: explain before loading either the learning page or the set.
  const intro = useStandoutsIntro();
  const introLoaded = demoOnly || introReady();
  const showIntro = demoOnly ? !demoIntroSeen : !demo && introLoaded && !intro.welcomeShown;
  const closeIntro = useCallback(() => {
    if (demoOnly) onDemoIntroSeen?.(true); else markWelcomeShown();
  }, [demoOnly, onDemoIntroSeen]);
  useFocusEffect(useCallback(() => {
    if (demoOnly) return;
    if (introLoaded && intro.welcomeShown && loaded && !loading && state !== 'learning') markStandoutsOpened();
  }, [demoOnly, introLoaded, intro.welcomeShown, loaded, loading, state]));
  useEffect(() => {
    if (!showIntro || !focused) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {closeIntro(); return true;});
    return () => back.remove();
  }, [showIntro, focused, closeIntro]);

  const loadedAt = useRef(kept?.at ?? 0);
  useEffect(() => {
    if (demo || !loaded || loading || error || !loadedAt.current) return;
    // Never kept: the next visit must ask again, it may have just finished.
    if (state === "learning") { lastSet = null; return; }
    lastSet = { userId, at: loadedAt.current, cards, state, refreshAt };
  }, [demo, loaded, loading, error, userId, cards, state, refreshAt]);
  const load = useCallback(
    async (useDemo: boolean = demo, few: boolean = demoFew) => {
      const id = ++requestId.current;
      pendingRequest.current?.abort();
      const controller = useDemo ? null : new AbortController();
      pendingRequest.current = controller;
      const latest = () => mounted.current && id === requestId.current;
      setLoading(true);
      setError(false);
      loadedAt.current = Date.now();
      try {
        if (useDemo) {
          if (demoOnly && demoProgress && demoProgress.done < demoProgress.needed) {
            setCards([]);
            setState('learning');
            setLearning(demoProgress);
            setRefreshAt(null);
            return;
          }
          if (demoOnly) {
            // Demo-only response delay, long enough to review one complete icon loop.
            if (demoTimer.current) clearTimeout(demoTimer.current);
            await new Promise<void>(resolve => {demoTimer.current = setTimeout(resolve, 2400);});
            if (!latest()) return;
          }
          const set = few ? [] : demoStandouts();
          setCards(set);
          setState(few ? "not_enough_people" : "ok");
          setLearning(null);
          setRefreshAt(Date.now() + 5 * 60 * 60_000);
          return;
        }
        const response = await api.get("/discover/standouts", {signal: controller?.signal});
        if (!latest()) return;
        const data = response.data.data ?? { cards: [], state: "ok" };
        setCards(data.cards ?? []);
        setState(data.state ?? "ok");
        setLearning(data.learning ?? null);
        setRefreshAt(Date.now() + (data.refreshesInSeconds ?? 0) * 1000);
      } catch {
        if (!latest()) return;
        loadedAt.current = 0;
        setCards([]);
        setError(true);
      } finally {
        if (latest()) {pendingRequest.current = null; setLoading(false); setLoaded(true);}
      }
    },
    [demo, demoFew, demoOnly, demoProgress],
  );

  // Today's set loads on the first visit. Coming back (from a profile, a Rose,
  // the info page) keeps it - a reload only after a long time away or a
  // failed load; a new day's set comes from the countdown below.
  const shownDemo = useRef(demo);
  const shownState = useRef(state);
  shownState.current = state;
  useFocusEffect(
    useCallback(() => {
      if (showIntro) return;
      if (!demo && (!introLoaded || !intro.welcomeShown)) return;
      // Swipes in Explore can finish learning while this screen is away.
      const stale = shownState.current === 'learning' || !loadedAt.current || Date.now() - loadedAt.current > STANDOUTS_STALE_MS;
      if (stale || shownDemo.current !== demo) void load();
      shownDemo.current = demo;
      if (!demo) void refreshRoses();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [demo, showIntro, introLoaded, intro.welcomeShown]),
  );

  // The countdown ticks once a minute; a new day's set is fetched when it passes.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const crossedMidnight = useRef(false);
  useEffect(() => {
    if (showIntro || !introLoaded || !refreshAt || now < refreshAt || crossedMidnight.current) return;
    crossedMidnight.current = true;
    void load().finally(() => {
      crossedMidnight.current = false;
    });
  }, [now, refreshAt, load, showIntro, introLoaded]);

  const markRosed = (id: string) =>
    setCards((current) => current.map((item) => (item.id === id ? { ...item, roseSent: true } : item)));

  const rose = async (card: Standout, comment: string | null) => {
    if (!card || roseSending.current || roseConfirmation || card.roseSent) return;
    roseSending.current = true;
    try {
      let matched = false;
      let matchId: string | undefined;
      let trial = false;
      if (demo) {
        if (demoNoRoses || demoRoses <= 0) return;
        setDemoRoses(count => Math.max(0, count - 1));
      } else {
        await api.post("/discover/visible", {impressionId: card.impressionId}).catch(() => undefined);
        const result = await sendRose(card.id, comment, {onTrialRoseSpent: () => {trial = true;}});
        if (!result) return;
        matched = !!result.matchCreated;
        matchId = result.matchId;
      }
      // Keep the card and expanded profile in place until confirmation finishes.
      markRosed(card.id);
      roseFollowup.current = {name: card.name, userId: card.id, photo: card.primaryPhoto ?? card.photos[0] ?? null, matchId, matched, trial};
      setRoseConfirmation({name: card.name, matched});
    } finally {
      roseSending.current = false;
    }
  };

  const finishRoseConfirmation = () => {
    profileRose.current?.close();
    listRose.current?.close();
    setSelected(null);
    setRoseConfirmation(null);
  };
  const afterRoseDismissed = useCallback(() => {
    const followup = roseFollowup.current;
    if (!followup) return;
    roseFollowup.current = null;
    let reminderShown = false;
    const showTrialReminder = () => {
      if (followup.trial && !reminderShown) {
        reminderShown = true;
        navigation.navigate('VerifyRules', {reason: 'roseSent'});
      }
    };
    if (followup.matched) {
      navigation.navigate('MatchCelebration', {name: followup.name, userId: followup.userId, photo: followup.photo, matchId: followup.matchId, roseTrial: followup.trial});
    } else {
      showTrialReminder();
    }
  }, [navigation]);

  /** "Not for me": hidden for today. Not a Pass - nothing they could ever notice. */
  const hide = (card: Standout) => {
    setCards((current) => current.filter((item) => item.id !== card.id));
    if (!demo) api.post(`/discover/standouts/${card.id}/hide`).catch(() => undefined);
  };

  const seen = useRef(new Set<string>());
  const visible = useRef(({ viewableItems }: any) => {
    if (demoOnly) return;
    for (const view of viewableItems) {
      const card = view.item as Standout;
      if (card.impressionId && !card.impressionId.startsWith("demo") && !seen.current.has(card.impressionId)) {
        seen.current.add(card.impressionId);
        api.post("/discover/visible", { impressionId: card.impressionId }).catch(() => undefined);
      }
    }
  }).current;

  const cell = (item: Standout) => (
    <View style={styles.cell} key={item.id}>
      <ConnectionProfileCard
        profile={item}
        large
        onOpen={(profile, cardOrigin) => {
          setOrigin(cardOrigin);
          setSelected(profile as Standout);
        }}
      />
      {!item.roseSent && (
        <Pressable
          onPress={() => hide(item)}
          hitSlop={8}
          style={styles.hide}
          accessibilityRole="button"
          accessibilityLabel={`Not for me: hide ${item.name} for today`}
        >
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      )}
      <View style={styles.cardBody}>
      {!!item.reasons?.length && (
        <View style={styles.reasons}>
          {item.reasons.slice(0, 2).map((reason) => (
            <View key={reason} style={styles.reason}>
              <ProfileFieldIcon name={standoutReasonIcon(reason)} size={13} color="#E6C6A7" />
              <Text style={styles.reasonText} numberOfLines={1}>
                {reason}
              </Text>
            </View>
          ))}
        </View>
      )}
      {item.roseSent ? (
        <View style={[styles.roseButton, styles.roseSent]} accessibilityLabel="Rose sent">
          <Ionicons name="checkmark" size={15} color="#F1B3C8" />
          <Text style={[styles.roseButtonText, styles.roseSentText]}>Rose sent</Text>
        </View>
      ) : (
        <Pressable
          onPress={() => listRose.current?.open(item)}
          disabled={outOfRoses}
          accessibilityRole="button"
          accessibilityState={{ disabled: outOfRoses }}
          accessibilityLabel={outOfRoses ? "No Roses left" : `Send ${item.name} a Rose`}
          style={({ pressed }) => [styles.roseButton, outOfRoses && styles.roseDisabled, pressed && styles.pressed]}
        >
          <Ionicons name="rose" size={18} color={outOfRoses ? "#9A9AA4" : "#302025"} />
          <Text style={[styles.roseButtonText, outOfRoses && styles.roseDisabledText]} numberOfLines={1}>
            {outOfRoses
              ? `Next Roses ${demo ? "in 3 days" : roseRefreshLabel(roseBalance?.refreshesAt)}`
              : "Send a Rose"}
          </Text>
        </Pressable>
      )}
      </View>
    </View>
  );

  // Fewer than a full set of 8 before verifying: the campus-only reason, and the way out.
  const fewBeforeVerifying = !demo && !!verification?.limited && loaded && !loading && !error && state !== "setup_required" && state !== "learning" && cards.length < 8;

  const roseSheet = (inline: boolean) => (
    <RoseSheetHost<Standout>
      ref={inline ? profileRose : listRose}
      inline={inline}
      balance={roses}
      onSend={(card, comment) => rose(card, comment)}
      confirmation={roseConfirmation}
      photoOf={(card) => card.primaryPhoto ?? card.photos?.[0] ?? undefined}
      onConfirmationComplete={finishRoseConfirmation}
      onDismiss={afterRoseDismissed}
    />
  );

  if (showIntro) return <StandoutsInfoContent onClose={closeIntro} weeklyGrant={demo ? 5 : roseBalance?.grant}
    trial={!demo && !!roseBalance?.trial} topInset={insets.top} bottomInset={insets.bottom} />;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 4 }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose ?? (() => navigation.goBack())} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>Standouts</Text>
          <Pressable onPress={() => demoOnly ? onDemoIntroSeen?.(false) : navigation.navigate('StandoutsInfo', { weeklyGrant: demo ? 5 : roseBalance?.grant, trial: !demo && !!roseBalance?.trial })}
            accessibilityRole="button" accessibilityLabel="About Standouts" accessibilityHint="Learn how daily picks and Roses work" hitSlop={8}
            style={({ pressed }) => [styles.infoButton, pressed && styles.pressed]}>
            <Ionicons name="information-circle-outline" size={20} color="#C8C0B8" style={styles.infoGlyph} />
          </Pressable>
        </View>
        {demoOnly && state !== 'learning' ? <Pressable accessibilityRole="button" accessibilityLabel="Replay Standouts animation"
          style={styles.back} onPress={() => {setCards([]); setLoaded(false); void load(true);}}>
          <Ionicons name="refresh" size={22} color="#E8C698" />
        </Pressable> : null}
        {__DEV__ && !demoOnly && (
          <Pressable
            onPress={() => {
              const next = !demo;
              setDemo(next);
              setDemoFew(false);
              setDemoNoRoses(false);
              setDemoRoses(5);
              // The focus effect reloads when `demo` changes.
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: demo }}
            accessibilityLabel={demo ? "Hide demo" : "Show demo"}
            style={[styles.demoToggle, demo && styles.demoToggleOn]}
          >
            <Ionicons name="flask-outline" size={14} color={demo ? "#FFFFFF" : colors.primaryLight} />
            <Text style={[styles.demoText, demo && styles.demoTextOn]}>Demo</Text>
          </Pressable>
        )}
      </View>
      {demo && (
        <View style={styles.demoRow}>
          <Pressable onPress={() => setDemoNoRoses((value) => !value)} style={[styles.demoChip, demoNoRoses && styles.demoChipOn]}>
            <Text style={styles.demoChipText}>Out of Roses</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const next = !demoFew;
              setDemoFew(next);
              void load(true, next);
            }}
            style={[styles.demoChip, demoFew && styles.demoChipOn]}
          >
            <Text style={styles.demoChipText}>Small college</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        accessibilityLabel="Today's standouts"
        data={cards}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 28 }]}
        ListHeaderComponent={state === 'learning' || !loaded ? null :
          <>
          {/* Before verifying, Standouts come from their campus only (GOOGLE_SIGNUP_PLAN.md 7.5):
              a thin day says why, and what verifying opens. Otherwise reminder 7. */}
          {fewBeforeVerifying ? (
            <UnverifiedNudge compact art="standouts" icon="albums-outline"
              text={`You see ${nearMe ? 'people near you' : `people from ${verification?.campusName ?? 'your campus'}`}. Verify to see every campus.`} />
          ) : (
            <UnverifiedNudge compact art="standouts" icon="albums-outline" text="Verify to appear in Standouts and get 5 Roses a week." dismissKey="standouts" />
          )}
          <View style={styles.intro}>
            <View style={styles.introTitleRow}>
              <Text style={styles.introTitle} numberOfLines={1}>Your daily picks</Text>
              <View style={styles.metaPill} accessibilityLabel={roses === null ? "Roses" : `${roses} Roses left`}>
                <Ionicons name="rose" size={17} color="#693346" />
                <Text style={styles.metaText}>{roses === null ? "Roses" : `${roses} left`}</Text>
              </View>
            </View>
            <Text style={styles.subtitle}>Profiles picked for you. Send a Rose to start something.</Text>
            {rosesNotice && (
              <View style={styles.notice} accessibilityLiveRegion="polite">
                <Ionicons name="rose" size={18} color="#F2BBC8" />
                <Text style={styles.noticeText}>
                  Roses are now rarer: 5 a week. Each one goes to the top of someone's Likes, so choose well.
                </Text>
                <Pressable onPress={dismissRosesNotice} hitSlop={10} accessibilityRole="button" accessibilityLabel="Got it">
                  <Ionicons name="close" size={18} color="#AAA39D" />
                </Pressable>
              </View>
            )}
            {!!refreshAt && state === "ok" && (
              <View style={styles.timer}>
                <Ionicons name="time-outline" size={14} color="#AAA39D" />
                <Text style={styles.timerText}>Refreshes in {untilLabel(refreshAt - now)}</Text>
              </View>
            )}
          </View>
          </>
        }
        onViewableItemsChanged={visible}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 700 }}
        refreshControl={<RefreshControl refreshing={loading && loaded && cards.length > 0} onRefresh={() => load()} tintColor={colors.primary} />}
        ListEmptyComponent={
          // An unverified person's empty day is explained by the card above.
          loaded && !loading && !error && state === "learning" && learning ? (
            <LearningPage progress={learning} onExplore={onExplore ?? (() => navigation.navigate("Main", {screen: "Dashboard"}))} />
          ) : loaded && !loading && !fewBeforeVerifying ? (
            <View style={styles.emptyBlock}>
              <View style={styles.emptyIcon}>{error ? <Ionicons name="cloud-offline-outline" size={30} color="#E6C6A7" />
                : <StandoutsIcon size={34} color="#E6C6A7" heartColor="#F2BDC9" />}</View>
              <Text style={styles.emptyTitle}>{error ? "Unable to load your picks" : state === "setup_required" ? "Make your profile ready" : "More connections ahead"}</Text>
              <Text style={styles.empty}>
                {error
                  ? "Standouts couldn't load. Check your connection and try again."
                  : state === "setup_required"
                    ? "Finish setting up your profile to get Standouts."
                    : state === "not_enough_people"
                      ? "Not enough people yet — check back as your college joins."
                      : `That's everyone for today. New Standouts in ${refreshAt ? untilLabel(refreshAt - now) : "a few hours"}.`}
              </Text>
              {error && (
                <Pressable onPress={() => load()} style={styles.retryBlock}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }) => cell(item)}
      />

      {selected && (
        <ProfileDetailModal
          user={selected}
          initialPhotoUri={selected.primaryPhoto ?? undefined}
          origin={origin}
          transition="photo"
          isVisible
          onClose={() => setSelected(null)}
          // No onLike and no onPass: Standouts is reached by Rose alone.
          onRose={selected.roseSent || outOfRoses ? undefined : () => profileRose.current?.open(selected)}
          roseBalance={roses}
          overlay={roseSheet(true)}
          onOverlayBack={() => profileRose.current?.back() ?? false}
          onReport={demo ? async () => undefined : undefined}
          onBlock={demo ? async () => undefined : undefined}
          onBlocked={() => setCards((items) => items.filter((item) => item.id !== selected.id))}
        />
      )}
      {roseSheet(false)}
      <StandoutsLoading loading={(!demo && !introLoaded) || (loading && cards.length === 0)} active={focused} />
    </View>
  );
};

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: "#2A2226", borderWidth: 1, borderColor: "rgba(242,187,200,0.2)" },
  noticeText: { flex: 1, color: "#E7E1DC", fontSize: 12, lineHeight: 17 },
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, minHeight: 52 },
  back: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  infoButton: { width: 28, height: 28, marginLeft: 2, alignItems: 'center', justifyContent: 'center' },
  infoGlyph: { lineHeight: 22, includeFontPadding: false, transform: [{ translateY: 1 }] },
  title: { color: "#FFFFFF", fontSize: 22, lineHeight: 28, includeFontPadding: false, fontFamily: "DMSans_700Bold", flexShrink: 1 },
  intro: { paddingTop: 8, paddingBottom: 22 },
  introTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  introTitle: { flex: 1, color: "#FFFFFF", fontSize: 27, letterSpacing: -0.8, fontFamily: "DMSans_700Bold" },
  subtitle: { color: "#B8B0AA", fontSize: 14, lineHeight: 21, fontFamily: "DMSans_400Regular", marginTop: 6, maxWidth: 310 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, minHeight: 34, borderRadius: 17, backgroundColor: "#F7D8E0" },
  metaText: { color: "#693346", fontSize: 12, fontFamily: "DMSans_700Bold" },
  timer: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 13 },
  timerText: { color: "#AAA39D", fontSize: 11, fontFamily: "DMSans_500Medium" },
  demoToggle: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: "#232323" },
  demoToggleOn: { backgroundColor: "#4A2930" },
  demoText: { color: colors.primaryLight, fontSize: 11, fontFamily: "DMSans_700Bold" },
  demoTextOn: { color: "#FFFFFF" },
  demoRow: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 6, marginBottom: 12 },
  demoChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: "#232323" },
  demoChipOn: { backgroundColor: "#543035" },
  demoChipText: { color: "#FFFFFF", fontSize: 11 },
  grid: { paddingHorizontal: 20, width: "100%", maxWidth: 600, alignSelf: "center" },
  cell: { backgroundColor: "#232323", borderRadius: 24, marginBottom: 20 },
  cardBody: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12, gap: 10 },
  hide: { position: "absolute", top: 12, right: 12, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#252322" },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reason: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%" },
  reasonText: { flexShrink: 1, color: "#D7CEC5", fontSize: 12, fontFamily: "DMSans_500Medium" },
  roseButton: { minHeight: 46, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 23, backgroundColor: "#F7D8E0", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  roseButtonText: { color: "#302025", fontSize: 14, fontFamily: "DMSans_700Bold", flexShrink: 1 },
  roseSent: { backgroundColor: "#36272D" },
  roseSentText: { color: "#F1B3C8" },
  roseDisabled: { backgroundColor: "#303030" },
  roseDisabledText: { color: "#B0AAA6", fontSize: 12 },
  pressed: { opacity: 0.8 },
  emptyBlock: { alignItems: "center", gap: 12, paddingVertical: 40, paddingHorizontal: 20 },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#2D2721", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { color: "#FFFFFF", fontFamily: "DMSans_700Bold", fontSize: 20, textAlign: "center" },
  empty: { color: "#B8B0AA", fontFamily: "DMSans_400Regular", fontSize: 14, textAlign: "center", lineHeight: 21 },
  retryBlock: { minHeight: 44, paddingHorizontal: 22, justifyContent: "center", borderRadius: 22, backgroundColor: "#F2C9D3", marginTop: 8 },
  retryText: { color: "#302025", fontSize: 13, fontFamily: "DMSans_700Bold" },
});
