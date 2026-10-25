import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Keyboard, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {CommonActions, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';

import {ATTENDANCE_STYLES} from '../../../core/profile/profileOptions';
import {useOptionalSave} from './useOptionalSave';
import {ConnectionFooter, ConnectionNav, ConnectionSheetHeader, TapChoice, connectionColors as c, connectionStyles as shared} from './ConnectionDesign';

import {socialTints as tints, SocialArt as Art, Check} from './OnboardingFormArtwork';

export function SocialIntroduction() {
  const o = useOptionalSave();
  const {height} = useWindowDimensions();
  const compact = height < 740;
  const [mood, setMood] = useState<string>(o.data.attendanceMood ?? '');
  const [spots, setSpots] = useState<string[]>(o.data.hangoutSpots ?? []);
  const latest = useRef(o); latest.current = o;
  const returned = o.route.params?.socialPlaces;
  useLayoutEffect(() => {if (returned) setSpots(returned.values);}, [returned]);
  useEffect(() => {
    const timer = setTimeout(() => latest.current.draft({attendanceMood: mood, hangoutSpots: spots}), 350);
    return () => clearTimeout(timer);
  }, [mood, spots]);
  const fields = () => ({attendanceMood: mood, hangoutSpots: spots});
  const keep = () => o.draft(fields());
  const open = () => o.navigation.navigate('SocialPlaces', {values: spots, returnKey: o.route.key});
  return <View style={shared.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <ConnectionNav busy={o.busy} onBack={() => {keep(); o.back();}} onSkip={o.skip ? () => {keep(); o.skip?.();} : undefined}/>
    <View style={[s.content, compact && {paddingTop: 10}]}>
      <Text accessibilityRole="header" style={[shared.title, {fontSize: compact ? 32 : 37, lineHeight: compact ? 35 : 40}]}>{'Life beyond\nthe classroom.'}</Text>
      <Text style={shared.subtitle}>A little about your college days.</Text>
      <Text style={s.section}>Your classroom style</Text>
      <View style={s.grid}>{ATTENDANCE_STYLES.map((label, index) => <TapChoice key={label} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{checked: mood === label}} disabled={o.busy} onPress={() => setMood(mood === label ? '' : label)} style={({pressed}) => [s.card, {backgroundColor: tints[index]}, mood === label && s.selected, pressed && shared.pressed]}>
        <View style={[s.check, mood === label && {backgroundColor: c.primary, borderColor: c.primary}]}>{mood === label && <Check/>}</View>
        <View pointerEvents="none" style={[s.art, compact && {height: 54}]}><Art kind={index}/></View>
        <Text style={s.cardLabel}>{label}</Text>
      </TapChoice>)}</View>
      <Text style={[s.section, {marginTop: 16}]}>Find me at…</Text>
      <TapChoice accessibilityRole="button" accessibilityLabel="Add a place" disabled={o.busy} onPress={open} style={({pressed}) => [s.placeCard, pressed && shared.pressed]}>
        <View style={s.cafe} pointerEvents="none"><Art kind={4}/></View>
        <View style={{flex: 1}}><Text style={s.cardLabel}>{spots.length ? 'Your favourite places' : 'Add a place'}</Text><Text style={s.detail}>{spots.length ? `${spots.length} added · Tap to edit` : 'A café, canteen, or favourite spot.'}</Text></View>
        <View style={s.plus}><Ionicons name="add" size={20} color={c.primary}/></View>
      </TapChoice>
      {spots.length > 0 && <View style={s.preview}>{spots.slice(0, 2).map(place => <TapChoice key={place} accessibilityRole="button" accessibilityLabel={`Remove ${place}`} onPress={() => setSpots(old => old.filter(x => x !== place))} style={({pressed}) => [s.pill, pressed && shared.pressed]}><Text numberOfLines={1} style={s.pillText}>{place}</Text><Ionicons name="close" size={14} color={c.primary}/></TapChoice>)}{spots.length > 2 && <TapChoice onPress={open} accessibilityRole="button" accessibilityLabel="View all places" style={s.more}><Text style={s.detail}>+{spots.length - 2}</Text></TapChoice>}</View>}
    </View>
    <ConnectionFooter label={o.action} disabled={false} busy={o.busy} error={o.error} onNext={() => {keep(); o.saveOptional(fields());}}/>
  </View>;
}

export function SocialPlacesSheet() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const [places, setPlaces] = useState<string[]>(route.params?.values ?? []);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<TextInput>(null);
  const commit = (values: string[]) => {
    setPlaces(values);
    navigation.dispatch({...CommonActions.setParams({socialPlaces: {values, revision: Date.now()}}), source: route.params?.returnKey});
  };
  const add = () => {
    const place = text.trim().replace(/\s+/g, ' ');
    if (!place) return;
    if (places.some(value => value.toLowerCase() === place.toLowerCase())) {setError('This place is already added.'); return;}
    if (places.length >= 50) {setError('You can add up to 50 places.'); return;}
    commit([...places, place]); setText(''); setError('');
    input.current?.focus();
  };
  const close = () => {Keyboard.dismiss(); navigation.goBack();};
  return <ScrollView nestedScrollEnabled style={shared.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{padding: 24, paddingBottom: Math.max(insets.bottom, 18) + 24}}>
    <ConnectionSheetHeader title="Your favourite places" onClose={close}/>
    <Text style={[shared.subtitle, {marginBottom: 18}]}>Add one place at a time.</Text>
    <View style={[s.inputRow, focused && s.selected]}>
      <Ionicons name="location-outline" size={21} color={c.primary}/>
      <TextInput ref={input} accessibilityLabel="Place name" value={text} onChangeText={value => {setText(value); setError('');}} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder="e.g. College canteen" placeholderTextColor="#927E89" selectionColor={c.primary} maxLength={100} returnKeyType="done" submitBehavior="submit" onSubmitEditing={add} style={s.input}/>
      <TapChoice accessibilityRole="button" accessibilityLabel="Add this place" disabled={!text.trim()} onPress={add} style={({pressed}) => [s.addButton, !text.trim() && {opacity: 0.4}, pressed && shared.pressed]}><Ionicons name="add" size={24} color="#FFF"/></TapChoice>
    </View>
    {!!error && <Text accessibilityRole="alert" style={shared.error}>{error}</Text>}
    <Text accessibilityLiveRegion="polite" style={s.section}>{places.length ? `${places.length} ${places.length === 1 ? 'place' : 'places'} added` : 'Your places will appear here'}</Text>
    <View style={s.placePills}>{places.map(place => <TapChoice key={place} accessibilityRole="button" accessibilityLabel={`Remove ${place}`} onPress={() => {commit(places.filter(value => value !== place)); setError('');}} style={({pressed}) => [s.pill, {maxWidth: '100%'}, pressed && shared.pressed]}><Text style={s.pillText}>{place}</Text><Ionicons name="close" size={16} color={c.primary}/></TapChoice>)}</View>
    <TapChoice accessibilityRole="button" accessibilityLabel="Done" onPress={close} style={({pressed}) => [shared.next, {marginTop: 24}, pressed && shared.pressed]}><Text style={shared.nextText}>Done</Text></TapChoice>
  </ScrollView>;
}
const s = StyleSheet.create({
  content: {flex: 1, width: '100%', maxWidth: 500, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 18},
  section: {fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 20, color: c.text, marginTop: 20, marginBottom: 10},
  grid: {flex: 1, maxHeight: 284, flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  card: {width: '48%', height: '48%', borderRadius: 22, borderWidth: 1, borderColor: 'transparent', padding: 12, justifyContent: 'flex-end'},
  selected: {borderColor: '#96516F'},
  check: {position: 'absolute', right: 12, top: 10, width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: '#BCAEBA', backgroundColor: '#FFFFFF77', justifyContent: 'center', alignItems: 'center'},
  art: {height: 70, width: 78, marginBottom: 5},
  cardLabel: {fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 21, color: c.text},
  placeCard: {minHeight: 86, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 10},
  cafe: {width: 58, height: 62},
  detail: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: c.muted, marginTop: 4},
  plus: {width: 30, height: 30, borderRadius: 15, backgroundColor: c.wash, justifyContent: 'center', alignItems: 'center'},
  preview: {flexDirection: 'row', gap: 6, marginTop: 10, height: 38},
  pill: {maxWidth: '43%', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.wash, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 9, minHeight: 38},
  pillText: {flexShrink: 1, fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: c.primary},
  more: {minWidth: 32, justifyContent: 'center'},
  inputRow: {flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: c.line, backgroundColor: '#FFFFFF', borderRadius: 28, padding: 6, paddingLeft: 16, marginBottom: 10},
  input: {flex: 1, minHeight: 44, paddingVertical: 10, fontFamily: 'DMSans_400Regular', fontSize: 15, color: c.text},
  addButton: {width: 42, height: 42, borderRadius: 21, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center'},
  placePills: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
});

