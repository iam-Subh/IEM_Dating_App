export const PROFILE_VIDEO_MIN_SECONDS = 15;
export const PROFILE_VIDEO_MAX_SECONDS = 60;

// Read elapsed time from the clock. Delayed UI updates cannot add timer drift.
export function recordingSeconds(startedAt: number | null, now: number) {
  if (startedAt === null) return 0;
  return Math.min(PROFILE_VIDEO_MAX_SECONDS, Math.max(0, Math.floor((now - startedAt) / 1000)));
}

export function recordingTimeLabel(seconds: number) {
  const value = Math.min(PROFILE_VIDEO_MAX_SECONDS, Math.max(0, Math.floor(seconds)));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
