import React from 'react';
import {Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Circle, Path} from 'react-native-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {faceCheckFailureContent, type FaceCheckFailure as Failure} from './faceCheckFailureContent';

export function FaceCheckFailure({result, onRetry, onClose, onboarding}: {
  result: Failure; onRetry: () => void; onClose: () => void; onboarding: boolean;
}) {
  const insets = useSafeAreaInsets();
  const {height, fontScale} = useWindowDimensions();
  const compact = height < 740;
  const content = faceCheckFailureContent(result);
  const limited = result.errorCode === 'FACE_ATTEMPTS_LIMIT';
  const body = <>
    <View style={[s.art, compact && s.compactArt]} accessible={false}>
      <Svg width={compact ? 84 : 108} height={compact ? 84 : 108} viewBox="0 0 108 108">
        <Path d="M27 5H77c12 0 17 6 17 17v62c0 11-5 17-17 17H27c-12 0-17-6-17-17V22c0-11 5-17 17-17Z" fill="#EEDFE5"/>
        <Path d="M34 29c0-13 40-13 40 0v18c0 17-9 28-20 28S34 64 34 47Z" fill="#F9F5F0" stroke="#A77C8C" strokeWidth="1.5"/>
        <Path d="M42 43h3m18 0h3M54 45v10m-7 7c4 2 10 2 14 0" fill="none" stroke="#712C48" strokeWidth="2" strokeLinecap="round"/>
        <Path d="M10 30v-8c0-11 5-17 17-17m50 0c12 0 17 6 17 17v8M10 76v8c0 11 5 17 17 17" fill="none" stroke="#712C48" strokeWidth="2.5" strokeLinecap="round"/>
        <Circle cx="86" cy="84" r="19" fill="#F8DCDD" stroke="#F2F3EE" strokeWidth="4"/>
        <Path d="M86 74v12m0 6v1" fill="none" stroke="#B63D4B" strokeWidth="3" strokeLinecap="round"/>
      </Svg>
    </View>
    <Text accessibilityRole="header" style={[s.title, compact && s.compactTitle]}>{content.title}</Text>
    <View style={[s.reason, compact && s.compactReason]}>
      <View style={s.reasonLabel}><Ionicons name="information-circle-outline" size={18} color="#936E29"/><Text style={s.reasonTitle}>What happened</Text></View>
      <Text style={s.reasonText}>{content.explanation}</Text>
    </View>
    <View style={[s.tips, compact && s.compactTips]}>
      <Text style={s.tipsTitle}>{limited ? 'For your next check' : 'Before you try again'}</Text>
      {content.tips.map((tip, index) => <View key={tip.text} style={s.tip}>
        <View style={[s.tipIcon, {backgroundColor: ['#F3E8CE', '#E9E1EE', '#E0EAE3'][index % 3]}]}><Ionicons name={tip.icon} size={18} color={['#8B682D', '#725A93', '#446D5C'][index % 3]}/></View>
        <Text style={s.tipText}>{tip.text}</Text>
      </View>)}
    </View>
  </>;

  return <View style={[s.page, {paddingTop: insets.top + 8}]}>
    <StatusBar barStyle="dark-content" backgroundColor="#F2F3EE"/>
    <View style={s.nav}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close face check" onPress={onClose} style={({pressed}) => [s.close, pressed && s.pressed]}><Ionicons name="close" size={22} color="#342335"/></Pressable>
      <Text style={s.navTitle}>Face check</Text>
      <View style={s.navSpacer}/>
    </View>
    {height < 620 || fontScale > 1.2
      ? <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={[s.body, s.scrollBody]}>{body}</ScrollView>
      : <View style={[s.body, compact && s.compactBody]}>{body}</View>}
    <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 12) + 4}]}>
      {!limited && <Pressable accessibilityRole="button" onPress={onRetry} style={({pressed}) => [s.primary, pressed && s.pressed]}><Text style={s.primaryText}>Try again</Text><Ionicons name="arrow-forward" size={19} color="#FFF"/></Pressable>}
      {content.settings && <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={({pressed}) => [s.secondary, pressed && s.pressed]}><Text style={s.secondaryText}>Open camera settings</Text></Pressable>}
      <Pressable accessibilityRole="button" onPress={onClose} style={({pressed}) => [s.secondary, pressed && s.pressed]}><Text style={s.secondaryText}>{onboarding ? 'Do it later' : 'Close'}</Text></Pressable>
    </View>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F2F3EE'},
  nav: {height: 44, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  close: {height: 44, width: 44, borderRadius: 22, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center'},
  navTitle: {fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#342335'},
  navSpacer: {width: 44},
  scroll: {flex: 1},
  body: {flex: 1, width: '100%', maxWidth: 500, alignSelf: 'center', paddingHorizontal: 24, justifyContent: 'center', paddingVertical: 16},
  compactBody: {paddingVertical: 8},
  scrollBody: {flex: undefined, flexGrow: 1},
  art: {alignSelf: 'center', marginBottom: 12},
  compactArt: {marginBottom: 6},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 38, lineHeight: 44, color: '#342335', textAlign: 'center', paddingBottom: 6, includeFontPadding: true},
  compactTitle: {fontSize: 34, lineHeight: 40},
  reason: {marginTop: 18, borderRadius: 22, backgroundColor: '#FFF', padding: 18, gap: 7},
  compactReason: {marginTop: 12, padding: 15},
  reasonLabel: {flexDirection: 'row', alignItems: 'center', gap: 7},
  reasonTitle: {fontFamily: 'DMSans_700Bold', fontSize: 12, lineHeight: 18, color: '#795E34'},
  reasonText: {fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, color: '#563E50'},
  tips: {marginTop: 22, gap: 12},
  compactTips: {marginTop: 16, gap: 9},
  tipsTitle: {fontFamily: 'DMSans_700Bold', fontSize: 13, lineHeight: 20, color: '#342335'},
  tip: {flexDirection: 'row', alignItems: 'center', gap: 11},
  tipIcon: {height: 34, width: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  tipText: {flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#715C6D'},
  footer: {paddingHorizontal: 24, paddingTop: 12, width: '100%', maxWidth: 500, alignSelf: 'center'},
  primary: {minHeight: 52, borderRadius: 28, backgroundColor: '#712C48', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10},
  primaryText: {fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#FFF'},
  secondary: {minHeight: 42, justifyContent: 'center', alignItems: 'center'},
  secondaryText: {fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#712C48'},
  pressed: {opacity: 0.65},
});
