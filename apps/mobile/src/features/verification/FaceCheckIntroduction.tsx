import React, {useRef, useState} from 'react';
import {ActivityIndicator, Modal, Platform, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {TapChoice, connectionColors as c, connectionStyles as shared} from '../auth/onboarding/ConnectionDesign';
import {FaceTurnIllustration} from './FaceTurnIllustration';

const steps = [
  {icon: 'sunny-outline', title: 'Find good light', note: 'Keep your face clear. Remove sunglasses.', color: '#8B682D', background: '#F4E8C9'},
  {icon: 'scan-outline', title: 'Follow the prompts', note: 'Look ahead, then do three face movements.', color: '#725A93', background: '#EAE2F1'},
  {icon: 'images-outline', title: 'Check your profile', note: 'Your main photo must clearly show your face.', color: '#446D5C', background: '#E0EBE2'},
] as const;

export function FaceCheckIntroduction({onboarding, onBack, onStart}: {
  onboarding: boolean; onBack: () => void; onStart: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const {height, fontScale} = useWindowDimensions();
  const compact = height < 740;
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const startRequested = useRef(false);
  const pendingDismiss = useRef(false);
  const begin = async () => {
    try {await onStart();}
    finally {startRequested.current = false; setStarting(false);}
  };
  const agree = () => {
    if (startRequested.current) return;
    startRequested.current = true;
    setStarting(true);
    pendingDismiss.current = Platform.OS === 'ios';
    setPrivacyOpen(false);
    if (!pendingDismiss.current) void begin();
  };
  const body = <>
    <View style={[s.art, compact && s.compactArt]} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <FaceTurnIllustration/>
    </View>
    <Text accessibilityRole="header" style={[s.title, compact && s.compactTitle]}>{'A quick check.\nA real you.'}</Text>
    <Text style={[s.description, compact && s.compactDescription]}>Follow four prompts. We compare your live selfie with your profile photos and video.</Text>
    <View style={[s.steps, compact && s.compactSteps]}>
      {steps.map((step, index) => <View key={step.title} style={s.step}>
        <View style={[s.stepIcon, {backgroundColor: step.background}, compact && s.compactIcon]}><Ionicons name={step.icon} size={20} color={step.color}/></View>
        <View style={s.stepCopy}><Text style={s.stepTitle}>{step.title}</Text><Text style={[s.stepNote, compact && s.compactNote]}>{step.note}</Text></View>
        <Text accessible={false} style={s.stepNumber}>{String(index + 1).padStart(2, '0')}</Text>
      </View>)}
    </View>
    <TapChoice accessibilityRole="button" accessibilityLabel="How we use your selfie. Read privacy details" disabled={starting} onPress={() => setPrivacyOpen(true)} style={({pressed}) => [s.privacy, compact && s.compactPrivacy, pressed && shared.pressed]}>
      <View style={s.privacyIcon}><Ionicons name="shield-checkmark-outline" size={21} color={c.primary}/></View>
      <View style={s.stepCopy}><Text style={s.privacyTitle}>How we use your selfie</Text><Text style={s.privacyNote}>{'Selfie used for the check and review.\nFace key stored for future photos.'}</Text></View>
      <Ionicons name="chevron-forward" size={17} color={c.primary}/>
    </TapChoice>
  </>;

  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      <TapChoice accessibilityRole="button" accessibilityLabel="Back" disabled={starting} onPress={onBack} style={({pressed}) => [shared.back, pressed && shared.pressed]}><Ionicons name="arrow-back" size={22} color={c.text}/></TapChoice>
      <View style={s.privateBadge}><Ionicons name="lock-closed-outline" size={12} color={c.primary}/><Text style={s.badgeText}>Private face check</Text></View>
    </View>
    {height < 600 || fontScale > 1.2
      ? <ScrollView style={s.body} contentContainerStyle={[s.content, s.accessibleContent]} showsVerticalScrollIndicator={false}>{body}</ScrollView>
      : <View style={[s.content, compact && s.compactContent]}>{body}</View>}
    <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 12) + 8}]}>
      <TapChoice accessibilityRole="button" accessibilityLabel="Start face check" accessibilityState={{disabled: starting, busy: starting}} disabled={starting} onPress={() => setPrivacyOpen(true)} style={({pressed}) => [s.primary, starting && s.disabled, pressed && shared.pressed]}>
        {starting ? <ActivityIndicator color="#FFF"/> : <><Text style={s.primaryText}>Start face check</Text><Ionicons name="arrow-forward" size={19} color="#FFF"/></>}
      </TapChoice>
      <TapChoice accessibilityRole="button" disabled={starting} onPress={onBack} style={({pressed}) => [s.later, pressed && shared.pressed]}><Text style={s.laterText}>{onboarding ? 'Do it later' : 'Not now'}</Text></TapChoice>
    </View>

    <Modal visible={privacyOpen} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setPrivacyOpen(false)} onDismiss={() => {
      if (pendingDismiss.current) {pendingDismiss.current = false; void begin();}
    }}>
      <View style={s.shade}>
        <TapChoice accessibilityRole="button" accessibilityLabel="Close privacy details" onPress={() => setPrivacyOpen(false)} style={StyleSheet.absoluteFill}/>
        <View style={[s.sheet, {maxHeight: height - insets.top - 24, paddingBottom: Math.max(insets.bottom, 16) + 12}]}>
          <View style={s.sheetHeader}><View style={s.sheetIcon}><Ionicons name="lock-closed-outline" size={22} color={c.primary}/></View><TapChoice accessibilityRole="button" accessibilityLabel="Close privacy details" onPress={() => setPrivacyOpen(false)} style={({pressed}) => [s.close, pressed && shared.pressed]}><Ionicons name="close" size={22} color={c.text}/></TapChoice></View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.sheetCopy}>
            <Text accessibilityRole="header" style={s.sheetTitle}>Your selfie stays private.</Text>
            <Text style={s.sheetDescription}>Read how we use your face data before you start.</Text>
            <View style={s.dataRow}><Text style={s.dataTitle}>During the check</Text><Text style={s.dataBody}>We compare your live selfie with your profile photos and video.</Text></View>
            <View style={s.dataRow}><Text style={s.dataTitle}>After the check</Text><Text style={s.dataBody}>We delete your selfie images after the check. If manual review is needed, we keep them until a decision, for up to seven days. We keep an encrypted face key, which is a set of numbers, to check that new photos show you.</Text></View>
            <View style={s.dataRow}><Text style={s.dataTitle}>You control the face key</Text><Text style={s.dataBody}>The face key is never shared. You can remove it in Settings. We also delete it when you delete your account.</Text></View>
          </ScrollView>
          <TapChoice accessibilityRole="button" accessibilityLabel="I agree. Start face check" disabled={starting} onPress={agree} style={({pressed}) => [s.primary, pressed && shared.pressed]}><Text style={s.primaryText}>I agree — start check</Text><Ionicons name="arrow-forward" size={19} color="#FFF"/></TapChoice>
        </View>
      </View>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: c.canvas},
  nav: {paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  privateBadge: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: c.wash},
  badgeText: {fontFamily: 'DMSans_500Medium', fontSize: 10, lineHeight: 15, color: c.primary},
  body: {flex: 1},
  content: {flex: 1, width: '100%', maxWidth: 500, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 8},
  compactContent: {paddingTop: 4},
  accessibleContent: {flexGrow: 1, flex: undefined, paddingBottom: 12},
  art: {flex: 1, minHeight: 100, maxHeight: 220, marginBottom: 6},
  compactArt: {minHeight: 60, maxHeight: 135, marginBottom: 4},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 40, lineHeight: 42, color: c.text, paddingBottom: 4},
  compactTitle: {fontSize: 34, lineHeight: 35},
  description: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: c.muted, marginTop: 6},
  compactDescription: {fontSize: 12, lineHeight: 18, marginTop: 4},
  steps: {backgroundColor: '#FFF', borderRadius: 23, padding: 14, gap: 12, marginTop: 16},
  compactSteps: {padding: 11, gap: 8, marginTop: 11},
  step: {flexDirection: 'row', alignItems: 'center', gap: 11},
  stepIcon: {width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  compactIcon: {width: 34, height: 34, borderRadius: 12},
  stepCopy: {flex: 1},
  stepTitle: {fontFamily: 'DMSans_700Bold', fontSize: 12, lineHeight: 18, color: c.text},
  stepNote: {fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 15, color: c.muted, marginTop: 1},
  compactNote: {fontSize: 9, lineHeight: 13},
  stepNumber: {fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#BDAEB5'},
  privacy: {flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginTop: 12, borderRadius: 20, backgroundColor: '#EDE5E8'},
  compactPrivacy: {paddingVertical: 9, marginTop: 10},
  privacyIcon: {width: 34, height: 34, borderRadius: 12, backgroundColor: '#F9F2F5', alignItems: 'center', justifyContent: 'center'},
  privacyTitle: {fontFamily: 'DMSans_500Medium', fontSize: 11, lineHeight: 17, color: c.primary},
  privacyNote: {fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 14, color: c.muted, marginTop: 2},
  footer: {paddingHorizontal: 24, paddingTop: 14, maxWidth: 500, width: '100%', alignSelf: 'center'},
  primary: {minHeight: 50, paddingHorizontal: 24, borderRadius: 25, backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10},
  primaryText: {fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 22, color: '#FFF'},
  later: {minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 3},
  laterText: {fontFamily: 'DMSans_500Medium', fontSize: 12, color: c.primary},
  disabled: {opacity: 0.45},
  shade: {flex: 1, justifyContent: 'flex-end', backgroundColor: '#21151F88'},
  sheet: {backgroundColor: c.canvas, borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 24},
  sheetHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16},
  sheetIcon: {width: 48, height: 48, borderRadius: 16, backgroundColor: c.wash, alignItems: 'center', justifyContent: 'center'},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: c.wash, alignItems: 'center', justifyContent: 'center'},
  sheetCopy: {paddingBottom: 22},
  sheetTitle: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 32, lineHeight: 36, color: c.text, paddingBottom: 4},
  sheetDescription: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: c.muted, marginTop: 4},
  dataRow: {marginTop: 18},
  dataTitle: {fontFamily: 'DMSans_700Bold', fontSize: 12, lineHeight: 18, color: c.text},
  dataBody: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 19, color: c.muted, marginTop: 4},
});
