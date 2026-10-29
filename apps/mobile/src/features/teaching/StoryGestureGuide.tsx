import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureTeachingHand, type TeachingGesturePose } from './GestureTeachingHand';
import { markTipSeen, tipUnseen } from './tipsSeen';

const HAND = 56;

/** The first Story anyone opens shows this, once (tipsSeen). */
export const shouldShowStoryGuide = (demo: boolean) => tipUnseen('storyGuide', demo);
export const markStoryGuideSeen = (demo: boolean) => markTipSeen('storyGuide', demo);

type Item = { pose: TeachingGesturePose; text: string; direction?: 'left' | 'right' | 'down' };

/**
 * How Stories move, over the first Story, as on Instagram: the three tap zones
 * where they really are (back is the left 30 percent), and the two swipes
 * below. The Story stays paused under it until Got it.
 */
export function StoryGestureGuide({ onDone, topInset, bottomInset }: { onDone: () => void; topInset: number; bottomInset: number }) {
  const { width } = useWindowDimensions();
  const side = width * 0.3;
  const zones: [Item, number][] = [
    [{ pose: 'point', text: 'Tap to go back' }, side],
    [{ pose: 'hold', text: 'Hold to pause' }, width - side * 2],
    [{ pose: 'point', text: 'Tap for the next Story' }, side],
  ];
  const swipes: Item[] = [
    { pose: 'swipe', text: 'Swipe for the next person', direction: 'left' },
    { pose: 'swipe', text: 'Swipe down to close', direction: 'down' },
  ];
  const hand = (item: Item, room: number) => <GestureTeachingHand pose={item.pose} text={item.text} direction={item.direction}
    textSide="below" textMaxWidth={room - 16} size={HAND} loop />;

  return <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onDone} accessibilityViewIsModal
    accessibilityLabel="How Stories work. Tap the left side to go back, the right side for the next Story, hold to pause, swipe sideways for the next person, swipe down to close.">
    <View style={[styles.head, { paddingTop: topInset + 72 }]}>
      <Text style={styles.title} accessibilityRole="header">How Stories work</Text>
    </View>
    <View style={styles.zones}>
      <View style={[styles.divider, { left: side }]} />
      <View style={[styles.divider, { left: width - side }]} />
      {zones.map(([item, room], i) => <View key={i} style={[styles.zone, { width: room }]}>{hand(item, room)}</View>)}
    </View>
    <View style={styles.swipes}>
      {swipes.map((item) => <View key={item.text} style={styles.swipe}>{hand(item, width / 2)}</View>)}
    </View>
    <View style={[styles.foot, { paddingBottom: bottomInset + 24 }]}>
      <Pressable onPress={onDone} accessibilityRole="button" style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
        <Text style={styles.doneText}>Got it</Text>
      </Pressable>
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(16,15,13,0.8)', zIndex: 60, elevation: 60 },
  head: { alignItems: 'center', paddingHorizontal: 24 },
  title: { color: '#F4EEE5', fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 30, lineHeight: 36, textAlign: 'center' },
  zones: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  zone: { alignItems: 'center' },
  divider: { position: 'absolute', top: '12%', bottom: '12%', width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(246,231,214,0.35)' },
  swipes: { flexDirection: 'row', paddingBottom: 28 },
  swipe: { flex: 1, alignItems: 'center' },
  foot: { alignItems: 'center' },
  done: { minWidth: 160, minHeight: 48, paddingHorizontal: 28, borderRadius: 24, backgroundColor: '#F7D8E0', alignItems: 'center', justifyContent: 'center' },
  doneText: { color: '#3A222B', fontFamily: 'DMSans_700Bold', fontSize: 15 },
  pressed: { opacity: 0.72 },
});
