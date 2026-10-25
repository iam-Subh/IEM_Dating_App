import type { VideoPlayer } from 'expo-video';

// Transfer the opening buffer to the viewer instead of constructing it twice.
// Keep at most one player. Release it if opening is cancelled or never mounts.
let prepared: { uri: string; player: VideoPlayer; timer: ReturnType<typeof setTimeout> } | null = null;

export function retainStoryVideo(uri: string, player: VideoPlayer): void {
  discardStoryVideo();
  prepared = { uri, player, timer: setTimeout(() => discardStoryVideo(uri), 10_000) };
}

export function takeStoryVideo(uri: string): VideoPlayer | null {
  if (!prepared || prepared.uri !== uri) return null;
  const entry = prepared;
  prepared = null;
  clearTimeout(entry.timer);
  return entry.player;
}

export function discardStoryVideo(uri?: string): void {
  if (!prepared || (uri && prepared.uri !== uri)) return;
  const entry = prepared;
  prepared = null;
  clearTimeout(entry.timer);
  entry.player.release();
}
