import React, {useLayoutEffect, useRef, useState} from 'react';
import {View, Text, Image, StyleSheet, Pressable, PanResponder, ScrollView, StatusBar, useWindowDimensions} from 'react-native';
import Slider from '@react-native-community/slider';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Defs, LinearGradient, Path, Stop} from 'react-native-svg';
import {CommonActions, useNavigation, useRoute} from '@react-navigation/native';
import {RADIUS_PRESETS_KM} from '@iem-dating/shared/location';
import {PREFERENCE_AGE_MIN as AGE_MIN, PREFERENCE_AGE_MAX as AGE_MAX} from '@iem-dating/shared/age';
import {ConnectionNav, ConnectionFooter, ConnectionSheetHeader, connectionColors as c} from '../../auth/onboarding/ConnectionDesign';

const categories = [
  {id: 'man', label: 'Men', tint: '#F1E0C5', selected: '#E8CEA6', ink: '#9B7548'},
  {id: 'woman', label: 'Women', tint: '#FAEFE6', selected: '#F2DECF', ink: '#B47A59'},
  {id: 'nonbinary', label: 'Nonbinary people', tint: '#ECE3F4', selected: '#DDD0EA', ink: '#9465AD'},
];
const includeCategoryArt: Record<string, number> = {
  man: require('../../../../assets/illustrations/include-me-man-3d.png'),
  woman: require('../../../../assets/illustrations/include-me-woman-3d.png'),
  nonbinary: require('../../../../assets/illustrations/include-me-nonbinary-3d.png'),
};

function MeetCardGraphic({index, selected}: {index: number; selected: boolean}) {
  const ink = index === 0 ? '#326D70' : categories[index].ink;
  if (index === 2) return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={s.cardGraphic}>
    <Svg width="100%" height="100%" viewBox="0 0 64 48">
      <Defs><LinearGradient id="meetHeart" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#E498A8"/><Stop offset="1" stopColor="#9361B5"/></LinearGradient></Defs>
      <Path d="M32 43C25 37 8 27 8 16C8 3 25 1 32 12C39 1 56 3 56 16C56 27 39 37 32 43Z" fill="url(#meetHeart)" opacity={selected ? 1 : 0.85}/>
      <Path d="M15 16C15 11 21 8 25 11" fill="none" stroke="#FFF" strokeWidth={3} strokeLinecap="round" strokeOpacity={0.7}/>
    </Svg>
  </View>;
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={s.cardGraphic}>
    <Svg width="100%" height="100%" viewBox="0 0 64 72" opacity={selected ? 1 : 0.8}>
      {index === 1 && <Path d="M17 34V23C17 4 48 4 48 23V47H15Z" fill="#735149"/>}
      <Path d="M7 71V59C7 48 18 43 27 43H38C48 43 57 50 57 59V71Z" fill={ink}/>
      <Path d="M27 36H38V47C38 53 27 53 27 47Z" fill="#D9A88F"/>
      <Path d="M21 23C21 12 44 12 44 23V31C44 47 21 47 21 31Z" fill="#EDC4A8"/>
      {index === 0 && <Path d="M20 27V20C17 9 31 6 40 11C47 12 46 21 44 27L40 20C35 23 29 18 25 20L23 27Z" fill="#5E5149"/>}
      {index === 1 && <Path d="M20 28V21C20 11 43 10 45 23L44 30L40 20C33 27 27 20 23 27Z" fill="#735149"/>}
      <Path d="M27 31H28M37 31H38M29 37Q33 40 36 37" fill="none" stroke="#765545" strokeWidth={1.6} strokeLinecap="round"/>
      <Path d={index === 0 ? 'M23 46L32 55L42 46M32 55V71' : 'M23 47Q32 61 43 47'} fill="none" stroke="#FFF" strokeOpacity={0.7} strokeWidth={2} strokeLinejoin="round"/>
    </Svg>
  </View>;
}
type Option = {id: string; label: string; detail?: string; locked?: boolean};
type Props = {
  category: string; setCategory: (value: string) => void; show: string[]; setShow: (value: string[]) => void;
  min: string; max: string; setMin: (value: string) => void; setMax: (value: string) => void;
  mode: string; setMode: (value: string) => void; distance: number; setDistance: (value: number) => void;
  scope: string; setScope: (value: any) => void; scopes: Option[]; expandRadius: boolean; setExpandRadius: (value: boolean) => void;
  busy: boolean; loaded: boolean; error: string; onBack: () => void; onNext: () => void; retry: () => void;
  shareLocation: () => void; removeLocation: () => void;
  locationReady: boolean; locationError: string;
};

