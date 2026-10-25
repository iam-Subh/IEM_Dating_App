import React from 'react';
import {Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle} from 'react-native';
import {Gesture, GestureDetector, ScrollView} from 'react-native-gesture-handler';
import Animated, {runOnJS, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Path} from 'react-native-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {GENDER_DETAILS, GENDER_OPTIONS} from '../../../core/profile/profileOptions';
import {TapChoice} from './ConnectionDesign';

const palettes = {
  light: {text: '#352335', muted: '#715365', accent: '#712C48', onAccent: '#FFFFFF', surface: '#FFFFFF', selected: '#EEDDE3', radio: '#C9BEC3', optional: '#8A747F', more: '#E9B8C9', line: '#E1DBDA', checkbox: '#A5909B'},
  dark: {text: '#FAF7F2', muted: '#BDB5AF', accent: '#F3C1CA', onAccent: '#331C23', surface: '#242321', selected: '#3B2933', radio: '#847A7C', optional: '#9D958F', more: '#3B2933', line: '#302D29', checkbox: '#847A7C'},
};

export function RoundedTick({size = 17, color = '#FFFFFF'}: {size?: number; color?: string}) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    <Path d="M5 12.5L9 16.5Q10.5 18 12 16L19 7" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>;
}

export function GenderChoice({label, selected, disabled = false, onSelect, style, radius = 18, children, dark = false}: {
  label: string; selected: boolean; disabled?: boolean; onSelect: () => void;
  style: StyleProp<ViewStyle>; radius?: number; children: React.ReactNode; dark?: boolean;
}) {
  const touch = useSharedValue(0);
  const touchStyle = useAnimatedStyle(() => ({opacity: touch.value * 0.07}));
  const tap = Gesture.Tap().enabled(!disabled).maxDistance(8)
    .onBegin(() => {touch.value = withTiming(1, {duration: 60});})
    .onEnd((_event, success) => {if (success) runOnJS(onSelect)();})
    .onFinalize(() => {touch.value = withTiming(0, {duration: 120});});
  if (Platform.OS === 'web') return <TapChoice accessibilityRole="radio" accessibilityLabel={label}
    accessibilityState={{checked: selected, disabled}} disabled={disabled} onPress={onSelect}
    onPressIn={() => {touch.value = withTiming(1, {duration: 60});}}
    onPressOut={() => {touch.value = withTiming(0, {duration: 120});}} style={style}>
    <Animated.View pointerEvents="none" accessible={false} style={[s.optionTouch, {borderRadius: radius, backgroundColor: palettes[dark ? 'dark' : 'light'].text}, touchStyle]}/>
    {children}
  </TapChoice>;
  return <GestureDetector gesture={tap}>
    <View accessible accessibilityRole="radio" accessibilityLabel={label}
      accessibilityState={{checked: selected, disabled}}
      onAccessibilityTap={() => {if (!disabled) onSelect();}} style={style}>
      <Animated.View pointerEvents="none" accessible={false} style={[s.optionTouch, {borderRadius: radius, backgroundColor: palettes[dark ? 'dark' : 'light'].text}, touchStyle]}/>
      {children}
    </View>
  </GestureDetector>;
}

export function GenderForm({gender, detail, showGender, busy, onSelectGender, onOpenLabels, onToggleVisibility, dark = false}: {
  gender: string; detail: string; showGender: boolean; busy: boolean;
  onSelectGender: (value: string) => void; onOpenLabels: () => void; onToggleVisibility: () => void; dark?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const compact = height - insets.top - insets.bottom < 720;
  const c = palettes[dark ? 'dark' : 'light'];
  const content = <>
    <Text accessibilityRole="header" style={[s.title, compact && s.titleCompact, {color: c.text}]}>How do you describe{'\n'}your gender?</Text>
    <Text style={[s.subtitle, {color: c.muted}]}>Choose what feels right for you.</Text>
    <View style={[s.options, compact && s.optionsCompact]}>
      {GENDER_OPTIONS.map(option => {
        const selected = gender === option.id;
        return <GenderChoice key={option.id} label={option.label} selected={selected} disabled={busy} dark={dark}
          onSelect={() => onSelectGender(option.id)} radius={20}
          style={[s.option, compact && s.optionCompact, {backgroundColor: selected ? c.selected : c.surface, borderColor: selected ? c.accent : c.surface}]}>
          <Text style={[s.optionText, {color: selected ? c.accent : c.text}]}>{option.label}</Text>
          <View style={[s.radio, {borderColor: selected ? c.accent : c.radio}, selected && {backgroundColor: c.accent}]}>
            {selected && <RoundedTick color={c.onAccent}/>}
          </View>
        </GenderChoice>;
      })}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={detail ? `Gender label: ${detail}. Change label` : 'More about my gender, optional'}
      accessibilityState={{disabled: !gender || busy}} disabled={!gender || busy}
      onPress={onOpenLabels} style={({pressed}) => [s.more, (!gender || busy) && {opacity: 0.45}, pressed && s.pressed]}>
      <View style={s.moreCopy}><Text numberOfLines={1} style={[s.moreText, {color: c.accent}]}>{detail || 'More about my gender'}</Text><Text style={[s.optional, {color: c.optional}]}>{detail ? 'Change label' : 'Optional'}</Text></View>
      <View style={[s.moreIcon, {backgroundColor: c.more}]}><Ionicons name="add" size={18} color={c.accent}/></View>
    </Pressable>
    <Pressable accessibilityRole="checkbox" accessibilityLabel="Show gender on my profile"
      accessibilityState={{checked: showGender, disabled: busy}} disabled={busy} onPress={onToggleVisibility}
      style={({pressed}) => [s.visibility, compact && s.visibilityCompact, {borderTopColor: c.line}, pressed && s.pressed]}>
      <View style={[s.checkbox, {borderColor: showGender ? c.accent : c.checkbox}, showGender && {backgroundColor: c.accent}]}>{showGender && <RoundedTick size={18} color={c.onAccent}/>}</View>
      <Text style={[s.visibilityText, {color: c.muted}]}>Show gender on my profile</Text>
    </Pressable>
  </>;
  if (dark) return <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, compact && s.contentCompact, {flex: undefined, flexGrow: 1}]}>{content}</ScrollView>;
  return <View style={[s.content, compact && s.contentCompact]}>{content}</View>;
}

