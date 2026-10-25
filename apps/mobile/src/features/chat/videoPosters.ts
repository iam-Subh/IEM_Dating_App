import * as VideoThumbnails from 'expo-video-thumbnails';
import { ChatMedia } from '../../../modules/chat-media';

/**
 * Still frames of local videos, for the bubble shown while a video is sending.
 *
 * A chat bubble used to mount a full video player per message, and received
 * videos were downloaded in full just to draw one. Bubbles now show a poster
 * and a play button, the way Telegram does; this supplies that poster for a
 * video that exists only on this device so far.
 */
const posters = new Map<string, Promise<string>>();
const POSTER_HEIGHT = 720;

export function localVideoPoster(videoUri: string, timeMs = 0): Promise<string> {
  const key = `${videoUri}#${Math.round(timeMs)}`;
  let poster = posters.get(key);
  if (!poster) {
    poster = (ChatMedia
      ? ChatMedia.frameAt(videoUri, timeMs, POSTER_HEIGHT)
      : VideoThumbnails.getThumbnailAsync(videoUri, { time: timeMs, quality: 0.8 }).then((result) => result.uri))
      .catch((error) => {
        posters.delete(key);
        throw error;
      });
    posters.set(key, poster);
  }
  return poster;
}

/** The server's poster for a processed video key. */
export function videoPosterKey(mediaKey: string): string | null {
  return /\.mp4$/i.test(mediaKey) ? mediaKey.replace(/\.mp4$/i, '.thumbnail.jpg') : null;
}
