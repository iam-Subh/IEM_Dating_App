import {AuthEntryFrame, AuthField, AuthAction, auth} from '../onboarding/AuthEntryFrame';
import {GoogleMark} from '../onboarding/GoogleMark';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, Pressable, Alert } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useDispatch } from 'react-redux';




import { api } from '../../../services/api';
import { setCredentials } from '../../../store/authSlice';
import { signInWithGoogle } from '../../../services/googleSignIn';
import {isOnboardingPreview} from '../../../development/onboardingPreviewRuntime';
import { credentialStore } from '../../../services/credentialStore';
import { PasswordPromptModal } from '../../../components/PasswordPromptModal';

export const LoginScreen = () => {
  const [googleHovered, setGoogleHovered] = useState(false);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  


  // From sign-up with an email that already has an account: start filled in.
  const [emailPrefix, setEmailPrefix] = useState(() => (typeof route.params?.email === 'string' ? route.params.email.replace(/@iem\.edu\.in$/i, '') : ''));
  // This screen can already be open behind sign-up: take the email when it arrives.
  useEffect(() => {
    const email = route.params?.email;
    if (typeof email === 'string' && email) setEmailPrefix(email.replace(/@iem\.edu\.in$/i, ''));
  }, [route.params?.email]);
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
  const emailFormatError = emailPrefix.includes('@') ? '@iem.edu.in is already added. Enter only the part before @, for example firstname.lastname2024.' : '';

  // Validation
  const isValidPrefix = emailPrefix.trim().length >= 3 && !emailFormatError;
  const hasYear = /\d{4}$/.test(emailPrefix.trim());
  const isFullyValid = isValidPrefix && hasYear && password.length >= 8;

  const handleContinue = useCallback(async () => {
    if (emailFormatError) return;
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
  }, [emailPrefix, password, isValidPrefix, emailFormatError, dispatch]);

  /** Sign in with Google: the same session and onboarding as an email sign-in. */
  const [googleBusy, setGoogleBusy] = useState(false);
  // The Gmail already has an account with a password: asked once, then Google
  // is connected to it (GOOGLE_SIGNUP_PLAN.md 1.2).
  const [linking, setLinking] = useState<{ idToken: string; email: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const finishGoogle = useCallback(async (resData: any) => {
    await credentialStore.setRefreshToken(resData.refreshToken);
    dispatch(setCredentials({ user: resData.user, token: resData.accessToken, nextRequiredStep: resData.onboarding?.nextRequiredStep }));
    if (resData.onboarding?.nextRequiredStep === 'profile') {
      navigation.navigate('HouseRules', { user: resData.user, token: resData.accessToken });
    }
  }, [dispatch, navigation]);
  const linkWithPassword = useCallback(async (value: string) => {
    if (!linking) return;
    setLinkBusy(true);
    setLinkError('');
    try {
      const response = await api.post('/auth/google/link-with-password', { idToken: linking.idToken, password: value });
      setLinking(null);
      await finishGoogle(response.data.data);
    } catch (err: any) {
      setLinkError(err?.response?.data?.message ?? 'That did not work. Check your connection and try again.');
    } finally {
      setLinkBusy(false);
    }
  }, [finishGoogle, linking]);
  const handleGoogle = useCallback(async () => {
    if (__DEV__ && isOnboardingPreview()) {navigation.navigate('HouseRules'); return;}
    if (googleBusy) return;
    setError('');
    setGoogleBusy(true);
    try {
      const result = await signInWithGoogle();
      if (result.kind === 'cancelled') return;
      if (result.kind === 'error') {
        Alert.alert('Google sign-in', result.message);
        return;
      }
      try {
        const response = await api.post('/auth/google', { idToken: result.idToken });
        await finishGoogle(response.data.data);
      } catch (err: any) {
        if (err?.response?.data?.code !== 'GOOGLE_NEEDS_PASSWORD') throw err;
        setLinkError('');
        setLinking({ idToken: result.idToken, email: err.response.data.details?.email ?? '' });
      }
    } catch (err: any) {
      const code = err?.response?.data?.code;
      Alert.alert(
        code === 'GOOGLE_EMAIL_HAS_ACCOUNT' ? 'You already have an account' : 'Google sign-in',
        err?.response?.data?.message ?? 'Google sign-in did not work. Check your connection and try again.',
      );
    } finally {
      setGoogleBusy(false);
    }
  }, [finishGoogle, googleBusy]);

  const googleStarted = useRef(false);
  useEffect(() => {
    if (route.params?.initialMethod === 'google' && !googleStarted.current) {
      googleStarted.current = true;
      void handleGoogle();
    }
  }, [route.params?.initialMethod, handleGoogle]);
  return <>
    <AuthEntryFrame title="Welcome back" subtitle="Sign in to your account." colors={['#F1EDE4','#F1EDE4','#F1EDE4']} onBack={() => navigation.goBack()} footer={<>
      <View style={auth.divider}><View style={auth.line}/><Text style={auth.or}>or</Text><View style={auth.line}/></View>
      <Pressable accessibilityRole="button" accessibilityState={{disabled:googleBusy || loading,busy:googleBusy}} onPress={handleGoogle} disabled={googleBusy || loading} onHoverIn={()=>setGoogleHovered(true)} onHoverOut={()=>setGoogleHovered(false)} style={({pressed})=>[auth.google,(pressed||googleHovered)&&auth.googleActive]}><GoogleMark/><Text style={auth.googleText}>{googleBusy ? 'Connecting…' : 'Continue with Google'}</Text></Pressable>
      <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('SignUp')} style={[auth.switch,auth.switchCompact]}><Text style={auth.switchText}>New here? <Text style={auth.link}>Create an account</Text></Text></TouchableOpacity>
    </>}>
      <AuthField label="College email" suffix={domain} value={emailPrefix} onChangeText={setEmailPrefix} placeholder="firstname.lastname2024" style={auth.emailInput} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="username" />
      {!!emailFormatError&&<Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={auth.fieldError}>{emailFormatError}</Text>}
      <AuthField label="Password" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoComplete="current-password" onToggle={()=>setShowPassword(!showPassword)} visible={showPassword}/>
      <TouchableOpacity accessibilityRole="button" hitSlop={{top:6,bottom:6,left:6,right:6}} onPress={() => navigation.navigate('PasswordRecovery')} style={auth.utility}><Text style={auth.link}>Forgot password?</Text></TouchableOpacity>
      {!!error&&<Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={auth.error}>{error}</Text>}
      <AuthAction label="Sign in" onPress={handleContinue} disabled={!isFullyValid || googleBusy} busy={loading}/>
    </AuthEntryFrame>
    <PasswordPromptModal visible={!!linking} title="Connect Google" message={`${linking?.email || 'This email'} already has an IEM Connect account. Enter its password to connect Google.`} confirmLabel="Connect" busy={linkBusy} error={linkError} onSubmit={linkWithPassword} onCancel={() => setLinking(null)} />
  </>;
};

