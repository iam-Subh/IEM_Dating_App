import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { PHOTO_MAX_MS, PHOTO_MIN_MS } from '../composition/types';
import { EDITOR_RAIL_RIGHT, EDITOR_RAIL_WIDTH } from './editorChromeLayout';

export type PhotoDurationControl = {
  value: number;
  musicLocked: boolean;
  onChange: (ms: number) => void;
  onClose: () => void;
};

const CHOICE_WIDTH = 40;
const PILL_MAX_WIDTH = EDITOR_RAIL_WIDTH + CHOICE_WIDTH * 4 + 8;
const CHOICES = Array.from({ length: (PHOTO_MAX_MS - PHOTO_MIN_MS) / 1000 + 1 },
  (_, index) => PHOTO_MIN_MS + index * 1000);

/** The right end stays under the timer button as the left end expands. */
export function PhotoDurationPill({ width, progress, anchorY, scrollY, control, open }: {
  width: number; progress: SharedValue<number>; anchorY: SharedValue<number>;
  scrollY: SharedValue<number>; control: PhotoDurationControl; open: boolean;
}) {
  const row = useRef<ScrollView>(null);
  const maxWidth = Math.max(EDITOR_RAIL_WIDTH, Math.min(PILL_MAX_WIDTH, width - EDITOR_RAIL_RIGHT * 2));
  const choicesWidth = maxWidth - EDITOR_RAIL_WIDTH;
  const wasOpen = useRef(false);
  const centerSelected = useCallback(() => {
    const index = CHOICES.indexOf(control.value);
    const maxOffset = Math.max(0, CHOICES.length * CHOICE_WIDTH + 8 - choicesWidth);
    row.current?.scrollTo({ x: Math.min(maxOffset, Math.max(0, 4 + Math.max(0, index) * CHOICE_WIDTH + CHOICE_WIDTH / 2 - choicesWidth / 2)), animated: false });
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

  return <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[s.pill, pillStyle]}>
    <Animated.View style={[s.content, { width: choicesWidth }, contentStyle]}>
      {control.musicLocked ? <View style={s.musicLength}><Text numberOfLines={1} style={s.musicText}>Music length · {Math.round(control.value / 1000)}s</Text></View>
        : <ScrollView ref={row} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
          contentContainerStyle={s.choices}
          onLayout={centerSelected}>
          {CHOICES.map(ms => <Pressable key={ms} accessibilityRole="button" accessibilityLabel={`${ms / 1000} seconds`}
            accessibilityState={{ selected: control.value === ms }} onPress={() => {
              control.onChange(ms);
              control.onClose();
            }}
            style={({ pressed }) => [s.choice, pressed && s.pressed]}>
            <View style={s.choiceFace}>
              {control.value === ms && <Svg pointerEvents="none" width={36} height={36} style={s.selectionCircle}>
                <Circle cx={18} cy={18} r={18} fill="#F3C1CA" />
              </Svg>}
              <Text style={[s.choiceText, control.value === ms && s.selectedText]}>{ms / 1000}s</Text>
            </View>
          </Pressable>)}
        </ScrollView>}
    </Animated.View>
  </Animated.View>;
}

const s = StyleSheet.create({
  pill: { position: 'absolute', right: EDITOR_RAIL_RIGHT, height: 44, borderRadius: 22, overflow: 'hidden', backgroundColor: '#282628' },
  content: { position: 'absolute', right: EDITOR_RAIL_WIDTH, top: 0, bottom: 0 },
  choices: { paddingHorizontal: 4, alignItems: 'center' },
  choice: { width: CHOICE_WIDTH, height: 44, alignItems: 'center', justifyContent: 'center' },
  choiceFace: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  selectionCircle: { position: 'absolute', left: 0, top: 0 },
  choiceText: { color: '#FFF4F6', fontSize: 12, fontWeight: '600' },
  selectedText: { color: '#332027' },
  pressed: { opacity: 0.65 },
  musicLength: { flex: 1, justifyContent: 'center', paddingHorizontal: 14 },
  musicText: { color: '#FFF4F6', fontSize: 12, fontWeight: '500' },
});
