import React, {useEffect, useRef, useState} from 'react';
import {View, Text, Pressable, ScrollView, Keyboard, StatusBar, ActivityIndicator, StyleSheet, useWindowDimensions} from 'react-native';
import type {GestureResponderEvent} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Path} from 'react-native-svg';
import Animated, {Easing, FadeInDown, useReducedMotion} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {api} from '../../../services/api';
import {useOnboarding} from './useOnboarding';
import {cachedCollegeOptions, loadCollegeOptions} from './collegeOptions';

import {ResidencyGraphic} from './OnboardingFormArtwork';

export function CollegeIntroduction() {
  const o = useOnboarding();
  const insets = useSafeAreaInsets();
  const {height, fontScale} = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingCollege, setPendingCollege] = useState('');
  const [reveal, setReveal] = useState(0);
  const choosing = true;
  const [institutions, setInstitutions] = useState(cachedCollegeOptions);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>(() => cachedCollegeOptions().find(item => item.id === (o.data.institutionId ?? o.data.claimedInstitutionId))?.campusList ?? []);
  const [institution, setInstitution] = useState(o.data.institutionId ?? o.data.claimedInstitutionId ?? '');
  const [campus, setCampus] = useState(o.data.campus ?? '');
  const [isHosteller, setIsHosteller] = useState<boolean | null>(o.editing && typeof o.data.isHosteller === 'boolean' ? o.data.isHosteller : null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(!cachedCollegeOptions().length), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const needsScroll = height < 760 || fontScale > 1.15 || !!error;
  useEffect(() => {
    if (!o.editing) o.draft({isHosteller: null});
  }, [o.editing]);
  const choosingCollege = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const selectedCampus = useRef(campus);
  const touch = useRef<{x: number; y: number; moved: boolean} | null>(null);
  const tapHandlers = {
    onTouchStart: (event: GestureResponderEvent) => {
      const {pageX, pageY} = event.nativeEvent;
      touch.current = {x: pageX, y: pageY, moved: false};
    },
    onTouchMove: (event: GestureResponderEvent) => {
      const start = touch.current;
      if (start && Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) > 8) start.moved = true;
    },
    onTouchCancel: () => {touch.current = null;},
  };
  const completedTap = () => {
    const moved = touch.current?.moved;
    touch.current = null;
    return !moved;
  };
  useEffect(() => { let live = true; setLoading(!cachedCollegeOptions().length); setError('');
    (async () => { try {
      const list = await loadCollegeOptions(retry > 0);
      if (!live) return;
      setInstitutions(list);
      if (institution) {
        const cached = list.find((item: {id: string}) => item.id === institution)?.campusList;
        const options = cached ?? (await api.get('/profile/campuses')).data.data.campuses ?? [];
        if (!live) return;
        setCampuses(options);
        if (options.length === 1) {setCampus(options[0].name); selectedCampus.current = options[0].name;}
      }
    } catch {if (live) setError('Could not load college details. Select Retry.');}
    finally {if (live) setLoading(false);} })();
    return () => {live = false;};
  }, [retry]);
  const choose = async (id: string, name: string) => {
    if (choosingCollege.current || loading) return;
    const previous = {institution, campus: selectedCampus.current, campuses};
    const changed = id !== institution;
    const cached = institutions.find(item => item.id === id)?.campusList
      ?? (!changed && campuses.length ? campuses : undefined);
    choosingCollege.current = true; setBusy(true); setError(''); setPendingCollege(id);
    let saved = !changed;
    const revealCampuses = (list: {id: string; name: string}[]) => {
      const selected = list.length === 1 ? list[0].name
        : !changed && list.some(item => item.name === previous.campus) ? previous.campus : '';
      setInstitution(id); setCampuses(list); setCampus(selected); selectedCampus.current = selected;
      scroll.current?.scrollTo({y: 0, animated: false});
      setReveal(value => value + 1); setSearchOpen(false); Keyboard.dismiss();
    };
    // Campus options are loaded before the tap. Render them before the save.
    if (cached !== undefined) revealCampuses(cached);
    else setSearchOpen(true);
    try {
      if (changed) await o.save({institutionId: id});
      saved = true;
      if (cached === undefined) {
        const res = await api.get('/profile/campuses');
        revealCampuses(res.data.data.campuses ?? []);
      }
      o.draft({college: name, institutionId: id, campus: selectedCampus.current});
    } catch (cause: any) {
      if (!saved) {
        setInstitution(previous.institution); setCampus(previous.campus);
        selectedCampus.current = previous.campus; setCampuses(previous.campuses); setSearchOpen(true);
      }
      setError(!saved
        ? cause?.response?.data?.message || 'Could not change your college. Try again.'
        : 'Could not load campuses for your college. Select Retry.');
    } finally {choosingCollege.current = false; setBusy(false); setPendingCollege('');}
  };
  const next = async () => { if (busy || !campus || isHosteller === null || loading || (choosing && !institution) || !campuses.some(x => x.name === campus)) return; setBusy(true); setError(''); try { await o.save({campus, isHosteller}); o.next('AcademicSelection'); } catch { setError('Could not save your college details. Try again.'); } finally { setBusy(false); } };
  const searching = choosing && (!institution || searchOpen);
  const selectedCollege = institutions.find(item => item.id === institution);
  const collegeName = selectedCollege?.name || o.data.college || 'Your college';
  const enabled = !searching && !!campus && isHosteller !== null && !loading && !busy && (!choosing || !!institution) && campuses.some(item => item.name === campus);
  const content = <>
        <Text accessibilityRole="header" style={s.title}>Where do you{'\n'}study?</Text>
        <Text style={s.subtitle}>{searching ? 'Choose your college.' : 'Choose your campus.'}</Text>
        {searching ? <View style={s.searchSection}>
          {institutions.map(item => <Pressable key={item.id} disabled={busy || loading} accessibilityRole="button" onPress={() => choose(item.id, item.name)} style={({pressed}) => [s.campus, (pressed || pendingCollege === item.id) && s.selected]}><Text style={s.campusName}>{item.name}</Text><Ionicons name="chevron-forward" size={18} color="#8A747F"/></Pressable>)}
          {!loading && !institutions.length && <Text style={s.note}>No colleges are available. Retry loading college details.</Text>}
          {!!institution && <Pressable accessibilityRole="button" disabled={busy} onPress={() => setSearchOpen(false)} style={({pressed}) => [s.collegeAction, pressed && s.actionPressed]}><Text style={s.actionText}>Keep current college</Text></Pressable>}
        </View> : <>
          <View style={s.collegeRow}>
            <View style={{flex: 1}}>
              <Text style={s.eyebrow}>YOUR COLLEGE</Text>
              <View style={s.collegeHeading}>
                <Text style={[s.collegeName, {flex: 1, marginTop: 0}]}>{collegeName}</Text>
                {choosing && <Pressable accessibilityRole="button" disabled={busy} hitSlop={{top: 6, bottom: 6, left: 4, right: 4}} onPress={() => setSearchOpen(true)} style={({pressed}) => [s.collegeAction, s.inlineAction, pressed && s.actionPressed]}><Text style={[s.actionText, s.inlineActionText]}>Change college</Text></Pressable>}
              </View>
              <View style={s.status}><Ionicons name={o.auth.user?.isVerified ? 'checkmark-circle' : 'link-outline'} size={14} color={o.auth.user?.isVerified ? '#40778A' : '#8A747F'}/><Text style={s.statusText}>{o.auth.user?.isVerified ? 'College email verified' : 'College linked to your account'}</Text></View>
            </View>
          </View>
          <Text style={s.sectionLabel}>YOUR CAMPUS</Text>
          {campuses.map((item, index) => {
            const selected = campus === item.name;
            return <Animated.View key={`${reveal}-${item.id}`} entering={reducedMotion ? undefined : FadeInDown.withInitialValues({opacity: 0, transform: [{translateY: 14}]}).duration(280).delay(index * 65).easing(Easing.out(Easing.cubic))}>
              <Pressable disabled={loading || (busy && !choosingCollege.current)} accessibilityRole="radio" accessibilityState={{checked: selected, disabled: loading || (busy && !choosingCollege.current)}} unstable_pressDelay={0} {...tapHandlers} onPress={() => {if (!completedTap()) return; setCampus(item.name); selectedCampus.current = item.name; if (!choosingCollege.current) o.draft({campus: item.name});}} style={({pressed}) => [s.campus, selected && s.selected, pressed && {opacity: 0.85}]}>
              <Text style={[s.campusName, selected && {color: '#712C48'}]}>{item.name}</Text>
              <View style={[s.radio, selected && s.radioSelected]}>{selected && <Svg width={17} height={17} viewBox="0 0 24 24"><Path d="M5 12.5L9 16.5Q10.5 18 12 16L19 7" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/></Svg>}</View>
              </Pressable>
            </Animated.View>;
          })}
          {!loading && campuses.length === 1 && <Text style={s.note}>Your college has one campus. It is selected.</Text>}
          {!loading && !campuses.length && <Text style={s.note}>No campus is available. Retry loading college details.</Text>}
          {campuses.length > 0 && !loading && <View style={s.residencySection}>
            <View style={s.residencyHeading}><Text style={[s.sectionLabel, {marginTop: 0, marginBottom: 0}]}>RESIDENCY</Text></View>
            <View style={s.residencyChoices}>
              {[{label: 'Hosteller', value: true}, {label: 'Day scholar', value: false}].map(item => <Pressable key={item.label} accessibilityRole="radio" accessibilityState={{checked: isHosteller === item.value, disabled: busy}} disabled={busy} unstable_pressDelay={0} {...tapHandlers} onPress={() => {if (!completedTap()) return; setIsHosteller(item.value); o.draft({isHosteller: item.value});}} style={({pressed}) => [s.residencyChoice, isHosteller === item.value && s.selected, pressed && {opacity: 0.85}]}>
                <View pointerEvents="none" style={s.residencyArt}><ResidencyGraphic hosteller={item.value}/></View>
                <Text style={s.residencyText}>{item.label}</Text>
                <View style={[s.residencyRadio, isHosteller === item.value && s.radioSelected]}>{isHosteller === item.value && <Svg width={14} height={14} viewBox="0 0 24 24"><Path d="M5 12.5L9 16.5Q10.5 18 12 16L19 7" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/></Svg>}</View>
              </Pressable>)}
            </View>
          </View>}
        </>}
        {loading && <ActivityIndicator style={{marginTop: 20}} color="#712C48"/>}
        {!!error && <View style={{marginTop: 16}}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Pressable disabled={busy || loading} accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={s.change}><Text style={s.link}>Retry</Text></Pressable></View>}
  </>;
  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor="#F2F3EE"/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={busy} onPress={o.back} style={({pressed}) => [s.back, pressed && s.pressed]}><Ionicons name="arrow-back" size={22} color="#352335"/></Pressable>
      <View accessibilityLabel="Stage 2 of 4: Your world" style={s.progress}>{[0,1,2,3].map(stage => <View key={stage} style={[s.progressLine, stage <= 1 && s.progressActive]}/>)}</View>
      <View style={{width: 44}}/>
    </View>
    <View style={{flex: 1}}>
      {needsScroll ? <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>{content}</ScrollView>
        : <View style={[s.content, {flex: 1}]}>{content}</View>}
      <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 16) + 16}]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Continue to studies" accessibilityState={{disabled: !enabled, busy}} disabled={!enabled} onPress={next} style={({pressed}) => [s.next, !enabled && {opacity: 0.45}, pressed && s.pressed]}><Text style={s.nextText}>Continue</Text></Pressable>
      </View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F2F3EE'},
  nav: {paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  back: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  progress: {flexDirection: 'row', gap: 4, width: 92},
  progressLine: {flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E2D8D1'},
  progressActive: {backgroundColor: '#712C48'},
  content: {paddingTop: 10, paddingHorizontal: 24, paddingBottom: 8, width: '100%', maxWidth: 500, alignSelf: 'center'},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 36, lineHeight: 44, paddingBottom: 6, textAlign: 'center', color: '#352335'},
  subtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: '#715365', textAlign: 'center', marginTop: 6},
  collegeRow: {marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#DED8D6'},
  collegeHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 5},
  inlineAction: {minHeight: 32, marginTop: 0, marginBottom: 0, paddingHorizontal: 10, borderRadius: 16, alignSelf: 'center'},
  inlineActionText: {fontSize: 11},
  eyebrow: {fontFamily: 'DMSans_700Bold', fontSize: 9, letterSpacing: 1.2, color: '#8A747F'},
  collegeName: {fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 22, color: '#352335', marginTop: 5},
  status: {flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7},
  statusText: {flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, color: '#8A747F'},
  sectionLabel: {fontFamily: 'DMSans_700Bold', fontSize: 10, letterSpacing: 1.2, color: '#8A747F', marginTop: 8, marginBottom: 8},
  campus: {minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 12, borderWidth: 1.5, borderColor: '#FFFFFF', marginBottom: 8},
  selected: {backgroundColor: '#EEDDE3', borderColor: '#712C48'},
  campusName: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 23, color: '#352335'},
  radio: {width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, borderColor: '#C9BEC3', alignItems: 'center', justifyContent: 'center'},
  radioSelected: {backgroundColor: '#712C48', borderColor: '#712C48'},
  residencySection: {marginTop: 8},
  residencyHeading: {flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10},
  residencyChoices: {flexDirection: 'row', gap: 10},
  residencyChoice: {flex: 1, minHeight: 82, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'flex-end', backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#FFFFFF', overflow: 'hidden'},
  residencyArt: {position: 'absolute', left: 4, top: 0, opacity: 0.65},
  residencyText: { fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 19, color: '#352335', zIndex: 1},
  residencyRadio: {position: 'absolute', top: 14, right: 14, width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#C9BEC3', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  note: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 19, color: '#8A747F', marginTop: 4},
  searchSection: {marginTop: 20},
  change: {minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start'},
  collegeAction: {minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: '#B88A9D', backgroundColor: '#FFFFFF', justifyContent: 'center', alignSelf: 'flex-start', marginTop: 8, marginBottom: 8},
  actionText: {fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#712C48'},
  actionPressed: {backgroundColor: '#EEDDE3', opacity: 0.65},
  link: {fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#712C48'},
  footer: {paddingTop: 12, paddingHorizontal: 28, backgroundColor: '#F2F3EE'},
  next: {alignSelf: 'center', minWidth: 132, minHeight: 50, paddingHorizontal: 28, borderRadius: 25, backgroundColor: '#712C48', alignItems: 'center', justifyContent: 'center'},
  nextText: {fontFamily: 'DMSans_500Medium', fontSize: 17, color: '#FFF7FA'},
  error: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#AE2646'},
  pressed: {opacity: 0.6},
});
