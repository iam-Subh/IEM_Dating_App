import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { transformToCdnUrl } from '../middlewares/upload.middleware';
import { ChatMediaService } from './chat-media.service';
import { MatchAccessService } from './match-access.service';
import { messageNotificationPrefs } from './app-settings.service';
import { PushService } from './push.service';
import { notificationReplySnippet, truncateNotificationText } from './chat-notification-preview';

/**
 * What a phone needs to draw a chat notification itself
 * (apps/mobile/src/features/notifications/MESSAGE_NOTIFICATIONS_PLAN.md 3, 4).
 *
 * With "Show name and message" off, the payload says only that a message
 * exists: no name, no text, no pictures pass through Google's servers.
 * Everything fits in a push (4 KB): text is cut at 500 characters.
 */

const TEXT_LIMIT = 500;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const PHOTO = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i;

export type ChatLineKind = 'text' | 'photo' | 'video' | 'voice' | 'document' | 'link' | 'story_reply';

export type ChatPushPayload = {
  type: 'chat';
  matchId: string;
  messageId: string;
  seq: number;
  sentAt: string;
  expiresAt?: string;
  previews: boolean;
  /** Device behaviour chosen in App settings (14). */
  photos: boolean;
  smartReplies: boolean;
  voicePlay: boolean;
  kind: ChatLineKind;
  sender?: { id: string; name: string; avatar?: string };
  /** The chat's title line: "Riya · New match" for the first message after matching. */
  newMatch?: boolean;
  text?: string;
  media?: { count: number; durationSec?: number; thumb?: string; fileName?: string; sizeBytes?: number; format?: 'gif' | 'mixed' };
  storyReaction?: boolean;
  replyTo?: { sender: string; snippet: string };
};

const cut = (value: string, limit = TEXT_LIMIT) => truncateNotificationText(value, limit);

