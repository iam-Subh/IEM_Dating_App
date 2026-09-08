import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  StatusBar,
  Platform,
  Alert,
  KeyboardAvoidingView,
  Dimensions,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useDispatch } from "react-redux";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../../../services/api";
import { setCredentials } from "../../../store/authSlice";
import { colors } from "../../../core/theme/colors";
import { AnimatedBlurBackground } from "../../../components/ui/AnimatedBlurBackground";
import { credentialStore } from "../../../services/credentialStore";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;
const { width, height } = Dimensions.get("window");

export const SignUpOTPScreen = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const dispatch = useDispatch();
  const { email, password, intent } = route.params || {};
  const [challengeId, setChallengeId] = useState(route.params?.challengeId || "");

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [timer, setTimer] = useState(RESEND_COOLDOWN);
  const [verifying, setVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [success, setSuccess] = useState(false);

  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const successScale = useRef(new Animated.Value(0.8)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const boxAnims = useRef(
    Array(OTP_LENGTH)
      .fill(null)
      .map(() => new Animated.Value(0)),
  ).current;
  const progressAnim = useRef(new Animated.Value(0.33)).current;

  useEffect(() => {
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Stagger OTP boxes
    Animated.stagger(
      100,
      boxAnims.map((anim) =>
        Animated.spring(anim, {
          toValue: 1,
          friction: 7,
          tension: 80,
          useNativeDriver: true,
        }),
      ),
    ).start();

    // Focus first input
    setTimeout(() => inputRefs.current[0]?.focus(), 800);
  }, []);

  // Countdown
  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const handleChange = useCallback(
    (text: string, index: number) => {
      const cleaned = text.replace(/[^0-9]/g, "");
      if (!cleaned && text !== "") return;

      const newOtp = [...otp];

      if (cleaned.length > 1) {
        const chars = cleaned.split("").slice(0, OTP_LENGTH);
        chars.forEach((char, i) => {
          if (i + index < OTP_LENGTH) newOtp[i + index] = char;
        });
        setOtp(newOtp);
        const focusIndex = Math.min(index + chars.length, OTP_LENGTH - 1);
        inputRefs.current[focusIndex]?.focus();
        if (newOtp.every((d) => d !== "")) handleVerify(newOtp.join(""));
        return;
      }

      newOtp[index] = cleaned;
      setOtp(newOtp);
      if (cleaned && index < OTP_LENGTH - 1)
        inputRefs.current[index + 1]?.focus();
      if (newOtp.every((d) => d !== "")) handleVerify(newOtp.join(""));
    },
    [otp],
  );

  const handleKeyPress = useCallback(
    (e: any, index: number) => {
      if (e.nativeEvent.key === "Backspace" && !otp[index] && index > 0) {
        const newOtp = [...otp];
        newOtp[index - 1] = "";
        setOtp(newOtp);
        inputRefs.current[index - 1]?.focus();
      }
    },
    [otp],
  );

  const handleVerify = async (code: string) => {
    setVerifying(true);

    // Animate progress bar
    Animated.timing(progressAnim, {
      toValue: 0.66,
      duration: 600,
      useNativeDriver: false,
    }).start();

    try {
      // Step 1: Verify OTP
      const verification = await api.post("/auth/verify-otp", { email, code, challengeId });

      // Step 2: Register user
      await api.post("/auth/register", {
        email,
        name: email
          .split("@")[0]
          .replace(/\./g, " ")
          .replace(/\d{4}$/, "")
          .trim(),
        password,
        verificationToken: verification.data.data.verificationToken,
      });

      // Step 3: Login to get tokens
      const loginRes = await api.post("/auth/login", { email, password });
      await credentialStore.setRefreshToken(loginRes.data.data.refreshToken);

      // Success animation
      setSuccess(true);
      Animated.parallel([
        Animated.spring(successScale, {
          toValue: 1,
          friction: 6,
          tension: 50,
          useNativeDriver: true,
        }),
        Animated.timing(successOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: false,
        }),
      ]).start();

      dispatch(
        setCredentials({
          user: loginRes.data.data.user,
          token: loginRes.data.data.accessToken,
          nextRequiredStep: loginRes.data.data.onboarding?.nextRequiredStep,
        })
      );

      setTimeout(() => {
        navigation.navigate("HouseRules", {
          user: loginRes.data.data.user,
          token: loginRes.data.data.accessToken,
          intent,
        });
      }, 1500);
    } catch (err: any) {
      setVerifying(false);
      setOtp(Array(OTP_LENGTH).fill(""));
      inputRefs.current[0]?.focus();

      Animated.timing(progressAnim, {
        toValue: 0.33,
        duration: 300,
        useNativeDriver: false,
      }).start();

      const msg =
        err.response?.data?.message || "Verification failed. Please try again.";
      Alert.alert("Verification Failed", msg, [{ text: "OK" }]);
    }
  };

  const handleResend = async () => {
    if (timer > 0 || isResending) return;
    setIsResending(true);
    try {
      const response = await api.post("/auth/send-otp", { email });
      setChallengeId(response.data.data.challengeId);
      setTimer(RESEND_COOLDOWN);
      setOtp(Array(OTP_LENGTH).fill(""));
      inputRefs.current[0]?.focus();
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.response?.data?.message || "Failed to resend code.",
      );
    } finally {
      setIsResending(false);
    }
  };

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  if (success) {
    return (
      <>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <AnimatedBlurBackground />
        <View style={styles.container}>
          <Animated.View
            style={[
              styles.successContainer,
              { opacity: successOpacity, transform: [{ scale: successScale }] },
            ]}
          >
            <View style={styles.successCircle}>
              <MaterialCommunityIcons name="check" size={60} color="#FFF" />
            </View>
            <Text style={styles.successTitle}>
              <Text style={styles.serifItalic}>Verified </Text>
              <Text style={styles.sansText}>Successfully</Text>
            </Text>
            <Text style={styles.successSubtitle}>Let's set up your profile</Text>
            <Text style={styles.successEmail}>{email}</Text>
          </Animated.View>
        </View>
      </>
    );
  }

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <AnimatedBlurBackground />
      
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <Animated.ScrollView
          style={[styles.scrollView, { opacity: fadeAnim }]}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Animated.View
            style={[
              styles.innerContent,
              { transform: [{ translateY: slideAnim }] },
            ]}
          >
            {/* Progress Bar */}
            <View style={styles.progressContainer}>
              <View style={styles.progressTrack}>
                <Animated.View
                  style={[
                    styles.progressFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0%", "100%"],
                      }),
                    },
                  ]}
                />
              </View>
              <View style={styles.progressLabels}>
                <View style={[styles.labelPill, styles.labelPillActive]}>
                  <Text style={styles.progressLabelActive}>Email</Text>
                </View>
                <View style={[styles.labelPill, styles.labelPillActive]}>
                  <Text style={styles.progressLabelActive}>Verify</Text>
                </View>
                <View style={styles.labelPill}>
                  <Text style={styles.progressLabel}>Profile</Text>
                </View>
              </View>
            </View>

            {/* Header */}
          <View style={styles.header}>
            <Text style={styles.titleEditorial}>
              <Text style={styles.serifItalic}>Check </Text>
              <Text style={styles.sansText}>Your Inbox</Text>
            </Text>
            <Text style={styles.subtitle}>We've sent a 6-digit verification code to</Text>
            <Text style={styles.emailHighlight}>{email}</Text>
          </View>

          {/* OTP Inputs */}
          <View style={styles.otpRow}>
            {otp.map((digit, index) => (
              <Animated.View
                key={index}
                style={[
                  styles.otpBoxWrapper,
                  {
                    opacity: boxAnims[index],
                    transform: [
                      {
                        translateY: boxAnims[index].interpolate({
                          inputRange: [0, 1],
                          outputRange: [20, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View style={styles.otpBoxPill}>
                  {!digit && (
                    <Text style={styles.otpDash}>-</Text>
                  )}
                  <TextInput
                    ref={(r) => {
                      inputRefs.current[index] = r;
                    }}
                    style={[
                      styles.otpInput,
                      digit ? styles.otpBoxFilled : null,
                      verifying && styles.otpBoxVerifying,
                    ]}
                    value={digit}
                    onChangeText={(text) => handleChange(text, index)}
                    onKeyPress={(e) => handleKeyPress(e, index)}
                    keyboardType="number-pad"
                    maxLength={index === 0 ? OTP_LENGTH : 1}
                    selectTextOnFocus
                    editable={!verifying}
                    selectionColor="#E84A3B"
                  />
                </View>
              </Animated.View>
            ))}
          </View>

          {verifying && (
            <View style={styles.verifyingRow}>
              <Text style={styles.verifyingText}>Creating your cinematic profile...</Text>
            </View>
          )}

          {/* Timer */}
          <View style={styles.timerContainer}>
            {timer > 0 ? (
              <View style={styles.timerCapsule}>
                <MaterialCommunityIcons name="clock-outline" size={14} color="rgba(255,255,255,0.6)" />
                <Text style={styles.timerText}>
                  Resend in <Text style={styles.timerHighlight}>{formatTime(timer)}</Text>
                </Text>
              </View>
            ) : (
              <TouchableOpacity 
                onPress={handleResend}
                style={styles.resendBtn}
                activeOpacity={0.8}
                disabled={isResending}
              >
                <Text style={[styles.resendText, isResending && { opacity: 0.7 }]}>
                  {isResending ? "Sending..." : <>Didn't get the code? <Text style={styles.resendTextBold}>Resend Now</Text></>}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Help */}
          <View style={styles.helpSection}>
            <View style={styles.helpLine}>
              <MaterialCommunityIcons name="email-check-outline" size={16} color="rgba(255,255,255,0.4)" />
              <Text style={styles.helpText}>
                Check your spam folder just in case
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.smsOption}
              onPress={() => navigation.navigate("PhoneLogin")}
            >
              <Text style={styles.smsText}>
                No email access? <Text style={styles.coralText}>Use SMS instead →</Text>
              </Text>
            </TouchableOpacity>
          </View>
          </Animated.View>
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardView: { flex: 1 },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 32,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 40) + 20 : 60,
    paddingBottom: 40,
  },
  innerContent: {
    flex: 1,
    justifyContent: "center",
    minHeight: height * 0.7,
  },

  // Progress
  progressContainer: { 
    width: '100%',
    marginBottom: 40,
  },
  progressTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#E84A3B", // Coral
    borderRadius: 2,
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  progressLabel: {
    fontSize: 10,
    color: "rgba(255,255,255,0.4)",
    fontWeight: "600",
    textTransform: 'uppercase',
  },
  progressLabelActive: { 
    fontSize: 10,
    color: "#FFF",
    fontWeight: "700",
    textTransform: 'uppercase',
  },
  labelPill: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  labelPillActive: {
    backgroundColor: 'rgba(232, 74, 59, 0.2)',
    borderColor: 'rgba(232, 74, 59, 0.4)',
  },

  // Header
  header: { 
    alignItems: "flex-start", 
    marginBottom: 48,
    width: '100%',
  },
  titleEditorial: {
    marginBottom: 12,
  },
  serifItalic: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 48,
    color: '#FFF',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  sansText: {
    fontFamily: "Inter_700Bold",
    fontSize: 38,
    color: "#FFF",
    letterSpacing: -1.5,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  subtitle: { 
    fontSize: 15, 
    color: "rgba(255,255,255,0.85)", 
    fontWeight: "600",
    lineHeight: 22,
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  emailHighlight: {
    fontSize: 16,
    color: "#E84A3B",
    fontWeight: "700",
    marginTop: 4,
  },

  // OTP Row
  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: '100%',
    marginBottom: 32,
  },
  otpBoxWrapper: {},
  otpBoxPill: {
    width: (width - 64 - 50) / 6,
    height: 70,
    borderRadius: 20,
    backgroundColor: "rgba(50,50,50,0.5)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  otpDash: {
    position: 'absolute',
    fontSize: 24,
    color: 'rgba(255,255,255,0.2)',
    fontWeight: '700',
  },
  otpInput: {
    width: '100%',
    height: '100%',
    textAlign: "center",
    fontSize: 24,
    fontWeight: "700",
    color: "#FFF",
    padding: 0,
    ...Platform.select({
      android: {
        includeFontPadding: false,
        textAlignVertical: 'center',
      }
    }),
  },
  otpBoxFilled: {
    borderColor: "#E84A3B",
    backgroundColor: "rgba(232, 74, 59, 0.15)",
  },
  otpBoxVerifying: { 
    borderColor: "rgba(255,255,255,0.5)", 
    opacity: 0.6,
  },

  // Verifying
  verifyingRow: { alignItems: "center", marginBottom: 24 },
  verifyingText: { 
    fontSize: 13, 
    color: "rgba(255,255,255,0.5)", 
    fontWeight: "600",
    fontStyle: "italic",
  },

  // Timer
  timerContainer: { 
    alignItems: "center", 
    marginBottom: 48,
  },
  timerCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  timerText: { 
    fontSize: 14, 
    color: "rgba(255,255,255,0.6)", 
    fontWeight: "500",
  },
  timerHighlight: { color: "#FFF", fontWeight: "700" },
  resendBtn: {
    paddingVertical: 8,
  },
  resendText: { 
    fontSize: 14, 
    color: "rgba(255,255,255,0.7)", 
    fontWeight: "700",
  },
  resendTextBold: {
    color: '#E84A3B',
    fontWeight: '700',
  },

  // Help
  helpSection: { alignItems: "center", gap: 16 },
  helpLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  helpText: { 
    fontSize: 13, 
    color: "rgba(255,255,255,0.4)", 
    fontWeight: "500",
  },
  smsOption: { paddingVertical: 10 },
  smsText: { 
    fontSize: 14, 
    color: "rgba(255,255,255,0.6)", 
    fontWeight: "500",
  },
  coralText: {
    color: '#E84A3B',
    fontWeight: '700',
  },

  // Success
  successContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#E84A3B",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
    shadowColor: "#E84A3B",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 15,
  },
  successTitle: {
    marginBottom: 12,
    textAlign: "center",
  },
  successSubtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "500",
    marginBottom: 8,
    textAlign: "center",
  },
  successEmail: { fontSize: 14, color: "#E84A3B", fontWeight: "700", textAlign: "center" },
});
