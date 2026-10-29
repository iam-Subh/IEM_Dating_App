import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { Learning } from '../standoutsLearning';

const growingArtwork = {
  sprout: require('../../../../assets/illustrations/standouts-growing-sprout.png'),
  buds: require('../../../../assets/illustrations/standouts-growing-buds.png'),
  bloom: require('../../../../assets/illustrations/standouts-growing-bloom.png'),
};

/** A thin ring that fills as a new person swipes: around the Standouts icon, and in the Explore pill. */
export function LearningRing({ progress, size, stroke = 2 }: { progress: Learning; size: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const share = progress.needed ? Math.min(1, progress.done / progress.needed) : 0;
  return <Svg width={size} height={size} accessible={false}>
    <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(232,198,152,0.22)" strokeWidth={stroke} fill="none" />
    <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#E8C698" strokeWidth={stroke} fill="none" strokeLinecap="round"
      strokeDasharray={[length, length]} strokeDashoffset={length * (1 - share)} rotation={-90} origin={`${size / 2}, ${size / 2}`} />
  </Svg>;
}

/** Explore, above the cards, while a new person's type is learned. Tapping it opens Standouts, which explains. */
export function LearningPill({ progress, onPress }: { progress: Learning; onPress: () => void }) {
  const left = Math.max(0, progress.needed - progress.done);
  return <Pressable onPress={onPress} accessibilityRole="button"
    accessibilityLabel={`Learning your type. ${left} ${left === 1 ? 'swipe' : 'swipes'} to go. Opens Standouts.`}
    style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
    <LearningRing progress={progress} size={20} stroke={2.5} />
    <Text style={styles.text} numberOfLines={1}>
      <Text style={styles.strong}>Learning your type</Text> · {left} to go
    </Text>
  </Pressable>;
}

/** Standouts while learning: how far along, and the way back to Explore. */
export function LearningPage({ progress, onExplore }: { progress: Learning; onExplore: () => void }) {
  const needed = Math.max(1, progress.needed);
  const done = Math.max(0, Math.min(needed, progress.done));
  const share = done / needed;
  const stage = share < 1 / 3 ? 'sprout' : share < 2 / 3 ? 'buds' : 'bloom';
  return <View style={styles.page}>
    <View style={styles.artFrame}>
      <Image source={growingArtwork[stage]} style={styles.art} resizeMode="contain"
        fadeDuration={0} accessible={false} testID={`standouts-growing-${stage}`} />
    </View>
    <Text style={styles.title} accessibilityRole="header">Your Standouts are on the way</Text>
    <Text style={styles.body}>Swipe on {needed} people in Explore so we can learn your type. Likes and passes both count.</Text>
    <View style={styles.progress}>
      <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityLabel="Standouts progress"
        aria-valuemin={0} aria-valuemax={needed} aria-valuenow={done} aria-valuetext={`${done} of ${needed} swipes`}>
        <View style={[styles.fill, {width: `${share * 100}%`}]} />
      </View>
      <Text style={styles.progressText}>{done} of {needed} swipes</Text>
    </View>
    <Pressable onPress={onExplore} accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Text style={styles.buttonText}>Go to Explore</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  page: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20 },
  artFrame: {width: 200, height: 200, overflow: 'hidden', marginBottom: 22},
  art: {position: 'absolute', width: 250, height: 250, left: -25, top: -38},
  title: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 20, lineHeight: 27, textAlign: 'center', maxWidth: 280 },
  body: { color: '#B8B0AA', fontFamily: 'DMSans_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 12, maxWidth: 290 },
  progress: {width: '100%', maxWidth: 260, marginTop: 26, alignItems: 'center', gap: 10},
  track: {width: '100%', height: 4, borderRadius: 2, backgroundColor: '#383129', overflow: 'hidden'},
  fill: {height: '100%', borderRadius: 2, backgroundColor: '#E8C698'},
  progressText: {color: '#C4B6A5', fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18},
  button: { width: '100%', maxWidth: 280, minHeight: 48, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#F2C9D3', marginTop: 28 },
  buttonText: { color: '#302025', fontSize: 14, fontFamily: 'DMSans_700Bold' },
  pill: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
    paddingLeft: 8, paddingRight: 14, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#211C17', borderWidth: 1, borderColor: 'rgba(232,198,152,0.2)',
  },
  pressed: { opacity: 0.8 },
  text: { color: '#D9CFC4', fontSize: 13 },
  strong: { color: '#F2E3CE', fontWeight: '700' },
});
