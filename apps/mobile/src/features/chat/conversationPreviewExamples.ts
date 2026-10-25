import type { LastMessage } from '../../store/chatSlice';
import type { PreviewDraft, ReactionPreview } from './conversationPreview';

export interface PreviewExample {
  label: string;
  message: Partial<LastMessage> | null;
  draft?: PreviewDraft;
  activity?: 'typing' | 'recording';
  reaction?: boolean;
}
export const previewExamples: PreviewExample[] = [
  { label: 'Text', message: { content: 'Oi call kori?' } },
  { label: 'Emoji', message: { content: '😂❤️🥹' } },
  { label: 'Combined emoji', message: { content: '👨‍👩‍👧‍👦 👍🏽 🇮🇳' } },
  { label: 'Text with emoji', message: { content: 'See you tomorrow 😊' } },
  { label: 'Long text and line breaks', message: { content: 'Let’s meet after class.\nWe can go to the café and talk about the college fest.' } },
  { label: 'Photo', message: { type: 'media', mediaKeys: ['photo.jpeg'] } },
  { label: 'Photo caption', message: { type: 'media', mediaKeys: ['photo.jpeg'], content: 'Our college fest ❤️' } },
  { label: 'Photo album', message: { type: 'media', mediaKeys: ['a.jpeg', 'b.jpeg', 'c.jpeg', 'd.jpeg'] } },
  { label: 'Video', message: { type: 'media', mediaKeys: ['clip.mp4'] } },
  { label: 'Video caption', message: { type: 'media', mediaKeys: ['clip.mp4'], content: 'Watch this 😂' } },
  { label: 'Video album', message: { type: 'media', mediaKeys: ['a.mp4', 'b.mp4'] } },
  { label: 'Mixed album', message: { type: 'media', mediaKeys: ['a.jpeg', 'b.mp4'] } },
  { label: 'GIF', message: { type: 'media', mediaKeys: ['meme.gif'] } },
  { label: 'Voice message', message: { type: 'voice', metadata: { durationSeconds: 18 } } },
  { label: 'Played voice message', message: { type: 'voice', metadata: { durationSeconds: 42 }, playedAt: '2026-10-22T09:00:01Z' } },
  { label: 'Document', message: { type: 'document', metadata: { document: { fileName: 'Assignment.pdf', mimeType: 'application/pdf' } } } },
  { label: 'Audio file fallback', message: { type: 'document', metadata: { document: { fileName: 'Recording.mp3', mimeType: 'audio/mpeg' } } } },
  { label: 'Link', message: { content: 'https://example.com/events' } },
  { label: 'Reply', message: { content: 'Yes, after class', replyToId: 'earlier' } },
  { label: 'Story reply', message: { type: 'story_reply', content: 'Looking good!' } },
  { label: 'Story reaction', message: { type: 'story_reply', content: '❤️', metadata: { storyReplyKind: 'reaction' } } },
  { label: 'Message reaction', message: { content: 'That was funny' }, reaction: true },
  { label: 'Edited message', message: { content: 'Meet at 5, please', editedAt: '2026-10-22T09:00:01Z', revision: 2 } },
  { label: 'Draft · only visible to its author', message: { content: 'See you soon' }, draft: { text: 'Are you free tonight?', media: [], updatedAt: 1 } },
  { label: 'Attachment draft', message: { content: 'See you soon' }, draft: { text: '', media: [{ kind: 'image' }], updatedAt: 1 } },
  { label: 'Typing · visible to the other person', message: { content: 'See you soon' }, activity: 'typing' },
  { label: 'Recording · visible to the other person', message: { content: 'See you soon' }, activity: 'recording' },
  { label: 'Waiting to send', message: { content: 'Are you there?', localStatus: 'queued' } },
  { label: 'Sent', message: { content: 'Are you there?' } },
  { label: 'Delivered', message: { content: 'Are you there?', deliveredAt: '2026-10-22T09:00:01Z' } },
  { label: 'Read', message: { content: 'Are you there?', readAt: '2026-10-22T09:00:01Z' } },
  { label: 'Uploading', message: { type: 'media', mediaKeys: ['local-photo.jpeg'], localStatus: 'sending', metadata: { localMediaUpload: { items: [{ status: 'uploading' }] } } } },
  { label: 'Processing', message: { type: 'media', localStatus: 'sending', metadata: { localMediaUpload: { items: [{ status: 'processing' }] } } } },
  { label: 'Failed', message: { content: 'Are you there?', localStatus: 'failed' } },
  { label: 'Failed attachment', message: { type: 'media', localStatus: 'failed' } },
  { label: 'Disappearing-message notice', message: { type: 'service', metadata: { seconds: 86400 } } },
  { label: 'Unknown attachment fallback', message: { type: 'unknown' } },
  { label: 'No messages', message: null },
];

export function exampleInput(example: PreviewExample, outgoing: boolean) {
  const lastMessage: LastMessage | null = example.message ? {
    id: 'example', content: '', senderId: outgoing ? 'me' : 'peer', sentAt: '2026-10-22T09:00:00Z', isRead: false, readAt: null, type: 'text', ...example.message,
  } : null;
  const reaction: ReactionPreview | null = example.reaction ? {
    messageId: 'example', userId: outgoing ? 'me' : 'peer', emoji: '😂', at: '2026-10-22T09:00:02Z', messageSenderId: outgoing ? 'peer' : 'me', content: 'That was funny', type: 'text',
  } : null;
  return { lastMessage, currentUserId: 'me', peerName: 'Rupsa', draft: example.draft, activity: example.activity, reaction };
}
