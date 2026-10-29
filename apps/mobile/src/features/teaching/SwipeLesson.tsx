import React, {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import {Gesture, GestureDetector, GestureHandlerRootView} from 'react-native-gesture-handler';
import {AccessibilityInfo, Animated, AppState, Easing, Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {LinearGradient} from 'expo-linear-gradient';
import Svg, {Defs, LinearGradient as SvgGradient, Path, Stop} from 'react-native-svg';
import {TeachingHandArt} from './TeachingHandArt';
import {practiceDecision, practiceInstruction, recordPractice, type PracticeDecision} from './swipeLessonModel';

type Phase = 'right' | 'left' | 'practice' | 'complete';
type Props = {onDone: () => void; topInset?: number; bottomInset?: number; photo?: ImageSourcePropType};
// Bundle the practice photo so the lesson does not wait for a network image.
const SAMPLE_PHOTO: ImageSourcePropType = require('../../../assets/teaching/swipe-practice.jpg');
const HEART = 'M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54Z';

/** Demo-only practice. It has no profile callbacks, storage, or API client. */
export function SwipeLesson({onDone, topInset = 0, bottomInset = 0, photo = SAMPLE_PHOTO}: Props) {
  const [phase, setPhase] = useState<Phase>('right');
  const [mask, setMask] = useState(0);
  const [width, setWidth] = useState(0);
  const [mediaReady, setMediaReady] = useState(false);
  const [motion, setMotion] = useState<'pending' | 'full' | 'reduced'>('pending');
  const [replay, setReplay] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const hand = useRef(new Animated.Value(0)).current;
  const visibility = useRef(new Animated.Value(1)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const generation = useRef(0);
  const started = useRef(false);
  const mounted = useRef(true);
  const busy = useRef(false);
  const values = useRef({phase, mask, width, motion});
  values.current = {phase, mask, width, motion};
  const drag = useRef({origin: 0, pending: 0, ready: true, active: false});
  const gradient = `lesson-heart-${useId().replace(/:/g, '')}`;

  const cancel = useCallback(() => {
    generation.current++;
    animation.current?.stop();
    animation.current = null;
    hand.stopAnimation();
    hand.setValue(0);
  }, [hand]);
  const play = useCallback((next: Animated.CompositeAnimation) => new Promise<boolean>(resolve => {
    animation.current = next;
    next.start(({finished}) => resolve(finished));
  }), []);
  const timing = useCallback((value: Animated.Value, toValue: number, duration: number) => Animated.timing(value, {
    toValue, duration, easing: Easing.inOut(Easing.cubic), useNativeDriver: true,
  }), []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const change = (reduced: boolean) => {
      if (!active) return;
      setMotion(reduced ? 'reduced' : 'full');
      if (reduced) {
        started.current = true;
        cancel(); x.stopAnimation(); x.setValue(0); visibility.setValue(1); busy.current = false;
        setPhase(current => current === 'complete' ? current : 'practice');
      }
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(change).catch(() => change(true));
    const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', change);
    const app = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        cancel(); x.stopAnimation(); x.setValue(0); visibility.setValue(1); busy.current = false;
        setPhase(current => current === 'complete' ? current : 'practice');
        started.current = true;
      }
    });
    return () => {
      active = false; mounted.current = false; cancel(); x.stopAnimation(); visibility.stopAnimation();
      preference.remove(); app.remove();
    };
  }, [cancel, visibility, x]);

  useEffect(() => {
    if (motion !== 'full' || !mediaReady || !width || started.current) return;
    started.current = true;
    const token = ++generation.current;
    const showDirection = async (sign: number) => play(Animated.sequence([
      Animated.delay(250), timing(hand, 1, 160),
      timing(x, sign * width * 0.25, 850), Animated.delay(250),
      Animated.parallel([timing(hand, 0, 180), timing(x, 0, 400)]),
    ]));
    void (async () => {
      if (!await showDirection(1) || generation.current !== token || !mounted.current) return;
      setPhase('left');
      if (!await showDirection(-1) || generation.current !== token || !mounted.current) return;
      setPhase('practice');
    })();
  }, [hand, mediaReady, motion, play, replay, timing, width, x]);

  const interrupt = () => {
    if (busy.current || values.current.phase === 'complete') return;
    started.current = true;
    cancel();
    setPhase('practice');
  };
  const decide = async (decision: PracticeDecision) => {
    if (busy.current || values.current.phase === 'complete') return;
    busy.current = true;
    started.current = true;
    cancel();
    const token = generation.current;
    setPhase('practice');
    const reduced = values.current.motion !== 'full';
    const finished = await play(timing(x, (decision === 'like' ? 1 : -1) * (values.current.width + 90), reduced ? 0 : 260));
    if (!mounted.current) return;
    // Cut short (Replay, the app going to the background): put the card back
    // and let it be dragged again, rather than leave it stuck where it stopped.
    if (!finished || token !== generation.current) {
      if (token === generation.current) { x.setValue(0); busy.current = false; }
      return;
    }
    const next = recordPractice(values.current.mask, decision);
    values.current.mask = next;
    setMask(next);
    visibility.setValue(0); x.setValue(0);
    setPhase(next === 3 ? 'complete' : 'practice');
    await play(timing(visibility, 1, reduced ? 0 : 160));
    if (token === generation.current) busy.current = false;
  };
  const handlers = useRef({interrupt, decide});
  handlers.current = {interrupt, decide};
  // The same gesture library as the real deck. The old PanResponder never got
  // the drag here (the card would not move), and a Modal needs its own
  // GestureHandlerRootView for these gestures - see the return below.
  const pan = useMemo(() => Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-8, 8])
    .failOffsetY([-24, 24])
    .maxPointers(1)
    .onBegin(() => handlers.current.interrupt())
    .onStart(() => {
      if (busy.current || values.current.phase === 'complete') return;
      drag.current = {origin: 0, pending: 0, ready: false, active: true};
      x.stopAnimation(current => {
        drag.current.origin = current; drag.current.ready = true;
        x.setValue(current + drag.current.pending);
      });
    })
    .onUpdate(event => {
      if (busy.current || values.current.phase === 'complete') return;
      drag.current.pending = event.translationX;
      if (drag.current.ready) x.setValue(drag.current.origin + event.translationX);
    })
    // onFinalize, not onEnd: it runs however the touch ends (lifted, cancelled
    // by the system), so the card always either goes or comes back.
    .onFinalize((event, success) => {
      if (!drag.current.active) return; // a tap, or a drag that never started
      const moved = drag.current.origin + event.translationX;
      drag.current = {origin: 0, pending: 0, ready: false, active: false};
      if (busy.current || values.current.phase === 'complete') return;
      // practiceDecision takes PanResponder's units, pixels per millisecond.
      const choice = success ? practiceDecision(moved, event.velocityX / 1000, values.current.width) : null;
      if (choice) void handlers.current.decide(choice);
      else if (values.current.motion === 'full') Animated.spring(x, {toValue: 0, stiffness: 240, damping: 26, mass: 0.8, useNativeDriver: true}).start();
      else x.setValue(0);
    }), [x]);

  const reset = () => {
    cancel(); x.stopAnimation(); x.setValue(0); visibility.setValue(1);
    busy.current = false; started.current = false;
    values.current.mask = 0; setMask(0);
    setPhase(motion === 'full' ? 'right' : 'practice'); setReplay(value => value + 1);
  };
  const threshold = Math.max(56, width * 0.22);
  const progress = (decision: PracticeDecision) => x.interpolate({inputRange: decision === 'like' ? [0, threshold] : [-threshold, 0], outputRange: decision === 'like' ? [0, 1] : [1, 0], extrapolate: 'clamp'});
  const likeProgress = progress('like'), passProgress = progress('pass');
  const grow = (decision: PracticeDecision) => x.interpolate({inputRange: decision === 'like' ? [0, threshold] : [-threshold, 0], outputRange: decision === 'like' ? [1, 1.15] : [1.15, 1], extrapolate: 'clamp'});
  const rotate = x.interpolate({inputRange: [-Math.max(width, 1), 0, Math.max(width, 1)], outputRange: ['-12deg', '0deg', '12deg'], extrapolate: 'clamp'});
  const title = phase === 'right' ? 'Swipe right to Like' : phase === 'left' ? 'Swipe left to Pass' : phase === 'complete' ? 'You’re ready' : 'Your turn';
  const subtitle = phase === 'right' ? 'If you both Like each other, it’s a match.' : phase === 'left' ? 'Move on to the next profile.' : phase === 'complete' ? 'You can also tap the heart or cross.' : practiceInstruction(mask);
  return <GestureHandlerRootView style={[styles.page, {paddingTop: topInset, paddingBottom: bottomInset}]}>
    <View style={styles.header}><Text style={styles.explore}>Explore</Text><Pressable accessibilityRole="button" onPress={onDone} style={styles.skip}><Text style={styles.skipText}>Skip</Text></Pressable></View>
    <View style={styles.instruction} accessibilityLiveRegion="polite"><Text style={styles.title} accessibilityRole="header">{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
    <View style={styles.stage} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <View pointerEvents="none" style={styles.backCard}/>
      <GestureDetector gesture={pan}>
      <Animated.View testID="swipe-practice-card" style={[styles.card, {opacity: visibility, transform: [{translateX: x}, {rotate: motion === 'full' ? rotate : '0deg'}]}]}>
        <Image source={photo} resizeMode="cover" style={StyleSheet.absoluteFill} onLoad={() => setMediaReady(true)} onError={() => setMediaReady(true)}/>
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.08)', 'transparent', 'rgba(0,0,0,0.9)']} locations={[0, 0.32, 1]} style={StyleSheet.absoluteFill}/>
        <View pointerEvents="none" style={styles.practicePill}><Text style={styles.practiceText}>Practice profile</Text></View>
        <Animated.View pointerEvents="none" style={[styles.mark, {left: 16, opacity: likeProgress, transform: [{rotate: '-12deg'}]}]}><Svg width={76} height={76} viewBox="0 0 24 24"><Defs><SvgGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="100%"><Stop offset="0%" stopColor="#FF9BA8"/><Stop offset="48%" stopColor="#FF5364"/><Stop offset="100%" stopColor="#EC327B"/></SvgGradient></Defs><Path d={HEART} fill={`url(#${gradient})`}/></Svg></Animated.View>
        <Animated.View pointerEvents="none" style={[styles.mark, {right: 16, opacity: passProgress}]}><Ionicons name="close" size={76} color="#FFFFFF"/></Animated.View>
        <View pointerEvents="none" style={styles.profile}><Text style={styles.name}>Aanya, 22</Text><Text style={styles.department}>Computer Science</Text></View>
        <Animated.View pointerEvents="none" style={[styles.hand, {opacity: hand}]}><Svg width={52} height={79} viewBox="0 -18 128 194"><TeachingHandArt/></Svg></Animated.View>
        <View style={styles.actions}>
          <Animated.View style={{transform: [{scale: motion === 'full' ? grow('pass') : 1}]}}><Pressable accessibilityRole="button" accessibilityLabel="Practise Pass" disabled={phase === 'complete'} onPress={() => void decide('pass')} style={[styles.action, styles.pass]}><Ionicons name="close" size={32} color="#FFFFFF"/></Pressable></Animated.View>
          <Animated.View style={{transform: [{scale: motion === 'full' ? grow('like') : 1}]}}><Pressable accessibilityRole="button" accessibilityLabel="Practise Like" disabled={phase === 'complete'} onPress={() => void decide('like')} style={[styles.action, styles.like]}><Ionicons name="heart" size={32} color="#FFFFFF"/></Pressable></Animated.View>
        </View>
      </Animated.View>
      </GestureDetector>
    </View>
    <View style={styles.footer}>
      <View style={styles.progress} accessibilityLabel={`${mask & 1 ? 'Like complete' : 'Like not complete'}. ${mask & 2 ? 'Pass complete' : 'Pass not complete'}.`}>
        {(['like', 'pass'] as const).map((item, i) => <View key={item} style={styles.progressItem}><Ionicons name={mask & (1 << i) ? 'checkmark-circle' : i === 0 ? 'arrow-forward-circle-outline' : 'arrow-back-circle-outline'} color={mask & (1 << i) ? '#F2C1BE' : '#A49A91'} size={17}/><Text style={styles.progressText}>{i === 0 ? 'Like' : 'Pass'}</Text></View>)}
      </View>
      <Text style={styles.note}>Practice only. No Likes are sent.</Text>
      {phase === 'complete' ? <Pressable accessibilityRole="button" onPress={onDone} style={styles.start}><Text style={styles.startText}>Start exploring</Text><Ionicons name="arrow-forward" size={19} color="#352329"/></Pressable> : <View style={styles.hint}><Ionicons name="swap-horizontal-outline" color="#BDB5AB" size={18}/><Text style={styles.hintText}>You can also use the buttons.</Text></View>}
      <Pressable accessibilityRole="button" onPress={reset} style={styles.replay}><Text style={styles.replayText}>Replay lesson</Text></Pressable>
    </View>
  </GestureHandlerRootView>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#100F0D', overflow: 'hidden'},
  header: {height: 52, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  explore: {fontFamily: 'DMSans_700Bold', color: '#FFF', fontSize: 21},
  skip: {minWidth: 48, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end'},
  skipText: {fontFamily: 'DMSans_500Medium', color: '#CFC6BD', fontSize: 14},
  instruction: {height: 90, paddingHorizontal: 24, justifyContent: 'center', gap: 7},
  title: {fontFamily: 'DMSans_700Bold', fontSize: 25, lineHeight: 31, color: '#F9F5EF'},
  subtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#BDB5AB'},
  stage: {flex: 1, minHeight: 200, marginHorizontal: 20, marginVertical: 8},
  backCard: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#2B2524', borderRadius: 25, transform: [{scale: 0.96}, {translateY: 9}]},
  card: {position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#342F2D', borderRadius: 25, overflow: 'hidden'},
  practicePill: {position: 'absolute', left: 14, top: 14, borderRadius: 20, backgroundColor: 'rgba(16,15,13,0.72)', paddingHorizontal: 12, paddingVertical: 7},
  practiceText: {fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#F6E7D6'},
  mark: {position: 'absolute', top: 64, width: 76, height: 76},
  profile: {position: 'absolute', left: 20, right: 20, bottom: 108, gap: 5},
  name: {fontFamily: 'DMSans_700Bold', fontSize: 27, color: '#FFF'},
  department: {fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#E2DAD4'},
  hand: {position: 'absolute', top: '46%', left: '50%', marginLeft: -22},
  actions: {position: 'absolute', bottom: 20, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18},
  action: {width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center'},
  pass: {backgroundColor: '#24211F', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)'},
  like: {backgroundColor: '#FF5364'},
  footer: {paddingHorizontal: 24, paddingTop: 14, paddingBottom: 4, gap: 9},
  progress: {flexDirection: 'row', justifyContent: 'center', gap: 25},
  progressItem: {flexDirection: 'row', alignItems: 'center', gap: 7},
  progressText: {fontFamily: 'DMSans_500Medium', color: '#D8D0C6', fontSize: 12},
  note: {fontFamily: 'DMSans_400Regular', color: '#A69E95', fontSize: 11, textAlign: 'center'},
  hint: {height: 48, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8},
  hintText: {fontFamily: 'DMSans_400Regular', color: '#BDB5AB', fontSize: 12},
  start: {height: 48, borderRadius: 24, backgroundColor: '#F2C1BE', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10},
  startText: {fontFamily: 'DMSans_700Bold', color: '#352329', fontSize: 14},
  replay: {minHeight: 44, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: 16},
  replayText: {fontFamily: 'DMSans_500Medium', color: '#BDB5AB', fontSize: 12},
});
