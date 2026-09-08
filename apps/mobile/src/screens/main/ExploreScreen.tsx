import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DiscoveryCard } from '@iem-dating/shared';
import { api } from '../../services/api';
import { colors } from '../../core/theme/colors';
import { INTEREST_CATEGORIES } from '@iem-dating/shared/interest-catalog';

type ExploreCard = DiscoveryCard & { followStatus: 'pending' | 'accepted' | null };
type Category = 'for_you' | 'new_here' | 'active' | 'shared_interests' | 'same_department';
const categories: { id: Category; label: string }[] = [
  { id: 'for_you', label: 'For you' },
  { id: 'new_here', label: 'New here' },
  { id: 'active', label: 'Active' },
  { id: 'shared_interests', label: 'Shared interests' },
  { id: 'same_department', label: 'My department' },
];
const interestChoices = INTEREST_CATEGORIES.flatMap((group) => group.interests).slice(0, 16);

export const ExploreScreen = () => {
  const [category, setCategory] = useState<Category>('for_you');
  const [cards, setCards] = useState<ExploreCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
  const seen = useRef(new Set<string>());

  const load = useCallback(async (reset = false) => {
    if (loading) return;
    setLoading(true);
    setPrivacyNotice(null);
    try {
      const response = await api.get('/search/explore', { params: { category, limit: 20, cursor: reset ? undefined : cursor ?? undefined, interests: selectedInterests.join(',') || undefined } });
      const data = response.data.data;
      setCards((current) => reset ? data.cards : [...current, ...data.cards.filter((card: ExploreCard) => !current.some((item) => item.id === card.id))]);
      setCursor(data.nextCursor);
    } catch (cause: any) {
      const code = cause?.response?.data?.code;
      if (code === 'EXPLORE_COHORT_TOO_SMALL') {
        setCards([]);
        setCursor(null);
        setPrivacyNotice('This filter is unavailable because the eligible group is too small. Select a broader filter.');
      } else if (code === 'EXPLORE_FILTER_COMBINATION_LIMIT') {
        setCards([]);
        setCursor(null);
        setPrivacyNotice('Use no more than two filter dimensions. A category counts as one dimension.');
      } else {
        setPrivacyNotice('Explore could not load. Check your connection and try again.');
      }
    } finally { setLoading(false); }
  }, [category, cursor, loading, selectedInterests]);

  useEffect(() => { setCards([]); setCursor(null); seen.current.clear(); load(true); }, [category, selectedInterests.join(',')]);

  const follow = async (card: ExploreCard) => {
    if (card.followStatus) return;
    const confirmed = await new Promise<boolean>((resolve) => Alert.alert(
      'Send follow request?',
      `${card.name} will immediately see your profile and that you requested to follow them. Dating Likes stay private unless you both Like each other.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Send request', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ));
    if (!confirmed) return;
    await api.post('/stories/follows', { userId: card.id, disclosureAccepted: true });
    setCards((current) => current.map((item) => item.id === card.id ? { ...item, followStatus: 'pending' } : item));
  };

  const swipe = async (card: ExploreCard, action: 'like' | 'pass') => {
    await api.post('/discover/visible', { impressionId: card.impressionId }).catch(() => undefined);
    await api.post('/discover/swipe', { targetId: card.id, action });
    setCards((current) => current.filter((item) => item.id !== card.id));
  };

  const visible = useRef(({ viewableItems }: any) => {
    for (const view of viewableItems) {
      const card = view.item as ExploreCard;
      if (!seen.current.has(card.impressionId)) {
        seen.current.add(card.impressionId);
        api.post('/discover/visible', { impressionId: card.impressionId }).catch(() => undefined);
      }
    }
  }).current;

  return <View style={styles.container}>
    <Text style={styles.title}>Explore</Text>
    <FlatList horizontal data={categories} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false}
      accessibilityLabel="Explore categories"
      contentContainerStyle={styles.categories} renderItem={({ item }) => <Pressable accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked: category === item.id }} onPress={() => { setCategory(item.id); if (item.id !== 'for_you') setSelectedInterests((values) => values.slice(-1)); }} style={[styles.category, category === item.id && styles.categoryActive]}>
        <Text style={[styles.categoryText, category === item.id && styles.categoryTextActive]}>{item.label}</Text>
      </Pressable>} />
    <FlatList horizontal data={interestChoices} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.interests}
      accessibilityLabel="Interest filters"
      renderItem={({ item }) => { const active = selectedInterests.includes(item.id); return <Pressable accessibilityRole="checkbox" accessibilityLabel={item.label} accessibilityState={{ checked: active }} onPress={() => setSelectedInterests((values) => active ? values.filter((value) => value !== item.id) : [...values, item.id].slice(category === 'for_you' ? -2 : -1))} style={[styles.interest, active && styles.interestActive]}><Text style={[styles.interestText, active && styles.categoryTextActive]}>{item.label}</Text></Pressable>; }} />
    {!!privacyNotice && <Text accessibilityLiveRegion="polite" style={styles.privacyNotice}>{privacyNotice}</Text>}
    <FlatList accessibilityLabel="Eligible profiles" data={cards} numColumns={2} keyExtractor={(item) => item.id} onViewableItemsChanged={visible}
      viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 700 }}
      contentContainerStyle={styles.grid} columnWrapperStyle={styles.row}
      refreshControl={<RefreshControl refreshing={loading && cards.length > 0} onRefresh={() => load(true)} tintColor={colors.primary} />}
      onEndReached={() => cursor && load()} onEndReachedThreshold={0.5}
      ListFooterComponent={loading ? <ActivityIndicator color={colors.primary} /> : null}
      ListEmptyComponent={!loading ? <View><Text style={styles.empty}>No eligible profiles in this category.</Text>{cursor && <Pressable onPress={() => load()}><Text style={styles.more}>Check more profiles</Text></Pressable>}</View> : null}
      renderItem={({ item }) => <View style={styles.card}>
        <Image accessible accessibilityLabel={`${item.name}'s profile photo`} source={{ uri: item.primaryPhoto ?? undefined }} style={styles.photo} />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{item.name}{item.age ? `, ${item.age}` : ''}</Text>
          <Text style={styles.meta} numberOfLines={1}>{item.department ?? item.college ?? 'IEM student'}</Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Pass ${item.name}`} onPress={() => swipe(item, 'pass')} style={styles.circle}><Ionicons name="close" size={20} color={colors.text.secondary} /></Pressable>
            {item.canRequestFollow ? <Pressable accessibilityRole="button" accessibilityLabel={item.followStatus === 'accepted' ? `Following ${item.name}` : item.followStatus === 'pending' ? `Follow request pending for ${item.name}` : `Request to follow ${item.name}`} accessibilityState={{ disabled: item.followStatus !== null }} disabled={item.followStatus !== null} onPress={() => follow(item)} style={styles.circle}><Ionicons name={item.followStatus === 'accepted' ? 'people' : item.followStatus === 'pending' ? 'time' : 'person-add'} size={17} color={colors.secondary} /></Pressable> : <View accessible={false} style={styles.circle} />}
            <Pressable accessibilityRole="button" accessibilityLabel={`Like ${item.name}`} onPress={() => swipe(item, 'like')} style={styles.circle}><Ionicons name="heart" size={19} color={colors.primary} /></Pressable>
          </View>
        </View>
      </View>} />
  </View>;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 58 },
  title: { color: colors.text.primary, fontSize: 32, fontWeight: '800', paddingHorizontal: 20, marginBottom: 14 },
  categories: { paddingHorizontal: 16, gap: 8, paddingBottom: 14 },
  interests: { paddingHorizontal: 16, gap: 7, paddingBottom: 12 }, interest: { paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: colors.surface, justifyContent: 'center' }, interestActive: { backgroundColor: colors.secondary }, interestText: { color: colors.text.secondary, fontSize: 12 },
  privacyNotice: { color: colors.text.secondary, fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingBottom: 8 },
  category: { height: 36, paddingHorizontal: 15, borderRadius: 18, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  categoryActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryText: { color: colors.text.secondary, fontWeight: '600' }, categoryTextActive: { color: '#fff' },
  grid: { paddingHorizontal: 12, paddingBottom: 120, flexGrow: 1 }, row: { gap: 10 },
  card: { flex: 1, maxWidth: '50%', backgroundColor: colors.surface, borderRadius: 18, overflow: 'hidden', marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  photo: { width: '100%', aspectRatio: 0.8, backgroundColor: '#211b1f' }, info: { padding: 10 },
  name: { color: colors.text.primary, fontSize: 17, fontWeight: '700' }, meta: { color: colors.text.tertiary, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  circle: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.text.secondary, textAlign: 'center', marginTop: 80, paddingHorizontal: 30 },
  more: { color: colors.primary, textAlign: 'center', marginTop: 14, fontWeight: '700' },
});
