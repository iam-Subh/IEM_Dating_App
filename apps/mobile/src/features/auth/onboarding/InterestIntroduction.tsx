import React, {memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Keyboard, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import type {TextInputProps} from 'react-native';
import {KeyboardAvoidingView, useKeyboardState, useReanimatedKeyboardAnimation} from 'react-native-keyboard-controller';
import type {SharedValue} from 'react-native-reanimated';
import Animated, {dispatchCommand, interpolate, runOnJS, runOnUI, scrollTo, useAnimatedProps, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useDerivedValue, useEvent, useSharedValue} from 'react-native-reanimated';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {LinearGradient} from 'expo-linear-gradient';
import {Ionicons} from '@expo/vector-icons';
import {CommonActions, useFocusEffect, useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {INTEREST_CATEGORIES} from '@iem-dating/shared/interest-catalog';
import {PROFILE_CLUBS} from '../../../core/profile/profileOptions';
import {CLUB_LIMIT, INTEREST_LIMIT, InterestGroupView} from './InterestGroupView';
import {afterScreenTransition} from './afterScreenTransition';
import {useOptionalSave} from './useOptionalSave';
import {interestEmojis, interestGradient} from './InterestVisuals';
import {ConnectionFooter, ConnectionNav, ConnectionSheetHeader, TapChoice, connectionColors as c, connectionStyles as shared} from './ConnectionDesign';
import {EditScreenHeader} from '../../../components/EditScreenHeader';
import {EditSaveFooter} from '../../../components/EditSaveFooter';
import {FormSheet} from '../../../components/ProfileEditForms';

export type InterestGroup = {id: string; title: string; icon: string; interests: {id: string; label: string}[]};
const categoryNames: Record<string, string> = {creativity: 'Creativity', fan_favorites: 'Favourites', food_and_drink: 'Food', gaming: 'Gaming', going_out: 'Going out', music: 'Music', outdoors: 'Outdoors', social_and_content: 'Social', sports_and_fitness: 'Sport', tv_and_movies: 'Films', values_and_causes: 'Causes', wellness_and_lifestyle: 'Wellness', college_clubs: 'Clubs'};
const categoryIcons: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  creativity: 'color-palette-outline', fan_favorites: 'star-outline', food_and_drink: 'restaurant-outline',
  gaming: 'game-controller-outline', going_out: 'location-outline', music: 'musical-notes-outline',
  outdoors: 'trail-sign-outline', social_and_content: 'phone-portrait-outline', sports_and_fitness: 'barbell-outline',
  tv_and_movies: 'film-outline', values_and_causes: 'earth-outline', wellness_and_lifestyle: 'leaf-outline', college_clubs: 'people-outline',
};
const groups: InterestGroup[] = [
  ...['fan_favorites', 'music', 'gaming', 'creativity', 'food_and_drink', 'going_out', 'outdoors', 'sports_and_fitness', 'tv_and_movies', 'social_and_content', 'values_and_causes', 'wellness_and_lifestyle'].map(id => INTEREST_CATEGORIES.find(group => group.id === id)!),
  {id: 'college_clubs', title: 'College clubs', icon: 'people-outline', interests: PROFILE_CLUBS.map(label => ({id: label, label}))},
];
const interestOnlyGroups = groups.filter(group => group.id !== 'college_clubs');
// Tags that fill the first screen render with the page. The rest follow a
// few per frame once it has appeared, so no frame blocks a tap or Back.
const FIRST_TAGS = groups[0].interests.length + groups[1].interests.length;
const TAGS_PER_FRAME = 12;
const TOTAL_TAGS = groups.reduce((total, group) => total + group.interests.length, 0);
const catalog = new Map(INTEREST_CATEGORIES.flatMap(group => group.interests).map(option => [option.id, option.label]));
const searchIndex = groups.map(group => group.interests.map(option => option.label.toLowerCase()));
export type InterestSelection = {interests: string[]; clubs: string[]; revision: number};
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

import {InterestArtwork} from './OnboardingFormArtwork';

// Plain views: fourteen tabs each with a gesture and three animation hooks
// were a large part of the time this page took to open.
const InterestCategory = memo(function InterestCategory({id, label, selected, busy, onSelect, dark = false}: {id: string; label: string; selected: boolean; busy: boolean; onSelect: (id: string) => void; dark?: boolean}) {
  const content = <View style={[s.tab, dark && d.tab, selected && (dark ? d.tabSelected : s.tabSelected)]}><Text style={[s.tabLabel, dark && d.muted, selected && (dark ? d.accent : s.tabLabelSelected)]}>{label}</Text></View>;
  if (dark) return <TapChoice accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{selected, disabled: busy}} disabled={busy} onPress={() => onSelect(id)} style={s.tabTouch}>{content}</TapChoice>;
  return <View accessible accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{selected, disabled: busy}}
    onAccessibilityTap={() => {if (!busy) onSelect(id);}} onStartShouldSetResponder={() => !busy} onResponderRelease={() => onSelect(id)} style={s.tabTouch}>
    {content}
  </View>;
});

