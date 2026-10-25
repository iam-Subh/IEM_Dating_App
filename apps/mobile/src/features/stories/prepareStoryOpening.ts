import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { loadStorySource, prepareStoryPhoto, type StorySource } from './storySources';
import { retainStoryVideo } from './preparedStoryVideo';

/** Keep loading in the tray until the first photo or video buffer is ready. */
export function prepareStoryOpening(storyId: string, signal: AbortSignal): Promise<StorySource> {
  return new Promise((resolve, reject) => {
    let active = true;
    let player: VideoPlayer | undefined;
    let listener: { remove(): void } | undefined;
    const finish = (source?: StorySource, error?: Error) => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      listener?.remove();
      if (source && player) retainStoryVideo(source.url, player);
      else player?.release();
      if (source) resolve(source);
      else reject(error ?? new Error('Story could not load'));
    };
    const abort = () => finish(undefined, new Error('Story opening cancelled'));
    const timer = setTimeout(() => finish(undefined, new Error('Story loading timed out')), 20_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void (async () => {
      const source = await loadStorySource(storyId);
      if (!active) return;
      // A locked Reveal story opens its hint, without loading private media.
      if (source.locked) { finish(source); return; }
      if (!source.url) throw new Error('Story media is unavailable');
      if (source.contentType.startsWith('video/')) {
        player = createVideoPlayer(null);
        player.muted = true;
        listener = player.addListener('statusChange', ({ status }) => {
          if (status === 'readyToPlay') finish(source);
          else if (status === 'error') finish(undefined, new Error('Story video could not load'));
        });
        await player.replaceAsync({ uri: source.url, useCaching: true });
        if (active && player.status === 'readyToPlay') finish(source);
      } else {
        // Cached metadata can arrive before its background image prefetch ends.
        const loaded = await prepareStoryPhoto(source.url);
        if (!loaded) throw new Error('Story photo could not load');
        finish(source);
      }
    })().catch(error => finish(undefined, error instanceof Error ? error : new Error('Story could not load')));
  });
}
