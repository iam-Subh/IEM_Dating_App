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
  TextInput,
  ScrollView,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AnimatedBlurBackground } from '../../../components/ui/AnimatedBlurBackground';
import { colors } from '../../../core/theme/colors';
import { api } from '../../../services/api';

export const PhoneLoginScreen = () => {
  const [phoneNumber, setPhoneNumber] = useState('');
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
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const navigation = useNavigation<any>();

  const isValid = /^\d{10}$/.test(phoneNumber.trim());

  // Animations
  const fadeAnim1 = useRef(new Animated.Value(0)).current;
  const slideAnim1 = useRef(new Animated.Value(30)).current;
  
  const fadeAnim2 = useRef(new Animated.Value(0)).current;
  const slideAnim2 = useRef(new Animated.Value(30)).current;

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

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const handleSendOTP = useCallback(async () => {
    if (!isValid) {
      setError('Enter a valid 10-digit phone number');
      return;
    }
    setError('');
    setLoading(true);

    const fullPhone = `+91${phoneNumber.trim()}`;

    try {
      const response = await api.post('/auth/send-phone-otp', { phone: fullPhone });
      setLoading(false);
      navigation.navigate('PhoneOTPVerification', { phone: fullPhone, challengeId: response.data.data.challengeId });
    } catch (err: any) {
      setLoading(false);
      const msg = err.response?.data?.message || 'Failed to send code.';
      setError(msg);
    }
  }, [phoneNumber, isValid, navigation]);

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      <AnimatedBlurBackground />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView 
          contentContainerStyle={[
            styles.scrollContent,
            isKeyboardVisible && styles.scrollContentKeyboardOpen,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
        <View style={[styles.contentContainer, isKeyboardVisible && styles.contentContainerKeyboardOpen]}>
          
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
                Sign in with your phone number to continue.
              </Text>
            </Animated.View>

          <Animated.View 
            style={[
              styles.bottomArea,
              { opacity: fadeAnim2, transform: [{ translateY: slideAnim2 }] }
            ]}
          >
            <View style={styles.formContainer}>
              
              <View style={styles.newInputGroup}>
                <Text style={styles.newInputLabel}>Phone Number</Text>
                <View style={[
                  styles.phoneField,
                  isInputFocused && styles.phoneFieldFocused,
                  !!error && styles.phoneFieldError,
                ]}>
                  <View style={styles.countryCodeSection}>
                    <Text style={styles.flag}>🇮🇳</Text>
                    <Text style={styles.countryCodeText}>+91</Text>
                  </View>
                  <View style={styles.phoneFieldDivider} />
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="Enter 10-digit number"
                    placeholderTextColor="rgba(255,255,255,0.38)"
                    value={phoneNumber}
                    onChangeText={(text) => {
                      setPhoneNumber(text.replace(/[^0-9]/g, '').slice(0, 10));
                      if (error) setError('');
                    }}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    keyboardType="phone-pad"
                    maxLength={10}
                    returnKeyType="go"
                    onSubmitEditing={handleSendOTP}
                  />
                </View>
                
                {phoneNumber.length > 0 && phoneNumber.length < 10 && (
                  <Text style={styles.domainHint}>{10 - phoneNumber.length} more digits needed</Text>
                )}
              </View>

              {error ? <Text style={styles.newErrorText}>{error}</Text> : null}

              {/* Redesigned Primary Call to Action */}
              <TouchableOpacity
                style={[
                  styles.newLoginBtn,
                  !isValid && styles.newLoginBtnDisabled,
                  isValid && styles.newLoginBtnActive,
                ]}
                onPress={handleSendOTP}
                disabled={!isValid || loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <>
                    <ActivityIndicator size="small" color="#FFF" />
                    <Text style={styles.newLoginBtnText}>Sending code</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.newLoginBtnText}>Send verification code</Text>
                    <MaterialCommunityIcons name="arrow-right" size={20} color={isValid ? "#FFF" : "rgba(255,255,255,0.5)"} style={styles.btnIconRedesigned} />
                  </>
                )}
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
  },
  scrollContentKeyboardOpen: {
    justifyContent: 'flex-end',
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 20 : 60,
    paddingBottom: Platform.OS === 'ios' ? 72 : 52,
  },
  contentContainerKeyboardOpen: {
    flex: 0,
    justifyContent: 'flex-end',
    paddingTop: 16,
    paddingBottom: 14,
  },
  
  // Header Typography
  formHeaderArea: {
    marginBottom: 32,
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
    color: '#FFF',
  },
  serifItalic: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic', 
  },
  sansText: {
    fontFamily: 'Inter_700Bold', 
    letterSpacing: -1.5,
  },
  formSubtext: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 22,
    paddingRight: 32, // Keep line length readable
  },

  // Bottom Area & Forms
  bottomArea: {
    width: '100%',
  },
  formContainer: {
    width: '100%',
  },
  newInputGroup: {
    marginBottom: 14,
  },
  newInputLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.82)',
    fontFamily: 'Inter_500Medium',
    marginBottom: 9,
    marginLeft: 4,
    letterSpacing: 0.3,
  },
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    backgroundColor: 'rgba(18, 13, 17, 0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 18,
    overflow: 'hidden',
  },
  phoneFieldFocused: {
    backgroundColor: 'rgba(18, 13, 17, 0.72)',
    borderColor: 'rgba(255,255,255,0.55)',
  },
  phoneFieldError: {
    borderColor: 'rgba(255,107,107,0.8)',
  },
  countryCodeSection: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: 15,
    gap: 7,
  },
  flag: {
    fontSize: 17,
  },
  countryCodeText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },
  phoneFieldDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  phoneInput: {
    flex: 1,
    alignSelf: 'stretch',
    paddingHorizontal: 16,
    paddingVertical: 0,
    fontSize: 16,
    color: '#FFF',
    fontWeight: '500',
    letterSpacing: 0.7,
  },
  domainHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginLeft: 4,
    marginTop: 6,
    fontWeight: '500',
  },
  newErrorText: {
    color: '#FF6B6B',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 10,
    fontWeight: '500',
  },
  
  // Buttons
  newLoginBtn: {
    width: '100%',
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  newLoginBtnActive: {
    backgroundColor: '#E84A3B',
    borderColor: 'rgba(255,255,255,0.2)',
    shadowColor: '#E84A3B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 6,
  },
  newLoginBtnDisabled: {
    opacity: 0.6,
  },
  newLoginBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  btnIconRedesigned: {
    opacity: 0.9,
  },
});
