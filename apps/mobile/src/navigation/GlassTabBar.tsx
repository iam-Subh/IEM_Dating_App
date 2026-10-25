import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { GlassSurface, hasGlassSurface } from '../../modules/glass-surface';
import { CustomTabBar } from './CustomTabBar';

const labels: Record<string, string> = { Dashboard: 'EXPLORE', Search: 'SEARCH', Matches: 'Connections', Chats: 'CHATS', Profile: 'PROFILE' };
const icons: Record<string, [React.ComponentProps<typeof Ionicons>['name'], React.ComponentProps<typeof Ionicons>['name']]> = {
  Dashboard: ['home-outline', 'home'], Search: ['search-outline', 'search'],
  Chats: ['chatbubble-outline', 'chatbubble'], Profile: ['person-outline', 'person'],
};

/** Independent Android hardware material; the original iOS bar remains intact. */
export function GlassTabBar(props: BottomTabBarProps) {
  if (Platform.OS === 'ios') return <CustomTabBar {...props} />;
  return <AndroidGlassTabBar {...props} />;
}

function AndroidGlassTabBar({ state, navigation }: BottomTabBarProps) {
  const { width } = useWindowDimensions();
  const focused = useIsFocused();
  const [reduceTransparency, setReduceTransparency] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (active) setReduceTransparency(value); });
    const listener = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => { active = false; listener.remove(); };
  }, []);
  const barWidth = Math.min(width - 32, 400);
  const controls = <View style={styles.controls} pointerEvents="box-none">
    {state.routes.map((route, index) => {
      const selected = index === state.index;
      const center = route.name === 'Matches';
      const press = () => {
        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (!selected && !event.defaultPrevented) navigation.navigate(route.name);
      };
      return <TouchableOpacity key={route.key} accessibilityRole="tab"
        accessibilityLabel={labels[route.name] ?? route.name} accessibilityState={{ selected }}
        onPress={press} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
        activeOpacity={0.9} style={[styles.button, center && styles.center]}>
        {center ? <LinearGradient colors={['#FF5A5F', '#E0484D']} style={styles.diamond}>
          <MaterialCommunityIcons name={selected ? 'heart-multiple' : 'heart-multiple-outline'} size={28} color="#fff" />
        </LinearGradient> : <>
          <Ionicons name={(icons[route.name] ?? ['help-circle-outline', 'help-circle'])[selected ? 1 : 0]} size={24} color={selected ? '#fff' : '#A1A1AA'} />
          <Text style={[styles.label, { color: selected ? '#fff' : '#A1A1AA' }]}>{labels[route.name] ?? route.name}</Text>
        </>}
      </TouchableOpacity>;
    })}
  </View>;
  return <View style={[styles.container, { width: barWidth, left: (width - barWidth) / 2 }]}
    pointerEvents={focused ? 'box-none' : 'none'} accessibilityElementsHidden={!focused}
    importantForAccessibility={focused ? 'auto' : 'no-hide-descendants'}>
    {hasGlassSurface ? <GlassSurface style={styles.surface} reduceTransparency={reduceTransparency}>
      {controls}
    </GlassSurface> : <>
      <BlurView intensity={48} tint="dark" blurMethod="dimezisBlurView" style={styles.frost} />
      <View style={styles.bulge} />
      {controls}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  container: { position: 'absolute', bottom: 14, height: 84, zIndex: 10 },
  surface: { ...StyleSheet.absoluteFill },
  controls: { ...StyleSheet.absoluteFill, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12 },
  button: { flex: 1, height: 62, alignItems: 'center', justifyContent: 'center', gap: 4 },
  center: { top: -22 },
  diamond: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  frost: { position: 'absolute', top: 22, bottom: 0, left: 0, right: 0, borderRadius: 31, overflow: 'hidden', backgroundColor: 'rgba(28,28,28,0.86)' },
  bulge: { position: 'absolute', top: 0, left: '50%', marginLeft: -33, width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(28,28,28,0.92)' },
});
