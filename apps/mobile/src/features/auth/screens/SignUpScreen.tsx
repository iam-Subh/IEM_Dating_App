import {AuthEntryFrame, AuthField, AuthAction, auth} from '../onboarding/AuthEntryFrame';

import React, { useState, useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';



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
  // Use the account's sign-in method in the single footer link.
  const [registered, setRegistered] = useState<{ email: string; signIn: 'google' | 'password' } | null>(null);
  const domain = '@iem.edu.in';
  const emailFormatError = emailPrefix.includes('@') ? '@iem.edu.in is already added. Enter only the part before @, for example firstname.lastname2024.' : '';
  const navigation = useNavigation<any>();

  // Validation
  const isValidPrefix = emailPrefix.trim().length >= 3 && !emailFormatError;
  const hasYear = /\d{4}$/.test(emailPrefix.trim());
  const isEmailValid = isValidPrefix && hasYear;
  const isPasswordValid = password.length >= 8;
  const canContinue = isEmailValid && isPasswordValid;
  const existingAccount = registered?.email === `${emailPrefix.trim().toLowerCase()}${domain}` ? registered : null;
  const openSignIn = () => navigation.navigate('Login', existingAccount?.signIn === 'google'
    ? { initialMethod: 'google' }
    : { initialForm: 'email', ...(existingAccount ? { email: existingAccount.email } : {}) });

  const handleContinue = useCallback(async () => {
    if (emailFormatError) return;
    if (!isEmailValid) {
      setError('Include your admission year (e.g. 2024)');
      return;
    }
    if (!isPasswordValid) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError('');
    setRegistered(null);
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
      if (err.response?.data?.code === 'EMAIL_ALREADY_REGISTERED') {
        setError('This email already has an account.');
        setRegistered({ email: fullEmail, signIn: err.response.data.details?.signIn === 'google' ? 'google' : 'password' });
      }
    }
  }, [emailPrefix, password, isEmailValid, isPasswordValid, emailFormatError, navigation]);

  return <AuthEntryFrame title="Create an account" subtitle="Start with your college email." headingStyle={styles.heading} colors={['#F1EDE4','#F1EDE4','#F1EDE4']} onBack={() => navigation.goBack()} footer={
    <TouchableOpacity accessibilityRole="button" onPress={openSignIn} style={[auth.switch, auth.switchCompact]}><Text style={auth.switchText}>Already have an account? <Text style={auth.link}>{existingAccount?.signIn === 'google' ? 'Sign in with Google' : 'Sign in'}</Text></Text></TouchableOpacity>
  }>
    <AuthField label="College email" suffix={domain} placeholder="firstname.lastname2024" style={auth.emailInput} value={emailPrefix} onChangeText={setEmailPrefix} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
    {!!emailFormatError&&<Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={auth.fieldError}>{emailFormatError}</Text>}
    <AuthField label="Password" placeholder="Create a password" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoComplete="new-password" onToggle={()=>setShowPassword(!showPassword)} visible={showPassword}/>
    <Text style={[auth.passwordRule,styles.passwordRule,isPasswordValid&&auth.passwordRuleMet]}>{isPasswordValid?'✓ ':''}Use at least 8 characters.</Text>
    {!!error&&<Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[auth.error,styles.error]}>{error}</Text>}
    <AuthAction label="Send code" backgroundColor="#712C48" onPress={handleContinue} disabled={!canContinue} busy={loading}/>
  </AuthEntryFrame>;
};

const styles = StyleSheet.create({
  heading: { marginBottom: 28 },
  passwordRule: { marginBottom: 10 },
  error: { marginBottom: 4 },
});
