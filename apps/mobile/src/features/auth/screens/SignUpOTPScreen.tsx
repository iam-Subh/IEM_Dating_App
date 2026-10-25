import { EmailCodeEntry } from '../onboarding/EmailCodeEntry';

import React, { useState, useEffect } from "react";

import { useRoute, useNavigation } from "@react-navigation/native";
import { useDispatch } from "react-redux";

import { api } from "../../../services/api";
import { setCredentials } from "../../../store/authSlice";


import { credentialStore } from "../../../services/credentialStore";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;

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
  const [error, setError] = useState('');

  // Countdown
  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const handleVerify = async (code: string) => {
    if (verifying || code.length !== OTP_LENGTH) return;
    setError('');
    setVerifying(true);


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

      setSuccess(true);

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
      }, 0);
    } catch (err: any) {
      setVerifying(false);
      setOtp(Array(OTP_LENGTH).fill(""));

      const msg =
        err.response?.data?.message || 'Could not verify the code. Try again or request another code.';
      setError(msg);
    }
  };

  const handleResend = async () => {
    if (timer > 0 || isResending) return;
    setError('');
    setIsResending(true);
    try {
      const response = await api.post("/auth/send-otp", { email });
      setChallengeId(response.data.data.challengeId);
      setTimer(RESEND_COOLDOWN);
      setOtp(Array(OTP_LENGTH).fill(""));
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not send the code. Try again.');
    } finally {
      setIsResending(false);
    }
  };

  return <EmailCodeEntry
    email={email || ''} code={otp.join('')}
    onChangeCode={value => {setOtp(value.split('')); setError('');}}
    onBack={() => navigation.goBack()}
    onVerify={() => handleVerify(otp.join(''))}
    onResend={handleResend} timer={timer}
    verifying={verifying} resending={isResending}
    error={error} success={success}
  />;
};
