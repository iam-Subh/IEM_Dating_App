import React, {memo, useCallback, useEffect, useState} from 'react';
import {ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import type {StyleProp, ViewStyle} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {runOnJS, runOnUI, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSequence, withTiming} from 'react-native-reanimated';
import type {SharedValue} from 'react-native-reanimated';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';

import {ORIENTATION_OPTIONS} from '../../../core/profile/profileOptions';
import {useOptionalSave} from './useOptionalSave';
import {ConnectionFooter, ConnectionNav, ConnectionSheetHeader, RoundedTick, TapChoice, connectionColors as c, connectionStyles as shared} from './ConnectionDesign';

type OrientationState = {orientation: string[]; showOrientation: boolean; revision: number};
import {OrientationArtwork} from './OnboardingFormArtwork';

const OrientationCheckbox = memo(function OrientationCheckbox({id, label, children, state, busy, style, onCommit}: {
  id?: string; label: string; children: React.ReactNode; state: SharedValue<OrientationState>; busy: boolean;
  style: StyleProp<ViewStyle>; onCommit: (next: OrientationState) => void;
}) {
  const checked = useDerivedValue(() => id ? state.value.orientation.includes(id) : state.value.showOrientation);
  const tick = useSharedValue(0);
  const pulse = useSharedValue(1);
  useAnimatedReaction(() => checked.value, (current, previous) => {
    tick.value = previous === null ? (current ? 1 : 0) : withTiming(current ? 1 : 0, {duration: 140});
  });
  const cardStyle = useAnimatedStyle(() => ({backgroundColor: checked.value ? '#F0DFE6' : '#FFFFFF', borderColor: checked.value ? '#96516F' : '#E9E2E4', opacity: busy ? 0.5 : 1, transform: [{scale: pulse.value}]}));
  const boxStyle = useAnimatedStyle(() => ({backgroundColor: checked.value ? c.primary : '#FFFFFF', borderColor: checked.value ? c.primary : '#C9B9C3'}));
  const tickStyle = useAnimatedStyle(() => ({opacity: tick.value, transform: [{scale: 0.65 + tick.value * 0.35}]}));
  const accessibility = useAnimatedProps(() => ({accessibilityState: {checked: checked.value, disabled: busy}}));
  const toggle = () => {
    'worklet';
    if (busy) return;
    const previous = state.value;
    const next = id ? {...previous, orientation: previous.orientation.includes(id) ? previous.orientation.filter(value => value !== id) : [...previous.orientation, id], revision: previous.revision + 1} : {...previous, showOrientation: !previous.showOrientation, revision: previous.revision + 1};
    state.value = next;
    pulse.value = withSequence(withTiming(0.98, {duration: 50}), withTiming(1, {duration: 130}));
    runOnJS(onCommit)(next);
  };
  const tap = Gesture.Tap().maxDistance(8).enabled(!busy).onEnd((_event, success) => {if (success) toggle();});
  return <GestureDetector gesture={tap}><Animated.View accessible accessibilityRole="checkbox" accessibilityLabel={label} animatedProps={accessibility} onAccessibilityTap={() => runOnUI(toggle)()} style={[style, cardStyle]}>
    {children}
    <Animated.View style={[s.check, boxStyle]}><Animated.View style={tickStyle}><RoundedTick size={14}/></Animated.View></Animated.View>
  </Animated.View></GestureDetector>;
});

export function OrientationIntroduction() {
  const o = useOptionalSave();
  const {width, fontScale} = useWindowDimensions();
  const [savedState, setSavedState] = useState<OrientationState>(() => ({orientation: o.editing ? o.data.orientation ?? [] : [], showOrientation: o.editing ? o.data.showOrientation ?? false : false, revision: 0}));
  const state = useSharedValue(savedState);
  const commit = useCallback((next: OrientationState) => setSavedState(previous => next.revision > previous.revision ? next : previous), []);
  const singleColumn = width < 340 || fontScale > 1.25;
  useEffect(() => {
    const timer = setTimeout(() => o.draft({orientation: savedState.orientation, showOrientation: savedState.showOrientation}), 350);
    return () => clearTimeout(timer);
  }, [savedState.orientation, savedState.showOrientation]);
  return <View style={shared.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <ConnectionNav onBack={o.back} onSkip={o.skip} busy={o.busy}/>
    <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} bounces={false}>
      <View style={s.hero}>
        <Text accessibilityRole="header" style={[shared.title, s.title]}>Your{'\n'}orientation</Text>
        <View pointerEvents="none" style={[s.art, singleColumn && s.smallArt]}><OrientationArtwork/></View>
      </View>
      <Text style={[shared.subtitle, s.subtitle]}>Choose what feels right for you.</Text>
      <View style={s.selectionHint}><Text style={s.hint}>Choose more than one.</Text><Text accessibilityLiveRegion="polite" style={s.count}>{savedState.orientation.length ? `${savedState.orientation.length} selected` : ''}</Text></View>
      <View style={s.grid}>
        {ORIENTATION_OPTIONS.map(option => <OrientationCheckbox key={option.id} id={option.id} label={option.label} state={state} busy={o.busy} onCommit={commit} style={[s.option, {width: singleColumn ? '100%' : (Math.min(width, 500) - 56) / 2}]}>
          <Text style={s.optionLabel}>{option.label}</Text>
        </OrientationCheckbox>)}
      </View>
      <TapChoice accessibilityRole="button" accessibilityLabel="What do these labels mean?" disabled={o.busy} onPress={() => o.navigation.navigate('OrientationDefinitions')} style={({pressed}) => [s.help, pressed && shared.pressed]}><Ionicons name="information-circle-outline" size={17} color={c.primary}/><Text style={s.helpLabel}>What do these labels mean?</Text><Ionicons name="chevron-forward" size={14} color={c.primary}/></TapChoice>
      <OrientationCheckbox label="Show orientation on my profile" state={state} busy={o.busy} onCommit={commit} style={s.visibility}>
        <View style={s.visibilityCopy}><Text style={s.visibilityTitle}>Show orientation on my profile</Text><Text style={s.visibilityDetail}>{savedState.showOrientation ? 'Visible on your profile.' : 'Private unless you choose to share.'}</Text></View>
      </OrientationCheckbox>
    </ScrollView>
    <ConnectionFooter label={o.action} disabled={!savedState.orientation.length && !o.editing} busy={o.busy} error={o.error} onNext={() => {const current = state.value; o.saveOptional({orientation: current.orientation, showOrientation: current.showOrientation});}}/>
  </View>;
}

export function OrientationDefinitionsSheet() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  return <ScrollView style={shared.page} contentContainerStyle={[shared.sheetContent, {paddingBottom: Math.max(insets.bottom, 18) + 24}]} showsVerticalScrollIndicator={false}>
    <ConnectionSheetHeader title="Orientation labels" onClose={() => navigation.goBack()}/>
    <Text style={[shared.subtitle, {marginBottom: 18}]}>Use the labels that describe you. You can choose more than one.</Text>
    {ORIENTATION_OPTIONS.map(option => <View key={option.id} style={s.definition}>
      <Text style={s.definitionTitle}>{option.label}</Text>
      <Text style={s.definitionText}>{option.description || 'Exploring attraction to more than one gender.'}</Text>
    </View>)}
  </ScrollView>;
}

