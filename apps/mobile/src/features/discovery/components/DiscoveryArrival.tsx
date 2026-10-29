import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Image, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Animated, {cancelAnimation, Easing, interpolateColor, runOnJS, runOnUI, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue} from 'react-native-reanimated';
import {LinearGradient} from 'expo-linear-gradient';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Defs, Ellipse, RadialGradient, Stop} from 'react-native-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {finishDiscoveryArrival, getDiscoveryArrival, retryDiscoveryArrival, subscribeDiscoveryArrival, type ArrivalFrame, type ArrivalProfile} from '../discoveryArrival';
import {CARD_TRANSFER_MS, discoveryShuffleMotion} from '../discoveryShuffleMotion';
import {shuffleMessage, shuffleMessageIndex} from '../discoveryShuffleCaption';

const EMPTY_PROFILES: readonly ArrivalProfile[] = [];

function AmbientLight() {
  return <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" accessible={false}>
    <Defs><RadialGradient id="discoveryArrivalRose"><Stop offset="0" stopColor="#B66C89" stopOpacity={.22}/><Stop offset="1" stopColor="#B66C89" stopOpacity={0}/></RadialGradient></Defs>
    <Ellipse cx="50%" cy="42%" rx="78%" ry="40%" fill="url(#discoveryArrivalRose)"/>
  </Svg>;
}

function ShuffleCard({index, front, profile, progress, reveal, frame, width, height, x, y, onPrepared}: {
  index: number; front: number; profile?: ArrivalProfile;
  progress: SharedValue<number>; reveal: SharedValue<number>; frame?: ArrivalFrame;
  width: number; height: number; x: number; y: number; onPrepared: (uri: string) => void;
}) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const uri = profile?.photoUri ?? profile?.primaryPhoto;
  const motion = useAnimatedStyle(() => {
    const pose = discoveryShuffleMotion(index, Number.isFinite(progress.value) ? progress.value : 0);
    const amount = reveal.value;
    const morph = index === 0 && frame ? amount : 0;
    return {
      width: width + ((frame?.width ?? width) - width) * morph,
      height: height + ((frame?.height ?? height) - height) * morph,
      left: x + pose.x * width / 158 * (1 - amount) + ((frame?.x ?? x) - x) * morph,
      top: y + pose.y * width / 158 * (1 - amount) + ((frame?.y ?? y) - y) * morph,
      opacity: index === 0 && frame ? Math.min(1, (1 - amount) / .2) : 1 - amount,
      borderRadius: 24 - 10 * morph,
      transform: [{rotate: (pose.rotation * (1 - amount)) + 'deg'}, {scale: pose.scale + (1 - pose.scale) * amount}],
    };
  });
  // React must commit depth changes. Android's synchronous animation updates
  // move views without updating their parent's drawing order.
  return <Animated.View pointerEvents="none" accessible={false} style={[s.card, {zIndex: 3 - ((index - front + 3) % 3)}, motion]}>
    <LinearGradient colors={index === 1 ? ['#51434E', '#29242A'] : index === 2 ? ['#5B4840', '#292320'] : ['#5B3D4D', '#2A2228']} style={StyleSheet.absoluteFill}/>
    {uri && failedUri !== uri ? <Image source={{uri}} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0}
      onLoad={() => onPrepared(uri)} onError={() => {setFailedUri(uri); onPrepared(uri);}}/>
      : <View style={s.placeholder}><View style={s.placeholderFrame}/><View style={s.placeholderLine}/><View style={[s.placeholderLine, {width: '44%'}]}/></View>}
    <LinearGradient colors={['transparent', '#100F0D10', '#100F0DD9']} locations={[0, .48, 1]} style={StyleSheet.absoluteFill}/>
    <View style={s.cardTopline}>{[0, 1, 2].map(segment => <View key={segment} style={[s.cardSegment, {opacity: segment === 0 ? .9 : .3}]}/>)}</View>
    {profile && <View style={s.cardFooter}>
      <Text numberOfLines={1} style={s.cardName}>{profile.name}{profile.age != null ? ', ' + profile.age : ''}</Text>
      {!!profile.campus && <Text numberOfLines={1} style={s.cardCampus}>{profile.campus}</Text>}
    </View>}
  </Animated.View>;
}

export function DiscoveryArrival({preview = false, revealToDeck = true}: {preview?: boolean; revealToDeck?: boolean}) {
  const state = useSyncExternalStore(subscribeDiscoveryArrival, getDiscoveryArrival);
  useEffect(() => () => {
    const current = getDiscoveryArrival();
    if (current.active && !!current.replay === preview) finishDiscoveryArrival();
  }, [preview]);
  return state.active && !!state.replay === preview
    ? <ArrivalContent status={state.status} loop={preview} profiles={state.profiles ?? EMPTY_PROFILES} frame={revealToDeck ? state.frame : undefined}/>
    : null;
}

