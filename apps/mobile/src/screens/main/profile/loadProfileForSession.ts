type Session = { user: { id: string } | null; token: string | null };
type ProfileResponse = { data: { success?: boolean; data?: { id: string; [key: string]: unknown } } };

/** An old request cannot replace the current account's profile. */
export async function loadProfileForSession({ accountId, signal, getSession, fetchProfile, applyProfile }: {
  accountId: string;
  signal: AbortSignal;
  getSession: () => Session;
  fetchProfile: (signal: AbortSignal) => Promise<ProfileResponse>;
  applyProfile: (profile: NonNullable<ProfileResponse['data']['data']>) => void;
}): Promise<void> {
  const isCurrent = () => {
    const session = getSession();
    return !signal.aborted && session.user?.id === accountId && !!session.token;
  };
  if (!isCurrent()) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchProfile(signal);
      if (isCurrent() && response.data.success && response.data.data?.id === accountId) {
        applyProfile(response.data.data);
      }
      return;
    } catch (error) {
      if (!isCurrent()) return;
      const failure = error as { message?: string; code?: string; name?: string } | null;
      if (failure?.code === 'ERR_CANCELED' || failure?.name === 'AbortError') return;
      if (failure?.message === 'Session changed') {
        // Retry with a new request config after this account's token becomes ready.
        if (attempt === 0) continue;
        return;
      }
      throw error;
    }
  }
}
