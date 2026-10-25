import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, StatusBar, Text, View, useWindowDimensions} from 'react-native';
import {ScrollView} from 'react-native-gesture-handler';
import {Ionicons} from '@expo/vector-icons';
import {CommonActions, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {GENDER_DETAILS, GENDER_OPTIONS} from '../../../core/profile/profileOptions';
import {useOnboarding} from './useOnboarding';
import {GenderForm, GenderLabelOptions, genderStyles as s} from './GenderForm';

export function GenderIntroduction() {
  const o = useOnboarding();
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const compact = height - insets.top - insets.bottom < 720;
  const initial = GENDER_OPTIONS.find(option => option.id === o.data.gender)?.id
    ?? Object.keys(GENDER_DETAILS).find(key => GENDER_DETAILS[key].some(option => option.label === o.data.gender)) ?? '';
  const [gender, setGender] = useState(initial);
  const [detail, setDetail] = useState(initial && o.data.gender !== initial ? o.data.gender : '');
  const [showGender, setShowGender] = useState(o.data.showGender ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!gender) return;
    const timer = setTimeout(() => o.draft({gender: detail || gender, showGender}), 150);
    return () => clearTimeout(timer);
  }, [gender, detail, showGender]);
  const next = async () => {
    if (!gender || busy) return;
    setBusy(true); setError('');
    try {await o.save({gender: detail || gender, showGender}); o.next('CollegeSelection');}
    catch {setError('Could not save your gender. Try again.');}
    finally {setBusy(false);}
  };
  const labelSelection = o.route.params?.genderLabelSelection;
  useLayoutEffect(() => {
    if (labelSelection?.gender === gender) {setDetail(labelSelection.detail); setError('');}
  }, [labelSelection]);
  const selectGender = (value: string) => {
    if (busy) return;
    if (gender !== value) {setGender(value); setDetail('');}
    setError('');
  };
  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor="#F2F3EE"/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={busy} onPress={o.back} style={({pressed}) => [s.back, pressed && s.pressed]}>
        <Ionicons name="arrow-back" size={22} color="#352335"/>
      </Pressable>
      <View accessibilityLabel="Stage 1 of 4: About you" style={s.progress}>
        {[0, 1, 2, 3].map(stage => <View key={stage} style={[s.progressLine, stage === 0 && s.progressActive]}/>)}
      </View>
      <View style={s.navSpace}/>
    </View>
    <GenderForm gender={gender} detail={detail} showGender={showGender} busy={busy}
      onSelectGender={selectGender} onOpenLabels={() => o.navigation.navigate('GenderLabels', {gender, detail})}
      onToggleVisibility={() => setShowGender(!showGender)}/>
    <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 16) + (compact ? 16 : 42)}]}>
      {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Continue to college" accessibilityState={{disabled: !gender || busy, busy}}
        disabled={!gender || busy} onPress={next} style={({pressed}) => [s.next, (!gender || busy) && {opacity: 0.45}, pressed && s.pressed]}>
        {busy ? <ActivityIndicator color="#FFF7FA"/> : <Text style={s.nextText}>Continue</Text>}
      </Pressable>
    </View>
  </View>;
}

export function ProfileGenderLabelsSheet() {
  return <GenderLabelsSheet dark/>;
}

export function GenderLabelsSheet({dark = false}: {dark?: boolean} = {}) {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const gender = route.params?.gender ?? '';
  const detail = route.params?.detail ?? '';
  const [selectedLabel, setSelectedLabel] = useState(detail);
  const selecting = useRef(false);
  const dismissFrame = useRef<number | null>(null);
  useEffect(() => () => {if (dismissFrame.current !== null) cancelAnimationFrame(dismissFrame.current);}, []);
  const labels = GENDER_DETAILS[gender] ?? [];
  const selectLabel = (label: string) => {
    if (selecting.current) return;
    selecting.current = true;
    setSelectedLabel(label);
    dismissFrame.current = requestAnimationFrame(() => {
      if (dark) {
        if (route.params?.returnKey) navigation.dispatch({
          ...CommonActions.setParams({genderLabelSelection: {gender, detail: label}}),
          source: route.params.returnKey,
        });
        navigation.goBack();
      } else navigation.popTo('GenderSelection', {genderLabelSelection: {gender, detail: label}}, {merge: true});
    });
  };
  return <ScrollView nestedScrollEnabled style={[s.sheet, dark && {backgroundColor: '#242321'}]} contentContainerStyle={[s.labelListContent, {paddingBottom: Math.max(insets.bottom, 18) + 24}]} showsVerticalScrollIndicator>
    <View style={s.sheetHeader}>
      <Text accessibilityRole="header" style={[s.sheetTitle, dark && {color: '#FAF7F2'}]}>More about your gender</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close gender labels" onPress={() => navigation.goBack()} style={({pressed}) => [s.close, dark && {backgroundColor: '#3B2933'}, pressed && s.pressed]}>
        <Ionicons name="close" size={22} color={dark ? '#FAF7F2' : '#352335'}/>
      </Pressable>
    </View>
    <Text style={[s.sheetSubtitle, dark && {color: '#BDB5AF'}]}>{labels.length} labels · Optional · Scroll to see all</Text>
    <GenderLabelOptions gender={gender} detail={selectedLabel} onSelect={selectLabel} dark={dark}/>
  </ScrollView>;
}