function ArrivalContent({status, loop, profiles, frame}: {
  status: 'loading' | 'ready' | 'error'; loop: boolean; profiles: readonly ArrivalProfile[]; frame?: ArrivalFrame;
}) {
  const reduced = useReducedMotion();
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const root = useRef<View>(null);
  const [origin, setOrigin] = useState({x: 0, y: 0});
  const tone = useSharedValue(0);
  const reveal = useSharedValue(0);
  const progress = useSharedValue(0);
  const [settled, setSettled] = useState(false);
  const [shuffleDone, setShuffleDone] = useState(reduced);
  const [front, setFront] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [slow, setSlow] = useState(false);
  const [lightText, setLightText] = useState(false);
  const [preparedUri, setPreparedUri] = useState<string | null>(null);
  const firstPhotoUri = profiles[0]?.photoUri ?? profiles[0]?.primaryPhoto;
  const firstPhotoReady = !firstPhotoUri || preparedUri === firstPhotoUri;
  const stopShuffle = reduced || status === 'error' || (!loop && settled && status === 'ready' && firstPhotoReady);

  useAnimatedReaction(() => shuffleMessageIndex(progress.value + .5), (next, previous) => {
    if (next !== previous) runOnJS(setFront)(next);
  });
  useAnimatedReaction(() => shuffleMessageIndex(progress.value), (next, previous) => {
    if (next !== previous) runOnJS(setMessageIndex)(next);
  });
  useEffect(() => {
    setShuffleDone(false);
    runOnUI(() => {
      'worklet';
      cancelAnimation(progress);
      if (!Number.isFinite(progress.value)) progress.value = 0;
      if (reduced) {
        progress.value = 0;
        runOnJS(setShuffleDone)(true);
      } else if (stopShuffle) {
        // End with the first recommendation in front for the Discovery reveal.
        const target = status === 'error' ? Math.ceil(progress.value) : Math.ceil(progress.value / 3) * 3;
        progress.value = withTiming(target, {duration: (target - progress.value) * CARD_TRANSFER_MS, easing: Easing.linear}, done => {
          if (done) runOnJS(setShuffleDone)(true);
        });
      } else {
        progress.value = withRepeat(withTiming(progress.value + 3, {duration: CARD_TRANSFER_MS * 3, easing: Easing.linear}), -1, false);
      }
    })();
    return () => cancelAnimation(progress);
  }, [reduced, stopShuffle, status, progress]);
  useEffect(() => {
    tone.value = withTiming(1, {duration: reduced ? 450 : 3000, easing: Easing.inOut(Easing.sin)});
    const minimum = setTimeout(() => setSettled(true), reduced ? 450 : CARD_TRANSFER_MS * 2.4);
    const bar = setTimeout(() => setLightText(true), reduced ? 200 : 1400);
    const waiting = setTimeout(() => setSlow(true), 8000);
    return () => {clearTimeout(minimum); clearTimeout(bar); clearTimeout(waiting); cancelAnimation(tone); cancelAnimation(reveal);};
  }, [reduced, tone, reveal]);
  useEffect(() => {
    if (!loop && settled && shuffleDone && firstPhotoReady && status === 'ready') {
      reveal.value = withTiming(1, {duration: reduced ? 200 : 650, easing: Easing.inOut(Easing.cubic)}, done => {
        if (done) runOnJS(finishDiscoveryArrival)();
      });
    }
    return () => cancelAnimation(reveal);
  }, [loop, settled, shuffleDone, firstPhotoReady, status, reduced, reveal]);

  const availableHeight = height - insets.top - insets.bottom;
  const cardWidth = Math.max(80, Math.min(width * .69, 300, (availableHeight - 252) / 1.4));
  const cardHeight = cardWidth * 1.4;
  const cardX = (width - cardWidth) / 2;
  const cardY = insets.top + Math.max(92, (availableHeight - cardHeight - 152) / 2);
  const target = !loop && firstPhotoUri && firstPhotoReady && frame
    ? {...frame, x: frame.x - origin.x, y: frame.y - origin.y} : undefined;
  const message = shuffleMessage(messageIndex);
  const surface = useAnimatedStyle(() => ({backgroundColor: interpolateColor(tone.value, [0, .5, 1], ['#F2F3EE', '#65505A', '#100F0D']), opacity: 1 - reveal.value}));
  const disappearing = useAnimatedStyle(() => ({opacity: 1 - reveal.value}));
  const heading = useAnimatedStyle(() => ({color: interpolateColor(tone.value, [0, 1], ['#352335', '#FAF0F4'])}));
  const detail = useAnimatedStyle(() => ({color: interpolateColor(tone.value, [0, 1], ['#715365', '#C1ADB7'])}));
  const caption = useAnimatedStyle(() => {
    const phase = Number.isFinite(progress.value) ? progress.value - Math.floor(progress.value) : .5;
    return {opacity: (1 - reveal.value) * (reduced || shuffleDone || status === 'error' ? 1 : Math.max(0, Math.min(1, phase / .1, (1 - phase) / .1)))};
  });

  return <Animated.View ref={root} accessibilityViewIsModal style={[StyleSheet.absoluteFill, s.page]}
    onLayout={() => root.current?.measureInWindow((x, y) => setOrigin({x, y}))}>
    <StatusBar barStyle={lightText ? 'light-content' : 'dark-content'}/>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, surface]}/>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, disappearing]}><AmbientLight/></Animated.View>
    {loop && <Animated.View style={[s.header, {top: insets.top + 16}, disappearing]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close animation preview" onPress={finishDiscoveryArrival} style={s.close}>
        <Ionicons name="close" size={20} color={lightText ? '#FAF0F4' : '#712C48'}/>
      </Pressable>
    </Animated.View>}
    {loop && <Animated.Text style={[s.previewLabel, {top: insets.top + 63}, detail, disappearing]}>Animation preview · sample profiles</Animated.Text>}
    {[2, 1, 0].map(index => <ShuffleCard key={index} index={index} front={front} profile={profiles[index]} progress={progress} reveal={reveal}
      frame={target} width={cardWidth} height={cardHeight} x={cardX} y={cardY} onPrepared={uri => {if (uri === firstPhotoUri) setPreparedUri(uri);}}/>)}
    <View style={[s.footer, {top: cardY + cardHeight + 28}]}>
      <Animated.View style={[s.caption, caption]}>
        <Animated.Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[s.title, heading]}>{status === 'error' ? 'Discovery could not load' : message.title}</Animated.Text>
        <Animated.Text style={[s.detail, detail]}>{status === 'error' ? 'Check your connection and try again.' : slow && (status === 'loading' || !firstPhotoReady) ? 'Still loading your discovery…' : message.detail}</Animated.Text>
      </Animated.View>
      {status === 'error' && <Pressable accessibilityRole="button" onPress={retryDiscoveryArrival} style={s.retry}><Text style={s.retryText}>Try again</Text><Ionicons name="refresh" size={17} color="#352335"/></Pressable>}
      {!loop && (status === 'error' || (slow && (status === 'loading' || !firstPhotoReady))) && <Pressable accessibilityRole="button" onPress={finishDiscoveryArrival} style={s.open}><Text style={s.openText}>Open Discovery</Text></Pressable>}
    </View>
  </Animated.View>;
}