// Both thumbs share one track. Clamp each thumb against the other.
function AgeRange({low, high, onLow, onHigh}: {low: number; high: number; onLow: (n: number) => void; onHigh: (n: number) => void}) {
  const [width, setWidth] = useState(1);
  const live = useRef({low, high, width, onLow, onHigh}); live.current = {low, high, width, onLow, onHigh};
  const start = useRef({value: 0, x: 0});
  const responder = (lower: boolean) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => {start.current = {value: lower ? live.current.low : live.current.high, x: e.nativeEvent.pageX};},
    onPanResponderMove: e => {const v = live.current; const n = Math.round(start.current.value + (e.nativeEvent.pageX - start.current.x) / v.width * (AGE_MAX - AGE_MIN));
      lower ? v.onLow(Math.max(AGE_MIN, Math.min(v.high, n))) : v.onHigh(Math.min(AGE_MAX, Math.max(v.low, n)));},
  });
  const lowerPan = useRef(responder(true)).current, upperPan = useRef(responder(false)).current;
  const position = (n: number) => (n - AGE_MIN) / (AGE_MAX - AGE_MIN) * width;
  return <View style={s.range} onLayout={e => setWidth(Math.max(1, e.nativeEvent.layout.width - 44))}>
    <View style={s.track}/><View style={[s.activeTrack, {left: 22 + position(low), width: position(high) - position(low)}]}/>
    {[true, false].map(lower => <View key={String(lower)} {...(lower ? lowerPan : upperPan).panHandlers}
      accessible accessibilityRole="adjustable" accessibilityLabel={lower ? 'Minimum age' : 'Maximum age'}
      accessibilityValue={{min: lower ? AGE_MIN : low, max: lower ? high : AGE_MAX, now: lower ? low : high}}
      accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
      onAccessibilityAction={e => {const n = (lower ? low : high) + (e.nativeEvent.actionName === 'increment' ? 1 : -1); lower ? onLow(Math.max(AGE_MIN, Math.min(high, n))) : onHigh(Math.min(AGE_MAX, Math.max(low, n)));}}
      style={[s.thumbTarget, {left: position(lower ? low : high), top: low === high ? (lower ? -5 : 5) : 0}]}><View style={s.thumb}/></View>)}
  </View>;
}

