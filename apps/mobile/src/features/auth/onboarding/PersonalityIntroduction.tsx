import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {CommonActions, useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';

import {PERSONALITY_SECTIONS} from '../../../core/profile/profileOptions';
import {afterScreenTransition} from './afterScreenTransition';
import {useOptionalSave} from './useOptionalSave';
import {ConnectionFooter, ConnectionNav, ConnectionSheetHeader, TapChoice, connectionColors as c, connectionStyles as shared} from './ConnectionDesign';

const topics = ['communication', 'love_reception', 'personality', 'star_sign'].map(id => PERSONALITY_SECTIONS.find(topic => topic.id === id)!);
type Answers = Record<string, string>;
import {personalityDesign as design, zodiac, ConnectionArt, Check} from './OnboardingFormArtwork';

export function PersonalityIntroduction() {
  const o = useOptionalSave();
  const {height, fontScale} = useWindowDimensions();
  const [answers, setAnswers] = useState<Answers>(() => o.data.preferences?.personality ?? {});
  const latest = useRef(o);
  latest.current = o;
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const {navigation} = o;
  const returnKey = o.route.key;
  const returned = o.route.params?.personalityAnswer;
  useLayoutEffect(() => {
    if (!returned || !topics.some(topic => topic.id === returned.id)) return;
    setAnswers(previous => {
      const next = {...previous};
      if (returned.value) next[returned.id] = returned.value;
      else delete next[returned.id];
      return next;
    });
  }, [returned]);
  const sheetParams = useCallback((id = 'communication') => ({id, selected: answersRef.current[id] ?? '', returnKey}), [returnKey]);
  useFocusEffect(useCallback(() => {
    return afterScreenTransition(navigation, () => navigation.preload('PersonalityOptions', sheetParams()));
  }, [navigation, sheetParams]));
  useEffect(() => {
    const timer = setTimeout(() => latest.current.draft({preferences: {...latest.current.data.preferences, personality: answers}}), 350);
    return () => clearTimeout(timer);
  }, [answers]);
  const fields = () => ({preferences: {...latest.current.data.preferences, personality: answersRef.current}});
  const keepDraft = () => o.draft(fields());
  const answered = topics.filter(topic => answers[topic.id]).length;
  const compact = height < 740 && fontScale <= 1.2;
  return <View style={shared.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <ConnectionNav busy={o.busy} onBack={() => {keepDraft(); o.back();}} onSkip={o.skip ? () => {keepDraft(); o.skip?.();} : undefined}/>
    <View style={[s.content, compact && {paddingTop: 12}]}>
      <Text accessibilityRole="header" style={[shared.title, s.title, compact && {fontSize: 34, lineHeight: 38}]}>{'The way you\nconnect.'}</Text>
      <Text style={[shared.subtitle, s.subtitle]}>Share what feels like you.</Text>
      <View style={s.hintRow}><Text style={s.hint}>Tap a card to choose.</Text><Text accessibilityLiveRegion="polite" style={s.count}>{answered}/4 answered</Text></View>
      <View style={s.cards}>{topics.map(topic => {
        const look = design[topic.id];
        const answer = topic.options.find(option => option.id === answers[topic.id])?.label;
        return <TapChoice key={topic.id} accessibilityRole="button" accessibilityLabel={`${look.label}, ${answer ?? 'Add answer'}`} accessibilityHint="Opens answer options" disabled={o.busy} onPress={() => navigation.navigate('PersonalityOptions', sheetParams(topic.id))} style={({pressed}) => [s.card, {backgroundColor: look.tint}, answer && s.cardSelected, pressed && s.cardPressed, o.busy && {opacity: 0.5}]}>
          <View pointerEvents="none" style={[s.art, compact && {width: 60, height: 56}]}><ConnectionArt id={topic.id}/></View>
          <View style={s.cardText}><Text style={s.cardTitle}>{look.label}</Text><Text style={[s.answer, !answer && s.empty]}>{answer ?? 'Add answer'}</Text></View>
          <View style={[s.badge, answer && s.badgeSelected]}>{answer ? <Check/> : <Ionicons name="add" size={18} color={c.primary}/>}</View>
        </TapChoice>;
      })}</View>
    </View>
    <ConnectionFooter label={o.action} disabled={false} busy={o.busy} error={o.error} onNext={() => {keepDraft(); o.saveOptional(fields());}}/>
  </View>;
}

export function PersonalityOptionsSheet() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const {width, fontScale} = useWindowDimensions();
  const topic = topics.find(value => value.id === route.params?.id) ?? topics[0];
  const [selection, setSelection] = useState(() => ({source: route.params, value: route.params?.selected ?? ''}));
  const selecting = useRef(false);
  const dismissFrame = useRef<number | null>(null);
  if (selection.source !== route.params) {
    selecting.current = false;
    setSelection({source: route.params, value: route.params?.selected ?? ''});
  }
  useEffect(() => () => {if (dismissFrame.current !== null) cancelAnimationFrame(dismissFrame.current);}, []);
  const select = (value: string) => {
    if (selecting.current) return;
    selecting.current = true;
    setSelection(previous => ({...previous, value}));
    navigation.dispatch({...CommonActions.setParams({personalityAnswer: {id: topic.id, value, revision: Date.now()}}), source: route.params?.returnKey});
    dismissFrame.current = requestAnimationFrame(() => navigation.goBack());
  };
  const isZodiac = topic.id === 'star_sign';
  const zodiacGrid = isZodiac && width >= 350 && fontScale <= 1.2;
  const content = <>
    <ConnectionSheetHeader title={design[topic.id].label} onClose={() => navigation.goBack()} style={s.sheetHeader}/>
    <Text style={s.question}>{topic.title}</Text>
    <View style={[s.options, zodiacGrid && s.zodiacGrid]}>{topic.options.map(option => {
      const checked = selection.value === option.id;
      return <TapChoice key={option.id} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{checked}} onPress={() => select(option.id)} style={({pressed}) => [s.option, zodiacGrid && s.zodiacOption, checked && s.optionSelected, pressed && shared.pressed]}>
        {isZodiac && <Text accessible={false} style={s.zodiacSymbol}>{zodiac[option.id]}</Text>}
        <Text style={[s.optionLabel, isZodiac && {fontSize: 13}]}>{option.label}</Text>
        <View style={[s.radio, zodiacGrid && s.zodiacRadio, checked && s.radioSelected]}>{checked && <Check/>}</View>
      </TapChoice>;
    })}</View>
    <TapChoice accessibilityRole="button" accessibilityLabel="Clear answer" disabled={!selection.value} onPress={() => select('')} style={({pressed}) => [s.clear, !selection.value && {opacity: 0.4}, pressed && shared.pressed]}><Ionicons name="close-circle-outline" size={17} color={c.primary}/><Text style={s.clearLabel}>Clear answer</Text></TapChoice>
  </>;
  const bottom = {paddingBottom: Math.max(insets.bottom, 18) + 12};
  return topic.id === 'communication' || isZodiac
    ? <ScrollView nestedScrollEnabled style={shared.page} contentContainerStyle={bottom} showsVerticalScrollIndicator>{content}</ScrollView>
    : <View style={[s.sheet, bottom]}>{content}</View>;
}

