import { Platform } from 'react-native';
import { ChatMedia } from '../../../modules/chat-media';

type Kind = 'photo' | 'video' | 'file';
const UPDATE_MS = 500;

/** "photo", "3 photos", "video", "2 files", "4 items" - what a message is sending. */
export function mediaLabel(kinds: readonly Kind[]) {
  const count = kinds.length;
  const kind = kinds.every((value) => value === kinds[0]) ? kinds[0] : null;
  const noun = kind === 'photo' ? 'photo' : kind === 'video' ? 'video' : kind === 'file' ? 'file' : 'item';
  return count === 1 ? noun : `${count} ${noun}s`;
}

const capitalised = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * One message's media sending, in the status bar: "Sending 3 photos · 45%",
 * then "3 photos sent" for a few seconds, or "Couldn't send". Files large
 * enough for the background uploader already show its bar (`nativeBar`), so
 * only the outcome is added for them. Nothing on platforms without it.
 */
export function createMediaSendNotice(key: string, kinds: readonly Kind[], nativeBar = false) {
  const native = Platform.OS === 'android' ? ChatMedia : null;
  const label = mediaLabel(kinds);
  const progress = kinds.map(() => 0);
  let lastShown = 0;
  let over = false;
  const show = (force = false) => {
    if (!native?.showTransferProgress || nativeBar || over) return;
    const now = Date.now();
    if (!force && now - lastShown < UPDATE_MS) return;
    lastShown = now;
    const percent = Math.round(progress.reduce((sum, value) => sum + value, 0) / Math.max(1, progress.length));
    try { native.showTransferProgress(key, `Sending ${label}`, percent); } catch { /* notifications are optional */ }
  };
  return {
    start() { show(true); },
    /** One file's progress, 0-100. */
    update(index: number, percent: number) {
      progress[index] = Math.max(progress[index] ?? 0, Math.min(100, percent));
      show();
    },
    done() {
      if (over) return;
      over = true;
      try { native?.finishTransfer?.(key, `${capitalised(label)} sent`, null, true); } catch { /* optional */ }
    },
    failed() {
      if (over) return;
      over = true;
      try { native?.finishTransfer?.(key, `Couldn't send ${label}`, 'Open the chat to try again.', false); } catch { /* optional */ }
    },
    cancel() {
      over = true;
      try { native?.cancelTransfer?.(key); } catch { /* optional */ }
    },
  };
}