export function MatchingIntroduction(p: Props) {
  const navigation = useNavigation<any>(), route = useRoute<any>();
  const compact = useWindowDimensions().height < 820;
  const answer = route.params?.matchingAnswer;
  useLayoutEffect(() => {if (!answer) return; if (answer.kind === 'category') p.setCategory(answer.value); else p.setScope(answer.value);}, [answer]);
  const open = (kind: string, options: Option[], value: string) => navigation.navigate('MatchingOptions', {kind, options, value, returnKey: route.key});
  const scope = p.scopes.find(item => item.id === p.scope);
  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <ConnectionNav onBack={p.onBack} busy={p.busy}/>
    <View style={[s.content, compact && {gap: 4, paddingTop: 10}]} pointerEvents={p.busy || !p.loaded ? 'none' : 'auto'}>
      <View><Text style={[s.title, compact && {fontSize: 34, lineHeight: 38}]}>Who would you{'\n'}like to meet?</Text><Text style={s.hint}>Your preferences. Change them anytime.</Text></View>
      <View style={s.meetPanel}><View style={s.row}><Text style={s.label}>I’d like to meet</Text><Text style={s.small}>Select one or more</Text></View><View style={s.pills}>{categories.map((item, index) => {
        const selected = p.show.includes(item.id);
        return <Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{checked: selected}} onPress={() => p.setShow(selected ? p.show.filter(id => id !== item.id) : [...p.show, item.id])} style={({pressed}) => [s.pill, {backgroundColor: selected ? item.selected : item.tint, borderColor: selected ? item.ink : item.tint}, pressed && {opacity: .65}]}>
          <MeetCardGraphic index={index} selected={selected}/>
          <View style={[s.choiceCheck, selected && {backgroundColor: c.primary, borderColor: c.primary}]}>{selected && <Ionicons name="checkmark" size={14} color="#FFF"/>}</View><Text style={s.pillText}>{item.label}</Text>
        </Pressable>;
      })}</View></View>
      <View style={s.age}><View style={s.row}><Text style={s.label}>Age range</Text><Text style={s.value}>{p.min}–{p.max}</Text></View><AgeRange low={Number(p.min)} high={Number(p.max)} onLow={n => p.setMin(String(n))} onHigh={n => p.setMax(String(n))}/><View style={s.row}><Text style={s.small}>{AGE_MIN} years</Text><Text style={s.small}>{AGE_MAX} years</Text></View></View>
      <View><Text style={[s.label, {marginBottom: 8}]}>Where to meet</Text><View style={s.mode}>{[{id: 'college', label: 'College', icon: 'school-outline'}, {id: 'distance', label: 'Nearby', icon: 'location-outline'}].map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{checked: p.mode === item.id}} onPress={() => p.setMode(item.id)} style={[s.modeButton, p.mode === item.id && s.modeActive]}><Ionicons name={item.icon as any} size={18} color={c.primary}/><Text style={s.modeText}>{item.label}</Text></Pressable>)}</View>
      {p.mode === 'college' ? <Pressable accessibilityRole="button" accessibilityLabel="Change college discovery area" onPress={() => open('scope', p.scopes, p.scope)} style={[s.area, compact && {paddingVertical: 10}]}>
        <View style={{flex: 1, gap: 5}}><Text style={s.small}>MEET PEOPLE FROM</Text><Text style={s.areaTitle}>{scope?.label ?? 'Choose your college area'}</Text><Text style={s.hint}>Your college. No location needed.</Text></View><Ionicons name="chevron-forward" size={20} color={c.primary}/>
      </Pressable> : <View style={s.distance}><View style={s.row}><Text style={s.label}>Within</Text><Text style={s.value}>{p.distance} km <Text style={s.hint}>· {(p.distance / 1.609344).toFixed(1)} mi</Text></Text></View>
        <Slider accessibilityLabel="Maximum distance" accessibilityValue={{text: `${p.distance} kilometres, ${(p.distance / 1.609344).toFixed(1)} miles`}} minimumValue={0} maximumValue={RADIUS_PRESETS_KM.length - 1} step={1} value={RADIUS_PRESETS_KM.indexOf(p.distance)} onValueChange={n => p.setDistance(RADIUS_PRESETS_KM[Math.round(n)])} minimumTrackTintColor={c.primary} maximumTrackTintColor={c.line} thumbTintColor={c.primary} style={{height: 36}}/>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked: p.expandRadius}} onPress={() => p.setExpandRadius(!p.expandRadius)} style={s.checkRow}><Ionicons name={p.expandRadius ? 'checkbox' : 'square-outline'} size={21} color={c.primary}/><Text style={s.hint}>Show farther away if I run out</Text></Pressable>
        <Text accessibilityRole={p.locationError ? 'alert' : undefined} accessibilityLiveRegion="polite" style={[s.hint, {marginTop: 4}, !!p.locationError && {color: '#AE2646'}]}>{p.locationError || (p.locationReady ? 'Location shared.' : 'Share location to use Nearby.')}</Text>
        <View style={s.locationActions}><Pressable accessibilityRole="button" onPress={p.shareLocation} style={({pressed}) => [s.locationShare, !!p.locationError && s.locationNeedsAction, pressed && {opacity: .65}]}><Ionicons name="navigate-outline" size={17} color={p.locationError ? '#AE2646' : c.primary}/><Text style={[s.link, !!p.locationError && {color: '#AE2646'}]}>Share location</Text></Pressable><Pressable accessibilityRole="button" onPress={p.removeLocation} style={({pressed}) => [s.locationRemove, pressed && {opacity: .65}]}><Ionicons name="trash-outline" size={16} color="#AE2646"/><Text style={s.removeText}>Remove</Text></Pressable></View>
      </View>}</View>
      {p.mode === 'college' && <Pressable accessibilityRole="button" accessibilityLabel="Edit my discovery category" onPress={() => open('category', categories, p.category)} style={({pressed}) => [s.category, pressed && {opacity: .65}]}><Image source={includeCategoryArt[p.category] ?? require('../../../../assets/illustrations/include-me-raised-hand.png')} style={s.categoryArt} resizeMode="contain" accessible={false}/><View style={{flex: 1, gap: 2}}><Text style={s.small}>Include me in</Text><Text style={s.categoryValue}>{categories.find(item => item.id === p.category)?.label ?? 'Choose a category'}</Text></View><View style={s.editBadge}><Text style={s.link}>Edit</Text><Ionicons name="chevron-forward" size={14} color={c.primary}/></View></Pressable>}
    </View>
    {!p.loaded && !p.busy && <Pressable onPress={p.retry} style={{alignSelf: 'center', padding: 12}}><Text style={s.link}>Retry</Text></Pressable>}
    <ConnectionFooter onNext={p.onNext} disabled={!p.loaded || !p.category || !p.show.length} busy={p.busy} error={p.error} label="Continue"/>
  </View>;
}

