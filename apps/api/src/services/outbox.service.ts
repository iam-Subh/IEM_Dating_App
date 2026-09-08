import { Prisma } from '@prisma/client';

export const OUTBOX_TOPICS = {
  MATCH_CREATED: 'match.created',
  MESSAGE_CREATED: 'message.created',
  CHAT_EVENT: 'chat.event',
  FOLLOW_REQUESTED: 'follow.requested',
  STORY_PUBLISHED: 'story.published',
  PROFILE_VIDEO_PREVIEW_REQUESTED: 'profile.video-preview.requested',
} as const;

export type OutboxTopic = (typeof OUTBOX_TOPICS)[keyof typeof OUTBOX_TOPICS];

export class OutboxService {
  static async enqueue(
    tx: Prisma.TransactionClient,
    input: {
      topic: OutboxTopic;
      aggregateId: string;
      deduplicationKey: string;
      payload: Prisma.InputJsonValue;
    },
  ) {
    return tx.outboxEvent.create({
      data: {
        topic: input.topic,
        aggregateId: input.aggregateId,
        deduplicationKey: input.deduplicationKey,
        payloadVersion: 1,
        payload: input.payload,
      },
    });
  }
}
