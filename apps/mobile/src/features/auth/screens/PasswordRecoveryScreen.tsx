import { AuthEntryFrame, AuthField, AuthAction, auth } from '../onboarding/AuthEntryFrame';
import React, { useState } from 'react';
import { Alert, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {isOnboardingPreview} from '../../../development/onboardingPreviewRuntime';
import { api } from '../../../services/api';

export const PasswordRecoveryScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const previewReset = __DEV__ && isOnboardingPreview() && route.params?.previewReset;
  const [email, setEmail] = useState(previewReset ? 'firstname.lastname2024@iem.edu.in' : '');
  const [challengeId, setChallengeId] = useState(previewReset ? 'design-preview' : '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const response = await api.post('/auth/recovery/start', { email: email.trim().toLowerCase() });
      setChallengeId(response.data.data.challengeId);
    } catch (error: any) {
      // A Google account has no password to recover (GOOGLE_SIGNUP_PLAN.md 1.2).
      if (error.response?.data?.code === 'USE_GOOGLE_SIGN_IN') {
        Alert.alert('Sign in with Google', 'This account signs in with Google - go back and tap Continue with Google.');
      } else {
        Alert.alert('Cannot start recovery', error.response?.data?.message || 'Try again.');
      }
    } finally { setBusy(false); }
  };

  const complete = async () => {
    setBusy(true);
    try {
      await api.post('/auth/recovery/complete', {
        email: email.trim().toLowerCase(), challengeId, code, newPassword: password,
      });
      Alert.alert('Password changed', 'Sign in with your new password.', [
        { text: 'Continue', onPress: () => navigation.navigate('Login', { initialForm: 'email' }) },
      ]);
    } catch (error: any) {
      Alert.alert('Recovery failed', error.response?.data?.message || 'Check the code and try again.');
    } finally { setBusy(false); }
  };

  return <AuthEntryFrame title={challengeId ? 'Reset your\npassword' : 'Recover your password'} subtitle={challengeId ? 'Enter your email code.\nChoose a new password.' : 'Enter the email address for your account.'} colors={['#F1EDE4','#F1EDE4','#F1EDE4']} onBack={() => challengeId ? setChallengeId('') : navigation.goBack()} footer={null}>
    <AuthField label="Account email" icon="mail-outline" placeholder="firstname.lastname2024@iem.edu.in" style={auth.emailInput} value={email} onChangeText={value => {setEmail(value); setChallengeId('');}} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!busy && !challengeId} />
    {!!challengeId && <>
      <AuthField label="Verification code" icon="keypad-outline" placeholder="6-digit code" value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))} maxLength={6} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" editable={!busy} />
      <AuthField label="New password" placeholder="Create a password" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoComplete="new-password" editable={!busy} onToggle={()=>setShowPassword(!showPassword)} visible={showPassword} />
      <Text style={[auth.passwordRule,password.length>=8&&auth.passwordRuleMet]}>{password.length>=8?'✓ ':''}Use at least 8 characters.</Text>
    </>}
    <AuthAction label={challengeId ? 'Reset password' : 'Send recovery code'} onPress={challengeId ? complete : start} disabled={challengeId ? code.length !== 6 || password.length < 8 : !email.trim()} busy={busy} />
  </AuthEntryFrame>;
};
