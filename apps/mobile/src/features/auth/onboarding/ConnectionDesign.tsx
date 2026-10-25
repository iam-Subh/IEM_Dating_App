import React, {useRef} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import type {PressableProps, StyleProp, ViewStyle} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

export const connectionColors = {canvas: '#F2F3EE', text: '#352335', muted: '#715365', primary: '#712C48', wash: '#EEDDE3', line: '#DDD4D7'};

// Commit a choice after release. A drag cannot change an answer.
export function TapChoice({onPress, ...props}: Omit<PressableProps, 'onPress'> & {onPress: () => void}) {
  const touch = useRef<{x: number; y: number; moved: boolean} | null>(null);
  return <Pressable {...props} unstable_pressDelay={0}
    onTouchStart={event => {const {pageX, pageY} = event.nativeEvent; touch.current = {x: pageX, y: pageY, moved: false};}}
    onTouchMove={event => {const start = touch.current; if (start && Math.hypot(event.nativeEvent.pageX - start.x, event.nativeEvent.pageY - start.y) > 8) start.moved = true;}}
    onTouchCancel={() => {touch.current = null;}}
    onPress={() => {const moved = touch.current?.moved; touch.current = null; if (!moved) onPress();}}/>;
}

export function RoundedTick({size = 17, color = '#FFFFFF'}: {size?: number; color?: string}) {
  // Keep selection marks out of SVG's synchronous layout events during screen mounts.
  const stroke = size / 8;
  return <View accessible={false} pointerEvents="none" style={{width: size, height: size}}>
    <View style={{position: 'absolute', left: size * 0.16, top: size * 0.54, width: size * 0.34, height: stroke, borderRadius: stroke / 2, backgroundColor: color, transform: [{rotate: '45deg'}]}}/>
    <View style={{position: 'absolute', left: size * 0.35, top: size * 0.43, width: size * 0.59, height: stroke, borderRadius: stroke / 2, backgroundColor: color, transform: [{rotate: '-51deg'}]}}/>
  </View>;
}

export function ConnectionNav({onBack, onSkip, busy, stage = 3}: {onBack: () => void; onSkip?: () => void; busy: boolean; stage?: number}) {
  const insets = useSafeAreaInsets();
  return <View style={[connectionStyles.nav, {paddingTop: insets.top + 8}]}>
    <TapChoice accessibilityRole="button" accessibilityLabel="Back" disabled={busy} onPress={onBack} style={({pressed}) => [connectionStyles.back, pressed && connectionStyles.pressed]}><Ionicons name="arrow-back" size={22} color={connectionColors.text}/></TapChoice>
    <View accessibilityLabel={`Stage ${stage} of 4`} style={connectionStyles.progress}>{[0, 1, 2, 3].map(index => <View key={index} style={[connectionStyles.progressLine, index < stage && {backgroundColor: connectionColors.primary}]}/>)}</View>
    {onSkip ? <TapChoice accessibilityRole="button" accessibilityLabel="Skip this step" disabled={busy} onPress={onSkip} style={({pressed}) => [connectionStyles.skip, pressed && connectionStyles.pressed]}><Text style={connectionStyles.link}>Skip</Text></TapChoice> : <View style={{width: 44}}/>}
  </View>;
}

export function ConnectionFooter({onNext, disabled, busy, error, label, dark = false}: {onNext: () => void; disabled: boolean; busy: boolean; error: string; label: string; dark?: boolean}) {
  const insets = useSafeAreaInsets();
  return <View style={[connectionStyles.footer, dark && {backgroundColor: '#100F0D'}, {paddingBottom: Math.max(insets.bottom, 16) + 16}]}>
    {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[connectionStyles.error, dark && {color: '#FFAFBA'}]}>{error}</Text>}
    <TapChoice accessibilityRole="button" accessibilityLabel={dark ? 'Save changes' : label} accessibilityState={{disabled: disabled || busy, busy}} disabled={disabled || busy} onPress={onNext} style={({pressed}) => [connectionStyles.next, dark && {backgroundColor: '#F3C1CA'}, (disabled || busy) && {opacity: 0.45}, pressed && connectionStyles.pressed]}>
      {busy ? <ActivityIndicator color={dark ? '#331C23' : '#FFFFFF'}/> : <Text style={[connectionStyles.nextText, dark && {color: '#331C23'}]}>{label}</Text>}
    </TapChoice>
  </View>;
}

export function ConnectionSheetHeader({title, onClose, style, dark = false, compact = false}: {title: string; onClose: () => void; style?: StyleProp<ViewStyle>; dark?: boolean; compact?: boolean}) {
  return <View style={[connectionStyles.sheetHeader, style]}>
    <Text accessibilityRole="header" style={[connectionStyles.sheetTitle, dark && {color: '#FAF7F2'}]}>{title}</Text>
    <TapChoice accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={compact ? 4 : undefined} style={({pressed}) => [connectionStyles.close, compact && {width: 36, height: 36, borderRadius: 18}, dark && {backgroundColor: '#3B2933'}, pressed && connectionStyles.pressed]}><Ionicons name="close" size={22} color={dark ? '#FAF7F2' : connectionColors.text}/></TapChoice>
  </View>;
}

export const connectionStyles = StyleSheet.create({
  page: {flex: 1, backgroundColor: connectionColors.canvas},
  nav: {paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  back: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  skip: {minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'},
  progress: {flexDirection: 'row', gap: 4, width: 92},
  progressLine: {flex: 1, height: 3, borderRadius: 2, backgroundColor: '#E2D8D1'},
  link: {fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 20, color: connectionColors.primary},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 38, lineHeight: 48, paddingBottom: 4, color: connectionColors.text},
  subtitle: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: connectionColors.muted},
  footer: {paddingHorizontal: 24, paddingTop: 12, backgroundColor: connectionColors.canvas},
  next: {alignSelf: 'center', minWidth: 132, minHeight: 50, paddingHorizontal: 28, borderRadius: 25, backgroundColor: connectionColors.primary, alignItems: 'center', justifyContent: 'center'},
  nextText: {fontFamily: 'DMSans_500Medium', fontSize: 17, color: '#FFFFFF'},
  error: {fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, color: '#AE2646', textAlign: 'center', marginBottom: 10},
  pressed: {opacity: 0.65},
  sheetContent: {paddingHorizontal: 24, paddingTop: 22},
  sheetHeader: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18},
  sheetTitle: {flex: 1, fontFamily: 'DMSans_700Bold', fontSize: 22, lineHeight: 30, color: connectionColors.text},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: connectionColors.wash, alignItems: 'center', justifyContent: 'center'},
});
