import React from 'react';
import {Image, Platform, StyleSheet, Text, View, type PressableProps, type TextStyle, type ViewStyle} from 'react-native';
import {TapChoice} from '../features/auth/onboarding/ConnectionDesign';

export const editColors = {
  canvas: '#100F0D', surface: '#242321', elevated: '#302D29', text: '#FAF7F2',
  muted: '#BDB5AF', hint: '#9D958F', accent: '#F3C1CA', onAccent: '#331C23',
  selected: '#3B2933', mint: '#B6DCCA', amber: '#E8C185', lavender: '#CEC0EB',
};

const artwork = {
  EditGender: require('../../assets/illustrations/include-me-nonbinary-3d.png'),
  EditSeeking: require('../../assets/illustrations/welcome-heart-ribbon.png'),
  EditOrientation: require('../../assets/illustrations/welcome-love-chat-3d.png'),
  EditCollege: require('../../assets/illustrations/reminder-campus-3d-v1.png'),
  EditCampus: require('../../assets/illustrations/reminder-map-3d-v1.png'),
  EditBio: require('../../assets/illustrations/reminder-chat-3d-v1.png'),
  EditInterests: require('../../assets/illustrations/chat-media-3d-v1.png'),
} as const;

export function EditHeading({children, screen}: {children: React.ReactNode; screen: string}) {
  const source = artwork[screen as keyof typeof artwork];
  return <View style={design.heading}>
    <View style={{flex: 1, minWidth: 0}}><Text style={design.eyebrow}>YOUR PROFILE</Text><Text accessibilityRole="header" style={design.title}>{children}</Text></View>
    {source && <Image accessible={false} source={Platform.OS === 'web' ? {uri: source as unknown as string} : source}
      resizeMode="contain" fadeDuration={0} style={design.artwork}/>}
  </View>;
}

/** Uses the same release-to-select control as the newer onboarding forms. */
export function EditTapChoice({onPress, style, activeOpacity: _activeOpacity, ...props}: Omit<PressableProps, 'onPress'> & {onPress?: () => void; activeOpacity?: number}) {
  return <TapChoice {...props} disabled={props.disabled || !onPress} accessibilityRole={props.accessibilityRole ?? 'button'}
    aria-checked={props['aria-checked'] ?? props.accessibilityState?.checked}
    onPress={onPress ?? (() => {})} style={state => [typeof style === 'function' ? style(state) : style,
      state.pressed && {opacity: 0.82, transform: [{scale: 0.985}]}]}/>;
}

type FormStyle = TextStyle & ViewStyle;
const rowKeys = new Set(['card', 'courseItem', 'collegeItem', 'genderOption', 'subOptionCard', 'optionItem']);
const rowSelectedKeys = new Set(['cardSelected', 'courseItemSelected', 'collegeItemSelected', 'genderOptionSelected', 'subOptionCardSelected', 'optionItemSelected']);
const chipKeys = new Set(['pill', 'choice', 'yearPill', 'batchItem']);
const chipSelectedKeys = new Set(['pillSelected', 'selectedChoice', 'yearPillSelected', 'batchItemSelected']);
const chipTextKeys = new Set(['pillText', 'choiceText', 'yearText', 'batchText']);
const chipTextSelectedKeys = new Set(['pillTextSelected', 'selectedText', 'yearTextSelected', 'batchTextSelected']);

