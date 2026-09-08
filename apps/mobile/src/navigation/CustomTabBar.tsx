import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../core/theme/colors';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

const { width } = Dimensions.get('window');

const LABELS: Record<string, string> = {
  Dashboard: 'EXPLORE',
  Search: 'SEARCH',
  Matches: 'MATCHES',
  Chats: 'CHATS',
  Profile: 'PROFILE',
};

export const CustomTabBar = ({ state, descriptors, navigation }: BottomTabBarProps) => {
  return (
    <View style={styles.container} pointerEvents="box-none">
      
      {/* 1. LAYER ONE: The Glass Background */}
      {/* Apply the BlurView directly as the container, and use the dimezis engine for Android */}
      <BlurView 
        intensity={80} 
        tint="dark" 
        experimentalBlurMethod="dimezisBlurView" // CRITICAL FOR ANDROID BLUR
        style={styles.glassBackground}
      >
        <View style={styles.glassBorder} />
      </BlurView>

      {/* 2. LAYER TWO: The Buttons */}
      <View style={styles.content} pointerEvents="box-none">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
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
                <View accessible={false} style={styles.centerGlow} />
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={LABELS[route.name] || route.name}
                  accessibilityHint="Opens the Matches tab"
                  accessibilityState={{ selected: isFocused }}
                  onPress={onPress}
                  style={styles.centerButton}
                  activeOpacity={0.9}
                >
                  <LinearGradient
                    colors={[colors.primary, '#FF1493']} 
                    style={styles.centerGradient}
                  >
                     <MaterialCommunityIcons name="diamond-stone" size={26} color="#FFF" />
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    height: 70,
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glassBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: width - 32,
    maxWidth: 400,
    borderRadius: 35,
    overflow: 'hidden', 
    // Removed the background color so it doesn't block the native blur sampler
  },
  glassBorder: {
    ...StyleSheet.absoluteFill,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)', 
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: width - 32,
    maxWidth: 400,
    height: 70,
    paddingHorizontal: 12,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 4,
  },
  tabLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  centerButtonContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    top: -24, 
  },
  centerGlow: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FF1493', 
    shadowColor: '#FF1493',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 20,
  },
  centerButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  centerGradient: {
    flex: 1,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
