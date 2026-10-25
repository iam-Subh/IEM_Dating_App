import React, {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {CommonActions, useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Path} from 'react-native-svg';
import {LIFESTYLE_SECTIONS} from '../../../core/profile/profileOptions';
import {afterScreenTransition} from './afterScreenTransition';
import {useOptionalSave} from './useOptionalSave';
import {ConnectionFooter, ConnectionNav, ConnectionSheetHeader, TapChoice, connectionColors as c, connectionStyles as shared} from './ConnectionDesign';

type Topic = typeof LIFESTYLE_SECTIONS[number];
type Answers = Record<string, string>;
function LifestyleCheck() {
  return <Svg width={18} height={18} viewBox="0 0 24 24" accessible={false}>
    <Path d="M5 12.5L10 17L19 7" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>;
}
import {lifestyleDesign as design, LifestyleArt} from './OnboardingFormArtwork';

export function LifestyleIntroduction() {
  const o = useOptionalSave();
  const {width, height, fontScale} = useWindowDimensions();
  const [answers, setAnswers] = useState<Answers>(() => o.data.preferences?.lifestyle ?? {});
  const latest = useRef(o);
  latest.current = o;
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const navigation = o.navigation;
  const returnKey = o.route.key;
  const returned = o.route.params?.lifestyleAnswer;
  useLayoutEffect(() => {
    if (!returned || !LIFESTYLE_SECTIONS.some(topic => topic.id === returned.id)) return;
    setAnswers(previous => {
      const next = {...previous};
      if (returned.value) next[returned.id] = returned.value;
      else delete next[returned.id];
      return next;
    });
  }, [returned]);
  const sheetParams = useCallback((id = 'drink') => ({id, selected: answersRef.current[id] ?? '', returnKey}), [returnKey]);
  useFocusEffect(useCallback(() => {
    return afterScreenTransition(navigation, () => navigation.preload('LifestyleOptions', sheetParams()));
  }, [navigation, sheetParams]));
  useEffect(() => {
    const timer = setTimeout(() => latest.current.draft({preferences: {...latest.current.data.preferences, lifestyle: answers}}), 350);
    return () => clearTimeout(timer);
  }, [answers]);
  const fields = () => ({preferences: {...latest.current.data.preferences, lifestyle: answersRef.current}});
  const keepDraft = () => o.draft(fields());
  const singleColumn = width < 340 || fontScale > 1.25;
  const cardHeight = height < 740 ? 162 : 182;
  const answered = LIFESTYLE_SECTIONS.filter(topic => answers[topic.id]).length;
  return <View style={shared.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <ConnectionNav busy={o.busy} onBack={() => {keepDraft(); o.back();}} onSkip={o.skip ? () => {keepDraft(); o.skip?.();} : undefined}/>
    <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} bounces={false}>
      <Text accessibilityRole="header" style={[shared.title, s.title]}>{'Your everyday\nchoices.'}</Text>
      <Text style={[shared.subtitle, s.subtitle]}>Share a little about your routine.</Text>
      <View style={s.gridHint}><Text style={s.hint}>Tap a card to choose.</Text><Text accessibilityLiveRegion="polite" style={s.count}>{answered}/4 answered</Text></View>
      <View style={s.grid}>{LIFESTYLE_SECTIONS.map(topic => {
        const look = design[topic.id];
        const answer = topic.options.find(option => option.id === answers[topic.id])?.label;
        return <TapChoice key={topic.id} accessibilityRole="button" accessibilityLabel={`${look.label}, ${answer ?? 'Add answer'}`} accessibilityHint="Opens answer options" disabled={o.busy} onPress={() => navigation.navigate('LifestyleOptions', sheetParams(topic.id))} style={({pressed}) => [s.card, {width: singleColumn ? '100%' : (Math.min(width, 500) - 60) / 2, minHeight: cardHeight, backgroundColor: look.tint}, answer && s.cardSelected, pressed && s.cardPressed, o.busy && {opacity: 0.5}]}>
          <View style={s.cardTop}><Text style={s.cardTitle}>{look.label}</Text><View style={[s.add, answer && s.addSelected]}>{answer ? <LifestyleCheck/> : <Ionicons name="add" size={16} color={c.primary}/>}</View></View>
          <View pointerEvents="none" style={s.art}><LifestyleArt id={topic.id}/></View>
          <View style={s.answer}><Text style={[s.answerText, !answer && s.answerEmpty]}>{answer ?? 'Add answer'}</Text>{!!answer && <Ionicons name="pencil-outline" size={12} color={c.primary}/>}</View>
        </TapChoice>;
      })}</View>
      <Text style={s.note}>You can change these later.</Text>
    </ScrollView>
    <ConnectionFooter label={o.action} disabled={false} busy={o.busy} error={o.error} onNext={() => {keepDraft(); o.saveOptional(fields());}}/>
  </View>;
}

export function LifestyleOptionsSheet() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const topic: Topic = LIFESTYLE_SECTIONS.find(value => value.id === route.params?.id) ?? LIFESTYLE_SECTIONS[0];
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
    navigation.dispatch({...CommonActions.setParams({lifestyleAnswer: {id: topic.id, value, revision: Date.now()}}), source: route.params?.returnKey});
    dismissFrame.current = requestAnimationFrame(() => navigation.goBack());
  };
  const content = <>
    <ConnectionSheetHeader title={design[topic.id].label} onClose={() => navigation.goBack()} style={s.sheetHeader}/>
    <Text accessibilityRole="header" style={s.question}>{topic.title}</Text>
    <View style={s.options}>
      {topic.options.map(option => {
        const checked = selection.value === option.id;
        return <TapChoice key={option.id} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{checked}} onPress={() => select(option.id)} style={({pressed}) => [s.option, checked && s.optionSelected, pressed && shared.pressed]}><Text style={s.optionLabel}>{option.label}</Text><View style={[s.radio, checked && s.radioSelected]}>{checked && <LifestyleCheck/>}</View></TapChoice>;
      })}
    </View>
    <View style={s.sheetFooter}>
      <TapChoice accessibilityRole="button" accessibilityLabel="Clear answer" disabled={!selection.value} onPress={() => select('')} style={({pressed}) => [s.clear, !selection.value && {opacity: 0.4}, pressed && shared.pressed]}><Ionicons name="close-circle-outline" size={17} color={c.primary}/><Text style={s.clearLabel}>Clear answer</Text></TapChoice>
    </View>
  </>;
  const bottom = {paddingBottom: Math.max(insets.bottom, 18) + 12};
  // Short sheets measure their content. The long pet list uses a bounded scroll area.
  return topic.id === 'pets'
    ? <ScrollView nestedScrollEnabled style={shared.page} contentContainerStyle={bottom} showsVerticalScrollIndicator>{content}</ScrollView>
    : <View style={[s.sheet, bottom]}>{content}</View>;
}

