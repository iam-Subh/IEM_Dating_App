import React from 'react';
import {View, Text, Image, Pressable, StatusBar, StyleSheet, useWindowDimensions} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {AuthAction} from './AuthEntryFrame';
import {useOnboarding} from './useOnboarding';
import {useDispatch} from 'react-redux';
import {updateUser} from '../../../store/authSlice';
import {acceptLegal, type LegalSlug} from '../../legal/legal';
export function GoodIntentions() {
  const o = useOnboarding();
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const compact = height - insets.top - insets.bottom < 720;
  const dispatch = useDispatch();
  const open = (slug: LegalSlug) => o.navigation.navigate('Legal' as never, {slug} as never);
  // Recorded with the server; if it doesn't get through, the app asks again before it opens.
  const agree = () => {
    void acceptLegal().then((result) => dispatch(updateUser({termsVersion: result.termsVersion} as any))).catch(() => undefined);
    o.next('NameSelection');
  };
  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor="#F1EDE4"/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      {o.navigation.canGoBack() ? <Pressable onPress={o.back} accessibilityRole="button" accessibilityLabel="Back"
        style={({pressed}) => [s.back, pressed && {opacity: 0.5}]}>
        <Ionicons name="arrow-back" size={22} color="#352335"/>
      </Pressable> : <View style={s.backSpace}/>}
      <Text style={s.navLabel}>OUR COMMUNITY</Text>
      <View style={s.backSpace}/>
    </View>
    <View style={[s.content, compact && s.contentCompact]}>
      <View style={[s.hero, compact && s.heroCompact]}>
        <Image source={require('../../../../assets/illustrations/good-intentions-3d.png')}
          resizeMode="contain" accessible={false} style={[s.art, compact && s.artCompact]}/>
        <Text style={s.promiseText}>A shared promise</Text>
      </View>
      <Text accessibilityRole="header" style={[s.title, compact && s.titleCompact]}>Good connections.{ '\n' }Good intentions.</Text>
      <Text style={s.subtitle}>Three things we ask of everyone.</Text>

      <View style={[s.rules, compact && s.rulesCompact]}>
        {[
          {title: 'Be yourself', detail: 'Use your own photos and accurate profile details.', art: require('../../../../assets/illustrations/community-profile-3d.png')},
          {title: 'Respect each other', detail: 'Respect boundaries and stop contact when someone says no.', art: require('../../../../assets/illustrations/community-conversation-3d.png')},
          {title: 'Keep this space safe', detail: 'Report harassment, fake profiles, or unsafe behaviour.', art: require('../../../../assets/illustrations/community-shield-3d.png')},
        ].map((rule, index) => <View key={rule.title}>
          {index > 0 && <View style={s.divider}/>}
          <View style={[s.rule, compact && s.ruleCompact]}>
            <View accessible={false} pointerEvents="none" style={[s.numberBadge, compact && s.numberBadgeCompact]}>
              <Text style={s.number}>{index + 1}</Text>
            </View>
            <Image source={rule.art} resizeMode="contain" accessible={false} style={[s.ruleArt, compact && s.ruleArtCompact]}/>
            <View style={s.copy}>
              <Text style={s.ruleTitle}>{rule.title}</Text>
              <Text style={s.detail}>{rule.detail}</Text>
            </View>
          </View>
        </View>)}
      </View>
    </View>
    <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 16)}]}>
      <View style={s.footerInner}>
        <AuthAction label="I agree" onPress={agree}/>
        <Text style={s.agreement}>
          By tapping I agree, you accept our{' '}
          <Text accessibilityRole="link" style={s.link} onPress={() => open('terms')}>Terms of Service</Text>,{' '}
          <Text accessibilityRole="link" style={s.link} onPress={() => open('privacy')}>Privacy Policy</Text> and{' '}
          <Text accessibilityRole="link" style={s.link} onPress={() => open('guidelines')}>Community Guidelines</Text>, and confirm you are 18 or over.
        </Text>
      </View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F1EDE4'},
  nav: {paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  back: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF80', alignItems: 'center', justifyContent: 'center'},
  backSpace: {width: 44, height: 44},
  navLabel: {fontFamily: 'DMSans_700Bold', fontSize: 10, letterSpacing: 1.8, color: '#715365'},
  content: {flex: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8, width: '100%', maxWidth: 540, alignSelf: 'center'},
  contentCompact: {paddingTop: 2},
  hero: {height: 112, alignItems: 'flex-start', justifyContent: 'center'},
  heroCompact: {height: 88},
  promiseText: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: '#712C48'},
  art: {width: 174, height: 92, marginLeft: -34},
  artCompact: {width: 148, height: 66, marginLeft: -30},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 38, lineHeight: 46, letterSpacing: -0.9, color: '#352335', marginTop: 6},
  titleCompact: {fontSize: 34, lineHeight: 41, marginTop: 4},
  subtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: '#715365', marginTop: 4},
  rules: {marginTop: 18, backgroundColor: '#FFFBF4', borderRadius: 26, borderWidth: 1, borderColor: '#E5DCD2', paddingHorizontal: 16, paddingVertical: 4},
  rulesCompact: {marginTop: 12},
  rule: {position: 'relative', overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, minHeight: 84},
  ruleCompact: {paddingVertical: 8, minHeight: 76, gap: 10},
  divider: {height: 1, backgroundColor: '#E8DFD6', marginLeft: 76},
  ruleArt: {width: 64, height: 70},
  ruleArtCompact: {width: 54, height: 58},
  copy: {flex: 1},
  numberBadge: {position: 'absolute', right: 0, top: 9, width: 24, height: 24, borderRadius: 12, backgroundColor: '#F3E3E7', alignItems: 'center', justifyContent: 'center'},
  numberBadgeCompact: {top: 8},
  number: {fontFamily: 'DMSans_700Bold', fontSize: 12, lineHeight: 16, color: '#712C48', includeFontPadding: false},
  ruleTitle: {paddingRight: 32, fontFamily: 'DMSans_700Bold', fontSize: 16, lineHeight: 22, letterSpacing: -0.3, color: '#712C48'},
  detail: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: '#715F67', marginTop: 6},
  footer: {paddingHorizontal: 24, paddingTop: 4, backgroundColor: '#F1EDE4'},
  footerInner: {width: '100%', maxWidth: 492, alignSelf: 'center'},
  agreement: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, color: '#8A7A80', textAlign: 'center', marginTop: 10},
  link: {fontFamily: 'DMSans_700Bold', color: '#712C48', textDecorationLine: 'underline'},
});
