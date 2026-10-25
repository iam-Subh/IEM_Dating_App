// @refresh reset
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { Easing, FadeInDown, runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../services/api";
import { useSocketEvent } from "../../services/useSocketEvent";
import { store } from "../../store";
import { colors } from "../../core/theme/colors";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  NO_UNREAD,
  ago,
  buildSections,
  countNotifications,
  lookOf,
  stackText,
  textOf,
  type Category,
  type NotificationItem,
  type Row,
  type Unread,
} from "./notificationModel";
import { refreshUnread, setUnread, useUnreadNotifications } from "./useUnreadNotifications";
import { ACTIVITY_CATEGORIES, activityUnread, countActivity, isSocialActivity } from "./activityModel";
import { activityDemo, useActivityDemo } from "./useActivityDemo";
import { NotificationOptions, NotificationReveal as StackMessages, type NotificationMenuAction } from "./NotificationOptions";
import { SystemNotice } from './SystemNotice';
import { isSystemNotice, type SystemNoticeAction } from './systemNoticeModel';
import { demoSystemNotifications } from './notificationsDemo';

type Filter = Category | "all";

/**
 * The notification centre (the bell on the deck): every kind of notification
 * the app sends, newest first, in time sections, with the same kind stacked -
 * a chat's messages, the day's Likes, follow requests. Live: something new
 * arrives while you look, and the counts move with it.
 */
/**
 * The last feed shown, per account and filter: opening the page again shows
 * it at once and refreshes quietly, instead of a spinner every time.
 */
const feedCache = new Map<string, { items: NotificationItem[]; cursor: string | null }>();
const feedKey = (filter: string) => `${store.getState().auth.user?.id ?? ""}:${filter}`;