// Its own component: each step of mounting renders only new tags, not the page.
const InterestCatalog = memo(function InterestCatalog({ready, category, interests, clubs, busy, onToggle, dark = false, includeClubs = true}: {
  ready: boolean; category: SharedValue<string>; interests: string[]; clubs: string[]; busy: boolean; dark?: boolean; includeClubs?: boolean; onToggle: (id: string, club: boolean) => boolean | undefined;
}) {
  const [mountedTags, setMountedTags] = useState(FIRST_TAGS);
  useEffect(() => {
    if (!ready || mountedTags >= TOTAL_TAGS) return;
    const frame = requestAnimationFrame(() => setMountedTags(count => count + TAGS_PER_FRAME));
    return () => cancelAnimationFrame(frame);
  }, [ready, mountedTags]);
  let remaining = mountedTags;
  return <>{(includeClubs ? groups : interestOnlyGroups).map(group => {
    if (remaining <= 0) return null;
    const options = remaining >= group.interests.length ? group.interests : group.interests.slice(0, remaining);
    remaining -= group.interests.length;
    return <InterestGroupView dark={dark} key={group.id} icon={categoryIcons[group.id]} group={group} options={options} category={category}
      selected={group.id === 'college_clubs' ? clubs : interests} busy={busy} onToggle={onToggle}/>;
  })}</>;
});

export function InterestIntroduction() {
  const o = useOptionalSave();
  return <InterestForm controller={o}/>;
}

export type InterestFormController = {
  data: {preferences?: Record<string, any>; clubs?: string[]}; navigation: any; route: any;
  editing: boolean; busy: boolean; error: string; action: string; back: () => void;
  skip?: () => void; draft: (fields: Record<string, any>) => void;
  saveOptional: (fields: Record<string, any>) => void | Promise<void>;
};

