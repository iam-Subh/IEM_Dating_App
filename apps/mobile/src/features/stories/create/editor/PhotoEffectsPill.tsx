import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, Image as SvgImage } from 'react-native-svg';
import type { PhotoEffect } from '../../../../../modules/chat-media';
import { PHOTO_EFFECTS } from '../camera/boomerang';
import { EDITOR_RAIL_RIGHT, EDITOR_RAIL_WIDTH } from './editorChromeLayout';

export type PhotoEffectsControl = {
  value: PhotoEffect | 'none';
  baseUri: string;
  previews: Record<string, { uri: string; ok: boolean }>;
  busy: boolean;
  onChange: (effect: PhotoEffect | 'none') => void;
  onClose: () => void;
};

const CHOICE_WIDTH = 44;
const MAX_WIDTH = EDITOR_RAIL_WIDTH + CHOICE_WIDTH * 4 + 8;
const SHORT_NAMES: Record<string, string> = { none: 'OR', blur: 'BL', mono: 'BW', studio: 'ST' };

export function PhotoEffectsPill({ width, progress, anchorY, scrollY, control, open, onHint }: {
  width: number; progress: SharedValue<number>; anchorY: SharedValue<number>; scrollY: SharedValue<number>;
  control: PhotoEffectsControl; open: boolean; onHint: (name: string) => void;
}) {
  const row = useRef<ScrollView>(null);
  const wasOpen = useRef(false);
  const [picked, setPicked] = useState(control.value);
  useEffect(() => {
    if (open) setPicked(control.value);
  }, [control.value, open]);
  const maxWidth = Math.max(EDITOR_RAIL_WIDTH, Math.min(MAX_WIDTH, width - EDITOR_RAIL_RIGHT * 2));
  const choicesWidth = maxWidth - EDITOR_RAIL_WIDTH;
  const centerSelected = useCallback(() => {
    const index = Math.max(0, PHOTO_EFFECTS.findIndex(entry => entry.id === control.value));
    const maxOffset = Math.max(0, PHOTO_EFFECTS.length * CHOICE_WIDTH + 8 - choicesWidth);
    row.current?.scrollTo({ x: Math.min(maxOffset, Math.max(0, 4 + index * CHOICE_WIDTH + CHOICE_WIDTH / 2 - choicesWidth / 2)), animated: false });
  }, [choicesWidth, control.value]);
  useEffect(() => {
    if (open && !wasOpen.current) centerSelected();
    wasOpen.current = open;
  }, [centerSelected, open]);
  const pillStyle = useAnimatedStyle(() => ({
    top: 8 + anchorY.value - scrollY.value,
    width: EDITOR_RAIL_WIDTH + (maxWidth - EDITOR_RAIL_WIDTH) * progress.value,
    opacity: progress.value > 0 ? 1 : 0,
  }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, progress.value * 2) }));

  return <Animated.View pointerEvents={open && !control.busy ? 'auto' : 'none'} style={[s.pill, pillStyle]}>
    <Animated.View style={[s.content, { width: choicesWidth }, contentStyle]}>
      <ScrollView ref={row} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
        contentContainerStyle={s.choices} onLayout={centerSelected}>
        {PHOTO_EFFECTS.map(entry => {
          const thumb = control.previews[entry.id];
          const selected = picked === entry.id;
          return <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={entry.name}
            accessibilityState={{ selected, disabled: control.busy }} disabled={control.busy}
            onPress={() => { setPicked(entry.id); control.onChange(entry.id); control.onClose(); }}
            onLongPress={() => onHint(entry.name)} delayLongPress={350}
            style={({ pressed }) => [s.choice, pressed && s.pressed]}>
            <View style={s.face}>
              <Svg pointerEvents="none" width={36} height={36}>
                <Defs><ClipPath id={`effect-${entry.id}`}><Circle cx={18} cy={18} r={15} /></ClipPath></Defs>
                <SvgImage href={{ uri: thumb?.uri ?? control.baseUri }} width={36} height={36}
                  preserveAspectRatio="xMidYMid slice" clipPath={`url(#effect-${entry.id})`} />
                <Circle cx={18} cy={18} r={17} fill="none" stroke={selected ? '#F3C1CA' : '#534A4E'} strokeWidth={2} />
              </Svg>
              {(!thumb || !thumb.ok) && <View pointerEvents="none" style={s.fallback}>
                <Text style={s.fallbackText}>{entry.emoji ?? SHORT_NAMES[entry.id]}</Text>
              </View>}
            </View>
          </Pressable>;
        })}
      </ScrollView>
    </Animated.View>
  </Animated.View>;
}

const s = StyleSheet.create({
  pill: { position: 'absolute', right: EDITOR_RAIL_RIGHT, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: '#282628' },
  content: { position: 'absolute', right: EDITOR_RAIL_WIDTH, top: 0, bottom: 0 },
  choices: { paddingHorizontal: 4, alignItems: 'center' },
  choice: { width: CHOICE_WIDTH, height: 44, alignItems: 'center', justifyContent: 'center' },
  face: { width: 36, height: 36 },
  fallback: { position: 'absolute', left: 5, right: 5, top: 8, bottom: 8, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: '#FFF4F6', fontSize: 11, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});
