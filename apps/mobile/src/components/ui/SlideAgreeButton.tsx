import React, { useState, useRef, useEffect } from "react";
import { 
  View, 
  Text, 
  StyleSheet, 
  Dimensions, 
  Animated, 
  PanResponder,
  Easing
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

const { width } = Dimensions.get("window");
const SLIDER_WIDTH = width - 64; 
const HANDLE_SIZE = 54;
const TRACK_HEIGHT = 70;
const PADDING = 8;

// Our Native Object Pool Interface
interface HeartParticle {
  id: number;
  x: Animated.Value;
  y: Animated.Value;
  scale: Animated.Value;
  opacity: Animated.Value;
}

export const SlideAgreeButton = ({ onAgree }: { onAgree: () => void }) => {
  const [sliderWidth, setSliderWidth] = useState(SLIDER_WIDTH);
  
  const pan = useRef(new Animated.Value(0)).current; 
  const trailAnim = useRef(new Animated.Value(0)).current; 
  const currentX = useRef(0);
  
  const threshold = Math.max(100, sliderWidth - HANDLE_SIZE - (PADDING * 2)); 
  const thresholdRef = useRef(threshold);
  
  useEffect(() => {
    thresholdRef.current = threshold;
  }, [threshold]);

  useEffect(() => {
    const id = pan.addListener((value) => {
      currentX.current = value.value;
    });
    return () => pan.removeListener(id);
  }, [sliderWidth]);

  const handlePulse = useRef(new Animated.Value(1)).current;
  const idleAnim = useRef(new Animated.Value(0)).current;

  // OBJECT POOLING FOR 120FPS SMOOTHNESS
  const PARTICLE_COUNT = 25;
  const particles = useRef<HeartParticle[]>(
    Array.from({ length: PARTICLE_COUNT }).map((_, i) => ({
      id: i,
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      scale: new Animated.Value(0),
      opacity: new Animated.Value(0),
    }))
  ).current;
  const particleIndex = useRef(0);
  const particleInterval = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(handlePulse, { toValue: 1.15, duration: 1200, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }),
        Animated.timing(handlePulse, { toValue: 1, duration: 1200, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(idleAnim, { toValue: 1, duration: 2500, easing: Easing.linear, useNativeDriver: true })
    ).start();
  }, []);

  const spawnSpreadHeart = (currentHandleX: number) => {
    const p = particles[particleIndex.current];
    particleIndex.current = (particleIndex.current + 1) % PARTICLE_COUNT;
    
    const startX = currentHandleX + PADDING + (HANDLE_SIZE / 2) - 9; 
    const startY = (TRACK_HEIGHT / 2) - 9; 
    
    const randomAngle = Math.random() * Math.PI * 2; 
    const distance = 25 + Math.random() * 35; 
    
    p.x.setValue(startX);
    p.y.setValue(startY);
    p.scale.setValue(Math.random() * 0.4 + 0.4); 
    p.opacity.setValue(0.8);

    Animated.parallel([
      Animated.timing(p.x, { toValue: startX + Math.cos(randomAngle) * distance, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(p.y, { toValue: startY + Math.sin(randomAngle) * distance, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(p.scale, { toValue: 0, duration: 600, useNativeDriver: true }),
      Animated.timing(p.opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  };

  const startSpawning = () => {
    if (particleInterval.current) return;
    particleInterval.current = setInterval(() => {
      spawnSpreadHeart(currentX.current);
    }, 60); 
  };

  const stopSpawning = () => {
    if (particleInterval.current) {
      clearInterval(particleInterval.current);
      particleInterval.current = null;
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startSpawning();
      },
      onPanResponderMove: (_, gestureState) => {
        const maxDist = thresholdRef.current;
        const newX = Math.min(Math.max(0, gestureState.dx), maxDist);
        pan.setValue(newX);
        trailAnim.setValue(newX); 
      },
      onPanResponderRelease: () => {
        stopSpawning();
        const maxDist = thresholdRef.current;
        
        if (currentX.current >= maxDist - 20) {
          Animated.parallel([
            Animated.spring(pan, { toValue: maxDist, bounciness: 0, useNativeDriver: true }),
            Animated.spring(trailAnim, { toValue: maxDist, bounciness: 0, useNativeDriver: false })
          ]).start(() => {
            
            // Trigger Navigation
            onAgree();

            // THE FIX: Silently reset the slider after the screen transitions away
            setTimeout(() => {
              pan.setValue(0);
              trailAnim.setValue(0);
            }, 500); 

          });
        } else {
          Animated.parallel([
            Animated.spring(pan, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
            Animated.spring(trailAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: false })
          ]).start();
        }
      },
      onPanResponderTerminate: () => stopSpawning(), 
    })
  ).current;

  useEffect(() => {
    return () => stopSpawning();
  }, []);

  const getCombinedChevronStyle = (index: number) => {
    const startFadeIn = threshold * (0.2 + index * 0.2); 
    const endFadeIn = threshold * (0.4 + index * 0.2);   
    const startFadeOut = threshold * (0.7 + index * 0.1); 
    const endFadeOut = threshold * (0.8 + index * 0.1);   

    const dragOpacity = pan.interpolate({
      inputRange: [0, startFadeIn, endFadeIn, startFadeOut, endFadeOut, threshold + 100],
      outputRange: [0.2, 0.2, 1, 1, 0, 0], 
      extrapolate: 'clamp',
    });

    let idleOpacityBase;
    if (index === 0) {
      idleOpacityBase = idleAnim.interpolate({ inputRange: [0, 0.1, 0.3, 1], outputRange: [0, 0.8, 0, 0], extrapolate: 'clamp' });
    } else if (index === 1) {
      idleOpacityBase = idleAnim.interpolate({ inputRange: [0, 0.1, 0.25, 0.45, 1], outputRange: [0, 0, 0.8, 0, 0], extrapolate: 'clamp' });
    } else {
      idleOpacityBase = idleAnim.interpolate({ inputRange: [0, 0.25, 0.4, 0.6, 1], outputRange: [0, 0, 0.8, 0, 0], extrapolate: 'clamp' });
    }

    const idleSuppress = pan.interpolate({ inputRange: [0, 20], outputRange: [1, 0], extrapolate: 'clamp' });
    const activeIdleOpacity = Animated.multiply(idleOpacityBase, idleSuppress);
    
    return {
      opacity: Animated.add(dragOpacity, activeIdleOpacity),
      transform: [{
        scale: pan.interpolate({
          inputRange: [0, startFadeIn, endFadeIn, startFadeOut, endFadeOut],
          outputRange: [1, 1, 1.25, 1.25, 0.8], 
          extrapolate: 'clamp',
        })
      }]
    };
  };

  const textOpacity = Animated.multiply(
    idleAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1, 0.6] }),
    pan.interpolate({ inputRange: [0, HANDLE_SIZE], outputRange: [1, 0], extrapolate: 'clamp' })
  );

  return (
    <View 
      style={styles.container}
      onLayout={(e) => setSliderWidth(e.nativeEvent.layout.width)}
    >
      <View style={styles.track}>
        
        <Animated.View 
          style={[
            styles.trail, 
            { width: Animated.add(trailAnim, HANDLE_SIZE) }
          ]} 
        />
        
        <Animated.View style={[{ opacity: textOpacity }, styles.textContainer]}>
          <Text style={styles.label}>Get Started</Text>
        </Animated.View>
        
        <View style={styles.hintsContainer}>
          <Animated.View style={getCombinedChevronStyle(0)}><MaterialCommunityIcons name="chevron-right" size={32} color="#FFF" /></Animated.View>
          <Animated.View style={[getCombinedChevronStyle(1), styles.chevronOverlap]}><MaterialCommunityIcons name="chevron-right" size={32} color="#FFF" /></Animated.View>
          <Animated.View style={[getCombinedChevronStyle(2), styles.chevronOverlap]}><MaterialCommunityIcons name="chevron-right" size={32} color="#FFF" /></Animated.View>
        </View>
      </View>

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {particles.map(p => (
          <Animated.View
            key={p.id}
            style={[
              styles.particle,
              {
                transform: [{ translateX: p.x }, { translateY: p.y }, { scale: p.scale }],
                opacity: p.opacity,
              },
            ]}
          >
            <MaterialCommunityIcons name="heart" size={18} color="#FFF" />
          </Animated.View>
        ))}
      </View>

      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.handle,
          { 
            transform: [{ translateX: pan }],
            zIndex: 10,
          },
        ]}
      >
        <View style={styles.handleCircle}>
           <Animated.View style={{ transform: [{ scale: handlePulse }] }}>
              <MaterialCommunityIcons name="heart" size={30} color="#FFF" />
           </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: TRACK_HEIGHT,
    justifyContent: 'center',
  },
  track: {
    width: '100%',
    height: TRACK_HEIGHT,
    backgroundColor: '#1A1A1A',
    borderRadius: TRACK_HEIGHT / 2,
    justifyContent: 'center', 
    position: 'relative', 
  },
  trail: {
    position: 'absolute',
    left: PADDING,
    top: PADDING,
    bottom: PADDING,
    backgroundColor: '#FF416C', 
    borderRadius: (TRACK_HEIGHT - PADDING * 2) / 2, 
  },
  textContainer: {
    position: 'absolute',
    left: HANDLE_SIZE + (PADDING * 2), 
    right: 70, 
    alignItems: 'center', 
    zIndex: 5, 
  },
  label: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  hintsContainer: {
    position: 'absolute',
    right: 20, 
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 5,
  },
  chevronOverlap: {
    marginLeft: -16, 
  },
  handle: {
    position: 'absolute',
    left: PADDING,
    top: PADDING,
    bottom: PADDING,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  handleCircle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#FF416C', 
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  particle: {
    position: 'absolute',
    zIndex: 15, 
  }
});
