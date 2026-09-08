import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { HttpError } from '../utils/httpError';
import { MatchAccessService } from './match-access.service';
import { OUTBOX_TOPICS, OutboxService } from './outbox.service';
import { AccountEventService } from './account-event.service';

type AppendInput = {
  matchId: string;
  type: string;
  actorId: string;
  entityId: string;
  entityRevision?: number;
  audienceUserId?: string;
  payload: Prisma.InputJsonValue;
  enqueueDelivery?: boolean;
};

export class ChatEventService {
  static async append(tx: Prisma.TransactionClient, input: AppendInput) {
    const session = await tx.chatSession.upsert({
      where: { matchId: input.matchId },
      create: { matchId: input.matchId, lastEventSeq: 1 },
      update: { lastEventSeq: { increment: 1 } },
      select: { lastEventSeq: true },
    });
    const event = await tx.chatEvent.create({
      data: {
        matchId: input.matchId,
        eventSeq: session.lastEventSeq,
        type: input.type,
        actorId: input.actorId,
        audienceUserId: input.audienceUserId,
        entityId: input.entityId,
        entityRevision: input.entityRevision ?? 1,
        payload: input.payload,
      },
    });
    if (input.enqueueDelivery !== false) {
      await OutboxService.enqueue(tx, {
        topic: OUTBOX_TOPICS.CHAT_EVENT,
        aggregateId: event.id,
        deduplicationKey: `chat.event:${event.id}`,
        payload: { matchId: input.matchId },
      });
    }
    const match = await tx.match.findUnique({ where: { id: input.matchId }, select: { user1Id: true, user2Id: true } });
    if (match) {
      await AccountEventService.append(tx, {
        userIds: input.audienceUserId ? [input.audienceUserId] : [match.user1Id, match.user2Id],
        type: 'conversation.updated',
        matchId: input.matchId,
        payload: { eventSeq: event.eventSeq },
      });
    }
    return event;
  }

  static async list(userId: string, matchId: string, afterSeq = 0, limit = 100) {
    await MatchAccessService.requireActiveMatch(userId, matchId);
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      throw new HttpError(400, 'Event cursor is invalid', 'INVALID_EVENT_CURSOR');
    }
    const take = Math.min(Math.max(limit, 1), 200);
    const session = await prisma.chatSession.findUnique({ where: { matchId }, select: { lastEventSeq: true } });
    const [events, earliest] = await Promise.all([
      prisma.chatEvent.findMany({
        where: {
          matchId,
          eventSeq: { gt: afterSeq, lte: session?.lastEventSeq ?? 0 },
          OR: [{ audienceUserId: null }, { audienceUserId: userId }],
        },
        orderBy: { eventSeq: 'asc' },
        take: take + 1,
      }),
      prisma.chatEvent.findFirst({ where: { matchId }, orderBy: { eventSeq: 'asc' }, select: { eventSeq: true } }),
    ]);
    const hasMore = events.length > take;
    const page = hasMore ? events.slice(0, take) : events;
    const editedIds = page.filter((event) => event.type === 'message.edited').map((event) => event.entityId);
    const editedMessages = editedIds.length ? await prisma.message.findMany({
      where: { id: { in: editedIds }, matchId, isDeleted: false, NOT: { hiddenBy: { has: userId } } },
      select: { id: true, content: true, editedAt: true, revision: true },
    }) : [];
    const editMap = new Map(editedMessages.map((message) => [message.id, message]));
    const createdIds = page.filter((event) => event.type === 'message.created').map((event) => event.entityId);
    const createdMessages = createdIds.length ? await prisma.message.findMany({
      where: { id: { in: createdIds }, matchId, isDeleted: false,
        NOT: { hiddenBy: { has: userId } } },
      select: { id: true, matchId: true, senderId: true, content: true, sentAt: true, readAt: true,
        clientMessageId: true, messageSeq: true, type: true, mediaKeys: true, photoUrl: true,
        metadata: true, replyToId: true, storyId: true, editedAt: true, revision: true },
    }) : [];
    const createdMap = new Map(createdMessages.map((message) => [message.id, message]));
    const projected = page.map((event) => {
      if (event.type === 'message.created') {
        const message = createdMap.get(event.entityId);
        return { ...event, payload: { messageId: event.entityId, message: message ? {
          ...message, mediaKey: message.photoUrl, photoUrl: undefined,
        } : null } };
      }
      const message = event.type === 'message.edited' ? editMap.get(event.entityId) : undefined;
      return message ? { ...event, payload: { messageId: message.id, content: message.content, editedAt: message.editedAt?.toISOString(), revision: message.revision } } : event;
    });
    const highWaterSeq = session?.lastEventSeq ?? 0;
    const lastReturnedSeq = page[page.length - 1]?.eventSeq ?? afterSeq;
    return {
      events: projected,
      // With no further authorized events the caller has seen everything it is
      // allowed to see, so advance past events private to the other
      // participant. Leaving the cursor behind kept the client permanently
      // short of the high-water mark and rescanning the same range.
      nextSeq: hasMore ? lastReturnedSeq : Math.max(lastReturnedSeq, highWaterSeq),
      highWaterSeq,
      hasMore,
      resetRequired: afterSeq > 0 && !!earliest && afterSeq < earliest.eventSeq - 1,
    };
  }
}
