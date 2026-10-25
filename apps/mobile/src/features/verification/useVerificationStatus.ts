import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../../services/api';
import { useVerificationPreview } from './VerificationPreviewContext';
import { getSocket, onSocketChange } from '../../services/socket';
import type { Socket } from 'socket.io-client';

/**
 * What the app shows about verifying a college (features/auth/GOOGLE_SIGNUP_PLAN.md 2, 4, 5):
 * the badge, what is limited and how much is left, the grace period, and when
 * a verification runs out. One read, shared by every screen that asks.
 */
export type VerificationStatus = {
  verified: boolean;
  expired: boolean;
  limited: boolean;
  likesLeft: number | null;
  dailyLikeLimit: number;
  chatLeft: number | null;
  chatLimit: number;
  roseTrialAvailable: boolean;
  paused: boolean;
  graceEndsAt: string | null;
  graceDaysLeft: number | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  signedUpWithGoogle: boolean;
  campusName: string | null;
  realPersonVerified: boolean;
  realPersonRequired: boolean;
  /** A Google account that still owes the selfie (once required): counts towards the 14 days. */
  owesRealPerson: boolean;
  collegeShortName: string | null;
};

let cached: VerificationStatus | null = null;
let inFlight: Promise<VerificationStatus | null> | null = null;
const listeners = new Set<(status: VerificationStatus | null) => void>();

/** Reads the status again and tells every screen showing it. */
export function refreshVerificationStatus() {
  inFlight ??= api.get('/verification/status')
    .then((response) => {
      cached = response.data.data as VerificationStatus;
      listeners.forEach((listener) => listener(cached));
      return cached;
    })
    .catch(() => cached)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Live: the server says the verification changed (a selfie-check result, a
 * team decision) - re-read once for every screen. A reconnect re-reads too.
 */
let liveSocket: Socket | null = null;
const reread = () => { if (listeners.size) void refreshVerificationStatus(); };
function bindLive(socket: Socket | null) {
  if (liveSocket === socket) return;
  liveSocket?.off('verification_changed', reread);
  liveSocket?.off('connect', reread);
  liveSocket = socket;
  socket?.on('verification_changed', reread);
  socket?.on('connect', reread);
}
onSocketChange(bindLive);

/** Forgets the status, as signing out does. */
export function clearVerificationStatus() {
  cached = null;
  listeners.forEach((listener) => listener(null));
}

export function useVerificationStatus() {
  const preview = useVerificationPreview();
  const [status, setStatus] = useState<VerificationStatus | null>(cached);
  useEffect(() => {
    if (preview) return;
    bindLive(getSocket());
    listeners.add(setStatus);
    return () => { listeners.delete(setStatus); };
  }, [preview]);
  useFocusEffect(useCallback(() => { if (!preview) void refreshVerificationStatus(); }, [preview]));
  return preview?.status ?? status;
}
