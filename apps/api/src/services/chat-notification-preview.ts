type PreviewMessage = { type: string; content?: string | null; metadata?: unknown; mediaKeys?: string[]; photoUrl?: string | null };
const segmenter = new (Intl as unknown as { Segmenter: new (locale: string, options: { granularity: string }) => { segment(value: string): Iterable<{ segment: string }> } }).Segmenter('en', { granularity: 'grapheme' });

export function truncateNotificationText(value: string, limit = 500): string {
  if (value.length <= limit) return value;
  let result = '';
  for (const { segment } of segmenter.segment(value)) {
    if (result.length + segment.length > limit - 1) break;
    result += segment;
  }
  return result + '…';
}

export function notificationReplySnippet(message: PreviewMessage): string {
  const metadata = (message.metadata && typeof message.metadata === 'object' ? message.metadata : {}) as Record<string, any>;
  if (message.type === 'voice') {
    const value = typeof metadata.durationSeconds === 'number' ? metadata.durationSeconds : message.content?.trim() ? Number(message.content) : NaN;
    const seconds = Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
    return `Voice message${seconds === null ? '' : ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})`}`;
  }
  if (message.type === 'document') return truncateNotificationText(String(metadata.document?.fileName || 'Document'), 60);
  const body = message.content?.trim().replace(/\s+/gu, ' ');
  if (body) return truncateNotificationText(body, 60);
  const keys = message.mediaKeys?.length ? message.mediaKeys : message.photoUrl ? [message.photoUrl] : [];
  if (keys.length) {
    const video = keys.every(key => /\.mp4$/i.test(key));
    const mixed = !video && keys.some(key => /\.mp4$/i.test(key));
    if (keys.length > 1) return `${keys.length} ${mixed ? 'attachments' : video ? 'videos' : 'photos'}`;
    return /\.gif$/i.test(keys[0]) ? 'GIF' : video ? 'Video' : 'Photo';
  }
  return 'Message';
}
