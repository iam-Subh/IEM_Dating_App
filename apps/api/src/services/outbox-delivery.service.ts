import { VerificationLimitsService } from './verification-limits.service';
import { Prisma } from '@prisma/client';
import { showsMessagePreviews } from './app-settings.service';
import { getIO } from '../socket';
import { prisma } from '../utils/prisma';
import { OUTBOX_TOPICS } from './outbox.service';
import { VideoPreviewService } from './videoPreview.service';
import { PushService } from './push.service';
import { ChatNotificationService } from './chat-notification.service';
import { notificationReplySnippet } from './chat-notification-preview';
import { LINES, pickLine } from './push-policy.service';
import { StoryVisibilityService } from './story-visibility.service';
import { LikesService, seenCutoff } from './likes.service';

type ClaimedEvent = {
  id: string;
  topic: string;
  aggregateId: string;
  payloadVersion: number;
  payload: Prisma.JsonValue;
};

function objectPayload(payload: Prisma.JsonValue): Record<string, unknown> {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('Outbox payload must be an object');
  }
  return payload as Record<string, unknown>;
}

export class OutboxDeliveryService {
  static async deliver(event: ClaimedEvent): Promise<void> {
    if (event.payloadVersion !== 1) throw new Error(`Unsupported payload version: ${event.payloadVersion}`);
    if (event.topic === OUTBOX_TOPICS.MESSAGE_CREATED) return this.deliverMessage(event);
    if (event.topic === OUTBOX_TOPICS.CHAT_EVENT) return this.deliverChatEvent(event);
    if (event.topic === OUTBOX_TOPICS.FOLLOW_REQUESTED) return this.deliverFollowRequest(event);
    if (event.topic === OUTBOX_TOPICS.STORY_PUBLISHED) return this.deliverStoryPublished(event);
    if (event.topic === OUTBOX_TOPICS.STORY_BATCH_FAILED) return this.deliverStoryBatchFailed(event);
    if (event.topic === OUTBOX_TOPICS.MATCH_CREATED) return this.deliverMatch(event);
    if (event.topic === OUTBOX_TOPICS.REACTION_ADDED) return this.deliverReaction(event);
    if (event.topic === OUTBOX_TOPICS.LIKE_RECEIVED) return this.deliverLikeReceived(event);
    if (event.topic === OUTBOX_TOPICS.PROFILE_VIDEO_PREVIEW_REQUESTED) {
      return VideoPreviewService.generatePreview(event.aggregateId);
    }
    throw new Error(`Unsupported outbox topic: ${event.topic}`);
  }