export function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const social = route.params?.scope === "social";
  const activitySnapshot = useActivityDemo();
  const demo = activitySnapshot.enabled;
  const [filter, setFilter] = useState<Filter>("all");
  const [feedItems, setFeedItems] = useState<NotificationItem[]>(() => feedCache.get(feedKey("all"))?.items ?? []);
  const items = demo ? activitySnapshot.items : feedItems;
  const setItems = useCallback((update: React.SetStateAction<NotificationItem[]>) => {
    if (demo) activityDemo.update(update);
    else setFeedItems(update);
  }, [demo]);
  const [cursor, setCursor] = useState<string | null>(() => feedCache.get(feedKey("all"))?.cursor ?? null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(() => feedCache.has(feedKey("all")));
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuKey, setMenuKey] = useState<string | null>(null);
  // Rows that arrived live, so they can come in with a little motion.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  // The running clock: every row's "5m" moves on by itself.
  const [now, setNow] = useState(Date.now());
  const { unread: liveUnread } = useUnreadNotifications();
  const generation = useRef(0);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const known = useRef(new Set<string>());

  useFocusEffect(useCallback(() => {
    if (!menuKey) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      setMenuKey(null);
      return true;
    });
    return () => listener.remove();
  }, [menuKey]));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // In the demo the counts are the demo's own.
  const unread: Unread = useMemo(() => {
    if (social) return demo ? countActivity(items) : activityUnread(liveUnread);
    if (!demo) return liveUnread;
    return countNotifications(items);
  }, [demo, social, liveUnread, items]);

  const shown = useMemo(() => items.filter((item) => (!social || isSocialActivity(item))
    && (filter === "all" || item.category === filter)), [items, filter, social]);
  const sections = useMemo(
    () => buildSections(shown, new Date(now)).map((section) => ({ ...section, data: section.rows })),
    [shown, now],
  );

  const load = useCallback(
    async (reset: boolean, silent = false) => {
      const id = reset ? ++generation.current : generation.current;
      if (!silent) setLoading(true);
      setError(false);
      try {
        const response = await api.get("/notifications/feed", {
          params: {
            category: filter === "all" ? undefined : filter,
            cursor: reset ? undefined : (cursor ?? undefined),
          },
        });
        if (id !== generation.current) return;
        const data = response.data.data ?? { items: [], nextCursor: null };
        const incoming: NotificationItem[] = data.items ?? [];
        if (reset) {
          // Whatever was not on screen before a live re-read is new.
          if (silent && known.current.size) {
            const arrived = incoming.filter((item) => !known.current.has(item.id)).map((item) => item.id);
            if (arrived.length) setFresh(new Set(arrived));
          }
          setFeedItems(incoming);
        } else {
          setFeedItems((current) => {
            const have = new Set(current.map((item) => item.id));
            return [...current, ...incoming.filter((item) => !have.has(item.id))];
          });
        }
        for (const item of incoming) known.current.add(item.id);
        setCursor(data.nextCursor ?? null);
        if (reset) feedCache.set(feedKey(filter), { items: incoming, cursor: data.nextCursor ?? null });
        if (data.unread) setUnread(() => ({ ...NO_UNREAD, ...data.unread }));
      } catch {
        if (id === generation.current && reset && !silent) setError(true);
      } finally {
        if (id === generation.current) {
          setLoading(false);
          setLoaded(true);
        }
      }
    },
    [filter, cursor],
  );

  // First page on focus, and whenever the filter changes. With a feed already
  // to show - this visit's, or the last one - the re-read is quiet: no spinner.
  useFocusEffect(
    useCallback(() => {
      if (demo) return;
      const cached = feedCache.get(feedKey(filter));
      if (cached) {
        for (const item of cached.items) known.current.add(item.id);
        setFeedItems(cached.items);
        setCursor(cached.cursor);
        setLoaded(true);
      }
      void load(true, !!cached || loadedRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [demo, filter]),
  );

  // Live: something new, or read on another device - re-read quietly.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    // A preloaded route can prepare its feed before the bell is tapped.
    if (demo || navigation.isFocused()) return;
    void loadRef.current(true);
  }, [demo, navigation]);
  // On whichever socket is current, and once more after every reconnect, so a
  // notification that arrived while the connection was down still shows.
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSocketEvent("notifications_changed", () => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => void loadRef.current(true, true), 250);
  }, { enabled: !demo, onReconnect: true });
  useEffect(() => () => { if (liveTimer.current) clearTimeout(liveTimer.current); }, []);

  useEffect(() => {
    if (!demo) return;
    setCursor(null);
    setLoaded(true);
    setLoading(false);
    setError(false);
    setNow(Date.now());
    if (activitySnapshot.latestId) setFresh(new Set([activitySnapshot.latestId]));
  }, [demo, activitySnapshot.latestId]);

  const toggleDemo = () => {
    generation.current += 1;
    setFeedItems([]);
    setLoading(false);
    setLoaded(false);
    setCursor(null);
    setExpanded(new Set());
    setMenuKey(null);
    setFresh(new Set());
    known.current = new Set();
    if (demo) activityDemo.disable();
    else activityDemo.enable();
  };

  /** Read, here and now (then on the server): a row, or a whole stack. */
  const markRead = (targets: NotificationItem[]) => {
    const ids = targets.filter((item) => !item.isRead).map((item) => item.id);
    if (!ids.length) return;
    const readSet = new Set(ids);
    setItems((current) => current.map((item) => (readSet.has(item.id) ? { ...item, isRead: true } : item)));
    if (demo) return;
    setUnread((current) => {
      const byCategory = { ...current.byCategory };
      for (const item of targets) if (readSet.has(item.id)) byCategory[item.category] = Math.max(0, byCategory[item.category] - 1);
      return { total: Math.max(0, current.total - ids.length), byCategory };
    });
    api.post("/notifications/read", { ids }).catch(() => void refreshUnread());
  };

  const markAll = () => {
    if (social) {
      markRead(shown);
      return;
    }
    const scope = filter === "all" ? null : filter;
    setItems((current) => current.map((item) => (!scope || item.category === scope ? { ...item, isRead: true } : item)));
    if (demo) return;
    setUnread((current) =>
      scope
        ? { total: Math.max(0, current.total - current.byCategory[scope]), byCategory: { ...current.byCategory, [scope]: 0 } }
        : NO_UNREAD,
    );
    api.post("/notifications/read-all", scope ? { category: scope } : {}).catch(() => void refreshUnread());
  };

  /** Where a notification leads. Read first, so the badge drops as you go. */
  const open = (targets: NotificationItem[]) => {
    const first = targets[0];
    markRead(targets);
    const target = first.target;
    if (!target) return;
    if (demo) {
      Alert.alert("Demo", `In the app, this opens ${target.kind === "chat" ? `your chat with ${first.actor?.name ?? "them"}` : target.kind === "likes" ? "Likes You" : target.kind === "follow_requests" ? first.type === "follow_request" ? "your follow requests" : `${first.actor?.name ?? "this person"}'s profile` : "the story"}.`);
      return;
    }
    if (target.kind === "chat" && first.actor) {
      navigation.navigate("ChatScreen", {
        matchId: target.matchId,
        userId: first.actor.id,
        userName: first.actor.name,
        userAvatar: first.actor.avatarUrl,
      });
    } else if (target.kind === "likes") {
      navigation.navigate("Main", { screen: "Matches", params: { tab: "likes" } });
    } else if (target.kind === "follow_requests") {
      navigation.navigate("FollowRequests");
    } else if (target.kind === "story") {
      navigation.navigate("StoryViewer", { storyId: target.storyId });
    }
  };

  const openSystemAction = (item: NotificationItem, action: SystemNoticeAction) => {
    setMenuKey(null);
    markRead([item]);
    if (action === 'explore') {
      navigation.navigate('Main', { screen: 'Dashboard' });
      return;
    }
    if (demo) {
      const destination = { explore: 'Explore', profile: 'your profile', edit_profile: 'Edit profile', sessions: 'your active devices', verification: 'college verification', selfie: 'the selfie check' }[action];
      Alert.alert('Demo preview', `This opens ${destination} in the app.`);
      return;
    }
    if (action === 'profile') navigation.navigate('Main', { screen: 'Profile' });
    else navigation.navigate({ edit_profile: 'EditProfile', sessions: 'ActiveSessions', verification: 'VerifyCollege', selfie: 'RealPersonCheck' }[action]);
  };

  const systemDemoSequence = useRef(0);
  const addDemoUpdate = () => {
    if (filter !== 'account') { activityDemo.arrive(); return; }
    const examples = demoSystemNotifications();
    const index = systemDemoSequence.current++;
    const example = examples[index % examples.length];
    const at = Date.now();
    const item = { ...example, id: `demo-system-live-${at}-${index}`, isRead: false, createdAt: new Date(at).toISOString() };
    activityDemo.update(current => [item, ...current]);
    setFresh(new Set([item.id]));
    setNow(at);
  };

  // --- Row actions: only where a tap here saves a trip --------------------

  /** New facts about one notification's target, on screen now. */
  const patchTarget = (id: string, patch: Record<string, unknown>) =>
    setItems((current) => current.map((item) => (item.id === id && item.target ? { ...item, target: { ...item.target, ...patch } as NotificationItem["target"] } : item)));

  /** Confirm or Delete a follow request, right in the row. */
  const answerFollow = async (item: NotificationItem, accept: boolean) => {
    const target = item.target;
    if (target?.kind !== "follow_requests" || !target.followId) return;
    markRead([item]);
    patchTarget(item.id, { state: accept ? "accepted" : "declined" });
    if (demo) return;
    try {
      await api.patch(`/stories/follows/${target.followId}`, { accept });
    } catch (cause: any) {
      // Withdrawn or already answered elsewhere: nothing left to answer.
      if (cause?.response?.status === 404) patchTarget(item.id, { state: "gone" });
      else {
        patchTarget(item.id, { state: "pending" });
        Alert.alert("Couldn't save that", "Check your connection and try again.");
      }
    }
  };

  /** After Confirm: follow them too, without leaving the page. */
  const followBack = async (item: NotificationItem) => {
    if (!item.actor) return;
    markRead([item]);
    patchTarget(item.id, { followBack: "pending" });
    if (demo) return;
    try {
      const response = await api.post("/stories/follows", { userId: item.actor.id, disclosureAccepted: true });
      patchTarget(item.id, { followBack: response.data?.data?.status === "accepted" ? "accepted" : "pending" });
    } catch {
      patchTarget(item.id, { followBack: "none" });
      // Never why - a refusal must not become a way to read their settings.
      Alert.alert("Follow request not sent", "You can't follow this person right now.");
    }
  };

  // Matches you have just waved to, for "Sent 👋" in their row.
  const [waved, setWaved] = useState<Set<string>>(new Set());
  /** A new match with an empty chat: one tap says hello. */
  const sayHi = async (item: NotificationItem) => {
    const target = item.target;
    if (target?.kind !== "chat") return;
    markRead([item]);
    setWaved((current) => new Set(current).add(item.id));
    if (demo) return;
    try {
      await api.post(`/chat/${target.matchId}/messages`, {
        content: "👋",
        clientMessageId: `wave-${target.matchId}-${Date.now().toString(36)}`,
      });
      patchTarget(item.id, { empty: false });
    } catch {
      setWaved((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      Alert.alert("Couldn't send", "Check your connection and try again.");
    }
  };

  /** Reuse the existing actions in an inline card tray. */
  const rowMenu = (targets: NotificationItem[]): NotificationMenuAction[] => {
    const anyUnread = targets.some((item) => !item.isRead);
    const ids = targets.map((item) => item.id);
    return [
      anyUnread
        ? { text: "Mark as read", onPress: () => markRead(targets) }
        : {
            text: "Mark as unread",
            onPress: () => {
              const set = new Set(ids);
              setItems((current) => current.map((item) => (set.has(item.id) ? { ...item, isRead: false } : item)));
              if (demo) return;
              setUnread((current) => {
                const byCategory = { ...current.byCategory };
                for (const item of targets) byCategory[item.category] += 1;
                return { total: current.total + targets.length, byCategory };
              });
              api.post("/notifications/unread", { ids }).catch(() => void refreshUnread());
            },
          },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          const set = new Set(ids);
          const unreadGone = targets.filter((item) => !item.isRead);
          setItems((current) => current.filter((item) => !set.has(item.id)));
          if (demo) return;
          if (unreadGone.length) {
            setUnread((current) => {
              const byCategory = { ...current.byCategory };
              for (const item of unreadGone) byCategory[item.category] = Math.max(0, byCategory[item.category] - 1);
              return { total: Math.max(0, current.total - unreadGone.length), byCategory };
            });
          }
          api.post("/notifications/remove", { ids }).catch(() => void load(true, true));
        },
      },
    ];
  };

  const showMenu = (key: string) => setMenuKey((current) => current === key ? null : key);
  const openOrDismiss = (targets: NotificationItem[]) => {
    if (menuKey) setMenuKey(null);
    else open(targets);
  };
  const menuFor = (key: string, targets: NotificationItem[]) => (
    <NotificationOptions expanded={menuKey === key} actions={rowMenu(targets)} onClose={() => setMenuKey(null)} />
  );

  /** The buttons a row carries, if any. */
  const actionsFor = (item: NotificationItem, compact = false): React.ReactNode => {
    const target = item.target;
    if (item.type === "follow_accepted") return <Text style={styles.done}>Following</Text>;
    if ((item.type === "follow_request" || item.type === "follow") && target?.kind === "follow_requests" && item.actor) {
      if (target.state === "pending") {
        return (
          <View style={styles.actions}>
            <ActionButton label="Confirm" primary compact={compact} onPress={() => void answerFollow(item, true)} />
            <ActionButton label="Delete" compact={compact} onPress={() => void answerFollow(item, false)} />
          </View>
        );
      }
      if (target.state === "accepted") {
        return target.followBack === "none" ? (
          <View style={styles.actions}>
            <ActionButton label="Follow back" primary compact={compact} onPress={() => void followBack(item)} />
          </View>
        ) : (
          <Text style={styles.done}>{target.followBack === "accepted" ? "You follow each other" : "Follow back requested"}</Text>
        );
      }
      if (target.state === "declined") return <Text style={styles.done}>Request deleted</Text>;
      return null;
    }
    if (item.type === "match" && target?.kind === "chat" && item.actor) {
      if (waved.has(item.id)) {
        return (
          <View style={styles.actions}>
            <Text style={styles.done}>Sent 👋</Text>
            <ActionButton label="Open chat" compact={compact} onPress={() => open([item])} />
          </View>
        );
      }
      if (target.empty) {
        return (
          <View style={styles.actions}>
            <ActionButton label="Say hi 👋" primary compact={compact} onPress={() => void sayHi(item)} />
          </View>
        );
      }
    }
    return null;
  };

  const toggleStack = (key: string) => {
    setMenuKey(null);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const chips: Filter[] = ["all", ...(social ? ACTIVITY_CATEGORIES : CATEGORIES)];

  const renderRow = ({ item: row }: { item: Row }) => {
    if (row.kind === "single") {
      return (
        <NotificationRow
          item={row.item}
          now={now}
          fresh={fresh.has(row.item.id)}
          onPress={() => openOrDismiss([row.item])}
          onLongPress={() => showMenu(row.key)}
          menuOpen={menuKey === row.key}
          menu={menuFor(row.key, [row.item])}
          actions={actionsFor(row.item)}
          onSystemAction={action => openSystemAction(row.item, action)}
        />
      );
    }
    const isOpen = expanded.has(row.key);
    const unreadCount = row.items.filter((item) => !item.isRead).length;
    const words = stackText(row.items);
    const head = row.items[0];
    return (
      <NotificationStack expanded={isOpen} unreadCount={unreadCount} count={row.items.length}
        fresh={row.items.some((item) => fresh.has(item.id))} onToggle={() => toggleStack(row.key)}
        menu={menuFor(row.key, row.items)} summary={
          <Pressable
            onPress={() => openOrDismiss(row.items)}
            onLongPress={() => showMenu(row.key)}
            delayLongPress={350}
            style={({ pressed }) => [styles.row, styles.stackSummary, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${words.lead} ${words.rest}, ${ago(head.createdAt, now)}${unreadCount ? `, ${unreadCount} unread` : ""}`}
          >
            <AvatarPile items={row.items} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText} numberOfLines={2}>
                {!!words.lead && <Text style={styles.lead}>{words.lead} </Text>}
                {words.rest}
              </Text>
              <Text style={styles.time}>
                {ago(head.createdAt, now)} · {CATEGORY_LABELS[head.category]}
              </Text>
            </View>
            {!!head.preview && <Image source={{ uri: head.preview.uri }} style={styles.storyPreview} fadeDuration={0} accessibilityLabel="Story preview" />}
          </Pressable>
        }>
          {row.items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              now={now}
              fresh={false}
              compact
              onPress={() => openOrDismiss([item])}
              onLongPress={() => showMenu(item.id)}
              menuOpen={menuKey === item.id}
              menu={menuFor(item.id, [item])}
              actions={actionsFor(item, true)}
            />
          ))}
      </NotificationStack>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 4 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => menuKey ? setMenuKey(null) : navigation.goBack()} hitSlop={6} style={styles.back} accessibilityRole="button" accessibilityLabel={menuKey ? "Close notification options" : "Go back"}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{social ? "Activity" : "Notifications"}</Text>
        </View>
        {(__DEV__ || social) && (
          <Pressable
            onPress={toggleDemo}
            accessibilityRole="switch"
            accessibilityState={{ checked: demo }}
            accessibilityLabel={demo ? "Hide demo" : "Show demo"}
            style={[styles.demoToggle, demo && styles.demoToggleOn]}
          >
            <Ionicons name="flask-outline" size={14} color={demo ? "#FFFFFF" : "#F1B6C0"} />
            <Text style={[styles.demoText, demo && styles.demoTextOn]}>Demo</Text>
          </Pressable>
        )}
        <Pressable
          onPress={markAll}
          disabled={!(filter === "all" ? unread.total : unread.byCategory[filter])}
          style={({ pressed }) => [styles.markAll, pressed && styles.rowPressed, !(filter === "all" ? unread.total : unread.byCategory[filter]) && styles.markAllOff]}
          accessibilityRole="button"
          accessibilityLabel={filter === "all" ? "Mark all as read" : `Mark all ${CATEGORY_LABELS[filter]} as read`}
        >
          <Ionicons name="checkmark-done" size={19} color="#fff" />
        </Pressable>
      </View>

      <FlatList
        horizontal
        data={chips}
        keyExtractor={(chip) => chip}
        showsHorizontalScrollIndicator={false}
        style={styles.chipsList}
        contentContainerStyle={styles.chips}
        renderItem={({ item: chip }) => {
          const count = chip === "all" ? unread.total : unread.byCategory[chip];
          const active = filter === chip;
          return (
            <Pressable
              onPress={() => {
                setFilter(chip);
                setExpanded(new Set());
                setMenuKey(null);
              }}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${chip === "all" ? "All" : CATEGORY_LABELS[chip]}${count ? `, ${count} unread` : ""}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip === "all" ? "All" : CATEGORY_LABELS[chip]}</Text>
              {count > 0 && (
                <View style={[styles.chipCount, active && styles.chipCountActive]}>
                  <Text style={styles.chipCountText}>{count > 99 ? "99+" : count}</Text>
                </View>
              )}
            </Pressable>
          );
        }}
      />

      <SectionList
        style={styles.feed}
        scrollEnabled={shown.length > 0}
        bounces={shown.length > 0}
        alwaysBounceVertical={shown.length > 0}
        sections={sections}
        extraData={{ menuKey, expanded }}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 20 }]}
        ListHeaderComponent={demo ? (
          <View style={styles.demoPanel}>
            <View style={styles.rowBody}>
              <Text style={styles.demoPanelTitle}>{filter === 'account' ? 'System notices preview' : 'Live notifications demo'}</Text>
              <Text style={styles.demoPanelText}>{filter === 'account' ? 'Welcome, verification and account updates.' : 'Updates arrive here and on Explore.'}</Text>
            </View>
            <Pressable onPress={addDemoUpdate} style={({ pressed }) => [styles.demoArrival, pressed && styles.rowPressed]}
              accessibilityRole="button" accessibilityLabel={filter === 'account' ? 'Add a demo system notice' : 'Add a demo activity update'}>
              <Ionicons name="add" size={16} color="#33191F" />
              <Text style={styles.demoArrivalText}>New update</Text>
            </Pressable>
          </View>
        ) : null}
        onEndReached={() => !demo && cursor && !loading && load(false)}
        onEndReachedThreshold={0.4}
        refreshControl={
          shown.length > 0 ? <RefreshControl refreshing={loading && loaded && items.length > 0} onRefresh={() => !demo && load(true)} tintColor={colors.primary} /> : undefined
        }
        ListFooterComponent={loading && !loaded ? <ActivityIndicator color={colors.primary} style={styles.loadingMore} /> : null}
        ListEmptyComponent={
          loaded && !loading ? (
            <View style={styles.empty}>
              {error ? <View style={styles.emptyIcon}>
                <Ionicons name="cloud-offline-outline" size={30} color="#FFADB6" />
              </View> : <Image
                source={require('../../../assets/illustrations/notifications-caught-up-kitten.png')}
                style={styles.emptyKitten}
                resizeMode="contain"
                fadeDuration={0}
                accessible={false}
              />}
              <Text style={styles.emptyTitle}>{error ? `${social ? "Activity" : "Notifications"} couldn't load` : "You're all caught up"}</Text>
              <Text style={styles.emptyText}>
                {error
                  ? "Check your connection and try again."
                  : filter === "all"
                    ? social ? "New followers, follow requests and story updates appear here." : "Likes, matches, messages and more show up here as they happen."
                    : `Nothing in ${CATEGORY_LABELS[filter]} yet.`}
              </Text>
              {error && (
                <Pressable onPress={() => load(true)} style={styles.retry}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
      />
    </View>
  );
}

function NotificationStack({ expanded, unreadCount, count, fresh, onToggle, summary, menu, children }: {
  expanded: boolean; unreadCount: number; count: number; fresh: boolean; onToggle: () => void;
  summary: React.ReactNode; menu: React.ReactNode; children: React.ReactNode;
}) {
  const expandedValue = useSharedValue(expanded);
  useLayoutEffect(() => { expandedValue.value = expanded; }, [expanded, expandedValue]);
  return <Animated.View style={[styles.stack, unreadCount > 0 && styles.stackUnread]} entering={fresh ? FadeInDown.duration(220) : undefined}>
    <View style={styles.stackHeader}>
      {summary}
      <StackToggle count={count} unread={unreadCount > 0} expanded={expanded} expandedValue={expandedValue} onPress={onToggle} />
    </View>
    {menu}
    <StackMessages expanded={expanded} expandedValue={expandedValue}>{children}</StackMessages>
  </Animated.View>;
}

function StackToggle({ count, unread, expanded, expandedValue, onPress }: {
  count: number; unread: boolean; expanded: boolean; expandedValue: SharedValue<boolean>; onPress: () => void;
}) {
  const rotation = useDerivedValue(() => withTiming(expandedValue.value ? 180 : 0, {
    duration: 180, easing: Easing.out(Easing.cubic),
  }));
  const arrowMotion = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  const tap = Gesture.Tap().maxDistance(12).onEnd((_event, success) => {
    if (!success) return;
    expandedValue.value = !expandedValue.value;
    runOnJS(onPress)();
  });
  return (
    <GestureDetector gesture={tap}>
    <View style={styles.stackToggle} accessible
      accessibilityRole="button" accessibilityState={{ expanded }}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityTap={onPress}
      onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "activate") onPress(); }}
      accessibilityLabel={expanded ? "Collapse notifications" : `Expand ${count} notifications`}>
      <Text style={[styles.stackCount, unread && styles.stackCountUnread]}>{count}</Text>
      <Animated.View style={arrowMotion}>
        <Ionicons name="chevron-down" size={12} color="#C1BDC4" />
      </Animated.View>
    </View>
    </GestureDetector>
  );
}

function NotificationRow({ item, now, fresh, compact, onPress, onLongPress, actions, menuOpen, menu, onSystemAction }: {
  item: NotificationItem; now: number; fresh: boolean; compact?: boolean; onPress: () => void;
  onLongPress?: () => void; actions?: React.ReactNode; menuOpen?: boolean; menu?: React.ReactNode;
  onSystemAction?: (action: SystemNoticeAction) => void;
}) {
  if (isSystemNotice(item)) return <SystemNotice item={item} now={now} fresh={fresh} menuOpen={menuOpen} menu={menu}
    onPress={onPress} onLongPress={onLongPress} onAction={onSystemAction ?? (() => onPress())} />;
  const words = textOf(item);
  return (
    <Animated.View entering={fresh ? FadeInDown.duration(220) : undefined}
      style={[styles.notificationCard, !compact && styles.notification, compact && styles.notificationCompact, menuOpen && styles.notificationOptionsOpen]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={({ pressed }) => [styles.row, compact && styles.rowCompact, !item.isRead && styles.rowUnread, menuOpen && styles.rowOptionsOpen, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${words.lead} ${words.rest}, ${ago(item.createdAt, now)}${item.isRead ? "" : ", unread"}`}
      >
        <Face item={item} size={compact ? 32 : 44} />
        <View style={styles.rowBody}>
          <Text style={styles.rowText} numberOfLines={2}>
            {!!words.lead && <Text style={styles.lead}>{words.lead} </Text>}
            {words.rest}
          </Text>
          {item.type === "story_reply" && !!item.body && <Text style={styles.storyReply} numberOfLines={2}>{item.body}</Text>}
          <Text style={styles.time}>
            {ago(item.createdAt, now)}
            {!compact && ` · ${CATEGORY_LABELS[item.category]}`}
          </Text>
          {actions}
        </View>
        {!!item.preview && <Image source={{ uri: item.preview.uri }} style={styles.storyPreview} fadeDuration={0} accessibilityLabel="Story preview" />}
        {!item.isRead && <View style={styles.dot} />}
      </Pressable>
      {menu}
    </Animated.View>
  );
}

/** A small button inside a row; its press never also opens the row. */
function ActionButton({ label, primary, compact, onPress }: { label: string; primary?: boolean; compact?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.action, compact && styles.actionCompact, primary && styles.actionPrimary, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

/** A face with a small badge of the kind, or the kind alone when there is no one to show. */
function Face({ item, size }: { item: NotificationItem; size: number }) {
  const look = lookOf(item.type);
  const badge = Math.round(size * 0.42);
  return (
    <View style={{ width: size, height: size }}>
      {item.actor?.avatarUrl ? (
        <Image source={{ uri: item.actor.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#27272D" }} />
      ) : (
        <View style={[styles.iconFace, { width: size, height: size, borderRadius: size / 2, backgroundColor: `${look.color}26` }]}>
          <Ionicons name={look.icon} size={size * 0.46} color={look.color} />
        </View>
      )}
      {!!item.actor && (
        <View style={[styles.kindBadge, { width: badge, height: badge, borderRadius: badge / 2, backgroundColor: look.color }]}>
          <Ionicons name={look.icon} size={badge * 0.55} color="#fff" />
        </View>
      )}
    </View>
  );
}

/** Up to three faces fanned out, for a stack. */
function AvatarPile({ items }: { items: NotificationItem[] }) {
  const faces = items.filter((item, index, all) => item.actor && all.findIndex((other) => other.actor?.id === item.actor?.id) === index).slice(0, 3);
  if (faces.length <= 1) return <Face item={faces[0] ?? items[0]} size={40} />;
  return (
    <View style={styles.pile}>
      {faces.map((item, index) => (
        <View key={item.id} style={[styles.pileFace, { left: index * 12, zIndex: 3 - index }]}>
          <Face item={item} size={30} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#100F0D" },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 44, marginBottom: 6, flexShrink: 0 },
  back: { width: 32, height: 40, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: "#F8F7F9", fontSize: 22, fontWeight: "700", includeFontPadding: false },
  markAll: {
    width: 36,
    height: 36,
    borderRadius: 18,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#232323",
  },
  markAllOff: { opacity: 0.35 },
  demoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 30,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 15,
    backgroundColor: "#302326",
    flexShrink: 0,
  },
  demoToggleOn: { backgroundColor: "#BA4059" },
  demoText: { color: "#F1B6C0", fontSize: 12, fontWeight: "700" },
  demoTextOn: { color: "#fff" },
  demoPanel: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginTop: 4, borderRadius: 16, backgroundColor: "#292024" },
  demoPanelTitle: { color: "#F3C1CA", fontSize: 13, fontWeight: "700" },
  demoPanelText: { color: "#C8BFC3", fontSize: 11, lineHeight: 16, marginTop: 3 },
  demoArrival: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 10, minHeight: 34, borderRadius: 17, backgroundColor: "#F3C1CA" },
  demoArrivalText: { color: "#33191F", fontSize: 11, fontWeight: "700" },
  chipsList: { height: 48, flexGrow: 0, flexShrink: 0 },
  chips: { paddingHorizontal: 16, gap: 6, paddingBottom: 8, alignItems: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 34,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: "#252426",
  },
  chipActive: { backgroundColor: "#F6CBD3" },
  chipText: { color: "#D8D5DC", fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#33191F" },
  chipCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3B383C",
  },
  chipCountActive: { backgroundColor: "#A83D56" },
  chipCountText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  feed: { flex: 1 },
  list: { paddingHorizontal: 16, flexGrow: 1 },
  sectionTitle: { color: "#B6B1BC", fontSize: 12, fontWeight: "700", paddingHorizontal: 2, paddingTop: 14, paddingBottom: 8, letterSpacing: 0.4 },
  notification: { marginBottom: 6 },
  notificationCard: { borderRadius: 16, overflow: "hidden" },
  notificationCompact: { borderRadius: 0 },
  notificationOptionsOpen: { backgroundColor: "#211B1E" },
  rowOptionsOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 16 },
  rowCompact: { paddingVertical: 9, borderRadius: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#363036" },
  rowUnread: { backgroundColor: "#211B1E" },
  rowPressed: { opacity: 0.75 },
  rowBody: { flex: 1, minWidth: 0 },
  rowText: { color: "#DFDBE2", fontSize: 14, lineHeight: 20 },
  lead: { color: "#F8F7FA", fontWeight: "700" },
  time: { color: "#A39BA8", fontSize: 11, lineHeight: 15, marginTop: 3 },
  storyReply: { color: "#C9BEC4", fontSize: 13, lineHeight: 18, marginTop: 4 },
  storyPreview: { width: 36, height: 48, borderRadius: 8, backgroundColor: "#302A30", flexShrink: 0 },
  dot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: "#F08A9B" },
  iconFace: { alignItems: "center", justifyContent: "center" },
  kindBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#100F0D",
  },
  pile: { width: 58, height: 40 },
  pileFace: { position: "absolute", top: 3, borderRadius: 17, borderWidth: 2, borderColor: "#100F0D" },
  stack: { backgroundColor: "#1C1B1E", borderRadius: 18, marginBottom: 8, overflow: "hidden" },
  stackUnread: { backgroundColor: "#211B1E" },
  stackHeader: { flexDirection: "row", alignItems: "center", paddingRight: 8 },
  stackSummary: { flex: 1, minWidth: 0, gap: 8, paddingVertical: 8, paddingRight: 8 },
  stackToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, minWidth: 44, minHeight: 34, paddingHorizontal: 6, borderRadius: 17, backgroundColor: "#302A30", flexShrink: 0 },
  stackCount: { color: "#C3BDC8", fontSize: 11, fontWeight: "700" },
  stackCountUnread: { color: "#F4A6B5" },
  loadingMore: { marginVertical: 18 },
  empty: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 24, paddingHorizontal: 24, gap: 10 },
  emptyKitten: { width: 180, height: 180, marginBottom: -18 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,173,182,0.12)",
  },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  emptyText: { color: "#AAAAB4", fontSize: 14, textAlign: "center", lineHeight: 20 },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 18, backgroundColor: "#2A2624" },
  retryText: { color: "#fff", fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 9 },
  action: {
    minHeight: 32,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#302A30",
  },
  actionCompact: { minHeight: 28, paddingHorizontal: 12 },
  actionPrimary: { backgroundColor: "#F6CBD3" },
  actionText: { color: "#EDE8F0", fontSize: 13, fontWeight: "700" },
  actionTextPrimary: { color: "#33191F" },
  done: { color: "#A39BA8", fontSize: 12, fontWeight: "600", marginTop: 8 },
});
