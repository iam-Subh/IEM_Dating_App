import React, {memo, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Animated as NativeAnimated, Easing, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {LinearGradient} from 'expo-linear-gradient';
import Svg, {Path} from 'react-native-svg';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import type {SharedValue} from 'react-native-reanimated';
import type {InterestGroup} from './InterestIntroduction';
import {interestEmojis, interestGradient} from './InterestVisuals';
import {connectionColors as c} from './ConnectionDesign';

const AnimatedTagPressable = NativeAnimated.createAnimatedComponent(Pressable);

export const INTEREST_LIMIT = 100;
export const CLUB_LIMIT = 5;

function MarkGlyph({selected, dark = false}: {selected: boolean; dark?: boolean}) {
  return selected ? <Svg width={16} height={16} viewBox="0 0 20 20" accessible={false}>
    <Path d="M4 10L8 14L16 6" fill="none" stroke={c.primary} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg> : <View style={s.plus}>
    <View style={[s.plusHorizontal, dark && {backgroundColor: '#BDB5AF'}]}/><View style={[s.plusVertical, dark && {backgroundColor: '#BDB5AF'}]}/>
  </View>;
}

const SelectionMark = memo(function SelectionMark({selected, dark = false}: {selected: boolean; dark?: boolean}) {
  const previous = useRef(selected);
  const [transition, setTransition] = useState<{progress: NativeAnimated.Value; from: boolean; to: boolean} | null>(null);
  useLayoutEffect(() => {
    if (previous.current === selected) return;
    const from = previous.current;
    previous.current = selected;
    setTransition({progress: new NativeAnimated.Value(0), from, to: selected});
  }, [selected]);
  useEffect(() => {
    if (!transition) return;
    let active = true;
    const animation = NativeAnimated.timing(transition.progress, {toValue: 1, duration: dark ? 120 : 180, easing: Easing.out(Easing.quad), useNativeDriver: true});
    animation.start(({finished}) => {if (active && finished) setTransition(current => current === transition ? null : current);});
    return () => {active = false; animation.stop();};
  }, [transition, dark]);
  return <View accessible={false} pointerEvents="none" style={s.mark}>
    {transition ? <>
      <NativeAnimated.View style={[s.markLayer, {
        opacity: dark ? 0 : transition.progress.interpolate({inputRange: [0, .45, 1], outputRange: [1, 0, 0]}),
        transform: [{scale: transition.progress.interpolate({inputRange: [0, 1], outputRange: [1, .65]})}, {rotate: transition.progress.interpolate({inputRange: [0, 1], outputRange: ['0deg', '35deg']})}],
      }]}><MarkGlyph dark={dark} selected={transition.from}/></NativeAnimated.View>
      <NativeAnimated.View style={[s.markLayer, {
        opacity: dark ? 1 : transition.progress.interpolate({inputRange: [0, .35, 1], outputRange: [0, 0, 1]}),
        transform: [{scale: transition.progress.interpolate({inputRange: [0, 1], outputRange: [dark ? .9 : .65, 1]})}, {rotate: transition.progress.interpolate({inputRange: [0, 1], outputRange: [dark ? '-12deg' : '-35deg', '0deg']})}],
      }]}><MarkGlyph dark={dark} selected={transition.to}/></NativeAnimated.View>
    </> : <MarkGlyph dark={dark} selected={selected}/>}
  </View>;
});

// The catalogue mounts 271 of these, and leaving the page unmounts them all.
// Create native animation nodes only for a mark that changes after a tap.
const Tag = memo(function Tag({id, label, selected, limited, busy, onToggle, dark = false}: {
  id: string; label: string; selected: boolean; limited: boolean; busy: boolean; dark?: boolean; onToggle: (id: string) => boolean | undefined;
}) {
  const disabled = busy || limited;
  const [visualSelected, setVisualSelected] = useState(selected);
  const visualSelection = useRef(selected);
  const [gradientReady, setGradientReady] = useState(selected);
  const previousSelected = useRef(selected);
  useLayoutEffect(() => {
    if (previousSelected.current !== selected) {
      previousSelected.current = selected;
      visualSelection.current = selected;
      setVisualSelected(selected);
    }
  }, [selected]);
  const toggleSelection = () => {
    if (disabled) return;
    if (dark) {
      // Paint this item first. The parent can update the catalogue afterwards.
      const optimistic = !visualSelection.current;
      visualSelection.current = optimistic;
      setVisualSelected(optimistic);
      const next = onToggle(id);
      const accepted = next ?? !optimistic;
      if (accepted !== optimistic) {
        visualSelection.current = accepted;
        setVisualSelected(accepted);
      }
      return;
    }
    const next = onToggle(id);
    if (next !== undefined) setVisualSelected(next);
  };
  const [pressScale, setPressScale] = useState<NativeAnimated.Value | null>(() => dark ? new NativeAnimated.Value(1) : null);
  const press = useRef<{scale: NativeAnimated.Value | null; pressed: boolean; animation?: NativeAnimated.CompositeAnimation}>({scale: pressScale, pressed: false});
  const animatePress = (pressed: boolean) => {
    if (dark && press.current.pressed === pressed) return;
    press.current.pressed = pressed;
    if (!press.current.scale) {
      if (!pressed) return;
      press.current.scale = new NativeAnimated.Value(1);
      setPressScale(press.current.scale);
      return;
    }
    press.current.animation?.stop();
    if (dark && pressed) {
      press.current.scale.setValue(.98);
      return;
    }
    press.current.animation = NativeAnimated.timing(press.current.scale, {toValue: pressed ? .96 : 1, duration: dark ? 70 : pressed ? 70 : 140, easing: Easing.out(Easing.quad), useNativeDriver: true});
    press.current.animation.start();
  };
  useLayoutEffect(() => {if (pressScale) animatePress(press.current.pressed);}, [pressScale]);
  useEffect(() => () => {press.current.animation?.stop();}, []);
  const touch = useRef<{x: number; y: number; moved: boolean} | null>(null);
  const Container = dark ? AnimatedTagPressable : NativeAnimated.View;
  // Dark editors use Pressable for touch, mouse and keyboard input.
  // Onboarding keeps its existing responder behaviour.
  return <Container accessible accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{checked: visualSelected, disabled}} aria-checked={visualSelected}
    {...(dark ? {
      disabled,
      unstable_pressDelay: 0,
      ...(Platform.OS === 'web' ? {delayPressIn: 0, delayPressOut: 0} : {}),
      onTouchStart: (event: any) => {
        if (disabled) return;
        setGradientReady(true);
        touch.current = {x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, moved: false};
        animatePress(true);
      },
      onTouchMove: (event: any) => {
        const start = touch.current;
        if (start && Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) > 8) {
          start.moved = true;
          animatePress(false);
        }
      },
      // Release on touch end instead of waiting for Pressable's press-out delay.
      onTouchEnd: () => animatePress(false),
      onTouchCancel: () => {touch.current = null; animatePress(false);},
      onPressIn: () => animatePress(true),
      onPressOut: () => animatePress(false),
      onPress: () => {animatePress(false); const moved = touch.current?.moved; touch.current = null; if (!moved) toggleSelection();},
    } : {
      onAccessibilityTap: toggleSelection, onStartShouldSetResponder: () => !disabled,
      onResponderGrant: () => {setGradientReady(true); animatePress(true);}, onResponderTerminationRequest: () => true,
      onResponderTerminate: () => animatePress(false), onResponderRelease: () => {animatePress(false); toggleSelection();},
    })}
    style={[s.tag, dark && {backgroundColor: '#242321'}, visualSelected && s.selectedTag, limited && s.limitedTag, pressScale && {transform: [{scale: pressScale}]}]}>
    {(gradientReady || visualSelected) && <LinearGradient key="background" pointerEvents="none" colors={interestGradient(id)} start={{x: 0, y: 0}} end={{x: 1, y: 1}} style={[StyleSheet.absoluteFill, {opacity: visualSelected ? 1 : 0}]}/>}
    <View key="content" collapsable={false} pointerEvents="none" style={s.content}>
      <Text accessible={false} style={s.emoji}>{interestEmojis[id]}</Text>
      <Text style={[s.label, dark && {color: visualSelected ? c.text : '#FAF7F2'}]}>{label}</Text>
    </View>
    <SelectionMark key="selection" dark={dark} selected={visualSelected}/>
  </Container>;
});

