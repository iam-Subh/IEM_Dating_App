import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Animated,
  Linking,
  Easing,
  Image,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useDispatch } from "react-redux";
import { completeOnboarding } from "../../../store/authSlice";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Circle, Path, Rect, G } from "react-native-svg";

const FaceScannerIcon = () => {
  const scanAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Sweep down the face and back up again. A one-way loop snapped back to
    // the top each cycle, which read as a repeated jump rather than a scan.
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Circular rotation animation for the dashed ring
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Slow breathing pulse on the ring so it reads as active rather than
    // just spinning at a constant size.
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  // Travel from the top of the head down to the mouth.
  //
  // The 85px face icon uses a 24-unit viewBox (scale 85/24) and is centred in
  // the 180px-tall container, so it spans y 47.5 - 132.5. Mapping the icon's
  // own paths: the head starts at viewBox y=2 (~55px) and the mouth curve ends
  // at y=16 (~105px), with a little travel past it to just below the jaw.
  const scanTranslateY = scanAnim.interpolate({ inputRange: [0, 1], outputRange: [55, 121] });
  
  // Ease the line out slightly as it turns around at each end.
  const scanOpacity = scanAnim.interpolate({
    inputRange: [0, 0.12, 0.88, 1],
    outputRange: [0.35, 1, 1, 0.35]
  });

  const spinRotate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  });

  const ringScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1.04],
  });

  const ringOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 1],
  });

  return (
    <View style={{ width: 140, height: 180, justifyContent: 'center', alignItems: 'center' }}>
      {/* Background SVG Elements */}
      <Svg width="200" height="200" viewBox="0 0 200 200" style={{ position: 'absolute' }}>
        <Defs>
          <SvgLinearGradient id="faceGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#ff6a00" />
            <Stop offset="100%" stopColor="#ee0979" />
          </SvgLinearGradient>
        </Defs>

        {/* Framing Corners */}
        <Path d="M 50 70 L 50 50 L 70 50" fill="none" stroke="#ff6a00" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
        <Path d="M 150 70 L 150 50 L 130 50" fill="none" stroke="#ff6a00" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
        <Path d="M 50 130 L 50 150 L 70 150" fill="none" stroke="#ee0979" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
        <Path d="M 150 130 L 150 150 L 130 150" fill="none" stroke="#ee0979" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
      </Svg>

      {/* Animated Background Ring */}
      <Animated.View
        style={{
          position: 'absolute',
          opacity: ringOpacity,
          transform: [{ rotate: spinRotate }, { scale: ringScale }],
        }}
      >
        <Svg width="200" height="200" viewBox="0 0 200 200">
          <Circle cx="100" cy="100" r="90" fill="none" stroke="#ff6a00" strokeWidth="1" strokeDasharray="10 5" opacity="0.5" />
        </Svg>
      </Animated.View>

      {/* Core Face Profile */}
      <View style={{ position: 'absolute' }}>
        <Svg width="85" height="85" viewBox="0 0 24 24">
          <Defs>
            <SvgLinearGradient id="faceGradientRef" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="#ff6a00" />
              <Stop offset="100%" stopColor="#ee0979" />
            </SvgLinearGradient>
          </Defs>
          <Path 
            d="M9,3A1,1,0,0,1,8,4H5A1,1,0,0,0,4,5V8A1,1,0,0,1,2,8V5A3,3,0,0,1,5,2H8A1,1,0,0,1,9,3ZM2,19a3,3,0,0,0,3,3H8a1,1,0,0,0,0-2H5a1,1,0,0,1-1-1V16a1,1,0,0,0-2,0Zm19-4a1,1,0,0,0-1,1v3a1,1,0,0,1-1,1H16a1,1,0,0,0,0,2h3a3,3,0,0,0,3-3V16A1,1,0,0,0,21,15ZM19,2H16a1,1,0,0,0,0,2h3a1,1,0,0,1,1,1V8a1,1,0,0,0,2,0V5A3,3,0,0,0,19,2ZM8,9V8A1,1,0,0,0,6,8V9A1,1,0,0,0,8,9ZM18,9V8a1,1,0,0,0-2,0V9a1,1,0,0,0,2,0ZM8.775,14.368a1,1,0,0,0-1.55,1.264,6,6,0,0,0,9.55,0,1,1,0,1,0-1.55-1.264,4,4,0,0,1-6.45,0ZM11,7a1,1,0,0,0-1,1v3.01A3,3,0,0,0,13,14a1,1,0,0,0-.01-2,.991.991,0,0,1-.99-.99V8A1,1,0,0,0,11,7Z" 
            fill="url(#faceGradientRef)" 
          />
        </Svg>
      </View>

      {/* Animated Scan Line */}
      <Animated.View style={{ position: 'absolute', top: 0, transform: [{ translateY: scanTranslateY }], opacity: scanOpacity }}>
        <Svg width="200" height="4" viewBox="0 0 200 4">
          <Defs>
            <SvgLinearGradient id="scanLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#F5F1E8" stopOpacity="0" />
              <Stop offset="50%" stopColor="#F5F1E8" stopOpacity="0.95" />
              <Stop offset="100%" stopColor="#F5F1E8" stopOpacity="0" />
            </SvgLinearGradient>
          </Defs>
          <Rect x="40" y="0" width="120" height="4" fill="url(#scanLineGradient)" />
        </Svg>
      </Animated.View>
    </View>
  );
};

export const FaceVerificationInfoScreen = () => {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleCompleteNow = () => {
    navigation.navigate("PhotoUpload");
  };

  const handleMaybeLater = () => {
    // If they skip, they might complete onboarding without photos, or we can just complete it
    dispatch(completeOnboarding());
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.headerNav}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <MaterialCommunityIcons name="arrow-left" size={28} color="#FFF" />
        </TouchableOpacity>
      </View>

      <Animated.ScrollView 
        contentContainerStyle={styles.scrollContent}
        style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconContainer}>
          <FaceScannerIcon />
        </View>

        <Text style={styles.title}>Let's keep it real</Text>

        <Text style={styles.description}>
          Add clear, recent photos that show your face. The app verifies your college membership. It does not provide photo or biometric verification at this time.
        </Text>

        <Text style={styles.warning}>
          Your profile won't be visible to others until you complete this step.
        </Text>
      </Animated.ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.primaryButton}
          onPress={handleCompleteNow}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>Complete now</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.secondaryButton}
          onPress={handleMaybeLater}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryButtonText}>Maybe later</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F1115",
  },
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "ios" ? 10 : 45,
    height: Platform.OS === "ios" ? 60 : 90,
    paddingBottom: 10,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: "center",
  },
  iconContainer: {
    marginTop: 40,
    marginBottom: 30,
    alignItems: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFF",
    marginBottom: 24,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    color: "rgba(255, 255, 255, 0.7)",
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 24,
  },
  linkText: {
    color: "#4A90E2",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  warning: {
    fontSize: 15,
    color: "rgba(255, 255, 255, 0.7)",
    lineHeight: 22,
    textAlign: "center",
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    paddingTop: 10,
    gap: 16,
  },
  primaryButton: {
    backgroundColor: "#FFF",
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#000",
    fontSize: 18,
    fontWeight: "700",
  },
  secondaryButton: {
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "700",
  }
});
