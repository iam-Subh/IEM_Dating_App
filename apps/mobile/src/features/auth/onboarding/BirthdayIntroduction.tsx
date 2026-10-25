import React, {useEffect, useMemo, useState} from 'react';
import {View, Text, Pressable, StatusBar, StyleSheet, ActivityIndicator, useWindowDimensions} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {LinearGradient} from 'expo-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {birthdayFromParts} from './profileValues';
import {useOnboarding} from './useOnboarding';

import {DateWheel, MONTHS, ROW, WINDOW} from './BirthdayDateWheel';

export function BirthdayIntroduction() {
  const o = useOnboarding();
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const compact = height - insets.top - insets.bottom < 720;
  const date = o.data.birthday ? new Date(o.data.birthday) : null;
  const [day, setDay] = useState(date ? String(date.getUTCDate()) : '');
  const [month, setMonth] = useState(date ? String(date.getUTCMonth() + 1) : '');
  const [year, setYear] = useState(date ? String(date.getUTCFullYear()) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<Record<string, string>>({});
  const result = birthdayFromParts(day, month, year);
  const valid = !!result && result.age >= 18;
  const scrolling = Object.values(moving).some(Boolean);
  const previewMonth = preview.Month ?? month;
  const previewYear = preview.Year ?? year;
  const previewDay = preview.Day ?? day;
  const previewDayCount = previewMonth ? new Date(Date.UTC(Number(previewYear) || 2000, Number(previewMonth), 0)).getUTCDate() : 31;
  const displayResult = birthdayFromParts(previewDay ? String(Math.min(Number(previewDay), previewDayCount)) : '', previewMonth, previewYear);
  const displayComplete = !!previewDay && !!previewMonth && !!previewYear;
  useEffect(() => {if (!scrolling) setPreview({});}, [scrolling]);
  const enabled = valid && !busy && !scrolling;
  const dayCount = month ? new Date(Date.UTC(Number(year) || 2000, Number(month), 0)).getUTCDate() : 31;
  const days = useMemo(() => [{value: '', label: 'DD'}, ...Array.from({length: dayCount}, (_, i) => ({value: String(i + 1), label: String(i + 1).padStart(2, '0')}))], [dayCount]);
  const months = useMemo(() => [{value: '', label: 'MMM'}, ...MONTHS.map((label, i) => ({value: String(i + 1), label}))], []);
  const years = useMemo(() => {
    const newest = Math.max(new Date().getFullYear() - 18, Number(year) || 0);
    return [{value: '', label: 'YYYY'}, ...Array.from({length: newest - 1919}, (_, i) => ({value: String(newest - i), label: String(newest - i)}))];
  }, []);
  useEffect(() => {if (Number(day) > dayCount) setDay(String(dayCount));}, [dayCount, day]);
  useEffect(() => {if (valid && result && !scrolling) o.draft({birthday: result.birthday});}, [day, month, year, scrolling]);
  const next = async () => {
    if (!enabled || !result) return;
    setBusy(true); setError('');
    try {await o.save({birthday: result.birthday}); o.next('GenderSelection');}
    catch {setError('Could not save your birthday. Try again.');}
    finally {setBusy(false);}
  };
  const wheels = [
    {label: 'Day', options: days, value: String(Math.min(Number(day), dayCount) || ''), set: setDay, key: 'day'},
    {label: 'Month', options: months, value: month, set: setMonth, key: 'month'},
    {label: 'Year', options: years, value: year, set: setYear, key: 'year'},
  ];
  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor="#F2F3EE"/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      <Pressable onPress={o.back} disabled={busy} accessibilityRole="button" accessibilityLabel="Back" style={({pressed}) => [s.back, pressed && {opacity: 0.5}]}>
        <Ionicons name="arrow-back" size={22} color="#352335"/>
      </Pressable>
      <View accessibilityLabel="Stage 1 of 4: About you" style={s.progress}>
        {[0, 1, 2, 3].map(stage => <View key={stage} style={[s.progressLine, stage === 0 && s.progressActive]}/>)}
      </View>
      <View style={s.navSpace}/>
    </View>
    <View style={[s.content, compact && s.contentCompact]}>
      <Text accessibilityRole="header" style={[s.title, compact && s.titleCompact]}>When’s your{'\n'}birthday?</Text>
      <Text style={s.subtitle}>Only your age appears on your profile.</Text>
      <View style={[s.picker, compact && s.pickerCompact]}>
        <View pointerEvents="none" style={s.selectionStrip}/>
        <View style={s.columns}>
          {wheels.map(wheel => <DateWheel key={wheel.key} label={wheel.label} options={wheel.options} value={wheel.value} disabled={busy}
            onPreview={value => setPreview(previous => ({...previous, [wheel.label]: value}))}
            onChange={value => {wheel.set(value); setError('');}}
            onMoving={value => setMoving(previous => ({...previous, [wheel.label]: value}))}/>)}
        </View>
        <LinearGradient pointerEvents="none" colors={['#F2F3EE', '#F2F3EE00']} style={s.fadeTop}/>
        <LinearGradient pointerEvents="none" colors={['#F2F3EE00', '#F2F3EE']} style={s.fadeBottom}/>
      </View>
      <View style={s.feedback}>
        {displayComplete && (!displayResult || displayResult.age < 18) ? <Text accessibilityRole="alert" style={s.validation}>{displayResult ? 'You must be at least 18 to join.' : 'Select a valid date.'}</Text>
          : <Text accessibilityLiveRegion="polite" style={[s.ageText, !displayComplete && s.hint]}>{displayResult && displayResult.age >= 18 ? `You’re ${displayResult.age}` : 'Swipe to choose your date'}</Text>}
      </View>
    </View>
    <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 16) + (compact ? 20 : 42)}]}>
      {!!error && <Text accessibilityRole="alert" style={s.validation}>{error}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Continue to gender" accessibilityState={{disabled: !enabled, busy}} disabled={!enabled} onPress={next} style={({pressed}) => [s.next, !enabled && {opacity: 0.45}, pressed && {opacity: 0.75}]}>
        {busy ? <ActivityIndicator color="#FFF7FA"/> : <Text style={s.nextText}>Continue</Text>}
      </Pressable>
      <Text style={s.eligibility}>You must be 18 or older to join.</Text>
    </View>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F2F3EE'},
  nav: {paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  back: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  navSpace: {width: 44},
  progress: {flexDirection: 'row', gap: 4, width: 92},
  progressLine: {flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E2D8D1'},
  progressActive: {backgroundColor: '#712C48'},
  content: {flex: 1, paddingHorizontal: 24, paddingTop: 38, width: '100%', maxWidth: 500, alignSelf: 'center'},
  contentCompact: {paddingTop: 20},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 44, lineHeight: 48, textAlign: 'center', color: '#352335'},
  titleCompact: {fontSize: 38, lineHeight: 41},
  subtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: '#715365', marginTop: 14, textAlign: 'center'},
  picker: {marginTop: 32},
  pickerCompact: {marginTop: 20},
  columns: {flexDirection: 'row'},
  column: {flex: 1},
  columnLabel: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: '#8A747F', textAlign: 'center', marginBottom: 16},
  wheel: {height: WINDOW},
  wheelContent: {paddingVertical: ROW * 2},
  wheelRow: {height: ROW, alignItems: 'center', justifyContent: 'center'},
  wheelText: {fontFamily: 'DMSans_500Medium', fontSize: 24, color: '#712C48'},
  selectionStrip: {position: 'absolute', top: 34 + ROW * 2, left: 0, right: 0, height: ROW, backgroundColor: '#EEDDE3', borderRadius: 16},
  fadeTop: {position: 'absolute', left: 0, right: 0, top: 34, height: ROW},
  fadeBottom: {position: 'absolute', left: 0, right: 0, bottom: 0, height: ROW},
  feedback: {minHeight: 42, marginTop: 18, alignItems: 'center', justifyContent: 'center'},
  ageText: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 30, lineHeight: 38, color: '#712C48'},
  hint: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: '#8A747F'},
  validation: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', color: '#AE2646', marginBottom: 8},
  footer: {paddingHorizontal: 28, paddingTop: 8},
  next: {alignSelf: 'center', minWidth: 132, minHeight: 50, paddingHorizontal: 28, borderRadius: 25, backgroundColor: '#712C48', alignItems: 'center', justifyContent: 'center'},
  nextText: {fontFamily: 'DMSans_500Medium', fontSize: 17, color: '#FFF7FA'},
  eligibility: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: '#8A747F', textAlign: 'center', marginTop: 12},
});
