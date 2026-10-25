import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, ZoomIn, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { InteractiveSticker } from '../composition/types';
import { frameLayout } from '../composition/frame';
import { onShake } from './shake';
import { AnimatedStoryText } from '../editor/StoryText';

/** What the viewer knows about a sticker from the server. */
export type StickerState = {
  id: string;
  myResponse: { option?: number; value?: number } | null;
  subscribed?: boolean;
  results: {
    counts?: number[]; total?: number; correctIndex?: number; average?: number | null; subscribers?: number; replies?: number; taps?: number;
    unlocks?: number; threadId?: string | null; count?: number;
  } | null;
};

type Props = {
  sticker: InteractiveSticker;
  /** Screen pixels per canvas unit. */
  unit: number;
  mode: 'edit' | 'view';
  state?: StickerState | null;
  isOwner?: boolean;
  onRespond?: (body: { option?: number; value?: number; subscribe?: boolean }) => void;
  onOpen?: () => void;
  /** The story's playback time, for captions. */
  timeMs?: number;
  /** In the sticker tray: an emoji slider can be tried, and nothing is sent. */
  tryOut?: boolean;
};

const GRADIENTS: Record<string, readonly [string, string]> = {
  default: ['#8A3AB9', '#E1306C'],
  blue: ['#3897F0', '#4F5BD5'],
  orange: ['#FCAF45', '#F77737'],
  green: ['#56AB2F', '#A8E063'],
  dark: ['#262626', '#262626'],
};
const gradientFor = (style: string) => GRADIENTS[style] ?? GRADIENTS.default;

/** Style names each sticker cycles through when tapped in the editor. */
export const STICKER_STYLES = ['default', 'blue', 'orange', 'green', 'dark'];

