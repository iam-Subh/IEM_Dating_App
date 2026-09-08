import { compatibilityValue } from '../../compatibility';
import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import Svg, { Circle, Text as SvgText, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

interface ProfileCompatibilityProps {
  user: any;
}

export const ProfileCompatibility: React.FC<ProfileCompatibilityProps> = ({ user }) => {
  const matchPercentage = compatibilityValue(user.matchPercentage);
  const factors = Array.isArray(user.matchFactors) ? user.matchFactors : [];
  if (matchPercentage === null || factors.length === 0) return null;

  const CompatibilityFactor = ({ factor, index }: { factor: any, index: number }) => {
    const scaleX = useRef(new Animated.Value(0)).current;
    
    useEffect(() => {
      Animated.timing(scaleX, {
        toValue: 1,
        duration: 800,
        delay: index * 150 + 400,
        useNativeDriver: true,
      }).start();
    }, []);

    // Extract number to calculate width percentage, cap at 100
    const rawVal = typeof factor.points === 'number' ? factor.points : 0;
    const progressWidth: any = `${Math.min(100, rawVal * 4)}%`;

    return (
      <View style={styles.factorRow}>
        <View style={styles.factorHeader}>
          <Text style={styles.factorLabel}>{factor.label}</Text>
          <Text style={styles.factorBoost}>{factor.boost}</Text>
        </View>
        <View style={styles.progressBarBg}>
          <Animated.View 
            style={[
              styles.progressBarFill, 
              { 
                width: progressWidth, 
                transform: [{ scaleX }],
                transformOrigin: 'left' // React Native transformOrigin support
              }
            ]} 
          />
        </View>
      </View>
    );
  };

  // SVG Ring calculations
  const size = 160;
  const strokeWidth = 10;
  const center = size / 2;
  const radius = center - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * matchPercentage) / 100;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>PROFILE COMPATIBILITY</Text>
      
      <Text style={{ color: "#aaa", textAlign: "center" }}>Shared profile information. This score does not predict relationship success.</Text>
      <View style={styles.ringContainer}>
        <View style={styles.svgWrapper}>
          <Svg width={size} height={size}>
            <Defs>
              <SvgLinearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor="#26de81" />
                <Stop offset="100%" stopColor="#45aaf2" />
              </SvgLinearGradient>
            </Defs>
            {/* Background Ring */}
            <Circle
              stroke="rgba(255, 255, 255, 0.05)"
              cx={center}
              cy={center}
              r={radius}
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            {/* Progress Ring */}
            <Circle
              stroke="url(#grad)"
              cx={center}
              cy={center}
              r={radius}
              strokeWidth={strokeWidth}
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${center} ${center})`}
            />
            {/* 56px Gradient Text */}
            <SvgText
              fill="url(#grad)"
              fontSize="56"
              fontFamily="Syne_800ExtraBold"
              x={center}
              y={center + 18}
              textAnchor="middle"
            >
              {matchPercentage}
            </SvgText>
          </Svg>
        </View>
      </View>

      <View style={styles.factorsList}>
        {factors.map((factor: any, idx: number) => (
          <CompatibilityFactor key={idx} factor={factor} index={idx} />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#13131a',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  sectionTitle: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
    color: '#8e8e93',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 20,
    textAlign: 'center',
  },
  ringContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  svgWrapper: {
    position: 'relative',
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#26de81',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  factorsList: {
    gap: 16,
  },
  factorRow: {
    flexDirection: 'column',
    gap: 8,
  },
  factorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  factorLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
  },
  factorBoost: {
    fontFamily: 'Syne_800ExtraBold',
    fontSize: 13,
    color: '#26de81',
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#26de81',
    borderRadius: 3,
  }
});
