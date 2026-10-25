import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Keyboard, Pressable, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {Gesture, GestureDetector, ScrollView} from 'react-native-gesture-handler';
import Animated, {runOnJS, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {KeyboardAwareScrollView, KeyboardAvoidingView} from 'react-native-keyboard-controller';
import {Ionicons} from '@expo/vector-icons';
import {useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Path} from 'react-native-svg';
import {ACADEMIC_COURSES, DEGREE_OPTIONS, normalizeAcademicCourse} from '../../../core/profile/profileOptions';
import {useOnboarding} from './useOnboarding';

type StudyField = 'degree' | 'department';

function Tick() {
  return <Svg width={17} height={17} viewBox="0 0 24 24" accessible={false}><Path d="M5 12.5L9 16.5Q10.5 18 12 16L19 7" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/></Svg>;
}

function StudyChoice({label, value, placeholder, disabled, onPress}: {label: string; value: string; placeholder: string; disabled: boolean; onPress: () => void}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || placeholder}`} disabled={disabled} onPress={onPress} style={({pressed}) => [s.field, s.choice, pressed && s.pressed]}>
    <View style={s.fieldCopy}><Text style={s.label}>{label}</Text><Text style={[s.value, !value && s.placeholder]}>{value || placeholder}</Text></View>
    <Ionicons name="chevron-down" size={18} color="#712C48"/>
  </Pressable>;
}

function StudyOption({value, selected, onSelect}: {value: string; selected: boolean; onSelect: (value: string) => void}) {
  const touch = useSharedValue(0);
  const touchStyle = useAnimatedStyle(() => ({opacity: touch.value * 0.07}));
  const tap = Gesture.Tap().maxDistance(8)
    .onBegin(() => {touch.value = withTiming(1, {duration: 60});})
    .onEnd((_event, success) => {if (success) runOnJS(onSelect)(value);})
    .onFinalize(() => {touch.value = withTiming(0, {duration: 120});});
  return <GestureDetector gesture={tap}>
    <View accessible accessibilityRole="radio" accessibilityLabel={value} accessibilityState={{checked: selected}}
      onAccessibilityTap={() => onSelect(value)} style={[s.sheetOption, selected && s.sheetSelected]}>
      <Animated.View pointerEvents="none" accessible={false} style={[s.optionTouch, touchStyle]}/>
      <Text style={s.optionText}>{value}</Text><View style={[s.radio, selected && s.radioSelected]}>{selected && <Tick/>}</View>
    </View>
  </GestureDetector>;
}

export function AcademicIntroduction() {
  const o = useOnboarding();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const [department, setDepartment] = useState(normalizeAcademicCourse(o.data.department ?? ''));
  const [degree, setDegree] = useState(o.data.degree ?? '');
  const [year, setYear] = useState(String(o.data.graduationYear ?? ''));
  const [currentYear, setCurrentYear] = useState(String(o.data.yearOfStudy ?? ''));
  const [focused, setFocused] = useState<'graduation' | 'current' | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const yearValid = /^\d{4}$/.test(year) && Number(year) >= 2020 && Number(year) <= 2100;
  const currentValid = !currentYear || (Number(currentYear) >= 1 && Number(currentYear) <= 10);
  const valid = department.length >= 2 && !!degree && yearValid && currentValid;
  const selection = o.route.params?.academicSelection;
  useLayoutEffect(() => {
    if (selection?.field === 'degree') setDegree(selection.value);
    if (selection?.field === 'department') setDepartment(selection.value);
    if (selection) setError('');
  }, [selection]);
  useEffect(() => {
    const timer = setTimeout(() => o.draft({department, degree,
      ...(yearValid ? {graduationYear: Number(year)} : {}),
      ...(currentYear && currentValid ? {yearOfStudy: Number(currentYear)} : {}),
    }), 150);
    return () => clearTimeout(timer);
  }, [department, degree, year, currentYear]);
  const open = (field: StudyField) => {
    Keyboard.dismiss();
    o.navigation.navigate('AcademicOptions', {field, value: field === 'degree' ? degree : department, returnTo: o.route.name});
  };
  const next = async () => {
    if (!valid || busy) return;
    Keyboard.dismiss(); setBusy(true); setError('');
    try {
      await o.save({department, degree, graduationYear: Number(year), ...(currentYear ? {yearOfStudy: Number(currentYear)} : {})});
      o.next('SeekingSelection');
    } catch {setError('Could not save your studies. Try again.');}
    finally {setBusy(false);}
  };
  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor="#F2F3EE"/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={busy} onPress={o.back} style={({pressed}) => [s.back, pressed && s.pressed]}><Ionicons name="arrow-back" size={22} color="#352335"/></Pressable>
      <View accessibilityLabel="Stage 2 of 4: Your world" style={s.progress}>{[0, 1, 2, 3].map(stage => <View key={stage} style={[s.progressLine, stage <= 1 && s.progressActive]}/>)}</View>
      <View style={{width: 44}}/>
    </View>
    <KeyboardAvoidingView style={{flex: 1}} behavior="padding" automaticOffset>
      <KeyboardAwareScrollView bottomOffset={32} style={{flex: 1}} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, {paddingTop: height < 760 ? 16 : 24}]}>
        <Text accessibilityRole="header" style={s.title}>What do you{'\n'}study?</Text>
        <Text style={s.subtitle}>Add your degree and course.</Text>
        <View style={s.fields}>
          <StudyChoice label="Degree type" value={degree} placeholder="Choose your degree" disabled={busy} onPress={() => open('degree')}/>
          <StudyChoice label="Course / branch" value={department} placeholder="Choose your course or branch" disabled={busy} onPress={() => open('department')}/>
        </View>
        <View style={s.yearSection}>
          <Text style={s.sectionLabel}>YOUR TIMELINE</Text>
          <View style={[s.years, width < 360 && s.yearsStack]}>
            <View style={s.yearColumn}>
              <View style={[s.field, focused === 'graduation' && s.focused, year.length === 4 && !yearValid && s.invalid]}>
                <Text style={s.label}>Graduation year</Text>
                <TextInput accessibilityLabel="Graduation year" value={year} editable={!busy} keyboardType="number-pad" maxLength={4} placeholder="YYYY" placeholderTextColor="#9A8792" selectionColor="#712C48" onFocus={() => setFocused('graduation')} onBlur={() => setFocused(null)} onChangeText={text => setYear(text.replace(/\D/g, ''))} style={s.yearInput}/>
              </View>
              {year.length === 4 && !yearValid && <Text accessibilityRole="alert" style={s.fieldError}>Use a year from 2020 to 2100.</Text>}
            </View>
            <View style={s.yearColumn}>
              <View style={[s.field, focused === 'current' && s.focused, !currentValid && s.invalid]}>
                <Text style={s.label}>Year of study</Text>
                <TextInput accessibilityLabel="Year of study" value={currentYear} editable={!busy} keyboardType="number-pad" maxLength={2} placeholder="e.g. 2" placeholderTextColor="#9A8792" selectionColor="#712C48" onFocus={() => setFocused('current')} onBlur={() => setFocused(null)} onChangeText={text => setCurrentYear(text.replace(/\D/g, ''))} style={s.yearInput}/>
              </View>
              {!currentValid && <Text accessibilityRole="alert" style={s.fieldError}>Use a number from 1 to 10.</Text>}
            </View>
          </View>
        </View>
      </KeyboardAwareScrollView>
      <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 16) + 16}]}>
        {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Continue to dating intentions" accessibilityState={{disabled: !valid || busy, busy}} disabled={!valid || busy} onPress={next} style={({pressed}) => [s.next, (!valid || busy) && {opacity: 0.45}, pressed && s.pressed]}><Text style={s.nextText}>Continue</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  </View>;
}

export function AcademicOptionsSheet() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const field: StudyField = route.params?.field ?? 'degree';
  const isCourse = field === 'department';
  const [selected, setSelected] = useState(route.params?.value ?? '');
  const [search, setSearch] = useState('');
  const selecting = useRef(false), dismissFrame = useRef<number | null>(null);
  useEffect(() => () => {if (dismissFrame.current !== null) cancelAnimationFrame(dismissFrame.current);}, []);
  const groups = isCourse ? ACADEMIC_COURSES.map(group => ({...group, courses: group.courses.filter(value => value.toLowerCase().includes(search.trim().toLowerCase()))})).filter(group => group.courses.length)
    : [{title: '', courses: [...DEGREE_OPTIONS]}];
  const select = (value: string) => {
    if (selecting.current) return;
    selecting.current = true; setSelected(value); Keyboard.dismiss();
    dismissFrame.current = requestAnimationFrame(() => navigation.popTo(route.params?.returnTo ?? 'AcademicSelection', {academicSelection: {field, value}}, {merge: true}));
  };
  return <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={s.sheet} contentContainerStyle={[s.sheetContent, {paddingBottom: Math.max(insets.bottom, 18) + 24}]} showsVerticalScrollIndicator>
    <View style={s.sheetHeader}>
      <Text accessibilityRole="header" style={s.sheetTitle}>{isCourse ? 'Course / branch' : 'Degree type'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close study options" onPress={() => navigation.goBack()} style={({pressed}) => [s.close, pressed && s.pressed]}><Ionicons name="close" size={22} color="#352335"/></Pressable>
    </View>
    {isCourse && <View style={s.searchBox}><Ionicons name="search-outline" size={20} color="#8A747F"/><TextInput accessibilityLabel="Search courses" value={search} onChangeText={setSearch} placeholder="Search courses" placeholderTextColor="#9A8792" selectionColor="#712C48" style={s.searchInput}/></View>}
    {groups.map(group => <View key={group.title} style={s.group}>
      {!!group.title && <Text style={s.groupLabel}>{group.title}</Text>}
      {group.courses.map(value => <StudyOption key={value} value={value} selected={selected === value} onSelect={select}/>)}
    </View>)}
    {!groups.length && <Text style={s.empty}>No courses found. Try another name.</Text>}
  </ScrollView>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F2F3EE'},
  nav: {paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  back: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  progress: {flexDirection: 'row', gap: 4, width: 92},
  progressLine: {flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E2D8D1'},
  progressActive: {backgroundColor: '#712C48'},
  content: {paddingHorizontal: 24, paddingBottom: 20, width: '100%', maxWidth: 500, alignSelf: 'center'},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 40, lineHeight: 52, paddingBottom: 6, textAlign: 'center', color: '#352335'},
  subtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: '#715365', textAlign: 'center', marginTop: 6},
  fields: {marginTop: 24, gap: 12},
  field: {minHeight: 78, backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 12, borderWidth: 1.5, borderColor: '#FFFFFF'},
  choice: {flexDirection: 'row', alignItems: 'center', gap: 12},
  fieldCopy: {flex: 1},
  label: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, color: '#8A747F'},
  value: {fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 23, color: '#352335', marginTop: 4},
  placeholder: {color: '#9A8792'},
  yearSection: {marginTop: 24},
  sectionLabel: {fontFamily: 'DMSans_700Bold', fontSize: 10, letterSpacing: 1.2, color: '#8A747F', marginBottom: 12},
  years: {flexDirection: 'row', gap: 12},
  yearsStack: {flexDirection: 'column'},
  yearColumn: {flex: 1},
  yearInput: {fontFamily: 'DMSans_500Medium', fontSize: 18, lineHeight: 25, color: '#352335', padding: 0, marginTop: 4, minHeight: 28},
  focused: {borderColor: '#712C48'},
  invalid: {borderColor: '#AE2646'},
  fieldError: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: '#AE2646', marginTop: 5},
  footer: {paddingTop: 12, paddingHorizontal: 28, backgroundColor: '#F2F3EE'},
  next: {alignSelf: 'center', minWidth: 132, minHeight: 50, paddingHorizontal: 28, borderRadius: 25, backgroundColor: '#712C48', alignItems: 'center', justifyContent: 'center'},
  nextText: {fontFamily: 'DMSans_500Medium', fontSize: 17, color: '#FFF7FA'},
  error: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', color: '#AE2646', marginBottom: 12},
  pressed: {opacity: 0.6},
  sheet: {flex: 1, backgroundColor: '#F2F3EE'},
  sheetContent: {paddingHorizontal: 24, paddingTop: 22, gap: 16},
  sheetHeader: {flexDirection: 'row', alignItems: 'center', gap: 8},
  sheetTitle: {flex: 1, fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 30, lineHeight: 38, paddingBottom: 4, color: '#352335'},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEDDE3', alignItems: 'center', justifyContent: 'center'},
  searchBox: {minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 26, backgroundColor: '#FFFFFF', paddingHorizontal: 18},
  searchInput: {flex: 1, minHeight: 52, fontFamily: 'DMSans_400Regular', fontSize: 15, color: '#352335'},
  group: {gap: 8},
  groupLabel: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: '#8A747F', marginBottom: 4},
  sheetOption: {minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: '#FFFFFF', backgroundColor: '#FFFFFF'},
  sheetSelected: {borderColor: '#712C48', backgroundColor: '#EEDDE3'},
  optionTouch: {position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 18, backgroundColor: '#352335'},
  optionText: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 22, color: '#352335'},
  radio: {width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, borderColor: '#C9BEC3', alignItems: 'center', justifyContent: 'center'},
  radioSelected: {backgroundColor: '#712C48', borderColor: '#712C48'},
  empty: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: '#715365'},
});
