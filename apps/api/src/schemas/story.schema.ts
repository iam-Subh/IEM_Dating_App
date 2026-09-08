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
export const storyReplySchema = z.object({ body: z.object({ content: z.string().trim().min(1).max(2000), clientMessageId: z.string().min(1).max(100) }) });
export const storySettingsSchema = z.object({ body: z.object({ storiesEnabled: z.boolean(), allowFollowRequests: z.boolean() }) });
