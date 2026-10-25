import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions, Platform, UIManager } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  LiquidGlassView,
  useGlassSupport,
} from 'react-native-liquid-glassmorphism';

const hasLiquidGlassNativeView = Platform.OS !== 'web'
  && !!UIManager.getViewManagerConfig?.('LiquidGlassmorphismView');

// Author the path at its actual display width. Stretching a fixed-width path
// turns the circular ends into ellipses on narrow screens.
const GLASS_MARGIN = 4;
const createGlassShape = (width: number) => ({
  type: 'path' as const,
  width: width + GLASS_MARGIN * 2,
  height: 84 + GLASS_MARGIN * 2,
  d: [
    'M 31 22',
    `L ${width / 2 - 55} 22`,
    `C ${width / 2 - 40} 22 ${width / 2 - 35} 20 ${width / 2 - 25} 10`,
    `C ${width / 2 - 18} 3 ${width / 2 - 10} 0 ${width / 2} 0`,
    `C ${width / 2 + 10} 0 ${width / 2 + 18} 3 ${width / 2 + 25} 10`,
    `C ${width / 2 + 35} 20 ${width / 2 + 40} 22 ${width / 2 + 55} 22`,
    `L ${width - 31} 22`,
    `C ${width - 13.879} 22 ${width} 35.879 ${width} 53`,
    `C ${width} 70.121 ${width - 13.879} 84 ${width - 31} 84`,
    'L 31 84',
    'C 13.879 84 0 70.121 0 53',
    'C 0 35.879 13.879 22 31 22',
    'Z',
  // All commands use absolute coordinates. Inset the entire contour so the
  // native blur and mask have room beyond every edge, including the bottom.
  ].join(' ').replace(/-?\d+(?:\.\d+)?/g, value => String(Number(value) + GLASS_MARGIN)),
});

const LABELS: Record<string, string> = {
  Dashboard: 'EXPLORE',
  Search: 'SEARCH',
  Matches: 'Connections',
  Chats: 'CHATS',
  Profile: 'PROFILE',
};

export const CustomTabBar = ({ state, navigation }: BottomTabBarProps) => {
  const { width } = useWindowDimensions();
  const isFocused = useIsFocused();
  const barWidth = Math.min(width - 32, 400);
  const glassShape = React.useMemo(() => createGlassShape(barWidth), [barWidth]);
  const glass = useGlassSupport();
  const rendersLiquidGlass = hasLiquidGlassNativeView
    && (glass.tier === 'glass' || glass.tier === 'refraction');

  // Native capture is scoped to MainTabNavigator. Keep the same material and
  // controls mounted beneath root-stack screens throughout their transitions.

  const tabContent = (
      <View style={[styles.content, rendersLiquidGlass && { left: GLASS_MARGIN, bottom: GLASS_MARGIN, width: barWidth }]} pointerEvents="box-none">
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const isCenter = index === Math.floor(state.routes.length / 2);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          if (isCenter) {
            return (
              <View key={route.key} style={styles.centerButtonContainer} pointerEvents="box-none">
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={LABELS[route.name] || route.name}
                  accessibilityHint="Opens your matches and likes"
                  accessibilityState={{ selected: isFocused }}
                  onPress={onPress}
                  style={styles.centerButton}
                  activeOpacity={0.9}
                >
                  <LinearGradient
                    colors={['#FF5A5F', '#E0484D']}
                    style={styles.centerGradient}
                  >
                     <MaterialCommunityIcons name={isFocused ? 'heart-multiple' : 'heart-multiple-outline'} size={28} color="#FFF" />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            );
          }

          let iconName: keyof typeof Ionicons.glyphMap = 'help-circle-outline';
          if (route.name === 'Dashboard') iconName = isFocused ? 'home' : 'home-outline';
          if (route.name === 'Search') iconName = isFocused ? 'search' : 'search-outline';
          if (route.name === 'Chats') iconName = isFocused ? 'chatbubble' : 'chatbubble-outline';
          if (route.name === 'Profile') iconName = isFocused ? 'person' : 'person-outline';

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityLabel={LABELS[route.name] || route.name}
              accessibilityHint={`Opens the ${LABELS[route.name] || route.name} tab`}
              accessibilityState={{ selected: isFocused }}
              onPress={onPress}
              style={styles.tabButton}
            >
              <Ionicons 
                name={iconName} 
                size={24} 
                color={isFocused ? '#FFF' : '#A1A1AA'} 
              />
              <Text style={[styles.tabLabel, { color: isFocused ? '#FFF' : '#A1A1AA' }]}>
                {LABELS[route.name] || route.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
  );

  return (
    <View style={[styles.container, { width: barWidth, left: (width - barWidth) / 2 }]} pointerEvents={isFocused ? 'box-none' : 'none'} accessibilityElementsHidden={!isFocused} importantForAccessibility={isFocused ? 'auto' : 'no-hide-descendants'}>
      {rendersLiquidGlass ? (
        <LiquidGlassView
          accessibilityMode="auto"
          variant="clear"
          shape={glassShape}
          tintColor="rgba(24,24,24,0.28)"
          blurRadius={8}
          refraction
          rim={false}
          specular={false}
          thickness={1.1}
          edgeReflectionStrength={0}
          legibilityFloor={0.12}
          brightness={1}
          magnification={1}
          ior={1.5}
          style={[styles.materialLayer, { width: glassShape.width, height: glassShape.height }]}
        >
          <Svg pointerEvents="none" width="100%" height="100%" viewBox={`0 0 ${glassShape.width} ${glassShape.height}`} style={StyleSheet.absoluteFill}>
            <Path d={glassShape.d} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={0.6} />
          </Svg>
          {tabContent}
        </LiquidGlassView>
      ) : (
        <>
          <BlurView intensity={48} tint="dark" blurMethod="dimezisBlurView" style={styles.glassBackground}>
            <View style={styles.glassBorder} />
          </BlurView>
          <BlurView intensity={48} tint="dark" blurMethod="dimezisBlurView" style={styles.centerGlassBulge}>
            <View style={styles.centerGlassBorder} />
          </BlurView>
          {tabContent}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 14,
    height: 84,
    zIndex: 10,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  glassBackground: {
    position: 'absolute',
    top: 22,
    bottom: 0,
    left: 0,
    right: 0,
    width: '100%',
    maxWidth: 400,
    borderRadius: 31,
    overflow: 'hidden', 
  },
  materialLayer: {
    position: 'absolute',
    left: -GLASS_MARGIN,
    top: -GLASS_MARGIN,
  },
  centerGlassBulge: {
    position: 'absolute',
    top: 0,
    left: '50%',
    marginLeft: -33,
    width: 66,
    height: 66,
    borderRadius: 33,
    overflow: 'hidden',
  },
  glassBorder: {
    ...StyleSheet.absoluteFill,
    borderRadius: 31,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.11)',
  },
  centerGlassBorder: {
    ...StyleSheet.absoluteFill,
    borderRadius: 33,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  content: {
    position: 'absolute',
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 400,
    height: 84,
    paddingHorizontal: 12,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 62,
    gap: 4,
  },
  tabLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  centerButtonContainer: {
    flex: 1,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    top: -22,
  },
  centerButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    // Foreground controls must not cast a halo into the glass capture.
    elevation: 0,
  },
  centerGradient: {
    flex: 1,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