export const InterestGroupView = memo(function InterestGroupView({group, icon, options = group.interests, category, selected, busy, onToggle, dark = false}: {
  group: InterestGroup; icon: React.ComponentProps<typeof Ionicons>['name'];
  /** The options to show; search results pass the matching ones. */
  options?: InterestGroup['interests'];
  /** Omitted for search results, which ignore the category tabs. */
  category?: SharedValue<string>;
  /** This group's kind of selection: interest ids, or club names for clubs. */
  selected: string[]; busy: boolean; dark?: boolean;
  onToggle: (id: string, club: boolean) => boolean | undefined;
}) {
  const college = group.id === 'college_clubs';
  const full = selected.length >= (college ? CLUB_LIMIT : INTEREST_LIMIT);
  const toggle = useCallback((id: string) => onToggle(id, college), [onToggle, college]);
  // Category tabs show one group without rendering anything.
  const visibility = useAnimatedStyle(() => ({display: !category || category.value === 'all' || category.value === group.id ? 'flex' : 'none'}));
  return <Animated.View style={[s.group, visibility]}>
    <View style={s.header}><Ionicons name={icon} size={18} color={dark ? '#F3C1CA' : c.primary}/><Text style={[s.title, dark && {color: '#FAF7F2'}]}>{group.title}</Text>{college && <Text style={[s.count, dark && {color: '#BDB5AF'}]}>{selected.length}/{CLUB_LIMIT}</Text>}</View>
    <View style={s.tags}>{options.map(option => {
      const isSelected = selected.includes(option.id);
      return <Tag dark={dark} key={option.id} id={option.id} label={option.label} selected={isSelected} limited={full && !isSelected} busy={busy} onToggle={toggle}/>;
    })}</View>
  </Animated.View>;
});

const s = StyleSheet.create({
  group: {marginBottom: 24}, header: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12},
  title: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 24, color: c.text},
  count: {fontFamily: 'DMSans_400Regular', fontSize: 11, color: c.muted},
  tags: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  tag: {minHeight: 44, maxWidth: '100%', borderRadius: 22, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFF', flexDirection: 'row', alignItems: 'center', gap: 6},
  selectedTag: {backgroundColor: 'transparent'},
  limitedTag: {opacity: 0.5},
  content: {flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6},
  label: {flexShrink: 1, fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 23, color: c.text},
  emoji: {fontSize: 17, lineHeight: 23, flexShrink: 0},
  mark: {width: 20, height: 24, flexShrink: 0, alignItems: 'center', justifyContent: 'center', overflow: 'visible'},
  markLayer: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', overflow: 'visible'},
  plus: {width: 14, height: 14, alignItems: 'center', justifyContent: 'center'},
  plusHorizontal: {position: 'absolute', width: 12, height: 1.8, borderRadius: 1, backgroundColor: '#A78B9B'},
  plusVertical: {position: 'absolute', width: 1.8, height: 12, borderRadius: 1, backgroundColor: '#A78B9B'},
});
