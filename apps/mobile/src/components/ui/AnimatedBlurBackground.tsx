import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

// Blob definitions with LinearGradient for the "V" shape glow
const blobs = [
  // 1. Ambient Crimson
  { colors: ['#FF2A2A', 'rgba(255,42,42,0)'] as [string, string, ...string[]], start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, size: width * 1.6, top: -height * 0.1, left: -width * 0.3, duration: 17000 },
  // 2. Magenta Shift
  { colors: ['#FF33A1', 'rgba(255,51,161,0)'] as [string, string, ...string[]], start: { x: 1, y: 0 }, end: { x: 0, y: 1 }, size: width * 1.4, top: height * 0.15, left: width * 0.1, duration: 13000 },
  // 3. The Glowing Core (White/Peach)
  { colors: ['#FFFFFF', '#FFE5D9', 'rgba(255,229,217,0)'] as [string, string, ...string[]], start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 }, size: width * 1.1, top: 0, left: width * 0.2, duration: 11000 },
  // 4. The Light Fold (Stretched oval)
  { colors: ['#FFFFFF', 'rgba(255,255,255,0)'] as [string, string, ...string[]], start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 }, size: width * 1.8, top: height * 0.1, left: -width * 0.2, duration: 19000 },
];

export const AnimatedBlurBackground: React.FC = () => {
  // Animation values for each blob
  const anim1 = useRef(new Animated.Value(0)).current;
  const anim2 = useRef(new Animated.Value(0)).current;
  const anim3 = useRef(new Animated.Value(0)).current;
  const anim4 = useRef(new Animated.Value(0)).current;

  // Create infinite loops for each blob
  useEffect(() => {
    const createLoop = (anim: Animated.Value, duration: number) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: duration,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: duration,
            useNativeDriver: true,
          }),
        ])
      ).start();
    };

    createLoop(anim1, blobs[0].duration);
    createLoop(anim2, blobs[1].duration);
    createLoop(anim3, blobs[2].duration);
    createLoop(anim4, blobs[3].duration);
  }, [anim1, anim2, anim3, anim4]);

  // Interpolations for movement and scaling
  const getTransform = (anim: Animated.Value, index: number) => {
    // Generate organic motion path depending on index
    const translateX = anim.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0, index % 2 === 0 ? 60 : -50, 0],
    });
    const translateY = anim.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0, index % 3 === 0 ? -70 : 60, 0],
    });
    const scale = anim.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [1, index === 3 ? 1.3 : 1.15, 1],
    });
    
    // Blob 4 needs a base rotation to act as the "light fold"
    if (index === 3) {
      return [{ translateX }, { translateY }, { scale }, { rotate: '-30deg' }];
    }
    
    return [{ translateX }, { translateY }, { scale }];
  };

  return (
    <View style={styles.container}>
      {/* Background Blobs */}
      <Animated.View
        style={[
          styles.blob,
          {
            width: blobs[0].size,
            height: blobs[0].size,
            top: blobs[0].top,
            left: blobs[0].left,
            transform: getTransform(anim1, 0),
          },
        ]}
      >
        <LinearGradient 
          colors={blobs[0].colors} start={blobs[0].start} end={blobs[0].end}
          style={{ flex: 1, borderRadius: blobs[0].size / 2 }}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.blob,
          {
            width: blobs[1].size,
            height: blobs[1].size,
            top: blobs[1].top,
            left: blobs[1].left,
            transform: getTransform(anim2, 1),
          },
        ]}
      >
        <LinearGradient 
          colors={blobs[1].colors} start={blobs[1].start} end={blobs[1].end}
          style={{ flex: 1, borderRadius: blobs[1].size / 2 }}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.blob,
          {
            width: blobs[2].size,
            height: blobs[2].size,
            top: blobs[2].top,
            left: blobs[2].left,
            transform: getTransform(anim3, 2),
            opacity: 0.8, // Make the peach core slightly translucent
          },
        ]}
      >
        <LinearGradient 
          colors={blobs[2].colors} start={blobs[2].start} end={blobs[2].end}
          style={{ flex: 1, borderRadius: blobs[2].size / 2 }}
        />
      </Animated.View>

      {/* 4. The Light Fold */}
      <Animated.View
        style={[
          styles.blob,
          {
            width: blobs[3].size,
            height: blobs[3].size * 0.3, // Stretch to oval
            top: blobs[3].top,
            left: blobs[3].left,
            transform: getTransform(anim4, 3),
            opacity: 0.3, // Lower opacity for the fold refraction
          },
        ]}
      >
        <LinearGradient 
          colors={blobs[3].colors} start={blobs[3].start} end={blobs[3].end}
          style={{ flex: 1, borderRadius: blobs[3].size }}
        />
      </Animated.View>

      {/* Massive blur overlay to melt them together (Removed due to washing out colors) */}
      
      {/* Film Grain Simulation (Optional overlay layer) */}
      <View style={styles.noiseOverlay} />

      {/* Bottom fade to black for UI anchoring */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.85)', '#000000']}
        locations={[0, 0.4, 1]}
        style={styles.bottomGradient}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#140505', // Deep dark red base per prompt
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    opacity: 0.7, // Base opacity for fluid layers
  },
  noiseOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.02)', // Subtle noise simulation if image missing
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: height * 0.5, // Bottom 50%
  },
});
