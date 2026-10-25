import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {AndroidSoftInputModes, KeyboardController, useGenericKeyboardHandler, useKeyboardState} from 'react-native-keyboard-controller';
import Animated, {cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import {Ionicons} from '@expo/vector-icons';

import {useOptionalSave} from './useOptionalSave';
import {ConnectionFooter, ConnectionNav, TapChoice, connectionColors as c, connectionStyles as shared} from './ConnectionDesign';

const starters = ['My perfect Sunday…', 'Ask me about…', 'Together, we could…'];
const LIMIT = 2000;
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

import {ConversationArt} from './OnboardingFormArtwork';

export function ShareMoreIntroduction() {
  const o = useOptionalSave();
  const [bio, setBio] = useState<string>(o.data.preferences?.bio ?? '');
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const progress = useSharedValue(0);
  const keyboardHeight = useSharedValue(0);
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android') return;
    // Prevent the OS resize from moving the footer ahead of the card.
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    return () => KeyboardController.setDefaultMode();
  }, []));
  useGenericKeyboardHandler({
    onStart: event => {
      'worklet';
      if (event.height > 0) keyboardHeight.value = event.height;
      // One clock drives the footer, card, heading, and prompts.
      progress.value = withTiming(event.height > 0 ? 1 : 0, {
        duration: event.duration > 0 ? event.duration : 260,
        easing: Easing.inOut(Easing.cubic),
      });
    },
    onInteractive: event => {
      'worklet';
      cancelAnimation(progress);
      progress.value = event.progress;
    },
  }, []);
  const footerStyle = useAnimatedStyle(() => ({transform: [{translateY: -keyboardHeight.value * progress.value}]}));
  const {fontScale} = useWindowDimensions();
  const heroHeight = useSharedValue(140 * fontScale);
  // Animate positions directly on the UI thread. Keep the surrounding layout
  // fixed so footer movement does not depend on the text input's size update.
  const heroStyle = useAnimatedStyle(() => ({
    height: heroHeight.value,
  }));
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{translateY: -(heroHeight.value - 42 * fontScale + 8) * progress.value}],
  }));
  const expandedStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - progress.value * 2),
    transform: [{translateY: -progress.value * 8}],
  }));
  const compactStyle = useAnimatedStyle(() => ({opacity: Math.max(0, progress.value * 2 - 1)}));
  const inputStyle = useAnimatedStyle(() => ({height: 144 - 24 * progress.value}));
  const startersStyle = useAnimatedStyle(() => ({
    transform: [{translateY: -(heroHeight.value - 42 * fontScale + 14) * progress.value}],
    opacity: Math.max(0, 1 - progress.value * 2),
  }));
  const latest = useRef(o);
  latest.current = o;
  useEffect(() => {
    const timer = setTimeout(() => latest.current.draft({preferences: {...latest.current.data.preferences, bio}}), 350);
    return () => clearTimeout(timer);
  }, [bio]);
  const fields = () => ({preferences: {...latest.current.data.preferences, bio: bio.trim()}});
  const keepDraft = () => o.draft(fields());
  const hasText = bio.trim().length > 0;
  const startWith = (starter: string) => {
    if (hasText || o.busy) return;
    setBio(starter.replace('…', ' '));
    input.current?.focus();
  };
  return <View style={shared.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <ConnectionNav busy={o.busy} onBack={() => {keepDraft(); o.back();}} onSkip={o.skip ? () => {keepDraft(); o.skip?.();} : undefined}/>
    <View style={s.body}>
      <ScrollView style={s.body} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} bounces={false}>
        <Animated.View style={[s.heroFrame, heroStyle]}>
          <Animated.View pointerEvents="none" importantForAccessibility={keyboardVisible ? 'no-hide-descendants' : 'auto'} onLayout={event => {heroHeight.value = event.nativeEvent.layout.height;}} style={[s.heroContent, expandedStyle]}>
            <View style={s.heading}>
              <Text accessibilityRole="header" style={[shared.title, s.title]}>{'A little more\nabout you.'}</Text>
              <ConversationArt/>
            </View>
            <Text style={[shared.subtitle, s.subtitle]}>Give someone a reason to say hello.</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" importantForAccessibility={keyboardVisible ? 'auto' : 'no-hide-descendants'} style={[s.compactHeading, compactStyle]}><Text accessibilityRole="header" style={[shared.title, s.typingTitle]}>About you.</Text></Animated.View>
        </Animated.View>
        <Animated.View style={[s.card, focused && s.cardFocused, cardStyle]}>
          <View style={s.cardHeader}><Text style={s.label}>About me</Text><Ionicons name="create-outline" size={18} color={c.primary}/></View>
          <AnimatedTextInput ref={input} accessibilityLabel="About me" multiline maxLength={LIMIT} value={bio} onChangeText={setBio} editable={!o.busy} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholder="What would someone enjoy knowing about you?" placeholderTextColor="#968791" selectionColor={c.primary} textAlignVertical="top" autoCapitalize="sentences" style={[s.input, inputStyle]}/>
          <View style={s.cardFoot}><View style={s.profileHint}><Ionicons name="person-outline" size={12} color={c.muted}/><Text style={s.note}>Visible on your profile</Text></View><Text accessibilityLabel={bio.length + ' of ' + LIMIT + ' characters'} style={[s.count, bio.length === LIMIT && s.limit]}>{bio.length}/{LIMIT}</Text></View>
        </Animated.View>
        <Animated.View pointerEvents={keyboardVisible ? 'none' : 'auto'} importantForAccessibility={keyboardVisible ? 'no-hide-descendants' : 'auto'} style={[s.startersFrame, startersStyle]}><View style={s.starters}>
          <Text style={s.starterHeading}>Need a starting point?</Text>
          <View style={s.pills}>{starters.map((starter, index) => <TapChoice key={starter} accessibilityRole="button" accessibilityLabel={starter} accessibilityState={{disabled: hasText || o.busy}} disabled={hasText || o.busy} onPress={() => startWith(starter)} style={({pressed}) => [s.pill, hasText && s.pillDisabled, pressed && shared.pressed]}><Ionicons name={(['sunny-outline', 'chatbubble-outline', 'heart-outline'] as const)[index]} size={15} color={c.primary}/><Text style={s.pillText}>{starter}</Text></TapChoice>)}</View>
          <Text style={s.guidance}>{hasText ? 'A few honest lines are enough.' : 'Choose a starter, or write your own.'}</Text>
        </View></Animated.View>
      </ScrollView>
      <Animated.View style={[s.footer, footerStyle]}><ConnectionFooter label={o.action} busy={o.busy} disabled={!hasText && !o.editing} error={o.error} onNext={() => {keepDraft(); o.saveOptional(fields());}}/></Animated.View>
    </View>
  </View>;
}

