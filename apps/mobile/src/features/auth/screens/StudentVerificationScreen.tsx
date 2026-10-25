import {StudentVerificationEntry} from '../onboarding/StudentVerificationEntry';
import { refreshVerificationStatus } from '../../verification/useVerificationStatus';
import React, { useEffect, useState } from 'react';
import {Alert} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { api } from '../../../services/api';
import type { RootState } from '../../../store';
import { setCredentials, setNextRequiredStep, updateUser } from '../../../store/authSlice';
import { credentialStore } from '../../../services/credentialStore';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';

type Institution = { id: string; code: string; name: string; campuses: string[]; domainShared?: boolean };

/**
 * Verify your college (GOOGLE_SIGNUP_PLAN.md 1.4): college, college email, the
 * code sent there - and a password when the account has none, so the college
 * email can sign in too. Google accounts open this page from Settings after
 * onboarding as "VerifyCollege".
 */
export const StudentVerificationScreen = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation<any>();
  const route = useRoute();
  // Opened from the app (Settings, a reminder), not the onboarding gate.
  const opened = route.name === 'VerifyCollege';
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionCode, setInstitutionCode] = useState('');
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [timer, setTimer] = useState(0);
  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => setTimer(value => value - 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);
  // A Google sign-up may verify later (GOOGLE_SIGNUP_PLAN.md reminder 1); a
  // college-email sign-up is verified at sign-up and never sees this choice.
  const isGoogle = useSelector((state: RootState) => !!state.auth.user?.googleSub);

  const later = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await api.post('/verification/student/later');
      dispatch(setNextRequiredStep(response.data.data.onboarding.nextRequiredStep));
    } catch (error: any) {
      Alert.alert('Something went wrong', error.response?.data?.message || 'Try again.');
    } finally { setBusy(false); }
  };

  /** "Use that one?": sign in to the account this college email already has. */
  const offerSwitch = (switchToken: string, losesSomething: boolean) => {
    const doSwitch = async () => {
      setBusy(true);
      try {
        const response = await api.post('/verification/switch-account', { switchToken });
        const data = response.data.data;
        await credentialStore.setRefreshToken(data.refreshToken);
        dispatch(setCredentials({ user: data.user, token: data.accessToken, nextRequiredStep: data.onboarding?.nextRequiredStep }));
      } catch (error: any) {
        Alert.alert('Could not switch', error.response?.data?.message || 'Verify again and try once more.');
      } finally { setBusy(false); }
    };
    Alert.alert(
      'You already have an account',
      'This college email already has an IEM Connect account. Use that one? Google will open it from now on, and this new account will be deleted.' +
        (losesSomething ? '\n\nThis account\'s matches and chats will be lost.' : ''),
      [
        { text: 'No', style: 'cancel' },
        { text: 'Use that one', style: losesSomething ? 'destructive' : 'default', onPress: () => void doSwitch() },
      ],
    );
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    Promise.all([api.get('/verification/institutions'), api.get('/auth/account')])
      .then(([collegeResponse, accountResponse]) => {
        if (!active) return;
        const list = collegeResponse.data.data as Institution[];
        setInstitutions(list);
        setNeedsPassword(!accountResponse.data.data.hasPassword);
        if (list.length === 1) setInstitutionCode(list[0].code);
      })
      .catch(() => { if (active) setLoadError('Could not load verification details. Select Retry.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  const sendCode = async (resend = false) => {
    if (busy || loading || loadError || !institutionCode || !email.trim()) return;
    setError('');
    setResending(resend);
    setBusy(true);
    try {
      const response = await api.post('/verification/student/send', { institutionCode, email: email.trim().toLowerCase() });
      setChallengeId(response.data.data.challengeId);
      setCode('');
      setTimer(60);
    } catch (error: any) {
      setError(error.response?.data?.message || 'Could not send the code. Try again.');
    } finally { setBusy(false); setResending(false); }
  };

  /**
   * uem.edu.in belongs to both UEM Kolkata and UEM Jaipur, so the email alone
   * cannot say which campus a student attends (LOCATION_SPEC.md 8.2). For
   * those colleges only, one approximate location check - used for that one
   * comparison and never stored. Declining is fine: you are still verified,
   * and an admin confirms the campus.
   */
  const askCampusCheck = () =>
    new Promise<{ latitude: number; longitude: number } | undefined>((resolve) => {
      Alert.alert(
        'Confirm your campus',
        'Your college email is shared by more than one IEM–UEM campus, so we check once, with your approximate location, which city you study in. It is used for this check only and is not stored.',
        [
          { text: 'Skip', style: 'cancel', onPress: () => resolve(undefined) },
          {
            text: 'Continue',
            onPress: async () => {
              try {
                const permission = await Location.requestForegroundPermissionsAsync();
                if (permission.status !== 'granted') return resolve(undefined);
                const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
                resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
              } catch {
                resolve(undefined);
              }
            },
          },
        ],
        { cancelable: false },
      );
    });

  const verify = async () => {
    if (busy || !challengeId || code.length !== 6 || (needsPassword && password.length < 8)) return;
    setError('');
    setBusy(true);
    try {
      const shared = institutions.find((institution) => institution.code === institutionCode)?.domainShared;
      const location = shared ? await askCampusCheck() : undefined;
      const response = await api.post('/verification/student/verify', {
        institutionCode,
        email: email.trim().toLowerCase(),
        challengeId,
        code,
        ...(location ? { location } : {}),
        ...(needsPassword ? { password } : {}),
      });
      if (response.data.data.membership.campusConfirmed === false) {
        Alert.alert(
          'Verified',
          "You're verified. We couldn't confirm your campus automatically, so an admin will check it. Until then you'll meet people from your own college only.",
        );
      }
      dispatch(updateUser({ college: response.data.data.membership.institution.name, claimedInstitutionId: null, isVerified: true }));
      // Every reminder and limit stops at once (GOOGLE_SIGNUP_PLAN.md 4).
      void refreshVerificationStatus();
      if (opened) {
        Alert.alert("You're verified ✓", 'Unlimited chat, photos and videos, Roses and Standouts are unlocked. Add the selfie check to get your blue badge.');
        if (navigation.canGoBack()) navigation.goBack();
      } else {
        dispatch(setNextRequiredStep(response.data.data.onboarding.nextRequiredStep));
      }
    } catch (error: any) {
      const data = error.response?.data;
      if (data?.code === 'COLLEGE_EMAIL_HAS_ACCOUNT' && data.details?.switchToken) {
        offerSwitch(data.details.switchToken, !!data.details.hasMatchesOrChats);
      } else {
        setError(data?.message || 'Check the code and try again.');
      }
      setCode('');
    } finally { setBusy(false); }
  };

  const changeEmail = () => {if (!busy) {setChallengeId(''); setCode(''); setError('');}};
  const back = () => {
    if (busy) return;
    if (challengeId) changeEmail();
    else if (navigation.canGoBack()) navigation.goBack();
    else if (isGoogle && !opened) void later();
  };
  return <StudentVerificationEntry
    institutions={institutions} institutionCode={institutionCode}
    onCollege={value => {setInstitutionCode(value); setError('');}}
    email={email} onEmail={value => {setEmail(value); setError('');}}
    code={code} onCode={value => {setCode(value); setError('');}}
    hasChallenge={!!challengeId} needsPassword={needsPassword} password={password} onPassword={setPassword}
    loading={loading} busy={busy} resending={resending} error={error} loadError={loadError} timer={timer}
    onRetry={() => setRetry(value => value + 1)} onBack={back}
    onSend={() => void sendCode()} onVerify={() => void verify()}
    onResend={() => {if (!timer && !busy) void sendCode(true);}}
    onLater={isGoogle && !opened ? () => void later() : undefined}
  />;
};
