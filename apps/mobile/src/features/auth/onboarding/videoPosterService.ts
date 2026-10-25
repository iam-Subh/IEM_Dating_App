import {Platform} from 'react-native';
import {createVideoPlayer} from 'expo-video';
import {ImageManipulator, SaveFormat} from 'expo-image-manipulator';
import {createVideoPosterCache, type VideoPoster} from './videoPosterCache';

async function extractPoster(uri: string): Promise<VideoPoster> {
  if (Platform.OS === 'web') throw new Error('Native thumbnails are unavailable on web');
  // This temporary decoder has no video surface and never plays the video.
  const player = createVideoPlayer(null);
  player.muted = true;
  let cancelLoad = () => {};
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const subscriptions: {remove: () => void}[] = [];
      const cleanup = () => {clearTimeout(timer); subscriptions.forEach(s => s.remove());};
      const fail = (error: unknown) => {cleanup(); reject(error);};
      const timer = setTimeout(() => fail(new Error('Video thumbnail timed out')), 15000);
      cancelLoad = cleanup;
      subscriptions.push(player.addListener('sourceLoad', event => {cleanup(); resolve(event.duration);}));
      subscriptions.push(player.addListener('statusChange', event => {
        if (event.status === 'error') fail(new Error(event.error?.message ?? 'Video could not load'));
      }));
      void player.replaceAsync({uri, useCaching: /^https?:/.test(uri)}).catch(fail);
    });
    const thumbnails = await player.generateThumbnailsAsync(Math.min(0.5, Math.max(0, duration - 0.05)), {maxWidth: 320, maxHeight: 420});
    try {
      if (!thumbnails[0]) throw new Error('Video thumbnail is unavailable');
      const context = ImageManipulator.manipulate(thumbnails[0]);
      try {
        const image = await context.renderAsync();
        try {
          const result = await image.saveAsync({format: SaveFormat.JPEG, compress: 0.9});
          return {uri: result.uri, duration};
        } finally {image.release();}
      } finally {context.release();}
    } finally {thumbnails.forEach(thumbnail => thumbnail.release());}
  } finally {cancelLoad(); player.release();}
}

export const videoPosters = createVideoPosterCache(extractPoster);
