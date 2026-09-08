import { Prisma } from '@prisma/client';
import { getIO } from '../socket';
import { prisma } from '../utils/prisma';
import { OUTBOX_TOPICS } from './outbox.service';
import { VideoPreviewService } from './videoPreview.service';
import { PushService } from './push.service';

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
    if (event.topic === OUTBOX_TOPICS.STORY_PUBLISHED) return;
    if (event.topic === OUTBOX_TOPICS.MATCH_CREATED) return this.deliverMatch(event);
    if (event.topic === OUTBOX_TOPICS.PROFILE_VIDEO_PREVIEW_REQUESTED) {
      return VideoPreviewService.generatePreview(event.aggregateId);
    }
    throw new Error(`Unsupported outbox topic: ${event.topic}`);
  }

  private static async deliverChatEvent(event: ClaimedEvent): Promise<void> {
    const chatEvent = await prisma.chatEvent.findUnique({ where: { id: event.aggregateId } });
    if (!chatEvent) return;
    let projectedPayload: Prisma.JsonValue = chatEvent.payload;
    if (chatEvent.type === 'message.edited') {
      const message = await prisma.message.findFirst({ where: { id: chatEvent.entityId, matchId: chatEvent.matchId, isDeleted: false }, select: { id: true, content: true, editedAt: true, revision: true } });
      if (message) projectedPayload = { messageId: message.id, content: message.content, editedAt: message.editedAt?.toISOString() ?? null, revision: message.revision };
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

    getIO()?.to(message.matchId).emit('new_message', {
      id: message.id,
      matchId: message.matchId,
      senderId: message.senderId,
      sender: message.sender,
      content: message.content,
      mediaKey: message.photoUrl,
      mediaKeys: message.mediaKeys,
      clientMessageId: message.clientMessageId,
      sentAt: message.sentAt,
      readAt: message.readAt,
      deliveryId: event.id,
    });

    if (notification.pushSentAt) return;
    const participant = await prisma.chatParticipant.findUnique({
      where: { matchId_userId: { matchId: message.matchId, userId: recipientId } },
      select: { mutedUntil: true },
    });
    if (participant?.mutedUntil && participant.mutedUntil > new Date()) return;
    await PushService.send(recipientId, {
      title: 'New message',
      body: preview.slice(0, 50),
      data: { url: `iemdating://chat/${message.matchId}`, matchId: message.matchId, messageId: message.id },
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
        title: "It's a match!",
        body: `You and ${delivery.otherName} liked each other.`,
        data: { url: `iemdating://match/${match.id}`, matchId: match.id },
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
