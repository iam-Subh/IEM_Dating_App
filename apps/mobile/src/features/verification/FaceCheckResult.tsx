import React from 'react';
import {Image, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Defs, LinearGradient, Stop, Rect, Path, Circle} from 'react-native-svg';
import {TapChoice, connectionColors as c} from '../auth/onboarding/ConnectionDesign';

export type FaceResultRow = {url: string; kind: 'photo' | 'video'; name: string; text: string; ok: boolean | null};

function ResultArt({pending, compact}: {pending: boolean; compact: boolean}) {
  const ink = pending ? '#996B2D' : '#39785D';
  return <Svg width={compact ? 140 : 196} height={compact ? 112 : 158} viewBox="0 0 224 180" accessible={false}>
    <Defs><LinearGradient id="result-wash" x1="0" y1="0" x2="1" y2="1">
      <Stop offset="0" stopColor={pending ? '#F4E7C8' : '#DDECE0'}/><Stop offset="1" stopColor="#F2F3EE"/>
    </LinearGradient></Defs>
    <Path d="M34 45Q49 13 100 18Q171 8 194 53Q222 108 178 150Q139 180 77 157Q14 141 20 89Z" fill="url(#result-wash)"/>
    <Rect x={55} y={31} width={110} height={130} rx={23} fill={pending ? '#E9D8B3' : '#C6DEC9'} transform="rotate(-9 110 96)"/>
    <Rect x={54} y={24} width={110} height={130} rx={23} fill="#FFF" stroke={pending ? '#DECBA5' : '#B6D3BE'} strokeWidth={1.5}/>
    <Rect x={67} y={37} width={84} height={92} rx={17} fill={pending ? '#FBF4E5' : '#EBF4EC'}/>
    <Path d="M80 52V47Q80 44 83 44H91M127 44H136Q139 44 139 47V54M80 109V117Q80 120 83 120H91M127 120H136Q139 120 139 117V109" fill="none" stroke={ink} strokeWidth={2.3} strokeLinecap="round"/>
    <Path d="M94 76Q93 61 109 61Q126 61 124 79L122 94Q119 106 109 106Q98 106 95 94Z" fill={pending ? '#EDDFC5' : '#D4E5D7'} stroke={ink} strokeWidth={1.8}/>
    <Path d="M99 80H102M116 80H119M109 82V88M104 95Q109 99 114 95" fill="none" stroke={ink} strokeWidth={1.8} strokeLinecap="round"/>
    <Path d="M89 120Q93 110 99 108M119 108Q127 111 130 120" fill="none" stroke={ink} strokeWidth={1.8} strokeLinecap="round"/>
    <Path d="M84 140H134" stroke={pending ? '#DECEAE' : '#CBDECD'} strokeWidth={4} strokeLinecap="round"/>
    <Circle cx={163} cy={131} r={27} fill={pending ? '#F0DEAF' : '#A9D3B6'} stroke="#F2F3EE" strokeWidth={5}/>
    {pending ? <><Circle cx={163} cy={131} r={12} fill="none" stroke={ink} strokeWidth={2.5}/><Path d="M163 122V131L170 135" fill="none" stroke={ink} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/></>
      : <Path d="M151 131L160 140L176 122" fill="none" stroke={ink} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"/>}
    <Path d="M34 58H42M38 54V62M185 43H193M189 39V47" stroke={ink} opacity={0.45} strokeWidth={2} strokeLinecap="round"/>
  </Svg>;
}

export function FaceCheckResult({status, rows, onContinue, onboarding}: {
  status: 'verified' | 'pending_review'; rows: FaceResultRow[]; onContinue: () => void; onboarding: boolean;
}) {
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const compact = height < 740;
  const pending = status === 'pending_review';
  const action = onboarding ? 'Continue' : 'Done';
  const note = pending ? 'We will notify you when the review is complete.' : 'College email verification is a separate check.';
  const matches = rows.filter(row => row.ok === true).length;
  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      <Text style={s.navTitle}>Face check</Text>
      <TapChoice accessibilityRole="button" accessibilityLabel="Close face check result" onPress={onContinue} style={({pressed}) => [s.close, pressed && s.pressed]}><Ionicons name="close" size={21} color={c.text}/></TapChoice>
    </View>
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}
      contentContainerStyle={[s.content, compact && s.compactContent]}>
      <View style={s.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><ResultArt pending={pending} compact={compact}/></View>
      <View style={[s.status, pending ? s.waitWash : s.successWash]}><View style={[s.statusDot, {backgroundColor: pending ? '#996B2D' : '#39785D'}]}/><Text style={[s.statusText, {color: pending ? '#996B2D' : '#39785D'}]}>{pending ? 'REVIEW IN PROGRESS' : 'FACE CHECK COMPLETE'}</Text></View>
      <Text accessibilityRole="header" style={[s.title, compact && s.compactTitle]}>{pending ? 'One final check.' : 'Verified.\nReally you.'}</Text>
      <Text style={[s.description, compact && s.compactDescription]}>{pending ? rows.length ? 'Our team is checking the items below. You can continue while we review them.' : 'Our team is reviewing your face check. You can continue while we review it.' : 'Your live selfie matches your profile media.'}</Text>
      {!!rows.length && <View style={[s.results, compact && s.compactResults]}>
        <View style={s.resultsHeader}><Text style={s.resultsTitle}>Your profile media</Text><Text style={s.resultsCount}>{matches}/{rows.length} complete</Text></View>
        {rows.map((row, index) => {
          const color = row.ok === true ? '#39785D' : row.ok === false ? '#B43A48' : '#996B2D';
          return <View key={`${row.kind}:${row.url}:${index}`} style={[s.row, compact && s.compactRow, index > 0 && s.rowDivider]}>
            {row.kind === 'photo' ? <Image source={{uri: row.url}} resizeMode="cover" style={[s.thumb, compact && s.compactThumb]}/>
              : <View style={[s.thumb, compact && s.compactThumb, s.videoThumb]}><Ionicons name="play" size={20} color={c.primary}/></View>}
            <View style={s.rowCopy}><Text style={s.rowTitle}>{row.name}</Text><Text style={[s.rowNote, {color}]}>{row.text}</Text></View>
            <View style={[s.rowStatus, {backgroundColor: row.ok === true ? '#E5F0E7' : row.ok === false ? '#F8E2E5' : '#F5EACC'}]}><Ionicons name={row.ok === true ? 'checkmark' : row.ok === false ? 'close' : 'time-outline'} size={17} color={color}/></View>
          </View>;
        })}
      </View>}
      {!compact && <View style={s.note}><Ionicons name={pending ? 'notifications-outline' : 'shield-checkmark-outline'} size={17} color={c.muted}/><Text style={s.noteText}>{note}</Text></View>}
    </ScrollView>
    <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 12) + 8}]}>
      <TapChoice accessibilityRole="button" accessibilityLabel={action} onPress={onContinue} style={({pressed}) => [s.primary, pressed && s.pressed]}><Text style={s.primaryText}>{action}</Text><Ionicons name="arrow-forward" size={19} color="#FFF"/></TapChoice>
      <Text style={s.footerNote}>{compact ? note : pending ? onboarding ? 'You can keep setting up your profile.' : 'You can continue using the app.' : 'Your live selfie stays private.'}</Text>
    </View>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: c.canvas},
  nav: {paddingHorizontal: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  navTitle: {fontFamily: 'DMSans_500Medium', fontSize: 14, color: c.text},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center'},
  pressed: {opacity: 0.6}, scroll: {flex: 1},
  content: {flexGrow: 1, paddingHorizontal: 24, paddingVertical: 20, width: '100%', maxWidth: 500, alignSelf: 'center', justifyContent: 'center'},
  compactContent: {paddingVertical: 6}, art: {alignSelf: 'center', marginBottom: 8},
  status: {alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5},
  successWash: {backgroundColor: '#E2EDE3'}, waitWash: {backgroundColor: '#F2E6C9'},
  statusDot: {width: 5, height: 5, borderRadius: 3},
  statusText: {fontFamily: 'DMSans_700Bold', fontSize: 9, lineHeight: 14, letterSpacing: 0.8},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 42, lineHeight: 49, paddingTop: 10, paddingBottom: 6, includeFontPadding: true, textAlign: 'center', color: c.text},
  compactTitle: {fontSize: 34, lineHeight: 40},
  description: {fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', color: c.muted, marginTop: 2},
  compactDescription: {fontSize: 13, lineHeight: 19},
  results: {backgroundColor: '#FFF', borderRadius: 23, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 5, marginTop: 22},
  compactResults: {marginTop: 12, paddingTop: 12},
  resultsHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5},
  resultsTitle: {fontFamily: 'DMSans_700Bold', fontSize: 12, lineHeight: 18, color: c.text},
  resultsCount: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: c.muted},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12},
  compactRow: {paddingVertical: 8},
  rowDivider: {borderTopWidth: 1, borderTopColor: '#F0ECEC'},
  thumb: {width: 43, height: 54, borderRadius: 11, backgroundColor: '#EEDDE3'},
  compactThumb: {width: 36, height: 44},
  videoThumb: {alignItems: 'center', justifyContent: 'center'}, rowCopy: {flex: 1},
  rowTitle: {fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 22, color: c.text},
  rowNote: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, marginTop: 2},
  rowStatus: {width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  note: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, paddingHorizontal: 4},
  noteText: {flexShrink: 1, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: c.muted},
  footer: {paddingTop: 12, paddingHorizontal: 24, width: '100%', maxWidth: 500, alignSelf: 'center'},
  primary: {minHeight: 52, borderRadius: 26, backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10},
  primaryText: {fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 23, color: '#FFF'},
  footerNote: {fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 15, color: c.muted, textAlign: 'center', marginTop: 9},
});
