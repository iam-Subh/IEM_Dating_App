import type { LastMessage } from '../../store/chatSlice';

export type PreviewIcon = 'image-outline' | 'images-outline' | 'videocam-outline' | 'mic' | 'document-text-outline' | 'musical-notes-outline' | 'attach' | 'link-outline' | 'arrow-undo-outline' | 'time-outline';
export type PreviewStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | null;
export interface ReactionPreview {
  messageId: string;
  userId: string;
  emoji: string;
  at: string;
  messageSenderId: string;
  content: string;
  type?: string;
}
export interface PreviewDraft { text: string; media: Array<{ kind: string }>; replyToId?: string; updatedAt: number }
export interface ConversationPreview {
  text: string;
  prefix: string;
  icon?: PreviewIcon;
  status: PreviewStatus;
  tone: 'normal' | 'activity' | 'draft' | 'error' | 'service';
  thumbnailKey?: string;
  played: boolean;
}

/** Collapse layout whitespace. Native Text truncates the line without splitting emoji sequences. */
const line = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' ? value as Record<string, any> : {};
const duration = (value: unknown) => {
  const seconds = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function messagePreviewBody(last: LastMessage): { text: string; icon?: PreviewIcon } {
  const metadata = record(last.metadata);
  const caption = line(last.content);
  const keys = last.mediaKeys?.length ? last.mediaKeys : last.mediaKey ? [last.mediaKey] : [];
  const upload = record(metadata.localMediaUpload);
  const items: Record<string, any>[] = Array.isArray(upload.items) ? upload.items : [];
  if (last.type === 'voice') return { text: typeof metadata.durationSeconds === 'number' ? duration(metadata.durationSeconds) : 'Voice message', icon: 'mic' };
  if (last.type === 'document' || metadata.document) {
    const document = record(metadata.document);
    return { text: line(document.fileName) || line(items[0]?.fileName) || 'Document', icon: String(document.mimeType ?? '').startsWith('audio/') ? 'musical-notes-outline' : 'document-text-outline' };
  }
  if (last.type === 'media' && !keys.length && !items.length) return { text: caption || 'Attachment', icon: 'attach' };
  if (last.type === 'media' || keys.length || items.length) {
    const count = Math.max(keys.length, items.length, 1);
    const kinds = keys.length ? keys.map(key => (key.startsWith('local-video-') || /\.mp4(?:$|\?)/i.test(key)) ? 'video' : /\.gif(?:$|\?)/i.test(key) ? 'gif' : 'image') : items.map(item => item.kind === 'video' || String(item.mimeType).startsWith('video/') ? 'video' : item.mimeType === 'image/gif' ? 'gif' : 'image');
    const allVideo = kinds.length > 0 && kinds.every(kind => kind === 'video');
    const mixed = kinds.some(kind => kind === 'video') && !allVideo;
    const gif = count === 1 && kinds[0] === 'gif';
    const label = count > 1 ? `${count} ${mixed ? 'attachments' : allVideo ? 'videos' : 'photos'}` : gif ? 'GIF' : allVideo ? 'Video' : 'Photo';
    return { text: caption || label, icon: allVideo ? 'videocam-outline' : count > 1 ? 'images-outline' : 'image-outline' };
  }
  if (last.type && !['text', 'story_reply', 'service'].includes(last.type)) return { text: 'Attachment', icon: 'attach' };
  return { text: caption || 'Message', icon: last.replyToId ? 'arrow-undo-outline' : /https?:\/\//i.test(caption) ? 'link-outline' : undefined };
}

export function conversationPreview(input: {
  lastMessage: LastMessage | null;
  currentUserId: string;
  peerName?: string;
  draft?: PreviewDraft | null;
  activity?: 'typing' | 'recording' | null;
  reaction?: ReactionPreview | null;
  now?: number;
}): ConversationPreview {
  const { currentUserId, draft, activity, reaction } = input;
  const base: ConversationPreview = { text: '', prefix: '', status: null, tone: 'normal', played: false };
  if (activity) return { ...base, tone: 'activity', text: activity === 'recording' ? 'Recording voice message…' : 'Typing…', icon: activity === 'recording' ? 'mic' : undefined };
  if (draft && (line(draft.text) || draft.media.length || draft.replyToId)) {
    const count = draft.media.length;
    return { ...base, tone: 'draft', prefix: 'Draft: ', text: line(draft.text) || (count > 1 ? `${count} attachments` : count ? draft.media[0].kind === 'video' ? 'Video' : draft.media[0].kind === 'file' ? 'Document' : draft.media[0].kind === 'voice' ? 'Voice message' : 'Photo' : 'Reply') };
  }
  const last = input.lastMessage;
  if (!last || (last.expiresAt && Date.parse(last.expiresAt) <= (input.now ?? Date.now()))) return { ...base, text: 'Say hello! 👋' };
  if (reaction && Date.parse(reaction.at) > Date.parse(last.sentAt)) {
    const own = reaction.userId === currentUserId;
    const target = reaction.type === 'voice' ? 'a voice message' : reaction.content ? `“${line(reaction.content)}”` : 'an attachment';
    return { ...base, text: `${own ? 'You reacted' : 'Reacted'} ${reaction.emoji} to ${!own && reaction.messageSenderId === currentUserId ? 'your message' : target}` };
  }
  const mine = last.senderId === currentUserId;
  const metadata = record(last.metadata);
  if (last.type === 'service') {
    const who = mine ? 'You' : input.peerName || 'They';
    const seconds = metadata.seconds;
    const amount = typeof seconds === 'number' && seconds > 0 ? seconds % 86400 === 0 ? `${seconds / 86400} day${seconds === 86400 ? '' : 's'}` : seconds % 3600 === 0 ? `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}` : `${Math.ceil(seconds / 60)} minutes` : '';
    return { ...base, tone: 'service', icon: 'time-outline', text: amount ? `${who} set disappearing messages to ${amount}` : `${who} turned off disappearing messages` };
  }
  const body = messagePreviewBody(last);
  let status: PreviewStatus = !mine ? null : last.localStatus === 'failed' ? 'failed' : last.localStatus || last.id.startsWith('temp-') ? 'pending' : last.readAt ? 'read' : last.deliveredAt ? 'delivered' : 'sent';
  const uploading = record(metadata.localMediaUpload).items;
  const stages: string[] = Array.isArray(uploading) ? uploading.map(item => item.status) : [];
  if (mine && stages.some(stage => stage === 'failed' || stage === 'cancelled')) status = 'failed';
  const keys = last.mediaKeys?.length ? last.mediaKeys : last.mediaKey ? [last.mediaKey] : [];
  const attachmentName = last.type === 'voice' ? 'voice message' : last.type === 'document' ? 'document'
    : last.type === 'media' ? keys.length > 1 ? 'attachments'
    : keys[0]?.startsWith('local-video-') || /\.mp4(?:$|\?)/i.test(keys[0] ?? '') ? 'video'
    : keys.length ? 'photo' : 'attachment' : 'message';
  const text = status === 'failed' ? `Couldn’t send ${attachmentName}`
    : last.type === 'story_reply' && metadata.storyReplyKind === 'reaction'
    ? `${mine ? 'You reacted' : 'Reacted'} ${line(last.content)} to ${mine ? 'their' : 'your'} story`
    : last.type === 'story_reply'
    ? `${mine ? 'You replied to their story' : 'Replied to your story'}${line(last.content) ? `: ${line(last.content)}` : ''}`
    : mine && stages.some(stage => ['uploading', 'processing', 'queued'].includes(stage)) ? `${stages.includes('processing') ? 'Processing' : 'Uploading'} ${attachmentName}…`
    : body.text;
  const firstKey = last.mediaKeys?.[0] ?? last.mediaKey;
  const thumbnail = firstKey && /^chat-media-approved\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpeg|jpg|png|webp|gif|avif|heic|heif|mp4)$/i.test(firstKey)
    ? firstKey.replace(/\.[^.]+$/, '.thumbnail.jpg') : undefined;
  return { ...base, text, prefix: mine && last.type !== 'story_reply' && status !== 'failed' ? 'You: ' : '', icon: body.icon, status, tone: status === 'failed' ? 'error' : 'normal', thumbnailKey: status === 'failed' || last.type === 'document' || last.type === 'voice' ? undefined : last.previewThumbnailKey ?? thumbnail, played: last.type === 'voice' && Boolean(last.playedAt) };
}
