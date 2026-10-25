import React, { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, FadeIn, FadeOut, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import type { ProfileEditorSection } from './profileEditNavigation';

export type ProfileTask = { ok: boolean; title: string; label: string; route: string; section?: ProfileEditorSection };
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const CIRCUMFERENCE = 2 * Math.PI * 24;

function Spark({ index, progress }: { index: number; progress: ReturnType<typeof useSharedValue<number>> }) {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const angle = (index / 6) * Math.PI * 2;
    return {
      opacity: p > 0 && p < 1 ? Math.sin(p * Math.PI) : 0,
      transform: [{ translateX: Math.cos(angle) * p * 36 }, { translateY: Math.sin(angle) * p * 32 }, { rotate: `${p * 140}deg` }],
    };
  });
  return <Animated.View style={[s.spark, { backgroundColor: index % 2 ? '#F3C1CA' : '#EEE1CB' }, style]} />;
}

export function ProfileAchievementCard({ accountId, tasks, onOpen, onNext }: {
  accountId: string; tasks: ProfileTask[]; onOpen: () => void; onNext: (task: ProfileTask) => void;
}) {
  const done = tasks.filter(task => task.ok).length;
  const total = tasks.length;
  const complete = total > 0 && done === total;
  const next = tasks.find(task => !task.ok);
  const percent = total ? Math.round(done / total * 100) : 0;
  const reducedMotion = useReducedMotion();
  const focused = useIsFocused();
  const [display, setDisplay] = useState<{ accountId: string; visible: boolean } | null>(null);
  const ring = useSharedValue(total ? done / total : 0);
  const celebration = useSharedValue(0);
  const previous = useRef({ accountId, done });

  useEffect(() => {
    const sameAccount = previous.current.accountId === accountId;
    if (sameAccount) ring.value = withTiming(total ? done / total : 0, { duration: 380, easing: Easing.out(Easing.cubic) });
    else {
      ring.value = total ? done / total : 0;
      cancelAnimation(celebration);
      celebration.value = 0;
    }
    previous.current = { accountId, done };
  }, [accountId, done, total, ring, celebration]);

  useEffect(() => {
    const key = `profile-completion-celebrated:v1:${accountId}`;
    let cancelled = false;
    let dismiss: ReturnType<typeof setTimeout> | undefined;
    cancelAnimation(celebration);
    celebration.value = 0;
    if (!complete) {
      setDisplay({ accountId, visible: true });
      // Reset completion when a required detail is removed.
      void AsyncStorage.removeItem(key).catch(() => {});
    } else if (focused) {
      void AsyncStorage.getItem(key).catch(() => null).then(acknowledged => {
        if (cancelled) return;
        if (acknowledged === '1') {
          setDisplay({ accountId, visible: false });
          return;
        }
        setDisplay({ accountId, visible: true });
        if (!reducedMotion) celebration.value = withTiming(1, { duration: 1500 });
        // Keep the confirmation visible before removing it from the page.
        dismiss = setTimeout(() => {
          if (cancelled) return;
          setDisplay({ accountId, visible: false });
          void AsyncStorage.setItem(key, '1').catch(() => {});
        }, 3000);
      });
    }
    return () => {
      cancelled = true;
      if (dismiss) clearTimeout(dismiss);
      cancelAnimation(celebration);
    };
  }, [accountId, complete, focused, reducedMotion, celebration]);
  useEffect(() => () => { cancelAnimation(ring); cancelAnimation(celebration); }, [ring, celebration]);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE * (1 - ring.value) }));
  const trophyStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + Math.sin(celebration.value * Math.PI) * 0.12 }] }));

  if (complete && (display?.accountId !== accountId || !display.visible)) return null;

  return <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(180)} exiting={reducedMotion ? undefined : FadeOut.duration(180)} style={s.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${complete ? 'Profile complete' : 'Build your profile'}, ${done} of ${total} steps complete. View tasks.`} onPress={onOpen} style={({ pressed }) => [s.progressButton, pressed && s.pressed]}>
      <View style={s.header}>
        <View style={s.ring} accessible={false}>
          <Svg width={56} height={56} viewBox="0 0 56 56">
            <Circle cx={28} cy={28} r={24} stroke="#41403E" strokeWidth={3} fill="none" />
            <AnimatedCircle cx={28} cy={28} r={24} stroke={complete ? '#EBDCC4' : '#F3C1CA'} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={[CIRCUMFERENCE, CIRCUMFERENCE]} rotation={-90} origin="28,28" animatedProps={ringProps} />
          </Svg>
          <View style={s.ringCenter}>
            {complete ? <Animated.View style={trophyStyle}><Ionicons name="trophy" size={24} color="#EBDCC4" /></Animated.View> : <Text style={s.percent}>{percent}%</Text>}
            {Array.from({ length: 6 }, (_, index) => <Spark key={index} index={index} progress={celebration} />)}
          </View>
        </View>
        <View style={s.copy}><Text accessibilityLiveRegion="polite" style={[s.title, complete && s.completeTitle]}>{complete ? 'Profile complete!' : 'Build your profile'}</Text><Text style={s.subtitle}>{done} of {total} steps complete</Text></View>
        <Ionicons name="chevron-forward" size={17} color="#D0C6BE" />
      </View>
      <View style={s.segments} accessible={false}>{tasks.map(task => <View key={task.title} style={[s.segment, task.ok && (complete ? s.segmentComplete : s.segmentDone)]} />)}</View>
    </Pressable>
    {next ? <Pressable accessibilityRole="button" accessibilityLabel={next.label} onPress={() => onNext(next)} style={({ pressed }) => [s.next, pressed && s.pressed]}>
      <View style={s.copy}><Text style={s.nextLabel}>NEXT STEP</Text><Text style={s.nextTitle}>{next.label}</Text></View>
      <View style={s.arrow}><Ionicons name="arrow-forward" size={17} color="#33212A" /></View>
    </Pressable> : <View style={s.finished}><Ionicons name="checkmark-circle" size={18} color="#EBDCC4" /><Text style={s.finishedText}>All steps finished. Your profile is complete.</Text></View>}
  </Animated.View>;
}

const s = StyleSheet.create({
  card: { marginBottom: 12, borderRadius: 16, backgroundColor: '#222222', overflow: 'hidden' },
  progressButton: { padding: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ring: { width: 56, height: 56 },
  ringCenter: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  percent: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#F3C1CA' },
  spark: { position: 'absolute', width: 5, height: 7, borderRadius: 1 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 15, lineHeight: 20, color: '#F8F4EF' },
  completeTitle: { color: '#EBDCC4' },
  subtitle: { marginTop: 4, fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#C9C2BA' },
  segments: { flexDirection: 'row', gap: 4, marginTop: 12 },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#41403E' },
  segmentDone: { backgroundColor: '#F3C1CA' },
  segmentComplete: { backgroundColor: '#EBDCC4' },
  next: { minHeight: 54, paddingHorizontal: 12, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  nextLabel: { fontFamily: 'DMSans_700Bold', fontSize: 9, letterSpacing: 1, color: '#BAAEA5' },
  nextTitle: { marginTop: 3, fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: '#F5D4DE' },
  arrow: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3C1CA', alignItems: 'center', justifyContent: 'center' },
  finished: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 12 },
  finishedText: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#C9C2BA' },
  pressed: { opacity: 0.8 },
});
