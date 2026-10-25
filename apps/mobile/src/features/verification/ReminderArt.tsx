import React, { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing, ReduceMotion, cancelAnimation, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

/**
 * The reminders' 3D artwork (assets/illustrations/reminders, made from the
 * prompts beside the originals in assets/illustrations): satin-clay objects
 * everywhere, the kitten on the deck's two big cards.
 */
const ART = {
  likes: require('../../../assets/illustrations/reminders/likes.webp'),
  search: require('../../../assets/illustrations/reminders/search.webp'),
  follow: require('../../../assets/illustrations/reminders/follow.webp'),
  standouts: require('../../../assets/illustrations/reminders/standouts.webp'),
  badge: require('../../../assets/illustrations/reminders/badge.webp'),
  lock: require('../../../assets/illustrations/reminders/lock.webp'),
  deadline: require('../../../assets/illustrations/reminders/deadline.webp'),
  renew: require('../../../assets/illustrations/reminders/renew.webp'),
  envelope: require('../../../assets/illustrations/reminders/envelope.webp'),
  campus: require('../../../assets/illustrations/reminders/campus.webp'),
  chat: require('../../../assets/illustrations/reminders/chat.webp'),
  paused: require('../../../assets/illustrations/reminders/paused.webp'),
  correction: require('../../../assets/illustrations/reminders/correction.webp'),
  mention: require('../../../assets/illustrations/reminders/mention.webp'),
  match: require('../../../assets/illustrations/reminders/match.webp'),
  preferences: require('../../../assets/illustrations/reminders/preferences.webp'),
  map: require('../../../assets/illustrations/reminders/map.webp'),
  rose: require('../../../assets/illustrations/reminders/rose.webp'),
  media: require('../../../assets/illustrations/reminders/media.webp'),
  selfie: require('../../../assets/illustrations/reminders/selfie.webp'),
  kittenLikes: require('../../../assets/illustrations/reminders/kitten-likes.webp'),
  kittenPaused: require('../../../assets/illustrations/reminders/kitten-paused.webp'),
} as const;

export type ReminderArtName = keyof typeof ART;

/**
 * How it moves (REMINDER_DESIGN.md, motion):
 * - `pop`: grows in with a soft spring, once - banners, rows, small art;
 * - `float`: pop, then drifts 4px and tilts 1.5° on a 3.2s loop - a sheet's art;
 * - `lively`: float, a breathing glow behind, and - with `bounce` - a small
 *   squash-and-bounce every 10s - the deck's big cards.
 * Still when the phone's Reduce motion is on.
 */
export function ReminderArt({ name, size, motion = 'pop', glow, bounce = false, delay = 0 }: {
  name: ReminderArtName;
  size: number;
  motion?: 'none' | 'pop' | 'float' | 'lively';
  /** The glow's colour, for `lively`. */
  glow?: string;
  bounce?: boolean;
  /** Milliseconds before the pop, to follow a sheet's slide. */
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const still = reduced || motion === 'none';
  const shown = useSharedValue(still ? 1 : 0);
  const drift = useSharedValue(0);
  const breath = useSharedValue(0);
  const squash = useSharedValue(1);

  useEffect(() => {
    if (still) { shown.value = 1; return; }
    const options = { reduceMotion: ReduceMotion.System };
    shown.value = withDelay(delay, withSpring(1, { damping: 14, stiffness: 180, ...options }));
    if (motion === 'float' || motion === 'lively') {
      drift.value = withDelay(delay + 350, withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin), ...options }), -1, true));
    }
    if (motion === 'lively') {
      breath.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin), ...options }), -1, true);
      if (bounce) {
        squash.value = withDelay(delay + 2000, withRepeat(withSequence(
          withTiming(1.06, { duration: 180, easing: Easing.out(Easing.quad) }),
          withSpring(1, { damping: 7, stiffness: 220 }),
          withTiming(1, { duration: 9200 }),
        ), -1, false));
      }
    }
    return () => { [shown, drift, breath, squash].forEach((value) => cancelAnimation(value)); };
  }, [still, motion, bounce, delay, shown, drift, breath, squash]);

  const lift = motion === 'lively' ? 3 : 4;
  const artStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, shown.value * 1.4),
    transform: [
      { translateY: -lift * drift.value },
      { rotate: `${(drift.value - 0.5) * 3}deg` },
      { scale: (0.85 + 0.15 * shown.value) * squash.value },
    ],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: shown.value * (0.14 + 0.08 * breath.value) }));

  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
    {motion === 'lively' && glow ? <Animated.View pointerEvents="none" style={[styles.glow, {
      width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25, top: size * 0.25, left: size * 0.25,
      backgroundColor: glow, boxShadow: `0px 0px ${Math.round(size * 0.3)}px ${Math.round(size * 0.22)}px ${glow}`,
    }, glowStyle]} /> : null}
    <Animated.View style={[StyleSheet.absoluteFill, artStyle]}>
      <Image source={ART[name]} style={styles.image} resizeMode="contain" fadeDuration={0} />
    </Animated.View>
  </View>;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Art inside a ring that fills to `progress` (0-1) - the blue badge's steps. */
export function ArtRing({ name, size = 46, progress, color }: { name: ReminderArtName; size?: number; progress: number; color: string }) {
  const reduced = useReducedMotion();
  const radius = (size - 4) / 2;
  const length = 2 * Math.PI * radius;
  const filled = useSharedValue(reduced ? progress : 0);
  useEffect(() => {
    filled.value = reduced ? progress : withDelay(200, withTiming(progress, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [progress, reduced, filled]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - filled.value) }));
  return <View accessible={false} style={{ width: size, height: size }}>
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.12)" strokeWidth={3} fill="none" />
      <AnimatedCircle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round"
        strokeDasharray={length} animatedProps={ringProps} rotation={-90} origin={`${size / 2}, ${size / 2}`} />
    </Svg>
    <View style={[StyleSheet.absoluteFill, { padding: 7 }]}><ReminderArt name={name} size={size - 14} /></View>
  </View>;
}

const styles = StyleSheet.create({
  glow: { position: 'absolute' },
  image: { width: '100%', height: '100%' },
});