const s = StyleSheet.create({
  page: {zIndex: 100, elevation: 30, overflow: 'hidden'},
  header: {position: 'absolute', left: 22, right: 22, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', height: 40},
  close: {width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#B17C9420'},
  previewLabel: {position: 'absolute', left: 22, fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 16},
  card: {position: 'absolute', overflow: 'hidden', backgroundColor: '#342830', borderWidth: 1, borderColor: '#EAC3D138', elevation: 0, shadowColor: '#000', shadowOffset: {width: 0, height: 12}, shadowOpacity: .32, shadowRadius: 18},
  cardTopline: {position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', gap: 4},
  cardSegment: {height: 2, borderRadius: 1, flex: 1, backgroundColor: '#FFF'},
  cardFooter: {position: 'absolute', left: 20, right: 20, bottom: 22, gap: 5},
  cardName: {fontFamily: 'DMSans_700Bold', fontSize: 23, lineHeight: 30, color: '#FFF'},
  cardCampus: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: '#E8DDE2'},
  placeholder: {flex: 1, padding: 22, justifyContent: 'flex-end', gap: 10},
  placeholderFrame: {position: 'absolute', top: 38, bottom: 94, left: 22, right: 22, borderRadius: 18, borderWidth: 1, borderColor: '#E6A5BD20'},
  placeholderLine: {width: '66%', height: 8, borderRadius: 4, backgroundColor: '#E6C5D044'},
  footer: {position: 'absolute', left: 24, right: 24, alignItems: 'center'},
  caption: {minHeight: 112, width: '100%', alignItems: 'center'},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 31, lineHeight: 38, textAlign: 'center', includeFontPadding: true, paddingBottom: 10},
  detail: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 300},
  retry: {marginTop: 12, minHeight: 46, paddingHorizontal: 24, borderRadius: 23, backgroundColor: '#EDBBD0', flexDirection: 'row', alignItems: 'center', gap: 10},
  retryText: {fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#352335'},
  open: {minHeight: 44, justifyContent: 'center', marginTop: 4}, openText: {fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#EDBBD0'},
});