export function GenderLabelOptions({gender, detail, onSelect, dark = false}: {
  gender: string; detail: string; onSelect: (label: string) => void; dark?: boolean;
}) {
  const c = palettes[dark ? 'dark' : 'light'];
  const labels = GENDER_DETAILS[gender] ?? [];
  return <>
    {[{label: '', description: '', title: `Use “${gender}” only`}, ...labels.map(option => ({...option, title: option.label}))].map(option => <GenderChoice
      key={option.label} label={option.title} selected={detail === option.label} onSelect={() => onSelect(option.label)} dark={dark}
      style={[s.labelOption, {backgroundColor: detail === option.label ? c.selected : dark ? '#3C3937' : c.surface, borderColor: detail === option.label ? c.accent : dark ? '#3C3937' : c.surface}]}>
      <View style={s.labelCopy}><Text style={[s.labelTitle, {color: c.text}]}>{option.title}</Text>{!!option.description && <Text style={[s.labelDescription, {color: c.muted}]}>{option.description}</Text>}</View>
      <View style={[s.radio, {borderColor: detail === option.label ? c.accent : c.radio}, detail === option.label && {backgroundColor: c.accent}]}>{detail === option.label && <RoundedTick color={c.onAccent}/>}</View>
    </GenderChoice>)}
  </>;
}

export const genderStyles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F2F3EE'},
  nav: {paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  back: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  navSpace: {width: 44},
  progress: {flexDirection: 'row', gap: 4, width: 92},
  progressLine: {flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E2D8D1'},
  progressActive: {backgroundColor: '#712C48'},
  content: {flex: 1, width: '100%', maxWidth: 500, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 44},
  contentCompact: {paddingTop: 24},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 36, lineHeight: 48, paddingTop: 2, paddingBottom: 6, paddingHorizontal: 4, includeFontPadding: true, textAlign: 'center', color: '#352335'},
  titleCompact: {fontSize: 32, lineHeight: 43},
  subtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: '#715365', textAlign: 'center', marginTop: 14},
  options: {marginTop: 32, gap: 12},
  optionsCompact: {marginTop: 24, gap: 10},
  option: {minHeight: 68, borderRadius: 20, paddingHorizontal: 22, paddingVertical: 16, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 16},
  optionCompact: {minHeight: 60, paddingVertical: 12},
  optionTouch: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#352335'},
  optionText: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 18, lineHeight: 25, color: '#352335'},
  radio: {width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, borderColor: '#C9BEC3', alignItems: 'center', justifyContent: 'center'},
  more: {minHeight: 66, paddingLeft: 8, paddingRight: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 14},
  moreCopy: {flex: 1},
  moreIcon: {width: 32, height: 32, borderRadius: 16, marginTop: -3, backgroundColor: '#E9B8C9', alignItems: 'center', justifyContent: 'center'},
  moreText: {flexShrink: 1, fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 20, color: '#712C48'},
  optional: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, color: '#8A747F', marginTop: 2},
  visibility: {marginTop: 18, borderTopWidth: 1, borderTopColor: '#E1DBDA', paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 52},
  visibilityCompact: {marginTop: 8, paddingTop: 10},
  checkbox: {width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: '#A5909B', alignItems: 'center', justifyContent: 'center'},
  visibilityText: {flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: '#715365'},
  footer: {paddingHorizontal: 28, paddingTop: 8},
  next: {alignSelf: 'center', minWidth: 132, minHeight: 50, paddingHorizontal: 28, borderRadius: 25, backgroundColor: '#712C48', alignItems: 'center', justifyContent: 'center'},
  nextText: {fontFamily: 'DMSans_500Medium', fontSize: 17, color: '#FFF7FA'},
  error: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', color: '#AE2646', marginBottom: 12},
  pressed: {opacity: 0.6},
  sheet: {flex: 1, backgroundColor: '#F2F3EE'},
  sheetHeader: {flexDirection: 'row', alignItems: 'center', gap: 8},
  sheetTitle: {flex: 1, fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 29, lineHeight: 34, color: '#352335'},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEDDE3', alignItems: 'center', justifyContent: 'center'},
  sheetSubtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: '#715365', marginBottom: 20},
  labelListContent: {gap: 10, paddingHorizontal: 24, paddingTop: 22},
  labelOption: {flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, minHeight: 58, borderRadius: 18, borderWidth: 1, borderColor: '#FFFFFF', backgroundColor: '#FFFFFF'},
  labelCopy: {flex: 1},
  labelTitle: {fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 22, color: '#352335'},
  labelDescription: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: '#715365', marginTop: 5},
});

const s = genderStyles;
