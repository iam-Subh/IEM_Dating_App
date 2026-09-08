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
  ScrollView,
  TextInput,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AnimatedBlurBackground } from '../../../components/ui/AnimatedBlurBackground';
import { colors } from '../../../core/theme/colors';
import { api } from '../../../services/api';

export const SignUpScreen = () => {
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
  const domain = '@iem.edu.in';
  const navigation = useNavigation<any>();

  // Validation
  const isValidPrefix = emailPrefix.trim().length >= 3;
  const hasYear = /\d{4}$/.test(emailPrefix.trim());
  const isEmailValid = isValidPrefix && hasYear;
  const isPasswordValid = password.length >= 8;
  const canContinue = isEmailValid && isPasswordValid;

  // Staggered entrance animations
  const fadeAnim1 = useRef(new Animated.Value(0)).current;
  const slideAnim1 = useRef(new Animated.Value(30)).current;
  const fadeAnim2 = useRef(new Animated.Value(0)).current;
  const slideAnim2 = useRef(new Animated.Value(30)).current;
  const fadeAnim4 = useRef(new Animated.Value(0)).current;
  const slideAnim4 = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.stagger(150, [
      Animated.parallel([
        Animated.timing(fadeAnim1, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.spring(slideAnim1, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeAnim2, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(slideAnim2, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
      ]),

      Animated.parallel([
        Animated.timing(fadeAnim4, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(slideAnim4, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const handleContinue = useCallback(async () => {
    if (!isEmailValid) {
      setError('Include your admission year (e.g. 2024)');
      return;
    }
    if (!isPasswordValid) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError('');
    setLoading(true);

    const fullEmail = `${emailPrefix.trim().toLowerCase()}${domain}`;

    try {
      const response = await api.post('/auth/send-otp', { email: fullEmail });
      setLoading(false);
      navigation.navigate('SignUpOTP', {
        email: fullEmail,
        password,
        challengeId: response.data.data.challengeId,
      });
    } catch (err: any) {
      setLoading(false);
      const msg = err.response?.data?.message || 'Failed to send verification code.';
      setError(msg);
    }
  }, [emailPrefix, password, isEmailValid, isPasswordValid, navigation]);

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
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={styles.contentContainer}>
            
            {/* Top Hero Section */}
            <Animated.View 
              style={[
                styles.formHeaderArea, 
                { opacity: fadeAnim1, transform: [{ translateY: slideAnim1 }] }
              ]}
            >
              <Text style={styles.formTitle}>
                <Text style={[styles.serifItalic, { fontSize: 44 }]}>Create </Text>
                <Text style={[styles.sansText, { fontSize: 36 }]}>Account</Text>
              </Text>
              <Text style={styles.formSubtext}>
                Join the verified college network.
              </Text>
            </Animated.View>

            {/* Form Section */}
            <Animated.View 
              style={[
                styles.formArea,
                { opacity: fadeAnim2, transform: [{ translateY: slideAnim2 }] }
              ]}
            >
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
                {!hasYear && emailPrefix.length > 3 && (
                  <Text style={styles.domainHint}>Include your admission year (e.g. 2024)</Text>
                )}
                {emailPrefix.length > 0 && !emailPrefix.includes('@') && hasYear && (
                  <Text style={styles.domainHint}>@iem.edu.in will be added</Text>
                )}
              </View>

              <View style={styles.newInputGroup}>
                <Text style={styles.newInputLabel}>Password</Text>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={styles.newInputPillPassword}
                    placeholder="Min. 8 characters"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={password}
                    onChangeText={(text: string) => {
                      setPassword(text);
                      if (error) setError('');
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={!showPassword}
                    returnKeyType="done"
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
            </Animated.View>



            {/* CTA & Footer Section */}
            <Animated.View 
              style={[
                styles.footerArea,
                { opacity: fadeAnim4, transform: [{ translateY: slideAnim4 }] }
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.newLoginBtn,
                  (!canContinue) && styles.newLoginBtnDisabled
                ]}
                onPress={handleContinue}
                disabled={!canContinue || loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <Text style={styles.newLoginBtnText}>Sending Code...</Text>
                ) : (
                  <Text style={styles.newLoginBtnText}>Continue</Text>
                )}
              </TouchableOpacity>

              <View style={styles.footer}>
                <TouchableOpacity onPress={() => navigation.navigate('Login', { initialForm: 'email' })} activeOpacity={0.7}>
                  <Text style={styles.footerText}>
                    Already have an account? <Text style={styles.footerTextBold}>Log In</Text>
                  </Text>
                </TouchableOpacity>
              </View>
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
  scrollContent: {
    flexGrow: 1,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 20 : 60,
  },
  contentContainer: {
    paddingHorizontal: 32,
    flex: 1,
    paddingBottom: Platform.OS === 'ios' ? 40 : 40,
  },

  // Header Typography
  formHeaderArea: {
    marginTop: 40,
    marginBottom: 40,
    alignItems: 'flex-start',
    width: '100%',
  },
  formTitle: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  formSubtext: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 22,
    paddingRight: 32,
  },
  serifItalic: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic', 
  },
  sansText: {
    fontFamily: 'Inter_700Bold', 
    letterSpacing: -1.5,
    color: '#FFF',
  },


  formArea: {
    marginBottom: 10,
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
    backgroundColor: 'rgba(50,50,50,0.5)', 
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)', 
    borderRadius: 30, 
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
    paddingRight: 60,
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



  // Buttons & Footer Area
  footerArea: {
    width: '100%',
  },
  newLoginBtn: {
    width: '100%',
    height: 60,
    backgroundColor: '#E84A3B',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 24,
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
  footer: {
    alignItems: 'center',
    marginTop: 'auto', // Pushes the footer to the very bottom if there is space
  },
  footerText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 15,
  },
  footerTextBold: {
    color: '#FFF',
    fontWeight: '700',
  },
});
