import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../../core/theme/colors';

const { width, height } = Dimensions.get('window');

interface Props {
  children: React.ReactNode;
  style?: any;
}

export const MeshGradientBackground = ({ children, style }: Props) => {
  return (
    <View style={[styles.container, style]}>
      {/* Base Dark Background */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
      
      {/* Top Left Subtle Purple Gradient */}
      <View style={styles.topLeftGradient}>
        <LinearGradient
          colors={['rgba(88, 28, 135, 0.25)', 'rgba(88, 28, 135, 0)']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </View>

      {/* Bottom Right Subtle Blue Gradient */}
      <View style={styles.bottomRightGradient}>
        <LinearGradient
          colors={['rgba(30, 58, 138, 0.25)', 'transparent']}
          start={{ x: 1, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topLeftGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: width * 0.8,
    height: height * 0.5,
    opacity: 0.6,
  },
  bottomRightGradient: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: width * 0.8,
    height: height * 0.5,
    opacity: 0.6,
  },
  content: {
    flex: 1,
    zIndex: 1,
  },
});
