export function clampPlaybackTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(duration, seconds));
}

export function playbackClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export type PendingVideoSeek = { target: number; startedAt: number; resumes: boolean };

/** Keep queued playback events from resetting the thumb after a seek. */
export function matchesPendingVideoSeek(seconds: number, pending: PendingVideoSeek, now: number): boolean {
  if (!Number.isFinite(seconds)) return false;
  const elapsed = pending.resumes ? Math.max(0, now - pending.startedAt) / 1000 : 0;
  return seconds >= pending.target - 0.15 && seconds <= pending.target + elapsed + 0.15;
}

/** Send the first position now, then only the latest position each display frame. */
export function createLiveVideoSeekQueue(
  seek: (seconds: number) => void,
  schedule: (callback: () => void) => number = requestAnimationFrame,
  cancelFrame: (id: number) => void = cancelAnimationFrame,
) {
  let frame: number | null = null;
  let pending: number | null = null;
  let sent: number | null = null;
  const send = (seconds: number) => {
    if (sent !== null && Math.abs(seconds - sent) < 0.001) return;
    sent = seconds;
    seek(seconds);
  };
  const drain = () => {
    frame = null;
    if (pending === null) return;
    const next = pending;
    pending = null;
    send(next);
    frame = schedule(drain);
  };
  const cancel = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    pending = null;
    sent = null;
  };
  return {
    move(seconds: number) {
      if (frame === null) {
        send(seconds);
        frame = schedule(drain);
      } else pending = seconds;
    },
    finish(seconds: number) {
      cancel();
      // Always seek again after restoring exact precision, even at the same time.
      seek(seconds);
    },
    cancel,
  };
}
