import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Animated, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useReducedMotion} from 'react-native-reanimated';

type Props = {
  preview: React.ReactNode;
  title: string;
  hint: string;
  step: number;
  total: number;
  completed: number;
  ready: boolean;
  started: boolean;
  captured: boolean;
  confirmed: boolean;
  sending: boolean;
  note: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onReady: () => void;
  onClose: () => void;
};

export function FaceCheckCamera(props: Props) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const {height, width} = useWindowDimensions();
  const compact = height - insets.top - insets.bottom < 650;
  const ovalHeight = Math.max(150, Math.min(360, height - insets.top - insets.bottom - (compact ? 348 : 390)));
  const ovalWidth = Math.min(width - 80, ovalHeight * 0.77);
  const waiting = !props.started && !props.sending;
  const confirmed = props.captured && props.confirmed && !props.sending;
  const confirmation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(confirmation, {toValue: confirmed ? 1 : 0, duration: 200, useNativeDriver: false});
    animation.start();
    return () => animation.stop();
  }, [confirmation, confirmed]);
  const borderColor = confirmation.interpolate({inputRange: [0, 1], outputRange: ['#712C48', '#4F8A68']});
  const nextTitle = waiting ? 'Start when\nyou’re ready.' : props.sending ? 'Checking\nyour selfie' : props.title;
  const [displayedTitle, setDisplayedTitle] = useState(nextTitle);
  const headingOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (waiting || reducedMotion) {
      setDisplayedTitle(nextTitle);
      headingOpacity.setValue(1);
      return;
    }
    let cancelled = false;
    let fadeIn: Animated.CompositeAnimation | undefined;
    const fadeOut = Animated.timing(headingOpacity, {toValue: 0, duration: 120, useNativeDriver: true});
    fadeOut.start(({finished}) => {
      if (!finished || cancelled) return;
      setDisplayedTitle(nextTitle);
      fadeIn = Animated.timing(headingOpacity, {toValue: 1, duration: 200, useNativeDriver: true});
      fadeIn.start();
    });
    return () => {
      cancelled = true;
      fadeOut.stop();
      fadeIn?.stop();
    };
  }, [headingOpacity, nextTitle, waiting, reducedMotion]);
  const feedback = props.sending ? 'Your selfie is being checked.'
    : props.captured ? (confirmed ? 'Step confirmed' : 'Step captured') : props.note || (waiting ? (props.ready ? 'Four prompts, one at a time.' : 'Opening your camera…') : props.hint);

  return <View style={[s.page, {paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 12)}]}>
    <StatusBar barStyle="dark-content" backgroundColor="#F2F3EE"/>
    <View style={s.nav}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close face check" onPress={props.onClose} style={({pressed}) => [s.close, pressed && s.pressed]}>
        <Ionicons name="close" size={23} color="#342335"/>
      </Pressable>
      <Text style={s.navTitle}>Face check</Text>
      <View style={s.counter}><Text style={s.counterText}>{props.step} of {props.total}</Text></View>
    </View>
    <View style={[s.heading, compact && s.compactHeading]}>
      <Animated.Text accessibilityRole="header" style={[s.title, compact && s.compactTitle, {opacity: headingOpacity}]}>{displayedTitle}</Animated.Text>
    </View>
    <View style={s.main}>
    <View style={s.previewSpace}>
      <Animated.View style={[s.oval, {width: ovalWidth, height: ovalHeight, borderRadius: ovalHeight / 2, borderColor}]}>
        {props.preview}
        {props.sending && <View style={s.sending}><ActivityIndicator size="large" color="#FFF"/></View>}
        {props.captured && !props.sending && <View pointerEvents="none" style={s.captureShade}><View style={[s.captureCheck, confirmed && s.confirmed]}><Ionicons name="checkmark" size={30} color="#FFF"/></View></View>}
      </Animated.View>
      <Text style={s.ovalHint}>Keep your face inside the oval.</Text>
    </View>
    <View style={[s.feedback, compact && s.compactFeedback]} accessibilityLiveRegion="polite">
      <View style={[s.feedbackIcon, props.captured && s.feedbackSuccess, confirmed && s.confirmed]}>
        {props.sending ? <ActivityIndicator size="small" color="#712C48"/> : <Ionicons name={props.captured ? 'checkmark' : props.icon} size={21} color={props.captured ? '#FFF' : '#712C48'}/>}
      </View>
      <Text style={s.feedbackText}>{feedback}</Text>
    </View>
    <View style={s.footer}>
      <View style={s.progress} accessibilityRole="progressbar" accessibilityLabel="Face check progress" accessibilityValue={{min: 0, max: props.total, now: props.completed}}>
        {Array.from({length: props.total}, (_, index) => <View key={index} style={[s.segment, index < props.completed ? s.complete : index === props.step - 1 && s.current]}/>)}
      </View>
      <View style={s.actionSpace}>
        {waiting ? <Pressable accessibilityRole="button" accessibilityLabel="I'm ready. Begin capture" accessibilityState={{disabled: !props.ready}} disabled={!props.ready} onPress={props.onReady} style={({pressed}) => [s.primary, !props.ready && s.disabled, pressed && s.pressed]}>
          <Text style={s.primaryText}>I’m ready</Text><Ionicons name="arrow-forward" size={19} color="#FFF"/>
        </Pressable> : <View style={s.activeNote}><Ionicons name="lock-closed-outline" size={13} color="#816B7C"/><Text style={s.privateText}>Your selfie stays private.</Text></View>}
      </View>
    </View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F2F3EE', paddingHorizontal: 24},
  nav: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center'},
  navTitle: {fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#342335'},
  counter: {minWidth: 54, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18, backgroundColor: '#EEDFE5'},
  counterText: {fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#712C48'},
  heading: {minHeight: 118, justifyContent: 'center', paddingTop: 12, paddingBottom: 8},
  compactHeading: {minHeight: 104, paddingTop: 8, paddingBottom: 4},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 36, lineHeight: 43, color: '#342335', textAlign: 'center', paddingHorizontal: 4, paddingTop: 2, paddingBottom: 6, includeFontPadding: true},
  compactTitle: {fontSize: 32, lineHeight: 39},
  main: {flex: 1, minHeight: 0, justifyContent: 'center', paddingBottom: 20},
  previewSpace: {alignItems: 'center', justifyContent: 'center', gap: 10},
  oval: {overflow: 'hidden', backgroundColor: '#30262D', borderWidth: 1.5, borderColor: '#712C48', alignItems: 'center', justifyContent: 'center'},
  ovalHint: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#715C6D', textAlign: 'center'},
  sending: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(31,20,28,0.55)', alignItems: 'center', justifyContent: 'center'},
  captureShade: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(31,20,28,0.15)', alignItems: 'center', justifyContent: 'center'},
  captureCheck: {width: 60, height: 60, borderRadius: 30, backgroundColor: '#712C48', alignItems: 'center', justifyContent: 'center'},
  feedback: {minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 8},
  compactFeedback: {minHeight: 56, paddingVertical: 6},
  feedbackIcon: {width: 36, height: 36, borderRadius: 18, backgroundColor: '#EEDFE5', alignItems: 'center', justifyContent: 'center'},
  feedbackSuccess: {backgroundColor: '#712C48'},
  confirmed: {backgroundColor: '#4F8A68'},
  feedbackText: {flexShrink: 1, fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 20, color: '#563E50', maxWidth: 230},
  footer: {alignItems: 'center', gap: 10, paddingBottom: 8},
  progress: {flexDirection: 'row', gap: 6, width: 172},
  segment: {flex: 1, height: 5, borderRadius: 3, backgroundColor: '#E1DAD9'},
  current: {backgroundColor: '#BB889D'},
  complete: {backgroundColor: '#712C48'},
  actionSpace: {height: 52, justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch'},
  primary: {height: 52, minWidth: 180, borderRadius: 28, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#712C48'},
  primaryText: {fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#FFF'},
  disabled: {opacity: 0.4},
  pressed: {opacity: 0.7},
  activeNote: {flexDirection: 'row', alignItems: 'center', gap: 6},
  privateText: {fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#816B7C'},
});