const s = StyleSheet.create({
  scroll: {flex: 1},
  content: {paddingTop: 16, paddingHorizontal: 24, paddingBottom: 8, width: '100%', maxWidth: 500, alignSelf: 'center'},
  hero: {flexDirection: 'row', alignItems: 'center', gap: 4},
  title: {flex: 1, fontSize: 38, lineHeight: 42, paddingBottom: 4},
  art: {width: 100, height: 100},
  smallArt: {width: 76, height: 88},
  subtitle: {marginTop: 6},
  selectionHint: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 8, gap: 8, minHeight: 20},
  hint: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: c.muted},
  count: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: c.primary},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  option: {minHeight: 50, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8},
  optionLabel: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 21, color: c.text},
  check: {width: 21, height: 21, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center'},
  help: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: 44, marginTop: 2},
  helpLabel: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 19, color: c.primary},
  visibility: {minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, marginTop: 12, borderWidth: 1, borderRadius: 18},
  visibilityCopy: {flex: 1},
  visibilityTitle: {fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 20, color: c.text},
  visibilityDetail: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: c.muted, marginTop: 2},
  definition: {paddingVertical: 16, borderTopWidth: 1, borderTopColor: c.line},
  definitionTitle: {fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 24, color: c.text},
  definitionText: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 21, color: c.muted, marginTop: 5},
});
