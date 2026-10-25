import { z } from 'zod';

export const followRequestSchema = z.object({ body: z.object({ userId: z.string().uuid(), disclosureAccepted: z.literal(true) }) });
export const followResponseSchema = z.object({ body: z.object({ accept: z.boolean() }) });
export const storyPublishSchema = z.object({
  body: z.object({
    assetId: z.string().uuid(),
    clientPublishId: z.string().min(1).max(100),
    caption: z.string().trim().max(200).optional(),
  }),
});
export const storyMuteSchema = z.object({ body: z.object({ muted: z.boolean() }) });
export const storyReplySchema = z.object({
  body: z.object({
    content: z.string().trim().min(1).max(2000),
    clientMessageId: z.string().min(1).max(100),
    kind: z.enum(['text', 'reaction']).optional(),
  }),
});
export const storySettingsSchema = z.object({
  body: z.object({
    storiesEnabled: z.boolean().optional(),
    allowFollowRequests: z.boolean().optional(),
    replies: z.enum(['matches', 'close_friends', 'off']).optional(),
    mentions: z.enum(['everyone', 'following', 'off']).optional(),
    resharing: z.boolean().optional(),
    screenshotBlock: z.boolean().optional(),
    archive: z.boolean().optional(),
    saveToGallery: z.boolean().optional(),
    showFollowerCount: z.boolean().optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, { message: 'Change at least one setting' }),
});
export const storyLikeSchema = z.object({ body: z.object({ liked: z.boolean() }).strict() });

const insightCount = z.number().int().min(0).max(1000).optional();
export const storyInsightEventsSchema = z.object({
  body: z.object({
    batchId: z.string().min(1).max(100),
    events: z.array(z.object({
      storyId: z.string().uuid(),
      views: insightCount,
      forward: insightCount,
      back: insightCount,
      nextStory: insightCount,
      exited: insightCount,
    }).strict()).min(1).max(100),
  }).strict(),
});