export function InterestForm({controller: o, dark = false, includeClubs = true}: {controller: InterestFormController; dark?: boolean; includeClubs?: boolean}) {
  const busy = o.busy;
  const [reviewSelection, setReviewSelection] = useState<InterestSelection | null>(null);
  const [savedSelection, setSavedSelection] = useState<InterestSelection>(() => ({interests: o.editing ? o.data.preferences?.interests ?? [] : [], clubs: includeClubs && o.editing ? o.data.clubs ?? [] : [], revision: 0}));
  const [saveChanged, setSaveChanged] = useState(false);
  const choices = useSharedValue(savedSelection);
  const selectionRef = useRef(savedSelection);
  if (savedSelection.revision >= selectionRef.current.revision) selectionRef.current = savedSelection;
  const openingReview = useSharedValue(false);
  const reviewPressed = useSharedValue(false);
  const navigation = o.navigation;
  const focused = useIsFocused();
  const firstFocus = useRef(true);
  const latestData = useRef(o.data);
  latestData.current = o.data;
  const returnKey = o.route.key;
  const reviewRoute = dark ? 'ProfileInterestSelectionReview' : 'InterestSelectionReview';
  const nativeReview = Platform.OS !== 'web' || !dark;
  // Mount the native sheet before a tap. Rebuild it after closing as well.
  useFocusEffect(useCallback(() => {
    // A preloaded editor must use the latest saved answers when it becomes visible.
    // Do not reset answers when the selection sheet returns to this screen.
    if (firstFocus.current) {
      firstFocus.current = false;
      if (o.editing) {
        const data = latestData.current;
        const current = selectionRef.current;
        const interests: string[] = data.preferences?.interests ?? [];
        const clubs: string[] = includeClubs ? data.clubs ?? [] : [];
        const changed = interests.length !== current.interests.length || clubs.length !== current.clubs.length
          || interests.some((id, index) => id !== current.interests[index]) || clubs.some((id, index) => id !== current.clubs[index]);
        if (changed) {
          const next = {interests, clubs, revision:choices.value.revision + 1};
          choices.value = next;
          setSavedSelection(next);
          selectionRef.current = next;
        }
      }
    }
    openingReview.value = false;
    reviewPressed.value = false;
    if (nativeReview) return afterScreenTransition(navigation, () => navigation.preload(reviewRoute, {...selectionRef.current, returnKey}));
  }, [navigation, returnKey, openingReview, reviewPressed, choices, o.editing, includeClubs, nativeReview, reviewRoute]));
  const {interests, clubs} = savedSelection;
  const updateSaveState = useCallback((next: InterestSelection) => {
    if (!dark) return;
    const initialInterests: string[] = latestData.current.preferences?.interests ?? [];
    const initialClubs: string[] = latestData.current.clubs ?? [];
    setSaveChanged(next.interests.length !== initialInterests.length || next.interests.some(id => !initialInterests.includes(id))
      || (includeClubs && (next.clubs.length !== initialClubs.length || next.clubs.some(id => !initialClubs.includes(id)))));
  }, [dark, includeClubs]);
  // Ignore older updates, such as a sheet's removals arriving after a newer tap.
  const commitSelection = useCallback((next: InterestSelection) => setSavedSelection(previous => next.revision > previous.revision ? next : previous), []);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // Read and write the ref, not the state: two taps inside one frame must
  // both count. The shared value drives the count and the View button.
  const toggle = useCallback((id: string, club: boolean) => {
    if (busyRef.current || (club && !includeClubs)) return;
    const previous = selectionRef.current;
    const values = club ? previous.clubs : previous.interests;
    const has = values.includes(id);
    if (!has && values.length >= (club ? CLUB_LIMIT : INTEREST_LIMIT)) return;
    const next = {...previous, [club ? 'clubs' : 'interests']: has ? values.filter(value => value !== id) : [...values, id], revision: previous.revision + 1};
    selectionRef.current = next;
    choices.value = next;
    // Update Save before the catalogue's deferred render.
    updateSaveState(next);
    // Paint the tapped item before updating the rest of the catalogue.
    startTransition(() => commitSelection(next));
    return !has;
  }, [choices, commitSelection, includeClubs, updateSaveState]);
  const search = useSharedValue('');
  const category = useSharedValue('all');
  const [activeCategory, setActiveCategory] = useState('all');
  const selectCategory = useCallback((id: string) => {
    if (busyRef.current) return;
    category.value = id;
    setActiveCategory(id);
  }, [category]);
  const inputEventCount = useSharedValue(0);
  const {progress} = useReanimatedKeyboardAnimation();
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  // A completed hide must restore the page, even if the last animation frame was missed.
  const keyboardProgress = useDerivedValue(() => keyboardVisible ? progress.value : 0, [keyboardVisible]);
  const {fontScale} = useWindowDimensions();
  const heroHeight = useSharedValue(134 * fontScale);
  const headerStyle = useAnimatedStyle(() => ({paddingTop: interpolate(keyboardProgress.value, [0, 1], [18, 6])}));
  const heroStyle = useAnimatedStyle(() => ({height: interpolate(keyboardProgress.value, [0, 1], [heroHeight.value, 48 * fontScale])}));
  const expandedStyle = useAnimatedStyle(() => ({opacity: Math.max(0, 1 - keyboardProgress.value * 2), transform: [{translateY: -keyboardProgress.value * 12}]}));
  const compactStyle = useAnimatedStyle(() => ({opacity: Math.max(0, keyboardProgress.value * 2 - 1), transform: [{translateY: (1 - keyboardProgress.value) * 8}]}));
  const tabsStyle = useAnimatedStyle(() => ({height: 48 * (1 - keyboardProgress.value), opacity: 1 - keyboardProgress.value}));
  const list = useAnimatedRef<Animated.ScrollView>();
  // A virtual list mounted each row as it scrolled in: a fast fling outran it
  // and showed blank space. Every group mounts once instead, so scrolling is
  // native work alone. Mounting waits until the page has slid in.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!focused || ready) return;
    const fallback = setTimeout(() => setReady(true), 800);
    const cancel = afterScreenTransition(navigation, () => setReady(true));
    return () => {clearTimeout(fallback); cancel();};
  }, [focused, ready, navigation]);
  const searchInput = useAnimatedRef<TextInput>();
  const returnedSelection = o.route.params?.interestSelection;
  useLayoutEffect(() => {
    if (returnedSelection) {
      const next = {...returnedSelection, clubs: includeClubs ? returnedSelection.clubs ?? [] : [], revision: choices.value.revision + 1};
      selectionRef.current = next;
      choices.value = next;
      updateSaveState(next);
      commitSelection(next);
    }
  }, [returnedSelection, includeClubs, updateSaveState]);
  useEffect(() => {
    // Preparing a hidden editor must not write its initial values to the draft.
    if (!focused) return;
    const timer = setTimeout(() => {
      o.draft({...includeClubs && {clubs}, preferences: {...o.data.preferences, interests}});

    }, 350);
    return () => clearTimeout(timer);
  }, [interests, clubs, focused, includeClubs]);
  // A search renders only its matches, usually a handful, above a hidden
  // catalogue. Hiding tags one by one needed refs on every tag.
  const query = useDerivedValue(() => search.value.trim().toLowerCase());
  const [resultsQuery, setResultsQuery] = useState('');
  useAnimatedReaction(() => query.value, (current, previous) => {
    if (previous !== null && current !== previous) runOnJS(setResultsQuery)(current);
  });
  const visibleGroups = includeClubs ? groups : interestOnlyGroups;
  const results = useMemo(() => resultsQuery ? visibleGroups.map((group, index) => ({group, options: group.interests.filter((_option, option) => searchIndex[index][option].includes(resultsQuery))}))
    .filter(result => result.options.length) : [], [resultsQuery, visibleGroups]);
  useEffect(() => {if (resultsQuery) setActiveCategory('all');}, [resultsQuery]);
  useAnimatedReaction(() => `${category.value}\n${query.value}`, (current, previous) => {
    if (previous !== null && current !== previous) scrollTo(list, 0, 0, false);
  });
  const textChange = useEvent<{text: string; eventCount: number}>(event => {
    'worklet';
    inputEventCount.value = event.eventCount;
    search.value = event.text;
    if (event.text) category.value = 'all';
  }, ['onChange']);
  const clearStyle = useAnimatedStyle(() => ({opacity: search.value ? 1 : 0, pointerEvents: search.value && !busy ? 'auto' : 'none'}));
  const clearAccessibility = useAnimatedProps(() => ({importantForAccessibility: search.value ? 'auto' as const : 'no-hide-descendants' as const, accessibilityState: {disabled: !search.value || busy}}));
  const count = interests.length + clubs.length;
  const selectionCount = useAnimatedProps<TextInputProps & {text: string}>(() => {
    const total = choices.value.interests.length + choices.value.clubs.length;
    return {text: total ? `${total} selected` : 'Find a few favourites', accessibilityLabel: total ? `${total} selected` : 'Find a few favourites'};
  });
  const reviewStyle = useAnimatedStyle(() => ({opacity: choices.value.interests.length + choices.value.clubs.length ? (reviewPressed.value || openingReview.value ? 0.65 : 1) : 0.4}));
  const reviewAccessibility = useAnimatedProps(() => ({accessibilityState: {disabled: busy || openingReview.value || !(choices.value.interests.length + choices.value.clubs.length)}}));
  const limitStyle = useAnimatedStyle(() => ({display: choices.value.interests.length >= 100 ? 'flex' : 'none'}));
  const clearSearch = () => {
    'worklet';
    if (busy || !search.value) return;
    search.value = '';
    category.value = 'all';
    dispatchCommand(searchInput, 'setTextAndSelection', [inputEventCount.value, '', 0, 0]);
    dispatchCommand(searchInput, 'blur');
  };
  const clearTap = Gesture.Tap().maxDistance(8).enabled(!o.busy).onEnd((_event, success) => {if (success) clearSearch();});
  const review = useCallback((current: InterestSelection) => {
    if (!nativeReview) {setReviewSelection({...current}); Keyboard.dismiss(); return;}
    navigation.navigate(reviewRoute, {interests: current.interests, clubs: current.clubs, returnKey});
    Keyboard.dismiss();
  }, [navigation, returnKey, nativeReview, reviewRoute]);
  const openReview = () => {
    'worklet';
    const current = choices.value;
    if (busy || openingReview.value || !(current.interests.length + current.clubs.length)) return;
    openingReview.value = true;
    runOnJS(review)(current);
  };
  const reviewTap = Gesture.Tap().maxDistance(8).enabled(!busy)
    .onBegin(() => {reviewPressed.value = true;})
    .onEnd((_event, success) => {if (success) openReview();})
    .onFinalize(() => {reviewPressed.value = false;});
  const changed = saveChanged;
  const save = () => {Keyboard.dismiss(); const current = choices.value; o.saveOptional({...includeClubs && {clubs: current.clubs}, preferences: {...o.data.preferences, interests: current.interests}});};
  const removeSelection = (kind: 'interests' | 'clubs', id: string) => {
    const current = selectionRef.current;
    const next = {...current, [kind]: current[kind].filter(value => value !== id), revision: current.revision + 1};
    selectionRef.current = next; choices.value = next; updateSaveState(next); commitSelection(next); setReviewSelection(next);
  };
  const closeReview = () => {setReviewSelection(null); openingReview.value = false; reviewPressed.value = false;};
  const clearControl = <Animated.View style={[s.clearCircle, dark && d.surface]}><Ionicons name="close" size={17} color={dark ? '#BDB5AF' : c.muted}/></Animated.View>;
  const reviewControl = <><Text style={[shared.link, dark && d.accent]}>View</Text><Ionicons name="chevron-forward" size={15} color={dark ? '#F3C1CA' : c.primary}/></>;
  return <View style={[shared.page, dark && d.page]}>
    <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor={dark ? '#100F0D' : c.canvas}/>
    {dark ? <EditScreenHeader title="Interests" onCancel={o.back} onSave={save} saving={busy} hasUnsavedChanges={changed} showSave={false}/> : <ConnectionNav onBack={o.back} onSkip={o.skip} busy={o.busy}/>}
    <KeyboardAvoidingView style={{flex: 1}} behavior="padding" automaticOffset enabled={keyboardVisible}>
      <Animated.View style={[s.fixedHeader, headerStyle]}>
        <Animated.View style={[s.heroFrame, heroStyle]}>
          <Animated.View pointerEvents="none" onLayout={event => {heroHeight.value = event.nativeEvent.layout.height;}} style={[s.hero, expandedStyle]}>
            <View style={s.heroCopy}><Text accessibilityRole="header" style={[shared.title, s.title, dark && d.text]}>What are{'\n'}you into?</Text>{!dark && <Text style={shared.subtitle}>Pick the things you enjoy.</Text>}</View>
            <View style={s.art}><InterestArtwork/></View>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[s.compactHero, compactStyle]}><Text accessible={false} style={[shared.title, s.searchTitle, dark && d.text]}>What are you into?</Text></Animated.View>
        </Animated.View>
        <View style={[s.search, dark && d.surface]}>
          <Ionicons name="search-outline" size={19} color={dark ? '#BDB5AF' : c.muted}/>
          <AnimatedTextInput ref={searchInput} accessibilityLabel={includeClubs ? "Search interests and college clubs" : "Search interests"} editable={!o.busy} defaultValue="" onChange={Platform.OS === 'web' ? undefined : textChange as unknown as NonNullable<TextInputProps['onChange']>} onChangeText={Platform.OS === 'web' ? text => {search.value = text; if (text) category.value = 'all';} : undefined} placeholder="Search interests" placeholderTextColor={dark ? '#9D958F' : '#9A8792'} selectionColor={dark ? '#F3C1CA' : c.primary} returnKeyType="search" onSubmitEditing={Keyboard.dismiss} autoCorrect={false} style={[s.searchInput, dark && d.text]}/>
          {Platform.OS === 'web' ? <TapChoice accessibilityRole="button" accessibilityLabel="Clear search" disabled={!resultsQuery || busy} onPress={() => {search.value = ''; category.value = 'all'; searchInput.current?.clear();}} style={[s.clear, {opacity: resultsQuery ? 1 : 0}]}>{clearControl}</TapChoice> : <GestureDetector gesture={clearTap}><Animated.View accessible accessibilityRole="button" accessibilityLabel="Clear search" animatedProps={clearAccessibility} onAccessibilityTap={() => runOnUI(clearSearch)()} style={[s.clear, clearStyle]}>{clearControl}</Animated.View></GestureDetector>}
        </View>
        <Animated.View style={[s.tabsFrame, tabsStyle]}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs} keyboardShouldPersistTaps="handled">
          {[{id: 'all', title: 'All'}, ...visibleGroups].map(group => <InterestCategory dark={dark} key={group.id} id={group.id} label={categoryNames[group.id] ?? group.title} selected={activeCategory === group.id} busy={o.busy} onSelect={selectCategory}/>)}
        </ScrollView></Animated.View>
        <View style={[s.selectionRow, dark && {borderBottomColor: '#302D29'}]}>
          <AnimatedTextInput editable={false} defaultValue={count ? `${count} selected` : 'Find a few favourites'} value={Platform.OS === 'web' ? count ? `${count} selected` : 'Find a few favourites' : undefined} accessibilityLiveRegion="polite" animatedProps={selectionCount} style={[s.selectionCount, s.readOnlyCount, dark && d.muted]}/>
          {Platform.OS === 'web' ? <TapChoice accessibilityRole="button" accessibilityLabel={includeClubs ? "View selected interests and clubs" : "View selected interests"} disabled={!count || busy} onPress={() => review(selectionRef.current)} style={[s.viewSelection, {opacity: count ? 1 : 0.4}]}>{reviewControl}</TapChoice> : <GestureDetector gesture={reviewTap}><Animated.View accessible accessibilityRole="button" accessibilityLabel={includeClubs ? "View selected interests and clubs" : "View selected interests"} animatedProps={reviewAccessibility} onAccessibilityTap={() => runOnUI(openReview)()} style={[s.viewSelection, reviewStyle]}>{reviewControl}</Animated.View></GestureDetector>}
        </View>
      </Animated.View>
      <Animated.ScrollView ref={list} style={s.list} contentContainerStyle={s.listContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        {results.map(({group, options}) => <InterestGroupView dark={dark} key={`result-${group.id}`} icon={categoryIcons[group.id]} group={group} options={options}
          selected={group.id === 'college_clubs' ? clubs : interests} busy={o.busy} onToggle={toggle}/>)}
        {!!resultsQuery && !results.length && <View style={s.empty}><Ionicons name="search-outline" size={28} color="#A78B9B"/><Text style={[s.emptyTitle, dark && d.text]}>No interests found</Text><Text style={[shared.subtitle, dark && d.muted]}>Try another word or category.</Text></View>}
        <View style={resultsQuery ? s.hidden : undefined}>
          <InterestCatalog dark={dark} includeClubs={includeClubs} ready={ready} category={category} interests={interests} clubs={clubs} busy={o.busy} onToggle={toggle}/>
        </View>
        <Animated.Text accessibilityLiveRegion="polite" style={[s.limitNote, dark && d.accent, limitStyle]}>You selected 100 interests. Remove one to add another.</Animated.Text>
      </Animated.ScrollView>

      {dark ? <EditSaveFooter onSave={save} saving={o.busy} hasUnsavedChanges={changed} error={o.error}/> : <ConnectionFooter label={o.action} disabled={!count && !o.editing} busy={o.busy} error={o.error} onNext={save}/>}
    </KeyboardAvoidingView>
    {dark && !nativeReview && <FormSheet compactHeader backgroundColor="#242321" visible={!!reviewSelection} title="Your selections" subtitle="Tap a selection to remove it." onClose={closeReview}>
      <InterestSelectionContent dark interests={reviewSelection?.interests ?? []} clubs={reviewSelection?.clubs ?? []} onRemove={removeSelection}/>
    </FormSheet>}
  </View>;
}

