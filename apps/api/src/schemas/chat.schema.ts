import { z } from 'zod';

export const deviceCursorSchema = z.object({ body: z.object({
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
  eventSeq: z.number().int().min(0),
}).strict() });

export const sendMessageSchema = z.object({
  body: z.object({
    content: z.string().max(2000, 'Message too long').default(''),
    mediaKey: z.string().optional(),
    mediaKeys: z.array(z.string().min(1).max(500)).max(10).optional(),
    clientMessageId: z.string().min(1).max(100).optional(),
    type: z.enum(['text', 'media', 'document', 'voice', 'story_reply']).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    replyToId: z.string().uuid().optional(),
    storyId: z.string().uuid().optional(),
  }).refine((data) => data.content.length > 0 || data.mediaKey || (data.mediaKeys?.length ?? 0) > 0, {
    message: "Message must either have content or a photo",
    path: ["content"],
  }),
});

export const editMessageSchema = z.object({
  body: z.object({
    content: z.string().trim().min(1).max(2000),
    expectedRevision: z.number().int().positive().optional(),
  }),
});

export const deleteMessageSchema = z.object({
  body: z.object({ mode: z.enum(['me', 'everyone']).default('everyone') }),
});

export const receiptSchema = z.object({
  body: z.object({ messageIds: z.array(z.string().uuid()).min(1).max(100) }),
});

export const reactionSchema = z.object({
  // Any single emoji. The shape is checked here; that it is exactly one emoji is
  // checked by the service, which is the one place that rule lives.
  body: z.object({ emoji: z.string().min(1).max(64).nullable() }).strict(),
});

export const pinConversationSchema = z.object({ body: z.object({ pinned: z.boolean() }).strict() });
export const archiveConversationSchema = z.object({ body: z.object({ archived: z.boolean() }).strict() });
export const unreadConversationSchema = z.object({ body: z.object({ unread: z.boolean() }).strict() });
export const clearConversationSchema = z.object({ body: z.object({ forEveryone: z.boolean().default(false) }).strict() });
export const messageTtlSchema = z.object({
  body: z.object({ seconds: z.number().int().min(60).max(366 * 24 * 60 * 60).nullable() }).strict(),
});

export const muteSchema = z.object({
  body: z.object({ mutedUntil: z.string().datetime().nullable() }),
});

export const getMessagesSchema = z.object({
  query: z.object({
    cursor: z.string().optional(),
    limit: z.string().optional(),
  }),
});
