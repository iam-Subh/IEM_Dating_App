import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  TouchableOpacity,
  StatusBar,
  Dimensions,
  TextInput,
  BackHandler,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useDispatch } from 'react-redux';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AnimatedInput } from '../../../components/ui/AnimatedInput';
import { AnimatedBlurBackground } from '../../../components/ui/AnimatedBlurBackground';
import { colors } from '../../../core/theme/colors';
import { api } from '../../../services/api';
import { setCredentials } from '../../../store/authSlice';
import { credentialStore } from '../../../services/credentialStore';

export const LoginScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  
  const { initialForm } = route.params || {};

  const [emailPrefix, setEmailPrefix] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // This screen stays mounted in the navigation stack, so returning to it
  // after a successful save would otherwise leave a stuck loading button
  // that is also disabled. Clearing on focus covers every exit path.
  useFocusEffect(
    React.useCallback(() => {
      setLoading(false);
    }, [])
  );

  const [error, setError] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(initialForm === 'email');
  const domain = '@iem.edu.in';

  // Validation
  const isValidPrefix = emailPrefix.trim().length >= 3;
  const hasYear = /\d{4}$/.test(emailPrefix.trim());
  const isFullyValid = isValidPrefix && hasYear && password.length >= 8;

  // Staggered entrance animations
  const fadeAnim1 = useRef(new Animated.Value(0)).current;
  const slideAnim1 = useRef(new Animated.Value(30)).current;
  
  const fadeAnim2 = useRef(new Animated.Value(0)).current;
  const slideAnim2 = useRef(new Animated.Value(30)).current;

  // Subtle background pulse
  const bgPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.stagger(150, [
      Animated.parallel([
        Animated.timing(fadeAnim1, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.spring(slideAnim1, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeAnim2, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.spring(slideAnim2, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  // Handle hardware back press natively
  useEffect(() => {
    const handleBackPress = () => {
      if (showEmailForm) {
        setShowEmailForm(false);
        return true; // Prevent default behavior (exiting app)
      }
      return false; // Let default behavior happen (exit app or go back in nav stack)
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      handleBackPress
    );

    return () => backHandler.remove();
  }, [showEmailForm]);

  useEffect(() => {
    if (initialForm === 'email') {
      setShowEmailForm(true);
    }
  }, [initialForm]);

  const handleContinue = useCallback(async () => {
    if (!isValidPrefix) {
      setError('Enter at least 3 characters for email');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError('');
    setLoading(true);

    const fullEmail = `${emailPrefix.trim().toLowerCase()}${domain}`;

    try {
      const response = await api.post('/auth/login', { email: fullEmail, password });
      setLoading(false);
      
      // Update Redux state to authenticate user and trigger navigation automatically
      const resData = response.data.data;
      const user = resData.user;
      const token = resData.accessToken;
      await credentialStore.setRefreshToken(resData.refreshToken);
      
      dispatch(setCredentials({ user, token, nextRequiredStep: resData.onboarding?.nextRequiredStep }));
      
      // If user hasn't completed profile, Redux won't toggle isAuthenticated
      // Manually push them into the remaining onboarding flow
      if (resData.onboarding?.nextRequiredStep === 'profile') {
         navigation.navigate("HouseRules", { user, token });
      }
      
    } catch (err: any) {
      setLoading(false);
      const msg = err.response?.data?.message || 'Invalid credentials.';
      setError(msg);
    }
  }, [emailPrefix, password, isValidPrefix, dispatch]);

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      <AnimatedBlurBackground />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView 
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={[styles.contentContainer, showEmailForm && styles.contentContainerFormActive]}>
          
          {/* Typography Header */}
          {!showEmailForm ? (
            <Animated.View 
              style={[
                styles.headerArea, 
                { opacity: fadeAnim1, transform: [{ translateY: slideAnim1 }] }
              ]}
            >
              <Text style={styles.cinematicRow}>
                <Text style={styles.serifItalic}>Let's</Text>
                <Text style={styles.sansText}> help you</Text>
              </Text>
              <Text style={styles.cinematicRow}>
                <Text style={styles.sansText}>meet someone</Text>
              </Text>
              <Text style={styles.cinematicRow}>
                <Text style={styles.sansText}>who truly gets </Text>
                <Text style={[styles.serifItalic, styles.coralAccent]}>you</Text>
              </Text>
              
              <Text style={styles.subtext}>
                Find genuine connections built on shared values, interests, and goals.
              </Text>
            </Animated.View>
          ) : (
            <Animated.View 
              style={[
                styles.formHeaderArea,
                { opacity: fadeAnim1, transform: [{ translateY: slideAnim1 }] }
              ]}
            >
              <Text style={styles.formTitle}>
                <Text style={[styles.serifItalic, { fontSize: 44 }]}>Welcome </Text>
                <Text style={[styles.sansText, { fontSize: 36 }]}>Back</Text>
              </Text>
              <Text style={styles.formSubtext}>
                Sign in with your college email to continue.
              </Text>
            </Animated.View>
          )}

          {/* Bottom Actions Area */}
          <Animated.View 
            style={[
              styles.bottomArea,
              { opacity: fadeAnim2, transform: [{ translateY: slideAnim2 }] }
            ]}
          >
            {!showEmailForm ? (
              // Initial Cinematic Landing View
              <>
                <TouchableOpacity
                  style={styles.pillBtnWhite}
                  activeOpacity={0.9}
                  onPress={() => setShowEmailForm(true)}
                >
                  <Text style={styles.pillBtnWhiteText}>Continue with Email</Text>
                </TouchableOpacity>

                <View style={styles.dividerContainer}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>OR CONTINUE WITH</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* Simulated Social Buttons to match mockup layout */}
                <TouchableOpacity
                  style={styles.pillBtnDark}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate('PhoneLogin')}
                >
                  <Text style={styles.pillBtnDarkText}>Continue With Phone</Text>
                  <MaterialCommunityIcons name="phone" size={20} color="#FFF" />
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.pillBtnDark}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate('SignUp')} // Routing Google/Apple to SignUp for now
                >
                  <Text style={styles.pillBtnDarkText}>Create New Account</Text>
                  <MaterialCommunityIcons name="account-plus" size={20} color="#FFF" />
                </TouchableOpacity>

                <Text style={styles.legalText}>
                  By continuing, you agree to IEM Connect's{'\n'}Terms of Service and Privacy Policy
                </Text>
              </>
            ) : (
              // The completely redesigned Email/Password Form (White Pill shapes)
              <View style={styles.formContainer}>
                
                <View style={styles.newInputGroup}>
                  <Text style={styles.newInputLabel}>College Email</Text>
                  <TextInput
                    style={styles.newInputPill}
                    placeholder="firstname.lastname2024"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={emailPrefix}
                    onChangeText={(text: string) => {
                      setEmailPrefix(text);
                      if (error) setError('');
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="next"
                  />
                  {emailPrefix.length > 0 && !emailPrefix.includes('@') && (
                    <Text style={styles.domainHint}>@iem.edu.in will be added</Text>
                  )}
                </View>

                <View style={styles.newInputGroup}>
                  <Text style={styles.newInputLabel}>Password</Text>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={styles.newInputPillPassword}
                      placeholder="Enter your password"
                      placeholderTextColor="rgba(255,255,255,0.4)"
                      value={password}
                      onChangeText={(text: string) => {
                        setPassword(text);
                        if (error) setError('');
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={!showPassword}
                      returnKeyType="go"
                      onSubmitEditing={handleContinue}
                    />
                    <TouchableOpacity
                      style={styles.eyeIconContainer}
                      onPress={() => setShowPassword(!showPassword)}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons 
                        name={showPassword ? "eye-off-outline" : "eye-outline"} 
                        size={22} 
                        color="rgba(255,255,255,0.5)" 
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {error ? <Text style={styles.newErrorText}>{error}</Text> : null}

                <View style={styles.forgotPasswordContainer}>
                  <TouchableOpacity onPress={() => navigation.navigate('PasswordRecovery')}>
                    <Text style={styles.forgotPasswordText}>Recover Password</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[
                    styles.newLoginBtn,
                    (!isValidPrefix || password.length < 8) && styles.newLoginBtnDisabled
                  ]}
                  onPress={handleContinue}
                  disabled={!isValidPrefix || password.length < 8 || loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <Text style={styles.newLoginBtnText}>Authenticating...</Text>
                  ) : (
                    <Text style={styles.newLoginBtnText}>Sign In</Text>
                  )}
                </TouchableOpacity>

              </View>
            )}
          </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'flex-end', // Push everything to bottom
    paddingHorizontal: 32, // Tighter horizontal margins
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 20 : 60,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  contentContainerFormActive: {
    justifyContent: 'center',
    paddingBottom: Platform.OS === 'ios' ? 100 : 80, // High padding to clear keyboard
  },
  
  // Header Typography
  headerArea: {
    marginBottom: 40,
    alignItems: 'center',
    paddingHorizontal: 8, // Give curls breathing room to prevent side-clipping
  },
  formHeaderArea: {
    marginBottom: 40,
    alignItems: 'flex-start',
    width: '100%',
  },
  backButton: {
    marginBottom: 16,
    marginLeft: -8,
    padding: 8,
  },
  formTitle: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap', // Prevent text cutoff
  },
  formSubtext: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 22,
    paddingRight: 32, // Keep line length readable
  },
  cinematicRow: {
    fontSize: 40, // Scaled down purely to prevent wrapping on narrow mobile screens
    lineHeight: 60, // Must be significantly larger than font size to prevent top/bottom slicing
    color: '#FFF',
    textAlign: 'center',
    letterSpacing: -1.5, // Tighter tracking to emulate Mona Sans Display
  },
  serifItalic: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic', 
    fontSize: 50, // Much larger hook for "Let's" and "you", but fits within lineHeight: 60
  },
  sansText: {
    fontFamily: 'Inter_700Bold', 
    letterSpacing: -1.5,
  },
  coralAccent: {
    color: '#E84A3B',
  },
  subtext: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },

  // Bottom Area & Forms
  bottomArea: {
    width: '100%',
  },
  formContainer: {
    width: '100%',
  },
  newInputGroup: {
    marginBottom: 20,
  },
  newInputLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 16,
    letterSpacing: 0.5,
  },
  newInputPill: {
    width: '100%',
    height: 60,
    backgroundColor: 'rgba(50,50,50,0.5)', // Darker, more solid glass
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)', // Slightly stronger border
    borderRadius: 30, // Maintains the pill shape request
    paddingHorizontal: 24,
    fontSize: 16,
    color: '#FFF',
    fontWeight: '500',
  },
  passwordInputContainer: {
    width: '100%',
    position: 'relative',
  },
  newInputPillPassword: {
    width: '100%',
    height: 60,
    backgroundColor: 'rgba(50,50,50,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 30,
    paddingLeft: 24,
    paddingRight: 60, // Leave room for the eye icon
    fontSize: 16,
    color: '#FFF',
    fontWeight: '500',
  },
  eyeIconContainer: {
    position: 'absolute',
    right: 6,
    top: 6,
    height: 48,
    width: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 24,
  },
  domainHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginLeft: 16,
    marginTop: 6,
  },
  newErrorText: {
    color: '#FF6B6B',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 10,
    fontWeight: '500',
  },
  transparentInput: {
    backgroundColor: 'rgba(255,255,255,0.06)', // Slightly more visible
    borderColor: 'rgba(255,255,255,0.1)',
  },
  hintBox: {
    marginTop: -8,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  hintText: {
    fontSize: 12,
    color: '#FFF',
    opacity: 0.8,
  },
  forgotPasswordContainer: {
    width: '100%',
    alignItems: 'flex-end',
    marginTop: 8,
    marginBottom: 16,
  },
  forgotPasswordText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '500',
  },
  
  // Buttons
  newLoginBtn: {
    width: '100%',
    height: 60,
    backgroundColor: '#E84A3B',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#E84A3B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  newLoginBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    shadowOpacity: 0,
    elevation: 0,
  },
  newLoginBtnText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  primaryBtn: {
    width: '100%',
    height: 56,
    borderRadius: 14, // Match inputs
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnActive: {
    backgroundColor: '#E84A3B', // Coral to match 'you' text
    shadowColor: '#E84A3B',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20, // Huge glow
    elevation: 12,
  },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700', // Bolder for high-end look
    letterSpacing: 0.5,
  },
  btnIcon: {
    marginLeft: 8,
    opacity: 0.9,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  dividerText: {
    color: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 16,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
  pillBtnWhite: {
    width: '100%',
    height: 56,
    backgroundColor: '#FFF',
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 5,
  },
  pillBtnWhiteText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  pillBtnDark: {
    width: '100%',
    height: 56,
    backgroundColor: '#1A1A1A',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  pillBtnDarkText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  legalText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    marginTop: 16,
    lineHeight: 16,
  },
});