export function ProfileInterestSelectionReviewSheet() {
  return <InterestSelectionReviewSheet dark includeClubs={false}/>;
}

export function InterestSelectionReviewSheet({dark = false, includeClubs = true}: {dark?: boolean; includeClubs?: boolean}) {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const [selection, setSelection] = useState<{source: typeof route.params; interests: string[]; clubs: string[]}>(() => ({source: route.params, interests: route.params?.interests ?? [], clubs: route.params?.clubs ?? []}));
  // Navigation can update a preloaded sheet. Use its latest values before painting.
  if (selection.source !== route.params) setSelection({source: route.params, interests: route.params?.interests ?? [], clubs: route.params?.clubs ?? []});
  const {interests} = selection;
  const clubs = includeClubs ? selection.clubs : [];
  const remove = (kind: 'interests' | 'clubs', id: string) => {
    const next = {...selection, [kind]: selection[kind].filter((value: string) => value !== id)};
    setSelection(next);
    if (route.params?.returnKey) navigation.dispatch({...CommonActions.setParams({interestSelection: {interests: next.interests, clubs: next.clubs}}), source: route.params.returnKey});
  };
  return <ScrollView style={[shared.page, dark && d.surface]} contentContainerStyle={[shared.sheetContent, {paddingBottom: Math.max(insets.bottom, 18) + 24}]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <ConnectionSheetHeader dark={dark} compact={dark} title="Your selections" onClose={() => navigation.goBack()} style={[s.reviewHeader, dark && {marginBottom: 0}]}/>
    <Text style={[shared.subtitle, s.reviewHint, dark && d.muted]}>Tap a selection to remove it.</Text>
    <InterestSelectionContent dark={dark} interests={interests} clubs={clubs} onRemove={remove}/>
  </ScrollView>;
}

function InterestSelectionContent({interests, clubs, onRemove, dark = false}: {
  interests: string[]; clubs: string[]; onRemove: (kind: 'interests' | 'clubs', id: string) => void; dark?: boolean;
}) {
  const rows = [{id: 'interests', title: 'Interests', values: interests, remove: (id: string) => onRemove('interests', id)}, {id: 'clubs', title: 'College clubs', values: clubs, remove: (id: string) => onRemove('clubs', id)}];
  return <>
    {rows.map(section => section.values.length ? <View key={section.id} style={s.reviewGroup}>
      {(!dark || clubs.length > 0) && <Text style={[s.groupTitle, dark && d.text]}>{section.title} · {section.values.length}</Text>}
      <View style={[s.tags, {marginTop: 8}]}>{section.values.map(id => <TapChoice key={id} accessibilityRole="button" accessibilityLabel={`Remove ${section.id === 'interests' ? catalog.get(id) ?? id : id}`} onPress={() => section.remove(id)} style={({pressed}) => [s.tag, pressed && shared.pressed]}><LinearGradient colors={interestGradient(id)} start={{x: 0, y: 0}} end={{x: 1, y: 1}} style={StyleSheet.absoluteFill}/><Text accessible={false} style={s.emoji}>{interestEmojis[id]}</Text><Text style={s.tagLabel}>{section.id === 'interests' ? catalog.get(id) ?? id : id}</Text><Ionicons name="close" size={15} color={c.primary}/></TapChoice>)}</View>
    </View> : null)}
    {!interests.length && !clubs.length && <View style={s.empty}><Text style={[s.emptyTitle, dark && d.text]}>Your selection is empty</Text><Text style={[shared.subtitle, dark && d.muted]}>Close this sheet to choose interests.</Text></View>}
  </>;
}

const d = StyleSheet.create({
  page: {backgroundColor: '#100F0D'}, surface: {backgroundColor: '#242321'},
  text: {color: '#FAF7F2'}, muted: {color: '#BDB5AF'}, accent: {color: '#F3C1CA'},
  tab: {backgroundColor: '#242321'}, tabSelected: {backgroundColor: '#3B2933', borderColor: '#3B2933'},
});

const s = StyleSheet.create({
  fixedHeader: {paddingHorizontal: 24, paddingTop: 18, width: '100%', maxWidth: 500, alignSelf: 'center'},
  heroFrame: {overflow: 'hidden'},
  hero: {position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 18},
  compactHero: {position: 'absolute', left: 0, right: 0, top: 0},
  heroCopy: {flex: 1},
  title: {fontSize: 38, lineHeight: 42, marginBottom: 8},
  searchTitle: {fontSize: 26, lineHeight: 34, marginBottom: 0},
  art: {width: 114, alignItems: 'center', justifyContent: 'center'},
  search: {minHeight: 48, borderRadius: 24, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 8},
  searchInput: {flex: 1, minHeight: 48, padding: 0, fontFamily: 'DMSans_400Regular', fontSize: 14, color: c.text},
  clear: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  clearCircle: {width: 30, height: 30, borderRadius: 15, backgroundColor: '#F0E8EB', alignItems: 'center', justifyContent: 'center'},
  tabsFrame: {marginHorizontal: -24, overflow: 'hidden'},
  tabs: {gap: 4, paddingHorizontal: 24, paddingTop: 4},
  tabTouch: {height: 44, justifyContent: 'center'},
  tab: {height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: '#E8E4E0', borderWidth: 1, borderColor: 'transparent'},
  tabSelected: {borderColor: '#C99AAC', backgroundColor: c.wash},
  tabLabel: {fontFamily: 'DMSans_500Medium', fontSize: 12, color: c.muted},
  tabLabelSelected: {color: c.primary},
  selectionRow: {minHeight: 40, borderBottomWidth: 1, borderBottomColor: c.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10},
  selectionCount: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 19, color: c.muted},
  readOnlyCount: {padding: 0, margin: 0, minHeight: 20},
  viewSelection: {flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', minHeight: 40, minWidth: 60, gap: 3},
  list: {flex: 1, width: '100%', maxWidth: 500, alignSelf: 'center'},
  listContent: {paddingHorizontal:24,paddingTop:12,paddingBottom:18},
  optionsContent: {paddingHorizontal: 24, paddingTop: 12, paddingBottom: 18, width: '100%', maxWidth: 500, alignSelf: 'center'},
  group: {marginBottom: 24},
  groupHeader: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12},
  groupTitle: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 24, color: c.text},
  limit: {fontFamily: 'DMSans_400Regular', fontSize: 11, color: c.muted},
  tags: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  tagFrame: {maxWidth: '100%'},
  tag: {minHeight: 44, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', overflow: 'hidden'},
  tagLabel: {fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 20, color: c.text, flexShrink: 1},
  tagMark: {width: 15, alignItems: 'center', justifyContent: 'center'},
  markLayer: {position: 'absolute', width: 15, height: 18, alignItems: 'center', justifyContent: 'center'},
  emoji: {fontSize: 17, lineHeight: 23},
  empty: {alignItems: 'center', gap: 10, paddingVertical: 32},
  hidden: {display: 'none'},
  emptyTitle: {fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 24, color: c.text},
  limitNote: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 19, color: c.primary},
  reviewHeader: {marginBottom: 4},
  reviewHint: {marginBottom: 12},
  reviewGroup: {marginBottom: 20},
});