export class ChatNotificationService {
  /** The payload for `recipientId`'s phones, or null if this message shouldn't notify. */
  static async payload(recipientId: string, messageId: string): Promise<ChatPushPayload | null> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true, matchId: true, senderId: true, content: true, type: true, photoUrl: true, mediaKeys: true,
        metadata: true, messageSeq: true, sentAt: true, expiresAt: true, isDeleted: true, replyToId: true,
        sender: { select: { name: true, avatarUrl: true, photos: { where: { isPrimary: true }, select: { thumbUrl: true, photoUrl: true }, take: 1 } } },
        match: { select: { status: true } },
      },
    });
    if (!message || message.isDeleted || message.match.status !== 'active' || message.senderId === recipientId) return null;
    const owner = await prisma.user.findUnique({ where: { id: recipientId }, select: { notificationPrefs: true, notifyLikes: true } });
    if (!owner) return null;
    const prefs = messageNotificationPrefs(owner);
    const metadata = (message.metadata && typeof message.metadata === 'object' ? message.metadata : {}) as Record<string, any>;
    const keys = message.mediaKeys.length ? message.mediaKeys : message.photoUrl ? [message.photoUrl] : [];
    const kind: ChatLineKind = message.type === 'voice' ? 'voice'
      : message.type === 'document' ? 'document'
        : message.type === 'story_reply' ? 'story_reply'
          : keys.length && keys.every((key) => VIDEO.test(key)) ? 'video'
            : keys.length ? 'photo'
              : metadata.linkPreview ? 'link' : 'text';
    const earlier = await prisma.message.count({ where: { matchId: message.matchId, id: { not: message.id }, sentAt: { lte: message.sentAt } } });
    const payload: ChatPushPayload = {
      type: 'chat',
      matchId: message.matchId,
      messageId: message.id,
      seq: message.messageSeq ?? 0,
      sentAt: message.sentAt.toISOString(),
      ...(message.expiresAt ? { expiresAt: message.expiresAt.toISOString() } : {}),
      previews: prefs.previews,
      photos: prefs.previews && prefs.photos,
      smartReplies: prefs.smartReplies,
      voicePlay: prefs.voicePlay,
      kind,
      ...(earlier === 0 ? { newMatch: true } : {}),
      media: keys.length || kind === 'voice' || kind === 'document' ? { count: Math.max(1, keys.length) } : undefined,
    };
    if (kind === 'voice' && typeof metadata.durationSeconds === 'number') payload.media!.durationSec = Math.max(0, Math.floor(metadata.durationSeconds));
    if (kind === 'photo' && keys.length === 1 && /\.gif$/i.test(keys[0])) payload.media!.format = 'gif';
    if (kind === 'photo' && keys.some(key => VIDEO.test(key))) payload.media!.format = 'mixed';
    // The rest is private: only with "Show name and message".
    if (!prefs.previews) return payload;
    if (kind === 'story_reply' && metadata.storyReplyKind === 'reaction') payload.storyReaction = true;
    const avatar = message.sender.photos[0]?.thumbUrl ?? message.sender.photos[0]?.photoUrl ?? message.sender.avatarUrl;
    payload.sender = { id: message.senderId, name: cut(message.sender.name, 60), ...(avatar ? { avatar: transformToCdnUrl(avatar) } : {}) };
    if (kind === 'document' && metadata.document) {
      payload.media = { ...payload.media!, fileName: cut(String(metadata.document.fileName ?? ''), 80), sizeBytes: Number(metadata.document.size) || undefined };
    }
    // A voice message's text is its length in seconds - never shown as words.
    const text = kind === 'voice' ? '' : message.content?.trim();
    if (text) payload.text = cut(text);
    if (message.replyToId) {
      const parent = await prisma.message.findFirst({
        where: { id: message.replyToId, matchId: message.matchId, isDeleted: false, NOT: { hiddenBy: { has: recipientId } }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { content: true, senderId: true, sender: { select: { name: true } }, type: true, metadata: true, mediaKeys: true, photoUrl: true },
      });
      if (parent) {
        payload.replyTo = {
          sender: parent.senderId === recipientId ? 'You' : parent.sender.name.split(' ')[0],
          snippet: notificationReplySnippet(parent),
        };
      }
    }
    if (payload.photos && (kind === 'photo' || kind === 'video')) {
      payload.media!.thumb = await this.thumbUrl(recipientId, keys[0], kind).catch(() => undefined);
    }
    return payload;
  }

  /** A signed link (15 minutes) to the first photo, or a video's poster frame. */
  private static async thumbUrl(recipientId: string, key: string, kind: 'photo' | 'video') {
    if (kind === 'photo' && !PHOTO.test(key)) return undefined;
    const asset = await prisma.chatMediaAsset.findUnique({ where: { objectKey: key }, select: { thumbnailObjectKey: true } });
    return asset?.thumbnailObjectKey ? ChatMediaService.generateReadUrl(recipientId, asset.thumbnailObjectKey) : undefined;
  }

  /** The ready-made text for phones that can't draw chat notifications (older app versions, iPhone). */
  static legacyText(payload: ChatPushPayload | null, fallback: { title: string; body: string }) {
    if (!payload?.previews || !payload.sender) return fallback;
    const line = payload.kind === 'voice' ? '🎤 Voice message'
      : payload.kind === 'photo' ? (payload.media?.format === 'gif' ? '🎞 GIF' : payload.media?.format === 'mixed' ? `📎 ${payload.media.count} attachments` : payload.media && payload.media.count > 1 ? `📷 ${payload.media.count} photos` : '📷 Photo')
        : payload.kind === 'video' ? '🎥 Video'
          : payload.kind === 'document' ? `📄 ${payload.media?.fileName ?? 'Document'}`
            : payload.kind === 'story_reply' ? `Replied to your story${payload.text ? `: ${payload.text}` : ''}`
              : payload.text ?? 'New message';
    return { title: payload.sender.name, body: cut(line, 120) };
  }

  /**
   * An edit, a delete, a reaction or a mute changes a notification already on
   * the phone (9). Silent and at normal priority: it shows nothing new.
   */
  static async sendUpdate(recipientId: string, update: Record<string, string | number | boolean | null>) {
    await PushService.sendNative(recipientId, { type: 'chat_update', ...update }, 'normal').catch((error) => {
      logger.warn(`[PUSH] chat update failed: ${(error as Error).message}`);
    });
  }

  /** A short-lived link to a voice note for the status-bar player (7). */
  static async voiceUrl(userId: string, matchId: string, messageId: string) {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    const message = await prisma.message.findFirst({
      where: { id: messageId, matchId, type: 'voice', isDeleted: false, NOT: { hiddenBy: { has: userId } } },
      select: { mediaKeys: true, metadata: true, sender: { select: { name: true } } },
    });
    if (!message?.mediaKeys[0]) throw new HttpError(404, 'Voice message is unavailable', 'VOICE_MESSAGE_UNAVAILABLE');
    const url = await ChatMediaService.generateReadUrl(userId, message.mediaKeys[0]);
    const duration = (message.metadata as Record<string, unknown> | null)?.durationSeconds;
    return { url, senderName: message.sender.name, durationSec: typeof duration === 'number' ? duration : null };
  }
}
