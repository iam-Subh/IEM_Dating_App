import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { profileIntentionDesign } from './profileIntentionDesign';

export function ProfileIntentionCard({ value }: { value?: string | null }) {
  const intention = value?.trim();
  if (!intention) return null;
  const design = profileIntentionDesign(intention);
  const singleLine = design.id === 'short-flexible' || design.id === 'long-flexible';
  return <LinearGradient colors={design.colors} locations={[0, 0.6, 1]}
    start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={s.card}>
    <View style={s.copy}>
      <View style={s.heading}>
        <Ionicons accessible={false} name={design.icon} size={14} color={design.accent} />
        <Text style={[s.label, { color: design.label }]}>LOOKING FOR</Text>
      </View>
      <Text style={s.value} numberOfLines={singleLine ? 1 : undefined}
        adjustsFontSizeToFit={singleLine} minimumFontScale={0.8}>{intention}</Text>
    </View>
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.art, singleLine && s.headerArt]}>
      <Ionicons name={design.largeIcon} size={singleLine ? 24 : 36} color={design.accent} style={s.symbolLarge} />
      <Ionicons name={design.smallIcon} size={singleLine ? 16 : 23} color={design.accent}
        style={[s.symbolSmall, (design.id === 'partner' || design.id === 'friends') && s.linkedSymbol]} />
      {design.id === 'fun' && <>
        <View style={[s.confetti, s.confettiLeft, { backgroundColor: design.accent }]} />
        <View style={[s.confetti, s.confettiTop, { backgroundColor: design.accent }]} />
        <View style={[s.confetti, s.confettiRight, { backgroundColor: design.accent }]} />
      </>}
    </View>
  </LinearGradient>;
}

const s = StyleSheet.create({
  card: { borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden' },
  copy: { flex: 1, minWidth: 0 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  art: { width: 60, height: 40 },
  headerArt: { position: 'absolute', right: 16, top: 10, width: 44, height: 22 },
  symbolLarge: { position: 'absolute', right: 0, top: -2, opacity: 0.32, transform: [{ rotate: '-18deg' }] },
  symbolSmall: { position: 'absolute', left: 0, bottom: -2, opacity: 0.65, transform: [{ rotate: '18deg' }] },
  linkedSymbol: { left: 8, bottom: 0 },
  confetti: { position: 'absolute', width: 3, height: 6, borderRadius: 1, opacity: 0.55 },
  confettiLeft: { left: 4, top: 2, transform: [{ rotate: '-30deg' }] },
  confettiTop: { left: 19, top: -3, transform: [{ rotate: '20deg' }] },
  confettiRight: { right: 0, bottom: 0, transform: [{ rotate: '35deg' }] },
  label: { fontFamily: 'DMSans_700Bold', fontSize: 11, letterSpacing: 1.1, color: '#E0B9C4' },
  value: { marginTop: 5, fontFamily: 'DMSans_700Bold', fontSize: 18, lineHeight: 25, color: '#FFF4F6' },
});