function Countdown({ endsAt, unit }: { endsAt: string; unit: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Date.parse(endsAt) - now);
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  const cells = days > 0 ? [[days, 'days'], [hours, 'hours'], [minutes, 'minutes']] : [[hours, 'hours'], [minutes, 'minutes'], [seconds, 'seconds']];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14 * unit }}>
      {cells.map(([value, label]) => (
        <View key={String(label)} style={{ alignItems: 'center' }}>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 14 * unit, paddingHorizontal: 18 * unit, paddingVertical: 8 * unit }}>
            <Text style={{ color: '#fff', fontSize: 64 * unit, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{String(value).padStart(2, '0')}</Text>
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 24 * unit, marginTop: 6 * unit }}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const SLIDER_SPRING = { damping: 14, stiffness: 220, mass: 0.6 };
const sliderTick = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/**
 * Instagram's emoji slider: the emoji on the track keeps its size; while it is
 * held a second emoji floats above it, growing the further it is slid, and on
 * release that emoji floats up and fades while the average rating pops in.
 */
function Slider({ sticker, unit, mode, state, isOwner, onRespond, tryOut }: Props & { sticker: Extract<InteractiveSticker, { type: 'slider' }> }) {
  const trackWidth = 560 * unit;
  const thumbSize = 96 * unit;
  const answered = state?.myResponse?.value;
  const position = useSharedValue(answered ?? 0.15);
  // 1 while a finger holds the emoji.
  const held = useSharedValue(0);
  // 0 → 1 as the released emoji floats away.
  const burst = useSharedValue(1);
  const locked = !tryOut && (mode === 'edit' || isOwner || answered !== undefined);
  useEffect(() => {
    if (answered !== undefined) position.value = withTiming(answered, { duration: 450, easing: Easing.out(Easing.cubic) });
  }, [answered, position]);
  const pan = useMemo(() => Gesture.Pan()
    .enabled(!locked)
    .minDistance(0)
    .onBegin((event) => {
      held.value = withSpring(1, SLIDER_SPRING);
      position.value = Math.max(0, Math.min(1, event.x / trackWidth));
      runOnJS(sliderTick)();
    })
    .onUpdate((event) => {
      position.value = Math.max(0, Math.min(1, event.x / trackWidth));
    })
    .onFinalize((_event, success) => {
      held.value = withSpring(0, SLIDER_SPRING);
      if (!success) return;
      burst.value = 0;
      burst.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
      runOnJS(sliderTick)();
      if (!tryOut && onRespond) runOnJS(onRespond)({ value: position.value });
    }), [burst, held, locked, onRespond, position, trackWidth, tryOut]);
  const fillStyle = useAnimatedStyle(() => ({ width: position.value * trackWidth }));
  // The emoji on the track keeps its size and follows the finger.
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * trackWidth - thumbSize / 2 }],
  }));
  // A second emoji floats above the thumb while it is held, bigger the further right.
  const bubbleScale = (value: number) => {
    'worklet';
    return 0.7 + value * 1.8;
  };
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: held.value,
    transform: [
      { translateX: position.value * trackWidth - thumbSize / 2 },
      { translateY: -(70 + position.value * 60) * unit - held.value * 20 * unit },
      { scale: held.value * bubbleScale(position.value) },
    ],
  }));
  // On release that emoji floats up and fades.
  const burstStyle = useAnimatedStyle(() => ({
    opacity: burst.value < 1 ? 1 - burst.value : 0,
    transform: [
      { translateX: position.value * trackWidth - thumbSize / 2 },
      { translateY: -(90 + position.value * 60) * unit - burst.value * 220 * unit },
      { scale: bubbleScale(position.value) * (1 + burst.value * 0.3) },
    ],
  }));
  const average = state?.results?.average;
  return (
    <View style={[styles.card, { width: 680 * unit, borderRadius: 36 * unit, padding: 36 * unit }]}>
      {!!sticker.question && <Text style={[styles.cardTitle, { fontSize: 42 * unit, marginBottom: 28 * unit }]}>{sticker.question}</Text>}
      <GestureDetector gesture={pan}>
        <View style={{ width: trackWidth, height: 80 * unit, justifyContent: 'center', alignSelf: 'center' }}>
          <View style={{ height: 16 * unit, borderRadius: 8 * unit, backgroundColor: '#EFEFEF', overflow: 'hidden' }}>
            <Animated.View style={[{ height: '100%' }, fillStyle]}>
              <LinearGradient colors={gradientFor(sticker.style)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
          </View>
          {typeof average === 'number' ? (
            <Animated.View
              entering={ZoomIn.springify().damping(12)}
              style={{ position: 'absolute', left: average * trackWidth - 18 * unit, width: 36 * unit, height: 36 * unit, borderRadius: 18 * unit, backgroundColor: '#fff', borderWidth: 3 * unit, borderColor: '#999' }}
            />
          ) : null}
          <Animated.View pointerEvents="none" style={[styles.sliderThumb, { width: thumbSize, height: thumbSize }, burstStyle]}>
            <Text style={{ fontSize: 72 * unit }}>{sticker.emoji}</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.sliderThumb, { width: thumbSize, height: thumbSize }, bubbleStyle]}>
            <Text style={{ fontSize: 72 * unit }}>{sticker.emoji}</Text>
          </Animated.View>
          <Animated.View style={[styles.sliderThumb, { width: thumbSize, height: thumbSize }, thumbStyle]}>
            <Text style={{ fontSize: 72 * unit }}>{sticker.emoji}</Text>
          </Animated.View>
        </View>
      </GestureDetector>
      {state?.results && typeof state.results.total === 'number' ? (
        <Text style={[styles.cardMeta, { fontSize: 26 * unit, marginTop: 12 * unit }]}>{state.results.total} {state.results.total === 1 ? 'response' : 'responses'}</Text>
      ) : null}
    </View>
  );
}

/**
 * Frames in the viewer: the photo is in the media, and this covers it until the
 * viewer shakes the phone or taps, then fades away like a print developing.
 */