const s = StyleSheet.create({
  content: {flex: 1, width: '100%', maxWidth: 500, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 18, paddingBottom: 8},
  title: {fontSize: 38, lineHeight: 42},
  subtitle: {marginTop: 8},
  hintRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 16, marginBottom: 12},
  hint: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: c.muted},
  count: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: c.primary},
  cards: {flex: 1, maxHeight: 430, gap: 10},
  card: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 23, borderWidth: 1, borderColor: 'transparent'},
  cardSelected: {borderColor: '#96516F'},
  cardPressed: {opacity: 0.72, transform: [{scale: 0.99}]},
  art: {width: 72, height: 64, flexShrink: 0},
  cardText: {flex: 1, gap: 5},
  cardTitle: {fontFamily: 'DMSans_700Bold', fontSize: 15, lineHeight: 22, color: c.text},
  answer: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: c.primary},
  empty: {fontFamily: 'DMSans_400Regular', color: c.muted},
  badge: {width: 28, height: 28, flexShrink: 0, borderRadius: 14, backgroundColor: '#FFFFFFAA', alignItems: 'center', justifyContent: 'center'},
  badgeSelected: {backgroundColor: c.primary},
  sheet: {backgroundColor: c.canvas},
  sheetHeader: {marginHorizontal: 24, marginTop: 20, marginBottom: 6},
  question: {fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 22, color: c.muted, marginHorizontal: 24, marginBottom: 18},
  options: {paddingHorizontal: 24, gap: 8, paddingBottom: 8},
  option: {minHeight: 54, paddingHorizontal: 16, paddingVertical: 13, borderWidth: 1, borderColor: '#E5DEE1', borderRadius: 17, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 14},
  optionSelected: {backgroundColor: c.wash, borderColor: '#96516F'},
  optionLabel: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 22, color: c.text},
  radio: {width: 26, height: 26, flexShrink: 0, borderRadius: 13, borderWidth: 1.5, borderColor: '#C7B9C2', alignItems: 'center', justifyContent: 'center'},
  radioSelected: {backgroundColor: c.primary, borderColor: c.primary},
  zodiacGrid: {flexDirection: 'row', flexWrap: 'wrap'},
  zodiacOption: {width: '48.5%', paddingHorizontal: 8, gap: 4},
  zodiacSymbol: {fontSize: 17, width: 22, color: c.primary},
  zodiacRadio: {width: 22, height: 22, borderRadius: 11},
  clear: {alignSelf: 'center', minHeight: 44, marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 7},
  clearLabel: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 20, color: c.primary},
});
