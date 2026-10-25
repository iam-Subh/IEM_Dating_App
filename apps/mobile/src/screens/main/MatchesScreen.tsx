import { UnverifiedNudge } from '../../features/verification/VerifyNudge';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, FadeIn, useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';
import { api } from '../../services/api';
import { useSocketEvent } from '../../services/useSocketEvent';
import { colors } from '../../core/theme/colors';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import type { LastMessage } from '../../store/chatSlice';
import { conversationPreview, type ReactionPreview } from '../../features/chat/conversationPreview';
import { ConversationPreviewLine } from '../../features/chat/components/ConversationPreviewLine';
import { LikesYouScreen } from './LikesYouScreen';
import { considerRatingPrompts } from '../../features/feedback/RatingPrompt';

type Tab = 'likes' | 'matches';
type MatchItem = {
  matchId: string;
  user: { id: string; name: string; age?: number | null; department?: string | null; avatar?: string | null };
  lastMessage: LastMessage | null;
  unreadCount?: number;
  reactionPreview?: ReactionPreview | null;
  matchedAt: string;
};

/**
 * Likes you | Matches. A Like is a match waiting to happen - Like back and
 * they move straight across - so the two live side by side, as on Hinge and
 * Bumble (STANDOUTS_LIKES_SPEC.md 7.3).
 */
export const MatchesScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>(route.params?.tab === 'likes' ? 'likes' : 'matches');
  // Waiting on your answer, and how many of them are new since you last looked.
  const [likes, setLikes] = useState({ total: 0, unseen: 0, rose: false });
  const [matchCount, setMatchCount] = useState<number>();
  const [emptyDemo, setEmptyDemo] = useState(false);
  const [tabsWidth, setTabsWidth] = useState(0);
  const selection = useDerivedValue(() => withTiming(tab === 'matches' ? 0 : 1, {
    duration: 220, easing: Easing.out(Easing.cubic),
  }));
  const selectionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: selection.value * Math.max(0, (tabsWidth - 8) / 2) }],
  }));

  // A notification (or any link) can ask for a tab.
  useEffect(() => {
    const wanted = route.params?.tab;
    if (wanted === 'likes' || wanted === 'matches') {
      setTab(wanted);
      navigation.setParams({ tab: undefined });
    }
  }, [route.params?.tab, navigation]);

  const readSummary = useCallback(() => {
    api
      .get('/discover/likes-you/summary')
      .then((response) => {
        const summary = response.data.data ?? {};
        setLikes({ total: summary.total ?? 0, unseen: summary.unseen ?? 0, rose: (summary.unseenRoses ?? 0) > 0 });
      })
      .catch(() => undefined);
  }, []);
  useFocusEffect(readSummary);
  // A calm moment for a rating ask, if one is due (features/feedback).
  useFocusEffect(useCallback(() => { void considerRatingPrompts('Matches'); }, []));
  // Live: the count moves the moment a Like lands or is answered anywhere.
  const likesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSocketEvent('likes_changed', () => {
    if (likesTimer.current) clearTimeout(likesTimer.current);
    likesTimer.current = setTimeout(readSummary, 300);
  }, { onReconnect: true });
  useEffect(() => () => { if (likesTimer.current) clearTimeout(likesTimer.current); }, []);
  // Opening the Likes tab is seeing them: the "new" part of the count clears.
  useEffect(() => {
    if (tab === 'likes') {
      setLikes((current) => ({ ...current, unseen: 0, rose: false }));
      setEmptyDemo(false);
    }
  }, [tab]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 4 }]}>
      <View style={styles.top}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Connections</Text>
          {__DEV__ && tab === 'matches' && <Pressable onPress={() => setEmptyDemo((value) => !value)}
            accessibilityRole="switch" accessibilityState={{ checked: emptyDemo }} accessibilityLabel="Preview no matches"
            style={({ pressed }) => [styles.demoButton, emptyDemo && styles.demoButtonActive, pressed && styles.pressed]}>
            <Ionicons name="flask-outline" size={13} color={emptyDemo ? '#331C23' : '#F3C1CA'} />
            <Text style={[styles.demoText, emptyDemo && styles.demoTextActive]}>{emptyDemo ? 'Exit demo' : 'Demo'}</Text>
          </Pressable>}
        </View>
        <View style={styles.tabs} accessibilityRole="tablist" onLayout={(event) => setTabsWidth(event.nativeEvent.layout.width)}>
          <Animated.View pointerEvents="none" style={[styles.selection, { width: Math.max(0, (tabsWidth - 8) / 2) }, selectionStyle]} />
          <TabButton key="matches" tone="matches" label="Matches" icon="people-outline" active={tab === 'matches'} onPress={() => setTab('matches')} count={emptyDemo ? 0 : matchCount} />
          <TabButton
            key="likes"
            tone="likes"
            label="Likes you"
            icon="heart-outline"
            active={tab === 'likes'}
            onPress={() => setTab('likes')}
            count={likes.total}
            fresh={likes.unseen > 0}
            rose={likes.rose}
          />
        </View>
      </View>
      <Animated.View key={tab} entering={FadeIn.duration(140)} style={styles.content}>
        {tab === 'likes' ? <LikesYouScreen embedded onChanged={readSummary} /> : <>
          <View style={[styles.content, emptyDemo && styles.hiddenContent]}><MatchesList onCount={setMatchCount} /></View>
          {emptyDemo && <ScrollView showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 112 }]}>
            <NoMatchesState />
          </ScrollView>}
        </>}
      </Animated.View>
    </View>
  );
};