  private static async updateChatNotification(matchId: string, actorId: string | null, messageId: string, action: 'edit' | 'delete') {
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { user1Id: true, user2Id: true } });
    if (!match) return;
    const recipientId = match.user1Id === actorId ? match.user2Id : match.user1Id;
    let text: string | null = null;
    if (action === 'edit') {
      const owner = await prisma.user.findUnique({ where: { id: recipientId }, select: { notificationPrefs: true, notifyLikes: true } });
      const message = await prisma.message.findUnique({ where: { id: messageId }, select: { content: true } });
      text = owner && showsMessagePreviews(owner) ? (message?.content ?? '').trim().slice(0, 500) : null;
    }
    await ChatNotificationService.sendUpdate(recipientId, { action, matchId, messageId, text });
  }

  private static async deliverChatEvent(event: ClaimedEvent): Promise<void> {
    const chatEvent = await prisma.chatEvent.findUnique({ where: { id: event.aggregateId } });
    if (!chatEvent) return;
    let projectedPayload: Prisma.JsonValue = chatEvent.payload;
    if (chatEvent.type === 'message.edited') {
      const message = await prisma.message.findFirst({ where: { id: chatEvent.entityId, matchId: chatEvent.matchId, isDeleted: false }, select: { id: true, content: true, editedAt: true, revision: true } });
      if (message) projectedPayload = { messageId: message.id, content: message.content, editedAt: message.editedAt?.toISOString() ?? null, revision: message.revision };
    }
    if (chatEvent.type === 'message.created') {
      const message = await prisma.message.findFirst({
        where: { id: chatEvent.entityId, matchId: chatEvent.matchId, isDeleted: false },
        select: {
          id: true, matchId: true, senderId: true, content: true, sentAt: true, readAt: true,
          clientMessageId: true, messageSeq: true, type: true, mediaKeys: true, photoUrl: true,
          metadata: true, replyToId: true, storyId: true, editedAt: true, revision: true, expiresAt: true,
        },
      });
      const projectedMessage = message ? {
        id: message.id,
        matchId: message.matchId,
        senderId: message.senderId,
        content: message.content,
        sentAt: message.sentAt.toISOString(),
        readAt: message.readAt?.toISOString() ?? null,
        deliveredAt: null,
        clientMessageId: message.clientMessageId,
        messageSeq: message.messageSeq,
        type: message.type,
        mediaKeys: message.mediaKeys,
        mediaKey: message.photoUrl,
        metadata: message.metadata,
        replyToId: message.replyToId,
        storyId: message.storyId,
        editedAt: message.editedAt?.toISOString() ?? null,
        revision: message.revision,
        expiresAt: message.expiresAt?.toISOString() ?? null,
      } : null;
      projectedPayload = {
        messageId: chatEvent.entityId,
        message: projectedMessage,
      };
    }
    // An edit or a delete changes the notification already on the other
    // person's phone (MESSAGE_NOTIFICATIONS_PLAN.md 9).
    if (chatEvent.type === 'message.edited' || (chatEvent.type === 'message.deleted' && !chatEvent.audienceUserId)) {
      void this.updateChatNotification(chatEvent.matchId, chatEvent.actorId, chatEvent.entityId, chatEvent.type === 'message.edited' ? 'edit' : 'delete');
    }
    const room = chatEvent.audienceUserId ? `user:${chatEvent.audienceUserId}` : chatEvent.matchId;
    getIO()?.to(room).emit('chat_event', {
      id: chatEvent.id,
      matchId: chatEvent.matchId,
      eventSeq: chatEvent.eventSeq,
      type: chatEvent.type,
      actorId: chatEvent.actorId,
      entityId: chatEvent.entityId,
      entityRevision: chatEvent.entityRevision,
      payload: projectedPayload,
      createdAt: chatEvent.createdAt,
      deliveryId: event.id,
    });
  }

  /**
   * "Someone mentioned you in their story". Like message pushes, the lock
   * screen shows no name; the app shows who once opened.
   */
  private static async deliverStoryPublished(event: ClaimedEvent): Promise<void> {
    const payload = objectPayload(event.payload);
    const ownerId = String(payload.ownerId ?? '');
    const recipients = Array.isArray(payload.mentionedUserIds) ? payload.mentionedUserIds.map(String) : [];
    const story = await prisma.story.findFirst({ where: { id: event.aggregateId, state: 'published', deletedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (!story) return;

    // Mentions: a push to each person named in this Story.
    for (const recipientId of recipients) {
      const deliveryKey = `${event.id}:${recipientId}`;
      const notification = await prisma.notification.upsert({
        where: { deliveryKey },
        create: {
          userId: recipientId, type: 'story_mention', title: 'New mention', body: 'Someone mentioned you in their story.',
          data: { storyId: story.id }, actionUrl: `/stories/${story.id}`, deliveryKey, outboxEventId: event.id,
        },
        update: {},
      });
      if (notification.pushSentAt) continue;
      await PushService.send(recipientId, {
        title: 'New mention',
        body: 'Someone mentioned you in their story.',
        data: { url: `iemdating://stories/${story.id}`, storyId: story.id, kind: 'story_mention' },
        category: 'story_mentions',
        notificationId: notification.id,
      }, event.id);
      await prisma.notification.update({ where: { id: notification.id }, data: { pushSentAt: new Date() } });
    }

    // Live tray update (STORY_AUDIENCE_SPEC.md, section 17.3): a lightweight
    // nudge to everyone who could ever see this owner's Stories. The client
    // just refetches its tray, which already applies the full visibility and
    // mute rules - so this never has to work out Close Friends or hidden
    // itself, and never risks leaking who is on either list.
    if (!ownerId) return;
    const io = getIO();
    if (!io) return;
    const audience = await StoryVisibilityService.audienceOf(ownerId);
    for (const recipientId of audience) {
      io.to(`user:${recipientId}`).emit('story_published', { ownerId });
    }
  }

  /** A background post that could not finish. The draft is still on the phone. */
  private static async deliverStoryBatchFailed(event: ClaimedEvent): Promise<void> {
    const payload = objectPayload(event.payload);
    const ownerId = String(payload.ownerId ?? '');
    if (!ownerId) return;
    const deliveryKey = `${event.id}:${ownerId}`;
    const notification = await prisma.notification.upsert({
      where: { deliveryKey },
      create: {
        userId: ownerId, type: 'story_post_failed', title: "Couldn't post your story", body: 'Open the app to try again.',
        data: { batchId: event.aggregateId }, actionUrl: '/discover', deliveryKey, outboxEventId: event.id,
      },
      update: {},
    });
    if (notification.pushSentAt) return;
    await PushService.send(ownerId, {
      title: "Couldn't post your story",
      body: 'Open the app to try again.',
      data: { url: 'iemdating://main/Dashboard', batchId: event.aggregateId, kind: 'story_post_failed' },
      category: 'story_problems',
      notificationId: notification.id,
    }, event.id);
    await prisma.notification.update({ where: { id: notification.id }, data: { pushSentAt: new Date() } });
  }

  private static async deliverFollowRequest(event: ClaimedEvent): Promise<void> {
    const payload = objectPayload(event.payload);
    const recipientId = String(payload.recipientId ?? '');
    if (!recipientId) return;
    const deliveryKey = `${event.id}:${recipientId}`;
    const notification = await prisma.notification.upsert({
      where: { deliveryKey },
      create: {
        userId: recipientId,
        type: 'follow_request',
        title: 'New follow request',
        body: 'Open the app to review it.',
        data: { followId: event.aggregateId },
        actionUrl: '/stories/follow-requests',
        deliveryKey,
        outboxEventId: event.id,
      },
      update: {},
    });
    if (notification.pushSentAt) return;
    await PushService.send(recipientId, {
      title: 'New follow request',
      body: 'Open the app to review it.',
      data: { url: 'iemdating://stories/follow-requests', followId: event.aggregateId },
      category: 'follow_requests',
      kind: 'follow_request',
      notificationId: notification.id,
    }, event.id);
    await prisma.notification.update({ where: { id: notification.id }, data: { pushSentAt: new Date() } });
  }

  private static async deliverMessage(event: ClaimedEvent): Promise<void> {
    const payload = objectPayload(event.payload);
    const recipientId = String(payload.recipientId ?? '');
    if (!recipientId) throw new Error('Message event has no recipient');

    const message = await prisma.message.findUnique({
      where: { id: event.aggregateId },
      select: {
        id: true,
        matchId: true,
        senderId: true,
        content: true,
        photoUrl: true,
        mediaKeys: true,
        clientMessageId: true,
        sentAt: true,
        readAt: true,
        isDeleted: true,
        sender: { select: { name: true } },
        match: { select: { status: true, user1Id: true, user2Id: true } },
      },
    });
    if (!message || message.isDeleted) return;
    const isRecipient = message.match.user1Id === recipientId || message.match.user2Id === recipientId;
    if (message.match.status !== 'active' || !isRecipient || message.senderId === recipientId) return;

    const preview = message.mediaKeys.length || message.photoUrl ? 'Sent an attachment' : 'Sent you a message';
    const notification = await prisma.notification.upsert({
      where: { deliveryKey: `${event.id}:${recipientId}` },
      create: {
        userId: recipientId,
        type: 'message',
        title: 'New message',
        body: preview.slice(0, 50),
        data: { matchId: message.matchId, messageId: message.id },
        actionUrl: `/chat/${message.matchId}`,
        deliveryKey: `${event.id}:${recipientId}`,
        outboxEventId: event.id,
      },
      update: {},
    });

    if (notification.pushSentAt) return;
    const participant = await prisma.chatParticipant.findUnique({
      where: { matchId_userId: { matchId: message.matchId, userId: recipientId } },
      select: { mutedUntil: true },
    });
    if (participant?.mutedUntil && participant.mutedUntil > new Date()) return;
    // Name and text only for someone who chose previews; otherwise the lock screen says nothing private.
    const owner = await prisma.user.findUnique({ where: { id: recipientId }, select: { notificationPrefs: true, notifyLikes: true } });
    const previews = !!owner && showsMessagePreviews(owner);
    const text = !message.mediaKeys.length && !message.photoUrl && message.content ? message.content.trim() : '';
    // Phones that draw chat notifications get the message itself; others the
    // ready-made text, now with 📷 / 🎤 / 📄 lines (MESSAGE_NOTIFICATIONS_PLAN.md 3, 4).
    const native = await ChatNotificationService.payload(recipientId, message.id);
    const ready = ChatNotificationService.legacyText(native, {
      title: previews ? message.sender.name : 'New message',
      body: previews ? (text ? text.slice(0, 120) : 'Sent an attachment') : preview.slice(0, 50),
    });
    await PushService.send(recipientId, {
      ...ready,
      data: { url: `iemdating://chat/${message.matchId}`, matchId: message.matchId, messageId: message.id },
      category: 'messages',
      kind: 'message',
      notificationId: notification.id,
      ...(native ? { native } : {}),
    }, event.id);
    await prisma.notification.update({ where: { id: notification.id }, data: { pushSentAt: new Date() } });

  }

  /**
   * "Reacted 👍 to your message", as Telegram sends when the author is away.
   *
   * Same privacy posture as message pushes in this app: the lock screen shows
   * neither the reactor's name nor the message text. The emoji is the point of
   * the notification and reveals nothing about the conversation. Whether the
   * author is currently looking at the chat is decided on the device, which is
   * the only place that knows.
   */
  private static async deliverReaction(event: ClaimedEvent): Promise<void> {
    const payload = objectPayload(event.payload);
    const reactorId = String(payload.reactorId ?? '');
    const emoji = String(payload.emoji ?? '');
    if (!reactorId || !emoji) return;

    const message = await prisma.message.findUnique({
      where: { id: event.aggregateId },
      select: {
        id: true, matchId: true, senderId: true, isDeleted: true, type: true, mediaKeys: true, photoUrl: true,
        match: { select: { status: true } },
      },
    });
    if (!message || message.isDeleted || message.match.status !== 'active') return;
    const recipientId = message.senderId;
    if (recipientId === reactorId) return;

    // Delivered after it was queued, so re-check: a reaction changed or taken
    // back in the meantime must not be announced.
    const standing = await prisma.messageReaction.findUnique({
      where: { messageId_userId: { messageId: message.id, userId: reactorId } },
      select: { emoji: true },
    });
    if (standing?.emoji !== emoji) return;

    const subject = message.type === 'voice'
      ? 'voice message'
      : message.mediaKeys.length || message.photoUrl ? 'attachment' : 'message';
    const title = 'New reaction';
    const body = `Reacted ${emoji} to your ${subject}`;
    const deliveryKey = `${event.id}:${recipientId}`;
    const notification = await prisma.notification.upsert({
      where: { deliveryKey },
      create: {
        userId: recipientId,
        type: 'reaction',
        title,
        body,
        data: { matchId: message.matchId, messageId: message.id, emoji },
        actionUrl: `/chat/${message.matchId}`,
        deliveryKey,
        outboxEventId: event.id,
      },
      update: {},
    });
    if (notification.pushSentAt) return;
    const participant = await prisma.chatParticipant.findUnique({
      where: { matchId_userId: { matchId: message.matchId, userId: recipientId } },
      select: { mutedUntil: true },
    });
    if (participant?.mutedUntil && participant.mutedUntil > new Date()) return;
    // On phones that draw chats: a line in the chat's notification (MESSAGE_NOTIFICATIONS_PLAN.md 4).
    const owner = await prisma.user.findUnique({ where: { id: recipientId }, select: { notificationPrefs: true, notifyLikes: true, } });
    const previews = !!owner && showsMessagePreviews(owner);
    const reactor = previews ? await prisma.user.findUnique({ where: { id: reactorId }, select: { name: true } }) : null;
    const original = previews ? await prisma.message.findUnique({ where: { id: message.id }, select: { content: true } }) : null;
    await PushService.send(recipientId, {
      title,
      body,
      data: { url: `iemdating://chat/${message.matchId}`, matchId: message.matchId, messageId: message.id, kind: 'reaction' },
      category: 'reactions',
      notificationId: notification.id,
      native: {
        type: 'chat_reaction', matchId: message.matchId, messageId: message.id, emoji, previews, subject,
        ...(reactor ? { sender: { id: reactorId, name: reactor.name } } : {}),
        ...(original?.content && message.type !== 'voice' ? { snippet: notificationReplySnippet({ ...message, content: original.content }) } : {}),
      },
    }, event.id);
    await prisma.notification.update({ where: { id: notification.id }, data: { pushSentAt: new Date() } });
  }

  /**
   * A Like or Rose received (STANDOUTS_LIKES_SPEC.md 4.4). Never the sender's
   * name - a lock screen is readable by whoever sits next to you in a lecture.
   * A Rose is told at once, at most ROSE_PUSHES_PER_DAY a day; ordinary Likes
   * are batched into one "You have new Likes" at most every LIKE_PUSH_GAP_MS,
   * so a burst of ten is one push and none can be matched to a moment.
   */
  private static async deliverLikeReceived(event: ClaimedEvent): Promise<void> {
    const ROSE_PUSHES_PER_DAY = 3;
    // At most one an hour; later ones stack into "N people like you" (NOTIFICATIONS_PLAN.md 5).
    const LIKE_PUSH_GAP_MS = 60 * 60_000;
    const payload = objectPayload(event.payload);
    const recipientId = String(payload.recipientId ?? '');
    const isRose = payload.rose === true;
    // A comment on a photo or the bio rode on it: the push says on what, never the words.
    const commented = payload.commented === 'photo' || payload.commented === 'bio' ? payload.commented : null;
    if (!recipientId) return;
    const [recipient, swipe] = await Promise.all([
      prisma.user.findUnique({ where: { id: recipientId }, select: { notifyLikes: true, accountStatus: true, likesSeenAt: true } }),
      prisma.swipe.findUnique({ where: { id: event.aggregateId }, select: { swiperId: true, targetId: true, action: true, createdAt: true } }),
    ]);
    if (!recipient || recipient.accountStatus !== 'active') return;
    // Rewound or answered by the time this runs: nothing to tell.
    if (!swipe || swipe.action !== 'like' || swipe.targetId !== recipientId) return;
    const answered = await prisma.swipe.findUnique({
      where: { swiperId_targetId: { swiperId: recipientId, targetId: swipe.swiperId } },
      select: { id: true },
    });
    if (answered) return;
    // Live first: an open Likes You and the heart's dot re-read now. This
    // runs once the Rewind window has closed (LIKE_GRACE_MS), so the Like is
    // there to be read, and the push below follows the same timing.
    LikesService.nudge([recipientId]);
    // Likes and Roses have their own switches; the push checks them (App settings).
    // Already seen: Likes You was opened after this Like became visible.
    if (swipe.createdAt <= seenCutoff(recipient.likesSeenAt)) return;

    let title: string;
    let body: string;
    let template: string | undefined;
    if (isRose) {
      const today = await prisma.notification.count({
        where: { userId: recipientId, type: 'rose', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
      });
      if (today >= ROSE_PUSHES_PER_DAY) return;
      ({ title, body, id: template } = pickLine(LINES.rose));
    } else {
      // Claims the batch window atomically, so parallel deliveries send one push.
      const claimed = await prisma.$executeRaw`
        UPDATE users SET likes_pushed_at = now()
        WHERE id = ${recipientId}::uuid
          AND (likes_pushed_at IS NULL OR likes_pushed_at < ${new Date(Date.now() - LIKE_PUSH_GAP_MS)})`;
      if (!claimed) return;
      // Only what is true: the unseen Likes waiting right now.
      const { unseen } = await LikesService.summary(recipientId);
      if (unseen <= 1 && commented) {
        title = commented === 'photo' ? 'Someone commented on your photo' : 'Someone commented on your bio';
        body = 'Open Likes You to read it.';
        template = undefined;
      } else if (unseen <= 1) {
        const liker = await prisma.user.findUnique({ where: { id: swipe.swiperId }, select: { campusRef: { select: { name: true } } } });
        const campus = liker?.campusRef?.name;
        const set = campus ? LINES.like_one : LINES.like_one.filter((line) => !line.title.includes('{campus}'));
        ({ title, body, id: template } = pickLine(set, { campus: campus ?? '' }));
      } else {
        ({ title, body, id: template } = pickLine(LINES.like_many, { count: unseen }));
      }
    }
    // Reminder 27 (GOOGLE_SIGNUP_PLAN.md 4): to someone who hasn't verified,
    // a Like from a verified student says so - still never who.
    const [senderVerified, recipientLimited] = await Promise.all([
      prisma.studentMembership.count({
        where: { userId: swipe.swiperId, status: 'verified', verifiedAt: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      }),
      VerificationLimitsService.isLimited(recipientId),
    ]);
    if (senderVerified && recipientLimited) {
      title = isRose ? 'A verified student sent you a Rose' : 'A verified student liked you';
      body = 'Open Likes You to see who - and get your blue badge so they see it.';
      template = undefined;
    }
    const deliveryKey = `${event.id}:${recipientId}`;
    const notification = await prisma.notification.upsert({
      where: { deliveryKey },
      create: {
        userId: recipientId,
        type: isRose ? 'rose' : 'like',
        title,
        body,
        data: {},
        actionUrl: '/likes-you',
        deliveryKey,
        outboxEventId: event.id,
      },
      update: {},
    });
    if (notification.pushSentAt) return;
    // Likes You is the first tab of Matches.
    await PushService.send(recipientId, {
      title, body, template, notificationId: notification.id, kind: isRose ? 'rose' : 'like',
      data: { url: 'iemdating://main/matches?tab=likes' }, category: isRose ? 'roses' : 'likes',
    }, event.id);
    await prisma.notification.update({ where: { id: notification.id }, data: { pushSentAt: new Date() } });
  }

  private static async deliverMatch(event: ClaimedEvent): Promise<void> {
    const match = await prisma.match.findUnique({
      where: { id: event.aggregateId },
      select: {
        id: true,
        status: true,
        user1Id: true,
        user2Id: true,
        user1: { select: { name: true } },
        user2: { select: { name: true } },
      },
    });
    if (!match || match.status !== 'active') return;

    const deliveries = [
      { userId: match.user1Id, otherName: match.user2.name },
      { userId: match.user2Id, otherName: match.user1.name },
    ];
    for (const delivery of deliveries) {
      const line = pickLine(LINES.match, { name: delivery.otherName.split(' ')[0] });
      const notification = await prisma.notification.upsert({
        where: { deliveryKey: `${event.id}:${delivery.userId}` },
        create: {
          userId: delivery.userId,
          type: 'match',
          title: "It's a match!",
          body: `You and ${delivery.otherName} liked each other.`,
          data: { matchId: match.id },
          actionUrl: `/match/${match.id}`,
          deliveryKey: `${event.id}:${delivery.userId}`,
          outboxEventId: event.id,
        },
        update: {},
      });
      if (!notification.pushSentAt) {
      await PushService.send(delivery.userId, {
        title: line.title,
        body: line.body,
        template: line.id,
        // The chat: "Say hi" opens it with the keyboard up.
        data: { url: `iemdating://chat/${match.id}`, matchId: match.id },
        category: 'matches',
        kind: 'match',
        notificationId: notification.id,
      }, event.id);
        await prisma.notification.update({ where: { id: notification.id }, data: { pushSentAt: new Date() } });
      }
      const io = getIO();
      io?.in(`user:${delivery.userId}`).socketsJoin(match.id);
      io?.to(`user:${delivery.userId}`).emit('new_match', {
        matchId: match.id,
        deliveryId: event.id,
      });
    }
  }
}