const s = StyleSheet.create({
  scroll: {flex: 1},
  content: {width: '100%', maxWidth: 500, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 22, paddingBottom: 8},
  title: {fontSize: 38, lineHeight: 42},
  subtitle: {marginTop: 8},
  gridHint: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 26, marginBottom: 12},
  hint: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: c.muted},
  count: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: c.primary},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
  card: {borderRadius: 23, borderWidth: 1, borderColor: 'transparent', padding: 15, overflow: 'hidden', justifyContent: 'space-between'},
  cardSelected: {borderColor: '#96516F'},
  cardPressed: {opacity: 0.72, transform: [{scale: 0.98}]},
  cardTop: {flexDirection: 'row', alignItems: 'center', gap: 5, zIndex: 1},
  cardTitle: {flex: 1, fontFamily: 'DMSans_700Bold', fontSize: 15, lineHeight: 22, color: c.text},
  add: {width: 26, height: 26, flexShrink: 0, borderRadius: 13, backgroundColor: '#FFFFFFAA', alignItems: 'center', justifyContent: 'center', overflow: 'visible'},
  addSelected: {backgroundColor: c.primary},
  art: {position: 'absolute', top: 42, right: 7, width: 88, height: 82},
  answer: {flexDirection: 'row', alignItems: 'center', gap: 5, zIndex: 1, marginTop: 82},
  answerText: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: c.primary},
  answerEmpty: {fontFamily: 'DMSans_400Regular', color: c.muted},
  note: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 18, color: c.muted, marginTop: 16},
  sheetHeader: {marginHorizontal: 24, marginTop: 20, marginBottom: 6},
  sheet: {backgroundColor: c.canvas},
  question: {fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 22, color: c.muted, marginHorizontal: 24, marginBottom: 18},
  options: {paddingHorizontal: 24, paddingBottom: 8},
  option: {minHeight: 54, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 8, borderWidth: 1, borderColor: '#E5DEE1', borderRadius: 17, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 14},
  optionSelected: {backgroundColor: c.wash, borderColor: '#96516F'},
  optionLabel: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 22, color: c.text},
  radio: {width: 26, height: 26, flexShrink: 0, borderRadius: 13, borderWidth: 1.5, borderColor: '#C7B9C2', alignItems: 'center', justifyContent: 'center', overflow: 'visible'},
  radioSelected: {backgroundColor: c.primary, borderColor: c.primary},
  sheetFooter: {paddingTop: 4, paddingHorizontal: 24, backgroundColor: c.canvas},
  clear: {alignSelf: 'center', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7},
  clearLabel: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 20, color: c.primary},
});
