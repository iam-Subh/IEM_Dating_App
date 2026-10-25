import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';

/**
 * Before verifying a college, a chat has limits (features/auth/GOOGLE_SIGNUP_PLAN.md 2.3):
 * 30 messages in all, voice notes but no photos or videos. And the other
 * side of a chat sees a quiet line once that limit is reached.
 */
export type ChatAllowance = {
  limited: boolean;
  left: number;
  limit: number;
  warnFrom: number;
  otherWaitingToVerify: boolean;
};

const OPEN: ChatAllowance = { limited: false, left: Infinity, limit: Infinity, warnFrom: Infinity, otherWaitingToVerify: false };

export function useChatAllowance(matchId: string) {
  const [allowance, setAllowance] = useState<ChatAllowance>(OPEN);
  const refresh = useCallback(async () => {
    try {
      const response = await api.get(`/chat/${matchId}/allowance`);
      const data = response.data.data;
      setAllowance(data.limited
        ? { limited: true, left: data.left, limit: data.limit, warnFrom: data.warnFrom, otherWaitingToVerify: !!data.otherWaitingToVerify }
        : { ...OPEN, otherWaitingToVerify: !!data.otherWaitingToVerify });
    } catch {
      // Offline: nothing is locked on the phone; the server still decides.
    }
  }, [matchId]);
  useEffect(() => { void refresh(); }, [refresh]);
  /** One message sent: counted down at once, confirmed by the server shortly after. */
  const noteSent = useCallback(() => {
    setAllowance((current) => (current.limited ? { ...current, left: Math.max(0, current.left - 1) } : current));
    setTimeout(() => { void refresh(); }, 1500);
  }, [refresh]);
  return { allowance, refresh, noteSent };
}