function TabButton({ label, icon, tone, active, onPress, count, fresh, rose }: {
  label: string; icon: React.ComponentProps<typeof Ionicons>['name']; tone: Tab; active: boolean; onPress: () => void; count?: number; fresh?: boolean; rose?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count === undefined ? 'count loading' : count}${fresh ? rose ? ', new Rose' : ', new' : ''}`}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
    >
      <View style={styles.tabLabelRow}>
        <Ionicons name={icon} size={17} color={active ? '#331C23' : '#C9C2C5'} accessible={false} />
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
        <CountBadge count={count} tone={tone} fresh={fresh} rose={rose} />
      </View>
    </Pressable>
  );
}

function CountBadge({ count, tone = 'matches', fresh, rose }: {
  count?: number; tone?: Tab; fresh?: boolean; rose?: boolean;
}) {
  if (count === undefined || count <= 0) return null;
  return (
    <View style={[styles.count, tone === 'matches' ? styles.countMatches : styles.countLikes]}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.countText}>
        {count > 99 ? '99+' : count}
      </Text>
      {fresh && <View style={[styles.countNew, rose && styles.countNewRose]} />}
    </View>
  );
}

function MatchesList({ onCount }: { onCount: (count: number) => void }) {
  const currentUserId = useSelector((state: RootState) => state.auth.user?.id ?? '');
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<MatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await api.get('/match/pending');
      const matches: MatchItem[] = response.data.data ?? [];
      setItems(matches);
      onCount(matches.length);
    }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [onCount]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const newMatches = useMemo(() => items.filter((item) => !item.lastMessage), [items]);
  const conversations = useMemo(() => items.filter((item) => !!item.lastMessage), [items]);
  const openChat = (item: MatchItem) => navigation.navigate('ChatScreen', {
    matchId: item.matchId, userId: item.user.id, userName: item.user.name, userAvatar: item.user.avatar,
  });
  return (
    <FlatList
      style={styles.content}
      accessibilityLabel="Your matches"
      data={conversations}
      keyExtractor={(item) => item.matchId}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={load} tintColor="#F3C1CA" />}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 112 }]}
      ListHeaderComponent={
        <View>
          {/* Reminder 25 (GOOGLE_SIGNUP_PLAN.md 4): at most once a week. */}
          <UnverifiedNudge compact art="match" icon="chatbubbles-outline" text="Verify your college for unlimited chat and photos." dismissKey="matches-header" dismissDays={7} />
          {error && items.length > 0 && (
            <Pressable onPress={load} style={styles.refreshError} accessibilityRole="button">
              <Text style={styles.refreshErrorText}>Couldn't refresh. Tap to retry.</Text>
              <Ionicons name="refresh" size={16} color="#F3C1CA" />
            </Pressable>
          )}
          {newMatches.length > 0 && (
            <View style={styles.newSection}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle} accessibilityRole="header">New matches</Text>
                <CountBadge count={newMatches.length} />
              </View>
              <Text style={styles.sectionHint}>You matched. Start a conversation.</Text>
              <FlatList horizontal data={newMatches} keyExtractor={(item) => item.matchId}
                showsHorizontalScrollIndicator={false} contentContainerStyle={styles.newMatches}
                renderItem={({ item }) => (
                  <Pressable onPress={() => openChat(item)} accessibilityRole="button" accessibilityLabel={`Start a conversation with ${item.user.name}`}
                    style={({ pressed }) => [styles.matchCard, pressed && styles.pressed]}>
                    <View style={styles.matchPhoto}>
                      <MatchPhoto item={item} />
                      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.photoShade} />
                      <View style={styles.matchIdentity}>
                        <Text numberOfLines={1} style={styles.matchName}>{item.user.name}{item.user.age ? `, ${item.user.age}` : ''}</Text>
                        {!!item.user.department && <Text numberOfLines={1} style={styles.matchDepartment}>{item.user.department}</Text>}
                      </View>
                    </View>
                    <View style={styles.hello}>
                      <Ionicons name="chatbubble-outline" size={14} color="#331C23" />
                      <Text style={styles.helloText}>Say hello</Text>
                    </View>
                  </Pressable>
                )}
              />
            </View>
          )}
          {conversations.length > 0 && (
            <View style={[styles.sectionHead, styles.conversationsHead]}>
              <Text style={styles.sectionTitle} accessibilityRole="header">Conversations</Text>
              <Text style={styles.sectionCount}>{conversations.length}</Text>
            </View>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open chat with ${item.user.name}`}
          style={({ pressed }) => [styles.conversation, pressed && styles.conversationPressed]}
          onPress={() => openChat(item)}
        >
          <View style={styles.avatar}><MatchPhoto item={item} /></View>
          <View style={styles.copy}>
            <View style={styles.conversationHeading}>
              <Text numberOfLines={1} style={styles.name}>{item.user.name}{item.user.age ? `, ${item.user.age}` : ''}</Text>
              <Text style={styles.time}>{messageDate(item.lastMessage?.sentAt)}</Text>
            </View>
            {!!item.user.department && <Text numberOfLines={1} style={styles.meta}>{item.user.department}</Text>}
            <ConversationPreviewLine preview={conversationPreview({ lastMessage: item.lastMessage, currentUserId, peerName: item.user.name, reaction: item.reactionPreview })} accountId={currentUserId} unread={Boolean(item.unreadCount)} />
          </View>
          <Ionicons name="chevron-forward" size={15} color="#817A81" />
        </Pressable>
      )}
      ListEmptyComponent={items.length ? null : loading ? (
        <View style={styles.emptyBlock}>
          <ActivityIndicator accessibilityLabel="Loading matches" color="#F3C1CA" />
          <Text style={styles.emptyText}>Loading your matches…</Text>
        </View>
      ) : error ? (
        <View style={styles.emptyBlock}>
          <View style={styles.emptyIcon}><Ionicons name="cloud-offline-outline" size={34} color="#F3C1CA" /></View>
          <Text style={styles.emptyTitle}>Couldn't load matches</Text>
          <Text style={styles.emptyText}>Check your connection and try again.</Text>
          <Pressable onPress={load} accessibilityRole="button"
            style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}>
            <Text style={styles.emptyActionText}>Try again</Text>
            <Ionicons name="refresh" size={16} color="#331C23" />
          </Pressable>
        </View>
      ) : <NoMatchesState />}
    />
  );
}

