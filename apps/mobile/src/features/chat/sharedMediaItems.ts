/**
 * What each Shared media tab lists, derived from the messages the server sent.
 *
 * Kept free of React and React Native imports so the rules can be unit tested:
 * which attachments become grid cells, and what counts as a link.
 */

export type SharedType = 'media' | 'document' | 'voice' | 'link';

export type SharedMessage = {
  id: string;
  content: string;
  sentAt: string;
  type?: string;
  mediaKey?: string | null;
  mediaKeys?: string[] | null;
  metadata?: Record<string, any> | null;
};

export type SharedPage = { messages: SharedMessage[]; nextCursor: string | null; hasMore: boolean };

/** One grid cell per attachment: an album of five photos is five cells. */
export type MediaCell<T extends SharedMessage> = { kind: 'media'; id: string; message: T; mediaKey: string };
export type RowItem<T extends SharedMessage> = { kind: 'row'; id: string; message: T; url?: string };
export type SharedItem<T extends SharedMessage> = MediaCell<T> | RowItem<T>;

const URL_PATTERN = /(https?:\/\/[^\s<>{}[\]]+|www\.[^\s<>{}[\]]+)/i;

export function firstUrl(value: string | undefined | null): string | null {
  const match = value?.match(URL_PATTERN)?.[0]?.replace(/[),.!?]+$/, '');
  if (!match) return null;
  return match.toLowerCase().startsWith('www.') ? `https://${match}` : match;
}

export function isAudioKey(key: string): boolean {
  const value = key.toLowerCase();
  return value.includes('voice') || value.includes('audio') || /\.(m4a|mp3|wav|aac|ogg|pcm)$/.test(value);
}

export function mediaKeysOf(message: SharedMessage): string[] {
  if (message.mediaKeys?.length) return message.mediaKeys;
  return message.mediaKey ? [message.mediaKey] : [];
}

export function fileNameOf(message: SharedMessage): string {
  const document = message.metadata?.document as { fileName?: string } | undefined;
  if (document?.fileName) return document.fileName;
  // Falling straight back to "Document" made every row read the same while the
  // real names were still arriving.
  const tail = mediaKeysOf(message)[0]?.split('/').pop();
  if (!tail) return 'File';
  try { return decodeURIComponent(tail); } catch { return tail; }
}

export function formatSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A voice message carries its length, in seconds, as its content. */
export function formatVoiceDuration(content: string): string | null {
  const seconds = Number.parseFloat(content);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || url;
}

export function itemsFor<T extends SharedMessage>(type: SharedType, pages: Array<{ messages: T[] }> | undefined): Array<SharedItem<T>> {
  const items: Array<SharedItem<T>> = [];
  const seen = new Set<string>();
  for (const page of pages ?? []) {
    for (const message of page.messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      if (type === 'media') {
        mediaKeysOf(message).forEach((mediaKey, index) => {
          if (!isAudioKey(mediaKey)) items.push({ kind: 'media', id: `${message.id}:${index}`, message, mediaKey });
        });
      } else if (type === 'link') {
        // A voice note is never a link, whatever its stored content says.
        if (message.type === 'voice' || mediaKeysOf(message).some(isAudioKey)) continue;
        const url = firstUrl(message.content);
        if (url) items.push({ kind: 'row', id: message.id, message, url });
      } else {
        items.push({ kind: 'row', id: message.id, message });
      }
    }
  }
  return items;
}
