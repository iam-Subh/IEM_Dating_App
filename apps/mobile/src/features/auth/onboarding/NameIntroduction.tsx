import React, {useEffect, useRef, useState} from 'react';
import {View, Text, TextInput, ActivityIndicator, Pressable, StatusBar, StyleSheet, Keyboard, KeyboardAvoidingView, useWindowDimensions} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Path} from 'react-native-svg';
import {useOnboarding} from './useOnboarding';

export function NameIntroduction() {
  const o = useOnboarding();
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const compact = height - insets.top - insets.bottom < 720;
  const [name, setName] = useState<string>(o.data.name?.startsWith('User_') ? '' : o.data.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [boxSize, setBoxSize] = useState({width: 0, height: 80});
  const [labelWidth, setLabelWidth] = useState(0);
  const floating = focused || !!name;
  const gapStart = floating ? 18 : boxSize.width / 2;
  const gapEnd = floating ? 18 + labelWidth : boxSize.width / 2;
  const valid = name.trim().length >= 2;
  // A draft per keystroke redrew the page and rewrote storage on every letter.
  // Keep the latest text and write it once typing pauses, or when leaving.
  const pendingName = useRef<string | null>(null);
  const flushName = () => {
    if (pendingName.current === null) return;
    o.draft({name: pendingName.current});
    pendingName.current = null;
  };
  useEffect(() => {
    const timer = setTimeout(flushName, 350);
    return () => clearTimeout(timer);
  }, [name]);
  useEffect(() => () => flushName(), []);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const proceed = async () => {
    if (!valid || busy) return;
    Keyboard.dismiss();
    pendingName.current = null; // save() drafts the trimmed name
    setBusy(true);
    setError('');
    try { await o.save({name: name.trim()}); o.next('BirthdaySelection'); }
    catch { pendingName.current = name; setError('Could not save your name. Try again.'); }
    finally { setBusy(false); }
  };
  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor="#F2F3EE"/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      <Pressable onPress={o.back} disabled={busy} accessibilityRole="button" accessibilityLabel="Back"
        style={({pressed}) => [s.back, pressed && {opacity: 0.5}]}>
        <Ionicons name="arrow-back" size={22} color="#352335"/>
      </Pressable>
      <View accessibilityLabel="Stage 1 of 4: About you" style={s.progress}>
        {[0, 1, 2, 3].map(stage => <View key={stage} style={[s.progressLine, stage === 0 && s.progressActive]}/>)}
      </View>
      <View style={s.navSpace}/>
    </View>
    <KeyboardAvoidingView style={s.layout} behavior="padding">
      <View style={[s.content, compact && s.contentCompact, keyboardOpen && s.contentKeyboard]}>
        <Text accessibilityRole="header" style={[s.title, compact && s.titleCompact, keyboardOpen && s.titleKeyboard]}>What's your name?</Text>
        <Text style={s.subtitle}>Use the name you want people to call you.{ '\n' }It will appear on your profile.</Text>
        <View style={[s.form, keyboardOpen && s.formKeyboard]}>
          <Pressable accessible={false} onPress={() => inputRef.current?.focus()} onLayout={event => setBoxSize(event.nativeEvent.layout)} style={s.inputBox}>
          {boxSize.width > 40 && <Svg pointerEvents="none" width={boxSize.width} height={boxSize.height} style={s.outline}>
            <Path d={`M ${gapStart} 2 H 20 A 18 18 0 0 0 2 20 V ${boxSize.height - 20} A 18 18 0 0 0 20 ${boxSize.height - 2} H ${boxSize.width - 20} A 18 18 0 0 0 ${boxSize.width - 2} ${boxSize.height - 20} V 20 A 18 18 0 0 0 ${boxSize.width - 20} 2 H ${gapEnd}`} fill="none" stroke={focused ? '#712C48' : '#DDD7D0'} strokeWidth={1.5}/>
          </Svg>}
          <Text accessible={false} pointerEvents="none" onLayout={event => setLabelWidth(event.nativeEvent.layout.width)} style={[s.inputLabel, floating && s.inputLabelFloating, focused && {color: '#712C48'}]}>Full name</Text>
          <TextInput ref={inputRef} accessibilityLabel="Full name" value={name} placeholder={floating ? 'Your full name' : undefined}
            placeholderTextColor="#91848B" selectionColor="#712C48" style={s.input}
            maxLength={100} autoCapitalize="words" autoComplete="name" autoCorrect={false}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            editable={!busy} returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()}
            onChangeText={value => {setName(value); setError(''); pendingName.current = value;}}/>
          </Pressable>
        </View>
      </View>
      <View style={[s.footer, {paddingBottom: keyboardOpen ? 12 : Math.max(insets.bottom, 16) + Math.min(height * 0.06, 60)}]}>
        <View style={s.footerInner}>
          {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="Continue to birthday"
            accessibilityState={{disabled: !valid || busy, busy}} disabled={!valid || busy} onPress={proceed}
            style={({pressed}) => [s.next, (!valid || busy) && s.nextDisabled, pressed && {opacity: 0.75}]}>
            {busy ? <ActivityIndicator color="#FFF7FA"/> : <Text style={s.nextText}>Continue</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F2F3EE'},
  layout: {flex: 1},
  nav: {paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  back: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  navSpace: {width: 44},
  content: {flex: 1, paddingHorizontal: 34, paddingTop: 36, width: '100%', maxWidth: 540, alignSelf: 'center'},
  contentCompact: {paddingTop: 24},
  contentKeyboard: {paddingTop: 12},
  progress: {flexDirection: 'row', gap: 4, width: 92},
  progressLine: {flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E2D8D1'},
  progressActive: {backgroundColor: '#712C48'},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 36, lineHeight: 44, letterSpacing: -0.8, textAlign: 'center', color: '#352335'},
  titleCompact: {fontSize: 34, lineHeight: 42},
  titleKeyboard: {fontSize: 32, lineHeight: 39},
  subtitle: {fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center', color: '#715365', marginTop: 24},
  form: {marginTop: 28},
  formKeyboard: {marginTop: 22},
  inputBox: {minHeight: 80, borderRadius: 20, backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingVertical: 12, justifyContent: 'center'},
  outline: {position: 'absolute', left: 0, top: 0},
  inputLabel: {position: 'absolute', left: 20, top: 29, fontFamily: 'DMSans_400Regular', fontSize: 16, lineHeight: 22, color: '#82757D', zIndex: 1},
  inputLabelFloating: {left: 18, top: -7, paddingHorizontal: 3, fontSize: 12, lineHeight: 18},
  input: {minHeight: 34, paddingHorizontal: 0, paddingVertical: 0, fontFamily: 'DMSans_500Medium', fontSize: 19, color: '#352335'},
  footer: {paddingHorizontal: 28, paddingTop: 8},
  footerInner: {width: '100%', maxWidth: 484, alignSelf: 'center'},
  next: {alignSelf: 'center', minWidth: 132, minHeight: 50, paddingHorizontal: 28, borderRadius: 25, backgroundColor: '#712C48', alignItems: 'center', justifyContent: 'center'},
  nextText: {fontFamily: 'DMSans_500Medium', fontSize: 17, color: '#FFF7FA'},
  nextDisabled: {opacity: 0.45},
  error: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#AE2646', marginBottom: 8},
});