/** Keeps each editor's layout and data handling, with one dark form palette. */
export function createEditStyles<T extends StyleSheet.NamedStyles<T>>(source: T): T {
  const result = {} as T;
  for (const key of Object.keys(source) as Array<keyof T & string>) {
    const value = {...source[key]} as FormStyle;
    if (value.fontSize) {
      value.fontFamily = Number(value.fontWeight) >= 600 || value.fontWeight === 'bold' ? 'DMSans_700Bold' : 'DMSans_400Regular';
      value.fontWeight = undefined;
      if (!value.lineHeight) value.lineHeight = Math.ceil(value.fontSize * 1.4);
    }
    if (['container', 'screen'].includes(key)) value.backgroundColor = editColors.canvas;
    if (key === 'scrollContent') Object.assign(value, {padding: 24, paddingTop: 14, paddingBottom: 40});
    if (key === 'content' && (value.padding || value.paddingHorizontal)) Object.assign(value, {paddingHorizontal: 24, paddingTop: 14});
    if (key === 'title') Object.assign(value, design.title, {marginBottom: 10});
    if (key === 'subtitle') Object.assign(value, {fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 23, color: editColors.muted, marginBottom: 22});
    if (['sectionTitle', 'sectionLabel', 'catTitle'].includes(key)) Object.assign(value, {fontFamily: 'DMSans_700Bold', fontSize: 17, lineHeight: 24, color: editColors.text, textTransform: 'none', letterSpacing: 0});
    if (rowKeys.has(key)) Object.assign(value, {backgroundColor: editColors.surface, borderWidth: 0, borderBottomWidth: 0, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 16, minHeight: 64, height: undefined, marginBottom: 10});
    if (rowSelectedKeys.has(key)) Object.assign(value, {backgroundColor: editColors.selected, borderWidth: 0, borderBottomWidth: 0});
    if (['courseText', 'collegeText', 'primaryGenderText', 'optionText', 'cardText', 'label'].includes(key)) Object.assign(value, {fontFamily: 'DMSans_500Medium', color: editColors.text, fontSize: 16, lineHeight: 23, flexShrink: 1});
    if (['description', 'subOptionDescription', 'note', 'visibilityText'].includes(key)) Object.assign(value, {fontFamily: 'DMSans_400Regular', color: editColors.muted, lineHeight: 21});
    if (chipKeys.has(key)) Object.assign(value, {backgroundColor: editColors.surface, borderWidth: 0, minHeight: 46, height: undefined, borderRadius: 23, paddingVertical: 11, paddingHorizontal: 16, justifyContent: 'center'});
    if (chipSelectedKeys.has(key)) Object.assign(value, {backgroundColor: editColors.accent, borderWidth: 0});
    if (chipTextKeys.has(key)) Object.assign(value, {fontFamily: 'DMSans_500Medium', color: editColors.text, fontSize: key === 'batchText' ? 20 : 15, lineHeight: 23});
    if (chipTextSelectedKeys.has(key)) Object.assign(value, {color: editColors.onAccent, fontFamily: 'DMSans_700Bold'});
    if (['inputContainer', 'inputCard', 'bioCard', 'searchContainer'].includes(key)) Object.assign(value, {backgroundColor: editColors.surface, borderWidth: 0, borderRadius: 22});
    if (['input', 'bioInput', 'searchInput'].includes(key)) Object.assign(value, {color: editColors.text, fontFamily: 'DMSans_400Regular', fontSize: 16, lineHeight: 24});
    if (key === 'optionCard') Object.assign(value, {width: '48%', minHeight: 110, height: undefined, aspectRatio: undefined, backgroundColor: editColors.surface, borderWidth: 0, borderRadius: 24, padding: 16});
    if (key === 'optionCardSelected') Object.assign(value, {backgroundColor: editColors.selected, borderWidth: 0});
    if (key === 'optionTitle') Object.assign(value, {color: editColors.text, fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 23});
    if (key === 'charCount') Object.assign(value, {color: editColors.muted, fontSize: 12, lineHeight: 18});
    if (key === 'gridContainer') Object.assign(value, {gap: 10});
    if (key === 'batchItem') Object.assign(value, {width: '30%', minHeight: 62, aspectRatio: undefined});
    if (key === 'dateInputContainer') Object.assign(value, {gap: 3, marginTop: 14});
    if (key === 'digitInput') Object.assign(value, {width: undefined, flex: 1, minWidth: 0, height: 54, fontFamily: 'DMSans_500Medium', fontSize: 24, lineHeight: 32, backgroundColor: editColors.surface, borderRadius: 10, borderBottomWidth: 0});
    if (key === 'separator') Object.assign(value, {marginHorizontal: 0, fontSize: 20});
    if (key === 'footer' && value.marginTop) value.marginTop = 22;
    result[key] = value as T[typeof key];
  }
  return StyleSheet.create(result);
}

const design = StyleSheet.create({
  heading: {flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 12, marginBottom: 12},
  eyebrow: {fontFamily: 'DMSans_700Bold', fontSize: 10, lineHeight: 16, letterSpacing: 1.5, color: editColors.muted, marginBottom: 7},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 38, lineHeight: 44, color: editColors.text, paddingBottom: 5, fontWeight: undefined},
  artwork: {width: 82, height: 96, flexShrink: 0},
});
