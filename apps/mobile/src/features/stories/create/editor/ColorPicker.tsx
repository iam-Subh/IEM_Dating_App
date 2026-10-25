import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { STORY_COLORS } from '../fonts';
import { DrawToolIcon } from './DrawToolIcon';

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((value) => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const SPECTRUM = Array.from({ length: 13 }, (_, index) => hslToHex(index * 30, 100, 50));

/**
 * Instagram's colour row: tap a swatch, or press and hold one to slide along
 * the full spectrum and pick any colour.
 */
export function ColorPicker({ value, onChange, onEyedropper, compact = false }: {
  value: string; onChange: (colour: string) => void; onEyedropper?: () => void; compact?: boolean;
}) {
  const [spectrum, setSpectrum] = useState(false);
  const [width, setWidth] = useState(1);

  const pick = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      const hue = Math.max(0, Math.min(359, (event.x / width) * 360));
      runOnJS(onChange)(hslToHex(hue, 100, 50));
    })
    .onUpdate((event) => {
      const hue = Math.max(0, Math.min(359, (event.x / width) * 360));
      // Towards the bottom of the bar the colour darkens, towards the top it lightens.
      const lightness = Math.max(15, Math.min(90, 50 - (event.y / (compact ? 32 : 44)) * 20));
      runOnJS(onChange)(hslToHex(hue, 100, lightness));
    })
    .onFinalize(() => {
      runOnJS(setSpectrum)(false);
    }), [compact, onChange, width]);

  if (spectrum) {
    return (
      <GestureDetector gesture={pick}>
        <View style={[styles.spectrumWrap, compact && styles.compactRow]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          <LinearGradient colors={SPECTRUM as unknown as [string, string, ...string[]]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[styles.spectrum, compact && styles.compactSpectrum]} />
        </View>
      </GestureDetector>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={compact && styles.compactScroll}
      contentContainerStyle={[styles.row, compact && styles.compactRow]} keyboardShouldPersistTaps="always">
      {onEyedropper ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Pick a colour from the story" onPress={onEyedropper} hitSlop={4} style={[styles.dropper, compact && styles.compactDropper]}>
          <DrawToolIcon name="pipette" size={compact ? 16 : 20} color="#332027" />
        </Pressable>
      ) : null}
      {STORY_COLORS.map((colour) => (
        <Pressable
          key={colour}
          accessibilityRole="button"
          accessibilityLabel={`Colour ${colour}`}
          onPress={() => onChange(colour)}
          onLongPress={() => setSpectrum(true)}
          delayLongPress={350}
          hitSlop={4}
          style={[styles.swatch, compact && styles.compactSwatch, { backgroundColor: colour },
            value.toUpperCase() === colour && (compact ? styles.compactSelected : styles.selected)]}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, gap: 10, alignItems: 'center', height: 48 },
  dropper: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#fff' },
  selected: { transform: [{ scale: 1.25 }], borderWidth: 3 },
  spectrumWrap: { height: 48, justifyContent: 'center', paddingHorizontal: 16 },
  spectrum: { height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#fff' },
  compactScroll: { height: 32, flexGrow: 0 },
  compactRow: { height: 32, paddingHorizontal: 8, gap: 8 },
  compactDropper: { width: 24, height: 24, borderRadius: 12 },
  compactSwatch: { width: 20, height: 20, borderRadius: 10 },
  compactSelected: { transform: [{ scale: 1.2 }], borderWidth: 2 },
  compactSpectrum: { height: 22, borderRadius: 11 },
});