const s = StyleSheet.create({
  body: {flex: 1},
  content: {flexGrow: 1, width: '100%', maxWidth: 500, alignSelf: 'center', paddingBottom: 110},
  footer: {position: 'absolute', bottom: 0, left: 0, right: 0},
  heroFrame: {overflow: 'hidden', marginTop: 22},
  heroContent: {position: 'absolute', top: 0, left: 0, right: 0},
  compactHeading: {position: 'absolute', top: 0, left: 24, right: 24},
  heading: {marginHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 8},
  title: {flex: 1, fontSize: 36, lineHeight: 40},
  typingTitle: {fontSize: 28, lineHeight: 34},
  subtitle: {marginHorizontal: 24, marginTop: 8, marginBottom: 24},
  art: {width: 80, height: 88},
  card: {marginHorizontal: 24, marginTop: 8, padding: 18, borderRadius: 24, borderWidth: 1, borderColor: '#DDD8D5', backgroundColor: '#FFFFFF'},
  cardFocused: {borderColor: '#96516F'},
  cardHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12},
  label: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: c.primary},
  input: {height: 144, padding: 0, margin: 0, fontFamily: 'DMSans_400Regular', fontSize: 17, lineHeight: 26, color: c.text},
  cardFoot: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 16},
  profileHint: {flexDirection: 'row', alignItems: 'center', gap: 5},
  note: {fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 16, color: c.muted},
  count: {fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 16, color: c.muted, fontVariant: ['tabular-nums']},
  limit: {color: c.primary},
  startersFrame: {marginHorizontal: 24, overflow: 'hidden'},
  starters: {paddingTop: 22},
  starterHeading: {fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 20, color: c.text, marginBottom: 10},
  pills: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  pill: {minHeight: 42, borderRadius: 24, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#EEDFE4'},
  pillDisabled: {opacity: 0.45},
  pillText: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 20, color: c.primary},
  guidance: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 18, color: c.muted, marginTop: 10},
  spacer: {flexGrow: 1, minHeight: 12},
});
