import React, {useCallback, useEffect, useState} from 'react';
import {Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Animated, {cancelAnimation, Easing, runOnJS, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withTiming} from 'react-native-reanimated';
import Svg, {Path} from 'react-native-svg';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {MapPaperArtwork} from './MapPaperArtwork';
import {MAP_INTRODUCTION_MS, paperIntroductionMotion} from './mapIntroductionMotion';
import {CrumpledMapPaper} from './CrumpledMapPaper';

const PAPER = '#F1EDE4';

/** This screen covers the existing map while its data and tiles load. */
export function MapIntroduction({onComplete, onClose}: {onComplete: () => void; onClose: () => void}) {
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const [ready, setReady] = useState(false);
  const artworkReady = useCallback(() => setReady(true), []);
  const stage = useDerivedValue(() => paperIntroductionMotion(reduced ? .75 : progress.value));
  const availableHeight = height - insets.top - insets.bottom;
  const paperWidth = Math.min(width * .59, 310);
  const paperHeight = paperWidth;
  const open = useDerivedValue(() => 1 - stage.value.fold);
  const centerY = insets.top + availableHeight * .42;
  const fullScale = Math.max(width / paperWidth, height / paperHeight) * 1.15;
  useEffect(() => {
    if (!ready) return;
    progress.value = withTiming(1, {duration: reduced ? 220 : MAP_INTRODUCTION_MS, easing: Easing.linear}, done => {
      if (done) runOnJS(onComplete)();
    });
    return () => cancelAnimation(progress);
  }, [onComplete, progress, reduced, ready]);
  const cover = useAnimatedStyle(() => ({opacity: reduced ? 1 - progress.value : stage.value.opacity}));
  const paper = useAnimatedStyle(() => {
    const motion = stage.value;
    return {transform: [{translateY: (height / 2 - centerY) * motion.expand}, {rotateZ: motion.rotation + 'deg'}, {scale: motion.scale * (1 + (fullScale - 1) * motion.expand)}]};
  });
  const content = useAnimatedStyle(() => ({opacity: stage.value.headingOpacity}));
  const heart = useAnimatedStyle(() => ({opacity: Math.max(0, 1 - stage.value.fold * 4) * stage.value.headingOpacity}));
  return <Animated.View accessibilityViewIsModal style={[StyleSheet.absoluteFill, s.page, cover]}>
    <StatusBar barStyle="dark-content" backgroundColor={PAPER}/>
    <View pointerEvents="none" collapsable={false} renderToHardwareTextureAndroid shouldRasterizeIOS style={s.ghost}><MapPaperArtwork prefix="mapGhost"/></View>
    <Animated.View pointerEvents="none" style={[s.paper, {width: paperWidth, height: paperHeight, left: (width - paperWidth) / 2, top: centerY - paperHeight / 2}, paper]}>
      <CrumpledMapPaper size={paperWidth} open={open} onReady={artworkReady}/>
      <Animated.View style={[s.heart, heart]}><Svg width={27} height={27} viewBox="0 0 30 30" accessible={false}><Path d="M15 26C11 23 2 17 2 10C2 3 11 1 15 7C19 1 28 3 28 10C28 17 19 23 15 26Z" fill="#E7A6B6"/></Svg></Animated.View>
    </Animated.View>
    <Animated.View style={[s.copy, {top: insets.top + availableHeight * .68}, content]}>
      <Text accessibilityRole="header" style={[s.title, {fontSize: Math.min(34, width * .088), lineHeight: Math.min(43, width * .112)}]}>Discover soon the{'\n'}profiles you’ve{'\n'}crossed paths with</Text>
    </Animated.View>
    <Animated.View style={[s.back, {top: insets.top + 8}, content]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onClose} hitSlop={8} style={s.backButton}><Ionicons name="arrow-back" size={20} color="#332A32"/></Pressable>
    </Animated.View>
  </Animated.View>;
}

export function MapIntroductionChecking() {
  return <View style={[StyleSheet.absoluteFill, s.page]}><StatusBar barStyle="dark-content" backgroundColor={PAPER}/></View>;
}

const s = StyleSheet.create({
  page: {backgroundColor: PAPER, zIndex: 1000, elevation: 40, overflow: 'hidden'},
  ghost: {position: 'absolute', left: '-15%', right: '-15%', top: 0, bottom: 0, opacity: .055, transform: [{rotate: '13deg'}, {scale: 1.15}]},
  paper: {position: 'absolute'},
  heart: {position: 'absolute', left: -10, top: '72%'},
  copy: {position: 'absolute', left: 20, right: 20, alignItems: 'center'},
  title: {fontFamily: 'DMSans_700Bold', color: '#1C1B1D', textAlign: 'center', includeFontPadding: true, paddingBottom: 8},
  back: {position: 'absolute', left: 16},
  backButton: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF66'},
});