function NoMatchesState() {
  const navigation = useNavigation<any>();
  return <View style={[styles.emptyBlock, styles.noMatchesBlock]}>
    <Image source={require('../../../assets/illustrations/matches-kitten.png')}
      style={styles.matchesKitten} resizeMode="contain" fadeDuration={0} accessible={false} />
    <Text style={styles.emptyTitle}>No matches yet</Text>
    <Text style={styles.emptyText}>A little hello starts with a mutual like. When you both like each other, your match appears here.</Text>
    <Pressable onPress={() => navigation.navigate('Dashboard')} accessibilityRole="button"
      style={({ pressed }) => [styles.emptyAction, pressed && styles.pressed]}>
      <Text style={styles.emptyActionText}>Explore people</Text>
      <Ionicons name="arrow-forward" size={16} color="#331C23" />
    </Pressable>
  </View>;
}

function MatchPhoto({ item }: { item: MatchItem }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.user.avatar]);
  return item.user.avatar && !failed
    ? <Image accessible={false} source={{ uri: item.user.avatar }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} onError={() => setFailed(true)} />
    : <View style={styles.photoFallback}><Text style={styles.initial}>{item.user.name.trim().charAt(0).toUpperCase() || '?'}</Text></View>;
}

function messageDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  top: { width: '100%', maxWidth: 600, alignSelf: 'center' },
  header: { minHeight: 48, paddingHorizontal: 20, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 27, letterSpacing: -0.6 },
  content: { flex: 1 },
  hiddenContent: { display: 'none' },
  demoButton: { minHeight: 34, paddingHorizontal: 12, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#422830' },
  demoButtonActive: { backgroundColor: '#F3C1CA' },
  demoText: { color: '#F3C1CA', fontFamily: 'DMSans_700Bold', fontSize: 12 },
  demoTextActive: { color: '#331C23' },
  tabs: { flexDirection: 'row', marginHorizontal: 16, padding: 4, marginBottom: 8, borderRadius: 25, backgroundColor: '#242124', overflow: 'hidden' },
  selection: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 22, backgroundColor: '#F3C1CA', zIndex: 0 },
  tab: { flex: 1, minWidth: 0, minHeight: 42, justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 8, zIndex: 1, overflow: 'hidden' },
  tabLabelRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  tabText: { minWidth: 0, flexShrink: 1, color: '#C9C2C5', fontSize: 14, fontFamily: 'DMSans_700Bold' },
  tabTextActive: { color: '#331C23' },
  count: {
    width: 22,
    height: 22,
    borderRadius: 11,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countMatches: { backgroundColor: '#383039' },
  countLikes: { backgroundColor: '#653746' },
  countText: { maxWidth: '90%', color: '#FFFFFF', fontSize: 12, lineHeight: 16, includeFontPadding: false, textAlign: 'center', fontFamily: 'DMSans_700Bold', fontVariant: ['tabular-nums'] },
  countNew: { position: 'absolute', top: -1, right: -1, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  countNewRose: { backgroundColor: '#C2185B' },
  list: { flexGrow: 1, paddingTop: 12, width: '100%', maxWidth: 600, alignSelf: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  sectionTitle: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 18 },
  sectionCount: { color: '#BDB3BB', fontFamily: 'DMSans_500Medium', fontSize: 13 },
  sectionHint: { color: '#BDB3BB', fontFamily: 'DMSans_400Regular', fontSize: 13, marginTop: 4, paddingHorizontal: 20 },
  newSection: { marginBottom: 24 },
  newMatches: { paddingHorizontal: 16, paddingTop: 14, gap: 10 },
  matchCard: { width: 142, borderRadius: 20, overflow: 'hidden', backgroundColor: '#262126' },
  matchPhoto: { height: 174, backgroundColor: '#302830', overflow: 'hidden' },
  photoShade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%' },
  matchIdentity: { position: 'absolute', bottom: 12, left: 12, right: 10 },
  matchName: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 17 },
  matchDepartment: { color: '#E2D9DD', fontFamily: 'DMSans_400Regular', fontSize: 11, marginTop: 3 },
  hello: { minHeight: 38, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F3C1CA' },
  helloText: { color: '#331C23', fontFamily: 'DMSans_700Bold', fontSize: 12 },
  conversationsHead: { marginBottom: 6 },
  conversation: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 20 },
  conversationPressed: { backgroundColor: '#221E22' },
  avatar: { width: 58, height: 64, borderRadius: 18, overflow: 'hidden', backgroundColor: '#302830' },
  photoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3B2B34' },
  initial: { color: '#F3C1CA', fontFamily: 'DMSans_700Bold', fontSize: 28 },
  copy: { flex: 1, minWidth: 0 },
  conversationHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: '#FFFFFF', fontSize: 16, fontFamily: 'DMSans_700Bold' },
  time: { color: '#AFA4AE', fontSize: 10, fontFamily: 'DMSans_400Regular' },
  meta: { color: '#BDB3BB', fontSize: 11, marginTop: 2, fontFamily: 'DMSans_400Regular' },
  message: { color: '#DBD3D9', fontSize: 13, marginTop: 5, fontFamily: 'DMSans_400Regular' },
  pressed: { opacity: 0.75 },
  emptyBlock: { alignItems: 'center', paddingHorizontal: 36, paddingTop: 60, gap: 14 },
  noMatchesBlock: { paddingTop: 28, gap: 12 },
  matchesKitten: { width: 124, height: 186, marginBottom: 4 },
  emptyIcon: { width: 80, height: 80, borderRadius: 28, backgroundColor: '#30232B', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 22, textAlign: 'center' },
  emptyText: { color: '#BDB3BB', fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  emptyAction: { minHeight: 44, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F3C1CA', marginTop: 6 },
  emptyActionText: { color: '#331C23', fontFamily: 'DMSans_700Bold', fontSize: 14 },
  refreshError: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: '#30232B', flexDirection: 'row', alignItems: 'center', gap: 10 },
  refreshErrorText: { flex: 1, color: '#F3C1CA', fontSize: 13 },
});
