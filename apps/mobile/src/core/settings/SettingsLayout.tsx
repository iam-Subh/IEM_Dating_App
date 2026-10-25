import React, { useEffect, useState } from 'react';
import { Image, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';

export const settingsPalette = {
  card: '#232323',
  text: '#F6F4F6',
  secondary: '#BDB7C0',
  muted: '#89858B',
  icon: '#C1BDC4',
  accent: '#F3C1CA',
  accentText: '#331C23',
  danger: '#FF8C93',
  dangerSurface: '#3D2729',
  separator: 'rgba(255,255,255,0.07)',
};

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function SettingsPage({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  return <View style={settingsLayout.page}>
    <StatusBar barStyle="light-content" backgroundColor={colors.background} />
    <View style={[settingsLayout.header, { height: insets.top + 52, paddingTop: insets.top }]}>
      <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back"
        style={({ pressed }) => [settingsLayout.back, pressed && settingsLayout.pressed]}>
        <Ionicons name="chevron-back" size={25} color="#FFFFFF" />
      </Pressable>
      <Text style={settingsLayout.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{title}</Text>
      {action ?? <View style={settingsLayout.back} />}
    </View>
    {children}
  </View>;
}

export function SettingsAvatar({ name, uri, inactive = false }: { name: string; uri?: string | null; inactive?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return <View style={[settingsLayout.avatar, inactive && { opacity: 0.45 }]}>
    {uri && !failed ? <Image source={{ uri }} style={StyleSheet.absoluteFill} onError={() => setFailed(true)} accessible={false} />
      : <Text style={settingsLayout.initial}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>}
  </View>;
}

export function SettingsToggle({ value, label, hint, onChange }: { value: boolean; label: string; hint?: string; onChange: (value: boolean) => void }) {
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => { progress.value = withTiming(value ? 1 : 0, { duration: 140 }); }, [value, progress]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(progress.value, [0, 1], ['#4A474B', settingsPalette.accent]) }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: 18 * progress.value }] }));
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ checked: value }}
    onPress={() => onChange(!value)} style={settingsLayout.toggleTouch}>
    <Animated.View style={[settingsLayout.toggleTrack, track]}><Animated.View style={[settingsLayout.toggleThumb, thumb]} /></Animated.View>
  </Pressable>;
}

export function SettingsPersonRow({ name, uri, note, inactive, first, last, children }: {
  name: string; uri?: string | null; note?: string | null; inactive?: boolean; first: boolean; last: boolean; children?: React.ReactNode;
}) {
  return <View style={[settingsLayout.personRow, first && settingsLayout.firstRow, last && settingsLayout.lastRow]}>
    <SettingsAvatar name={name} uri={uri} inactive={inactive} />
    <View style={settingsLayout.personCopy}><Text style={settingsLayout.personName} numberOfLines={2}>{name}</Text>
      {note && <Text style={settingsLayout.personNote}>{note}</Text>}
    </View>
    {children}
  </View>;
}

export function SettingsCard({ title, icon, children, showDividers = true }: { title: string; icon: IconName | React.ReactElement; children: React.ReactNode; showDividers?: boolean }) {
  const rows = React.Children.toArray(children);
  return <View style={settingsLayout.card}>
    <View style={[settingsLayout.cardHeading, !showDividers && {borderBottomWidth: 0}]}>
      {typeof icon === 'string'
        ? <View style={settingsLayout.headingIcon}><Ionicons name={icon} size={18} color={settingsPalette.accent} /></View>
        : icon}
      <Text style={settingsLayout.cardTitle} accessibilityRole="header">{title}</Text>
    </View>
    {rows.map((child, index) => <View key={(React.isValidElement(child) && child.key) || index}
      style={showDividers && index < rows.length - 1 ? settingsLayout.divider : undefined}>{child}</View>)}
  </View>;
}

export function SettingsEmptyState({ icon, title, message, onRetry }: {
  icon: IconName; title: string; message: string; onRetry?: () => void;
}) {
  return <View style={settingsLayout.empty}>
    <View style={settingsLayout.emptyIcon}><Ionicons name={icon} size={27} color={settingsPalette.accent} /></View>
    <Text style={settingsLayout.emptyTitle}>{title}</Text>
    <Text style={settingsLayout.emptyMessage}>{message}</Text>
    {onRetry && <Pressable onPress={onRetry} accessibilityRole="button"
      style={({ pressed }) => [settingsLayout.retryButton, pressed && settingsLayout.pressed]}>
      <Text style={settingsLayout.retryText}>Try again</Text>
    </Pressable>}
  </View>;
}

export const settingsLayout = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  title: { flex: 1, minWidth: 0, color: '#FFFFFF', textAlign: 'center', fontFamily: 'DMSans_700Bold', fontSize: 21 },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  peopleList: { gap: 0 },
  listIntro: { gap: 12, paddingBottom: 14 },
  listHeading: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 15 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3B2B34', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { color: settingsPalette.accent, fontFamily: 'DMSans_700Bold', fontSize: 18 },
  personRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: settingsPalette.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: settingsPalette.separator },
  firstRow: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  lastRow: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, borderBottomWidth: 0 },
  personCopy: { flex: 1, minWidth: 0 },
  personName: { color: settingsPalette.text, fontFamily: 'DMSans_700Bold', fontSize: 14 },
  personNote: { color: settingsPalette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 16, marginTop: 3 },
  personAction: { minHeight: 44, minWidth: 84, paddingHorizontal: 12, borderRadius: 22, backgroundColor: settingsPalette.accent, alignItems: 'center', justifyContent: 'center' },
  personActionText: { color: settingsPalette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 12 },
  personSecondary: { backgroundColor: '#3A3337' },
  personSecondaryText: { color: settingsPalette.text },
  search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: settingsPalette.card, borderRadius: 24, paddingHorizontal: 14 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, color: '#FFFFFF', fontFamily: 'DMSans_400Regular', fontSize: 14, paddingVertical: 8 },
  toggleTouch: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  toggleTrack: { width: 40, height: 22, borderRadius: 11, padding: 2 },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF' },
  intro: { color: settingsPalette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: settingsPalette.card, borderRadius: 18, paddingHorizontal: 14, paddingTop: 12, overflow: 'hidden' },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: settingsPalette.separator },
  headingIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2D2B2D' },
  cardTitle: { flex: 1, color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 16 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: settingsPalette.separator },
  pressed: { opacity: 0.7 },
  loading: { paddingTop: 44, alignItems: 'center', gap: 10 },
  empty: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 44, paddingBottom: 20 },
  emptyIcon: { width: 60, height: 60, borderRadius: 22, backgroundColor: settingsPalette.card, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 19, textAlign: 'center' },
  emptyMessage: { maxWidth: 300, color: settingsPalette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  retryButton: { minHeight: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: settingsPalette.accent, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  retryText: { color: settingsPalette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 14 },
});