export function MatchingOptionsSheet() {
  const navigation = useNavigation<any>(), route = useRoute<any>();
  const {kind, options, value, returnKey} = route.params;
  return <ScrollView contentContainerStyle={{padding: 24, paddingBottom: 36}}><ConnectionSheetHeader title={kind === 'category' ? 'Include me in' : 'Where you meet'} onClose={() => navigation.goBack()} style={kind === 'scope' ? {marginBottom: 6} : undefined}/>
    <Text style={[s.hint, {marginBottom: 16}]}>{kind === 'category' ? 'Choose whose preferences include you. This does not change your profile gender.' : 'These choices use your college and verification status.'}</Text>
    {options.map((item: Option) => <Pressable key={item.id} disabled={item.locked} accessibilityRole="radio" accessibilityState={{checked: value === item.id, disabled: !!item.locked}} onPress={() => {navigation.dispatch({...CommonActions.setParams({matchingAnswer: {kind, value: item.id, revision: Date.now()}}), source: returnKey}); navigation.goBack();}} style={[s.sheetOption, value === item.id && {backgroundColor: c.wash}]}><View style={{flex: 1}}><Text style={s.areaTitle}>{item.label}</Text>{(item.detail || item.locked) && <Text style={s.hint}>{item.locked ? 'Verify your college to choose this.' : item.detail}</Text>}</View><Ionicons name={item.locked ? 'lock-closed-outline' : value === item.id ? 'checkmark-circle' : 'ellipse-outline'} color={c.primary} size={24}/></Pressable>)}
  </ScrollView>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: c.canvas}, content: {flex: 1, paddingHorizontal: 24, paddingTop: 18, gap: 12},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 36, lineHeight: 40, color: c.text, paddingBottom: 6},
  hint: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: c.muted}, small: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, color: c.muted},
  label: {fontFamily: 'DMSans_700Bold', fontSize: 14, color: c.text}, value: {fontFamily: 'DMSans_700Bold', fontSize: 20, color: c.primary},
  meetPanel: {marginTop: 8, backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 10, paddingVertical: 8},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, pills: {flexDirection: 'row', gap: 6, marginTop: 8},
  pill: {flex: 1, alignItems: 'flex-start', justifyContent: 'flex-start', gap: 6, paddingHorizontal: 8, paddingVertical: 10, minHeight: 76, borderRadius: 18, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E3DCDF', overflow: 'hidden'}, selected: {backgroundColor: '#EEDDE3', borderColor: c.primary}, pillText: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 16, color: c.text},
  cardGraphic: {position: 'absolute', width: 46, height: 34, right: 0, top: 1},
  choiceCheck: {width: 19, height: 19, borderRadius: 6, borderWidth: 1, borderColor: '#BCAAB3', alignItems: 'center', justifyContent: 'center'},
  age: {marginTop: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, backgroundColor: '#FFF', borderRadius: 22}, range: {height: 44}, track: {position: 'absolute', height: 4, left: 22, right: 22, top: 20, borderRadius: 2, backgroundColor: c.line}, activeTrack: {position: 'absolute', height: 4, top: 20, backgroundColor: c.primary}, thumbTarget: {position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center'}, thumb: {width: 23, height: 23, borderRadius: 12, backgroundColor: c.primary, borderWidth: 3, borderColor: '#FFF', elevation: 2},
  mode: {flexDirection: 'row', padding: 4, backgroundColor: '#E8E6E1', borderRadius: 25}, modeButton: {flex: 1, flexDirection: 'row', gap: 7, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 22}, modeActive: {backgroundColor: '#FFF'}, modeText: {fontFamily: 'DMSans_500Medium', fontSize: 14, color: c.primary},
  area: {flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, backgroundColor: '#EEE4E7', borderRadius: 22, marginTop: 10}, areaTitle: {fontFamily: 'DMSans_700Bold', fontSize: 15, lineHeight: 21, color: c.text},
  distance: {paddingHorizontal: 12, paddingTop: 10}, checkRow: {flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 34}, locationActions: {flexDirection: 'row', gap: 8, marginTop: 6}, locationShare: {flex: 1, minHeight: 42, borderRadius: 21, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: c.wash}, locationRemove: {minHeight: 42, paddingHorizontal: 12, borderRadius: 21, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5}, removeText: {fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#AE2646'}, link: {fontFamily: 'DMSans_700Bold', fontSize: 12, color: c.primary},
  locationNeedsAction: {borderWidth: 1, borderColor: '#AE2646', backgroundColor: '#F9E5EA'},
  categoryArt: {width: 48, height: 44},
  category: {marginTop: 12, flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FFF', borderRadius: 20, gap: 10}, categoryIcon: {width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5ECEF', alignItems: 'center', justifyContent: 'center'}, editBadge: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 36, paddingHorizontal: 10, borderRadius: 18, backgroundColor: '#F5ECEF'}, categoryValue: {fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 20, color: c.text}, sheetOption: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: '#FFF', borderRadius: 20, marginBottom: 10},
});