function FrameCover({ sticker, unit }: { sticker: Extract<InteractiveSticker, { type: 'frame' }>; unit: number }) {
  const box = frameLayout(sticker.width, sticker.height);
  const developed = useSharedValue(0);
  const [started, setStarted] = useState(false);
  const develop = useCallback(() => {
    setStarted((already) => {
      if (!already) developed.value = withTiming(1, { duration: 2400, easing: Easing.in(Easing.quad) });
      return true;
    });
  }, [developed]);
  useEffect(() => (started ? undefined : onShake(develop)), [develop, started]);
  const coverStyle = useAnimatedStyle(() => ({ opacity: 1 - developed.value }));
  return (
    <View pointerEvents="box-none" style={{ width: box.width * unit, height: box.height * unit }}>
      <Animated.View
        pointerEvents={started ? 'none' : 'auto'}
        style={[{ position: 'absolute', left: box.photo.left * unit, top: box.photo.top * unit, width: sticker.width * unit, height: sticker.height * unit, backgroundColor: '#2E2D31', overflow: 'hidden' }, coverStyle]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Develop photo" onPress={develop} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 * unit }}>
          <Ionicons name="phone-portrait-outline" size={70 * unit} color="rgba(255,255,255,0.85)" />
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 34 * unit, fontWeight: '600', textAlign: 'center' }}>Shake or tap{'\n'}to develop</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/**
 * An interactive sticker, drawn the same in the editor and in the viewer.
 * Sizes are in canvas units so the sticker keeps its place and proportion on
 * every screen.
 */
export function StickerView(props: Props) {
  const { sticker, unit, mode, state, isOwner, onRespond, onOpen, timeMs } = props;
  const gradient = gradientFor(sticker.style);
  const viewing = mode === 'view';

  switch (sticker.type) {
    case 'poll':
    case 'quiz': {
      const counts = state?.results?.counts;
      const total = state?.results?.total ?? 0;
      const answered = state?.myResponse?.option;
      const showResults = viewing && (isOwner || answered !== undefined) && counts;
      const correct = sticker.type === 'quiz' ? (state?.results?.correctIndex ?? (mode === 'edit' ? sticker.correctIndex : undefined)) : undefined;
      return (
        <View style={[styles.card, { width: 700 * unit, borderRadius: 36 * unit, overflow: 'hidden' }]}>
          {(sticker.type === 'quiz' || sticker.question) ? (
            <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 30 * unit, paddingHorizontal: 32 * unit }}>
              <Text style={[styles.headerText, { fontSize: 44 * unit }]}>{sticker.question || 'Ask a question…'}</Text>
            </LinearGradient>
          ) : null}
          <View style={{ padding: 24 * unit, gap: 16 * unit }}>
            {sticker.options.map((option, index) => {
              const share = showResults && total ? Math.round((counts![index] / total) * 100) : 0;
              const isCorrect = correct === index;
              const isMine = answered === index;
              const wrong = sticker.type === 'quiz' && isMine && correct !== undefined && !isCorrect;
              return (
                <Pressable
                  key={`${index}-${option}`}
                  disabled={!viewing || isOwner || answered !== undefined}
                  onPress={() => onRespond?.({ option: index })}
                  style={{ minHeight: 88 * unit, borderRadius: 44 * unit, backgroundColor: '#F2F2F2', justifyContent: 'center', overflow: 'hidden' }}
                >
                  {showResults ? (
                    <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${share}%`, backgroundColor: wrong ? '#ED4956' : isCorrect ? '#70C050' : isMine ? gradient[0] : '#DBDBDB', opacity: isMine || isCorrect || wrong ? 0.9 : 1 }} />
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 30 * unit, gap: 16 * unit }}>
                    {sticker.type === 'quiz' ? (
                      <View style={{ width: 48 * unit, height: 48 * unit, borderRadius: 24 * unit, borderWidth: 3 * unit, borderColor: isCorrect && (showResults || mode === 'edit') ? '#70C050' : '#C7C7C7', backgroundColor: isCorrect && (showResults || mode === 'edit') ? '#70C050' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {isCorrect && (showResults || mode === 'edit') ? <Ionicons name="checkmark" size={30 * unit} color="#fff" /> : <Text style={{ fontSize: 26 * unit, fontWeight: '700', color: '#8E8E8E' }}>{String.fromCharCode(65 + index)}</Text>}
                      </View>
                    ) : null}
                    <Text numberOfLines={2} style={{ flex: 1, fontSize: 38 * unit, fontWeight: '700', color: '#262626', textAlign: sticker.type === 'poll' && !showResults ? 'center' : 'left' }}>{option}</Text>
                    {showResults ? <Text style={{ fontSize: 34 * unit, fontWeight: '700', color: '#262626' }}>{share}%</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    }
    case 'question':
      return (
        <Pressable disabled={!viewing} onPress={onOpen} style={[styles.card, { width: 660 * unit, borderRadius: 36 * unit, overflow: 'hidden' }]}>
          <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 34 * unit, paddingHorizontal: 32 * unit }}>
            <Text style={[styles.headerText, { fontSize: 44 * unit }]}>{sticker.prompt}</Text>
          </LinearGradient>
          <View style={{ padding: 26 * unit }}>
            <View style={{ borderRadius: 24 * unit, backgroundColor: '#F2F2F2', paddingVertical: 26 * unit, alignItems: 'center' }}>
              <Text style={{ fontSize: 34 * unit, color: '#8E8E8E' }}>
                {viewing && isOwner ? `${state?.results?.replies ?? 0} replies` : 'Type something…'}
              </Text>
            </View>
          </View>
        </Pressable>
      );
    case 'slider':
      return <Slider {...props} sticker={sticker} />;
    case 'countdown': {
      const ended = Date.parse(sticker.endsAt) <= Date.now();
      return (
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 680 * unit, borderRadius: 36 * unit, padding: 32 * unit, gap: 22 * unit }}>
          <Text style={[styles.headerText, { fontSize: 46 * unit, textAlign: 'center' }]}>{sticker.title}</Text>
          <Countdown endsAt={sticker.endsAt} unit={unit} />
          {viewing && !isOwner && !ended ? (
            <Pressable onPress={() => onRespond?.({ subscribe: !state?.subscribed })} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10 * unit, backgroundColor: state?.subscribed ? 'rgba(255,255,255,0.25)' : '#fff', borderRadius: 32 * unit, paddingHorizontal: 32 * unit, paddingVertical: 14 * unit }}>
              <Ionicons name={state?.subscribed ? 'notifications' : 'notifications-outline'} size={32 * unit} color={state?.subscribed ? '#fff' : gradient[0]} />
              <Text style={{ fontSize: 32 * unit, fontWeight: '700', color: state?.subscribed ? '#fff' : gradient[0] }}>{state?.subscribed ? 'Reminder set' : 'Remind me'}</Text>
            </Pressable>
          ) : null}
          {viewing && isOwner ? <Text style={[styles.headerText, { fontSize: 28 * unit, textAlign: 'center', opacity: 0.9 }]}>{state?.results?.subscribers ?? 0} reminders</Text> : null}
        </LinearGradient>
      );
    }
    case 'gif':
      return <Image source={{ uri: sticker.url }} style={{ width: sticker.width * unit, height: sticker.height * unit }} resizeMode="contain" />;
    case 'frame':
      return viewing ? <FrameCover sticker={sticker} unit={unit} /> : null;
    case 'text':
      return <AnimatedStoryText layer={sticker} unit={unit} />;
    case 'captions': {
      // While editing, the first line shows where the captions sit.
      const segment = timeMs === undefined
        ? sticker.segments[0]
        : sticker.segments.find((entry) => timeMs >= entry.startMs && timeMs < entry.endMs);
      return (
        <View style={{ width: 900 * unit, minHeight: 90 * unit, alignItems: 'center', justifyContent: 'center' }}>
          {segment ? (
            <Text style={{ color: '#fff', fontSize: 50 * unit, fontWeight: '800', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 22 * unit, paddingVertical: 10 * unit, borderRadius: 16 * unit, overflow: 'hidden' }}>
              {segment.text}
            </Text>
          ) : null}
        </View>
      );
    }
    case 'addYours': {
      const count = state?.results?.count ?? 0;
      return (
        <Pressable disabled={!viewing} onPress={onOpen} style={[styles.card, { width: 640 * unit, borderRadius: 36 * unit, paddingVertical: 30 * unit, paddingHorizontal: 34 * unit, alignItems: 'center', gap: 20 * unit }]}>
          <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 * unit, borderRadius: 24 * unit, paddingHorizontal: 22 * unit, paddingVertical: 8 * unit }}>
            <Ionicons name={sticker.music ? 'musical-notes' : 'camera'} size={30 * unit} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 28 * unit, fontWeight: '800' }}>{sticker.music ? 'Add Yours Music' : 'Add Yours'}</Text>
          </LinearGradient>
          <Text style={[styles.cardTitle, { fontSize: 46 * unit }]}>{sticker.prompt}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 * unit }}>
            {viewing ? <Text style={[styles.cardMeta, { fontSize: 28 * unit }]}>{count} {count === 1 ? 'participant' : 'participants'}</Text> : null}
            <View style={{ backgroundColor: gradient[0], borderRadius: 30 * unit, paddingHorizontal: 30 * unit, paddingVertical: 12 * unit }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 30 * unit }}>Add yours</Text>
            </View>
          </View>
        </Pressable>
      );
    }
    case 'reveal':
      // Viewers see the story blurred instead (StoryMedia); the sticker itself is only shown while editing.
      return viewing ? null : (
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 16 * unit, borderRadius: 40 * unit, paddingHorizontal: 34 * unit, paddingVertical: 22 * unit, maxWidth: 900 * unit }}>
          <Ionicons name="eye-off" size={48 * unit} color="#fff" />
          <View style={{ flexShrink: 1 }}>
            <Text style={[styles.headerText, { fontSize: 46 * unit, textAlign: 'left' }]} numberOfLines={1}>{sticker.hint || 'Reveal'}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 28 * unit }}>Blurred until they message you</Text>
          </View>
        </LinearGradient>
      );
    case 'mention':
    case 'hashtag':
    case 'location':
    case 'link': {
      const icon = sticker.type === 'location' ? 'location-sharp' : sticker.type === 'link' ? 'link' : null;
      const label = sticker.type === 'mention' ? `@${sticker.name.replace(/\s+/g, '').toUpperCase()}`
        : sticker.type === 'hashtag' ? `#${sticker.tag.toUpperCase()}`
          : sticker.type === 'location' ? sticker.name.toUpperCase()
            : (sticker.label || sticker.url.replace(/^https?:\/\//, '').replace(/\/$/, '')).toUpperCase();
      const dark = sticker.style === 'dark';
      const colour = sticker.type === 'link' ? '#3897F0' : gradient[0];
      return (
        <Pressable disabled={!viewing} onPress={onOpen} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 * unit, backgroundColor: dark ? '#262626' : '#fff', borderRadius: 22 * unit, paddingHorizontal: 26 * unit, paddingVertical: 16 * unit, maxWidth: 900 * unit }}>
          {icon ? <Ionicons name={icon} size={44 * unit} color={dark ? '#fff' : colour} /> : null}
          <Text numberOfLines={1} style={{ fontSize: 52 * unit, fontWeight: '800', color: dark ? '#fff' : colour, letterSpacing: 0.5 * unit }}>{label}</Text>
        </Pressable>
      );
    }
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 3 },
  cardTitle: { color: '#262626', fontWeight: '700', textAlign: 'center' },
  cardMeta: { color: '#8E8E8E', textAlign: 'center' },
  sliderThumb: { position: 'absolute', left: 0, alignItems: 'center', justifyContent: 'center' },
  headerText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
});
